# backend/main.py
"""
MPLADS-AI backend — Phase 1 prototype API.

Small, single-file FastAPI service that sits in front of a SQLite-backed
project store (REAL DATA MODE — no sample/demo data is auto-loaded; every
project comes from POST /api/upload or POST /api/projects) and exposes the
risk/anomaly engine in risk_engine.py over HTTP for the existing React
frontend.

Run with:
    uvicorn main:app --reload --port 8000

Design notes (see project brief for full rationale):
- No database is required to run this prototype. PostgreSQL is prepared for
  via the DATABASE_URL environment variable (see .env.example) but is
  entirely optional right now — the app runs fully in-memory otherwise.
- Risk scoring is deterministic and rule-based (risk_engine.py), mirroring
  the frontend's existing riskCalculator.js so both sides agree.
- Rule-based anomaly detection (risk_engine.py) also mirrors the frontend's
  anomalyDetector.js and remains the primary/fallback anomaly signal.
- Milestone 2 adds a genuine, unsupervised ML anomaly signal (Isolation
  Forest, see ml_anomaly.py) and an improved TF-IDF-based duplicate/
  similar-work signal (see duplicate_detector.py). Both are additive,
  exposed via their own endpoints, and never overwrite or feed back into
  the rule-based risk score above.
"""

import io
import json
import logging
import os
from datetime import datetime
from typing import List, Optional

import pandas as pd
from fastapi import Depends, FastAPI, File, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware
from slowapi.util import get_remote_address

import risk_engine as engine
import compliance_engine as compliance
import ml_anomaly
import duplicate_detector
import predictive_model
import early_warning
import monitoring
import alert_prioritizer
import db
import geo_data
import mlops_engine
import workflow
import evidence
import geo
import notifications as notifications_module
import auth

logger = logging.getLogger("mplads_ai")
logging.basicConfig(level=logging.INFO)

# ---------------------------------------------------------------------------
# App setup
# ---------------------------------------------------------------------------

app = FastAPI(
    title="MPLADS-AI Monitoring API",
    description="Production API for the MPLADS AI Monitoring & Analytics Platform.",
    version="1.0.0",
)

# ---------------------------------------------------------------------------
# Production configuration (Milestone 4, Parts F/H) — every deployment-
# specific value below is read from an environment variable, never
# hardcoded. See backend/.env.example for the full list this app actually
# uses.
# ---------------------------------------------------------------------------

# Comma-separated list of allowed browser origins for CORS, e.g.
#   FRONTEND_URL=https://mplads-ai.example.com,https://staging.example.com
# Local dev origins are always included as a convenience fallback so nothing
# breaks if this isn't set yet.
_DEFAULT_DEV_ORIGINS = ["http://localhost:5173", "http://127.0.0.1:5173"]
_configured_origins = [
    o.strip().rstrip("/") for o in os.environ.get("FRONTEND_URL", "").split(",") if o.strip()
]
FRONTEND_ORIGINS = _configured_origins + [o for o in _DEFAULT_DEV_ORIGINS if o not in _configured_origins]

