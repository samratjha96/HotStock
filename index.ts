// ABOUTME: Main Hono server for stock-picker-madness
// ABOUTME: Handles API routes, serves static files, and manages competition logic

import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import { rateLimiter } from "hono-rate-limiter";
import {
	db,
	generateId,
	generateSlug,
	logAuditEvent,
	getAuditLog,
	getAuditLogCount,
} from "./src/db";
import { fetchHistoricalPrice, fetchPrice, validateTicker } from "./src/yahoo";

const app = new Hono();

// Input validation constants
const MAX_COMPETITION_NAME_LENGTH = 100;
const MAX_PARTICIPANT_NAME_LENGTH = 50;
const MAX_TICKER_LENGTH = 10;

// Validate string input: checks max length and strips HTML/script tags
function validateStringInput(
	value: unknown,
	fieldName: string,
	maxLength: number,
): { valid: true; sanitized: string } | { valid: false; error: string } {
	if (typeof value !== "string") {
		return { valid: false, error: `${fieldName} must be a string` };
	}

	const trimmed = value.trim();

	if (trimmed.length === 0) {
		return { valid: false, error: `${fieldName} cannot be empty` };
	}

	if (trimmed.length > maxLength) {
		return {
			valid: false,
			error: `${fieldName} must be ${maxLength} characters or less`,
		};
	}

	// Basic sanitization: remove HTML tags to prevent XSS
	const sanitized = trimmed.replace(/<[^>]*>/g, "");

	return { valid: true, sanitized };
}

// Helper to get client IP for rate limiting
function getClientIP(c: {
	req: { header: (name: string) => string | undefined };
}): string {
	return (
		c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ||
		c.req.header("x-real-ip") ||
		"unknown"
	);
}

// Global rate limiter: 100 requests per minute per IP
const globalLimiter = rateLimiter({
	windowMs: 60 * 1000,
	limit: 100,
	keyGenerator: getClientIP,
	message: { error: "Too many requests, please try again later" },
});

// Stricter rate limiter for write endpoints: 10 requests per minute per IP
const writeLimiter = rateLimiter({
	windowMs: 60 * 1000,
	limit: 10,
	keyGenerator: getClientIP,
	message: { error: "Too many write requests, please slow down" },
});

// Apply global rate limiter to all API routes
app.use("/api/*", globalLimiter);

// Price cache: stores last refresh time per competition
const priceCache = new Map<string, number>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

// Serve static files from public directory
app.use("/public/*", serveStatic({ root: "./" }));

// Serve index.html at root
app.get("/", serveStatic({ path: "./public/index.html" }));

// Helper to check if a competition's pick window is still open
function isPickWindowOpen(competition: {
	pick_window_start: string;
	pick_window_end: string;
}): boolean {
	const now = new Date();
	const start = new Date(competition.pick_window_start);
	const end = new Date(competition.pick_window_end);
	return now >= start && now <= end;
}

// Helper to check if competition is locked (past pick window)
function isCompetitionLocked(competition: {
	pick_window_end: string;
	backfill_mode?: number;
	finalized?: number;
}): boolean {
	// Backfill competitions are only locked when finalized
	if (competition.backfill_mode) {
		return competition.finalized === 1;
	}
	// Regular competitions lock when pick window ends
	const now = new Date();
	const end = new Date(competition.pick_window_end);
	return now > end;
}

// Helper to find competition by slug or ID
function findCompetition(slugOrId: string) {
	// First try by slug (more common for shared URLs)
	let competition = db
		.query(`SELECT * FROM competitions WHERE slug = ?`)
		.get(slugOrId);
	if (!competition) {
		// Fall back to ID lookup for backwards compatibility
		competition = db
			.query(`SELECT * FROM competitions WHERE id = ?`)
			.get(slugOrId);
	}
	return competition as {
		id: string;
		name: string;
		slug: string;
		pick_window_start: string;
		pick_window_end: string;
		created_at: string;
		backfill_mode: number;
		finalized: number;
	} | null;
}

