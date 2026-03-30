# Brief: Design a Solar Panel Monitoring Dashboard

## You are
A senior product designer and web developer. Your job is to design AND BUILD
a standalone HTML dashboard for residential solar panel owners. Think of it
like a "health report" for solar panels — clear, visual, actionable, zero
jargon. You will produce a single working HTML file with real charts using
the sample data provided.

## The system
A 15.84 kWp rooftop solar installation in the Negev desert (Israel).
We have 6 years of historical data (Feb 2020 – Mar 2026).
The dashboard is a static HTML file generated from pre-computed data — no
backend, no login, just open in a browser.

---

## PROCESSED DATA AVAILABLE

All data below is the **output of our analysis pipeline** — already cleaned,
classified, and enriched. The dashboard consumer never sees raw sensor readings
or model internals. Everything is pre-computed and ready to display.

### 1. Daily production analysis
Each day has a computed summary:
- **actual_kwh** — what the panels actually produced
- **est_clean_kwh** — what the panels SHOULD have produced if perfectly clean
  (computed by the system using physics-based modeling, already calibrated)
- **loss_pct** — percentage of production lost to dirt
- **lost_kwh** — energy lost to dirt in kWh (= est_clean_kwh × loss_pct)
- All monetary values are pre-computed at ₪0.48/kWh

### 2. Panel cleanliness (soiling analysis)
- **soiling_ratio** per day: 1.0 = perfectly clean, 0.90 = 10% dirty
- **Cleaning events**: dates + cause (Heavy Rain / Rain / Manual Clean) +
  recovery magnitude (how much cleanliness improved)
- **Soiling rate**: how fast panels are getting dirty (pre-computed trend)
- **Optimal cleaning interval**: already computed (days between cleanings that
  minimizes total cost of dirt losses + cleaning fees)
- **Break-even estimate**: days until accumulated dirt losses exceed cleaning cost

### 3. Weather classification
Each day is classified by the system:
- **classification**: clear / partial / cloudy (based on curve-shape analysis)
- **rain_mm**: daily precipitation (used to explain cleaning events and
  seasonal patterns — NOT raw weather data, but the processed daily total)
- **Dry spell detection**: periods of 14+ consecutive days without significant
  rain, correlated with accelerated soiling

### 4. Seasonal production envelope
- A pre-computed smooth curve showing expected clean production for each
  calendar day — captures the natural seasonal cycle (short winter days vs
  long summer days)
- Used to contextualize daily performance: "today you produced 67 kWh, which
  is 92% of what a clean system would produce on a March day"

### 5. Monthly summaries (pre-aggregated)
For each month, the system provides:
- Average daily production, total production
- Total energy lost to dirt, total rainfall
- Average cleanliness percentage, number of clear days
- Number of cleaning events

---

## INSIGHTS AVAILABLE FROM THIS DATA (use any of these)

All of these can be derived from the processed fields above — no raw data
access needed. Pick the ones that matter for each persona.

### System health & performance
- **Current cleanliness** — the headline number (e.g., 93% = "Good")
- **Production vs expected** — how much of its potential the system is achieving
- **Best day/month/year** — personal records for the system
- **Year-over-year trend** — is the system degrading beyond normal aging?
- **Capacity utilization** — actual output as % of rated 15.84 kWp

### Weather & seasons
- **Sunny days this month** vs historical average
- **Dry spell tracker** — consecutive rainless days and their effect on panels
- **Rain effectiveness** — which rains actually cleaned panels vs just got
  them wet (cleaning events include cause classification)
- **Seasonal weather calendar** — month-by-month sunny/cloudy/rainy breakdown

### Money & cleaning ROI
- **Total lifetime production** in kWh and ₪
- **Monthly savings** from solar at ₪0.48/kWh
- **Money lost to dirt** — lifetime, this year, this month, since last cleaning
- **Cleaning ROI** — cost to clean (₪350) vs money recovered
- **Break-even countdown** — days until dirt losses exceed cleaning cost
- **Optimal cleaning schedule** — computed interval that minimizes total cost
- **What-if scenarios** — "if you never cleaned" vs "if you cleaned monthly"

