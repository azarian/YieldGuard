"""
Configuration & data types for the soiling analysis algorithm.
Immutable dataclasses with no internal dependencies.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date

import numpy as np
import pandas as pd


@dataclass(frozen=True)
class SystemConfig:
    """Physical parameters of the solar installation."""

    lat: float
    lon: float
    alt: float
    kwp: float
    tilt: float
    azimuth: float
    tz: str
    install_date: str
    temp_coeff: float = -0.004
    price: float = 0.48
    clean_cost: float = 350.0


@dataclass(frozen=True)
class ClearDayResult:
    """Result of clear-day classification for a single day."""

    date: date
    classification: str
    clear_fraction: float
    fit_score: float
    estimated_clean_kwh: float
    actual_kwh: float
    model_scale: float
    n_intervals: int
    n_clear_intervals: int


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
    avg_summer_rate: float
    avg_winter_rate: float
    analysis_start: date
    analysis_end: date
    n_days: int


@dataclass
class SoilingResult:
    """Complete result of a soiling analysis run."""

    daily: pd.DataFrame
    summary: SoilingSummary
    events: pd.DataFrame
    envelope: pd.Series
    envelope_params: np.ndarray
    config: SystemConfig
