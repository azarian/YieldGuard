"""Integration test for the /api/py/analyze/losses endpoint.

Uses FastAPI TestClient with mocked service layer to test the endpoint
wiring without needing a real database or SolarEdge API.
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
def mock_system_row():
    return {
        "id": "test-sys-id",
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


class TestAnalyzeLossesEndpoint:
    def test_returns_401_without_token(self, client):
        resp = client.get("/api/py/analyze/soiling")
        assert resp.status_code == 401

    def test_returns_401_with_bad_token(self, client):
        resp = client.get("/api/py/analyze/soiling", headers={"Authorization": "Token xyz"})
        assert resp.status_code == 401

    @patch("api.py.index._get_system")
    def test_returns_soiling_response(
        self, mock_get_system, client, mock_system_row, sample_result,
    ):
        mock_get_system.return_value = mock_system_row

        with patch("api.py.analysis_service.SiteDataLoader") as MockLoader, \
             patch("api.py.analysis_service.AnalysisOrchestrator") as MockOrch:

            loader_inst = MagicMock()
            loader_inst.load_site_energy = AsyncMock(return_value=MagicMock())
            loader_inst.load_precipitation = AsyncMock(return_value=MagicMock())
            MockLoader.return_value = loader_inst

            MockOrch.run = AsyncMock(return_value=sample_result)

            resp = client.get(
                "/api/py/analyze/soiling",
                headers={"Authorization": "Bearer test-token"},
            )

        assert resp.status_code == 200
        data = resp.json()
        assert "system" in data
        assert "summary" in data
        assert "daily" in data
        assert "events" in data
        assert "monetary" in data

    @patch("api.py.index._get_system")
    def test_returns_400_when_missing_coords(self, mock_get_system, client, mock_system_row):
        mock_system_row["latitude"] = None
        mock_get_system.return_value = mock_system_row

        resp = client.get(
            "/api/py/analyze/soiling",
            headers={"Authorization": "Bearer test-token"},
        )
        assert resp.status_code == 400
        assert "latitude" in resp.json()["detail"].lower() or "sync" in resp.json()["detail"].lower()
