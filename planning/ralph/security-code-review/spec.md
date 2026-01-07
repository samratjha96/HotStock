# Security & Code Review - HotStock

## Goal
Harden the HotStock codebase with code cleanup (unused code, inefficiencies) and basic security protections against API abuse.

## Scope
**Full cleanup** - Fix all identified issues and verify each fix works.

## Current Tech Stack
- Runtime: Bun
- Backend: Hono framework
- Database: SQLite via `bun:sqlite`
- Frontend: Vanilla HTML/CSS/JS (no build step)
- Deployment: Docker

## Code Cleanup Tasks

### 1. Install and Configure Biome
- Add `@biomejs/biome` as dev dependency: `bun add -D -E @biomejs/biome`
- Initialize config: `bunx --bun biome init`
- Configure for TypeScript and JavaScript
- Add npm scripts: `lint`, `lint:fix`, `format`

### 2. Remove Unused Code/Imports
- Audit all files for:
  - Unused imports
  - Unused variables
  - Dead code paths
  - Unused functions

### 3. Fix Inefficient Patterns
- Review for:
  - Redundant database queries
  - Unnecessary re-computations
  - Code duplication
  - Overly complex logic that could be simplified

## Security Hardening Tasks

### 4. API Endpoint Audit

Current endpoints to review:
| Endpoint | Method | Risk Assessment |
|----------|--------|-----------------|
| `/api/competitions` | GET | Low - read only |
| `/api/competitions` | POST | Medium - creates data |
| `/api/competitions/:slugOrId` | GET | Low - read only |
| `/api/competitions/:slugOrId/join` | POST | Medium - creates participant |
| `/api/participants/:id` | PUT | **HIGH** - updates data by ID |
| `/api/competitions/:slugOrId/leaderboard` | GET | Low - read only |

### 5. Rate Limiting
Add rate limiting to prevent DoS:
- Global rate limit: ~100 requests/minute per IP
- Stricter limits on write endpoints (POST, PUT): ~10 requests/minute per IP
- Use Hono middleware or simple in-memory rate limiter

### 6. Authorization Checks
Fix the following vulnerabilities:
- **PUT `/api/participants/:id`**: Anyone can update ANY participant's ticker if they know the ID
  - Solution: Require some form of ownership verification (e.g., session token from join, or name re-entry)
- **POST `/api/competitions/:slugOrId/join`**: No duplicate protection beyond name
  - Already has name uniqueness check - OK

### 7. Input Validation
Ensure all user inputs are validated:
- Competition name: max length, no script injection
- Participant name: max length, no script injection
- Ticker: already validated against Yahoo Finance API
- Dates: already validated as Date objects
- slugOrId: sanitize for SQL injection (using parameterized queries - verify)

### 8. Database Integrity
- Verify all queries use parameterized statements (not string concatenation)
- Ensure foreign key constraints are enforced
- Add input length limits at database level if needed

## Out of Scope
- Full authentication system (users are friends, not public)
- HTTPS/TLS (handled by deployment infrastructure)
- CSRF protection (no cookies/sessions currently)
- Comprehensive penetration testing
- Automated security scanning tools

## Done When
- [ ] Biome installed and configured with lint + format scripts
- [ ] `bunx biome check .` passes with no errors
- [ ] All unused code removed
- [ ] Rate limiting middleware active on all endpoints
- [ ] PUT `/api/participants/:id` has ownership verification
- [ ] Input validation on all string inputs (max length)
- [ ] All SQL queries verified as parameterized
- [ ] `docker compose build && docker compose up` works
- [ ] Manual smoke test: create competition, join, update pick, view leaderboard

## Development Rules
- Use `bun` for all package management
- NO new tests required (MVP scope of original project)
- Commit after each logical change
- Verify Docker still works after dependency changes
- Keep changes minimal - don't refactor working code unnecessarily

## API Research: Hono Rate Limiting

Hono has built-in rate limiting middleware. Example:
```typescript
import { rateLimiter } from 'hono/rate-limiter'

// Simple in-memory rate limiter
app.use(rateLimiter({
  windowMs: 60 * 1000, // 1 minute
  limit: 100, // 100 requests per minute
  keyGenerator: (c) => c.req.header('x-forwarded-for') || 'unknown'
}))
```

Note: For Bun + Hono, may need to check if `hono/rate-limiter` is available or use a custom implementation.

## Biome Configuration Reference

Minimal `biome.json`:
```json
{
  "$schema": "https://biomejs.dev/schemas/1.9.4/schema.json",
  "organizeImports": { "enabled": true },
  "linter": {
    "enabled": true,
    "rules": { "recommended": true }
  },
  "formatter": {
    "enabled": true,
    "indentStyle": "space",
    "indentWidth": 2
  },
  "files": {
    "ignore": ["node_modules", "data", "*.db"]
  }
}
```
