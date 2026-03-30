
# Daily Soiling Loss Estimation for Residential PV Systems
## Complete Algorithm Design & Theory

---

## 1. Problem Statement

**Given:**
- A residential PV system (e.g., 15.84 kWp, ~20 panels)
- System location (latitude, longitude)
- Production measurements every 15 minutes (system-level)
- System size (kWp) and number of panels

**Objective:**
For each day, estimate:
- **Soiling loss (kWh)** — how much energy was lost due to dirt
- **Soiling ratio** — the fraction of "clean" production being achieved (1.0 = clean, 0.93 = 7% soiling loss)
- **Cumulative monetary loss** — to trigger cleaning recommendations

---

## 2. Core Concept: The Decomposition Problem

The actual power output of a PV system at any moment is:

$$P_{\text{actual}}(t) = P_{\text{clean}}(t) \times S(t) \times \epsilon_{\text{other}}(t)$$

Where:
- $P_{\text{clean}}(t)$ = expected power if panels were perfectly clean
- $S(t)$ = **soiling ratio** (what we want to extract) — ranges from 0 to 1
- $\epsilon_{\text{other}}(t)$ = all other unmodeled losses (measurement noise, transient shading, snow, etc.)

**The fundamental insight**: If we can accurately model $P_{\text{clean}}(t)$, then we can extract the soiling ratio:

$$S(t) = \frac{P_{\text{actual}}(t)}{P_{\text{clean}}(t) \times \epsilon_{\text{other}}(t)}$$

The entire algorithm is about:
1. Making $P_{\text{clean}}(t)$ as accurate as possible
2. Minimizing the contamination from $\epsilon_{\text{other}}(t)$

---

## 3. Phase 1 — System Characterization (One-Time Setup)

### 3.1 Required Inputs
```
system_config = {
    latitude: float,          # e.g., 32.07 (Tel Aviv)
    longitude: float,         # e.g., 34.78
    altitude_m: float,        # meters above sea level
    system_capacity_kwp: float,  # e.g., 15.84
    num_panels: int,          # e.g., 36
    panel_wp: float,          # watt-peak per panel (e.g., 440)
    tilt_deg: float,          # panel tilt from horizontal (if known)
    azimuth_deg: float,       # panel facing direction, 180=south (if known)
    installation_date: date,  # for degradation calculation
    electricity_price_per_kwh: float,  # for ROI calculation
    cleaning_cost: float      # cost of one cleaning event
}
```

### 3.2 Unknown Tilt & Azimuth

If tilt and azimuth are unknown (common for residential), **estimate them from the production data**:

**Method**: On clear days, the time of peak production reveals the azimuth, and the peak-to-morning/evening ratio reveals the tilt.

1. Select 5-10 clear days (high total production, smooth profile)
2. For each candidate (tilt, azimuth) pair, compute expected production profile
3. Find the pair that best matches actual production shape (minimize RMSE of normalized profile)
4. Search space: tilt ∈ [0°, 60°], azimuth ∈ [90°, 270°], step 2°

Alternatively, if the system was installed professionally, the tilt typically equals the roof pitch and azimuth matches the roof orientation — these can often be obtained from the installer or estimated from satellite imagery.

---

## 4. Phase 2 — The Clean Baseline Model: $P_{\text{clean}}(t)$

This is the most critical component. The better this model, the more accurately you isolate soiling.

### 4.1 Solar Position Calculation

For each 15-minute timestamp $t$, compute the sun's position:

**Inputs**: latitude, longitude, timestamp (with timezone)

**Outputs**:
- **Solar zenith angle** $\theta_z$ (angle from vertical; 0° = sun directly overhead)
- **Solar azimuth** $\gamma_s$ (compass direction of the sun; 180° = due south in Northern Hemisphere)
- **Solar elevation** $\alpha_s = 90° - \theta_z$

Use the **NREL SPA algorithm** (Solar Position Algorithm) — accurate to ±0.0003° over millennia. This is built into `pvlib.solarposition.get_solarposition()`.

**When $\alpha_s < 0$**: Sun is below the horizon → $P_{\text{clean}} = 0$.

