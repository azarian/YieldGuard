"""Tests for clear-sky model."""

import pytest
import numpy as np
from datetime import date

from config import SystemConfig
from models.clearsky import ClearSkyModel


@pytest.fixture
def model():
    config = SystemConfig(
        lat=31.33, lon=34.90, alt=350, kwp=15.84,
        tilt=20, azimuth=180, tz="Asia/Jerusalem",
        install_date="2019-11-03",
    )
    return ClearSkyModel(config)


class TestClearSkyModel:
    def test_power_is_zero_at_night(self, model):
        power, times = model.compute_profile(date(2024, 6, 21))
        # Night hours (0:00-4:00 and 21:00-23:45) should be ~0
        night_indices = [i for i, t in enumerate(times) if t.hour < 5 or t.hour >= 21]
        assert len(night_indices) > 0
        for idx in night_indices:
            assert power[idx] < 10, f"Power at {times[idx]} should be ~0, got {power[idx]}"

    def test_power_peaks_around_noon(self, model):
        power, times = model.compute_profile(date(2024, 6, 21))
        peak_idx = np.argmax(power)
        peak_hour = times[peak_idx].hour
        assert 10 <= peak_hour <= 14, f"Peak at hour {peak_hour}, expected 10-14"

    def test_summer_produces_more_than_winter(self, model):
        summer_power, _ = model.compute_profile(date(2024, 6, 21))
        winter_power, _ = model.compute_profile(date(2024, 12, 21))

        summer_energy = summer_power.sum() * (15 / 60)  # Wh
        winter_energy = winter_power.sum() * (15 / 60)

        assert summer_energy > winter_energy * 1.2, \
            f"Summer ({summer_energy:.0f} Wh) should be >20% more than winter ({winter_energy:.0f} Wh)"

    def test_profile_is_smooth(self, model):
        power, _ = model.compute_profile(date(2024, 6, 21))
        # During daylight, power changes should be gradual
        daylight = power[power > 100]
        if len(daylight) > 2:
            diffs = np.abs(np.diff(daylight))
            max_jump = diffs.max()
            assert max_jump < daylight.max() * 0.15, \
                f"Max 15-min jump ({max_jump:.0f}W) too large for smooth clear-sky curve"

    def test_total_energy_reasonable(self, model):
        # A 15.84 kWp system in Israel summer should produce roughly 80-120 kWh/day
        power, _ = model.compute_profile(date(2024, 6, 21))
        total_kwh = power.sum() * (15 / 60) / 1000
        assert 50 < total_kwh < 150, f"Daily energy {total_kwh:.1f} kWh out of reasonable range"

    def test_caching_works(self, model):
        day = date(2024, 3, 20)
        p1, t1 = model.compute_profile(day)
        p2, t2 = model.compute_profile(day)
        np.testing.assert_array_equal(p1, p2)

    def test_clear_cache(self, model):
        model.compute_profile(date(2024, 1, 1))
        assert len(model._cache) > 0
        model.clear_cache()
        assert len(model._cache) == 0
