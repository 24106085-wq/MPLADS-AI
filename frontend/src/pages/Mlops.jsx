// src/pages/Mlops.jsx
//
// MLOPS DASHBOARD (Priority 8). Everything shown here is fetched from the
// FastAPI backend and displayed as-is — this page NEVER computes or
// fabricates a metric itself. It is a pure presentation layer over:
//   GET  /api/mlops/summary   (feedback case counts, model status, honest
//                               validation metrics when available, last
//                               retrain event — see backend/workflow.py's
//                               build_mlops_summary())
//   POST /api/mlops/retrain   (records a retrain event; the ML/predictive
//                               models already recompute fresh from the
//                               current dataset on every request, so this
//                               re-runs that computation over the dataset
//                               + feedback collected so far)
//
// If a figure isn't available from the backend, this page says
// "Not available" rather than inventing one.

import { useEffect, useState } from "react";
import {
  BrainCircuit,
  RefreshCcw,
  ShieldAlert,
  ShieldCheck,
  AlertTriangle,
  Gauge,
  History,
  Info,
  Loader2,
} from "lucide-react";
import StatCard from "../components/StatCard";
import EmptyState from "../components/EmptyState";
import { fetchMlopsSummaryFromApi, triggerMlopsRetrainViaApi } from "../utils/apiClient";
import "../style/mlops.css";

