# backend/ml_anomaly.py
"""
MPLADS ML Anomaly Detector — Milestone 2, Part A.

Adds a lightweight, UNSUPERVISED ML anomaly signal (Isolation Forest) for
every project, computed ALONGSIDE — not instead of — the existing
rule-based anomaly detection in risk_engine.py / anomalyDetector.js.

This module is intentionally additive and self-contained:
- It does not modify risk_engine.py, its weights, or calculate_risk().
- It does not change compliance_engine.py.
- The existing rule-based anomaly checks remain the primary/fallback
  signal; the ML score is a secondary, independent signal.

Design notes
------------
- Only numerical project features that already exist in the dataset (or
  are cheaply derivable from it, e.g. duration/overdue days) are used.
  No field is invented.
- Missing/invalid values are imputed with the column median so a single
  incomplete row can never crash training or scoring.
- Isolation Forest needs a reasonable number of samples to produce a
  meaningful separation between "normal" and "anomalous" points. Below
  MIN_PROJECTS_FOR_FOREST rows, we still return a result for every
  project, but via a transparent, simple robust-statistics fallback
  (median/MAD z-score) rather than pretending a forest trained on a
  handful of rows is trustworthy. Either way `ml_confidence` tells the
  caller how much to trust the score, and no accuracy/precision figure
  is ever fabricated.
- Output score is a normalized 0-1 "how unusual is this project relative
  to the others currently loaded" score — NOT a probability of fraud.
  Wording throughout intentionally avoids asserting fraud.
"""

import re
from typing import List, Optional

import numpy as np

import risk_engine as engine

try:
    from sklearn.ensemble import IsolationForest
    from sklearn.preprocessing import StandardScaler

    _SKLEARN_AVAILABLE = True
except ImportError:  # pragma: no cover - sklearn is a declared dependency
    _SKLEARN_AVAILABLE = False

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

# Below this many projects, a forest's notion of "normal" is unreliable, so
# we fall back to a simpler robust-statistics method instead.
MIN_PROJECTS_FOR_FOREST = 8

# Below this many projects, even the fallback method's confidence is capped
# at "limited" and shown as such in every response.
LOW_CONFIDENCE_THRESHOLD = 30

# Robust z-score above which the fallback method flags a project.
FALLBACK_Z_THRESHOLD = 3.0

FEATURE_NAMES = [
    "sanctionedAmount",
    "expenditure",
    "financialProgress",  # utilization %
    "physicalProgress",
    "progressGap",  # financial - physical
    "costOverrunRatio",  # max(0, (expenditure - sanctioned) / sanctioned)
    "durationDays",  # expectedCompletion - startDate, when both parse
    "overdueDays",
    "paymentCount",
]

_FEATURE_LABELS = {
    "sanctionedAmount": "sanctioned amount",
    "expenditure": "expenditure",
    "financialProgress": "financial progress (utilization %)",
    "physicalProgress": "physical progress",
    "progressGap": "financial-physical progress gap",
    "costOverrunRatio": "cost overrun ratio",
    "durationDays": "planned project duration",
    "overdueDays": "days overdue",
    "paymentCount": "number of payment transactions",
}

ANOMALY_DISCLAIMER = "Potential anomaly detected — requires review."
NO_ANOMALY_MESSAGE = "No ML anomaly detected relative to the current project set."


# ---------------------------------------------------------------------------
# Feature extraction
# ---------------------------------------------------------------------------


def _safe_float(value, default: float = 0.0) -> float:
    """Never raises — missing/garbage values fall back to `default` so a
    single bad row can't crash training or scoring."""
    try:
        if value is None or value == "":
            return default
        f = float(value)
        if np.isnan(f) or np.isinf(f):
            return default
        return f
    except (TypeError, ValueError):
        return default


def _duration_days(project: dict) -> float:
    start = engine._parse_date(project.get("startDate"))
    end = engine._parse_date(project.get("expectedCompletion"))
    if start and end and end >= start:
        return float((end - start).days)
    return 0.0


def _extract_features(project: dict) -> List[float]:
    sanctioned = _safe_float(project.get("sanctionedAmount"))
    spent = _safe_float(project.get("expenditure"))
    physical = _safe_float(project.get("physicalProgress"))
    financial = engine.calc_financial_progress(spent, sanctioned)
    gap = financial - physical
    overrun_ratio = max(0.0, (spent - sanctioned) / sanctioned) if sanctioned > 0 else 0.0
    duration = _duration_days(project)
    overdue = float(engine.days_overdue(project))
    payment_count = _safe_float(project.get("paymentCount"), default=3.0)
    return [sanctioned, spent, financial, physical, gap, overrun_ratio, duration, overdue, payment_count]


def build_feature_matrix(all_projects: list) -> np.ndarray:
    rows = [_extract_features(p) for p in all_projects]
    matrix = np.array(rows, dtype=float)
    # Impute any remaining NaN/inf (shouldn't normally occur given
    # _safe_float above, but this keeps the matrix crash-proof end to end)
    # with the column median so one bad column can't skew the whole row.
    if matrix.size == 0:
        return matrix
    finite_mask = np.isfinite(matrix)
    for col in range(matrix.shape[1]):
        col_vals = matrix[finite_mask[:, col], col]
        median = float(np.median(col_vals)) if col_vals.size else 0.0
        bad_rows = ~finite_mask[:, col]
        if bad_rows.any():
            matrix[bad_rows, col] = median
    return matrix


# ---------------------------------------------------------------------------
# Scoring methods
# ---------------------------------------------------------------------------


def _minmax_normalize(values: np.ndarray) -> np.ndarray:
    lo, hi = float(values.min()), float(values.max())
    if hi - lo < 1e-9:
        return np.zeros_like(values)
    return (values - lo) / (hi - lo)


