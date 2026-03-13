"""YieldGuard Analytics – FastAPI service deployed as a Vercel Python serverless function."""

from pathlib import Path
from fastapi import FastAPI, Request, HTTPException
from fastapi.responses import JSONResponse
import httpx
import json
import os
import statistics
from datetime import datetime, timezone, timedelta

try:
    from dotenv import load_dotenv
    load_dotenv(Path(__file__).resolve().parents[2] / ".env.local")
except ImportError:
    pass

app = FastAPI(title="YieldGuard Analytics", version="0.2.0")

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
    """GET query to Supabase PostgREST with the caller's JWT so RLS is enforced."""
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
    """POST insert to Supabase PostgREST."""
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
    """PATCH update to Supabase PostgREST."""
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


async def _get_system(token: str) -> dict:
    """Get the caller's first solar system or raise 404."""
    systems = await _supabase_query(
        token,
        "solar_systems",
        {"select": "id,system_name,site_id,last_synced_at,latitude,longitude,peak_power_kwp,azimuth,tilt,electricity_price_per_kwh"},
    )
    if not systems:
        raise HTTPException(status_code=404, detail="No solar system registered")
    return systems[0]


# ── Open-Meteo ───────────────────────────────────────────────────────────────


async def _fetch_irradiance(lat: float, lng: float, start: str, end: str) -> dict[str, list]:
    """Fetch hourly actual and clear-sky irradiance from Open-Meteo.

    Returns {"time": [...], "actual": [...], "clear_sky": [...]} with W/m2 values.
    """
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
    """Build a lookup from ISO hour string -> (actual_wm2, clear_sky_wm2)."""
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
    return {"status": "ok", "service": "yieldguard-analytics", "version": "0.2.0"}


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


# ── Main Analysis Endpoint ──────────────────────────────────────────────────


@app.get("/api/py/analyze")
async def analyze(request: Request):
    token = _get_token(request)
    system = await _get_system(token)

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


# ── Loss Analysis ────────────────────────────────────────────────────────────


def _compute_losses(
    power_values: list[dict],
    irradiance_map: dict[str, tuple[float, float]],
    peak_kwp: float,
) -> dict:
    """Compare actual 15-min power readings against weather-adjusted and clear-sky expectations.

    SolarEdge power values are in Watts (instantaneous). Each interval is 15 min = 0.25 h.
    Open-Meteo irradiance is hourly W/m2. Standard Test Conditions assume 1000 W/m2 = rated kWp.
    So expected_power_w = (irradiance / 1000) * peak_kwp * 1000 * efficiency.
    """
    interval_hours = 0.25
    daily: dict[str, dict] = {}

    for entry in power_values:
        dt_str = entry.get("date", "")
        actual_w = entry.get("value")
        if actual_w is None:
            actual_w = 0.0

        # Parse "2026-02-28 12:15:00" -> date key + hour key
        try:
            dt = datetime.strptime(dt_str, "%Y-%m-%d %H:%M:%S")
        except (ValueError, TypeError):
            continue

        date_key = dt.strftime("%Y-%m-%d")
        hour_key = dt.strftime("%Y-%m-%dT%H:00")

        actual_irr, clear_sky_irr = irradiance_map.get(hour_key, (0.0, 0.0))

        # Expected power in watts: (irradiance / STC) * system_kWp * 1000 * efficiency
        weather_expected_w = (actual_irr / 1000.0) * peak_kwp * 1000.0 * SYSTEM_EFFICIENCY
        clear_sky_expected_w = (clear_sky_irr / 1000.0) * peak_kwp * 1000.0 * SYSTEM_EFFICIENCY

        # Convert to energy (Wh) for the 15-min interval
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

    # Build per-day list and totals
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

    system_loss_pct = (
        (total_system_loss / total_weather_exp * 100) if total_weather_exp > 0 else 0
    )
    cloud_loss_pct = (
        (total_cloud_loss / total_clear_sky * 100) if total_clear_sky > 0 else 0
    )

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


def _generate_recommendations(
    system_id: str, losses: dict
) -> list[dict]:
    """Produce recommendation dicts based on loss analysis thresholds."""
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
                f"Estimated loss: {totals['system_loss_kwh']} kWh over the last 7 days."
            ),
            "metadata": {
                "system_loss_pct": sys_loss_pct,
                "system_loss_kwh": totals["system_loss_kwh"],
            },
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
                f"Estimated loss: {totals['system_loss_kwh']} kWh over the last 7 days."
            ),
            "metadata": {
                "system_loss_pct": sys_loss_pct,
                "system_loss_kwh": totals["system_loss_kwh"],
            },
            "status": "active",
            "analysis_context": {"period_totals": totals},
        })

    # Check for time-of-day shading pattern
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
            # High avg loss but low variance = consistent issue, possibly shade
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
                    "metadata": {
                        "avg_loss_ratio": round(avg_ratio, 3),
                        "loss_std_dev": round(std_ratio, 3),
                    },
                    "status": "active",
                    "analysis_context": {"period_totals": totals},
                })

    # Degradation trend: compare first half vs second half of period
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


