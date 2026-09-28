// src/utils/projectUtils.js
// Shared helper utilities: ID generation, formatting, derived field calculations.

/**
 * Generates a unique, sequential MPLADS project ID.
 * Format: MPLADS-<YEAR>-<0001>
 * Guarantees uniqueness against the currently loaded project list.
 */
export function generateProjectId(existingProjects = [], year = new Date().getFullYear()) {
  const prefix = `MPLADS-${year}-`;
  let maxSeq = 0;

  existingProjects.forEach((p) => {
    if (p.id && p.id.startsWith(prefix)) {
      const seqPart = p.id.slice(prefix.length);
      const seqNum = parseInt(seqPart, 10);
      if (!Number.isNaN(seqNum) && seqNum > maxSeq) {
        maxSeq = seqNum;
      }
    }
  });

  let nextSeq = maxSeq + 1;
  let candidate = `${prefix}${String(nextSeq).padStart(4, "0")}`;

  // Extra safety net in case of gaps / manual IDs colliding.
  const existingIds = new Set(existingProjects.map((p) => p.id));
  while (existingIds.has(candidate)) {
    nextSeq += 1;
    candidate = `${prefix}${String(nextSeq).padStart(4, "0")}`;
  }

  return candidate;
}

/** Formats a number as Indian Rupees with lakh/crore grouping. */
export function formatCurrency(value) {
  const num = Number(value) || 0;
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(num);
}

/** Compact currency for tight spaces, e.g. ₹42.5 L / ₹1.2 Cr */
export function formatCurrencyCompact(value) {
  const num = Number(value) || 0;
  if (num >= 1_00_00_000) return `₹${(num / 1_00_00_000).toFixed(2)} Cr`;
  if (num >= 1_00_000) return `₹${(num / 1_00_000).toFixed(2)} L`;
  if (num >= 1_000) return `₹${(num / 1_000).toFixed(1)} K`;
  return `₹${num}`;
}

/** Formats an ISO date string as DD MMM YYYY */
export function formatDate(dateStr) {
  if (!dateStr) return "—";
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

/** Financial progress (%) = expenditure / sanctioned amount * 100, capped for display sanity */
export function calcFinancialProgress(expenditure, sanctionedAmount) {
  const sanctioned = Number(sanctionedAmount) || 0;
  const spent = Number(expenditure) || 0;
  if (sanctioned <= 0) return 0;
  const pct = (spent / sanctioned) * 100;
  return Math.round(pct * 10) / 10;
}

/** Returns true if the project's expected completion date has passed and it isn't completed. */
export function isOverdue(project) {
  if (!project.expectedCompletion) return false;
  if (project.status === "Completed") return false;
  const today = new Date();
  const due = new Date(project.expectedCompletion);
  if (Number.isNaN(due.getTime())) return false;
  return due.getTime() < today.getTime();
}

/** Days a project is overdue by (0 if not overdue). */
export function daysOverdue(project) {
  if (!isOverdue(project)) return 0;
  const today = new Date();
  const due = new Date(project.expectedCompletion);
  return Math.floor((today.getTime() - due.getTime()) / (1000 * 60 * 60 * 24));
}

/** Normalizes raw CSV/JSON row keys (case-insensitive, trims whitespace) into our schema. */
export function normalizeImportedRow(row) {
  const get = (...keys) => {
    for (const k of keys) {
      const foundKey = Object.keys(row).find(
        (rk) => rk.trim().toLowerCase() === k.toLowerCase()
      );
      if (foundKey && row[foundKey] !== undefined && row[foundKey] !== "") {
        return row[foundKey];
      }
    }
    return undefined;
  };

  return {
    workName: get("workName", "work name", "work_name", "project name") || "Untitled Work",
    mpName: get("mpName", "mp name", "mp_name", "member of parliament") || "Unknown MP",
    constituency: get("constituency") || "Unknown",
    state: get("state") || "Unknown",
    district: get("district") || "Unknown",
    category: get("category", "work category", "work_category") || "General",
    sanctionedAmount: Number(get("sanctionedAmount", "sanctioned amount", "sanctioned_amount")) || 0,
    expenditure: Number(get("expenditure", "expenditure amount")) || 0,
    physicalProgress: Number(get("physicalProgress", "physical progress", "physical_progress")) || 0,
    status: get("status") || "In Progress",
    startDate: get("startDate", "start date", "start_date") || null,
    expectedCompletion:
      get("expectedCompletion", "expected completion", "expected_completion") || null,
    implementingAgency:
      get("implementingAgency", "implementing agency", "implementing_agency") || "Not Specified",
    paymentCount: Number(get("paymentCount", "payment count", "payments")) || 3,
    id: get("id", "project id", "project_id") || null,
    // Real coordinates ONLY if the file actually has them — never
    // fabricated for the preview. undefined/blank stays null so the
    // backend (source of truth) can honestly mark the record as having
    // no location rather than inventing one.
    latitude: (() => {
      const v = get("latitude", "lat");
      const n = Number(v);
      return v !== undefined && !Number.isNaN(n) ? n : null;
    })(),
    longitude: (() => {
      const v = get("longitude", "lon", "lng", "long");
      const n = Number(v);
      return v !== undefined && !Number.isNaN(n) ? n : null;
    })(),
  };
}

/** Required columns for a valid MPLADS CSV import. */
export const REQUIRED_IMPORT_COLUMNS = [
  "workName",
  "state",
  "district",
  "sanctionedAmount",
  "expenditure",
  "physicalProgress",
];

/** Validates a normalized row has the minimum required fields populated. */
export function validateImportedRow(row) {
  const errors = [];
  if (!row.workName || row.workName === "Untitled Work") errors.push("Missing work name");
  if (!row.state || row.state === "Unknown") errors.push("Missing state");
  if (!row.district || row.district === "Unknown") errors.push("Missing district");
  if (!row.sanctionedAmount || row.sanctionedAmount <= 0) errors.push("Invalid sanctioned amount");
  if (row.physicalProgress < 0 || row.physicalProgress > 100) errors.push("Physical progress out of range");
  return { valid: errors.length === 0, errors };
}
