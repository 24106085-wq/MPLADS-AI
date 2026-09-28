# backend/multi_signal_risk.py
"""
Multi-Signal Risk & Decision Engine (Target Architecture Block 4: Risk
Scoring & Decision Engine).

Before this module existed, riskScore/riskLevel shown to the user came
ONLY from risk_engine.calculate_risk() (pure rule-based points). The ML
anomaly score (ml_anomaly.py), duplicate/similarity score
(duplicate_detector.py), compliance score (compliance_engine.py) and
delay/cost-overrun predictions (predictive_model.py) were all computed and
exposed on their OWN endpoints, but never actually combined into the
headline risk score the rest of the app (dashboard, map, alerts) relies on.

This module fixes that: it genuinely combines all of those independently-
computed signals into ONE transparent, weighted 0-100 score, and returns
the individual contribution of every signal so the UI can show its
breakdown rather than a black box.

This is deliberately NOT presented as a single trained fraud-detection
model — it is an explainable, configurable weighted combination of
several signals, some of which (ML anomaly / delay / cost-overrun) ARE
genuinely trained models where the dataset supports it, and others
(financial-physical gap, compliance deviation, remaining rule signals)
are transparent rule-based calculations. Combining them here does not
change what any individual signal is; it changes how they add up.

Configured weights (sum to 100 — adjust freely, this is a prototype,
not a production-calibrated model):

    Financial / behavioural anomaly (ML)      25%
    Physical-financial progress gap           20%
    Compliance deviation                      15%
    Duplicate / similarity evidence           10%
    Delay risk                                10%
    Cost overrun risk                         10%
    Other rule-based signals                  10%

If a signal can't be computed for a given project (e.g. an ML/predictive
model needs more loaded projects than are currently available), its
configured weight is proportionally redistributed across the signals that
ARE available for that project. This keeps the score honest (nothing is
fabricated) and is reported back in `contributing_factors` /
`insufficient_signal_note` so the UI never silently pretends every signal
ran.
"""

from typing import Optional

import risk_engine as rule_engine

SIGNAL_WEIGHTS = {
    "financial_anomaly": 25,
    "physical_financial_gap": 20,
    "compliance_deviation": 15,
    "duplicate_evidence": 10,
    "delay_risk": 10,
    "cost_overrun_risk": 10,
    "other_signals": 10,
}

SIGNAL_LABELS = {
    "financial_anomaly": "Financial / Behavioural Anomaly",
    "physical_financial_gap": "Physical-Financial Progress Gap",
    "compliance_deviation": "Compliance Deviation",
    "duplicate_evidence": "Duplicate / Similarity Evidence",
    "delay_risk": "Delay Risk",
    "cost_overrun_risk": "Cost Overrun Risk",
    "other_signals": "Other Rule-Based Signals",
}

RISK_BANDS = [
    {"level": "Low", "min": 0, "max": 39},
    {"level": "Medium", "min": 40, "max": 59},
    {"level": "High", "min": 60, "max": 79},
    {"level": "Critical", "min": 80, "max": 100},
]


def get_multi_signal_level(score: float) -> str:
    for band in RISK_BANDS:
        if band["min"] <= score <= band["max"]:
            return band["level"]
    return "Low"


def _clamp(v: float, lo: float = 0.0, hi: float = 100.0) -> float:
    return max(lo, min(hi, v))


def _rule_points(rule_result: dict, names) -> float:
    return sum(f["points"] for f in rule_result.get("factors", []) if f["name"] in names)


