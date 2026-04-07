"""YieldGuard Analytics – FastAPI service deployed as a Vercel Python serverless function."""

from pathlib import Path
from fastapi import FastAPI, Request, HTTPException
from fastapi.responses import JSONResponse
import asyncio
import httpx
import os
import statistics
import traceback
from datetime import datetime, timezone, timedelta

try:
    from dotenv import load_dotenv
    load_dotenv(Path(__file__).resolve().parents[2] / ".env.local")
except ImportError:
    pass

try:
    from api.py.solaredge_client import SolarEdgeOptimizerClient
except ImportError:
    from solaredge_client import SolarEdgeOptimizerClient

app = FastAPI(title="YieldGuard Analytics", version="0.4.0")

SUPABASE_URL = os.environ.get("NEXT_PUBLIC_SUPABASE_URL", "")
SUPABASE_ANON_KEY = os.environ.get("NEXT_PUBLIC_SUPABASE_ANON_KEY", "")
SYSTEM_EFFICIENCY = 0.80
OPEN_METEO_BASE = "https://archive-api.open-meteo.com/v1/archive"


# ── Helpers ──────────────────────────────────────────────────────────────────


def _get_token(request: Request) -> str:
    auth = request.headers.get("authorization", "")
    if not auth.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing or invalid authorization header")
    return auth.split(" ", 1)[1]


def _supabase_headers(token: str) -> dict:
    return {
        "apikey": SUPABASE_ANON_KEY,
        "Authorization": f"Bearer {token}",
        "Accept": "application/json",
        "Content-Type": "application/json",
        "Prefer": "return=representation",
    }


async def _supabase_query(token: str, table: str, params: dict | None = None) -> list:
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.get(
            f"{SUPABASE_URL}/rest/v1/{table}",
            headers=_supabase_headers(token),
            params=params or {},
        )
        if resp.status_code != 200:
            raise HTTPException(
                status_code=resp.status_code,
                detail=f"Supabase query failed: {resp.text}",
            )
        return resp.json()


async def _supabase_insert(token: str, table: str, rows: list[dict]) -> list:
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.post(
            f"{SUPABASE_URL}/rest/v1/{table}",
            headers=_supabase_headers(token),
            json=rows,
        )
        if resp.status_code not in (200, 201):
            raise HTTPException(
                status_code=resp.status_code,
                detail=f"Supabase insert failed: {resp.text}",
            )
        return resp.json()


async def _supabase_patch(token: str, table: str, params: dict, body: dict) -> list:
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.patch(
            f"{SUPABASE_URL}/rest/v1/{table}",
            headers=_supabase_headers(token),
            params=params,
            json=body,
        )
        if resp.status_code not in (200, 204):
            raise HTTPException(
                status_code=resp.status_code,
                detail=f"Supabase patch failed: {resp.text}",
            )
        return resp.json() if resp.status_code == 200 else []


async def _supabase_rpc(token: str, fn_name: str, body: dict) -> list | dict:
    """Call a Supabase RPC (database function)."""
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.post(
            f"{SUPABASE_URL}/rest/v1/rpc/{fn_name}",
            headers=_supabase_headers(token),
            json=body,
        )
        if resp.status_code not in (200, 201):
            raise HTTPException(
                status_code=resp.status_code,
                detail=f"Supabase RPC failed: {resp.text}",
            )
        return resp.json()


async def _get_system(token: str) -> dict:
    systems = await _supabase_query(
        token,
        "solar_systems",
        {"select": "id,system_name,site_id,last_synced_at,latitude,longitude,peak_power_kwp,azimuth,tilt,electricity_price_per_kwh,currency,altitude,installation_date"},
    )
    if not systems:
        raise HTTPException(status_code=404, detail="No solar system registered")
    return systems[0]


# ── Open-Meteo ───────────────────────────────────────────────────────────────


