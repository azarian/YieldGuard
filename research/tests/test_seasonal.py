"""Tests for seasonal envelope model."""

import pytest
import numpy as np
import pandas as pd

from models.seasonal import fit_seasonal_envelope, seasonal_curve


class TestSeasonalCurve:
    def test_is_periodic(self):
        doy = np.array([1.0, 366.0])
        params = [75, 25, -1.0, 5, -1.0, 2, 0]
        vals = seasonal_curve(doy, *params)
        # DOY 1 and 366 should be approximately equal (annual cycle)
        assert abs(vals[0] - vals[1]) < 1.0

    def test_parameter_count(self):
        doy = np.array([100.0])
        params = [75, 25, -1.0, 5, -1.0, 2, 0]
        result = seasonal_curve(doy, *params)
        assert len(result) == 1


class TestFitSeasonalEnvelope:
    def test_fits_synthetic_seasonal_data(self):
        """Create synthetic data with a known seasonal pattern, verify the fit."""
        np.random.seed(42)

        # Simulate 3 years of clear-day data with seasonal pattern
        dates = []
        energies = []
        for year in [2021, 2022, 2023]:
            for doy in range(1, 366):
                # Skip ~30% of days (cloudy)
                if np.random.random() < 0.3:
                    continue
                # True seasonal pattern: peak ~90 kWh in summer, ~40 kWh in winter
                true_energy = 65 + 25 * np.sin(2 * np.pi * (doy - 80) / 365.25)
                # Add noise + soiling (up to 10% below true)
                observed = true_energy * (1 - np.random.uniform(0, 0.10))
                dates.append(pd.Timestamp(f"{year}-01-01") + pd.Timedelta(days=doy - 1))
                energies.append(observed)

        daily = pd.DataFrame({
            "date": dates,
            "energy_kwh": energies,
            "is_clear": True,
        })

        params, envelope = fit_seasonal_envelope(daily)

        # Verify envelope shape
        assert len(params) == 7
        assert len(envelope) == 366

        # Summer (DOY ~172) should be higher than winter (DOY ~355)
        summer_val = envelope[172]
        winter_val = envelope[355]
        assert summer_val > winter_val, f"Summer ({summer_val:.1f}) should exceed winter ({winter_val:.1f})"

        # Envelope should be smooth (no big jumps between consecutive DOYs)
        diffs = np.abs(np.diff(envelope.values))
        assert diffs.max() < 3.0, f"Max day-to-day envelope change ({diffs.max():.2f}) too large"

    def test_envelope_values_positive(self):
        """Envelope values should all be positive."""
        np.random.seed(123)
        dates = []
        energies = []
        for year in [2022, 2023]:
            for doy in range(1, 366):
                if np.random.random() < 0.3:
                    continue
                energy = 65 + 25 * np.sin(2 * np.pi * (doy - 80) / 365.25)
                dates.append(pd.Timestamp(f"{year}-01-01") + pd.Timedelta(days=doy - 1))
                energies.append(energy * np.random.uniform(0.85, 1.0))

        daily = pd.DataFrame({"date": dates, "energy_kwh": energies, "is_clear": True})
        _, envelope = fit_seasonal_envelope(daily)
        assert (envelope.values > 0).all()
