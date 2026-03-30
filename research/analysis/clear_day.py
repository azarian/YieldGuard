"""
Clear-day detection via 15-min curve matching.

Compares actual 15-min power profiles against a pvlib clear-sky model
to classify days as clear, partial, or cloudy.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from datetime import date

import numpy as np
import pandas as pd

from config import SystemConfig, ClearDayResult, DEFAULT_SYSTEM
from models.clearsky import ClearSkyModel


class ClearDayDetector(ABC):
    """Base class for clear-day detection strategies."""

    @abstractmethod
    def classify_day(
        self, day: date, intervals: pd.DataFrame, rain_mm: float = 0.0
    ) -> ClearDayResult:
        ...

    @abstractmethod
    def compute_model_profile(self, day: date) -> tuple[np.ndarray, pd.DatetimeIndex]:
        ...

    def classify_all(
        self, energy_15min: pd.DataFrame, precip: pd.DataFrame
    ) -> list[ClearDayResult]:
        """Classify all days in the dataset."""
        energy_15min = energy_15min.copy()
        energy_15min["date"] = energy_15min["timestamp"].dt.date

        precip_map = {}
        if precip is not None and len(precip) > 0:
            for _, r in precip.iterrows():
                precip_map[r["date"]] = r["rain_mm"]

        results = []
        dates = sorted(energy_15min["date"].unique())
        for i, day in enumerate(dates):
            if i % 100 == 0:
                print(f"  Classifying: {i}/{len(dates)}...", end="\r")
            day_data = energy_15min[energy_15min["date"] == day].copy()
            rain = precip_map.get(day, 0.0)
            results.append(self.classify_day(day, day_data, rain))

        print(f"  Classifying: done ({len(dates)} days)    ")
        results = self._apply_baseline_scale(results)
        return results

    def _apply_baseline_scale(
        self, results: list[ClearDayResult]
    ) -> list[ClearDayResult]:
        """
        Replace model_scale on partial/cloudy days with a rolling baseline
        derived from nearby clear days.
        """
        dates = [r.date for r in results]
        scales = [r.model_scale for r in results]
        classes = [r.classification for r in results]

        clear_scales = pd.Series(
            [s if c == "clear" else np.nan for s, c in zip(scales, classes)],
            index=pd.to_datetime(dates),
        )
        baseline = clear_scales.rolling("30D", min_periods=3, center=True).median()
        baseline = baseline.interpolate(method="linear").ffill().bfill()

        updated = []
        for i, r in enumerate(results):
            if r.classification == "clear":
                updated.append(r)
            else:
                bs = baseline.iloc[i]
                if np.isfinite(bs) and bs > 0:
                    model_power, _ = self.compute_model_profile(r.date)
                    full_model_energy = model_power * (15 / 60)
                    est_clean = np.sum(full_model_energy * bs) / 1000.0
                    updated.append(
                        ClearDayResult(
                            date=r.date,
                            classification=r.classification,
                            clear_fraction=r.clear_fraction,
                            fit_score=r.fit_score,
                            estimated_clean_kwh=round(est_clean, 2),
                            actual_kwh=r.actual_kwh,
                            model_scale=round(float(bs), 4),
                            n_intervals=r.n_intervals,
                            n_clear_intervals=r.n_clear_intervals,
                        )
                    )
                else:
                    updated.append(r)

        return updated


class CurveMatchDetector(ClearDayDetector):
    """
    Detect clear days by matching 15-min power curves to a pvlib clear-sky model.

    On a clear day, the ratio actual/model is nearly constant across all intervals.
    Cloud events show up as sudden dips in this ratio.
    """

    def __init__(
        self,
        config: SystemConfig = DEFAULT_SYSTEM,
        clear_r2_threshold: float = 0.97,
        cloudy_r2_threshold: float = 0.50,
        min_daylight_intervals: int = 8,
        model_power_threshold_w: float = 200,
    ):
        self.config = config
        self.model = ClearSkyModel(config)
        self.clear_r2 = clear_r2_threshold
        self.cloudy_r2 = cloudy_r2_threshold
        self.min_daylight = min_daylight_intervals
        self.model_power_min = model_power_threshold_w

    def compute_model_profile(self, day: date) -> tuple[np.ndarray, pd.DatetimeIndex]:
        return self.model.compute_profile(day)

    def classify_day(
        self, day: date, intervals: pd.DataFrame, rain_mm: float = 0.0
    ) -> ClearDayResult:
        model_power, model_times = self.compute_model_profile(day)
        actual = self._align_actual(intervals, model_times)
        actual_kwh = intervals["energy_wh"].sum() / 1000.0

        peak_power = model_power.max()
        daylight_mask = model_power > max(peak_power * 0.10, self.model_power_min)
        n_daylight = daylight_mask.sum()

        if n_daylight < self.min_daylight:
            return ClearDayResult(
                date=day, classification="cloudy", clear_fraction=0.0,
                fit_score=0.0, estimated_clean_kwh=0.0, actual_kwh=actual_kwh,
                model_scale=0.0, n_intervals=int(n_daylight), n_clear_intervals=0,
            )

        model_day = model_power[daylight_mask]
        actual_day = actual[daylight_mask]

        model_energy = model_day * (15 / 60)  # W → Wh per 15 min
        actual_energy = actual_day  # already in Wh

        valid = (actual_energy > 0) & np.isfinite(actual_energy) & (model_energy > 0)
        if valid.sum() < self.min_daylight:
            return ClearDayResult(
                date=day, classification="cloudy", clear_fraction=0.0,
                fit_score=0.0, estimated_clean_kwh=0.0, actual_kwh=actual_kwh,
                model_scale=0.0, n_intervals=int(n_daylight), n_clear_intervals=0,
            )

        model_v = model_energy[valid]
        actual_v = actual_energy[valid]
        ratio = actual_v / model_v

        # Two-pass clear interval identification
        median_ratio = np.median(ratio)
        clear_mask = ratio >= median_ratio * 0.85

        n_clear = clear_mask.sum()
        n_valid = valid.sum()
        clear_fraction = n_clear / n_valid if n_valid > 0 else 0.0

        if n_clear >= self.min_daylight:
            scale = np.median(ratio[clear_mask])
        else:
            scale = median_ratio

        # R² against ceiling-scaled model
        scaled_model = model_v * scale
        ss_res = np.sum((actual_v - scaled_model) ** 2)
        ss_tot = np.sum((actual_v - np.mean(actual_v)) ** 2)
        fit_score = 1 - ss_res / ss_tot if ss_tot > 0 else 0.0

        # Full-day estimated production with no clouds
        full_model_energy = model_power * (15 / 60)
        estimated_clean_kwh = np.sum(full_model_energy * scale) / 1000.0

        if fit_score >= self.clear_r2 and rain_mm < 0.5:
            classification = "clear"
        elif fit_score >= self.cloudy_r2:
            classification = "partial"
        else:
            classification = "cloudy"

        return ClearDayResult(
            date=day,
            classification=classification,
            clear_fraction=round(clear_fraction, 3),
            fit_score=round(fit_score, 4),
            estimated_clean_kwh=round(estimated_clean_kwh, 2),
            actual_kwh=round(actual_kwh, 2),
            model_scale=round(float(scale), 4),
            n_intervals=int(n_valid),
            n_clear_intervals=int(n_clear),
        )

    def _align_actual(
        self, intervals: pd.DataFrame, model_times: pd.DatetimeIndex
    ) -> np.ndarray:
        """Align actual 15-min energy data to model timestamps."""
        if intervals.empty:
            return np.zeros(len(model_times))

        model_naive = model_times.tz_localize(None)
        ts_naive = pd.to_datetime(intervals["timestamp"].values).tz_localize(None)
        actual_df = pd.DataFrame(
            {"energy_wh": intervals["energy_wh"].values}, index=ts_naive
        )
        actual_df = actual_df[~actual_df.index.duplicated(keep="first")]

        aligned = actual_df["energy_wh"].reindex(
            model_naive, method="nearest", tolerance=pd.Timedelta("8min")
        )
        return aligned.fillna(0).values
