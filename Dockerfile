# ABOUTME: Dockerfile for HotStock
# ABOUTME: Builds a minimal container using Bun runtime

FROM oven/bun:1 AS base
WORKDIR /app

# Install dependencies
COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile --production

# Copy source files
COPY . .

# Create data directory for SQLite
RUN mkdir -p /app/data

# Expose port
EXPOSE 3000

# Run the app via startup script (seeds demo data first)
ENV NODE_ENV=production
ENV DB_PATH=/app/data/stock-picker.db
CMD ["./start.sh"]
