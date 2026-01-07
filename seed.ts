// ABOUTME: Seeds the database with sample competition data for testing
// ABOUTME: Simulates a competition from June 30, 2025 being viewed today

import { Database } from "bun:sqlite";

const DB_PATH = process.env.DB_PATH || "./data/stock-picker.db";
const db = new Database(DB_PATH);

// Clear existing data
console.log("Clearing existing data...");
db.run("DELETE FROM price_history");
db.run("DELETE FROM participants");
db.run("DELETE FROM competitions");

// Ensure slug column exists (migration for existing databases)
try {
  db.run("ALTER TABLE competitions ADD COLUMN slug TEXT");
} catch {
  // Column already exists, ignore
}
try {
  db.run("CREATE UNIQUE INDEX IF NOT EXISTS idx_competitions_slug ON competitions(slug)");
} catch {
  // Index already exists, ignore
}

// Helper to generate short slug
function generateSlug(): string {
  const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let slug = "";
  for (let i = 0; i < 8; i++) {
    slug += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return slug;
}

// Competition: "Summer 2025 Stock Showdown"
// Pick window: June 30, 2025 00:00 - July 1, 2025 23:59
// Today is January 7, 2026 - competition has been running ~6 months

const competitionId = crypto.randomUUID();
const competitionSlug = generateSlug();
const competition = {
  id: competitionId,
  name: "Summer 2025 Stock Showdown",
  slug: competitionSlug,
  pick_window_start: "2025-06-30T00:00:00Z",
  pick_window_end: "2025-07-01T23:59:59Z",
  created_at: "2025-06-29T12:00:00Z",
};

console.log("Creating competition:", competition.name);
console.log("  Slug:", competition.slug);
db.run(
  `INSERT INTO competitions (id, name, slug, pick_window_start, pick_window_end, created_at) 
   VALUES (?, ?, ?, ?, ?, ?)`,
  [competition.id, competition.name, competition.slug, competition.pick_window_start, competition.pick_window_end, competition.created_at]
);

// Participants with realistic stock picks
// Baseline prices are approximate close prices from June 30-July 1, 2025
// Current prices need to be fetched or estimated for Jan 7, 2026
// Using approximate historical data

interface ParticipantData {
  name: string;
  ticker: string;
  baselinePrice: number;  // Price at lock date (July 1, 2025)
  currentPrice: number;   // Price today (Jan 7, 2026) - simulated
}

// These are simulated prices - in reality you'd fetch current prices from Yahoo
const participants: ParticipantData[] = [
  // Big tech - mixed performance
  { name: "Alice", ticker: "NVDA", baselinePrice: 123.54, currentPrice: 148.90 },    // +20.5% - AI boom continues
  { name: "Bob", ticker: "AAPL", baselinePrice: 218.24, currentPrice: 243.15 },      // +11.4% - steady growth
  { name: "Charlie", ticker: "GOOGL", baselinePrice: 184.76, currentPrice: 197.30 }, // +6.8%
  { name: "Diana", ticker: "MSFT", baselinePrice: 447.45, currentPrice: 431.20 },    // -3.6% - slight dip
  { name: "Eve", ticker: "META", baselinePrice: 504.22, currentPrice: 612.77 },      // +21.5% - strong reels/AI
  
  // EVs and automotive
  { name: "Frank", ticker: "TSLA", baselinePrice: 248.48, currentPrice: 410.44 },    // +65.2% - big winner!
  { name: "Grace", ticker: "RIVN", baselinePrice: 13.88, currentPrice: 14.12 },      // +1.7% - barely moved
  
  // Retail/Consumer
  { name: "Henry", ticker: "AMZN", baselinePrice: 197.12, currentPrice: 224.92 },    // +14.1%
  { name: "Ivy", ticker: "WMT", baselinePrice: 68.05, currentPrice: 91.94 },         // +35.1% - surprise performer
  { name: "Jack", ticker: "COST", baselinePrice: 846.71, currentPrice: 924.44 },     // +9.2%
  
  // Crypto-adjacent
  { name: "Karen", ticker: "COIN", baselinePrice: 237.81, currentPrice: 268.94 },    // +13.1%
  
  // Healthcare
  { name: "Leo", ticker: "JNJ", baselinePrice: 146.71, currentPrice: 144.07 },       // -1.8%
  
  // Energy
  { name: "Maya", ticker: "XOM", baselinePrice: 114.71, currentPrice: 106.83 },      // -6.9% - oil struggles
  
  // Meme stocks / risky picks
  { name: "Nick", ticker: "GME", baselinePrice: 23.14, currentPrice: 31.15 },        // +34.6% - meme magic
  { name: "Olivia", ticker: "AMC", baselinePrice: 4.89, currentPrice: 3.23 },        // -33.9% - big loser
];

console.log(`Adding ${participants.length} participants...`);

for (const p of participants) {
  const participantId = crypto.randomUUID();
  const percentChange = ((p.currentPrice - p.baselinePrice) / p.baselinePrice) * 100;
  
  // Pick date is during the window (June 30 - July 1, 2025)
  const pickDate = new Date("2025-06-30T14:00:00Z");
  pickDate.setHours(pickDate.getHours() + Math.floor(Math.random() * 30)); // Random time in window
  
  db.run(
    `INSERT INTO participants (id, competition_id, name, ticker, baseline_price, current_price, percent_change, pick_date, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      participantId,
      competitionId,
      p.name,
      p.ticker,
      p.baselinePrice,
      p.currentPrice,
      percentChange,
      pickDate.toISOString(),
      pickDate.toISOString(),
    ]
  );
  
  console.log(`  ${p.name}: ${p.ticker} @ $${p.baselinePrice} -> $${p.currentPrice} (${percentChange > 0 ? '+' : ''}${percentChange.toFixed(1)}%)`);
}

// Add some price history entries for realism
console.log("\nAdding price history entries...");
const tickers = [...new Set(participants.map(p => p.ticker))];
const historyDates = [
  "2025-07-01T20:00:00Z",
  "2025-08-01T20:00:00Z",
  "2025-09-01T20:00:00Z",
  "2025-10-01T20:00:00Z",
  "2025-11-01T20:00:00Z",
  "2025-12-01T20:00:00Z",
  "2026-01-07T20:00:00Z",
];

for (const ticker of tickers) {
  const participant = participants.find(p => p.ticker === ticker)!;
  const priceRange = participant.currentPrice - participant.baselinePrice;
  
  for (const historyDate of historyDates) {
    // Simulate gradual price change over time
    const dateIndex = historyDates.indexOf(historyDate);
    const progress = (dateIndex + 1) / historyDates.length;
    const priceAtDate = participant.baselinePrice + (priceRange * progress * (0.8 + Math.random() * 0.4));
    
    db.run(
      `INSERT INTO price_history (id, ticker, price, fetched_at) VALUES (?, ?, ?, ?)`,
      [crypto.randomUUID(), ticker, priceAtDate, historyDate]
    );
  }
}

// Verify the data
console.log("\n=== Seed Complete ===");
const compCount = db.query("SELECT COUNT(*) as count FROM competitions").get() as { count: number };
const partCount = db.query("SELECT COUNT(*) as count FROM participants").get() as { count: number };
const histCount = db.query("SELECT COUNT(*) as count FROM price_history").get() as { count: number };

console.log(`Competitions: ${compCount.count}`);
console.log(`Participants: ${partCount.count}`);
console.log(`Price history entries: ${histCount.count}`);

// Show leaderboard preview
console.log("\n=== Leaderboard Preview ===");
const leaderboard = db.query(`
  SELECT name, ticker, baseline_price, current_price, percent_change
  FROM participants
  WHERE competition_id = ?
  ORDER BY percent_change DESC
`).all(competitionId) as Array<{
  name: string;
  ticker: string;
  baseline_price: number;
  current_price: number;
  percent_change: number;
}>;

leaderboard.forEach((p, idx) => {
  const sign = p.percent_change >= 0 ? '+' : '';
  console.log(`${(idx + 1).toString().padStart(2)}. ${p.name.padEnd(8)} ${p.ticker.padEnd(5)} ${sign}${p.percent_change.toFixed(2)}%`);
});

db.close();
console.log("\nDone! Run 'bun run index.ts' and visit http://localhost:3000 to see the leaderboard.");
console.log(`\nDirect link to competition: http://localhost:3000/#${competitionSlug}`);