### 4.2 Clear-Sky Irradiance Model

Compute the irradiance that would reach the panels under perfectly clear skies.

**Step A — Clear-sky irradiance on a horizontal surface:**

Use the **Ineichen-Perez model** which computes three components:
- **GHI** (Global Horizontal Irradiance) — total sunlight on a flat surface
- **DNI** (Direct Normal Irradiance) — direct beam from the sun
- **DHI** (Diffuse Horizontal Irradiance) — scattered light from the sky

The model requires the **Linke Turbidity** coefficient $T_L$ which characterizes atmospheric clarity. This varies by location and month. Lookup tables exist (pvlib provides them for any lat/lon from the SoDa database).

$$GHI_{\text{clear}} = DNI_{\text{clear}} \cdot \cos(\theta_z) + DHI_{\text{clear}}$$

**Step B — Transposition to Plane of Array (POA):**

The panels are tilted, so we need to convert horizontal irradiance to the irradiance actually hitting the panel surface. Use the **Perez transposition model** (most accurate):

$$POA = POA_{\text{beam}} + POA_{\text{sky diffuse}} + POA_{\text{ground reflected}}$$

Where:
- $POA_{\text{beam}} = DNI \cdot \cos(\text{AOI})$
  - AOI = Angle of Incidence between sun direction and panel normal
- $POA_{\text{sky diffuse}}$ = Perez model (anisotropic sky model, uses sun position + clearness/brightness indices)
- $POA_{\text{ground reflected}} = GHI \cdot \rho \cdot \frac{1 - \cos(\text{tilt})}{2}$
  - $\rho$ = ground albedo (typically 0.2 for ground, 0.25 for concrete, 0.6-0.8 for snow)

### 4.3 Angle of Incidence (AOI) Losses

Light hitting glass at a steep angle gets partially reflected. This is an **optical loss**, not soiling — must be modeled to avoid confusing it with dirt.

Use the **physical IAM (Incidence Angle Modifier)** model:

$$IAM(\theta) = 1 - b_0 \left(\frac{1}{\cos(\theta)} - 1\right)$$

Where $b_0 \approx 0.05$ for glass-covered panels, and $\theta$ = AOI.

For $\theta > 85°$: $IAM = 0$ (essentially no light gets through at extreme angles).

The effective POA irradiance:
$$POA_{\text{effective}} = POA_{\text{beam}} \cdot IAM(\theta) + POA_{\text{diffuse}} \cdot IAM_{\text{diffuse}}$$

Where $IAM_{\text{diffuse}} \approx 0.97$ (diffuse light comes from all angles, averages out).

### 4.4 Cell Temperature Model

Panel efficiency drops as temperature rises (typically -0.35% to -0.45% per °C above 25°C for crystalline silicon).

Use the **Faiman model** for cell temperature:

$$T_{\text{cell}} = T_{\text{air}} + \frac{POA}{U_0 + U_1 \cdot v_{\text{wind}}}$$

Where:
- $T_{\text{air}}$ = ambient temperature (°C) — from weather data
- $POA$ = plane of array irradiance (W/m²)
- $v_{\text{wind}}$ = wind speed (m/s) — from weather data
- $U_0 = 25.0$ W/(m²·K), $U_1 = 6.84$ W/(m²·K)/(m/s) — default coefficients for glass/glass modules on open rack

**Temperature correction factor:**
$$f_{\text{temp}} = 1 + \gamma \cdot (T_{\text{cell}} - 25)$$

Where $\gamma \approx -0.004$ per °C (i.e., -0.4%/°C) — this is the panel's temperature coefficient of power, available from the panel datasheet.

### 4.5 DC Power Output (Clean)

$$P_{\text{DC,clean}}(t) = \frac{POA_{\text{effective}}(t)}{1000} \times P_{\text{STC}} \times f_{\text{temp}}(t)$$

Where:
- $P_{\text{STC}}$ = system rated capacity in watts at Standard Test Conditions (1000 W/m², 25°C)
- Division by 1000 normalizes irradiance to STC conditions