def compute_multi_signal_risk(
    project: dict,
    all_projects: list,
    rule_result: Optional[dict] = None,
    compliance_result: Optional[dict] = None,
    ml_result: Optional[dict] = None,
    duplicate_result: Optional[dict] = None,
    delay_result: Optional[dict] = None,
    overrun_result: Optional[dict] = None,
    photo_evidence_result: Optional[dict] = None,
) -> dict:
    """Computes the transparent weighted multi-signal risk score for ONE
    project. Every *_result argument is optional and, when omitted, is
    treated as unavailable for this call (callers that already ran the
    other engines over the full project set — see monitoring.py — should
    pass those results in directly rather than letting this function
    recompute them project-by-project)."""

    rule_result = rule_result or rule_engine.calculate_risk(project, all_projects)
    compliance_result = compliance_result or {}
    ml_result = ml_result or {}
    duplicate_result = duplicate_result or {}
    delay_result = delay_result or {}
    overrun_result = overrun_result or {}
    photo_evidence_result = photo_evidence_result or {}

    sanctioned = float(project.get("sanctionedAmount") or 0)
    spent = float(project.get("expenditure") or 0)
    physical = float(project.get("physicalProgress") or 0)
    financial = rule_engine.calc_financial_progress(spent, sanctioned)

    signals = {}

    # 1. Financial / behavioural anomaly — genuine ML (Isolation Forest, or
    #    its documented robust-z-score fallback) score when the model could
    #    run; otherwise an explicit, labeled rule-based fallback so the
    #    score is never silently zero just because the dataset is small.
    ml_score = ml_result.get("ml_anomaly_score")
    ml_method = ml_result.get("ml_method")
    ml_sample_size = ml_result.get("ml_sample_size") or 0
    if ml_score is not None and ml_sample_size >= 2:
        signals["financial_anomaly"] = {
            "value": _clamp(float(ml_score) * 100),
            "available": True,
            "source": f"ML anomaly detector ({ml_method})",
            "detail": ml_result.get("ml_anomaly_reason"),
        }
    else:
        fallback_pts = _rule_points(rule_result, {"Financial-Physical Mismatch", "Cost Overrun"})
        fallback_max = rule_engine.WEIGHTS["MISMATCH"] + rule_engine.WEIGHTS["OVERRUN"]
        signals["financial_anomaly"] = {
            "value": _clamp((fallback_pts / fallback_max) * 100) if fallback_max else 0.0,
            "available": True,
            "source": "Rule-based fallback (too few loaded projects to train the ML model)",
            "detail": "The Isolation Forest anomaly model needs more loaded projects to run reliably.",
        }

    # 2. Physical-financial progress gap — always directly computable.
    gap = max(0.0, financial - physical)
    signals["physical_financial_gap"] = {
        "value": _clamp(min(gap / 60, 1) * 100),
        "available": True,
        "source": "Direct calculation",
        "detail": f"Financial progress {financial:.1f}% vs physical progress {physical:.1f}% "
                  f"(gap {gap:.1f} points).",
    }

    # 3. Compliance deviation
    comp_score = compliance_result.get("compliance_score")
    if comp_score is not None:
        signals["compliance_deviation"] = {
            "value": _clamp(100 - float(comp_score)),
            "available": True,
            "source": "Compliance engine",
            "detail": compliance_result.get("compliance_explanation"),
        }
    else:
        signals["compliance_deviation"] = {
            "value": 0.0, "available": False,
            "source": "Compliance engine", "detail": "Not computed for this request.",
        }

    # 4. Duplicate / similarity evidence — the higher of the text-similarity
    #    duplicate detector and any field-photo near-duplicate signal.
    dup_score = duplicate_result.get("duplicate_similarity_score") or 0
    photo_score = photo_evidence_result.get("similarity_score") or 0
    top_score = max(float(dup_score), float(photo_score))
    detail = duplicate_result.get("duplicate_reason") or "No significant duplicate/similarity evidence."
    if photo_score > dup_score:
        detail = photo_evidence_result.get("similarity_reason", detail)
    signals["duplicate_evidence"] = {
        "value": _clamp(top_score),
        "available": True,
        "source": "Duplicate/similarity detector + field photo evidence",
        "detail": detail,
    }

    # 5. Delay risk
    delay_prob = delay_result.get("delay_probability")
    if delay_prob is not None:
        signals["delay_risk"] = {
            "value": _clamp(float(delay_prob) * 100), "available": True,
            "source": "Delay prediction model", "detail": delay_result.get("model_notes"),
        }
    else:
        overdue_days = rule_engine.days_overdue(project)
        val = _clamp(min(overdue_days / 180, 1) * 100) if rule_engine.is_overdue(project) else 0.0
        signals["delay_risk"] = {
            "value": val, "available": True,
            "source": "Rule-based fallback (insufficient data to train the delay model)",
            "detail": f"{overdue_days} day(s) overdue." if overdue_days else "Not currently overdue.",
        }

    # 6. Cost overrun risk
    overrun_prob = overrun_result.get("cost_overrun_probability")
    if overrun_prob is not None:
        signals["cost_overrun_risk"] = {
            "value": _clamp(float(overrun_prob) * 100), "available": True,
            "source": "Cost-overrun prediction model", "detail": None,
        }
    else:
        if sanctioned > 0 and spent > sanctioned:
            overrun_pct = ((spent - sanctioned) / sanctioned) * 100
            val = _clamp(min(overrun_pct / 40, 1) * 100)
            detail = f"Expenditure exceeds sanctioned amount by {overrun_pct:.1f}%."
        else:
            val, detail = 0.0, "No cost overrun."
        signals["cost_overrun_risk"] = {
            "value": val, "available": True,
            "source": "Rule-based fallback (prediction model unavailable on current dataset)",
            "detail": detail,
        }

    # 7. Everything else the rule engine catches that isn't already folded
    #    into a signal above (payment pattern, stalled progress, high
    #    utilization, the rule engine's own duplicate-name heuristic).
    other_names = {
        "Suspicious Payment Pattern", "Very Low Physical Progress",
        "High Expenditure Utilization", "Duplicate/Similar Work Indicator",
    }
    other_pts = _rule_points(rule_result, other_names)
    other_max = (rule_engine.WEIGHTS["PAYMENT_ANOMALY"] + rule_engine.WEIGHTS["LOW_PROGRESS"]
                 + rule_engine.WEIGHTS["HIGH_UTILIZATION"] + rule_engine.WEIGHTS["DUPLICATE_WORK"])
    signals["other_signals"] = {
        "value": _clamp((other_pts / other_max) * 100) if other_max else 0.0,
        "available": True,
        "source": "Rule engine (payment pattern, stalled progress, utilization, name-similarity)",
        "detail": None,
    }

    # ---- Weighted combination, redistributing any unavailable signal's
    #      weight across the signals that ARE available. ----
    available_weight = sum(SIGNAL_WEIGHTS[k] for k, s in signals.items() if s["available"])
    if available_weight <= 0:
        final_score = 0.0
    else:
        weighted_sum = sum(SIGNAL_WEIGHTS[k] * s["value"] for k, s in signals.items() if s["available"])
        final_score = weighted_sum / available_weight

    final_score = round(_clamp(final_score))
    level = get_multi_signal_level(final_score)

    contributing_factors = []
    for key, s in signals.items():
        effective_weight = (SIGNAL_WEIGHTS[key] / available_weight * 100) if available_weight else 0.0
        contribution = (SIGNAL_WEIGHTS[key] / available_weight * s["value"]) if available_weight and s["available"] else 0.0
        contributing_factors.append({
            "signal": key,
            "label": SIGNAL_LABELS.get(key, key),
            "configured_weight_pct": SIGNAL_WEIGHTS[key],
            "effective_weight_pct": round(effective_weight, 1),
            "signal_value_0_100": round(s["value"], 1),
            "contribution_points": round(contribution, 1),
            "available": s["available"],
            "source": s["source"],
            "detail": s["detail"],
        })
    contributing_factors.sort(key=lambda f: f["contribution_points"], reverse=True)

    unavailable = [SIGNAL_LABELS[k] for k, s in signals.items() if not s["available"]]

    if final_score == 0:
        explanation = ("No significant multi-signal risk indicators detected across financial, "
                        "compliance, ML and duplicate checks.")
    else:
        top = contributing_factors[0]
        explanation = f"Risk driven primarily by {top['label'].lower()} ({top['contribution_points']} of {final_score} points)."

    action_level = level if level in ("Low", "Medium", "High", "Critical") else "Medium"

    return {
        "score": final_score,
        "level": level,
        "contributing_factors": contributing_factors,
        "unavailable_signals": unavailable,
        "explanation": explanation,
        "recommended_action": rule_engine.get_recommended_action(action_level),
        "engine": "weighted_multi_signal_v1",
        "disclaimer": (
            "Explainable weighted-signal prototype, not a single trained fraud-detection model. "
            "The ML anomaly, delay and cost-overrun signals ARE genuinely computed models where the "
            "loaded dataset is large enough to support them; where it is not, a clearly labeled "
            "rule-based fallback is used instead of a fabricated model output."
        ),
    }
