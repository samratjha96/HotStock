# stock-picker-madness

## Goal

A stock picking competition app where friends each pick one stock and compete on percentage growth over time.

## Core Mechanics

- **Create Competition**: Set a name and pick window (start date → lock date)
- **Join & Pick**: Participants enter their name and pick exactly one stock ticker
- **Editable Window**: Picks can be changed until the lock date
- **Lock-in**: At lock date, picks are frozen and baseline price is recorded
- **Daily Tracking**: System fetches current prices daily and calculates % growth from baseline
- **Leaderboard**: Ranks all participants by % gain, highest wins

## Tech Stack

- **Runtime**: Bun
- **Backend**: Hono (lightweight, fast)
- **Database**: SQLite (simple, file-based, no setup)
- **Frontend**: Vanilla HTML/CSS/JS (no build step, served by Hono)
- **Deployment**: Docker Compose (single command startup)

## Data Model

### competitions
| Field | Type | Description |
|-------|------|-------------|
| id | TEXT | UUID primary key |
| name | TEXT | Competition name |
| pick_window_start | TEXT | ISO date when picks open |
| pick_window_end | TEXT | ISO date when picks lock |
| created_at | TEXT | ISO timestamp |

### participants
| Field | Type | Description |
|-------|------|-------------|
| id | TEXT | UUID primary key |
| competition_id | TEXT | FK to competitions |
| name | TEXT | Participant display name |
| ticker | TEXT | Stock ticker symbol (e.g., AAPL) |
| baseline_price | REAL | Price at lock date (null until locked) |
| current_price | REAL | Latest fetched price |
| percent_change | REAL | Calculated % gain/loss |
| pick_date | TEXT | When they made/last changed their pick |
| created_at | TEXT | ISO timestamp |

### price_history
| Field | Type | Description |
|-------|------|-------------|
| id | TEXT | UUID primary key |
| ticker | TEXT | Stock ticker symbol |
| price | REAL | Closing price |
| fetched_at | TEXT | ISO timestamp |

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | / | Serve frontend |
| GET | /api/competitions | List all competitions |
| POST | /api/competitions | Create a competition |
| GET | /api/competitions/:id | Get competition details + participants |
| POST | /api/competitions/:id/join | Join competition with name + ticker |
| PUT | /api/participants/:id | Update participant's ticker (if window open) |
| GET | /api/competitions/:id/leaderboard | Get ranked leaderboard |

## Frontend Pages

1. **Home**: List competitions, create new one
2. **Competition Detail**: Show pick window status, participants, join form
3. **Leaderboard**: Ranked list with % changes, highlights leader

## Background Jobs

- **Price Fetch Job**: Runs daily (or on demand), fetches current price for all unique tickers, updates `current_price` and `percent_change` for all participants
- **Lock-in Job**: On lock date, fetches closing prices and sets `baseline_price` for all participants in that competition

## External Integrations

### Yahoo Finance API

**Endpoint**: 
```
https://query1.finance.yahoo.com/v8/finance/chart/{TICKER}?range=1d&interval=1d
```

**Headers Required**:
```typescript
{
  "User-Agent": "<browser user agent string>"
}
```

**User-Agent Rotation** (required to avoid blocks):
```typescript
const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:135.0) Gecko/20100101 Firefox/135.0",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_7_4) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.3 Safari/605.1.15",
];

function getRandomUserAgent(): string {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}
```

**Response Structure** (key fields):
```typescript
interface YahooResponse {
  chart: {
    result: Array<{
      meta: {
        regularMarketPrice: number;  // Current/latest price
        chartPreviousClose: number;  // Previous close
        symbol: string;
      };
    }>;
    error: any | null;
  };
}
```

**Rate Limit Handling**:
- On 429 response: wait 2 seconds, rotate User-Agent, retry once
- Cache responses for 5+ minutes to reduce API calls

**Fetch Pattern**:
```typescript
async function fetchPrice(ticker: string): Promise<number | null> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?range=1d&interval=1d`;
  
  let response = await fetch(url, {
    headers: { "User-Agent": getRandomUserAgent() }
  });
  
  if (response.status === 429) {
    await new Promise(r => setTimeout(r, 2000));
    response = await fetch(url, {
      headers: { "User-Agent": getRandomUserAgent() }
    });
  }
  
  if (!response.ok) return null;
  
  const data = await response.json();
  return data.chart.result?.[0]?.meta?.regularMarketPrice ?? null;
}
```

## MVP Done When

- [ ] Can create a competition with name and pick window dates
- [ ] Participants can join by entering name and stock ticker
- [ ] Picks are editable until lock date, then frozen (enforced)
- [ ] Baseline price is stored when window closes
- [ ] Daily/manual price fetch updates all current prices
- [ ] Leaderboard displays participants ranked by % gain
- [ ] Everything runs with `docker-compose up`

## Non-Goals (Not for MVP)

- Authentication / user accounts
- Notifications (email, push, etc.)
- Historical price charts or graphs
- Multiple competitions per person tracking
- Real-time price updates (daily is fine)
- Mobile app

## Development Rules

- **Runtime**: Use `bun` for all package management and running
- **Testing**: NO TESTS - focus on working features only
- **Build verification**: `bun run build` must succeed (if applicable)
- **Deployment verification**: `docker-compose up` must work
- **Commits**: Commit after each working feature
- **Style**: Simple, readable code. Avoid heavy libraries and over-engineering.
- **Parallelization**: Use subagents for independent work (e.g., frontend and backend can be built in parallel once API contract is defined)
