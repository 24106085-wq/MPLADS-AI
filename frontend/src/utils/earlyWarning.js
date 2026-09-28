// src/utils/earlyWarning.js
// Milestone 4, Part A — Early Warning Engine (client-side mirror).
//
// This is a direct JS mirror of backend/early_warning.py, kept in sync the
// same way riskCalculator.js/complianceChecker.js/anomalyDetector.js already
// mirror their backend counterparts. It lets the UI show an early warning
// verdict immediately from local data, with or without the FastAPI backend
// online, matching this app's existing "client is the source of truth"
// pattern (see App.jsx's enrichProjects()).
//
// It is a combination layer only — it does not compute any new underlying
// signal, it just reads risk / compliance / duplicate results that already
// exist on the client (calculateRisk, checkCompliance, findDuplicateMatches)
// and combines them into one early_warning_level + reasons + recommended
// action. The backend's richer version (see backend/monitoring.py) also
// folds in ML anomaly detection and predictive delay/cost-overrun
// probabilities, which only exist server-side.
//
// IMPORTANT: an early warning means "requires attention" / "potential risk
// indicator". It is NEVER a declaration of confirmed fraud.

import { isOverdue, daysOverdue, calcFinancialProgress } from "./projectUtils";
import { checkCompliance } from "./complianceChecker";
import { findDuplicateMatches } from "./anomalyDetector";

export const EARLY_WARNING_LEVELS = ["GREEN", "YELLOW", "ORANGE", "RED"];
const ORDER = { GREEN: 0, YELLOW: 1, ORANGE: 2, RED: 3 };

export const EARLY_WARNING_COLORS = {
  RED: "#DC2626",
  ORANGE: "#EA580C",
  YELLOW: "#CA8A04",
  GREEN: "#16A34A",
};

const RECOMMENDED_ACTIONS = {
  RED: "Immediate attention required — escalate for verification and detailed review before further disbursement. This is a risk indicator, not a confirmed finding.",
  ORANGE: "Priority review recommended during the current monitoring cycle.",
  YELLOW: "Monitor closely and verify supporting records at the next review.",
  GREEN: "No immediate action required. Continue routine monitoring.",
};

function bump(current, candidate) {
  return ORDER[candidate] > ORDER[current] ? candidate : current;
}

/**
 * Computes the early warning verdict for a single project using only
 * client-side signals (risk score/level from calculateRisk, compliance
 * status from checkCompliance, duplicate matches from findDuplicateMatches).
 * `project` is expected to already carry riskScore/riskLevel/financialProgress
 * (see App.jsx's enrichProjects()).
 */
export function computeEarlyWarning(project, allProjects = []) {
  const reasons = [];
  let level = "GREEN";

  const riskLevel = project.riskLevel || "Low";
  const riskScore = project.riskScore || 0;
  const overdue = isOverdue(project);
  const overdueDays = daysOverdue(project);
  const financial =
    project.financialProgress ?? calcFinancialProgress(project.expenditure, project.sanctionedAmount);
  const physical = Number(project.physicalProgress) || 0;
  const gap = financial - physical;

  const compliance = checkCompliance(project);
  const duplicateMatches = findDuplicateMatches(project, allProjects);
  const possibleDuplicate = duplicateMatches.length > 0 || Boolean(project.duplicateFlag);

  // --- RED ---
  if (riskLevel === "Critical") {
    level = bump(level, "RED");
    reasons.push(`Critical composite risk score (${riskScore}/100).`);
  }
  if (gap >= 45) {
    level = bump(level, "RED");
    reasons.push(`Severe financial-physical progress mismatch (${Math.round(gap)} point gap).`);
  }
  if (compliance.compliance_status === "NON_COMPLIANT") {
    level = bump(level, "RED");
    reasons.push("Serious compliance violations detected — multiple checks failed.");
  }
  if (overdue && overdueDays > 180) {
    level = bump(level, "RED");
    reasons.push(`Severely overdue by ${overdueDays} day(s).`);
  }

  // --- ORANGE ---
  if (riskLevel === "High") {
    level = bump(level, "ORANGE");
    reasons.push(`High composite risk score (${riskScore}/100).`);
  }
  if (possibleDuplicate) {
    level = bump(level, "ORANGE");
    reasons.push("Potential duplicate/similar work detected.");
  }
  if (compliance.compliance_status === "REQUIRES_REVIEW") {
    level = bump(level, "ORANGE");
    reasons.push("Compliance review required — multiple checks failed.");
  }
  if (gap >= 25 && gap < 45) {
    level = bump(level, "ORANGE");
    reasons.push(`Significant financial-physical progress mismatch (${Math.round(gap)} points).`);
  }
  if (overdue && overdueDays > 90 && overdueDays <= 180) {
    level = bump(level, "ORANGE");
    reasons.push(`Significantly overdue (${overdueDays} day(s)).`);
  }

  // --- YELLOW ---
  if (riskLevel === "Medium") {
    level = bump(level, "YELLOW");
    reasons.push(`Moderate composite risk score (${riskScore}/100).`);
  }
  if (compliance.compliance_status === "WARNING") {
    level = bump(level, "YELLOW");
    reasons.push("Minor compliance concerns flagged.");
  }
  if (gap >= 15 && gap < 25) {
    level = bump(level, "YELLOW");
    reasons.push(`Moderate financial-physical progress mismatch (${Math.round(gap)} points).`);
  }
  if (overdue && overdueDays > 0 && overdueDays <= 90) {
    level = bump(level, "YELLOW");
    reasons.push(`Approaching or past deadline (${overdueDays} day(s) overdue).`);
  }

  if (reasons.length === 0) {
    reasons.push("No significant warning indicators detected across risk, compliance and duplicate signals.");
  }

  return {
    early_warning_level: level,
    early_warning_reasons: reasons,
    recommended_action: RECOMMENDED_ACTIONS[level],
  };
}

/** Bulk variant — early warning verdict for every project in the list. */
export function computeAllEarlyWarnings(allProjects) {
  return allProjects.map((p) => ({ projectId: p.id, ...computeEarlyWarning(p, allProjects) }));
}

export default computeEarlyWarning;