### Trends & comparisons
- **This month vs same month last year** (production, cleanliness, weather)
- **Seasonal production patterns** — what to expect next month based on history
- **Personal records** — highest production day, month, year
- **Daily context** — "today was better than 73% of similar calendar days"

### Alerts & anomalies
- **Unusual production drops** not explained by weather — possible equipment issue
- **Accelerated degradation** — year-over-year drop exceeding normal ~0.5%/yr
- **Extended dirty periods** — panels below threshold for too long without rain

---

## AGGREGATE STATS (for context)

```
Date range:         2020-02-02 to 2026-03-24 (2,243 days, ~6.1 years)
System size:        15.84 kWp
Location:           Kramit, Negev, Israel (31.33°N 34.90°E, 350m altitude)
Currency:           Israeli Shekel (₪), electricity rate ₪0.48/kWh
Cleaning cost:      ₪350 per cleaning

Clear days:         1,017 (45%)
Partial days:         910 (41%)
Cloudy days:          316 (14%)

Avg daily production: 66.7 kWh
Best day ever:       109.1 kWh (2022-06-20)
Total production:    149,686 kWh (₪71,849)
Total lost to dirt:   16,882 kWh (₪8,103)

Current cleanliness: 93.1%
Worst ever:          61.1% (2023-10-27)
Cleaning events:     27 (all rain-triggered so far)
Rainy days:          375 (>0.5mm)
Total rainfall:      1,658 mm

Recent 12-month summary:
2025-04: 72.6 kWh/d,  2,178 kWh total, lost  379 kWh, rain  12mm, 85.3% clean,  9 clear days
2025-05: 83.9 kWh/d,  2,601 kWh total, lost  548 kWh, rain  13mm, 82.6% clean, 17 clear days
2025-06: 96.0 kWh/d,  2,879 kWh total, lost  284 kWh, rain   1mm, 91.1% clean, 25 clear days
2025-07: 94.1 kWh/d,  2,918 kWh total, lost  121 kWh, rain   0mm, 96.0% clean, 27 clear days
2025-08: 78.2 kWh/d,  2,423 kWh total, lost  293 kWh, rain   2mm, 89.2% clean, 18 clear days
2025-09: 65.6 kWh/d,  1,969 kWh total, lost  454 kWh, rain   2mm, 81.2% clean, 18 clear days
2025-10: 47.9 kWh/d,  1,486 kWh total, lost  563 kWh, rain   2mm, 72.4% clean, 19 clear days
2025-11: 41.8 kWh/d,  1,253 kWh total, lost  151 kWh, rain  19mm, 89.8% clean,  7 clear days
2025-12: 40.5 kWh/d,  1,255 kWh total, lost    8 kWh, rain  90mm, 99.3% clean,  4 clear days
2026-01: 42.5 kWh/d,  1,319 kWh total, lost   82 kWh, rain  67mm, 94.3% clean,  4 clear days
2026-02: 54.5 kWh/d,  1,525 kWh total, lost  152 kWh, rain  21mm, 91.0% clean,  3 clear days
2026-03: 64.7 kWh/d,  1,552 kWh total, lost   91 kWh, rain  63mm, 94.3% clean,  5 clear days
```

---

## SAMPLE DATA (processed analysis output)

Use this data to build working prototype charts. This is real **processed**
output from the analysis pipeline — embed it directly as JavaScript variables
in your HTML. Every field is already computed and ready to display.

### Daily analysis records (48 representative days)

These cover: clean periods, dirty periods, cleaning events, rainy days, and
recent data. Each record is a fully processed daily summary.

