"""
YieldGuard — Configuration & Data Types
========================================
Immutable configuration dataclasses and shared result types.
No dependencies on any other YieldGuard module.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date
from typing import Optional


@dataclass(frozen=True)
class SystemConfig:
    """Physical parameters of the solar installation."""

    lat: float
    lon: float
    alt: float  # meters above sea level
    kwp: float  # system capacity in kWp
    tilt: float  # panel tilt from horizontal (degrees)
    azimuth: float  # panel facing direction (degrees, 180 = south)
    tz: str  # timezone string, e.g. "Asia/Jerusalem"
    install_date: str  # ISO date string
    temp_coeff: float = -0.004  # power temperature coefficient (%/°C)
    price: float = 0.48  # electricity price per kWh
    clean_cost: float = 350.0  # cost of one cleaning event


@dataclass(frozen=True)
class SolarEdgeConfig:
    """SolarEdge monitoring API credentials."""

    site_id: str
    api_key: str


@dataclass(frozen=True)
class ClearDayResult:
    """Result of clear-day classification for a single day."""

    date: date
    classification: str  # "clear", "partial", "cloudy"
    clear_fraction: float  # 0.0–1.0, fraction of daylight with clear sky
    fit_score: float  # R² of actual vs model on clear segments
    estimated_clean_kwh: float  # full-day production if no clouds
    actual_kwh: float
    model_scale: float  # ratio actual/model on clear segments
    n_intervals: int  # number of daylight 15-min intervals
    n_clear_intervals: int  # number classified as clear


# ── Default configurations ────────────────────────────────────────────────────

DEFAULT_SYSTEM = SystemConfig(
    lat=31.332182,
    lon=34.896813,
    alt=350,
    kwp=15.84,
    tilt=20,
    azimuth=180,
    tz="Asia/Jerusalem",
    install_date="2019-11-03",
    temp_coeff=-0.004,
    price=0.48,
    clean_cost=350,
)

DEFAULT_SOLAREDGE = SolarEdgeConfig(
    site_id="1353684",
    api_key="9AMEDLLW9UST1HA7849YYIF9JQK1UJN8",
)
