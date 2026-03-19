#!/usr/bin/env python3
"""
Example: SolarEdge Per-Optimizer Telemetry

Demonstrates all operations available in the SolarEdgeOptimizerClient.
Run this file to verify everything works with your credentials.

Usage:
    pip install requests
    python example_usage.py
"""

from datetime import datetime, timedelta, timezone
from solaredge_client import SolarEdgeOptimizerClient

# ── Configuration ────────────────────────────────────────────────────────────

SITE_ID = 1353684
USERNAME = "nadav.azaria@gmail.com"
PASSWORD = "Ana4rdiv"


def main():
    # ── 1. Create client and authenticate ────────────────────────────────

    print("=" * 60)
    print("SolarEdge Per-Optimizer Telemetry — Example")
    print("=" * 60)

    client = SolarEdgeOptimizerClient(
        site_id=SITE_ID,
        username=USERNAME,
        password=PASSWORD,
    )

    print("\n[1] Authenticating...")
    client.authenticate()
    print("    OK")

    # ── 2. Discover all optimizers ───────────────────────────────────────

    print("\n[2] Discovering optimizers...")
    optimizers = client.discover_optimizers()
    print(f"    Found {len(optimizers)} optimizers:")
    for opt in optimizers[:5]:
        print(f"      {opt.name:20s}  SN: {opt.serial_number:15s}  "
              f"ID: {opt.internal_id}  Today: {opt.today_energy_kwh:.1f} kWh")
    if len(optimizers) > 5:
        print(f"      ... and {len(optimizers) - 5} more")

    # ── 3. Fetch 1 day of power data (high resolution ~5 min) ────────────

    print("\n[3] Fetching 1-day Power data for first optimizer...")
    opt = optimizers[0]
    yesterday = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0) - timedelta(days=1)
    today = yesterday + timedelta(days=1)

    telemetry = client.fetch_optimizer_telemetry(
        optimizer=opt,
        start_date=yesterday,
        end_date=today,
        parameter="Power",
    )
    print(f"    Optimizer: {opt.name} ({opt.serial_number})")
    print(f"    Data points: {len(telemetry.data_points)}")
    if telemetry.data_points:
        print(f"    First: {telemetry.data_points[0].timestamp} → {telemetry.data_points[0].value:.1f} W")
        print(f"    Last:  {telemetry.data_points[-1].timestamp} → {telemetry.data_points[-1].value:.1f} W")
        peak = max(telemetry.data_points, key=lambda p: p.value)
        print(f"    Peak:  {peak.timestamp} → {peak.value:.1f} W")

    # ── 4. Fetch voltage data ────────────────────────────────────────────

    print("\n[4] Fetching 1-day Voltage data...")
    voltage = client.fetch_optimizer_telemetry(
        optimizer=opt,
        start_date=yesterday,
        end_date=today,
        parameter="Voltage",
    )
    print(f"    Data points: {len(voltage.data_points)}")
    if voltage.data_points:
        avg_v = sum(p.value for p in voltage.data_points) / len(voltage.data_points)
        print(f"    Avg voltage: {avg_v:.1f} V")

    # ── 5. Fetch current readings (no auth, public endpoint) ─────────────

    print("\n[5] Fetching current readings (public endpoint)...")
    current = client.fetch_current_readings(opt)
    if current:
        print(f"    Serial: {current.get('serialNumber')}")
        print(f"    Model: {current.get('model')}")
        print(f"    Last reading: {current.get('lastMeasurementDate')}")
        measurements = current.get("measurements", {})
        for key, val in measurements.items():
            print(f"      {key}: {val}")
    else:
        print("    No current readings available")

    # ── 6. Multi-day backfill example (3 days, high resolution) ──────────

    print("\n[6] Backfill example: 3 days of Power at max resolution...")
    three_days_ago = yesterday - timedelta(days=2)

    backfill = client.fetch_optimizer_telemetry_daily(
        optimizer=opt,
        start_date=three_days_ago,
        end_date=yesterday,
        parameter="Power",
    )
    print(f"    Date range: {three_days_ago.strftime('%Y-%m-%d')} to {yesterday.strftime('%Y-%m-%d')}")
    print(f"    Total data points: {len(backfill.data_points)}")

    # Group by day to show distribution
    daily_counts: dict[str, int] = {}
    for p in backfill.data_points:
        day = p.timestamp.strftime("%Y-%m-%d")
        daily_counts[day] = daily_counts.get(day, 0) + 1
    for day, count in sorted(daily_counts.items()):
        print(f"      {day}: {count} points")

    # ── 7. Compare all optimizers for one day ────────────────────────────

    print(f"\n[7] Comparing all {len(optimizers)} optimizers for yesterday...")
    results = []
    for i, opt in enumerate(optimizers):
        tele = client.fetch_optimizer_telemetry(
            optimizer=opt,
            start_date=yesterday,
            end_date=today,
            parameter="Power",
        )
        if tele.data_points:
            avg_power = sum(p.value for p in tele.data_points) / len(tele.data_points)
            peak_power = max(p.value for p in tele.data_points)
        else:
            avg_power = 0
            peak_power = 0
        results.append((opt, avg_power, peak_power, len(tele.data_points)))

        # Progress
        if (i + 1) % 10 == 0:
            print(f"    ... queried {i + 1}/{len(optimizers)}")

    # Sort by average power
    results.sort(key=lambda r: r[1], reverse=True)
    avg_all = sum(r[1] for r in results) / len(results) if results else 0

    print(f"\n    Average power across all panels: {avg_all:.1f} W")
    print(f"\n    Top 5 performers:")
    for opt, avg, peak, pts in results[:5]:
        pct = ((avg - avg_all) / avg_all * 100) if avg_all > 0 else 0
        print(f"      {opt.name:20s}  avg={avg:6.1f} W  peak={peak:6.1f} W  ({pct:+.1f}%)")

    print(f"\n    Bottom 5 performers:")
    for opt, avg, peak, pts in results[-5:]:
        pct = ((avg - avg_all) / avg_all * 100) if avg_all > 0 else 0
        print(f"      {opt.name:20s}  avg={avg:6.1f} W  peak={peak:6.1f} W  ({pct:+.1f}%)")

    # ── Done ─────────────────────────────────────────────────────────────

    print("\n" + "=" * 60)
    print("All examples completed successfully!")
    print("=" * 60)


if __name__ == "__main__":
    main()
