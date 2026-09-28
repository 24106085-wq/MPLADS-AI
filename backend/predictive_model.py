# backend/predictive_model.py
"""
MPLADS Predictive Risk Model — Milestone 3, Parts A, B & C.

Adds GENUINE SUPERVISED ML on top of the existing prototype:

- Part A: a delay-prediction classifier (logistic regression) trained on the
  `status == "Delayed"` label that already exists in the dataset.
- Part B: a cost-overrun classifier, trained the same way where the data
  actually supports it (see "PART B — WHY IT IS DISABLED" below).
- Part C: explanations for the delay model's predictions — real SHAP values
  when the `shap` package is installed, otherwise a clearly-labeled linear
  feature-importance fallback (never fabricated SHAP output).

This module is additive and self-contained, mirroring ml_anomaly.py's
conventions:
- It does not modify risk_engine.py, compliance_engine.py, ml_anomaly.py or
  duplicate_detector.py, and never overwrites riskScore/riskLevel.
- It reuses risk_engine's date/financial-progress helpers and ml_anomaly's
  safe-float/duration helpers rather than re-implementing them.
- It never fabricates accuracy, confidence, or SHAP values. Below the
  documented sample-size thresholds it returns a transparent
  "insufficient_data" / "unavailable" result instead of a number.

WHY LOGISTIC REGRESSION (not a heavier model)
----------------------------------------------
The dataset currently has 16 rows. A lightweight, linear, well-regularized
model is the only kind of model that can be evaluated at all honestly at
this sample size, and it is directly explainable (the SHAP fallback in
Part C is mathematically the same computation logistic-regression SHAP
would produce). A more complex model (gradient boosting, random forest)
would only add uninspectable variance here, not real predictive power.

LABEL DEFINITION & LEAKAGE
--------------------------
The delay label is `project["status"] == "Delayed"` — a real, pre-existing
outcome field in the dataset, not something derived from the features fed
to the model, so using it as a target is not circular. Note that this label
is noisy in the actual sample: several "In Progress" rows are already past
their `expectedCompletion` date, i.e. the humans who set `status` did not
mark every overdue project "Delayed". The model is trained on the label as
recorded, and this noise is disclosed in `model_notes` rather than hidden.

`overdueDays` and `physicalProgress` are legitimate point-in-time features
(they describe the project's state *as of today*, not information that
would only exist after the outcome is known), and the brief explicitly
lists both as allowed features, so they are used.

PART B — WHY IT IS DISABLED ON THE CURRENT DATASET
---------------------------------------------------
A "cost overrun" label can only be defined here as `expenditure >
sanctionedAmount` (there is no separate "projected final cost" field).
That means the label would be computed directly from `expenditure`, so
training on features that include `expenditure` (or anything derived from
it, like `financialProgress`) would be circular, not a forward-looking
prediction. Even excluding those, the current dataset has only 3 rows
where an overrun has already happened — far below MIN_POSITIVE_SAMPLES —
so `compute_cost_overrun_predictions()` always returns
`model_status: "unavailable"` on this data rather than fabricating a
probability. The function is fully implemented so it activates
automatically once enough non-circular, labeled history exists.
"""

from datetime import date
from typing import Dict, List, Optional, Tuple

import numpy as np

import ml_anomaly
import risk_engine as engine

try:
    from sklearn.linear_model import LogisticRegression
    from sklearn.metrics import accuracy_score, f1_score, precision_score, recall_score, roc_auc_score
    from sklearn.model_selection import LeaveOneOut
    from sklearn.preprocessing import StandardScaler

    _SKLEARN_AVAILABLE = True
except ImportError:  # pragma: no cover - scikit-learn is a declared dependency
    _SKLEARN_AVAILABLE = False

try:
    import shap as _shap

    _SHAP_AVAILABLE = True
except ImportError:
    _SHAP_AVAILABLE = False

RANDOM_STATE = 42