async def _fetch_irradiance(lat: float, lng: float, start: str, end: str) -> dict[str, list]:
    params = {
        "latitude": lat,
        "longitude": lng,
        "start_date": start,
        "end_date": end,
        "hourly": "shortwave_radiation,shortwave_radiation_clear_sky",
        "timezone": "UTC",
    }
    async with httpx.AsyncClient(timeout=20) as client:
        resp = await client.get(OPEN_METEO_BASE, params=params)
        if resp.status_code != 200:
            raise HTTPException(status_code=502, detail=f"Open-Meteo API error: {resp.text}")
        data = resp.json()

    hourly = data.get("hourly", {})
    return {
        "time": hourly.get("time", []),
        "actual": hourly.get("shortwave_radiation", []),
        "clear_sky": hourly.get("shortwave_radiation_clear_sky", []),
    }


def _build_irradiance_map(irradiance: dict[str, list]) -> dict[str, tuple[float, float]]:
    result: dict[str, tuple[float, float]] = {}
    times = irradiance["time"]
    actual = irradiance["actual"]
    clear_sky = irradiance["clear_sky"]
    for i, t in enumerate(times):
        a = actual[i] if i < len(actual) and actual[i] is not None else 0.0
        c = clear_sky[i] if i < len(clear_sky) and clear_sky[i] is not None else 0.0
        result[t] = (a, c)
    return result


# ── Health ───────────────────────────────────────────────────────────────────


@app.get("/api/py/health")
async def health():
    return {"status": "ok", "service": "yieldguard-analytics", "version": "0.3.0"}


# ── Main Analysis Endpoint (reads from structured DB tables) ─────────────────


