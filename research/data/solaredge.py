"""
SolarEdge API data fetching with CSV caching.
"""

from __future__ import annotations

import os
import time
from datetime import date, timedelta

import pandas as pd
import requests

from config import SolarEdgeConfig, DEFAULT_SOLAREDGE


def fetch_15min_energy(
    config: SolarEdgeConfig = DEFAULT_SOLAREDGE,
    start: str | date = "2020-02-02",
    end: str | date = "2026-03-24",
    cache_path: str | None = None,
) -> pd.DataFrame:
    """
    Fetch 15-min energy from SolarEdge API, month by month.
    Caches to CSV after first fetch.

    Returns DataFrame with columns: timestamp, energy_wh, date
    """
    if cache_path is None:
        cache_path = os.path.join(
            os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
            "energy_15min_cache.csv",
        )

    if os.path.exists(cache_path):
        print(f"Loading cached 15-min data from {cache_path}...")
        df = pd.read_csv(cache_path, parse_dates=["timestamp"])
        last_cached = df["timestamp"].max().date()
        end_date = pd.Timestamp(str(end)).date()
        if last_cached >= end_date - timedelta(days=1):
            df["date"] = df["timestamp"].dt.date
            print(f"  {len(df)} records, {df['date'].nunique()} days")
            return df
        else:
            print(f"  Cache ends at {last_cached}, fetching to {end_date}...")
            start = str(last_cached + timedelta(days=1))
            existing = df
    else:
        existing = None

    start_date = pd.Timestamp(str(start)).date()
    end_date = pd.Timestamp(str(end)).date()

    all_records = []
    cursor = start_date.replace(day=1)

    total_months = (
        (end_date.year - cursor.year) * 12 + end_date.month - cursor.month + 1
    )
    month_i = 0

    while cursor <= end_date:
        if cursor.month == 12:
            next_month_1st = cursor.replace(year=cursor.year + 1, month=1, day=1)
        else:
            next_month_1st = cursor.replace(month=cursor.month + 1, day=1)
        month_end = next_month_1st - timedelta(days=1)
        month_end = min(month_end, end_date)
        req_start = max(cursor, start_date)

        month_i += 1
        print(
            f"  Fetching {req_start} to {month_end} ({month_i}/{total_months})...",
            end="\r",
        )

        for attempt in range(3):
            try:
                r = requests.get(
                    f"https://monitoringapi.solaredge.com/site/{config.site_id}/energy",
                    params={
                        "api_key": config.api_key,
                        "timeUnit": "QUARTER_OF_AN_HOUR",
                        "startDate": str(req_start),
                        "endDate": str(month_end),
                    },
                    timeout=30,
                )
                r.raise_for_status()
                break
            except requests.exceptions.HTTPError:
                if attempt < 2:
                    time.sleep(2**attempt)
                else:
                    raise
        data = r.json()

        for v in data["energy"]["values"]:
            wh = v["value"]
            if wh is not None:
                all_records.append(
                    {"timestamp": pd.Timestamp(v["date"]), "energy_wh": float(wh)}
                )

        cursor = next_month_1st

    print(f"  Fetched {len(all_records)} non-null records from {total_months} months")

    new_df = pd.DataFrame(all_records)
    if existing is not None:
        df = pd.concat([existing, new_df], ignore_index=True)
        df = (
            df.drop_duplicates(subset=["timestamp"])
            .sort_values("timestamp")
            .reset_index(drop=True)
        )
    else:
        df = new_df.sort_values("timestamp").reset_index(drop=True)

    df.to_csv(cache_path, index=False)
    print(f"  Cached to {cache_path}")

    df["date"] = df["timestamp"].dt.date
    print(f"  {len(df)} records, {df['date'].nunique()} days")
    return df