# A model is attempted at all only above this many total rows...
MIN_SAMPLES_FOR_TRAINING = 10
# ...AND with at least this many examples of each class (otherwise a
# logistic regression can't learn anything about the minority class).
MIN_POSITIVE_SAMPLES = 3
MIN_NEGATIVE_SAMPLES = 3
# Even once trained, confidence is capped at "low" below this many rows —
# 16-30 rows is enough to fit a 1-2 feature linear model, not enough to
# trust it the way a production model would be trusted.
LOW_CONFIDENCE_SAMPLE_THRESHOLD = 50
# Stricter bar for the cost-overrun model (Part B) since its label is
# closer to circular — see module docstring.
MIN_POSITIVE_SAMPLES_OVERRUN = 5

DELAY_FEATURE_NAMES = [
    "sanctionedAmount",
    "expenditure",
    "financialProgress",
    "physicalProgress",
    "progressGap",
    "plannedDurationDays",
    "projectAgeDays",
    "overdueDays",
    "paymentCount",
    "categoryFrequency",
]

# Features usable for the cost-overrun model, deliberately EXCLUDING
# expenditure/financialProgress/progressGap since the overrun label is
# defined from expenditure — see module docstring "PART B" section.
OVERRUN_FEATURE_NAMES = [
    "sanctionedAmount",
    "physicalProgress",
    "plannedDurationDays",
    "projectAgeDays",
    "overdueDays",
    "paymentCount",
    "categoryFrequency",
]

_FEATURE_LABELS = {
    "sanctionedAmount": "sanctioned amount",
    "expenditure": "expenditure",
    "financialProgress": "financial progress (utilization %)",
    "physicalProgress": "physical progress",
    "progressGap": "financial-physical progress gap",
    "plannedDurationDays": "planned project duration",
    "projectAgeDays": "project age (time since start)",
    "overdueDays": "days overdue",
    "paymentCount": "number of payment transactions",
    "categoryFrequency": "how common this work category is",
}

DELAY_DISCLAIMER = (
    "Predictive ML signal — a probability estimate from a trained model, not a "
    "certainty or a fraud/compliance determination."
)

# ---------------------------------------------------------------------------
# Data-sufficiency status wording (brief requirement: "Model Available" /
# "Limited Data" / "Insufficient Data" — never fabricate a prediction when
# the dataset is too small, and always label transparently which of these
# three states a given result is in). This is a display-friendly ALIAS of
# the existing model_status/confidence values below, not a replacement —
# model_status/model_confidence keep their existing values unchanged so
# nothing that already branches on them (e.g. ProjectModal.jsx checking
# model_status == "insufficient_data") is affected by this addition.
# ---------------------------------------------------------------------------

DATA_STATUS_AVAILABLE = "Model Available"
DATA_STATUS_LIMITED = "Limited Data"
DATA_STATUS_INSUFFICIENT = "Insufficient Data"

_MODEL_STATUS_TO_DATA_STATUS = {
    "trained": DATA_STATUS_AVAILABLE,
    "trained_limited_data": DATA_STATUS_LIMITED,
    "insufficient_data": DATA_STATUS_INSUFFICIENT,
    "unavailable": DATA_STATUS_INSUFFICIENT,
}


def _data_status(model_status: str) -> str:
    return _MODEL_STATUS_TO_DATA_STATUS.get(model_status, DATA_STATUS_INSUFFICIENT)


# ---------------------------------------------------------------------------
# Feature extraction (reuses risk_engine / ml_anomaly helpers — nothing here
# re-derives logic that already exists elsewhere in the codebase)
# ---------------------------------------------------------------------------


def _project_age_days(project: dict) -> float:
    start = engine._parse_date(project.get("startDate"))
    if not start:
        return 0.0
    return float(max(0, (date.today() - start).days))


def _category_counts(all_projects: List[dict]) -> Dict[str, int]:
    counts: Dict[str, int] = {}
    for p in all_projects:
        cat = p.get("category") or "General"
        counts[cat] = counts.get(cat, 0) + 1
    return counts


