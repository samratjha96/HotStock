// ABOUTME: Main Hono server for stock-picker-madness
// ABOUTME: Handles API routes, serves static files, and manages competition logic

import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import { db, generateId, generateSlug } from "./src/db";
import { fetchPrice, validateTicker } from "./src/yahoo";

const app = new Hono();

// Price cache: stores last refresh time per competition
const priceCache = new Map<string, number>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

// Serve static files from public directory
app.use("/public/*", serveStatic({ root: "./" }));

// Serve index.html at root
app.get("/", serveStatic({ path: "./public/index.html" }));

// Helper to check if a competition's pick window is still open
function isPickWindowOpen(competition: { pick_window_start: string; pick_window_end: string }): boolean {
  const now = new Date();
  const start = new Date(competition.pick_window_start);
  const end = new Date(competition.pick_window_end);
  return now >= start && now <= end;
}

// Helper to check if competition is locked (past pick window)
function isCompetitionLocked(competition: { pick_window_end: string }): boolean {
  const now = new Date();
  const end = new Date(competition.pick_window_end);
  return now > end;
}

// Helper to find competition by slug or ID
function findCompetition(slugOrId: string) {
  // First try by slug (more common for shared URLs)
  let competition = db.query(`SELECT * FROM competitions WHERE slug = ?`).get(slugOrId);
  if (!competition) {
    // Fall back to ID lookup for backwards compatibility
    competition = db.query(`SELECT * FROM competitions WHERE id = ?`).get(slugOrId);
  }
  return competition as {
    id: string;
    name: string;
    slug: string;
    pick_window_start: string;
    pick_window_end: string;
    created_at: string;
  } | null;
}

// Helper to refresh prices for a competition (with caching)
async function refreshPricesIfNeeded(competition: { id: string; pick_window_end: string }) {
  const lastRefresh = priceCache.get(competition.id) || 0;
  const now = Date.now();
  
  if (now - lastRefresh < CACHE_TTL_MS) {
    return; // Cache still valid
  }
  
  const participants = db.query(`SELECT * FROM participants WHERE competition_id = ?`).all(competition.id) as Array<{
    id: string;
    ticker: string;
    baseline_price: number | null;
  }>;

  const isLocked = isCompetitionLocked(competition);

  for (const participant of participants) {
    const price = await fetchPrice(participant.ticker);
    if (price === null) continue;

    if (isLocked && participant.baseline_price === null) {
      db.run(
        `UPDATE participants SET baseline_price = ?, current_price = ?, percent_change = 0 WHERE id = ?`,
        [price, price, participant.id]
      );
    } else if (participant.baseline_price !== null) {
      const percentChange = ((price - participant.baseline_price) / participant.baseline_price) * 100;
      db.run(
        `UPDATE participants SET current_price = ?, percent_change = ? WHERE id = ?`,
        [price, percentChange, participant.id]
      );
    } else {
      db.run(`UPDATE participants SET current_price = ? WHERE id = ?`, [price, participant.id]);
    }

    db.run(
      `INSERT INTO price_history (id, ticker, price) VALUES (?, ?, ?)`,
      [generateId(), participant.ticker, price]
    );
  }
  
  priceCache.set(competition.id, now);
}

// API: List all competitions (only locked ones are public)
app.get("/api/competitions", (c) => {
  const competitions = db.query(`
    SELECT c.*, 
           COUNT(p.id) as participant_count
    FROM competitions c
    LEFT JOIN participants p ON p.competition_id = c.id
    WHERE c.pick_window_end < datetime('now')
    GROUP BY c.id
    ORDER BY c.created_at DESC
  `).all();
  return c.json(competitions);
});

// API: Create a competition
app.post("/api/competitions", async (c) => {
  const body = await c.req.json();
  const { name, pick_window_start, pick_window_end } = body;

  if (!name || !pick_window_start || !pick_window_end) {
    return c.json({ error: "Missing required fields: name, pick_window_start, pick_window_end" }, 400);
  }

  // Validate dates
  const startDate = new Date(pick_window_start);
  const endDate = new Date(pick_window_end);
  if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
    return c.json({ error: "Invalid date format" }, 400);
  }
  if (endDate <= startDate) {
    return c.json({ error: "End date must be after start date" }, 400);
  }

  const id = generateId();
  const slug = generateSlug();
  db.run(
    `INSERT INTO competitions (id, name, slug, pick_window_start, pick_window_end) VALUES (?, ?, ?, ?, ?)`,
    [id, name, slug, pick_window_start, pick_window_end]
  );

  const competition = db.query(`SELECT * FROM competitions WHERE id = ?`).get(id);
  return c.json(competition, 201);
});