### 4.6 System Losses (Constants)

Apply fixed loss factors that don't change day to day:

$$P_{\text{clean}}(t) = P_{\text{DC,clean}}(t) \times \eta_{\text{inv}} \times (1 - L_{\text{wiring}}) \times (1 - L_{\text{mismatch}}) \times (1 - L_{\text{degradation}})$$

Where:
- $\eta_{\text{inv}} \approx 0.96$ — inverter efficiency (can use manufacturer's efficiency curve if available)
- $L_{\text{wiring}} \approx 0.02$ — DC wiring losses (2%)
- $L_{\text{mismatch}} \approx 0.02$ — module mismatch losses (2%)
- $L_{\text{degradation}} = 0.005 \times \text{years\_since\_install}$ — linear degradation (~0.5%/year)

### 4.7 The Critical Improvement: Satellite Irradiance Instead of Clear-Sky

The clear-sky model assumes **no clouds**. On cloudy days, $P_{\text{clean}}$ will be much higher than what's possible → the Performance Index will be artificially low → you'll think there's more soiling than there is.

**Solution**: Use **satellite-derived irradiance** instead of the clear-sky model for the actual sky conditions. This captures clouds, haze, and atmospheric conditions.

**Free data sources:**
- **Open-Meteo Solar API** — hourly GHI, DNI, DHI from satellite (global coverage, free, API access)
- **PVGIS** (EU Joint Research Centre) — historical hourly irradiance (global, free)
- **Solcast** — 15-min resolution satellite irradiance (free tier: 10 API calls/day; paid for production use)

**If you use satellite irradiance**: Replace Steps 4.2-4.3 with measured GHI/DNI/DHI from the satellite source, then still apply transposition and AOI corrections. This dramatically improves accuracy on partly cloudy days.

**If you only use clear-sky model**: You MUST aggressively filter out cloudy periods (see Phase 4 below). Your soiling estimate will only be valid on clear/mostly-clear days.

---

## 5. Phase 3 — Performance Index Calculation

### 5.1 Raw 15-Minute Performance Index

For each 15-minute interval where $P_{\text{clean}}(t) > 0$:

$$PI(t) = \frac{P_{\text{actual}}(t)}{P_{\text{clean}}(t)}$$

**Interpretation:**
- $PI = 1.0$ → system performing at expected clean level
- $PI = 0.95$ → 5% loss (likely soiling)
- $PI > 1.0$ → model underestimates (possible if irradiance model is conservative, or enhanced irradiance from cloud edges)
- $PI \ll 1.0$ → shading, cloud, snow, or equipment issue

### 5.2 Important: Initial Calibration

The physics model won't be perfect out of the box. There will be a **systematic bias** — the model might consistently predict 3% more or less than reality even when panels are clean.

**Calibration procedure:**
1. Identify a period when panels are known to be clean (right after installation, or right after a documented cleaning, or right after heavy rain)
2. Compute PI for those days
3. The median PI on clean days = your **calibration factor** $C$:
   $$C = \text{median}(PI_{\text{clean days}})$$
4. Adjusted PI: $PI_{\text{adj}}(t) = PI(t) / C$

Now $PI_{\text{adj}} = 1.0$ truly means clean, and deviations represent real soiling.

**If no clean reference period is available**: Use the maximum PI observed over a rolling 30-day window as the reference. After rain events, PI typically recovers close to the clean baseline.

---

## 6. Phase 4 — Quality Filtering (Critical for Residential)

This is where residential systems need extra care. Small systems are noisy, and you need to aggressively filter bad data.

### 6.1 Solar Elevation Filter
- **Discard** all intervals where solar elevation $\alpha_s < 15°$
- At low sun angles: atmospheric effects are extreme, AOI losses dominate, and any shading is amplified
- This typically removes the first ~1 hour after sunrise and last ~1 hour before sunset

### 6.2 Minimum Power Filter
- **Discard** intervals where $P_{\text{actual}}(t) < 0.1 \times P_{\text{STC}}$
- Very low production periods are dominated by noise and inverter startup effects

### 6.3 Clear-Sky Index Filter (Only if Using Clear-Sky Model)

If you're NOT using satellite irradiance, you need to identify and exclude cloudy periods:

$$k_t(t) = \frac{GHI_{\text{measured or proxy}}(t)}{GHI_{\text{clear sky}}(t)}$$

- $k_t > 0.9$ → very clear sky → **keep** (best data for soiling estimation)
- $0.7 < k_t < 0.9$ → partly cloudy → **keep with caution**
- $k_t < 0.7$ → cloudy → **discard**

**How to compute $k_t$ without a pyranometer**: Use the production data itself as a proxy. If $PI(t) > 0.85$ and the production profile is smooth (no rapid fluctuations), the sky is likely clear. More precisely: compute the **variability index** — the standard deviation of 15-min PI changes within a 1-hour window. Low variability = clear sky.

$$VI(t) = \text{std}\left(\frac{\Delta PI}{\Delta t}\right)_{\text{1-hour window around } t}$$

If $VI < 0.05$ → clear conditions → keep.

### 6.4 Shading Detection and Exclusion

For residential rooftops, nearby trees and structures create **repeating shading patterns** that depend on sun position.

**Detection method:**
1. Build a 2D lookup table: $\text{ShadeMap}(\alpha_s, \gamma_s)$ — a map of expected PI as a function of solar elevation and azimuth
2. Population: Using data from the first 2-4 weeks (ideally after installation when panels are clean), bin PI values by (elevation, azimuth) buckets
3. Any (elevation, azimuth) bucket where median PI drops below a threshold (e.g., < 0.85 when most buckets are > 0.95) is likely affected by shading
4. **Mark these time windows** and exclude them from soiling calculation in all future days

**Simpler alternative**: Use a fixed **time window** for soiling calculation. For example, only use data from 10:00 AM to 2:00 PM local solar time, when the sun is high and shading from objects at the horizon is minimal.

### 6.5 Snow Detection
- If $T_{\text{air}} < 2°C$ AND $PI < 0.3$ for the entire day → likely snow coverage → exclude
- If $PI$ drops to near-zero suddenly (within one 15-min interval) on a cold day → snow event

### 6.6 Outlier Removal
- Within a day's filtered PI values, remove values outside $[\text{median} - 2\sigma, \text{median} + 2\sigma]$
- This catches transient anomalies (bird shadows, brief equipment issues)

---

## 7. Phase 5 — Daily Soiling Ratio Estimation

### 7.1 Computing Daily Soiling Ratio

After all filtering, you have a set of "good" PI values for each day. The daily soiling ratio:

$$SR(d) = \text{median}\left(\{PI_{\text{adj}}(t) : t \in \text{filtered intervals of day } d\}\right)$$

**Why median, not mean**: The median is robust to remaining outliers (a single shading event or brief cloud that passed through filters).

**Minimum data requirement**: If fewer than 8 good 15-minute intervals survive filtering for a day (i.e., less than 2 hours of clean data), mark the day as **unreliable** and interpolate from neighboring days.

### 7.2 Smoothing the Soiling Time Series

Raw daily SR values will be noisy. Apply light smoothing:

**Method**: **Weighted moving median** with a 3-day window:

$$SR_{\text{smooth}}(d) = \text{weighted\_median}(SR(d-1), SR(d), SR(d+1), \text{weights} = [0.25, 0.5, 0.25])$$

**Important constraint**: Soiling can only get worse (decrease) over dry days. If $SR_{\text{smooth}}(d) > SR_{\text{smooth}}(d-1)$ and there was no rain on day $d$ or $d-1$:
- Either it's noise → keep the lower value (soiling doesn't clean itself)
- Or there was an undetected cleaning/rain → investigate

