
"use strict";

/* ==========================================
   TRIPLITE — COMPLETE APP.JS
   Trips: MongoDB
   Packing + Expenses: LocalStorage
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
let expenseFilter = "all";
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

  // Handle date-only strings without timezone shifting.
  const datePart = String(dateString).slice(0, 10);
  const parts = datePart.split("-").map(Number);

  if (parts.length !== 3 || parts.some(Number.isNaN)) {
    return dateString;
  }

  const date = new Date(parts[0], parts[1] - 1, parts[2]);

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
   MONGODB API HELPERS
========================================== */

async function apiRequest(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options.headers
    }
  });

  let result;

  try {
    result = await response.json();
  } catch {
    throw new Error("Server returned an invalid response.");
  }

  if (!response.ok || result.success !== true) {
    throw new Error(
      result.message || `Request failed (${response.status})`
    );
  }

  return result;
}

// Convert MongoDB's _id into the id used by existing UI code.
function normalizeTrip(trip) {
  const id = trip._id || trip.id;

  return {
    ...trip,
    id: String(id),
    startDate: String(trip.startDate).slice(0, 10),
    endDate: String(trip.endDate).slice(0, 10),
    travellers: Number(trip.travellers),
    budget: Number(trip.budget)
  };
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
let editingTripId = null;

function setTripDialogMode(isEditing) {
  const heading = $(".dialog-heading h2");
  const submitButton = tripForm?.querySelector('button[type="submit"]');

  if (heading) {
    heading.textContent = isEditing ? "Edit your trip" : "Create your trip";
  }
  if (submitButton) {
    submitButton.textContent = isEditing ? "Save changes" : "Save trip";
  }
}

function resetTripDialogState() {
  editingTripId = null;
  tripForm?.reset();
  if (tripForm) {
    tripForm.elements.namedItem("travellers").value = "1";
    tripForm.elements.namedItem("budget").value = "10000";
  }
  setTripDialogMode(false);

  const error = $("#form-error");
  if (error) error.textContent = "";
}

function openTripDialog(destination = "") {
  if (!tripDialog) return;

  resetTripDialogState();
  if (typeof destination === "string" && destination && tripForm) {
    tripForm.elements.namedItem("destination").value = destination;
  }

  if (typeof tripDialog.showModal === "function") {
    tripDialog.showModal();
  } else {
    tripDialog.setAttribute("open", "");
  }
}

function setDestinationCardFlipped(card, flipped) {
  card.classList.toggle("is-flipped", flipped);
  card.querySelector(".destination-front").inert = flipped;
  card.querySelector(".destination-back").inert = !flipped;
  card.querySelectorAll(".destination-flip").forEach(button => {
    button.setAttribute("aria-pressed", String(flipped));
  });
}

$$(".destination-card").forEach(card => {
  card.querySelector(".destination-back").inert = true;
  card.addEventListener("pointerenter", event => {
    if (event.pointerType === "mouse") setDestinationCardFlipped(card, true);
  });
  card.addEventListener("pointerleave", event => {
    if (event.pointerType === "mouse" && !card.contains(document.activeElement)) {
      setDestinationCardFlipped(card, false);
    }
  });
  card.addEventListener("click", event => {
    const planButton = event.target.closest(".plan-trip-btn");
    if (planButton) {
      openTripDialog(planButton.dataset.destination || "");
      return;
    }

    if (event.target.closest(".destination-flip")) {
      setDestinationCardFlipped(card, !card.classList.contains("is-flipped"));
      return;
    }

    if (!event.target.closest("button")) {
      setDestinationCardFlipped(card, !card.classList.contains("is-flipped"));
    }
  });

  card.addEventListener("keydown", event => {
    if (event.target !== card || (event.key !== "Enter" && event.key !== " ")) return;
    event.preventDefault();
    setDestinationCardFlipped(card, !card.classList.contains("is-flipped"));
  });
});

function openEditTripDialog(trip) {
  if (!tripDialog || !tripForm) return;

  editingTripId = trip.id;
  tripForm.elements.namedItem("name").value = trip.name;
  tripForm.elements.namedItem("destination").value = trip.destination;
  tripForm.elements.namedItem("startDate").value = trip.startDate;
  tripForm.elements.namedItem("endDate").value = trip.endDate;
  tripForm.elements.namedItem("travellers").value = String(trip.travellers);
  tripForm.elements.namedItem("budget").value = String(trip.budget);
  setTripDialogMode(true);

  const error = $("#form-error");
  if (error) error.textContent = "";

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

  resetTripDialogState();
}

$("#add-trip-btn")?.addEventListener("click", () => openTripDialog());
$("#banner-create-btn")?.addEventListener("click", () => openTripDialog());
$("#close-dialog")?.addEventListener("click", closeTripDialog);

tripDialog?.addEventListener("click", event => {
  if (event.target !== tripDialog) return;

  const bounds = tripDialog.getBoundingClientRect();
  const clickedOutside =
    event.clientX < bounds.left ||
    event.clientX > bounds.right ||
    event.clientY < bounds.top ||
    event.clientY > bounds.bottom;

  if (clickedOutside) closeTripDialog();
});
tripDialog?.addEventListener("close", resetTripDialogState);

/* ==========================================
   CREATE AND EDIT TRIPS — MONGODB
========================================== */

tripForm?.addEventListener("submit", async event => {
  event.preventDefault();

  const data = new FormData(tripForm);

  const name = String(data.get("name") || "").trim();
  const destination = String(data.get("destination") || "").trim();
  const startDate = String(data.get("startDate") || "");
  const endDate = String(data.get("endDate") || "");
  const travellers = Number(data.get("travellers"));
  const budget = Number(data.get("budget"));
  const tripId = editingTripId;

  const error = $("#form-error");
  if (error) error.textContent = "";

  if (!name || !destination || !startDate || !endDate) {
    if (error) {
      error.textContent = "Please fill in all required fields.";
    }
    return;
  }

  if (endDate < startDate) {
    if (error) {
      error.textContent = "End date cannot be before start date.";
    }
    return;
  }

  if (!Number.isInteger(travellers) || travellers < 1 || travellers > 50) {
    if (error) {
      error.textContent = "Enter between 1 and 50 travellers.";
    }
    return;
  }

  if (!Number.isFinite(budget) || budget < 0) {
    if (error) {
      error.textContent = "Enter a valid budget.";
    }
    return;
  }

  const submitButton = tripForm.querySelector(
    'button[type="submit"]'
  );

  if (submitButton) submitButton.disabled = true;

  try {
    const result = await apiRequest(
      tripId
        ? `/api/trips/${encodeURIComponent(tripId)}`
        : "/api/trips",
      {
        method: tripId ? "PUT" : "POST",
        body: JSON.stringify({
          name,
          destination,
          startDate,
          endDate,
          travellers,
          budget
        })
      }
    );

    const savedTrip = normalizeTrip(result.data);
    if (tripId) {
      const index = trips.findIndex(trip => trip.id === tripId);
      if (index !== -1) trips[index] = savedTrip;
    } else {
      trips.unshift(savedTrip);
    }
    tripForm.reset();

    tripForm.elements.namedItem("travellers").value = "1";
    tripForm.elements.namedItem("budget").value = "10000";

    closeTripDialog();

    renderDashboard();
    renderAllTrips();
    updateExpenseTripOptions();

    if (tripId) {
      renderExpenses();
      showToast("Trip updated successfully!");
    } else {
      showView("dashboard");
      showToast("Trip saved to MongoDB!");
    }
  } catch (error) {
    console.error(
      tripId ? "Update trip failed:" : "Create trip failed:",
      error
    );
    const formError = $("#form-error");
    if (formError) {
      formError.textContent =
        error.message ||
        `Could not ${tripId ? "update" : "save"} trip. Please try again.`;
    }
  } finally {
    if (submitButton) submitButton.disabled = false;
  }
});

/* ==========================================
   TRIP CARDS
========================================== */

function tripCardHTML(trip) {
  const spent = expenses
    .filter(expense => getExpenseTripId(expense) === trip.id)
    .reduce((sum, expense) => sum + expenseAmount(expense), 0);
  const remainingBudget = Number(trip.budget) - spent;
  const overBudget = spent > Number(trip.budget);
  const budgetStatus = overBudget
    ? `Over budget by ${money(Math.abs(remainingBudget))}`
    : `Remaining: ${money(remainingBudget)}`;

  return `
    <article class="trip-card">
      <div class="trip-card-content">
        <span class="trip-destination">
          ${escapeHTML(trip.destination)}
        </span>

        <div class="trip-card-title">
          <h3>${escapeHTML(trip.name)}</h3>
          ${overBudget ? '<span class="budget-alert-dot" role="img" aria-label="Over budget" title="Over budget"></span>' : ""}
        </div>

        <p class="muted">
          ${escapeHTML(formatDate(trip.startDate))}
          – ${escapeHTML(formatDate(trip.endDate))}
        </p>

        <p>${escapeHTML(trip.travellers)} traveller(s)</p>

        <div class="trip-card-footer">
          <span>Budget: <strong>${money(trip.budget)}</strong></span>
          <span>Spent: <strong>${money(spent)}</strong></span>
        </div>
        <p class="trip-budget-status${overBudget ? " is-over-budget" : ""}">
          ${escapeHTML(budgetStatus)}
        </p>

        <div class="trip-card-actions">
          <button
            type="button"
            class="text-btn edit-trip-btn"
            data-trip-id="${escapeHTML(trip.id)}"
          >Edit</button>
          <button
            type="button"
            class="text-btn delete-trip-btn"
            data-trip-id="${escapeHTML(trip.id)}"
          >Delete trip</button>
        </div>
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

/* ==========================================
   DELETE TRIP — DELETE FROM MONGODB
========================================== */

document.addEventListener("click", async event => {
  const editButton = event.target.closest(".edit-trip-btn");
  if (editButton) {
    const trip = trips.find(item => item.id === editButton.dataset.tripId);
    if (trip) openEditTripDialog(trip);
    return;
  }

  const button = event.target.closest(".delete-trip-btn");
  if (!button) return;

  const tripId = button.dataset.tripId;
  const trip = trips.find(item => item.id === tripId);

  if (!trip) return;

  if (!confirm(`Delete "${trip.name}"?`)) return;

  button.disabled = true;

  try {
    await apiRequest(
      `/api/trips/${encodeURIComponent(tripId)}`,
      { method: "DELETE" }
    );

    trips = trips.filter(item => item.id !== tripId);

    // Keep expenses, but unlink them from the deleted trip.
    expenses = expenses.map(expense =>
      expense.tripId === tripId
        ? { ...expense, tripId: "" }
        : expense
    );

    saveData(STORAGE_KEYS.expenses, expenses);

    renderDashboard();
    renderAllTrips();
    renderExpenses();
    updateExpenseTripOptions();

    showToast("Trip deleted from MongoDB!");
  } catch (error) {
    console.error("Delete trip failed:", error);
    showToast(error.message || "Could not delete trip.");
    button.disabled = false;
  }
});

/* ==========================================
   PACKING CHECKLIST — LOCALSTORAGE
========================================== */

const packingForm = $("#packing-form");
const packingList = $("#packing-list");

const PACKING_CATEGORIES = [
  {
    name: "Identity and Documents",
    items: [
      "Aadhaar card or valid government ID",
      "Driving licence (when needed)",
      "Passport (for international travel)",
      "Visa and entry permits (when required)",
      "Tickets and booking confirmations",
      "Travel insurance details",
      "Emergency contact information"
    ]
  },
  {
    name: "Money and Essentials",
    items: ["Wallet and cash", "Debit/credit cards", "UPI/payment access", "Emergency cash"]
  },
  {
    name: "Electronics",
    items: [
      "Phone and charger",
      "Power bank",
      "Earphones",
      "Camera accessories (if needed)",
      "Travel adapter (if needed)"
    ]
  },
  {
    name: "Clothing and Personal Care",
    items: [
      "Clothes and extra outfit",
      "Underwear and socks",
      "Weather-appropriate clothing",
      "Comfortable shoes",
      "Toothbrush and toiletries",
      "Sunscreen and sunglasses"
    ]
  },
  {
    name: "Health and Safety",
    items: [
      "Personal medicines",
      "Basic first-aid supplies",
      "Prescriptions (when needed)",
      "Hand sanitizer",
      "Water bottle",
      "Emergency contacts saved offline"
    ]
  },
  {
    name: "Before Leaving Home",
    items: [
      "Check weather and transport status",
      "Confirm accommodation and tickets",
      "Charge devices",
      "Download offline maps and tickets",
      "Lock doors and windows",
      "Switch off unnecessary appliances"
    ]
  }
];

const normalizePackingName = name => String(name || "").trim().toLocaleLowerCase();

$("#use-standard-checklist")?.addEventListener("click", () => {
  const existingNames = new Set(packingItems.map(item => normalizePackingName(item.name)));
  let added = 0;

  PACKING_CATEGORIES.forEach(category => {
    category.items.forEach(name => {
      const normalizedName = normalizePackingName(name);
      if (existingNames.has(normalizedName)) return;

      packingItems.push({
        id: createId(),
        name,
        packed: false,
        category: category.name
      });
      existingNames.add(normalizedName);
      added += 1;
    });
  });

  if (added) {
    saveData(STORAGE_KEYS.packing, packingItems);
    renderPacking();
    renderDashboard();
    showToast(`${added} standard items added.`);
  } else {
    showToast("Standard checklist items are already in your list.");
  }
});

$("#reset-packed-items")?.addEventListener("click", () => {
  const completed = packingItems.filter(item => item.packed);
  if (!completed.length) {
    showToast("There are no completed items to reset.");
    return;
  }

  if (!confirm(`Uncheck ${completed.length} completed checklist item${completed.length === 1 ? "" : "s"}?`)) return;

  packingItems.forEach(item => {
    item.packed = false;
  });
  saveData(STORAGE_KEYS.packing, packingItems);
  renderPacking();
  renderDashboard();
  showToast("Completed items reset.");
});

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
    summary.textContent = `${packed} of ${total} packed · ${total - packed} remaining`;
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

  const renderItem = item => `
      <li class="packing-item ${item.packed ? "is-packed" : ""}">
        <label class="packing-item-label">
          <input type="checkbox" class="packing-toggle" data-item-id="${escapeHTML(item.id)}" ${item.packed ? "checked" : ""}>
          <span>${escapeHTML(item.name)}</span>
        </label>
        <button type="button" class="text-btn delete-packing-btn" data-item-id="${escapeHTML(item.id)}">Delete</button>
      </li>`;

  const categorized = new Set(PACKING_CATEGORIES.map(category => category.name));
  const sections = PACKING_CATEGORIES.map(category => ({
    name: category.name,
    items: packingItems.filter(item => item.category === category.name)
  })).filter(section => section.items.length);
  const customItems = packingItems.filter(item => !categorized.has(item.category));
  if (customItems.length) sections.push({ name: "My items", items: customItems });

  packingList.innerHTML = sections.map(section => `
    <li class="packing-category-heading" role="presentation"><h3>${escapeHTML(section.name)}</h3></li>
    ${section.items.map(renderItem).join("")}
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
   EXPENSES — LOCALSTORAGE
========================================== */

const expenseForm = $("#expense-form");

function updateExpenseTripOptions() {
  const select = $("#expense-trip");
  if (!select) return;

  const previousValue = select.value;

  select.innerHTML = `
    <option value="">Unassigned expense</option>
    ${trips.map(trip => `
      <option value="${escapeHTML(trip.id)}">
        ${escapeHTML(trip.name)} — ${escapeHTML(trip.destination)}
      </option>
    `).join("")}
  `;

  if (trips.some(trip => trip.id === previousValue)) {
    select.value = previousValue;
  } else {
    select.value = "";
  }
}

function updateExpenseFilterOptions() {
  const select = $("#expense-filter");
  if (!select) return;

  const previousValue = expenseFilter;
  select.innerHTML = `
    <option value="all">All expenses</option>
    <option value="unassigned">Unassigned expenses</option>
    ${trips.map(trip => `
      <option value="${escapeHTML(trip.id)}">
        ${escapeHTML(trip.name)} â€” ${escapeHTML(trip.destination)}
      </option>
    `).join("")}
  `;

  expenseFilter = previousValue === "all" || previousValue === "unassigned" ||
    trips.some(trip => trip.id === previousValue)
    ? previousValue
    : "all";
  select.value = expenseFilter;
}

function getExpenseTripId(expense) {
  return typeof expense?.tripId === "string" &&
    trips.some(trip => trip.id === expense.tripId)
    ? expense.tripId
    : "";
}

function expenseAmount(expense) {
  const amount = Number(expense?.amount);
  return Number.isFinite(amount) && amount > 0 ? amount : 0;
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

  if (tripId && !trips.some(trip => trip.id === tripId)) {
    showToast("That trip is no longer available. Choose another trip.");
    updateExpenseTripOptions();
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
  updateExpenseFilterOptions();

  const list = $("#expenses-list");
  const empty = $("#expenses-empty");

  const globalTotal = expenses.reduce(
    (sum, expense) => sum + expenseAmount(expense),
    0
  );
  const globalSummary = $("#expense-global-summary");
  if (globalSummary) {
    globalSummary.textContent =
      `All expenses: ${money(globalTotal)} across ${expenses.length} ` +
      `${expenses.length === 1 ? "transaction" : "transactions"}.`;
  }

  const visibleExpenses = expenses.filter(expense => {
    if (expenseFilter === "all") return true;
    const tripId = getExpenseTripId(expense);
    if (expenseFilter === "unassigned") return !tripId;
    return tripId === expenseFilter;
  });
  const filteredTotal = visibleExpenses.reduce(
    (sum, expense) => sum + expenseAmount(expense),
    0
  );

  const totalElement = $("#expense-total");
  const countElement = $("#expense-count");

  if (totalElement) totalElement.textContent = money(filteredTotal);
  if (countElement) countElement.textContent = String(visibleExpenses.length);

  if (!list) return;

  if (empty) {
    empty.hidden = visibleExpenses.length > 0;
    empty.textContent = expenses.length
      ? "No expenses match this filter."
      : "No expenses recorded yet.";
  }

  list.innerHTML = visibleExpenses.map(expense => {
    const tripId = getExpenseTripId(expense);
    const trip = trips.find(item => item.id === tripId);
    const expenseId = String(expense?.id ?? "");

    return `
      <article class="expense-row">
        <div class="expense-details">
          <strong>${escapeHTML(expense?.description || "Untitled expense")}</strong>
          <p class="muted">
            ${escapeHTML(expense?.category || "Other")}
            · ${escapeHTML(formatDate(String(expense?.date || "").slice(0, 10)))}
          </p>
          <small class="muted">
            ${trip
              ? `Trip: ${escapeHTML(trip.name)}`
              : "Unassigned expense"}
          </small>
        </div>

        <strong class="expense-amount">${money(expenseAmount(expense))}</strong>

        ${expenseId ? `
          <button
            type="button"
            class="text-btn delete-expense-btn"
            data-expense-id="${escapeHTML(expenseId)}"
          >Delete</button>
        ` : ""}
      </article>
    `;
  }).join("");
}

$("#expense-filter")?.addEventListener("change", event => {
  expenseFilter = event.target.value;
  renderExpenses();
});

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
    (sum, expense) => sum + expenseAmount(expense),
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

async function initializeApp() {
  // Display saved data while the database request is in progress.
  renderDashboard();
  renderAllTrips();
  renderPacking();
  renderExpenses();
  updateExpenseTripOptions();
  showView("dashboard");

  try {
    const result = await apiRequest("/api/trips");

    trips = result.data.map(normalizeTrip);

    renderDashboard();
    renderAllTrips();
    updateExpenseTripOptions();

    console.log("Trips loaded from MongoDB:", trips.length);
  } catch (error) {
    console.error("Could not load MongoDB trips:", error);
    showToast("Database unavailable. Showing saved local data.");
  }
}

initializeApp();