@app.get("/api/py/analyze")
async def analyze(request: Request):
    token = _get_token(request)
    system = await _get_system(token)
    system_id = system["id"]

    end_date = datetime.now(timezone.utc).date()
    start_date = end_date - timedelta(days=7)

    # Fetch daily energy from site_energy_daily
    daily_rows = await _supabase_query(
        token,
        "site_energy_daily",
        {
            "select": "date,energy_wh",
            "system_id": f"eq.{system_id}",
            "date": f"gte.{start_date.isoformat()}",
            "order": "date.asc",
        },
    )

    # If no site_energy_daily data, try to aggregate from equipment_telemetry
    if not daily_rows:
        equipment_rows = await _supabase_query(
            token, "equipment", {"select": "id", "system_id": f"eq.{system_id}"},
        )
        if equipment_rows:
            equip_ids = [e["id"] for e in equipment_rows]
            # Fetch telemetry for the last 7 days
            all_telemetry = []
            for eid in equip_ids:
                tele = await _supabase_query(
                    token,
                    "equipment_telemetry",
                    {
                        "select": "ts,energy_wh,power_w",
                        "equipment_id": f"eq.{eid}",
                        "ts": f"gte.{start_date.isoformat()}",
                        "order": "ts.asc",
                    },
                )
                all_telemetry.extend(tele)

            # Aggregate into daily sums
            daily_agg: dict[str, float] = {}
            for t in all_telemetry:
                d = t["ts"][:10]
                val = t.get("energy_wh") or 0
                if val:
                    daily_agg[d] = daily_agg.get(d, 0) + val
                elif t.get("power_w"):
                    daily_agg[d] = daily_agg.get(d, 0) + (t["power_w"] * 0.25)

            daily_rows = [{"date": d, "energy_wh": v} for d, v in sorted(daily_agg.items())]

    if not daily_rows:
        raise HTTPException(
            status_code=404, detail="No synced data available. Please sync your system first."
        )

    # Analyze energy data
    daily_values = [
        {"date": r["date"], "kwh": round((r["energy_wh"] or 0) / 1000, 2)}
        for r in daily_rows if r.get("energy_wh") and r["energy_wh"] > 0
    ]

    if not daily_values:
        raise HTTPException(status_code=404, detail="No energy data found in the synced period.")

    energies = [d["kwh"] for d in daily_values]
    total = sum(energies)
    avg = statistics.mean(energies)
    best = max(daily_values, key=lambda d: d["kwh"])
    worst = min(daily_values, key=lambda d: d["kwh"])

    mid = len(energies) // 2
    first_half = statistics.mean(energies[:mid]) if mid > 0 else 0
    second_half = statistics.mean(energies[mid:]) if mid > 0 else 0
    trend_pct = ((second_half - first_half) / first_half * 100) if first_half > 0 else 0
    trend_dir = "up" if trend_pct > 5 else ("down" if trend_pct < -5 else "stable")

    consistency = 100.0
    if avg > 0 and len(energies) > 1:
        consistency = max(0, 100 - (statistics.stdev(energies) / avg) * 100)

    # Get peak power from telemetry
    peak_kw = 0.0
    peak_time = ""
    equipment_rows = await _supabase_query(
        token, "equipment", {"select": "id", "system_id": f"eq.{system_id}"},
    )
    if equipment_rows:
        # Sum power across all equipment per timestamp for site-level peak
        all_power: dict[str, float] = {}
        for eq in equipment_rows:
            tele = await _supabase_query(
                token,
                "equipment_telemetry",
                {
                    "select": "ts,power_w",
                    "equipment_id": f"eq.{eq['id']}",
                    "ts": f"gte.{start_date.isoformat()}",
                    "order": "ts.asc",
                    "limit": "2000",
                },
            )
            for t in tele:
                if t.get("power_w") and t["power_w"] > 0:
                    ts_key = t["ts"]
                    all_power[ts_key] = all_power.get(ts_key, 0) + t["power_w"]

        if all_power:
            peak_ts = max(all_power, key=all_power.get)  # type: ignore[arg-type]
            peak_kw = round(all_power[peak_ts] / 1000, 2)
            peak_time = peak_ts

    analysis = {
        "energy": {
            "total_kwh": round(total, 2),
            "average_daily_kwh": round(avg, 2),
            "best_day": best,
            "worst_day": worst,
            "trend": {"direction": trend_dir, "change_pct": round(trend_pct, 1)},
            "consistency_score": round(consistency, 1),
            "daily_values": daily_values,
            "days_analyzed": len(daily_values),
        },
    }

    if peak_kw > 0:
        active_count = sum(1 for v in all_power.values() if v > 0)
        total_count = len(all_power)
        avg_active = statistics.mean([v for v in all_power.values() if v > 0]) if active_count > 0 else 0
        analysis["power"] = {
            "peak_kw": peak_kw,
            "peak_time": peak_time,
            "average_active_kw": round(avg_active / 1000, 2),
            "active_intervals": active_count,
            "total_intervals": total_count,
        }

    return {
        "system": {
            "system_name": system["system_name"],
            "site_id": system["site_id"],
            "last_synced_at": system.get("last_synced_at"),
        },
        "analysis": analysis,
        "analyzed_at": datetime.now(timezone.utc).isoformat(),
    }


# ── Loss Analysis (reads from equipment_telemetry) ───────────────────────────


