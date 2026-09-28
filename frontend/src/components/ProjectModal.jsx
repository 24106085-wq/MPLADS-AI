// src/components/ProjectModal.jsx
import { useEffect, useState } from "react";
import {
  X,
  MapPin,
  Building2,
  Calendar,
  FileDown,
  ShieldAlert,
  Sparkles,
  Copy,
  ClipboardCheck,
  Info,
  ShieldCheck,
  BrainCircuit,
  TrendingUp,
  AlertTriangle,
} from "lucide-react";
import RiskBadge from "./RiskBadge";
import { formatCurrency, formatDate } from "../utils/projectUtils";
import { detectProjectAnomalies, findDuplicateMatches } from "../utils/anomalyDetector";
import { getRiskColor, getRecommendedAction } from "../utils/riskCalculator";
import { buildProjectReportText, downloadTextFile, printCurrentView } from "../utils/reportGenerator";
import { checkCompliance, COMPLIANCE_STATUS_COLORS } from "../utils/complianceChecker";
import { computeEarlyWarning, EARLY_WARNING_COLORS } from "../utils/earlyWarning";
import {
  fetchProjectMlAnomalyFromApi,
  fetchProjectDuplicatesFromApi,
  fetchProjectPredictionFromApi,
  fetchProjectExplanationFromApi,
  fetchProjectMonitoringFromApi,
} from "../utils/apiClient";

/**
 * Detailed Alert / Project Risk Analysis modal.
 * Shared by Dashboard, Projects and Alerts pages so every entry point opens
 * the exact same explainable risk breakdown for a project.
 */
