"""
database.py - SQLite Database Management Module for Personal Expense Tracker

This module handles:
1. Connecting to the SQLite database stored inside the `instance/` directory.
2. Automatically creating the `transactions` and `settings` tables when the app starts.
3. Providing safe, parameterized helper functions for all CRUD (Create, Read, Update, Delete)
   and aggregation operations so SQL injection is prevented.
"""

import os
import sqlite3
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple

# Default categories for validation and reference
INCOME_CATEGORIES = [
    "Salary",
    "Freelance",
    "Business",
    "Scholarship",
    "Other Income",
]

EXPENSE_CATEGORIES = [
    "Food",
    "Transportation",
    "Education",
    "Shopping",
    "Bills",
    "Healthcare",
    "Entertainment",
    "Other Expenses",
]

ALL_CATEGORIES = INCOME_CATEGORIES + EXPENSE_CATEGORIES

SUPPORTED_CURRENCIES = {
    "BDT": {"symbol": "৳", "name": "Bangladeshi Taka (BDT)"},
    "USD": {"symbol": "$", "name": "US Dollar (USD)"},
    "EUR": {"symbol": "€", "name": "Euro (EUR)"},
    "GBP": {"symbol": "£", "name": "British Pound (GBP)"},
    "INR": {"symbol": "₹", "name": "Indian Rupee (INR)"},
}


def get_db_path(custom_path: Optional[str] = None) -> str:
    """Return the absolute path to the SQLite database file, ensuring the parent directory exists."""
    if custom_path:
        db_path = os.path.abspath(custom_path)
    else:
        base_dir = os.path.dirname(os.path.abspath(__file__))
        env_path = os.environ.get("DATABASE_PATH")
        if env_path:
            db_path = (
                env_path
                if os.path.isabs(env_path)
                else os.path.join(base_dir, env_path)
            )
        else:
            db_path = os.path.join(base_dir, "instance", "expenses.db")

    os.makedirs(os.path.dirname(db_path), exist_ok=True)
    return db_path


def get_connection(db_path: Optional[str] = None) -> sqlite3.Connection:
    """Create and return a configured SQLite connection with dictionary-like row access."""
    resolved_path = get_db_path(db_path)
    conn = sqlite3.connect(resolved_path)
    conn.row_factory = sqlite3.Row
    return conn


def init_db(db_path: Optional[str] = None) -> None:
    """
    Create the `transactions` and `settings` tables automatically if they do not exist,
    and ensure default settings (currency = BDT) are initialized.
    """
    conn = get_connection(db_path)
    try:
        with conn:
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS transactions (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    type TEXT NOT NULL CHECK(type IN ('Income', 'Expense')),
                    amount REAL NOT NULL CHECK(amount > 0),
                    category TEXT NOT NULL,
                    description TEXT NOT NULL,
                    date TEXT NOT NULL,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
                """
            )
            conn.execute(
                """
                CREATE INDEX IF NOT EXISTS idx_transactions_date
                ON transactions(date DESC, id DESC)
                """
            )
            conn.execute(
                """
                CREATE INDEX IF NOT EXISTS idx_transactions_type_category
                ON transactions(type, category)
                """
            )
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS settings (
                    key TEXT PRIMARY KEY,
                    value TEXT NOT NULL
                )
                """
            )
            conn.execute(
                """
                INSERT OR IGNORE INTO settings (key, value)
                VALUES (?, ?)
                """,
                ("currency", "BDT"),
            )
    finally:
        conn.close()