def _compute_losses(
    power_entries: list[dict],
    irradiance_map: dict[str, tuple[float, float]],
    peak_kwp: float,
) -> dict:
    """Compare actual power readings against weather-adjusted and clear-sky expectations."""
    interval_hours = 0.25
    daily: dict[str, dict] = {}

    for entry in power_entries:
        ts_str = entry.get("ts", "")
        actual_w = entry.get("power_w") or 0.0

        try:
            dt = datetime.fromisoformat(ts_str.replace("Z", "+00:00"))
        except (ValueError, TypeError):
            continue

        date_key = dt.strftime("%Y-%m-%d")
        hour_key = dt.strftime("%Y-%m-%dT%H:00")

        actual_irr, clear_sky_irr = irradiance_map.get(hour_key, (0.0, 0.0))

        weather_expected_w = (actual_irr / 1000.0) * peak_kwp * 1000.0 * SYSTEM_EFFICIENCY
        clear_sky_expected_w = (clear_sky_irr / 1000.0) * peak_kwp * 1000.0 * SYSTEM_EFFICIENCY

        actual_wh = actual_w * interval_hours
        weather_expected_wh = weather_expected_w * interval_hours
        clear_sky_expected_wh = clear_sky_expected_w * interval_hours

        cloud_loss_wh = max(0.0, clear_sky_expected_wh - weather_expected_wh)
        system_loss_wh = max(0.0, weather_expected_wh - actual_wh)

        if date_key not in daily:
            daily[date_key] = {
                "actual_wh": 0.0,
                "weather_expected_wh": 0.0,
                "clear_sky_expected_wh": 0.0,
                "cloud_loss_wh": 0.0,
                "system_loss_wh": 0.0,
            }
        d = daily[date_key]
        d["actual_wh"] += actual_wh
        d["weather_expected_wh"] += weather_expected_wh
        d["clear_sky_expected_wh"] += clear_sky_expected_wh
        d["cloud_loss_wh"] += cloud_loss_wh
        d["system_loss_wh"] += system_loss_wh

    total_actual = 0.0
    total_weather_exp = 0.0
    total_clear_sky = 0.0
    total_cloud_loss = 0.0
    total_system_loss = 0.0
    days = []

    for date_key in sorted(daily):
        d = daily[date_key]
        total_actual += d["actual_wh"]
        total_weather_exp += d["weather_expected_wh"]
        total_clear_sky += d["clear_sky_expected_wh"]
        total_cloud_loss += d["cloud_loss_wh"]
        total_system_loss += d["system_loss_wh"]
        days.append({
            "date": date_key,
            "actual_kwh": round(d["actual_wh"] / 1000, 2),
            "weather_expected_kwh": round(d["weather_expected_wh"] / 1000, 2),
            "clear_sky_expected_kwh": round(d["clear_sky_expected_wh"] / 1000, 2),
            "cloud_loss_kwh": round(d["cloud_loss_wh"] / 1000, 2),
            "system_loss_kwh": round(d["system_loss_wh"] / 1000, 2),
        })

    system_loss_pct = (total_system_loss / total_weather_exp * 100) if total_weather_exp > 0 else 0
    cloud_loss_pct = (total_cloud_loss / total_clear_sky * 100) if total_clear_sky > 0 else 0

    return {
        "totals": {
            "actual_kwh": round(total_actual / 1000, 2),
            "weather_expected_kwh": round(total_weather_exp / 1000, 2),
            "clear_sky_expected_kwh": round(total_clear_sky / 1000, 2),
            "cloud_loss_kwh": round(total_cloud_loss / 1000, 2),
            "system_loss_kwh": round(total_system_loss / 1000, 2),
            "system_loss_pct": round(system_loss_pct, 1),
            "cloud_loss_pct": round(cloud_loss_pct, 1),
        },
        "daily": days,
    }


# ── Recommendation Generation ────────────────────────────────────────────────


