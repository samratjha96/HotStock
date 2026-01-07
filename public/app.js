// ABOUTME: Frontend JavaScript for stock-picker-madness
// ABOUTME: Handles UI interactions, API calls, and URL-based navigation

const VIRTUAL_BUDGET = 1000;

// Price cache for budget calculation
const priceCache = new Map();

const API = {
	async getCompetitions() {
		const res = await fetch("/api/competitions");
		return res.json();
	},

	async createCompetition(data) {
		const res = await fetch("/api/competitions", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(data),
		});
		return res.json();
	},

	async getCompetition(slugOrId) {
		const res = await fetch(`/api/competitions/${slugOrId}`);
		return res.json();
	},

	async joinCompetition(slugOrId, data) {
		const res = await fetch(`/api/competitions/${slugOrId}/join`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(data),
		});
		return res.json();
	},

	async updateParticipant(participantId, data) {
		const res = await fetch(`/api/participants/${participantId}`, {
			method: "PUT",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(data),
		});
		return res.json();
	},

	async finalizeCompetition(slugOrId) {
		const res = await fetch(`/api/competitions/${slugOrId}/finalize`, {
			method: "POST",
		});
		return res.json();
	},

	async unfinalizeCompetition(slugOrId) {
		const res = await fetch(`/api/competitions/${slugOrId}/unfinalize`, {
			method: "POST",
		});
		return res.json();
	},

	async getAuditLog(slugOrId, limit = 20, offset = 0) {
		const res = await fetch(
			`/api/competitions/${slugOrId}/audit-log?limit=${limit}&offset=${offset}`,
		);
		return res.json();
	},

	// Fetch current stock price for budget calculation
	async getStockPrice(ticker) {
		// Use Yahoo Finance chart API for quick quote
		try {
			const res = await fetch(
				`https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=1d&range=1d`,
			);
			const data = await res.json();
			if (data.chart?.result?.[0]?.meta?.regularMarketPrice) {
				return data.chart.result[0].meta.regularMarketPrice;
			}
		} catch (e) {
			console.error("Failed to fetch price for", ticker, e);
		}
		return null;
	},
};

// State
let currentCompetitionSlug = null;

// DOM Elements
const homeSection = document.getElementById("home-section");
const competitionSection = document.getElementById("competition-section");
const competitionsList = document.getElementById("competitions-list");
const competitionDetail = document.getElementById("competition-detail");

// Modals
const createModal = document.getElementById("create-modal");
const joinModal = document.getElementById("join-modal");
const editModal = document.getElementById("edit-modal");

// Format date for display (converts UTC to local timezone)
function formatDate(isoString) {
	return new Date(isoString).toLocaleDateString("en-US", {
		month: "short",
		day: "numeric",
		year: "numeric",
		hour: "numeric",
		minute: "2-digit",
	});
}

// Format date without time, showing UTC date (for backfill competitions)
// This prevents timezone shift - user picks Jan 1, they see Jan 1
function formatDateOnly(isoString) {
	const date = new Date(isoString);
	return date.toLocaleDateString("en-US", {
		month: "short",
		day: "numeric",
		year: "numeric",
		timeZone: "UTC",
	});
}

// Get competition status
function getStatus(competition) {
	// Past competitions have special status handling
	if (competition.backfill_mode || competition.is_backfill) {
		if (competition.finalized || competition.is_finalized) {
			return { text: "Locked", class: "status-locked" };
		}
		return { text: "Adding Picks", class: "status-setup" };
	}

	const now = new Date();
	const start = new Date(competition.pick_window_start);
	const end = new Date(competition.pick_window_end);

	if (now < start) return { text: "Upcoming", class: "status-upcoming" };
	if (now > end) return { text: "Locked", class: "status-locked" };
	return { text: "Open", class: "status-open" };
}

// Format percent change
function formatPercent(value) {
	if (value === null || value === undefined) return "—";
	const sign = value >= 0 ? "+" : "";
	return `${sign}${value.toFixed(2)}%`;
}