def validate_transaction_payload(data: Dict[str, Any]) -> Tuple[bool, Optional[str], Optional[Dict[str, Any]]]:
    """
    Validate and sanitize incoming transaction payload on the server side.
    Returns (is_valid, error_message, cleaned_data).
    """
    if not isinstance(data, dict):
        return False, "Request body must be a valid JSON object.", None

    tx_type = str(data.get("type", "")).strip()
    if tx_type not in ("Income", "Expense"):
        return False, "Transaction type must be either 'Income' or 'Expense'.", None

    raw_amount = data.get("amount")
    if raw_amount is None or str(raw_amount).strip() == "":
        return False, "Amount is required.", None

    try:
        amount = round(float(raw_amount), 2)
    except (ValueError, TypeError):
        return False, "Amount must be a valid number.", None

    if amount <= 0:
        return False, "Amount must be greater than zero.", None
    if amount > 999_999_999.99:
        return False, "Amount exceeds the maximum allowed limit.", None

    category = str(data.get("category", "")).strip()
    if not category:
        return False, "Category is required.", None

    valid_categories = INCOME_CATEGORIES if tx_type == "Income" else EXPENSE_CATEGORIES
    if category not in valid_categories:
        return (
            False,
            f"Invalid category '{category}' for {tx_type}. Allowed: {', '.join(valid_categories)}.",
            None,
        )

    description = str(data.get("description", "")).strip()
    if not description:
        return False, "Description is required and cannot be empty.", None
    if len(description) > 150:
        return False, "Description must be 150 characters or fewer.", None

    date_str = str(data.get("date", "")).strip()
    if not date_str:
        return False, "Date is required.", None

    try:
        parsed_date = datetime.strptime(date_str, "%Y-%m-%d")
        normalized_date = parsed_date.strftime("%Y-%m-%d")
    except ValueError:
        return False, "Date must be a valid calendar date in YYYY-MM-DD format.", None

    cleaned = {
        "type": tx_type,
        "amount": amount,
        "category": category,
        "description": description,
        "date": normalized_date,
    }
    return True, None, cleaned


def create_transaction(data: Dict[str, Any], db_path: Optional[str] = None) -> Dict[str, Any]:
    """Insert a validated transaction record and return the created row as a dict."""
    conn = get_connection(db_path)
    try:
        with conn:
            cursor = conn.execute(
                """
                INSERT INTO transactions (type, amount, category, description, date)
                VALUES (?, ?, ?, ?, ?)
                """,
                (
                    data["type"],
                    data["amount"],
                    data["category"],
                    data["description"],
                    data["date"],
                ),
            )
            tx_id = cursor.lastrowid
            row = conn.execute(
                "SELECT id, type, amount, category, description, date, created_at FROM transactions WHERE id = ?",
                (tx_id,),
            ).fetchone()
            return dict(row)
    finally:
        conn.close()


def get_transaction_by_id(tx_id: int, db_path: Optional[str] = None) -> Optional[Dict[str, Any]]:
    """Retrieve a single transaction by its primary key ID."""
    conn = get_connection(db_path)
    try:
        row = conn.execute(
            "SELECT id, type, amount, category, description, date, created_at FROM transactions WHERE id = ?",
            (tx_id,),
        ).fetchone()
        return dict(row) if row else None
    finally:
        conn.close()


def get_transactions(
    tx_type: Optional[str] = None,
    category: Optional[str] = None,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    search: Optional[str] = None,
    db_path: Optional[str] = None,
) -> List[Dict[str, Any]]:
    """
    Fetch transactions ordered by newest first (date DESC, id DESC),
    supporting combined filtering by type, category, date range, and description search.
    """
    query = """
        SELECT id, type, amount, category, description, date, created_at
        FROM transactions
        WHERE 1=1
    """
    params: List[Any] = []

    if tx_type and tx_type in ("Income", "Expense"):
        query += " AND type = ?"
        params.append(tx_type)

    if category and category != "All":
        query += " AND category = ?"
        params.append(category)

    if start_date:
        query += " AND date >= ?"
        params.append(start_date)

    if end_date:
        query += " AND date <= ?"
        params.append(end_date)

    if search and search.strip():
        query += " AND LOWER(description) LIKE LOWER(?)"
        params.append(f"%{search.strip()}%")

    query += " ORDER BY date DESC, id DESC"

    conn = get_connection(db_path)
    try:
        rows = conn.execute(query, params).fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


def update_transaction(
    tx_id: int, data: Dict[str, Any], db_path: Optional[str] = None
) -> Optional[Dict[str, Any]]:
    """Update an existing transaction by ID and return the updated row, or None if not found."""
    conn = get_connection(db_path)
    try:
        with conn:
            cursor = conn.execute(
                """
                UPDATE transactions
                SET type = ?, amount = ?, category = ?, description = ?, date = ?
                WHERE id = ?
                """,
                (
                    data["type"],
                    data["amount"],
                    data["category"],
                    data["description"],
                    data["date"],
                    tx_id,
                ),
            )
            if cursor.rowcount == 0:
                return None
            row = conn.execute(
                "SELECT id, type, amount, category, description, date, created_at FROM transactions WHERE id = ?",
                (tx_id,),
            ).fetchone()
            return dict(row) if row else None
    finally:
        conn.close()


