# SolarEdge API Research Findings

> **Date:** March 2026
> **Context:** Investigating how to retrieve per-optimizer (per-panel) historical telemetry data from SolarEdge for the YieldGuard app.

---

## Table of Contents

1. [Summary](#summary)
2. [Public Monitoring API](#public-monitoring-api)
3. [Old Portal API (solaredge-apigw)](#old-portal-api-solaredge-apigw)
4. [Old Portal Web Endpoints (solaredge-web)](#old-portal-web-endpoints-solaredge-web)
5. [New CNI Portal API (services/cni)](#new-cni-portal-api-servicescni)
6. [Authentication Flows](#authentication-flows)
7. [What Works vs What Doesn't](#what-works-vs-what-doesnt)
8. [Open-Source Projects and Tools](#open-source-projects-and-tools)
9. [Tested Credentials & Site Info](#tested-credentials--site-info)
10. [Recommended Implementation Path](#recommended-implementation-path)
11. [Future Avenues to Explore](#future-avenues-to-explore)

---

## Summary

SolarEdge has three API surfaces plus two unofficial web endpoints. The **public API** works well for inverter-level and site-level data but returns empty for per-optimizer queries. The **old portal API** (`solaredge-apigw`) serves `layout/logical` and `layout/energy`. The **old portal web endpoints** (`solaredge-web`) include two critical endpoints: `chartData` (per-optimizer historical time-series) and `playbackData` (per-optimizer snapshot data). The **new CNI portal API** requires complex Cognito OAuth authentication and blocks chart/data execution with **403 Forbidden** for residential site OWNER accounts.

**Bottom line (UPDATED):** Two unofficial `solaredge-web` endpoints can retrieve per-optimizer historical telemetry:
1. **`/solaredge-web/p/chartData`** -- returns time-series data (Power, Voltage, Current, Energy, PowerBox Voltage) per optimizer for arbitrary date ranges. Used by the `solaredgeoptimizers` Python package.
2. **`/solaredge-web/p/playbackData`** -- returns per-optimizer power snapshots at 15-min intervals. Used by the SEDRI project.

Both require portal session authentication (not the public API key).

---

## Public Monitoring API

**Base URL:** `https://monitoringapi.solaredge.com`
**Auth:** API key as query parameter (`api_key=...`)

### Working Endpoints

| Endpoint | Method | Description | Notes |
|---|---|---|---|
| `/site/{siteId}/details` | GET | Site details (location, peak power, install date) | ✅ Works |
| `/site/{siteId}/overview` | GET | Site overview (lifetime energy, revenue) | ✅ Works |
| `/site/{siteId}/energy` | GET | Site energy (daily/monthly/yearly) | ✅ Works |
| `/site/{siteId}/power` | GET | Site power at 15-min intervals | ✅ Works |
| `/site/{siteId}/powerDetails` | GET | Site power with meter breakdown (FeedIn, etc.) at 15-min | ✅ Works |
| `/site/{siteId}/energyDetails` | GET | Site energy with meter breakdown at 15-min | ✅ Works |
| `/site/{siteId}/inventory` | GET | Equipment inventory (inverters, batteries, meters) | ✅ Returns inverters only; `connectedOptimizers: 36` but no optimizer serial numbers |
| `/equipment/{siteId}/list` | GET | Equipment list (inverters) | ✅ Returns inverters only |
| `/equipment/{siteId}/{serialNumber}/data` | GET | Equipment telemetry (15-min intervals) | ✅ Works for **inverter** SNs; ❌ Returns **empty** for optimizer SNs |
| `/site/{siteId}/dataPeriod` | GET | Available data date range | ✅ Works |
| `/site/{siteId}/currentPowerFlow` | GET | Current power flow | ✅ Works |
| `/site/{siteId}/envBenefits` | GET | Environmental benefits | ✅ Works |

### Key Limitation

The `/equipment/{siteId}/{serialNumber}/data` endpoint returns `{"data":{"count":0,"telemetries":[]}}` for all optimizer serial numbers, even though the same serial numbers are visible in the monitoring portal. This appears to be a deliberate restriction for residential accounts using the public API.

---

## Old Portal API (solaredge-apigw)

**Base URL:** `https://monitoring.solaredge.com/solaredge-apigw/api/`
**Auth:** Session-based (JSESSIONID cookie from POST to `/login`)

### Login

```
POST /solaredge-apigw/api/login
Content-Type: application/x-www-form-urlencoded
Body: j_username={email}&j_password={password}
```

Returns HTTP 302 redirect to `/solaredge-apigw/api/user/details` with `Set-Cookie: JSESSIONID=...` and `CSRF-TOKEN=...`.

### Working Endpoints

| Endpoint | Method | Result |
|---|---|---|
| `/sites/{siteId}/layout/logical` | GET | ✅ **Works!** Returns full logical tree with all 36 optimizers (type `POWER_BOX`), their serial numbers, names, and today's per-optimizer energy in `reportersData` |

### Response Structure for `layout/logical`

```json
{
  "siteId": 1353684,
  "expanded": true,
  "playback": true,
  "hasPhysical": true,
  "logicalTree": {
    "children": [
      {
        "data": {
          "id": 105687541,
          "serialNumber": "7E171746-F2",
          "name": "Inverter 1",
          "type": "INVERTER_3PHASE"
        },
        "children": [
          {
            "data": { "type": "STRING", "name": "String 1.0" },
            "children": [
              {
                "data": {
                  "id": 100714142,
                  "serialNumber": "12272871-D2",
                  "name": "Module 1.0.8",
                  "type": "POWER_BOX"
                }
              }
              // ... 35 more optimizers
            ]
          }
        ]
      }
    ]
  },
  "reportersData": {
    "100714142": {
      "energy": 2.26,
      "moduleEnergy": 2.26,
      "unscaledEnergy": 2260.5,
      "units": "kWh",
      "color": "#3091F2"
    },
    "1353684": {
      "energy": 77.19,
      "units": "kWh"
    }
    // ... entry for each optimizer by internal ID
  }
}
```

### Key Details

- Optimizer type in the tree is `POWER_BOX` (not `OPTIMIZER`)
- `reportersData` contains **today's daily energy** per optimizer, keyed by internal ID
- Date parameters (`?date=`, `?startDate=`, `?from=`) are accepted but **do not change** the `reportersData` — it always returns today's data
- All other endpoints (`/overview`, `/energy`, `/power`, etc.) return **404** — SolarEdge appears to have removed them from the old API gateway

### Non-Working Endpoints (all return 404)

- `/sites/{siteId}/overview`
- `/sites/{siteId}/currentPowerFlow`
- `/sites/{siteId}/energy`
- `/sites/{siteId}/power`
- `/sites/{siteId}/energyDetails`
- `/sites/{siteId}/powerDetails`
- `/sites/{siteId}/inventory`
- `/sites/{siteId}/dataPeriod`
- `/sites/{siteId}/envBenefits`
- `/sites/{siteId}/equipment/{serialNumber}/data`
- `/sites/{siteId}/equipment/{serialNumber}/telemetry`
- `/sites/{siteId}/modules/{id}/telemetry`
- `/sites/{siteId}/powerboxes/{id}/telemetry`
- `/sites/{siteId}/components/{id}/telemetry`
- `/sites/{siteId}/reporters/{id}/data`
- `/sites/{siteId}/playback`

---

## Old Portal Web Endpoints (solaredge-web)

**Base URL:** `https://monitoring.solaredge.com/solaredge-web/p/`
**Auth:** Session-based (same JSESSIONID + CSRF-TOKEN from the `/solaredge-apigw/api/login` flow)

These endpoints are used by the old SolarEdge monitoring portal SPA and are the key to per-optimizer historical data. Discovered via reverse-engineering by the `solaredgeoptimizers` Python package (ProudElm/packaging_solaredgeoptimizers on GitHub).

### Login (shared with solaredge-apigw)

The same session cookies from the `solaredge-apigw/api/login` POST work here. Additionally, the `solaredge-web/p/login` endpoint can be used directly with HTTP Basic Auth:

```python
session = requests.Session()
# Warm up the session
session.head("https://monitoring.solaredge.com/solaredge-apigw/api/sites/{siteid}/layout/energy")
# Login
session.auth = (username, password)
session.get("https://monitoring.solaredge.com/solaredge-web/p/login")
# Extract CSRF token from cookies
csrf_token = session.cookies["CSRF-TOKEN"]
```

### Endpoint 1: chartData (Per-Optimizer Historical Time-Series)

**This is the most important endpoint for per-optimizer historical data.**

```
GET https://monitoring.solaredge.com/solaredge-web/p/chartData
    ?reporterId={optimizerInternalId}
    &fieldId={siteId}
    &reporterType=
    &startDate={unixTimestampMs}
    &endDate={unixTimestampMs}
    &uom=W
    &parameterName={parameter}
```

**Parameters:**
| Parameter | Type | Description |
|---|---|---|
| `reporterId` | integer | The optimizer's internal ID (from `layout/logical` tree, e.g., `100714142`) |
| `fieldId` | integer | The site ID (e.g., `1353684`) |
| `reporterType` | string | Leave empty |
| `startDate` | integer | Start time as Unix timestamp in **milliseconds** |
| `endDate` | integer | End time as Unix timestamp in **milliseconds** |
| `uom` | string | Unit of measure, typically `W` |
| `parameterName` | string | The measurement type (see table below) |

**Valid `parameterName` values by item type:**

| Item Type | Valid Parameters |
|---|---|
| **Panel/Optimizer** | `Power`, `Current`, `Voltage`, `Energy`, `PowerBox Voltage` |
| **String** | `Energy`, `Power` |
| **Inverter** | `AC Energy`, `AC Frequency`, `AC Frequency P2`, `AC Frequency P3`, `AC Voltage`, `AC Voltage P2`, `AC Voltage P3`, `AC Current`, `AC Current P2`, `AC Current P3`, `Power`, `DC Voltage`, `Purchased back feed AC Energy`, `Total Reactive Power`, `Power Factor` |

**Response format:**

```json
{
  "dateValuePairs": [
    { "date": 1709874000000, "value": 245.3 },
    { "date": 1709874900000, "value": 312.7 },
    ...
  ]
}
```

- `date` is Unix timestamp in milliseconds
- `value` is the measurement value in the requested unit
- Data points are at ~15-minute intervals
- The `reporterId` must be the **internal numeric ID** (not the serial number). Get this from `layout/logical`.

**Required headers for authenticated requests:**

```python
headers = {
    "authority": "monitoring.solaredge.com",
    "accept": "*/*",
    "content-type": "application/json",
    "cookie": session_cookies_string,
    "origin": "https://monitoring.solaredge.com",
    "referer": "https://monitoring.solaredge.com/solaredge-web/p/site/{siteId}/",
    "x-csrf-token": csrf_token,
    "x-kl-ajax-request": "Ajax_Request",
    "x-requested-with": "XMLHttpRequest",
    "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ..."
}
```

**Date handling example (Python):**

```python
from datetime import datetime, timedelta

# Default to today
start = datetime(2025, 3, 1)
start_ms = int(start.timestamp() * 1000)  # e.g., 1709254800000
end_ms = int((start + timedelta(days=1)).total_seconds() * 1000) + start_ms

# Query one optimizer's power for March 1, 2025
url = (f"https://monitoring.solaredge.com/solaredge-web/p/chartData"
       f"?reporterId=100714142&fieldId=1353684&reporterType="
       f"&startDate={start_ms}&endDate={end_ms}&uom=W&parameterName=Power")
```

**Rate limiting:** The `solaredgeoptimizers` library adds 100ms delay between requests and retries on connection resets with 5s cooldown (3 retries max). This suggests SolarEdge may throttle aggressive scraping.

### Endpoint 2: playbackData (Per-Optimizer Snapshots)

```
POST https://monitoring.solaredge.com/solaredge-web/p/playbackData
Content-Type: application/x-www-form-urlencoded
X-CSRF-TOKEN: {csrf_token}
Body: fieldId={siteId}&timeUnit={timeUnit}
```

**`timeUnit` values:**
| Value | Meaning |
|---|---|
| `4` | DAILY (shows 15-min intervals for recent day) |
| `5` | WEEKLY |
| `6` | MONTHLY |

**Response format:**

Returns a nested dictionary with timestamps as keys, mapping optimizer IDs to wattage readings at 15-minute intervals. The response uses single quotes and non-standard JSON, requiring string cleanup before parsing.

**Note:** The SEDRI project states "pData.py can only get 7 days of data. That's all SolarEdge provides" for this endpoint, suggesting a rolling 7-day window.

### Endpoint 3: publicSystemData (Per-Optimizer Current Measurements)

```
GET https://monitoringpublic.solaredge.com/solaredge-web/p/publicSystemData
    ?reporterId={optimizerInternalId}
    &type=panel
    &activeTab=0
    &fieldId={siteId}
    &isPublic=true
    &locale=en_US
```

**Note:** This endpoint is on `monitoringpublic.solaredge.com` (different host). It returns current/last measurements, not historical data.

**Response format:**

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

## New CNI Portal API (services/cni)

**Base URL:** `https://monitoring.solaredge.com/services/cni/`
**Auth:** JWT cookie (`se_monitoring_auth`) obtained via Cognito PKCE OAuth flow

### Authentication (Cognito PKCE)

See [Authentication Flows](#authentication-flows) section below.

### Working Endpoints

| Endpoint | Method | HTTP | Notes |
|---|---|---|---|
| `/ui-api/user-info` | GET | 200 | Returns userId, email, name, language |
| `/ui-api/sites/{siteId}` | GET | 200 | Site details (name, location, peak power, timezone) |
| `/ui-api/sites/{siteId}/pages` | GET | 200 | Available page modules for this site |
| `/ui-api/sites/{siteId}/user-actions` | GET | 200 | User roles and permitted actions |
| `/ui-api/feature-flags/user` | GET | 200 | User feature flags |
| `/ui-api/feature-flags/site/{siteId}` | GET | 200 | Site feature flags |
| `/ui-api/pages/site/analysis/site/{siteId}/supported-charts` | GET | 200 | List of available chart types |
| `/ui-api/pages/site/analysis/site/{siteId}/metrics/supported` | GET | 200 | Supported measurements and calculations |
| `/services/auth/valid` | GET | 200 | Session validity check |
| `/services/auth/refresh` | POST | 200 | Session refresh |

### Blocked Endpoints (403 Forbidden)

All "execute" and data endpoints return 403 for residential OWNER accounts:

| Endpoint | Method | HTTP | Description |
|---|---|---|---|
| `/ui-api/pages/site/analysis/execute/site/{siteId}/render-chart` | POST | 403 | Chart data rendering |
| `/ui-api/pages/site/analysis/custom/site/{siteId}/devices` | GET | 403 | Device list for analysis |
| `/ui-api/pages/site/dashboard/execute/site/{siteId}/render-chart` | POST | 403 | Dashboard chart rendering |
| `/ui-api/pages/site/dashboard/site/{siteId}/equipment` | GET | 403 | Dashboard equipment list |
| `/ui-api/pages/site/dashboard/site/{siteId}/metrics/live` | GET | 403 | Live metrics |
| `/ui-api/pages/site/dashboard/site/{siteId}/dashboard-descriptor` | GET | 403 | Dashboard layout |
| `/api/ui/data-export/site/{siteId}/export-data` | POST | 403 | Data export |
| `/api/ui/data-export/site/{siteId}/supported-exporters` | GET | 403 | Export format options |

### Unavailable Endpoints (502/404)

| Endpoint | Method | HTTP | Notes |
|---|---|---|---|
| `/ui-api/pages/site/digital-twin/site/{siteId}/optimizer/{optimizerId}` | GET | 502 | Digital twin service appears down |
| `/ui-api/pages/site/digital-twin/site/{siteId}/import-layout` | POST | 502 | Same |
| `/ui-api/pages/site/digital-twin/site/{siteId}/fetch-layout-data` | POST | 502 | Same |
| `/internal/charts/site/{siteId}/execute/render-chart` | POST | 404 | Internal-only endpoint |
| `/internal/charts/execute/render-chart` | POST | 404 | Internal-only endpoint |
| `/ui-api/power-flow/site/{siteId}` | GET | 404 | Not routed |

### User Actions Response

The OWNER role has these permissions:
```json
{
  "roles": ["OWNER"],
  "actions": [
    "STANDARD_ANALYSIS_VIEW",
    "DIGITAL_TWIN_VIEW",
    "SITE_ENERGY_BOARD_VIEW",
    "SITE_ENERGY_BOARD_EDIT"
  ]
}
```

Despite having `STANDARD_ANALYSIS_VIEW`, the render-chart execution endpoints return 403. This suggests the "VIEW" permission only applies to the browser SPA, not direct API calls, or there's an additional authorization layer in the browser (e.g., CORS origin check, browser-only session flag).

### Available Charts (from supported-charts)

- `inverter-production-breakdown` (INVERTER)
- `site-energy-vs-irradiance` (SITE)
- `site-energy-monthly-comparison` (SITE)
- `inverter-production-time` (INVERTER)
- `site-pr-calculation-breakdown` (SITE)
- `site-energy-generation` (SITE)
- `site-yield` (SITE)
- `site-performance` (SITE)
- `site-expected-power` (SITE)
- `site-power-generation` (SITE)
- `site-accumulated-energy` (SITE)
- `inverter-power-generation` (INVERTER)
- `inverter-pr` (INVERTER)
- `site-daily-energy-flow` (SITE)
- `inverter-performance` (INVERTER)
- `inverter-power-statistics` (INVERTER)
- `inverter-energy-generation` (INVERTER)

### Render Chart Request Body Format

Discovered from the portal's JavaScript bundle:

```json
{
  "chartPeriodScale": "DAY",
  "intervalIndex": 0,
  "chartUri": "site-energy-generation",
  "chartPopulation": {
    "siteId": 1353684,
    "populationType": "site"
  },
  "customPeriod": {
    "from": "2025-02-25",
    "to": "2025-02-25"
  }
}
```

For device-level charts:
```json
{
  "chartPeriodScale": "DAY",
  "intervalIndex": 0,
  "chartUri": "inverter-power-generation",
  "chartPopulation": {
    "siteId": 1353684,
    "populationType": "deviceList",
    "deviceType": "INVERTER",
    "deviceSerials": ["7E171746-F2"]
  }
}
```

Valid `chartPeriodScale` values: `DAY`, `WEEK`, `MONTH`, `YEAR`

### Key API Endpoints Found in JS Bundles

From the analysis MFE (`/mfe/onm_analysis/`), chunk 558:

```
GET  /services/cni/ui-api/pages/site/analysis/site/{siteId}/supported-charts
GET  /services/cni/ui-api/pages/site/analysis/site/{siteId}/metrics/supported
GET  /services/cni/ui-api/pages/site/analysis/custom/site/{siteId}/devices
GET  /services/cni/ui-api/pages/site/analysis/custom/site/{siteId}/v2/devices
GET  /services/cni/ui-api/pages/site/analysis/custom/site/{siteId}/devices/strings/{stringId}/optimizers
POST /services/cni/ui-api/pages/site/analysis/execute/site/{siteId}/render-chart
POST /services/cni/ui-api/pages/site/analysis/execute/site/{siteId}/render-custom-chart
POST /services/cni/ui-api/pages/site/analysis/custom/site/{siteId}/generate-chart
POST /services/cni/ui-api/pages/site/analysis/custom/site/{siteId}/generate-saved-chart
POST /services/cni/internal/charts/site/{siteId}/execute/render-chart
GET  /services/cni/ui-api/pages/site/digital-twin/site/{siteId}/optimizer/{optimizerId}
GET  /services/cni/ui-api/pages/site/digital-twin/site/{siteId}/supported-layout-layers
POST /services/cni/ui-api/pages/site/digital-twin/site/{siteId}/fetch-layout-data
POST /services/cni/ui-api/pages/site/digital-twin/site/{siteId}/import-layout
GET  /services/charts/site/{siteId}/disabled-devices/is-show-allowed
```

---

## Authentication Flows

### 1. Public API

Simply append `api_key=YOUR_KEY` to any request URL. No session needed.

### 2. Old Portal (JSESSIONID)

```
POST https://monitoring.solaredge.com/solaredge-apigw/api/login
Content-Type: application/x-www-form-urlencoded
Body: j_username={email}&j_password={password}

Response: 302 Redirect
Cookies: JSESSIONID, SPRING_SECURITY_REMEMBER_ME_COOKIE, SolarEdge_SSO-1.4, CSRF-TOKEN
```

Use the `JSESSIONID` cookie for subsequent requests. Only `layout/logical` works.

### 3. New Portal (Cognito PKCE → JWT)

This is a multi-step OAuth 2.0 Authorization Code flow with PKCE:

**Step 1: Generate PKCE challenge**
```python
code_verifier = base64url(random(32))
code_challenge = base64url(sha256(code_verifier))
```

**Step 2: Get Cognito login page**
```
GET https://login.solaredge.com/login?
  lang=en&
  response_type=code&
  client_id=ugfnsujd3384sshcjehaphlh3&
  scope=email+openid&
  redirect_uri=https://monitoring.solaredge.com/mfe/auth/callback&
  code_challenge_method=S256&
  code_challenge={code_challenge}
```

Parse the HTML form to extract the `csrf` hidden field.

**Step 3: Submit login form**
```
POST to same URL
Content-Type: application/x-www-form-urlencoded
Body: csrf={csrf}&username={email}&password={password}&cognitoAsfData=
```

Response: 302 redirect to `https://monitoring.solaredge.com/mfe/auth/callback?code={auth_code}`

**Step 4: Exchange code for tokens**
```
POST https://login.solaredge.com/oauth2/token
Content-Type: application/x-www-form-urlencoded
Body: grant_type=authorization_code&
  client_id=ugfnsujd3384sshcjehaphlh3&
  redirect_uri=https://monitoring.solaredge.com/mfe/auth/callback&
  code={auth_code}&
  code_verifier={code_verifier}
```

Response: `{ id_token, access_token, refresh_token, expires_in: 86400, token_type: "Bearer" }`

**Step 5: Exchange tokens for monitoring session**
```
POST https://monitoring.solaredge.com/services/auth/token
Content-Type: application/json
Body: { id_token, access_token, refresh_token, expires_in, token_type }
```

Sets cookies: `se_monitoring_auth` (path=/services), `se_monitoring_refresh` (path=/services/auth)

**Cognito Details:**
- Client ID: `ugfnsujd3384sshcjehaphlh3`
- Domain: `login.solaredge.com`
- `USER_PASSWORD_AUTH` flow: Not supported (ResourceNotFoundException)
- `password` grant type: Not supported (unsupported_grant_type)
- Region: Likely `eu-west-1` (ALB server, not directly confirmable)

---

## What Works vs What Doesn't

### ✅ Can retrieve

| Data | API | Granularity | History |
|---|---|---|---|
| Site energy | Public API | Daily/15-min | Full history |
| Site power | Public API | 15-min | Full history |
| Site power details (FeedIn, etc.) | Public API | 15-min | Full history |
| Inverter telemetry | Public API | 15-min | Full history |
| Optimizer serial numbers + internal IDs | Old Portal (`layout/logical`) | Discovery | N/A |
| Today's per-optimizer daily energy | Old Portal (`layout/logical`) | Daily total | Today only |
| **Per-optimizer historical power/voltage/current** | **Old Portal Web (`chartData`)** | **~15-min** | **Arbitrary date range** |
| **Per-optimizer current measurements** | **Public System Data** | **Snapshot** | **Last reading only** |
| **Per-optimizer 15-min snapshots** | **Old Portal Web (`playbackData`)** | **15-min** | **~7 days rolling** |
| Per-optimizer lifetime energy | Old Portal (`layout/energy`) | Cumulative | Total only |
| Site metadata (location, peak power) | Public API + CNI | N/A | Current |

### ❌ Cannot retrieve (via official/public API)

| Data | Why |
|---|---|
| Per-optimizer data via public API | `/equipment/{siteId}/{serialNumber}/data` returns empty for optimizer SNs |
| CNI portal chart data | 403 Forbidden for residential OWNER accounts |
| Data export via CNI | 403 Forbidden |

### ⚠️ Can retrieve but unofficial (may break)

| Data | Endpoint | Risk |
|---|---|---|
| Per-optimizer historical telemetry | `solaredge-web/p/chartData` | Unofficial, session-auth, may be rate-limited or disabled |
| Per-optimizer snapshots | `solaredge-web/p/playbackData` | Unofficial, ~7 day limit, non-standard JSON |
| Per-optimizer current readings | `monitoringpublic.solaredge.com/...publicSystemData` | Public but undocumented |

---

## Tested Credentials & Site Info

- **Site ID:** 1353684
- **API Key:** 9AMEDLLW9UST1HA7849YYIF9JQK1UJN8
- **Portal Username:** nadav.azaria@gmail.com
- **Inverter:** 7E171746-F2 (SolarEdge SE15K-IL000BNN4, 3-phase)
- **Optimizers:** 36 units (type POWER_BOX), all on String 1.0
- **Location:** Beer Sheva, Israel (31.332°N, 34.897°E)
- **Peak Power:** 15 kW

### Sample Optimizer Serial Numbers

```
12272871-D2  (Module 1.0.8)
12290F71-BB  (Module 1.0.9)
1226FB86-B9  (Module 1.0.10)
12270B03-47  (Module 1.0.11)
... (36 total)
```

---

## Open-Source Projects and Tools

### 1. solaredgeoptimizers (ProudElm) -- MOST RELEVANT

- **GitHub:** https://github.com/ProudElm/solaredgeoptimizers (HA integration, 61 stars)
- **Python package:** https://github.com/ProudElm/packaging_solaredgeoptimizers (the actual API client)
- **PyPI:** `pip install solaredgeoptimizers`
- **What it does:** Home Assistant integration that retrieves per-optimizer current readings (Power, Current, Voltage, Optimizer Voltage, Lifetime Energy) from the SolarEdge portal.
- **Key endpoints used:**
  - `solaredge-apigw/api/sites/{siteId}/layout/logical` -- discovers all optimizers
  - `solaredge-apigw/api/sites/{siteId}/layout/energy?timeUnit=ALL` -- lifetime energy per optimizer
  - `monitoringpublic.solaredge.com/solaredge-web/p/publicSystemData` -- current measurements per optimizer
  - `solaredge-web/p/chartData` -- **historical time-series per optimizer** (the key endpoint)
- **Auth:** Username/password session-based login via `solaredge-web/p/login`
- **Rate handling:** 100ms delay between requests, 5s cooldown on connection reset, 3 retries
- **Update interval:** Every 15 minutes

### 2. SEDRI (dkperf)

- **GitHub:** https://github.com/dkperf/SEDRI
- **What it does:** Retrieves per-panel optimizer data and inverter data, stores locally, generates plots.
- **Key endpoints used:**
  - `solaredge-apigw/api/login` -- session auth
  - `solaredge-web/p/playbackData` -- per-optimizer 15-min power snapshots
  - `monitoringapi.solaredge.com/equipment/{siteId}/{inverterId}/data` -- inverter telemetry
- **Limitation:** "pData.py can only get 7 days of data. That's all SolarEdge provides" for `playbackData`.
- **Auth:** JSESSIONID + CSRF-TOKEN from form login

### 3. solaredge-webscrape (dragoshenron)

- **GitHub:** https://github.com/dragoshenron/solaredge-webscrape
- **What it does:** Bash script that downloads per-optimizer data (Current, Energy, Voltage, PowerBox Voltage, Power) from the SolarEdge web portal.
- **Auth:** Uses a `requesterId` extracted manually from Chrome DevTools.
- **Output:** Can post to InfluxDB.
- **Status:** Alpha. Requires manual auth setup.

### 4. solaredge (jbuehl) -- Hardware-level approach

- **GitHub:** https://github.com/jbuehl/solaredge
- **What it does:** Captures per-optimizer telemetry by intercepting the inverter's network traffic or using RS232/RS485 serial connections.
- **Not an API client** -- requires physical access to the inverter's network or serial port.
- **Limitation:** Modern inverters use SSL/TLS encryption, limiting compatibility to serial connections.

### 5. solaredge-local (drobtravels) -- Local API

- **GitHub:** https://github.com/drobtravels/solaredge-local
- **PyPI:** `pip install solaredge-local`
- **What it does:** Accesses the local API on SetApp-based SolarEdge inverters (no display, HD-Wave, newer 3-phase EU models).
- **Key endpoint:** `http://{inverter-ip}/web/v1/maintenance` -- per-optimizer data via Protocol Buffers.
- **No auth required** for local API.
- **Critical limitation:** "Recent firmware versions disable local access." Many users report it no longer works.

### 6. solaredge_modbus (nmakel) -- Modbus approach

- **GitHub:** https://github.com/nmakel/solaredge_modbus
- **What it does:** Reads data directly from SolarEdge inverters via Modbus TCP/RTU (SunSpec protocol).
- **Provides:** Real-time inverter and meter data. Per-optimizer data limited to what the inverter exposes via Modbus registers.
- **Requires:** LAN access, Modbus TCP enabled on inverter.

---

## Recommended Implementation Path

Based on the research, the best approach for YieldGuard to get per-optimizer historical data:

### Phase 1: Use `chartData` endpoint (highest priority)

The `solaredge-web/p/chartData` endpoint is the only known way to get arbitrary historical per-optimizer time-series data. Implementation steps:

1. **Store portal credentials** alongside the existing API key (username + password for `monitoring.solaredge.com`)
2. **Discover optimizers** via `layout/logical` -- get internal IDs (not serial numbers)
3. **Fetch historical data** via `chartData` with `parameterName=Power` for each optimizer
4. **Backfill** by iterating date ranges (e.g., 1 day at a time per optimizer)
5. **Rate limit** requests: ~100ms between calls, handle connection resets gracefully

### Phase 2: Daily polling for ongoing data

- Poll `layout/logical` daily for today's per-optimizer energy totals
- Poll `chartData` for yesterday's 15-min data once per day
- Use `publicSystemData` for near-real-time current readings

### Key implementation concerns:

- **Session management:** Sessions expire; need to re-authenticate periodically
- **Rate limiting:** No documented limits, but `solaredgeoptimizers` library suggests SolarEdge throttles at ~10 req/sec
- **Fragility:** These are unofficial endpoints that SolarEdge could change or block at any time
- **Identifier mapping:** `chartData` uses internal numeric IDs (from `layout/logical`), not serial numbers. Must maintain a mapping table.

---

## Future Avenues to Explore

1. **Browser automation (Puppeteer/Playwright):** The web portal UI at `monitoring.solaredge.com/one#/residential/analysis` can render per-optimizer charts. A headless browser could potentially access these and scrape the rendered data. However, this is fragile, slow, and may violate ToS.

2. **SolarEdge SetApp API:** Some newer SolarEdge inverters use the SetApp mobile application which may have a different API. Worth investigating if the user's inverter supports it.

3. **Modbus/SunSpec:** Direct local network access to the inverter via Modbus TCP can provide real-time per-optimizer data. Requires the inverter to be on the same network and Modbus to be enabled. Does not provide historical data.

4. **SolarEdge API changes:** SolarEdge may expand their public API or change the CNI API permissions in the future. The `STANDARD_ANALYSIS_VIEW` permission exists, suggesting the intent is there.

5. **Daily polling of `layout/logical`:** Could accumulate per-optimizer daily energy going forward by polling `reportersData` once per day. Only captures today's totals; no intra-day granularity.

6. **Commercial account:** The 403 errors may be specific to residential OWNER accounts. A commercial/installer account might have different permissions on the CNI API execute endpoints.
