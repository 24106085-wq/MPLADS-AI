# backend/duplicate_detector.py
"""
MPLADS Duplicate / Similar-Work Detector — Milestone 2, Part B.

Improves on the existing word-overlap heuristic used inside
risk_engine.py (_find_similar_work / find_duplicate_matches /
detect_duplicate_works) by combining:

  1. TF-IDF + cosine similarity over each project's text fields
     (work description, category, implementing agency), instead of a
     simple "shared significant words" overlap ratio.
  2. A location agreement signal (same district/state).
  3. A sanctioned-amount closeness signal.

This module is ADDITIVE and self-contained:
- risk_engine.py's own duplicate signal (used inside calculate_risk()'s
  "Duplicate/Similar Work Indicator" factor, and in
  detect_duplicate_works()) is left completely unchanged, so the
  existing risk score is not affected.
- It only reads fields that already exist in the dataset — no field is
  invented.

Terminology deliberately avoids asserting fraud or a confirmed
duplicate: results are always labelled "Potential Duplicate" or
"Similar Work — Review Required", never "duplicate" as a fact.
"""

import re
from typing import List, Optional

import numpy as np

try:
    from sklearn.feature_extraction.text import TfidfVectorizer
    from sklearn.metrics.pairwise import cosine_similarity

    _SKLEARN_TEXT_AVAILABLE = True
except ImportError:  # pragma: no cover - sklearn is a declared dependency
    _SKLEARN_TEXT_AVAILABLE = False

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

TEXT_WEIGHT = 0.70
LOCATION_WEIGHT = 0.15
AMOUNT_WEIGHT = 0.15

# Combined-score thresholds (0-1 scale internally, reported as 0-100).
SIMILAR_WORK_THRESHOLD = 0.35  # "Similar Work — Review Required"
POSSIBLE_DUPLICATE_THRESHOLD = 0.55  # "Potential Duplicate"

MAX_MATCHES_RETURNED = 5


# ---------------------------------------------------------------------------
# Feature helpers
# ---------------------------------------------------------------------------


def _project_text(project: dict) -> str:
    parts = [
        project.get("workName") or "",
        project.get("category") or "",
        project.get("implementingAgency") or "",
    ]
    return " ".join(str(p) for p in parts if p).strip()


def _normalize_text(s: str) -> str:
    s = (s or "").lower()
    s = re.sub(r"[^a-z0-9 ]", "", s)
    return re.sub(r"\s+", " ", s).strip()


def _significant_words(s: str) -> set:
    return {w for w in _normalize_text(s).split(" ") if len(w) > 3}


def _location_score(a: dict, b: dict) -> float:
    if not a.get("district") or not a.get("state"):
        return 0.0
    same_state = a.get("state") == b.get("state")
    same_district = a.get("district") == b.get("district")
    if same_district and same_state:
        return 1.0
    if same_state:
        return 0.4
    return 0.0


def _amount_score(a: dict, b: dict) -> float:
    try:
        sa = float(a.get("sanctionedAmount") or 0)
        sb = float(b.get("sanctionedAmount") or 0)
    except (TypeError, ValueError):
        return 0.0
    if sa <= 0 or sb <= 0:
        return 0.0
    diff_ratio = abs(sa - sb) / max(sa, sb)
    return max(0.0, 1 - diff_ratio / 0.3)  # 1.0 at identical, 0.0 at >=30% apart


def _word_overlap_matrix(texts: List[str]) -> np.ndarray:
    """Legacy-style Jaccard-ish overlap, used as a safety-net fallback when
    TF-IDF isn't available or degenerates (e.g. all-empty text)."""
    n = len(texts)
    sim = np.zeros((n, n))
    word_sets = [_significant_words(t) for t in texts]
    for i in range(n):
        sim[i, i] = 1.0
        for j in range(i + 1, n):
            wi, wj = word_sets[i], word_sets[j]
            if not wi or not wj:
                continue
            overlap = len(wi & wj) / min(len(wi), len(wj))
            sim[i, j] = overlap
            sim[j, i] = overlap
    return sim