**Exception**: After rain, SR is allowed to increase (recovery).

### 7.3 Rain Recovery Detection

Rain washes away some or all dirt. Detect rain recovery events:

1. **Get precipitation data**: Use Open-Meteo API → daily precipitation (mm) for your location
2. **Rain threshold**: $\text{rain}(d) > 0.5 \text{ mm}$ → likely cleaning effect
3. **Heavy rain threshold**: $\text{rain}(d) > 5 \text{ mm}$ → likely full clean

**After rain**: Allow SR to jump up (recovery). The amount of recovery depends on rain intensity:
- Light rain (0.5-2 mm): Partial recovery (~30-50% of accumulated soiling removed)
- Moderate rain (2-5 mm): Significant recovery (~50-80%)
- Heavy rain (>5 mm): Near-full recovery (~80-100%)

These recovery fractions vary by location and panel tilt. **Learn them from your data**: After each rain event, observe how much SR recovers. Over time, build a lookup: $\text{recovery\_fraction} = f(\text{rain\_mm}, \text{tilt})$.

---

## 8. Phase 6 — Daily Soiling Loss Calculation

### 8.1 Daily Energy Loss

$$E_{\text{lost}}(d) = E_{\text{clean}}(d) \times (1 - SR(d))$$

Where:
$$E_{\text{clean}}(d) = \sum_{t \in \text{day } d} P_{\text{clean}}(t) \times \Delta t$$

