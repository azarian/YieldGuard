"""Tests for config module."""

import pytest
from datetime import date

from config import SystemConfig, SolarEdgeConfig, ClearDayResult, DEFAULT_SYSTEM, DEFAULT_SOLAREDGE


class TestSystemConfig:
    def test_creation_with_defaults(self):
        cfg = SystemConfig(
            lat=32.0, lon=34.0, alt=100, kwp=10.0,
            tilt=20, azimuth=180, tz="Asia/Jerusalem",
            install_date="2020-01-01",
        )
        assert cfg.lat == 32.0
        assert cfg.temp_coeff == -0.004  # default
        assert cfg.price == 0.48  # default
        assert cfg.clean_cost == 350.0  # default

    def test_creation_with_overrides(self):
        cfg = SystemConfig(
            lat=32.0, lon=34.0, alt=100, kwp=10.0,
            tilt=20, azimuth=180, tz="UTC",
            install_date="2020-01-01",
            price=0.30, clean_cost=200.0,
        )
        assert cfg.price == 0.30
        assert cfg.clean_cost == 200.0

    def test_frozen(self):
        cfg = DEFAULT_SYSTEM
        with pytest.raises(AttributeError):
            cfg.lat = 0.0  # type: ignore

    def test_default_system_values(self):
        assert DEFAULT_SYSTEM.kwp == 15.84
        assert DEFAULT_SYSTEM.tz == "Asia/Jerusalem"
        assert DEFAULT_SYSTEM.tilt == 20


class TestSolarEdgeConfig:
    def test_creation(self):
        cfg = SolarEdgeConfig(site_id="123", api_key="abc")
        assert cfg.site_id == "123"

    def test_frozen(self):
        cfg = DEFAULT_SOLAREDGE
        with pytest.raises(AttributeError):
            cfg.site_id = "new"  # type: ignore


class TestClearDayResult:
    def test_creation(self):
        r = ClearDayResult(
            date=date(2024, 6, 15),
            classification="clear",
            clear_fraction=0.95,
            fit_score=0.98,
            estimated_clean_kwh=80.0,
            actual_kwh=76.0,
            model_scale=0.95,
            n_intervals=48,
            n_clear_intervals=45,
        )
        assert r.classification == "clear"
        assert r.actual_kwh == 76.0

    def test_frozen(self):
        r = ClearDayResult(
            date=date(2024, 1, 1), classification="cloudy",
            clear_fraction=0.0, fit_score=0.0,
            estimated_clean_kwh=0.0, actual_kwh=0.0,
            model_scale=0.0, n_intervals=0, n_clear_intervals=0,
        )
        with pytest.raises(AttributeError):
            r.classification = "clear"  # type: ignore
