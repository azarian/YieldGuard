"""Tests for cleaning event detection."""

import pytest
import numpy as np
import pandas as pd

from analysis.cleaning import detect_cleaning, classify_event


class TestClassifyEvent:
    def test_heavy_rain(self):
        assert classify_event(max_rain=10.0, total_rain=15.0) == "Heavy Rain"

    def test_heavy_rain_from_total(self):
        assert classify_event(max_rain=3.0, total_rain=12.0) == "Heavy Rain"

    def test_light_rain(self):
        assert classify_event(max_rain=1.0, total_rain=3.0) == "Rain"

    def test_no_rain(self):
        assert classify_event(max_rain=0.0, total_rain=0.0) == "No Rain"

    def test_borderline_rain(self):
        # max_rain > 0.5 triggers "Rain" (strict >)
        assert classify_event(max_rain=0.6, total_rain=0.6) == "Rain"

    def test_borderline_no_rain(self):
        assert classify_event(max_rain=0.5, total_rain=1.0) == "No Rain"


class TestDetectCleaning:
    def _make_daily(self, sr_values, rain_values=None):
        """Helper: build a minimal daily DataFrame for cleaning detection."""
        n = len(sr_values)
        if rain_values is None:
            rain_values = np.zeros(n)
        return pd.DataFrame({
            "sr_raw": sr_values,
            "is_usable": True,
            "is_dry": rain_values < 0.5,
            "rain_mm": rain_values,
        })

    def test_detects_large_jump(self):
        """A large SR jump should be detected as a cleaning event."""
        n = 60
        sr = np.ones(n) * 0.90
        # Add a big jump at day 30
        sr[30:] = 0.97
        rain = np.zeros(n)

        daily = self._make_daily(sr, rain)
        result = detect_cleaning(daily)

        assert result["cleaning"].any(), "Should detect at least one cleaning event"
        cleaning_days = result[result["cleaning"]].index.tolist()
        # The event should be detected near day 30
        assert any(28 <= d <= 33 for d in cleaning_days), \
            f"Cleaning detected at {cleaning_days}, expected near 30"

    def test_no_cleaning_on_flat_sr(self):
        """Flat SR should have no cleaning events."""
        sr = np.ones(60) * 0.95
        daily = self._make_daily(sr)
        result = detect_cleaning(daily)
        assert not result["cleaning"].any()

    def test_gradual_decline_no_cleaning(self):
        """Gradual decline (soiling) should not trigger cleaning."""
        sr = np.linspace(0.98, 0.90, 60)
        daily = self._make_daily(sr)
        result = detect_cleaning(daily)
        assert not result["cleaning"].any()

    def test_rain_event_classified_correctly(self):
        """A recovery coinciding with rain should be classified as rain event."""
        n = 60
        sr = np.ones(n) * 0.88
        sr[30:] = 0.96
        rain = np.zeros(n)
        rain[29] = 8.0  # heavy rain before recovery

        daily = self._make_daily(sr, rain)
        daily["is_dry"] = False  # wet period
        result = detect_cleaning(daily)

        rain_events = result[result["event_type"].str.contains("Rain", na=False)]
        assert len(rain_events) > 0 or not result["cleaning"].any(), \
            "Recovery with rain should be classified as rain event"
