# backend/compliance_engine.py
"""
MPLADS Compliance Engine — Milestone 1.

A modular, rule-based compliance checker for MPLADS projects. This is
intentionally SEPARATE from risk_engine.py:

- risk_engine.py answers "how risky/anomalous does this project look?"
  (fraud/anomaly-oriented, weighted 0-100 risk score).
- compliance_engine.py answers "does this project satisfy the basic
  MPLADS record-keeping and consistency rules we can check from the data
  we actually have?" (governance/data-quality oriented, 0-100 compliance
  score).

The two scores are independent and are NOT combined or used to adjust one
another in this milestone.

Every check below only uses fields that already exist on an imported
project record (see the REQUIRED_IMPORT_COLUMNS / column-alias contract in
backend/risk_engine.py):
    id, workName, mpName, constituency, state, district, category,
    sanctionedAmount, expenditure, physicalProgress, status, startDate,
    expectedCompletion, implementingAgency, paymentCount, duplicateFlag

No field is invented. Where the dataset is insufficient to support a rule
described in the milestone brief exactly as worded, that limitation is
documented in the module docstring section "KNOWN DATA LIMITATIONS" below
and the check is adapted to what is actually available.

KNOWN DATA LIMITATIONS
-----------------------
1. There is no distinct "actual completion date" field — only `startDate`
   and `expectedCompletion` (a target/due date) exist. So "completion date
   should not be before start date" is implemented as an expected-completion
   vs start-date check; a true actual-completion-date check cannot be done
   without that field.
2. There is no field marking a project as an approved/allowed exception for
   exceeding its sanctioned amount (e.g. a supplementary sanction flag), so
   every over-expenditure is flagged. If such a flag is added later
   (e.g. `allowedExceptionFlag`), `_is_overrun_allowed()` below is the single
   place to wire it in.
3. There is no separate "revised/supplementary sanctioned amount" field, so
   utilization is always computed against the single `sanctionedAmount`.

All thresholds/weights are declared in CONFIG below and can be changed
without touching the check logic itself.
"""

from datetime import date, datetime
from typing import Optional

import numpy as np

# ---------------------------------------------------------------------------
# CONFIG — every tunable threshold/weight lives here. Change freely; nothing
# below this block needs to be edited to retune the engine.
# ---------------------------------------------------------------------------

CONFIG = {
    # Fields considered mandatory for a usable project record.
    "REQUIRED_FIELDS": [
        "id",
        "workName",
        "state",
        "district",
        "implementingAgency",
        "sanctionedAmount",
        "expenditure",
        "status",
    ],
    # Points deducted (from a 100 baseline) per failed check.
    "WEIGHTS": {
        "MISSING_REQUIRED_FIELDS": 8,      # per missing field, capped below
        "MISSING_REQUIRED_FIELDS_CAP": 24,
        "INVALID_NUMERIC_VALUES": 10,      # per invalid numeric field, capped below
        "INVALID_NUMERIC_VALUES_CAP": 20,
        "INVALID_PERCENTAGE": 10,
        "EXPENDITURE_EXCEEDS_SANCTIONED": 20,
        "HIGH_UTILIZATION_WARNING": 8,
        "PROGRESS_MISMATCH": 15,
        "INVALID_TIMELINE": 15,
        "PROJECT_OVERDUE": 12,
        "COMPLETED_LOW_PHYSICAL_PROGRESS": 20,
        "COMPLETED_FINANCIAL_INCONSISTENT": 15,
        "ACTIVE_SEVERELY_OVERDUE": 15,
    },
    # Behavioural thresholds.
    "HIGH_UTILIZATION_PCT": 95,          # >= this without being Completed => warning
    "PROGRESS_MISMATCH_PCT_POINTS": 20,  # |financial% - physical%| >= this => fail
    "COMPLETED_MIN_PHYSICAL_PROGRESS": 90,
    "COMPLETED_MIN_FINANCIAL_UTILIZATION": 85,
    "SEVERELY_OVERDUE_DAYS": 180,
    # Score band -> compliance_status (checked highest-first).
    "STATUS_BANDS": [
        {"status": "COMPLIANT", "min": 90},
        {"status": "WARNING", "min": 75},
        {"status": "REQUIRES_REVIEW", "min": 50},
        {"status": "NON_COMPLIANT", "min": 0},
    ],
}

