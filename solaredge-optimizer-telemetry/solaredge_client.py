"""
SolarEdge Per-Optimizer Telemetry Client

Production-ready client for fetching per-optimizer historical data from the
SolarEdge monitoring portal. Uses the unofficial chartData endpoint which
provides ~5-minute resolution power/voltage/current data per optimizer.

This module is designed to be imported and used by the YieldGuard backend.
All methods are stateless except for session management.

Dependencies: requests (pip install requests)
"""

import json
import time
import requests
from datetime import datetime, timedelta, timezone
from dataclasses import dataclass, field


# ── Data classes ─────────────────────────────────────────────────────────────


@dataclass
class Optimizer:
    """A SolarEdge optimizer (power box) attached to a panel."""
    internal_id: int       # Numeric ID used by chartData (e.g., 100714142)
    serial_number: str     # e.g., "12272871-D2"
    name: str              # e.g., "Module 1.0.8"
    today_energy_kwh: float = 0.0


@dataclass
class TelemetryPoint:
    """A single telemetry measurement."""
    timestamp: datetime    # UTC datetime
    value: float           # Measurement value in the requested unit


@dataclass
class OptimizerTelemetry:
    """Historical telemetry for one optimizer."""
    optimizer: Optimizer
    parameter: str         # "Power", "Voltage", "Current", "Energy", "PowerBox Voltage"
    data_points: list[TelemetryPoint] = field(default_factory=list)


# ── Client ───────────────────────────────────────────────────────────────────


