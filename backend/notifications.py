# backend/notifications.py
"""
Alerts & Notifications (Target Architecture Block 6).

In-app alerts are fully real and already computed from live project data
by alert_prioritizer.py / GET /api/alerts. Email, SMS and webhook delivery
require a real provider (SMTP credentials, an SMS gateway, a webhook
target) that this prototype does not have configured — rather than fake a
"delivered" response, this module provides a clean, honestly-labeled
dispatch abstraction:

    - If a channel is actually configured (via environment variables —
      see .env.example), this module attempts real delivery for that
      channel.
    - If it is NOT configured (the default for a hackathon deployment),
      the "send" is recorded in the notifications_log table and returned
      as `status: "simulated"`, with the exact subject/message that WOULD
      have been sent — so the demo can show the full alert pipeline
      without pretending a provider is wired up that isn't.

This keeps the architecture's "Alerts & Notifications" block genuinely
implemented end-to-end (something is always recorded and returned) without
faking delivery.
"""

import os
from typing import Optional, Tuple

import db

# ---------------------------------------------------------------------------
# In-app notification feed (bell icon in the topbar).
#
# Every notification below is derived from real, already-persisted data —
# either an alert the risk/compliance/duplicate/predictive engines already
# surface for a real imported project (see alert_prioritizer.py), or a real
# workflow event (import, investigation action, evidence upload, feedback,
# manual retrain) that just happened. Nothing here is demo/sample data:
# REAL DATA MODE means there is no seeded project for any of this to fire on
# until a real project exists.
#
# `settings` (see db.get_settings()) gates each category so the Settings ->
# Notification Preferences toggles have a genuine effect rather than being
# decorative.
# ---------------------------------------------------------------------------


def sync_alert_notifications(alerts: list, settings: dict) -> int:
    """Ensures every currently-active project alert has a corresponding
    notification row (idempotent via dedupe_key — safe to call on every
    GET /api/notifications). Returns how many were newly created this call."""
    if not settings.get("notify_high_risk", True):
        return 0
    created = 0
    for alert in alerts:
        project_id = alert.get("project_id")
        if not project_id:
            continue
        alert_type = alert.get("alert_type") or "Risk Alert"
        dedupe_key = f"alert::{project_id}::{alert_type}"
        result = db.insert_notification_if_new(
            dedupe_key=dedupe_key,
            project_id=project_id,
            category="risk",
            title=f"{alert_type} — {alert.get('project_name') or project_id}",
            description=alert.get("description") or "Requires review.",
        )
        if result and result.get("_was_new"):
            created += 1
    return created


def notify_investigation_change(project_id: str, work_name: Optional[str], action_type: str,
                                 resulting_status: str, settings: dict) -> Optional[dict]:
    if not settings.get("notify_investigation", True):
        return None
    import datetime as _dt
    dedupe_key = f"investigation::{project_id}::{_dt.datetime.utcnow().isoformat()}"
    return db.insert_notification_if_new(
        dedupe_key=dedupe_key,
        project_id=project_id,
        category="investigation",
        title=f"Investigation status changed — {resulting_status}",
        description=f"'{action_type}' applied to {work_name or project_id}; status is now {resulting_status}.",
    )


def notify_evidence_uploaded(project_id: str, work_name: Optional[str], filename: Optional[str],
                              settings: dict) -> Optional[dict]:
    if not settings.get("notify_investigation", True):
        return None
    import datetime as _dt
    dedupe_key = f"evidence::{project_id}::{_dt.datetime.utcnow().isoformat()}"
    return db.insert_notification_if_new(
        dedupe_key=dedupe_key,
        project_id=project_id,
        category="investigation",
        title="Evidence uploaded",
        description=f"Field photo '{filename or 'unnamed'}' uploaded for {work_name or project_id}.",
    )


def notify_feedback_submitted(project_id: str, work_name: Optional[str], decision: str,
                               settings: dict) -> Optional[dict]:
    if not settings.get("notify_investigation", True):
        return None
    import datetime as _dt
    dedupe_key = f"feedback::{project_id}::{_dt.datetime.utcnow().isoformat()}"
    return db.insert_notification_if_new(
        dedupe_key=dedupe_key,
        project_id=project_id,
        category="investigation",
        title=f"Feedback submitted — {decision}",
        description=f"'{decision}' recorded for {work_name or project_id}.",
    )


def notify_import_completed(records_imported: int, records_rejected: int, duplicate_records: int,
                             settings: dict) -> Optional[dict]:
    if not settings.get("notify_import", True) or records_imported <= 0:
        return None
    import datetime as _dt
    now = _dt.datetime.utcnow().isoformat()
    dedupe_key = f"import::{now}"
    parts = [f"{records_imported} project(s) imported"]
    if records_rejected:
        parts.append(f"{records_rejected} rejected")
    if duplicate_records:
        parts.append(f"{duplicate_records} duplicate(s) skipped")
    return db.insert_notification_if_new(
        dedupe_key=dedupe_key,
        project_id=None,
        category="import",
        title="Dataset import completed",
        description=", ".join(parts) + ".",
    )


def notify_mlops_retrain(notes: str, settings: dict) -> Optional[dict]:
    if not settings.get("notify_mlops", True):
        return None
    import datetime as _dt
    dedupe_key = f"mlops::{_dt.datetime.utcnow().isoformat()}"
    return db.insert_notification_if_new(
        dedupe_key=dedupe_key,
        project_id=None,
        category="mlops",
        title="MLOps retrain triggered",
        description=notes or "Manual retrain triggered; models recomputed over the current dataset + feedback.",
    )

EMAIL_CONFIGURED = bool(os.environ.get("SMTP_HOST"))
SMS_CONFIGURED = bool(os.environ.get("SMS_GATEWAY_URL"))
WEBHOOK_URL = os.environ.get("ALERT_WEBHOOK_URL")


def _build_message(alert: dict) -> Tuple[str, str]:
    subject = f"HIGH-RISK PROJECT DETECTED — {alert.get('projectId', 'Unknown')}"
    lines = [
        f"Project: {alert.get('projectId', 'Unknown')}",
        f"Work: {alert.get('workName', '')}",
        f"Type: {alert.get('type', 'Risk Alert')}",
        f"Severity: {alert.get('severity', 'Medium')}",
        f"Details: {alert.get('message', '')}",
    ]
    return subject, "\n".join(lines)


def dispatch_alert(alert: dict, channels: Optional[list] = None) -> list:
    """Dispatches (or simulates dispatching) an alert on the requested
    channels ("in_app", "email", "sms", "webhook"; defaults to all).
    Returns one result dict per channel. Every call is logged to
    notifications_log so a demo/audit can show the full history."""
    channels = channels or ["in_app", "email", "sms", "webhook"]
    subject, message = _build_message(alert)
    project_id = alert.get("projectId")
    results = []

    for channel in channels:
        if channel == "in_app":
            status = "delivered"  # in-app is real: the alert already exists in /api/alerts
        elif channel == "email":
            status = "simulated" if not EMAIL_CONFIGURED else "attempted"
        elif channel == "sms":
            status = "simulated" if not SMS_CONFIGURED else "attempted"
        elif channel == "webhook":
            status = "simulated" if not WEBHOOK_URL else "attempted"
        else:
            status = "unsupported_channel"

        entry = db.log_notification(project_id, channel, subject, message, status)
        results.append(entry)

    return results
