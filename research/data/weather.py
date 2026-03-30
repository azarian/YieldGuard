"""
Weather data fetching (Open-Meteo) with CSV caching.
"""

from __future__ import annotations

import logging
import os
from datetime import timedelta

import pandas as pd
import requests

from config import SystemConfig, DEFAULT_SYSTEM

logger = logging.getLogger(__name__)


def fetch_precipitation(
    start: str,
    end: str,
    config: SystemConfig = DEFAULT_SYSTEM,
    cache_path: str | None = None,
) -> pd.DataFrame:
    """
    Fetch daily precipitation from Open-Meteo archive API.
    Caches to CSV after first fetch.

    Returns DataFrame with columns: date, rain_mm
    """
    if cache_path is None:
        cache_path = os.path.join(
            os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
            "precip_cache.csv",
        )

    if os.path.exists(cache_path):
        precip = pd.read_csv(cache_path, parse_dates=["date"])
        precip["date"] = precip["date"].dt.date
        last = precip["date"].max()
        end_d = pd.Timestamp(str(end)).date()
        if last >= end_d - timedelta(days=1):
            return precip
        start = str(last + timedelta(days=1))
        existing = precip
    else:
        existing = None

    all_data = []
    cursor = pd.Timestamp(str(start))
    end_ts = pd.Timestamp(str(end))

    while cursor < end_ts:
        chunk_end = min(cursor + pd.Timedelta(days=365), end_ts)
        r = requests.get(
            "https://archive-api.open-meteo.com/v1/archive",
            params={
                "latitude": config.lat,
                "longitude": config.lon,
                "start_date": cursor.strftime("%Y-%m-%d"),
                "end_date": chunk_end.strftime("%Y-%m-%d"),
                "daily": "precipitation_sum",
                "timezone": config.tz,
            },
            timeout=60,
        )
        r.raise_for_status()
        d = r.json()
        for dt, rain in zip(d["daily"]["time"], d["daily"]["precipitation_sum"]):
            all_data.append(
                {"date": pd.Timestamp(dt).date(), "rain_mm": rain if rain else 0}
            )
        cursor = chunk_end + pd.Timedelta(days=1)

    new_df = pd.DataFrame(all_data)
    if existing is not None:
        df = pd.concat([existing, new_df], ignore_index=True)
        df = (
            df.drop_duplicates(subset=["date"])
            .sort_values("date")
            .reset_index(drop=True)
        )
    else:
        df = new_df

    df.to_csv(cache_path, index=False)
    logger.info("Precipitation: %d days, %d rain days", len(df), (df["rain_mm"] > 0.5).sum())
    return df