// Render competitions list
async function renderCompetitions() {
	competitionsList.innerHTML = '<p class="loading">Loading...</p>';

	const competitions = await API.getCompetitions();

	if (competitions.length === 0) {
		competitionsList.innerHTML =
			'<p class="empty-state">No competitions yet. Create one to get started!</p>';
		return;
	}

	competitionsList.innerHTML = competitions
		.map((comp) => {
			const status = getStatus(comp);
			return `
        <div class="competition-card" data-slug="${comp.slug}">
          <h3>${escapeHtml(comp.name)}</h3>
          <p class="meta">
            <span class="status-badge ${status.class}">${status.text}</span>
            ${comp.participant_count} participant${comp.participant_count !== 1 ? "s" : ""}
          </p>
          <p class="meta">
            Pick window: ${formatDate(comp.pick_window_start)} — ${formatDate(comp.pick_window_end)}
          </p>
        </div>
      `;
		})
		.join("");

	// Add click handlers
	document.querySelectorAll(".competition-card").forEach((card) => {
		card.addEventListener("click", () => {
			showCompetition(card.dataset.slug);
		});
	});
}

// Render competition detail
async function renderCompetitionDetail(slug) {
	const comp = await API.getCompetition(slug);

	if (comp.error) {
		competitionDetail.innerHTML = `<p class="error">${comp.error}</p>`;
		return;
	}

	const status = getStatus(comp);
	const shareUrl = `${window.location.origin}/#${comp.slug}`;

	// Determine which buttons to show
	let actionButtons = "";
	if (comp.is_backfill && !comp.is_finalized) {
		// Past competition mode: show Add Participant and Lock buttons
		actionButtons = `
			<button id="join-btn" class="btn btn-primary">+ Add Participant</button>
			<button id="finalize-btn" class="btn btn-secondary">Lock Competition</button>
		`;
	} else if (comp.is_backfill && comp.is_finalized) {
		// Locked past competition: show Unlock button
		actionButtons = `
			<button id="unfinalize-btn" class="btn btn-secondary">Unlock for Edits</button>
		`;
	} else if (comp.can_join) {
		// Regular competition that's open
		actionButtons =
			'<button id="join-btn" class="btn btn-primary">Join Competition</button>';
	}

	// Show baseline date info for past competitions
	const baselineInfo = comp.is_backfill
		? `<p class="backfill-info">Prices from: ${formatDateOnly(comp.pick_window_start)}</p>`
		: "";

	competitionDetail.innerHTML = `
    <div class="competition-detail-header">
      <h2>${escapeHtml(comp.name)}</h2>
      <span class="status-badge ${status.class}">${status.text}</span>
      ${
				comp.is_backfill
					? baselineInfo
					: `<p class="window-info">Pick window: ${formatDate(comp.pick_window_start)} — ${formatDate(comp.pick_window_end)}</p>`
			}
      <div class="share-url">
        <label>Share this competition:</label>
        <input type="text" readonly value="${shareUrl}" id="share-url-input" onclick="this.select()">
        <button id="copy-url-btn" class="btn btn-small btn-secondary">Copy</button>
      </div>
      <div class="action-buttons">
        ${actionButtons}
      </div>
    </div>

    <div class="participants-section">
      <h3>Leaderboard</h3>
      ${renderParticipantsTable(comp.participants, comp.can_join)}
    </div>

    <div id="audit-log-container"></div>
  `;

	// Fetch and render audit log
	API.getAuditLog(slug).then((auditData) => {
		const container = document.getElementById("audit-log-container");
		if (container && !auditData.error) {
			container.innerHTML = renderAuditLogSection(
				auditData.entries,
				auditData.total,
				auditData.has_more,
				slug,
			);
			attachAuditLogHandlers(slug);
		}
	});

	// Add event handlers
	const joinBtn = document.getElementById("join-btn");
	if (joinBtn) {
		joinBtn.addEventListener("click", () => showJoinModal());
	}

	const copyBtn = document.getElementById("copy-url-btn");
	if (copyBtn) {
		copyBtn.addEventListener("click", () => {
			const input = document.getElementById("share-url-input");
			input.select();
			navigator.clipboard.writeText(input.value);
			copyBtn.textContent = "Copied!";
			setTimeout(() => {
				copyBtn.textContent = "Copy";
			}, 2000);
		});
	}

	// Finalize button
	const finalizeBtn = document.getElementById("finalize-btn");
	if (finalizeBtn) {
		finalizeBtn.addEventListener("click", async () => {
			if (
				!confirm(
					"Lock this competition? It will appear on the homepage and no more changes can be made.",
				)
			) {
				return;
			}
			const result = await API.finalizeCompetition(slug);
			if (result.error) {
				alert(result.error);
				return;
			}
			renderCompetitionDetail(slug);
		});
	}

	// Unfinalize button
	const unfinalizeBtn = document.getElementById("unfinalize-btn");
	if (unfinalizeBtn) {
		unfinalizeBtn.addEventListener("click", async () => {
			const result = await API.unfinalizeCompetition(slug);
			if (result.error) {
				alert(result.error);
				return;
			}
			renderCompetitionDetail(slug);
		});
	}

	// Edit buttons
	document.querySelectorAll(".edit-pick-btn").forEach((btn) => {
		btn.addEventListener("click", (e) => {
			e.stopPropagation();
			const portfolio = JSON.parse(btn.dataset.portfolio || "[]");
			showEditModal(btn.dataset.id, portfolio);
		});
	});
}