def delete_transaction(tx_id: int, db_path: Optional[str] = None) -> bool:
    """Delete a single transaction by ID. Returns True if a row was deleted."""
    conn = get_connection(db_path)
    try:
        with conn:
            cursor = conn.execute("DELETE FROM transactions WHERE id = ?", (tx_id,))
            return cursor.rowcount > 0
    finally:
        conn.close()


def clear_all_transactions(db_path: Optional[str] = None) -> int:
    """Delete all transactions from the database and return the number of deleted rows."""
    conn = get_connection(db_path)
    try:
        with conn:
            cursor = conn.execute("DELETE FROM transactions")
            return cursor.rowcount
    finally:
        conn.close()


def get_dashboard_data(
    reference_month: Optional[str] = None, db_path: Optional[str] = None
) -> Dict[str, Any]:
    """
    Calculate all dashboard statistics directly from actual SQLite records:
    - Total Balance, Total Income, Total Expenses, Number of Transactions
    - Recent Transactions (latest 5)
    - Monthly Expense Summary (for current/latest month + last 6 months trend)
    - Expense Category Breakdown (all-time and active month)
    - Income vs Expense Overview
    """
    conn = get_connection(db_path)
    try:
        # 1. Overall totals
        totals_row = conn.execute(
            """
            SELECT
                COUNT(*) AS transaction_count,
                COALESCE(SUM(CASE WHEN type = 'Income' THEN amount ELSE 0 END), 0.0) AS total_income,
                COALESCE(SUM(CASE WHEN type = 'Expense' THEN amount ELSE 0 END), 0.0) AS total_expense
            FROM transactions
            """
        ).fetchone()

        total_income = round(float(totals_row["total_income"]), 2)
        total_expense = round(float(totals_row["total_expense"]), 2)
        total_balance = round(total_income - total_expense, 2)
        transaction_count = int(totals_row["transaction_count"])

        # 2. Recent transactions (5 newest)
        recent_rows = conn.execute(
            """
            SELECT id, type, amount, category, description, date, created_at
            FROM transactions
            ORDER BY date DESC, id DESC
            LIMIT 5
            """
        ).fetchall()
        recent_transactions = [dict(r) for r in recent_rows]

        # 3. Determine active month for Monthly Expense Summary
        if not reference_month:
            latest_month_row = conn.execute(
                "SELECT SUBSTR(date, 1, 7) AS ym FROM transactions ORDER BY date DESC LIMIT 1"
            ).fetchone()
            active_month = (
                latest_month_row["ym"]
                if latest_month_row and latest_month_row["ym"]
                else datetime.now().strftime("%Y-%m")
            )
        else:
            active_month = reference_month

        month_summary_row = conn.execute(
            """
            SELECT
                COALESCE(SUM(CASE WHEN type = 'Income' THEN amount ELSE 0 END), 0.0) AS monthly_income,
                COALESCE(SUM(CASE WHEN type = 'Expense' THEN amount ELSE 0 END), 0.0) AS monthly_expense,
                COUNT(CASE WHEN type = 'Expense' THEN 1 END) AS expense_count,
                MAX(CASE WHEN type = 'Expense' THEN amount ELSE NULL END) AS largest_expense
            FROM transactions
            WHERE SUBSTR(date, 1, 7) = ?
            """,
            (active_month,),
        ).fetchone()

        monthly_income = round(float(month_summary_row["monthly_income"]), 2)
        monthly_expense = round(float(month_summary_row["monthly_expense"]), 2)
        monthly_savings = round(monthly_income - monthly_expense, 2)
        largest_expense = (
            round(float(month_summary_row["largest_expense"]), 2)
            if month_summary_row["largest_expense"] is not None
            else 0.0
        )

        # Monthly trend (up to 6 most recent distinct months present in DB, sorted chronologically)
        monthly_trend_rows = conn.execute(
            """
            SELECT
                SUBSTR(date, 1, 7) AS month,
                COALESCE(SUM(CASE WHEN type = 'Income' THEN amount ELSE 0 END), 0.0) AS income,
                COALESCE(SUM(CASE WHEN type = 'Expense' THEN amount ELSE 0 END), 0.0) AS expense
            FROM transactions
            GROUP BY SUBSTR(date, 1, 7)
            ORDER BY month DESC
            LIMIT 6
            """
        ).fetchall()
        monthly_trend = [
            {
                "month": r["month"],
                "income": round(float(r["income"]), 2),
                "expense": round(float(r["expense"]), 2),
                "savings": round(float(r["income"]) - float(r["expense"]), 2),
            }
            for r in reversed(monthly_trend_rows)
        ]

        # 4. Expense Category Breakdown (overall across all saved expenses)
        cat_rows = conn.execute(
            """
            SELECT
                category,
                ROUND(SUM(amount), 2) AS total,
                COUNT(*) AS count
            FROM transactions
            WHERE type = 'Expense'
            GROUP BY category
            ORDER BY total DESC
            """
        ).fetchall()

        category_breakdown = []
        for r in cat_rows:
            cat_total = round(float(r["total"]), 2)
            percentage = (
                round((cat_total / total_expense) * 100, 1) if total_expense > 0 else 0.0
            )
            category_breakdown.append(
                {
                    "category": r["category"],
                    "amount": cat_total,
                    "count": int(r["count"]),
                    "percentage": percentage,
                }
            )

        # 5. Income vs Expense overview metrics
        savings_rate = (
            round(((total_income - total_expense) / total_income) * 100, 1)
            if total_income > 0
            else 0.0
        )
        expense_ratio = (
            round((total_expense / total_income) * 100, 1)
            if total_income > 0
            else (100.0 if total_expense > 0 else 0.0)
        )

        return {
            "total_balance": total_balance,
            "total_income": total_income,
            "total_expense": total_expense,
            "transaction_count": transaction_count,
            "recent_transactions": recent_transactions,
            "monthly_summary": {
                "month": active_month,
                "monthly_income": monthly_income,
                "monthly_expense": monthly_expense,
                "monthly_savings": monthly_savings,
                "expense_count": int(month_summary_row["expense_count"]),
                "largest_expense": largest_expense,
                "trend": monthly_trend,
            },
            "category_breakdown": category_breakdown,
            "income_vs_expense": {
                "income": total_income,
                "expense": total_expense,
                "net_savings": total_balance,
                "savings_rate": savings_rate,
                "expense_ratio": expense_ratio,
            },
        }
    finally:
        conn.close()