export default function ProjectModal({ project, allProjects = [], onClose }) {
  // Milestone 2 — ML Anomaly (Isolation Forest) and Duplicate Check (TF-IDF
  // similarity) results. Fetched from the backend on open; the rule-based
  // sections above (Detected Anomalies, Potential Duplicate Work) keep
  // working from local data regardless, so this section simply doesn't
  // render if the backend isn't reachable — same "backend optional"
  // pattern as the rest of this app (see apiClient.js).
  const [mlAnomaly, setMlAnomaly] = useState(null);
  const [mlDuplicate, setMlDuplicate] = useState(null);
  const [mlLoading, setMlLoading] = useState(false);

  // Milestone 3 — predictive delay/cost-overrun model + its explanation
  // (see backend/predictive_model.py). Same fetch-on-open, degrade-
  // gracefully-if-backend-unreachable pattern as the ML section above.
  const [prediction, setPrediction] = useState(null);
  const [predictionExplanation, setPredictionExplanation] = useState(null);
  const [predictionLoading, setPredictionLoading] = useState(false);

  // Milestone 4 — unified monitoring (see backend/monitoring.py). Used here
  // specifically to source the Early Warning section's level/reasons from
  // the backend's combined view (risk + compliance + ML + duplicate +
  // predictive signals together). Falls back to the client-side mirror
  // (utils/earlyWarning.js) instantly and whenever the backend isn't
  // reachable, matching this modal's existing "backend optional" pattern.
  const [monitoringData, setMonitoringData] = useState(null);

  useEffect(() => {
    if (!project) return undefined;
    const handleKeyDown = (e) => {
      if (e.key === "Escape") onClose?.();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [project, onClose]);

  useEffect(() => {
    if (!project?.id) return;
    let cancelled = false;
    setMlLoading(true);
    setMlAnomaly(null);
    setMlDuplicate(null);

    Promise.allSettled([
      fetchProjectMlAnomalyFromApi(project.id),
      fetchProjectDuplicatesFromApi(project.id),
    ]).then(([anomalyResult, duplicateResult]) => {
      if (cancelled) return;
      if (anomalyResult.status === "fulfilled") setMlAnomaly(anomalyResult.value);
      if (duplicateResult.status === "fulfilled") setMlDuplicate(duplicateResult.value);
      setMlLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [project?.id]);

  useEffect(() => {
    if (!project?.id) return undefined;
    let cancelled = false;
    setPredictionLoading(true);
    setPrediction(null);
    setPredictionExplanation(null);

    Promise.allSettled([
      fetchProjectPredictionFromApi(project.id),
      fetchProjectExplanationFromApi(project.id),
    ]).then(([predictionResult, explanationResult]) => {
      if (cancelled) return;
      if (predictionResult.status === "fulfilled") setPrediction(predictionResult.value);
      if (explanationResult.status === "fulfilled") setPredictionExplanation(explanationResult.value);
      setPredictionLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [project?.id]);

  useEffect(() => {
    if (!project?.id) return undefined;
    let cancelled = false;
    setMonitoringData(null);
    fetchProjectMonitoringFromApi(project.id)
      .then((data) => {
        if (!cancelled) setMonitoringData(data);
      })
      .catch(() => {
        // Backend unreachable or project not found there — the Early
        // Warning section below falls back to the client-side mirror.
      });
    return () => {
      cancelled = true;
    };
  }, [project?.id]);

  if (!project) return null;

  const anomalies = detectProjectAnomalies(project);
  const riskColor = getRiskColor(project.riskLevel);
  const recommendation = getRecommendedAction(project.riskLevel);
  const duplicateMatches = findDuplicateMatches(project, allProjects);
  const financial = Number(project.financialProgress) || 0;
  const physical = Number(project.physicalProgress) || 0;
  const mismatchGap = Math.round(financial - physical);

  // Compliance Engine — independent of the risk score above; see
  // complianceChecker.js. Computed on the fly from project fields so it
  // always reflects the currently loaded record, with or without a live
  // backend connection.
  const compliance = checkCompliance(project);
  const complianceColor = COMPLIANCE_STATUS_COLORS[compliance.compliance_status] || "#2A7FB8";
  const complianceStatusLabel = compliance.compliance_status.replace(/_/g, " ");

  // Prefer the backend's unified verdict (folds in ML anomaly + predictive
  // signals too); fall back to the instant client-side mirror otherwise.
  const earlyWarning = monitoringData?.early_warning || computeEarlyWarning(project, allProjects);
  const earlyWarningColor = EARLY_WARNING_COLORS[earlyWarning.early_warning_level] || "#2A7FB8";

  const handleGenerateReport = () => {
    const text = buildProjectReportText(project);
    downloadTextFile(`${project.id}-risk-report.txt`, text);
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal modal--wide"
        role="dialog"
        aria-modal="true"
        aria-label={`Risk analysis for ${project.workName}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal__header">
          <div>
            <span className="modal__eyebrow">{project.id}</span>
            <h2 className="modal__title">{project.workName}</h2>
          </div>
          <button className="modal__close" onClick={onClose} aria-label="Close dialog">
            <X size={18} />
          </button>
        </div>

        <div className="modal__body">
          <div className="pm-disclaimer">
            <Info size={13} />
            <span>AI-assisted / rule-based prototype analysis — not a trained ML model.</span>
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
              <span>{project.implementingAgency}</span>
            </div>
            <div className="pm-meta-item">
              <Calendar size={15} />
              <span>Due {formatDate(project.expectedCompletion)}</span>
            </div>
            <span className={`status-pill status-pill--${project.status.replace(/\s+/g, "-").toLowerCase()}`}>
              {project.status}
            </span>
          </div>

          <div className="pm-grid">
            <div className="pm-card">
              <span className="pm-card__label">MP / Constituency</span>
              <span className="pm-card__value">{project.mpName}</span>
              <span className="pm-card__sub">{project.constituency}</span>
            </div>
            <div className="pm-card">
              <span className="pm-card__label">Sanctioned Amount</span>
              <span className="pm-card__value">{formatCurrency(project.sanctionedAmount)}</span>
            </div>
            <div className="pm-card">
              <span className="pm-card__label">Expenditure</span>
              <span className="pm-card__value">{formatCurrency(project.expenditure)}</span>
            </div>
            <div className="pm-card">
              <span className="pm-card__label">Work Category</span>
              <span className="pm-card__value">{project.category || "—"}</span>
            </div>
          </div>

          <div className="pm-section">
            <h3 className="pm-section__title">Financial vs Physical Progress</h3>
            <div className="pm-compare">
              <div className="pm-compare__row">
                <span className="pm-compare__label">Financial Progress</span>
                <div className="mini-progress mini-progress--wide">
                  <div
                    className="mini-progress__fill"
                    style={{ width: `${Math.min(financial, 100)}%` }}
                  />
                  <span className="mini-progress__label">{financial}%</span>
                </div>
              </div>
              <div className="pm-compare__row">
                <span className="pm-compare__label">Physical Progress</span>
                <div className="mini-progress mini-progress--wide">
                  <div
                    className="mini-progress__fill mini-progress__fill--physical"
                    style={{ width: `${Math.min(physical, 100)}%` }}
                  />
                  <span className="mini-progress__label">{physical}%</span>
                </div>
              </div>
            </div>
            {mismatchGap >= 15 && (
              <p className="pm-compare__note">
                {mismatchGap} percentage-point mismatch detected between financial utilization and
                physical progress.
              </p>
            )}
          </div>

          <div className="pm-risk-panel" style={{ borderColor: `${riskColor}40` }}>
            <div className="pm-risk-panel__score" style={{ color: riskColor }}>
              <span className="pm-risk-panel__number">{project.riskScore}</span>
              <span className="pm-risk-panel__max">/100</span>
            </div>
            <div className="pm-risk-panel__body">
              <div className="pm-risk-panel__heading">
                <ShieldAlert size={16} color={riskColor} />
                <RiskBadge level={project.riskLevel} />
              </div>
              <p className="pm-risk-panel__explanation">
                <Sparkles size={13} className="pm-risk-panel__sparkle" />
                {project.riskExplanation}
              </p>
            </div>
          </div>

          {project.riskFactors.length > 0 && (
            <div className="pm-section">
              <h3 className="pm-section__title">Risk Factors ({project.riskFactors.length})</h3>
              <div className="pm-factor-list">
                {project.riskFactors.map((f) => (
                  <div className="pm-factor" key={f.name}>
                    <div className="pm-factor__top">
                      <span className="pm-factor__name">{f.name}</span>
                      <span className={`pm-factor__severity pm-factor__severity--${f.severity.toLowerCase()}`}>
                        {f.severity} · +{f.points} pts
                      </span>
                    </div>
                    <p className="pm-factor__explanation">{f.explanation}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="pm-section">
            <h3 className="pm-section__title">
              <ShieldCheck size={14} /> Compliance Check
            </h3>
            <div className="pm-risk-panel" style={{ borderColor: `${complianceColor}40` }}>
              <div className="pm-risk-panel__score" style={{ color: complianceColor }}>
                <span className="pm-risk-panel__number">{compliance.compliance_score}</span>
                <span className="pm-risk-panel__max">/100</span>
              </div>
              <div className="pm-risk-panel__body">
                <div className="pm-risk-panel__heading">
                  <span
                    className="compliance-badge"
                    style={{ background: `${complianceColor}1A`, color: complianceColor }}
                  >
                    {complianceStatusLabel}
                  </span>
                </div>
                <p className="pm-risk-panel__explanation">
                  <Sparkles size={13} className="pm-risk-panel__sparkle" />
                  {compliance.compliance_explanation}
                </p>
              </div>
            </div>

            {compliance.failed_checks.length > 0 && (
              <div className="pm-factor-list">
                {compliance.compliance_issues.map((issue, idx) => (
                  <div className="pm-factor" key={`${issue.check}-${idx}`}>
                    <div className="pm-factor__top">
                      <span className="pm-factor__name">{issue.check}</span>
                      <span
                        className={`pm-factor__severity pm-factor__severity--${issue.severity.toLowerCase()}`}
                      >
                        {issue.severity}
                      </span>
                    </div>
                    <p className="pm-factor__explanation">{issue.message}</p>
                  </div>
                ))}
              </div>
            )}

            <p className="pm-recommendation">{compliance.recommended_action}</p>
          </div>

          <div className="pm-section">
            <h3 className="pm-section__title">Detected Anomalies ({anomalies.length})</h3>
            {anomalies.length === 0 ? (
              <p className="pm-empty-note">No anomalies detected for this project.</p>
            ) : (
              <div className="pm-factor-list">
                {anomalies.map((a, idx) => (
                  <div className="pm-factor" key={`${a.type}-${idx}`}>
                    <div className="pm-factor__top">
                      <span className="pm-factor__name">{a.type}</span>
                      <span className={`pm-factor__severity pm-factor__severity--${a.severity.toLowerCase()}`}>
                        {a.severity}
                      </span>
                    </div>
                    <p className="pm-factor__explanation">{a.message}</p>
                  </div>
                ))}
              </div>
            )}
          </div>

          {duplicateMatches.length > 0 && (
            <div className="pm-section">
              <h3 className="pm-section__title">
                <Copy size={14} /> Potential Duplicate Work
              </h3>
              <div className="pm-factor-list">
                {duplicateMatches.map((m) => (
                  <div className="pm-factor" key={m.project.id}>
                    <div className="pm-factor__top">
                      <span className="pm-factor__name">
                        Matched Project: {m.project.id} — {m.project.workName}
                      </span>
                      <span className="pm-factor__severity pm-factor__severity--high">
                        {m.similarity}% similar
                      </span>
                    </div>
                    <p className="pm-factor__explanation">
                      Matched fields: {m.matchedFields.join(", ")}
                    </p>
                  </div>
                ))}
              </div>
              <p className="pm-disclaimer pm-disclaimer--inline">
                <Info size={12} />
                AI-assisted similarity detection — prototype, not production-grade fraud detection.
              </p>
            </div>
          )}

          {(mlAnomaly || mlDuplicate || mlLoading) && (
            <div className="pm-section">
              <h3 className="pm-section__title">
                <BrainCircuit size={14} /> ML-Based Analysis
              </h3>

              {mlLoading && !mlAnomaly && !mlDuplicate && (
                <p className="pm-empty-note">Running ML analysis…</p>
              )}

              {mlAnomaly && (
                <div className="pm-factor-list">
                  <div className="pm-factor">
                    <div className="pm-factor__top">
                      <span className="pm-factor__name">
                        ML Anomaly: {mlAnomaly.ml_anomaly_flag ? "Potential Anomaly" : "Normal"}
                      </span>
                      <span
                        className={`pm-factor__severity pm-factor__severity--${
                          mlAnomaly.ml_anomaly_flag ? "high" : "low"
                        }`}
                      >
                        score {mlAnomaly.ml_anomaly_score}
                      </span>
                    </div>
                    <p className="pm-factor__explanation">{mlAnomaly.ml_anomaly_reason}</p>
                    {mlAnomaly.ml_anomaly_confidence !== "normal" && (
                      <p className="pm-disclaimer pm-disclaimer--inline">
                        <Info size={12} />
                        {mlAnomaly.ml_anomaly_confidence === "insufficient_data"
                          ? "Not enough projects loaded to run ML anomaly detection."
                          : `ML confidence is limited — based on only ${mlAnomaly.ml_sample_size} project(s) currently loaded.`}
                      </p>
                    )}
                  </div>
                </div>
              )}

              {mlDuplicate && (
                <div className="pm-factor-list">
                  <div className="pm-factor">
                    <div className="pm-factor__top">
                      <span className="pm-factor__name">
                        Duplicate Check:{" "}
                        {mlDuplicate.possible_duplicate
                          ? "Potential Duplicate"
                          : mlDuplicate.duplicate_similarity_score > 0
                          ? "Similar Work — Review Required"
                          : "No Similar Work"}
                      </span>
                      {mlDuplicate.duplicate_similarity_score > 0 && (
                        <span className="pm-factor__severity pm-factor__severity--high">
                          {mlDuplicate.duplicate_similarity_score}% similar
                        </span>
                      )}
                    </div>
                    <p className="pm-factor__explanation">{mlDuplicate.duplicate_reason}</p>
                    {mlDuplicate.matched_project_ids?.length > 0 && (
                      <p className="pm-factor__explanation">
                        Matched project(s): {mlDuplicate.matched_project_ids.join(", ")}
                      </p>
                    )}
                  </div>
                </div>
              )}

              <p className="pm-disclaimer pm-disclaimer--inline">
                <Info size={12} />
                Unsupervised ML signal (Isolation Forest) + text-similarity duplicate check —
                supplementary to the rule-based analysis above, not a fraud determination.
              </p>
            </div>
          )}

          {(prediction || predictionLoading) && (
            <div className="pm-section">
              <h3 className="pm-section__title">
                <TrendingUp size={14} /> Predictive Insights
              </h3>

              {predictionLoading && !prediction && <p className="pm-empty-note">Running predictive model…</p>}

              {prediction && prediction.model_status === "insufficient_data" && (
                <p className="pm-empty-note">{prediction.model_notes}</p>
              )}

              {prediction && prediction.model_status !== "insufficient_data" && (
                <>
                  <div className="pm-factor-list">
                    <div className="pm-factor">
                      <div className="pm-factor__top">
                        <span className="pm-factor__name">
                          Delay Risk: {Math.round((prediction.delay_probability ?? 0) * 100)}%
                        </span>
                        <span
                          className={`pm-factor__severity pm-factor__severity--${
                            prediction.predicted_delay ? "high" : "low"
                          }`}
                        >
                          {prediction.predicted_delay ? "Delay Likely" : "On Track"}
                        </span>
                      </div>
                      {prediction.data_status && (
                        <p className="pm-factor__explanation">Data Status: {prediction.data_status}</p>
                      )}
                      {prediction.cost_overrun_probability != null && (
                        <p className="pm-factor__explanation">
                          Cost Overrun Probability: {Math.round(prediction.cost_overrun_probability * 100)}%
                          {prediction.predicted_cost_overrun ? " — overrun likely" : ""}
                        </p>
                      )}
                      {prediction.model_confidence === "low" && (
                        <p className="pm-disclaimer pm-disclaimer--inline">
                          <Info size={12} />
                          Model confidence is limited — trained on only {prediction.sample_size} project(s)
                          currently loaded.
                        </p>
                      )}
                    </div>
                  </div>

                  {predictionExplanation?.top_factors?.length > 0 && (
                    <div className="pm-compare__note" style={{ marginTop: "0.75rem" }}>
                      <strong>Primary Factors</strong>
                      <ul style={{ margin: "0.35rem 0 0", paddingLeft: "1.1rem" }}>
                        {predictionExplanation.top_factors.map((f) => (
                          <li key={f.feature} title={f.description}>
                            {f.short_label || f.description}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  <p className="pm-disclaimer pm-disclaimer--inline">
                    <Info size={12} />
                    {prediction.disclaimer}
                    {predictionExplanation?.notes ? ` ${predictionExplanation.notes}` : ""}
                  </p>
                </>
              )}
            </div>
          )}

          <div className="pm-section">
            <h3 className="pm-section__title">
              <AlertTriangle size={14} /> Early Warning
            </h3>
            <div className="pm-risk-panel" style={{ borderColor: `${earlyWarningColor}40` }}>
              <div className="pm-risk-panel__score" style={{ color: earlyWarningColor }}>
                <span className="pm-risk-panel__number" style={{ fontSize: "1.15rem" }}>
                  {earlyWarning.early_warning_level}
                </span>
              </div>
              <div className="pm-risk-panel__body">
                <div className="pm-risk-panel__heading">
                  <span
                    className="compliance-badge"
                    style={{ background: `${earlyWarningColor}1A`, color: earlyWarningColor }}
                  >
                    Requires Attention Level
                  </span>
                </div>
                <ul style={{ margin: "0.35rem 0 0", paddingLeft: "1.1rem" }}>
                  {earlyWarning.early_warning_reasons.map((reason, idx) => (
                    <li className="pm-factor__explanation" key={idx}>
                      {reason}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
            <p className="pm-recommendation">{earlyWarning.recommended_action}</p>
            <p className="pm-disclaimer pm-disclaimer--inline">
              <Info size={12} />
              Early warning means "requires attention" — it is not a confirmed finding of fraud.
            </p>
          </div>

          <div className="pm-section">
            <h3 className="pm-section__title">
              <ClipboardCheck size={14} /> Recommended Action
            </h3>
            <p className="pm-recommendation">{recommendation}</p>
          </div>
        </div>

        <div className="modal__footer">
          <button className="btn-secondary" onClick={onClose}>
            Close
          </button>
          <button className="btn-secondary" onClick={printCurrentView}>
            Print / Save as PDF
          </button>
          <button className="btn-primary" onClick={handleGenerateReport}>
            <FileDown size={15} />
            Generate Report
          </button>
        </div>
      </div>
    </div>
  );
}
