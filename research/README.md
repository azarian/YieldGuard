# YieldGuard — Soiling Loss Estimation

Estimates energy loss from solar panel soiling (dust/dirt accumulation) using production data and weather records. Detects cleaning events, computes daily soiling ratios, and quantifies financial impact.

## Architecture

```
config.py              Pure data: system config, result types
  |
data/                  I/O layer: SolarEdge API, Open-Meteo weather (research only)
  |
models/                Physics: pvlib clear-sky model, seasonal envelope fitting
  |
analysis/              Core algorithms: clear-day detection, soiling, cleaning
  |
reporting/             Charts and HTML reports (Plotly)
  |
api.py                 Production facade: SoilingAnalyzer
pipeline.py            Research CLI: runs full analysis from API data
```

Each layer only imports from layers above it. The analysis layer has no I/O — it takes DataFrames in and returns DataFrames out.

## Production Integration

The app should use `SoilingAnalyzer` from `api.py`. It takes raw DataFrames — no API keys, no file paths, no CSV caching.

```python
from api import SoilingAnalyzer
from config import SystemConfig

# 1. Configure your system
config = SystemConfig(
    lat=31.33, lon=34.90, alt=350, kwp=15.84,
    tilt=20, azimuth=180, tz="Asia/Jerusalem",
    install_date="2019-11-03",
    price=0.48,         # electricity price per kWh
    clean_cost=350.0,   # cost of one manual cleaning
)

# 2. Provide data as DataFrames (from database, API, memory — your choice)
#    energy_15min: columns ['timestamp' (datetime), 'energy_wh' (float)]
#    precip:       columns ['date' (date), 'rain_mm' (float)]

# 3. Run analysis
analyzer = SoilingAnalyzer(config)
result = analyzer.analyze(energy_15min_df, precip_df)

# 4. Use results
result.summary.current_sr          # 0.931 (93.1% of clean performance)
result.summary.current_loss_pct    # 6.9%
result.summary.total_lost_kwh      # 17400.0
result.summary.total_lost_money    # 8352.0
result.summary.n_cleaning_events   # 27
result.summary.avg_summer_rate     # -0.16 (%/day)
result.daily                       # Full daily DataFrame
result.events                      # Cleaning events only
result.envelope                    # Seasonal production envelope

# 5. Charts (optional, only built when needed)
charts = analyzer.build_charts(result)  # dict of Plotly figures
```

### Input Data Contracts

**energy_15min** — 15-minute energy production intervals:
| Column | Type | Description |
|--------|------|-------------|
| `timestamp` | datetime | Interval start time (naive or tz-aware) |
| `energy_wh` | float | Energy produced in the interval (Wh) |

**precip** — Daily precipitation:
| Column | Type | Description |
|--------|------|-------------|
| `date` | date | Calendar date |
| `rain_mm` | float | Total daily rainfall (mm) |

### Output: SoilingResult

| Field | Type | Description |
|-------|------|-------------|
| `daily` | DataFrame | Full daily analysis (soiling_ratio, loss_pct, lost_kwh, cleaning, event_type, ...) |
| `summary` | SoilingSummary | Aggregated stats (current_sr, total_lost_kwh, n_cleaning_events, ...) |
| `events` | DataFrame | Subset of daily where cleaning=True |
| `envelope` | Series | Seasonal envelope indexed by day-of-year (1-366) |
| `envelope_params` | ndarray | 7 fitted curve parameters |
| `config` | SystemConfig | Config used for the analysis |

### Low-Level API

For incremental processing or custom pipelines, import the individual modules:

```python
from analysis.clear_day import CurveMatchDetector
from analysis.soiling import build_daily, compute_soiling, enforce_monotonicity
from analysis.cleaning import detect_cleaning, classify_event
from models.seasonal import fit_seasonal_envelope
from models.clearsky import ClearSkyModel
```

## Research Pipeline

For standalone research use with the SolarEdge API:

```bash
# Set credentials
export SOLAREDGE_SITE_ID=your_site_id
export SOLAREDGE_API_KEY=your_api_key

# Install dependencies
pip install -r requirements.txt

# Run full analysis
PYTHONPATH=. python pipeline.py

# Output:
#   soiling_full.json         — daily soiling data
#   soiling_report_full.html  — interactive HTML report
```

## Algorithm Overview

1. **Clear-sky model** — pvlib computes theoretical 15-min power profiles for each day (sun position, POA irradiance, IAM, temperature, system losses)
2. **Day classification** — Actual 15-min curves are matched against the model via R² fit. Days are classified as clear (R²>0.97), partial (R²>0.50), or cloudy
3. **Seasonal envelope** — P95 of clear-day production per 10-day DOY bin, fitted with a 3-harmonic Fourier curve. This is the "clean system ceiling"
4. **Soiling ratio** — Daily SR = production / envelope. Piecewise-linear fitting between cleaning events
5. **Cleaning detection** — SR jumps exceeding noise-adaptive thresholds, with rain classification (Heavy Rain / Rain / No Rain)
6. **Monotonicity enforcement** — Physical constraint: SR can only decrease during dry, non-cleaning days. Post-processing clamp ensures this

See `plan.md` for the full algorithm design document.

## Testing

```bash
PYTHONPATH=. python -m pytest tests/ -v
```

51 tests across 7 modules:
- `test_config.py` — Config dataclass creation, defaults, immutability
- `test_clearsky.py` — Clear-sky model physics (zero at night, peak at noon, summer > winter)
- `test_seasonal.py` — Envelope fitting with synthetic seasonal data
- `test_clear_day.py` — Day classification with synthetic curves
- `test_cleaning.py` — Cleaning detection and rain classification
- `test_soiling.py` — Monotonicity enforcement, dry period marking
- `test_validate.py` — Common-sense validation against real output data

## Logging

All library modules use Python `logging` (not print). To control verbosity:

```python
import logging
logging.getLogger("analysis").setLevel(logging.WARNING)  # silence analysis logs
logging.getLogger("models").setLevel(logging.WARNING)    # silence model logs
```