def _text_similarity_matrix(all_projects: list) -> np.ndarray:
    texts = [_project_text(p) for p in all_projects]
    n = len(texts)
    if _SKLEARN_TEXT_AVAILABLE and n >= 2 and any(texts):
        try:
            vectorizer = TfidfVectorizer(stop_words="english", min_df=1)
            tfidf = vectorizer.fit_transform(texts)
            if tfidf.shape[1] > 0:
                return cosine_similarity(tfidf)
        except ValueError:
            pass  # e.g. vocabulary is empty after stop-word removal
    return _word_overlap_matrix(texts)


def _matched_fields(text_sim: float, loc_sim: float, amount_sim: float, a: dict, b: dict) -> List[str]:
    fields = []
    if text_sim >= 0.3:
        fields.append("Work Description")
    if loc_sim >= 0.9:
        fields.append("District")
    elif loc_sim > 0:
        fields.append("State")
    if amount_sim >= 0.7:
        fields.append("Sanctioned Amount")
    if a.get("category") and a.get("category") == b.get("category"):
        fields.append("Category")
    return fields or ["Text Similarity"]


def _empty_result(reason: str) -> dict:
    return {
        "duplicate_similarity_score": 0.0,
        "possible_duplicate": False,
        "matched_project_ids": [],
        "duplicate_reason": reason,
        "duplicate_matches": [],
    }


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def compute_duplicate_matches(all_projects: list) -> dict:
    """Runs duplicate/similar-work detection over the currently loaded
    project set and returns a dict keyed by project id, e.g.:

        {
          "MPLADS-2024-0003": {
            "duplicate_similarity_score": 78.4,
            "possible_duplicate": True,
            "matched_project_ids": ["MPLADS-2024-0007"],
            "duplicate_reason": "Potential Duplicate — 78.4% similar to
                MPLADS-2024-0007 (Work Description, District). Requires
                review.",
            "duplicate_matches": [ {project_id, work_name, similarity,
                matched_fields}, ... up to 5, most similar first ],
          },
          ...
        }

    Never raises on missing/small/malformed data.
    """
    results: dict = {}
    n = len(all_projects)

    if n < 2:
        for p in all_projects:
            results[p["id"]] = _empty_result(
                "Insufficient data for duplicate comparison (fewer than 2 projects loaded)."
            )
        return results

    sim_matrix = _text_similarity_matrix(all_projects)

    for i, project in enumerate(all_projects):
        matches = []
        for j, other in enumerate(all_projects):
            if i == j:
                continue
            text_sim = float(sim_matrix[i, j])
            loc_sim = _location_score(project, other)
            amount_sim = _amount_score(project, other)
            combined = TEXT_WEIGHT * text_sim + LOCATION_WEIGHT * loc_sim + AMOUNT_WEIGHT * amount_sim
            if combined < SIMILAR_WORK_THRESHOLD:
                continue
            matches.append(
                {
                    "project_id": other.get("id"),
                    "work_name": other.get("workName"),
                    "similarity": round(combined * 100, 1),
                    "matched_fields": _matched_fields(text_sim, loc_sim, amount_sim, project, other),
                }
            )

        matches.sort(key=lambda m: m["similarity"], reverse=True)
        top_matches = matches[:MAX_MATCHES_RETURNED]
        top = top_matches[0] if top_matches else None

        if top is None:
            results[project["id"]] = _empty_result("No similar or duplicate work detected.")
            continue

        possible_duplicate = top["similarity"] >= POSSIBLE_DUPLICATE_THRESHOLD * 100
        label = "Potential Duplicate" if possible_duplicate else "Similar Work — Review Required"
        reason = (
            f"{label} — {top['similarity']}% similar to {top['project_id']} "
            f"({', '.join(top['matched_fields'])})."
        )

        results[project["id"]] = {
            "duplicate_similarity_score": top["similarity"],
            "possible_duplicate": possible_duplicate,
            "matched_project_ids": [m["project_id"] for m in top_matches],
            "duplicate_reason": reason,
            "duplicate_matches": top_matches,
        }

    return results


def compute_duplicates_for_project(project: dict, all_projects: list) -> dict:
    """Convenience wrapper for a single-project endpoint — runs detection
    over the full currently loaded set, then returns just this project's
    entry."""
    all_results = compute_duplicate_matches(all_projects)
    return all_results.get(
        project.get("id"),
        _empty_result("No similar or duplicate work detected."),
    )
