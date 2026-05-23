const apiBaseUrl = window.APP_CONFIG?.apiBaseUrl || "/api";
let token = localStorage.getItem("ledgerlyToken");
let currentUser = null;

const state = {
  authMode: "login",
  page: "dashboard",
};

const elements = {
  authView: document.querySelector("#authView"),
  authLanding: document.querySelector("#authLanding"),
  authPanel: document.querySelector("#authPanel"),
  authOpenButtons: document.querySelectorAll("[data-auth-open]"),
  authBackButton: document.querySelector("#authBackButton"),
  authTitle: document.querySelector("#authTitle"),
  authSubmitButton: document.querySelector("#authSubmitButton"),
  appView: document.querySelector("#appView"),
  authForm: document.querySelector("#authForm"),
  authMessage: document.querySelector("#authMessage"),
  nameField: document.querySelector("#nameField"),
  navItems: document.querySelectorAll(".nav-item"),
  pages: document.querySelectorAll(".page"),
  pageEyebrow: document.querySelector("#pageEyebrow"),
  pageTitle: document.querySelector("#pageTitle"),
  form: document.querySelector("#transactionForm"),
  profileForm: document.querySelector("#profileForm"),
  profileMessage: document.querySelector("#profileMessage"),
  rows: document.querySelector("#transactionRows"),
  totalIncome: document.querySelector("#totalIncome"),
  totalExpense: document.querySelector("#totalExpense"),
  netBalance: document.querySelector("#netBalance"),
  recordCount: document.querySelector("#recordCount"),
  categoryList: document.querySelector("#categoryList"),
  apiStatus: document.querySelector("#apiStatus"),
  apiLatency: document.querySelector("#apiLatency"),
  appVersion: document.querySelector("#appVersion"),
  sidebarName: document.querySelector("#sidebarName"),
  sidebarEmail: document.querySelector("#sidebarEmail"),
  profileInitials: document.querySelector("#profileInitials"),
  profileAvatar: document.querySelector("#profileAvatar"),
  profileHeading: document.querySelector("#profileHeading"),
  profileSubheading: document.querySelector("#profileSubheading"),
  snapshotBudget: document.querySelector("#snapshotBudget"),
  snapshotGoal: document.querySelector("#snapshotGoal"),
  snapshotCurrency: document.querySelector("#snapshotCurrency"),
  snapshotCategory: document.querySelector("#snapshotCategory"),
  refreshButton: document.querySelector("#refreshButton"),
  logoutButton: document.querySelector("#logoutButton"),
  emptyTemplate: document.querySelector("#emptyStateTemplate"),
};

function currencyFormatter(currency = currentUser?.currency || "USD") {
  return new Intl.NumberFormat("en-US", { style: "currency", currency });
}

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function initials(name = "User") {
  return name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

async function request(path, options = {}) {
  const headers = {
    "Content-Type": "application/json",
    ...options.headers,
  };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(`${apiBaseUrl}${path}`, { ...options, headers });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: "Request failed" }));
    throw new Error(error.message || "Request failed");
  }

  return response.status === 204 ? null : response.json();
}

function showAuthenticated(isAuthenticated) {
  elements.authView.classList.toggle("hidden", isAuthenticated);
  elements.appView.classList.toggle("hidden", !isAuthenticated);
  document.body.classList.toggle("auth-active", !isAuthenticated);
  document.body.classList.toggle("app-active", isAuthenticated);
}

