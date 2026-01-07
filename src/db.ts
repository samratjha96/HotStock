// ABOUTME: Database setup and schema for stock-picker-madness
// ABOUTME: Creates SQLite tables for competitions, participants, and price history

import { Database } from "bun:sqlite";

const DB_PATH = process.env.DB_PATH || "./data/stock-picker.db";

// Ensure data directory exists
import { mkdirSync } from "fs";
import { dirname } from "path";
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
db.run(`CREATE INDEX IF NOT EXISTS idx_participants_competition ON participants(competition_id)`);
db.run(`CREATE INDEX IF NOT EXISTS idx_price_history_ticker ON price_history(ticker)`);

export function generateId(): string {
  return crypto.randomUUID();
}
