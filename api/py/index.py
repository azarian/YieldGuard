"""YieldGuard Analytics – FastAPI service deployed as a Vercel Python serverless function."""

from pathlib import Path
from fastapi import FastAPI, Request, HTTPException
from fastapi.responses import JSONResponse
import httpx
import os
import statistics
from datetime import datetime, timezone

try:
    from dotenv import load_dotenv
    load_dotenv(Path(__file__).resolve().parents[2] / ".env.local")
except ImportError:
    pass

app = FastAPI(title="YieldGuard Analytics", version="0.1.0")

SUPABASE_URL = os.environ.get("NEXT_PUBLIC_SUPABASE_URL", "")
SUPABASE_ANON_KEY = os.environ.get("NEXT_PUBLIC_SUPABASE_ANON_KEY", "")


def _get_token(request: Request) -> str:
    auth = request.headers.get("authorization", "")
    if not auth.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing or invalid authorization header")
    return auth.split(" ", 1)[1]


async def _supabase_query(token: str, table: str, params: dict | None = None) -> list:
    """Query Supabase PostgREST with the caller's JWT so RLS is enforced."""
    headers = {
        "apikey": SUPABASE_ANON_KEY,
        "Authorization": f"Bearer {token}",
        "Accept": "application/json",
    }
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.get(
            f"{SUPABASE_URL}/rest/v1/{table}",
            headers=headers,
            params=params or {},
        )
        if resp.status_code != 200:
            raise HTTPException(
                status_code=resp.status_code,
                detail=f"Supabase query failed: {resp.text}",
            )
        return resp.json()


# ── Health ────────────────────────────────────────────────────────────────────


@app.get("/api/py/health")
async def health():
    return {"status": "ok", "service": "yieldguard-analytics", "version": "0.1.0"}


# ── Energy Analysis ──────────────────────────────────────────────────────────


def _analyze_energy(energy_row: dict) -> dict | None:
    values = energy_row.get("data", {}).get("energy", {}).get("values", [])
    daily = [v for v in values if v.get("value") is not None and v["value"] > 0]

    if not daily:
        return None

    energies = [v["value"] for v in daily]
    best = max(daily, key=lambda v: v["value"])
    worst = min(daily, key=lambda v: v["value"])
    avg = statistics.mean(energies)
    total = sum(energies)

    mid = len(energies) // 2
    first_half = statistics.mean(energies[:mid]) if mid > 0 else 0
    second_half = statistics.mean(energies[mid:]) if mid > 0 else 0
    trend_pct = ((second_half - first_half) / first_half * 100) if first_half > 0 else 0
    trend_dir = "up" if trend_pct > 5 else ("down" if trend_pct < -5 else "stable")

    consistency = 100.0
    if avg > 0 and len(energies) > 1:
        consistency = max(0, 100 - (statistics.stdev(energies) / avg) * 100)

    return {
        "total_kwh": round(total / 1000, 2),
        "average_daily_kwh": round(avg / 1000, 2),
        "best_day": {"date": best["date"], "kwh": round(best["value"] / 1000, 2)},
        "worst_day": {"date": worst["date"], "kwh": round(worst["value"] / 1000, 2)},
        "trend": {"direction": trend_dir, "change_pct": round(trend_pct, 1)},
        "consistency_score": round(consistency, 1),
        "daily_values": [
            {"date": v["date"], "kwh": round(v["value"] / 1000, 2)} for v in daily
        ],
        "days_analyzed": len(daily),
    }


# ── Power Analysis ───────────────────────────────────────────────────────────


def _analyze_power(power_row: dict) -> dict | None:
    values = power_row.get("data", {}).get("power", {}).get("values", [])
    active = [v for v in values if v.get("value") is not None and v["value"] > 0]

    if not active:
        return None

    powers = [v["value"] for v in active]
    peak = max(active, key=lambda v: v["value"])

    return {
        "peak_kw": round(peak["value"] / 1000, 2),
        "peak_time": peak["date"],
        "average_active_kw": round(statistics.mean(powers) / 1000, 2),
        "active_intervals": len(active),
        "total_intervals": len(values),
    }


# ── Overview Insights ────────────────────────────────────────────────────────


def _analyze_overview(overview_row: dict) -> dict | None:
    overview = overview_row.get("data", {}).get("overview", {})
    if not overview:
        return None

    lifetime_wh = overview.get("lifeTimeData", {}).get("energy", 0) or 0
    last_month_wh = overview.get("lastMonthData", {}).get("energy", 0) or 0
    last_day_wh = overview.get("lastDayData", {}).get("energy", 0) or 0
    current_power = overview.get("currentPower", {}).get("power", 0) or 0

    return {
        "lifetime_mwh": round(lifetime_wh / 1_000_000, 2),
        "last_month_kwh": round(last_month_wh / 1000, 1),
        "last_day_kwh": round(last_day_wh / 1000, 1),
        "current_power_kw": round(current_power / 1000, 2),
        "is_producing": current_power > 0,
    }


# ── Main Analysis Endpoint ───────────────────────────────────────────────────


@app.get("/api/py/analyze")
async def analyze(request: Request):
    token = _get_token(request)

    systems = await _supabase_query(
        token, "solar_systems", {"select": "id,system_name,site_id,last_synced_at"}
    )
    if not systems:
        raise HTTPException(status_code=404, detail="No solar system registered")

    system = systems[0]

    sync_rows = await _supabase_query(
        token,
        "sync_data",
        {
            "select": "sync_type,data,period_start,period_end,synced_at",
            "system_id": f"eq.{system['id']}",
            "order": "synced_at.desc",
        },
    )
    if not sync_rows:
        raise HTTPException(
            status_code=404, detail="No synced data available. Please sync your system first."
        )

    overview_row = next((r for r in sync_rows if r["sync_type"] == "overview"), None)
    energy_row = next((r for r in sync_rows if r["sync_type"] == "energy"), None)
    power_row = next((r for r in sync_rows if r["sync_type"] == "power"), None)

    analysis: dict = {}
    if energy_row:
        energy = _analyze_energy(energy_row)
        if energy:
            analysis["energy"] = energy
    if power_row:
        power = _analyze_power(power_row)
        if power:
            analysis["power"] = power
    if overview_row:
        overview = _analyze_overview(overview_row)
        if overview:
            analysis["overview"] = overview

    return {
        "system": system,
        "analysis": analysis,
        "analyzed_at": datetime.now(timezone.utc).isoformat(),
    }


# ── Global error handler ────────────────────────────────────────────────────


@app.exception_handler(Exception)
async def global_exception_handler(_request: Request, exc: Exception):
    return JSONResponse(
        status_code=500,
        content={"error": str(exc)},
    )