function renderParticipantsTable(participants, canEdit) {
	if (participants.length === 0) {
		return '<p class="empty-state">No participants yet. Be the first to join!</p>';
	}

	return `
    <table class="participants-table">
      <thead>
        <tr>
          <th>#</th>
          <th>Name</th>
          <th>Portfolio</th>
          <th>Change</th>
          ${canEdit ? "<th></th>" : ""}
        </tr>
      </thead>
      <tbody>
        ${participants
					.map(
						(p, i) => `
          <tr class="${i === 0 && p.percent_change !== null ? "rank-1" : ""}">
            <td><span class="rank-cell">${i + 1}</span></td>
            <td>${escapeHtml(p.name)}</td>
            <td>${renderPortfolioTickers(p.portfolio || [{ ticker: p.ticker, shares: 1 }])}</td>
            <td class="${p.percent_change >= 0 ? "gain" : "loss"}">
              ${formatPercent(p.percent_change)}
            </td>
            ${
							canEdit
								? `<td><button class="btn btn-small btn-secondary edit-pick-btn" data-id="${p.id}" data-portfolio='${JSON.stringify((p.portfolio || []).map((s) => ({ ticker: s.ticker, shares: s.shares })))}'>Edit</button></td>`
								: ""
						}
          </tr>
        `,
					)
					.join("")}
      </tbody>
    </table>
  `;
}

// Render portfolio tickers with shares and expand/collapse for many stocks
function renderPortfolioTickers(portfolio) {
	if (!portfolio || portfolio.length === 0) return "—";

	const maxShow = 3;

	if (portfolio.length <= maxShow) {
		return `<div class="portfolio-tickers-display">
			${portfolio.map((s) => `<span class="ticker-symbol">${escapeHtml(s.ticker)}<span class="shares-badge">x${formatShares(s.shares)}</span></span>`).join("")}
		</div>`;
	}

	const visible = portfolio.slice(0, maxShow);
	const hidden = portfolio.slice(maxShow);

	return `<div class="portfolio-tickers-display">
		${visible.map((s) => `<span class="ticker-symbol">${escapeHtml(s.ticker)}<span class="shares-badge">x${formatShares(s.shares)}</span></span>`).join("")}
		<button class="portfolio-expand-btn" title="${hidden.map((s) => `${s.ticker} x${formatShares(s.shares)}`).join(", ")}">+${hidden.length} more</button>
	</div>`;
}