// API: Get competition details with participants
app.get("/api/competitions/:slugOrId", async (c) => {
  const slugOrId = c.req.param("slugOrId");
  const competition = findCompetition(slugOrId);

  if (!competition) {
    return c.json({ error: "Competition not found" }, 404);
  }

  // Auto-refresh prices if cache is stale
  await refreshPricesIfNeeded(competition);

  const participants = db.query(`
    SELECT * FROM participants 
    WHERE competition_id = ? 
    ORDER BY percent_change DESC NULLS LAST, name ASC
  `).all(competition.id);

  const isLocked = isCompetitionLocked(competition);

  return c.json({
    ...competition,
    is_pick_window_open: isPickWindowOpen(competition),
    is_locked: isLocked,
    can_join: !isLocked,
    participants,
  });
});

// API: Join competition
app.post("/api/competitions/:slugOrId/join", async (c) => {
  const slugOrId = c.req.param("slugOrId");
  const body = await c.req.json();
  const { name, ticker } = body;

  if (!name || !ticker) {
    return c.json({ error: "Missing required fields: name, ticker" }, 400);
  }

  const competition = findCompetition(slugOrId);

  if (!competition) {
    return c.json({ error: "Competition not found" }, 404);
  }

  if (isCompetitionLocked(competition)) {
    return c.json({ error: "Competition is locked, pick window has ended" }, 400);
  }

  // Check if name is already taken in this competition
  const existing = db.query(
    `SELECT id FROM participants WHERE competition_id = ? AND LOWER(name) = LOWER(?)`
  ).get(competition.id, name);

  if (existing) {
    return c.json({ error: "Name already taken in this competition" }, 400);
  }

  // Validate ticker with Yahoo Finance
  const isValid = await validateTicker(ticker.toUpperCase());
  if (!isValid) {
    return c.json({ error: "Invalid stock ticker" }, 400);
  }

  // Fetch initial price
  const currentPrice = await fetchPrice(ticker.toUpperCase());

  const id = generateId();
  db.run(
    `INSERT INTO participants (id, competition_id, name, ticker, current_price) VALUES (?, ?, ?, ?, ?)`,
    [id, competition.id, name, ticker.toUpperCase(), currentPrice]
  );

  const participant = db.query(`SELECT * FROM participants WHERE id = ?`).get(id);
  return c.json(participant, 201);
});

// API: Update participant's ticker
app.put("/api/participants/:id", async (c) => {
  const participantId = c.req.param("id");
  const body = await c.req.json();
  const { ticker } = body;

  if (!ticker) {
    return c.json({ error: "Missing required field: ticker" }, 400);
  }

  const participant = db.query(`
    SELECT p.*, c.pick_window_start, c.pick_window_end 
    FROM participants p
    JOIN competitions c ON c.id = p.competition_id
    WHERE p.id = ?
  `).get(participantId) as {
    id: string;
    competition_id: string;
    pick_window_start: string;
    pick_window_end: string;
  } | null;

  if (!participant) {
    return c.json({ error: "Participant not found" }, 404);
  }

  if (!isPickWindowOpen(participant)) {
    return c.json({ error: "Pick window is closed, cannot change ticker" }, 400);
  }

  // Validate ticker
  const isValid = await validateTicker(ticker.toUpperCase());
  if (!isValid) {
    return c.json({ error: "Invalid stock ticker" }, 400);
  }

  // Fetch initial price
  const currentPrice = await fetchPrice(ticker.toUpperCase());

  db.run(
    `UPDATE participants SET ticker = ?, current_price = ?, pick_date = datetime('now') WHERE id = ?`,
    [ticker.toUpperCase(), currentPrice, participantId]
  );

  const updated = db.query(`SELECT * FROM participants WHERE id = ?`).get(participantId);
  return c.json(updated);
});

// API: Get leaderboard for a competition
app.get("/api/competitions/:slugOrId/leaderboard", (c) => {
  const slugOrId = c.req.param("slugOrId");
  const competition = findCompetition(slugOrId);

  if (!competition) {
    return c.json({ error: "Competition not found" }, 404);
  }

  const participants = db.query(`
    SELECT id, name, ticker, baseline_price, current_price, percent_change, pick_date
    FROM participants 
    WHERE competition_id = ? 
    ORDER BY percent_change DESC NULLS LAST, name ASC
  `).all(competition.id) as Array<Record<string, unknown>>;

  return c.json({
    competition,
    leaderboard: participants.map((p, index) => ({
      rank: index + 1,
      ...p,
    })),
  });
});

const PORT = parseInt(process.env.PORT || "3000");

export default {
  port: PORT,
  fetch: app.fetch,
};

console.log(`Stock Picker Madness running on http://localhost:${PORT}`);
