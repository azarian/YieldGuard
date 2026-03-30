"""Tests for soiling computation, especially monotonicity enforcement."""

import pytest
import numpy as np
import pandas as pd

from analysis.soiling import enforce_monotonicity, mark_dry_periods


class TestEnforceMonotonicity:
    def test_already_monotonic(self):
        """Already decreasing SR should be unchanged."""
        sr = np.array([1.0, 0.99, 0.98, 0.97, 0.96])
        rain = np.zeros(5)
        cleaning = np.zeros(5, dtype=bool)

        result = enforce_monotonicity(sr, rain, cleaning)
        np.testing.assert_array_almost_equal(result, sr)

    def test_clamps_upward_jumps_on_dry_days(self):
        """Upward jumps on dry days should be clamped."""
        sr = np.array([1.0, 0.98, 0.99, 0.97, 0.98, 0.96])
        rain = np.zeros(6)
        cleaning = np.zeros(6, dtype=bool)

        result = enforce_monotonicity(sr, rain, cleaning)

        # Should be monotonically non-increasing
        for i in range(1, len(result)):
            assert result[i] <= result[i - 1], \
                f"SR[{i}]={result[i]:.4f} > SR[{i-1}]={result[i-1]:.4f} on dry day"

        # Expected: [1.0, 0.98, 0.98, 0.97, 0.97, 0.96]
        expected = np.array([1.0, 0.98, 0.98, 0.97, 0.97, 0.96])
        np.testing.assert_array_almost_equal(result, expected)

    def test_allows_increase_after_rain(self):
        """SR should be allowed to increase after rain."""
        sr = np.array([0.95, 0.94, 0.93, 0.97, 0.96])
        rain = np.array([0.0, 0.0, 5.0, 0.0, 0.0])
        cleaning = np.zeros(5, dtype=bool)

        result = enforce_monotonicity(sr, rain, cleaning)

        # Day 3 (after rain on day 2) should be allowed to increase
        assert result[3] == 0.97, f"Post-rain recovery should be preserved, got {result[3]}"

    def test_allows_increase_after_cleaning(self):
        """SR should be allowed to increase on cleaning days."""
        sr = np.array([0.90, 0.89, 0.98, 0.97, 0.96])
        rain = np.zeros(5)
        cleaning = np.array([False, False, True, False, False])

        result = enforce_monotonicity(sr, rain, cleaning)

        assert result[2] == 0.98, "Cleaning day should allow SR increase"

    def test_monotonic_after_rain_recovery(self):
        """After a rain recovery, dry days should resume monotonic decline."""
        sr = np.array([0.95, 0.94, 0.93, 0.97, 0.96, 0.97, 0.95])
        rain = np.array([0.0, 0.0, 5.0, 0.0, 0.0, 0.0, 0.0])
        cleaning = np.zeros(7, dtype=bool)

        result = enforce_monotonicity(sr, rain, cleaning)

        # Days 4-6 (after rain recovery) should be monotonically non-increasing
        assert result[5] <= result[4], "Post-recovery dry days should not increase"
        # Expected: day 5 should be clamped from 0.97 to 0.96
        assert result[5] == 0.96

    def test_noisy_dry_spell(self):
        """Realistic noisy dry spell should become monotonic."""
        np.random.seed(42)
        # True soiling: linear decline at 0.15%/day
        true_sr = 1.0 - 0.0015 * np.arange(30)
        # Add noise: ±0.005
        noisy_sr = true_sr + np.random.normal(0, 0.005, 30)

        rain = np.zeros(30)
        cleaning = np.zeros(30, dtype=bool)

        result = enforce_monotonicity(noisy_sr, rain, cleaning)

        # Should be strictly monotonically non-increasing
        for i in range(1, len(result)):
            assert result[i] <= result[i - 1] + 1e-10, \
                f"Day {i}: {result[i]:.6f} > {result[i-1]:.6f}"

    def test_handles_previous_day_rain(self):
        """Rain on previous day should also allow increase."""
        sr = np.array([0.93, 0.93, 0.97, 0.96])
        rain = np.array([0.0, 3.0, 0.0, 0.0])
        cleaning = np.zeros(4, dtype=bool)

        result = enforce_monotonicity(sr, rain, cleaning)
        # Day 2 has rain=3mm, so day 2 itself can increase (checked via i-1 rain)
        # But since day 2's rain is >= threshold, the function checks rain_mm[i] or rain_mm[i-1]
        # For day 2 (i=2): rain_mm[2]=0 but rain_mm[1]=3.0 >= 0.5 → allow increase
        assert result[2] == 0.97


class TestMarkDryPeriods:
    def test_all_dry(self):
        daily = pd.DataFrame({"rain_mm": np.zeros(30)})
        result = mark_dry_periods(daily)
        assert result.all()

    def test_all_wet(self):
        daily = pd.DataFrame({"rain_mm": np.ones(30) * 5.0})
        result = mark_dry_periods(daily)
        assert not result.any()

    def test_mixed(self):
        rain = np.zeros(50)
        rain[25] = 10.0  # big rain on day 25
        daily = pd.DataFrame({"rain_mm": rain})
        result = mark_dry_periods(daily)

        # Days far from rain should be dry
        assert result[0]  # day 0: 14 days window has no rain
        assert result[5]
        # Days near rain should be wet
        assert not result[25]
        assert not result[20]  # within 14-day window of rain

    def test_returns_correct_length(self):
        daily = pd.DataFrame({"rain_mm": np.zeros(100)})
        result = mark_dry_periods(daily)
        assert len(result) == 100
