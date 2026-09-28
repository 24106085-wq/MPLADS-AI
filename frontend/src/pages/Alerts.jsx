// src/pages/Alerts.jsx
import { useEffect, useMemo, useState } from "react";
import {
  AlertOctagon,
  ShieldAlert,
  ShieldCheck,
  TrendingDown,
  DollarSign,
  Timer,
  Copy,
  Gauge,
  Repeat,
  Eye,
  FileDown,
  Activity,
  ListFilter,
  RotateCcw,
  ArrowUp,
  ArrowDown,
  ArrowUpDown,
  AlertTriangle,
} from "lucide-react";
import { detectAllAnomalies } from "../utils/anomalyDetector";
import { buildProjectReportText, downloadTextFile } from "../utils/reportGenerator";
import { computeEarlyWarning, EARLY_WARNING_COLORS } from "../utils/earlyWarning";
import { fetchAlertsFromApi } from "../utils/apiClient";
import RiskBadge from "../components/RiskBadge";
import ProjectModal from "../components/ProjectModal";
import EmptyState from "../components/EmptyState";
import "../style/alerts.css";

const SEVERITY_ORDER = { Critical: 0, High: 1, Medium: 2, Low: 3 };

const TYPE_ICONS = {
  "Cost Overrun": DollarSign,
  "Financial-Physical Mismatch": TrendingDown,
  "Unusual Payment Frequency": Repeat,
  "Delayed Project": Timer,
  "Stalled Physical Progress": Gauge,
  "Duplicate Work Flag": Copy,
  "Duplicate/Similar Work": Copy,
  // Milestone 4 — new prioritized-alert types from backend/alert_prioritizer.py
  "Early Warning": AlertTriangle,
  "Compliance Violation": ShieldCheck,
  "Potential Duplicate Work": Copy,
  "ML Anomaly Detected": Activity,
  "High Delay Risk": Timer,
  "High Cost Overrun Risk": DollarSign,
};

const SEVERITY_FILTERS = ["All Severities", "Critical", "High", "Medium", "Low"];

const SORT_OPTIONS = [
  { key: "severity", label: "Severity" },
  { key: "riskScore", label: "Risk Score" },
  { key: "type", label: "Alert Type" },
  { key: "projectId", label: "Project ID" },
];