def _isolation_forest_scores(X: np.ndarray, contamination_override: Optional[float] = None):
    scaler = StandardScaler()
    Xs = scaler.fit_transform(X)
    n = X.shape[0]
    if contamination_override is not None:
        # Feedback-calibrated contamination (see mlops_engine.py) — how many
        # of the officer-verified feedback cases turned out to be genuine
        # ("Confirmed Issue") vs not ("False Positive"), clamped to
        # sklearn's valid (0, 0.5] range. Overrides the heuristic below.
        contamination = float(min(0.5, max(0.01, contamination_override)))
    else:
        # Default heuristic (no feedback calibration yet): keep contamination
        # within sklearn's valid (0, 0.5] range while scaling it down for
        # larger datasets so we don't over-flag.
        contamination = float(min(0.25, max(0.05, 3.0 / n)))
    model = IsolationForest(
        n_estimators=200,
        contamination=contamination,
        random_state=42,
    )
    model.fit(Xs)
    # decision_function: higher = more normal. Invert so higher = more anomalous.
    raw = -model.decision_function(Xs)
    scores = _minmax_normalize(raw)
    flags = model.predict(Xs) == -1
    return scores, flags


def _fallback_zscore_scores(X: np.ndarray):
    """Robust (median/MAD) per-feature z-score, reduced to a single
    per-project score by taking the worst-deviating feature. Used when
    scikit-learn isn't available or the dataset is too small for a forest
    to produce a meaningful separation."""
    median = np.median(X, axis=0)
    mad = np.median(np.abs(X - median), axis=0)
    mad = np.where(mad < 1e-9, 1.0, mad)
    z = np.abs((X - median) / (1.4826 * mad))
    worst_z = z.max(axis=1)
    scores = _minmax_normalize(worst_z)
    flags = worst_z >= FALLBACK_Z_THRESHOLD
    return scores, flags


def _top_deviating_features(row: np.ndarray, median: np.ndarray, top_n: int = 2) -> List[str]:
    denom = np.where(np.abs(median) < 1e-9, 1.0, np.abs(median))
    relative_dev = np.abs(row - median) / denom
    order = np.argsort(-relative_dev)
    reasons = []
    for idx in order[:top_n]:
        if relative_dev[idx] <= 0.05:
            continue
        reasons.append(_FEATURE_LABELS.get(FEATURE_NAMES[idx], FEATURE_NAMES[idx]))
    return reasons


def _insufficient_data_result(sample_size: int) -> dict:
    return {
        "ml_anomaly_score": 0.0,
        "ml_anomaly_flag": False,
        "ml_anomaly_confidence": "insufficient_data",
        "ml_method": "none",
        "ml_sample_size": sample_size,
        "ml_anomaly_reason": (
            "Not enough projects loaded to run anomaly detection "
            f"(need at least 2, found {sample_size})."
        ),
    }


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def compute_ml_anomalies(all_projects: list, contamination_override: Optional[float] = None) -> dict:
    """Runs ML anomaly detection over the currently loaded project set and
    returns a dict keyed by project id, e.g.:

        {
          "MPLADS-2024-0001": {
            "ml_anomaly_score": 0.83,
            "ml_anomaly_flag": True,
            "ml_anomaly_confidence": "limited",
            "ml_method": "isolation_forest",
            "ml_sample_size": 16,
            "ml_anomaly_reason": "Potential anomaly detected — requires
                review. Unusual: cost overrun ratio, financial-physical
                progress gap.",
          },
          ...
        }

    Never raises on missing/small/malformed data — callers can rely on
    every project id in `all_projects` having an entry in the result.
    """
    results: dict = {}
    n = len(all_projects)

    if n < 2:
        for p in all_projects:
            results[p["id"]] = _insufficient_data_result(n)
        return results

    X = build_feature_matrix(all_projects)

    use_forest = _SKLEARN_AVAILABLE and n >= MIN_PROJECTS_FOR_FOREST
    if use_forest:
        scores, flags = _isolation_forest_scores(X, contamination_override=contamination_override)
        method = "isolation_forest"
    else:
        scores, flags = _fallback_zscore_scores(X)
        method = "fallback_robust_zscore" if _SKLEARN_AVAILABLE else "fallback_robust_zscore_no_sklearn"

    confidence = "limited" if n < LOW_CONFIDENCE_THRESHOLD else "normal"
    median = np.median(X, axis=0)

    for i, project in enumerate(all_projects):
        flagged = bool(flags[i])
        reason_bits = _top_deviating_features(X[i], median) if flagged else []
        if flagged:
            reason = ANOMALY_DISCLAIMER
            if reason_bits:
                reason += " Unusual: " + ", ".join(reason_bits) + "."
        else:
            reason = NO_ANOMALY_MESSAGE

        results[project["id"]] = {
            "ml_anomaly_score": round(float(scores[i]), 3),
            "ml_anomaly_flag": flagged,
            "ml_anomaly_confidence": confidence,
            "ml_method": method,
            "ml_sample_size": n,
            "ml_anomaly_reason": reason,
        }

    return results


def compute_ml_anomaly_for_project(project: dict, all_projects: list,
                                    contamination_override: Optional[float] = None) -> dict:
    """Convenience wrapper for a single-project endpoint — still runs the
    detector over the full currently loaded set (required for the model to
    have any notion of "typical"), then returns just this project's entry."""
    all_results = compute_ml_anomalies(all_projects, contamination_override=contamination_override)
    return all_results.get(
        project.get("id"),
        _insufficient_data_result(len(all_projects)),
    )