```json
[
  {"date":"2020-02-05","soiling_ratio":0.9933,"loss_pct":0.67,"lost_kwh":0.46,"actual_kwh":68.26,"est_clean_kwh":68.79,"rain_mm":0.0,"classification":"clear","cleaning":false,"event_type":""},
  {"date":"2020-02-08","soiling_ratio":0.977,"loss_pct":2.3,"lost_kwh":0.41,"actual_kwh":17.45,"est_clean_kwh":71.69,"rain_mm":6.8,"classification":"cloudy","cleaning":false,"event_type":""},
  {"date":"2020-02-09","soiling_ratio":0.9856,"loss_pct":1.44,"lost_kwh":0.43,"actual_kwh":29.72,"est_clean_kwh":72.13,"rain_mm":9.0,"classification":"cloudy","cleaning":false,"event_type":""},
  {"date":"2020-02-16","soiling_ratio":0.9735,"loss_pct":2.65,"lost_kwh":1.19,"actual_kwh":43.78,"est_clean_kwh":75.19,"rain_mm":6.8,"classification":"cloudy","cleaning":false,"event_type":""},
  {"date":"2020-02-19","soiling_ratio":0.9954,"loss_pct":0.46,"lost_kwh":0.13,"actual_kwh":28.06,"est_clean_kwh":78.34,"rain_mm":15.1,"classification":"cloudy","cleaning":false,"event_type":""},
  {"date":"2020-02-25","soiling_ratio":1.0131,"loss_pct":0.0,"lost_kwh":0.0,"actual_kwh":49.24,"est_clean_kwh":83.11,"rain_mm":7.4,"classification":"partial","cleaning":false,"event_type":""},
  {"date":"2020-02-28","soiling_ratio":1.0131,"loss_pct":0.0,"lost_kwh":0.0,"actual_kwh":82.11,"est_clean_kwh":83.9,"rain_mm":0.0,"classification":"clear","cleaning":false,"event_type":""},
  {"date":"2020-03-03","soiling_ratio":1.0092,"loss_pct":0.0,"lost_kwh":0.0,"actual_kwh":84.96,"est_clean_kwh":86.65,"rain_mm":0.0,"classification":"clear","cleaning":false,"event_type":""},
  {"date":"2020-03-04","soiling_ratio":1.0092,"loss_pct":0.0,"lost_kwh":0.0,"actual_kwh":86.33,"est_clean_kwh":86.69,"rain_mm":0.0,"classification":"clear","cleaning":false,"event_type":""},
  {"date":"2020-03-08","soiling_ratio":1.0118,"loss_pct":0.0,"lost_kwh":0.0,"actual_kwh":87.46,"est_clean_kwh":89.43,"rain_mm":0.0,"classification":"clear","cleaning":false,"event_type":""},
  {"date":"2020-03-23","soiling_ratio":0.9876,"loss_pct":1.24,"lost_kwh":1.14,"actual_kwh":90.08,"est_clean_kwh":92.53,"rain_mm":0.3,"classification":"clear","cleaning":false,"event_type":""},
  {"date":"2020-03-24","soiling_ratio":0.9871,"loss_pct":1.29,"lost_kwh":1.21,"actual_kwh":92.36,"est_clean_kwh":94.8,"rain_mm":0.0,"classification":"clear","cleaning":false,"event_type":""},
  {"date":"2022-12-17","soiling_ratio":0.8821,"loss_pct":11.79,"lost_kwh":5.7,"actual_kwh":42.63,"est_clean_kwh":43.16,"rain_mm":0.0,"classification":"clear","cleaning":false,"event_type":""},
  {"date":"2022-12-18","soiling_ratio":0.8842,"loss_pct":11.58,"lost_kwh":5.78,"actual_kwh":44.09,"est_clean_kwh":44.96,"rain_mm":0.0,"classification":"clear","cleaning":false,"event_type":""},
  {"date":"2022-12-19","soiling_ratio":0.8842,"loss_pct":11.58,"lost_kwh":5.56,"actual_kwh":42.46,"est_clean_kwh":43.29,"rain_mm":0.0,"classification":"clear","cleaning":false,"event_type":""},
  {"date":"2022-12-20","soiling_ratio":0.8842,"loss_pct":11.58,"lost_kwh":5.39,"actual_kwh":41.12,"est_clean_kwh":44.82,"rain_mm":0.0,"classification":"partial","cleaning":false,"event_type":""},
  {"date":"2022-12-21","soiling_ratio":0.8859,"loss_pct":11.41,"lost_kwh":4.34,"actual_kwh":33.7,"est_clean_kwh":44.76,"rain_mm":6.4,"classification":"partial","cleaning":false,"event_type":""},
  {"date":"2022-12-22","soiling_ratio":0.8876,"loss_pct":11.24,"lost_kwh":6.5,"actual_kwh":51.33,"est_clean_kwh":53.12,"rain_mm":0.0,"classification":"clear","cleaning":false,"event_type":""},
  {"date":"2022-12-23","soiling_ratio":0.9188,"loss_pct":8.12,"lost_kwh":3.67,"actual_kwh":41.55,"est_clean_kwh":48.39,"rain_mm":1.6,"classification":"partial","cleaning":false,"event_type":""},
  {"date":"2022-12-24","soiling_ratio":0.9951,"loss_pct":0.49,"lost_kwh":0.1,"actual_kwh":19.4,"est_clean_kwh":52.05,"rain_mm":6.1,"classification":"cloudy","cleaning":true,"event_type":"Heavy Rain"},
  {"date":"2022-12-25","soiling_ratio":0.9951,"loss_pct":0.49,"lost_kwh":0.17,"actual_kwh":33.6,"est_clean_kwh":52.03,"rain_mm":2.6,"classification":"cloudy","cleaning":false,"event_type":""},
  {"date":"2022-12-26","soiling_ratio":0.9951,"loss_pct":0.49,"lost_kwh":0.04,"actual_kwh":9.02,"est_clean_kwh":52.14,"rain_mm":9.2,"classification":"cloudy","cleaning":false,"event_type":""},
  {"date":"2022-12-27","soiling_ratio":1.0095,"loss_pct":0.0,"lost_kwh":0.0,"actual_kwh":42.24,"est_clean_kwh":52.26,"rain_mm":1.0,"classification":"partial","cleaning":false,"event_type":""},
  {"date":"2022-12-28","soiling_ratio":0.9951,"loss_pct":0.49,"lost_kwh":0.2,"actual_kwh":41.42,"est_clean_kwh":52.27,"rain_mm":0.1,"classification":"cloudy","cleaning":false,"event_type":""},
  {"date":"2022-12-29","soiling_ratio":0.9951,"loss_pct":0.49,"lost_kwh":0.25,"actual_kwh":51.28,"est_clean_kwh":52.54,"rain_mm":0.0,"classification":"clear","cleaning":false,"event_type":""},
  {"date":"2022-12-30","soiling_ratio":0.9951,"loss_pct":0.0,"lost_kwh":0.0,"actual_kwh":53.32,"est_clean_kwh":54.5,"rain_mm":0.0,"classification":"clear","cleaning":false,"event_type":""},
  {"date":"2022-12-31","soiling_ratio":0.978,"loss_pct":2.2,"lost_kwh":1.16,"actual_kwh":51.56,"est_clean_kwh":52.13,"rain_mm":0.0,"classification":"clear","cleaning":false,"event_type":""},
  {"date":"2023-10-24","soiling_ratio":0.615,"loss_pct":38.5,"lost_kwh":24.49,"actual_kwh":39.12,"est_clean_kwh":41.55,"rain_mm":0.1,"classification":"partial","cleaning":false,"event_type":""},
  {"date":"2023-10-25","soiling_ratio":0.6138,"loss_pct":38.62,"lost_kwh":25.59,"actual_kwh":40.67,"est_clean_kwh":41.82,"rain_mm":0.0,"classification":"clear","cleaning":false,"event_type":""},
  {"date":"2023-10-26","soiling_ratio":0.6114,"loss_pct":38.86,"lost_kwh":25.48,"actual_kwh":40.09,"est_clean_kwh":41.22,"rain_mm":0.0,"classification":"clear","cleaning":false,"event_type":""},
  {"date":"2023-10-27","soiling_ratio":0.611,"loss_pct":38.9,"lost_kwh":26.49,"actual_kwh":41.58,"est_clean_kwh":44.01,"rain_mm":0.0,"classification":"partial","cleaning":false,"event_type":""},
  {"date":"2023-10-28","soiling_ratio":0.611,"loss_pct":38.9,"lost_kwh":7.61,"actual_kwh":11.94,"est_clean_kwh":44.13,"rain_mm":0.0,"classification":"cloudy","cleaning":false,"event_type":""},
  {"date":"2023-10-29","soiling_ratio":0.611,"loss_pct":38.9,"lost_kwh":6.12,"actual_kwh":9.61,"est_clean_kwh":44.27,"rain_mm":0.0,"classification":"cloudy","cleaning":false,"event_type":""},
  {"date":"2023-10-30","soiling_ratio":0.6218,"loss_pct":37.82,"lost_kwh":22.29,"actual_kwh":36.66,"est_clean_kwh":44.34,"rain_mm":0.5,"classification":"partial","cleaning":false,"event_type":""},
  {"date":"2026-03-11","soiling_ratio":0.9454,"loss_pct":5.46,"lost_kwh":4.08,"actual_kwh":70.69,"est_clean_kwh":71.71,"rain_mm":0.0,"classification":"clear","cleaning":false,"event_type":""},
  {"date":"2026-03-12","soiling_ratio":0.9454,"loss_pct":5.46,"lost_kwh":1.87,"actual_kwh":32.46,"est_clean_kwh":73.28,"rain_mm":0.6,"classification":"cloudy","cleaning":false,"event_type":""},
  {"date":"2026-03-13","soiling_ratio":0.9454,"loss_pct":5.46,"lost_kwh":4.22,"actual_kwh":73.1,"est_clean_kwh":76.05,"rain_mm":0.0,"classification":"clear","cleaning":false,"event_type":""},
  {"date":"2026-03-14","soiling_ratio":0.9454,"loss_pct":5.46,"lost_kwh":4.45,"actual_kwh":77.2,"est_clean_kwh":76.85,"rain_mm":0.0,"classification":"clear","cleaning":false,"event_type":""},
  {"date":"2026-03-15","soiling_ratio":0.9454,"loss_pct":5.46,"lost_kwh":4.13,"actual_kwh":71.56,"est_clean_kwh":79.6,"rain_mm":0.0,"classification":"partial","cleaning":false,"event_type":""},
  {"date":"2026-03-16","soiling_ratio":0.9381,"loss_pct":6.19,"lost_kwh":4.82,"actual_kwh":73.0,"est_clean_kwh":81.4,"rain_mm":0.0,"classification":"partial","cleaning":false,"event_type":""},
  {"date":"2026-03-17","soiling_ratio":0.9308,"loss_pct":6.92,"lost_kwh":0.42,"actual_kwh":5.64,"est_clean_kwh":79.2,"rain_mm":20.1,"classification":"cloudy","cleaning":false,"event_type":""},
  {"date":"2026-03-18","soiling_ratio":0.9308,"loss_pct":6.92,"lost_kwh":1.38,"actual_kwh":18.59,"est_clean_kwh":79.83,"rain_mm":25.7,"classification":"cloudy","cleaning":false,"event_type":""},
  {"date":"2026-03-19","soiling_ratio":0.9308,"loss_pct":6.92,"lost_kwh":5.05,"actual_kwh":67.92,"est_clean_kwh":80.52,"rain_mm":0.0,"classification":"partial","cleaning":false,"event_type":""},
  {"date":"2026-03-20","soiling_ratio":0.9308,"loss_pct":6.92,"lost_kwh":0.33,"actual_kwh":4.48,"est_clean_kwh":79.35,"rain_mm":15.1,"classification":"cloudy","cleaning":false,"event_type":""},
  {"date":"2026-03-21","soiling_ratio":0.9308,"loss_pct":6.92,"lost_kwh":0.99,"actual_kwh":13.29,"est_clean_kwh":80.55,"rain_mm":1.7,"classification":"cloudy","cleaning":false,"event_type":""},
  {"date":"2026-03-22","soiling_ratio":0.9308,"loss_pct":6.92,"lost_kwh":5.45,"actual_kwh":73.29,"est_clean_kwh":82.37,"rain_mm":0.0,"classification":"partial","cleaning":false,"event_type":""},
  {"date":"2026-03-23","soiling_ratio":0.9308,"loss_pct":6.92,"lost_kwh":5.71,"actual_kwh":76.87,"est_clean_kwh":82.08,"rain_mm":0.0,"classification":"clear","cleaning":false,"event_type":""},
  {"date":"2026-03-24","soiling_ratio":0.9308,"loss_pct":6.92,"lost_kwh":5.77,"actual_kwh":77.63,"est_clean_kwh":82.93,"rain_mm":0.0,"classification":"clear","cleaning":false,"event_type":""}
]
```