// Helper to refresh prices for a competition (with caching)
async function refreshPricesIfNeeded(competition: {
	id: string;
	pick_window_end: string;
}) {
	const lastRefresh = priceCache.get(competition.id) || 0;
	const now = Date.now();

	if (now - lastRefresh < CACHE_TTL_MS) {
		return; // Cache still valid
	}

	const participants = db
		.query(`SELECT * FROM participants WHERE competition_id = ?`)
		.all(competition.id) as Array<{
		id: string;
		ticker: string;
		baseline_price: number | null;
	}>;

	for (const participant of participants) {
		const price = await fetchPrice(participant.ticker);
		if (price === null) continue;

		if (participant.baseline_price === null) {
			// No baseline yet - set both baseline and current to same price
			db.run(
				`UPDATE participants SET baseline_price = ?, current_price = ?, percent_change = 0 WHERE id = ?`,
				[price, price, participant.id],
			);
		} else {
			// Has baseline - update current price and calculate change
			const percentChange =
				((price - participant.baseline_price) / participant.baseline_price) *
				100;
			db.run(
				`UPDATE participants SET current_price = ?, percent_change = ? WHERE id = ?`,
				[price, percentChange, participant.id],
			);
		}

		db.run(`INSERT INTO price_history (id, ticker, price) VALUES (?, ?, ?)`, [
			generateId(),
			participant.ticker,
			price,
		]);
	}

	priceCache.set(competition.id, now);
}

// API: List all competitions (locked or finalized backfill competitions are public)
app.get("/api/competitions", (c) => {
	const competitions = db
		.query(`
    SELECT c.*, 
           COUNT(p.id) as participant_count
    FROM competitions c
    LEFT JOIN participants p ON p.competition_id = c.id
    WHERE c.pick_window_end < datetime('now') OR (c.backfill_mode = 1 AND c.finalized = 1)
    GROUP BY c.id
    ORDER BY c.created_at DESC
  `)
		.all();
	return c.json(competitions);
});

// API: Create a competition (with stricter rate limit)
app.post("/api/competitions", writeLimiter, async (c) => {
	const body = await c.req.json();
	const { name, pick_window_start, pick_window_end, backfill_mode } = body;

	if (!name || !pick_window_start || !pick_window_end) {
		return c.json(
			{
				error:
					"Missing required fields: name, pick_window_start, pick_window_end",
			},
			400,
		);
	}

	// Validate competition name
	const nameValidation = validateStringInput(
		name,
		"Competition name",
		MAX_COMPETITION_NAME_LENGTH,
	);
	if (!nameValidation.valid) {
		return c.json({ error: nameValidation.error }, 400);
	}
	const sanitizedName = nameValidation.sanitized;

	// Validate dates
	const startDate = new Date(pick_window_start);
	const endDate = new Date(pick_window_end);
	if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
		return c.json({ error: "Invalid date format" }, 400);
	}
	if (endDate <= startDate) {
		return c.json({ error: "End date must be after start date" }, 400);
	}

	// Backfill mode allows past start dates, regular mode does not
	const isBackfill = backfill_mode === true;
	if (!isBackfill) {
		const now = new Date();
		if (startDate < now) {
			return c.json(
				{
					error:
						"Start date must be in the future. Use backfill mode for past competitions.",
				},
				400,
			);
		}
	}

	const id = generateId();
	const slug = generateSlug();
	db.run(
		`INSERT INTO competitions (id, name, slug, pick_window_start, pick_window_end, backfill_mode, finalized) VALUES (?, ?, ?, ?, ?, ?, 0)`,
		[
			id,
			sanitizedName,
			slug,
			pick_window_start,
			pick_window_end,
			isBackfill ? 1 : 0,
		],
	);

	const competition = db
		.query(`SELECT * FROM competitions WHERE id = ?`)
		.get(id);
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

	const participants = db
		.query(`
    SELECT * FROM participants 
    WHERE competition_id = ? 
    ORDER BY percent_change DESC NULLS LAST, name ASC
  `)
		.all(competition.id);

	const isLocked = isCompetitionLocked(competition);

	return c.json({
		...competition,
		is_pick_window_open: isPickWindowOpen(competition),
		is_locked: isLocked,
		can_join: !isLocked,
		is_backfill: competition.backfill_mode === 1,
		is_finalized: competition.finalized === 1,
		participants,
	});
});

