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
		budget: number | null;
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

	// Get all portfolio stocks for this competition's participants
	const portfolioStocks = db
		.query(`
			SELECT ps.id, ps.participant_id, ps.ticker, ps.baseline_price
			FROM portfolio_stocks ps
			JOIN participants p ON p.id = ps.participant_id
			WHERE p.competition_id = ?
		`)
		.all(competition.id) as Array<{
		id: string;
		participant_id: string;
		ticker: string;
		baseline_price: number | null;
	}>;

	// Track which participants need aggregate recalculation
	const participantsToUpdate = new Set<string>();

	for (const stock of portfolioStocks) {
		const price = await fetchPrice(stock.ticker);
		if (price === null) continue;

		if (stock.baseline_price === null) {
			// No baseline yet - set both baseline and current to same price
			db.run(
				`UPDATE portfolio_stocks SET baseline_price = ?, current_price = ?, percent_change = 0 WHERE id = ?`,
				[price, price, stock.id],
			);
		} else {
			// Has baseline - update current price and calculate change
			const percentChange =
				((price - stock.baseline_price) / stock.baseline_price) * 100;
			db.run(
				`UPDATE portfolio_stocks SET current_price = ?, percent_change = ? WHERE id = ?`,
				[price, percentChange, stock.id],
			);
		}

		participantsToUpdate.add(stock.participant_id);

		db.run(`INSERT INTO price_history (id, ticker, price) VALUES (?, ?, ?)`, [
			generateId(),
			stock.ticker,
			price,
		]);
	}

	// Update aggregate percent_change for each participant
	for (const participantId of participantsToUpdate) {
		updateParticipantAggregate(participantId);
	}

	priceCache.set(competition.id, now);
}

// Helper to recalculate a participant's aggregate percent_change from their portfolio
// Uses weighted average based on initial investment value (shares * baseline_price)
function updateParticipantAggregate(participantId: string): void {
	const stocks = db
		.query(`
			SELECT shares, baseline_price, current_price, percent_change
			FROM portfolio_stocks
			WHERE participant_id = ? AND percent_change IS NOT NULL
		`)
		.all(participantId) as Array<{
		shares: number;
		baseline_price: number | null;
		current_price: number | null;
		percent_change: number;
	}>;

	if (stocks.length === 0) {
		db.run(`UPDATE participants SET percent_change = NULL WHERE id = ?`, [
			participantId,
		]);
		return;
	}

	const weightedChange = calculateWeightedPercentChange(
		stocks.map((s) => ({
			shares: s.shares,
			baselinePrice: s.baseline_price,
			currentPrice: s.current_price,
			percentChange: s.percent_change,
		})),
	);

	db.run(`UPDATE participants SET percent_change = ? WHERE id = ?`, [
		weightedChange,
		participantId,
	]);
}

// Calculate weighted percent change based on initial investment value
// Weight = (shares * baseline_price) / total_investment
function calculateWeightedPercentChange(
	stocks: Array<{
		shares: number;
		baselinePrice: number | null;
		currentPrice: number | null;
		percentChange: number;
	}>,
): number {
	// Calculate total initial investment
	const totalInvestment = stocks.reduce((sum, s) => {
		return sum + s.shares * (s.baselinePrice || 0);
	}, 0);

	if (totalInvestment === 0) {
		// Fallback to simple average if no baseline prices
		return stocks.reduce((sum, s) => sum + s.percentChange, 0) / stocks.length;
	}

	// Calculate weighted percent change
	// Each stock's contribution = (initial_value / total_investment) * percent_change
	const weightedSum = stocks.reduce((sum, s) => {
		const initialValue = s.shares * (s.baselinePrice || 0);
		const weight = initialValue / totalInvestment;
		return sum + weight * s.percentChange;
	}, 0);

	return weightedSum;
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
	const { name, pick_window_start, pick_window_end, backfill_mode, budget } =
		body;

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

	// Validate budget if provided
	let validatedBudget: number | null = null;
	if (budget !== undefined && budget !== null && budget !== "") {
		const budgetNum = Number(budget);
		if (Number.isNaN(budgetNum) || budgetNum <= 0) {
			return c.json({ error: "Budget must be a positive number" }, 400);
		}
		validatedBudget = budgetNum;
	}

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
		`INSERT INTO competitions (id, name, slug, pick_window_start, pick_window_end, backfill_mode, finalized, budget) VALUES (?, ?, ?, ?, ?, ?, 0, ?)`,
		[
			id,
			sanitizedName,
			slug,
			pick_window_start,
			pick_window_end,
			isBackfill ? 1 : 0,
			validatedBudget,
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
		.all(competition.id) as Array<Record<string, unknown>>;

	// Get portfolio stocks for each participant
	const participantsWithPortfolio = participants.map((p) => {
		const portfolioStocks = db
			.query(
				`SELECT * FROM portfolio_stocks WHERE participant_id = ? ORDER BY ticker ASC`,
			)
			.all(p.id as string);
		return { ...p, portfolio: portfolioStocks };
	});

	const isLocked = isCompetitionLocked(competition);

	return c.json({
		...competition,
		is_pick_window_open: isPickWindowOpen(competition),
		is_locked: isLocked,
		can_join: !isLocked,
		is_backfill: competition.backfill_mode === 1,
		is_finalized: competition.finalized === 1,
		participants: participantsWithPortfolio,
	});
});