function toTitleCase(value) {
  if (!value) return "Low";
  const s = String(value);
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

export default function Alerts({ projects, searchTerm }) {
  const [severityFilter, setSeverityFilter] = useState("All Severities");
  const [typeFilter, setTypeFilter] = useState("All Types");
  const [localSearch, setLocalSearch] = useState("");
  const [sortKey, setSortKey] = useState("severity");
  const [sortDir, setSortDir] = useState("asc");
  const [viewProject, setViewProject] = useState(null);

  // Milestone 4, Part C — prioritized alerts from the backend (already
  // deduplicated and merged with compliance/ML/duplicate/predictive/early-
  // warning signals server-side, see backend/alert_prioritizer.py). `null`
  // means "not loaded / backend unreachable", not "zero alerts".
  const [backendAlerts, setBackendAlerts] = useState(null);

  const findProject = (id) => projects.find((p) => p.id === id);

  useEffect(() => {
    let cancelled = false;
    fetchAlertsFromApi()
      .then((alerts) => {
        if (!cancelled) setBackendAlerts(alerts);
      })
      .catch(() => {
        if (!cancelled) setBackendAlerts(null);
      });
    return () => {
      cancelled = true;
    };
  }, [projects]);

  // Client-side Early Warning mirror (utils/earlyWarning.js), computed once
  // per project so the offline fallback below doesn't recompute it per row.
  const earlyWarningByProject = useMemo(() => {
    const map = new Map();
    projects.forEach((p) => map.set(p.id, computeEarlyWarning(p, projects)));
    return map;
  }, [projects]);

  // Stable Alert IDs assigned once, before any filtering, so they don't shift
  // around as the user changes filters.
  const allAlerts = useMemo(() => {
    if (backendAlerts !== null) {
      // Prefer the backend's prioritized list — no separate alert-generation
      // logic is duplicated here, this just reshapes the API response for
      // this table's existing columns.
      return backendAlerts.map((a) => ({
        alertId: a.alert_id,
        projectId: a.project_id,
        workName: a.project_name,
        type: a.alert_type,
        severity: toTitleCase(a.severity),
        message: a.description,
        recommendedAction: a.recommended_action,
        state: a.state || "—",
        district: a.district || "—",
        riskScore: a.risk_score ?? 0,
        riskLevel: a.risk_level || "Low",
        warningLevel: a.warning_level || null,
      }));
    }

    // Backend unreachable — existing local rule-based detection (unchanged),
    // enriched with the same client-side Early Warning mirror used in
    // ProjectModal so the new columns still populate offline.
    const raw = detectAllAnomalies(projects);
    return raw.map((a, idx) => {
      const project = findProject(a.projectId);
      const ew = project ? earlyWarningByProject.get(project.id) : null;
      return {
        alertId: `ALT-${String(idx + 1).padStart(4, "0")}`,
        projectId: a.projectId,
        workName: a.workName,
        type: a.type,
        severity: a.severity,
        message: a.message,
        recommendedAction: ew?.recommended_action || null,
        state: project?.state || "—",
        district: project?.district || "—",
        riskScore: project?.riskScore ?? 0,
        riskLevel: project?.riskLevel || "Low",
        warningLevel: ew?.early_warning_level || null,
      };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [backendAlerts, projects, earlyWarningByProject]);

  const alertTypes = useMemo(
    () => ["All Types", ...Array.from(new Set(allAlerts.map((a) => a.type)))],
    [allAlerts]
  );

  const filtered = useMemo(() => {
    let rows = [...allAlerts];

    if (severityFilter !== "All Severities") {
      rows = rows.filter((a) => a.severity === severityFilter);
    }
    if (typeFilter !== "All Types") {
      rows = rows.filter((a) => a.type === typeFilter);
    }

    const term = (searchTerm || localSearch || "").trim().toLowerCase();
    if (term) {
      rows = rows.filter((a) =>
        [a.alertId, a.type, a.message, a.projectId, a.workName, a.state, a.district]
          .join(" ")
          .toLowerCase()
          .includes(term)
      );
    }

    rows.sort((a, b) => {
      let cmp;
      if (sortKey === "severity") {
        cmp = SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
      } else if (sortKey === "riskScore") {
        cmp = a.riskScore - b.riskScore;
      } else {
        cmp = String(a[sortKey] || "").localeCompare(String(b[sortKey] || ""));
      }
      return sortDir === "asc" ? cmp : -cmp;
    });

    return rows;
  }, [allAlerts, severityFilter, typeFilter, searchTerm, localSearch, sortKey, sortDir]);

  const counts = useMemo(() => {
    const c = {
      total: allAlerts.length,
      Critical: 0,
      High: 0,
      Medium: 0,
      Low: 0,
      financialMismatch: 0,
      delayed: 0,
    };
    allAlerts.forEach((a) => {
      c[a.severity] = (c[a.severity] || 0) + 1;
      if (a.type === "Financial-Physical Mismatch") c.financialMismatch += 1;
      if (a.type === "Delayed Project") c.delayed += 1;
    });
    return c;
  }, [allAlerts]);

  const resetFilters = () => {
    setSeverityFilter("All Severities");
    setTypeFilter("All Types");
    setLocalSearch("");
    setSortKey("severity");
    setSortDir("asc");
  };

  const toggleSort = (key) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  };

  const handleGenerateAlertReport = (alert) => {
    const project = findProject(alert.projectId);
    if (!project) return;
    downloadTextFile(`${project.id}-risk-report.txt`, buildProjectReportText(project));
  };

  return (
    <div className="alerts-page">
      <div className="alerts-page__header">
        <div>
          <h1 className="dashboard__title">Risk &amp; Alerts</h1>
          <p className="dashboard__subtitle">
            Consolidated AI-detected anomalies across all sanctioned MPLADS works.
          </p>
        </div>
      </div>

      <div className="ai-alert-banner">
        <div className="ai-alert-banner__icon">
          <Activity size={18} />
        </div>
        <div className="ai-alert-banner__body">
          <div className="ai-alert-banner__title-row">
            <h2>AI Alert Engine Active</h2>
            <span className="ai-alert-banner__status">
              <span className="ai-alert-banner__status-dot" />
              Live
            </span>
          </div>
          <p>
            This prototype continuously analyzes expenditure, physical progress, timelines,
            payment patterns and duplicate/similar work across the current dataset to surface
            explainable, rule-based risk alerts. It is AI-assisted, not a trained ML model.
          </p>
        </div>
      </div>

      <div className="alerts-summary">
        <div className="alerts-summary__card alerts-summary__card--total">
          <ListFilter size={18} />
          <span className="alerts-summary__count">{counts.total}</span>
          <span className="alerts-summary__label">Total Alerts</span>
        </div>
        <div className="alerts-summary__card alerts-summary__card--critical">
          <AlertOctagon size={18} />
          <span className="alerts-summary__count">{counts.Critical}</span>
          <span className="alerts-summary__label">Critical</span>
        </div>
        <div className="alerts-summary__card alerts-summary__card--high">
          <ShieldAlert size={18} />
          <span className="alerts-summary__count">{counts.High}</span>
          <span className="alerts-summary__label">High</span>
        </div>
        <div className="alerts-summary__card alerts-summary__card--medium">
          <Gauge size={18} />
          <span className="alerts-summary__count">{counts.Medium}</span>
          <span className="alerts-summary__label">Medium</span>
        </div>
        <div className="alerts-summary__card alerts-summary__card--amber">
          <TrendingDown size={18} />
          <span className="alerts-summary__count">{counts.financialMismatch}</span>
          <span className="alerts-summary__label">Financial Mismatch</span>
        </div>
        <div className="alerts-summary__card alerts-summary__card--blue">
          <Timer size={18} />
          <span className="alerts-summary__count">{counts.delayed}</span>
          <span className="alerts-summary__label">Delayed Projects</span>
        </div>
      </div>

      <div className="alerts-toolbar">
        <div className="project-table__filters">
          {!searchTerm && (
            <input
              className="project-table__search"
              type="text"
              placeholder="Search by alert, project, district..."
              value={localSearch}
              onChange={(e) => setLocalSearch(e.target.value)}
            />
          )}
          <div className="project-table__select-group">
            <select value={severityFilter} onChange={(e) => setSeverityFilter(e.target.value)}>
              {SEVERITY_FILTERS.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
              {alertTypes.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
            <select value={sortKey} onChange={(e) => toggleSort(e.target.value)}>
              {SORT_OPTIONS.map((s) => (
                <option key={s.key} value={s.key}>
                  Sort: {s.label}
                </option>
              ))}
            </select>
            <button className="btn-secondary btn-reset" onClick={resetFilters}>
              <RotateCcw size={13} />
              Reset
            </button>
          </div>
        </div>
        <span className="project-table__count">{filtered.length} alert(s)</span>
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          icon={ShieldAlert}
          title="No alerts match your filters"
          message="Adjust the severity, type or search filters to see more results."
        />
      ) : (
        <div className="alerts-table-wrap">
          <div className="alerts-table-scroll">
            <table className="project-table alerts-table">
              <thead>
                <tr>
                  <th>Alert ID</th>
                  <th>Project ID</th>
                  <th>Alert Type</th>
                  <th>Severity</th>
                  <th>Project</th>
                  <th>State</th>
                  <th>District</th>
                  <th
                    className="th-sortable"
                    onClick={() => toggleSort("riskScore")}
                  >
                    <span className="th-content">
                      Risk Score
                      {sortKey === "riskScore" ? (
                        sortDir === "asc" ? (
                          <ArrowUp size={12} className="th-sort-icon th-sort-icon--active" />
                        ) : (
                          <ArrowDown size={12} className="th-sort-icon th-sort-icon--active" />
                        )
                      ) : (
                        <ArrowUpDown size={12} className="th-sort-icon" />
                      )}
                    </span>
                  </th>
                  <th>Early Warning</th>
                  <th>Detected Issue</th>
                  <th>Recommended Action</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((a) => {
                  const Icon = TYPE_ICONS[a.type] || AlertOctagon;
                  const project = findProject(a.projectId);
                  const ewColor = a.warningLevel ? EARLY_WARNING_COLORS[a.warningLevel] : null;
                  return (
                    <tr key={a.alertId}>
                      <td className="td-mono">{a.alertId}</td>
                      <td className="td-mono">{a.projectId}</td>
                      <td>
                        <span className="alerts-table__type">
                          <Icon size={14} />
                          {a.type}
                        </span>
                      </td>
                      <td>
                        <span className={`alert-item__severity alert-item__severity--${a.severity.toLowerCase()}`}>
                          {a.severity.toUpperCase()}
                        </span>
                      </td>
                      <td className="td-work-name" title={a.workName}>
                        {a.workName || "—"}
                      </td>
                      <td>{a.state}</td>
                      <td>{a.district}</td>
                      <td>{project ? <RiskBadge level={project.riskLevel} score={project.riskScore} /> : "—"}</td>
                      <td>
                        {a.warningLevel ? (
                          <span
                            className="compliance-badge"
                            style={{ background: `${ewColor}1A`, color: ewColor }}
                          >
                            {a.warningLevel}
                          </span>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="alerts-table__issue" title={a.message}>
                        {a.message}
                      </td>
                      <td className="alerts-table__issue" title={a.recommendedAction || ""}>
                        {a.recommendedAction || "—"}
                      </td>
                      <td>
                        <div className="alerts-table__actions">
                          {project && (
                            <button className="btn-view" onClick={() => setViewProject(project)}>
                              <Eye size={14} />
                              View
                            </button>
                          )}
                          {project && (
                            <button
                              className="btn-view btn-view--secondary"
                              onClick={() => handleGenerateAlertReport(a)}
                            >
                              <FileDown size={14} />
                              Report
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {viewProject && (
        <ProjectModal project={viewProject} allProjects={projects} onClose={() => setViewProject(null)} />
      )}
    </div>
  );
}
