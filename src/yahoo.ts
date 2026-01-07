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
	// biome-ignore lint/style/noNonNullAssertion: idx is always valid (0 to length-1)
	return USER_AGENTS[idx]!;
}

// Yahoo Finance uses dashes instead of dots in tickers (e.g., BRK-B not BRK.B)
function normalizeTickerForYahoo(ticker: string): string {
	return ticker.replace(/\./g, "-");
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
	// Check cache first (use original ticker for cache key)
	const cacheKey = ticker.toUpperCase();
	const cached = priceCache.get(cacheKey);
	if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
		return cached.price;
	}

	const yahooTicker = normalizeTickerForYahoo(ticker);
	const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooTicker)}?range=1d&interval=1d`;

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
		priceCache.set(cacheKey, {
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

// Fetch historical price for a specific date
// Returns the closing price for that trading day (or nearest previous trading day)
export async function fetchHistoricalPrice(
	ticker: string,
	date: Date,
): Promise<number | null> {
	// Yahoo Finance chart API accepts period1/period2 as Unix timestamps
	// We request a small range around the target date to handle weekends/holidays
	const targetTimestamp = Math.floor(date.getTime() / 1000);
	// Go back 7 days to ensure we capture at least one trading day
	const startTimestamp = targetTimestamp - 7 * 24 * 60 * 60;
	// End at the target date (or slightly after to include it)
	const endTimestamp = targetTimestamp + 24 * 60 * 60;

	const yahooTicker = normalizeTickerForYahoo(ticker);
	const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooTicker)}?period1=${startTimestamp}&period2=${endTimestamp}&interval=1d`;

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
		console.error(
			`Failed to fetch historical price for ${ticker}: ${response.status}`,
		);
		return null;
	}

	const data = (await response.json()) as YahooHistoricalResponse;
	const result = data.chart?.result?.[0];

	if (!result?.timestamp || !result?.indicators?.quote?.[0]?.close) {
		console.error(`No historical data for ${ticker} around ${date}`);
		return null;
	}

	const timestamps = result.timestamp;
	const closes = result.indicators.quote[0].close;

	// Find the latest price on or before the target date
	let bestPrice: number | null = null;
	for (let i = 0; i < timestamps.length; i++) {
		const ts = timestamps[i];
		const closePrice = closes[i];
		if (ts !== undefined && ts <= targetTimestamp && closePrice != null) {
			bestPrice = closePrice;
		}
	}

	if (bestPrice === null) {
		console.error(`Could not find price for ${ticker} on or before ${date}`);
	}

	return bestPrice;
}

interface YahooHistoricalResponse {
	chart: {
		result?: Array<{
			timestamp?: number[];
			indicators?: {
				quote?: Array<{
					close?: (number | null)[];
				}>;
			};
		}>;
		error?: unknown;
	};
}