def _generate_recommendations(system_id: str, losses: dict) -> list[dict]:
    recs: list[dict] = []
    totals = losses["totals"]
    sys_loss_pct = totals["system_loss_pct"]

    if sys_loss_pct > 15:
        recs.append({
            "system_id": system_id,
            "type": "cleaning",
            "severity": "critical",
            "title": "Significant production loss detected",
            "message": (
                f"Your system is producing {sys_loss_pct:.1f}% less than expected after accounting "
                f"for weather. This suggests dirty panels or a shading issue. "
                f"Estimated loss: {totals['system_loss_kwh']} kWh over the analyzed period."
            ),
            "metadata": {"system_loss_pct": sys_loss_pct, "system_loss_kwh": totals["system_loss_kwh"]},
            "status": "active",
            "analysis_context": {"period_totals": totals},
        })
    elif sys_loss_pct > 8:
        recs.append({
            "system_id": system_id,
            "type": "cleaning",
            "severity": "warning",
            "title": "Moderate production loss detected",
            "message": (
                f"Your system is producing {sys_loss_pct:.1f}% less than expected. "
                f"Consider scheduling a panel cleaning. "
                f"Estimated loss: {totals['system_loss_kwh']} kWh over the analyzed period."
            ),
            "metadata": {"system_loss_pct": sys_loss_pct, "system_loss_kwh": totals["system_loss_kwh"]},
            "status": "active",
            "analysis_context": {"period_totals": totals},
        })

    daily = losses["daily"]
    if len(daily) >= 3:
        loss_ratios = [
            d["system_loss_kwh"] / d["weather_expected_kwh"]
            if d["weather_expected_kwh"] > 0 else 0
            for d in daily
        ]
        if len(loss_ratios) > 1:
            avg_ratio = statistics.mean(loss_ratios)
            std_ratio = statistics.stdev(loss_ratios)
            if avg_ratio > 0.10 and std_ratio < 0.05:
                recs.append({
                    "system_id": system_id,
                    "type": "shade_check",
                    "severity": "warning",
                    "title": "Possible shading detected",
                    "message": (
                        "Production loss is consistent across days, which may indicate "
                        "a shading issue (e.g., a tree or structure blocking sunlight). "
                        "Check for obstructions near your panels."
                    ),
                    "metadata": {"avg_loss_ratio": round(avg_ratio, 3), "loss_std_dev": round(std_ratio, 3)},
                    "status": "active",
                    "analysis_context": {"period_totals": totals},
                })

    if len(daily) >= 4:
        mid = len(daily) // 2
        first_losses = [d["system_loss_kwh"] for d in daily[:mid]]
        second_losses = [d["system_loss_kwh"] for d in daily[mid:]]
        avg_first = statistics.mean(first_losses) if first_losses else 0
        avg_second = statistics.mean(second_losses) if second_losses else 0
        if avg_first > 0 and avg_second > avg_first * 1.3:
            recs.append({
                "system_id": system_id,
                "type": "degradation",
                "severity": "info",
                "title": "Production efficiency declining",
                "message": (
                    "System losses appear to be increasing over the analyzed period. "
                    "This may indicate soiling buildup. Monitor over the coming weeks."
                ),
                "metadata": {
                    "first_half_avg_loss_kwh": round(avg_first, 2),
                    "second_half_avg_loss_kwh": round(avg_second, 2),
                },
                "status": "active",
                "analysis_context": {"period_totals": totals},
            })

    return recs


CURRENCY_SYMBOLS = {"ILS": "₪", "USD": "$", "EUR": "€"}


def _compute_monetary(
    losses: dict, price_per_kwh: float | None, currency: str = "ILS"
) -> dict | None:
    if not price_per_kwh or price_per_kwh <= 0:
        return None

    totals = losses["totals"]
    daily = losses["daily"]
    days_count = len(daily)

    loss_7d = totals["system_loss_kwh"] * price_per_kwh
    loss_today = (daily[-1]["system_loss_kwh"] * price_per_kwh) if daily else 0
    avg_daily_loss_kwh = totals["system_loss_kwh"] / days_count if days_count > 0 else 0
    avg_daily_loss_money = avg_daily_loss_kwh * price_per_kwh
    loss_monthly_projected = avg_daily_loss_money * 30
    loss_yearly_projected = avg_daily_loss_money * 365

    return {
        "currency_per_kwh": price_per_kwh,
        "currency": currency,
        "currency_symbol": CURRENCY_SYMBOLS.get(currency, currency),
        "loss_today": round(loss_today, 2),
        "loss_7d": round(loss_7d, 2),
        "loss_monthly_projected": round(loss_monthly_projected, 2),
        "loss_yearly_projected": round(loss_yearly_projected, 2),
        "avg_daily_loss": round(avg_daily_loss_money, 2),
    }