function formatTimestamp(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function titleize(value) {
  if (value === null || value === undefined || value === "") return "Not available";
  return String(value)
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export default function Mlops({ backendOnline }) {
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [retrainBusy, setRetrainBusy] = useState(false);
  const [retrainError, setRetrainError] = useState("");
  const [retrainResult, setRetrainResult] = useState(null);

  const loadSummary = () => {
    setLoading(true);
    setLoadError(false);
    fetchMlopsSummaryFromApi()
      .then((data) => setSummary(data))
      .catch(() => setLoadError(true))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    if (!backendOnline) {
      setLoading(false);
      return;
    }
    loadSummary();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [backendOnline]);

  const handleRetrain = async () => {
    setRetrainBusy(true);
    setRetrainError("");
    try {
      const result = await triggerMlopsRetrainViaApi("Manual retrain triggered from MLOps Dashboard");
      setRetrainResult(result);
      // Re-fetch: the models already recompute fresh from the current
      // dataset on every request, so this pulls the freshly-recomputed
      // status/metrics rather than showing a stale snapshot.
      loadSummary();
    } catch (err) {
      setRetrainError(err.message || "Could not reach the backend to trigger retraining.");
    } finally {
      setRetrainBusy(false);
    }
  };

  const feedback = summary?.feedback_cases;
  const modelMonitoring = summary?.model_monitoring;
  const anomalyModel = modelMonitoring?.ml_anomaly_model;
  const delayModel = modelMonitoring?.delay_prediction_model;
  const validation = delayModel?.validation_metrics;
  const lastRetrain = modelMonitoring?.last_retrain_event;
  const registry = summary?.model_registry;
  const activeModel = registry?.active_model;
  const retrainHistory = registry?.retraining_history || [];

  return (
    <div className="mlops-page">
      <div className="dashboard__header">
        <div>
          <div className="dashboard__title-row">
            <h1 className="dashboard__title">MLOps Dashboard</h1>
            <span
              className={`backend-status ${backendOnline ? "backend-status--online" : "backend-status--offline"}`}
            >
              <span className="backend-status__dot" />
              {backendOnline ? "Backend Online" : "Backend Offline"}
            </span>
          </div>
          <p className="dashboard__subtitle">
            Real feedback-loop and model-monitoring status, straight from the backend's MLOps
            summary endpoint — nothing here is a fabricated accuracy or drift figure.
          </p>
        </div>
        <div className="reports-page__icon">
          <BrainCircuit size={20} />
        </div>
      </div>

      {!backendOnline && (
        <EmptyState
          icon={AlertTriangle}
          title="Backend unreachable"
          message="The MLOps Dashboard needs the FastAPI backend (/api/mlops/summary) — it never shows locally-invented figures. Start the backend and reload."
        />
      )}

      {backendOnline && loading && (
        <p className="pm-empty-note mlops-loading">
          <Loader2 size={13} className="ev-spin" /> Loading MLOps summary…
        </p>
      )}

      {backendOnline && !loading && loadError && (
        <EmptyState
          icon={AlertTriangle}
          title="Could not load MLOps summary"
          message="The backend responded to /api/health but /api/mlops/summary failed."
          action={
            <button className="btn-secondary" onClick={loadSummary}>
              <RefreshCcw size={14} /> Retry
            </button>
          }
        />
      )}

      {backendOnline && !loading && !loadError && summary && (
        <>
          {/* ================= FEEDBACK CASES ================= */}
          <div className="reports-section-heading">
            <h2>Feedback Cases</h2>
            <p>Officer feedback submitted from the Investigation screen, persisted to SQLite.</p>
          </div>
          <div className="kpi-grid mlops-kpi-grid">
            <StatCard icon={History} value={feedback?.total ?? 0} label="Total Feedback Cases" tone="default" />
            <StatCard
              icon={ShieldAlert}
              value={feedback?.confirmed_issues ?? 0}
              label="Confirmed Risks"
              tone="bad"
            />
            <StatCard
              icon={ShieldCheck}
              value={feedback?.false_positives ?? 0}
              label="False Positives"
              tone="good"
            />
            <StatCard
              icon={AlertTriangle}
              value={feedback?.needs_verification ?? 0}
              label="Needs Review"
              tone="warn"
            />
          </div>

          {/* ================= ACTIVE MODEL (registry) ================= */}
          <div className="reports-section-heading">
            <h2>Active Model</h2>
            <p>
              Persisted model registry — a version only increments when a real feedback-driven
              update happens (see "Retraining" below), never on page refresh.
            </p>
          </div>
          <div className="mlops-model-grid">
            <div className="mlops-model-card">
              <h4 className="mlops-model-card__title">{titleize(activeModel?.model_type) || "Model"}</h4>
              <dl className="mlops-dl">
                <div>
                  <dt>Model Version</dt>
                  <dd>{activeModel?.model_version ?? "Not available"}</dd>
                </div>
                <div>
                  <dt>Status</dt>
                  <dd>{titleize(activeModel?.model_status)}</dd>
                </div>
                <div>
                  <dt>Training Records</dt>
                  <dd>{activeModel?.training_records ?? "Not available"}</dd>
                </div>
                <div>
                  <dt>Feedback Used</dt>
                  <dd>{activeModel?.feedback_used ?? 0}</dd>
                </div>
                <div>
                  <dt>Last Updated</dt>
                  <dd>{formatTimestamp(activeModel?.trained_at) ?? "Not available"}</dd>
                </div>
                <div>
                  <dt>Verified Feedback Available</dt>
                  <dd>{registry?.verified_feedback_available ?? 0}</dd>
                </div>
              </dl>
              <p className="pm-empty-note">
                {(registry?.verified_feedback_available ?? 0) < (registry?.min_feedback_for_retraining ?? 10)
                  ? `Needs ${registry?.feedback_needed_for_next_update ?? registry?.min_feedback_for_retraining} more verified feedback record(s) (Confirmed Issue / False Positive) before the next update.`
                  : "Enough verified feedback is available — use Retrain Model below to update."}
              </p>
            </div>
          </div>

          {/* ================= MODEL STATUS ================= */}
          <div className="reports-section-heading">
            <h2>Model Status</h2>
            <p>Recomputed fresh from the current dataset on every request — no separately versioned model artifact exists in this prototype.</p>
          </div>
          <div className="mlops-model-grid">
            <div className="mlops-model-card">
              <h4 className="mlops-model-card__title">ML Anomaly Model</h4>
              <dl className="mlops-dl">
                <div>
                  <dt>Method</dt>
                  <dd>{titleize(anomalyModel?.method)}</dd>
                </div>
                <div>
                  <dt>Sample Size</dt>
                  <dd>{anomalyModel?.sample_size ?? "Not available"}</dd>
                </div>
                <div>
                  <dt>Confidence</dt>
                  <dd>{titleize(anomalyModel?.confidence)}</dd>
                </div>
              </dl>
            </div>

            <div className="mlops-model-card">
              <h4 className="mlops-model-card__title">Delay Prediction Model</h4>
              <dl className="mlops-dl">
                <div>
                  <dt>Status</dt>
                  <dd>{titleize(delayModel?.status)}</dd>
                </div>
                <div>
                  <dt>Method</dt>
                  <dd>{titleize(delayModel?.method)}</dd>
                </div>
                <div>
                  <dt>Sample Size</dt>
                  <dd>{delayModel?.sample_size ?? "Not available"}</dd>
                </div>
              </dl>

              <span className="inv-subheading mlops-metrics-heading">
                <Gauge size={12} style={{ verticalAlign: "-2px", marginRight: 4 }} />
                Performance Metrics
              </span>
              {validation ? (
                <>
                  <div className="mlops-metrics-grid">
                    <span>
                      Accuracy <strong>{validation.accuracy}</strong>
                    </span>
                    <span>
                      Precision <strong>{validation.precision}</strong>
                    </span>
                    <span>
                      Recall <strong>{validation.recall}</strong>
                    </span>
                    <span>
                      F1 <strong>{validation.f1}</strong>
                    </span>
                    {validation.roc_auc !== undefined && (
                      <span>
                        ROC AUC <strong>{validation.roc_auc}</strong>
                      </span>
                    )}
                    <span>
                      CV Folds <strong>{validation.folds_evaluated}</strong>
                    </span>
                  </div>
                  {validation.caution && <p className="pm-factor__explanation">{validation.caution}</p>}
                </>
              ) : (
                <p className="pm-empty-note">Not available (insufficient labeled history to cross-validate yet).</p>
              )}
            </div>
          </div>

          {/* ================= RETRAINING ================= */}
          <div className="reports-section-heading">
            <h2>Retraining</h2>
            <p>Re-runs the ML/predictive models over the current dataset and feedback, and logs the event to SQLite.</p>
          </div>
          <div className="mlops-retrain-card">
            <div className="mlops-retrain-card__info">
              <span className="inv-subheading">Last Retraining</span>
              {lastRetrain ? (
                <p className="pm-empty-note">
                  {formatTimestamp(lastRetrain.created_at)}
                  {lastRetrain.notes ? ` — "${lastRetrain.notes}"` : ""}
                </p>
              ) : (
                <p className="pm-empty-note">No retraining event has been triggered yet.</p>
              )}
            </div>
            <button className="btn-primary" onClick={handleRetrain} disabled={retrainBusy}>
              {retrainBusy ? <Loader2 size={14} className="ev-spin" /> : <RefreshCcw size={14} />}
              {retrainBusy ? "Retraining…" : "Retrain Model"}
            </button>
          </div>
          {retrainError && <p className="upload-error">{retrainError}</p>}
          {retrainResult && !retrainError && (
            <p className="pm-empty-note mlops-retrain-confirm">
              {retrainResult.updated
                ? `Model updated: ${retrainResult.previous_version} → ${retrainResult.new_version}, using ${retrainResult.verified_feedback_count} verified feedback record(s).`
                : retrainResult.message}
            </p>
          )}

          {retrainHistory.length > 0 && (
            <>
              <div className="reports-section-heading">
                <h2>Retraining / Update History</h2>
                <p>Every genuine update attempt for the anomaly detector, persisted to SQLite.</p>
              </div>
              <div className="mlops-model-grid" style={{ marginBottom: 20 }}>
                <div className="mlops-model-card">
                  <ul className="mlops-history-list">
                    {retrainHistory.map((h) => (
                      <li key={h.id}>
                        <div className="mlops-history-list__meta">
                          <strong>{h.version}</strong> · {titleize(h.trigger)} · {formatTimestamp(h.timestamp)}
                        </div>
                        <p className="mlops-history-list__detail">
                          <strong>{h.status}</strong> — {h.records_used} records, {h.feedback_used} feedback used
                          {h.notes ? `. ${h.notes}` : ""}
                        </p>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </>
          )}

          {summary.disclaimer && (
            <p className="pm-disclaimer mlops-disclaimer">
              <Info size={13} />
              {summary.disclaimer}
            </p>
          )}
        </>
      )}
    </div>
  );
}
