"""
Production entry point for the soiling analysis algorithm.
"""

from __future__ import annotations

import logging
from datetime import date

import numpy as np
import pandas as pd

from .config import SystemConfig, SoilingSummary, SoilingResult
from .analysis.clear_day import CurveMatchDetector
from .analysis.soiling import build_daily, compute_soiling
from .models.seasonal import fit_seasonal_envelope

logger = logging.getLogger(__name__)


class SoilingAnalyzer:
    """High-level facade for running a full soiling analysis."""

    def __init__(self, config: SystemConfig):
        self.config = config
        self._detector = CurveMatchDetector(config)

    def analyze(self, energy_15min: pd.DataFrame, precip: pd.DataFrame) -> SoilingResult:
        self._validate_inputs(energy_15min, precip)

        energy = energy_15min.copy()
        if "date" not in energy.columns:
            energy["date"] = energy["timestamp"].dt.date

        logger.info("Classifying %d days...", energy["date"].nunique())
        results = self._detector.classify_all(energy, precip)

        daily = build_daily(results, precip)

        logger.info("Fitting seasonal envelope...")
        params, envelope = fit_seasonal_envelope(daily)

        logger.info("Computing soiling ratios...")
        daily = compute_soiling(daily, envelope, self.config)

        summary = self._build_summary(daily)
        events = daily[daily["cleaning"]].copy()

        return SoilingResult(
            daily=daily, summary=summary, events=events,
            envelope=envelope, envelope_params=params, config=self.config,
        )

    def _validate_inputs(self, energy_15min: pd.DataFrame, precip: pd.DataFrame) -> None:
        energy_required = {"timestamp", "energy_wh"}
        missing = energy_required - set(energy_15min.columns)
        if missing:
            raise ValueError(f"energy_15min missing required columns: {missing}")

        precip_required = {"date", "rain_mm"}
        missing = precip_required - set(precip.columns)
        if missing:
            raise ValueError(f"precip missing required columns: {missing}")

        if energy_15min.empty:
            raise ValueError("energy_15min DataFrame is empty")

    def _build_summary(self, daily: pd.DataFrame) -> SoilingSummary:
        sr = daily["soiling_ratio"].iloc[-1]
        total_lost_kwh = daily["lost_kwh"].sum()
        total_lost_money = daily["lost_ils"].sum()

        n_years = (
            pd.Timestamp(str(daily["date"].max()))
            - pd.Timestamp(str(daily["date"].min()))
        ).days / 365.25

        ev_idx = [0] + daily[daily["cleaning"]].index.tolist() + [len(daily) - 1]
        summer_rates, winter_rates = [], []
        for s in range(len(ev_idx) - 1):
            seg = daily.iloc[ev_idx[s] : ev_idx[s + 1] + 1]
            v = seg[seg["is_usable"] & seg["soiling_ratio"].notna()]
            if len(v) < 4:
                continue
            x = (
                pd.to_datetime(v["date"]) - pd.to_datetime(v["date"].iloc[0])
            ).dt.days.values.astype(float)
            if x[-1] - x[0] < 5:
                continue
            slope, _ = np.polyfit(x, v["soiling_ratio"].values, 1)
            mid = pd.to_datetime(v["date"].iloc[len(v) // 2]).month
            if mid in [5, 6, 7, 8, 9]:
                summer_rates.append(slope * 100)
            else:
                winter_rates.append(slope * 100)

        return SoilingSummary(
            current_sr=round(float(sr), 4),
            current_loss_pct=round((1 - sr) * 100, 2),
            total_lost_kwh=round(float(total_lost_kwh), 1),
            total_lost_money=round(float(total_lost_money), 1),
            annual_avg_loss_money=round(float(total_lost_money / max(n_years, 1)), 1),
            n_cleaning_events=int(daily["cleaning"].sum()),
            loss_since_last_clean=round(float(daily["cumul_loss"].iloc[-1]), 1),
            avg_summer_rate=round(float(np.mean(summer_rates)) if summer_rates else 0, 4),
            avg_winter_rate=round(float(np.mean(winter_rates)) if winter_rates else 0, 4),
            analysis_start=daily["date"].min(),
            analysis_end=daily["date"].max(),
            n_days=len(daily),
        )
