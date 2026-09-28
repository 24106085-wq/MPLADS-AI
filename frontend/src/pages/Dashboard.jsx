// src/pages/Dashboard.jsx
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  FolderKanban,
  IndianRupee,
  Wallet,
  ShieldAlert,
  Clock,
  Gauge,
  Plus,
  UploadCloud,
  Download,
  Activity,
  AlertOctagon,
  TrendingDown,
  DollarSign,
  Timer,
  Copy,
  X,
  FileBarChart2,
  CheckCircle2,
  ShieldCheck,
  BrainCircuit,
  AlertTriangle,
  Eye,
  Check,
  Landmark,
  Building2,
  MapPinned,
  UserRound,
} from "lucide-react";
import StatCard from "../components/StatCard";
import ProjectTable from "../components/ProjectTable";
import ProjectModal from "../components/ProjectModal";
import UploadDataModal from "../components/UploadDataModal";
import { formatCurrencyCompact } from "../utils/projectUtils";
import { checkCompliance } from "../utils/complianceChecker";
import { computeEarlyWarning } from "../utils/earlyWarning";
import { fetchAllMonitoringFromApi, fetchGeoRegionsFromApi } from "../utils/apiClient";
import "../style/dashcss.css";

const CATEGORIES = [
  "Healthcare",
  "Education",
  "Drinking Water",
  "Roads & Connectivity",
  "Rural Infrastructure",
  "Sanitation",
  "Sports Infrastructure",
  "Community Infrastructure",
  "Child & Women Welfare",
  "General",
];

const STATUSES = ["Not Started", "In Progress", "Completed", "Delayed"];

