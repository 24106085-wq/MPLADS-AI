// src/components/InvestigationModal.jsx
//
// PROJECT INVESTIGATION screen (modal). Everything shown here — risk score,
// risk level, top risk factors, financial/physical figures, AI/ML signals,
// early warning, evidence and investigation status/history — is fetched
// from the FastAPI backend and displayed as-is. This component NEVER
// calculates a risk score, compliance status, or AI signal itself; it is a
// pure presentation layer over:
//   GET  /api/projects/{id}/monitoring      (risk + compliance + AI + early warning)
//   GET  /api/projects/{id}/investigation   (status + action history)
//   GET  /api/projects/{id}/evidence        (field photo evidence)
//   POST /api/projects/{id}/investigation/action  (Verify / Recommend / Hold / Escalate)
//   POST /api/projects/{id}/evidence        (upload a field photo)
//
// Frontend MUST NOT become another analytics engine — see main.py's
// architecture note. Every action button below calls the backend and
// re-fetches; nothing here is a fake button that only flips local state.

import { useEffect, useState } from "react";
import {
  X,
  MapPin,
  Building2,
  ShieldAlert,
  Sparkles,
  Info,
  BrainCircuit,
  Camera,
  UploadCloud,
  CheckCircle2,
  AlertTriangle,
  Clock,
  History,
  Image as ImageIcon,
  ScanEye,
  Sun,
  Fingerprint,
  Copy,
  Ruler,
  FileWarning,
  Loader2,
  UserCheck,
} from "lucide-react";
import RiskBadge from "./RiskBadge";
import { formatCurrency } from "../utils/projectUtils";
import { getRiskColor } from "../utils/riskCalculator";
import {
  fetchProjectMonitoringFromApi,
  fetchInvestigationFromApi,
  postInvestigationActionViaApi,
  fetchProjectEvidenceFromApi,
  uploadEvidenceViaApi,
  postFeedbackViaApi,
  getStoredUser,
} from "../utils/apiClient";
import "../style/investigation.css";

const STATUS_STEPS = ["Open", "Under Verification", "Action Taken", "Closed"];

const ACTION_BUTTONS = [
  { action: "Verify", label: "Verify Project", tone: "accent" },
  { action: "Recommend", label: "Recommend", tone: "good" },
  { action: "Hold", label: "Hold", tone: "warn" },
  { action: "Escalate", label: "Escalate", tone: "bad" },
  { action: "Close", label: "Close", tone: "neutral" },
];

// Alert Assessment (Priority 7 feedback) — displayed labels map onto the
// exact decision strings workflow.FEEDBACK_DECISIONS validates server-side
// (backend/workflow.py). Labels are the reviewer-facing wording; the value
// actually POSTed to /api/projects/{id}/feedback is `decision`.
const FEEDBACK_OPTIONS = [
  { decision: "Confirmed Issue", label: "Confirmed Risk", tone: "bad" },
  { decision: "False Positive", label: "False Positive", tone: "good" },
  { decision: "Needs Verification", label: "Needs Review", tone: "warn" },
];

