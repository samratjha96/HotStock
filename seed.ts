// ABOUTME: Seeds the database with a Demo competition for first-time users
// ABOUTME: Idempotent - only seeds if Demo competition doesn't exist

// Import db to ensure schema is created before seeding
import { db, generateSlug } from "./src/db";

// Check if Demo competition already exists
const existingDemo = db
	.query("SELECT id FROM competitions WHERE name = 'Demo'")
	.get();
if (existingDemo) {
	console.log("Demo competition already exists, skipping seed.");
	db.close();
	process.exit(0);
}

console.log("Creating Demo competition...");

// Demo competition with a closed pick window to show leaderboard functionality
const competitionId = crypto.randomUUID();
const competitionSlug = generateSlug();
const competition = {
	id: competitionId,
	name: "Demo",
	slug: competitionSlug,
	pick_window_start: "2025-06-30T00:00:00Z",
	pick_window_end: "2025-07-01T23:59:59Z",
	created_at: "2025-06-29T12:00:00Z",
};

console.log("  Slug:", competition.slug);
db.run(
	`INSERT INTO competitions (id, name, slug, pick_window_start, pick_window_end, created_at, backfill_mode, finalized) 
   VALUES (?, ?, ?, ?, ?, ?, 0, 0)`,
	[
		competition.id,
		competition.name,
		competition.slug,
		competition.pick_window_start,
		competition.pick_window_end,
		competition.created_at,
	],
);

// Participants with realistic stock picks
// Baseline prices are approximate close prices from June 30-July 1, 2025
// Current prices need to be fetched or estimated for Jan 7, 2026
// Using approximate historical data

interface StockData {
	ticker: string;
	baselinePrice: number;
	currentPrice: number;
	shares: number;
}

interface ParticipantData {
	name: string;
	portfolio: StockData[];
}

// These are simulated prices - in reality you'd fetch current prices from Yahoo
// Budget is $1000 per participant, shares are calculated to stay within budget
const participants: ParticipantData[] = [
	// Single-stock portfolios (traditional picks) - all $1000 into one stock
	{
		name: "Alice",
		portfolio: [
			{
				ticker: "NVDA",
				baselinePrice: 123.54,
				currentPrice: 148.9,
				shares: 8.1,
			},
		],
	}, // ~$1000 invested, +20.5% - AI boom continues
	{
		name: "Bob",
		portfolio: [
			{
				ticker: "AAPL",
				baselinePrice: 218.24,
				currentPrice: 243.15,
				shares: 4.58,
			},
		],
	}, // ~$1000 invested, +11.4% - steady growth
	{
		name: "Charlie",
		portfolio: [
			{
				ticker: "GOOGL",
				baselinePrice: 184.76,
				currentPrice: 197.3,
				shares: 5.41,
			},
		],
	}, // ~$1000 invested, +6.8%
	{
		name: "Diana",
		portfolio: [
			{
				ticker: "MSFT",
				baselinePrice: 447.45,
				currentPrice: 431.2,
				shares: 2.23,
			},
		],
	}, // ~$1000 invested, -3.6% - slight dip

	// Multi-stock portfolios with weighted allocations
	{
		name: "Eve",
		portfolio: [
			{
				ticker: "META",
				baselinePrice: 504.22,
				currentPrice: 612.77,
				shares: 1,
			}, // $504
			{
				ticker: "NVDA",
				baselinePrice: 123.54,
				currentPrice: 148.9,
				shares: 2.5,
			}, // $309
			{
				ticker: "GOOGL",
				baselinePrice: 184.76,
				currentPrice: 197.3,
				shares: 1,
			}, // $185
		],
	}, // Total ~$998, weighted gain

	{
		name: "Frank",
		portfolio: [
			{
				ticker: "TSLA",
				baselinePrice: 248.48,
				currentPrice: 410.44,
				shares: 3.2,
			}, // $795 - heavy on TSLA
			{
				ticker: "RIVN",
				baselinePrice: 13.88,
				currentPrice: 14.12,
				shares: 14.5,
			}, // $201
		],
	}, // Total ~$996, EV focused with heavy TSLA weight

	{
		name: "Grace",
		portfolio: [
			{
				ticker: "AMZN",
				baselinePrice: 197.12,
				currentPrice: 224.92,
				shares: 1.7,
			}, // $335
			{ ticker: "WMT", baselinePrice: 68.05, currentPrice: 91.94, shares: 5 }, // $340
			{
				ticker: "COST",
				baselinePrice: 846.71,
				currentPrice: 924.44,
				shares: 0.38,
			}, // $322
		],
	}, // Total ~$997, Retail portfolio

	{
		name: "Henry",
		portfolio: [
			{
				ticker: "COIN",
				baselinePrice: 237.81,
				currentPrice: 268.94,
				shares: 2.5,
			}, // $594 - heavy on COIN
			{
				ticker: "GME",
				baselinePrice: 23.14,
				currentPrice: 31.15,
				shares: 17.5,
			}, // $405
		],
	}, // Total ~$999, High risk with crypto exposure

	{
		name: "Ivy",
		portfolio: [
			{
				ticker: "JNJ",
				baselinePrice: 146.71,
				currentPrice: 144.07,
				shares: 3.4,
			}, // $499
			{
				ticker: "XOM",
				baselinePrice: 114.71,
				currentPrice: 106.83,
				shares: 4.3,
			}, // $493
		],
	}, // Total ~$992, Defensive picks that didn't work

	{
		name: "Jack",
		portfolio: [
			{ ticker: "AMC", baselinePrice: 4.89, currentPrice: 3.23, shares: 204.5 },
		],
	}, // ~$1000 invested, -33.9% - big loser, all eggs in one basket
];