With $\Delta t = 0.25$ hours (15-minute intervals).

**Example**: If $E_{\text{clean}} = 80$ kWh and $SR = 0.94$:
$$E_{\text{lost}} = 80 \times (1 - 0.94) = 80 \times 0.06 = 4.8 \text{ kWh}$$

### 8.2 Monetary Loss

$$\text{Money\_lost}(d) = E_{\text{lost}}(d) \times \text{price\_per\_kWh}$$

### 8.3 Cumulative Loss Since Last Cleaning

$$\text{Cumulative\_loss}(d) = \sum_{d'=d_{\text{last\_clean}}}^{d} \text{Money\_lost}(d')$$

Where $d_{\text{last\_clean}}$ is the date of the last cleaning event (or the last heavy rain that achieved near-full recovery).

---

## 9. Phase 7 — Cleaning ROI Decision

### 9.1 Simple Threshold Rule

**Trigger cleaning when**: $\text{Cumulative\_loss} > \text{Cleaning\_cost}$

This means you've already lost more to dirt than cleaning would cost → cleaning is overdue.

### 9.2 Forward-Looking Optimal Rule (Better)

The simple threshold is reactive — you've already wasted money. A better approach is to **predict** when to clean.

**Estimated daily soiling loss rate** (monetary):

$$r = \text{median soiling rate (fraction/day)} \times E_{\text{clean,avg}} \times \text{price\_per\_kWh}$$

Where:
- Median soiling rate comes from historical data — the typical %/day loss during dry periods for this location/system
- $E_{\text{clean,avg}}$ = average daily expected production for the current season

**Days until rain** (probabilistic):
- From weather forecast, estimate the probability of rain in the next $N$ days
- If rain is expected soon, it may clean the panels for free → postpone cleaning

**Optimal cleaning trigger:**

Clean when the **expected future loss** exceeds the cleaning cost, accounting for rain probability:

