"""Tests for soiling analysis caching and backfill endpoints.

Tests the three soiling endpoints:
- GET  /api/py/analyze/soiling          — return cached result or 404
- POST /api/py/analyze/soiling/run      — compute if stale, return cached if fresh
- POST /api/py/analyze/soiling/backfill — force full recomputation
"""

import pytest
from unittest.mock import patch, AsyncMock, MagicMock
from datetime import date

from fastapi.testclient import TestClient
from api.py.index import app


@pytest.fixture
def client():
    return TestClient(app)


@pytest.fixture
def mock_system():
    return {
        "id": "sys-1",
        "system_name": "Test System",
        "site_id": "12345",
        "latitude": 31.33,
        "longitude": 34.89,
        "peak_power_kwp": 15.84,
        "azimuth": 180,
        "tilt": 20,
        "altitude": 350,
        "installation_date": "2020-01-01",
        "electricity_price_per_kwh": 0.48,
        "currency": "ILS",
        "last_synced_at": None,
    }


HEADERS = {"Authorization": "Bearer test-token"}

FAKE_CACHED_RESULT = {
    "id": "result-1",
    "system_id": "sys-1",
    "worker_id": "soiling_analysis",
    "coverage_hash": "abc123",
    "data_start": "2024-01-01",
    "data_end": "2025-01-01",
    "summary": {
        "summary": {"current_sr": 0.95, "current_loss_pct": 5.0},
        "monetary": {"total_lost_money": 100},
    },
    "daily_data": [{"date": "2024-06-01", "soiling_ratio": 0.95}],
    "events": [{"date": "2024-03-15", "type": "rain"}],
    "computed_at": "2025-01-01T00:00:00Z",
}

FAKE_COVERAGE_ROWS = [
    {"period_start": "2024-01-01", "period_end": "2024-06-30", "status": "fetched"},
    {"period_start": "2024-07-01", "period_end": "2024-12-31", "status": "fetched"},
]


class TestGetSoilingCached:
    """GET /api/py/analyze/soiling — return cached or 404."""

    @patch("api.py.index._get_system")
    @patch("api.py.analysis_service.AnalysisCache.get_cached")
    def test_returns_404_when_no_cache(self, mock_get_cached, mock_get_system, client, mock_system):
        mock_get_system.return_value = mock_system
        mock_get_cached.return_value = None

        resp = client.get("/api/py/analyze/soiling", headers=HEADERS)
        assert resp.status_code == 404
        assert "Run it" in resp.json()["detail"] or "No soiling" in resp.json()["detail"]

    @patch("api.py.index._get_system")
    @patch("api.py.analysis_service.AnalysisCache.get_coverage_rows")
    @patch("api.py.analysis_service.AnalysisCache.get_cached")
    def test_returns_404_when_cache_stale(
        self, mock_get_cached, mock_get_coverage, mock_get_system, client, mock_system
    ):
        mock_get_system.return_value = mock_system
        mock_get_cached.return_value = {**FAKE_CACHED_RESULT, "coverage_hash": "old_hash"}
        mock_get_coverage.return_value = FAKE_COVERAGE_ROWS

        resp = client.get("/api/py/analyze/soiling", headers=HEADERS)
        assert resp.status_code == 404
        assert "outdated" in resp.json()["detail"]

    @patch("api.py.index._get_system")
    @patch("api.py.analysis_service.AnalysisCache.get_coverage_rows")
    @patch("api.py.analysis_service.AnalysisCache.get_cached")
    @patch("api.py.analysis_service.compute_coverage_hash")
    def test_returns_cached_result_when_fresh(
        self, mock_hash, mock_get_cached, mock_get_coverage, mock_get_system, client, mock_system
    ):
        mock_get_system.return_value = mock_system
        mock_hash.return_value = "abc123"
        mock_get_cached.return_value = FAKE_CACHED_RESULT
        mock_get_coverage.return_value = FAKE_COVERAGE_ROWS

        resp = client.get("/api/py/analyze/soiling", headers=HEADERS)
        assert resp.status_code == 200
        data = resp.json()
        assert data["cached"] is True
        assert "system" in data
        assert data["analyzed_at"] == "2025-01-01T00:00:00Z"

    def test_returns_401_without_token(self, client):
        resp = client.get("/api/py/analyze/soiling")
        assert resp.status_code == 401


