# backend/mlops_engine.py
"""
MPLADS-AI MLOps model registry & feedback-driven update logic.

This module is what actually turns officer feedback into a genuine
retraining/versioning workflow, instead of the previous behaviour (which
just logged a "retrain_triggered" event — see workflow.trigger_retrain()'s
old docstring — while the ML modules recomputed fresh from the dataset on
every request regardless of feedback).

WHICH MODEL IS BEING VERSIONED, AND WHY
----------------------------------------
The bundled anomaly detector (ml_anomaly.py) is an UNSUPERVISED Isolation
Forest — officer feedback labels ("Confirmed Issue" / "False Positive")
cannot be fed into it directly as training labels the way they could for a
supervised classifier, without changing what the model fundamentally is.

So this module implements OPTION A from the brief: Isolation Forest stays
the unsupervised anomaly detector, and verified officer feedback is used to
CALIBRATE it — specifically, its `contamination` parameter (sklearn's
estimate of "what fraction of projects are actually anomalous"). Once
enough verified feedback exists, contamination is recalibrated to the
observed confirmed-issue rate among verified feedback cases:

    contamination = confirmed_issues / (confirmed_issues + false_positives)

This is a real, explainable adjustment: if officers are marking most
flagged projects "False Positive", contamination goes down (the model
becomes stricter about what it flags); if most are "Confirmed Issue",
contamination goes up. It is not a supervised model and does not report
accuracy/precision/recall for itself (there's no notion of a held-out test
set for a contamination parameter) — those metrics remain the delay
prediction model's territory (see predictive_model.py's LOO-CV metrics),
consistent with "never fabricate a metric that hasn't actually been
measured."

VERSIONING
----------
A version only increments when a genuine calibration update happens:
enough NEW verified feedback has accumulated since the last update. Simply
reloading the MLOps dashboard, or clicking "Retrain" with no new verified
feedback since the last real update, does NOT bump the version — it
returns "not enough new verified feedback" instead. This matches the
brief's explicit requirement not to increment on every page refresh.
"""

from typing import List, Optional

import db

MODEL_NAME = "anomaly_detector"
MODEL_TYPE = "Isolation Forest"

# Officer feedback of "Needs Verification" is explicitly excluded from the
# training/calibration signal per the brief — it isn't a verified label.
POSITIVE_DECISION = "Confirmed Issue"
NEGATIVE_DECISION = "False Positive"
VERIFIED_DECISIONS = (POSITIVE_DECISION, NEGATIVE_DECISION)

MIN_FEEDBACK_FOR_RETRAINING = 10

# Contamination is clamped to sklearn's valid (0, 0.5] range, and further
# bounded here to avoid a single lopsided early batch of feedback (e.g.
# "everything so far was a false positive") driving it to an extreme.
MIN_CONTAMINATION = 0.03
MAX_CONTAMINATION = 0.40


def verified_feedback_records() -> List[dict]:
    """All officer feedback with a usable (verified) label — i.e. excluding
    'Needs Verification', which is not a training label."""
    return [f for f in db.list_feedback() if f.get("decision") in VERIFIED_DECISIONS]


def _increment_version(version: Optional[str]) -> str:
    """v1.0 -> v1.1 -> v1.2 ... Falls back to v1.0 if the stored version
    string is missing or unparseable (should not normally happen)."""
    if not version:
        return "v1.0"
    try:
        body = version.lstrip("vV")
        major_str, minor_str = body.split(".", 1)
        return f"v{int(major_str)}.{int(minor_str) + 1}"
    except (ValueError, AttributeError):
        return "v1.0"


def get_active_model_metadata(training_records: int = 0) -> dict:
    """Returns the current registry row for the anomaly detector, bootstrap-
    creating it as v1.0 ("Initial Training") the first time this is called
    on a fresh database — so the dashboard always has something real to
    show, never a blank state pretending no model exists."""
    meta = db.get_model_metadata(MODEL_NAME)
    if meta is not None:
        return meta

    meta = db.upsert_model_metadata(
        model_name=MODEL_NAME,
        model_version="v1.0",
        model_type=MODEL_TYPE,
        training_records=training_records,
        feedback_used=0,
        features_used=_feature_names(),
        model_status="Active",
        calibration_params=None,
    )
    db.insert_retraining_history(
        model_name=MODEL_NAME,
        version="v1.0",
        records_used=training_records,
        feedback_used=0,
        trigger="Initial Training",
        status="Success",
        notes="Baseline model: default heuristic contamination, no officer feedback yet.",
    )
    return meta


