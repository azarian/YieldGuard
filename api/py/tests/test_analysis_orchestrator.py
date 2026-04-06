"""Tests for AnalysisOrchestrator — computation wrapper."""

import pytest
import asyncio
import numpy as np
import pandas as pd
from datetime import date, timedelta
from unittest.mock import patch, MagicMock

from api.py.analysis_service import AnalysisOrchestrator
from api.py.soiling.config import SystemConfig, SoilingResult
from api.py.soiling.models.clearsky import ClearSkyModel


def _make_synthetic_data(config: SystemConfig, n_days: int = 120):
    """Build synthetic 15-min energy + precip data using the actual pvlib model."""
    model = ClearSkyModel(config)
    np.random.seed(42)

    timestamps = []
    energies = []

    start = date(2024, 1, 1)
    for d in range(n_days):
        day = start + timedelta(days=d)
        power, times = model.compute_profile(day)
        model_energy = power * (15 / 60)
        scale = np.random.uniform(0.90, 0.97)
        naive_times = times.tz_localize(None)

        for t, e in zip(naive_times, model_energy * scale):
            timestamps.append(t)
            energies.append(max(0, float(e)))

    energy_df = pd.DataFrame({"timestamp": timestamps, "energy_wh": energies})

    precip_dates = [start + timedelta(days=d) for d in range(n_days)]
    rain = np.zeros(n_days)
    for idx, val in [(15, 5.0), (45, 12.0), (75, 2.0), (100, 8.0)]:
        if idx < n_days:
            rain[idx] = val

    precip_df = pd.DataFrame({"date": precip_dates, "rain_mm": rain})
    return energy_df, precip_df


class TestAnalysisOrchestrator:
    @pytest.mark.asyncio
    async def test_run_returns_soiling_result(self, system_config):
        energy_df, precip_df = _make_synthetic_data(system_config)
        result = await AnalysisOrchestrator.run(energy_df, precip_df, system_config)

        assert isinstance(result, SoilingResult)
        assert result.summary.n_days > 0
        assert 0.5 <= result.summary.current_sr <= 1.05

    @pytest.mark.asyncio
    async def test_run_raises_http_on_value_error(self, system_config):
        empty_energy = pd.DataFrame(columns=["timestamp", "energy_wh"])
        precip = pd.DataFrame({"date": [date(2024, 1, 1)], "rain_mm": [0.0]})

        from fastapi import HTTPException
        with pytest.raises(HTTPException) as exc_info:
            await AnalysisOrchestrator.run(empty_energy, precip, system_config)
        assert exc_info.value.status_code == 400
        assert "could not complete" in exc_info.value.detail.lower()
