# backend/db.py
"""
Lightweight persistent data store (Target Architecture Block 5: Backend &
Services -> Data Store).

Uses Python's built-in `sqlite3` module ONLY — no new dependency, no extra
infra to deploy. Replaces the previous purely in-memory project list so the
application survives a server restart, and adds the tables needed for the
investigation workflow, feedback capture and field-photo evidence that the
in-memory prototype did not persist at all.

Design notes:
- One file, `data/mplads.db` by default (override with the DB_PATH env
  var) — trivial to back up, inspect (`sqlite3 data/mplads.db`), or reset
  by deleting the file.
- `init_db()` is idempotent and safe to call on every startup: it creates
  tables only if they don't already exist.
- REAL DATA MODE: no sample/demo data is ever auto-seeded into the
  `projects` table. A freshly created database starts with zero projects.
  The database is always the source of truth — every project arrives via
  POST /api/upload or POST /api/projects, and it (plus every investigation/
  feedback/evidence record) survives a restart.
- This intentionally stays a simple table-per-concern schema. No ORM, no
  migrations framework — reasonable for a hackathon prototype that must be
  easy to run on a bare virtual server.
"""

import json
import os
import sqlite3
import threading
from contextlib import contextmanager
from datetime import datetime
from typing import List, Optional

DB_PATH = os.environ.get("DB_PATH", os.path.join(os.path.dirname(__file__), "data", "mplads.db"))

_lock = threading.Lock()

PROJECT_COLUMNS = [
    "id", "workName", "mpName", "constituency", "state", "district", "category",
    "sanctionedAmount", "expenditure", "physicalProgress", "status", "startDate",
    "expectedCompletion", "implementingAgency", "paymentCount", "duplicateFlag",
    "latitude", "longitude",
]