/** Inline "Add New Project" form modal — kept local to Dashboard per the approved file structure. */
function AddProjectModal({ onClose, onSubmit }) {
  const [form, setForm] = useState({
    workName: "",
    mpName: "",
    constituency: "",
    state: "",
    district: "",
    category: CATEGORIES[0],
    sanctionedAmount: "",
    expenditure: "",
    physicalProgress: "",
    expectedCompletion: "",
    status: STATUSES[1],
    implementingAgency: "",
  });
  const [submitError, setSubmitError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // ---------------------------------------------------------------------
  // Add Project — State -> District -> Constituency cascading dropdowns.
  // Sourced from GET /api/geo/regions (backend/geo_data.py) so the form
  // only ever offers combinations the backend will actually accept. See
  // that module's docstring for the real-but-not-exhaustive data scope.
  // ---------------------------------------------------------------------
  const [regions, setRegions] = useState(null); // { states: [...], regions: { state: { district: [constituency,...] } } }
  const [regionsError, setRegionsError] = useState("");

  useEffect(() => {
    let cancelled = false;
    fetchGeoRegionsFromApi()
      .then((data) => {
        if (!cancelled) setRegions(data);
      })
      .catch(() => {
        if (!cancelled) setRegionsError("Could not load state/district data from the backend.");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const districtOptions = form.state ? Object.keys(regions?.regions?.[form.state] || {}).sort() : [];
  const constituencyOptions =
    form.state && form.district ? regions?.regions?.[form.state]?.[form.district] || [] : [];

  const update = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  // Changing State invalidates whatever District/Constituency/MP was
  // selected under the previous state, so all three reset together.
  const handleStateChange = (e) => {
    const state = e.target.value;
    setForm((f) => ({ ...f, state, district: "", constituency: "", mpName: "" }));
  };

  // Changing District invalidates the Constituency/MP that was selected
  // under the previous district.
  const handleDistrictChange = (e) => {
    const district = e.target.value;
    setForm((f) => ({ ...f, district, constituency: "", mpName: "" }));
  };

  const handleConstituencyChange = (e) => {
    const constituency = e.target.value;
    // The constituency IS the MP's constituency in this prototype's data
    // model, so selecting one also fills the MP Name field with it —
    // officers can still edit the actual sitting MP's name afterwards.
    setForm((f) => ({ ...f, constituency, mpName: constituency }));
  };

  // Async now: awaits the real backend result from onSubmit (see
  // App.jsx's handleAddProject, which returns {success, error}) instead of
  // firing and assuming success. On success the caller closes this modal
  // and refreshes the dataset; on failure the modal stays open and shows
  // the real error instead of silently failing.
  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.workName || !form.state || !form.district || !form.sanctionedAmount) {
      setSubmitError("Please fill in Work Name, State, District and Sanctioned Amount.");
      return;
    }
    setSubmitError("");
    setSubmitting(true);
    const result = await onSubmit({
      ...form,
      sanctionedAmount: Number(form.sanctionedAmount) || 0,
      expenditure: Number(form.expenditure) || 0,
      physicalProgress: Number(form.physicalProgress) || 0,
      startDate: new Date().toISOString().slice(0, 10),
      paymentCount: 1,
    });
    setSubmitting(false);
    if (result && result.success === false) {
      setSubmitError(result.error || "Could not add the project. Please try again.");
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal--wide" onClick={(e) => e.stopPropagation()}>
        <div className="modal__header">
          <div>
            <span className="modal__eyebrow">New Record</span>
            <h2 className="modal__title">Add New Project</h2>
          </div>
          <button className="modal__close" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="modal__body">
            <div className="form-grid">
              <label className="form-field form-field--span2">
                <span>Work Name</span>
                <input value={form.workName} onChange={update("workName")} placeholder="e.g. Construction of Community Hall" required />
              </label>

              <label className="form-field">
                <span>State</span>
                <select value={form.state} onChange={handleStateChange} required disabled={!regions}>
                  <option value="">
                    {regionsError ? "Could not load states" : regions ? "Select state" : "Loading states…"}
                  </option>
                  {(regions?.states || []).map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </label>

              <label className="form-field">
                <span>District</span>
                <select
                  value={form.district}
                  onChange={handleDistrictChange}
                  required
                  disabled={!form.state}
                >
                  {!form.state ? (
                    <option value="">Select state first</option>
                  ) : (
                    <>
                      <option value="">Select district</option>
                      {districtOptions.map((d) => (
                        <option key={d} value={d}>
                          {d}
                        </option>
                      ))}
                    </>
                  )}
                </select>
              </label>

              <label className="form-field">
                <span>Constituency / MP</span>
                <select
                  value={form.constituency}
                  onChange={handleConstituencyChange}
                  disabled={!form.district || constituencyOptions.length === 0}
                >
                  {!form.district ? (
                    <option value="">Select district first</option>
                  ) : constituencyOptions.length === 0 ? (
                    <option value="">No constituency mapping available</option>
                  ) : (
                    <>
                      <option value="">Select constituency</option>
                      {constituencyOptions.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </>
                  )}
                </select>
              </label>

              <label className="form-field">
                <span>MP Name</span>
                <input
                  value={form.mpName}
                  onChange={update("mpName")}
                  placeholder="e.g. Shri A. Kumar"
                  disabled={!form.district}
                />
              </label>

              <label className="form-field">
                <span>Work Category</span>
                <select value={form.category} onChange={update("category")}>
                  {CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </label>

              <label className="form-field">
                <span>Status</span>
                <select value={form.status} onChange={update("status")}>
                  {STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </label>

              <label className="form-field">
                <span>Sanctioned Amount (₹)</span>
                <input type="number" min="0" value={form.sanctionedAmount} onChange={update("sanctionedAmount")} placeholder="e.g. 2500000" required />
              </label>

              <label className="form-field">
                <span>Expenditure (₹)</span>
                <input type="number" min="0" value={form.expenditure} onChange={update("expenditure")} placeholder="e.g. 1200000" />
              </label>

              <label className="form-field">
                <span>Physical Progress (%)</span>
                <input type="number" min="0" max="100" value={form.physicalProgress} onChange={update("physicalProgress")} placeholder="e.g. 45" />
              </label>

              <label className="form-field">
                <span>Expected Completion Date</span>
                <input type="date" value={form.expectedCompletion} onChange={update("expectedCompletion")} />
              </label>

              <label className="form-field">
                <span>Implementing Agency</span>
                <input value={form.implementingAgency} onChange={update("implementingAgency")} placeholder="e.g. District Rural Development Agency" />
              </label>
            </div>

            {regionsError && <div className="upload-error">{regionsError}</div>}
            {submitError && <div className="upload-error">{submitError}</div>}
            <p className="form-note">
              A unique Project ID will be generated automatically on submission. Financial progress
              and AI risk score are calculated instantly from the values above. State and District
              are validated against the server's real geography data (backend/geo_data.py) on submit.
            </p>
          </div>

          <div className="modal__footer">
            <button type="button" className="btn-secondary" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn-primary" disabled={submitting}>
              <Plus size={15} />
              {submitting ? "Adding…" : "Add Project"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function exportProjectsCSV(projects) {
  const headers = [
    "Project ID",
    "Work Name",
    "MP Name",
    "Constituency",
    "State",
    "District",
    "Category",
    "Sanctioned Amount",
    "Expenditure",
    "Financial Progress %",
    "Physical Progress %",
    "Status",
    "Risk Score",
    "Risk Level",
    "Expected Completion",
  ];
  const rows = projects.map((p) => [
    p.id,
    p.workName,
    p.mpName,
    p.constituency,
    p.state,
    p.district,
    p.category,
    p.sanctionedAmount,
    p.expenditure,
    p.financialProgress,
    p.physicalProgress,
    p.status,
    p.riskScore,
    p.riskLevel,
    p.expectedCompletion,
  ]);
  const csv = [headers, ...rows]
    .map((r) => r.map((cell) => `"${String(cell ?? "").replace(/"/g, '""')}"`).join(","))
    .join("\n");

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `mplads-projects-export-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

// Milestone 4, Part D — Role-Oriented View Selector. This is a lightweight
// filtering mechanism only (no authentication). Each role scopes the
// dashboard to the closest matching field actually present in the dataset:
// MP -> constituency, District Authority -> district, State Nodal -> state.
// Ministry View has no hierarchy above state, so it stays national/unfiltered
// (the dataset also doesn't carry a distinct "ministry" grouping field).
// shortLabel/icon are purely presentational (added for the Milestone 4
// role-switcher UI refresh) and do not affect the key/scopeField values
// that drive the existing filtering logic below.
const ROLE_VIEWS = [
  { key: "ministry", label: "Ministry View (National)", shortLabel: "Ministry", icon: Landmark, scopeField: null },
  { key: "state", label: "State Nodal Authority", shortLabel: "State Nodal", icon: Building2, scopeField: "state" },
  { key: "district", label: "District Authority", shortLabel: "District", icon: MapPinned, scopeField: "district" },
  { key: "mp", label: "MP View (Constituency)", shortLabel: "MP", icon: UserRound, scopeField: "constituency" },
];

const COMPLIANCE_ISSUE_STATUSES = ["NON_COMPLIANT", "REQUIRES_REVIEW", "WARNING"];

export default function Dashboard({ projects, onAddProject, onImportProjects, searchTerm, backendOnline, currentUser }) {
  const [viewProject, setViewProject] = useState(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showUploadModal, setShowUploadModal] = useState(false);

  // A logged-in non-admin's role/scope is decided server-side (see
  // backend/auth.py + GET /api/projects) — `projects` here already arrives
  // pre-scoped to just their own data. The switcher below is therefore
  // locked to that real role for them; only Ministry/Admin, who legitimately
  // sees the full national dataset, gets to explore other views with it.
  const isAdmin = !currentUser || currentUser.role === "admin";
  const lockedRoleView = currentUser && ROLE_VIEWS.find((r) => r.key === currentUser.role);

  const [roleKey, setRoleKey] = useState(isAdmin ? "ministry" : lockedRoleView?.key || "ministry");
  const [scopeValue, setScopeValue] = useState(isAdmin ? "" : currentUser?.identifier || "");
  const role = ROLE_VIEWS.find((r) => r.key === roleKey) || ROLE_VIEWS[0];

  const scopeOptions = useMemo(() => {
    if (!isAdmin || !role.scopeField) return [];
    return Array.from(new Set(projects.map((p) => p[role.scopeField]).filter(Boolean))).sort();
  }, [isAdmin, role.scopeField, projects]);

  // Reset/default the scope value whenever the role (or its available
  // options) changes, so switching to e.g. District Authority always lands
  // on a valid district rather than an empty/stale selection. Only runs for
  // admin — a non-admin's role/scope stays pinned to their own login.
  useEffect(() => {
    if (!isAdmin) return;
    if (!role.scopeField) {
      setScopeValue("");
      return;
    }
    setScopeValue((prev) => (scopeOptions.includes(prev) ? prev : scopeOptions[0] || ""));
  }, [isAdmin, role.scopeField, scopeOptions]);

  const roleFilteredProjects = useMemo(() => {
    // Non-admin: `projects` is already scoped server-side to this user's
    // own data — filtering it again client-side would be redundant (and,
    // if it ever disagreed with the server, misleading).
    if (!isAdmin) return projects;
    if (!role.scopeField || !scopeValue) return projects;
    return projects.filter((p) => p[role.scopeField] === scopeValue);
  }, [projects, role.scopeField, scopeValue, isAdmin]);

  // Milestone 4, Part B/E — unified monitoring, fetched once from the
  // backend and reused for both the Compliance Issues / ML Anomalies /
  // Early Warnings KPIs below and (implicitly) kept in sync with whatever
  // role/scope is selected, instead of re-deriving compliance/ML logic here.
  const [monitoringList, setMonitoringList] = useState(null); // null = backend unreachable

  useEffect(() => {
    let cancelled = false;
    fetchAllMonitoringFromApi()
      .then((list) => {
        if (!cancelled) setMonitoringList(list);
      })
      .catch(() => {
        if (!cancelled) setMonitoringList(null);
      });
    return () => {
      cancelled = true;
    };
  }, [projects]);

  const monitoringById = useMemo(() => {
    const map = new Map();
    (monitoringList || []).forEach((m) => {
      if (m?.project?.id) map.set(m.project.id, m);
    });
    return map;
  }, [monitoringList]);

  const kpis = useMemo(() => {
    const total = roleFilteredProjects.length;
    const totalSanctioned = roleFilteredProjects.reduce((s, p) => s + p.sanctionedAmount, 0);
    const totalExpenditure = roleFilteredProjects.reduce((s, p) => s + p.expenditure, 0);
    const atRisk = roleFilteredProjects.filter((p) => ["High", "Critical"].includes(p.riskLevel)).length;
    const delayed = roleFilteredProjects.filter((p) => p.status === "Delayed").length;
    const avgPhysical =
      total === 0 ? 0 : Math.round(roleFilteredProjects.reduce((s, p) => s + p.physicalProgress, 0) / total);

    return { total, totalSanctioned, totalExpenditure, atRisk, delayed, avgPhysical };
  }, [roleFilteredProjects]);

  const aiSummary = useMemo(() => {
    const critical = roleFilteredProjects.filter((p) => p.riskLevel === "Critical").length;
    const high = roleFilteredProjects.filter((p) => p.riskLevel === "High").length;
    const mismatches = roleFilteredProjects.filter((p) => p.financialProgress - p.physicalProgress >= 15).length;
    const overruns = roleFilteredProjects.filter((p) => p.expenditure > p.sanctionedAmount).length;
    const delayed = roleFilteredProjects.filter((p) => p.status === "Delayed").length;
    const duplicates = roleFilteredProjects.filter((p) =>
      p.riskFactors.some((f) => f.name === "Duplicate/Similar Work Indicator")
    ).length;

    return { critical, high, mismatches, overruns, delayed, duplicates };
  }, [roleFilteredProjects]);

  // Milestone 4, Part E — the four additional Final Dashboard KPIs.
  // Prefers the backend's unified monitoring data (folds in real ML anomaly
  // detection); falls back to the client-side compliance/early-warning
  // mirrors when the backend isn't reachable. There is no client-side ML
  // mirror (Isolation Forest runs server-side only), so ML Anomalies shows
  // "—" rather than a fabricated number while offline.
  const extraSummary = useMemo(() => {
    const completedProjects = roleFilteredProjects.filter((p) => p.status === "Completed").length;
    const earlyWarnings = { RED: 0, ORANGE: 0, YELLOW: 0, GREEN: 0 };
    let complianceIssues = 0;
    let mlAnomalies = 0;
    let mlAvailable = false;

    if (monitoringList) {
      mlAvailable = true;
      roleFilteredProjects.forEach((p) => {
        const m = monitoringById.get(p.id);
        if (!m) return;
        if (COMPLIANCE_ISSUE_STATUSES.includes(m.compliance?.status)) complianceIssues += 1;
        if (m.ai?.ml_anomaly_flag) mlAnomalies += 1;
        const level = m.early_warning?.early_warning_level;
        if (level) earlyWarnings[level] = (earlyWarnings[level] || 0) + 1;
      });
    } else {
      roleFilteredProjects.forEach((p) => {
        const c = checkCompliance(p);
        if (COMPLIANCE_ISSUE_STATUSES.includes(c.compliance_status)) complianceIssues += 1;
        const ew = computeEarlyWarning(p, roleFilteredProjects);
        earlyWarnings[ew.early_warning_level] = (earlyWarnings[ew.early_warning_level] || 0) + 1;
      });
    }

    return { completedProjects, complianceIssues, mlAnomalies, mlAvailable, earlyWarnings };
  }, [roleFilteredProjects, monitoringList, monitoringById]);

  const utilizationRate =
    kpis.totalSanctioned > 0 ? Math.round((kpis.totalExpenditure / kpis.totalSanctioned) * 100) : 0;

  return (
    <div className="dashboard">
      <div className="dashboard__header">
        <div>
          <div className="dashboard__title-row">
            <h1 className="dashboard__title">MPLADS AI Monitoring Dashboard</h1>
            <span className={`backend-status ${backendOnline ? "backend-status--online" : "backend-status--offline"}`}>
              <span className="backend-status__dot" />
              {backendOnline ? "Backend Connected" : "Backend Unreachable"}
            </span>
          </div>
          <p className="dashboard__subtitle">
            AI-powered monitoring of project execution, fund utilization and implementation risks.
          </p>
        </div>
        <div className="dashboard__actions">
          <Link className="btn-secondary" to="/alerts">
            <ShieldAlert size={15} />
            View All Alerts
          </Link>
          <Link className="btn-secondary" to="/reports">
            <FileBarChart2 size={15} />
            Generate Report
          </Link>
          <button className="btn-secondary" onClick={() => setShowUploadModal(true)}>
            <UploadCloud size={15} />
            Upload MPLADS Data
          </button>
          <button className="btn-secondary" onClick={() => exportProjectsCSV(roleFilteredProjects)}>
            <Download size={15} />
            Export Data
          </button>
          <button className="btn-primary" onClick={() => setShowAddModal(true)}>
            <Plus size={15} />
            Add New Project
          </button>
        </div>
      </div>

      {isAdmin ? (
        <div className="role-switcher">
          <div className="role-switcher__top">
            <div className="role-switcher__label">
              <Eye size={13} />
              Viewing Dashboard As
            </div>
            <span className="role-switcher__count">
              {roleFilteredProjects.length} of {projects.length} project(s) in view
            </span>
          </div>

          <div className="role-switcher__row">
            <div className="role-switcher__tabs" role="tablist" aria-label="Role view">
              {ROLE_VIEWS.map((r) => {
                const Icon = r.icon;
                const active = r.key === roleKey;
                return (
                  <button
                    key={r.key}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    title={r.label}
                    className={`role-switcher__tab${active ? " role-switcher__tab--active" : ""}`}
                    onClick={() => setRoleKey(r.key)}
                  >
                    <Icon size={14} />
                    {r.shortLabel}
                    {active && <Check size={13} className="role-switcher__tab-check" />}
                  </button>
                );
              })}
            </div>

            {role.scopeField && (
              <div className="role-switcher__scope">
                <label htmlFor="role-scope-select">
                  {role.scopeField.charAt(0).toUpperCase() + role.scopeField.slice(1)}
                </label>
                <select
                  id="role-scope-select"
                  value={scopeValue}
                  onChange={(e) => setScopeValue(e.target.value)}
                  aria-label={`Filter by ${role.scopeField}`}
                >
                  {scopeOptions.length === 0 && <option value="">No {role.scopeField} in dataset</option>}
                  {scopeOptions.map((opt) => (
                    <option key={opt} value={opt}>
                      {opt}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>

          {roleKey !== "ministry" && (
            <p className="form-note role-switcher__note">
              {role.label} scopes the dashboard to the closest available field ({role.scopeField}) in the current
              dataset. Ministry View shows the full national dataset.
            </p>
          )}
        </div>
      ) : (
        <div className="role-switcher role-switcher--locked">
          <div className="role-switcher__top">
            <div className="role-switcher__label">
              <ShieldCheck size={13} />
              Signed in as {currentUser.role_label}
              {currentUser.identifier ? ` — ${currentUser.identifier}` : ""}
            </div>
            <span className="role-switcher__count">{roleFilteredProjects.length} project(s) in view</span>
          </div>
          <p className="form-note role-switcher__note">
            This view is scoped to your account by the server and can't be switched to another role or region —
            log in with a different demo account to see a different scope.
          </p>
        </div>
      )}

      <div className="kpi-grid">
        <StatCard icon={FolderKanban} value={kpis.total} label="Total Projects" trend="Across all states" tone="default" />
        <StatCard
          icon={Wallet}
          value={formatCurrencyCompact(kpis.totalSanctioned)}
          label="Total Sanctioned Amount"
          trend="Cumulative MPLADS funds"
          tone="field"
        />
        <StatCard
          icon={IndianRupee}
          value={formatCurrencyCompact(kpis.totalExpenditure)}
          label="Total Expenditure"
          trend={`${utilizationRate}% of sanctioned funds utilized`}
          tone="accent"
        />
        <StatCard
          icon={ShieldAlert}
          value={kpis.atRisk}
          label="Projects At Risk"
          trend="High + Critical risk level"
          tone="bad"
        />
        <StatCard icon={Clock} value={kpis.delayed} label="Delayed Projects" trend="Past expected completion" tone="warn" />
        <StatCard
          icon={Gauge}
          value={`${kpis.avgPhysical}%`}
          label="Average Physical Progress"
          trend="Across all active works"
          tone="good"
        />
        <StatCard
          icon={CheckCircle2}
          value={extraSummary.completedProjects}
          label="Completed Projects"
          trend="Status: Completed"
          tone="good"
        />
        <StatCard
          icon={ShieldCheck}
          value={extraSummary.complianceIssues}
          label="Compliance Issues"
          trend="Requires review or non-compliant"
          tone="warn"
        />
        <StatCard
          icon={BrainCircuit}
          value={extraSummary.mlAvailable ? extraSummary.mlAnomalies : "—"}
          label="ML Anomalies"
          trend={extraSummary.mlAvailable ? "Isolation Forest flags" : "Backend offline"}
          tone="bad"
        />
        <StatCard
          icon={AlertTriangle}
          value={extraSummary.earlyWarnings.RED + extraSummary.earlyWarnings.ORANGE}
          label="Early Warnings"
          trend={`${extraSummary.earlyWarnings.RED} red · ${extraSummary.earlyWarnings.ORANGE} orange`}
          tone="bad"
        />
      </div>

      <div className="ai-summary">
        <div className="ai-summary__header">
          <div className="ai-summary__title-group">
            <div className="ai-summary__icon">
              <Activity size={18} />
            </div>
            <div>
              <h2>AI Monitoring Summary</h2>
              <p>Live risk signals derived from the current project dataset</p>
            </div>
          </div>
          <div className="ai-summary__status">
            <span className="ai-summary__status-dot" />
            AI Monitoring Active
          </div>
        </div>

        <div className="ai-summary__grid">
          <div className="ai-signal ai-signal--critical">
            <AlertOctagon size={17} />
            <div>
              <span className="ai-signal__value">{aiSummary.critical}</span>
              <span className="ai-signal__label">Critical Alerts</span>
            </div>
          </div>
          <div className="ai-signal ai-signal--high">
            <ShieldAlert size={17} />
            <div>
              <span className="ai-signal__value">{aiSummary.high}</span>
              <span className="ai-signal__label">High-Risk Projects</span>
            </div>
          </div>
          <div className="ai-signal ai-signal--amber">
            <TrendingDown size={17} />
            <div>
              <span className="ai-signal__value">{aiSummary.mismatches}</span>
              <span className="ai-signal__label">Financial-Physical Mismatches</span>
            </div>
          </div>
          <div className="ai-signal ai-signal--amber">
            <DollarSign size={17} />
            <div>
              <span className="ai-signal__value">{aiSummary.overruns}</span>
              <span className="ai-signal__label">Cost Overruns</span>
            </div>
          </div>
          <div className="ai-signal ai-signal--blue">
            <Timer size={17} />
            <div>
              <span className="ai-signal__value">{aiSummary.delayed}</span>
              <span className="ai-signal__label">Delayed Projects</span>
            </div>
          </div>
          <div className="ai-signal ai-signal--blue">
            <Copy size={17} />
            <div>
              <span className="ai-signal__value">{aiSummary.duplicates}</span>
              <span className="ai-signal__label">Duplicate/Similar Works</span>
            </div>
          </div>
        </div>
      </div>

      <div className="dashboard__table-section">
        <div className="dashboard__table-heading">
          <h2>All Projects</h2>
          <span>{roleFilteredProjects.length} records</span>
        </div>
        <ProjectTable projects={roleFilteredProjects} searchTerm={searchTerm} onView={setViewProject} />
      </div>

      {viewProject && (
        <ProjectModal project={viewProject} allProjects={projects} onClose={() => setViewProject(null)} />
      )}
      {showAddModal && (
        <AddProjectModal
          onClose={() => setShowAddModal(false)}
          onSubmit={async (data) => {
            // onAddProject (App.jsx's handleAddProject) awaits the real
            // POST /api/projects call and returns {success, error}. Only
            // close the modal (and thereby accept the new project) once
            // the backend has actually confirmed success and the project
            // list has been refreshed from it — never on a fire-and-forget
            // assumption.
            const result = await onAddProject(data);
            if (result?.success) {
              setShowAddModal(false);
            }
            return result;
          }}
        />
      )}
      {showUploadModal && (
        <UploadDataModal
          backendOnline={backendOnline}
          onClose={() => setShowUploadModal(false)}
          onImport={onImportProjects}
        />
      )}
    </div>
  );
}