$$\sum_{d'=d+1}^{d+T} r(d') \times P(\text{no rain by day } d') > \text{Cleaning\_cost}$$

Where $T$ is the planning horizon (e.g., 30 days).

**Simplified version**: Clean when:
$$\text{Cumulative\_loss} + r \times \min(T, \text{days\_until\_next\_rain\_forecast}) > \text{Cleaning\_cost}$$

### 9.3 Output to User

For each day, provide:
```
{
    date: "2026-03-21",
    soiling_ratio: 0.94,           # 94% of clean performance
    soiling_loss_pct: 6.0,         # 6% production lost to dirt
    energy_lost_kwh: 4.8,          # kWh lost today
    money_lost_today: 1.44,        # $ lost today (at $0.30/kWh)
    cumulative_loss_since_clean: 18.50,  # $ total lost since last clean
    cleaning_cost: 150.00,
    recommendation: "NOT_YET",     # or "CLEAN_NOW" or "RAIN_EXPECTED"
    days_until_cleaning_roi: 22,   # estimated days until cleaning pays for itself
    confidence: "HIGH"             # or "MEDIUM" or "LOW" based on data quality
}
```

---

## 10. Handling Edge Cases & Accuracy Considerations

### 10.1 Accuracy Expectations

Be honest about what's achievable:

| Condition | Expected Accuracy |
|---|---|
| Clear day, no shading, with satellite irradiance | ±1% soiling ratio |
| Clear day, no shading, clear-sky model only | ±2-3% soiling ratio |
| Partly cloudy day, with satellite irradiance | ±2-3% soiling ratio |
| Partly cloudy day, clear-sky model only | ±5-10% (poor) — filter these out |
| System with significant shading | ±3-5% after shading model calibration |

For cleaning ROI, ±2% accuracy on the soiling ratio is typically sufficient. At 6% actual soiling, estimating 4-8% still gives a reasonable economic decision.

### 10.2 The "Chicken-and-Egg" Problem

To calibrate the model, you need clean panels. To know when panels are clean, you need the model.

**Bootstrap approach:**
1. **Assume** panels are clean after heavy rain events (>5mm)
2. Compute initial calibration factor $C$ from post-rain days
3. Run the model for the entire historical period
4. **Iterate**: Use the model to identify truly clean days (SR > 0.98), recalibrate, re-run
5. Converges in 2-3 iterations

### 10.3 New System Without History

For a newly installed system (no history):
1. First 2-4 weeks: panels are clean (new glass) → use this period for calibration
2. During this period, establish the shading profile
3. Start soiling estimation from week 3-4 onward

### 10.4 Inverter Clipping

If the inverter is undersized relative to the panel array (common in residential), the inverter clips the output during peak hours.

**Detection**: If $PI(t) < 1.0$ consistently during midday on clear days, but $P_{\text{actual}}$ is flat at a ceiling value → inverter clipping.

**Solution**: Exclude intervals where $P_{\text{actual}}$ is within 2% of the inverter's rated AC capacity. These intervals provide no soiling information.

### 10.5 Seasonal Considerations

Soiling rates vary by season:
- **Summer (dry)**: Fastest soiling accumulation, especially in arid climates
- **Winter (wet)**: Frequent rain keeps panels relatively clean
- **Spring**: Pollen can cause rapid soiling spikes
- **Dusty events**: Saharan dust in Mediterranean regions, wildfire smoke, construction nearby

The model handles this naturally — it measures actual soiling, not predicted soiling. But for the **forward-looking ROI calculation** (Section 9.2), use season-specific soiling rates.

---

## 11. Data Flow & Implementation Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                    DAILY PROCESSING PIPELINE                     │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│  INPUTS (per day):                                               │
│  ├── Production data: P_actual(t) every 15 min                   │
│  ├── Weather data (API): T_air, wind_speed, precipitation        │
│  └── Irradiance (API or model): GHI, DNI, DHI                   │
│                                                                  │
│  STEP 1: Solar Position                                          │
│  └── (lat, lon, timestamps) → zenith, azimuth, elevation         │
│                                                                  │
│  STEP 2: Expected Clean Power                                    │
│  ├── Irradiance → POA transposition (Perez model)                │
│  ├── AOI → IAM correction                                        │
│  ├── T_air, wind, POA → T_cell → temperature correction          │
│  └── × system_losses → P_clean(t)                                │
│                                                                  │
│  STEP 3: Raw Performance Index                                   │
│  └── PI(t) = P_actual(t) / P_clean(t)                           │
│                                                                  │
│  STEP 4: Quality Filtering                                       │
│  ├── Remove: elevation < 15°                                     │
│  ├── Remove: P_actual < 10% of capacity                          │
│  ├── Remove: cloudy periods (variability index > 0.05)           │
│  ├── Remove: known shading windows (from ShadeMap)               │
│  ├── Remove: inverter clipping periods                           │
│  └── Remove: statistical outliers (> 2σ from median)             │
│                                                                  │
│  STEP 5: Daily Soiling Ratio                                     │
│  ├── SR(d) = median(filtered PI values) / calibration_factor     │
│  ├── Smooth with 3-day weighted median                           │
│  └── Enforce monotonic decrease between rain events              │
│                                                                  │
│  STEP 6: Loss Calculation                                        │
│  ├── E_lost(d) = E_clean(d) × (1 - SR(d))                       │
│  ├── Money_lost(d) = E_lost(d) × price/kWh                      │
│  └── Cumulative_loss += Money_lost(d)                            │
│                                                                  │
│  STEP 7: Cleaning Recommendation                                 │
│  ├── Get weather forecast (next 7 days rain probability)         │
│  ├── Compute days_to_ROI at current soiling rate                 │
│  └── Emit recommendation: CLEAN_NOW / NOT_YET / RAIN_EXPECTED   │
│                                                                  │
│  OUTPUT: daily soiling report (JSON)                             │
└──────────────────────────────────────────────────────────────────┘
```

---

## 12. Key Libraries for Implementation

| Component | Library | Notes |
|---|---|---|
| Solar position | `pvlib.solarposition` | NREL SPA algorithm |
| Clear-sky irradiance | `pvlib.clearsky` (Ineichen) | If not using satellite data |
| POA transposition | `pvlib.irradiance.get_total_irradiance` | Perez model |
| AOI / IAM | `pvlib.iam.physical` | Glass refraction model |
| Cell temperature | `pvlib.temperature.faiman` | Or SAPM model |
| PV power model | `pvlib.pvsystem` | Single-diode or PVWatts |
| Weather data | `openmeteo_requests` or `requests` | Open-Meteo API (free) |
| Satellite irradiance | Solcast API or PVGIS | Higher accuracy than clear-sky |
| SRR soiling | `pvlib.soiling.soiling_srr` | Optional — for soiling rate analysis |
| Data processing | `pandas`, `numpy` | Core data handling |

---

## 13. Validation Strategy

### 13.1 Synthetic Validation
1. Generate synthetic production data using pvlib (known soiling profile injected)
2. Run your algorithm on the synthetic data
3. Compare estimated soiling to the known injected soiling
4. Target: < 1% absolute error on clear days

### 13.2 Rain-Event Validation
1. After heavy rain, SR should jump back to ~1.0 (or close to calibration baseline)
2. If SR after rain is consistently 0.90 or 1.10, your calibration is off
3. Track post-rain SR over time — it should be stable (within ±2%)

### 13.3 Cross-System Validation (If You Have Multiple Systems)
1. For systems in the same geographic area, soiling rates should be similar
2. Large deviations indicate a system-specific issue (not soiling) or model problem

### 13.4 Before/After Cleaning Validation
If you can get data from a system that was manually cleaned on a known date:
1. SR should be low before cleaning
2. SR should jump to ~1.0 after cleaning
3. The difference = your estimated soiling loss, which can be compared to the actual production increase observed

---

## 14. Summary: What to Hand to the Coding Agent

**File structure:**
```
soiling_estimator/
├── config.py              # System configuration, API keys
├── solar_model.py         # Phase 2: P_clean(t) calculation
├── irradiance.py          # Irradiance fetching (API or clear-sky)
├── weather.py             # Weather data fetching (Open-Meteo)
├── performance_index.py   # Phase 3: PI calculation
├── filters.py             # Phase 4: Quality filtering
├── soiling.py             # Phase 5: Daily SR estimation
├── loss_calculator.py     # Phase 6: Energy & monetary loss
├── cleaning_roi.py        # Phase 7: Cleaning recommendation
├── calibration.py         # Calibration & bootstrap procedures
├── main.py                # Daily pipeline orchestrator
└── tests/
    ├── test_synthetic.py  # Synthetic data validation
    └── test_rain.py       # Rain recovery validation
```

**Processing order per day:**
1. Fetch weather + irradiance data for the day
2. Compute solar positions for all 15-min timestamps
3. Compute $P_{\text{clean}}(t)$ for all timestamps
4. Compute raw $PI(t)$
5. Apply all quality filters
6. Compute daily $SR(d)$
7. Compute losses and update cumulative tracking
8. Evaluate cleaning recommendation
9. Store results and emit daily report
