# backend/alert_prioritizer.py
"""
MPLADS Alert Prioritization — Milestone 4, Part C.

Builds the unified, prioritized alert list for the Alerts page from
signals already computed elsewhere: the existing rule-based anomalies in
risk_engine.py, plus the compliance / ML / duplicate / predictive /
early-warning signals assembled in monitoring.py.

This module does not persist alerts and does not generate duplicates on
repeated calls — every call recomputes the list fresh from the currently
loaded in-memory project set (see main.py), exactly like every other
endpoint in this API. Existing alert types are kept exactly as they were
(risk_engine.detect_all_anomalies is untouched); this module only adds new
alert entries for signals that didn't previously have one and sorts the
combined list.

Priority order (highest first), per the milestone brief:
    1. RED early warnings
    2. Critical risk
    3. High risk (incl. ORANGE early warnings)
    4. High predicted delay
    5. High predicted cost overrun
    6. Compliance violations
    7. Potential duplicate works
    8. ML anomalies
    9. Everything else (existing rule-based anomalies not covered above,
       e.g. Medium-severity mismatches/payment anomalies)
"""

from typing import Dict, List

import risk_engine as engine

HIGH_DELAY_THRESHOLD = 0.6
HIGH_OVERRUN_THRESHOLD = 0.6


def _priority_rank(alert: dict) -> int:
    alert_type = alert.get("alert_type", "")
    warning_level = alert.get("warning_level")
    risk_level = alert.get("risk_level")

    if alert_type == "Early Warning" and warning_level == "RED":
        return 0
    if risk_level == "Critical":
        return 1
    if risk_level == "High" or (alert_type == "Early Warning" and warning_level == "ORANGE"):
        return 2
    if alert_type == "High Delay Risk":
        return 3
    if alert_type == "High Cost Overrun Risk":
        return 4
    if alert_type == "Compliance Violation":
        return 5
    if alert_type == "Potential Duplicate Work" or "Duplicate" in alert_type:
        return 6
    if alert_type == "ML Anomaly Detected":
        return 7
    return 9


def build_prioritized_alerts(all_projects: List[dict], monitoring_by_id: Dict[str, dict]) -> List[dict]:
    """Assembles the full, prioritized alert list. `monitoring_by_id` should
    be the output of monitoring.build_all_monitoring(all_projects) — passed
    in rather than recomputed here so the (comparatively expensive) ML/
    duplicate/predictive computation only runs once per request."""

    alerts: List[dict] = []
    seen = set()

    def add(project_id, alert_type, severity, description, warning_level=None):
        key = (project_id, alert_type)
        if key in seen or not project_id:
            return
        seen.add(key)
        mon = monitoring_by_id.get(project_id, {})
        risk = mon.get("risk", {})
        proj = mon.get("project", {})
        alerts.append(
            {
                "project_id": project_id,
                "project_name": proj.get("workName"),
                "alert_type": alert_type,
                "severity": severity,
                "risk_score": risk.get("score"),
                "risk_level": risk.get("level"),
                "warning_level": warning_level,
                "state": proj.get("state"),
                "district": proj.get("district"),
                "description": description,
                "recommended_action": (mon.get("early_warning") or {}).get("recommended_action")
                or risk.get("recommended_action")
                or engine.get_recommended_action(severity.title()),
            }
        )

    # 1) Existing rule-based anomalies — behavior unchanged, just reshaped
    #    into the same alert dict used by every other source below.
    for a in engine.detect_all_anomalies(all_projects):
        add(a.get("projectId"), a["type"], a["severity"].upper(), a["message"])

    # 2) New signal-based alerts, additive per project.
    for pid, mon in monitoring_by_id.items():
        ew = mon.get("early_warning") or {}
        if ew.get("early_warning_level") in ("RED", "ORANGE"):
            add(
                pid,
                "Early Warning",
                "CRITICAL" if ew["early_warning_level"] == "RED" else "HIGH",
                "; ".join(ew.get("early_warning_reasons", [])) or "Requires attention.",
                warning_level=ew.get("early_warning_level"),
            )

        compliance = mon.get("compliance") or {}
        if compliance.get("status") in ("NON_COMPLIANT", "REQUIRES_REVIEW"):
            add(
                pid,
                "Compliance Violation",
                "HIGH" if compliance.get("status") == "NON_COMPLIANT" else "MEDIUM",
                f"Compliance status: {compliance.get('status', '').replace('_', ' ').title()} "
                f"(score {compliance.get('score')}/100).",
            )

        ai = mon.get("ai") or {}
        if ai.get("possible_duplicate"):
            matched = ", ".join(ai.get("matched_project_ids") or [])
            add(
                pid,
                "Potential Duplicate Work",
                "HIGH",
                f"{ai.get('duplicate_score')}% text/location/amount similarity to {matched or 'another project'} "
                f"— requires review, not a confirmed duplicate.",
            )
        if ai.get("ml_anomaly_flag"):
            add(
                pid,
                "ML Anomaly Detected",
                "HIGH",
                "Unsupervised ML model (Isolation Forest) flagged this project as a potential "
                "risk indicator — requires investigation.",
            )
        delay_probability = ai.get("delay_probability")
        if delay_probability is not None and delay_probability >= HIGH_DELAY_THRESHOLD:
            add(
                pid,
                "High Delay Risk",
                "HIGH",
                f"Predictive model estimates a {round(delay_probability * 100)}% probability of delay.",
            )
        overrun_probability = ai.get("cost_overrun_probability")
        if overrun_probability is not None and overrun_probability >= HIGH_OVERRUN_THRESHOLD:
            add(
                pid,
                "High Cost Overrun Risk",
                "HIGH",
                f"Predictive model estimates a {round(overrun_probability * 100)}% probability of cost overrun.",
            )

    alerts.sort(key=lambda a: (_priority_rank(a), -(a.get("risk_score") or 0)))

    for idx, a in enumerate(alerts):
        a["alert_id"] = f"ALT-{idx + 1:04d}"

    return alerts
