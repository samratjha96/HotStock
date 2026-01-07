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

// Create indexes for common queries
db.run(
	`CREATE INDEX IF NOT EXISTS idx_participants_competition ON participants(competition_id)`,
);
db.run(
	`CREATE INDEX IF NOT EXISTS idx_price_history_ticker ON price_history(ticker)`,
);

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
