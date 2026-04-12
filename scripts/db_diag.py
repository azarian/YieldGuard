"""Quick diagnostic script for querying the production Supabase database."""

import asyncio
import os
import json
import httpx
from pathlib import Path
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parents[1] / ".env.local")

SUPABASE_URL = os.environ["NEXT_PUBLIC_SUPABASE_URL"]
SUPABASE_KEY = os.environ["NEXT_PUBLIC_SUPABASE_ANON_KEY"]

HEADERS = {
    "apikey": SUPABASE_KEY,
    "Authorization": f"Bearer {SUPABASE_KEY}",
    "Accept": "application/json",
}


async def query(table: str, params: dict) -> list:
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.get(
            f"{SUPABASE_URL}/rest/v1/{table}",
            headers=HEADERS,
            params=params,
        )
        if resp.status_code != 200:
            print(f"ERROR {resp.status_code}: {resp.text[:200]}")
            return []
        return resp.json()


async def main():
    print("=== 1. Systems ===")
    systems = await query("solar_systems", {
        "select": "id,system_name,site_id,installation_date,last_synced_at",
        "limit": "5",
    })
    for s in systems:
        print(f"  {s['system_name']} | id={s['id'][:8]}... | site={s['site_id']} | installed={s.get('installation_date')}")

    if not systems:
        print("  No systems found!")
        return

    system_id = systems[0]["id"]
    print(f"\nUsing system: {system_id}")

    print("\n=== 2. Equipment ===")
    equipment = await query("equipment", {
        "select": "id,serial_number,equipment_type,name",
        "system_id": f"eq.{system_id}",
    })
    inverters = [e for e in equipment if e["equipment_type"] == "inverter"]
    optimizers = [e for e in equipment if e["equipment_type"] == "optimizer"]
    print(f"  {len(inverters)} inverters, {len(optimizers)} optimizers")
    for e in inverters:
        print(f"  INV: {e['serial_number']} ({e.get('name', 'unnamed')})")

    print("\n=== 3. Recent telemetry (last 7 days, power > 0) ===")
    from datetime import datetime, timedelta, timezone
    start = (datetime.now(timezone.utc) - timedelta(days=7)).date().isoformat()

    total_readings = 0
    total_energy_wh = 0.0
    days_seen = set()

    for eq in inverters:
        rows = await query("equipment_telemetry", {
            "select": "ts,power_w",
            "equipment_id": f"eq.{eq['id']}",
            "ts": f"gte.{start}",
            "order": "ts.asc",
            "limit": "2000",
        })
        for r in rows:
            p = r.get("power_w") or 0
            if p > 0:
                total_readings += 1
                total_energy_wh += p * 0.25
                days_seen.add(r["ts"][:10])

    print(f"  Inverter readings with power > 0: {total_readings}")
    print(f"  Days with data: {sorted(days_seen)}")
    print(f"  Total energy (from power): {total_energy_wh / 1000:.1f} kWh")

    if not total_readings:
        print("\n  ⚠ No inverter data with power > 0 in last 7 days!")
        print("  Checking ALL equipment (including optimizers)...")

        for eq in equipment[:3]:  # check first 3
            rows = await query("equipment_telemetry", {
                "select": "ts,power_w",
                "equipment_id": f"eq.{eq['id']}",
                "ts": f"gte.{start}",
                "power_w": "gt.0",
                "limit": "5",
            })
            print(f"  {eq['equipment_type']} {eq.get('name','')}: {len(rows)} rows with power>0")

    print("\n=== 4. data_coverage (new table) ===")
    coverage = await query("data_coverage", {
        "select": "worker_id,period_start,period_end,status",
        "system_id": f"eq.{system_id}",
        "order": "worker_id,period_start.asc",
        "limit": "20",
    })
    if coverage:
        for c in coverage:
            print(f"  {c['worker_id']}: {c['period_start']} → {c['period_end']} [{c['status']}]")
    else:
        print("  No data_coverage rows yet (migration may not be applied)")

    print("\n=== 5. daily_energy (new table) ===")
    daily = await query("daily_energy", {
        "select": "date,energy_wh",
        "system_id": f"eq.{system_id}",
        "order": "date.desc",
        "limit": "5",
    })
    if daily:
        for d in daily:
            print(f"  {d['date']}: {d['energy_wh'] / 1000:.1f} kWh")
    else:
        print("  Empty (expected — not populated yet)")

    print("\n=== 6. analysis_results (cache) ===")
    results = await query("analysis_results", {
        "select": "worker_id,data_start,data_end,coverage_hash,computed_at",
        "system_id": f"eq.{system_id}",
        "limit": "5",
    })
    if results:
        for r in results:
            print(f"  {r['worker_id']}: {r['data_start']} → {r['data_end']} (hash={r['coverage_hash']}, at={r['computed_at']})")
    else:
        print("  Empty (expected — no analysis run yet)")


if __name__ == "__main__":
    asyncio.run(main())
