// ABOUTME: Main Hono server for stock-picker-madness
// ABOUTME: Handles API routes, serves static files, and manages competition logic

import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import { db, generateId } from "./src/db";
import { fetchPrice, validateTicker } from "./src/yahoo";

const app = new Hono();

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

// API: List all competitions
app.get("/api/competitions", (c) => {
  const competitions = db.query(`
    SELECT c.*, 
           COUNT(p.id) as participant_count
    FROM competitions c
    LEFT JOIN participants p ON p.competition_id = c.id
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
  db.run(
    `INSERT INTO competitions (id, name, pick_window_start, pick_window_end) VALUES (?, ?, ?, ?)`,
    [id, name, pick_window_start, pick_window_end]
  );

  const competition = db.query(`SELECT * FROM competitions WHERE id = ?`).get(id);
  return c.json(competition, 201);
});

// API: Get competition details with participants
app.get("/api/competitions/:id", (c) => {
  const id = c.req.param("id");
  const competition = db.query(`SELECT * FROM competitions WHERE id = ?`).get(id) as {
    id: string;
    name: string;
    pick_window_start: string;
    pick_window_end: string;
    created_at: string;
  } | null;

  if (!competition) {
    return c.json({ error: "Competition not found" }, 404);
  }

  const participants = db.query(`
    SELECT * FROM participants 
    WHERE competition_id = ? 
    ORDER BY percent_change DESC NULLS LAST, name ASC
  `).all(id);

  return c.json({
    ...competition,
    is_pick_window_open: isPickWindowOpen(competition),
    is_locked: isCompetitionLocked(competition),
    participants,
  });
});

// API: Join competition
app.post("/api/competitions/:id/join", async (c) => {
  const competitionId = c.req.param("id");
  const body = await c.req.json();
  const { name, ticker } = body;

  if (!name || !ticker) {
    return c.json({ error: "Missing required fields: name, ticker" }, 400);
  }

  const competition = db.query(`SELECT * FROM competitions WHERE id = ?`).get(competitionId) as {
    id: string;
    pick_window_start: string;
    pick_window_end: string;
  } | null;

  if (!competition) {
    return c.json({ error: "Competition not found" }, 404);
  }

  if (!isPickWindowOpen(competition)) {
    return c.json({ error: "Pick window is not open" }, 400);
  }

  // Check if name is already taken in this competition
  const existing = db.query(
    `SELECT id FROM participants WHERE competition_id = ? AND LOWER(name) = LOWER(?)`
  ).get(competitionId, name);

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
    [id, competitionId, name, ticker.toUpperCase(), currentPrice]
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
app.get("/api/competitions/:id/leaderboard", (c) => {
  const id = c.req.param("id");
  const competition = db.query(`SELECT * FROM competitions WHERE id = ?`).get(id);

  if (!competition) {
    return c.json({ error: "Competition not found" }, 404);
  }

  const participants = db.query(`
    SELECT id, name, ticker, baseline_price, current_price, percent_change, pick_date
    FROM participants 
    WHERE competition_id = ? 
    ORDER BY percent_change DESC NULLS LAST, name ASC
  `).all(id) as Array<Record<string, unknown>>;

  return c.json({
    competition,
    leaderboard: participants.map((p, index) => ({
      rank: index + 1,
      ...p,
    })),
  });
});

// API: Manually trigger price update for a competition
app.post("/api/competitions/:id/refresh-prices", async (c) => {
  const id = c.req.param("id");
  const competition = db.query(`SELECT * FROM competitions WHERE id = ?`).get(id) as {
    id: string;
    pick_window_end: string;
  } | null;

  if (!competition) {
    return c.json({ error: "Competition not found" }, 404);
  }

  const participants = db.query(`SELECT * FROM participants WHERE competition_id = ?`).all(id) as Array<{
    id: string;
    ticker: string;
    baseline_price: number | null;
  }>;

  const isLocked = isCompetitionLocked(competition);

  for (const participant of participants) {
    const price = await fetchPrice(participant.ticker);
    if (price === null) continue;

    // If competition just locked and no baseline, set baseline
    if (isLocked && participant.baseline_price === null) {
      db.run(
        `UPDATE participants SET baseline_price = ?, current_price = ?, percent_change = 0 WHERE id = ?`,
        [price, price, participant.id]
      );
    } else if (participant.baseline_price !== null) {
      // Update current price and calculate percent change
      const percentChange = ((price - participant.baseline_price) / participant.baseline_price) * 100;
      db.run(
        `UPDATE participants SET current_price = ?, percent_change = ? WHERE id = ?`,
        [price, percentChange, participant.id]
      );
    } else {
      // Just update current price (window still open)
      db.run(`UPDATE participants SET current_price = ? WHERE id = ?`, [price, participant.id]);
    }

    // Record in price history
    db.run(
      `INSERT INTO price_history (id, ticker, price) VALUES (?, ?, ?)`,
      [generateId(), participant.ticker, price]
    );
  }

  return c.json({ success: true, updated: participants.length });
});

const PORT = parseInt(process.env.PORT || "3000");

export default {
  port: PORT,
  fetch: app.fetch,
};

console.log(`Stock Picker Madness running on http://localhost:${PORT}`);
