// src/utils/apiClient.js
// Minimal client for the FastAPI backend (backend/main.py).
// Every call is wrapped with a short timeout and never throws uncaught —
// callers get either the parsed data or a rejected promise they can
// gracefully fall back on, per the "backend optional" requirement.

// Strip any trailing slash so a deployment env var like
// "https://api.example.com/" doesn't produce double-slash request URLs
// (`${API_BASE}${path}` below always supplies its own leading "/").
const API_BASE = (import.meta.env.VITE_API_BASE_URL || "http://localhost:8000").replace(/\/+$/, "");
const TIMEOUT_MS = 10000;
const HEALTH_TIMEOUT_MS = 60000;
// ---------------------------------------------------------------------------
// Auth session (JWT + hashed passwords — see backend/auth.py). The token is
// the actual security boundary, checked server-side on every protected
// request; what's cached here in localStorage is only a convenience so the
// app doesn't have to re-prompt for a password on every page reload, and so
// UI bits (e.g. the investigation modal's "acting as" label) can read the
// logged-in user's identity without prop-drilling it through every page.
// ---------------------------------------------------------------------------

const AUTH_TOKEN_KEY = "mplads_auth_token";
const AUTH_USER_KEY = "mplads_auth_user";

export function getAuthToken() {
  return localStorage.getItem(AUTH_TOKEN_KEY);
}

export function getStoredUser() {
  try {
    const raw = localStorage.getItem(AUTH_USER_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function setAuthSession(token, user) {
  localStorage.setItem(AUTH_TOKEN_KEY, token);
  localStorage.setItem(AUTH_USER_KEY, JSON.stringify(user));
}

export function clearAuthSession() {
  localStorage.removeItem(AUTH_TOKEN_KEY);
  localStorage.removeItem(AUTH_USER_KEY);
}

async function request(path, options = {}, timeoutMs = TIMEOUT_MS) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const token = getAuthToken();
  const headers = { ...(options.headers || {}) };
  if (token) headers.Authorization = `Bearer ${token}`;
  try {
    const res = await fetch(`${API_BASE}${path}`, { ...options, headers, signal: controller.signal });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.detail || `Request to ${path} failed with status ${res.status}`);
    }
    return await res.json();
  } finally {
    clearTimeout(timeout);
  }
}

// ---------------------------------------------------------------------------
// Authentication endpoints (backend/main.py's /api/auth/*).
// ---------------------------------------------------------------------------

export async function loginViaApi(username, password) {
  return request("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
}

/** Validates the stored token (if any) against the backend and returns the
 * verified user — used to restore a session on page reload. */
export async function fetchMeFromApi() {
  return request("/api/auth/me");
}

/** True if the FastAPI backend responds within the timeout window. */
export async function checkBackendHealth() {
  try {
    await request("/api/health", {}, HEALTH_TIMEOUT_MS);
    return true;
  } catch {
    return false;
  }
}

/** Fetches all projects (already risk-enriched by the backend). */
export async function fetchProjectsFromApi() {
  const data = await request("/api/projects");
  return data.projects || [];
}

export async function fetchProjectFromApi(projectId) {
  return request(`/api/projects/${encodeURIComponent(projectId)}`);
}

export async function fetchProjectRiskFromApi(projectId) {
  return request(`/api/projects/${encodeURIComponent(projectId)}/risk`);
}

/** Compliance Engine endpoints (Milestone 1) — additive, independent of the
 * risk endpoints above. Not wired into the UI yet: the UI currently computes
 * compliance client-side via utils/complianceChecker.js so it works with or
 * without the backend, matching this file's existing risk/alerts pattern. */
export async function fetchProjectComplianceFromApi(projectId) {
  return request(`/api/projects/${encodeURIComponent(projectId)}/compliance`);
}

export async function fetchAllComplianceFromApi() {
  const data = await request("/api/compliance");
  return data.compliance || [];
}

/** Milestone 2 — ML anomaly detection (Isolation Forest, see
 * backend/ml_anomaly.py) and improved duplicate/similar-work detection
 * (TF-IDF + cosine similarity, see backend/duplicate_detector.py).
 * Both are additive/independent of riskScore — callers should degrade
 * gracefully (e.g. hide the section) if the backend isn't reachable,
 * same as every other endpoint in this file. */
export async function fetchProjectMlAnomalyFromApi(projectId) {
  return request(`/api/projects/${encodeURIComponent(projectId)}/anomaly`);
}

export async function fetchProjectDuplicatesFromApi(projectId) {
  return request(`/api/projects/${encodeURIComponent(projectId)}/duplicates`);
}

/** Milestone 3 — predictive delay/cost-overrun model (see
 * backend/predictive_model.py) and its SHAP/feature-importance explanation.
 * Additive/independent of riskScore, same "backend optional" degrade-
 * gracefully pattern as every other endpoint in this file. */
export async function fetchProjectPredictionFromApi(projectId) {
  return request(`/api/projects/${encodeURIComponent(projectId)}/prediction`);
}

export async function fetchProjectExplanationFromApi(projectId) {
  return request(`/api/projects/${encodeURIComponent(projectId)}/explanation`);
}

export async function fetchAlertsFromApi() {
  const data = await request("/api/alerts");
  return data.alerts || [];
}

/** Milestone 4 — unified project monitoring (see backend/monitoring.py):
 * one object per project combining risk, compliance, AI and early-warning
 * signals. Additive/optional — callers should degrade gracefully (e.g. fall
 * back to the client-side mirrors already used elsewhere) if the backend
 * isn't reachable, same "backend optional" pattern as the rest of this file. */
export async function fetchProjectMonitoringFromApi(projectId) {
  return request(`/api/projects/${encodeURIComponent(projectId)}/monitoring`);
}

export async function fetchAllMonitoringFromApi() {
  const data = await request("/api/monitoring");
  return data.monitoring || [];
}

/** Milestone 4, Part E — backend-generated Final Dashboard aggregate KPIs. */
export async function fetchDashboardSummaryFromApi() {
  return request("/api/dashboard/summary");
}

export async function fetchProjectReportFromApi(projectId) {
  return request(`/api/reports/${encodeURIComponent(projectId)}`);
}

export async function createProjectViaApi(project) {
  return request("/api/projects", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(project),
  });
}

