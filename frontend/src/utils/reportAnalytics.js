// src/utils/reportAnalytics.js
//
// Derived, chart-ready data for the Reports/Analytics page.
//
// SOURCE OF TRUTH: every project handed to these functions has already
// been risk-enriched by the FastAPI backend (see App.jsx / backend
// risk_engine.enrich_project) — riskScore, riskLevel, riskFactors and
// financialProgress all come straight from the backend response. Nothing
// in this file recalculates risk or invents a project field; it only
// aggregates/buckets values that are already on the record.

import { getRiskColor } from "./riskCalculator";

export const RISK_LEVELS_ORDER = ["Critical", "High", "Medium", "Moderate", "Low"];

// A small, stable palette for chart categories that don't have a fixed
// semantic color (e.g. arbitrary/imported status strings).
const STATUS_PALETTE = ["#2E5C8A", "#1F9254", "#C9A227", "#A62A22", "#6B5B95", "#3E7C8A", "#8A5A3E"];

/** Risk Distribution — counts per backend-provided riskLevel. */
export function buildRiskDistribution(projects) {
  const counts = { Critical: 0, High: 0, Medium: 0, Moderate: 0, Low: 0 };
  projects.forEach((p) => {
    if (counts[p.riskLevel] !== undefined) counts[p.riskLevel] += 1;
  });
  return RISK_LEVELS_ORDER.map((level) => ({
    label: level,
    value: counts[level],
    color: getRiskColor(level),
  }));
}

/** Project Status — counts per each distinct status value actually present in the imported data. */
export function buildStatusDistribution(projects) {
  const counts = {};
  projects.forEach((p) => {
    const status = p.status && String(p.status).trim() ? String(p.status).trim() : "Unspecified";
    counts[status] = (counts[status] || 0) + 1;
  });
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .map(([label, value], i) => ({ label, value, color: STATUS_PALETTE[i % STATUS_PALETTE.length] }));
}

/**
 * Delay classification for a single project, using only real date fields
 * on the record:
 *   - "On Track"  — status is Completed, OR expectedCompletion exists and
 *                    hasn't passed yet.
 *   - "Delayed"    — expectedCompletion exists, is a valid date, and has
 *                    passed, and the project isn't marked Completed.
 *   - "Unknown"    — no valid expectedCompletion on file. Never guessed as
 *                    Delayed or On Track.
 */
export function classifyDelay(project) {
  if (project.status === "Completed") return "On Track";
  const raw = project.expectedCompletion;
  if (!raw) return "Unknown";
  const due = new Date(raw);
  if (Number.isNaN(due.getTime())) return "Unknown";
  return due.getTime() < Date.now() ? "Delayed" : "On Track";
}

const DELAY_COLORS = { Delayed: "var(--red)", "On Track": "var(--green)", Unknown: "var(--text-500)" };

/** Delay Analysis — Delayed / On Track / Unknown, dataset-derived only. */
export function buildDelayDistribution(projects) {
  const counts = { Delayed: 0, "On Track": 0, Unknown: 0 };
  projects.forEach((p) => {
    counts[classifyDelay(p)] += 1;
  });
  return ["Delayed", "On Track", "Unknown"].map((label) => ({
    label,
    value: counts[label],
    color: DELAY_COLORS[label],
  }));
}

/** Financial Analysis — Sanctioned vs Expenditure, top N projects by sanctioned amount. */
export function buildFinancialComparison(projects, limit = 8) {
  return [...projects]
    .filter((p) => Number(p.sanctionedAmount) > 0)
    .sort((a, b) => (Number(b.sanctionedAmount) || 0) - (Number(a.sanctionedAmount) || 0))
    .slice(0, limit)
    .map((p) => ({
      id: p.id,
      label: p.workName || p.id,
      sanctioned: Number(p.sanctionedAmount) || 0,
      expenditure: Number(p.expenditure) || 0,
    }));
}

/**
 * Physical vs Financial scatter points — only for projects that actually
 * have both a real sanctioned amount (so financial utilization is
 * meaningful) and a numeric physical progress on file. Everything else is
 * left out rather than plotted at a guessed 0.
 */
export function buildPhysicalVsFinancial(projects) {
  return projects
    .filter((p) => {
      const physical = Number(p.physicalProgress);
      const sanctioned = Number(p.sanctionedAmount);
      return !Number.isNaN(physical) && sanctioned > 0;
    })
    .map((p) => ({
      id: p.id,
      label: p.workName || p.id,
      physical: Number(p.physicalProgress) || 0,
      financial: Number(p.financialProgress) || 0,
      riskLevel: p.riskLevel,
    }));
}
