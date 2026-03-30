"""
Soiling ratio computation with monotonicity enforcement.

Computes daily soiling ratio from clear-day performance vs seasonal envelope,
detects cleaning events, fits piecewise-linear trends, and enforces the
physical constraint that soiling can only worsen during dry periods.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

from config import ClearDayResult, SystemConfig
from analysis.cleaning import detect_cleaning


def build_daily(
    results: list[ClearDayResult], precip: pd.DataFrame
) -> pd.DataFrame:
    """Build daily DataFrame from clear-day results + precipitation."""
    rows = []
    for r in results:
        rows.append(
            {
                "date": r.date,
                "energy_kwh": r.actual_kwh,
                "est_clean_kwh": r.estimated_clean_kwh,
                "model_scale": r.model_scale,
                "fit_score": r.fit_score,
                "clear_fraction": r.clear_fraction,
                "classification": r.classification,
                "is_clear": r.classification == "clear",
                "is_usable": r.classification in ("clear", "partial"),
            }
        )

    daily = pd.DataFrame(rows).sort_values("date").reset_index(drop=True)
    daily = daily.merge(precip, on="date", how="left")
    daily["rain_mm"] = daily["rain_mm"].fillna(0)

    print(f"Daily: {len(daily)} days")
    print(
        f"  Clear: {daily['is_clear'].sum()}, "
        f"Partial: {(daily['classification'] == 'partial').sum()}, "
        f"Cloudy: {(daily['classification'] == 'cloudy').sum()}"
    )
    return daily


def compute_soiling(
    daily: pd.DataFrame, envelope: pd.Series, config: SystemConfig
) -> pd.DataFrame:
    """
    Compute soiling ratio using the seasonal envelope.

    Pipeline:
    1. Map each day to its envelope value
    2. Compute raw SR = production / envelope
    3. Identify dry periods
    4. Detect cleaning events
    5. Fit piecewise-linear soiling between cleaning events
    6. Enforce monotonicity within dry spells
    7. Calculate losses
    """
    daily = daily.copy()
    daily["doy"] = pd.to_datetime(daily["date"]).dt.dayofyear
    daily["envelope_kwh"] = daily["doy"].map(envelope)

    # Raw soiling ratio
    production = np.where(
        daily["is_clear"],
        daily["energy_kwh"],
        np.where(
            daily["classification"] == "partial", daily["est_clean_kwh"], np.nan
        ),
    )
    daily["sr_raw"] = production / daily["envelope_kwh"]
    daily["sr_raw"] = daily["sr_raw"].clip(upper=1.05)

    # Identify dry periods
    daily["is_dry"] = mark_dry_periods(daily)

    # Detect cleaning events
    daily = detect_cleaning(daily)

    # Fit piecewise-linear soiling between cleaning events
    daily = _fit_piecewise_soiling(daily)

    # Enforce monotonicity within dry spells (THE FIX)
    daily["soiling_ratio"] = enforce_monotonicity(
        daily["soiling_ratio"].values,
        daily["rain_mm"].values,
        daily["cleaning"].values,
    )

    # Losses
    loss_f = (1 - daily["soiling_ratio"]).clip(lower=0)
    daily["loss_pct"] = loss_f * 100
    daily["lost_kwh"] = np.where(
        daily["soiling_ratio"] > 0.3,
        daily["energy_kwh"] * (1 - daily["soiling_ratio"]) / daily["soiling_ratio"],
        0,
    )
    daily["lost_ils"] = daily["lost_kwh"] * config.price

    # Cumulative loss since last cleaning
    daily["cumul_loss"] = 0.0
    c = 0.0
    for i in range(len(daily)):
        if daily.iloc[i]["cleaning"]:
            c = 0.0
        c += daily.iloc[i]["lost_ils"]
        daily.iloc[i, daily.columns.get_loc("cumul_loss")] = c

    return daily


def mark_dry_periods(daily: pd.DataFrame) -> np.ndarray:
    """
    Mark days that fall in dry periods (no significant rain nearby).

    Uses a 14-day rolling window — if total rain in that window < 2mm,
    the day is considered dry.
    """
    rain = daily["rain_mm"].values
    n = len(rain)
    is_dry = np.ones(n, dtype=bool)

    for i in range(n):
        window_start = max(0, i - 14)
        window_end = min(n, i + 15)
        if rain[window_start:window_end].sum() > 2.0:
            is_dry[i] = False

    return is_dry


def enforce_monotonicity(
    soiling_ratio: np.ndarray,
    rain_mm: np.ndarray,
    cleaning: np.ndarray,
    rain_threshold: float = 0.5,
) -> np.ndarray:
    """
    Enforce that soiling ratio can only decrease during dry, non-cleaning days.

    This is the key physical constraint: dirt accumulates but doesn't remove
    itself. Within each "dry spell" (contiguous days with no rain above
    threshold and no cleaning event), SR is clamped to be monotonically
    non-increasing.

    Args:
        soiling_ratio: raw fitted soiling ratios
        rain_mm: daily precipitation
        cleaning: boolean array of cleaning events
        rain_threshold: minimum rain to allow SR increase (mm)

    Returns:
        Monotonicity-enforced soiling ratios
    """
    sr = soiling_ratio.copy()
    n = len(sr)

    for i in range(1, n):
        is_wet = rain_mm[i] >= rain_threshold or rain_mm[max(0, i - 1)] >= rain_threshold
        is_cleaning = cleaning[i]

        if not is_wet and not is_cleaning:
            # Dry non-cleaning day: SR can only stay the same or decrease
            sr[i] = min(sr[i], sr[i - 1])

    return sr


def _fit_piecewise_soiling(daily: pd.DataFrame) -> pd.DataFrame:
    """
    Fit piecewise-linear soiling trends between cleaning events.

    During dry periods: fit linear regression with non-positive slope.
    During wet periods: use rolling median with moderate smoothing.
    """
    event_idx = [0] + daily[daily["cleaning"]].index.tolist() + [len(daily) - 1]

    soiling = np.full(len(daily), np.nan)

    for seg in range(len(event_idx) - 1):
        seg_start = event_idx[seg]
        seg_end = event_idx[seg + 1]
        segment = daily.iloc[seg_start : seg_end + 1]

        usable = segment[segment["is_usable"] & segment["sr_raw"].notna()]
        if len(usable) < 2:
            if len(usable) == 1:
                soiling[seg_start : seg_end + 1] = usable["sr_raw"].iloc[0]
            continue

        x = (
            pd.to_datetime(usable["date"])
            - pd.to_datetime(segment["date"].iloc[0])
        ).dt.days.values.astype(float)
        y = usable["sr_raw"].values

        dry_fraction = segment["is_dry"].mean()

        if dry_fraction > 0.7:
            # Dry segment: fit linear with non-positive slope
            if len(x) >= 3:
                slope, intercept = np.polyfit(x, y, 1)
                slope = min(slope, 0)
            else:
                slope = 0
                intercept = np.median(y)

            all_x = np.arange(seg_end - seg_start + 1, dtype=float)
            fitted = intercept + slope * all_x
            soiling[seg_start : seg_end + 1] = fitted
        else:
            # Wet segment: rolling median
            sr_seg = segment["sr_raw"].copy()
            sr_seg[~segment["is_usable"]] = np.nan
            smoothed = sr_seg.rolling(7, center=True, min_periods=2).median()
            smoothed = smoothed.interpolate(method="linear").ffill().bfill()
            soiling[seg_start : seg_end + 1] = smoothed.values

    # Fill remaining NaN gaps
    sr = pd.Series(soiling)
    sr = sr.interpolate(method="linear").ffill().bfill()
    daily["soiling_ratio"] = sr.values

    return daily
