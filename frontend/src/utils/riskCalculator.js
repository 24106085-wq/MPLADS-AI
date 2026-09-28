// src/utils/riskCalculator.js
// Deterministic, explainable, weighted risk-scoring model for MPLADS projects.
// No ML model — transparent rule-based scoring so every point is explainable.

import { calcFinancialProgress, isOverdue, daysOverdue } from "./projectUtils";

// Maximum points each factor can contribute. Sums to 100.
const WEIGHTS = {
  MISMATCH: 25,
  OVERRUN: 20,
  DELAY: 15,
  LOW_PROGRESS: 10,
  HIGH_UTILIZATION: 10,
  PAYMENT_ANOMALY: 10,
  DUPLICATE_WORK: 10,
};

export const RISK_LEVELS = [
  { level: "Low", min: 0, max: 19, color: "#1F9254" },
  { level: "Moderate", min: 20, max: 39, color: "#2A7FB8" },
  { level: "Medium", min: 40, max: 59, color: "#C98A1A" },
  { level: "High", min: 60, max: 79, color: "#D9711C" },
  { level: "Critical", min: 80, max: 100, color: "#C23B3B" },
];

export function getRiskLevel(score) {
  const found = RISK_LEVELS.find((r) => score >= r.min && score <= r.max);
  return found ? found.level : "Low";
}

export function getRiskColor(levelOrScore) {
  const level =
    typeof levelOrScore === "number" ? getRiskLevel(levelOrScore) : levelOrScore;
  const found = RISK_LEVELS.find((r) => r.level === level);
  return found ? found.color : "#1F9254";
}

/**
 * Rule-based recommended action for a given risk level.
 * Deterministic and explainable — no ML model involved.
 */
export function getRecommendedAction(level) {
  switch (level) {
    case "Critical":
      return "Immediate verification recommended. Review payment records, work measurements and implementing agency documentation.";
    case "High":
      return "Priority review recommended within the next monitoring cycle.";
    case "Medium":
      return "Continue monitoring and verify supporting project records.";
    case "Moderate":
      return "Periodic monitoring recommended. No urgent action required at this time.";
    case "Low":
    default:
      return "No immediate intervention required.";
  }
}

function severityFromPoints(points, maxPoints) {
  const ratio = points / maxPoints;
  if (ratio >= 0.8) return "Critical";
  if (ratio >= 0.6) return "High";
  if (ratio >= 0.3) return "Medium";
  return "Low";
}

/**
 * Detects whether a project shares a near-duplicate work name + location
 * with another project in the dataset — a common red flag for split-billing
 * or duplicate fund claims.
 */
function findSimilarWork(project, allProjects) {
  if (!allProjects || allProjects.length < 2) return null;

  const normalize = (s) =>
    (s || "")
      .toLowerCase()
      .replace(/[^a-z0-9 ]/g, "")
      .replace(/\s+/g, " ")
      .trim();

  const words = (s) => new Set(normalize(s).split(" ").filter((w) => w.length > 3));
  const projectWords = words(project.workName);

  for (const other of allProjects) {
    if (other.id === project.id) continue;
    if (other.district !== project.district || other.state !== project.state) continue;

    const otherWords = words(other.workName);
    if (projectWords.size === 0 || otherWords.size === 0) continue;

    const intersection = [...projectWords].filter((w) => otherWords.has(w));
    const overlapRatio =
      intersection.length / Math.min(projectWords.size, otherWords.size);

    if (overlapRatio >= 0.6) {
      return other;
    }
  }
  return null;
}

/**
 * Core deterministic risk calculator.
 * @param {Object} project - the project record
 * @param {Array} allProjects - full dataset, used for duplicate-work detection
 * @returns {{score:number, level:string, factors:Array, explanation:string}}
 */