def _connect() -> sqlite3.Connection:
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    conn = sqlite3.connect(DB_PATH, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


@contextmanager
def _cursor():
    """Serializes access with a process-wide lock — this is a small
    single-process prototype, not a high-concurrency service, so a simple
    lock around sqlite3 (which is not thread-safe across connections by
    default) is the right amount of complexity here."""
    with _lock:
        conn = _connect()
        try:
            cur = conn.cursor()
            yield cur
            conn.commit()
        finally:
            conn.close()


def init_db() -> None:
    with _cursor() as cur:
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS projects (
                id TEXT PRIMARY KEY,
                workName TEXT,
                mpName TEXT,
                constituency TEXT,
                state TEXT,
                district TEXT,
                category TEXT,
                sanctionedAmount REAL,
                expenditure REAL,
                physicalProgress REAL,
                status TEXT,
                startDate TEXT,
                expectedCompletion TEXT,
                implementingAgency TEXT,
                paymentCount REAL,
                duplicateFlag INTEGER DEFAULT 0,
                latitude REAL,
                longitude REAL,
                created_at TEXT
            )
            """
        )
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS investigations (
                project_id TEXT PRIMARY KEY,
                status TEXT NOT NULL DEFAULT 'Open',
                updated_at TEXT,
                FOREIGN KEY(project_id) REFERENCES projects(id)
            )
            """
        )
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS investigation_actions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                project_id TEXT NOT NULL,
                action_type TEXT NOT NULL,
                role TEXT,
                remarks TEXT,
                resulting_status TEXT,
                created_at TEXT NOT NULL
            )
            """
        )
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS feedback (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                project_id TEXT NOT NULL,
                decision TEXT NOT NULL,
                remarks TEXT,
                role TEXT,
                risk_score REAL,
                signal_snapshot TEXT,
                created_at TEXT NOT NULL
            )
            """
        )
        # Migration-safe: a database created before risk_score/signal_snapshot
        # existed just gets the columns added; a fresh database already has
        # them from the CREATE TABLE above, so this is a no-op there.
        existing_feedback_cols = {row["name"] for row in cur.execute("PRAGMA table_info(feedback)").fetchall()}
        if "risk_score" not in existing_feedback_cols:
            cur.execute("ALTER TABLE feedback ADD COLUMN risk_score REAL")
        if "signal_snapshot" not in existing_feedback_cols:
            cur.execute("ALTER TABLE feedback ADD COLUMN signal_snapshot TEXT")

        # ---------------------------------------------------------------
        # MLOps model registry (Priority: real model versioning) — one row
        # per named model (e.g. "anomaly_detector"), holding its CURRENT
        # metadata. History of every past version lives in
        # `retraining_history` below; this table only ever holds the latest
        # state, so the MLOps dashboard can show "Active Model" with a
        # single lookup.
        # ---------------------------------------------------------------
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS model_metadata (
                model_name TEXT PRIMARY KEY,
                model_version TEXT NOT NULL,
                model_type TEXT NOT NULL,
                trained_at TEXT NOT NULL,
                training_records INTEGER NOT NULL DEFAULT 0,
                feedback_used INTEGER NOT NULL DEFAULT 0,
                features_used TEXT,
                model_status TEXT NOT NULL DEFAULT 'Active',
                calibration_params TEXT,
                updated_at TEXT NOT NULL
            )
            """
        )
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS retraining_history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                model_name TEXT NOT NULL,
                version TEXT NOT NULL,
                timestamp TEXT NOT NULL,
                records_used INTEGER NOT NULL DEFAULT 0,
                feedback_used INTEGER NOT NULL DEFAULT 0,
                trigger TEXT,
                status TEXT NOT NULL,
                notes TEXT
            )
            """
        )
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS evidence (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                project_id TEXT NOT NULL,
                kind TEXT NOT NULL,
                original_filename TEXT,
                stored_filename TEXT,
                content_type TEXT,
                size_bytes INTEGER,
                width INTEGER,
                height INTEGER,
                avg_hash TEXT,
                quality_score REAL,
                quality_notes TEXT,
                near_duplicate_of INTEGER,
                similarity_score REAL,
                uploaded_at TEXT NOT NULL
            )
            """
        )
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS mlops_events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                event_type TEXT NOT NULL,
                notes TEXT,
                created_at TEXT NOT NULL
            )
            """
        )
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS notifications_log (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                project_id TEXT,
                channel TEXT NOT NULL,
                subject TEXT,
                message TEXT,
                status TEXT NOT NULL,
                created_at TEXT NOT NULL
            )
            """
        )
        # In-app notification feed (bell icon). Distinct from notifications_log
        # above, which is the email/SMS/webhook dispatch-attempt audit log for
        # a single alert. This table holds the actual items the user sees in
        # the notification panel, generated only from real project data/events
        # — see notifications.py for what creates rows here. `dedupe_key` lets
        # a recurring condition (e.g. "Project X is High risk") be synced
        # repeatedly without ever creating a second row for the same
        # underlying condition.
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS notifications (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                dedupe_key TEXT UNIQUE NOT NULL,
                project_id TEXT,
                category TEXT NOT NULL,
                title TEXT NOT NULL,
                description TEXT,
                is_read INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL
            )
            """
        )
        # Single-row settings table (id is always 1) — a hackathon prototype
        # is single-tenant/single-session, so one row is enough. Profile
        # fields and notification toggles are genuinely persisted server-side
        # (they affect what notifications.py generates); display preferences
        # are also mirrored here for convenience but the frontend is free to
        # keep those in localStorage per-browser instead.
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS app_settings (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                profile_name TEXT NOT NULL DEFAULT 'Admin Officer',
                profile_role TEXT NOT NULL DEFAULT 'Ministry / Admin',
                profile_org TEXT NOT NULL DEFAULT 'MPLADS Cell',
                notify_high_risk INTEGER NOT NULL DEFAULT 1,
                notify_investigation INTEGER NOT NULL DEFAULT 1,
                notify_import INTEGER NOT NULL DEFAULT 1,
                notify_mlops INTEGER NOT NULL DEFAULT 1,
                default_map_view TEXT,
                default_risk_filter TEXT,
                last_import_at TEXT,
                updated_at TEXT
            )
            """
        )
        # ---------------------------------------------------------------
        # Users (simple backend-verified prototype authentication — see
        # backend/auth.py). Passwords are never stored in plaintext, only
        # a salted PBKDF2-HMAC-SHA256 hash. This table holds only the 4
        # seeded demo accounts (one per role in workflow.ROLES); there is
        # no self-registration endpoint, by design, for a prototype.
        # ---------------------------------------------------------------
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS users (
                username TEXT PRIMARY KEY,
                password_hash TEXT NOT NULL,
                role TEXT NOT NULL,
                display_name TEXT,
                identifier TEXT,
                created_at TEXT NOT NULL
            )
            """
        )


def _row_to_project(row: sqlite3.Row) -> dict:
    d = {k: row[k] for k in row.keys() if k not in ("created_at",)}
    d["duplicateFlag"] = bool(d.get("duplicateFlag"))
    return d