app.add_middleware(
    CORSMiddleware,
    allow_origins=FRONTEND_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------------------------------------------------------------------------
# Rate limiting (documented gap closed) — a basic per-client-IP limit on the
# two endpoint groups most exposed to abuse: the data-ingest endpoint
# (/api/upload, which parses arbitrary uploaded files) and the alert/
# notification-listing endpoints (/api/alerts, /api/notifications, which
# recompute the full monitoring/alert pipeline on every call — the most
# expensive GETs in this API). 10 requests/minute is enough to demonstrate
# the intent for this prototype, not a tuned production value.
# ---------------------------------------------------------------------------

limiter = Limiter(key_func=get_remote_address)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
app.add_middleware(SlowAPIMiddleware)


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    """Milestone 4, Part I — production-safety net. Any unexpected error
    (a bad ML/model edge case, a malformed record, etc.) is returned as a
    clean JSON error instead of crashing the process or leaking a raw
    traceback to the client. The real error is still logged server-side and
    still described (not silently swallowed) in the response detail."""
    logger.exception("Unhandled error while processing %s %s", request.method, request.url.path)
    return JSONResponse(
        status_code=500,
        content={"detail": f"Internal server error while processing this request: {exc}"},
    )


# SQLite is the ONLY source of truth for every project, investigation,
# action, feedback and evidence record (Priority 2 — see backend/db.py).
# The database file is created automatically on first startup. REAL DATA
# MODE: the app never auto-seeds sample/demo projects. A fresh database
# starts with zero projects; the only way projects enter the system is via
# POST /api/projects or POST /api/upload. This guarantees the database —
# not any bundled CSV — is always the source of truth, and that restarting
# the server never loses (or silently reintroduces demo) data.
DATABASE_URL = os.environ.get("DATABASE_URL")  # kept as an optional, unused hook — see README

# Kept for the /api/health response shape; always None now that automatic
# seeding has been removed. Not otherwise used.
SEED_LOAD_ERROR: Optional[str] = None


@app.on_event("startup")
def startup_event():
    db.init_db()
    auth.seed_demo_users()
    print(f"[startup] Using database at {db.DB_PATH} ({len(db.list_projects())} project(s) currently stored). "
          "No sample/demo data is auto-loaded — import a CSV/JSON file via /api/upload or add a project via "
          "/api/projects to populate the dashboard.")


def _all_projects() -> List[dict]:
    """Always reads fresh from SQLite. The dataset is small (a hackathon
    prototype, not a high-traffic service) and every engine here already
    needs the FULL current project set for its "typical"/"similar"
    comparisons, so there is no benefit to an additional in-process cache —
    only a risk of it going stale after a write from another route."""
    return db.list_projects()


def _find_project(project_id: str) -> Optional[dict]:
    return db.get_project(project_id)


def _enriched(project: dict) -> dict:
    return engine.enrich_project(project, _all_projects())


def _enriched_all() -> List[dict]:
    all_projects = _all_projects()
    return [engine.enrich_project(p, all_projects) for p in all_projects]


def _photo_evidence_by_project() -> dict:
    """Strongest field-photo near-duplicate signal per project, from every
    stored evidence record — feeds the multi-signal risk engine's
    'duplicate_evidence' signal (see monitoring.py / multi_signal_risk.py)."""
    by_project: dict = {}
    for e in db.list_evidence():
        pid = e.get("project_id")
        score = e.get("similarity_score") or 0
        if pid not in by_project or score > (by_project[pid].get("similarity_score") or 0):
            by_project[pid] = {
                "similarity_score": score,
                "similarity_reason": (
                    f"Field photo {round(score, 1)}% similar to another stored photo."
                    if score else "No near-duplicate field photo found."
                ),
            }
    return by_project


# ---------------------------------------------------------------------------
# Role-based access control helpers (SIH-demo scope — see workflow.py's
# CAN_* sets for the actual per-action role lists). Two small, shared
# building blocks used across almost every route below:
#   - _authorize_project(): 403s if a LOGGED-IN non-admin role's scope
#     doesn't cover this specific project (e.g. mp_demo requesting another
#     MP's project by guessing/incrementing its id). A no-login caller is
#     left alone here — same "query params are for local API testing"
#     convention already established by list_projects() below — so this is
#     purely about a real bug it fixes: today, once logged in, a scoped
#     role can still reach ANY project's detail/risk/investigation/etc. by
#     project id, because only the /api/projects LIST endpoint filtered.
#   - _visible_project_ids(): for bulk/list endpoints (alerts, compliance,
#     monitoring, ...), returns the exact set of project ids a logged-in
#     non-admin role may see, or None to mean "no filtering" (no login, or
#     admin) so bulk results still get scoped consistently with
#     /api/projects instead of leaking every project's alerts/compliance/
#     monitoring regardless of role.
# ---------------------------------------------------------------------------


def _authorize_project(project: dict, current_user: Optional[dict]) -> None:
    if current_user and not workflow.project_in_scope(
        project, current_user["role"], current_user.get("identifier")
    ):
        raise HTTPException(status_code=403, detail="You don't have access to this project.")


def _visible_project_ids(current_user: Optional[dict]) -> Optional[set]:
    if not current_user or current_user["role"] == "admin":
        return None
    visible = workflow.filter_projects_by_role(
        _all_projects(), current_user["role"], current_user.get("identifier")
    )
    return {p["id"] for p in visible}


# ---------------------------------------------------------------------------
# Request/response models
# ---------------------------------------------------------------------------


class ProjectIn(BaseModel):
    workName: str
    mpName: Optional[str] = "Unknown MP"
    constituency: Optional[str] = "Unknown"
    state: str
    district: str
    category: Optional[str] = "General"
    sanctionedAmount: float = Field(..., gt=0)
    expenditure: float = 0
    physicalProgress: float = Field(0, ge=0, le=100)
    status: Optional[str] = "In Progress"
    startDate: Optional[str] = None
    expectedCompletion: Optional[str] = None
    implementingAgency: Optional[str] = "Not Specified"
    paymentCount: Optional[float] = 3
    id: Optional[str] = None  # ignored if it collides / is omitted — server assigns one


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------


@app.get("/api/health")
def health():
    return {
        "status": "ok",
        "projects_loaded": len(_all_projects()),
        "database_path": db.DB_PATH,
        "seed_data_error": SEED_LOAD_ERROR,
    }


@app.get("/api/roles")
def get_roles():
    """The 4 roles available on the login screen. Which one a logged-in
    user actually has is decided server-side at /api/auth/login and
    signed into their JWT — this list is just labels for the UI."""
    return {"roles": workflow.list_roles()}


# ---------------------------------------------------------------------------
# Authentication (JWT + hashed passwords — see backend/auth.py). A simple,
# backend-verified prototype login: 4 demo accounts, one per role above.
# ---------------------------------------------------------------------------


class LoginIn(BaseModel):
    username: str
    password: str


@app.post("/api/auth/login")
@limiter.limit("10/minute")
def login(request: Request, payload: LoginIn):
    user = auth.authenticate(payload.username, payload.password)
    if not user:
        raise HTTPException(status_code=401, detail="Invalid username or password.")
    token = auth.create_access_token(user)
    return {
        "access_token": token,
        "token_type": "bearer",
        "expires_in_minutes": auth.JWT_EXPIRES_MINUTES,
        "user": auth.user_public_view(user),
    }


@app.get("/api/auth/me")
def get_me(current_user: dict = Depends(auth.get_current_user)):
    """Lets the frontend restore a session (validate a stored token) on
    reload without re-sending the password."""
    return {"user": current_user}


@app.get("/api/projects")
def list_projects(
    role: Optional[str] = None,
    identifier: Optional[str] = None,
    current_user: Optional[dict] = Depends(auth.get_current_user_optional),
):
    """A logged-in, non-admin user's own role/identifier (verified from
    their JWT) always takes priority over the ?role=&identifier= query
    params below — those params exist only for local API testing without
    logging in, and can never be used to point a logged-in MP/district/
    state account at someone else's data by editing the URL."""
    enriched = _enriched_all()
    if current_user:
        enriched = workflow.filter_projects_by_role(enriched, current_user["role"], current_user["identifier"])
    elif role:
        enriched = workflow.filter_projects_by_role(enriched, role, identifier)
    return {"count": len(enriched), "projects": enriched}


@app.get("/api/projects/{project_id}")
def get_project(project_id: str, current_user: Optional[dict] = Depends(auth.get_current_user_optional)):
    project = _find_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail=f"Project '{project_id}' not found.")
    _authorize_project(project, current_user)
    return _enriched(project)