function renderUser(user) {
  currentUser = user;
  const userInitials = initials(user.name);
  const money = currencyFormatter(user.currency);

  elements.sidebarName.textContent = user.name;
  elements.sidebarEmail.textContent = user.email;
  elements.profileInitials.textContent = userInitials;
  elements.profileAvatar.textContent = userInitials;
  elements.profileHeading.textContent = user.name;
  elements.profileSubheading.textContent = user.email;
  elements.snapshotBudget.textContent = money.format(Number(user.monthly_budget || 0));
  elements.snapshotGoal.textContent = money.format(Number(user.savings_goal || 0));
  elements.snapshotCurrency.textContent = user.currency;
  elements.snapshotCategory.textContent = user.preferred_category;

  elements.profileForm.name.value = user.name;
  elements.profileForm.email.value = user.email;
  elements.profileForm.monthly_budget.value = user.monthly_budget;
  elements.profileForm.savings_goal.value = user.savings_goal;
  elements.profileForm.currency.value = user.currency;
  elements.profileForm.preferred_category.value = user.preferred_category;
  elements.profileForm.timezone.value = user.timezone;
  elements.profileForm.weekly_digest.checked = user.weekly_digest;
  elements.profileForm.spend_alerts.checked = user.spend_alerts;
}

function setPage(page) {
  state.page = page;
  const titles = {
    dashboard: ["Personal finance command center", "Overview"],
    insights: ["Category intelligence", "Insights"],
    transactions: ["Ledger activity", "Transactions"],
    profile: ["Account settings", "Profile"],
  };

  elements.pages.forEach((pageElement) => {
    pageElement.classList.toggle("active-page", pageElement.id === `${page}Page`);
  });

  elements.navItems.forEach((item) => {
    item.classList.toggle("active", item.dataset.page === page);
  });

  elements.pageEyebrow.textContent = titles[page][0];
  elements.pageTitle.textContent = titles[page][1];
}

function setAuthMode(mode) {
  state.authMode = mode;
  elements.authLanding.classList.add("hidden");
  elements.authPanel.classList.remove("hidden");
  elements.nameField.classList.toggle("hidden", mode === "login");
  elements.authTitle.textContent = mode === "login" ? "Log in" : "Create account";
  elements.authSubmitButton.textContent = mode === "login" ? "Log in" : "Sign up";
  elements.authMessage.textContent =
    mode === "login"
      ? "Enter your email and password."
      : "Password must contain at least 8 unique characters.";
}

function showAuthLanding() {
  elements.authPanel.classList.add("hidden");
  elements.authLanding.classList.remove("hidden");
  elements.authForm.reset();
  elements.authMessage.textContent = "";
}

function hasEightUniqueCharacters(password) {
  return new Set(String(password)).size >= 8;
}

function renderSummary(summary) {
  const money = currencyFormatter();
  elements.totalIncome.textContent = money.format(summary.totalIncome || 0);
  elements.totalExpense.textContent = money.format(summary.totalExpense || 0);
  elements.netBalance.textContent = money.format(summary.netBalance || 0);
  elements.recordCount.textContent = `${summary.transactionCount || 0} records`;
}

function renderCategories(categories) {
  elements.categoryList.innerHTML = "";

  if (!categories.length) {
    elements.categoryList.innerHTML = '<p class="empty-state">Category insights appear after expenses are added.</p>';
    return;
  }

  const money = currencyFormatter();
  const maxAmount = Math.max(...categories.map((category) => Number(category.total)));

  categories.forEach((category) => {
    const item = document.createElement("div");
    item.className = "category-item";
    const width = Math.max((Number(category.total) / maxAmount) * 100, 4);

    item.innerHTML = `
      <div class="category-meta">
        <strong>${escapeHtml(category.category)}</strong>
        <span>${money.format(Number(category.total))}</span>
      </div>
      <div class="category-bar"><span style="width: ${width}%"></span></div>
    `;
    elements.categoryList.appendChild(item);
  });
}

