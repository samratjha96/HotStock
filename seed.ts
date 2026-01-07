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
}

interface ParticipantData {
	name: string;
	portfolio: StockData[];
}

// These are simulated prices - in reality you'd fetch current prices from Yahoo
const participants: ParticipantData[] = [
	// Single-stock portfolios (traditional picks)
	{
		name: "Alice",
		portfolio: [{ ticker: "NVDA", baselinePrice: 123.54, currentPrice: 148.9 }],
	}, // +20.5% - AI boom continues
	{
		name: "Bob",
		portfolio: [
			{ ticker: "AAPL", baselinePrice: 218.24, currentPrice: 243.15 },
		],
	}, // +11.4% - steady growth
	{
		name: "Charlie",
		portfolio: [
			{ ticker: "GOOGL", baselinePrice: 184.76, currentPrice: 197.3 },
		],
	}, // +6.8%
	{
		name: "Diana",
		portfolio: [{ ticker: "MSFT", baselinePrice: 447.45, currentPrice: 431.2 }],
	}, // -3.6% - slight dip

	// Multi-stock portfolios (new feature)
	{
		name: "Eve",
		portfolio: [
			{ ticker: "META", baselinePrice: 504.22, currentPrice: 612.77 }, // +21.5%
			{ ticker: "NVDA", baselinePrice: 123.54, currentPrice: 148.9 }, // +20.5%
			{ ticker: "GOOGL", baselinePrice: 184.76, currentPrice: 197.3 }, // +6.8%
		],
	}, // avg ~16.3%

	{
		name: "Frank",
		portfolio: [
			{ ticker: "TSLA", baselinePrice: 248.48, currentPrice: 410.44 }, // +65.2%
			{ ticker: "RIVN", baselinePrice: 13.88, currentPrice: 14.12 }, // +1.7%
		],
	}, // avg ~33.5% - EV focused

	{
		name: "Grace",
		portfolio: [
			{ ticker: "AMZN", baselinePrice: 197.12, currentPrice: 224.92 }, // +14.1%
			{ ticker: "WMT", baselinePrice: 68.05, currentPrice: 91.94 }, // +35.1%
			{ ticker: "COST", baselinePrice: 846.71, currentPrice: 924.44 }, // +9.2%
		],
	}, // avg ~19.5% - Retail portfolio

	{
		name: "Henry",
		portfolio: [
			{ ticker: "COIN", baselinePrice: 237.81, currentPrice: 268.94 }, // +13.1%
			{ ticker: "GME", baselinePrice: 23.14, currentPrice: 31.15 }, // +34.6%
		],
	}, // avg ~23.9% - High risk

	{
		name: "Ivy",
		portfolio: [
			{ ticker: "JNJ", baselinePrice: 146.71, currentPrice: 144.07 }, // -1.8%
			{ ticker: "XOM", baselinePrice: 114.71, currentPrice: 106.83 }, // -6.9%
		],
	}, // avg ~-4.4% - Defensive picks that didn't work

	{
		name: "Jack",
		portfolio: [{ ticker: "AMC", baselinePrice: 4.89, currentPrice: 3.23 }],
	}, // -33.9% - big loser
];

console.log(`Adding ${participants.length} participants...`);

for (const p of participants) {
	const participantId = crypto.randomUUID();

	// Calculate aggregate percent change
	const stockChanges = p.portfolio.map(
		(s) => ((s.currentPrice - s.baselinePrice) / s.baselinePrice) * 100,
	);
	const avgPercentChange =
		stockChanges.reduce((sum, c) => sum + c, 0) / stockChanges.length;

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
			avgPercentChange,
			pickDate.toISOString(),
			pickDate.toISOString(),
		],
	);

	// Insert portfolio stocks
	for (const stock of p.portfolio) {
		const stockPercentChange =
			((stock.currentPrice - stock.baselinePrice) / stock.baselinePrice) * 100;
		db.run(
			`INSERT INTO portfolio_stocks (id, participant_id, ticker, baseline_price, current_price, percent_change, added_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
			[
				crypto.randomUUID(),
				participantId,
				stock.ticker,
				stock.baselinePrice,
				stock.currentPrice,
				stockPercentChange,
				pickDate.toISOString(),
			],
		);
	}

	const tickerStr = p.portfolio.map((s) => s.ticker).join(", ");
	console.log(
		`  ${p.name}: [${tickerStr}] (${avgPercentChange > 0 ? "+" : ""}${avgPercentChange.toFixed(1)}%)`,
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
