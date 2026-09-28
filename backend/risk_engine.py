# backend/risk_engine.py
"""
Deterministic, explainable, rule-based risk & anomaly engine for MPLADS
projects. This is a direct Python port of the existing frontend logic in
frontend/src/utils/riskCalculator.js and frontend/src/utils/anomalyDetector.js
so that the backend and the already-working React UI agree on every score.

No ML model is used here. This is intentionally a transparent, rule-based
prototype so every point awarded is explainable. Isolation Forest / SHAP /
predictive models described in the project brief are a later phase — see the
"FUTURE ML HOOK" note near the bottom of this file for where they would plug
in without disturbing this contract.
"""

import re
from datetime import date, datetime
from typing import Optional

import numpy as np
import pandas as pd

# ---------------------------------------------------------------------------
# Weights & risk bands (kept identical to riskCalculator.js — sums to 100)
# ---------------------------------------------------------------------------

WEIGHTS = {
    "MISMATCH": 25,
    "OVERRUN": 20,
    "DELAY": 15,
    "LOW_PROGRESS": 10,
    "HIGH_UTILIZATION": 10,
    "PAYMENT_ANOMALY": 10,
    "DUPLICATE_WORK": 10,
}

RISK_LEVELS = [
    {"level": "Low", "min": 0, "max": 19},
    {"level": "Moderate", "min": 20, "max": 39},
    {"level": "Medium", "min": 40, "max": 59},
    {"level": "High", "min": 60, "max": 79},
    {"level": "Critical", "min": 80, "max": 100},
]

REQUIRED_IMPORT_COLUMNS = [
    "workName",
    "state",
    "district",
    "sanctionedAmount",
    "expenditure",
    "physicalProgress",
]


def get_risk_level(score: float) -> str:
    for band in RISK_LEVELS:
        if band["min"] <= score <= band["max"]:
            return band["level"]
    return "Low"


def get_recommended_action(level: str) -> str:
    return {
        "Critical": "Immediate verification recommended. Review payment records, work "
        "measurements and implementing agency documentation.",
        "High": "Priority review recommended within the next monitoring cycle.",
        "Medium": "Continue monitoring and verify supporting project records.",
        "Moderate": "Periodic monitoring recommended. No urgent action required at this time.",
        "Low": "No immediate intervention required.",
    }.get(level, "No immediate intervention required.")


def _severity_from_points(points: float, max_points: float) -> str:
    ratio = points / max_points if max_points else 0
    if ratio >= 0.8:
        return "Critical"
    if ratio >= 0.6:
        return "High"
    if ratio >= 0.3:
        return "Medium"
    return "Low"


# ---------------------------------------------------------------------------
# Small numeric / date helpers (mirrors projectUtils.js)
# ---------------------------------------------------------------------------


def calc_financial_progress(expenditure, sanctioned_amount) -> float:
    sanctioned = float(sanctioned_amount or 0)
    spent = float(expenditure or 0)
    if sanctioned <= 0:
        return 0.0
    return round((spent / sanctioned) * 100, 1)


def _parse_date(value) -> Optional[date]:
    if not value or (isinstance(value, float) and np.isnan(value)):
        return None
    if isinstance(value, (date, datetime)):
        return value if isinstance(value, date) and not isinstance(value, datetime) else value.date()
    try:
        return datetime.strptime(str(value)[:10], "%Y-%m-%d").date()
    except ValueError:
        return None


def is_overdue(project: dict) -> bool:
    if not project.get("expectedCompletion"):
        return False
    if project.get("status") == "Completed":
        return False
    due = _parse_date(project.get("expectedCompletion"))
    if due is None:
        return False
    return due < date.today()


def days_overdue(project: dict) -> int:
    if not is_overdue(project):
        return 0
    due = _parse_date(project.get("expectedCompletion"))
    return (date.today() - due).days


def _normalize_text(s: str) -> str:
    s = (s or "").lower()
    s = re.sub(r"[^a-z0-9 ]", "", s)
    s = re.sub(r"\s+", " ", s).strip()
    return s


def _significant_words(s: str) -> set:
    return {w for w in _normalize_text(s).split(" ") if len(w) > 3}


