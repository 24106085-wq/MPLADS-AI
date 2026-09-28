// src/utils/complianceChecker.js
// Deterministic, explainable, rule-based Compliance Engine — Milestone 1.
//
// This is a direct JS mirror of backend/compliance_engine.py, kept in sync
// the same way riskCalculator.js/anomalyDetector.js already mirror
// backend/risk_engine.py. It lets the UI show compliance results
// immediately from local data, with or without the FastAPI backend online,
// matching this app's existing "client is the source of truth" pattern
// (see App.jsx's enrichProjects()).
//
// IMPORTANT: this is intentionally SEPARATE from riskCalculator.js /
// anomalyDetector.js. Compliance checks whether a project satisfies basic
// MPLADS record-keeping/consistency rules; it does not affect, and is not
// affected by, the existing risk score.
//
// See backend/compliance_engine.py's module docstring for the documented
// data limitations (no distinct actual-completion-date field, no
// approved-exception flag for sanctioned-amount overruns, etc).

// ---------------------------------------------------------------------------
// CONFIG — every tunable threshold/weight lives here.
// ---------------------------------------------------------------------------

export const COMPLIANCE_CONFIG = {
  REQUIRED_FIELDS: [
    "id",
    "workName",
    "state",
    "district",
    "implementingAgency",
    "sanctionedAmount",
    "expenditure",
    "status",
  ],
  WEIGHTS: {
    MISSING_REQUIRED_FIELDS: 8,
    MISSING_REQUIRED_FIELDS_CAP: 24,
    INVALID_NUMERIC_VALUES: 10,
    INVALID_NUMERIC_VALUES_CAP: 20,
    INVALID_PERCENTAGE: 10,
    EXPENDITURE_EXCEEDS_SANCTIONED: 20,
    HIGH_UTILIZATION_WARNING: 8,
    PROGRESS_MISMATCH: 15,
    INVALID_TIMELINE: 15,
    PROJECT_OVERDUE: 12,
    COMPLETED_LOW_PHYSICAL_PROGRESS: 20,
    COMPLETED_FINANCIAL_INCONSISTENT: 15,
    ACTIVE_SEVERELY_OVERDUE: 15,
  },
  HIGH_UTILIZATION_PCT: 95,
  PROGRESS_MISMATCH_PCT_POINTS: 20,
  COMPLETED_MIN_PHYSICAL_PROGRESS: 90,
  COMPLETED_MIN_FINANCIAL_UTILIZATION: 85,
  SEVERELY_OVERDUE_DAYS: 180,
  STATUS_BANDS: [
    { status: "COMPLIANT", min: 90 },
    { status: "WARNING", min: 75 },
    { status: "REQUIRES_REVIEW", min: 50 },
    { status: "NON_COMPLIANT", min: 0 },
  ],
};

const RECOMMENDED_ACTIONS = {
  NON_COMPLIANT:
    "Escalate for detailed audit. Multiple compliance rules failed — verify records with the implementing agency before further disbursement.",
  REQUIRES_REVIEW:
    "Review project progress and expenditure records; resolve flagged inconsistencies before the next monitoring cycle.",
  WARNING: "Monitor closely and confirm supporting documentation for the flagged item(s).",
  COMPLIANT: "No action required. Continue routine monitoring.",
};

export const COMPLIANCE_STATUS_COLORS = {
  COMPLIANT: "#1F9254",
  WARNING: "#C98A1A",
  REQUIRES_REVIEW: "#D9711C",
  NON_COMPLIANT: "#C23B3B",
};

// ---------------------------------------------------------------------------
// Small local helpers (deliberately independent of projectUtils.js /
// riskCalculator.js, mirroring compliance_engine.py's independence from
// risk_engine.py).
// ---------------------------------------------------------------------------

function isNumber(value) {
  if (value === null || value === undefined || typeof value === "boolean") return false;
  const n = Number(value);
  return !Number.isNaN(n);
}

function toFloat(value, fallback = 0) {
  return isNumber(value) ? Number(value) : fallback;
}

function isBlank(value) {
  if (value === null || value === undefined) return true;
  if (typeof value === "number" && Number.isNaN(value)) return true;
  if (typeof value === "string" && value.trim() === "") return true;
  return false;
}

function parseDate(value) {
  if (isBlank(value)) return null;
  const d = new Date(String(value).slice(0, 10));
  return Number.isNaN(d.getTime()) ? null : d;
}

function daysBetween(a, b) {
  return Math.round((a.getTime() - b.getTime()) / (1000 * 60 * 60 * 24));
}

function financialProgress(expenditure, sanctionedAmount) {
  const sanctioned = toFloat(sanctionedAmount);
  const spent = toFloat(expenditure);
  if (sanctioned <= 0) return 0;
  return Math.round((spent / sanctioned) * 1000) / 10;
}