@app.get("/api/projects/{project_id}/risk")
def get_project_risk(project_id: str, current_user: Optional[dict] = Depends(auth.get_current_user_optional)):
    project = _find_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail=f"Project '{project_id}' not found.")
    _authorize_project(project, current_user)

    risk = engine.calculate_risk(project, _all_projects())
    return {
        "project_id": project_id,
        "risk_score": risk["score"],
        "risk_level": risk["level"].upper(),
        "factors": [
            {"name": f["name"], "score": f["points"], "reason": f["explanation"]}
            for f in risk["factors"]
        ],
        "explanation": risk["explanation"],
        "recommended_action": engine.get_recommended_action(risk["level"]),
    }


@app.get("/api/projects/{project_id}/compliance")
def get_project_compliance(project_id: str, current_user: Optional[dict] = Depends(auth.get_current_user_optional)):
    project = _find_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail=f"Project '{project_id}' not found.")
    _authorize_project(project, current_user)
    return compliance.evaluate_compliance(project, _all_projects())


@app.get("/api/compliance")
def get_all_compliance(current_user: Optional[dict] = Depends(auth.get_current_user_optional)):
    """Lightweight bulk endpoint: compliance evaluation for every currently
    loaded project, scoped to the logged-in role like /api/projects (a
    logged-in non-admin never sees another scope's compliance results).
    evaluate_all() doesn't tag each result with a project_id itself, only
    returns them in the same order as all_projects — zip them together so
    both the id tag and the scope filter below are correct."""
    visible_ids = _visible_project_ids(current_user)
    all_projects = _all_projects()
    results = compliance.evaluate_all(all_projects)
    items = [{"project_id": p["id"], **r} for p, r in zip(all_projects, results)]
    if visible_ids is not None:
        items = [i for i in items if i["project_id"] in visible_ids]
    return {"count": len(items), "compliance": items}


@app.get("/api/projects/{project_id}/anomaly")
def get_project_ml_anomaly(project_id: str, current_user: Optional[dict] = Depends(auth.get_current_user_optional)):
    """Milestone 2, Part A: ML (Isolation Forest) anomaly signal for a single
    project. Independent of and additional to the existing rule-based
    anomalies returned by /api/reports/{id} and /api/alerts — does not
    change riskScore/riskLevel."""
    project = _find_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail=f"Project '{project_id}' not found.")
    _authorize_project(project, current_user)
    result = ml_anomaly.compute_ml_anomaly_for_project(
        project, _all_projects(), contamination_override=mlops_engine.get_calibrated_contamination()
    )
    return {"project_id": project_id, **result}


@app.get("/api/ml-anomalies")
def get_all_ml_anomalies(current_user: Optional[dict] = Depends(auth.get_current_user_optional)):
    """Bulk variant of the endpoint above, mirroring the /api/compliance
    convention: ML anomaly result for every currently loaded project,
    scoped to the logged-in role."""
    visible_ids = _visible_project_ids(current_user)
    results = ml_anomaly.compute_ml_anomalies(
        _all_projects(), contamination_override=mlops_engine.get_calibrated_contamination()
    )
    items = [{"project_id": pid, **r} for pid, r in results.items()]
    if visible_ids is not None:
        items = [i for i in items if i["project_id"] in visible_ids]
    return {"count": len(items), "anomalies": items}


@app.get("/api/projects/{project_id}/duplicates")
def get_project_duplicates(project_id: str, current_user: Optional[dict] = Depends(auth.get_current_user_optional)):
    """Milestone 2, Part B: improved TF-IDF + location + amount similarity
    duplicate/similar-work signal for a single project. Independent of the
    existing word-overlap based duplicate indicator inside risk_engine.py's
    calculate_risk() — does not change riskScore/riskLevel."""
    project = _find_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail=f"Project '{project_id}' not found.")
    _authorize_project(project, current_user)
    result = duplicate_detector.compute_duplicates_for_project(project, _all_projects())
    return {"project_id": project_id, **result}


