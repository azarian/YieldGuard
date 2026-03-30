"""
Clear-sky power model using pvlib.

Computes the theoretical 15-min power profile for a given day assuming
perfectly clear skies, accounting for sun position, POA irradiance,
angle-of-incidence losses, temperature, and system losses.
"""

from __future__ import annotations

from datetime import date

import numpy as np
import pandas as pd
import pvlib
from pvlib.location import Location
from pvlib.irradiance import get_total_irradiance
from pvlib.iam import physical as iam_physical

from config import SystemConfig


class ClearSkyModel:
    """Compute clear-sky power profiles for a solar installation."""

    def __init__(self, config: SystemConfig):
        self.config = config
        self.location = Location(config.lat, config.lon, config.tz, config.alt)
        self._cache: dict[date, tuple[np.ndarray, pd.DatetimeIndex]] = {}

    def compute_profile(self, day: date) -> tuple[np.ndarray, pd.DatetimeIndex]:
        """
        Compute 15-min clear-sky power profile for a day.

        Returns:
            power_w: array of power values in Watts for each 15-min interval
            timestamps: DatetimeIndex of the 15-min intervals
        """
        if day in self._cache:
            return self._cache[day]

        c = self.config

        # Generate 5-min timestamps, then resample to 15-min for accuracy
        times_5m = pd.date_range(str(day), periods=24 * 12, freq="5min", tz=c.tz)
        solpos = self.location.get_solarposition(times_5m)
        cs = self.location.get_clearsky(times_5m, model="ineichen", solar_position=solpos)
        dni_extra = pvlib.irradiance.get_extra_radiation(times_5m)

        # Plane-of-array irradiance using Perez transposition model
        poa = get_total_irradiance(
            c.tilt, c.azimuth,
            solpos["apparent_zenith"], solpos["azimuth"],
            cs["dni"], cs["ghi"], cs["dhi"],
            dni_extra=dni_extra, model="perez",
        )

        # Angle-of-incidence modifier
        aoi = pvlib.irradiance.aoi(
            c.tilt, c.azimuth,
            solpos["apparent_zenith"], solpos["azimuth"],
        )
        iam = iam_physical(aoi).fillna(0).clip(0, 1)

        # Effective POA irradiance (beam with IAM + diffuse)
        poa_beam = poa["poa_direct"].fillna(0).clip(lower=0)
        poa_diff = (
            poa["poa_sky_diffuse"].fillna(0) + poa["poa_ground_diffuse"].fillna(0)
        ).clip(lower=0)
        poa_eff = poa_beam * iam + poa_diff * 0.97

        # Cell temperature (Faiman model approximation)
        doy = int(np.mean(times_5m.dayofyear))
        t_amb = 18 + 10 * np.sin(2 * np.pi * (doy - 30) / 365)
        poa_global = poa["poa_global"].fillna(0).clip(lower=0)
        t_cell = t_amb + poa_global.values / (25 + 6.84 * 2)
        temp_f = 1 + c.temp_coeff * (t_cell - 25)

        # System degradation and fixed losses
        years = max(0, pd.Timestamp(str(day)).year - pd.Timestamp(c.install_date).year)
        sys_f = 0.96 * 0.98 * 0.98 * (1 - 0.005 * years)

        # DC power in Watts
        power_5m = (
            (poa_eff.values / 1000) * c.kwp * temp_f * sys_f * 1000
        ).clip(min=0)

        # Aggregate to 15-min average power
        power_df = pd.DataFrame({"power_w": power_5m}, index=times_5m)
        power_15m = power_df.resample("15min").mean()
        timestamps = power_15m.index
        power_arr = power_15m["power_w"].values

        self._cache[day] = (power_arr, timestamps)
        return power_arr, timestamps

    def clear_cache(self) -> None:
        """Clear the internal profile cache."""
        self._cache.clear()