@app.get("/api/py/analyze/losses")
async def analyze_losses(request: Request):
    token = _get_token(request)
    system = await _get_system(token)
    system_id = system["id"]

    lat = system.get("latitude")
    lng = system.get("longitude")
    kwp = system.get("peak_power_kwp")

    if not lat or not lng or not kwp:
        raise HTTPException(
            status_code=400,
            detail="Site details (latitude, longitude, peak power) are not available. Please sync your system first.",
        )

    end_date = datetime.now(timezone.utc).date()
    start_date = end_date - timedelta(days=7)

    # Get all equipment for this system
    equipment = await _supabase_query(
        token, "equipment", {"select": "id", "system_id": f"eq.{system_id}"},
    )

    if not equipment:
        raise HTTPException(status_code=404, detail="No equipment found. Please sync first.")

    # Aggregate site-level power per timestamp from telemetry
    site_power: dict[str, float] = {}
    for eq in equipment:
        tele = await _supabase_query(
            token,
            "equipment_telemetry",
            {
                "select": "ts,power_w",
                "equipment_id": f"eq.{eq['id']}",
                "ts": f"gte.{start_date.isoformat()}",
                "order": "ts.asc",
            },
        )
        for t in tele:
            pw = t.get("power_w") or 0.0
            site_power[t["ts"]] = site_power.get(t["ts"], 0) + pw

    if not site_power:
        raise HTTPException(status_code=404, detail="No telemetry data available for loss analysis.")

    power_entries = [{"ts": ts, "power_w": pw} for ts, pw in sorted(site_power.items())]

    # Fetch irradiance
    irradiance = await _fetch_irradiance(lat, lng, start_date.isoformat(), end_date.isoformat())
    irradiance_map = _build_irradiance_map(irradiance)

    losses = _compute_losses(power_entries, irradiance_map, kwp)

    return {
        "system": {
            "name": system["system_name"],
            "site_id": system["site_id"],
            "peak_power_kwp": kwp,
            "latitude": lat,
            "longitude": lng,
        },
        "losses": losses,
        "monetary": _compute_monetary(
            losses,
            system.get("electricity_price_per_kwh"),
            system.get("currency", "ILS"),
        ),
        "analyzed_at": datetime.now(timezone.utc).isoformat(),
    }




# ── Soiling Analysis (new — uses SoilingAnalyzer + site_energy_15min) ────────


@app.get("/api/py/analyze/soiling")
async def analyze_soiling(request: Request):
    from timezonefinder import TimezoneFinder
    from api.py.analysis_service import (
        SiteDataLoader, AnalysisOrchestrator, ResponseFormatter, build_system_config,
    )

    token = _get_token(request)
    system = await _get_system(token)
    system_id = system["id"]

    lat = system.get("latitude")
    lng = system.get("longitude")
    kwp = system.get("peak_power_kwp")

    if not lat or not lng or not kwp:
        raise HTTPException(
            status_code=400,
            detail="Site details (latitude, longitude, peak power) are not available. Please sync your system first.",
        )

    tf = TimezoneFinder()
    tz_str = tf.timezone_at(lat=lat, lng=lng) or "UTC"

    end_date = datetime.now(timezone.utc).date()
    start_date = end_date - timedelta(days=365)

    loader = SiteDataLoader(token)
    energy_df = await loader.load_site_energy(system_id, start_date.isoformat(), end_date.isoformat())
    precip_df = await loader.load_precipitation(lat, lng, start_date.isoformat(), end_date.isoformat())

    config = build_system_config(system, tz_str)
    result = await AnalysisOrchestrator.run(energy_df, precip_df, config)

    price = system.get("electricity_price_per_kwh")
    currency = system.get("currency", "ILS")

    response = ResponseFormatter.format(result, price, currency)

    return {
        "system": {
            "name": system["system_name"],
            "site_id": system["site_id"],
            "peak_power_kwp": kwp,
            "latitude": lat,
            "longitude": lng,
        },
        **response,
    }

