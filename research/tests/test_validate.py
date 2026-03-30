"""
Common-sense validation tests against real output data (soiling_full.json).

These tests verify that the algorithm's results match physical intuition.
They run against the pre-computed results, not synthetic data.
"""

import json
import os

import numpy as np
import pandas as pd
import pytest


DATA_PATH = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "soiling_full.json",
)


@pytest.fixture
def daily():
    if not os.path.exists(DATA_PATH):
        pytest.skip("soiling_full.json not found — run pipeline.py first")
    with open(DATA_PATH) as f:
        data = json.load(f)
    df = pd.DataFrame(data)
    df["date"] = pd.to_datetime(df["date"])
    df["month"] = df["date"].dt.month
    return df


class TestCommonSense:
    def test_cleaner_in_winter_than_summer(self, daily):
        """Israel has rainy winters → panels should be cleaner in winter."""
        winter = daily[daily["month"].isin([11, 12, 1, 2, 3])]["soiling_ratio"].mean()
        summer = daily[daily["month"].isin([6, 7, 8, 9])]["soiling_ratio"].mean()
        assert winter > summer, f"Winter SR ({winter:.4f}) should exceed summer ({summer:.4f})"

    def test_more_cleaning_events_in_winter(self, daily):
        """More rain in winter → more cleaning events."""
        cleans = daily[daily["cleaning"]]
        winter = cleans[cleans["month"].isin([11, 12, 1, 2, 3])].shape[0]
        summer = cleans[cleans["month"].isin([6, 7, 8, 9])].shape[0]
        assert winter > summer, f"Winter events ({winter}) should exceed summer ({summer})"

    def test_smooth_day_to_day_on_dry_days(self, daily):
        """On dry non-cleaning days, SR should change gradually (<2% for >95% of days)."""
        df = daily.sort_values("date").copy()
        df["sr_diff"] = df["soiling_ratio"].diff().abs()
        dry = df[(df["rain_mm"] == 0) & (~df["cleaning"])]
        big_jumps = dry[dry["sr_diff"] > 0.02]
        pct = len(big_jumps) / max(len(dry), 1)
        assert pct < 0.05, f"{pct:.1%} of dry days have jumps >2%, expected <5%"

    def test_monotonicity_on_dry_days(self, daily):
        """On dry non-cleaning days, SR should not increase (physics constraint)."""
        df = daily.sort_values("date").copy()
        df["sr_diff"] = df["soiling_ratio"].diff()
        dry = df[(df["rain_mm"] == 0) & (~df["cleaning"]) & df["sr_diff"].notna()]
        increasing = dry[dry["sr_diff"] > 0.001]
        pct = len(increasing) / max(len(dry), 1)
        assert pct < 0.05, \
            f"{pct:.1%} of dry days show SR increasing — monotonicity not enforced"

    def test_rain_triggers_recovery(self, daily):
        """Majority of significant rain events should show SR recovery."""
        df = daily.sort_values("date").reset_index(drop=True)
        rain_days = df[df["rain_mm"] > 2.0]
        recoveries = 0
        for idx in rain_days.index:
            next_indices = df.index[df.index > idx]
            if len(next_indices) > 0:
                next_sr = df.loc[next_indices[0], "soiling_ratio"]
                if next_sr >= df.loc[idx, "soiling_ratio"]:
                    recoveries += 1
        pct = recoveries / max(len(rain_days), 1)
        assert pct > 0.50, f"Only {pct:.0%} of rain days show recovery, expected >50%"

    def test_internal_consistency(self, daily):
        """loss_pct should be consistent with soiling_ratio."""
        expected_loss = (1 - daily["soiling_ratio"]) * 100
        actual_loss = daily["loss_pct"]
        corr = expected_loss.corr(actual_loss)
        assert corr > 0.99, f"Correlation {corr:.4f} too low"