def _extract_row(project: dict, category_counts: Dict[str, int], n_total: int) -> Dict[str, float]:
    sanctioned = ml_anomaly._safe_float(project.get("sanctionedAmount"))
    spent = ml_anomaly._safe_float(project.get("expenditure"))
    physical = ml_anomaly._safe_float(project.get("physicalProgress"))
    financial = engine.calc_financial_progress(spent, sanctioned)
    gap = financial - physical
    duration = ml_anomaly._duration_days(project)
    age = _project_age_days(project)
    overdue = float(engine.days_overdue(project))
    payment_count = ml_anomaly._safe_float(project.get("paymentCount"), default=3.0)
    cat = project.get("category") or "General"
    cat_freq = category_counts.get(cat, 1) / n_total if n_total else 0.0

    return {
        "sanctionedAmount": sanctioned,
        "expenditure": spent,
        "financialProgress": financial,
        "physicalProgress": physical,
        "progressGap": gap,
        "plannedDurationDays": duration,
        "projectAgeDays": age,
        "overdueDays": overdue,
        "paymentCount": payment_count,
        "categoryFrequency": cat_freq,
    }


def _build_matrix(all_projects: List[dict], feature_names: List[str]) -> np.ndarray:
    category_counts = _category_counts(all_projects)
    n_total = len(all_projects)
    rows = []
    for p in all_projects:
        full_row = _extract_row(p, category_counts, n_total)
        rows.append([full_row[name] for name in feature_names])
    matrix = np.array(rows, dtype=float)
    if matrix.size == 0:
        return matrix
    # Median-impute any stray NaN/inf, same crash-proofing convention as
    # ml_anomaly.build_feature_matrix().
    finite_mask = np.isfinite(matrix)
    for col in range(matrix.shape[1]):
        col_vals = matrix[finite_mask[:, col], col]
        median = float(np.median(col_vals)) if col_vals.size else 0.0
        bad_rows = ~finite_mask[:, col]
        if bad_rows.any():
            matrix[bad_rows, col] = median
    return matrix


def _is_delayed_label(project: dict) -> int:
    return 1 if str(project.get("status", "")).strip().lower() == "delayed" else 0


def _is_overrun_label(project: dict) -> int:
    sanctioned = ml_anomaly._safe_float(project.get("sanctionedAmount"))
    spent = ml_anomaly._safe_float(project.get("expenditure"))
    return 1 if sanctioned > 0 and spent > sanctioned else 0


# ---------------------------------------------------------------------------
# Leave-one-out cross-validated metrics — the only honest evaluation
# strategy at this sample size (a held-out test split would leave too few
# rows on each side to mean anything). Metrics are computed on the pooled
# out-of-fold predictions across all folds.
# ---------------------------------------------------------------------------


def _loo_cv_metrics(X: np.ndarray, y: np.ndarray) -> Optional[dict]:
    if not _SKLEARN_AVAILABLE:
        return None
    n = len(y)
    if n < 4 or len(set(y.tolist())) < 2:
        return None

    loo = LeaveOneOut()
    y_true, y_prob = [], []
    for train_idx, test_idx in loo.split(X):
        y_train = y[train_idx]
        if len(set(y_train.tolist())) < 2:
            # This fold's training set lost its only example of one class —
            # skip it rather than fit a degenerate one-class model. Reported
            # sample counts reflect this rather than pretending it fit.
            continue
        scaler = StandardScaler()
        X_train = scaler.fit_transform(X[train_idx])
        X_test = scaler.transform(X[test_idx])
        model = LogisticRegression(class_weight="balanced", C=1.0, max_iter=1000, random_state=RANDOM_STATE)
        model.fit(X_train, y_train)
        y_true.append(int(y[test_idx][0]))
        y_prob.append(float(model.predict_proba(X_test)[0, 1]))

    if len(y_true) < 4 or len(set(y_true)) < 2:
        return None

    y_true_arr = np.array(y_true)
    y_pred_arr = (np.array(y_prob) >= 0.5).astype(int)

    metrics = {
        "method": "leave_one_out_cross_validated",
        "folds_evaluated": len(y_true),
        "accuracy": round(float(accuracy_score(y_true_arr, y_pred_arr)), 3),
        "precision": round(float(precision_score(y_true_arr, y_pred_arr, zero_division=0)), 3),
        "recall": round(float(recall_score(y_true_arr, y_pred_arr, zero_division=0)), 3),
        "f1": round(float(f1_score(y_true_arr, y_pred_arr, zero_division=0)), 3),
    }
    try:
        metrics["roc_auc"] = round(float(roc_auc_score(y_true_arr, y_prob)), 3)
    except ValueError:
        pass  # not computable (e.g. all-one-class after fold skips)

    metrics["caution"] = (
        f"Computed on only {len(y_true)} leave-one-out folds — treat as a rough, "
        "high-variance signal, not a production-grade accuracy figure."
    )
    return metrics