// Format shares for display (e.g., 2.5 or 10)
function formatShares(shares) {
	if (shares === null || shares === undefined) return "?";
	const num = parseFloat(shares);
	if (Number.isNaN(num)) return "?";
	// Show decimal only if needed
	return num % 1 === 0 ? num.toString() : num.toFixed(2);
}

// Navigation
function showHome() {
	currentCompetitionSlug = null;
	window.location.hash = "";
	homeSection.classList.remove("hidden");
	competitionSection.classList.add("hidden");
	renderCompetitions();
}

function showCompetition(slug) {
	currentCompetitionSlug = slug;
	window.location.hash = slug;
	homeSection.classList.add("hidden");
	competitionSection.classList.remove("hidden");
	renderCompetitionDetail(slug);
}

// Handle URL hash changes (browser back/forward, direct links)
function handleHashChange() {
	const hash = window.location.hash.slice(1); // Remove the # prefix
	if (hash) {
		currentCompetitionSlug = hash;
		homeSection.classList.add("hidden");
		competitionSection.classList.remove("hidden");
		renderCompetitionDetail(hash);
	} else {
		showHome();
	}
}

window.addEventListener("hashchange", handleHashChange);

// Modal handlers
function showCreateModal() {
	// Set default dates
	const now = new Date();
	const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
	const nextWeek = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

	document.getElementById("pick-start").value = formatDateForInput(tomorrow);
	document.getElementById("pick-end").value = formatDateForInput(nextWeek);

	// Reset backfill mode
	const backfillCheckbox = document.getElementById("backfill-mode");
	backfillCheckbox.checked = false;
	document.getElementById("backfill-options").classList.add("hidden");
	document.getElementById("regular-dates").classList.remove("hidden");

	createModal.classList.remove("hidden");
}

function hideCreateModal() {
	createModal.classList.add("hidden");
	document.getElementById("create-form").reset();
}

function showJoinModal() {
	// Reset to single ticker input with shares
	const container = document.getElementById("portfolio-tickers");
	container.innerHTML = `
		<div class="ticker-row">
			<input type="text" class="ticker-input" placeholder="AAPL" maxlength="10">
			<input type="number" class="shares-input" placeholder="Shares" min="0.01" step="0.01">
			<button type="button" class="btn btn-small btn-remove-ticker" disabled>×</button>
		</div>
	`;
	updateRemoveButtons(container);
	updateBudgetDisplay("portfolio-tickers", "budget-used", "budget-status");
	joinModal.classList.remove("hidden");
}

function hideJoinModal() {
	joinModal.classList.add("hidden");
	document.getElementById("join-form").reset();
	priceCache.clear();
}

function showEditModal(participantId, portfolioStocks) {
	document.getElementById("edit-participant-id").value = participantId;

	// portfolioStocks can be array of objects with ticker and shares, or just tickers
	const container = document.getElementById("edit-portfolio-tickers");
	const stocks = Array.isArray(portfolioStocks) ? portfolioStocks : [];

	container.innerHTML = stocks
		.map((stock) => {
			const ticker = typeof stock === "string" ? stock : stock.ticker;
			const shares = typeof stock === "object" ? stock.shares : "";
			return `
		<div class="ticker-row">
			<input type="text" class="ticker-input" value="${escapeHtml(ticker)}" placeholder="AAPL" maxlength="10">
			<input type="number" class="shares-input" value="${shares || ""}" placeholder="Shares" min="0.01" step="0.01">
			<button type="button" class="btn btn-small btn-remove-ticker">×</button>
		</div>
	`;
		})
		.join("");

	updateRemoveButtons(container);
	updateBudgetDisplay(
		"edit-portfolio-tickers",
		"edit-budget-used",
		"edit-budget-status",
	);
	editModal.classList.remove("hidden");
}

