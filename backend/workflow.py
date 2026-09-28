# backend/workflow.py
"""
User Workflow (Target Architecture Block 8) + Feedback & MLOps (Block 9).

Thin business-rules layer over db.py:
    Login & Select Role -> View Insights -> Investigate -> Verify ->
    Take Action -> Track & Close -> Action Outcomes

and the feedback loop that is supposed to feed MLOps monitoring:

    User Feedback -> Knowledge Store -> (New Data) -> Model Retraining ->
    Performance Monitor -> Deploy Updated Models

Everything here is a genuine, working prototype: real persisted status
transitions and a real, on-demand recomputation of the ML/predictive
models (they are already recomputed fresh from the current dataset on
every call — see ml_anomaly.py / predictive_model.py — so a "retrain"
here means "re-run those models now, over the current dataset PLUS every
piece of feedback collected so far", which is an honest description of
what actually happens; it is not a fabricated metric.
"""

from typing import Optional

import db
import mlops_engine

ROLES = [
    {"id": "mp", "label": "Member of Parliament (MP)", "filters_by": "mpName"},
    {"id": "district", "label": "District Authority", "filters_by": "district"},
    {"id": "state", "label": "State Nodal Authority", "filters_by": "state"},
    {"id": "admin", "label": "Ministry / Admin", "filters_by": None},
]
ROLE_IDS = {r["id"] for r in ROLES}

VALID_ACTIONS = {
    "Verify": "Under Verification",
    "Recommend": "Action Taken",
    "Hold": "Action Taken",
    "Escalate": "Action Taken",
    "Close": "Closed",
    "Reopen": "Open",
}

FEEDBACK_DECISIONS = ["Confirmed Issue", "False Positive", "Needs Verification"]

# ---------------------------------------------------------------------------
# Simple, role-based access control (SIH-demo scope). This is intentionally
# a handful of fixed capability sets, not a granular permissions system —
# enough to make the 4 demo roles feel distinct and to stop a non-admin role
# from reaching another role's data or an authority-only action, without
# building out real RBAC. main.py is the only place that reads these; every
# route that should be role-restricted wires one of these sets into
# auth.require_role(*ROLE_SET).
# ---------------------------------------------------------------------------

# Investigation actions (Verify/Recommend/Hold/Escalate/Close/Reopen) are an
# authority function in the real MPLADS workflow — an MP can raise/monitor
# concerns (via feedback) but doesn't formally action a project.
CAN_TAKE_INVESTIGATION_ACTION = {"district", "state", "admin"}

# Adding a new sanctioned project or bulk-importing a dataset is a
# ministry-level data-management function, not something any of the three
# oversight/representative roles do day to day.
CAN_MANAGE_PROJECTS = {"admin"}

# MLOps is oversight of the AI system itself, not of a specific project —
# state nodal authorities and the ministry may want that visibility;
# district authorities and individual MPs don't need it.
CAN_VIEW_MLOPS = {"state", "admin"}

# Triggering a retrain is an even narrower ministry-level action.
CAN_RETRAIN_MLOPS = {"admin"}


def list_roles() -> list:
    return ROLES


def project_in_scope(project: dict, role: Optional[str], identifier: Optional[str]) -> bool:
    """True if a single project falls within a given role+identifier's own
    scope. Unknown role / missing identifier / admin => always in scope
    (never silently locks someone out due to a typo — this is a simple demo
    role filter, not a hardened authorization system). Shared by
    filter_projects_by_role (list filtering) and main.py's per-project
    route guards (single-project 403 checks), so there's exactly one
    definition of "does this role own this project"."""
    if not role or role not in ROLE_IDS or role == "admin" or not identifier:
        return True
    field = next((r["filters_by"] for r in ROLES if r["id"] == role), None)
    if not field:
        return True
    return str(project.get(field, "")).strip().lower() == identifier.strip().lower()


def filter_projects_by_role(projects: list, role: Optional[str], identifier: Optional[str]) -> list:
    """Filters the project list the way a logged-in role would see it."""
    return [p for p in projects if project_in_scope(p, role, identifier)]


def get_investigation_state(project_id: str) -> dict:
    inv = db.get_investigation(project_id)
    history = db.get_action_history(project_id)
    feedback = db.list_feedback(project_id)
    return {
        "project_id": project_id,
        "status": inv["status"],
        "updated_at": inv["updated_at"],
        "history": history,
        "feedback": feedback,
    }


