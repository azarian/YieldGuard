#!/usr/bin/env python3
"""
YieldGuard — Full Historical Soiling Analysis Pipeline
=======================================================
Main orchestrator: fetches data, classifies days, computes soiling,
generates reports and JSON output.
"""

import json
import os

import numpy as np
import pandas as pd

from config import DEFAULT_SYSTEM, DEFAULT_SOLAREDGE
from data.solaredge import fetch_15min_energy
from data.weather import fetch_precipitation
from models.seasonal import fit_seasonal_envelope
from analysis.clear_day import CurveMatchDetector
from analysis.soiling import build_daily, compute_soiling
from reporting.html import build_report

DIR = os.path.dirname(os.path.abspath(__file__))


def main():
    config = DEFAULT_SYSTEM
    se_config = DEFAULT_SOLAREDGE

    print("=" * 60)
    print("YieldGuard \u2014 Full Historical Analysis (6 years)")
    print("  Using 15-min curve-matching clear-day detection")
    print("=" * 60)

    # 1. Fetch 15-min data (cached)
    print("\n1. Fetching 15-min energy data...")
    energy = fetch_15min_energy(se_config)

    # 2. Fetch precipitation (cached)
    dates = energy["timestamp"].dt.date
    print("\n2. Fetching precipitation...")
    precip = fetch_precipitation(str(dates.min()), str(dates.max()), config)

    # 3. Classify days
    print("\n3. Classifying days (curve matching)...")
    detector = CurveMatchDetector(config)
    results = detector.classify_all(energy, precip)

    # 4. Build daily dataframe
    print("\n4. Building daily data...")
    daily = build_daily(results, precip)

    # 5. Fit seasonal envelope
    print("\n5. Fitting seasonal envelope...")
    params, envelope = fit_seasonal_envelope(daily)
    peak_doy = int(np.argmax(envelope.values)) + 1
    print(f"  Envelope peak: DOY {peak_doy} ({envelope.max():.1f} kWh)")
    print(f"  Envelope trough: DOY {int(np.argmin(envelope.values)) + 1} ({envelope.min():.1f} kWh)")

    # 6. Compute soiling (includes cleaning detection + monotonicity enforcement)
    print("\n6. Computing soiling...")
    daily = compute_soiling(daily, envelope, config)

    # 7. Build report
    print("\n7. Building report...")
    build_report(daily, envelope, config, DIR)

    # 8. JSON output
    p = os.path.join(DIR, "soiling_full.json")
    with open(p, "w") as f:
        json.dump(
            [
                {
                    "date": str(r["date"]),
                    "soiling_ratio": round(float(r["soiling_ratio"]), 4),
                    "loss_pct": round(float(r["loss_pct"]), 2),
                    "lost_kwh": round(float(r["lost_kwh"]), 2),
                    "actual_kwh": round(float(r["energy_kwh"]), 2),
                    "est_clean_kwh": round(float(r["est_clean_kwh"]), 2),
                    "rain_mm": round(float(r["rain_mm"]), 1),
                    "classification": r["classification"],
                    "cleaning": bool(r["cleaning"]),
                    "event_type": str(r["event_type"]),
                }
                for _, r in daily.iterrows()
            ],
            f,
        )
    print(f"JSON: {p}")

    sr = daily["soiling_ratio"].iloc[-1]
    print(f"\n{'=' * 60}")
    print(f"Current: SR={sr:.3f} ({(1 - sr) * 100:.1f}% loss)")
    print(f"Lifetime lost: {daily['lost_kwh'].sum():.0f} kWh = \u20aa{daily['lost_ils'].sum():.0f}")
    print(f"Events: {daily['cleaning'].sum()}")


if __name__ == "__main__":
    main()