def get_monthly_report(month: Optional[str] = None, db_path: Optional[str] = None) -> Dict[str, Any]:
    """
    Generate a detailed monthly financial report for a given YYYY-MM month.
    If month is omitted, defaults to the most recent month with transactions, or current month.
    """
    conn = get_connection(db_path)
    try:
        # Available months in the database for dropdown selection
        month_rows = conn.execute(
            """
            SELECT DISTINCT SUBSTR(date, 1, 7) AS month
            FROM transactions
            ORDER BY month DESC
            """
        ).fetchall()
        available_months = [r["month"] for r in month_rows if r["month"]]

        if not month:
            selected_month = (
                available_months[0]
                if available_months
                else datetime.now().strftime("%Y-%m")
            )
        else:
            selected_month = month

        totals_row = conn.execute(
            """
            SELECT
                COUNT(*) AS transaction_count,
                COALESCE(SUM(CASE WHEN type = 'Income' THEN amount ELSE 0 END), 0.0) AS monthly_income,
                COALESCE(SUM(CASE WHEN type = 'Expense' THEN amount ELSE 0 END), 0.0) AS monthly_expense
            FROM transactions
            WHERE SUBSTR(date, 1, 7) = ?
            """,
            (selected_month,),
        ).fetchone()

        monthly_income = round(float(totals_row["monthly_income"]), 2)
        monthly_expense = round(float(totals_row["monthly_expense"]), 2)
        monthly_savings = round(monthly_income - monthly_expense, 2)
        transaction_count = int(totals_row["transaction_count"])
        savings_rate = (
            round((monthly_savings / monthly_income) * 100, 1)
            if monthly_income > 0
            else 0.0
        )

        # Category-wise expense breakdown for selected month
        expense_cat_rows = conn.execute(
            """
            SELECT
                category,
                ROUND(SUM(amount), 2) AS total,
                COUNT(*) AS count
            FROM transactions
            WHERE SUBSTR(date, 1, 7) = ? AND type = 'Expense'
            GROUP BY category
            ORDER BY total DESC
            """,
            (selected_month,),
        ).fetchall()

        expense_breakdown = []
        for r in expense_cat_rows:
            amt = round(float(r["total"]), 2)
            pct = round((amt / monthly_expense) * 100, 1) if monthly_expense > 0 else 0.0
            expense_breakdown.append(
                {
                    "category": r["category"],
                    "amount": amt,
                    "count": int(r["count"]),
                    "percentage": pct,
                }
            )

        # Category-wise income breakdown for selected month
        income_cat_rows = conn.execute(
            """
            SELECT
                category,
                ROUND(SUM(amount), 2) AS total,
                COUNT(*) AS count
            FROM transactions
            WHERE SUBSTR(date, 1, 7) = ? AND type = 'Income'
            GROUP BY category
            ORDER BY total DESC
            """,
            (selected_month,),
        ).fetchall()

        income_breakdown = []
        for r in income_cat_rows:
            amt = round(float(r["total"]), 2)
            pct = round((amt / monthly_income) * 100, 1) if monthly_income > 0 else 0.0
            income_breakdown.append(
                {
                    "category": r["category"],
                    "amount": amt,
                    "count": int(r["count"]),
                    "percentage": pct,
                }
            )

        # Transactions for that month
        tx_rows = conn.execute(
            """
            SELECT id, type, amount, category, description, date
            FROM transactions
            WHERE SUBSTR(date, 1, 7) = ?
            ORDER BY date DESC, id DESC
            """,
            (selected_month,),
        ).fetchall()

        return {
            "month": selected_month,
            "available_months": available_months,
            "monthly_income": monthly_income,
            "monthly_expense": monthly_expense,
            "monthly_savings": monthly_savings,
            "savings_rate": savings_rate,
            "transaction_count": transaction_count,
            "expense_breakdown": expense_breakdown,
            "income_breakdown": income_breakdown,
            "transactions": [dict(r) for r in tx_rows],
        }
    finally:
        conn.close()