function hideEditModal() {
	editModal.classList.add("hidden");
	document.getElementById("edit-form").reset();
}

// Portfolio ticker management helpers
function addTickerRow(container) {
	const rows = container.querySelectorAll(".ticker-row");
	if (rows.length >= 10) {
		alert("Maximum 10 stocks per portfolio");
		return;
	}

	const newRow = document.createElement("div");
	newRow.className = "ticker-row";
	newRow.innerHTML = `
		<input type="text" class="ticker-input" placeholder="AAPL" maxlength="10">
		<input type="number" class="shares-input" placeholder="Shares" min="0.01" step="0.01">
		<button type="button" class="btn btn-small btn-remove-ticker">×</button>
	`;
	container.appendChild(newRow);
	updateRemoveButtons(container);
	newRow.querySelector(".ticker-input").focus();

	// Determine which budget display to update based on container id
	if (container.id === "portfolio-tickers") {
		updateBudgetDisplay("portfolio-tickers", "budget-used", "budget-status");
	} else {
		updateBudgetDisplay(
			"edit-portfolio-tickers",
			"edit-budget-used",
			"edit-budget-status",
		);
	}
}

function removeTickerRow(button) {
	const container = button.closest(".portfolio-tickers");
	const rows = container.querySelectorAll(".ticker-row");
	if (rows.length <= 1) return; // Keep at least one

	button.closest(".ticker-row").remove();
	updateRemoveButtons(container);
}

function updateRemoveButtons(container) {
	const rows = container.querySelectorAll(".ticker-row");
	const buttons = container.querySelectorAll(".btn-remove-ticker");

	buttons.forEach((btn) => {
		btn.disabled = rows.length <= 1;
	});
}

function getTickersFromContainer(container) {
	const inputs = container.querySelectorAll(".ticker-input");
	const tickers = [];
	for (const input of inputs) {
		const value = input.value.trim().toUpperCase();
		if (value) {
			tickers.push(value);
		}
	}
	return tickers;
}

// Get portfolio data (tickers with shares) from container
function getPortfolioFromContainer(container) {
	const rows = container.querySelectorAll(".ticker-row");
	const portfolio = [];
	for (const row of rows) {
		const tickerInput = row.querySelector(".ticker-input");
		const sharesInput = row.querySelector(".shares-input");
		const ticker = tickerInput?.value.trim().toUpperCase();
		const shares = parseFloat(sharesInput?.value) || 0;
		if (ticker) {
			portfolio.push({ ticker, shares });
		}
	}
	return portfolio;
}

// Update budget display based on current inputs
async function updateBudgetDisplay(containerId, budgetUsedId, budgetStatusId) {
	const container = document.getElementById(containerId);
	const budgetUsedEl = document.getElementById(budgetUsedId);
	const budgetStatusEl = document.getElementById(budgetStatusId);

	if (!container || !budgetUsedEl || !budgetStatusEl) return;

	const portfolio = getPortfolioFromContainer(container);
	let totalUsed = 0;
	let hasUnpricedStocks = false;

	for (const item of portfolio) {
		if (!item.ticker || !item.shares) continue;

		let price = priceCache.get(item.ticker);
		if (price === undefined) {
			// Mark as loading
			hasUnpricedStocks = true;
			// Fetch price asynchronously
			price = await API.getStockPrice(item.ticker);
			if (price !== null) {
				priceCache.set(item.ticker, price);
			} else {
				priceCache.set(item.ticker, null);
			}
		}

		if (price !== null && price !== undefined) {
			totalUsed += item.shares * price;
		} else if (item.shares > 0) {
			hasUnpricedStocks = true;
		}
	}

	budgetUsedEl.textContent = `$${totalUsed.toFixed(2)}`;

	if (hasUnpricedStocks && totalUsed === 0) {
		budgetStatusEl.textContent = "";
		budgetStatusEl.className = "budget-status";
	} else if (totalUsed > VIRTUAL_BUDGET) {
		budgetStatusEl.textContent = "Over budget!";
		budgetStatusEl.className = "budget-status over-budget";
	} else if (totalUsed > VIRTUAL_BUDGET * 0.95) {
		budgetStatusEl.textContent = "Almost full";
		budgetStatusEl.className = "budget-status at-budget";
	} else if (totalUsed > 0) {
		const remaining = VIRTUAL_BUDGET - totalUsed;
		budgetStatusEl.textContent = `$${remaining.toFixed(0)} left`;
		budgetStatusEl.className = "budget-status under-budget";
	} else {
		budgetStatusEl.textContent = "";
		budgetStatusEl.className = "budget-status";
	}
}

