// ABOUTME: Frontend JavaScript for stock-picker-madness
// ABOUTME: Handles UI interactions, API calls, and URL-based navigation

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

// Format date for display
function formatDate(isoString) {
	return new Date(isoString).toLocaleDateString("en-US", {
		month: "short",
		day: "numeric",
		year: "numeric",
		hour: "numeric",
		minute: "2-digit",
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
		? `<p class="backfill-info">Prices from: ${formatDate(comp.pick_window_start)}</p>`
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
			showEditModal(btn.dataset.id, btn.dataset.ticker);
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
          <th>Ticker</th>
          <th>Baseline</th>
          <th>Current</th>
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
            <td><span class="ticker-symbol">${escapeHtml(p.ticker)}</span></td>
            <td>${p.baseline_price ? `$${p.baseline_price.toFixed(2)}` : "—"}</td>
            <td>${p.current_price ? `$${p.current_price.toFixed(2)}` : "—"}</td>
            <td class="${p.percent_change >= 0 ? "gain" : "loss"}">
              ${formatPercent(p.percent_change)}
            </td>
            ${
							canEdit
								? `<td><button class="btn btn-small btn-secondary edit-pick-btn" data-id="${p.id}" data-ticker="${p.ticker}">Edit</button></td>`
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
	joinModal.classList.remove("hidden");
}

function hideJoinModal() {
	joinModal.classList.add("hidden");
	document.getElementById("join-form").reset();
}

function showEditModal(participantId, currentTicker) {
	document.getElementById("edit-participant-id").value = participantId;
	document.getElementById("edit-ticker").value = currentTicker;
	editModal.classList.remove("hidden");
}

function hideEditModal() {
	editModal.classList.add("hidden");
	document.getElementById("edit-form").reset();
}

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
		case "participant_joined":
			return `<span class="audit-actor">${escapeHtml(entry.actor_name || "Someone")}</span> joined with <span class="ticker-symbol">${escapeHtml(details?.ticker || "?")}</span> <span class="audit-time">${time}</span>`;
		case "pick_changed":
			return `<span class="audit-actor">${escapeHtml(entry.actor_name || "Someone")}</span> <span class="audit-action audit-pick-changed">changed pick</span> from <span class="ticker-symbol">${escapeHtml(details?.old_ticker || "?")}</span> to <span class="ticker-symbol">${escapeHtml(details?.new_ticker || "?")}</span> <span class="audit-time">${time}</span>`;
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
		// Set start to beginning of that day in local time, end to 1 second later (so pick window is closed)
		// Parse as local time by appending T00:00:00 (without Z suffix)
		const startDate = new Date(`${backfillDate}T00:00:00`);
		const endDate = new Date(startDate.getTime() + 1000);

		data = {
			name: document.getElementById("comp-name").value,
			pick_window_start: startDate.toISOString(),
			pick_window_end: endDate.toISOString(),
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

	const data = {
		name: document.getElementById("participant-name").value,
		ticker: document.getElementById("ticker").value.toUpperCase(),
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
	const ticker = document.getElementById("edit-ticker").value.toUpperCase();

	const result = await API.updateParticipant(participantId, { ticker });

	if (result.error) {
		alert(result.error);
		return;
	}

	hideEditModal();
	renderCompetitionDetail(currentCompetitionSlug);
});

// Initial render - check URL hash first
handleHashChange();