def get_settings(db_path: Optional[str] = None) -> Dict[str, Any]:
    """Retrieve application settings and metadata from the database."""
    conn = get_connection(db_path)
    try:
        rows = conn.execute("SELECT key, value FROM settings").fetchall()
        settings_map = {r["key"]: r["value"] for r in rows}
        currency = settings_map.get("currency", "BDT")
        if currency not in SUPPORTED_CURRENCIES:
            currency = "BDT"

        tx_count = conn.execute("SELECT COUNT(*) AS cnt FROM transactions").fetchone()["cnt"]

        return {
            "currency": currency,
            "currency_symbol": SUPPORTED_CURRENCIES[currency]["symbol"],
            "currency_name": SUPPORTED_CURRENCIES[currency]["name"],
            "supported_currencies": SUPPORTED_CURRENCIES,
            "app_info": {
                "name": "Personal Expense Tracker",
                "version": "1.0.0",
                "stack": "HTML5, CSS3, Vanilla JS, Python, Flask, SQLite",
                "database_engine": f"SQLite {sqlite3.sqlite_version}",
                "total_stored_transactions": int(tx_count),
            },
        }
    finally:
        conn.close()


def update_currency_setting(currency: str, db_path: Optional[str] = None) -> Tuple[bool, Optional[str], Optional[Dict[str, Any]]]:
    """Validate and update the display currency in settings without altering stored transaction amounts."""
    cleaned_currency = str(currency or "").strip().upper()
    if cleaned_currency not in SUPPORTED_CURRENCIES:
        allowed = ", ".join(SUPPORTED_CURRENCIES.keys())
        return False, f"Unsupported currency '{currency}'. Allowed values: {allowed}.", None

    conn = get_connection(db_path)
    try:
        with conn:
            conn.execute(
                """
                INSERT INTO settings (key, value)
                VALUES ('currency', ?)
                ON CONFLICT(key) DO UPDATE SET value = excluded.value
                """,
                (cleaned_currency,),
            )
        return True, None, get_settings(db_path)
    finally:
        conn.close()