@app.get("/api/duplicates")
def get_all_duplicates(current_user: Optional[dict] = Depends(auth.get_current_user_optional)):
    """Bulk variant of the endpoint above, mirroring the /api/compliance
    convention: duplicate-detection result for every currently loaded
    project, scoped to the logged-in role. Note: matches against a
    same-scope duplicate are still found (compute_duplicate_matches still
    compares against the FULL dataset internally, as it should — only the
    returned, top-level list of "which project's result do you get to see"
    is scope-filtered here)."""
    visible_ids = _visible_project_ids(current_user)
    results = duplicate_detector.compute_duplicate_matches(_all_projects())
    items = [{"project_id": pid, **r} for pid, r in results.items()]
    if visible_ids is not None:
        items = [i for i in items if i["project_id"] in visible_ids]
    return {"count": len(items), "duplicates": items}


@app.get("/api/projects/{project_id}/prediction")
def get_project_prediction(project_id: str, current_user: Optional[dict] = Depends(auth.get_current_user_optional)):
    """Milestone 3, Parts A & B: predictive delay + cost-overrun probability
    for a single project. Independent of and additional to riskScore/
    riskLevel above — a genuine (logistic regression) supervised ML signal,
    not a restatement of the rule-based risk engine. See predictive_model.py
    for label definitions, leakage avoidance and why cost-overrun prediction
    reports "unavailable" on the current sample dataset."""
    project = _find_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail=f"Project '{project_id}' not found.")
    _authorize_project(project, current_user)

    delay = predictive_model.predict_delay_for_project(project, _all_projects())
    overrun = predictive_model.compute_cost_overrun_predictions(_all_projects()).get(project_id, {})

    return {
        "project_id": project_id,
        "delay_probability": delay["delay_probability"],
        "predicted_delay": delay["predicted_delay"],
        "model_status": delay["model_status"],
        "cost_overrun_probability": overrun.get("cost_overrun_probability"),
        "predicted_cost_overrun": overrun.get("predicted_cost_overrun"),
        "cost_overrun_model_status": overrun.get("model_status", "unavailable"),
        "model_confidence": delay["model_confidence"],
        "sample_size": delay["sample_size"],
        "validation_metrics": delay["validation_metrics"],
        "model_notes": delay["model_notes"],
        "disclaimer": predictive_model.DELAY_DISCLAIMER,
    }


@app.get("/api/projects/{project_id}/explanation")
def get_project_explanation(project_id: str, current_user: Optional[dict] = Depends(auth.get_current_user_optional)):
    """Milestone 3, Part C: explains the delay prediction above using real
    SHAP values when the `shap` package is available, otherwise a clearly
    labeled linear feature-importance fallback (never fake SHAP output)."""
    project = _find_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail=f"Project '{project_id}' not found.")
    _authorize_project(project, current_user)

    explanation = predictive_model.explain_delay_prediction(project, _all_projects())
    return {
        "project_id": project_id,
        "explains": "delay_prediction",
        **explanation,
        "disclaimer": predictive_model.DELAY_DISCLAIMER,
    }


@app.get("/api/projects/{project_id}/monitoring")
def get_project_monitoring(project_id: str, current_user: Optional[dict] = Depends(auth.get_current_user_optional)):
    """Milestone 4, Part B: unified project monitoring object — combines
    project/financial/physical summaries with risk, compliance, AI
    (ML anomaly, duplicate, delay/cost-overrun prediction) and early
    warning signals in ONE response. See monitoring.py; no business logic
    is duplicated here or in the frontend."""
    project = _find_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail=f"Project '{project_id}' not found.")
    _authorize_project(project, current_user)
    result = monitoring.build_project_monitoring(project_id, _all_projects(), _photo_evidence_by_project())
    if result is None:
        raise HTTPException(status_code=404, detail=f"Monitoring data unavailable for '{project_id}'.")
    return result


@app.get("/api/monitoring")
def get_all_monitoring(current_user: Optional[dict] = Depends(auth.get_current_user_optional)):
    """Bulk variant of the endpoint above — unified monitoring for every
    currently loaded project, computed in one pass (see monitoring.py's
    efficiency note), then scoped to the logged-in role like /api/projects."""
    visible_ids = _visible_project_ids(current_user)
    results = monitoring.build_all_monitoring(_all_projects(), _photo_evidence_by_project())
    items = list(results.values())
    if visible_ids is not None:
        items = [m for m in items if m.get("project", {}).get("id") in visible_ids]
    return {"count": len(items), "monitoring": items}


@app.get("/api/dashboard/summary")
def get_dashboard_summary(current_user: Optional[dict] = Depends(auth.get_current_user_optional)):
    """Milestone 4, Part E: backend-generated aggregate KPIs for the Final
    Dashboard, so the frontend only has to display these numbers, not
    re-derive them. Computed over only the logged-in role's own projects —
    an MP/district/state account gets a dashboard about their own scope,
    not the whole country's."""
    all_projects = _all_projects()
    if current_user and current_user["role"] != "admin":
        all_projects = workflow.filter_projects_by_role(
            all_projects, current_user["role"], current_user.get("identifier")
        )
    return monitoring.build_dashboard_summary(all_projects)