def _find_similar_work(project: dict, all_projects: list) -> Optional[dict]:
    """Same-district/state, high word-overlap work name => likely duplicate."""
    if not all_projects or len(all_projects) < 2:
        return None
    project_words = _significant_words(project.get("workName"))
    for other in all_projects:
        if other.get("id") == project.get("id"):
            continue
        if other.get("district") != project.get("district") or other.get("state") != project.get("state"):
            continue
        other_words = _significant_words(other.get("workName"))
        if not project_words or not other_words:
            continue
        overlap = len(project_words & other_words) / min(len(project_words), len(other_words))
        if overlap >= 0.6:
            return other
    return None


# ---------------------------------------------------------------------------
# Core risk calculator — mirrors calculateRisk() in riskCalculator.js
# ---------------------------------------------------------------------------


def calculate_risk(project: dict, all_projects: Optional[list] = None) -> dict:
    all_projects = all_projects or []
    factors = []
    total = 0.0

    sanctioned = float(project.get("sanctionedAmount") or 0)
    spent = float(project.get("expenditure") or 0)
    physical = float(project.get("physicalProgress") or 0)
    financial = calc_financial_progress(spent, sanctioned)

    # A. Financial vs physical mismatch
    gap = financial - physical
    if gap >= 15:
        ratio = min(gap / 60, 1)
        points = round(ratio * WEIGHTS["MISMATCH"])
        if points > 0:
            total += points
            factors.append(
                {
                    "name": "Financial-Physical Mismatch",
                    "points": points,
                    "severity": _severity_from_points(points, WEIGHTS["MISMATCH"]),
                    "explanation": f"{financial}% of sanctioned funds have been utilized while "
                    f"physical progress is only {physical}%.",
                }
            )

    # B. Cost overrun
    if spent > sanctioned and sanctioned > 0:
        overrun_pct = ((spent - sanctioned) / sanctioned) * 100
        ratio = min(overrun_pct / 40, 1)
        points = round(max(ratio, 0.35) * WEIGHTS["OVERRUN"])
        total += points
        factors.append(
            {
                "name": "Cost Overrun",
                "points": points,
                "severity": _severity_from_points(points, WEIGHTS["OVERRUN"]),
                "explanation": f"Expenditure has exceeded the sanctioned amount by "
                f"{overrun_pct:.1f}% (₹{spent - sanctioned:,.0f} over budget).",
            }
        )

    # C. Implementation delay
    if is_overdue(project):
        overdue_days = days_overdue(project)
        ratio = min(overdue_days / 180, 1)
        points = round(max(ratio, 0.3) * WEIGHTS["DELAY"])
        total += points
        factors.append(
            {
                "name": "Implementation Delay",
                "points": points,
                "severity": _severity_from_points(points, WEIGHTS["DELAY"]),
                "explanation": f"Project is {overdue_days} day(s) past its expected completion "
                f"date and is not marked Completed.",
            }
        )

    # D. Very low physical progress
    if physical < 20 and project.get("status") != "Completed":
        ratio = (20 - physical) / 20
        points = round(ratio * WEIGHTS["LOW_PROGRESS"])
        if points > 0:
            total += points
            factors.append(
                {
                    "name": "Very Low Physical Progress",
                    "points": points,
                    "severity": _severity_from_points(points, WEIGHTS["LOW_PROGRESS"]),
                    "explanation": f"Physical progress stands at only {physical}%, indicating a "
                    f"stalled or barely-started work.",
                }
            )

    # E. High expenditure utilization
    if financial >= 85 and project.get("status") != "Completed":
        ratio = min((financial - 85) / 15 + 0.4, 1)
        points = round(ratio * WEIGHTS["HIGH_UTILIZATION"])
        total += points
        factors.append(
            {
                "name": "High Expenditure Utilization",
                "points": points,
                "severity": _severity_from_points(points, WEIGHTS["HIGH_UTILIZATION"]),
                "explanation": f"{financial}% of sanctioned funds are already utilized while the "
                f"work remains incomplete.",
            }
        )

    # F. Suspicious payment pattern
    payment_count = float(project.get("paymentCount") or 0)
    expected_max_payments = max(3, np.ceil(sanctioned / 500000)) if sanctioned > 0 else 3
    if payment_count > expected_max_payments + 3:
        excess = payment_count - expected_max_payments
        ratio = min(excess / 10, 1)
        points = round(max(ratio, 0.3) * WEIGHTS["PAYMENT_ANOMALY"])
        total += points
        factors.append(
            {
                "name": "Suspicious Payment Pattern",
                "points": points,
                "severity": _severity_from_points(points, WEIGHTS["PAYMENT_ANOMALY"]),
                "explanation": f"{int(payment_count)} separate payment transactions were "
                f"recorded — unusually fragmented for a work of this value.",
            }
        )

    # G. Duplicate / similar work indicator
    similar = _find_similar_work(project, all_projects)
    if similar:
        total += WEIGHTS["DUPLICATE_WORK"]
        factors.append(
            {
                "name": "Duplicate/Similar Work Indicator",
                "points": WEIGHTS["DUPLICATE_WORK"],
                "severity": "High",
                "explanation": f'A similarly named work ("{similar.get("workName")}") exists in '
                f'the same district ({similar.get("id")}), suggesting possible duplicate fund '
                f"claims.",
            }
        )

    score = min(round(total), 100)
    level = get_risk_level(score)

    if not factors:
        explanation = "No significant risk indicators detected. Project is progressing within normal parameters."
    else:
        top = sorted(factors, key=lambda f: f["points"], reverse=True)[:2]
        explanation = f"Risk driven primarily by: {' and '.join(f['name'].lower() for f in top)}."

    return {"score": score, "level": level, "factors": factors, "explanation": explanation}


