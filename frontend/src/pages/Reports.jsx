// src/pages/Reports.jsx
import { useMemo, useState } from "react";
import {
  FileBarChart2,
  FolderKanban,
  Wallet,
  IndianRupee,
  ShieldAlert,
  Clock,
  Gauge,
  Bell,
  Download,
  Printer,
  FileText,
  ClipboardList,
  Search,
  TrendingDown,
  AlertTriangle,
  PieChart,
} from "lucide-react";
import StatCard from "../components/StatCard";
import DonutChart from "../components/DonutChart";
import FinancialComparisonChart from "../components/FinancialComparisonChart";
import ScatterChart from "../components/ScatterChart";
import EmptyState from "../components/EmptyState";
import {
  REPORT_TYPES,
  buildAggregateReportText,
  buildExecutiveSummaryData,
  buildProjectReportText,
  downloadTextFile,
  printCurrentView,
} from "../utils/reportGenerator";
import { detectAllAnomalies } from "../utils/anomalyDetector";
import { formatCurrencyCompact } from "../utils/projectUtils";
import {
  buildRiskDistribution,
  buildStatusDistribution,
  buildDelayDistribution,
  buildFinancialComparison,
  buildPhysicalVsFinancial,
} from "../utils/reportAnalytics";
import "../style/reports.css";

const REPORT_TYPE_META = {
  risk: { icon: ShieldAlert, description: "Every project ranked by AI risk score, highest first." },
  financial: { icon: Wallet, description: "Sanctioned vs expenditure and utilization, project-wise." },
  delayed: { icon: Clock, description: "All projects past their expected completion date." },
  anomaly: { icon: Bell, description: "Every rule-based anomaly detected across the dataset." },
  executive: { icon: FileText, description: "Dynamic KPI overview with key findings for leadership." },
};

/** Reusable text-report preview panel with Download / Print actions. */
function ReportPreview({ title, text, filename, onClose }) {
  if (!text) return null;
  return (
    <div className="report-preview">
      <div className="report-preview__header">
        <h3>{title}</h3>
        <div className="report-preview__actions">
          <button className="btn-secondary" onClick={() => downloadTextFile(filename, text)}>
            <Download size={14} />
            Download Report
          </button>
          <button className="btn-secondary" onClick={printCurrentView}>
            <Printer size={14} />
            Print / Save as PDF
          </button>
          {onClose && (
            <button className="btn-secondary" onClick={onClose}>
              Close
            </button>
          )}
        </div>
      </div>
      <pre className="report-preview__body">{text}</pre>
    </div>
  );
}

