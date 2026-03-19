# SolarEdge Per-Optimizer Historical Telemetry — Integration Reference

> **Purpose:** This folder contains a fully tested, working reference implementation for
> fetching **per-optimizer (per-panel) historical telemetry** from SolarEdge.
> It is intended to be consumed by a Claude agent that will integrate this
> functionality into the main YieldGuard application (Next.js + Supabase).

---

## The Problem

The SolarEdge **public monitoring API** (`monitoringapi.solaredge.com`) provides
site-level and inverter-level telemetry, but returns **empty data** for optimizer
(per-panel) serial numbers. This is a known, deliberate limitation for residential
accounts. The data _does_ exist — it's visible in the SolarEdge monitoring portal
web app — but it's not exposed via the public API.

## The Solution

We discovered two **unofficial web endpoints** on the old SolarEdge monitoring portal
that return per-optimizer historical data. These have been verified working as of
March 2026 and are also used by the open-source `solaredgeoptimizers` Home Assistant
integration (61+ GitHub stars).

### Key Endpoints

| Endpoint | What It Returns | Resolution |
|---|---|---|
| `solaredge-apigw/api/sites/{siteId}/layout/logical` | All optimizers with internal IDs, serial numbers, names, today's energy | Discovery / daily totals |
| `solaredge-web/p/chartData` | **Historical time-series per optimizer** (Power, Voltage, Current, Energy) | ~5 min (1-day query) / ~1 hr (7-day) / daily (30-day) |
| `monitoringpublic.solaredge.com/solaredge-web/p/publicSystemData` | Current/last optimizer readings | Snapshot only |

### Data Resolution Depends on Query Span

| Query window | Data granularity | Points per optimizer per day |
|---|---|---|
| 1 day | ~5 minute intervals | ~130 |
| 7 days | ~1 hour intervals | ~13 |
| 30 days | Daily averages | 1 |

**Recommendation:** For maximum resolution, always query 1 day at a time.

---

## Authentication

These endpoints use **session-based auth** (not the public API key). The flow requires
two login steps to cover both the `solaredge-apigw` and `solaredge-web` cookie scopes.

See `solaredge_client.py` for the complete working implementation. The critical details:

1. **Form login** to `solaredge-apigw/api/login` — sets `JSESSIONID` (path: `/solaredge-apigw`)
2. **HTTP Basic Auth** GET to `solaredge-web/p/login` — sets `JSESSIONID` (path: `/solaredge-web`)
3. Both steps also set `CSRF-TOKEN` (path: `/`) which must be sent as `X-CSRF-TOKEN` header
4. Multiple cookies with the same name (`JSESSIONID`) exist at different paths — iterate `session.cookies` rather than using `.get()`
5. Sessions expire periodically — handle 401 by re-authenticating

### Required Headers for chartData

```python
headers = {
    "X-CSRF-TOKEN": csrf_token,        # From CSRF-TOKEN cookie
    "X-Requested-With": "XMLHttpRequest",
    "X-KL-Ajax-Request": "Ajax_Request",
    "Referer": f"https://monitoring.solaredge.com/solaredge-web/p/site/{site_id}/",
}
```

### Required User-Agent

SolarEdge may block non-browser user agents. Always set a realistic browser UA string.

---

## API Reference

### 1. Discover Optimizers

```
GET https://monitoring.solaredge.com/solaredge-apigw/api/sites/{siteId}/layout/logical
Cookie: JSESSIONID=...; CSRF-TOKEN=...
```

**Response structure:**
```json
{
  "logicalTree": {
    "children": [{
      "data": { "id": 105687541, "serialNumber": "7E171746-F2", "type": "INVERTER_3PHASE" },
      "children": [{
        "data": { "type": "STRING", "name": "String 1.0" },
        "children": [{
          "data": {
            "id": 100714142,           // ← INTERNAL ID (use for chartData)
            "serialNumber": "12272871-D2",  // ← SERIAL NUMBER
            "name": "Module 1.0.8",
            "type": "POWER_BOX"        // ← This means optimizer
          }
        }]
      }]
    }]
  },
  "reportersData": {
    "100714142": { "energy": 2.26, "units": "kWh" }  // Today's energy per optimizer
  }
}
```

**Important:** Walk the tree recursively. Optimizers have `type: "POWER_BOX"`.
The `id` field is the **internal numeric ID** needed for `chartData` (NOT the serial number).

### 2. Fetch Historical Telemetry (chartData)

```
GET https://monitoring.solaredge.com/solaredge-web/p/chartData
    ?reporterId={optimizerInternalId}
    &fieldId={siteId}
    &reporterType=
    &startDate={unixTimestampMs}
    &endDate={unixTimestampMs}
    &uom=W
    &parameterName={parameter}
Cookie: JSESSIONID=...; CSRF-TOKEN=...
X-CSRF-TOKEN: {csrfTokenValue}
X-Requested-With: XMLHttpRequest
```

**Parameters:**

| Param | Type | Description |
|---|---|---|
| `reporterId` | int | Optimizer internal ID from `layout/logical` (e.g., `100714142`) |
| `fieldId` | int | Site ID (e.g., `1353684`) |
| `reporterType` | string | Leave empty string |
| `startDate` | int | Unix timestamp in **milliseconds** |
| `endDate` | int | Unix timestamp in **milliseconds** |
| `uom` | string | Unit — use `W` |
| `parameterName` | string | See table below |