### Intraday production shape: Perfect clear day (2025-05-16)

This is a pre-processed daily production curve — showing the smooth bell shape
of a clear day. Use for "today's production" or to illustrate what a healthy
day looks like. Only daylight hours have non-zero values.

```json
[
  {"time":"06:00","wh":9},{"time":"06:15","wh":51},{"time":"06:30","wh":107},
  {"time":"06:45","wh":199},{"time":"07:00","wh":356},{"time":"07:15","wh":523},
  {"time":"07:30","wh":706},{"time":"07:45","wh":877},{"time":"08:00","wh":1044},
  {"time":"08:15","wh":1208},{"time":"08:30","wh":1381},{"time":"08:45","wh":1554},
  {"time":"09:00","wh":1705},{"time":"09:15","wh":1875},{"time":"09:30","wh":2047},
  {"time":"09:45","wh":2208},{"time":"10:00","wh":2348},{"time":"10:15","wh":2424},
  {"time":"10:30","wh":2516},{"time":"10:45","wh":2626},{"time":"11:00","wh":2701},
  {"time":"11:15","wh":2743},{"time":"11:30","wh":2770},{"time":"11:45","wh":2808},
  {"time":"12:00","wh":2828},{"time":"12:15","wh":2845},{"time":"12:30","wh":2862},
  {"time":"12:45","wh":2864},{"time":"13:00","wh":2844},{"time":"13:15","wh":2819},
  {"time":"13:30","wh":2784},{"time":"13:45","wh":2702},{"time":"14:00","wh":2662},
  {"time":"14:15","wh":2605},{"time":"14:30","wh":2484},{"time":"14:45","wh":2390},
  {"time":"15:00","wh":2269},{"time":"15:15","wh":2184},{"time":"15:30","wh":2067},
  {"time":"15:45","wh":1914},{"time":"16:00","wh":1785},{"time":"16:15","wh":1633},
  {"time":"16:30","wh":1380},{"time":"16:45","wh":1255},{"time":"17:00","wh":1125},
  {"time":"17:15","wh":953},{"time":"17:30","wh":760},{"time":"17:45","wh":606},
  {"time":"18:00","wh":456},{"time":"18:15","wh":338},{"time":"18:30","wh":225},
  {"time":"18:45","wh":133},{"time":"19:00","wh":44}
]
```

