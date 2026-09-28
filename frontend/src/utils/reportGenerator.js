// src/utils/reportGenerator.js
// Browser-side, rule-based report text generation. No backend required.
// Shared by ProjectModal, Alerts and Reports pages so there is exactly one
// place that formats MPLADS AI monitoring reports.

import { formatCurrency, formatDate } from "./projectUtils";
import { detectProjectAnomalies, detectAllAnomalies } from "./anomalyDetector";
import { getRecommendedAction } from "./riskCalculator";

/** Triggers a browser download of a plain-text file. */
export function downloadTextFile(filename, content) {
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/** Opens the browser print dialog for the current page (Print / Save as PDF). */
export function printCurrentView() {
  window.print();
}

/** Full single-project AI monitoring report, used by the alert/project modal and Reports page. */
export function buildProjectReportText(project) {
  const anomalies = detectProjectAnomalies(project);
  const recommendation = getRecommendedAction(project.riskLevel);

  return [
    "===========================================================",
    " MPLADS AI MONITORING REPORT",
    "===========================================================",
    `Generated: ${new Date().toLocaleString("en-IN")}`,
    "",
    "PROJECT INFORMATION",
    "-----------------------------------------------------------",
    `Project ID:             ${project.id}`,
    `Work Name:              ${project.workName}`,
    `MP / Constituency:      ${project.mpName} (${project.constituency})`,
    `State / District:       ${project.state} / ${project.district}`,
    `Work Category:          ${project.category || "—"}`,
    `Implementing Agency:    ${project.implementingAgency}`,
    `Status:                 ${project.status}`,
    `Expected Completion:    ${formatDate(project.expectedCompletion)}`,
    "",
    "FINANCIAL SUMMARY",
    "-----------------------------------------------------------",
    `Sanctioned Amount:      ${formatCurrency(project.sanctionedAmount)}`,
    `Expenditure:            ${formatCurrency(project.expenditure)}`,
    `Financial Utilization:  ${project.financialProgress}%`,
    "",
    "PHYSICAL SUMMARY",
    "-----------------------------------------------------------",
    `Physical Progress:      ${project.physicalProgress}%`,
    `Status:                 ${project.status}`,
    `Expected Completion:    ${formatDate(project.expectedCompletion)}`,
    "",
    "AI RISK ANALYSIS",
    "-----------------------------------------------------------",
    `Risk Score:             ${project.riskScore} / 100`,
    `Risk Level:             ${project.riskLevel}`,
    "",
    "RISK FACTORS",
    "-----------------------------------------------------------",
    ...(project.riskFactors && project.riskFactors.length
      ? project.riskFactors.map(
          (f) => `  - [${f.severity}] ${f.name} (+${f.points} pts): ${f.explanation}`
        )
      : ["  - No significant risk factors detected."]),
    "",
    "DETECTED ANOMALIES",
    "-----------------------------------------------------------",
    ...(anomalies.length
      ? anomalies.map((a) => `  - [${a.severity}] ${a.type}: ${a.message}`)
      : ["  - No anomalies detected."]),
    "",
    "AI EXPLANATION",
    "-----------------------------------------------------------",
    `  ${project.riskExplanation}`,
    "",
    "RECOMMENDED ACTION",
    "-----------------------------------------------------------",
    `  ${recommendation}`,
    "",
    "This is an AI-assisted / rule-based prototype analysis, not a trained",
    "ML model, and not a substitute for official audit or verification.",
    "",
    "===========================================================",
    " End of Report — MPLADS AI Monitoring & Analytics Platform",
    "===========================================================",
  ].join("\n");
}

/** Dynamic, dataset-derived executive summary stats + key findings. */
export function buildExecutiveSummaryData(projects) {
  const total = projects.length;
  const totalSanctioned = projects.reduce((s, p) => s + (Number(p.sanctionedAmount) || 0), 0);
  const totalExpenditure = projects.reduce((s, p) => s + (Number(p.expenditure) || 0), 0);
  const avgPhysical =
    total === 0 ? 0 : Math.round(projects.reduce((s, p) => s + (Number(p.physicalProgress) || 0), 0) / total);

  const critical = projects.filter((p) => p.riskLevel === "Critical").length;
  const high = projects.filter((p) => p.riskLevel === "High").length;
  const atRisk = critical + high;
  const delayed = projects.filter((p) => p.status === "Delayed").length;
  const mismatches = projects.filter((p) => (p.financialProgress || 0) - (p.physicalProgress || 0) >= 15).length;
  const overruns = projects.filter((p) => (Number(p.expenditure) || 0) > (Number(p.sanctionedAmount) || 0)).length;
  const duplicates = projects.filter((p) =>
    (p.riskFactors || []).some((f) => f.name === "Duplicate/Similar Work Indicator")
  ).length;
  const activeAlerts = detectAllAnomalies(projects).length;

  const findings = [];
  if (total > 0) {
    findings.push(`${total} project${total === 1 ? "" : "s"} ${total === 1 ? "is" : "are"} currently being monitored.`);
  } else {
    findings.push("No project data available.");
  }
  if (atRisk > 0) {
    findings.push(`${atRisk} project(s) are currently classified as High or Critical risk.`);
  }
  if (mismatches > 0) {
    findings.push(`${mismatches} project(s) show significant financial-physical mismatch.`);
  }
  if (delayed > 0) {
    findings.push(`${delayed} project(s) are delayed past their expected completion date.`);
  }
  if (overruns > 0) {
    findings.push(`${overruns} project(s) exceed their sanctioned expenditure.`);
  }
  if (duplicates > 0) {
    findings.push(`${duplicates} project(s) are flagged with potential duplicate/similar work.`);
  }
  if (total > 0 && findings.length === 1) {
    findings.push("No significant risk indicators were detected across the current dataset.");
  }

  return {
    stats: {
      total,
      totalSanctioned,
      totalExpenditure,
      avgPhysical,
      atRisk,
      critical,
      delayed,
      mismatches,
      overruns,
      duplicates,
      activeAlerts,
    },
    findings,
  };
}

export function buildExecutiveSummaryText(projects) {
  const { stats, findings } = buildExecutiveSummaryData(projects);
  return [
    "===========================================================",
    " MPLADS AI MONITORING — EXECUTIVE SUMMARY",
    "===========================================================",
    `Generated: ${new Date().toLocaleString("en-IN")}`,
    "",
    "OVERVIEW",
    "-----------------------------------------------------------",
    `Total Projects:              ${stats.total}`,
    `Total Sanctioned Funds:      ${formatCurrency(stats.totalSanctioned)}`,
    `Total Expenditure:           ${formatCurrency(stats.totalExpenditure)}`,
    `Average Physical Progress:   ${stats.avgPhysical}%`,
    `Projects At Risk (High/Crit):${stats.atRisk}`,
    `Critical Projects:           ${stats.critical}`,
    `Delayed Projects:            ${stats.delayed}`,
    `Financial Mismatch Cases:    ${stats.mismatches}`,
    `Cost Overrun Cases:          ${stats.overruns}`,
    `Duplicate Cases:             ${stats.duplicates}`,
    `Active Alerts:               ${stats.activeAlerts}`,
    "",
    "KEY FINDINGS",
    "-----------------------------------------------------------",
    ...findings.map((f) => `  - ${f}`),
    "",
    "This is an AI-assisted / rule-based prototype analysis, not a trained",
    "ML model, and not a substitute for official audit or verification.",
    "",
    "===========================================================",
    " End of Report — MPLADS AI Monitoring & Analytics Platform",
    "===========================================================",
  ].join("\n");
}

/** Financial Utilization Report — one line per project plus dataset totals. */
export function buildFinancialUtilizationReportText(projects) {
  const totalSanctioned = projects.reduce((s, p) => s + (Number(p.sanctionedAmount) || 0), 0);
  const totalExpenditure = projects.reduce((s, p) => s + (Number(p.expenditure) || 0), 0);
  const utilization = totalSanctioned > 0 ? Math.round((totalExpenditure / totalSanctioned) * 100) : 0;

  return [
    "===========================================================",
    " MPLADS AI MONITORING — FINANCIAL UTILIZATION REPORT",
    "===========================================================",
    `Generated: ${new Date().toLocaleString("en-IN")}`,
    "",
    `Total Sanctioned:  ${formatCurrency(totalSanctioned)}`,
    `Total Expenditure: ${formatCurrency(totalExpenditure)}`,
    `Overall Utilization: ${utilization}%`,
    "",
    "PROJECT-WISE UTILIZATION",
    "-----------------------------------------------------------",
    ...projects.map(
      (p) =>
        `  ${p.id}  ${p.workName.slice(0, 42).padEnd(42)}  Sanctioned ${formatCurrency(
          p.sanctionedAmount
        )}  Spent ${formatCurrency(p.expenditure)}  (${p.financialProgress}%)`
    ),
    "",
    "===========================================================",
  ].join("\n");
}

/** Delayed Projects Report. */
export function buildDelayedProjectsReportText(projects) {
  const delayed = projects.filter((p) => p.status === "Delayed");
  return [
    "===========================================================",
    " MPLADS AI MONITORING — DELAYED PROJECTS REPORT",
    "===========================================================",
    `Generated: ${new Date().toLocaleString("en-IN")}`,
    `Delayed Projects: ${delayed.length} of ${projects.length}`,
    "",
    ...(delayed.length
      ? delayed.map(
          (p) =>
            `  - [${p.riskLevel}] ${p.id} — ${p.workName} (${p.district}, ${p.state}). Expected completion: ${formatDate(
              p.expectedCompletion
            )}.`
        )
      : ["  No delayed projects in the current dataset."]),
    "",
    "===========================================================",
  ].join("\n");
}

/** Anomaly Report — every detected anomaly across the dataset. */
export function buildAnomalyReportText(projects) {
  const anomalies = detectAllAnomalies(projects);
  return [
    "===========================================================",
    " MPLADS AI MONITORING — ANOMALY REPORT",
    "===========================================================",
    `Generated: ${new Date().toLocaleString("en-IN")}`,
    `Total Anomalies Detected: ${anomalies.length}`,
    "",
    ...(anomalies.length
      ? anomalies.map((a) => `  - [${a.severity}] ${a.type} — ${a.projectId}: ${a.message}`)
      : ["  No anomalies detected in the current dataset."]),
    "",
    "This is an AI-assisted / rule-based prototype analysis.",
    "===========================================================",
  ].join("\n");
}

/** Project Risk Report — every project, sorted by risk score descending. */
export function buildProjectRiskReportText(projects) {
  const sorted = [...projects].sort((a, b) => b.riskScore - a.riskScore);
  return [
    "===========================================================",
    " MPLADS AI MONITORING — PROJECT RISK REPORT",
    "===========================================================",
    `Generated: ${new Date().toLocaleString("en-IN")}`,
    `Total Projects Assessed: ${projects.length}`,
    "",
    ...sorted.map(
      (p) => `  ${p.riskScore.toString().padStart(3)} [${p.riskLevel.padEnd(8)}] ${p.id}  ${p.workName}`
    ),
    "",
    "===========================================================",
  ].join("\n");
}

export const REPORT_TYPES = [
  { id: "risk", label: "Project Risk Report" },
  { id: "financial", label: "Financial Utilization Report" },
  { id: "delayed", label: "Delayed Projects Report" },
  { id: "anomaly", label: "Anomaly Report" },
  { id: "executive", label: "Executive Summary" },
];

/** Dispatches to the right aggregate-report builder by report type id. */
export function buildAggregateReportText(typeId, projects) {
  switch (typeId) {
    case "risk":
      return buildProjectRiskReportText(projects);
    case "financial":
      return buildFinancialUtilizationReportText(projects);
    case "delayed":
      return buildDelayedProjectsReportText(projects);
    case "anomaly":
      return buildAnomalyReportText(projects);
    case "executive":
      return buildExecutiveSummaryText(projects);
    default:
      return "";
  }
}
