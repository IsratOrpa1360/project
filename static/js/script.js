/**
 * script.js - Vanilla JavaScript Frontend Controller for Personal Expense Tracker
 *
 * Responsibilities:
 * 1. Manage navigation between Dashboard, Add Transaction, Transaction History, Monthly Reports, and Settings.
 * 2. Communicate with the Flask REST API (`/api/...`) using `fetch()`.
 * 3. Format currency consistently based on user settings (default BDT / ৳) without altering stored values.
 * 4. Validate forms client-side, prevent duplicate submissions, and display clear feedback.
 * 5. Render SVG charts and friendly empty states when no records exist.
 */

(function () {
    "use strict";

    // Category definitions matching backend validation
    const CATEGORIES = {
        Income: [
            "Salary",
            "Freelance",
            "Business",
            "Scholarship",
            "Other Income"
        ],
        Expense: [
            "Food",
            "Transportation",
            "Education",
            "Shopping",
            "Bills",
            "Healthcare",
            "Entertainment",
            "Other Expenses"
        ]
    };

    const CHART_COLORS = [
        "#635BDB",
        "#16A36A",
        "#E05252",
        "#D97706",
        "#0284C7",
        "#8B5CF6",
        "#EC4899",
        "#64748B"
    ];

    // Application state
    const state = {
        currency: "BDT",
        currencySymbol: "৳",
        transactions: [],
        pendingDeleteId: null,
        isSubmittingAdd: false,
        isSubmittingEdit: false
    };

    // -------------------------------------------------------------------------
    // Utility Helpers
    // -------------------------------------------------------------------------
    function formatMoney(amount) {
        const num = Number(amount) || 0;
        const absFormatted = Math.abs(num).toLocaleString("en-US", {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
        });
        return num < 0
            ? `-${state.currencySymbol}${absFormatted}`
            : `${state.currencySymbol}${absFormatted}`;
    }

    function escapeHtml(str) {
        const div = document.createElement("div");
        div.textContent = str == null ? "" : String(str);
        return div.innerHTML;
    }

    function getTodayDateString() {
        const now = new Date();
        const year = now.getFullYear();
        const month = String(now.getMonth() + 1).padStart(2, "0");
        const day = String(now.getDate()).padStart(2, "0");
        return `${year}-${month}-${day}`;
    }

    function getCurrentMonthString() {
        return getTodayDateString().slice(0, 7);
    }

    function showToast(message, type = "success") {
        const container = document.getElementById("toast-container");
        if (!container) return;

        const toast = document.createElement("div");
        toast.className = `toast toast-${type}`;
        toast.textContent = message;
        container.appendChild(toast);

        setTimeout(() => {
            if (toast.parentNode) {
                toast.parentNode.removeChild(toast);
            }
        }, 3500);
    }

    function setFormFeedback(elementId, message, type) {
        const el = document.getElementById(elementId);
        if (!el) return;
        if (!message) {
            el.hidden = true;
            el.textContent = "";
            el.className = "form-feedback";
            return;
        }
        el.hidden = false;
        el.textContent = message;
        el.className = `form-feedback ${type}`;
    }

    async function apiRequest(url, options = {}) {
        const fetchOptions = {
            headers: {
                "Content-Type": "application/json",
                ...(options.headers || {})
            },
            ...options
        };

        const response = await fetch(url, fetchOptions);
        let payload = null;
        try {
            payload = await response.json();
        } catch (err) {
            throw new Error("Received an invalid response from the server.");
        }

        if (!response.ok || (payload && payload.success === false)) {
            const errorMsg =
                (payload && payload.error) ||
                `Request failed with status ${response.status}.`;
            throw new Error(errorMsg);
        }

        return payload;
    }

    // -------------------------------------------------------------------------
    // Navigation & View Switching
    // -------------------------------------------------------------------------
    function switchView(targetView) {
        const views = {
            dashboard: document.getElementById("view-dashboard"),
            "add-transaction": document.getElementById("view-add-transaction"),
            history: document.getElementById("view-history"),
            reports: document.getElementById("view-reports"),
            settings: document.getElementById("view-settings")
        };

        Object.entries(views).forEach(([key, section]) => {
            if (section) {
                section.classList.toggle("active", key === targetView);
            }
        });

        document.querySelectorAll(".nav-tab").forEach((btn) => {
            btn.classList.toggle("active", btn.dataset.target === targetView);
        });

        setFormFeedback("add-form-feedback", "", "");

        // Refresh data for the active section
        if (targetView === "dashboard") {
            loadDashboard();
        } else if (targetView === "history") {
            loadTransactions();
        } else if (targetView === "reports") {
            const monthInput = document.getElementById("report-month-input");
            loadMonthlyReport(monthInput ? monthInput.value : "");
        } else if (targetView === "settings") {
            loadSettings();
        }
    }

    // -------------------------------------------------------------------------
    // Category Dropdown Helpers
    // -------------------------------------------------------------------------
    function populateCategorySelect(selectEl, type, selectedValue = "") {
        if (!selectEl) return;
        const list = CATEGORIES[type] || CATEGORIES.Expense;
        selectEl.innerHTML = list
            .map(
                (cat) =>
                    `<option value="${escapeHtml(cat)}" ${
                        cat === selectedValue ? "selected" : ""
                    }>${escapeHtml(cat)}</option>`
            )
            .join("");
    }

    function populateFilterCategorySelect() {
        const filterType = document.getElementById("filter-type").value;
        const filterCategory = document.getElementById("filter-category");
        const previousVal = filterCategory.value;

        let categories = [];
        if (filterType === "Income") {
            categories = CATEGORIES.Income;
        } else if (filterType === "Expense") {
            categories = CATEGORIES.Expense;
        } else {
            categories = [...CATEGORIES.Income, ...CATEGORIES.Expense];
        }

        filterCategory.innerHTML =
            `<option value="">All Categories</option>` +
            categories
                .map(
                    (cat) =>
                        `<option value="${escapeHtml(cat)}">${escapeHtml(cat)}</option>`
                )
                .join("");

        if (categories.includes(previousVal)) {
            filterCategory.value = previousVal;
        }
    }

    // -------------------------------------------------------------------------
    // Section A: Dashboard Loading & Rendering
    // -------------------------------------------------------------------------
    async function loadDashboard() {
        try {
            const res = await apiRequest("/api/dashboard");
            const data = res.data;

            // 1. Update KPI Cards
            document.getElementById("stat-total-balance").textContent = formatMoney(
                data.total_balance
            );
            document.getElementById("stat-total-income").textContent = formatMoney(
                data.total_income
            );
            document.getElementById("stat-total-expense").textContent = formatMoney(
                data.total_expense
            );
            document.getElementById("stat-transaction-count").textContent = String(
                data.transaction_count
            );

            const balanceStatus = document.getElementById("stat-balance-status");
            if (data.total_balance > 0) {
                balanceStatus.textContent = "Positive net balance";
            } else if (data.total_balance < 0) {
                balanceStatus.textContent = "Expenses exceed income";
            } else {
                balanceStatus.textContent = "Net available balance";
            }

            // 2. Income vs Expense Overview
            const inc = data.income_vs_expense.income;
            const exp = data.income_vs_expense.expense;
            const maxVal = Math.max(inc, exp, 1);

            document.getElementById("comp-income-val").textContent = formatMoney(inc);
            document.getElementById("comp-expense-val").textContent = formatMoney(exp);
            document.getElementById("comp-income-bar").style.width = `${
                inc > 0 ? Math.round((inc / maxVal) * 100) : 0
            }%`;
            document.getElementById("comp-expense-bar").style.width = `${
                exp > 0 ? Math.round((exp / maxVal) * 100) : 0
            }%`;

            document.getElementById("comp-net-savings").textContent = formatMoney(
                data.income_vs_expense.net_savings
            );
            document.getElementById("comp-expense-ratio").textContent = `${data.income_vs_expense.expense_ratio}%`;
            document.getElementById("dash-savings-badge").textContent = `${data.income_vs_expense.savings_rate}% Saved`;

            // 3. Monthly Expense Summary
            const ms = data.monthly_summary;
            document.getElementById("dash-monthly-subtitle").textContent = `Summary for ${ms.month}`;
            document.getElementById("dash-month-income").textContent = formatMoney(
                ms.monthly_income
            );
            document.getElementById("dash-month-expense").textContent = formatMoney(
                ms.monthly_expense
            );
            document.getElementById("dash-month-savings").textContent = formatMoney(
                ms.monthly_savings
            );
            document.getElementById("dash-month-largest").textContent = formatMoney(
                ms.largest_expense
            );

            // 4. Expense Category Breakdown
            renderDashboardCategories(data.category_breakdown);

            // 5. Recent Transactions
            renderRecentTransactions(data.recent_transactions);
        } catch (err) {
            showToast(err.message || "Failed to load dashboard statistics.", "error");
        }
    }

    function renderDashboardCategories(categories) {
        const container = document.getElementById("dash-category-list");
        if (!container) return;

        if (!categories || categories.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <p class="empty-title">No expenses recorded yet</p>
                    <p class="empty-desc">Add an expense transaction to see your category breakdown.</p>
                </div>
            `;
            return;
        }

        const itemsHtml = categories
            .map((item, idx) => {
                const color = CHART_COLORS[idx % CHART_COLORS.length];
                return `
                    <div class="category-item">
                        <div class="category-item-header">
                            <div class="category-name-group">
                                <span class="category-dot" style="background-color: ${color}"></span>
                                <span class="category-name">${escapeHtml(item.category)}</span>
                                <span class="category-count">(${item.count})</span>
                            </div>
                            <div class="category-stats">
                                <span class="category-amount">${formatMoney(item.amount)}</span>
                                <span class="category-pct">${item.percentage}%</span>
                            </div>
                        </div>
                        <div class="progress-track">
                            <div class="progress-fill" style="width: ${Math.max(
                                item.percentage,
                                2
                            )}%; background-color: ${color}"></div>
                        </div>
                    </div>
                `;
            })
            .join("");

        container.innerHTML = `<div class="category-list">${itemsHtml}</div>`;
    }

    function renderRecentTransactions(recentList) {
        const container = document.getElementById("dash-recent-list");
        if (!container) return;

        if (!recentList || recentList.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <p class="empty-title">No transactions yet</p>
                    <p class="empty-desc">Click "+ New Entry" to record your first income or expense.</p>
                </div>
            `;
            return;
        }

        const rowsHtml = recentList
            .map((tx) => {
                const isIncome = tx.type === "Income";
                const iconClass = isIncome ? "kpi-icon-income" : "kpi-icon-expense";
                const sign = isIncome ? "+" : "-";
                const amountClass = isIncome ? "text-income" : "text-expense";
                return `
                    <div class="recent-item">
                        <div class="recent-left">
                            <div class="recent-badge-icon ${iconClass}">${isIncome ? "↑" : "↓"}</div>
                            <div class="recent-info">
                                <p class="recent-desc">${escapeHtml(tx.description)}</p>
                                <p class="recent-meta">${escapeHtml(tx.category)} • ${escapeHtml(tx.date)}</p>
                            </div>
                        </div>
                        <span class="recent-amount ${amountClass}">${sign}${formatMoney(tx.amount)}</span>
                    </div>
                `;
            })
            .join("");

        container.innerHTML = `<div class="recent-list">${rowsHtml}</div>`;
    }

    // -------------------------------------------------------------------------
    // Section B: Add Transaction Form Validation & Submission
    // -------------------------------------------------------------------------
    function validateTransactionFormFields({ type, amount, category, description, date }) {
        if (type !== "Income" && type !== "Expense") {
            return "Please select a valid transaction type (Income or Expense).";
        }
        const numAmount = Number(amount);
        if (!amount || Number.isNaN(numAmount) || numAmount <= 0) {
            return "Amount must be a valid number greater than zero.";
        }
        if (numAmount > 999999999.99) {
            return "Amount exceeds the maximum allowed limit.";
        }
        if (!category) {
            return "Please select a category.";
        }
        if (!description || !description.trim()) {
            return "Description is required and cannot be empty.";
        }
        if (description.trim().length > 150) {
            return "Description must be 150 characters or fewer.";
        }
        if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
            return "Please select a valid date.";
        }
        return null;
    }

    async function handleAddTransactionSubmit(event) {
        event.preventDefault();
        if (state.isSubmittingAdd) return;

        setFormFeedback("add-form-feedback", "", "");

        const selectedTypeRadio = document.querySelector(
            'input[name="type"]:checked'
        );
        const payload = {
            type: selectedTypeRadio ? selectedTypeRadio.value : "Expense",
            amount: document.getElementById("add-amount").value,
            category: document.getElementById("add-category").value,
            description: document.getElementById("add-description").value.trim(),
            date: document.getElementById("add-date").value
        };

        const validationError = validateTransactionFormFields(payload);
        if (validationError) {
            setFormFeedback("add-form-feedback", validationError, "error");
            return;
        }

        const submitBtn = document.getElementById("add-submit-btn");
        state.isSubmittingAdd = true;
        submitBtn.disabled = true;
        submitBtn.textContent = "Saving...";

        try {
            await apiRequest("/api/transactions", {
                method: "POST",
                body: JSON.stringify(payload)
            });

            // Reset amount and description while preserving current date & selected type
            document.getElementById("add-amount").value = "";
            document.getElementById("add-description").value = "";

            setFormFeedback(
                "add-form-feedback",
                "Transaction saved to SQLite successfully!",
                "success"
            );
            showToast("Transaction added successfully.", "success");

            // Refresh dashboard data in background so totals are up to date
            await loadDashboard();
        } catch (err) {
            setFormFeedback("add-form-feedback", err.message, "error");
            showToast(err.message, "error");
        } finally {
            state.isSubmittingAdd = false;
            submitBtn.disabled = false;
            submitBtn.textContent = "Save Transaction";
        }
    }

    // -------------------------------------------------------------------------
    // Section C: Transaction History, Combined Filters, Edit & Delete
    // -------------------------------------------------------------------------
    async function loadTransactions() {
        const search = document.getElementById("filter-search").value.trim();
        const type = document.getElementById("filter-type").value;
        const category = document.getElementById("filter-category").value;
        const startDate = document.getElementById("filter-start-date").value;
        const endDate = document.getElementById("filter-end-date").value;

        if (startDate && endDate && startDate > endDate) {
            showToast("From Date cannot be later than To Date.", "error");
            return;
        }

        const params = new URLSearchParams();
        if (search) params.set("search", search);
        if (type) params.set("type", type);
        if (category) params.set("category", category);
        if (startDate) params.set("start_date", startDate);
        if (endDate) params.set("end_date", endDate);

        try {
            const queryString = params.toString() ? `?${params.toString()}` : "";
            const res = await apiRequest(`/api/transactions${queryString}`);
            state.transactions = res.data || [];

            const countBadge = document.getElementById("history-count-badge");
            if (countBadge) {
                countBadge.textContent = `${state.transactions.length} ${
                    state.transactions.length === 1 ? "record" : "records"
                }`;
            }

            renderTransactionTable(state.transactions);
        } catch (err) {
            showToast(err.message || "Failed to load transactions.", "error");
        }
    }

    function renderTransactionTable(transactions) {
        const tbody = document.getElementById("history-table-body");
        if (!tbody) return;

        if (!transactions || transactions.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="6" class="empty-table-cell">
                        No transactions found. Try adjusting your search filters or add a new transaction.
                    </td>
                </tr>
            `;
            return;
        }

        tbody.innerHTML = transactions
            .map((tx) => {
                const isIncome = tx.type === "Income";
                const badgeClass = isIncome ? "badge-income" : "badge-expense";
                const amountClass = isIncome ? "text-income" : "text-expense";
                const sign = isIncome ? "+" : "-";
                return `
                    <tr data-id="${tx.id}">
                        <td class="tx-date-cell">${escapeHtml(tx.date)}</td>
                        <td class="tx-desc-cell">${escapeHtml(tx.description)}</td>
                        <td>${escapeHtml(tx.category)}</td>
                        <td><span class="badge ${badgeClass}">${escapeHtml(tx.type)}</span></td>
                        <td class="text-right tx-amount-cell ${amountClass}">${sign}${formatMoney(
                    tx.amount
                )}</td>
                        <td class="tx-actions-cell">
                            <button type="button" class="btn btn-outline action-btn edit-tx-btn" data-id="${
                                tx.id
                            }">Edit</button>
                            <button type="button" class="btn btn-outline action-btn text-expense delete-tx-btn" data-id="${
                                tx.id
                            }">Delete</button>
                        </td>
                    </tr>
                `;
            })
            .join("");
    }

    function openEditModal(txId) {
        const tx = state.transactions.find((item) => item.id === Number(txId));
        if (!tx) return;

        setFormFeedback("edit-form-feedback", "", "");
        document.getElementById("edit-id").value = String(tx.id);
        document.getElementById("edit-amount").value = Number(tx.amount).toFixed(2);
        document.getElementById("edit-date").value = tx.date;
        document.getElementById("edit-description").value = tx.description;

        const isIncome = tx.type === "Income";
        document.getElementById("edit-type-income").checked = isIncome;
        document.getElementById("edit-type-expense").checked = !isIncome;

        populateCategorySelect(
            document.getElementById("edit-category"),
            tx.type,
            tx.category
        );

        document.getElementById("edit-modal-backdrop").hidden = false;
    }

    function closeEditModal() {
        document.getElementById("edit-modal-backdrop").hidden = true;
    }

    async function handleEditTransactionSubmit(event) {
        event.preventDefault();
        if (state.isSubmittingEdit) return;

        const txId = Number(document.getElementById("edit-id").value);
        const selectedTypeRadio = document.querySelector(
            'input[name="edit-type"]:checked'
        );
        const payload = {
            type: selectedTypeRadio ? selectedTypeRadio.value : "Expense",
            amount: document.getElementById("edit-amount").value,
            category: document.getElementById("edit-category").value,
            description: document.getElementById("edit-description").value.trim(),
            date: document.getElementById("edit-date").value
        };

        const validationError = validateTransactionFormFields(payload);
        if (validationError) {
            setFormFeedback("edit-form-feedback", validationError, "error");
            return;
        }

        const saveBtn = document.getElementById("save-edit-btn");
        state.isSubmittingEdit = true;
        saveBtn.disabled = true;
        saveBtn.textContent = "Updating...";

        try {
            await apiRequest(`/api/transactions/${txId}`, {
                method: "PUT",
                body: JSON.stringify(payload)
            });

            closeEditModal();
            showToast("Transaction updated successfully.", "success");
            await loadTransactions();
            await loadDashboard();
        } catch (err) {
            setFormFeedback("edit-form-feedback", err.message, "error");
        } finally {
            state.isSubmittingEdit = false;
            saveBtn.disabled = false;
            saveBtn.textContent = "Update Transaction";
        }
    }

    function openDeleteModal(txId) {
        const tx = state.transactions.find((item) => item.id === Number(txId));
        if (!tx) return;

        state.pendingDeleteId = tx.id;
        const summaryEl = document.getElementById("delete-tx-summary");
        summaryEl.innerHTML = `
            <div><strong>${escapeHtml(tx.description)}</strong></div>
            <div style="color: var(--text-secondary); margin-top: 4px;">
                ${escapeHtml(tx.type)} • ${escapeHtml(tx.category)} • ${escapeHtml(
            tx.date
        )} • <strong>${formatMoney(tx.amount)}</strong>
            </div>
        `;
        document.getElementById("delete-modal-backdrop").hidden = false;
    }

    function closeDeleteModal() {
        state.pendingDeleteId = null;
        document.getElementById("delete-modal-backdrop").hidden = true;
    }

    async function confirmDeleteTransaction() {
        if (!state.pendingDeleteId) return;
        const txId = state.pendingDeleteId;
        const btn = document.getElementById("confirm-delete-btn");
        btn.disabled = true;
        btn.textContent = "Deleting...";

        try {
            await apiRequest(`/api/transactions/${txId}`, {
                method: "DELETE"
            });
            closeDeleteModal();
            showToast("Transaction deleted.", "success");
            await loadTransactions();
            await loadDashboard();
        } catch (err) {
            showToast(err.message || "Failed to delete transaction.", "error");
        } finally {
            btn.disabled = false;
            btn.textContent = "Delete Transaction";
        }
    }

    // -------------------------------------------------------------------------
    // Section D: Monthly Reports & SVG Charts
    // -------------------------------------------------------------------------
    async function loadMonthlyReport(month = "") {
        try {
            const query = month ? `?month=${encodeURIComponent(month)}` : "";
            const res = await apiRequest(`/api/reports/monthly${query}`);
            const report = res.data;

            const monthInput = document.getElementById("report-month-input");
            if (monthInput && report.month) {
                monthInput.value = report.month;
            }

            document.getElementById("report-monthly-income").textContent = formatMoney(
                report.monthly_income
            );
            document.getElementById("report-monthly-expense").textContent = formatMoney(
                report.monthly_expense
            );
            document.getElementById("report-monthly-savings").textContent = formatMoney(
                report.monthly_savings
            );
            document.getElementById(
                "report-savings-rate"
            ).textContent = `${report.savings_rate}% savings rate (${report.transaction_count} records in ${report.month})`;

            renderMonthlyBarChart(report);
            renderMonthlyCategoryChart(report);
        } catch (err) {
            showToast(err.message || "Failed to load monthly report.", "error");
        }
    }

    function renderMonthlyBarChart(report) {
        const container = document.getElementById("report-bar-chart-container");
        if (!container) return;

        const income = report.monthly_income;
        const expense = report.monthly_expense;

        if (income === 0 && expense === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <p class="empty-title">No transactions in ${escapeHtml(report.month)}</p>
                    <p class="empty-desc">Record income or expenses for this month to view the comparison chart.</p>
                </div>
            `;
            return;
        }

        const maxVal = Math.max(income, expense, 1);
        const incHeight = Math.max(Math.round((income / maxVal) * 140), income > 0 ? 8 : 2);
        const expHeight = Math.max(Math.round((expense / maxVal) * 140), expense > 0 ? 8 : 2);

        container.innerHTML = `
            <div class="bar-chart-wrapper">
                <div class="svg-chart-box">
                    <svg width="320" height="200" viewBox="0 0 320 200" role="img" aria-label="Income versus Expenses Bar Chart">
                        <!-- Baseline -->
                        <line x1="30" y1="165" x2="290" y2="165" stroke="#E5E8EF" stroke-width="2" />

                        <!-- Income Bar -->
                        <rect x="75" y="${165 - incHeight}" width="55" height="${incHeight}" rx="6" fill="#16A36A" />
                        <text x="102.5" y="${157 - incHeight}" text-anchor="middle" font-size="11" font-weight="600" fill="#16A36A">${escapeHtml(
                            formatMoney(income)
                        )}</text>
                        <text x="102.5" y="185" text-anchor="middle" font-size="12" font-weight="600" fill="#202124">Income</text>

                        <!-- Expense Bar -->
                        <rect x="190" y="${165 - expHeight}" width="55" height="${expHeight}" rx="6" fill="#E05252" />
                        <text x="217.5" y="${157 - expHeight}" text-anchor="middle" font-size="11" font-weight="600" fill="#E05252">${escapeHtml(
                            formatMoney(expense)
                        )}</text>
                        <text x="217.5" y="185" text-anchor="middle" font-size="12" font-weight="600" fill="#202124">Expenses</text>
                    </svg>
                </div>
                <div class="summary-Highlight-box">
                    <div class="highlight-item">
                        <span class="highlight-label">Net Monthly Cashflow</span>
                        <strong class="highlight-val ${
                            report.monthly_savings >= 0 ? "text-income" : "text-expense"
                        }">${formatMoney(report.monthly_savings)}</strong>
                    </div>
                    <div class="highlight-item">
                        <span class="highlight-label">Savings Rate</span>
                        <strong class="highlight-val">${report.savings_rate}%</strong>
                    </div>
                </div>
            </div>
        `;
    }

    function renderMonthlyCategoryChart(report) {
        const container = document.getElementById("report-category-chart-container");
        if (!container) return;

        const breakdown = report.expense_breakdown || [];
        if (breakdown.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <p class="empty-title">No expenses for ${escapeHtml(report.month)}</p>
                    <p class="empty-desc">Category breakdown will appear here once expenses are recorded for this month.</p>
                </div>
            `;
            return;
        }

        // Build an SVG donut chart using stroke-dasharray
        const radius = 58;
        const circumference = 2 * Math.PI * radius;
        let accumulatedPercent = 0;

        const segmentsSvg = breakdown
            .map((item, idx) => {
                const color = CHART_COLORS[idx % CHART_COLORS.length];
                const pct = item.percentage / 100;
                const dashArray = `${pct * circumference} ${circumference}`;
                const dashOffset = -accumulatedPercent * circumference;
                accumulatedPercent += pct;
                return `<circle cx="80" cy="80" r="${radius}" fill="transparent" stroke="${color}" stroke-width="22" stroke-dasharray="${dashArray}" stroke-dashoffset="${dashOffset}" transform="rotate(-90 80 80)" />`;
            })
            .join("");

        const legendHtml = breakdown
            .map((item, idx) => {
                const color = CHART_COLORS[idx % CHART_COLORS.length];
                return `
                    <div class="category-item">
                        <div class="category-item-header">
                            <div class="category-name-group">
                                <span class="category-dot" style="background-color: ${color}"></span>
                                <span class="category-name">${escapeHtml(item.category)}</span>
                            </div>
                            <div class="category-stats">
                                <span class="category-amount">${formatMoney(item.amount)}</span>
                                <span class="category-pct">${item.percentage}%</span>
                            </div>
                        </div>
                    </div>
                `;
            })
            .join("");

        container.innerHTML = `
            <div class="donut-layout">
                <svg width="160" height="160" viewBox="0 0 160 160" role="img" aria-label="Category Expense Breakdown Donut Chart">
                    <circle cx="80" cy="80" r="${radius}" fill="transparent" stroke="#F1F3F7" stroke-width="22" />
                    ${segmentsSvg}
                    <text x="80" y="76" text-anchor="middle" font-size="10" fill="#737780">Total Spent</text>
                    <text x="80" y="92" text-anchor="middle" font-size="11" font-weight="700" fill="#202124">${escapeHtml(
                        formatMoney(report.monthly_expense)
                    )}</text>
                </svg>
                <div class="category-list">${legendHtml}</div>
            </div>
        `;
    }

    // -------------------------------------------------------------------------
    // Section E: Settings (Currency & Clear All Transactions)
    // -------------------------------------------------------------------------
    async function loadSettings() {
        try {
            const res = await apiRequest("/api/settings");
            const data = res.data;

            applyCurrencyState(data.currency, data.currency_symbol);

            const selectEl = document.getElementById("settings-currency-select");
            if (selectEl) {
                selectEl.value = data.currency;
            }

            if (data.app_info) {
                document.getElementById("info-app-name").textContent =
                    data.app_info.name;
                document.getElementById("info-app-version").textContent =
                    data.app_info.version;
                document.getElementById("info-app-stack").textContent =
                    data.app_info.stack;
                document.getElementById("info-db-engine").textContent =
                    data.app_info.database_engine;
                document.getElementById(
                    "info-stored-count"
                ).textContent = `${data.app_info.total_stored_transactions} transactions`;
            }
        } catch (err) {
            showToast(err.message || "Failed to load application settings.", "error");
        }
    }

    function applyCurrencyState(currencyCode, symbol) {
        state.currency = currencyCode;
        state.currencySymbol = symbol;

        const badge = document.getElementById("header-currency-badge");
        if (badge) {
            badge.textContent = `${currencyCode} (${symbol})`;
        }

        const addLabel = document.getElementById("add-currency-label");
        if (addLabel) {
            addLabel.textContent = `${currencyCode} / ${symbol}`;
        }
    }

    async function handleSaveCurrency(event) {
        event.preventDefault();
        const selectEl = document.getElementById("settings-currency-select");
        const selectedCurrency = selectEl ? selectEl.value : "BDT";

        try {
            const res = await apiRequest("/api/settings", {
                method: "PUT",
                body: JSON.stringify({ currency: selectedCurrency })
            });

            applyCurrencyState(res.data.currency, res.data.currency_symbol);
            showToast(res.message || "Display currency updated.", "success");
            await loadDashboard();
        } catch (err) {
            showToast(err.message || "Failed to update currency.", "error");
        }
    }

    function openClearModal() {
        const checkbox = document.getElementById("clear-confirm-checkbox");
        const confirmBtn = document.getElementById("confirm-clear-btn");
        checkbox.checked = false;
        confirmBtn.disabled = true;
        document.getElementById("clear-modal-backdrop").hidden = false;
    }

    function closeClearModal() {
        document.getElementById("clear-modal-backdrop").hidden = true;
    }

    async function handleConfirmClearAll() {
        const checkbox = document.getElementById("clear-confirm-checkbox");
        if (!checkbox.checked) return;

        const confirmBtn = document.getElementById("confirm-clear-btn");
        confirmBtn.disabled = true;
        confirmBtn.textContent = "Clearing...";

        try {
            const res = await apiRequest("/api/transactions/clear", {
                method: "DELETE",
                body: JSON.stringify({ confirm: true })
            });
            closeClearModal();
            showToast(res.message || "All transactions cleared.", "success");
            await loadSettings();
            await loadDashboard();
        } catch (err) {
            showToast(err.message || "Failed to clear transactions.", "error");
        } finally {
            confirmBtn.disabled = false;
            confirmBtn.textContent = "Yes, Clear Everything";
        }
    }

    // -------------------------------------------------------------------------
    // Event Listeners & Initialization
    // -------------------------------------------------------------------------
    function initEventListeners() {
        // Navigation Tabs
        document.querySelectorAll(".nav-tab").forEach((btn) => {
            btn.addEventListener("click", () => {
                switchView(btn.dataset.target);
            });
        });

        // Header Quick Add & Dashboard Shortcuts
        document
            .getElementById("quick-add-btn")
            .addEventListener("click", () => switchView("add-transaction"));
        document
            .getElementById("refresh-dashboard-btn")
            .addEventListener("click", () => loadDashboard());
        document
            .getElementById("dash-view-reports-btn")
            .addEventListener("click", () => switchView("reports"));
        document
            .getElementById("dash-view-all-tx-btn")
            .addEventListener("click", () => switchView("history"));

        // Add Transaction Form: Type Radio Change updates Category dropdown
        document.querySelectorAll('input[name="type"]').forEach((radio) => {
            radio.addEventListener("change", (e) => {
                populateCategorySelect(
                    document.getElementById("add-category"),
                    e.target.value
                );
            });
        });

        document
            .getElementById("add-transaction-form")
            .addEventListener("submit", handleAddTransactionSubmit);

        document.getElementById("add-reset-btn").addEventListener("click", () => {
            setTimeout(() => {
                document.getElementById("add-date").value = getTodayDateString();
                populateCategorySelect(
                    document.getElementById("add-category"),
                    "Expense"
                );
                setFormFeedback("add-form-feedback", "", "");
            }, 0);
        });

        // Transaction History Filter Form
        document
            .getElementById("filter-type")
            .addEventListener("change", () => {
                populateFilterCategorySelect();
                loadTransactions();
            });
        document
            .getElementById("filter-category")
            .addEventListener("change", loadTransactions);
        document
            .getElementById("filter-form")
            .addEventListener("submit", (e) => {
                e.preventDefault();
                loadTransactions();
            });
        document
            .getElementById("reset-filters-btn")
            .addEventListener("click", () => {
                document.getElementById("filter-search").value = "";
                document.getElementById("filter-type").value = "";
                populateFilterCategorySelect();
                document.getElementById("filter-start-date").value = "";
                document.getElementById("filter-end-date").value = "";
                loadTransactions();
            });

        // Table Actions (Edit / Delete Delegation)
        document
            .getElementById("history-table-body")
            .addEventListener("click", (e) => {
                const editBtn = e.target.closest(".edit-tx-btn");
                if (editBtn) {
                    openEditModal(editBtn.dataset.id);
                    return;
                }
                const deleteBtn = e.target.closest(".delete-tx-btn");
                if (deleteBtn) {
                    openDeleteModal(deleteBtn.dataset.id);
                }
            });

        // Edit Modal Controls
        document.querySelectorAll('input[name="edit-type"]').forEach((radio) => {
            radio.addEventListener("change", (e) => {
                populateCategorySelect(
                    document.getElementById("edit-category"),
                    e.target.value
                );
            });
        });
        document
            .getElementById("edit-transaction-form")
            .addEventListener("submit", handleEditTransactionSubmit);
        document
            .getElementById("close-edit-modal-btn")
            .addEventListener("click", closeEditModal);
        document
            .getElementById("cancel-edit-btn")
            .addEventListener("click", closeEditModal);

        // Delete Modal Controls
        document
            .getElementById("close-delete-modal-btn")
            .addEventListener("click", closeDeleteModal);
        document
            .getElementById("cancel-delete-btn")
            .addEventListener("click", closeDeleteModal);
        document
            .getElementById("confirm-delete-btn")
            .addEventListener("click", confirmDeleteTransaction);

        // Monthly Report Month Picker
        document
            .getElementById("report-month-input")
            .addEventListener("change", (e) => {
                loadMonthlyReport(e.target.value);
            });

        // Settings Controls
        document
            .getElementById("settings-currency-form")
            .addEventListener("submit", handleSaveCurrency);
        document
            .getElementById("open-clear-modal-btn")
            .addEventListener("click", openClearModal);
        document
            .getElementById("close-clear-modal-btn")
            .addEventListener("click", closeClearModal);
        document
            .getElementById("cancel-clear-btn")
            .addEventListener("click", closeClearModal);
        document
            .getElementById("clear-confirm-checkbox")
            .addEventListener("change", (e) => {
                document.getElementById("confirm-clear-btn").disabled =
                    !e.target.checked;
            });
        document
            .getElementById("confirm-clear-btn")
            .addEventListener("click", handleConfirmClearAll);
    }

    async function initApp() {
        // Set default dates and initial categories
        document.getElementById("add-date").value = getTodayDateString();
        document.getElementById("report-month-input").value = getCurrentMonthString();
        populateCategorySelect(
            document.getElementById("add-category"),
            "Expense"
        );
        populateFilterCategorySelect();

        initEventListeners();

        // Load saved currency setting first, then populate the dashboard
        await loadSettings();
        await loadDashboard();
    }

    document.addEventListener("DOMContentLoaded", initApp);
})();