def list_projects() -> List[dict]:
    with _cursor() as cur:
        cur.execute("SELECT * FROM projects ORDER BY created_at ASC")
        return [_row_to_project(r) for r in cur.fetchall()]


def get_project(project_id: str) -> Optional[dict]:
    with _cursor() as cur:
        cur.execute("SELECT * FROM projects WHERE id = ?", (project_id,))
        row = cur.fetchone()
        return _row_to_project(row) if row else None


def insert_project(project: dict) -> None:
    with _cursor() as cur:
        cur.execute(
            f"""INSERT INTO projects ({", ".join(PROJECT_COLUMNS)}, created_at)
                VALUES ({", ".join(["?"] * (len(PROJECT_COLUMNS) + 1))})""",
            [project.get(c) if c != "duplicateFlag" else int(bool(project.get(c)))
             for c in PROJECT_COLUMNS] + [datetime.utcnow().isoformat() + "Z"],
        )


def insert_projects_bulk(projects: List[dict]) -> None:
    for p in projects:
        insert_project(p)


# ---------------------------------------------------------------------------
# Investigation workflow
# ---------------------------------------------------------------------------

VALID_STATUSES = ["Open", "Under Verification", "Action Taken", "Closed"]


def get_investigation(project_id: str) -> dict:
    with _cursor() as cur:
        cur.execute("SELECT * FROM investigations WHERE project_id = ?", (project_id,))
        row = cur.fetchone()
        if row is None:
            return {"project_id": project_id, "status": "Open", "updated_at": None}
        return dict(row)


def _set_status(cur, project_id: str, status: str) -> None:
    now = datetime.utcnow().isoformat() + "Z"
    cur.execute(
        """INSERT INTO investigations (project_id, status, updated_at) VALUES (?, ?, ?)
           ON CONFLICT(project_id) DO UPDATE SET status = excluded.status, updated_at = excluded.updated_at""",
        (project_id, status, now),
    )


def record_action(project_id: str, action_type: str, role: Optional[str], remarks: Optional[str],
                   resulting_status: str) -> dict:
    now = datetime.utcnow().isoformat() + "Z"
    with _cursor() as cur:
        cur.execute(
            """INSERT INTO investigation_actions
               (project_id, action_type, role, remarks, resulting_status, created_at)
               VALUES (?, ?, ?, ?, ?, ?)""",
            (project_id, action_type, role, remarks, resulting_status, now),
        )
        _set_status(cur, project_id, resulting_status)
    return {"project_id": project_id, "action_type": action_type, "role": role,
            "remarks": remarks, "resulting_status": resulting_status, "created_at": now}


def get_action_history(project_id: str) -> List[dict]:
    with _cursor() as cur:
        cur.execute(
            "SELECT * FROM investigation_actions WHERE project_id = ? ORDER BY created_at ASC",
            (project_id,),
        )
        return [dict(r) for r in cur.fetchall()]


def get_all_investigations() -> List[dict]:
    with _cursor() as cur:
        cur.execute("SELECT * FROM investigations")
        return [dict(r) for r in cur.fetchall()]


# ---------------------------------------------------------------------------
# Feedback
# ---------------------------------------------------------------------------


def insert_feedback(project_id: str, decision: str, remarks: Optional[str], role: Optional[str],
                     risk_score: Optional[float] = None, signal_snapshot: Optional[dict] = None) -> dict:
    """`risk_score` / `signal_snapshot` capture what the system believed
    about this project AT THE MOMENT the officer gave feedback (e.g. the
    multi-signal risk score and the ml anomaly score/level then in effect).
    Without this snapshot, a later change to the underlying data would make
    it impossible to tell whether a "Confirmed Issue" label was agreeing
    with a genuinely high-risk score or a since-changed one — so it's
    captured once, at feedback time, and never recomputed."""
    now = datetime.utcnow().isoformat() + "Z"
    snapshot_json = json.dumps(signal_snapshot) if signal_snapshot is not None else None
    with _cursor() as cur:
        cur.execute(
            """INSERT INTO feedback (project_id, decision, remarks, role, risk_score, signal_snapshot, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?)""",
            (project_id, decision, remarks, role, risk_score, snapshot_json, now),
        )
        new_id = cur.lastrowid
    return {"id": new_id, "project_id": project_id, "decision": decision, "remarks": remarks,
            "role": role, "risk_score": risk_score, "signal_snapshot": signal_snapshot, "created_at": now}