@app.get("/api/alerts")
@limiter.limit("10/minute")
def get_alerts(request: Request, current_user: Optional[dict] = Depends(auth.get_current_user_optional)):
    """Milestone 4, Part C: unified, prioritized alert list — existing
    rule-based anomalies (risk_engine.detect_all_anomalies, unchanged) plus
    new alerts for RED/ORANGE early warnings, compliance violations,
    potential duplicates, ML anomalies and high delay/cost-overrun
    predictions. Recomputed fresh on every call from the current in-memory
    project set — nothing is persisted or duplicated across requests. See
    alert_prioritizer.py for the priority ordering. Scoped to the logged-in
    role: an MP/district/state account only ever sees alerts for their own
    projects, same as /api/projects."""
    visible_ids = _visible_project_ids(current_user)
    all_projects = _all_projects()
    monitoring_by_id = monitoring.build_all_monitoring(all_projects, _photo_evidence_by_project())
    alerts = alert_prioritizer.build_prioritized_alerts(all_projects, monitoring_by_id)
    if visible_ids is not None:
        alerts = [a for a in alerts if a.get("project_id") in visible_ids]
    return {"count": len(alerts), "alerts": alerts}


# ---------------------------------------------------------------------------
# Notifications (bell icon) — see backend/notifications.py for what
# generates these. Every GET re-syncs project-alert-derived notifications
# (idempotent, dedupe_key-based) before returning the current list; workflow
# events (import/investigation/evidence/feedback/retrain) insert their own
# notification directly at the point they happen, below.
# ---------------------------------------------------------------------------


@app.get("/api/notifications")
@limiter.limit("10/minute")
def get_notifications(request: Request):
    settings = db.get_settings()
    all_projects = _all_projects()
    monitoring_by_id = monitoring.build_all_monitoring(all_projects, _photo_evidence_by_project())
    alerts = alert_prioritizer.build_prioritized_alerts(all_projects, monitoring_by_id)
    notifications_module.sync_alert_notifications(alerts, settings)
    items = db.list_notifications()
    for item in items:
        item.pop("_was_new", None)
    return {"count": len(items), "unread_count": db.count_unread_notifications(), "notifications": items}


@app.post("/api/notifications/{notification_id}/read")
def mark_notification_read(notification_id: int):
    updated = db.mark_notification_read(notification_id)
    if not updated:
        raise HTTPException(status_code=404, detail=f"Notification {notification_id} not found.")
    return updated


@app.post("/api/notifications/read-all")
def mark_all_notifications_read():
    return {"updated": db.mark_all_notifications_read()}


# ---------------------------------------------------------------------------
# Settings (Profile / Notification Preferences / Display / Data Status).
# Persisted server-side in SQLite (db.app_settings) so notification
# preferences genuinely gate what notifications.py generates. Display
# defaults are also accepted here, but the frontend keeps its own
# localStorage copy for the "applies instantly, this browser only" case —
# see the docstring in Settings.jsx.
# ---------------------------------------------------------------------------


def _settings_response() -> dict:
    s = db.get_settings()
    return {
        "profile": {
            "name": s["profile_name"],
            "role": s["profile_role"],
            "organization": s["profile_org"],
        },
        "notification_preferences": {
            "high_risk_alerts": s["notify_high_risk"],
            "investigation_updates": s["notify_investigation"],
            "import_notifications": s["notify_import"],
            "mlops_notifications": s["notify_mlops"],
        },
        "display": {
            "default_map_view": s.get("default_map_view"),
            "default_risk_filter": s.get("default_risk_filter"),
        },
        "data_status": {
            "imported_project_count": len(_all_projects()),
            "last_import_at": s.get("last_import_at"),
            "database_status": "Connected (SQLite)",
            "database_path": db.DB_PATH,
        },
        "updated_at": s.get("updated_at"),
    }


class SettingsIn(BaseModel):
    profile_name: Optional[str] = None
    profile_role: Optional[str] = None
    profile_org: Optional[str] = None
    notify_high_risk: Optional[bool] = None
    notify_investigation: Optional[bool] = None
    notify_import: Optional[bool] = None
    notify_mlops: Optional[bool] = None
    default_map_view: Optional[str] = None
    default_risk_filter: Optional[str] = None


@app.get("/api/settings")
def get_settings():
    return _settings_response()


@app.put("/api/settings")
def put_settings(payload: SettingsIn, current_user: dict = Depends(auth.get_current_user)):
    data = payload.model_dump() if hasattr(payload, "model_dump") else payload.dict()
    patch = {k: v for k, v in data.items() if v is not None}
    db.update_settings(patch)
    return _settings_response()


# ---------------------------------------------------------------------------
# Add Project — State / District / Constituency geography (isolated feature;
# see geo_data.py). GET /api/geo/regions feeds the cascading dropdowns so
# the frontend never hardcodes a second copy of this data; the same module
# backs the server-side check in create_project() below so an invalid
# state/district combination submitted directly to the API (bypassing the
# UI) is rejected, not just discouraged client-side.
# ---------------------------------------------------------------------------


@app.get("/api/geo/regions")
def get_geo_regions():
    return geo_data.regions_payload()


@app.post("/api/projects", status_code=201)
def create_project(
    payload: ProjectIn,
    current_user: dict = Depends(auth.require_role(*workflow.CAN_MANAGE_PROJECTS)),
):
    if not geo_data.is_valid_state(payload.state):
        raise HTTPException(status_code=400, detail=f"'{payload.state}' is not a recognized state/UT.")
    if not geo_data.is_valid_state_district(payload.state, payload.district):
        raise HTTPException(
            status_code=400,
            detail=f"'{payload.district}' is not a recognized district of {payload.state}.",
        )

    data = payload.model_dump() if hasattr(payload, "model_dump") else payload.dict()
    new_id = engine.generate_project_id(_all_projects())
    data["id"] = new_id
    data.setdefault("duplicateFlag", False)
    data.setdefault("latitude", None)
    data.setdefault("longitude", None)
    db.insert_project(data)
    return _enriched(data)


