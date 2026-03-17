# SolarEdge API Research Findings

> **Date:** March 2026
> **Context:** Investigating how to retrieve per-optimizer (per-panel) historical telemetry data from SolarEdge for the YieldGuard app.

---

## Table of Contents

1. [Summary](#summary)
2. [Public Monitoring API](#public-monitoring-api)
3. [Old Portal API (solaredge-apigw)](#old-portal-api-solaredge-apigw)
4. [New CNI Portal API (services/cni)](#new-cni-portal-api-servicescni)
5. [Authentication Flows](#authentication-flows)
6. [What Works vs What Doesn't](#what-works-vs-what-doesnt)
7. [Tested Credentials & Site Info](#tested-credentials--site-info)
8. [Future Avenues to Explore](#future-avenues-to-explore)

---

## Summary

SolarEdge has three API surfaces. The **public API** works well for inverter-level and site-level data but returns empty for per-optimizer queries. The **old portal API** only serves the `layout/logical` endpoint (everything else returns 404). The **new CNI portal API** requires complex Cognito OAuth authentication and blocks chart/data execution with **403 Forbidden** for residential site OWNER accounts, despite the same user being able to see the data in the browser-based SolarEdge monitoring portal.

**Bottom line:** Per-optimizer historical telemetry cannot be retrieved programmatically for residential accounts as of March 2026.

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
| Optimizer serial numbers + names | Old Portal | Discovery | N/A |
| Today's per-optimizer daily energy | Old Portal | Daily total | Today only |
| Site metadata (location, peak power) | Public API + CNI | N/A | Current |

### ❌ Cannot retrieve

| Data | Why |
|---|---|
| Historical per-optimizer telemetry | Public API returns empty; CNI API returns 403 |
| Per-optimizer 15-min power data | Same as above |
| Per-optimizer historical daily energy | `layout/logical` only returns today; no date param support |

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

## Future Avenues to Explore

1. **Browser automation (Puppeteer/Playwright):** The web portal UI at `monitoring.solaredge.com/one#/residential/analysis` can render per-optimizer charts. A headless browser could potentially access these and scrape the rendered data. However, this is fragile, slow, and may violate ToS.

2. **SolarEdge SetApp API:** Some newer SolarEdge inverters use the SetApp mobile application which may have a different API. Worth investigating if the user's inverter supports it.

3. **Modbus/SunSpec:** Direct local network access to the inverter via Modbus TCP can provide real-time per-optimizer data. Requires the inverter to be on the same network and Modbus to be enabled. Does not provide historical data.

4. **SolarEdge API changes:** SolarEdge may expand their public API or change the CNI API permissions in the future. The `STANDARD_ANALYSIS_VIEW` permission exists, suggesting the intent is there.

5. **Daily polling of `layout/logical`:** Could accumulate per-optimizer daily energy going forward by polling `reportersData` once per day. Only captures today's totals; no intra-day granularity.

6. **Commercial account:** The 403 errors may be specific to residential OWNER accounts. A commercial/installer account might have different permissions on the CNI API execute endpoints.