def _row_to_feedback(row: sqlite3.Row) -> dict:
    d = dict(row)
    raw_snapshot = d.get("signal_snapshot")
    if raw_snapshot:
        try:
            d["signal_snapshot"] = json.loads(raw_snapshot)
        except (TypeError, ValueError):
            d["signal_snapshot"] = None
    else:
        d["signal_snapshot"] = None
    return d


def list_feedback(project_id: Optional[str] = None) -> List[dict]:
    with _cursor() as cur:
        if project_id:
            cur.execute("SELECT * FROM feedback WHERE project_id = ? ORDER BY created_at DESC", (project_id,))
        else:
            cur.execute("SELECT * FROM feedback ORDER BY created_at DESC")
        return [_row_to_feedback(r) for r in cur.fetchall()]


# ---------------------------------------------------------------------------
# MLOps model registry — persistent metadata for the "Active Model" shown on
# the MLOps dashboard, plus a full retraining/update history. See
# mlops_engine.py for the logic that decides WHEN to write a new row here;
# this module only persists whatever it's told.
# ---------------------------------------------------------------------------


def _row_to_model_metadata(row: sqlite3.Row) -> dict:
    d = dict(row)
    for key in ("features_used", "calibration_params"):
        raw = d.get(key)
        if raw:
            try:
                d[key] = json.loads(raw)
            except (TypeError, ValueError):
                d[key] = None
        else:
            d[key] = None
    return d


def get_model_metadata(model_name: str) -> Optional[dict]:
    with _cursor() as cur:
        cur.execute("SELECT * FROM model_metadata WHERE model_name = ?", (model_name,))
        row = cur.fetchone()
        return _row_to_model_metadata(row) if row else None


def upsert_model_metadata(model_name: str, model_version: str, model_type: str,
                           training_records: int, feedback_used: int,
                           features_used: Optional[list] = None, model_status: str = "Active",
                           calibration_params: Optional[dict] = None) -> dict:
    now = datetime.utcnow().isoformat() + "Z"
    features_json = json.dumps(features_used) if features_used is not None else None
    calibration_json = json.dumps(calibration_params) if calibration_params is not None else None
    with _cursor() as cur:
        cur.execute(
            """INSERT INTO model_metadata
               (model_name, model_version, model_type, trained_at, training_records,
                feedback_used, features_used, model_status, calibration_params, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT(model_name) DO UPDATE SET
                 model_version = excluded.model_version,
                 model_type = excluded.model_type,
                 trained_at = excluded.trained_at,
                 training_records = excluded.training_records,
                 feedback_used = excluded.feedback_used,
                 features_used = excluded.features_used,
                 model_status = excluded.model_status,
                 calibration_params = excluded.calibration_params,
                 updated_at = excluded.updated_at""",
            (model_name, model_version, model_type, now, training_records, feedback_used,
             features_json, model_status, calibration_json, now),
        )
    return get_model_metadata(model_name)


def insert_retraining_history(model_name: str, version: str, records_used: int, feedback_used: int,
                               trigger: str, status: str, notes: Optional[str] = None) -> dict:
    now = datetime.utcnow().isoformat() + "Z"
    with _cursor() as cur:
        cur.execute(
            """INSERT INTO retraining_history
               (model_name, version, timestamp, records_used, feedback_used, trigger, status, notes)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
            (model_name, version, now, records_used, feedback_used, trigger, status, notes),
        )
        new_id = cur.lastrowid
    return {"id": new_id, "model_name": model_name, "version": version, "timestamp": now,
            "records_used": records_used, "feedback_used": feedback_used, "trigger": trigger,
            "status": status, "notes": notes}


def get_retraining_history(model_name: Optional[str] = None, limit: int = 50) -> List[dict]:
    with _cursor() as cur:
        if model_name:
            cur.execute(
                "SELECT * FROM retraining_history WHERE model_name = ? ORDER BY id DESC LIMIT ?",
                (model_name, limit),
            )
        else:
            cur.execute("SELECT * FROM retraining_history ORDER BY id DESC LIMIT ?", (limit,))
        return [dict(r) for r in cur.fetchall()]


# ---------------------------------------------------------------------------
# Evidence (field photos / documents)
# ---------------------------------------------------------------------------


def insert_evidence(record: dict) -> dict:
    now = datetime.utcnow().isoformat() + "Z"
    with _cursor() as cur:
        cur.execute(
            """INSERT INTO evidence
               (project_id, kind, original_filename, stored_filename, content_type, size_bytes,
                width, height, avg_hash, quality_score, quality_notes, near_duplicate_of,
                similarity_score, uploaded_at)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (
                record["project_id"], record["kind"], record.get("original_filename"),
                record.get("stored_filename"), record.get("content_type"), record.get("size_bytes"),
                record.get("width"), record.get("height"), record.get("avg_hash"),
                record.get("quality_score"), record.get("quality_notes"),
                record.get("near_duplicate_of"), record.get("similarity_score"), now,
            ),
        )
        new_id = cur.lastrowid
    return {**record, "id": new_id, "uploaded_at": now}