RECOMMENDED_ACTIONS = {
    "NON_COMPLIANT": "Escalate for detailed audit. Multiple compliance rules failed — "
    "verify records with the implementing agency before further disbursement.",
    "REQUIRES_REVIEW": "Review project progress and expenditure records; resolve flagged "
    "inconsistencies before the next monitoring cycle.",
    "WARNING": "Monitor closely and confirm supporting documentation for the flagged item(s).",
    "COMPLIANT": "No action required. Continue routine monitoring.",
}


# ---------------------------------------------------------------------------
# Small helpers (kept local/independent from risk_engine.py on purpose, so
# this module has no import-time dependency on the risk engine).
# ---------------------------------------------------------------------------


def _is_number(value) -> bool:
    if value is None:
        return False
    if isinstance(value, bool):
        return False
    try:
        f = float(value)
        return not (isinstance(f, float) and np.isnan(f))
    except (TypeError, ValueError):
        return False


def _to_float(value, default=0.0) -> float:
    return float(value) if _is_number(value) else default


def _is_blank(value) -> bool:
    if value is None:
        return True
    if isinstance(value, float) and np.isnan(value):
        return True
    if isinstance(value, str) and value.strip() == "":
        return True
    return False


def _parse_date(value) -> Optional[date]:
    if _is_blank(value):
        return None
    if isinstance(value, (date, datetime)):
        return value if isinstance(value, date) and not isinstance(value, datetime) else value.date()
    try:
        return datetime.strptime(str(value)[:10], "%Y-%m-%d").date()
    except ValueError:
        return None


def _financial_progress(expenditure, sanctioned_amount) -> float:
    sanctioned = _to_float(sanctioned_amount)
    spent = _to_float(expenditure)
    if sanctioned <= 0:
        return 0.0
    return round((spent / sanctioned) * 100, 1)


def _is_overrun_allowed(project: dict) -> bool:
    """Single hook for a future 'approved exception' flag (see module
    docstring, limitation #2). No such field exists in the dataset today,
    so this always returns False."""
    return bool(project.get("allowedExceptionFlag", False))


def get_recommended_action(status: str) -> str:
    return RECOMMENDED_ACTIONS.get(status, RECOMMENDED_ACTIONS["REQUIRES_REVIEW"])


def _status_for_score(score: float) -> str:
    for band in CONFIG["STATUS_BANDS"]:
        if score >= band["min"]:
            return band["status"]
    return "NON_COMPLIANT"


# ---------------------------------------------------------------------------
# Core evaluator
# ---------------------------------------------------------------------------


