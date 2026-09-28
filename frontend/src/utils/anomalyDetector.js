// src/utils/anomalyDetector.js
// Rule-based anomaly detection over the MPLADS dataset.
// Complements riskCalculator.js by surfacing individual flagged conditions
// as discrete, structured anomaly records (used in Alerts page & Project modal).

import { calcFinancialProgress, isOverdue, daysOverdue } from "./projectUtils";

/**
 * @typedef Anomaly
 * @property {string} type
 * @property {string} severity - Low | Medium | High | Critical
 * @property {string} message
 */

/** Detects all anomalies for a single project (does not need the full dataset). */
export function detectProjectAnomalies(project) {
  const anomalies = [];
  const sanctioned = Number(project.sanctionedAmount) || 0;
  const spent = Number(project.expenditure) || 0;
  const physical = Number(project.physicalProgress) || 0;
  const financial = calcFinancialProgress(spent, sanctioned);

  // Expenditure exceeds sanctioned amount
  if (spent > sanctioned) {
    anomalies.push({
      type: "Cost Overrun",
      severity: spent > sanctioned * 1.2 ? "Critical" : "High",
      message: `Expenditure (₹${spent.toLocaleString("en-IN")}) exceeds sanctioned amount (₹${sanctioned.toLocaleString(
        "en-IN"
      )}).`,
    });
  }

  // Financial progress significantly higher than physical progress
  const gap = financial - physical;
  if (gap >= 25) {
    anomalies.push({
      type: "Financial-Physical Mismatch",
      severity: gap >= 45 ? "Critical" : "High",
      message: `Financial progress (${financial}%) is ${gap.toFixed(
        0
      )} points ahead of physical progress (${physical}%).`,
    });
  }

  // Unusual payment frequency
  const paymentCount = Number(project.paymentCount) || 0;
  const expectedMaxPayments = sanctioned > 0 ? Math.max(3, Math.ceil(sanctioned / 500000)) : 3;
  if (paymentCount > expectedMaxPayments + 3) {
    anomalies.push({
      type: "Unusual Payment Frequency",
      severity: paymentCount > expectedMaxPayments + 7 ? "Critical" : "Medium",
      message: `${paymentCount} payment transactions recorded, above the ${expectedMaxPayments} expected for a work of this value.`,
    });
  }

  // Delayed project
  if (isOverdue(project)) {
    const days = daysOverdue(project);
    anomalies.push({
      type: "Delayed Project",
      severity: days > 120 ? "Critical" : days > 45 ? "High" : "Medium",
      message: `Project is ${days} day(s) past its expected completion date.`,
    });
  }

  // Unusually low physical progress
  if (physical < 15 && project.status !== "Completed") {
    anomalies.push({
      type: "Stalled Physical Progress",
      severity: physical === 0 ? "Critical" : "Medium",
      message: `Physical progress is only ${physical}% — work may be stalled or not yet started.`,
    });
  }

  // Explicit duplicate flag carried on the record itself (e.g. seeded sample data)
  if (project.duplicateFlag) {
    anomalies.push({
      type: "Duplicate Work Flag",
      severity: "High",
      message: `This work has been flagged as potentially duplicating another sanctioned work.`,
    });
  }

  return anomalies;
}

/**
 * Finds candidate duplicate/similar works for a single project, with a simple
 * prototype similarity score (0-100) and the fields that matched.
 * This is an AI-assisted heuristic for demo purposes, not production-grade
 * fraud/duplicate detection.
 */
export function findDuplicateMatches(project, allProjects = []) {
  const normalize = (s) =>
    (s || "")
      .toLowerCase()
      .replace(/[^a-z0-9 ]/g, "")
      .replace(/\s+/g, " ")
      .trim();
  const words = (s) => new Set(normalize(s).split(" ").filter((w) => w.length > 3));

  const projectWords = words(project.workName);
  const matches = [];

  allProjects.forEach((other) => {
    if (!other || other.id === project.id) return;
    if (other.district !== project.district || other.state !== project.state) return;

    const otherWords = words(other.workName);
    if (projectWords.size === 0 || otherWords.size === 0) return;

    const intersection = [...projectWords].filter((w) => otherWords.has(w));
    const overlapRatio = intersection.length / Math.min(projectWords.size, otherWords.size);
    if (overlapRatio < 0.4) return;

    const matchedFields = ["Work Name", "District"];
    if (project.category && other.category === project.category) {
      matchedFields.push("Category");
    }

    const sanctioned = Number(project.sanctionedAmount) || 0;
    const otherSanctioned = Number(other.sanctionedAmount) || 0;
    let amountBonus = 0;
    if (sanctioned > 0 && otherSanctioned > 0) {
      const diffRatio = Math.abs(sanctioned - otherSanctioned) / Math.max(sanctioned, otherSanctioned);
      if (diffRatio <= 0.15) {
        matchedFields.push("Sanctioned Amount");
        amountBonus = 5;
      }
    }

    const similarity = Math.min(100, Math.round(overlapRatio * 90 + amountBonus));
    matches.push({ project: other, similarity, matchedFields });
  });

  return matches.sort((a, b) => b.similarity - a.similarity);
}

/** Cross-project duplicate/similar work detection across the full dataset. */
export function detectDuplicateWorks(allProjects) {
  const normalize = (s) =>
    (s || "")
      .toLowerCase()
      .replace(/[^a-z0-9 ]/g, "")
      .replace(/\s+/g, " ")
      .trim();
  const words = (s) => new Set(normalize(s).split(" ").filter((w) => w.length > 3));

  const pairs = [];
  const seen = new Set();

  for (let i = 0; i < allProjects.length; i++) {
    for (let j = i + 1; j < allProjects.length; j++) {
      const a = allProjects[i];
      const b = allProjects[j];
      if (a.district !== b.district || a.state !== b.state) continue;

      const wa = words(a.workName);
      const wb = words(b.workName);
      if (wa.size === 0 || wb.size === 0) continue;

      const intersection = [...wa].filter((w) => wb.has(w));
      const overlapRatio = intersection.length / Math.min(wa.size, wb.size);

      const pairKey = [a.id, b.id].sort().join("::");
      if (overlapRatio >= 0.6 && !seen.has(pairKey)) {
        seen.add(pairKey);
        pairs.push({
          type: "Duplicate/Similar Work",
          severity: "High",
          message: `"${a.workName}" (${a.id}) and "${b.workName}" (${b.id}) in ${a.district}, ${a.state} appear to be similar or duplicate works.`,
          projectIds: [a.id, b.id],
        });
      }
    }
  }
  return pairs;
}

/** Runs full anomaly detection across the dataset and returns a flat list, project-tagged. */
export function detectAllAnomalies(allProjects) {
  const results = [];
  allProjects.forEach((project) => {
    const projectAnomalies = detectProjectAnomalies(project);
    projectAnomalies.forEach((a) =>
      results.push({ ...a, projectId: project.id, workName: project.workName })
    );
  });

  const duplicates = detectDuplicateWorks(allProjects);
  duplicates.forEach((d) =>
    results.push({ ...d, projectId: d.projectIds[0], workName: "" })
  );

  return results;
}

export default detectAllAnomalies;