export function calculateRisk(project, allProjects = []) {
  const factors = [];
  let total = 0;

  const sanctioned = Number(project.sanctionedAmount) || 0;
  const spent = Number(project.expenditure) || 0;
  const physical = Number(project.physicalProgress) || 0;
  const financial = calcFinancialProgress(spent, sanctioned);

  // A. Financial vs Physical mismatch
  const gap = financial - physical;
  if (gap >= 15) {
    const ratio = Math.min(gap / 60, 1); // saturate around a 60pt gap
    const points = Math.round(ratio * WEIGHTS.MISMATCH);
    if (points > 0) {
      total += points;
      factors.push({
        name: "Financial-Physical Mismatch",
        points,
        severity: severityFromPoints(points, WEIGHTS.MISMATCH),
        explanation: `${financial}% of sanctioned funds have been utilized while physical progress is only ${physical}%.`,
      });
    }
  }

  // B. Cost overrun
  if (spent > sanctioned && sanctioned > 0) {
    const overrunPct = ((spent - sanctioned) / sanctioned) * 100;
    const ratio = Math.min(overrunPct / 40, 1); // saturate at 40% overrun
    const points = Math.round(Math.max(ratio, 0.35) * WEIGHTS.OVERRUN);
    total += points;
    factors.push({
      name: "Cost Overrun",
      points,
      severity: severityFromPoints(points, WEIGHTS.OVERRUN),
      explanation: `Expenditure has exceeded the sanctioned amount by ${overrunPct.toFixed(
        1
      )}% (₹${(spent - sanctioned).toLocaleString("en-IN")} over budget).`,
    });
  }

  // C. Project delay
  if (isOverdue(project)) {
    const overdueDays = daysOverdue(project);
    const ratio = Math.min(overdueDays / 180, 1); // saturate at ~6 months late
    const points = Math.round(Math.max(ratio, 0.3) * WEIGHTS.DELAY);
    total += points;
    factors.push({
      name: "Implementation Delay",
      points,
      severity: severityFromPoints(points, WEIGHTS.DELAY),
      explanation: `Project is ${overdueDays} day(s) past its expected completion date and is not marked Completed.`,
    });
  }

  // D. Very low physical progress (independent of mismatch, flags stalled works)
  if (physical < 20 && project.status !== "Completed") {
    const ratio = (20 - physical) / 20;
    const points = Math.round(ratio * WEIGHTS.LOW_PROGRESS);
    if (points > 0) {
      total += points;
      factors.push({
        name: "Very Low Physical Progress",
        points,
        severity: severityFromPoints(points, WEIGHTS.LOW_PROGRESS),
        explanation: `Physical progress stands at only ${physical}%, indicating a stalled or barely-started work.`,
      });
    }
  }

  // E. High expenditure utilization (funds nearly exhausted regardless of completion)
  if (financial >= 85 && project.status !== "Completed") {
    const ratio = Math.min((financial - 85) / 15 + 0.4, 1);
    const points = Math.round(ratio * WEIGHTS.HIGH_UTILIZATION);
    total += points;
    factors.push({
      name: "High Expenditure Utilization",
      points,
      severity: severityFromPoints(points, WEIGHTS.HIGH_UTILIZATION),
      explanation: `${financial}% of sanctioned funds are already utilized while the work remains incomplete.`,
    });
  }

  // F. Suspicious payment pattern (proxy: unusually high payment count vs work size)
  const paymentCount = Number(project.paymentCount) || 0;
  const expectedMaxPayments = sanctioned > 0 ? Math.max(3, Math.ceil(sanctioned / 500000)) : 3;
  if (paymentCount > expectedMaxPayments + 3) {
    const excess = paymentCount - expectedMaxPayments;
    const ratio = Math.min(excess / 10, 1);
    const points = Math.round(Math.max(ratio, 0.3) * WEIGHTS.PAYMENT_ANOMALY);
    total += points;
    factors.push({
      name: "Suspicious Payment Pattern",
      points,
      severity: severityFromPoints(points, WEIGHTS.PAYMENT_ANOMALY),
      explanation: `${paymentCount} separate payment transactions were recorded — unusually fragmented for a work of this value.`,
    });
  }

  // G. Duplicate / similar work indicator
  const similar = findSimilarWork(project, allProjects);
  if (similar) {
    total += WEIGHTS.DUPLICATE_WORK;
    factors.push({
      name: "Duplicate/Similar Work Indicator",
      points: WEIGHTS.DUPLICATE_WORK,
      severity: "High",
      explanation: `A similarly named work ("${similar.workName}") exists in the same district (${similar.id}), suggesting possible duplicate fund claims.`,
    });
  }

  const score = Math.min(Math.round(total), 100);
  const level = getRiskLevel(score);

  const explanation =
    factors.length === 0
      ? "No significant risk indicators detected. Project is progressing within normal parameters."
      : `Risk driven primarily by: ${factors
          .slice()
          .sort((a, b) => b.points - a.points)
          .slice(0, 2)
          .map((f) => f.name.toLowerCase())
          .join(" and ")}.`;

  return { score, level, factors, explanation };
}

export default calculateRisk;