console.log(`Adding ${participants.length} participants...`);

// Calculate weighted percent change based on initial investment value
function calculateWeightedPercentChange(portfolio: StockData[]): number {
	const totalInvestment = portfolio.reduce(
		(sum, s) => sum + s.shares * s.baselinePrice,
		0,
	);

	if (totalInvestment === 0) return 0;

	const weightedSum = portfolio.reduce((sum, s) => {
		const initialValue = s.shares * s.baselinePrice;
		const weight = initialValue / totalInvestment;
		const percentChange =
			((s.currentPrice - s.baselinePrice) / s.baselinePrice) * 100;
		return sum + weight * percentChange;
	}, 0);

	return weightedSum;
}

for (const p of participants) {
	const participantId = crypto.randomUUID();

	// Calculate weighted percent change
	const weightedPercentChange = calculateWeightedPercentChange(p.portfolio);

	// Pick date is during the window (June 30 - July 1, 2025)
	const pickDate = new Date("2025-06-30T14:00:00Z");
	pickDate.setHours(pickDate.getHours() + Math.floor(Math.random() * 30));

	// Insert participant (first ticker for backwards compat)
	const firstStock = p.portfolio[0]!; // Safe: portfolio always has at least one stock
	db.run(
		`INSERT INTO participants (id, competition_id, name, ticker, baseline_price, current_price, percent_change, pick_date, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		[
			participantId,
			competitionId,
			p.name,
			firstStock.ticker,
			firstStock.baselinePrice,
			firstStock.currentPrice,
			weightedPercentChange,
			pickDate.toISOString(),
			pickDate.toISOString(),
		],
	);

	// Insert portfolio stocks with shares
	for (const stock of p.portfolio) {
		const stockPercentChange =
			((stock.currentPrice - stock.baselinePrice) / stock.baselinePrice) * 100;
		db.run(
			`INSERT INTO portfolio_stocks (id, participant_id, ticker, baseline_price, current_price, percent_change, shares, added_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
			[
				crypto.randomUUID(),
				participantId,
				stock.ticker,
				stock.baselinePrice,
				stock.currentPrice,
				stockPercentChange,
				stock.shares,
				pickDate.toISOString(),
			],
		);
	}

	const tickerStr = p.portfolio
		.map((s) => `${s.ticker}x${s.shares}`)
		.join(", ");
	console.log(
		`  ${p.name}: [${tickerStr}] (${weightedPercentChange > 0 ? "+" : ""}${weightedPercentChange.toFixed(1)}%)`,
	);
}

// Add some price history entries for realism
console.log("\nAdding price history entries...");

// Collect all unique stocks with their price data
const allStocks = new Map<string, StockData>();
for (const p of participants) {
	for (const stock of p.portfolio) {
		if (!allStocks.has(stock.ticker)) {
			allStocks.set(stock.ticker, stock);
		}
	}
}

const historyDates = [
	"2025-07-01T20:00:00Z",
	"2025-08-01T20:00:00Z",
	"2025-09-01T20:00:00Z",
	"2025-10-01T20:00:00Z",
	"2025-11-01T20:00:00Z",
	"2025-12-01T20:00:00Z",
	"2026-01-07T20:00:00Z",
];

for (const [ticker, stock] of allStocks) {
	const priceRange = stock.currentPrice - stock.baselinePrice;

	for (const historyDate of historyDates) {
		// Simulate gradual price change over time
		const dateIndex = historyDates.indexOf(historyDate);
		const progress = (dateIndex + 1) / historyDates.length;
		const priceAtDate =
			stock.baselinePrice + priceRange * progress * (0.8 + Math.random() * 0.4);

		db.run(
			`INSERT INTO price_history (id, ticker, price, fetched_at) VALUES (?, ?, ?, ?)`,
			[crypto.randomUUID(), ticker, priceAtDate, historyDate],
		);
	}
}

// Verify the data
console.log("\n=== Seed Complete ===");
const compCount = db
	.query("SELECT COUNT(*) as count FROM competitions")
	.get() as { count: number };
const partCount = db
	.query("SELECT COUNT(*) as count FROM participants")
	.get() as { count: number };
const histCount = db
	.query("SELECT COUNT(*) as count FROM price_history")
	.get() as { count: number };

console.log(`Competitions: ${compCount.count}`);
console.log(`Participants: ${partCount.count}`);
console.log(`Price history entries: ${histCount.count}`);

// Show leaderboard preview
console.log("\n=== Leaderboard Preview ===");
const leaderboard = db
	.query(`
  SELECT name, ticker, baseline_price, current_price, percent_change
  FROM participants
  WHERE competition_id = ?
  ORDER BY percent_change DESC
`)
	.all(competitionId) as Array<{
	name: string;
	ticker: string;
	baseline_price: number;
	current_price: number;
	percent_change: number;
}>;

leaderboard.forEach((p, idx) => {
	const sign = p.percent_change >= 0 ? "+" : "";
	console.log(
		`${(idx + 1).toString().padStart(2)}. ${p.name.padEnd(8)} ${p.ticker.padEnd(5)} ${sign}${p.percent_change.toFixed(2)}%`,
	);
});

db.close();
console.log(
	"\nDone! Run 'bun run index.ts' and visit http://localhost:3000 to see the leaderboard.",
);
console.log(
	`\nDirect link to competition: http://localhost:3000/#${competitionSlug}`,
);