# ---------------------------------------------------------------------------
# Anomaly detection — mirrors anomalyDetector.js
# ---------------------------------------------------------------------------


def detect_project_anomalies(project: dict) -> list:
    anomalies = []
    sanctioned = float(project.get("sanctionedAmount") or 0)
    spent = float(project.get("expenditure") or 0)
    physical = float(project.get("physicalProgress") or 0)
    financial = calc_financial_progress(spent, sanctioned)

    if spent > sanctioned:
        anomalies.append(
            {
                "type": "Cost Overrun",
                "severity": "Critical" if spent > sanctioned * 1.2 else "High",
                "message": f"Expenditure (₹{spent:,.0f}) exceeds sanctioned amount (₹{sanctioned:,.0f}).",
            }
        )

    gap = financial - physical
    if gap >= 25:
        anomalies.append(
            {
                "type": "Financial-Physical Mismatch",
                "severity": "Critical" if gap >= 45 else "High",
                "message": f"Financial progress ({financial}%) is {gap:.0f} points ahead of "
                f"physical progress ({physical}%).",
            }
        )

    payment_count = float(project.get("paymentCount") or 0)
    expected_max_payments = max(3, np.ceil(sanctioned / 500000)) if sanctioned > 0 else 3
    if payment_count > expected_max_payments + 3:
        anomalies.append(
            {
                "type": "Unusual Payment Frequency",
                "severity": "Critical" if payment_count > expected_max_payments + 7 else "Medium",
                "message": f"{int(payment_count)} payment transactions recorded, above the "
                f"{int(expected_max_payments)} expected for a work of this value.",
            }
        )

    if is_overdue(project):
        days = days_overdue(project)
        severity = "Critical" if days > 120 else "High" if days > 45 else "Medium"
        anomalies.append(
            {
                "type": "Delayed Project",
                "severity": severity,
                "message": f"Project is {days} day(s) past its expected completion date.",
            }
        )

    if physical < 15 and project.get("status") != "Completed":
        anomalies.append(
            {
                "type": "Stalled Physical Progress",
                "severity": "Critical" if physical == 0 else "Medium",
                "message": f"Physical progress is only {physical}% — work may be stalled or not "
                f"yet started.",
            }
        )

    if project.get("duplicateFlag"):
        anomalies.append(
            {
                "type": "Duplicate Work Flag",
                "severity": "High",
                "message": "This work has been flagged as potentially duplicating another "
                "sanctioned work.",
            }
        )

    return anomalies