**Valid `parameterName` values for optimizers:**

| Parameter | Unit | Description |
|---|---|---|
| `Power` | W | AC power output |
| `Voltage` | V | Panel voltage |
| `Current` | A | Panel current |
| `Energy` | Wh | Energy produced |
| `PowerBox Voltage` | V | Optimizer output voltage |

**Response:**
```json
{
  "dateValuePairs": [
    { "date": 1709874000000, "value": 245.3 },
    { "date": 1709874300000, "value": 312.7 }
  ]
}
```

- `date` = Unix timestamp in milliseconds
- `value` = measurement in requested unit

### 3. Get Current Readings (publicSystemData)

```
GET https://monitoringpublic.solaredge.com/solaredge-web/p/publicSystemData
    ?reporterId={optimizerInternalId}
    &type=panel
    &activeTab=0
    &fieldId={siteId}
    &isPublic=true
    &locale=en_US
```

**No authentication required.** Different host: `monitoringpublic.solaredge.com`.

**Response:**
```json
{
  "serialNumber": "12272871-D2",
  "description": "Module 1.0.8",
  "lastMeasurementDate": "2025-03-08 14:30:00",
  "model": "P505",
  "manufacturer": "SolarEdge",
  "measurements": {
    "Current [A]": 8.45,
    "Optimizer Voltage [V]": 39.2,
    "Power [W]": 331.0,
    "Voltage [V]": 41.1
  }
}
```

---

## Rate Limiting & Robustness

- **Delay:** 150–200ms between requests. The `solaredgeoptimizers` library uses 100ms.
- **Throttling:** SolarEdge may reset connections on aggressive scraping. Back off 5s on error.
- **Retries:** 3 attempts with 5s delay between retries.
- **Session expiry:** Sessions expire after some hours. Detect 401 and re-authenticate.
- **Estimated throughput:** ~5 requests/sec → 36 optimizers × 1 day = ~7 seconds.
  For a full year backfill: 36 optimizers × 365 days = 13,140 requests ≈ 44 minutes.

---

## Test Results (Verified March 2026)

All tests run against site 1353684 (Beer Sheva, Israel, 15 kWp, 36 optimizers).

| Test | Result |
|---|---|
| Auth (form + web login) | Session cookies obtained |
| Discover optimizers | 36 POWER_BOX items found |
| chartData — 1 day Power | ~130 data points at ~5 min resolution |
| chartData — 7 day Power | ~91 points at ~1 hr resolution |
| chartData — 30 day Power | 30 points (daily averages) |
| chartData — 1 year ago | Works (tested 2025-03-18, got 128 points) |
| chartData — Voltage param | Works (66 data points) |
| Full backfill (3 days, 36 opt) | 14,608 data points, 108 API calls, ~30 seconds |

---

## Site-Specific Info

| Property | Value |
|---|---|
| Site ID | `1353684` |
| Public API Key | `9AMEDLLW9UST1HA7849YYIF9JQK1UJN8` |
| Portal Username | `nadav.azaria@gmail.com` |
| Portal Password | `Ana4rdiv` |
| Location | Beer Sheva, Israel (31.332°N, 34.897°E) |
| Peak Power | 15 kWp |
| Inverter | 7E171746-F2 (SE15K, 3-phase) |
| Optimizers | 36 units (model P505), all on String 1.0 |
| Timezone | Asia/Jerusalem (UTC+2 / UTC+3 DST) |

---

## Files in This Directory

| File | Description |
|---|---|
| `README.md` | This document |
| `solaredge_client.py` | Complete, production-ready Python client class |
| `example_usage.py` | Runnable example showing all operations |

---

## Integration Notes for YieldGuard

### What the integrating agent should do:

1. **Store portal credentials** — The user needs to provide `username` and `password`
   for `monitoring.solaredge.com` in addition to the existing `site_id` and `api_key`.
   Add fields to the `solar_systems` table or a secrets store.

2. **Create an optimizer equipment table** — Store optimizer metadata (internal_id,
   serial_number, name) discovered from `layout/logical`. The `internal_id` is critical
   as it's the key for `chartData`.

3. **Sync endpoint (server-side)** — Add an API route (e.g., `/api/py/sync/optimizer-telemetry`)
   that authenticates, discovers optimizers, and fetches recent data. This should be
   Python (the existing FastAPI service in `api/py/index.py`) since the auth flow uses
   `requests` sessions with cookies.

4. **Historical backfill** — For initial setup, fetch 1 day at a time for maximum
   resolution. Can be triggered as a background job.

5. **Daily sync** — After initial backfill, fetch yesterday's data once per day.
   Also fetch today's data from `layout/logical` (reportersData) for daily totals.

6. **UI components** — Per-panel power curves, heatmaps, comparison charts,
   underperformance detection. The existing `analyze/panels` endpoint in `api/py/index.py`
   already has the structure for this.

### What NOT to use:

- **Public API** for optimizer data — it returns empty (`count: 0, telemetries: []`)
- **CNI portal API** (`services/cni/`) — returns 403 for residential accounts
- **playbackData endpoint** — limited to ~7 days rolling window, non-standard JSON