class TestRunSoiling:
    """POST /api/py/analyze/soiling/run — compute if stale, cache if fresh."""

    @patch("api.py.index._get_system")
    @patch("api.py.analysis_service.AnalysisCache.get_cached")
    @patch("api.py.analysis_service.AnalysisCache.get_coverage_rows")
    @patch("api.py.analysis_service.compute_coverage_hash")
    def test_returns_cached_when_fresh(
        self, mock_hash, mock_get_coverage, mock_get_cached, mock_get_system, client, mock_system
    ):
        mock_get_system.return_value = mock_system
        mock_hash.return_value = "abc123"
        mock_get_coverage.return_value = FAKE_COVERAGE_ROWS
        mock_get_cached.return_value = FAKE_CACHED_RESULT

        resp = client.post("/api/py/analyze/soiling/run", headers=HEADERS)
        assert resp.status_code == 200
        assert resp.json()["cached"] is True

    @patch("api.py.index._get_system")
    @patch("api.py.analysis_service.AnalysisCache.save")
    @patch("api.py.analysis_service.AnalysisCache.get_cached")
    @patch("api.py.analysis_service.AnalysisCache.get_coverage_rows")
    @patch("api.py.analysis_service.compute_coverage_hash")
    @patch("api.py.index._run_soiling_analysis")
    def test_computes_and_caches_when_stale(
        self, mock_run, mock_hash, mock_get_coverage, mock_get_cached, mock_save,
        mock_get_system, client, mock_system
    ):
        mock_get_system.return_value = mock_system
        mock_hash.return_value = "new_hash"
        mock_get_coverage.return_value = FAKE_COVERAGE_ROWS
        mock_get_cached.return_value = {**FAKE_CACHED_RESULT, "coverage_hash": "old_hash"}
        mock_run.return_value = {
            "summary": {"current_sr": 0.90},
            "daily": [],
            "events": [],
            "monetary": {},
            "analyzed_at": "2025-06-01T00:00:00Z",
        }

        resp = client.post("/api/py/analyze/soiling/run", headers=HEADERS)
        assert resp.status_code == 200
        assert resp.json()["cached"] is False
        mock_save.assert_called_once()

    @patch("api.py.index._get_system")
    @patch("api.py.analysis_service.AnalysisCache.save")
    @patch("api.py.analysis_service.AnalysisCache.get_cached")
    @patch("api.py.analysis_service.AnalysisCache.get_coverage_rows")
    @patch("api.py.analysis_service.compute_coverage_hash")
    @patch("api.py.index._run_soiling_analysis")
    def test_computes_when_no_cache_exists(
        self, mock_run, mock_hash, mock_get_coverage, mock_get_cached, mock_save,
        mock_get_system, client, mock_system
    ):
        mock_get_system.return_value = mock_system
        mock_hash.return_value = "some_hash"
        mock_get_coverage.return_value = FAKE_COVERAGE_ROWS
        mock_get_cached.return_value = None  # no cache
        mock_run.return_value = {
            "summary": {"current_sr": 0.92},
            "daily": [],
            "events": [],
            "monetary": {},
            "analyzed_at": "2025-06-01T00:00:00Z",
        }

        resp = client.post("/api/py/analyze/soiling/run", headers=HEADERS)
        assert resp.status_code == 200
        assert resp.json()["cached"] is False
        mock_save.assert_called_once()


class TestBackfillSoiling:
    """POST /api/py/analyze/soiling/backfill — force recomputation."""

    @patch("api.py.index._get_system")
    @patch("api.py.analysis_service.AnalysisCache.save")
    @patch("api.py.analysis_service.AnalysisCache.delete")
    @patch("api.py.analysis_service.AnalysisCache.get_coverage_rows")
    @patch("api.py.analysis_service.compute_coverage_hash")
    @patch("api.py.index._run_soiling_analysis")
    def test_deletes_cache_and_recomputes(
        self, mock_run, mock_hash, mock_get_coverage, mock_delete, mock_save,
        mock_get_system, client, mock_system
    ):
        mock_get_system.return_value = mock_system
        mock_hash.return_value = "hash_after"
        mock_get_coverage.return_value = FAKE_COVERAGE_ROWS
        mock_run.return_value = {
            "summary": {"current_sr": 0.88},
            "daily": [{"date": "2024-01-01"}],
            "events": [],
            "monetary": {},
            "analyzed_at": "2025-06-01T00:00:00Z",
        }

        resp = client.post("/api/py/analyze/soiling/backfill", headers=HEADERS)
        assert resp.status_code == 200
        data = resp.json()
        assert data["cached"] is False
        assert data["backfilled"] is True

        # Verify cache was deleted before recomputation
        mock_delete.assert_called_once_with("sys-1", "soiling_analysis")
        mock_save.assert_called_once()

    @patch("api.py.index._get_system")
    @patch("api.py.analysis_service.AnalysisCache.save")
    @patch("api.py.analysis_service.AnalysisCache.delete")
    @patch("api.py.analysis_service.AnalysisCache.get_coverage_rows")
    @patch("api.py.analysis_service.compute_coverage_hash")
    @patch("api.py.index._run_soiling_analysis")
    def test_backfill_always_recomputes_even_if_cache_fresh(
        self, mock_run, mock_hash, mock_get_coverage, mock_delete, mock_save,
        mock_get_system, client, mock_system
    ):
        """Backfill should NOT short-circuit even if cache hash matches."""
        mock_get_system.return_value = mock_system
        mock_hash.return_value = "same_hash"
        mock_get_coverage.return_value = FAKE_COVERAGE_ROWS
        mock_run.return_value = {
            "summary": {"current_sr": 0.91},
            "daily": [],
            "events": [],
            "monetary": {},
            "analyzed_at": "2025-06-01T00:00:00Z",
        }

        resp = client.post("/api/py/analyze/soiling/backfill", headers=HEADERS)
        assert resp.status_code == 200
        # Backfill always runs the analysis
        mock_run.assert_called_once()
        mock_delete.assert_called_once()
        mock_save.assert_called_once()

    def test_returns_401_without_token(self, client):
        resp = client.post("/api/py/analyze/soiling/backfill")
        assert resp.status_code == 401

    @patch("api.py.index._get_system")
    def test_returns_400_without_coords(self, mock_get_system, client, mock_system):
        mock_system["latitude"] = None
        mock_get_system.return_value = mock_system

        resp = client.post("/api/py/analyze/soiling/backfill", headers=HEADERS)
        assert resp.status_code == 400