// Debounce helper
function debounce(fn, delay) {
	let timeout;
	return function (...args) {
		clearTimeout(timeout);
		timeout = setTimeout(() => fn.apply(this, args), delay);
	};
}

// Debounced budget update
const debouncedBudgetUpdate = debounce(
	(containerId, budgetUsedId, statusId) => {
		updateBudgetDisplay(containerId, budgetUsedId, statusId);
	},
	500,
);

// Helper to format date for datetime-local input (must be in local time)
function formatDateForInput(date) {
	const year = date.getFullYear();
	const month = String(date.getMonth() + 1).padStart(2, "0");
	const day = String(date.getDate()).padStart(2, "0");
	const hours = String(date.getHours()).padStart(2, "0");
	const minutes = String(date.getMinutes()).padStart(2, "0");
	return `${year}-${month}-${day}T${hours}:${minutes}`;
}

// Escape HTML to prevent XSS
function escapeHtml(text) {
	const div = document.createElement("div");
	div.textContent = text;
	return div.innerHTML;
}

// Format audit event for display
function formatAuditEvent(entry) {
	const time = formatDate(entry.created_at);
	let details;
	try {
		details = entry.details ? JSON.parse(entry.details) : null;
	} catch {
		details = null;
	}

	switch (entry.action) {
		case "unlock":
			return `<span class="audit-action audit-unlock">Unlocked for editing</span> <span class="audit-time">${time}</span>`;
		case "lock":
			return `<span class="audit-action audit-lock">Competition locked</span> <span class="audit-time">${time}</span>`;
		case "participant_joined": {
			// Support both old single ticker and new array format
			const tickers =
				details?.tickers || (details?.ticker ? [details.ticker] : ["?"]);
			const tickersHtml = tickers
				.map((t) => `<span class="ticker-symbol">${escapeHtml(t)}</span>`)
				.join(" ");
			return `<span class="audit-actor">${escapeHtml(entry.actor_name || "Someone")}</span> joined with ${tickersHtml} <span class="audit-time">${time}</span>`;
		}
		case "pick_changed":
			return `<span class="audit-actor">${escapeHtml(entry.actor_name || "Someone")}</span> <span class="audit-action audit-pick-changed">changed pick</span> from <span class="ticker-symbol">${escapeHtml(details?.old_ticker || "?")}</span> to <span class="ticker-symbol">${escapeHtml(details?.new_ticker || "?")}</span> <span class="audit-time">${time}</span>`;
		case "portfolio_updated": {
			const added = details?.added || [];
			const removed = details?.removed || [];
			const changes = [];
			if (added.length > 0) {
				changes.push(
					`+${added.map((t) => `<span class="ticker-symbol">${escapeHtml(t)}</span>`).join(" +")}`,
				);
			}
			if (removed.length > 0) {
				changes.push(
					`-${removed.map((t) => `<span class="ticker-symbol">${escapeHtml(t)}</span>`).join(" -")}`,
				);
			}
			return `<span class="audit-actor">${escapeHtml(entry.actor_name || "Someone")}</span> <span class="audit-action audit-pick-changed">updated portfolio</span>: ${changes.join(" ")} <span class="audit-time">${time}</span>`;
		}
		default:
			return `Unknown action: ${entry.action} <span class="audit-time">${time}</span>`;
	}
}