@app.post("/api/upload")
@limiter.limit("10/minute")
async def upload_data(
    request: Request,
    file: UploadFile = File(...),
    current_user: dict = Depends(auth.require_role(*workflow.CAN_MANAGE_PROJECTS)),
):
    """Accepts either a .csv or a .json file (Priority 10 fix — the UI's
    "CSV / JSON" wording now matches what the backend actually supports,
    instead of silently rejecting JSON). JSON files may be either a bare
    array of row objects or {"projects": [...]}. Both formats share the
    same column-alias normalization/validation as the CSV path below, and
    every accepted row is persisted to SQLite so it survives a restart."""
    filename = file.filename.lower()
    is_json = filename.endswith(".json")
    is_csv = filename.endswith(".csv")
    if not (is_csv or is_json):
        raise HTTPException(status_code=400, detail="Only .csv or .json files are accepted.")

    raw = await file.read()

    if is_csv:
        try:
            df = pd.read_csv(io.BytesIO(raw))
        except Exception as exc:  # malformed CSV
            raise HTTPException(status_code=400, detail=f"Could not parse CSV: {exc}") from exc
        if df.empty:
            raise HTTPException(status_code=400, detail="CSV file has no rows.")
        normalized_cols = {c.strip().lower() for c in df.columns}
        rows = df.where(pd.notnull(df), None).to_dict(orient="records")
    else:
        try:
            parsed = json.loads(raw.decode("utf-8"))
        except Exception as exc:  # malformed JSON
            raise HTTPException(status_code=400, detail=f"Could not parse JSON: {exc}") from exc
        rows = parsed if isinstance(parsed, list) else parsed.get("projects", [])
        if not rows:
            raise HTTPException(status_code=400, detail="JSON file has no rows.")
        normalized_cols = {str(k).strip().lower() for row in rows for k in row.keys()}

    # A required column is present if any of its known aliases is present.
    missing = []
    for canonical in engine.REQUIRED_IMPORT_COLUMNS:
        aliases = engine._COLUMN_ALIASES[canonical]
        if not any(alias in normalized_cols for alias in aliases):
            missing.append(canonical)
    if missing:
        raise HTTPException(
            status_code=400,
            detail=f"File is missing required column(s): {', '.join(missing)}",
        )

    existing = _all_projects()

    def _dedupe_key(p: dict) -> tuple:
        # A project is treated as a duplicate of one already on file (or
        # already accepted earlier in this same import) when its work name,
        # state, district and sanctioned amount all match — a reasonable,
        # explainable proxy for "the same record submitted again" without a
        # guaranteed external project-ID from the source file.
        return (
            str(p.get("workName", "")).strip().lower(),
            str(p.get("state", "")).strip().lower(),
            str(p.get("district", "")).strip().lower(),
            round(float(p.get("sanctionedAmount") or 0), 2),
        )

    existing_keys = {_dedupe_key(p): p.get("id") for p in existing}

    accepted, rejected, duplicates = [], [], []

    for row in rows:
        normalized = engine.normalize_imported_row(row)
        valid, errors = engine.validate_imported_row(normalized)
        if not valid:
            rejected.append({"row": row, "errors": errors})
            continue

        key = _dedupe_key(normalized)
        if key in existing_keys:
            duplicates.append({
                "row": row,
                "reason": f"Duplicate of existing project '{existing_keys[key]}' "
                          "(same work name, state, district and sanctioned amount).",
            })
            continue

        normalized["id"] = engine.generate_project_id(existing + accepted)
        normalized.setdefault("duplicateFlag", False)
        normalized.setdefault("latitude", None)
        normalized.setdefault("longitude", None)
        accepted.append(normalized)
        # Prevents two duplicate rows within the SAME file from both being
        # imported — the first one wins, later ones are flagged too.
        existing_keys[key] = normalized["id"]

    for project in accepted:
        db.insert_project(project)

    if accepted:
        db.record_import_now()
        notifications_module.notify_import_completed(
            len(accepted), len(rejected), len(duplicates), db.get_settings()
        )

    return {
        "success": True,
        # New, explicit import-summary fields (Real Data Mode requirement).
        "records_received": len(rows),
        "records_imported": len(accepted),
        "records_rejected": len(rejected),
        "duplicate_records": len(duplicates),
        "duplicate_details": duplicates,
        "rejected_details": rejected,
        # Kept for backward compatibility with any existing caller.
        "rows_processed": len(accepted),
        "rows_rejected": len(rejected),
        "projects": [_enriched(p) for p in accepted],
    }


@app.get("/api/reports/{project_id}")
def get_project_report(project_id: str, current_user: Optional[dict] = Depends(auth.get_current_user_optional)):
    project = _find_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail=f"Project '{project_id}' not found.")
    _authorize_project(project, current_user)

    enriched = _enriched(project)
    anomalies = engine.detect_project_anomalies(project)
    duplicates = engine.find_duplicate_matches(project, _all_projects())

    return {
        "generated_at": datetime.utcnow().isoformat() + "Z",
        "project": enriched,
        "risk": {
            "score": enriched["riskScore"],
            "level": enriched["riskLevel"],
            "factors": enriched["riskFactors"],
            "explanation": enriched["riskExplanation"],
            "recommended_action": engine.get_recommended_action(enriched["riskLevel"]),
        },
        "anomalies": anomalies,
        "duplicate_matches": [
            {
                "project_id": m["project"]["id"],
                "work_name": m["project"].get("workName"),
                "similarity": m["similarity"],
                "matched_fields": m["matchedFields"],
            }
            for m in duplicates
        ],
        "disclaimer": "AI-assisted / rule-based prototype analysis — not a trained ML model.",
    }


