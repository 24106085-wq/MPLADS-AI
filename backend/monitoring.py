# backend/monitoring.py
"""
MPLADS Unified Project Monitoring — Milestone 4, Part B.

Combines the outputs of every existing engine into ONE response object per
project:

    risk_engine        -> risk score / level / factors
    compliance_engine   -> compliance score / status / issues
    ml_anomaly          -> ML anomaly score / flag
    duplicate_detector  -> duplicate similarity / possible_duplicate
    predictive_model     -> delay + cost-overrun probability, top factors
    early_warning        -> early_warning_level / reasons / recommended_action

No business logic is duplicated here — every field is produced by calling
the existing module functions. This module only shapes/aggregates their
results so the frontend can retrieve one object per project instead of
making five separate calls.

Efficiency note: ml_anomaly/duplicate_detector/predictive_model all need to
look at the *whole* currently loaded project set to have any notion of
"typical" (Isolation Forest, TF-IDF similarity, the trained classifiers).
build_all_monitoring() below therefore runs each of those exactly once
over the full set and then assembles per-project results from that,
rather than repeating the whole-set computation once per project.
"""

from typing import Dict, List, Optional

import compliance_engine as compliance
import duplicate_detector
import early_warning
import ml_anomaly
import mlops_engine
import multi_signal_risk
import predictive_model
import risk_engine as engine


def _project_summary(project: dict) -> dict:
    return {
        "id": project.get("id"),
        "workName": project.get("workName"),
        "mpName": project.get("mpName"),
        "constituency": project.get("constituency"),
        "state": project.get("state"),
        "district": project.get("district"),
        "category": project.get("category"),
        "implementingAgency": project.get("implementingAgency"),
        "status": project.get("status"),
        "startDate": project.get("startDate"),
    }


def _financial_summary(project: dict) -> dict:
    sanctioned = float(project.get("sanctionedAmount") or 0)
    spent = float(project.get("expenditure") or 0)
    financial_progress = engine.calc_financial_progress(spent, sanctioned)
    return {
        "sanctionedAmount": sanctioned,
        "expenditure": spent,
        "utilization": financial_progress,
        "financialProgress": financial_progress,
        "costOverrun": spent > sanctioned,
        "costOverrunAmount": round(max(0.0, spent - sanctioned), 2),
    }


def _physical_summary(project: dict) -> dict:
    return {
        "physicalProgress": float(project.get("physicalProgress") or 0),
        "expectedCompletion": project.get("expectedCompletion"),
        "overdueDays": engine.days_overdue(project),
        "isOverdue": engine.is_overdue(project),
    }


def build_all_monitoring(all_projects: List[dict], photo_evidence_by_id: Optional[Dict[str, dict]] = None) -> Dict[str, dict]:
    """Runs every engine ONCE over the full project set, then assembles a
    unified monitoring object per project id. Never raises: any single
    project's optional AI/predictive fields fall back to safe defaults if
    that engine can't produce a result (e.g. too little data), matching the
    "insufficient_data" conventions already used by ml_anomaly.py and
    predictive_model.py.

    `photo_evidence_by_id` (optional): {project_id: {"similarity_score": ..,
    "similarity_reason": ..}} — the strongest field-photo near-duplicate
    signal per project, if any evidence has been uploaded (see evidence.py
    and main.py's evidence endpoints). Feeds the multi-signal risk engine's
    "duplicate_evidence" signal alongside the text-similarity detector.
    """
    if not all_projects:
        return {}
    photo_evidence_by_id = photo_evidence_by_id or {}

    try:
        compliance_by_id = {c["project_id"]: c for c in compliance.evaluate_all(all_projects)}
    except Exception:
        compliance_by_id = {}

    try:
        # Feedback-calibrated contamination when officer feedback has driven
        # a real model update (see mlops_engine.py); None until then, in
        # which case ml_anomaly.py falls back to its own default heuristic.
        calibrated_contamination = mlops_engine.get_calibrated_contamination()
        ml_by_id = ml_anomaly.compute_ml_anomalies(all_projects, contamination_override=calibrated_contamination)
    except Exception:
        ml_by_id = {}

    try:
        dup_by_id = duplicate_detector.compute_duplicate_matches(all_projects)
    except Exception:
        dup_by_id = {}

    try:
        delay_by_id = predictive_model.compute_delay_predictions(all_projects)
    except Exception:
        delay_by_id = {}

    try:
        overrun_by_id = predictive_model.compute_cost_overrun_predictions(all_projects)
    except Exception:
        overrun_by_id = {}

    results: Dict[str, dict] = {}

    for project in all_projects:
        pid = project.get("id")
        rule_risk = engine.calculate_risk(project, all_projects)
        compliance_result = compliance_by_id.get(pid, {})
        ml_result = ml_by_id.get(pid, {})
        dup_result = dup_by_id.get(pid, {})
        delay_result = delay_by_id.get(pid, {})
        overrun_result = overrun_by_id.get(pid, {})
        photo_result = photo_evidence_by_id.get(pid, {})

        # Genuine multi-signal combination (Target Architecture Block 4) —
        # this, NOT rule_risk above, is the headline risk score/level used
        # everywhere else in the app (dashboard, map, alerts, early
        # warning). rule_risk is kept only as one input and for its
        # detailed factor list (still shown in the UI for transparency).
        risk = multi_signal_risk.compute_multi_signal_risk(
            project, all_projects,
            rule_result=rule_risk,
            compliance_result=compliance_result,
            ml_result=ml_result,
            duplicate_result=dup_result,
            delay_result=delay_result,
            overrun_result=overrun_result,
            photo_evidence_result=photo_result,
        )

        financial = _financial_summary(project)
        physical = _physical_summary(project)
        gap = financial["financialProgress"] - physical["physicalProgress"]

        try:
            explanation = predictive_model.explain_delay_prediction(project, all_projects)
        except Exception:
            explanation = {
                "model_status": "unavailable",
                "explanation_method": "none",
                "top_factors": [],
                "notes": "Explanation temporarily unavailable.",
            }

        ew = early_warning.compute_early_warning(
            project,
            risk,
            compliance_result=compliance_result,
            ml_result=ml_result,
            duplicate_result=dup_result,
            delay_result=delay_result,
            overrun_result=overrun_result,
            overdue_days=physical["overdueDays"],
            financial_physical_gap=gap,
        )

        results[pid] = {
            "project": _project_summary(project),
            "financial": financial,
            "physical": physical,
            "risk": {
                "score": risk["score"],
                "level": risk["level"],
                "factors": rule_risk["factors"],
                "signals": risk["contributing_factors"],
                "unavailable_signals": risk["unavailable_signals"],
                "explanation": risk["explanation"],
                "recommended_action": risk["recommended_action"],
                "engine": risk["engine"],
                "disclaimer": risk["disclaimer"],
            },
            "compliance": {
                "score": compliance_result.get("compliance_score"),
                "status": compliance_result.get("compliance_status"),
                "issues": compliance_result.get("compliance_issues", []),
                "recommended_action": compliance_result.get("recommended_action"),
            },
            "ai": {
                "ml_anomaly_score": ml_result.get("ml_anomaly_score"),
                "ml_anomaly_flag": ml_result.get("ml_anomaly_flag"),
                "ml_method": ml_result.get("ml_method"),
                "duplicate_score": dup_result.get("duplicate_similarity_score"),
                "possible_duplicate": dup_result.get("possible_duplicate"),
                "matched_project_ids": dup_result.get("matched_project_ids", []),
                "delay_probability": delay_result.get("delay_probability"),
                "predicted_delay": delay_result.get("predicted_delay"),
                "cost_overrun_probability": overrun_result.get("cost_overrun_probability"),
                "predicted_cost_overrun": overrun_result.get("predicted_cost_overrun"),
                "top_factors": explanation.get("top_factors", []),
            },
            "early_warning": ew,
        }

    return results


