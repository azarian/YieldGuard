"""Shared test fixtures for the analysis service tests."""

import pytest
import numpy as np
import pandas as pd
from datetime import date, timedelta
from dataclasses import dataclass

from api.py.soiling.config import SystemConfig, SoilingSummary, SoilingResult


TEST_CONFIG = SystemConfig(
    lat=31.332182,
    lon=34.896813,
    alt=350,
    kwp=15.84,
    tilt=20,
    azimuth=180,
    tz="Asia/Jerusalem",
    install_date="2019-11-03",
    price=0.48,
)


@pytest.fixture
def system_config():
    return TEST_CONFIG


@pytest.fixture
def sample_summary():
    return SoilingSummary(
        current_sr=0.965,
        current_loss_pct=3.5,
        total_lost_kwh=1250.5,
        total_lost_money=600.2,
        annual_avg_loss_money=120.0,
        n_cleaning_events=8,
        loss_since_last_clean=45.2,
        avg_summer_rate=-0.15,
        avg_winter_rate=-0.05,
        analysis_start=date(2020, 2, 2),
        analysis_end=date(2026, 3, 1),
        n_days=1856,
    )


@pytest.fixture
def sample_daily():
    """Minimal daily DataFrame matching the soiling output schema."""
    n = 100
    dates = [date(2025, 1, 1) + timedelta(days=i) for i in range(n)]
    return pd.DataFrame({
        "date": dates,
        "energy_kwh": np.random.uniform(40, 80, n),
        "est_clean_kwh": np.random.uniform(50, 85, n),
        "soiling_ratio": np.random.uniform(0.92, 1.0, n),
        "lost_kwh": np.random.uniform(0, 5, n),
        "lost_ils": np.random.uniform(0, 2.5, n),
        "classification": np.random.choice(["clear", "partial", "cloudy"], n),
        "cleaning": [False] * n,
        "rain_mm": np.zeros(n),
        "cumul_loss": np.cumsum(np.random.uniform(0, 2.5, n)),
        "is_usable": [True] * n,
    })


@pytest.fixture
def sample_events():
    """Minimal events DataFrame."""
    return pd.DataFrame({
        "date": [date(2025, 1, 15), date(2025, 2, 20)],
        "cleaning": [True, True],
        "rain_mm": [8.5, 0.0],
        "event_type": ["Rain", "No Rain"],
    })


@pytest.fixture
def sample_result(sample_summary, sample_daily, sample_events, system_config):
    return SoilingResult(
        daily=sample_daily,
        summary=sample_summary,
        events=sample_events,
        envelope=pd.Series(np.random.uniform(60, 90, 366), index=range(1, 367)),
        envelope_params=np.zeros(7),
        config=system_config,
    )


@pytest.fixture
def sample_system_row():
    """A dict mimicking a Supabase solar_systems row."""
    return {
        "id": "test-system-id-123",
        "system_name": "My Solar System",
        "site_id": "1353684",
        "latitude": 31.332182,
        "longitude": 34.896813,
        "peak_power_kwp": 15.84,
        "azimuth": 180,
        "tilt": 20,
        "altitude": 350,
        "installation_date": "2019-11-03",
        "electricity_price_per_kwh": 0.48,
        "currency": "ILS",
    }