// Render audit log section
function renderAuditLogSection(entries, total, hasMore, slug) {
	if (total === 0) {
		return `
			<details class="audit-log-section">
				<summary class="audit-log-toggle">Activity History</summary>
				<div class="audit-log-content">
					<p class="audit-empty">No activity recorded yet.</p>
				</div>
			</details>
		`;
	}

	const entriesHtml = entries
		.map((entry) => `<li class="audit-entry">${formatAuditEvent(entry)}</li>`)
		.join("");

	return `
		<details class="audit-log-section">
			<summary class="audit-log-toggle">Activity History <span class="audit-count">${total}</span></summary>
			<div class="audit-log-content">
				<ul class="audit-log-list">${entriesHtml}</ul>
				${hasMore ? `<button class="btn btn-small btn-secondary audit-load-more" data-slug="${slug}" data-offset="${entries.length}">Load more</button>` : ""}
			</div>
		</details>
	`;
}

// Attach event handlers for audit log load more
function attachAuditLogHandlers(slug) {
	const loadMoreBtn = document.querySelector(".audit-load-more");
	if (loadMoreBtn) {
		loadMoreBtn.addEventListener("click", async () => {
			const offset = parseInt(loadMoreBtn.dataset.offset, 10);
			loadMoreBtn.textContent = "Loading...";
			loadMoreBtn.disabled = true;

			const auditData = await API.getAuditLog(slug, 20, offset);
			if (auditData.error) {
				loadMoreBtn.textContent = "Load more";
				loadMoreBtn.disabled = false;
				return;
			}

			const list = document.querySelector(".audit-log-list");
			const newEntriesHtml = auditData.entries
				.map(
					(entry) => `<li class="audit-entry">${formatAuditEvent(entry)}</li>`,
				)
				.join("");
			list.insertAdjacentHTML("beforeend", newEntriesHtml);

			if (auditData.has_more) {
				loadMoreBtn.dataset.offset = offset + auditData.entries.length;
				loadMoreBtn.textContent = "Load more";
				loadMoreBtn.disabled = false;
			} else {
				loadMoreBtn.remove();
			}
		});
	}
}

// Event Listeners
document
	.getElementById("new-competition-btn")
	.addEventListener("click", showCreateModal);
document.getElementById("back-btn").addEventListener("click", showHome);
document
	.getElementById("cancel-create")
	.addEventListener("click", hideCreateModal);
document.getElementById("cancel-join").addEventListener("click", hideJoinModal);
document.getElementById("cancel-edit").addEventListener("click", hideEditModal);

// Close modals on backdrop click
[createModal, joinModal, editModal].forEach((modal) => {
	modal.addEventListener("click", (e) => {
		if (e.target === modal) {
			modal.classList.add("hidden");
		}
	});
});

// Backfill mode toggle
document.getElementById("backfill-mode").addEventListener("change", (e) => {
	const backfillOptions = document.getElementById("backfill-options");
	const regularDates = document.getElementById("regular-dates");

	if (e.target.checked) {
		backfillOptions.classList.remove("hidden");
		regularDates.classList.add("hidden");
	} else {
		backfillOptions.classList.add("hidden");
		regularDates.classList.remove("hidden");
	}
});

