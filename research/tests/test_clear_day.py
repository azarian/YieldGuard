"""Tests for clear-day detection."""

import pytest
import numpy as np
import pandas as pd
from datetime import date

from config import DEFAULT_SYSTEM, ClearDayResult
from analysis.clear_day import CurveMatchDetector


@pytest.fixture
def detector():
    return CurveMatchDetector(DEFAULT_SYSTEM)


class TestCurveMatchDetector:
    def test_perfect_clear_day(self, detector):
        """A perfect match to the model curve should be classified as clear."""
        day = date(2024, 6, 15)
        model_power, model_times = detector.compute_model_profile(day)
        model_energy = model_power * (15 / 60)  # Wh

        # Create "actual" data that's 95% of model (clean panels, slight system loss)
        scale = 0.95
        naive_times = model_times.tz_localize(None)
        intervals = pd.DataFrame({
            "timestamp": naive_times,
            "energy_wh": model_energy * scale,
        })

        result = detector.classify_day(day, intervals, rain_mm=0.0)
        assert result.classification == "clear"
        assert result.fit_score > 0.95
        assert abs(result.model_scale - scale) < 0.05

    def test_cloudy_day(self, detector):
        """Random noise (simulating heavy clouds) should be classified cloudy."""
        day = date(2024, 6, 15)
        model_power, model_times = detector.compute_model_profile(day)

        np.random.seed(42)
        # Random production between 0 and 50% of model
        noisy = model_power * (15 / 60) * np.random.uniform(0, 0.5, len(model_power))

        naive_times = model_times.tz_localize(None)
        intervals = pd.DataFrame({
            "timestamp": naive_times,
            "energy_wh": noisy,
        })

        result = detector.classify_day(day, intervals, rain_mm=0.0)
        assert result.classification == "cloudy"

    def test_partial_day(self, detector):
        """Model curve with some dips (cloud passages) → partial."""
        day = date(2024, 6, 15)
        model_power, model_times = detector.compute_model_profile(day)
        model_energy = model_power * (15 / 60) * 0.95

        # Add cloud dips to ~30% of intervals
        np.random.seed(42)
        energy = model_energy.copy()
        n_intervals = len(energy)
        dip_indices = np.random.choice(n_intervals, size=n_intervals // 3, replace=False)
        energy[dip_indices] *= np.random.uniform(0.3, 0.7, len(dip_indices))

        naive_times = model_times.tz_localize(None)
        intervals = pd.DataFrame({
            "timestamp": naive_times,
            "energy_wh": energy,
        })

        result = detector.classify_day(day, intervals, rain_mm=0.0)
        assert result.classification in ("partial", "cloudy")

    def test_empty_intervals(self, detector):
        """Empty data should be classified as cloudy."""
        day = date(2024, 6, 15)
        intervals = pd.DataFrame(columns=["timestamp", "energy_wh"])
        result = detector.classify_day(day, intervals, rain_mm=0.0)
        assert result.classification == "cloudy"
        assert result.actual_kwh == 0.0

    def test_rain_day_not_clear(self, detector):
        """Even with good fit, rainy day should not be 'clear'."""
        day = date(2024, 6, 15)
        model_power, model_times = detector.compute_model_profile(day)
        model_energy = model_power * (15 / 60) * 0.95

        naive_times = model_times.tz_localize(None)
        intervals = pd.DataFrame({
            "timestamp": naive_times,
            "energy_wh": model_energy,
        })

        result = detector.classify_day(day, intervals, rain_mm=5.0)
        assert result.classification != "clear"
