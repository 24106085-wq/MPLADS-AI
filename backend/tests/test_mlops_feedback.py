# backend/tests/test_mlops_feedback.py
"""
Tests for the feedback-driven MLOps workflow added on top of the existing
prototype: feedback persistence (with risk-score/signal snapshot), the
verified-feedback threshold, model versioning, and metadata/history
persistence.

Each test gets its own throwaway SQLite file (via the db_path fixture in
conftest.py) so these tests never touch a real dev database and never
interfere with each other.
"""
import db
import mlops_engine


def _make_project(pid="P1"):
    return {
        "id": pid,
        "workName": "Test Work",
        "sanctionedAmount": 100000,
        "expenditure": 50000,
        "physicalProgress": 50,
        "status": "In Progress",
        "paymentCount": 3,
    }


# ---------------------------------------------------------------------------
# Feedback persistence
# ---------------------------------------------------------------------------


def test_feedback_persists_decision_and_snapshot(db_path):
    db.init_db()
    result = db.insert_feedback(
        "P1", "Confirmed Issue", "looks bad", "district",
        risk_score=72.5, signal_snapshot={"ml_anomaly_score": 0.8, "physicalProgress": 20},
    )
    assert result["id"] is not None
    assert result["risk_score"] == 72.5
    assert result["signal_snapshot"]["ml_anomaly_score"] == 0.8

    stored = db.list_feedback("P1")
    assert len(stored) == 1
    assert stored[0]["decision"] == "Confirmed Issue"
    assert stored[0]["risk_score"] == 72.5
    assert stored[0]["signal_snapshot"]["physicalProgress"] == 20


def test_feedback_survives_reinit(db_path):
    """A second init_db() call (simulating a backend restart) must not lose
    previously stored feedback, and must not fail on the new risk_score/
    signal_snapshot columns already existing."""
    db.init_db()
    db.insert_feedback("P1", "False Positive", None, "mp")
    db.init_db()  # simulate restart
    assert len(db.list_feedback()) == 1


# ---------------------------------------------------------------------------
# Verified feedback dataset (Needs Verification excluded)
# ---------------------------------------------------------------------------


def test_needs_verification_excluded_from_verified_records(db_path):
    db.init_db()
    db.insert_feedback("P1", "Confirmed Issue", None, "mp")
    db.insert_feedback("P2", "False Positive", None, "mp")
    db.insert_feedback("P3", "Needs Verification", None, "mp")

    verified = mlops_engine.verified_feedback_records()
    assert len(verified) == 2
    assert all(f["decision"] != "Needs Verification" for f in verified)


# ---------------------------------------------------------------------------
# Retraining threshold
# ---------------------------------------------------------------------------


def test_retraining_blocked_below_threshold(db_path):
    db.init_db()
    for i in range(5):  # below MIN_FEEDBACK_FOR_RETRAINING (10)
        db.insert_feedback(f"P{i}", "Confirmed Issue", None, "mp")

    projects = [_make_project(f"P{i}") for i in range(20)]
    result = mlops_engine.attempt_feedback_driven_update(projects)

    assert result["updated"] is False
    assert "Not enough verified feedback" in result["message"]
    # Blocked attempts must not create a new version.
    assert result["model_metadata"]["model_version"] == "v1.0"


def test_model_update_when_sufficient_feedback_exists(db_path):
    db.init_db()
    for i in range(7):
        db.insert_feedback(f"C{i}", "Confirmed Issue", None, "mp")
    for i in range(3):
        db.insert_feedback(f"F{i}", "False Positive", None, "mp")

    projects = [_make_project(f"P{i}") for i in range(20)]
    result = mlops_engine.attempt_feedback_driven_update(projects, trigger="Manual")

    assert result["updated"] is True
    assert result["verified_feedback_count"] == 10
    assert result["confirmed_issue_count"] == 7
    assert result["false_positive_count"] == 3
    # contamination calibrated toward the confirmed-issue rate (7/10 = 0.7,
    # clamped to MAX_CONTAMINATION)
    assert 0 < result["calibrated_contamination"] <= mlops_engine.MAX_CONTAMINATION


# ---------------------------------------------------------------------------
# Model version increment
# ---------------------------------------------------------------------------


def test_version_increments_on_successive_updates(db_path):
    db.init_db()
    projects = [_make_project(f"P{i}") for i in range(20)]

    for i in range(10):
        db.insert_feedback(f"A{i}", "Confirmed Issue", None, "mp")
    first = mlops_engine.attempt_feedback_driven_update(projects)
    assert first["updated"] is True
    assert first["new_version"] == "v1.1"

    # No NEW verified feedback yet -> must not bump again.
    stagnant = mlops_engine.attempt_feedback_driven_update(projects)
    assert stagnant["updated"] is False

    # Add one more verified feedback record -> should update again.
    db.insert_feedback("A10", "False Positive", None, "mp")
    second = mlops_engine.attempt_feedback_driven_update(projects)
    assert second["updated"] is True
    assert second["new_version"] == "v1.2"


def test_refresh_never_bumps_version(db_path):
    """Simply reading the registry summary (what the dashboard does on every
    page load) must never itself change the stored version."""
    db.init_db()
    projects = [_make_project(f"P{i}") for i in range(5)]
    before = mlops_engine.build_model_registry_summary(projects)
    after = mlops_engine.build_model_registry_summary(projects)
    assert before["active_model"]["model_version"] == after["active_model"]["model_version"] == "v1.0"


# ---------------------------------------------------------------------------
# Metadata & history persistence
# ---------------------------------------------------------------------------


def test_model_metadata_persists_across_calls(db_path):
    db.init_db()
    for i in range(10):
        db.insert_feedback(f"P{i}", "Confirmed Issue", None, "mp")
    projects = [_make_project(f"P{i}") for i in range(15)]
    mlops_engine.attempt_feedback_driven_update(projects)

    meta = db.get_model_metadata(mlops_engine.MODEL_NAME)
    assert meta["model_version"] == "v1.1"
    assert meta["feedback_used"] == 10
    assert meta["training_records"] == 15
    assert meta["calibration_params"]["confirmed_issue_count"] == 10


def test_retraining_history_persists_every_attempt(db_path):
    db.init_db()
    projects = [_make_project(f"P{i}") for i in range(15)]

    # Bootstraps v1.0 as an "Initial Training" history row.
    mlops_engine.get_active_model_metadata(len(projects))
    history_after_bootstrap = db.get_retraining_history(mlops_engine.MODEL_NAME)
    assert len(history_after_bootstrap) == 1
    assert history_after_bootstrap[0]["version"] == "v1.0"

    for i in range(10):
        db.insert_feedback(f"P{i}", "Confirmed Issue", None, "mp")
    mlops_engine.attempt_feedback_driven_update(projects, trigger="Manual")

    history = db.get_retraining_history(mlops_engine.MODEL_NAME)
    assert len(history) == 2
    assert history[0]["version"] == "v1.1"  # most recent first
    assert history[0]["status"] == "Success"
