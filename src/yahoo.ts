// ABOUTME: Yahoo Finance API client for fetching stock prices
// ABOUTME: Implements rate limiting, user-agent rotation, and caching

const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:135.0) Gecko/20100101 Firefox/135.0",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_7_4) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.3 Safari/605.1.15",
];

function getRandomUserAgent(): string {
  const idx = Math.floor(Math.random() * USER_AGENTS.length);
  return USER_AGENTS[idx]!;
}

interface PriceCache {
  price: number;
  fetchedAt: number;
}

interface YahooChartResponse {
  chart: {
    result?: Array<{
      meta: {
        regularMarketPrice: number;
      };
    }>;
    error?: unknown;
  };
}

// Cache prices for 5 minutes
const CACHE_TTL_MS = 5 * 60 * 1000;
const priceCache = new Map<string, PriceCache>();

export async function fetchPrice(ticker: string): Promise<number | null> {
  // Check cache first
  const cached = priceCache.get(ticker.toUpperCase());
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.price;
  }

  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?range=1d&interval=1d`;

  let response = await fetch(url, {
    headers: { "User-Agent": getRandomUserAgent() },
  });

  // Handle rate limiting with retry
  if (response.status === 429) {
    await new Promise((r) => setTimeout(r, 2000));
    response = await fetch(url, {
      headers: { "User-Agent": getRandomUserAgent() },
    });
  }

  if (!response.ok) {
    console.error(`Failed to fetch price for ${ticker}: ${response.status}`);
    return null;
  }

  const data = (await response.json()) as YahooChartResponse;
  const price = data.chart?.result?.[0]?.meta?.regularMarketPrice ?? null;

  if (price !== null) {
    priceCache.set(ticker.toUpperCase(), {
      price,
      fetchedAt: Date.now(),
    });
  }

  return price;
}

export async function validateTicker(ticker: string): Promise<boolean> {
  const price = await fetchPrice(ticker);
  return price !== null;
}