// API: Join competition (with stricter rate limit)
app.post("/api/competitions/:slugOrId/join", writeLimiter, async (c) => {
	const slugOrId = c.req.param("slugOrId");
	const body = await c.req.json();
	const { name, ticker } = body;

	if (!name || !ticker) {
		return c.json({ error: "Missing required fields: name, ticker" }, 400);
	}

	// Validate participant name
	const nameValidation = validateStringInput(
		name,
		"Participant name",
		MAX_PARTICIPANT_NAME_LENGTH,
	);
	if (!nameValidation.valid) {
		return c.json({ error: nameValidation.error }, 400);
	}
	const sanitizedName = nameValidation.sanitized;

	// Validate ticker format (before Yahoo API call)
	const tickerValidation = validateStringInput(
		ticker,
		"Ticker",
		MAX_TICKER_LENGTH,
	);
	if (!tickerValidation.valid) {
		return c.json({ error: tickerValidation.error }, 400);
	}
	const sanitizedTicker = tickerValidation.sanitized.toUpperCase();

	const competition = findCompetition(slugOrId);

	if (!competition) {
		return c.json({ error: "Competition not found" }, 404);
	}

	if (isCompetitionLocked(competition)) {
		return c.json(
			{ error: "Competition is locked, pick window has ended" },
			400,
		);
	}

	// Check if name is already taken in this competition
	const existing = db
		.query(
			`SELECT id FROM participants WHERE competition_id = ? AND LOWER(name) = LOWER(?)`,
		)
		.get(competition.id, sanitizedName);

	if (existing) {
		return c.json({ error: "Name already taken in this competition" }, 400);
	}

	// Validate ticker with Yahoo Finance
	const isValid = await validateTicker(sanitizedTicker);
	if (!isValid) {
		return c.json({ error: "Invalid stock ticker" }, 400);
	}

	// For backfill competitions, fetch historical price from start date
	// For regular competitions, fetch current price
	let baselinePrice: number | null;
	let currentPrice: number | null;

	if (competition.backfill_mode) {
		const startDate = new Date(competition.pick_window_start);
		baselinePrice = await fetchHistoricalPrice(sanitizedTicker, startDate);
		if (baselinePrice === null) {
			return c.json(
				{
					error: `Could not fetch historical price for ${sanitizedTicker} on ${startDate.toDateString()}`,
				},
				400,
			);
		}
		currentPrice = await fetchPrice(sanitizedTicker);
	} else {
		currentPrice = await fetchPrice(sanitizedTicker);
		baselinePrice = currentPrice;
	}

	// Calculate percent change
	const percentChange =
		baselinePrice && currentPrice
			? ((currentPrice - baselinePrice) / baselinePrice) * 100
			: 0;

	const id = generateId();
	db.run(
		`INSERT INTO participants (id, competition_id, name, ticker, baseline_price, current_price, percent_change) VALUES (?, ?, ?, ?, ?, ?, ?)`,
		[
			id,
			competition.id,
			sanitizedName,
			sanitizedTicker,
			baselinePrice,
			currentPrice,
			percentChange,
		],
	);

	logAuditEvent(competition.id, "participant_joined", sanitizedName, {
		ticker: sanitizedTicker,
	});

	const participant = db
		.query(`SELECT * FROM participants WHERE id = ?`)
		.get(id);
	return c.json(participant, 201);
});

// API: Update participant's ticker (with stricter rate limit)
app.put("/api/participants/:id", writeLimiter, async (c) => {
	const participantId = c.req.param("id");
	const body = await c.req.json();
	const { ticker } = body;

	if (!ticker) {
		return c.json({ error: "Missing required field: ticker" }, 400);
	}

	// Validate ticker format (before Yahoo API call)
	const tickerValidation = validateStringInput(
		ticker,
		"Ticker",
		MAX_TICKER_LENGTH,
	);
	if (!tickerValidation.valid) {
		return c.json({ error: tickerValidation.error }, 400);
	}
	const sanitizedTicker = tickerValidation.sanitized.toUpperCase();

	const participant = db
		.query(`
    SELECT p.*, c.pick_window_start, c.pick_window_end, c.id as comp_id, c.backfill_mode, c.finalized
    FROM participants p
    JOIN competitions c ON c.id = p.competition_id
    WHERE p.id = ?
  `)
		.get(participantId) as {
		id: string;
		name: string;
		ticker: string;
		competition_id: string;
		comp_id: string;
		pick_window_start: string;
		pick_window_end: string;
		backfill_mode: number;
		finalized: number;
	} | null;

	if (!participant) {
		return c.json({ error: "Participant not found" }, 404);
	}

	if (isCompetitionLocked(participant)) {
		return c.json(
			{ error: "Competition is locked, cannot change ticker" },
			400,
		);
	}

	// Validate ticker with Yahoo Finance
	const isValid = await validateTicker(sanitizedTicker);
	if (!isValid) {
		return c.json({ error: "Invalid stock ticker" }, 400);
	}

	const oldTicker = participant.ticker;

	// Fetch initial price
	const currentPrice = await fetchPrice(sanitizedTicker);

	db.run(
		`UPDATE participants SET ticker = ?, baseline_price = ?, current_price = ?, percent_change = 0, pick_date = datetime('now') WHERE id = ?`,
		[sanitizedTicker, currentPrice, currentPrice, participantId],
	);

	logAuditEvent(participant.competition_id, "pick_changed", participant.name, {
		old_ticker: oldTicker,
		new_ticker: sanitizedTicker,
	});

	const updated = db
		.query(`SELECT * FROM participants WHERE id = ?`)
		.get(participantId);
	return c.json(updated);
});