/** Uploads a .csv or .json file to the backend for parsing + validation
 * (backend/main.py's /api/upload accepts both — Priority 10 fix). */
export async function uploadDataViaApi(file) {
  const formData = new FormData();
  formData.append("file", file);
  return request("/api/upload", { method: "POST", body: formData });
}

// ---------------------------------------------------------------------------
// Priority 9 — roles / role-based project access.
// ---------------------------------------------------------------------------

export async function fetchRolesFromApi() {
  const data = await request("/api/roles");
  return data.roles || [];
}

export async function fetchProjectsForRoleFromApi(role, identifier) {
  const params = new URLSearchParams();
  if (role) params.set("role", role);
  if (identifier) params.set("identifier", identifier);
  const qs = params.toString();
  const data = await request(`/api/projects${qs ? `?${qs}` : ""}`);
  return data.projects || [];
}

// ---------------------------------------------------------------------------
// Priority 4 — investigation workflow (Investigate -> Verify -> Take
// Action -> Track & Close). Statuses/actions are validated server-side by
// workflow.py; SQLite is the source of truth for status + action history.
// ---------------------------------------------------------------------------

export async function fetchInvestigationFromApi(projectId) {
  return request(`/api/projects/${encodeURIComponent(projectId)}/investigation`);
}

export async function postInvestigationActionViaApi(projectId, action, role, remarks) {
  return request(`/api/projects/${encodeURIComponent(projectId)}/investigation/action`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, role, remarks }),
  });
}

// ---------------------------------------------------------------------------
// Priority 7 — feedback (Confirmed Issue / False Positive / Needs
// Verification), persisted to SQLite.
// ---------------------------------------------------------------------------

export async function postFeedbackViaApi(projectId, decision, remarks, role) {
  return request(`/api/projects/${encodeURIComponent(projectId)}/feedback`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ decision, remarks, role }),
  });
}

export async function fetchProjectFeedbackFromApi(projectId) {
  const data = await request(`/api/projects/${encodeURIComponent(projectId)}/feedback`);
  return data.feedback || [];
}

// ---------------------------------------------------------------------------
// Priority 8 — lightweight MLOps prototype view. Only real, stored values —
// see backend/workflow.py's build_mlops_summary() for why nothing here is
// a fabricated accuracy/drift metric.
// ---------------------------------------------------------------------------

export async function fetchMlopsSummaryFromApi() {
  return request("/api/mlops/summary");
}

export async function triggerMlopsRetrainViaApi(notes = "") {
  return request(`/api/mlops/retrain?notes=${encodeURIComponent(notes)}`, { method: "POST" });
}

// ---------------------------------------------------------------------------
// Priority 5 — field photo / evidence pipeline (backend/evidence.py):
// quality analysis, EXIF metadata where available, near-duplicate
// detection. Honestly labeled "Field Photo Evidence Analysis" — this is
// NOT object-recognition / fraud-detection computer vision.
// ---------------------------------------------------------------------------

export async function uploadEvidenceViaApi(projectId, file) {
  const formData = new FormData();
  formData.append("file", file);
  return request(`/api/projects/${encodeURIComponent(projectId)}/evidence`, {
    method: "POST",
    body: formData,
  });
}

export async function fetchProjectEvidenceFromApi(projectId) {
  const data = await request(`/api/projects/${encodeURIComponent(projectId)}/evidence`);
  return data.evidence || [];
}

// ---------------------------------------------------------------------------
// Priority 6 — project map (backend/geo.py). Coordinates are only ever the
// real values on a project record; a project with none is returned with
// locationUnavailable: true rather than a fabricated point.
// ---------------------------------------------------------------------------

// Add Project — State/District/Constituency cascading dropdown data (see
// backend/geo_data.py). Isolated from the map's own geo endpoint above.
export async function fetchGeoRegionsFromApi() {
  return request("/api/geo/regions");
}

export async function fetchGeoProjectsFromApi() {
  const data = await request("/api/geo/projects");
  return data.markers || [];
}

// ---------------------------------------------------------------------------
// Task 4 — Notifications (bell icon, backend/notifications.py) + Settings
// (Profile / Notification Preferences / Display / Data Status,
// backend/main.py's /api/settings). Same "backend optional" request()
// pattern as every other function in this file.
// ---------------------------------------------------------------------------

export async function fetchNotificationsFromApi() {
  const data = await request("/api/notifications");
  return { notifications: data.notifications || [], unreadCount: data.unread_count || 0 };
}

export async function markNotificationReadViaApi(notificationId) {
  return request(`/api/notifications/${encodeURIComponent(notificationId)}/read`, { method: "POST" });
}

export async function markAllNotificationsReadViaApi() {
  return request("/api/notifications/read-all", { method: "POST" });
}

export async function fetchSettingsFromApi() {
  return request("/api/settings");
}

export async function updateSettingsViaApi(patch) {
  return request("/api/settings", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
}
