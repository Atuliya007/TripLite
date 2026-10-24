
"use strict";

/* ==========================================
   TRIPLITE — COMPLETE APP.JS
   Storage: LocalStorage
========================================== */

const $ = (selector, parent = document) =>
  parent.querySelector(selector);

const $$ = (selector, parent = document) =>
  [...parent.querySelectorAll(selector)];

const STORAGE_KEYS = {
  trips: "triplite-trips",
  packing: "triplite-packing",
  expenses: "triplite-expenses"
};

function loadData(key) {
  try {
    const value = JSON.parse(localStorage.getItem(key));
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

function saveData(key, data) {
  localStorage.setItem(key, JSON.stringify(data));
}

let trips = loadData(STORAGE_KEYS.trips);
let packingItems = loadData(STORAGE_KEYS.packing);
let expenses = loadData(STORAGE_KEYS.expenses);
let toastTimer;

/* ==========================================
   HELPERS
========================================== */

function createId() {
  return globalThis.crypto?.randomUUID?.()
    || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[char]);
}

function money(amount) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2
  }).format(Number(amount) || 0);
}

function formatDate(dateString) {
  if (!dateString) return "Date not set";

  const date = new Date(`${dateString}T00:00:00`);

  if (Number.isNaN(date.getTime())) return dateString;

  return date.toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric"
  });
}

function showToast(message) {
  const toast = $("#toast");
  if (!toast) return;

  toast.textContent = message;
  toast.classList.add("show");

  clearTimeout(toastTimer);

  toastTimer = setTimeout(() => {
    toast.classList.remove("show");
  }, 2600);
}

/* ==========================================
   NAVIGATION
========================================== */

const views = {
  dashboard: $("#dashboard-view"),
  trips: $("#all-trips-view"),
  checklist: $("#checklist-section"),
  expenses: $("#expenses-section")
};

const pageTitles = {
  dashboard: "Travel Dashboard",
  trips: "My Trips",
  checklist: "Packing Checklist",
  expenses: "Travel Expenses"
};

function showView(viewName) {
  if (!views[viewName]) {
    viewName = "dashboard";
  }

  Object.entries(views).forEach(([name, element]) => {
    if (element) {
      element.hidden = name !== viewName;
    }
  });

  $$(".nav-link").forEach(button => {
    const active = button.dataset.view === viewName;

    button.classList.toggle("active", active);

    if (active) {
      button.setAttribute("aria-current", "page");
    } else {
      button.removeAttribute("aria-current");
    }
  });

  const title = $("#page-title");
  if (title) {
    title.textContent = pageTitles[viewName];
  }

  // CREATE TRIP BUTTON VISIBILITY
  const createTripButton = $("#add-trip-btn");

  if (createTripButton) {
    createTripButton.hidden =
      viewName === "checklist" ||
      viewName === "expenses";
  }

  if (viewName === "dashboard") renderDashboard();
  if (viewName === "trips") renderAllTrips();
  if (viewName === "checklist") renderPacking();
  if (viewName === "expenses") renderExpenses();

  window.scrollTo({ top: 0, behavior: "smooth" });
}

$$("[data-view]").forEach(button => {
  button.addEventListener("click", event => {
    event.preventDefault();
    showView(button.dataset.view);
  });
});

$("#view-all-trips")?.addEventListener("click", () => {
  showView("trips");
});

/* ==========================================
   CREATE TRIP DIALOG
========================================== */

const tripDialog = $("#trip-dialog");
const tripForm = $("#trip-form");

function openTripDialog() {
  if (!tripDialog) return;

  $("#form-error").textContent = "";

  if (typeof tripDialog.showModal === "function") {
    tripDialog.showModal();
  } else {
    tripDialog.setAttribute("open", "");
  }
}

function closeTripDialog() {
  if (!tripDialog) return;

  if (typeof tripDialog.close === "function" && tripDialog.open) {
    tripDialog.close();
  } else {
    tripDialog.removeAttribute("open");
  }
}