function isOverrunAllowed(project) {
  // Hook for a future approved-exception flag; no such field exists today.
  return Boolean(project.allowedExceptionFlag);
}

export function getRecommendedComplianceAction(status) {
  return RECOMMENDED_ACTIONS[status] || RECOMMENDED_ACTIONS.REQUIRES_REVIEW;
}

function statusForScore(score) {
  const found = COMPLIANCE_CONFIG.STATUS_BANDS.find((b) => score >= b.min);
  return found ? found.status : "NON_COMPLIANT";
}

// ---------------------------------------------------------------------------
// Core evaluator
// ---------------------------------------------------------------------------

/**
 * Evaluates a single project against every configured compliance check.
 * Returns: compliance_score, compliance_status, compliance_issues,
 * failed_checks, passed_checks, compliance_explanation, recommended_action.
 */
export function checkCompliance(project) {
  const W = COMPLIANCE_CONFIG.WEIGHTS;
  let score = 100;
  const issues = [];
  const failedChecks = [];
  const passedChecks = [];

  const fail = (checkName, message, points, severity = "Medium") => {
    score -= points;
    failedChecks.push(checkName);
    issues.push({ check: checkName, severity, message });
  };
  const ok = (checkName) => passedChecks.push(checkName);

  // -- 1. Required project information --
  const missingFields = COMPLIANCE_CONFIG.REQUIRED_FIELDS.filter((f) => isBlank(project[f]));
  if (missingFields.length > 0) {
    const points = Math.min(
      missingFields.length * W.MISSING_REQUIRED_FIELDS,
      W.MISSING_REQUIRED_FIELDS_CAP
    );
    fail(
      "Required Project Information",
      `Missing required field(s): ${missingFields.join(", ")}.`,
      points,
      missingFields.length > 2 ? "High" : "Medium"
    );
  } else {
    ok("Required Project Information");
  }

  // -- 6a. Data quality: invalid numeric values --
  const numericFields = ["sanctionedAmount", "expenditure", "physicalProgress"];
  const invalidNumeric = [];
  numericFields.forEach((f) => {
    const val = project[f];
    if (val !== null && val !== undefined && !isBlank(val) && !isNumber(val)) {
      invalidNumeric.push(f);
    }
  });
  const sanctioned = toFloat(project.sanctionedAmount);
  const spent = toFloat(project.expenditure);
  if (isNumber(project.sanctionedAmount) && sanctioned < 0) invalidNumeric.push("sanctionedAmount (negative)");
  if (isNumber(project.expenditure) && spent < 0) invalidNumeric.push("expenditure (negative)");
  if (sanctioned === 0 && !isBlank(project.sanctionedAmount)) invalidNumeric.push("sanctionedAmount (zero)");

  if (invalidNumeric.length > 0) {
    const points = Math.min(invalidNumeric.length * W.INVALID_NUMERIC_VALUES, W.INVALID_NUMERIC_VALUES_CAP);
    fail(
      "Data Quality — Numeric Values",
      `Invalid or non-numeric value(s) detected: ${invalidNumeric.join(", ")}.`,
      points,
      "High"
    );
  } else {
    ok("Data Quality — Numeric Values");
  }

  // -- 6b. Data quality: invalid percentage --
  const physical = toFloat(project.physicalProgress);
  if (isNumber(project.physicalProgress) && (physical < 0 || physical > 100)) {
    fail(
      "Data Quality — Percentage Range",
      `physicalProgress value (${physical}) is outside the valid 0-100 range.`,
      W.INVALID_PERCENTAGE,
      "High"
    );
  } else {
    ok("Data Quality — Percentage Range");
  }

  // -- 2. Financial consistency --
  const financial = financialProgress(spent, sanctioned);
  if (sanctioned > 0 && spent > sanctioned && !isOverrunAllowed(project)) {
    const overrunPct = ((spent - sanctioned) / sanctioned) * 100;
    fail(
      "Financial Consistency — Expenditure vs Sanctioned",
      `Expenditure exceeds the sanctioned amount by ${overrunPct.toFixed(1)}% (over budget by the difference) with no approved exception on record.`,
      W.EXPENDITURE_EXCEEDS_SANCTIONED,
      overrunPct > 20 ? "Critical" : "High"
    );
  } else {
    ok("Financial Consistency — Expenditure vs Sanctioned");
  }

  if (
    sanctioned > 0 &&
    financial >= COMPLIANCE_CONFIG.HIGH_UTILIZATION_PCT &&
    project.status !== "Completed" &&
    spent <= sanctioned
  ) {
    fail(
      "Financial Consistency — Utilization Rate",
      `${financial}% of the sanctioned amount is already utilized while the project is not marked Completed — utilization is nearing its limit.`,
      W.HIGH_UTILIZATION_WARNING,
      "Medium"
    );
  } else {
    ok("Financial Consistency — Utilization Rate");
  }

  // -- 3. Project progress consistency --
  const gap = Math.abs(financial - physical);
  if (gap >= COMPLIANCE_CONFIG.PROGRESS_MISMATCH_PCT_POINTS) {
    fail(
      "Progress Consistency — Financial vs Physical",
      `Financial progress (${financial}%) and physical progress (${physical}%) differ by ${Math.round(gap)} percentage points, an unexplained mismatch.`,
      W.PROGRESS_MISMATCH,
      gap >= 40 ? "High" : "Medium"
    );
  } else {
    ok("Progress Consistency — Financial vs Physical");
  }

  // -- 4. Date consistency --
  const start = parseDate(project.startDate);
  const expected = parseDate(project.expectedCompletion);
  if (start && expected && expected < start) {
    fail(
      "Date Consistency — Timeline",
      "Expected completion date is earlier than the start date.",
      W.INVALID_TIMELINE,
      "High"
    );
  } else {
    ok("Date Consistency — Timeline");
  }

  const today = new Date();
  const isOverdue = Boolean(expected && project.status !== "Completed" && expected < today);
  const overdueDays = isOverdue ? daysBetween(today, expected) : 0;
  if (isOverdue) {
    fail(
      "Date Consistency — Overdue Project",
      `Project is ${overdueDays} day(s) past its expected completion date and is not marked Completed.`,
      W.PROJECT_OVERDUE,
      overdueDays > COMPLIANCE_CONFIG.SEVERELY_OVERDUE_DAYS ? "Critical" : "High"
    );
  } else {
    ok("Date Consistency — Overdue Project");
  }

  // -- 5. Project status consistency --
  if (project.status === "Completed") {
    if (physical < COMPLIANCE_CONFIG.COMPLETED_MIN_PHYSICAL_PROGRESS) {
      fail(
        "Status Consistency — Completed with Low Physical Progress",
        `Project is marked Completed but physical progress is only ${physical}% (expected at least ${COMPLIANCE_CONFIG.COMPLETED_MIN_PHYSICAL_PROGRESS}%).`,
        W.COMPLETED_LOW_PHYSICAL_PROGRESS,
        "Critical"
      );
    } else {
      ok("Status Consistency — Completed with Low Physical Progress");
    }

    if (financial < COMPLIANCE_CONFIG.COMPLETED_MIN_FINANCIAL_UTILIZATION) {
      fail(
        "Status Consistency — Completed with Incomplete Financial Closure",
        `Project is marked Completed but only ${financial}% of the sanctioned amount has been utilized (expected at least ${COMPLIANCE_CONFIG.COMPLETED_MIN_FINANCIAL_UTILIZATION}%).`,
        W.COMPLETED_FINANCIAL_INCONSISTENT,
        "High"
      );
    } else {
      ok("Status Consistency — Completed with Incomplete Financial Closure");
    }
  } else {
    ok("Status Consistency — Completed with Low Physical Progress");
    ok("Status Consistency — Completed with Incomplete Financial Closure");

    if (isOverdue && overdueDays > COMPLIANCE_CONFIG.SEVERELY_OVERDUE_DAYS) {
      fail(
        "Status Consistency — Active Project Severely Overdue",
        `Project is still active (${project.status}) but is ${overdueDays} days overdue, well beyond the ${COMPLIANCE_CONFIG.SEVERELY_OVERDUE_DAYS}-day severe-delay threshold.`,
        W.ACTIVE_SEVERELY_OVERDUE,
        "Critical"
      );
    } else {
      ok("Status Consistency — Active Project Severely Overdue");
    }
  }

  // -- Final score / status --
  const finalScore = Math.max(0, Math.min(100, Math.round(score)));
  const status = statusForScore(finalScore);

  let explanation;
  if (failedChecks.length === 0) {
    explanation = "All checked compliance rules pass for this project based on currently available data.";
  } else {
    const top = issues.slice(0, 2);
    explanation = `Compliance concerns: ${top.map((i) => i.message).join("; ")}`;
    if (issues.length > 2) explanation += ` (+${issues.length - 2} more)`;
  }

  return {
    project_id: project.id,
    compliance_score: finalScore,
    compliance_status: status,
    compliance_issues: issues,
    failed_checks: failedChecks,
    passed_checks: passedChecks,
    compliance_explanation: explanation,
    recommended_action: getRecommendedComplianceAction(status),
  };
}
