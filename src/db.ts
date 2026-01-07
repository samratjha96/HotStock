// ABOUTME: Database setup and schema for stock-picker-madness
// ABOUTME: Creates SQLite tables for competitions, participants, and price history

import { Database } from "bun:sqlite";

const DB_PATH = process.env.DB_PATH || "./data/stock-picker.db";

// Ensure data directory exists
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

try {
	mkdirSync(dirname(DB_PATH), { recursive: true });
} catch {}

export const db = new Database(DB_PATH);

// Enable foreign keys
db.run("PRAGMA foreign_keys = ON");

// Create tables
db.run(`
  CREATE TABLE IF NOT EXISTS competitions (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    pick_window_start TEXT NOT NULL,
    pick_window_end TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )
`);

// Migration: Add slug column if it doesn't exist
const columns = db.query("PRAGMA table_info(competitions)").all() as Array<{
	name: string;
}>;
const hasSlug = columns.some((col) => col.name === "slug");
if (!hasSlug) {
	db.run("ALTER TABLE competitions ADD COLUMN slug TEXT");
	// Generate slugs for existing competitions
	const existingComps = db
		.query("SELECT id FROM competitions WHERE slug IS NULL")
		.all() as Array<{ id: string }>;
	const chars =
		"abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
	for (const comp of existingComps) {
		let slug = "";
		for (let i = 0; i < 8; i++) {
			slug += chars.charAt(Math.floor(Math.random() * chars.length));
		}
		db.run("UPDATE competitions SET slug = ? WHERE id = ?", [slug, comp.id]);
	}
}

// Create index for slug lookups (only if slug column exists now)
db.run(
	`CREATE INDEX IF NOT EXISTS idx_competitions_slug ON competitions(slug)`,
);

// Migration: Add backfill_mode column if it doesn't exist
const hasBackfillMode = columns.some((col) => col.name === "backfill_mode");
if (!hasBackfillMode) {
	db.run(
		"ALTER TABLE competitions ADD COLUMN backfill_mode INTEGER NOT NULL DEFAULT 0",
	);
}

// Migration: Add finalized column if it doesn't exist
const hasFinalized = columns.some((col) => col.name === "finalized");
if (!hasFinalized) {
	db.run(
		"ALTER TABLE competitions ADD COLUMN finalized INTEGER NOT NULL DEFAULT 0",
	);
}

db.run(`
  CREATE TABLE IF NOT EXISTS participants (
    id TEXT PRIMARY KEY,
    competition_id TEXT NOT NULL,
    name TEXT NOT NULL,
    ticker TEXT NOT NULL,
    baseline_price REAL,
    current_price REAL,
    percent_change REAL,
    pick_date TEXT NOT NULL DEFAULT (datetime('now')),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (competition_id) REFERENCES competitions(id)
  )
`);

db.run(`
  CREATE TABLE IF NOT EXISTS price_history (
    id TEXT PRIMARY KEY,
    ticker TEXT NOT NULL,
    price REAL NOT NULL,
    fetched_at TEXT NOT NULL DEFAULT (datetime('now'))
  )
`);

// Portfolio stocks table - each participant can have up to 10 stocks
db.run(`
  CREATE TABLE IF NOT EXISTS portfolio_stocks (
    id TEXT PRIMARY KEY,
    participant_id TEXT NOT NULL,
    ticker TEXT NOT NULL,
    baseline_price REAL,
    current_price REAL,
    percent_change REAL,
    added_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (participant_id) REFERENCES participants(id) ON DELETE CASCADE,
    UNIQUE(participant_id, ticker)
  )
`);

db.run(
	`CREATE INDEX IF NOT EXISTS idx_portfolio_stocks_participant ON portfolio_stocks(participant_id)`,
);

// Migration: Move existing participant tickers to portfolio_stocks table
// Check if any participants have tickers that aren't in portfolio_stocks yet
const participantsToMigrate = db
	.query(`
    SELECT p.id, p.ticker, p.baseline_price, p.current_price, p.percent_change, p.created_at
    FROM participants p
    WHERE p.ticker IS NOT NULL 
      AND p.ticker != ''
      AND NOT EXISTS (
        SELECT 1 FROM portfolio_stocks ps WHERE ps.participant_id = p.id
      )
  `)
	.all() as Array<{
	id: string;
	ticker: string;
	baseline_price: number | null;
	current_price: number | null;
	percent_change: number | null;
	created_at: string;
}>;

if (participantsToMigrate.length > 0) {
	console.log(
		`Migrating ${participantsToMigrate.length} participants to portfolio_stocks...`,
	);
	for (const p of participantsToMigrate) {
		db.run(
			`INSERT INTO portfolio_stocks (id, participant_id, ticker, baseline_price, current_price, percent_change, added_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
			[
				crypto.randomUUID(),
				p.id,
				p.ticker,
				p.baseline_price,
				p.current_price,
				p.percent_change,
				p.created_at,
			],
		);
	}
	console.log("Migration complete.");
}

db.run(`
  CREATE TABLE IF NOT EXISTS audit_log (
    id TEXT PRIMARY KEY,
    competition_id TEXT NOT NULL,
    action TEXT NOT NULL,
    actor_name TEXT,
    details TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (competition_id) REFERENCES competitions(id)
  )
`);

// Create indexes for common queries
db.run(
	`CREATE INDEX IF NOT EXISTS idx_participants_competition ON participants(competition_id)`,
);
db.run(
	`CREATE INDEX IF NOT EXISTS idx_price_history_ticker ON price_history(ticker)`,
);
db.run(
	`CREATE INDEX IF NOT EXISTS idx_audit_log_competition ON audit_log(competition_id)`,
);

export type AuditAction =
	| "unlock"
	| "lock"
	| "pick_changed"
	| "participant_joined"
	| "portfolio_updated";

export function logAuditEvent(
	competitionId: string,
	action: AuditAction,
	actorName: string | null,
	details: Record<string, unknown> | null,
): void {
	const id = generateId();
	db.run(
		`INSERT INTO audit_log (id, competition_id, action, actor_name, details) VALUES (?, ?, ?, ?, ?)`,
		[
			id,
			competitionId,
			action,
			actorName,
			details ? JSON.stringify(details) : null,
		],
	);
}

export interface AuditLogEntry {
	id: string;
	competition_id: string;
	action: AuditAction;
	actor_name: string | null;
	details: string | null;
	created_at: string;
}

export function getAuditLog(
	competitionId: string,
	limit: number,
	offset: number,
): AuditLogEntry[] {
	return db
		.query(
			`SELECT * FROM audit_log WHERE competition_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?`,
		)
		.all(competitionId, limit, offset) as AuditLogEntry[];
}

export function getAuditLogCount(competitionId: string): number {
	const result = db
		.query(`SELECT COUNT(*) as count FROM audit_log WHERE competition_id = ?`)
		.get(competitionId) as { count: number };
	return result.count;
}

export function generateId(): string {
	return crypto.randomUUID();
}

export function generateSlug(): string {
	// Generate a short random slug like pastebin (e.g., "a7xK2m")
	const chars =
		"abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
	let slug = "";
	for (let i = 0; i < 8; i++) {
		slug += chars.charAt(Math.floor(Math.random() * chars.length));
	}
	return slug;
}
