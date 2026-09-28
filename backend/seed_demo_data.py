"""
backend/seed_demo_data.py

One-command demo-data loader for local/first-run use.

REAL DATA MODE (see db.py) means the application itself never auto-seeds
sample projects — a fresh database always starts with zero rows, and the
only way projects normally enter the system is via POST /api/upload or
POST /api/projects. This script is a separate, OPTIONAL, manually-run
convenience for people who want something to look at (a populated
Dashboard, Alerts feed, risk map, etc.) right after cloning the repo,
without having to find or craft a CSV to upload first.

What it does:
- Reads backend/data/sample_projects.csv (18 realistic MPLADS project
  rows, deliberately varied: several clean/on-track projects, a clear
  cost-overrun case, a stalled/delayed case, a likely-duplicate pair of
  works, a financial/physical mismatch case, a high-utilization case and
  a suspicious-payment-count case — enough variety for the risk engine,
  ML anomaly detector and duplicate detector to all produce non-trivial,
  demonstrable output).
- Loads every row through db.py's own insert_project() function — never
  a raw/direct SQL statement — so the exact same validation-free, typed
  insert path used by the rest of the app is exercised here too.
- Is safe to re-run: each CSV row carries a fixed id (e.g.
  "MPLADS-2024-0007"). Before inserting, this script checks which ids are
  already present in the projects table and skips those, so running it
  twice (or after the app has already been used) never creates duplicate
  rows.

Usage (from the backend/ directory, with the same virtualenv you use to
run the app):

    python seed_demo_data.py

Optional: pass a different CSV path as the first argument, e.g.

    python seed_demo_data.py data/my_other_dataset.csv
"""

import csv
import os
import sys

# Ensure `import db` works regardless of the caller's current working
# directory (e.g. running `python backend/seed_demo_data.py` from the repo
# root instead of `cd backend && python seed_demo_data.py`).
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import db  # noqa: E402  (see sys.path adjustment above)

DEFAULT_CSV_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "sample_projects.csv")

# Columns in the CSV that must be parsed as numbers rather than left as
# strings, so they land in SQLite's REAL columns the same way a value
# coming through POST /api/upload would.
_NUMERIC_FIELDS = ["sanctionedAmount", "expenditure", "physicalProgress", "paymentCount", "latitude", "longitude"]


def _to_float_or_none(value):
    if value is None or value == "":
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def load_rows(csv_path: str) -> list:
    with open(csv_path, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        rows = []
        for raw in reader:
            project = {col: raw.get(col) for col in db.PROJECT_COLUMNS if col in raw}
            for field in _NUMERIC_FIELDS:
                if field in project:
                    project[field] = _to_float_or_none(project[field])
            # Not present in the CSV — every seeded project starts
            # unflagged, exactly like a freshly imported real project.
            project.setdefault("duplicateFlag", False)
            rows.append(project)
        return rows


def main():
    csv_path = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_CSV_PATH
    if not os.path.isfile(csv_path):
        print(f"[seed] CSV file not found: {csv_path}")
        sys.exit(1)

    # Idempotent, just like the app's own startup call — safe to run this
    # script before the backend has ever been started.
    db.init_db()

    rows = load_rows(csv_path)
    if not rows:
        print(f"[seed] {csv_path} has no rows — nothing to seed.")
        sys.exit(1)

    existing_ids = {p["id"] for p in db.list_projects()}

    inserted, skipped = 0, 0
    for project in rows:
        if project.get("id") in existing_ids:
            skipped += 1
            continue
        db.insert_project(project)
        inserted += 1

    total = len(db.list_projects())
    print(
        f"[seed] Seeded {inserted} new demo project(s) into {db.DB_PATH} "
        f"({skipped} already present, skipped). Total projects in database: {total}."
    )


if __name__ == "__main__":
    main()