def _feature_names() -> list:
    import ml_anomaly  # local import: avoids a hard import cycle at module load

    return list(ml_anomaly.FEATURE_NAMES)


def get_calibrated_contamination() -> Optional[float]:
    """The contamination value the anomaly detector should currently use,
    or None if no feedback-driven calibration has happened yet (in which
    case ml_anomaly.py falls back to its own default heuristic)."""
    meta = db.get_model_metadata(MODEL_NAME)
    if not meta:
        return None
    params = meta.get("calibration_params") or {}
    return params.get("contamination")


def attempt_feedback_driven_update(all_projects: list, trigger: str = "Manual") -> dict:
    """The real feedback -> retrain -> version -> history flow described in
    the brief. Never fabricates a successful update: below the minimum
    verified-feedback threshold, or with no NEW verified feedback since the
    last update, it returns updated=False with an honest reason instead."""
    training_records = len(all_projects)
    meta = get_active_model_metadata(training_records)

    verified = verified_feedback_records()
    n_verified = len(verified)
    confirmed = sum(1 for f in verified if f["decision"] == POSITIVE_DECISION)
    false_positive = n_verified - confirmed

    if n_verified < MIN_FEEDBACK_FOR_RETRAINING:
        return {
            "updated": False,
            "message": "Not enough verified feedback for model update.",
            "verified_feedback_count": n_verified,
            "min_feedback_for_retraining": MIN_FEEDBACK_FOR_RETRAINING,
            "model_metadata": meta,
        }

    previously_used = int(meta.get("feedback_used") or 0)
    if n_verified <= previously_used:
        return {
            "updated": False,
            "message": "No new verified feedback since the last model update.",
            "verified_feedback_count": n_verified,
            "min_feedback_for_retraining": MIN_FEEDBACK_FOR_RETRAINING,
            "model_metadata": meta,
        }

    raw_contamination = confirmed / n_verified if n_verified else 0.0
    calibrated_contamination = round(
        min(MAX_CONTAMINATION, max(MIN_CONTAMINATION, raw_contamination)), 4
    )

    new_version = _increment_version(meta.get("model_version"))
    notes = (
        f"Calibrated contamination to {calibrated_contamination} from {n_verified} verified "
        f"feedback records ({confirmed} Confirmed Issue, {false_positive} False Positive)."
    )

    updated_meta = db.upsert_model_metadata(
        model_name=MODEL_NAME,
        model_version=new_version,
        model_type=MODEL_TYPE,
        training_records=training_records,
        feedback_used=n_verified,
        features_used=_feature_names(),
        model_status="Active",
        calibration_params={
            "contamination": calibrated_contamination,
            "confirmed_issue_count": confirmed,
            "false_positive_count": false_positive,
        },
    )
    db.insert_retraining_history(
        model_name=MODEL_NAME,
        version=new_version,
        records_used=training_records,
        feedback_used=n_verified,
        trigger=trigger,
        status="Success",
        notes=notes,
    )

    return {
        "updated": True,
        "message": f"Model updated to {new_version} using {n_verified} verified feedback records.",
        "previous_version": meta.get("model_version"),
        "new_version": new_version,
        "verified_feedback_count": n_verified,
        "confirmed_issue_count": confirmed,
        "false_positive_count": false_positive,
        "calibrated_contamination": calibrated_contamination,
        "model_metadata": updated_meta,
    }


def build_model_registry_summary(all_projects: list) -> dict:
    """Read-only view for the MLOps dashboard — never mutates the registry
    (that only happens via attempt_feedback_driven_update, i.e. an explicit
    retrain action), so simply loading the dashboard never bumps a
    version."""
    meta = get_active_model_metadata(len(all_projects))
    verified = verified_feedback_records()
    n_verified = len(verified)
    confirmed = sum(1 for f in verified if f["decision"] == POSITIVE_DECISION)
    false_positive = n_verified - confirmed

    return {
        "active_model": meta,
        "verified_feedback_available": n_verified,
        "confirmed_issue_count": confirmed,
        "false_positive_count": false_positive,
        "min_feedback_for_retraining": MIN_FEEDBACK_FOR_RETRAINING,
        "feedback_needed_for_next_update": max(0, MIN_FEEDBACK_FOR_RETRAINING - n_verified)
        if n_verified < MIN_FEEDBACK_FOR_RETRAINING
        else max(0, 1 - (n_verified - int(meta.get("feedback_used") or 0))),
        "retraining_history": db.get_retraining_history(MODEL_NAME),
    }