### Intraday production shape: Cloudy day (2023-06-13)

Same system, same time of year — but clouds cause wild swings in production.
Use to contrast with the clear day above and illustrate why classification
matters.

```json
[
  {"time":"06:00","wh":44},{"time":"06:15","wh":98},{"time":"06:30","wh":160},
  {"time":"06:45","wh":236},{"time":"07:00","wh":335},{"time":"07:15","wh":453},
  {"time":"07:30","wh":602},{"time":"07:45","wh":769},{"time":"08:00","wh":945},
  {"time":"08:15","wh":1099},{"time":"08:30","wh":1271},{"time":"08:45","wh":1427},
  {"time":"09:00","wh":1574},{"time":"09:15","wh":1744},{"time":"09:30","wh":1676},
  {"time":"09:45","wh":1618},{"time":"10:00","wh":1278},{"time":"10:15","wh":1691},
  {"time":"10:30","wh":1098},{"time":"10:45","wh":931},{"time":"11:00","wh":879},
  {"time":"11:15","wh":1399},{"time":"11:30","wh":558},{"time":"11:45","wh":334},
  {"time":"12:00","wh":327},{"time":"12:15","wh":421},{"time":"12:30","wh":469},
  {"time":"12:45","wh":212},{"time":"13:00","wh":229},{"time":"13:15","wh":820},
  {"time":"13:30","wh":437},{"time":"13:45","wh":288},{"time":"14:00","wh":337},
  {"time":"14:15","wh":479},{"time":"14:30","wh":661},{"time":"14:45","wh":1589},
  {"time":"15:00","wh":1030},{"time":"15:15","wh":1326},{"time":"15:30","wh":1248},
  {"time":"15:45","wh":1049},{"time":"16:00","wh":528},{"time":"16:15","wh":595},
  {"time":"16:30","wh":883},{"time":"16:45","wh":863},{"time":"17:00","wh":1337},
  {"time":"17:15","wh":1094},{"time":"17:30","wh":1051},{"time":"17:45","wh":655},
  {"time":"18:00","wh":591},{"time":"18:15","wh":342},{"time":"18:30","wh":356},
  {"time":"18:45","wh":307},{"time":"19:00","wh":75}
]
```

