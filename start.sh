#!/bin/sh
# ABOUTME: Startup script that seeds demo data then starts the server
# ABOUTME: Used by Docker to ensure demo competition exists on fresh/restart

# Run seed script (idempotent - skips if Demo already exists)
bun run seed.ts

# Start the server
exec bun run index.ts