# ── Per-Panel Analysis ───────────────────────────────────────────────────────


@app.get("/api/py/analyze/panels")
async def analyze_panels(request: Request):
    token = _get_token(request)
    system = await _get_system(token)
    system_id = system["id"]

    end_date = datetime.now(timezone.utc).date()
    start_date = end_date - timedelta(days=7)

    # Get all optimizers
    equipment = await _supabase_query(
        token,
        "equipment",
        {
            "select": "id,serial_number,name,equipment_type",
            "system_id": f"eq.{system_id}",
            "equipment_type": "eq.optimizer",
        },
    )

    if not equipment:
        return {"panels": [], "message": "No optimizer data available"}

    panel_stats: list[dict] = []
    energy_values: list[float] = []

    for eq in equipment:
        tele = await _supabase_query(
            token,
            "equipment_telemetry",
            {
                "select": "ts,power_w,energy_wh",
                "equipment_id": f"eq.{eq['id']}",
                "ts": f"gte.{start_date.isoformat()}",
                "order": "ts.asc",
            },
        )

        if not tele:
            continue

        total_energy_wh = 0.0
        total_power = 0.0
        count = 0
        for t in tele:
            e = t.get("energy_wh") or 0.0
            p = t.get("power_w") or 0.0
            if e > 0:
                total_energy_wh += e
            elif p > 0:
                total_energy_wh += p * 0.25
            if p > 0:
                total_power += p
                count += 1

        total_energy_kwh = total_energy_wh / 1000.0
        avg_power = total_power / count if count > 0 else 0

        panel_stats.append({
            "serial_number": eq["serial_number"],
            "name": eq.get("name"),
            "total_energy_kwh": round(total_energy_kwh, 2),
            "avg_power_w": round(avg_power, 1),
        })
        energy_values.append(total_energy_kwh)

    if not panel_stats:
        return {"panels": [], "message": "No telemetry data available"}

    avg_energy = statistics.mean(energy_values) if energy_values else 0

    panels = []
    for ps in panel_stats:
        deviation = ((ps["total_energy_kwh"] - avg_energy) / avg_energy * 100) if avg_energy > 0 else 0
        status = "underperforming" if deviation < -10 else ("above_average" if deviation > 10 else "normal")
        panels.append({
            **ps,
            "deviation_pct": round(deviation, 1),
            "status": status,
        })

    panels.sort(key=lambda p: p["deviation_pct"])

    return {
        "panels": panels,
        "avg_energy_kwh": round(avg_energy, 2),
        "panel_count": len(panels),
        "underperforming_count": sum(1 for p in panels if p["status"] == "underperforming"),
        "analyzed_at": datetime.now(timezone.utc).isoformat(),
    }



# ── Optimizer Sync Endpoints ──────────────────────────────────────────────────


_portal_clients: dict[str, SolarEdgeOptimizerClient] = {}


def _get_portal_client(site_id: int, username: str, password: str, force_new: bool = False) -> SolarEdgeOptimizerClient:
    """Get or create a cached portal client for the given site."""
    key = f"{site_id}:{username}"
    client = _portal_clients.get(key) if not force_new else None
    if client is None or client.password != password:
        client = SolarEdgeOptimizerClient(
            site_id=site_id, username=username, password=password,
        )
        _portal_clients[key] = client
    return client