### Day classification examples (9 days across all types)

Shows the spectrum from perfect clear to heavily cloudy. Each day has a
system-assigned classification and a clear_fraction (what portion of the
day had unobstructed sunlight). These are processed outputs — the user sees
the classification label and the actual vs expected production.

```json
[
  {"date":"2025-05-16","classification":"clear","clear_fraction":1.0,"est_clean_kwh":87.9,"actual_kwh":88.6},
  {"date":"2023-02-26","classification":"clear","clear_fraction":0.875,"est_clean_kwh":77.0,"actual_kwh":74.9},
  {"date":"2022-07-07","classification":"clear","clear_fraction":0.978,"est_clean_kwh":100.3,"actual_kwh":102.7},
  {"date":"2022-02-18","classification":"partial","clear_fraction":0.897,"est_clean_kwh":76.2,"actual_kwh":69.4},
  {"date":"2020-02-27","classification":"partial","clear_fraction":0.800,"est_clean_kwh":83.9,"actual_kwh":77.2},
  {"date":"2024-01-02","classification":"partial","clear_fraction":0.543,"est_clean_kwh":47.9,"actual_kwh":33.4},
  {"date":"2022-03-10","classification":"cloudy","clear_fraction":0.585,"est_clean_kwh":85.2,"actual_kwh":53.8},
  {"date":"2021-09-24","classification":"cloudy","clear_fraction":0.634,"est_clean_kwh":81.0,"actual_kwh":58.7},
  {"date":"2023-06-13","classification":"cloudy","clear_fraction":0.587,"est_clean_kwh":89.0,"actual_kwh":41.9}
]
```