def apply_action(project_id: str, action: str, role: Optional[str], remarks: Optional[str]) -> dict:
    if action not in VALID_ACTIONS:
        raise ValueError(f"Unknown action '{action}'. Valid actions: {', '.join(VALID_ACTIONS)}")
    resulting_status = VALID_ACTIONS[action]
    record = db.record_action(project_id, action, role, remarks, resulting_status)
    return {**record, "history": db.get_action_history(project_id)}


def submit_feedback(project_id: str, decision: str, remarks: Optional[str], role: Optional[str],
                     risk_score: Optional[float] = None, signal_snapshot: Optional[dict] = None) -> dict:
    if decision not in FEEDBACK_DECISIONS:
        raise ValueError(f"Unknown decision '{decision}'. Valid decisions: {', '.join(FEEDBACK_DECISIONS)}")
    return db.insert_feedback(project_id, decision, remarks, role, risk_score, signal_snapshot)


# ---------------------------------------------------------------------------
# MLOps prototype view
# ---------------------------------------------------------------------------


def build_mlops_summary(all_projects: list, ml_meta: dict, delay_meta: dict) -> dict:
    """Assembles the practical MLOps prototype view described in the brief:
    feedback case counts, pending reviews, and honestly-reported model
    status (never fabricated metrics). ml_meta / delay_meta are the
    model_status/model_method/sample_size fields already produced by
    ml_anomaly.py / predictive_model.py for the current dataset."""
    feedback = db.list_feedback()
    investigations = db.get_all_investigations()

    decision_counts = {d: 0 for d in FEEDBACK_DECISIONS}
    for f in feedback:
        if f["decision"] in decision_counts:
            decision_counts[f["decision"]] += 1

    status_counts = {"Open": 0, "Under Verification": 0, "Action Taken": 0, "Closed": 0}
    investigated_ids = {i["project_id"] for i in investigations}
    for i in investigations:
        status_counts[i["status"]] = status_counts.get(i["status"], 0) + 1
    # Projects never touched are implicitly "Open" but have no row yet.
    status_counts["Open"] += max(0, len(all_projects) - len(investigated_ids))

    last_retrain = db.last_mlops_event("retrain_triggered")
    registry = mlops_engine.build_model_registry_summary(all_projects)

    return {
        "feedback_cases": {
            "total": len(feedback),
            "confirmed_issues": decision_counts["Confirmed Issue"],
            "false_positives": decision_counts["False Positive"],
            "needs_verification": decision_counts["Needs Verification"],
        },
        "investigation_status": status_counts,
        "model_monitoring": {
            "ml_anomaly_model": {
                "method": ml_meta.get("ml_method"),
                "sample_size": ml_meta.get("ml_sample_size"),
                "confidence": ml_meta.get("ml_anomaly_confidence"),
            },
            "delay_prediction_model": {
                "status": delay_meta.get("model_status"),
                "method": delay_meta.get("model_method"),
                "sample_size": delay_meta.get("sample_size"),
                "validation_metrics": delay_meta.get("validation_metrics"),
            },
            "labelled_feedback_cases": len(feedback),
            "last_retrain_event": last_retrain,
        },
        # Real, persisted model registry (Priority: MLOps/versioning) — the
        # "Active Model" card, retraining history and verified-feedback
        # counters on the dashboard all come from here. See mlops_engine.py.
        "model_registry": registry,
        "disclaimer": (
            "Prototype MLOps view. The delay-prediction model is recomputed fresh from the "
            "currently loaded dataset on every request (see predictive_model.py); its accuracy/"
            "precision/recall/F1 are only shown when a valid leave-one-out cross-validated "
            "evaluation was possible. The anomaly detector's contamination is feedback-"
            "calibrated and versioned (see 'model_registry' above / mlops_engine.py) once at "
            "least " + str(mlops_engine.MIN_FEEDBACK_FOR_RETRAINING) + " verified officer "
            "feedback records exist. No accuracy/drift figure is ever fabricated."
        ),
    }


def trigger_retrain(all_projects: list, notes: str = "") -> dict:
    """Runs the real feedback-driven update (see mlops_engine.py) and logs
    the attempt either way — a version bump on success, or an honest
    'not enough feedback yet' outcome — so `last_retrain_event` always
    reflects what actually happened, never a fabricated success."""
    result = mlops_engine.attempt_feedback_driven_update(
        all_projects, trigger=notes or "Manual retrain triggered from MLOps Dashboard"
    )
    db.log_mlops_event("retrain_triggered", result.get("message", ""))
    return result