$("#add-trip-btn")?.addEventListener("click", openTripDialog);
$("#banner-create-btn")?.addEventListener("click", openTripDialog);
$("#close-dialog")?.addEventListener("click", closeTripDialog);

tripDialog?.addEventListener("click", event => {
  if (event.target === tripDialog) closeTripDialog();
});

tripForm?.addEventListener("submit", event => {
  event.preventDefault();

  const data = new FormData(tripForm);

  const name = String(data.get("name") || "").trim();
  const destination = String(data.get("destination") || "").trim();
  const startDate = String(data.get("startDate") || "");
  const endDate = String(data.get("endDate") || "");
  const travellers = Number(data.get("travellers"));
  const budget = Number(data.get("budget"));

  const error = $("#form-error");

  if (!name || !destination || !startDate || !endDate) {
    error.textContent = "Please fill in all required fields.";
    return;
  }

  if (endDate < startDate) {
    error.textContent = "End date cannot be before start date.";
    return;
  }

  if (!Number.isFinite(travellers) || travellers < 1) {
    error.textContent = "Enter a valid number of travellers.";
    return;
  }

  if (!Number.isFinite(budget) || budget < 0) {
    error.textContent = "Enter a valid budget.";
    return;
  }

  trips.unshift({
    id: createId(),
    name,
    destination,
    startDate,
    endDate,
    travellers,
    budget,
    createdAt: new Date().toISOString()
  });

  saveData(STORAGE_KEYS.trips, trips);

  tripForm.reset();

  tripForm.elements.namedItem("travellers").value = "1";
  tripForm.elements.namedItem("budget").value = "10000";

  closeTripDialog();

  renderDashboard();
  renderAllTrips();
  updateExpenseTripOptions();

  showView("dashboard");
  showToast("Trip created successfully!");
});

/* ==========================================
   TRIP CARDS
========================================== */

function tripCardHTML(trip) {
  const spent = expenses
    .filter(expense => expense.tripId === trip.id)
    .reduce((sum, expense) => sum + Number(expense.amount || 0), 0);

  return `
    <article class="trip-card">
      <div class="trip-card-content">
        <span class="trip-destination">
          ${escapeHTML(trip.destination)}
        </span>

        <h3>${escapeHTML(trip.name)}</h3>

        <p class="muted">
          ${escapeHTML(formatDate(trip.startDate))}
          – ${escapeHTML(formatDate(trip.endDate))}
        </p>

        <p>${escapeHTML(trip.travellers)} traveller(s)</p>

        <div class="trip-card-footer">
          <span>Budget: <strong>${money(trip.budget)}</strong></span>
          <span>Spent: <strong>${money(spent)}</strong></span>
        </div>

        <button
          type="button"
          class="text-btn delete-trip-btn"
          data-trip-id="${escapeHTML(trip.id)}"
        >Delete trip</button>
      </div>
    </article>
  `;
}

function renderTripContainer(container, items, message) {
  if (!container) return;

  if (!items.length) {
    container.innerHTML = `
      <div class="empty-state">
        <span>🧳</span>
        <h3>No trips yet</h3>
        <p>${escapeHTML(message)}</p>
      </div>
    `;
    return;
  }

  container.innerHTML = items.map(tripCardHTML).join("");
}

function renderAllTrips() {
  renderTripContainer(
    $("#all-trips-container"),
    trips,
    "Create a trip to start planning your next adventure."
  );
}

function renderRecentTrips() {
  renderTripContainer(
    $("#trips-container"),
    trips.slice(0, 3),
    "Create your first trip to see it here."
  );
}

