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

    # Fetch daily energy from daily_energy table
    daily_rows = await _supabase_query(
        token,
        "daily_energy",
        {
            "select": "date,energy_wh",
            "system_id": f"eq.{system_id}",
            "date": f"gte.{start_date.isoformat()}",
            "order": "date.asc",
        },
    )

    # If no daily_energy data, aggregate from equipment_telemetry.
    # NOTE: energy_wh in equipment_telemetry is a CUMULATIVE lifetime counter
    # (totalEnergy from SolarEdge API), NOT incremental per-interval energy.
    # We compute energy from power × interval_hours, where the interval is
    # determined dynamically from consecutive timestamps (~5 min for SolarEdge).
    # Only inverter data is used (to avoid double-counting with optimizer data).
    if not daily_rows:
        equipment_rows = await _supabase_query(
            token, "equipment",
            {"select": "id", "system_id": f"eq.{system_id}", "equipment_type": "eq.inverter"},
        )
        if equipment_rows:
            all_telemetry = []
            for eq in equipment_rows:
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
                all_telemetry.extend(tele)

            # Sort by timestamp and compute energy using actual intervals
            all_telemetry.sort(key=lambda t: t["ts"])
            daily_agg: dict[str, float] = {}
            for i, t in enumerate(all_telemetry):
                power = t.get("power_w") or 0
                if power <= 0:
                    continue
                # Compute interval in hours from gap to next reading (or previous)
                if i + 1 < len(all_telemetry):
                    ts_cur = datetime.fromisoformat(t["ts"])
                    ts_next = datetime.fromisoformat(all_telemetry[i + 1]["ts"])
                    interval_h = (ts_next - ts_cur).total_seconds() / 3600
                else:
                    interval_h = 5 / 60  # default 5 min for last reading
                # Clamp to reasonable range (1 min to 1 hour)
                interval_h = max(1 / 60, min(1.0, interval_h))
                d = t["ts"][:10]
                daily_agg[d] = daily_agg.get(d, 0) + (power * interval_h)

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
    all_power: dict[str, float] = {}
    equipment_rows = await _supabase_query(
        token, "equipment", {"select": "id", "system_id": f"eq.{system_id}"},
    )
    if equipment_rows:
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

    # ── Overview (hero card data) ────────────────────────────────
    last_day_kwh = daily_values[-1]["kwh"] if daily_values else 0

    current_power_kw = 0.0
    if all_power:
        latest_ts = max(all_power.keys())
        if latest_ts[:10] == end_date.isoformat():
            current_power_kw = round(all_power[latest_ts] / 1000, 2)

    all_daily = await _supabase_query(
        token, "daily_energy",
        {"select": "date,energy_wh", "system_id": f"eq.{system_id}", "order": "date.asc", "limit": "10000"},
    )
    lifetime_wh = sum(r.get("energy_wh", 0) or 0 for r in all_daily)
    month_start = end_date.replace(day=1).isoformat()
    month_wh = sum(
        (r.get("energy_wh", 0) or 0)
        for r in all_daily
        if r.get("date", "") >= month_start
    )

    analysis["overview"] = {
        "lifetime_mwh": round(lifetime_wh / 1_000_000, 2),
        "last_month_kwh": round(month_wh / 1000, 2),
        "last_day_kwh": last_day_kwh,
        "current_power_kw": current_power_kw,
        "is_producing": current_power_kw > 0,
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


# ── Soiling Analysis (uses SoilingAnalyzer + site_energy_15min) ───────────────


def _system_info(system: dict) -> dict:
    """Extract system info block for soiling response."""
    return {
        "name": system["system_name"],
        "site_id": system["site_id"],
        "peak_power_kwp": system.get("peak_power_kwp"),
        "latitude": system.get("latitude"),
        "longitude": system.get("longitude"),
    }


def _validate_system_for_soiling(system: dict) -> None:
    """Raise 400 if system lacks required fields for soiling analysis."""
    if not system.get("latitude") or not system.get("longitude") or not system.get("peak_power_kwp"):
        raise HTTPException(
            status_code=400,
            detail="Site details (latitude, longitude, peak power) are not available. Please sync your system first.",
        )


async def _run_soiling_analysis(token: str, system: dict) -> dict:
    """Run the full soiling analysis pipeline and return formatted response."""
    from timezonefinder import TimezoneFinder
    from api.py.analysis_service import (
        SiteDataLoader, AnalysisOrchestrator, ResponseFormatter, build_system_config,
    )

    lat = system["latitude"]
    lng = system["longitude"]

    tf = TimezoneFinder()
    tz_str = tf.timezone_at(lat=lat, lng=lng) or "UTC"

    end_date = datetime.now(timezone.utc).date()
    start_date = end_date - timedelta(days=365)

    loader = SiteDataLoader(token)
    energy_df = await loader.load_site_energy(system["id"], start_date.isoformat(), end_date.isoformat())
    precip_df = await loader.load_precipitation(lat, lng, start_date.isoformat(), end_date.isoformat())

    config = build_system_config(system, tz_str)
    result = await AnalysisOrchestrator.run(energy_df, precip_df, config)

    price = system.get("electricity_price_per_kwh")
    currency = system.get("currency", "ILS")

    return ResponseFormatter.format(result, price, currency)


@app.get("/api/py/analyze/soiling")
async def analyze_soiling(request: Request):
    """Return cached soiling analysis if fresh, or 404 if stale/missing."""
    from api.py.analysis_service import AnalysisCache, compute_coverage_hash

    token = _get_token(request)
    system = await _get_system(token)
    system_id = system["id"]

    _validate_system_for_soiling(system)

    cache = AnalysisCache(token)
    cached = await cache.get_cached(system_id, "soiling_analysis")

    if not cached:
        raise HTTPException(
            status_code=404,
            detail="No soiling analysis available. Run it from the Data Sync page.",
        )

    # Check if cache is still fresh
    coverage_rows = await cache.get_coverage_rows(system_id, "site_energy_15min")
    current_hash = compute_coverage_hash(coverage_rows)

    if cached["coverage_hash"] != current_hash:
        raise HTTPException(
            status_code=404,
            detail="Soiling analysis is outdated (new data synced). Re-run it from the Data Sync page.",
        )

    return {
        "system": _system_info(system),
        **cached["summary"],
        "daily": cached.get("daily_data") or [],
        "events": cached.get("events") or [],
        "analyzed_at": cached["computed_at"],
        "cached": True,
    }


@app.post("/api/py/analyze/soiling/run")
async def analyze_soiling_run(request: Request):
    """Run soiling analysis if stale, return cached if fresh."""
    from api.py.analysis_service import AnalysisCache, compute_coverage_hash

    token = _get_token(request)
    system = await _get_system(token)
    system_id = system["id"]

    _validate_system_for_soiling(system)

    cache = AnalysisCache(token)
    coverage_rows = await cache.get_coverage_rows(system_id, "site_energy_15min")
    current_hash = compute_coverage_hash(coverage_rows)

    # Check if cache is still fresh
    cached = await cache.get_cached(system_id, "soiling_analysis")
    if cached and cached["coverage_hash"] == current_hash:
        return {
            "system": _system_info(system),
            **cached["summary"],
            "daily": cached.get("daily_data") or [],
            "events": cached.get("events") or [],
            "analyzed_at": cached["computed_at"],
            "cached": True,
        }

    # Compute fresh analysis
    response = await _run_soiling_analysis(token, system)

    # Persist to cache
    end_date = datetime.now(timezone.utc).date()
    start_date = end_date - timedelta(days=365)
    await cache.save(
        system_id=system_id,
        worker_id="soiling_analysis",
        coverage_hash=current_hash,
        data_start=start_date.isoformat(),
        data_end=end_date.isoformat(),
        summary={k: v for k, v in response.items() if k not in ("daily", "events")},
        daily_data=response.get("daily"),
        events=response.get("events"),
    )

    return {
        "system": _system_info(system),
        **response,
        "cached": False,
    }


@app.post("/api/py/analyze/soiling/backfill")
async def analyze_soiling_backfill(request: Request):
    """Force full recomputation of soiling analysis, ignoring cache."""
    from api.py.analysis_service import AnalysisCache, compute_coverage_hash

    token = _get_token(request)
    system = await _get_system(token)
    system_id = system["id"]

    _validate_system_for_soiling(system)

    cache = AnalysisCache(token)

    # Delete old cached result
    await cache.delete(system_id, "soiling_analysis")

    # Compute fresh analysis
    response = await _run_soiling_analysis(token, system)

    # Get current coverage hash and persist
    coverage_rows = await cache.get_coverage_rows(system_id, "site_energy_15min")
    current_hash = compute_coverage_hash(coverage_rows)

    end_date = datetime.now(timezone.utc).date()
    start_date = end_date - timedelta(days=365)
    await cache.save(
        system_id=system_id,
        worker_id="soiling_analysis",
        coverage_hash=current_hash,
        data_start=start_date.isoformat(),
        data_end=end_date.isoformat(),
        summary={k: v for k, v in response.items() if k not in ("daily", "events")},
        daily_data=response.get("daily"),
        events=response.get("events"),
    )

    return {
        "system": _system_info(system),
        **response,
        "cached": False,
        "backfilled": True,
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