// Type for portfolio stock input (ticker + shares)
interface PortfolioStockInput {
	ticker: string;
	shares: number;
}

// API: Join competition (with stricter rate limit)
app.post("/api/competitions/:slugOrId/join", writeLimiter, async (c) => {
	const slugOrId = c.req.param("slugOrId");
	const body = await c.req.json();
	const { name, ticker, tickers, portfolio } = body;

	// Support multiple input formats:
	// 1. portfolio: [{ ticker: "AAPL", shares: 2.5 }, ...] - new format with shares
	// 2. tickers: ["AAPL", "GOOGL"] - old array format (auto-calculate equal shares)
	// 3. ticker: "AAPL" - old single ticker format (auto-calculate shares)
	let portfolioInput: PortfolioStockInput[] = [];

	if (portfolio && Array.isArray(portfolio)) {
		// New format with explicit shares
		portfolioInput = portfolio;
	} else {
		// Legacy format - will calculate shares after fetching prices
		const tickerList: string[] = tickers || (ticker ? [ticker] : []);
		portfolioInput = tickerList.map((t: string) => ({ ticker: t, shares: 0 })); // 0 = auto-calculate
	}

	const tickerList = portfolioInput.map((p) => p.ticker);

	if (!name || tickerList.length === 0) {
		return c.json({ error: "Missing required fields: name, ticker(s)" }, 400);
	}

	// Validate portfolio size (1-10 stocks)
	if (tickerList.length > 10) {
		return c.json({ error: "Portfolio cannot exceed 10 stocks" }, 400);
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

	// Validate and sanitize all tickers
	const sanitizedTickers: string[] = [];
	for (const t of tickerList) {
		const tickerValidation = validateStringInput(
			t,
			"Ticker",
			MAX_TICKER_LENGTH,
		);
		if (!tickerValidation.valid) {
			return c.json({ error: tickerValidation.error }, 400);
		}
		sanitizedTickers.push(tickerValidation.sanitized.toUpperCase());
	}

	// Check for duplicate tickers in the request
	const uniqueTickers = new Set(sanitizedTickers);
	if (uniqueTickers.size !== sanitizedTickers.length) {
		return c.json({ error: "Portfolio cannot contain duplicate tickers" }, 400);
	}

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

	// Validate all tickers with Yahoo Finance
	for (const t of sanitizedTickers) {
		const isValid = await validateTicker(t);
		if (!isValid) {
			return c.json({ error: `Invalid stock ticker: ${t}` }, 400);
		}
	}

	// Fetch prices for all tickers
	const stockData: Array<{
		ticker: string;
		shares: number;
		baselinePrice: number | null;
		currentPrice: number | null;
		percentChange: number;
	}> = [];

	for (let i = 0; i < sanitizedTickers.length; i++) {
		const t = sanitizedTickers[i]!;
		let baselinePrice: number | null;
		let currentPrice: number | null;

		if (competition.backfill_mode) {
			const startDate = new Date(competition.pick_window_start);
			baselinePrice = await fetchHistoricalPrice(t, startDate);
			if (baselinePrice === null) {
				return c.json(
					{
						error: `Could not fetch historical price for ${t} on ${startDate.toDateString()}`,
					},
					400,
				);
			}
			currentPrice = await fetchPrice(t);
		} else {
			currentPrice = await fetchPrice(t);
			baselinePrice = currentPrice;
		}

		const percentChange =
			baselinePrice && currentPrice
				? ((currentPrice - baselinePrice) / baselinePrice) * 100
				: 0;

		// Get shares from input or calculate later
		const inputShares = portfolioInput[i]?.shares || 0;

		stockData.push({
			ticker: t,
			shares: inputShares,
			baselinePrice,
			currentPrice,
			percentChange,
		});
	}

	// If shares were not provided (legacy format) and competition has a budget, auto-calculate equal distribution
	const needsAutoShares = stockData.some((s) => s.shares === 0);
	if (needsAutoShares && competition.budget) {
		const amountPerStock = competition.budget / stockData.length;
		for (const stock of stockData) {
			if (stock.baselinePrice) {
				stock.shares = amountPerStock / stock.baselinePrice;
			} else {
				stock.shares = 1; // Fallback if no price
			}
		}
	} else if (needsAutoShares) {
		// No budget set - default to 1 share each (equal weighting by percent, not dollars)
		for (const stock of stockData) {
			stock.shares = 1;
		}
	}

	// Validate total investment doesn't exceed budget (with 1% tolerance for rounding)
	// Only validate if competition has a budget set
	if (competition.budget) {
		const totalInvestment = stockData.reduce((sum, s) => {
			return sum + s.shares * (s.baselinePrice || 0);
		}, 0);
		if (totalInvestment > competition.budget * 1.01) {
			return c.json(
				{
					error: `Total investment ($${totalInvestment.toFixed(2)}) exceeds budget ($${competition.budget}). Please reduce shares.`,
				},
				400,
			);
		}
	}

	// Calculate weighted percent change based on initial investment value
	// Weight = (shares * baseline_price) / total_investment
	const weightedPercentChange = calculateWeightedPercentChange(stockData);

	// Create participant (ticker field kept for backwards compat, shows first ticker)
	const participantId = generateId();
	const firstStock = stockData[0]!; // Safe: we validated tickerList.length > 0 above
	db.run(
		`INSERT INTO participants (id, competition_id, name, ticker, baseline_price, current_price, percent_change) VALUES (?, ?, ?, ?, ?, ?, ?)`,
		[
			participantId,
			competition.id,
			sanitizedName,
			firstStock.ticker,
			firstStock.baselinePrice,
			firstStock.currentPrice,
			weightedPercentChange,
		],
	);

	// Create portfolio stocks with shares
	for (const s of stockData) {
		db.run(
			`INSERT INTO portfolio_stocks (id, participant_id, ticker, baseline_price, current_price, percent_change, shares) VALUES (?, ?, ?, ?, ?, ?, ?)`,
			[
				generateId(),
				participantId,
				s.ticker,
				s.baselinePrice,
				s.currentPrice,
				s.percentChange,
				s.shares,
			],
		);
	}

	logAuditEvent(competition.id, "participant_joined", sanitizedName, {
		tickers: sanitizedTickers,
	});

	const participant = db
		.query(`SELECT * FROM participants WHERE id = ?`)
		.get(participantId) as Record<string, unknown>;

	// Get portfolio stocks for the response
	const portfolioStocks = db
		.query(`SELECT * FROM portfolio_stocks WHERE participant_id = ?`)
		.all(participantId);

	return c.json({ ...participant, portfolio: portfolioStocks }, 201);
});

// API: Update participant's portfolio (with stricter rate limit)
app.put("/api/participants/:id", writeLimiter, async (c) => {
	const participantId = c.req.param("id");
	const body = await c.req.json();
	const { ticker, tickers, portfolio } = body;

	// Support multiple input formats:
	// 1. portfolio: [{ ticker: "AAPL", shares: 2.5 }, ...] - new format with shares
	// 2. tickers: ["AAPL", "GOOGL"] - old array format (auto-calculate equal shares)
	// 3. ticker: "AAPL" - old single ticker format (auto-calculate shares)
	let portfolioInput: PortfolioStockInput[] = [];

	if (portfolio && Array.isArray(portfolio)) {
		portfolioInput = portfolio;
	} else {
		const tickerList: string[] = tickers || (ticker ? [ticker] : []);
		portfolioInput = tickerList.map((t: string) => ({ ticker: t, shares: 0 }));
	}

	const tickerList = portfolioInput.map((p) => p.ticker);

	if (tickerList.length === 0) {
		return c.json({ error: "Portfolio must contain at least 1 stock" }, 400);
	}

	if (tickerList.length > 10) {
		return c.json({ error: "Portfolio cannot exceed 10 stocks" }, 400);
	}

	// Validate and sanitize all tickers
	const sanitizedTickers: string[] = [];
	for (const t of tickerList) {
		const tickerValidation = validateStringInput(
			t,
			"Ticker",
			MAX_TICKER_LENGTH,
		);
		if (!tickerValidation.valid) {
			return c.json({ error: tickerValidation.error }, 400);
		}
		sanitizedTickers.push(tickerValidation.sanitized.toUpperCase());
	}

	// Check for duplicate tickers in the request
	const uniqueTickers = new Set(sanitizedTickers);
	if (uniqueTickers.size !== sanitizedTickers.length) {
		return c.json({ error: "Portfolio cannot contain duplicate tickers" }, 400);
	}

	const participant = db
		.query(`
    SELECT p.*, c.pick_window_start, c.pick_window_end, c.id as comp_id, c.backfill_mode, c.finalized, c.budget
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
		budget: number | null;
	} | null;

	if (!participant) {
		return c.json({ error: "Participant not found" }, 404);
	}

	if (isCompetitionLocked(participant)) {
		return c.json(
			{ error: "Competition is locked, cannot change portfolio" },
			400,
		);
	}

	// Get current portfolio stocks with shares
	const currentStocks = db
		.query(
			`SELECT id, ticker, shares, baseline_price FROM portfolio_stocks WHERE participant_id = ?`,
		)
		.all(participantId) as Array<{
		id: string;
		ticker: string;
		shares: number;
		baseline_price: number | null;
	}>;
	const currentStockMap = new Map(currentStocks.map((s) => [s.ticker, s]));

	// Build updated portfolio input map
	const updatedPortfolioMap = new Map<string, number>();
	for (let i = 0; i < sanitizedTickers.length; i++) {
		const ticker = sanitizedTickers[i]!;
		const shares = portfolioInput[i]?.shares || 0;
		updatedPortfolioMap.set(ticker, shares);
	}

	// Calculate adds, updates, and removes
	const currentTickers = new Set(currentStocks.map((s) => s.ticker));
	const newTickers = new Set(sanitizedTickers);
	const tickersToAdd = sanitizedTickers.filter((t) => !currentTickers.has(t));
	const tickersToUpdate = sanitizedTickers.filter((t) => currentTickers.has(t));
	const tickersToRemove = [...currentTickers].filter((t) => !newTickers.has(t));

	// Validate new tickers with Yahoo Finance
	for (const t of tickersToAdd) {
		const isValid = await validateTicker(t);
		if (!isValid) {
			return c.json({ error: `Invalid stock ticker: ${t}` }, 400);
		}
	}

	// Fetch prices for new tickers (baseline from competition start)
	const startDate = new Date(participant.pick_window_start);

	// Collect all stock data for validation and weighted calculation
	const allStockData: Array<{
		ticker: string;
		shares: number;
		baselinePrice: number | null;
	}> = [];

	// Add existing stocks that are being kept (with potentially updated shares)
	for (const t of tickersToUpdate) {
		const existing = currentStockMap.get(t)!;
		const newShares = updatedPortfolioMap.get(t) || existing.shares;
		allStockData.push({
			ticker: t,
			shares: newShares,
			baselinePrice: existing.baseline_price,
		});
	}

	// Add new stocks
	for (const t of tickersToAdd) {
		let baselinePrice: number | null;
		let currentPrice: number | null;

		if (participant.backfill_mode) {
			baselinePrice = await fetchHistoricalPrice(t, startDate);
			if (baselinePrice === null) {
				return c.json(
					{
						error: `Could not fetch historical price for ${t} on ${startDate.toDateString()}`,
					},
					400,
				);
			}
			currentPrice = await fetchPrice(t);
		} else {
			baselinePrice = await fetchHistoricalPrice(t, startDate);
			if (baselinePrice === null) {
				baselinePrice = await fetchPrice(t);
			}
			currentPrice = await fetchPrice(t);
		}

		const percentChange =
			baselinePrice && currentPrice
				? ((currentPrice - baselinePrice) / baselinePrice) * 100
				: 0;

		const shares = updatedPortfolioMap.get(t) || 0;
		allStockData.push({ ticker: t, shares, baselinePrice });

		db.run(
			`INSERT INTO portfolio_stocks (id, participant_id, ticker, baseline_price, current_price, percent_change, shares) VALUES (?, ?, ?, ?, ?, ?, ?)`,
			[
				generateId(),
				participantId,
				t,
				baselinePrice,
				currentPrice,
				percentChange,
				shares,
			],
		);
	}

	// If shares were not provided (legacy format) and competition has a budget, auto-calculate equal distribution
	const needsAutoShares = allStockData.some((s) => s.shares === 0);
	if (needsAutoShares && participant.budget) {
		const amountPerStock = participant.budget / allStockData.length;
		for (const stock of allStockData) {
			if (stock.baselinePrice) {
				stock.shares = amountPerStock / stock.baselinePrice;
			} else {
				stock.shares = 1;
			}
		}
	} else if (needsAutoShares) {
		// No budget set - default to 1 share each
		for (const stock of allStockData) {
			stock.shares = 1;
		}
	}

	// Validate total investment doesn't exceed budget (only if competition has budget)
	if (participant.budget) {
		const totalInvestment = allStockData.reduce((sum, s) => {
			return sum + s.shares * (s.baselinePrice || 0);
		}, 0);
		if (totalInvestment > participant.budget * 1.01) {
			// Rollback the new inserts by removing them
			for (const t of tickersToAdd) {
				db.run(
					`DELETE FROM portfolio_stocks WHERE participant_id = ? AND ticker = ?`,
					[participantId, t],
				);
			}
			return c.json(
				{
					error: `Total investment ($${totalInvestment.toFixed(2)}) exceeds budget ($${participant.budget}). Please reduce shares.`,
				},
				400,
			);
		}
	}

	// Update shares for existing stocks
	for (const t of tickersToUpdate) {
		const stockData = allStockData.find((s) => s.ticker === t)!;
		db.run(
			`UPDATE portfolio_stocks SET shares = ? WHERE participant_id = ? AND ticker = ?`,
			[stockData.shares, participantId, t],
		);
	}

	// If we auto-calculated shares, also update the new stocks
	if (needsAutoShares) {
		for (const t of tickersToAdd) {
			const stockData = allStockData.find((s) => s.ticker === t)!;
			db.run(
				`UPDATE portfolio_stocks SET shares = ? WHERE participant_id = ? AND ticker = ?`,
				[stockData.shares, participantId, t],
			);
		}
	}

	// Remove stocks
	for (const t of tickersToRemove) {
		db.run(
			`DELETE FROM portfolio_stocks WHERE participant_id = ? AND ticker = ?`,
			[participantId, t],
		);
	}

	// Recalculate aggregate percent change
	updateParticipantAggregate(participantId);

	// Update the participant's ticker field (first ticker for backwards compat)
	const firstTicker = sanitizedTickers[0]!; // Safe: we validated tickerList.length > 0 above
	db.run(
		`UPDATE participants SET ticker = ?, pick_date = datetime('now') WHERE id = ?`,
		[firstTicker, participantId],
	);

	// Log audit event if there were changes
	if (tickersToAdd.length > 0 || tickersToRemove.length > 0) {
		logAuditEvent(
			participant.competition_id,
			"portfolio_updated",
			participant.name,
			{
				added: tickersToAdd,
				removed: tickersToRemove,
			},
		);
	}

	const updated = db
		.query(`SELECT * FROM participants WHERE id = ?`)
		.get(participantId) as Record<string, unknown>;

	// Get updated portfolio stocks for the response
	const portfolioStocks = db
		.query(`SELECT * FROM portfolio_stocks WHERE participant_id = ?`)
		.all(participantId);

	return c.json({ ...updated, portfolio: portfolioStocks });
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