def detect_duplicate_works(all_projects: list) -> list:
    pairs = []
    seen = set()
    for i in range(len(all_projects)):
        for j in range(i + 1, len(all_projects)):
            a, b = all_projects[i], all_projects[j]
            if a.get("district") != b.get("district") or a.get("state") != b.get("state"):
                continue
            wa, wb = _significant_words(a.get("workName")), _significant_words(b.get("workName"))
            if not wa or not wb:
                continue
            overlap = len(wa & wb) / min(len(wa), len(wb))
            pair_key = "::".join(sorted([a["id"], b["id"]]))
            if overlap >= 0.6 and pair_key not in seen:
                seen.add(pair_key)
                pairs.append(
                    {
                        "type": "Duplicate/Similar Work",
                        "severity": "High",
                        "message": f'"{a.get("workName")}" ({a["id"]}) and "{b.get("workName")}" '
                        f'({b["id"]}) in {a.get("district")}, {a.get("state")} appear to be '
                        f"similar or duplicate works.",
                        "projectIds": [a["id"], b["id"]],
                    }
                )
    return pairs


def detect_all_anomalies(all_projects: list) -> list:
    results = []
    for project in all_projects:
        for a in detect_project_anomalies(project):
            results.append({**a, "projectId": project["id"], "workName": project.get("workName", "")})
    for d in detect_duplicate_works(all_projects):
        results.append({**d, "projectId": d["projectIds"][0], "workName": ""})
    return results


def find_duplicate_matches(project: dict, all_projects: list) -> list:
    """Per-project similarity list with matched fields, used for report/detail views."""
    project_words = _significant_words(project.get("workName"))
    matches = []
    for other in all_projects:
        if other.get("id") == project.get("id"):
            continue
        if other.get("district") != project.get("district") or other.get("state") != project.get("state"):
            continue
        other_words = _significant_words(other.get("workName"))
        if not project_words or not other_words:
            continue
        overlap = len(project_words & other_words) / min(len(project_words), len(other_words))
        if overlap < 0.4:
            continue
        matched_fields = ["Work Name", "District"]
        if project.get("category") and other.get("category") == project.get("category"):
            matched_fields.append("Category")
        sanctioned = float(project.get("sanctionedAmount") or 0)
        other_sanctioned = float(other.get("sanctionedAmount") or 0)
        amount_bonus = 0
        if sanctioned > 0 and other_sanctioned > 0:
            diff_ratio = abs(sanctioned - other_sanctioned) / max(sanctioned, other_sanctioned)
            if diff_ratio <= 0.15:
                matched_fields.append("Sanctioned Amount")
                amount_bonus = 5
        similarity = min(100, round(overlap * 90 + amount_bonus))
        matches.append({"project": other, "similarity": similarity, "matchedFields": matched_fields})
    return sorted(matches, key=lambda m: m["similarity"], reverse=True)


# ---------------------------------------------------------------------------
# Project ID generation — mirrors generateProjectId() in projectUtils.js
# ---------------------------------------------------------------------------


def generate_project_id(existing_projects: list, year: Optional[int] = None) -> str:
    year = year or date.today().year
    prefix = f"MPLADS-{year}-"
    max_seq = 0
    for p in existing_projects:
        pid = p.get("id") or ""
        if pid.startswith(prefix):
            try:
                seq = int(pid[len(prefix):])
                max_seq = max(max_seq, seq)
            except ValueError:
                continue
    existing_ids = {p.get("id") for p in existing_projects}
    next_seq = max_seq + 1
    candidate = f"{prefix}{next_seq:04d}"
    while candidate in existing_ids:
        next_seq += 1
        candidate = f"{prefix}{next_seq:04d}"
    return candidate


# ---------------------------------------------------------------------------
# CSV import normalization/validation — mirrors normalizeImportedRow() /
# validateImportedRow() in projectUtils.js, implemented with pandas.
# ---------------------------------------------------------------------------

_COLUMN_ALIASES = {
    "workName": ["workname", "work name", "work_name", "project name"],
    "mpName": ["mpname", "mp name", "mp_name", "member of parliament"],
    "constituency": ["constituency"],
    "state": ["state"],
    "district": ["district"],
    "category": ["category", "work category", "work_category"],
    "sanctionedAmount": ["sanctionedamount", "sanctioned amount", "sanctioned_amount"],
    "expenditure": ["expenditure", "expenditure amount"],
    "physicalProgress": ["physicalprogress", "physical progress", "physical_progress"],
    "status": ["status"],
    "startDate": ["startdate", "start date", "start_date"],
    "expectedCompletion": ["expectedcompletion", "expected completion", "expected_completion"],
    "implementingAgency": ["implementingagency", "implementing agency", "implementing_agency"],
    "paymentCount": ["paymentcount", "payment count", "payments"],
    "id": ["id", "project id", "project_id"],
    "latitude": ["latitude", "lat"],
    "longitude": ["longitude", "lon", "lng", "long"],
}


