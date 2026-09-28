# backend/tests/conftest.py
"""
The backend modules (risk_engine.py, compliance_engine.py, etc.) use flat,
package-free imports (e.g. `import risk_engine`), matching how main.py
imports them. This conftest just puts backend/ on sys.path so `pytest`
works the same way regardless of which directory it's invoked from.
"""
import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

import pytest  # noqa: E402  (import after sys.path fix-up, matching module convention above)

import db  # noqa: E402


@pytest.fixture
def db_path(tmp_path):
    """Points db.py at a fresh, throwaway SQLite file for the duration of a
    test, so tests that exercise persistence (feedback, model metadata,
    retraining history) never touch a real dev/demo database and never
    leak state between tests."""
    original = db.DB_PATH
    db.DB_PATH = str(tmp_path / "test_mplads.db")
    yield db.DB_PATH
    db.DB_PATH = original