def _compute_monetary(losses: dict, price_per_kwh: float | None) -> dict | None:
    """Compute monetary losses if the user has set an electricity price."""
    if not price_per_kwh or price_per_kwh <= 0:
        return None

    totals = losses["totals"]
    daily = losses["daily"]
    days_count = len(daily)

    loss_7d = totals["system_loss_kwh"] * price_per_kwh

    # Today = last day in the list (or 0)
    loss_today = (daily[-1]["system_loss_kwh"] * price_per_kwh) if daily else 0

    # Average daily loss
    avg_daily_loss_kwh = totals["system_loss_kwh"] / days_count if days_count > 0 else 0
    avg_daily_loss_money = avg_daily_loss_kwh * price_per_kwh

    # Monthly projection (30 days at current average rate)
    loss_monthly_projected = avg_daily_loss_money * 30

    # Yearly projection
    loss_yearly_projected = avg_daily_loss_money * 365

    return {
        "currency_per_kwh": price_per_kwh,
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

    lat = system.get("latitude")
    lng = system.get("longitude")
    kwp = system.get("peak_power_kwp")

    if not lat or not lng or not kwp:
        raise HTTPException(
            status_code=400,
            detail=(
                "Site details (latitude, longitude, peak power) are not available. "
                "Please sync your system first to fetch site details from SolarEdge."
            ),
        )

    # Get synced power data
    sync_rows = await _supabase_query(
        token,
        "sync_data",
        {
            "select": "sync_type,data,period_start,period_end",
            "system_id": f"eq.{system['id']}",
            "sync_type": "eq.power",
        },
    )
    if not sync_rows:
        raise HTTPException(status_code=404, detail="No power data available. Please sync first.")

    power_row = sync_rows[0]
    power_values = power_row.get("data", {}).get("power", {}).get("values", [])
    if not power_values:
        raise HTTPException(status_code=404, detail="Power data is empty.")

    start_date = power_row.get("period_start", "")
    end_date = power_row.get("period_end", "")

    # Fetch irradiance from Open-Meteo
    irradiance = await _fetch_irradiance(lat, lng, start_date, end_date)
    irradiance_map = _build_irradiance_map(irradiance)

    # Compute losses
    losses = _compute_losses(power_values, irradiance_map, kwp)

    # Generate recommendations and store them
    recs = _generate_recommendations(system["id"], losses)
    stored_recs = []
    if recs:
        stored_recs = await _supabase_insert(token, "recommendations", recs)

    return {
        "system": {
            "name": system["system_name"],
            "site_id": system["site_id"],
            "peak_power_kwp": kwp,
            "latitude": lat,
            "longitude": lng,
        },
        "losses": losses,
        "monetary": _compute_monetary(losses, system.get("electricity_price_per_kwh")),
        "recommendations_created": len(stored_recs),
        "analyzed_at": datetime.now(timezone.utc).isoformat(),
    }


# ── Recommendations API ──────────────────────────────────────────────────────


@app.get("/api/py/recommendations")
async def list_recommendations(request: Request):
    token = _get_token(request)
    system = await _get_system(token)

    status_filter = request.query_params.get("status", "active")

    recs = await _supabase_query(
        token,
        "recommendations",
        {
            "select": "id,type,severity,title,message,metadata,status,created_at,status_changed_at",
            "system_id": f"eq.{system['id']}",
            "status": f"eq.{status_filter}",
            "order": "created_at.desc",
        },
    )

    return {"recommendations": recs}


@app.patch("/api/py/recommendations/{rec_id}")
async def update_recommendation(rec_id: str, request: Request):
    token = _get_token(request)

    body = await request.json()
    new_status = body.get("status")
    if new_status not in ("dismissed", "resolved"):
        raise HTTPException(status_code=400, detail="Status must be 'dismissed' or 'resolved'")

    updated = await _supabase_patch(
        token,
        "recommendations",
        {"id": f"eq.{rec_id}"},
        {"status": new_status, "status_changed_at": datetime.now(timezone.utc).isoformat()},
    )

    return {"updated": updated}


# ── Global error handler ────────────────────────────────────────────────────


@app.exception_handler(Exception)
async def global_exception_handler(_request: Request, exc: Exception):
    return JSONResponse(
        status_code=500,
        content={"error": str(exc)},
    )