### Monthly summary (pre-aggregated by the analysis pipeline)

```json
[
  {"month":"2025-04","avg_kwh":72.6,"total_kwh":2178,"lost_kwh":379,"rain_mm":12,"clean_pct":85.3,"clear_days":9,"cleans":0},
  {"month":"2025-05","avg_kwh":83.9,"total_kwh":2601,"lost_kwh":548,"rain_mm":13,"clean_pct":82.6,"clear_days":17,"cleans":1},
  {"month":"2025-06","avg_kwh":96.0,"total_kwh":2879,"lost_kwh":284,"rain_mm":1,"clean_pct":91.1,"clear_days":25,"cleans":1},
  {"month":"2025-07","avg_kwh":94.1,"total_kwh":2918,"lost_kwh":121,"rain_mm":0,"clean_pct":96.0,"clear_days":27,"cleans":0},
  {"month":"2025-08","avg_kwh":78.2,"total_kwh":2423,"lost_kwh":293,"rain_mm":2,"clean_pct":89.2,"clear_days":18,"cleans":0},
  {"month":"2025-09","avg_kwh":65.6,"total_kwh":1969,"lost_kwh":454,"rain_mm":2,"clean_pct":81.2,"clear_days":18,"cleans":0},
  {"month":"2025-10","avg_kwh":47.9,"total_kwh":1486,"lost_kwh":563,"rain_mm":2,"clean_pct":72.4,"clear_days":19,"cleans":0},
  {"month":"2025-11","avg_kwh":41.8,"total_kwh":1253,"lost_kwh":151,"rain_mm":19,"clean_pct":89.8,"clear_days":7,"cleans":1},
  {"month":"2025-12","avg_kwh":40.5,"total_kwh":1255,"lost_kwh":8,"rain_mm":90,"clean_pct":99.3,"clear_days":4,"cleans":0},
  {"month":"2026-01","avg_kwh":42.5,"total_kwh":1319,"lost_kwh":82,"rain_mm":67,"clean_pct":94.3,"clear_days":4,"cleans":0},
  {"month":"2026-02","avg_kwh":54.5,"total_kwh":1525,"lost_kwh":152,"rain_mm":21,"clean_pct":91.0,"clear_days":3,"cleans":0},
  {"month":"2026-03","avg_kwh":64.7,"total_kwh":1552,"lost_kwh":91,"rain_mm":63,"clean_pct":94.3,"clear_days":5,"cleans":0}
]
```

