"""
YieldGuard Soiling Analysis — Public API
=========================================
Production entry point for the soiling analysis algorithm.

Usage:
    from api import SoilingAnalyzer
    from config import SystemConfig

    config = SystemConfig(lat=31.33, lon=34.90, alt=350, kwp=15.84,
                          tilt=20, azimuth=180, tz="Asia/Jerusalem",
                          install_date="2019-11-03")
    analyzer = SoilingAnalyzer(config)
    result = analyzer.analyze(energy_15min_df, precip_df)

Input DataFrames:
    energy_15min: columns ['timestamp' (datetime), 'energy_wh' (float)]
    precip:       columns ['date' (date), 'rain_mm' (float)]

Output:
    SoilingResult with .daily, .summary, .events, .envelope, .config
"""

from __future__ import annotations

import logging
from datetime import date

import numpy as np
import pandas as pd

from config import SystemConfig, SoilingSummary, SoilingResult
from analysis.clear_day import CurveMatchDetector
from analysis.soiling import build_daily, compute_soiling
from models.seasonal import fit_seasonal_envelope
from reporting.charts import build_all_charts

logger = logging.getLogger(__name__)


class SoilingAnalyzer:
    """High-level facade for running a full soiling analysis.

    Accepts raw DataFrames (no file I/O, no API calls) and returns
    a structured SoilingResult with all analysis outputs.
    """

    def __init__(self, config: SystemConfig):
        self.config = config
        self._detector = CurveMatchDetector(config)

    def analyze(
        self,
        energy_15min: pd.DataFrame,
        precip: pd.DataFrame,
    ) -> SoilingResult:
        """Run the full soiling analysis pipeline.

        Args:
            energy_15min: 15-minute energy data with columns:
                - timestamp: datetime (naive or tz-aware)
                - energy_wh: float, energy produced in that interval
            precip: Daily precipitation with columns:
                - date: date object
                - rain_mm: float, daily rainfall in mm

        Returns:
            SoilingResult with daily DataFrame, summary, events, and envelope.

        Raises:
            ValueError: If input DataFrames are missing required columns.
        """
        self._validate_inputs(energy_15min, precip)

        energy = energy_15min.copy()
        if "date" not in energy.columns:
            energy["date"] = energy["timestamp"].dt.date

        # 1. Classify days
        logger.info("Classifying %d days...", energy["date"].nunique())
        results = self._detector.classify_all(energy, precip)

        # 2. Build daily DataFrame
        daily = build_daily(results, precip)

        # 3. Fit seasonal envelope
        logger.info("Fitting seasonal envelope...")
        params, envelope = fit_seasonal_envelope(daily)

        # 4. Compute soiling (includes cleaning detection + monotonicity)
        logger.info("Computing soiling ratios...")
        daily = compute_soiling(daily, envelope, self.config)

        # 5. Build summary
        summary = self._build_summary(daily)
        events = daily[daily["cleaning"]].copy()

        return SoilingResult(
            daily=daily,
            summary=summary,
            events=events,
            envelope=envelope,
            envelope_params=params,
            config=self.config,
        )

    def build_charts(self, result: SoilingResult) -> dict:
        """Build Plotly charts from a SoilingResult.

        Separated from analyze() so charts are only built when needed.
        """
        return build_all_charts(result.daily, result.envelope)

    def _validate_inputs(
        self, energy_15min: pd.DataFrame, precip: pd.DataFrame
    ) -> None:
        """Validate that input DataFrames have the required columns."""
        energy_required = {"timestamp", "energy_wh"}
        missing = energy_required - set(energy_15min.columns)
        if missing:
            raise ValueError(
                f"energy_15min missing required columns: {missing}. "
                f"Expected: {energy_required}"
            )

        precip_required = {"date", "rain_mm"}
        missing = precip_required - set(precip.columns)
        if missing:
            raise ValueError(
                f"precip missing required columns: {missing}. "
                f"Expected: {precip_required}"
            )

        if energy_15min.empty:
            raise ValueError("energy_15min DataFrame is empty")

    def _build_summary(self, daily: pd.DataFrame) -> SoilingSummary:
        """Compute summary statistics from the analyzed daily DataFrame."""
        sr = daily["soiling_ratio"].iloc[-1]
        total_lost_kwh = daily["lost_kwh"].sum()
        total_lost_money = daily["lost_ils"].sum()

        n_years = (
            pd.Timestamp(str(daily["date"].max()))
            - pd.Timestamp(str(daily["date"].min()))
        ).days / 365.25

        # Compute seasonal soiling rates
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