export default function InvestigationModal({ project, onClose }) {
  const [monitoring, setMonitoring] = useState(null);
  const [monitoringError, setMonitoringError] = useState(false);
  const [investigation, setInvestigation] = useState(null);
  const [evidenceList, setEvidenceList] = useState([]);
  // The acting role is no longer a free-text picker — it's the server-
  // verified identity from login (see backend/auth.py). The backend
  // ignores/overrides any role sent from the client anyway, so this is
  // read once from the cached session rather than left user-editable.
  const currentUser = getStoredUser();
  const actionRole = currentUser?.role || "admin";
  const actionRoleLabel = currentUser?.role_label || "Ministry / Admin";
  const [actionRemarks, setActionRemarks] = useState("");
  const [actionBusy, setActionBusy] = useState(false);
  const [actionError, setActionError] = useState("");
  const [uploadBusy, setUploadBusy] = useState(false);
  const [uploadError, setUploadError] = useState("");
  // Alert Assessment / officer feedback (Priority 7) — POSTed straight to
  // the existing /api/projects/{id}/feedback endpoint and persisted to
  // SQLite by the backend; never held only in this state.
  const [feedbackDecision, setFeedbackDecision] = useState("");
  const [feedbackRemarks, setFeedbackRemarks] = useState("");
  const [feedbackBusy, setFeedbackBusy] = useState(false);
  const [feedbackError, setFeedbackError] = useState("");
  const [feedbackJustSubmitted, setFeedbackJustSubmitted] = useState(false);
  // Rich per-upload detail, keyed by evidence_id: the full backend analysis
  // response (quality, blur/brightness numbers, EXIF, similarity reasoning)
  // plus a browser-only object URL so the person can see the photo they
  // just sent. This is UI-session state only — nothing here is computed;
  // it is exactly what /api/projects/{id}/evidence returned. Photo bytes
  // are not persisted server-side (see evidence.py), so this detail is
  // only available for evidence uploaded during the current session; items
  // fetched from GET after a reload fall back to the persisted SQLite
  // fields (see evidenceList) which is why the list below merges both.
  const [sessionUploads, setSessionUploads] = useState({});

  const projectId = project?.id;

  const reloadInvestigation = () => {
    if (!projectId) return;
    fetchInvestigationFromApi(projectId).then(setInvestigation).catch(() => {});
  };

  const reloadEvidence = () => {
    if (!projectId) return;
    fetchProjectEvidenceFromApi(projectId).then(setEvidenceList).catch(() => setEvidenceList([]));
  };

  useEffect(() => {
    if (!projectId) return undefined;
    const handleKeyDown = (e) => {
      if (e.key === "Escape") onClose?.();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [projectId, onClose]);

  useEffect(() => {
    if (!projectId) return;
    setMonitoring(null);
    setMonitoringError(false);
    fetchProjectMonitoringFromApi(projectId)
      .then(setMonitoring)
      .catch(() => setMonitoringError(true));
    reloadInvestigation();
    reloadEvidence();
    setFeedbackDecision("");
    setFeedbackRemarks("");
    setFeedbackError("");
    setFeedbackJustSubmitted(false);
    // Switching projects: release any local photo preview URLs from the
    // previous project and start this project's evidence session clean.
    setSessionUploads((prev) => {
      Object.values(prev).forEach((u) => u.previewUrl && URL.revokeObjectURL(u.previewUrl));
      return {};
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  // Release object URLs when the modal itself unmounts.
  useEffect(() => {
    return () => {
      setSessionUploads((prev) => {
        Object.values(prev).forEach((u) => u.previewUrl && URL.revokeObjectURL(u.previewUrl));
        return prev;
      });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!project) return null;

  const handleAction = async (action) => {
    setActionBusy(true);
    setActionError("");
    try {
      await postInvestigationActionViaApi(projectId, action, actionRole, actionRemarks);
      setActionRemarks("");
      reloadInvestigation();
    } catch (err) {
      setActionError(err.message || "Could not reach the backend to record this action.");
    } finally {
      setActionBusy(false);
    }
  };

  const handleFeedbackSubmit = async () => {
    if (!feedbackDecision) return;
    setFeedbackBusy(true);
    setFeedbackError("");
    setFeedbackJustSubmitted(false);
    try {
      await postFeedbackViaApi(projectId, feedbackDecision, feedbackRemarks, actionRole);
      setFeedbackDecision("");
      setFeedbackRemarks("");
      setFeedbackJustSubmitted(true);
      // Reload from the backend — feedback lives in SQLite (see db.py's
      // `feedback` table) and is also what feeds the MLOps summary view,
      // so the on-screen history below must reflect the persisted row,
      // never a locally-guessed one.
      reloadInvestigation();
    } catch (err) {
      setFeedbackError(err.message || "Could not reach the backend to record this feedback.");
    } finally {
      setFeedbackBusy(false);
    }
  };

  const handleEvidenceUpload = async (e) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    setUploadBusy(true);
    setUploadError("");
    // Multiple photos are supported by re-using the existing single-file
    // endpoint once per photo (the backend already supports many evidence
    // rows per project) — each upload is sent, analyzed and stored one at
    // a time, in order, so the SQLite insert order matches selection order.
    const failures = [];
    for (const file of files) {
      const previewUrl = URL.createObjectURL(file);
      try {
        const result = await uploadEvidenceViaApi(projectId, file);
        setSessionUploads((prev) => ({ ...prev, [result.evidence_id]: { previewUrl, result } }));
      } catch (err) {
        URL.revokeObjectURL(previewUrl);
        failures.push(`${file.name}: ${err.message || "upload failed"}`);
      }
    }
    if (failures.length > 0) {
      setUploadError(failures.join(" · "));
    }
    reloadEvidence();
    setUploadBusy(false);
    e.target.value = "";
  };

  const risk = monitoring?.risk;
  const financial = monitoring?.financial;
  const physical = monitoring?.physical;
  const ai = monitoring?.ai;
  const earlyWarning = monitoring?.early_warning;
  const riskColor = getRiskColor(risk?.level || project.riskLevel || "Low");
  const currentStatus = investigation?.status || "Open";
  const currentStepIdx = Math.max(0, STATUS_STEPS.indexOf(currentStatus));

  const gap =
    financial && physical
      ? Math.round((financial.financialProgress ?? 0) - (physical.physicalProgress ?? 0))
      : null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal modal--wide"
        role="dialog"
        aria-modal="true"
        aria-label={`Investigation for ${project.workName}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal__header">
          <div>
            <span className="modal__eyebrow">{project.id} · PROJECT INVESTIGATION</span>
            <h2 className="modal__title">{project.workName}</h2>
          </div>
          <button className="modal__close" onClick={onClose} aria-label="Close dialog">
            <X size={18} />
          </button>
        </div>

        <div className="modal__body">
          <div className="pm-disclaimer">
            <Info size={13} />
            <span>
              All figures below are computed by the FastAPI backend (multi-signal risk engine) —
              nothing here is recalculated in the browser.
            </span>
          </div>

          <div className="pm-meta-row">
            <div className="pm-meta-item">
              <MapPin size={15} />
              <span>
                {project.district}, {project.state}
              </span>
            </div>
            <div className="pm-meta-item">
              <Building2 size={15} />
              <span>{project.implementingAgency || monitoring?.project?.implementingAgency || "—"}</span>
            </div>
            <span className={`inv-status-pill inv-status-pill--${currentStatus.replace(/\s+/g, "-").toLowerCase()}`}>
              {currentStatus}
            </span>
          </div>

          {/* ---------------- RISK SUMMARY ---------------- */}
          <div className="pm-section">
            <h3 className="pm-section__title">
              <ShieldAlert size={14} /> Risk Summary
            </h3>
            {monitoringError && (
              <p className="pm-empty-note">
                Backend monitoring data unavailable right now — showing the last known risk from
                the project list instead.
              </p>
            )}
            <div className="pm-risk-panel" style={{ borderColor: `${riskColor}40` }}>
              <div className="pm-risk-panel__score" style={{ color: riskColor }}>
                <span className="pm-risk-panel__number">{risk?.score ?? project.riskScore}</span>
                <span className="pm-risk-panel__max">/100</span>
              </div>
              <div className="pm-risk-panel__body">
                <div className="pm-risk-panel__heading">
                  <RiskBadge level={risk?.level || project.riskLevel} />
                </div>
                <p className="pm-risk-panel__explanation">
                  <Sparkles size={13} className="pm-risk-panel__sparkle" />
                  {risk?.explanation || project.riskExplanation}
                </p>
              </div>
            </div>

            {(risk?.factors || project.riskFactors || []).length > 0 && (
              <div className="pm-factor-list" style={{ marginTop: 12 }}>
                <span className="inv-subheading">Top Risk Factors</span>
                {(risk?.factors || project.riskFactors).slice(0, 6).map((f) => (
                  <div className="pm-factor" key={f.name}>
                    <div className="pm-factor__top">
                      <span className="pm-factor__name">{f.name}</span>
                      <span
                        className={`pm-factor__severity pm-factor__severity--${(f.severity || "medium").toLowerCase()}`}
                      >
                        +{f.points ?? f.score} pts
                      </span>
                    </div>
                    <p className="pm-factor__explanation">{f.explanation || f.reason}</p>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* ---------------- FINANCIAL & PHYSICAL ---------------- */}
          <div className="pm-section">
            <h3 className="pm-section__title">Financial &amp; Physical Analysis</h3>
            <div className="pm-grid">
              <div className="pm-card">
                <span className="pm-card__label">Sanctioned Amount</span>
                <span className="pm-card__value">{formatCurrency(project.sanctionedAmount)}</span>
              </div>
              <div className="pm-card">
                <span className="pm-card__label">Expenditure</span>
                <span className="pm-card__value">{formatCurrency(project.expenditure)}</span>
              </div>
              <div className="pm-card">
                <span className="pm-card__label">Utilization</span>
                <span className="pm-card__value">
                  {financial?.utilization ?? project.financialProgress ?? 0}%
                </span>
              </div>
              <div className="pm-card">
                <span className="pm-card__label">Physical Progress</span>
                <span className="pm-card__value">
                  {physical?.physicalProgress ?? project.physicalProgress ?? 0}%
                </span>
              </div>
            </div>

            {gap !== null && Math.abs(gap) >= 15 && (
              <div className="inv-mismatch-note">
                <AlertTriangle size={14} />
                <span>
                  Potential Financial–Physical Gap: Financial Utilization is{" "}
                  {financial.utilization}% while Physical Progress is only{" "}
                  {physical.physicalProgress}% — a {Math.abs(gap)} point mismatch.
                </span>
              </div>
            )}
            {physical?.isOverdue && (
              <p className="pm-compare__note">
                Overdue by {physical.overdueDays} day(s) past expected completion.
              </p>
            )}
          </div>

          {/* ---------------- AI / ML FINDINGS ---------------- */}
          <div className="pm-section">
            <h3 className="pm-section__title">
              <BrainCircuit size={14} /> AI / ML Findings
            </h3>
            {!monitoring && !monitoringError && <p className="pm-empty-note">Loading backend signals…</p>}
            {ai && (
              <div className="pm-factor-list">
                <div className="pm-factor">
                  <div className="pm-factor__top">
                    <span className="pm-factor__name">ML Anomaly</span>
                    <span
                      className={`pm-factor__severity pm-factor__severity--${ai.ml_anomaly_flag ? "high" : "low"}`}
                    >
                      {ai.ml_anomaly_flag ? "Flagged" : "Normal"}
                      {typeof ai.ml_anomaly_score === "number" ? ` · score ${ai.ml_anomaly_score}` : ""}
                    </span>
                  </div>
                </div>
                <div className="pm-factor">
                  <div className="pm-factor__top">
                    <span className="pm-factor__name">Duplicate / Similarity</span>
                    <span
                      className={`pm-factor__severity pm-factor__severity--${ai.possible_duplicate ? "high" : "low"}`}
                    >
                      {ai.duplicate_score ? `${ai.duplicate_score}% similar` : "No match found"}
                    </span>
                  </div>
                  {ai.matched_project_ids?.length > 0 && (
                    <p className="pm-factor__explanation">
                      Matched project(s): {ai.matched_project_ids.join(", ")}
                    </p>
                  )}
                </div>
                <div className="pm-factor">
                  <div className="pm-factor__top">
                    <span className="pm-factor__name">Delay Prediction</span>
                    <span className="pm-factor__severity pm-factor__severity--medium">
                      {ai.delay_probability != null ? `${ai.delay_probability}% probability` : "Unavailable"}
                    </span>
                  </div>
                </div>
                <div className="pm-factor">
                  <div className="pm-factor__top">
                    <span className="pm-factor__name">Cost Overrun Prediction</span>
                    <span className="pm-factor__severity pm-factor__severity--medium">
                      {ai.cost_overrun_probability != null
                        ? `${ai.cost_overrun_probability}% probability`
                        : "Unavailable"}
                    </span>
                  </div>
                </div>
                {ai.top_factors?.length > 0 && (
                  <p className="pm-factor__explanation" style={{ padding: "0 4px" }}>
                    Key contributing factors: {ai.top_factors.map((t) => t.name || t.feature || t).join(", ")}
                  </p>
                )}
              </div>
            )}

            {earlyWarning && (
              <div
                className="inv-mismatch-note"
                style={{ marginTop: 10, borderColor: `${getRiskColor(earlyWarning.early_warning_level === "RED" ? "Critical" : earlyWarning.early_warning_level === "ORANGE" ? "High" : earlyWarning.early_warning_level === "YELLOW" ? "Medium" : "Low")}40` }}
              >
                <Info size={14} />
                <span>
                  Early Warning: {earlyWarning.early_warning_level}. {earlyWarning.early_warning_reasons?.[0] || ""}
                  {" "}{earlyWarning.recommended_action}
                </span>
              </div>
            )}
          </div>

          {/* ---------------- FIELD EVIDENCE ---------------- */}
          <div className="pm-section">
            <h3 className="pm-section__title">
              <Camera size={14} /> Field Evidence — Field Photo Evidence Analysis
            </h3>
            <p className="pm-disclaimer pm-disclaimer--inline">
              <Info size={12} />
              Every result below — quality score, blur, brightness, EXIF, duplicate check — is
              computed once by the FastAPI backend (backend/evidence.py) and stored in SQLite. This
              screen only displays it; it never re-analyzes or re-scores a photo itself.
            </p>

            <label className="btn-secondary inv-upload-btn">
              <UploadCloud size={15} />
              {uploadBusy ? "Uploading & analyzing…" : "Upload Field Photo(s)"}
              <input
                type="file"
                accept="image/*"
                multiple
                hidden
                onChange={handleEvidenceUpload}
                disabled={uploadBusy}
              />
            </label>
            {uploadBusy && (
              <p className="pm-empty-note ev-uploading">
                <Loader2 size={13} className="ev-spin" /> Sending photo(s) to the backend evidence
                pipeline — quality, blur, brightness, EXIF and duplicate checks run server-side…
              </p>
            )}
            {uploadError && (
              <p className="upload-error">
                <FileWarning size={13} style={{ verticalAlign: "-2px", marginRight: 4 }} />
                {uploadError}
              </p>
            )}

            {evidenceList.length === 0 ? (
              <p className="pm-empty-note">No field evidence uploaded for this project yet.</p>
            ) : (
              <div className="ev-grid">
                {evidenceList.map((e) => (
                  <EvidenceCard key={e.id} record={e} session={sessionUploads[e.id]} />
                ))}
              </div>
            )}
          </div>

          {/* ---------------- INVESTIGATION ACTIONS ---------------- */}
          <div className="pm-section">
            <h3 className="pm-section__title">
              <CheckCircle2 size={14} /> Investigation Actions
            </h3>

            <div className="inv-status-track">
              {STATUS_STEPS.map((step, idx) => (
                <div key={step} className={`inv-status-step ${idx <= currentStepIdx ? "inv-status-step--done" : ""}`}>
                  <span className="inv-status-step__dot" />
                  <span className="inv-status-step__label">{step}</span>
                </div>
              ))}
            </div>

            <div className="inv-action-form">
              <span className="inv-action-role" title="Determined by your login — not editable here">
                <UserCheck size={13} />
                Acting as {actionRoleLabel}
              </span>
              <input
                className="inv-action-remarks"
                type="text"
                placeholder="Remarks (optional)"
                value={actionRemarks}
                onChange={(e) => setActionRemarks(e.target.value)}
                disabled={actionBusy}
              />
            </div>

            <div className="inv-action-buttons">
              {ACTION_BUTTONS.map(({ action, label, tone }) => (
                <button
                  key={action}
                  className={`inv-action-btn inv-action-btn--${tone}`}
                  onClick={() => handleAction(action)}
                  disabled={actionBusy}
                >
                  {label}
                </button>
              ))}
            </div>
            {actionError && <p className="upload-error">{actionError}</p>}

            {investigation?.history?.length > 0 && (
              <div className="inv-history">
                <span className="inv-subheading">
                  <History size={13} style={{ verticalAlign: "-2px", marginRight: 4 }} />
                  Action History
                </span>
                {investigation.history
                  .slice()
                  .reverse()
                  .map((h) => (
                    <div className="inv-history__item" key={h.id}>
                      <Clock size={12} />
                      <span>
                        <strong>{h.action_type}</strong> → {h.resulting_status}
                        {h.role ? ` · ${h.role}` : ""}
                        {h.remarks ? ` · "${h.remarks}"` : ""}
                      </span>
                    </div>
                  ))}
              </div>
            )}
          </div>

          {/* ---------------- ALERT ASSESSMENT / OFFICER FEEDBACK ---------------- */}
          <div className="pm-section">
            <h3 className="pm-section__title">
              <ShieldAlert size={14} /> Alert Assessment
            </h3>
            <p className="pm-disclaimer pm-disclaimer--inline">
              <Info size={12} />
              Submitting here POSTs to the existing feedback API and is persisted to SQLite
              (backend/db.py) — it also feeds the MLOps Dashboard's feedback-case counts.
            </p>

            <div className="inv-action-buttons" style={{ marginTop: 10 }}>
              {FEEDBACK_OPTIONS.map(({ decision, label, tone }) => (
                <button
                  key={decision}
                  className={`inv-action-btn inv-action-btn--${tone} ${
                    feedbackDecision === decision ? "inv-action-btn--selected" : ""
                  }`}
                  onClick={() => setFeedbackDecision(decision)}
                  disabled={feedbackBusy}
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="inv-action-form" style={{ marginTop: 10 }}>
              <input
                className="inv-action-remarks"
                type="text"
                placeholder="Officer remark / comment (optional)"
                value={feedbackRemarks}
                onChange={(e) => setFeedbackRemarks(e.target.value)}
                disabled={feedbackBusy}
              />
              <button
                className="btn-primary"
                onClick={handleFeedbackSubmit}
                disabled={feedbackBusy || !feedbackDecision}
              >
                {feedbackBusy ? "Submitting…" : "Submit Feedback"}
              </button>
            </div>
            {feedbackError && <p className="upload-error">{feedbackError}</p>}
            {feedbackJustSubmitted && !feedbackError && (
              <p className="pm-empty-note">
                <CheckCircle2 size={12} style={{ verticalAlign: "-2px", marginRight: 4 }} />
                Feedback recorded.
              </p>
            )}

            {investigation?.feedback?.length > 0 && (
              <div className="inv-history">
                <span className="inv-subheading">
                  <History size={13} style={{ verticalAlign: "-2px", marginRight: 4 }} />
                  Feedback History
                </span>
                {investigation.feedback.map((f) => (
                  <div className="inv-history__item" key={f.id}>
                    <Clock size={12} />
                    <span>
                      <strong>{f.decision}</strong>
                      {f.role ? ` · ${f.role}` : ""}
                      {f.remarks ? ` · "${f.remarks}"` : ""}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// EvidenceCard — pure presentation of one evidence record. `record` is the
// row persisted in SQLite (GET /api/projects/{id}/evidence — see db.py's
// `evidence` table: quality_score, quality_notes, near_duplicate_of,
// similarity_score, width/height, uploaded_at). `session`, when present, is
// the full analysis response captured at the moment this browser uploaded
// the photo (POST response — see evidence.py's process_uploaded_image):
// it additionally carries the exact blur/brightness numbers, EXIF fields
// and a local image preview, none of which the backend persists to disk.
// Every value rendered below is read straight from one of those two
// backend payloads — nothing is computed here.
// ---------------------------------------------------------------------------

function formatTimestamp(iso) {
  if (!iso) return "Not recorded";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function EvidenceCard({ record, session }) {
  const quality = session?.result?.quality;
  const metadata = session?.result?.metadata;
  const nearDupes = session?.result?.near_duplicates;
  const similarityReason = session?.result?.similarity_reason;

  const qualityScore = quality?.quality_score ?? record.quality_score;
  const qualityNotes = quality?.quality_notes ?? record.quality_notes;
  const passed = typeof quality?.passed === "boolean" ? quality.passed : (record.quality_score ?? 0) >= 50;
  const hasDuplicate = session
    ? Boolean(session.result.possible_duplicate)
    : Boolean(record.near_duplicate_of || record.similarity_score);
  const similarityScore = session ? session.result.similarity_score : record.similarity_score;
  const width = quality?.width ?? record.width;
  const height = quality?.height ?? record.height;

  return (
    <div className="ev-card">
      <div className="ev-card__media">
        {session?.previewUrl ? (
          <img src={session.previewUrl} alt={record.original_filename || "Uploaded field evidence"} />
        ) : (
          <div className="ev-card__media-placeholder">
            <ImageIcon size={22} />
            <span>Preview unavailable</span>
            <span className="ev-card__media-placeholder-note">
              (photo not re-fetchable after reload — analysis below is still the original backend result)
            </span>
          </div>
        )}
      </div>

      <div className="ev-card__body">
        <div className="ev-card__header">
          <span className="ev-card__filename" title={record.original_filename}>
            {record.original_filename || `Evidence #${record.id}`}
          </span>
          <span className={`ev-badge ev-badge--${passed ? "good" : "bad"}`}>
            {passed ? <CheckCircle2 size={12} /> : <AlertTriangle size={12} />}
            {passed ? "Passed Quality Check" : "Quality Flagged"}
          </span>
        </div>

        <div className="ev-row ev-row--meta">
          <Clock size={12} />
          <span>Uploaded {formatTimestamp(record.uploaded_at)}</span>
          {width && height && <span className="ev-dim">{width}×{height}px</span>}
        </div>

        <div className="ev-metric-grid">
          <div className="ev-metric">
            <span className="ev-metric__label">
              <ScanEye size={12} /> Image Quality
            </span>
            <span className="ev-metric__value">{qualityScore ?? "—"}/100</span>
          </div>
          <div className="ev-metric">
            <span className="ev-metric__label">
              <Ruler size={12} /> Blur Variance
            </span>
            <span className="ev-metric__value">
              {quality ? quality.blur_variance : "Only shown right after upload"}
            </span>
          </div>
          <div className="ev-metric">
            <span className="ev-metric__label">
              <Sun size={12} /> Brightness
            </span>
            <span className="ev-metric__value">
              {quality ? quality.brightness : "Only shown right after upload"}
            </span>
          </div>
          <div className="ev-metric">
            <span className="ev-metric__label">
              <Copy size={12} /> Duplicate Check
            </span>
            <span className={`ev-metric__value ${hasDuplicate ? "ev-metric__value--warn" : ""}`}>
              {hasDuplicate ? `${similarityScore ?? "?"}% similar` : "No match"}
            </span>
          </div>
        </div>

        <p className="ev-notes">{qualityNotes || "No quality notes returned by backend."}</p>

        {hasDuplicate && (
          <p className="ev-notes ev-notes--warn">
            <Copy size={12} />
            {similarityReason ||
              (record.near_duplicate_of
                ? `${record.similarity_score ?? "?"}% similar to evidence #${record.near_duplicate_of} already on file — review for reused/recycled evidence.`
                : `${record.similarity_score ?? "?"}% similar to another stored photo — review for reused/recycled evidence.`)}
          </p>
        )}

        <div className="ev-exif">
          <span className="ev-exif__label">
            <Fingerprint size={12} /> EXIF Metadata
          </span>
          {metadata ? (
            metadata.has_exif ? (
              <ul className="ev-exif__list">
                <li>Captured: {metadata.captured_at || "Timestamp not present in EXIF"}</li>
                <li>Camera: {metadata.camera || "Not present in EXIF"}</li>
                <li>GPS: {metadata.gps || "Not extracted"}</li>
              </ul>
            ) : (
              <span className="ev-exif__none">No EXIF metadata found in this file.</span>
            )
          ) : (
            <span className="ev-exif__none">
              Not available — EXIF is read at upload time and isn't persisted separately; reload this
              evidence's original file to re-check.
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