class SolarEdgeOptimizerClient:
    """Client for SolarEdge per-optimizer historical telemetry.

    Usage:
        client = SolarEdgeOptimizerClient(
            site_id=1353684,
            username="user@example.com",
            password="password",
        )
        client.authenticate()
        optimizers = client.discover_optimizers()
        telemetry = client.fetch_optimizer_telemetry(
            optimizer=optimizers[0],
            start_date=datetime(2025, 3, 1, tzinfo=timezone.utc),
            end_date=datetime(2025, 3, 2, tzinfo=timezone.utc),
            parameter="Power",
        )
    """

    BASE_URL = "https://monitoring.solaredge.com"
    PUBLIC_URL = "https://monitoringpublic.solaredge.com"

    # Valid parameters for each equipment type
    OPTIMIZER_PARAMETERS = ["Power", "Current", "Voltage", "Energy", "PowerBox Voltage"]
    INVERTER_PARAMETERS = [
        "AC Energy", "AC Frequency", "AC Voltage", "AC Current", "Power",
        "DC Voltage", "Total Reactive Power", "Power Factor",
    ]

    def __init__(
        self,
        site_id: int,
        username: str,
        password: str,
        request_delay_s: float = 0.15,
        max_retries: int = 3,
        retry_delay_s: float = 5.0,
    ):
        self.site_id = site_id
        self.username = username
        self.password = password
        self.request_delay_s = request_delay_s
        self.max_retries = max_retries
        self.retry_delay_s = retry_delay_s

        self._session = requests.Session()
        self._session.headers.update({
            "User-Agent": (
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/120.0.0.0 Safari/537.36"
            )
        })
        self._csrf_token = ""
        self._authenticated = False

    # ── Authentication ───────────────────────────────────────────────────

    def authenticate(self) -> None:
        """Authenticate to the SolarEdge monitoring portal.

        Performs two login steps:
        1. Form POST to solaredge-apigw/api/login
           → Sets JSESSIONID cookie scoped to /solaredge-apigw
           → Needed for layout/logical endpoint
        2. HTTP Basic Auth GET to solaredge-web/p/login
           → Sets JSESSIONID cookie scoped to /solaredge-web
           → Needed for chartData endpoint

        Both steps set a CSRF-TOKEN cookie (scoped to /) which must be
        sent as the X-CSRF-TOKEN header on subsequent requests.

        Raises:
            RuntimeError: If authentication fails (no session cookies received).
        """
        # Step 1: Form-based login for solaredge-apigw endpoints
        self._session.post(
            f"{self.BASE_URL}/solaredge-apigw/api/login",
            data={"j_username": self.username, "j_password": self.password},
            allow_redirects=True,
        )

        # Step 2: HTTP Basic Auth login for solaredge-web endpoints
        self._session.auth = (self.username, self.password)
        self._session.get(
            f"{self.BASE_URL}/solaredge-web/p/login",
            allow_redirects=True,
        )
        self._session.auth = None  # Clear for subsequent requests

        # Extract CSRF token from cookies.
        # IMPORTANT: Multiple cookies with the same name exist at different paths.
        # We must iterate session.cookies rather than using .get() which raises
        # CookieConflictError when duplicates exist.
        self._csrf_token = ""
        has_jsession = False
        for cookie in self._session.cookies:
            if cookie.name == "CSRF-TOKEN" and not self._csrf_token:
                self._csrf_token = cookie.value
            if cookie.name == "JSESSIONID":
                has_jsession = True

        if not has_jsession:
            raise RuntimeError(
                "SolarEdge authentication failed: no JSESSIONID cookie received. "
                "Check username/password."
            )

        self._authenticated = True

    def _ensure_auth(self) -> None:
        """Re-authenticate if needed."""
        if not self._authenticated:
            self.authenticate()

    # ── Optimizer Discovery ──────────────────────────────────────────────

    def discover_optimizers(self) -> list[Optimizer]:
        """Discover all optimizers (power boxes) for this site.

        Calls the layout/logical endpoint which returns the full equipment
        tree: Site → Inverter(s) → String(s) → Optimizer(s).

        Returns:
            List of Optimizer objects with internal_id, serial_number, name,
            and today's energy (from reportersData).

        Raises:
            RuntimeError: If the API call fails.
        """
        self._ensure_auth()

        resp = self._session.get(
            f"{self.BASE_URL}/solaredge-apigw/api/sites/{self.site_id}/layout/logical"
        )
        if resp.status_code == 401:
            # Session expired, retry
            self.authenticate()
            resp = self._session.get(
                f"{self.BASE_URL}/solaredge-apigw/api/sites/{self.site_id}/layout/logical"
            )
        if resp.status_code != 200:
            raise RuntimeError(
                f"Failed to get layout/logical: HTTP {resp.status_code} — {resp.text[:200]}"
            )

        data = resp.json()
        optimizers: list[Optimizer] = []

        def walk_tree(node):
            if not isinstance(node, dict):
                return
            node_data = node.get("data")
            if node_data and isinstance(node_data, dict):
                if node_data.get("type") == "POWER_BOX":
                    optimizers.append(Optimizer(
                        internal_id=node_data["id"],
                        serial_number=node_data.get("serialNumber", ""),
                        name=node_data.get("name", ""),
                    ))
            for child in node.get("children", []):
                walk_tree(child)

        walk_tree(data.get("logicalTree", {}))

        # Enrich with today's energy from reportersData
        reporters = data.get("reportersData", {})
        for opt in optimizers:
            rd = reporters.get(str(opt.internal_id), {})
            opt.today_energy_kwh = rd.get("energy", 0.0)

        return optimizers

    # ── Historical Telemetry ─────────────────────────────────────────────

    def fetch_optimizer_telemetry(
        self,
        optimizer: Optimizer,
        start_date: datetime,
        end_date: datetime,
        parameter: str = "Power",
    ) -> OptimizerTelemetry:
        """Fetch historical telemetry for a single optimizer.

        For maximum resolution (~5 min intervals), query 1 day at a time.
        Larger windows automatically reduce resolution:
        - 1 day  → ~5 min intervals (~130 points)
        - 7 days → ~1 hour intervals (~91 points)
        - 30 days → daily averages (30 points)

        Args:
            optimizer: Optimizer object (must have internal_id).
            start_date: Start of period (UTC).
            end_date: End of period (UTC).
            parameter: One of "Power", "Voltage", "Current", "Energy",
                       "PowerBox Voltage".

        Returns:
            OptimizerTelemetry with list of TelemetryPoint objects.
        """
        self._ensure_auth()

        if parameter not in self.OPTIMIZER_PARAMETERS:
            raise ValueError(
                f"Invalid parameter '{parameter}'. "
                f"Valid: {self.OPTIMIZER_PARAMETERS}"
            )

        pairs = self._call_chart_data(
            reporter_id=optimizer.internal_id,
            start_date=start_date,
            end_date=end_date,
            parameter=parameter,
        )

        data_points = [
            TelemetryPoint(
                timestamp=datetime.fromtimestamp(p["date"] / 1000, tz=timezone.utc),
                value=p["value"],
            )
            for p in pairs
        ]

        return OptimizerTelemetry(
            optimizer=optimizer,
            parameter=parameter,
            data_points=data_points,
        )

    def fetch_optimizer_telemetry_daily(
        self,
        optimizer: Optimizer,
        start_date: datetime,
        end_date: datetime,
        parameter: str = "Power",
    ) -> OptimizerTelemetry:
        """Fetch telemetry at maximum resolution by querying one day at a time.

        This fetches each day individually to get ~5-minute resolution data,
        then concatenates the results. Use this for backfills.

        Includes rate limiting (self.request_delay_s between requests) and
        automatic re-authentication on session expiry.

        Args:
            optimizer: Optimizer object.
            start_date: Start of period (UTC, time part ignored, uses 00:00).
            end_date: End of period (UTC, time part ignored, uses 23:59:59).
            parameter: Measurement parameter.

        Returns:
            OptimizerTelemetry with concatenated high-resolution data.
        """
        self._ensure_auth()

        all_points: list[TelemetryPoint] = []
        current = start_date.replace(hour=0, minute=0, second=0, microsecond=0)
        final = end_date.replace(hour=23, minute=59, second=59, microsecond=0)

        while current <= final:
            day_end = current + timedelta(days=1)

            pairs = self._call_chart_data(
                reporter_id=optimizer.internal_id,
                start_date=current,
                end_date=day_end,
                parameter=parameter,
            )

            for p in pairs:
                all_points.append(TelemetryPoint(
                    timestamp=datetime.fromtimestamp(p["date"] / 1000, tz=timezone.utc),
                    value=p["value"],
                ))

            current = day_end
            time.sleep(self.request_delay_s)

        return OptimizerTelemetry(
            optimizer=optimizer,
            parameter=parameter,
            data_points=all_points,
        )

    # ── Current Readings (No Auth Required) ──────────────────────────────

    def fetch_current_readings(self, optimizer: Optimizer) -> dict:
        """Fetch current/last measurements for an optimizer.

        Uses the public endpoint — no authentication required.
        Returns the most recent snapshot (not historical data).

        Args:
            optimizer: Optimizer object (must have internal_id).

        Returns:
            Dict with keys like:
            {
                "serialNumber": "12272871-D2",
                "description": "Module 1.0.8",
                "lastMeasurementDate": "2025-03-08 14:30:00",
                "model": "P505",
                "measurements": {
                    "Current [A]": 8.45,
                    "Optimizer Voltage [V]": 39.2,
                    "Power [W]": 331.0,
                    "Voltage [V]": 41.1
                }
            }
        """
        resp = requests.get(
            f"{self.PUBLIC_URL}/solaredge-web/p/publicSystemData",
            params={
                "reporterId": optimizer.internal_id,
                "type": "panel",
                "activeTab": "0",
                "fieldId": self.site_id,
                "isPublic": "true",
                "locale": "en_US",
            },
            headers={"User-Agent": self._session.headers["User-Agent"]},
            timeout=10,
        )
        if resp.status_code != 200:
            return {}
        return resp.json()

    # ── Internal ─────────────────────────────────────────────────────────

    def _call_chart_data(
        self,
        reporter_id: int,
        start_date: datetime,
        end_date: datetime,
        parameter: str,
    ) -> list[dict]:
        """Low-level call to the chartData endpoint with retry logic.

        Returns list of {"date": unix_ms, "value": float} dicts.
        Returns None if a 401 is received (caller should re-auth).
        """
        start_ms = int(start_date.timestamp() * 1000)
        end_ms = int(end_date.timestamp() * 1000)

        headers = {
            "X-CSRF-TOKEN": self._csrf_token,
            "X-Requested-With": "XMLHttpRequest",
            "X-KL-Ajax-Request": "Ajax_Request",
            "Referer": f"{self.BASE_URL}/solaredge-web/p/site/{self.site_id}/",
        }

        url = (
            f"{self.BASE_URL}/solaredge-web/p/chartData"
            f"?reporterId={reporter_id}"
            f"&fieldId={self.site_id}"
            f"&reporterType="
            f"&startDate={start_ms}"
            f"&endDate={end_ms}"
            f"&uom=W"
            f"&parameterName={parameter}"
        )

        for attempt in range(self.max_retries):
            try:
                resp = self._session.get(url, headers=headers, timeout=15)

                if resp.status_code == 401:
                    # Session expired — re-authenticate and retry
                    self.authenticate()
                    headers["X-CSRF-TOKEN"] = self._csrf_token
                    continue

                if resp.status_code != 200:
                    time.sleep(self.retry_delay_s)
                    continue

                data = resp.json()
                return data.get("dateValuePairs", [])

            except (requests.ConnectionError, requests.Timeout):
                time.sleep(self.retry_delay_s)
            except json.JSONDecodeError:
                time.sleep(self.retry_delay_s)

        return []