def evaluate_compliance(project: dict, all_projects: Optional[list] = None) -> dict:
    """Evaluates a single project against every configured compliance check.

    Returns a dict shaped exactly per the milestone spec:
        compliance_score, compliance_status, compliance_issues,
        failed_checks, passed_checks, compliance_explanation,
        recommended_action
    """
    W = CONFIG["WEIGHTS"]
    score = 100.0
    issues = []          # [{check, severity, message}]
    failed_checks = []   # [str]
    passed_checks = []   # [str]

    def fail(check_name: str, message: str, points: float, severity: str = "Medium"):
        nonlocal score
        score -= points
        failed_checks.append(check_name)
        issues.append({"check": check_name, "severity": severity, "message": message})

    def ok(check_name: str):
        passed_checks.append(check_name)

    # -- 1. Required project information -------------------------------------------------
    missing_fields = [f for f in CONFIG["REQUIRED_FIELDS"] if _is_blank(project.get(f))]
    if missing_fields:
        points = min(len(missing_fields) * W["MISSING_REQUIRED_FIELDS"], W["MISSING_REQUIRED_FIELDS_CAP"])
        fail(
            "Required Project Information",
            f"Missing required field(s): {', '.join(missing_fields)}.",
            points,
            severity="High" if len(missing_fields) > 2 else "Medium",
        )
    else:
        ok("Required Project Information")

    # -- 6a. Data quality: invalid numeric values -----------------------------------------
    numeric_fields = ["sanctionedAmount", "expenditure", "physicalProgress"]
    invalid_numeric = []
    for f in numeric_fields:
        val = project.get(f)
        if val is not None and not _is_blank(val) and not _is_number(val):
            invalid_numeric.append(f)
    # Negative amounts are also a numeric-validity problem.
    sanctioned = _to_float(project.get("sanctionedAmount"))
    spent = _to_float(project.get("expenditure"))
    if _is_number(project.get("sanctionedAmount")) and sanctioned < 0:
        invalid_numeric.append("sanctionedAmount (negative)")
    if _is_number(project.get("expenditure")) and spent < 0:
        invalid_numeric.append("expenditure (negative)")
    if sanctioned == 0 and not _is_blank(project.get("sanctionedAmount")):
        invalid_numeric.append("sanctionedAmount (zero)")

    if invalid_numeric:
        points = min(len(invalid_numeric) * W["INVALID_NUMERIC_VALUES"], W["INVALID_NUMERIC_VALUES_CAP"])
        fail(
            "Data Quality — Numeric Values",
            f"Invalid or non-numeric value(s) detected: {', '.join(invalid_numeric)}.",
            points,
            severity="High",
        )
    else:
        ok("Data Quality — Numeric Values")

    # -- 6b. Data quality: invalid percentage -------------------------------------------
    physical = _to_float(project.get("physicalProgress"))
    if _is_number(project.get("physicalProgress")) and (physical < 0 or physical > 100):
        fail(
            "Data Quality — Percentage Range",
            f"physicalProgress value ({physical}) is outside the valid 0-100 range.",
            W["INVALID_PERCENTAGE"],
            severity="High",
        )
    else:
        ok("Data Quality — Percentage Range")

    # -- 2. Financial consistency ----------------------------------------------------------
    financial = _financial_progress(spent, sanctioned)
    if sanctioned > 0 and spent > sanctioned and not _is_overrun_allowed(project):
        overrun_pct = ((spent - sanctioned) / sanctioned) * 100
        fail(
            "Financial Consistency — Expenditure vs Sanctioned",
            f"Expenditure exceeds the sanctioned amount by {overrun_pct:.1f}% "
            f"(₹{spent - sanctioned:,.0f} over budget) with no approved exception on record.",
            W["EXPENDITURE_EXCEEDS_SANCTIONED"],
            severity="Critical" if overrun_pct > 20 else "High",
        )
    else:
        ok("Financial Consistency — Expenditure vs Sanctioned")

    if sanctioned > 0 and financial >= CONFIG["HIGH_UTILIZATION_PCT"] and project.get("status") != "Completed" and spent <= sanctioned:
        fail(
            "Financial Consistency — Utilization Rate",
            f"{financial}% of the sanctioned amount is already utilized while the project "
            f"is not marked Completed — utilization is nearing its limit.",
            W["HIGH_UTILIZATION_WARNING"],
            severity="Medium",
        )
    else:
        ok("Financial Consistency — Utilization Rate")

    # -- 3. Project progress consistency ----------------------------------------------------
    gap = abs(financial - physical)
    if gap >= CONFIG["PROGRESS_MISMATCH_PCT_POINTS"]:
        fail(
            "Progress Consistency — Financial vs Physical",
            f"Financial progress ({financial}%) and physical progress ({physical}%) differ by "
            f"{gap:.0f} percentage points, an unexplained mismatch.",
            W["PROGRESS_MISMATCH"],
            severity="High" if gap >= 40 else "Medium",
        )
    else:
        ok("Progress Consistency — Financial vs Physical")

    # -- 4. Date consistency -----------------------------------------------------------------
    start = _parse_date(project.get("startDate"))
    expected = _parse_date(project.get("expectedCompletion"))
    if start and expected and expected < start:
        fail(
            "Date Consistency — Timeline",
            "Expected completion date is earlier than the start date.",
            W["INVALID_TIMELINE"],
            severity="High",
        )
    else:
        ok("Date Consistency — Timeline")

    is_overdue = bool(expected and project.get("status") != "Completed" and expected < date.today())
    overdue_days = (date.today() - expected).days if is_overdue else 0
    if is_overdue:
        fail(
            "Date Consistency — Overdue Project",
            f"Project is {overdue_days} day(s) past its expected completion date and is not "
            f"marked Completed.",
            W["PROJECT_OVERDUE"],
            severity="Critical" if overdue_days > CONFIG["SEVERELY_OVERDUE_DAYS"] else "High",
        )
    else:
        ok("Date Consistency — Overdue Project")

    # -- 5. Project status consistency ------------------------------------------------------
    if project.get("status") == "Completed":
        if physical < CONFIG["COMPLETED_MIN_PHYSICAL_PROGRESS"]:
            fail(
                "Status Consistency — Completed with Low Physical Progress",
                f"Project is marked Completed but physical progress is only {physical}% "
                f"(expected at least {CONFIG['COMPLETED_MIN_PHYSICAL_PROGRESS']}%).",
                W["COMPLETED_LOW_PHYSICAL_PROGRESS"],
                severity="Critical",
            )
        else:
            ok("Status Consistency — Completed with Low Physical Progress")

        if financial < CONFIG["COMPLETED_MIN_FINANCIAL_UTILIZATION"]:
            fail(
                "Status Consistency — Completed with Incomplete Financial Closure",
                f"Project is marked Completed but only {financial}% of the sanctioned amount "
                f"has been utilized (expected at least "
                f"{CONFIG['COMPLETED_MIN_FINANCIAL_UTILIZATION']}%).",
                W["COMPLETED_FINANCIAL_INCONSISTENT"],
                severity="High",
            )
        else:
            ok("Status Consistency — Completed with Incomplete Financial Closure")
    else:
        ok("Status Consistency — Completed with Low Physical Progress")
        ok("Status Consistency — Completed with Incomplete Financial Closure")

        if is_overdue and overdue_days > CONFIG["SEVERELY_OVERDUE_DAYS"]:
            fail(
                "Status Consistency — Active Project Severely Overdue",
                f"Project is still active ({project.get('status')}) but is {overdue_days} days "
                f"overdue, well beyond the {CONFIG['SEVERELY_OVERDUE_DAYS']}-day severe-delay "
                f"threshold.",
                W["ACTIVE_SEVERELY_OVERDUE"],
                severity="Critical",
            )
        else:
            ok("Status Consistency — Active Project Severely Overdue")

    # -- Final score / status ---------------------------------------------------------------
    final_score = max(0, min(100, round(score)))
    status = _status_for_score(final_score)

    if not failed_checks:
        explanation = "All checked compliance rules pass for this project based on currently available data."
    else:
        top = issues[:2]
        explanation = "Compliance concerns: " + "; ".join(i["message"] for i in top)
        if len(issues) > 2:
            explanation += f" (+{len(issues) - 2} more)"

    return {
        "project_id": project.get("id"),
        "compliance_score": final_score,
        "compliance_status": status,
        "compliance_issues": issues,
        "failed_checks": failed_checks,
        "passed_checks": passed_checks,
        "compliance_explanation": explanation,
        "recommended_action": get_recommended_action(status),
    }


def evaluate_all(all_projects: list) -> list:
    return [evaluate_compliance(p, all_projects) for p in all_projects]
