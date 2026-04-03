"""
Seasonal envelope model.
"""

from __future__ import annotations

import numpy as np
import pandas as pd
from scipy.optimize import curve_fit


def seasonal_curve(doy: np.ndarray, A, B, phi1, C, phi2, D, phi3) -> np.ndarray:
    return (
        A
        + B * np.sin(2 * np.pi * doy / 365.25 + phi1)
        + C * np.sin(4 * np.pi * doy / 365.25 + phi2)
        + D * np.sin(6 * np.pi * doy / 365.25 + phi3)
    )


def fit_seasonal_envelope(daily: pd.DataFrame) -> tuple[np.ndarray, pd.Series]:
    clear = daily[daily["is_clear"]].copy()
    clear["doy"] = pd.to_datetime(clear["date"]).dt.dayofyear

    n_bins = 36
    clear["bin"] = pd.cut(clear["doy"], bins=n_bins)
    bin_stats = (
        clear.groupby("bin")
        .agg(
            p95=("energy_kwh", lambda x: x.quantile(0.95)),
            mid_doy=("doy", "mean"),
            count=("doy", "count"),
        )
        .dropna()
    )

    bin_stats = bin_stats[bin_stats["count"] >= 3]

    x = bin_stats["mid_doy"].values.astype(float)
    y = bin_stats["p95"].values

    p0 = [75, 25, -1.0, 5, -1.0, 2, 0]
    params, _ = curve_fit(seasonal_curve, x, y, p0=p0, maxfev=10000)

    doys = np.arange(1, 367)
    envelope_values = seasonal_curve(doys, *params)
    envelope = pd.Series(envelope_values, index=doys, name="envelope_kwh")

    return params, envelope
