"""Tests for the SoilingAnalyzer production API."""

import pytest
import numpy as np
import pandas as pd
from datetime import date, timedelta

from config import SystemConfig, DEFAULT_SYSTEM, SoilingSummary, SoilingResult
from models.clearsky import ClearSkyModel
from api import SoilingAnalyzer


@pytest.fixture
def config():
    return DEFAULT_SYSTEM


@pytest.fixture
def analyzer(config):
    return SoilingAnalyzer(config)


def _make_synthetic_data(config=None, n_days=120):
    """Build synthetic 15-min energy + precip data using actual clear-sky model.

    Uses the pvlib model to generate realistic clear-day curves so that
    the classifier will actually classify days as 'clear'.
    """
    if config is None:
        config = DEFAULT_SYSTEM

    model = ClearSkyModel(config)
    np.random.seed(42)

    timestamps = []
    energies = []

    start = date(2024, 1, 1)
    for d in range(n_days):
        day = start + timedelta(days=d)
        power, times = model.compute_profile(day)
        model_energy = power * (15 / 60)  # W → Wh per 15 min

        # Scale to ~95% of model (clean panels, slight system loss)
        scale = np.random.uniform(0.90, 0.97)
        naive_times = times.tz_localize(None)

        for t, e in zip(naive_times, model_energy * scale):
            timestamps.append(t)
            energies.append(max(0, float(e)))

    energy_df = pd.DataFrame({
        "timestamp": timestamps,
        "energy_wh": energies,
    })

    # Precipitation: mostly dry, some rain events
    precip_dates = [start + timedelta(days=d) for d in range(n_days)]
    rain = np.zeros(n_days)
    for idx, val in [(15, 5.0), (16, 3.0), (45, 12.0), (75, 2.0), (100, 8.0)]:
        if idx < n_days:
            rain[idx] = val

    precip_df = pd.DataFrame({
        "date": precip_dates,
        "rain_mm": rain,
    })

    return energy_df, precip_df


class TestSoilingAnalyzer:
    def test_analyze_returns_soiling_result(self, analyzer):
        """analyze() should return a SoilingResult with all fields populated."""
        energy, precip = _make_synthetic_data()
        result = analyzer.analyze(energy, precip)

        assert isinstance(result, SoilingResult)
        assert isinstance(result.summary, SoilingSummary)
        assert isinstance(result.daily, pd.DataFrame)
        assert isinstance(result.events, pd.DataFrame)
        assert isinstance(result.envelope, pd.Series)
        assert result.config is analyzer.config

    def test_daily_has_required_columns(self, analyzer):
        """The daily DataFrame should have all analysis columns."""
        energy, precip = _make_synthetic_data()
        result = analyzer.analyze(energy, precip)

        required = {
            "date", "soiling_ratio", "loss_pct", "lost_kwh",
            "cleaning", "event_type", "rain_mm", "energy_kwh",
        }
        assert required.issubset(set(result.daily.columns))

    def test_summary_fields_reasonable(self, analyzer):
        """Summary values should be physically reasonable."""
        energy, precip = _make_synthetic_data()
        result = analyzer.analyze(energy, precip)

        s = result.summary
        assert 0.5 <= s.current_sr <= 1.05, f"SR {s.current_sr} out of range"
        assert s.current_loss_pct >= 0
        assert s.n_days == len(result.daily)
        assert s.total_lost_kwh >= 0
        assert s.n_cleaning_events >= 0

    def test_events_subset_of_daily(self, analyzer):
        """Events should be a filtered subset of daily."""
        energy, precip = _make_synthetic_data()
        result = analyzer.analyze(energy, precip)

        assert len(result.events) == result.daily["cleaning"].sum()
        if len(result.events) > 0:
            assert all(result.events["cleaning"])

    def test_envelope_covers_full_year(self, analyzer):
        """Envelope should have 366 DOY values."""
        energy, precip = _make_synthetic_data()
        result = analyzer.analyze(energy, precip)

        assert len(result.envelope) == 366
        assert all(result.envelope > 0)

    def test_build_charts(self, analyzer):
        """build_charts() should return dict of Plotly figures."""
        energy, precip = _make_synthetic_data()
        result = analyzer.analyze(energy, precip)
        charts = analyzer.build_charts(result)

        assert isinstance(charts, dict)
        assert "timeline" in charts
        assert "yearly" in charts

    def test_validates_missing_energy_columns(self, analyzer):
        """Should raise ValueError if energy DataFrame missing columns."""
        bad_energy = pd.DataFrame({"ts": [1], "wh": [100]})
        precip = pd.DataFrame({"date": [date(2024, 1, 1)], "rain_mm": [0.0]})

        with pytest.raises(ValueError, match="energy_15min missing"):
            analyzer.analyze(bad_energy, precip)

    def test_validates_missing_precip_columns(self, analyzer):
        """Should raise ValueError if precip DataFrame missing columns."""
        energy = pd.DataFrame({
            "timestamp": [pd.Timestamp("2024-01-01 12:00")],
            "energy_wh": [100.0],
        })
        bad_precip = pd.DataFrame({"day": [date(2024, 1, 1)], "precipitation": [0.0]})

        with pytest.raises(ValueError, match="precip missing"):
            analyzer.analyze(energy, bad_precip)

    def test_validates_empty_energy(self, analyzer):
        """Should raise ValueError if energy DataFrame is empty."""
        energy = pd.DataFrame(columns=["timestamp", "energy_wh"])
        precip = pd.DataFrame({"date": [date(2024, 1, 1)], "rain_mm": [0.0]})

        with pytest.raises(ValueError, match="empty"):
            analyzer.analyze(energy, precip)