# ---------------------------------------------------------------------------
# Priority 4 — Investigation workflow (Investigate -> Verify -> Take Action
# -> Track & Close). Thin wrappers over workflow.py / db.py; see workflow.py
# for the actual state machine and valid actions/statuses.
# ---------------------------------------------------------------------------


class ActionIn(BaseModel):
    action: str  # one of workflow.VALID_ACTIONS: Verify, Recommend, Hold, Escalate, Close, Reopen
    role: Optional[str] = None
    remarks: Optional[str] = None


@app.get("/api/projects/{project_id}/investigation")
def get_investigation(project_id: str, current_user: Optional[dict] = Depends(auth.get_current_user_optional)):
    project = _find_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail=f"Project '{project_id}' not found.")
    _authorize_project(project, current_user)
    return workflow.get_investigation_state(project_id)


@app.post("/api/projects/{project_id}/investigation/action")
def post_investigation_action(
    project_id: str,
    payload: ActionIn,
    current_user: dict = Depends(auth.require_role(*workflow.CAN_TAKE_INVESTIGATION_ACTION)),
):
    project = _find_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail=f"Project '{project_id}' not found.")
    # Role is already gated to CAN_TAKE_INVESTIGATION_ACTION above; on top
    # of that, a non-admin (district/state) may only action a project
    # within their own scope — same rule as every read endpoint.
    _authorize_project(project, current_user)
    # The acting role is the server-verified one from the JWT, never the
    # client-supplied payload.role — see auth.py.
    try:
        result = workflow.apply_action(project_id, payload.action, current_user["role_label"], payload.remarks)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    notifications_module.notify_investigation_change(
        project_id, project.get("workName"), payload.action,
        result.get("resulting_status"), db.get_settings(),
    )
    return result


# ---------------------------------------------------------------------------
# Priority 7 — Feedback (Confirmed Issue / False Positive / Needs
# Verification), persisted to SQLite and fed into the MLOps view below.
# ---------------------------------------------------------------------------


class FeedbackIn(BaseModel):
    decision: str  # one of workflow.FEEDBACK_DECISIONS
    remarks: Optional[str] = None
    role: Optional[str] = None


@app.post("/api/projects/{project_id}/feedback")
def post_feedback(project_id: str, payload: FeedbackIn, current_user: dict = Depends(auth.get_current_user)):
    project = _find_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail=f"Project '{project_id}' not found.")
    # Any logged-in role may submit feedback (an MP flagging a concern on
    # their own project is exactly the workflow this exists for) — but only
    # about a project within their own scope; admin is unrestricted.
    _authorize_project(project, current_user)

    # Snapshot the risk score / signal state AS OF THIS MOMENT, before the
    # feedback is recorded — a later change to the project's data must never
    # retroactively change what this feedback record says the system
    # believed at the time (see db.insert_feedback's docstring).
    monitoring_snapshot = monitoring.build_project_monitoring(project_id, _all_projects(), _photo_evidence_by_project())
    risk_score = monitoring_snapshot["risk"]["score"] if monitoring_snapshot else None
    signal_snapshot = (
        {
            "risk_level": monitoring_snapshot["risk"]["level"],
            "ml_anomaly_score": monitoring_snapshot["ai"]["ml_anomaly_score"],
            "ml_anomaly_flag": monitoring_snapshot["ai"]["ml_anomaly_flag"],
            "physicalProgress": monitoring_snapshot["physical"]["physicalProgress"],
            "financialProgress": monitoring_snapshot["financial"]["financialProgress"],
            "overdueDays": monitoring_snapshot["physical"]["overdueDays"],
        }
        if monitoring_snapshot
        else None
    )

    # Server-verified role, same reasoning as post_investigation_action above.
    try:
        result = workflow.submit_feedback(
            project_id, payload.decision, payload.remarks, current_user["role_label"], risk_score, signal_snapshot
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    notifications_module.notify_feedback_submitted(
        project_id, project.get("workName"), payload.decision, db.get_settings()
    )
    return result


@app.get("/api/projects/{project_id}/feedback")
def get_project_feedback(project_id: str, current_user: Optional[dict] = Depends(auth.get_current_user_optional)):
    project = _find_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail=f"Project '{project_id}' not found.")
    _authorize_project(project, current_user)
    return {"feedback": db.list_feedback(project_id)}


@app.get("/api/feedback")
def get_all_feedback(current_user: Optional[dict] = Depends(auth.get_current_user_optional)):
    visible_ids = _visible_project_ids(current_user)
    items = db.list_feedback()
    if visible_ids is not None:
        items = [f for f in items if f.get("project_id") in visible_ids]
    return {"feedback": items}


# ---------------------------------------------------------------------------
# Priority 8 — lightweight MLOps prototype view. Only real, stored values —
# see workflow.build_mlops_summary()'s docstring for why nothing here is a
# fabricated accuracy/drift metric.
# ---------------------------------------------------------------------------


