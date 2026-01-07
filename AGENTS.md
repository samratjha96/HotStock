# AGENTS.md - Guide for AI Agents

This document provides essential context for AI agents working on this codebase.

## Project Overview

**Stock Picker Madness** is a web app for running stock picking competitions among friends. Users create competitions with a pick window, participants join by selecting a stock ticker, and the leaderboard tracks performance based on real stock price changes.

## Tech Stack

- **Runtime**: Bun (not Node.js)
- **Backend**: Hono framework
- **Database**: SQLite via `bun:sqlite`
- **Frontend**: Vanilla HTML/CSS/JS (no React, no build step)
- **Deployment**: Docker

## Critical Rules

### 1. Always Use Bun
- `bun run index.ts` not `node index.ts`
- `bun install` not `npm install`
- `bun test` not `jest` or `vitest`
- See `CLAUDE.md` for full Bun API guidance

### 2. Docker Deployment Must Always Work
After any changes, verify Docker still works:
```bash
docker compose build
docker compose up -d
curl http://localhost:3000
docker compose down
```

The app must:
- Build successfully with `docker compose build`
- Start and serve requests on port 3000
- Persist data in the `stock-data` volume at `/app/data/stock-picker.db`

### 3. Database Migrations
SQLite schema lives in `src/db.ts`. When adding columns:
- Add migration logic that checks if column exists before altering
- Never break existing databases
- Example pattern (see `src/db.ts` for slug migration)

### 4. API Routes
All API routes are in `index.ts`:
- `GET /api/competitions` - List competitions
- `POST /api/competitions` - Create competition
- `GET /api/competitions/:slugOrId` - Get competition details
- `POST /api/competitions/:slugOrId/join` - Join competition
- `PUT /api/participants/:id` - Update participant's pick
- `POST /api/competitions/:slugOrId/refresh-prices` - Refresh stock prices

### 5. Frontend
Static files served from `public/`:
- `index.html` - Single page app
- `style.css` - March Madness tournament theme
- `app.js` - Vanilla JS for UI interactions

No build step required. Changes to these files are immediately reflected.

## File Structure

```
├── index.ts           # Main server, API routes
├── src/
│   ├── db.ts          # Database setup, migrations, helpers
│   └── yahoo.ts       # Yahoo Finance API for stock prices
├── public/
│   ├── index.html     # Frontend HTML
│   ├── style.css      # Styles
│   └── app.js         # Frontend JavaScript
├── Dockerfile         # Container build
├── docker-compose.yml # Deployment config
└── seed.ts            # Test data seeding script
```

## Testing Changes

1. **Local development**:
   ```bash
   bun run index.ts
   # Visit http://localhost:3000
   ```

2. **Docker deployment**:
   ```bash
   docker compose up --build
   # Visit http://localhost:3000
   ```

## Common Pitfalls

- Don't use `express`, `better-sqlite3`, `dotenv`, or other Node.js packages - Bun has built-in alternatives
- Don't add a frontend build step - the app serves static files directly
- Don't forget to test Docker after changes to dependencies or file structure
- Competition URLs use slugs (e.g., `/#TV62sRTJ`), not UUIDs