# ---------------------------------------------------------------------------
# Training
# ---------------------------------------------------------------------------


class _TrainedModel:
    __slots__ = ("scaler", "model", "feature_names", "X_scaled", "median_raw", "metrics", "method")

    def __init__(self, scaler, model, feature_names, X_scaled, median_raw, metrics, method):
        self.scaler = scaler
        self.model = model
        self.feature_names = feature_names
        self.X_scaled = X_scaled
        self.median_raw = median_raw
        self.metrics = metrics
        self.method = method


def _train(
    all_projects: List[dict],
    feature_names: List[str],
    label_fn,
    min_positive: int,
) -> Tuple[Optional[_TrainedModel], dict]:
    """Returns (trained_model_or_None, meta). `meta` always describes the
    model_status/confidence/sample counts, whether or not training happened."""
    n = len(all_projects)
    meta = {"sample_size": n, "n_positive": 0, "n_negative": 0}

    if not _SKLEARN_AVAILABLE:
        meta.update(model_status="unavailable", confidence="insufficient_data", method="none",
                    reason="scikit-learn is not available in this environment.")
        return None, meta

    y = np.array([label_fn(p) for p in all_projects])
    n_pos = int(y.sum())
    n_neg = int(n - n_pos)
    meta["n_positive"] = n_pos
    meta["n_negative"] = n_neg

    if n < MIN_SAMPLES_FOR_TRAINING or n_pos < min_positive or n_neg < MIN_NEGATIVE_SAMPLES:
        meta.update(
            model_status="insufficient_data",
            confidence="insufficient_data",
            method="none",
            reason=(
                f"Not enough labeled history to train reliably: {n} project(s) loaded "
                f"({n_pos} positive, {n_neg} negative); need at least {MIN_SAMPLES_FOR_TRAINING} "
                f"total and {min_positive} positive examples."
            ),
        )
        return None, meta

    X = _build_matrix(all_projects, feature_names)
    scaler = StandardScaler()
    X_scaled = scaler.fit_transform(X)
    model = LogisticRegression(class_weight="balanced", C=1.0, max_iter=1000, random_state=RANDOM_STATE)
    model.fit(X_scaled, y)

    cv_metrics = _loo_cv_metrics(X, y)
    confidence = "low" if n < LOW_CONFIDENCE_SAMPLE_THRESHOLD else "normal"
    meta.update(
        model_status="trained" if confidence == "normal" else "trained_limited_data",
        confidence=confidence,
        method="logistic_regression",
        validation_metrics=cv_metrics,
        reason=None,
    )
    trained = _TrainedModel(
        scaler=scaler,
        model=model,
        feature_names=feature_names,
        X_scaled=X_scaled,
        median_raw=np.median(X, axis=0),
        metrics=cv_metrics,
        method="logistic_regression",
    )
    return trained, meta


# ---------------------------------------------------------------------------
# Public API — Part A: delay prediction
# ---------------------------------------------------------------------------


