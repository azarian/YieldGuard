"""Tests for daily energy aggregation from equipment telemetry.

Validates:
- energy_wh in equipment_telemetry is a CUMULATIVE lifetime counter — NOT used
- Daily energy is computed from power_w × interval_hours (dynamic interval)
- SolarEdge equipment API returns ~5-min intervals, not 15-min
- Only inverter data is used (not optimizers, to avoid double-counting)
"""

import pytest
from unittest.mock import patch, AsyncMock
from fastapi.testclient import TestClient

from api.py.index import app


@pytest.fixture
def client():
    return TestClient(app)


def make_telemetry_row(ts: str, power_w: float, energy_wh: float = 0) -> dict:
    """Build a telemetry row as returned by Supabase."""
    return {"ts": ts, "power_w": power_w, "energy_wh": energy_wh}


def mock_system():
    return {
        "id": "sys-1",
        "system_name": "Test",
        "site_id": "123",
        "last_synced_at": "2024-01-07",
    }


class TestDailyEnergyAggregation:
    """Test the /api/py/analyze endpoint's fallback daily energy aggregation."""

    @patch("api.py.index._get_system")
    @patch("api.py.index._supabase_query")
    def test_15min_intervals_computed_correctly(self, mock_query, mock_get_system, client):
        """15-min spaced readings use dynamic interval computation."""
        mock_get_system.return_value = mock_system()

        # 5 readings at 15-min intervals so all 4 active readings have a "next" for interval calc
        telemetry = [
            make_telemetry_row("2024-01-05T08:00:00+00:00", 1000),
            make_telemetry_row("2024-01-05T08:15:00+00:00", 2000),
            make_telemetry_row("2024-01-05T08:30:00+00:00", 3000),
            make_telemetry_row("2024-01-05T08:45:00+00:00", 4000),
            make_telemetry_row("2024-01-05T09:00:00+00:00", 0),  # next reading (zero, just for interval)
        ]

        async def side_effect(token, table, params=None):
            if table == "daily_energy":
                return []
            if table == "equipment":
                return [{"id": "eq-1"}]
            if table == "equipment_telemetry":
                return telemetry
            return []

        mock_query.side_effect = side_effect
        resp = client.get("/api/py/analyze", headers={"Authorization": "Bearer t"})

        assert resp.status_code == 200
        daily = resp.json()["analysis"]["energy"]["daily_values"]
        assert len(daily) == 1
        # 1000×0.25 + 2000×0.25 + 3000×0.25 + 4000×0.25 = 2500 Wh = 2.5 kWh
        assert daily[0]["kwh"] == 2.5

    @patch("api.py.index._get_system")
    @patch("api.py.index._supabase_query")
    def test_5min_intervals_computed_correctly(self, mock_query, mock_get_system, client):
        """5-min spaced readings (actual SolarEdge equipment API interval)."""
        mock_get_system.return_value = mock_system()

        # 6 readings at 5-min intervals, all 6000W
        telemetry = [
            make_telemetry_row("2024-01-05T10:00:00+00:00", 6000),
            make_telemetry_row("2024-01-05T10:05:00+00:00", 6000),
            make_telemetry_row("2024-01-05T10:10:00+00:00", 6000),
            make_telemetry_row("2024-01-05T10:15:00+00:00", 6000),
            make_telemetry_row("2024-01-05T10:20:00+00:00", 6000),
            make_telemetry_row("2024-01-05T10:25:00+00:00", 6000),
        ]

        async def side_effect(token, table, params=None):
            if table == "daily_energy":
                return []
            if table == "equipment":
                return [{"id": "eq-1"}]
            if table == "equipment_telemetry":
                return telemetry
            return []

        mock_query.side_effect = side_effect
        resp = client.get("/api/py/analyze", headers={"Authorization": "Bearer t"})

        assert resp.status_code == 200
        daily = resp.json()["analysis"]["energy"]["daily_values"]
        assert len(daily) == 1
        # 6 readings × 6000W × (5/60)h = 3000 Wh = 3.0 kWh
        assert daily[0]["kwh"] == 3.0

    @patch("api.py.index._get_system")
    @patch("api.py.index._supabase_query")
    def test_skips_zero_power_readings(self, mock_query, mock_get_system, client):
        """Night readings with power_w=0 should not contribute to daily energy."""
        mock_get_system.return_value = mock_system()

        telemetry = [
            make_telemetry_row("2024-01-05T04:00:00+00:00", 0),
            make_telemetry_row("2024-01-05T04:05:00+00:00", 0),
            make_telemetry_row("2024-01-05T10:00:00+00:00", 5000),
            make_telemetry_row("2024-01-05T10:05:00+00:00", 6000),
        ]

        async def side_effect(token, table, params=None):
            if table == "daily_energy":
                return []
            if table == "equipment":
                return [{"id": "eq-1"}]
            if table == "equipment_telemetry":
                return telemetry
            return []

        mock_query.side_effect = side_effect
        resp = client.get("/api/py/analyze", headers={"Authorization": "Bearer t"})

        assert resp.status_code == 200
        daily = resp.json()["analysis"]["energy"]["daily_values"]
        assert len(daily) == 1
        # 5000W × 5/60h + 6000W × 5/60h = 916.67 Wh = 0.92 kWh
        assert daily[0]["kwh"] == pytest.approx(0.92, abs=0.01)

    @patch("api.py.index._get_system")
    @patch("api.py.index._supabase_query")
    def test_aggregates_across_multiple_days(self, mock_query, mock_get_system, client):
        """Energy should be aggregated per day."""
        mock_get_system.return_value = mock_system()

        telemetry = [
            make_telemetry_row("2024-01-05T10:00:00+00:00", 4000),
            make_telemetry_row("2024-01-05T10:05:00+00:00", 4000),
            make_telemetry_row("2024-01-06T10:00:00+00:00", 6000),
            make_telemetry_row("2024-01-06T10:05:00+00:00", 6000),
        ]

        async def side_effect(token, table, params=None):
            if table == "daily_energy":
                return []
            if table == "equipment":
                return [{"id": "eq-1"}]
            if table == "equipment_telemetry":
                return telemetry
            return []

        mock_query.side_effect = side_effect
        resp = client.get("/api/py/analyze", headers={"Authorization": "Bearer t"})

        assert resp.status_code == 200
        daily = resp.json()["analysis"]["energy"]["daily_values"]
        assert len(daily) == 2
        assert daily[0]["date"] == "2024-01-05"
        assert daily[1]["date"] == "2024-01-06"

    @patch("api.py.index._get_system")
    @patch("api.py.index._supabase_query")
    def test_only_uses_inverter_data(self, mock_query, mock_get_system, client):
        """Should query only inverters (equipment_type=inverter), not optimizers."""
        mock_get_system.return_value = mock_system()

        call_log = []

        async def side_effect(token, table, params=None):
            call_log.append((table, params))
            if table == "daily_energy":
                return []
            if table == "equipment":
                return [{"id": "eq-inv-1"}]
            if table == "equipment_telemetry":
                return [
                    make_telemetry_row("2024-01-05T10:00:00+00:00", 10000),
                    make_telemetry_row("2024-01-05T10:05:00+00:00", 10000),
                ]
            return []

        mock_query.side_effect = side_effect
        resp = client.get("/api/py/analyze", headers={"Authorization": "Bearer t"})
        assert resp.status_code == 200

        # Check that equipment query filters by inverter type
        eq_calls = [(t, p) for t, p in call_log if t == "equipment"]
        assert len(eq_calls) >= 1
        eq_params = eq_calls[0][1]
        assert eq_params.get("equipment_type") == "eq.inverter"

    @patch("api.py.index._get_system")
    @patch("api.py.index._supabase_query")
    def test_realistic_15kw_system_daily_output(self, mock_query, mock_get_system, client):
        """A 15kW system with 5-min data should produce ~75 kWh/day, not 3x that."""
        mock_get_system.return_value = mock_system()

        # Simulate a full day at 5-min intervals: 288 intervals total
        # ~10 hours of sunlight with a bell curve peaking at ~14kW
        telemetry = []
        for i in range(288):  # 24h × 12 intervals/h
            h = i // 12
            m = (i % 12) * 5
            # Bell curve: peak at noon (h=12), ~14kW peak
            import math
            power = max(0, 14000 * math.exp(-0.5 * ((h - 12) / 3) ** 2)) if 6 <= h <= 18 else 0
            telemetry.append(
                make_telemetry_row(f"2024-01-05T{h:02d}:{m:02d}:00+00:00", round(power))
            )

        async def side_effect(token, table, params=None):
            if table == "daily_energy":
                return []
            if table == "equipment":
                return [{"id": "eq-1"}]
            if table == "equipment_telemetry":
                return telemetry
            return []

        mock_query.side_effect = side_effect
        resp = client.get("/api/py/analyze", headers={"Authorization": "Bearer t"})

        assert resp.status_code == 200
        daily = resp.json()["analysis"]["energy"]["daily_values"]
        assert len(daily) == 1
        kwh = daily[0]["kwh"]
        # Reasonable range for a 15kW system: 50-120 kWh/day
        assert 50 < kwh < 120, f"Daily energy {kwh} kWh is outside reasonable range"

    @patch("api.py.index._get_system")
    @patch("api.py.index._supabase_query")
    def test_prefers_daily_energy_table_over_aggregation(
        self, mock_query, mock_get_system, client
    ):
        """If daily_energy table has data, use it instead of aggregating."""
        mock_get_system.return_value = mock_system()

        async def side_effect(token, table, params=None):
            if table == "daily_energy":
                return [
                    {"date": "2024-01-05", "energy_wh": 75000},
                    {"date": "2024-01-06", "energy_wh": 80000},
                ]
            return []

        mock_query.side_effect = side_effect
        resp = client.get("/api/py/analyze", headers={"Authorization": "Bearer t"})

        assert resp.status_code == 200
        daily = resp.json()["analysis"]["energy"]["daily_values"]
        assert len(daily) == 2
        assert daily[0]["kwh"] == 75.0
        assert daily[1]["kwh"] == 80.0
