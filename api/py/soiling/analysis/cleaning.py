"""
Cleaning event detection and classification.
"""

from __future__ import annotations

import logging

import numpy as np
import pandas as pd

logger = logging.getLogger(__name__)


def detect_cleaning(daily: pd.DataFrame) -> pd.DataFrame:
    daily = daily.copy()
    daily["cleaning"] = False
    daily["clean_mag"] = 0.0
    daily["event_type"] = ""

    sr_series = daily["sr_raw"].copy()
    sr_series[~daily["is_usable"]] = np.nan
    sr_smooth = sr_series.rolling(5, center=True, min_periods=2).median()
    sr_smooth = sr_smooth.interpolate(method="linear", limit=7).ffill().bfill()

    clear_sr = sr_series.dropna()
    diffs = clear_sr.diff().dropna().abs()
    noise_mad = diffs.median()
    noise_threshold = noise_mad * 4
    logger.info("SR noise MAD=%.4f, detection threshold=%.4f", noise_mad, noise_threshold)

    candidates = []
    for i in range(3, len(daily)):
        sr_now = sr_smooth.iloc[i]
        sr_before_1 = sr_smooth.iloc[i - 1]
        sr_before_3 = sr_smooth.iloc[max(0, i - 3)]

        jump_1d = sr_now - sr_before_1
        jump_3d = sr_now - sr_before_3

        is_dry = daily.iloc[i]["is_dry"]

        if is_dry:
            threshold = max(noise_threshold, 0.025)
        else:
            lookback_rain = daily.iloc[max(0, i - 3) : i + 1]["rain_mm"].sum()
            if lookback_rain > 2.0:
                threshold = max(noise_threshold * 0.6, 0.015)
            else:
                threshold = max(noise_threshold, 0.025)

        if jump_1d > threshold or jump_3d > threshold * 1.3:
            future_end = min(len(daily), i + 8)
            past_start = max(0, i - 8)
            future_sr = sr_smooth.iloc[i:future_end].dropna()
            past_sr = sr_smooth.iloc[past_start:i].dropna()

            if len(future_sr) >= 3 and len(past_sr) >= 3:
                sustained = future_sr.median() > past_sr.median() + noise_mad
            elif len(future_sr) >= 2:
                sustained = future_sr.median() >= sr_now - noise_mad * 2
            else:
                sustained = True

            if sustained:
                mag = max(jump_1d, jump_3d)
                candidates.append({"idx": i, "mag": mag, "sr_after": sr_now})

    consolidated = []
    if candidates:
        group = [candidates[0]]
        for c in candidates[1:]:
            if c["idx"] - group[-1]["idx"] <= 5:
                group.append(c)
            else:
                best = max(group, key=lambda x: x["mag"])
                consolidated.append(best)
                group = [c]
        best = max(group, key=lambda x: x["mag"])
        consolidated.append(best)

    for c in consolidated:
        i = c["idx"]
        daily.iloc[i, daily.columns.get_loc("cleaning")] = True
        daily.iloc[i, daily.columns.get_loc("clean_mag")] = c["mag"]

        lookback = daily.iloc[max(0, i - 3) : i + 1]
        max_rain = lookback["rain_mm"].max()
        total_rain = lookback["rain_mm"].sum()
        daily.iloc[i, daily.columns.get_loc("event_type")] = classify_event(
            max_rain, total_rain
        )

    n = daily["cleaning"].sum()
    logger.info("Cleaning events detected: %d", n)
    return daily


def classify_event(max_rain: float, total_rain: float) -> str:
    if max_rain > 5 or total_rain > 10:
        return "Heavy Rain"
    elif max_rain > 0.5 or total_rain > 2:
        return "Rain"
    else:
        return "No Rain"