def compute_delay_predictions(all_projects: List[dict]) -> Dict[str, dict]:
    """Runs the delay classifier over the currently loaded project set and
    returns a dict keyed by project id. Never raises; below the documented
    thresholds every project gets an honest 'insufficient_data' entry
    instead of a fabricated probability."""
    trained, meta = _train(all_projects, DELAY_FEATURE_NAMES, _is_delayed_label, MIN_POSITIVE_SAMPLES)

    results: Dict[str, dict] = {}
    if trained is None:
        for p in all_projects:
            results[p["id"]] = {
                "delay_probability": None,
                "predicted_delay": None,
                "model_status": meta["model_status"],
                "model_confidence": meta["confidence"],
                "data_status": _data_status(meta["model_status"]),
                "model_method": meta["method"],
                "sample_size": meta["sample_size"],
                "validation_metrics": None,
                "model_notes": meta["reason"],
            }
        return results

    probs = trained.model.predict_proba(trained.X_scaled)[:, 1]
    notes = (
        "Trained on the dataset's existing `status == \"Delayed\"` label. Note: several "
        "projects marked \"In Progress\" in this dataset are already past their expected "
        "completion date, so the label the model learned from is itself imperfect."
    )
    for i, p in enumerate(all_projects):
        prob = float(probs[i])
        results[p["id"]] = {
            "delay_probability": round(prob, 3),
            "predicted_delay": bool(prob >= 0.5),
            "model_status": meta["model_status"],
            "model_confidence": meta["confidence"],
            "data_status": _data_status(meta["model_status"]),
            "model_method": meta["method"],
            "sample_size": meta["sample_size"],
            "validation_metrics": meta["validation_metrics"],
            "model_notes": notes,
        }
    return results


def predict_delay_for_project(project: dict, all_projects: List[dict]) -> dict:
    all_results = compute_delay_predictions(all_projects)
    return all_results.get(
        project.get("id"),
        {
            "delay_probability": None,
            "predicted_delay": None,
            "model_status": "insufficient_data",
            "model_confidence": "insufficient_data",
            "data_status": DATA_STATUS_INSUFFICIENT,
            "model_method": "none",
            "sample_size": len(all_projects),
            "validation_metrics": None,
            "model_notes": "Project not found in the currently loaded set.",
        },
    )


# ---------------------------------------------------------------------------
# Public API — Part B: cost overrun prediction
# ---------------------------------------------------------------------------


def compute_cost_overrun_predictions(all_projects: List[dict]) -> Dict[str, dict]:
    """Same contract as compute_delay_predictions(). On the current sample
    dataset this always returns model_status="unavailable" — see the module
    docstring's "PART B" section for why. Implemented in full so it turns
    on automatically once enough non-circular history exists."""
    trained, meta = _train(
        all_projects, OVERRUN_FEATURE_NAMES, _is_overrun_label, MIN_POSITIVE_SAMPLES_OVERRUN
    )

    results: Dict[str, dict] = {}
    if trained is None:
        reason = meta["reason"] or (
            "Cost overrun prediction is unavailable: a reliable label can only be defined "
            "from expenditure already exceeding the sanctioned amount, which is too "
            "circular and too sparse in the current dataset to support supervised training."
        )
        for p in all_projects:
            results[p["id"]] = {
                "cost_overrun_probability": None,
                "predicted_cost_overrun": None,
                "model_status": "unavailable",
                "model_confidence": "insufficient_data",
                "data_status": DATA_STATUS_INSUFFICIENT,
                "model_method": "none",
                "sample_size": meta["sample_size"],
                "validation_metrics": None,
                "model_notes": reason,
            }
        return results

    probs = trained.model.predict_proba(trained.X_scaled)[:, 1]
    for i, p in enumerate(all_projects):
        prob = float(probs[i])
        results[p["id"]] = {
            "cost_overrun_probability": round(prob, 3),
            "predicted_cost_overrun": bool(prob >= 0.5),
            "model_status": meta["model_status"],
            "model_confidence": meta["confidence"],
            "data_status": _data_status(meta["model_status"]),
            "model_method": meta["method"],
            "sample_size": meta["sample_size"],
            "validation_metrics": meta["validation_metrics"],
            "model_notes": "Trained only on features unrelated to current expenditure, to avoid circularity.",
        }
    return results


# ---------------------------------------------------------------------------
# Public API — Part C: explainability (SHAP, with a labeled fallback)
# ---------------------------------------------------------------------------