@app.post("/api/py/portal/discover")
async def portal_discover(request: Request):
    """Authenticate to the SolarEdge portal and discover optimizers.

    Body: { site_id, username, password }
    Returns: { optimizers: [{ internal_id, serial_number, name, today_energy_kwh }] }
    """
    body = await request.json()
    site_id = body.get("site_id")
    username = body.get("username")
    password = body.get("password")

    if not site_id or not username or not password:
        raise HTTPException(status_code=400, detail="site_id, username, and password are required")

    def _do_discover():
        client = _get_portal_client(int(site_id), username, password)
        client.authenticate()
        return client.discover_optimizers()

    try:
        optimizers = await asyncio.to_thread(_do_discover)
    except RuntimeError as e:
        print(f"[portal/discover] Auth failed: {e}")
        raise HTTPException(status_code=401, detail=str(e))
    except Exception as e:
        print(f"[portal/discover] Error: {type(e).__name__}: {e}")
        traceback.print_exc()
        raise HTTPException(status_code=502, detail=f"Portal communication error: {e}")

    return {
        "optimizers": [
            {
                "internal_id": opt.internal_id,
                "serial_number": opt.serial_number,
                "name": opt.name,
                "today_energy_kwh": opt.today_energy_kwh,
            }
            for opt in optimizers
        ],
    }


@app.post("/api/py/portal/fetch-chunk")
async def portal_fetch_chunk(request: Request):
    """Fetch one day of optimizer telemetry for a single optimizer.

    Body: { site_id, username, password, internal_id, serial_number, name, date, parameter }
    Returns: { data_points: [{ ts, value }], count }
    """
    body = await request.json()
    site_id = body.get("site_id")
    username = body.get("username")
    password = body.get("password")
    internal_id = body.get("internal_id")
    date_str = body.get("date")
    parameter = body.get("parameter", "Power")

    if not all([site_id, username, password, internal_id, date_str]):
        raise HTTPException(status_code=400, detail="site_id, username, password, internal_id, and date are required")

    try:
        from api.py.solaredge_client import Optimizer
    except ImportError:
        from solaredge_client import Optimizer

    opt = Optimizer(
        internal_id=int(internal_id),
        serial_number=body.get("serial_number", ""),
        name=body.get("name", ""),
    )

    day_start = datetime.strptime(date_str, "%Y-%m-%d").replace(tzinfo=timezone.utc)
    day_end = day_start + timedelta(days=1)

    def _do_fetch():
        client = _get_portal_client(int(site_id), username, password)
        if not client._authenticated:
            client.authenticate()
        return client.fetch_optimizer_telemetry(
            optimizer=opt, start_date=day_start, end_date=day_end, parameter=parameter,
        )

    def _do_fetch_with_reauth():
        client = _get_portal_client(int(site_id), username, password)
        client.authenticate()
        return client.fetch_optimizer_telemetry(
            optimizer=opt, start_date=day_start, end_date=day_end, parameter=parameter,
        )

    try:
        telemetry = await asyncio.to_thread(_do_fetch)
    except RuntimeError as e:
        if "authentication" in str(e).lower() or "401" in str(e):
            try:
                telemetry = await asyncio.to_thread(_do_fetch_with_reauth)
            except Exception as retry_err:
                print(f"[portal/fetch-chunk] Retry error: {retry_err}")
                traceback.print_exc()
                raise HTTPException(status_code=502, detail=f"Portal retry failed: {retry_err}")
        else:
            raise HTTPException(status_code=502, detail=str(e))
    except Exception as e:
        print(f"[portal/fetch-chunk] Error: {e}")
        traceback.print_exc()
        raise HTTPException(status_code=502, detail=f"Portal communication error: {e}")

    return {
        "data_points": [
            {"ts": dp.timestamp.isoformat(), "value": dp.value}
            for dp in telemetry.data_points
        ],
        "count": len(telemetry.data_points),
    }


# ── Global error handler ────────────────────────────────────────────────────


@app.exception_handler(Exception)
async def global_exception_handler(_request: Request, exc: Exception):
    return JSONResponse(
        status_code=500,
        content={"error": str(exc)},
    )