// Form submissions
document.getElementById("create-form").addEventListener("submit", async (e) => {
	e.preventDefault();

	const isBackfill = document.getElementById("backfill-mode").checked;
	let data;

	if (isBackfill) {
		// Past competition: use the single date as both start and end (pick window already closed)
		const backfillDate = document.getElementById("backfill-start").value;
		if (!backfillDate) {
			alert("Please select the date when the competition started");
			return;
		}
		// Store as UTC midnight on the selected date
		// backfillDate is "YYYY-MM-DD", append Z to make it UTC
		const startDateUTC = `${backfillDate}T00:00:00.000Z`;
		const endDateUTC = `${backfillDate}T00:00:01.000Z`;

		data = {
			name: document.getElementById("comp-name").value,
			pick_window_start: startDateUTC,
			pick_window_end: endDateUTC,
			backfill_mode: true,
		};
	} else {
		// Regular mode
		const pickStart = document.getElementById("pick-start").value;
		const pickEnd = document.getElementById("pick-end").value;
		if (!pickStart || !pickEnd) {
			alert("Please select pick window dates");
			return;
		}
		data = {
			name: document.getElementById("comp-name").value,
			pick_window_start: new Date(pickStart).toISOString(),
			pick_window_end: new Date(pickEnd).toISOString(),
		};
	}

	const result = await API.createCompetition(data);

	if (result.error) {
		alert(result.error);
		return;
	}

	hideCreateModal();
	showCompetition(result.slug);
});

document.getElementById("join-form").addEventListener("submit", async (e) => {
	e.preventDefault();

	const container = document.getElementById("portfolio-tickers");
	const portfolio = getPortfolioFromContainer(container);

	if (portfolio.length === 0) {
		alert("Please enter at least one stock ticker");
		return;
	}

	// Validate that all stocks have shares
	const missingShares = portfolio.some((p) => !p.shares || p.shares <= 0);
	if (missingShares) {
		alert("Please enter the number of shares for each stock");
		return;
	}

	const data = {
		name: document.getElementById("participant-name").value,
		portfolio: portfolio,
	};

	const result = await API.joinCompetition(currentCompetitionSlug, data);

	if (result.error) {
		alert(result.error);
		return;
	}

	hideJoinModal();
	renderCompetitionDetail(currentCompetitionSlug);
});

document.getElementById("edit-form").addEventListener("submit", async (e) => {
	e.preventDefault();

	const participantId = document.getElementById("edit-participant-id").value;
	const container = document.getElementById("edit-portfolio-tickers");
	const portfolio = getPortfolioFromContainer(container);

	if (portfolio.length === 0) {
		alert("Portfolio must contain at least one stock");
		return;
	}

	// Validate that all stocks have shares
	const missingShares = portfolio.some((p) => !p.shares || p.shares <= 0);
	if (missingShares) {
		alert("Please enter the number of shares for each stock");
		return;
	}

	const result = await API.updateParticipant(participantId, { portfolio });

	if (result.error) {
		alert(result.error);
		return;
	}

	hideEditModal();
	renderCompetitionDetail(currentCompetitionSlug);
});

// Initial render - check URL hash first
handleHashChange();

// Portfolio ticker add/remove button handlers
document.getElementById("add-ticker-btn").addEventListener("click", () => {
	addTickerRow(document.getElementById("portfolio-tickers"));
});

document.getElementById("edit-add-ticker-btn").addEventListener("click", () => {
	addTickerRow(document.getElementById("edit-portfolio-tickers"));
});

// Event delegation for remove ticker buttons
document.addEventListener("click", (e) => {
	if (e.target.classList.contains("btn-remove-ticker") && !e.target.disabled) {
		removeTickerRow(e.target);
	}
});

// Event delegation for budget tracking on input changes
document.addEventListener("input", (e) => {
	if (
		e.target.classList.contains("ticker-input") ||
		e.target.classList.contains("shares-input")
	) {
		const container = e.target.closest(".portfolio-tickers");
		if (container) {
			if (container.id === "portfolio-tickers") {
				debouncedBudgetUpdate(
					"portfolio-tickers",
					"budget-used",
					"budget-status",
				);
			} else if (container.id === "edit-portfolio-tickers") {
				debouncedBudgetUpdate(
					"edit-portfolio-tickers",
					"edit-budget-used",
					"edit-budget-status",
				);
			}
		}
	}
});