export default function Reports({ projects }) {
  const [selectedType, setSelectedType] = useState(null);
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [projectReportText, setProjectReportText] = useState("");
  const [projectSearch, setProjectSearch] = useState("");

  const hasData = projects.length > 0;

  const overview = useMemo(() => {
    const total = projects.length;
    const totalSanctioned = projects.reduce((s, p) => s + (Number(p.sanctionedAmount) || 0), 0);
    const totalExpenditure = projects.reduce((s, p) => s + (Number(p.expenditure) || 0), 0);
    const avgPhysical =
      total === 0 ? 0 : Math.round(projects.reduce((s, p) => s + (Number(p.physicalProgress) || 0), 0) / total);
    const atRisk = projects.filter((p) => ["High", "Critical"].includes(p.riskLevel)).length;
    const delayed = projects.filter((p) => p.status === "Delayed").length;
    const overruns = projects.filter((p) => (Number(p.expenditure) || 0) > (Number(p.sanctionedAmount) || 0)).length;
    const mismatches = projects.filter(
      (p) => (Number(p.financialProgress) || 0) - (Number(p.physicalProgress) || 0) >= 15
    ).length;
    const activeAlerts = detectAllAnomalies(projects).length;
    return { total, totalSanctioned, totalExpenditure, avgPhysical, atRisk, delayed, overruns, mismatches, activeAlerts };
  }, [projects]);

  const { stats: execStats, findings } = useMemo(() => buildExecutiveSummaryData(projects), [projects]);

  const riskDistribution = useMemo(() => buildRiskDistribution(projects), [projects]);
  const statusDistribution = useMemo(() => buildStatusDistribution(projects), [projects]);
  const delayDistribution = useMemo(() => buildDelayDistribution(projects), [projects]);
  const financialComparison = useMemo(() => buildFinancialComparison(projects), [projects]);
  const physicalVsFinancial = useMemo(() => buildPhysicalVsFinancial(projects), [projects]);

  const filteredProjectOptions = useMemo(() => {
    const term = projectSearch.trim().toLowerCase();
    if (!term) return projects;
    return projects.filter((p) =>
      [p.id, p.workName, p.district, p.state].join(" ").toLowerCase().includes(term)
    );
  }, [projects, projectSearch]);

  const selectedReportText = selectedType ? buildAggregateReportText(selectedType, projects) : "";

  const handleGenerateProjectReport = () => {
    const project = projects.find((p) => p.id === selectedProjectId);
    if (!project) return;
    setProjectReportText(buildProjectReportText(project));
  };

  return (
    <div className="reports-page">
      <div className="reports-page__header">
        <div>
          <h1 className="dashboard__title">Reports</h1>
          <p className="dashboard__subtitle">
            Browser-generated AI monitoring reports — downloadable and print-ready, no backend
            required.
          </p>
        </div>
        <div className="reports-page__icon">
          <FileBarChart2 size={20} />
        </div>
      </div>

      {!hasData && (
        <EmptyState
          icon={FileBarChart2}
          title="No MPLADS data available"
          message="Import a dataset to generate analytics."
        />
      )}

      {hasData && (
        <>
          {/* ===================== REPORT OVERVIEW ===================== */}
          <div className="reports-section-heading">
            <h2>Report Overview</h2>
          </div>
          <div className="kpi-grid reports-kpi-grid">
            <StatCard icon={FolderKanban} value={overview.total} label="Total Projects" tone="default" />
            <StatCard
              icon={Wallet}
              value={formatCurrencyCompact(overview.totalSanctioned)}
              label="Total Sanctioned Funds"
              tone="default"
            />
            <StatCard
              icon={IndianRupee}
              value={formatCurrencyCompact(overview.totalExpenditure)}
              label="Total Expenditure"
              tone="default"
            />
            <StatCard icon={Gauge} value={`${overview.avgPhysical}%`} label="Avg Physical Progress" tone="good" />
            <StatCard icon={ShieldAlert} value={overview.atRisk} label="High/Critical Risk Projects" tone="bad" />
            <StatCard icon={Clock} value={overview.delayed} label="Delayed Projects" tone="warn" />
            <StatCard icon={TrendingDown} value={overview.overruns} label="Cost Overrun Projects" tone="bad" />
            <StatCard
              icon={AlertTriangle}
              value={overview.mismatches}
              label="Financial/Physical Mismatch"
              tone="warn"
            />
            <StatCard icon={Bell} value={overview.activeAlerts} label="Active Alerts" tone="warn" />
          </div>

          {/* ===================== ANALYTICS ===================== */}
          <div className="reports-section-heading">
            <h2>Analytics</h2>
            <p>Charted directly from the currently imported project dataset — nothing here is sample data.</p>
          </div>
          <div className="chart-grid">
            <div className="chart-card">
              <h3 className="chart-card__title">
                <PieChart size={14} /> Risk Distribution
              </h3>
              <DonutChart data={riskDistribution} centerLabel="Projects" />
            </div>

            <div className="chart-card">
              <h3 className="chart-card__title">
                <PieChart size={14} /> Project Status
              </h3>
              <DonutChart data={statusDistribution} centerLabel="Projects" />
            </div>

            <div className="chart-card">
              <h3 className="chart-card__title">
                <Clock size={14} /> Delay Analysis
              </h3>
              <p className="chart-card__note">
                A project is only ever counted as Delayed when a real expected-completion date on
                file has passed. Missing date information is reported as Unknown, never guessed.
              </p>
              <DonutChart data={delayDistribution} centerLabel="Projects" />
            </div>

            <div className="chart-card chart-card--wide">
              <h3 className="chart-card__title">
                <Wallet size={14} /> Financial Analysis — Sanctioned vs Expenditure
              </h3>
              {financialComparison.length > 0 ? (
                <>
                  <div className="fin-chart__legend">
                    <span>
                      <span className="fin-chart__legend-dot fin-chart__legend-dot--sanctioned" /> Sanctioned
                    </span>
                    <span>
                      <span className="fin-chart__legend-dot fin-chart__legend-dot--expenditure" /> Expenditure
                    </span>
                    <span className="chart-card__note" style={{ marginLeft: "auto" }}>
                      Top {financialComparison.length} project(s) by sanctioned amount
                    </span>
                  </div>
                  <FinancialComparisonChart rows={financialComparison} />
                </>
              ) : (
                <p className="pm-empty-note">Insufficient data — no project has a recorded sanctioned amount.</p>
              )}
            </div>

            <div className="chart-card chart-card--wide">
              <h3 className="chart-card__title">
                <Gauge size={14} /> Physical vs Financial Progress
              </h3>
              {physicalVsFinancial.length > 0 ? (
                <ScatterChart points={physicalVsFinancial} />
              ) : (
                <p className="pm-empty-note">
                  Insufficient data — no project has both a recorded sanctioned amount and physical
                  progress value.
                </p>
              )}
            </div>
          </div>
        </>
      )}

      {/* ===================== REPORT TYPES ===================== */}
      <div className="reports-section-heading">
        <h2>Report Types</h2>
        <p>Select a report type to generate a browser-side, rule-based summary.</p>
      </div>
      <div className="report-type-grid">
        {REPORT_TYPES.map((rt) => {
          const meta = REPORT_TYPE_META[rt.id];
          const Icon = meta.icon;
          const isActive = selectedType === rt.id;
          return (
            <button
              key={rt.id}
              className={`report-type-card ${isActive ? "report-type-card--active" : ""}`}
              onClick={() => setSelectedType(isActive ? null : rt.id)}
            >
              <div className="report-type-card__icon">
                <Icon size={18} />
              </div>
              <div>
                <span className="report-type-card__title">{rt.label}</span>
                <p className="report-type-card__desc">{meta.description}</p>
              </div>
            </button>
          );
        })}
      </div>

      {selectedType && (
        <ReportPreview
          title={REPORT_TYPES.find((r) => r.id === selectedType)?.label}
          text={selectedReportText}
          filename={`mplads-${selectedType}-report-${new Date().toISOString().slice(0, 10)}.txt`}
          onClose={() => setSelectedType(null)}
        />
      )}

      {/* ===================== PROJECT REPORT GENERATOR ===================== */}
      <div className="reports-section-heading">
        <h2>Project Report Generator</h2>
        <p>Select a project to generate its full AI monitoring report.</p>
      </div>
      <div className="project-report-generator">
        <div className="project-report-generator__controls">
          <div className="project-report-generator__search">
            <Search size={14} />
            <input
              type="text"
              placeholder="Search project by ID, name or district..."
              value={projectSearch}
              onChange={(e) => setProjectSearch(e.target.value)}
            />
          </div>
          <select value={selectedProjectId} onChange={(e) => setSelectedProjectId(e.target.value)}>
            <option value="">Select a project…</option>
            {filteredProjectOptions.map((p) => (
              <option key={p.id} value={p.id}>
                {p.id} — {p.workName}
              </option>
            ))}
          </select>
          <button
            className="btn-primary"
            disabled={!selectedProjectId}
            onClick={handleGenerateProjectReport}
          >
            <ClipboardList size={15} />
            Generate Report
          </button>
        </div>

        {projectReportText && (
          <ReportPreview
            title={`Project Report — ${selectedProjectId}`}
            text={projectReportText}
            filename={`${selectedProjectId}-mplads-report.txt`}
            onClose={() => setProjectReportText("")}
          />
        )}
      </div>

      {/* ===================== EXECUTIVE SUMMARY ===================== */}
      {hasData && (
        <>
          <div className="reports-section-heading">
            <h2>Executive Summary</h2>
            <p>Dynamically calculated from the current project dataset.</p>
          </div>
          <div className="exec-summary">
            <div className="exec-summary__stats">
              <div className="exec-stat">
                <span className="exec-stat__value">{execStats.total}</span>
                <span className="exec-stat__label">Total Projects</span>
              </div>
              <div className="exec-stat">
                <span className="exec-stat__value">{formatCurrencyCompact(execStats.totalSanctioned)}</span>
                <span className="exec-stat__label">Total Sanctioned Funds</span>
              </div>
              <div className="exec-stat">
                <span className="exec-stat__value">{formatCurrencyCompact(execStats.totalExpenditure)}</span>
                <span className="exec-stat__label">Total Expenditure</span>
              </div>
              <div className="exec-stat">
                <span className="exec-stat__value">{execStats.avgPhysical}%</span>
                <span className="exec-stat__label">Average Physical Progress</span>
              </div>
              <div className="exec-stat">
                <span className="exec-stat__value">{execStats.atRisk}</span>
                <span className="exec-stat__label">Projects At Risk</span>
              </div>
              <div className="exec-stat">
                <span className="exec-stat__value">{execStats.critical}</span>
                <span className="exec-stat__label">Critical Projects</span>
              </div>
              <div className="exec-stat">
                <span className="exec-stat__value">{execStats.delayed}</span>
                <span className="exec-stat__label">Delayed Projects</span>
              </div>
              <div className="exec-stat">
                <span className="exec-stat__value">{execStats.mismatches}</span>
                <span className="exec-stat__label">Financial Mismatch Cases</span>
              </div>
              <div className="exec-stat">
                <span className="exec-stat__value">{execStats.overruns}</span>
                <span className="exec-stat__label">Cost Overrun Cases</span>
              </div>
              <div className="exec-stat">
                <span className="exec-stat__value">{execStats.duplicates}</span>
                <span className="exec-stat__label">Duplicate Cases</span>
              </div>
            </div>

            <div className="exec-summary__findings">
              <h3>Key Findings</h3>
              <ul>
                {findings.map((f, idx) => (
                  <li key={idx}>{f}</li>
                ))}
              </ul>
            </div>

            <div className="exec-summary__actions">
              <button
                className="btn-secondary"
                onClick={() =>
                  downloadTextFile(
                    `mplads-executive-summary-${new Date().toISOString().slice(0, 10)}.txt`,
                    buildAggregateReportText("executive", projects)
                  )
                }
              >
                <Download size={14} />
                Download Report
              </button>
              <button className="btn-secondary" onClick={printCurrentView}>
                <Printer size={14} />
                Print / Save as PDF
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
