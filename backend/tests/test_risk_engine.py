# backend/tests/test_risk_engine.py
"""
Sanity checks for risk_engine.calculate_risk(): feed known project inputs,
assert the score and risk-level bucket they land in. Not exhaustive — just
enough to demonstrate the deterministic scoring behaves as documented.
"""
from datetime import date, timedelta

import risk_engine as engine


def test_healthy_project_scores_zero_and_low():
    """Spend matches physical progress, nothing overdue -> no risk factors."""
    project = {
        "id": "P1",
        "workName": "Community Hall Construction",
        "state": "Maharashtra",
        "district": "Thane",
        "sanctionedAmount": 1_000_000,
        "expenditure": 500_000,
        "physicalProgress": 50,
        "status": "In Progress",
        "paymentCount": 3,
    }

    result = engine.calculate_risk(project, [project])

    assert result["score"] == 0
    assert result["level"] == "Low"
    assert result["factors"] == []


def test_overrun_and_stalled_progress_scores_medium():
    """Cost overrun + a big financial/physical gap + low progress should
    trip three named factors and land in the Medium band (40-59)."""
    project = {
        "id": "P2",
        "workName": "Road Widening Project",
        "state": "Maharashtra",
        "district": "Pune",
        "sanctionedAmount": 1_000_000,
        "expenditure": 1_200_000,
        "physicalProgress": 10,
        "status": "In Progress",
        "paymentCount": 3,
    }

    result = engine.calculate_risk(project, [project])

    assert result["score"] == 50
    assert result["level"] == "Medium"
    factor_names = {f["name"] for f in result["factors"]}
    assert factor_names == {
        "Financial-Physical Mismatch",
        "Cost Overrun",
        "Very Low Physical Progress",
        "High Expenditure Utilization",
    }


def test_severely_overdue_overrun_project_scores_critical():
    """Stack every major factor (mismatch, overrun, long overdue delay,
    stalled progress, high utilization, fragmented payments) -> Critical."""
    overdue_date = (date.today() - timedelta(days=200)).isoformat()
    project = {
        "id": "P3",
        "workName": "Bridge Construction",
        "state": "Maharashtra",
        "district": "Nashik",
        "sanctionedAmount": 1_000_000,
        "expenditure": 1_300_000,
        "physicalProgress": 5,
        "status": "In Progress",
        "paymentCount": 20,
        "expectedCompletion": overdue_date,
    }

    result = engine.calculate_risk(project, [project])

    assert result["score"] == 83
    assert result["level"] == "Critical"
    assert "Implementation Delay" in {f["name"] for f in result["factors"]}


def test_duplicate_work_indicator_flags_similar_named_project_same_district():
    """Two projects in the same district with highly overlapping work
    names should trip the Duplicate/Similar Work factor for both."""
    project_a = {
        "id": "A1",
        "workName": "Construction of Community Health Centre Building",
        "state": "Maharashtra",
        "district": "Thane",
        "sanctionedAmount": 500_000,
        "expenditure": 100_000,
        "physicalProgress": 20,
        "status": "In Progress",
        "paymentCount": 3,
    }
    project_b = {
        **project_a,
        "id": "A2",
        "workName": "Construction of Community Health Centre Building Phase",
    }

    result = engine.calculate_risk(project_a, [project_a, project_b])

    assert result["score"] == 10
    assert [f["name"] for f in result["factors"]] == ["Duplicate/Similar Work Indicator"]