def list_evidence(project_id: Optional[str] = None) -> List[dict]:
    with _cursor() as cur:
        if project_id:
            cur.execute("SELECT * FROM evidence WHERE project_id = ? ORDER BY uploaded_at DESC", (project_id,))
        else:
            cur.execute("SELECT * FROM evidence ORDER BY uploaded_at DESC")
        return [dict(r) for r in cur.fetchall()]


def all_image_hashes(exclude_project_id: Optional[str] = None) -> List[dict]:
    """Every stored image's perceptual hash, for near-duplicate comparison
    against a newly uploaded photo — optionally excluding one project's own
    prior uploads (comparing a project's evidence against itself is not
    useful)."""
    with _cursor() as cur:
        cur.execute("SELECT id, project_id, avg_hash, stored_filename FROM evidence WHERE kind = 'image' AND avg_hash IS NOT NULL")
        rows = [dict(r) for r in cur.fetchall()]
    if exclude_project_id:
        rows = [r for r in rows if r["project_id"] != exclude_project_id]
    return rows


# ---------------------------------------------------------------------------
# MLOps event log (manual retrain trigger, etc.)
# ---------------------------------------------------------------------------


def log_mlops_event(event_type: str, notes: str = "") -> dict:
    now = datetime.utcnow().isoformat() + "Z"
    with _cursor() as cur:
        cur.execute(
            "INSERT INTO mlops_events (event_type, notes, created_at) VALUES (?, ?, ?)",
            (event_type, notes, now),
        )
        new_id = cur.lastrowid
    return {"id": new_id, "event_type": event_type, "notes": notes, "created_at": now}


def last_mlops_event(event_type: Optional[str] = None) -> Optional[dict]:
    with _cursor() as cur:
        if event_type:
            cur.execute(
                "SELECT * FROM mlops_events WHERE event_type = ? ORDER BY created_at DESC LIMIT 1",
                (event_type,),
            )
        else:
            cur.execute("SELECT * FROM mlops_events ORDER BY created_at DESC LIMIT 1")
        row = cur.fetchone()
        return dict(row) if row else None


# ---------------------------------------------------------------------------
# Notification log (email/SMS/webhook prototype dispatch — see notifications.py)
# ---------------------------------------------------------------------------


def log_notification(project_id: Optional[str], channel: str, subject: str, message: str, status: str) -> dict:
    now = datetime.utcnow().isoformat() + "Z"
    with _cursor() as cur:
        cur.execute(
            """INSERT INTO notifications_log (project_id, channel, subject, message, status, created_at)
               VALUES (?, ?, ?, ?, ?, ?)""",
            (project_id, channel, subject, message, status, now),
        )
        new_id = cur.lastrowid
    return {"id": new_id, "project_id": project_id, "channel": channel, "subject": subject,
            "message": message, "status": status, "created_at": now}


# ---------------------------------------------------------------------------
# In-app notifications (bell icon) — see notifications.py for what creates
# these and why. Every row here is either an alert already surfaced by the
# real risk engine, or a genuine workflow event (import, investigation
# action, evidence upload, feedback, retrain) — never synthetic/demo data.
# ---------------------------------------------------------------------------


def _row_to_notification(row: sqlite3.Row) -> dict:
    d = dict(row)
    d["is_read"] = bool(d.get("is_read"))
    return d


def insert_notification_if_new(dedupe_key: str, project_id: Optional[str], category: str,
                                title: str, description: str) -> dict:
    """Inserts a notification unless one with the same dedupe_key already
    exists (e.g. the same project already has an open "High risk" alert),
    in which case the existing row is returned unchanged. This is what lets
    /api/notifications re-sync on every call without ever duplicating an
    already-surfaced condition."""
    now = datetime.utcnow().isoformat() + "Z"
    with _cursor() as cur:
        cur.execute(
            """INSERT INTO notifications (dedupe_key, project_id, category, title, description, is_read, created_at)
               VALUES (?, ?, ?, ?, ?, 0, ?)
               ON CONFLICT(dedupe_key) DO NOTHING""",
            (dedupe_key, project_id, category, title, description, now),
        )
        was_new = cur.rowcount > 0
        cur.execute("SELECT * FROM notifications WHERE dedupe_key = ?", (dedupe_key,))
        row = cur.fetchone()
    if row is None:
        return None
    result = _row_to_notification(row)
    result["_was_new"] = was_new
    return result


