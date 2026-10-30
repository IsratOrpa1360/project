"""
app.py - Flask Backend Application for Personal Expense Tracker

This module defines:
1. The main web route (`/`) serving `templates/index.html`.
2. RESTful API endpoints under `/api/...` for:
   - Dashboard statistics (`/api/dashboard`)
   - Creating, reading, updating, and deleting transactions (`/api/transactions`)
   - Clearing all transactions (`/api/transactions/clear`)
   - Generating monthly financial reports (`/api/reports/monthly`)
   - Managing application settings such as display currency (`/api/settings`)
"""

import os
import sqlite3
from datetime import datetime
from dotenv import load_dotenv
from flask import Flask, jsonify, render_template, request

import database

# Load environment variables from .env if present
load_dotenv()


def create_app(test_config: dict = None) -> Flask:
    """Application factory for creating and configuring the Flask app."""
    app = Flask(__name__, instance_relative_config=True)

    # Configure secret key and database path
    app.config.from_mapping(
        SECRET_KEY=os.environ.get("SECRET_KEY", "dev-local-key-change-in-production"),
        DATABASE_PATH=os.path.join(app.instance_path, "expenses.db"),
    )

    if test_config:
        app.config.update(test_config)

    # Ensure instance folder and SQLite tables exist on startup
    os.makedirs(app.instance_path, exist_ok=True)
    database.init_db(app.config["DATABASE_PATH"])

    def db_file() -> str:
        return app.config["DATABASE_PATH"]

    # -------------------------------------------------------------------------
    # Frontend Route
    # -------------------------------------------------------------------------
    @app.route("/", methods=["GET"])
    def index():
        """Render the single-page Personal Expense Tracker dashboard interface."""
        return render_template("index.html")

    # -------------------------------------------------------------------------
    # REST API: Dashboard Statistics
    # -------------------------------------------------------------------------
    @app.route("/api/dashboard", methods=["GET"])
    def api_get_dashboard():
        """Return calculated dashboard totals, recent transactions, monthly summary, and category breakdown."""
        try:
            month_param = request.args.get("month", "").strip() or None
            if month_param:
                try:
                    datetime.strptime(month_param, "%Y-%m")
                except ValueError:
                    return (
                        jsonify(
                            {
                                "success": False,
                                "error": "Invalid month format. Expected YYYY-MM.",
                            }
                        ),
                        400,
                    )

            data = database.get_dashboard_data(
                reference_month=month_param, db_path=db_file()
            )
            return jsonify({"success": True, "data": data}), 200
        except sqlite3.Error as exc:
            return (
                jsonify(
                    {
                        "success": False,
                        "error": f"Database error while loading dashboard: {str(exc)}",
                    }
                ),
                500,
            )

    # -------------------------------------------------------------------------
    # REST API: Transactions CRUD
    # -------------------------------------------------------------------------
    @app.route("/api/transactions", methods=["GET"])
    def api_list_transactions():
        """List saved transactions (newest first) with optional filtering and search."""
        try:
            tx_type = request.args.get("type", "").strip() or None
            category = request.args.get("category", "").strip() or None
            start_date = request.args.get("start_date", "").strip() or None
            end_date = request.args.get("end_date", "").strip() or None
            search = request.args.get("search", "").strip() or None

            # Validate optional date filters
            for label, d_val in [("start_date", start_date), ("end_date", end_date)]:
                if d_val:
                    try:
                        datetime.strptime(d_val, "%Y-%m-%d")
                    except ValueError:
                        return (
                            jsonify(
                                {
                                    "success": False,
                                    "error": f"Invalid {label} format. Use YYYY-MM-DD.",
                                }
                            ),
                            400,
                        )

            if start_date and end_date and start_date > end_date:
                return (
                    jsonify(
                        {
                            "success": False,
                            "error": "Start date cannot be later than end date.",
                        }
                    ),
                    400,
                )

            transactions = database.get_transactions(
                tx_type=tx_type,
                category=category,
                start_date=start_date,
                end_date=end_date,
                search=search,
                db_path=db_file(),
            )
            return (
                jsonify(
                    {
                        "success": True,
                        "count": len(transactions),
                        "data": transactions,
                    }
                ),
                200,
            )
        except sqlite3.Error as exc:
            return (
                jsonify(
                    {
                        "success": False,
                        "error": f"Database error while reading transactions: {str(exc)}",
                    }
                ),
                500,
            )

    @app.route("/api/transactions", methods=["POST"])
    def api_create_transaction():
        """Validate and save a new transaction to SQLite."""
        payload = request.get_json(silent=True)
        if payload is None:
            return (
                jsonify(
                    {
                        "success": False,
                        "error": "Invalid or missing JSON request body.",
                    }
                ),
                400,
            )

        is_valid, error_msg, cleaned = database.validate_transaction_payload(payload)
        if not is_valid:
            return jsonify({"success": False, "error": error_msg}), 400

        try:
            created = database.create_transaction(cleaned, db_path=db_file())
            return (
                jsonify(
                    {
                        "success": True,
                        "message": "Transaction saved successfully.",
                        "data": created,
                    }
                ),
                201,
            )
        except sqlite3.Error as exc:
            return (
                jsonify(
                    {
                        "success": False,
                        "error": f"Failed to save transaction: {str(exc)}",
                    }
                ),
                500,
            )

    @app.route("/api/transactions/<int:tx_id>", methods=["GET"])
    def api_get_single_transaction(tx_id: int):
        """Fetch a single transaction by its ID."""
        try:
            tx = database.get_transaction_by_id(tx_id, db_path=db_file())
            if not tx:
                return (
                    jsonify({"success": False, "error": "Transaction not found."}),
                    404,
                )
            return jsonify({"success": True, "data": tx}), 200
        except sqlite3.Error as exc:
            return (
                jsonify(
                    {
                        "success": False,
                        "error": f"Database error: {str(exc)}",
                    }
                ),
                500,
            )

    @app.route("/api/transactions/<int:tx_id>", methods=["PUT"])
    def api_update_transaction(tx_id: int):
        """Validate and update an existing transaction in SQLite."""
        payload = request.get_json(silent=True)
        if payload is None:
            return (
                jsonify(
                    {
                        "success": False,
                        "error": "Invalid or missing JSON request body.",
                    }
                ),
                400,
            )

        is_valid, error_msg, cleaned = database.validate_transaction_payload(payload)
        if not is_valid:
            return jsonify({"success": False, "error": error_msg}), 400

        try:
            updated = database.update_transaction(tx_id, cleaned, db_path=db_file())
            if not updated:
                return (
                    jsonify({"success": False, "error": "Transaction not found."}),
                    404,
                )
            return (
                jsonify(
                    {
                        "success": True,
                        "message": "Transaction updated successfully.",
                        "data": updated,
                    }
                ),
                200,
            )
        except sqlite3.Error as exc:
            return (
                jsonify(
                    {
                        "success": False,
                        "error": f"Failed to update transaction: {str(exc)}",
                    }
                ),
                500,
            )

    @app.route("/api/transactions/<int:tx_id>", methods=["DELETE"])
    def api_delete_transaction(tx_id: int):
        """Delete an existing transaction by ID."""
        try:
            deleted = database.delete_transaction(tx_id, db_path=db_file())
            if not deleted:
                return (
                    jsonify({"success": False, "error": "Transaction not found."}),
                    404,
                )
            return (
                jsonify(
                    {
                        "success": True,
                        "message": "Transaction deleted successfully.",
                    }
                ),
                200,
            )
        except sqlite3.Error as exc:
            return (
                jsonify(
                    {
                        "success": False,
                        "error": f"Failed to delete transaction: {str(exc)}",
                    }
                ),
                500,
            )

    @app.route("/api/transactions/clear", methods=["DELETE"])
    def api_clear_transactions():
        """Clear all saved transactions after explicit user confirmation."""
        payload = request.get_json(silent=True) or {}
        if payload.get("confirm") is not True:
            return (
                jsonify(
                    {
                        "success": False,
                        "error": "Explicit confirmation (`confirm: true`) is required to clear all transactions.",
                    }
                ),
                400,
            )

        try:
            deleted_count = database.clear_all_transactions(db_path=db_file())
            return (
                jsonify(
                    {
                        "success": True,
                        "message": f"Cleared {deleted_count} transaction(s) from the database.",
                        "deleted_count": deleted_count,
                    }
                ),
                200,
            )
        except sqlite3.Error as exc:
            return (
                jsonify(
                    {
                        "success": False,
                        "error": f"Failed to clear transactions: {str(exc)}",
                    }
                ),
                500,
            )

    # -------------------------------------------------------------------------
    # REST API: Monthly Reports
    # -------------------------------------------------------------------------
    @app.route("/api/reports/monthly", methods=["GET"])
    def api_monthly_report():
        """Return monthly income, expenses, net savings, and category breakdowns."""
        month_param = request.args.get("month", "").strip() or None
        if month_param:
            try:
                datetime.strptime(month_param, "%Y-%m")
            except ValueError:
                return (
                    jsonify(
                        {
                            "success": False,
                            "error": "Invalid month format. Expected YYYY-MM (e.g., 2026-10).",
                        }
                    ),
                    400,
                )

        try:
            report = database.get_monthly_report(month=month_param, db_path=db_file())
            return jsonify({"success": True, "data": report}), 200
        except sqlite3.Error as exc:
            return (
                jsonify(
                    {
                        "success": False,
                        "error": f"Database error while generating monthly report: {str(exc)}",
                    }
                ),
                500,
            )

    # -------------------------------------------------------------------------
    # REST API: Application Settings
    # -------------------------------------------------------------------------
    @app.route("/api/settings", methods=["GET"])
    def api_get_settings():
        """Return current display currency and application information."""
        try:
            settings_data = database.get_settings(db_path=db_file())
            return jsonify({"success": True, "data": settings_data}), 200
        except sqlite3.Error as exc:
            return (
                jsonify(
                    {
                        "success": False,
                        "error": f"Failed to load settings: {str(exc)}",
                    }
                ),
                500,
            )

    @app.route("/api/settings", methods=["PUT"])
    def api_update_settings():
        """Update display currency without altering stored transaction amounts."""
        payload = request.get_json(silent=True)
        if not isinstance(payload, dict) or "currency" not in payload:
            return (
                jsonify(
                    {
                        "success": False,
                        "error": "Please provide a valid 'currency' code in the request body.",
                    }
                ),
                400,
            )

        try:
            ok, err_msg, updated_settings = database.update_currency_setting(
                payload.get("currency"), db_path=db_file()
            )
            if not ok:
                return jsonify({"success": False, "error": err_msg}), 400
            return (
                jsonify(
                    {
                        "success": True,
                        "message": f"Display currency updated to {updated_settings['currency']}.",
                        "data": updated_settings,
                    }
                ),
                200,
            )
        except sqlite3.Error as exc:
            return (
                jsonify(
                    {
                        "success": False,
                        "error": f"Failed to update settings: {str(exc)}",
                    }
                ),
                500,
            )

    # -------------------------------------------------------------------------
    # Error Handlers
    # -------------------------------------------------------------------------
    @app.errorhandler(404)
    def handle_not_found(err):
        if request.path.startswith("/api/"):
            return jsonify({"success": False, "error": "API endpoint not found."}), 404
        return render_template("index.html")

    @app.errorhandler(405)
    def handle_method_not_allowed(err):
        return (
            jsonify(
                {"success": False, "error": "HTTP method not allowed for this endpoint."}
            ),
            405,
        )

    @app.errorhandler(500)
    def handle_internal_error(err):
        return (
            jsonify(
                {
                    "success": False,
                    "error": "An unexpected internal server error occurred.",
                }
            ),
            500,
        )

    return app


app = create_app()

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    debug_mode = os.environ.get("FLASK_DEBUG", "1") == "1"
    app.run(host="127.0.0.1", port=port, debug=debug_mode)