def build_project_monitoring(project_id: str, all_projects: List[dict],
                              photo_evidence_by_id: Optional[Dict[str, dict]] = None) -> Optional[dict]:
    """Convenience wrapper for the single-project endpoint. Still runs the
    engines over the full currently loaded set (required for ML/duplicate/
    predictive signals to have any notion of "typical"/"similar"), then
    returns just this project's entry."""
    return build_all_monitoring(all_projects, photo_evidence_by_id).get(project_id)


# ---------------------------------------------------------------------------
# Milestone 4, Part E — Final Dashboard aggregate KPIs.
# Backend-generated so the frontend never has to re-derive these numbers;
# it only has to display them (see main.py's /api/dashboard/summary).
# ---------------------------------------------------------------------------


def build_dashboard_summary(all_projects: List[dict]) -> dict:
    n = len(all_projects)
    if n == 0:
        return {
            "totalProjects": 0,
            "totalSanctioned": 0,
            "totalExpenditure": 0,
            "fundUtilizationPct": 0,
            "completedProjects": 0,
            "delayedProjects": 0,
            "highCriticalRiskProjects": 0,
            "costOverruns": 0,
            "potentialDuplicates": 0,
            "complianceIssues": 0,
            "mlAnomalies": 0,
            "earlyWarnings": {"RED": 0, "ORANGE": 0, "YELLOW": 0, "GREEN": 0},
        }

    monitoring_by_id = build_all_monitoring(all_projects)
    monitored = list(monitoring_by_id.values())

    total_sanctioned = sum(m["financial"]["sanctionedAmount"] for m in monitored)
    total_expenditure = sum(m["financial"]["expenditure"] for m in monitored)
    utilization = round((total_expenditure / total_sanctioned) * 100, 1) if total_sanctioned > 0 else 0

    early_warning_counts = {"RED": 0, "ORANGE": 0, "YELLOW": 0, "GREEN": 0}
    for m in monitored:
        level = m["early_warning"]["early_warning_level"]
        early_warning_counts[level] = early_warning_counts.get(level, 0) + 1

    return {
        "totalProjects": n,
        "totalSanctioned": round(total_sanctioned, 2),
        "totalExpenditure": round(total_expenditure, 2),
        "fundUtilizationPct": utilization,
        "completedProjects": sum(1 for p in all_projects if p.get("status") == "Completed"),
        "delayedProjects": sum(
            1
            for m in monitored
            if m["project"]["status"] == "Delayed"
            or (m["physical"]["isOverdue"] and m["project"]["status"] != "Completed")
        ),
        "highCriticalRiskProjects": sum(1 for m in monitored if m["risk"]["level"] in ("High", "Critical")),
        "costOverruns": sum(1 for m in monitored if m["financial"]["costOverrun"]),
        "potentialDuplicates": sum(1 for m in monitored if m["ai"]["possible_duplicate"]),
        "complianceIssues": sum(
            1 for m in monitored if m["compliance"]["status"] in ("NON_COMPLIANT", "REQUIRES_REVIEW", "WARNING")
        ),
        "mlAnomalies": sum(1 for m in monitored if m["ai"]["ml_anomaly_flag"]),
        "earlyWarnings": early_warning_counts,
    }
