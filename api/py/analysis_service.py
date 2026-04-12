"""
Soiling analysis service layer.

Separates data loading, analysis orchestration, and response formatting
into independently testable components.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import os
from datetime import datetime, timezone, timedelta

import httpx
import pandas as pd

from fastapi import HTTPException

logger = logging.getLogger(__name__)

SUPABASE_URL = os.environ.get("NEXT_PUBLIC_SUPABASE_URL", "")
SUPABASE_ANON_KEY = os.environ.get("NEXT_PUBLIC_SUPABASE_ANON_KEY", "")
OPEN_METEO_BASE = "https://archive-api.open-meteo.com/v1/archive"
CURRENCY_SYMBOLS = {"ILS": "₪", "USD": "$", "EUR": "€"}


# ── Data Loading ──────────────────────────────────────────────────────────────


class SiteDataLoader:
    """Loads data from Supabase and Open-Meteo. Pure async I/O, no computation."""

    def __init__(self, token: str):
        self._token = token
        self._headers = {
            "apikey": SUPABASE_ANON_KEY,
            "Authorization": f"Bearer {token}",
            "Accept": "application/json",
        }

    async def load_site_energy(
        self, system_id: str, start_date: str, end_date: str,
    ) -> pd.DataFrame:
        """Load site-level 15-min energy from site_energy_15min table.

        Returns DataFrame with columns: timestamp (naive datetime), energy_wh (float).
        Raises HTTPException(404) if no data is found.
        """
        all_rows: list[dict] = []
        PAGE = 1000
        offset = 0

        while True:
            params = [
                ("select", "ts,energy_wh"),
                ("system_id", f"eq.{system_id}"),
                ("ts", f"gte.{start_date}"),
                ("ts", f"lte.{end_date}"),
                ("order", "ts.asc"),
                ("limit", str(PAGE)),
                ("offset", str(offset)),
            ]
            async with httpx.AsyncClient(timeout=30) as client:
                resp = await client.get(
                    f"{SUPABASE_URL}/rest/v1/site_energy_15min",
                    headers=self._headers, params=params,
                )
            if resp.status_code != 200:
                logger.warning("site_energy_15min query failed: %s", resp.text)
                break
            rows = resp.json()
            all_rows.extend(rows)
            if len(rows) < PAGE:
                break
            offset += PAGE

        if not all_rows:
            raise HTTPException(
                status_code=404,
                detail="No site energy data available for soiling analysis. "
                       "Go to Data Sync and sync your site energy data first.",
            )

        df = pd.DataFrame(all_rows)
        df["timestamp"] = pd.to_datetime(df["ts"])
        df = df[["timestamp", "energy_wh"]].sort_values("timestamp")

        n_days = df["timestamp"].dt.date.nunique()
        logger.info(
            "Loaded site energy: %d records, %d days, range [%.1f, %.1f] Wh",
            len(df), n_days, df["energy_wh"].min(), df["energy_wh"].max(),
        )

        if n_days < 30:
            raise HTTPException(
                status_code=400,
                detail=f"Insufficient data for soiling analysis: only {n_days} days "
                       f"available (need at least 30). Sync more site energy data.",
            )

        return df

    async def load_precipitation(
        self, lat: float, lng: float, start_date: str, end_date: str,
    ) -> pd.DataFrame:
        """Fetch daily precipitation from Open-Meteo Archive API.

        Returns DataFrame with columns: date (date object), rain_mm (float).
        Returns empty DataFrame on API failure (non-fatal).
        """
        params = {
            "latitude": lat,
            "longitude": lng,
            "start_date": start_date,
            "end_date": end_date,
            "daily": "precipitation_sum",
            "timezone": "UTC",
        }
        try:
            async with httpx.AsyncClient(timeout=20) as client:
                resp = await client.get(OPEN_METEO_BASE, params=params)
            if resp.status_code != 200:
                logger.warning("Open-Meteo API error: %s", resp.text)
                return pd.DataFrame(columns=["date", "rain_mm"])

            data = resp.json()
            daily = data.get("daily", {})
            times = daily.get("time", [])
            precip = daily.get("precipitation_sum", [])

            rows = [
                {"date": pd.Timestamp(t).date(), "rain_mm": p if p is not None else 0.0}
                for t, p in zip(times, precip)
            ]
            return pd.DataFrame(rows)

        except Exception:
            logger.exception("Failed to fetch precipitation")
            return pd.DataFrame(columns=["date", "rain_mm"])


# ── Analysis Orchestration ────────────────────────────────────────────────────


class AnalysisOrchestrator:
    """Runs the soiling analysis in a background thread. No I/O."""

    @staticmethod
    async def run(
        energy_df: pd.DataFrame,
        precip_df: pd.DataFrame,
        config: "SystemConfig",
    ) -> "SoilingResult":
        """Run SoilingAnalyzer.analyze() in a thread.

        Lazy-imports the soiling package to avoid loading heavy deps at startup.
        """
        from api.py.soiling import SoilingAnalyzer

        analyzer = SoilingAnalyzer(config)
        try:
            result = await asyncio.to_thread(analyzer.analyze, energy_df, precip_df)
        except ValueError as exc:
            logger.exception("Soiling analysis failed")
            raise HTTPException(
                status_code=400,
                detail=f"Soiling analysis could not complete: {exc}. "
                       "This typically means not enough clear-sky days were detected. "
                       "Try syncing more historical site energy data.",
            )
        return result


# ── Response Formatting ───────────────────────────────────────────────────────


def build_system_config(system: dict, tz_str: str) -> "SystemConfig":
    """Map a DB system row + detected timezone to a soiling SystemConfig."""
    from api.py.soiling import SystemConfig

    return SystemConfig(
        lat=system["latitude"],
        lon=system["longitude"],
        alt=system.get("altitude") or 0,
        kwp=system["peak_power_kwp"],
        tilt=system.get("tilt") or abs(system["latitude"]),
        azimuth=system.get("azimuth") or 180,
        tz=tz_str,
        install_date=str(system.get("installation_date") or "2020-01-01"),
        price=float(system.get("electricity_price_per_kwh") or 0.48),
    )


class ResponseFormatter:
    """Converts SoilingResult into the API JSON response. Pure functions, no I/O."""

    @staticmethod
    def format(
        result: "SoilingResult",
        price_per_kwh: float | None,
        currency: str = "ILS",
    ) -> dict:
        """Format the full analysis response."""
        summary = result.summary
        daily_df = result.daily.tail(90).copy()

        daily_records = []
        for _, row in daily_df.iterrows():
            sr = row.get("soiling_ratio")
            daily_records.append({
                "date": str(row["date"]),
                "soiling_ratio": round(float(sr), 4) if pd.notna(sr) else None,
                "actual_kwh": round(float(row.get("energy_kwh", 0)), 2),
                "clean_kwh": round(float(row.get("est_clean_kwh", 0)), 2),
                "lost_kwh": round(float(row.get("lost_kwh", 0)), 2),
                "classification": row.get("classification", "unknown"),
                "cleaning": bool(row.get("cleaning", False)),
            })

        events = []
        for _, row in result.events.iterrows():
            events.append({
                "date": str(row["date"]),
                "type": _classify_event_type(row),
                "rain_mm": round(float(row.get("rain_mm", 0)), 1),
            })

        monetary = ResponseFormatter._format_monetary(summary, price_per_kwh, currency)

        return {
            "summary": {
                "current_sr": summary.current_sr,
                "current_loss_pct": summary.current_loss_pct,
                "total_lost_kwh": summary.total_lost_kwh,
                "n_cleaning_events": summary.n_cleaning_events,
                "loss_since_last_clean": summary.loss_since_last_clean,
                "avg_summer_rate": summary.avg_summer_rate,
                "avg_winter_rate": summary.avg_winter_rate,
                "analysis_start": str(summary.analysis_start),
                "analysis_end": str(summary.analysis_end),
                "n_days": summary.n_days,
            },
            "daily": daily_records,
            "events": events,
            "monetary": monetary,
            "analyzed_at": datetime.now(timezone.utc).isoformat(),
        }

    @staticmethod
    def _format_monetary(
        summary: "SoilingSummary",
        price_per_kwh: float | None,
        currency: str,
    ) -> dict:
        price = float(price_per_kwh) if price_per_kwh and price_per_kwh > 0 else 0
        currency_symbol = CURRENCY_SYMBOLS.get(currency, currency)

        avg_daily_loss_kwh = summary.total_lost_kwh / max(summary.n_days, 1)
        avg_daily_loss_money = avg_daily_loss_kwh * price

        return {
            "currency_per_kwh": price,
            "currency": currency,
            "currency_symbol": currency_symbol,
            "total_lost_money": round(summary.total_lost_money, 2),
            "annual_avg_loss": round(summary.annual_avg_loss_money, 2),
            "loss_monthly_projected": round(avg_daily_loss_money * 30, 2),
            "loss_yearly_projected": round(avg_daily_loss_money * 365, 2),
            "avg_daily_loss": round(avg_daily_loss_money, 2),
        }

    @staticmethod
    def format_recommendations(
        system_id: str, summary: "SoilingSummary",
    ) -> list[dict]:
        """Generate recommendation rows from soiling analysis results."""
        recs: list[dict] = []

        if summary.current_loss_pct > 10:
            recs.append({
                "system_id": system_id,
                "type": "cleaning",
                "severity": "critical",
                "title": "Significant soiling detected — cleaning recommended",
                "message": (
                    f"Your panels are operating at {summary.current_sr:.1%} of their clean capacity "
                    f"({summary.current_loss_pct:.1f}% loss). "
                    f"Total estimated energy lost: {summary.total_lost_kwh:.0f} kWh. "
                    f"Professional cleaning is recommended."
                ),
                "metadata": {
                    "soiling_ratio": summary.current_sr,
                    "loss_pct": summary.current_loss_pct,
                    "total_lost_kwh": summary.total_lost_kwh,
                },
                "status": "active",
            })
        elif summary.current_loss_pct > 5:
            recs.append({
                "system_id": system_id,
                "type": "cleaning",
                "severity": "warning",
                "title": "Moderate soiling — monitor closely",
                "message": (
                    f"Your panels are at {summary.current_sr:.1%} capacity "
                    f"({summary.current_loss_pct:.1f}% loss from soiling). "
                    f"Consider scheduling a cleaning soon if no rain is expected."
                ),
                "metadata": {
                    "soiling_ratio": summary.current_sr,
                    "loss_pct": summary.current_loss_pct,
                },
                "status": "active",
            })

        if summary.avg_summer_rate < -0.3:
            recs.append({
                "system_id": system_id,
                "type": "seasonal",
                "severity": "info",
                "title": "High summer soiling rate",
                "message": (
                    f"Summer soiling rate is {summary.avg_summer_rate:.2f}%/day. "
                    f"More frequent cleaning during summer months may be cost-effective."
                ),
                "metadata": {
                    "summer_rate": summary.avg_summer_rate,
                    "winter_rate": summary.avg_winter_rate,
                },
                "status": "active",
            })

        return recs


def _classify_event_type(row: pd.Series) -> str:
    """Classify a cleaning event row as rain or manual."""
    rain_mm = row.get("rain_mm", 0)
    return "rain" if rain_mm > 0.5 else "manual"


# ── Analysis Result Caching ──────────────────────────────────────────────────


def compute_coverage_hash(coverage_rows: list[dict]) -> str:
    """Compute a deterministic hash of data_coverage rows.

    Used to detect when upstream data has changed since the last analysis run.
    The hash is based on sorted (period_start, period_end, status) tuples,
    so it changes when new data is synced or coverage changes.
    """
    if not coverage_rows:
        return hashlib.sha256(b"empty").hexdigest()[:16]

    # Sort deterministically and hash the content
    normalized = sorted(
        (r.get("period_start", ""), r.get("period_end", ""), r.get("status", ""))
        for r in coverage_rows
    )
    content = json.dumps(normalized, sort_keys=True)
    return hashlib.sha256(content.encode()).hexdigest()[:16]


class AnalysisCache:
    """Read/write analysis results from the analysis_results table."""

    def __init__(self, token: str):
        self._headers = {
            "apikey": SUPABASE_ANON_KEY,
            "Authorization": f"Bearer {token}",
            "Accept": "application/json",
            "Content-Type": "application/json",
            "Prefer": "return=representation",
        }

    async def get_coverage_rows(self, system_id: str, worker_id: str) -> list[dict]:
        """Fetch data_coverage rows for a given system and worker."""
        params = [
            ("select", "period_start,period_end,status"),
            ("system_id", f"eq.{system_id}"),
            ("worker_id", f"eq.{worker_id}"),
            ("order", "period_start.asc"),
        ]
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.get(
                f"{SUPABASE_URL}/rest/v1/data_coverage",
                headers=self._headers, params=params,
            )
        if resp.status_code != 200:
            logger.warning("data_coverage query failed: %s", resp.text)
            return []
        return resp.json()

    async def get_cached(self, system_id: str, worker_id: str) -> dict | None:
        """Get a cached analysis result if it exists."""
        params = [
            ("select", "*"),
            ("system_id", f"eq.{system_id}"),
            ("worker_id", f"eq.{worker_id}"),
            ("limit", "1"),
        ]
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.get(
                f"{SUPABASE_URL}/rest/v1/analysis_results",
                headers=self._headers, params=params,
            )
        if resp.status_code != 200:
            return None
        rows = resp.json()
        return rows[0] if rows else None

    async def save(
        self,
        system_id: str,
        worker_id: str,
        coverage_hash: str,
        data_start: str,
        data_end: str,
        summary: dict,
        daily_data: list | None = None,
        events: list | None = None,
    ) -> None:
        """Upsert an analysis result."""
        body = {
            "system_id": system_id,
            "worker_id": worker_id,
            "coverage_hash": coverage_hash,
            "data_start": data_start,
            "data_end": data_end,
            "summary": summary,
            "daily_data": daily_data,
            "events": events,
            "computed_at": datetime.now(timezone.utc).isoformat(),
        }
        headers = {**self._headers, "Prefer": "resolution=merge-duplicates,return=representation"}
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.post(
                f"{SUPABASE_URL}/rest/v1/analysis_results"
                "?on_conflict=system_id,worker_id",
                headers=headers, json=body,
            )
        if resp.status_code not in (200, 201):
            logger.warning("analysis_results upsert failed: %s", resp.text)

    async def delete(self, system_id: str, worker_id: str) -> None:
        """Delete a cached analysis result (for backfill)."""
        async with httpx.AsyncClient(timeout=15) as client:
            await client.delete(
                f"{SUPABASE_URL}/rest/v1/analysis_results"
                f"?system_id=eq.{system_id}&worker_id=eq.{worker_id}",
                headers=self._headers,
            )