---

## YOUR TASK

### Step 1: Define user personas
Identify 3–4 distinct personas who would use this dashboard. For each:
- Who they are (age, tech comfort, what they care about)
- What question they open the dashboard to answer
- How much time they'll spend (10 seconds? 2 minutes? 10 minutes?)
- What would make them share this page with someone

Example starting points (adapt/expand):
- The **homeowner** who just wants to know "is everything OK?"
- The **cost-conscious spouse** who wants to know "is this saving us money?"
- The **tech enthusiast** who wants graphs and trends
- The **installer/maintenance** person checking system health

### Step 2: Design the information architecture
For each persona, design a **view** or **tab** of the dashboard:

1. Map each persona to the data points they care about (from the lists above)
2. Decide the visual hierarchy: what's biggest/first vs what's tucked away
3. Choose the right visualization for each data point:
   - Status indicators (traffic lights, gauges, thumbs up/down)
   - Sparklines for trends
   - Bar charts for comparisons
   - Calendars/heatmaps for daily patterns
   - Simple numbers with context ("67 kWh — 12% above average")
4. Write the actual text labels and descriptions in plain language
   (no technical terms — "panel cleanliness" not "soiling ratio")

### Step 3: Create detailed wireframes
For each view, provide an ASCII wireframe showing exact layout. Include:
- Exact text for every label, number, and description
- Color coding rationale
- What happens on mobile (responsive behavior)
- Interactive elements (tooltips, expand/collapse, tab switching)

### Step 4: Build a working HTML prototype
**This is the main deliverable.** Using the sample data above, produce a
single standalone HTML file that:

- Embeds the sample data as `<script>` variables
- Uses **Plotly.js via CDN** for all charts
- Has **tabs or views** for the different personas
- Is fully responsive (phone → desktop)
- All CSS inline (no external stylesheets)
- Charts are interactive (hover for details, zoom, pan)
- Looks polished and professional — not a wireframe

Make the prototype feel real. Use the actual numbers from the sample data.
Show real charts with real data points. A homeowner opening this file should
immediately understand the status of their panels.

### Step 5: Explain your design decisions
For each component in your design, briefly explain:
- Why you chose that visualization type
- What persona it serves
- What data fields it uses
- Why it's placed where it is in the hierarchy

---

## DESIGN CONSTRAINTS

- **Standalone HTML** — single file, all CSS inline, charts via Plotly CDN
- **No framework** — vanilla HTML/CSS/JS only
- **Responsive** — must work on phone (360px) through desktop (1440px)
- **Fast** — page should feel instant. Limit to ~6 Plotly charts visible at
  once (use tabs or lazy rendering for the rest)
- **Hebrew-friendly** — design should work for RTL text even if content is in
  English for now (don't hardcode left-alignment for data labels)
- **Currency**: Israeli Shekel (₪ or ILS), electricity rate ₪0.48/kWh
- **Self-explanatory** — every number needs context. Never show "67" alone.
  Always "67 kWh — your daily average" or "67% — above normal"
- **Accessibility** — don't rely on color alone for meaning (add icons/text)
- **Print-friendly** — the summary view should look good if someone prints it
  or screenshots it for WhatsApp

## TONE
Friendly, confident, slightly playful. Like a smart friend who happens to
understand solar panels explaining things over coffee. Not a utility bill.
Not a scientific paper.
