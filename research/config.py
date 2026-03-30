"""
YieldGuard — Configuration & Data Types
========================================
Immutable configuration dataclasses and shared result types.
No dependencies on any other YieldGuard module.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from datetime import date
from typing import Optional

import numpy as np
import pandas as pd


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

def load_solaredge_config() -> SolarEdgeConfig:
    """Load SolarEdge config from environment variables."""
    site_id = os.environ.get("SOLAREDGE_SITE_ID", "")
    api_key = os.environ.get("SOLAREDGE_API_KEY", "")
    if not site_id or not api_key:
        raise ValueError(
            "SOLAREDGE_SITE_ID and SOLAREDGE_API_KEY environment variables must be set"
        )
    return SolarEdgeConfig(site_id=site_id, api_key=api_key)


@dataclass(frozen=True)
class SoilingSummary:
    """Summary statistics from a soiling analysis run."""

    current_sr: float
    current_loss_pct: float
    total_lost_kwh: float
    total_lost_money: float
    annual_avg_loss_money: float
    n_cleaning_events: int
    loss_since_last_clean: float
    avg_summer_rate: float  # %/day
    avg_winter_rate: float  # %/day
    analysis_start: date
    analysis_end: date
    n_days: int


@dataclass
class SoilingResult:
    """Complete result of a soiling analysis run.

    Attributes:
        daily: Full daily DataFrame with soiling ratios, losses, events
        summary: Aggregated summary statistics
        events: DataFrame of detected cleaning events only
        envelope: Seasonal envelope Series (DOY → kWh)
        envelope_params: Fitted curve parameters (7 values)
        config: System configuration used for the analysis
    """

    daily: pd.DataFrame
    summary: SoilingSummary
    events: pd.DataFrame
    envelope: pd.Series
    envelope_params: np.ndarray
    config: SystemConfig
