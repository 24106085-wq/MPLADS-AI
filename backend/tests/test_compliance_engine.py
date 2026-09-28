# backend/tests/test_compliance_engine.py
"""
A pass/flag pair for each of the compliance rules that matter most:
required-fields, financial consistency, progress consistency, and status
consistency. Each pair shows the same shape of project just past the
boundary that should trip the check.
"""
import compliance_engine as compliance


def _base_project(**overrides):
    project = {
        "id": "C1",
        "workName": "Water Tank Construction",
        "mpName": "Test MP",
        "constituency": "Test Constituency",
        "state": "Maharashtra",
        "district": "Thane",
        "category": "Water",
        "implementingAgency": "PWD",
        "sanctionedAmount": 500_000,
        "expenditure": 250_000,
        "physicalProgress": 50,
        "status": "In Progress",
        "startDate": "2024-01-01",
        "expectedCompletion": "2026-12-31",
        "paymentCount": 3,
    }
    project.update(overrides)
    return project


def test_fully_populated_project_is_compliant():
    project = _base_project()

    result = compliance.evaluate_compliance(project, [project])

    assert result["compliance_score"] == 100
    assert result["compliance_status"] == "COMPLIANT"
    assert result["failed_checks"] == []


def test_missing_required_fields_are_flagged():
    project = _base_project(workName="")

    result = compliance.evaluate_compliance(project, [project])

    assert "Required Project Information" in result["failed_checks"]
    assert result["compliance_score"] < 100


def test_expenditure_within_sanctioned_amount_passes_financial_check():
    project = _base_project(expenditure=250_000, sanctionedAmount=500_000)

    result = compliance.evaluate_compliance(project, [project])

    assert "Financial Consistency — Expenditure vs Sanctioned" in result["passed_checks"]


def test_expenditure_exceeding_sanctioned_amount_is_flagged():
    project = _base_project(expenditure=700_000, sanctionedAmount=500_000)

    result = compliance.evaluate_compliance(project, [project])

    assert "Financial Consistency — Expenditure vs Sanctioned" in result["failed_checks"]
    assert result["compliance_status"] in ("REQUIRES_REVIEW", "NON_COMPLIANT")


def test_completed_project_with_full_progress_passes_status_check():
    project = _base_project(
        status="Completed", physicalProgress=95, expenditure=475_000, sanctionedAmount=500_000
    )

    result = compliance.evaluate_compliance(project, [project])

    assert (
        "Status Consistency — Completed with Low Physical Progress"
        in result["passed_checks"]
    )


def test_completed_project_with_low_physical_progress_is_flagged():
    project = _base_project(
        status="Completed", physicalProgress=40, expenditure=500_000, sanctionedAmount=500_000
    )

    result = compliance.evaluate_compliance(project, [project])

    assert (
        "Status Consistency — Completed with Low Physical Progress"
        in result["failed_checks"]
    )
