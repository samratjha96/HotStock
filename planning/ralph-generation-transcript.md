# Ralph Loop Generation Transcript

**Project**: stock-picker-madness  
**Date**: 2026-01-07  
**Location**: /Users/samratj/Documents/scratch/stock-picker-madness

---

## Interview Q&A

### Q1: Problem
**Q**: What problem are you trying to solve with stock-picker-madness?

**A**: A simple app where a bunch of people can form a competition where they pick one stock and one stock only. We record the date they made/finalized their pick. Maybe there's a window where the user can modify their picks. But the day start value gets finalized at the end of that day the pick is made. Final pick on the final day of the window is locked in and there's no way to change.

The goal is to connect to a free stock price provider API (Yahoo Finance undocumented API). Every day we get the closing price of everyone's picks and track growth since the "finalization" date. At the end of the year, declare a winner - who picked the stock that went up the most percentage-wise.

Focus on simplicity. Only SQLite. Only TypeScript. Maybe Hono if we need a backend. All docker-compose and runnable anywhere.

---

### Q2: Users
**Q**: Who is this for? Just you and a small group of friends, a larger community, or public use?

**A**: Small group of friends. No need for auth.

---

### Q3: MVP
**Q**: Confirming the simplest useful version:
1. Create a competition with a pick window (start date → lock date)
2. Friends join and each pick exactly one stock ticker
3. Picks can be changed until the window closes, then locked forever
4. System records the closing price on the lock date as the baseline
5. Daily fetch of current prices to track % growth
6. Leaderboard showing who's winning based on % gain since their lock-in price

**A**: Yes, looks good.

---

### Q4: Tech Stack
**Q**: Frontend preference? Runtime preference?

**A**: Web UI with HTML/CSS/JS only. Simple. Bun runtime.

---

### Q5: External Integrations
**Q**: Any other external services needed beyond Yahoo Finance?

**A**: No, just research the Yahoo Finance API pattern from existing code.

**Research findings**: Yahoo Finance undocumented API at `https://query1.finance.yahoo.com/v8/finance/chart/{TICKER}?range=1d&interval=1d`. No auth required but needs browser User-Agent header. Rate limited - need to rotate User-Agents and handle 429 responses. Key fields: `regularMarketPrice` (current), `chartPreviousClose` (baseline for % calc).

---

### Q6: Deployment
**Q**: Single docker-compose up? Any specific requirements?

**A**: Yes, single docker-compose. Should run everywhere.

---

### Q7: Done Criteria
**Q**: MVP complete when:
1. Can create a competition with a name and pick window
2. Participants can add themselves and pick exactly one stock ticker
3. Picks are editable until lock date, then frozen
4. System stores the closing price on lock date as baseline
5. Daily job fetches current prices for all picked stocks
6. Leaderboard page shows all participants ranked by % gain
7. Whole thing runs with `docker-compose up`

**A**: Yes, looks good.

---

### Development Rules
**Q**: Testing, code style, commit frequency, anything to avoid?

**A**: 
- Skip tests for MVP
- Simple, readable code
- Commit after each working feature
- Avoid: Complication, heavy libraries

---

## Final Summary (Confirmed)

**Project**: stock-picker-madness

**Problem**: Stock picking competition where friends each pick one stock and compete on % growth over a year.

**Users**: Small friend group (~10 people), no authentication needed.

**Core Flow**:
1. Create competition with pick window (start date → lock date)
2. Friends join and pick exactly one stock ticker each
3. Picks editable until window closes, then locked forever
4. System records closing price on lock date as baseline
5. Daily price fetch tracks % growth from baseline
6. Leaderboard ranks participants by % gain
7. Winner declared at year end

**Tech Stack**:
- Runtime: Bun
- Backend: Hono (TypeScript)
- Database: SQLite
- Frontend: Vanilla HTML/CSS/JS
- Deployment: Docker Compose

**External Integration**:
- Yahoo Finance undocumented API
- User-Agent rotation required, handle 429 rate limits

**MVP Done When**:
1. Can create a competition with name and pick window
2. Participants can join and pick one stock
3. Picks editable until lock date, then frozen
4. Baseline price stored on lock date
5. Daily job fetches current prices
6. Leaderboard shows rankings by % gain
7. Runs with `docker-compose up`

**Non-Goals for MVP**:
- Authentication
- Notifications
- Multiple competitions per user
- Historical charts/graphs

**Development Rules**:
- No tests - focus on working features only
- Simple, readable code
- Commit after each working feature
- Avoid heavy libraries and over-engineering