def _to_float_or_none(value):
    """Best-effort float conversion for optional numeric fields (currently
    latitude/longitude) that must NOT be defaulted to 0 or fabricated —
    an absent or unparsable value stays None rather than becoming a fake
    coordinate (Real Data Mode requirement, see geo.py)."""
    if value is None or value == "":
        return None
    try:
        f = float(value)
    except (TypeError, ValueError):
        return None
    if np.isnan(f):
        return None
    return f


def _find_column(row_keys_lower: dict, target: str):
    for alias in _COLUMN_ALIASES[target]:
        if alias in row_keys_lower:
            return row_keys_lower[alias]
    return None


def normalize_imported_row(row: dict) -> dict:
    row_keys_lower = {str(k).strip().lower(): k for k in row.keys()}

    def get(target, default=None):
        col = _find_column(row_keys_lower, target)
        if col is None:
            return default
        val = row.get(col)
        if val is None or (isinstance(val, float) and np.isnan(val)) or val == "":
            return default
        return val

    return {
        "id": get("id"),
        "workName": get("workName", "Untitled Work"),
        "mpName": get("mpName", "Unknown MP"),
        "constituency": get("constituency", "Unknown"),
        "state": get("state", "Unknown"),
        "district": get("district", "Unknown"),
        "category": get("category", "General"),
        "sanctionedAmount": float(get("sanctionedAmount", 0) or 0),
        "expenditure": float(get("expenditure", 0) or 0),
        "physicalProgress": float(get("physicalProgress", 0) or 0),
        "status": get("status", "In Progress"),
        "startDate": get("startDate"),
        "expectedCompletion": get("expectedCompletion"),
        "implementingAgency": get("implementingAgency", "Not Specified"),
        "paymentCount": float(get("paymentCount", 3) or 3),
        # Real GPS coordinates ONLY if the source file actually carries
        # them — never fabricated here. Stays None when absent/invalid so
        # geo.py can honestly report "Location unavailable" instead of
        # inventing a point (Real Data Mode requirement).
        "latitude": _to_float_or_none(get("latitude")),
        "longitude": _to_float_or_none(get("longitude")),
    }


def validate_imported_row(row: dict) -> tuple:
    errors = []
    if not row.get("workName") or row["workName"] == "Untitled Work":
        errors.append("Missing work name")
    if not row.get("state") or row["state"] == "Unknown":
        errors.append("Missing state")
    if not row.get("district") or row["district"] == "Unknown":
        errors.append("Missing district")
    if not row.get("sanctionedAmount") or row["sanctionedAmount"] <= 0:
        errors.append("Invalid sanctioned amount")
    if row.get("physicalProgress", 0) < 0 or row.get("physicalProgress", 0) > 100:
        errors.append("Physical progress out of range")
    return (len(errors) == 0, errors)


def enrich_project(project: dict, all_projects: list) -> dict:
    """Attaches riskScore/riskLevel/riskFactors/riskExplanation to a project,
    matching the shape the frontend already expects from its own enrichment
    step (see frontend/src/App.jsx)."""
    risk = calculate_risk(project, all_projects)
    return {
        **project,
        "financialProgress": calc_financial_progress(
            project.get("expenditure"), project.get("sanctionedAmount")
        ),
        "riskScore": risk["score"],
        "riskLevel": risk["level"],
        "riskFactors": risk["factors"],
        "riskExplanation": risk["explanation"],
    }


# ---------------------------------------------------------------------------
# ML HOOK — implemented in Milestone 2
# ---------------------------------------------------------------------------
# The Isolation Forest anomaly detector anticipated here now lives in
# ml_anomaly.py (trained on financial/physical gap, utilization ratio,
# cost-overrun ratio, payment count, duration and overdue days), and an
# improved TF-IDF-based duplicate/similar-work detector lives in
# duplicate_detector.py. Both are intentionally kept OUT of this file: they
# are additive signals exposed via their own endpoints
# (/api/projects/{id}/anomaly, /api/projects/{id}/duplicates) and never
# overwrite or feed back into calculate_risk() above, so the existing,
# explainable rule-based risk score is unaffected. SHAP-based explanation of
# the Isolation Forest is still a later phase — not implemented here.