function renderTransactions(transactions) {
  elements.rows.innerHTML = "";

  if (!transactions.length) {
    elements.rows.appendChild(elements.emptyTemplate.content.cloneNode(true));
    return;
  }

  const money = currencyFormatter();
  transactions.forEach((transaction) => {
    const row = document.createElement("tr");
    const amountClass = transaction.type === "income" ? "amount-income" : "amount-expense";
    const amountPrefix = transaction.type === "income" ? "+" : "-";

    row.innerHTML = `
      <td><strong>${escapeHtml(transaction.description)}</strong></td>
      <td>${escapeHtml(transaction.category)}</td>
      <td><span class="pill ${escapeHtml(transaction.type)}">${escapeHtml(transaction.type)}</span></td>
      <td class="${amountClass}">${amountPrefix}${money.format(Number(transaction.amount))}</td>
      <td>${dateFormatter.format(new Date(transaction.created_at))}</td>
      <td><button class="danger-button" data-id="${transaction.id}" aria-label="Delete transaction">x</button></td>
    `;
    elements.rows.appendChild(row);
  });
}

async function loadDashboard() {
  const started = performance.now();

  try {
    const [health, profile, transactions, summary] = await Promise.all([
      request("/health"),
      request("/profile"),
      request("/transactions"),
      request("/summary"),
    ]);

    renderUser(profile);
    renderSummary(summary);
    renderCategories(summary.categories || []);
    renderTransactions(transactions);

    elements.apiStatus.textContent = "Healthy";
    elements.apiLatency.textContent = `${Math.round(performance.now() - started)} ms response`;
    elements.appVersion.textContent = health.version || "v0.0.0";
  } catch (error) {
    if (error.message.includes("log in")) {
      logout();
      return;
    }
    elements.apiStatus.textContent = "Offline";
    elements.apiLatency.textContent = error.message;
  }
}

function logout() {
  token = null;
  currentUser = null;
  localStorage.removeItem("ledgerlyToken");
  showAuthenticated(false);
}

elements.authOpenButtons.forEach((button) => {
  button.addEventListener("click", () => setAuthMode(button.dataset.authOpen));
});

elements.authBackButton.addEventListener("click", showAuthLanding);

elements.authForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const payload = Object.fromEntries(new FormData(elements.authForm).entries());
  const route = state.authMode === "login" ? "/auth/login" : "/auth/register";

  if (state.authMode === "register" && !hasEightUniqueCharacters(payload.password)) {
    elements.authMessage.textContent = "Use at least 8 unique characters in your password.";
    return;
  }

  try {
    const result = await request(route, { method: "POST", body: JSON.stringify(payload) });
    if (state.authMode === "register") {
      elements.authForm.reset();
      setAuthMode("login");
      elements.authMessage.textContent = "Account created. Log in with your new credentials.";
      return;
    }

    token = result.token;
    localStorage.setItem("ledgerlyToken", token);
    showAuthenticated(true);
    setPage("dashboard");
    await loadDashboard();
  } catch (error) {
    elements.authMessage.textContent = error.message;
  }
});

elements.navItems.forEach((item) => {
  item.addEventListener("click", () => setPage(item.dataset.page));
});

elements.form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const payload = Object.fromEntries(new FormData(elements.form).entries());
  payload.amount = Number(payload.amount);

  await request("/transactions", { method: "POST", body: JSON.stringify(payload) });
  elements.form.reset();
  await loadDashboard();
});

elements.rows.addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-id]");
  if (!button) return;

  await request(`/transactions/${button.dataset.id}`, { method: "DELETE" });
  await loadDashboard();
});

elements.profileForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const payload = Object.fromEntries(new FormData(elements.profileForm).entries());
  payload.monthly_budget = Number(payload.monthly_budget);
  payload.savings_goal = Number(payload.savings_goal);
  payload.weekly_digest = elements.profileForm.weekly_digest.checked;
  payload.spend_alerts = elements.profileForm.spend_alerts.checked;

  const user = await request("/profile", { method: "PUT", body: JSON.stringify(payload) });
  renderUser(user);
  elements.profileMessage.textContent = "Profile saved.";
});

elements.refreshButton.addEventListener("click", loadDashboard);
elements.logoutButton.addEventListener("click", logout);

if (token) {
  showAuthenticated(true);
  loadDashboard();
} else {
  showAuthenticated(false);
  showAuthLanding();
}