// API: Get leaderboard for a competition
app.get("/api/competitions/:slugOrId/leaderboard", (c) => {
	const slugOrId = c.req.param("slugOrId");
	const competition = findCompetition(slugOrId);

	if (!competition) {
		return c.json({ error: "Competition not found" }, 404);
	}

	const participants = db
		.query(`
    SELECT id, name, ticker, baseline_price, current_price, percent_change, pick_date
    FROM participants 
    WHERE competition_id = ? 
    ORDER BY percent_change DESC NULLS LAST, name ASC
  `)
		.all(competition.id) as Array<Record<string, unknown>>;

	return c.json({
		competition,
		leaderboard: participants.map((p, index) => ({
			rank: index + 1,
			...p,
		})),
	});
});

// API: Finalize a backfill competition (with stricter rate limit)
app.post("/api/competitions/:slugOrId/finalize", writeLimiter, async (c) => {
	const slugOrId = c.req.param("slugOrId");
	const competition = findCompetition(slugOrId);

	if (!competition) {
		return c.json({ error: "Competition not found" }, 404);
	}

	if (!competition.backfill_mode) {
		return c.json(
			{ error: "Only backfill competitions can be finalized" },
			400,
		);
	}

	if (competition.finalized) {
		return c.json({ error: "Competition is already finalized" }, 400);
	}

	// Check that there's at least one participant
	const participantCount = db
		.query(
			`SELECT COUNT(*) as count FROM participants WHERE competition_id = ?`,
		)
		.get(competition.id) as { count: number };

	if (participantCount.count === 0) {
		return c.json(
			{ error: "Cannot finalize competition with no participants" },
			400,
		);
	}

	db.run(`UPDATE competitions SET finalized = 1 WHERE id = ?`, [
		competition.id,
	]);

	logAuditEvent(competition.id, "lock", null, null);

	const updated = db
		.query(`SELECT * FROM competitions WHERE id = ?`)
		.get(competition.id);
	return c.json(updated);
});

// API: Unfinalize a backfill competition (to allow more edits)
app.post("/api/competitions/:slugOrId/unfinalize", writeLimiter, async (c) => {
	const slugOrId = c.req.param("slugOrId");
	const competition = findCompetition(slugOrId);

	if (!competition) {
		return c.json({ error: "Competition not found" }, 404);
	}

	if (!competition.backfill_mode) {
		return c.json(
			{ error: "Only backfill competitions can be unfinalized" },
			400,
		);
	}

	if (!competition.finalized) {
		return c.json({ error: "Competition is not finalized" }, 400);
	}

	db.run(`UPDATE competitions SET finalized = 0 WHERE id = ?`, [
		competition.id,
	]);

	logAuditEvent(competition.id, "unlock", null, null);

	const updated = db
		.query(`SELECT * FROM competitions WHERE id = ?`)
		.get(competition.id);
	return c.json(updated);
});

// API: Get audit log for a competition (with pagination)
app.get("/api/competitions/:slugOrId/audit-log", (c) => {
	const slugOrId = c.req.param("slugOrId");
	const competition = findCompetition(slugOrId);

	if (!competition) {
		return c.json({ error: "Competition not found" }, 404);
	}

	const limit = Math.min(parseInt(c.req.query("limit") || "20", 10), 100);
	const offset = parseInt(c.req.query("offset") || "0", 10);

	const entries = getAuditLog(competition.id, limit, offset);
	const total = getAuditLogCount(competition.id);

	return c.json({
		entries,
		total,
		limit,
		offset,
		has_more: offset + entries.length < total,
	});
});

const PORT = parseInt(process.env.PORT || "3000", 10);

export default {
	port: PORT,
	fetch: app.fetch,
};

console.log(`Stock Picker Madness running on http://localhost:${PORT}`);