def _impact_bucket(abs_contribution: float, max_abs_in_row: float) -> str:
    if max_abs_in_row <= 1e-9:
        return "low"
    ratio = abs_contribution / max_abs_in_row
    if ratio >= 0.6:
        return "high"
    if ratio >= 0.25:
        return "medium"
    return "low"


def _describe_direction(raw_value: float, median_value: float, contribution: float, label: str):
    direction = "increases_risk" if contribution > 0 else "decreases_risk"
    if abs(raw_value - median_value) < 1e-9:
        level_word = "typical"
        short_prefix = "Typical"
    elif raw_value > median_value:
        level_word = "higher than typical"
        short_prefix = "High"
    else:
        level_word = "lower than typical"
        short_prefix = "Low"
    verb = "increases" if direction == "increases_risk" else "reduces"
    description = f"{label.capitalize()} is {level_word}, which {verb} predicted delay risk."
    short_label = f"{short_prefix} {label}"
    return direction, description, short_label


def explain_delay_prediction(project: dict, all_projects: List[dict], top_n: int = 3) -> dict:
    """Explains this project's delay prediction with real SHAP values when
    the `shap` package is available, otherwise a linear feature-contribution
    fallback — clearly labeled as such, never presented as SHAP."""
    trained, meta = _train(all_projects, DELAY_FEATURE_NAMES, _is_delayed_label, MIN_POSITIVE_SAMPLES)

    if trained is None:
        return {
            "model_status": meta["model_status"],
            "data_status": _data_status(meta["model_status"]),
            "explanation_method": "none",
            "top_factors": [],
            "notes": meta["reason"],
        }

    ids = [p["id"] for p in all_projects]
    try:
        row_idx = ids.index(project.get("id"))
    except ValueError:
        return {
            "model_status": meta["model_status"],
            "data_status": _data_status(meta["model_status"]),
            "explanation_method": "none",
            "top_factors": [],
            "notes": "Project not found in the currently loaded set.",
        }

    x_row = trained.X_scaled[row_idx]
    raw_row = _extract_row(project, _category_counts(all_projects), len(all_projects))

    if _SHAP_AVAILABLE:
        try:
            explainer = _shap.LinearExplainer(trained.model, trained.X_scaled)
            shap_values = np.asarray(explainer.shap_values(x_row.reshape(1, -1)))
            if shap_values.ndim > 1:
                shap_values = shap_values[0]
            contributions = shap_values
            method = "shap"
        except Exception:  # pragma: no cover - defensive: fall back cleanly
            contributions = trained.model.coef_[0] * x_row
            method = "feature_importance_fallback"
    else:
        # For a linear model, coef_i * (standardized value)_i IS the SHAP
        # contribution relative to the training-set mean baseline — this is
        # not an approximation of SHAP, it's the same computation SHAP's
        # LinearExplainer performs, but we still label it as a fallback per
        # the brief since the shap package itself isn't the one computing it.
        contributions = trained.model.coef_[0] * x_row
        method = "feature_importance_fallback"

    max_abs = float(np.abs(contributions).max()) if contributions.size else 0.0
    order = np.argsort(-np.abs(contributions))[:top_n]

    top_factors = []
    for idx in order:
        feature = trained.feature_names[idx]
        label = _FEATURE_LABELS.get(feature, feature)
        contribution = float(contributions[idx])
        direction, description, short_label = _describe_direction(
            raw_row[feature], float(trained.median_raw[idx]), contribution, label
        )
        top_factors.append(
            {
                "feature": feature,
                "label": label,
                # Short "Primary Factors" style label (e.g. "Low physical
                # progress", "High financial progress (utilization %)") for
                # compact display, alongside the full `description` sentence.
                "short_label": short_label,
                "impact": _impact_bucket(abs(contribution), max_abs),
                "direction": direction,
                "contribution": round(contribution, 4),
                "description": description,
            }
        )

    return {
        "model_status": meta["model_status"],
        "data_status": _data_status(meta["model_status"]),
        "explanation_method": method,
        "top_factors": top_factors,
        "notes": None if method == "shap" else (
            "shap package not available in this environment — showing linear "
            "feature-importance contributions from the trained model instead "
            "(feature importance, not SHAP)."
        ),
    }
