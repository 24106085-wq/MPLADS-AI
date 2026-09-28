# backend/tests/test_duplicate_detector.py
"""
One true-positive pair (near-identical work in the same district -> should
match) and one true-negative pair (same district/similar budget, but a
genuinely different work -> should NOT match), to show the detector is
weighing text similarity rather than just flagging every same-district pair.
"""
import duplicate_detector as dd


def test_near_identical_work_in_same_district_is_flagged_as_duplicate():
    project_a = {
        "id": "D1",
        "workName": "Construction of Primary Health Centre Building",
        "state": "Maharashtra",
        "district": "Thane",
        "category": "Health",
        "implementingAgency": "PWD",
        "sanctionedAmount": 800_000,
    }
    project_b = {
        "id": "D2",
        "workName": "Construction of Primary Health Centre Building Extension",
        "state": "Maharashtra",
        "district": "Thane",
        "category": "Health",
        "implementingAgency": "PWD",
        "sanctionedAmount": 820_000,
    }

    results = dd.compute_duplicate_matches([project_a, project_b])

    assert results["D1"]["possible_duplicate"] is True
    assert results["D1"]["matched_project_ids"] == ["D2"]
    assert results["D1"]["duplicate_similarity_score"] > 55  # POSSIBLE_DUPLICATE_THRESHOLD


def test_different_work_same_district_and_similar_amount_is_not_flagged():
    """Same district and a similar sanctioned amount alone must not be
    enough to trigger a match — the work itself has to be similar too."""
    project_a = {
        "id": "D1",
        "workName": "Construction of Primary Health Centre Building",
        "state": "Maharashtra",
        "district": "Thane",
        "category": "Health",
        "implementingAgency": "PWD",
        "sanctionedAmount": 800_000,
    }
    project_c = {
        "id": "D5",
        "workName": "Renovation of Government School Playground",
        "state": "Maharashtra",
        "district": "Thane",
        "category": "Education",
        "implementingAgency": "ZP",
        "sanctionedAmount": 790_000,
    }

    results = dd.compute_duplicate_matches([project_a, project_c])

    assert results["D5"]["possible_duplicate"] is False
    assert results["D5"]["matched_project_ids"] == []