def list_notifications(limit: int = 200) -> List[dict]:
    with _cursor() as cur:
        cur.execute("SELECT * FROM notifications ORDER BY created_at DESC, id DESC LIMIT ?", (limit,))
        return [_row_to_notification(r) for r in cur.fetchall()]


def count_unread_notifications() -> int:
    with _cursor() as cur:
        cur.execute("SELECT COUNT(*) AS c FROM notifications WHERE is_read = 0")
        return cur.fetchone()["c"]


def mark_notification_read(notification_id: int) -> Optional[dict]:
    with _cursor() as cur:
        cur.execute("UPDATE notifications SET is_read = 1 WHERE id = ?", (notification_id,))
        if cur.rowcount == 0:
            return None
        cur.execute("SELECT * FROM notifications WHERE id = ?", (notification_id,))
        row = cur.fetchone()
    return _row_to_notification(row) if row else None


def mark_all_notifications_read() -> int:
    with _cursor() as cur:
        cur.execute("UPDATE notifications SET is_read = 1 WHERE is_read = 0")
        return cur.rowcount


# ---------------------------------------------------------------------------
# App settings (Profile / notification preferences / display defaults).
# Single row (id = 1). NOT a real multi-user auth system — see workflow.py's
# prototype role picker and main.py's local-session logout for why.
# ---------------------------------------------------------------------------

_SETTINGS_COLUMNS = [
    "profile_name", "profile_role", "profile_org",
    "notify_high_risk", "notify_investigation", "notify_import", "notify_mlops",
    "default_map_view", "default_risk_filter", "last_import_at",
]


def _row_to_settings(row: sqlite3.Row) -> dict:
    d = dict(row)
    for k in ("notify_high_risk", "notify_investigation", "notify_import", "notify_mlops"):
        d[k] = bool(d.get(k))
    return d


def get_settings() -> dict:
    with _cursor() as cur:
        cur.execute("SELECT * FROM app_settings WHERE id = 1")
        row = cur.fetchone()
        if row is None:
            cur.execute("INSERT INTO app_settings (id) VALUES (1)")
            cur.execute("SELECT * FROM app_settings WHERE id = 1")
            row = cur.fetchone()
    return _row_to_settings(row)


def update_settings(patch: dict) -> dict:
    """Merges `patch` (any subset of _SETTINGS_COLUMNS) into the single
    settings row and returns the full updated settings dict."""
    get_settings()  # ensures the row exists
    fields = {k: v for k, v in patch.items() if k in _SETTINGS_COLUMNS}
    now = datetime.utcnow().isoformat() + "Z"
    if fields:
        set_clause = ", ".join(f"{k} = ?" for k in fields)
        with _cursor() as cur:
            cur.execute(
                f"UPDATE app_settings SET {set_clause}, updated_at = ? WHERE id = 1",
                [*fields.values(), now],
            )
    return get_settings()


# ---------------------------------------------------------------------------
# Users (see backend/auth.py for hashing/JWT logic — this module only
# persists whatever it's given, same pattern as every other table here).
# ---------------------------------------------------------------------------


def get_user(username: str) -> Optional[dict]:
    with _cursor() as cur:
        cur.execute("SELECT * FROM users WHERE username = ?", (username,))
        row = cur.fetchone()
        return dict(row) if row else None


def insert_user(username: str, password_hash: str, role: str,
                 display_name: Optional[str], identifier: Optional[str]) -> dict:
    now = datetime.utcnow().isoformat() + "Z"
    with _cursor() as cur:
        cur.execute(
            """INSERT INTO users (username, password_hash, role, display_name, identifier, created_at)
               VALUES (?, ?, ?, ?, ?, ?)""",
            (username, password_hash, role, display_name, identifier, now),
        )
    return get_user(username)


def record_import_now() -> None:
    now = datetime.utcnow().isoformat() + "Z"
    get_settings()
    with _cursor() as cur:
        cur.execute("UPDATE app_settings SET last_import_at = ? WHERE id = 1", (now,))