document.addEventListener("click", event => {
  const button = event.target.closest(".delete-trip-btn");
  if (!button) return;

  const tripId = button.dataset.tripId;
  const trip = trips.find(item => item.id === tripId);

  if (!trip) return;

  if (!confirm(`Delete "${trip.name}"?`)) return;

  trips = trips.filter(item => item.id !== tripId);

  expenses = expenses.map(expense =>
    expense.tripId === tripId
      ? { ...expense, tripId: "" }
      : expense
  );

  saveData(STORAGE_KEYS.trips, trips);
  saveData(STORAGE_KEYS.expenses, expenses);

  renderDashboard();
  renderAllTrips();
  renderExpenses();
  updateExpenseTripOptions();

  showToast("Trip deleted.");
});

/* ==========================================
   PACKING CHECKLIST
========================================== */

const packingForm = $("#packing-form");
const packingList = $("#packing-list");

packingForm?.addEventListener("submit", event => {
  event.preventDefault();

  const input = $("#packing-item-input", packingForm);
  const name = String(input?.value || "").trim();

  if (!name) {
    showToast("Pehle item ka naam enter karo.");
    input?.focus();
    return;
  }

  packingItems.unshift({
    id: createId(),
    name,
    packed: false
  });

  saveData(STORAGE_KEYS.packing, packingItems);

  input.value = "";

  renderPacking();
  renderDashboard();

  input.focus();
  showToast("Packing item added!");
});

function renderPacking() {
  if (!packingList) return;

  const total = packingItems.length;
  const packed = packingItems.filter(item => item.packed).length;
  const percent = total ? Math.round(packed / total * 100) : 0;

  const summary = $("#packing-summary");
  if (summary) {
    summary.textContent = `${packed} of ${total} packed`;
  }

  const progressBar = $("#packing-progress-bar");
  if (progressBar) {
    progressBar.style.width = `${percent}%`;
  }

  const progressTrack = $(".packing-progress-track");
  if (progressTrack) {
    progressTrack.setAttribute("aria-valuenow", String(percent));
  }

  const empty = $("#packing-empty");
  if (empty) empty.hidden = total > 0;

  packingList.innerHTML = packingItems.map(item => `
    <li class="packing-item ${item.packed ? "is-packed" : ""}">
      <label class="packing-item-label">
        <input
          type="checkbox"
          class="packing-toggle"
          data-item-id="${escapeHTML(item.id)}"
          ${item.packed ? "checked" : ""}
        >
        <span>${escapeHTML(item.name)}</span>
      </label>

      <button
        type="button"
        class="text-btn delete-packing-btn"
        data-item-id="${escapeHTML(item.id)}"
      >Delete</button>
    </li>
  `).join("");
}

packingList?.addEventListener("change", event => {
  const checkbox = event.target.closest(".packing-toggle");
  if (!checkbox) return;

  const item = packingItems.find(
    entry => entry.id === checkbox.dataset.itemId
  );

  if (!item) return;

  item.packed = checkbox.checked;

  saveData(STORAGE_KEYS.packing, packingItems);

  renderPacking();
  renderDashboard();
});

packingList?.addEventListener("click", event => {
  const button = event.target.closest(".delete-packing-btn");
  if (!button) return;

  packingItems = packingItems.filter(
    item => item.id !== button.dataset.itemId
  );

  saveData(STORAGE_KEYS.packing, packingItems);

  renderPacking();
  renderDashboard();

  showToast("Packing item deleted.");
});

/* ==========================================
   EXPENSES
========================================== */

const expenseForm = $("#expense-form");

function updateExpenseTripOptions() {
  const select = $("#expense-trip");
  if (!select) return;

  const previousValue = select.value;

  select.innerHTML = `
    <option value="">General expense</option>
    ${trips.map(trip => `
      <option value="${escapeHTML(trip.id)}">
        ${escapeHTML(trip.name)} — ${escapeHTML(trip.destination)}
      </option>
    `).join("")}
  `;

  if (trips.some(trip => trip.id === previousValue)) {
    select.value = previousValue;
  }
}