@app.get("/api/mlops/summary")
def get_mlops_summary(current_user: dict = Depends(auth.require_role(*workflow.CAN_VIEW_MLOPS))):
    all_projects = _all_projects()
    calibrated_contamination = mlops_engine.get_calibrated_contamination()
    ml_meta = ml_anomaly.compute_ml_anomalies(all_projects, contamination_override=calibrated_contamination)
    sample_ml = next(iter(ml_meta.values()), {})
    delay_meta = predictive_model.compute_delay_predictions(all_projects)
    sample_delay = next(iter(delay_meta.values()), {})
    return workflow.build_mlops_summary(all_projects, sample_ml, sample_delay)


@app.post("/api/mlops/retrain")
def post_mlops_retrain(notes: str = "", current_user: dict = Depends(auth.require_role(*workflow.CAN_RETRAIN_MLOPS))):
    """Real feedback-driven model update trigger (Priority 8): recalibrates
    the anomaly detector against verified officer feedback collected so far
    (see mlops_engine.attempt_feedback_driven_update()) when — and only
    when — at least MIN_FEEDBACK_FOR_RETRAINING new verified feedback
    records exist; otherwise returns an honest 'not enough feedback yet'
    result rather than fabricating a version bump."""
    result = workflow.trigger_retrain(_all_projects(), notes)
    notifications_module.notify_mlops_retrain(
        notes or result.get("message", ""), db.get_settings()
    )
    return result


# ---------------------------------------------------------------------------
# Priority 5 — Field photo / evidence pipeline. Uploaded images are
# validated, quality-scored, checked for EXIF metadata and near-duplicate
# hashed (see evidence.py), then persisted to SQLite (see db.py) and fed
# into the multi-signal risk engine via _photo_evidence_by_project().
# ---------------------------------------------------------------------------


@app.post("/api/projects/{project_id}/evidence")
async def upload_evidence(project_id: str, file: UploadFile = File(...)):
    project = _find_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail=f"Project '{project_id}' not found.")

    raw = await file.read()
    existing_hashes = db.all_image_hashes(exclude_project_id=project_id)
    result = evidence.process_uploaded_image(raw, file.content_type, existing_hashes)
    if not result["success"]:
        raise HTTPException(status_code=400, detail=result["message"])

    record = db.insert_evidence({
        "project_id": project_id,
        "kind": "image",
        "original_filename": file.filename,
        "stored_filename": None,  # prototype: bytes are not persisted to disk, only their analysis
        "content_type": file.content_type,
        "size_bytes": len(raw),
        "width": result["quality"]["width"],
        "height": result["quality"]["height"],
        "avg_hash": result["avg_hash"],
        "quality_score": result["quality"]["quality_score"],
        "quality_notes": result["quality"]["quality_notes"],
        "near_duplicate_of": result["near_duplicates"][0]["evidence_id"] if result["near_duplicates"] else None,
        "similarity_score": result["similarity_score"],
    })

    notifications_module.notify_evidence_uploaded(
        project_id, project.get("workName"), file.filename, db.get_settings()
    )

    return {
        **result,
        "evidence_id": record["id"],
        "uploaded_at": record["uploaded_at"],
        "label": "Field Photo Evidence Analysis",  # honest wording — see evidence.py docstring
    }


@app.get("/api/projects/{project_id}/evidence")
def list_project_evidence(project_id: str):
    return {"evidence": db.list_evidence(project_id)}


# ---------------------------------------------------------------------------
# Priority 6 — Project Map. Real lat/lon per project (geo.py). REAL DATA
# MODE: a project with no valid coordinates on file is never given a fake
# marker — it's reported with locationUnavailable: True instead.
# ---------------------------------------------------------------------------


@app.get("/api/geo/projects")
def get_geo_projects():
    all_projects = _all_projects()
    monitoring_by_id = monitoring.build_all_monitoring(all_projects, _photo_evidence_by_project())
    markers = []
    unmapped_count = 0
    for project in all_projects:
        coords = geo.resolve_coordinates(project)
        if coords["locationUnavailable"]:
            unmapped_count += 1
        m = monitoring_by_id.get(project["id"], {})
        markers.append({
            "id": project["id"],
            "workName": project.get("workName"),
            "state": project.get("state"),
            "district": project.get("district"),
            "latitude": coords["latitude"],
            "longitude": coords["longitude"],
            "locationUnavailable": coords["locationUnavailable"],
            "sanctionedAmount": project.get("sanctionedAmount"),
            "expenditure": project.get("expenditure"),
            "physicalProgress": project.get("physicalProgress"),
            "riskScore": m.get("risk", {}).get("score"),
            "riskLevel": m.get("risk", {}).get("level"),
            "topRiskFactors": (m.get("risk", {}).get("factors") or [])[:3],
        })
    return {"count": len(markers), "unmapped_count": unmapped_count, "markers": markers}


# ---------------------------------------------------------------------------
# Entry point for platforms that run `python main.py` directly (e.g. some
# PaaS providers inject a $PORT env var rather than letting you pass
# --port on the uvicorn CLI). `uvicorn main:app --host 0.0.0.0 --port 8000`
# continues to work exactly as before for local development.
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import uvicorn

    uvicorn.run("main:app", host="0.0.0.0", port=int(os.environ.get("PORT", 8000)))
