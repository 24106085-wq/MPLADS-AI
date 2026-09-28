# backend/early_warning.py
"""
MPLADS Early Warning Engine — Milestone 4, Part A.

A lightweight combination layer, NOT a new model. It reads the outputs
already produced by the existing engines —

    risk_engine.calculate_risk()            -> risk score / level
    compliance_engine.evaluate_compliance()  -> compliance status
    ml_anomaly.compute_ml_anomalies()        -> ML anomaly flag
    duplicate_detector.compute_duplicate_matches() -> possible_duplicate
    predictive_model.compute_delay_predictions() / compute_cost_overrun_predictions()

— and combines them into a single, explainable early_warning_level plus
the reasons behind it and a recommended next step. No new underlying
signal is computed here; every threshold below only reads values other
modules already produced.

Levels (low to high urgency): GREEN, YELLOW, ORANGE, RED.

IMPORTANT: an early warning means "requires attention" / "potential risk
indicator". It is NEVER a declaration of confirmed fraud. Wording in this
module is deliberately hedged ("potential", "requires review", "risk
detected") and must stay that way.
"""

from typing import Optional

LEVELS = ["GREEN", "YELLOW", "ORANGE", "RED"]
_ORDER = {level: i for i, level in enumerate(LEVELS)}

RECOMMENDED_ACTIONS = {
    "RED": "Immediate attention required — escalate for verification and detailed review "
    "before further disbursement. This is a risk indicator, not a confirmed finding.",
    "ORANGE": "Priority review recommended during the current monitoring cycle.",
    "YELLOW": "Monitor closely and verify supporting records at the next review.",
    "GREEN": "No immediate action required. Continue routine monitoring.",
}


def _bump(current: str, candidate: str) -> str:
    """Raises `current` to `candidate` only if candidate is more urgent."""
    return candidate if _ORDER[candidate] > _ORDER[current] else current


def compute_early_warning(
    project: dict,
    risk: dict,
    compliance_result: Optional[dict] = None,
    ml_result: Optional[dict] = None,
    duplicate_result: Optional[dict] = None,
    delay_result: Optional[dict] = None,
    overrun_result: Optional[dict] = None,
    overdue_days: int = 0,
    financial_physical_gap: float = 0.0,
) -> dict:
    """Combines existing signals for ONE project into an early warning verdict.

    All arguments except `project` and `risk` are optional so this degrades
    gracefully if a given signal is unavailable (e.g. ML/predictive results
    on a tiny dataset) — it simply contributes no reasons in that case,
    rather than raising or fabricating a value.
    """
    compliance_result = compliance_result or {}
    ml_result = ml_result or {}
    duplicate_result = duplicate_result or {}
    delay_result = delay_result or {}
    overrun_result = overrun_result or {}

    level = "GREEN"
    reasons = []

    risk_level = (risk or {}).get("level", "Low")
    risk_score = (risk or {}).get("score", 0)
    compliance_status = compliance_result.get("compliance_status")
    delay_probability = delay_result.get("delay_probability")
    overrun_probability = overrun_result.get("cost_overrun_probability")
    ml_flag = bool(ml_result.get("ml_anomaly_flag"))
    possible_duplicate = bool(duplicate_result.get("possible_duplicate")) or bool(
        project.get("duplicateFlag")
    )
    gap = financial_physical_gap or 0.0

    # --- RED: critical / severe indicators -----------------------------
    if risk_level == "Critical":
        level = _bump(level, "RED")
        reasons.append(f"Critical composite risk score ({risk_score}/100).")
    if delay_probability is not None and delay_probability >= 0.75:
        level = _bump(level, "RED")
        reasons.append(f"Very high predicted delay probability ({round(delay_probability * 100)}%).")
    if gap >= 45:
        level = _bump(level, "RED")
        reasons.append(f"Severe financial-physical progress mismatch ({round(gap)} point gap).")
    if compliance_status == "NON_COMPLIANT":
        level = _bump(level, "RED")
        reasons.append("Serious compliance violations detected — multiple checks failed.")
    if overdue_days and overdue_days > 180:
        level = _bump(level, "RED")
        reasons.append(f"Severely overdue by {overdue_days} day(s).")

    # --- ORANGE: high-priority indicators -------------------------------
    if risk_level == "High":
        level = _bump(level, "ORANGE")
        reasons.append(f"High composite risk score ({risk_score}/100).")
    if delay_probability is not None and 0.6 <= delay_probability < 0.75:
        level = _bump(level, "ORANGE")
        reasons.append(f"High predicted delay probability ({round(delay_probability * 100)}%).")
    if overrun_probability is not None and overrun_probability >= 0.6:
        level = _bump(level, "ORANGE")
        reasons.append(f"High predicted cost-overrun probability ({round(overrun_probability * 100)}%).")
    if ml_flag:
        level = _bump(level, "ORANGE")
        reasons.append("ML-based anomaly detection flagged this project for review.")
    if possible_duplicate:
        level = _bump(level, "ORANGE")
        reasons.append("Potential duplicate/similar work detected.")
    if compliance_status == "REQUIRES_REVIEW":
        level = _bump(level, "ORANGE")
        reasons.append("Compliance review required — multiple checks failed.")
    if 25 <= gap < 45:
        level = _bump(level, "ORANGE")
        reasons.append(f"Significant financial-physical progress mismatch ({round(gap)} points).")
    if overdue_days and 90 < overdue_days <= 180:
        level = _bump(level, "ORANGE")
        reasons.append(f"Significantly overdue ({overdue_days} day(s)).")

    # --- YELLOW: moderate indicators -------------------------------------
    if risk_level == "Medium":
        level = _bump(level, "YELLOW")
        reasons.append(f"Moderate composite risk score ({risk_score}/100).")
    if delay_probability is not None and 0.4 <= delay_probability < 0.6:
        level = _bump(level, "YELLOW")
        reasons.append(f"Moderate predicted delay probability ({round(delay_probability * 100)}%).")
    if compliance_status == "WARNING":
        level = _bump(level, "YELLOW")
        reasons.append("Minor compliance concerns flagged.")
    if 15 <= gap < 25:
        level = _bump(level, "YELLOW")
        reasons.append(f"Moderate financial-physical progress mismatch ({round(gap)} points).")
    if overdue_days and 0 < overdue_days <= 90:
        level = _bump(level, "YELLOW")
        reasons.append(f"Approaching or past deadline ({overdue_days} day(s) overdue).")

    if not reasons:
        reasons.append(
            "No significant warning indicators detected across risk, compliance, ML and "
            "predictive signals."
        )

    return {
        "early_warning_level": level,
        "early_warning_reasons": reasons,
        "recommended_action": RECOMMENDED_ACTIONS[level],
    }
