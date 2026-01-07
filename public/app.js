// ABOUTME: Frontend JavaScript for stock-picker-madness
// ABOUTME: Handles UI interactions, API calls, and page navigation

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

  async getCompetition(id) {
    const res = await fetch(`/api/competitions/${id}`);
    return res.json();
  },

  async joinCompetition(competitionId, data) {
    const res = await fetch(`/api/competitions/${competitionId}/join`, {
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

  async refreshPrices(competitionId) {
    const res = await fetch(`/api/competitions/${competitionId}/refresh-prices`, {
      method: "POST",
    });
    return res.json();
  },
};

// State
let currentCompetitionId = null;

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
    competitionsList.innerHTML = '<p class="empty-state">No competitions yet. Create one to get started!</p>';
    return;
  }

  competitionsList.innerHTML = competitions
    .map((comp) => {
      const status = getStatus(comp);
      return `
        <div class="competition-card" data-id="${comp.id}">
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
      showCompetition(card.dataset.id);
    });
  });
}

// Render competition detail
async function renderCompetitionDetail(id) {
  const comp = await API.getCompetition(id);

  if (comp.error) {
    competitionDetail.innerHTML = `<p class="error">${comp.error}</p>`;
    return;
  }

  const status = getStatus(comp);

  competitionDetail.innerHTML = `
    <div class="competition-detail-header">
      <h2>${escapeHtml(comp.name)}</h2>
      <span class="status-badge ${status.class}">${status.text}</span>
      <p class="window-info">
        Pick window: ${formatDate(comp.pick_window_start)} — ${formatDate(comp.pick_window_end)}
      </p>
      <div class="action-buttons">
        ${comp.is_pick_window_open ? '<button id="join-btn" class="btn btn-primary">Join Competition</button>' : ""}
        <button id="refresh-btn" class="btn btn-success">Refresh Prices</button>
      </div>
    </div>

    <div class="participants-section">
      <h3>Leaderboard</h3>
      ${renderParticipantsTable(comp.participants, comp.is_pick_window_open)}
    </div>
  `;

  // Add event handlers
  const joinBtn = document.getElementById("join-btn");
  if (joinBtn) {
    joinBtn.addEventListener("click", () => showJoinModal());
  }

  const refreshBtn = document.getElementById("refresh-btn");
  if (refreshBtn) {
    refreshBtn.addEventListener("click", async () => {
      refreshBtn.textContent = "Refreshing...";
      refreshBtn.disabled = true;
      await API.refreshPrices(id);
      await renderCompetitionDetail(id);
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
            <td>${i + 1}</td>
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
        `
          )
          .join("")}
      </tbody>
    </table>
  `;
}

// Navigation
function showHome() {
  currentCompetitionId = null;
  homeSection.classList.remove("hidden");
  competitionSection.classList.add("hidden");
  renderCompetitions();
}

function showCompetition(id) {
  currentCompetitionId = id;
  homeSection.classList.add("hidden");
  competitionSection.classList.remove("hidden");
  renderCompetitionDetail(id);
}

// Modal handlers
function showCreateModal() {
  // Set default dates
  const now = new Date();
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const nextWeek = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

  document.getElementById("pick-start").value = formatDateForInput(tomorrow);
  document.getElementById("pick-end").value = formatDateForInput(nextWeek);

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

// Helper to format date for datetime-local input
function formatDateForInput(date) {
  return date.toISOString().slice(0, 16);
}

// Escape HTML to prevent XSS
function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

// Event Listeners
document.getElementById("new-competition-btn").addEventListener("click", showCreateModal);
document.getElementById("back-btn").addEventListener("click", showHome);
document.getElementById("cancel-create").addEventListener("click", hideCreateModal);
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

// Form submissions
document.getElementById("create-form").addEventListener("submit", async (e) => {
  e.preventDefault();

  const data = {
    name: document.getElementById("comp-name").value,
    pick_window_start: new Date(document.getElementById("pick-start").value).toISOString(),
    pick_window_end: new Date(document.getElementById("pick-end").value).toISOString(),
  };

  const result = await API.createCompetition(data);

  if (result.error) {
    alert(result.error);
    return;
  }

  hideCreateModal();
  showCompetition(result.id);
});

document.getElementById("join-form").addEventListener("submit", async (e) => {
  e.preventDefault();

  const data = {
    name: document.getElementById("participant-name").value,
    ticker: document.getElementById("ticker").value.toUpperCase(),
  };

  const result = await API.joinCompetition(currentCompetitionId, data);

  if (result.error) {
    alert(result.error);
    return;
  }

  hideJoinModal();
  renderCompetitionDetail(currentCompetitionId);
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
  renderCompetitionDetail(currentCompetitionId);
});

// Initial render
renderCompetitions();