expenseForm?.addEventListener("submit", event => {
  event.preventDefault();

  const data = new FormData(expenseForm);

  const description = String(data.get("description") || "").trim();
  const amount = Number(data.get("amount"));
  const category = String(data.get("category") || "Other");
  const tripId = String(data.get("tripId") || "");

  if (!description) {
    showToast("Expense description enter karo.");
    return;
  }

  if (!Number.isFinite(amount) || amount <= 0) {
    showToast("Valid expense amount enter karo.");
    return;
  }

  expenses.unshift({
    id: createId(),
    description,
    amount,
    category,
    tripId,
    date: new Date().toISOString()
  });

  saveData(STORAGE_KEYS.expenses, expenses);

  expenseForm.reset();
  updateExpenseTripOptions();

  renderExpenses();
  renderDashboard();

  showToast("Expense added successfully!");
});

function renderExpenses() {
  const list = $("#expenses-list");
  const empty = $("#expenses-empty");

  const total = expenses.reduce(
    (sum, expense) => sum + Number(expense.amount || 0),
    0
  );

  const totalElement = $("#expense-total");
  const countElement = $("#expense-count");

  if (totalElement) totalElement.textContent = money(total);
  if (countElement) countElement.textContent = String(expenses.length);

  if (!list) return;

  if (empty) empty.hidden = expenses.length > 0;

  list.innerHTML = expenses.map(expense => {
    const trip = trips.find(item => item.id === expense.tripId);

    return `
      <article class="expense-row">
        <div class="expense-details">
          <strong>${escapeHTML(expense.description)}</strong>
          <p class="muted">
            ${escapeHTML(expense.category)}
            · ${escapeHTML(formatDate(expense.date?.slice(0, 10)))}
          </p>
          <small class="muted">
            ${trip
              ? `Trip: ${escapeHTML(trip.name)}`
              : "General expense"}
          </small>
        </div>

        <strong class="expense-amount">${money(expense.amount)}</strong>

        <button
          type="button"
          class="text-btn delete-expense-btn"
          data-expense-id="${escapeHTML(expense.id)}"
        >Delete</button>
      </article>
    `;
  }).join("");
}

$("#expenses-list")?.addEventListener("click", event => {
  const button = event.target.closest(".delete-expense-btn");
  if (!button) return;

  expenses = expenses.filter(
    expense => expense.id !== button.dataset.expenseId
  );

  saveData(STORAGE_KEYS.expenses, expenses);

  renderExpenses();
  renderDashboard();

  showToast("Expense deleted.");
});

/* ==========================================
   DASHBOARD STATISTICS
========================================== */

function renderDashboard() {
  const totalBudget = trips.reduce(
    (sum, trip) => sum + Number(trip.budget || 0),
    0
  );

  const totalSpent = expenses.reduce(
    (sum, expense) => sum + Number(expense.amount || 0),
    0
  );

  const totalPacking = packingItems.length;
  const packedCount = packingItems.filter(item => item.packed).length;

  const packingPercent = totalPacking
    ? Math.round(packedCount / totalPacking * 100)
    : 0;

  if ($("#stat-trips")) {
    $("#stat-trips").textContent = String(trips.length);
  }

  if ($("#stat-budget")) {
    $("#stat-budget").textContent = money(totalBudget);
  }

  if ($("#stat-spent")) {
    $("#stat-spent").textContent = money(totalSpent);
  }

  if ($("#stat-packing")) {
    $("#stat-packing").textContent = `${packingPercent}%`;
  }

  const dashboardProgress = $("#stat-packing")
    ?.closest(".stat-card")
    ?.querySelector("#packing-progress");

  if (dashboardProgress) {
    dashboardProgress.style.width = `${packingPercent}%`;
  }

  renderRecentTrips();
  updateExpenseTripOptions();
}

/* ==========================================
   INITIALIZE
========================================== */

function initializeApp() {
  renderDashboard();
  renderAllTrips();
  renderPacking();
  renderExpenses();
  updateExpenseTripOptions();
  showView("dashboard");
}

initializeApp();
