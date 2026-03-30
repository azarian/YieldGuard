"""
HTML report generation from pre-computed charts and data.
"""

from __future__ import annotations

import os

import numpy as np
import pandas as pd
import plotly.graph_objects as go

from config import SystemConfig
from reporting.charts import build_all_charts


def build_report(
    daily: pd.DataFrame,
    envelope: pd.Series,
    config: SystemConfig,
    output_dir: str | None = None,
) -> str:
    """
    Build full HTML soiling report.

    Args:
        daily: DataFrame with soiling analysis results
        envelope: Seasonal envelope Series
        config: System configuration
        output_dir: Directory for output file (defaults to research/)

    Returns:
        Path to the generated HTML file
    """
    if output_dir is None:
        output_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

    charts = build_all_charts(daily, envelope)
    path = os.path.join(output_dir, "soiling_report_full.html")

    # Compute summary metrics
    sr = daily["soiling_ratio"].iloc[-1]
    tot_kwh = daily["lost_kwh"].sum()
    tot_ils = daily["lost_ils"].sum()
    ne = int(daily["cleaning"].sum())
    cum = daily["cumul_loss"].iloc[-1]
    n_years = (
        pd.Timestamp(str(daily["date"].max()))
        - pd.Timestamp(str(daily["date"].min()))
    ).days / 365.25
    avg_annual_loss = tot_ils / max(n_years, 1)
    n_clear = int(daily["is_clear"].sum())
    n_partial = int((daily["classification"] == "partial").sum())
    n_cloudy = int((daily["classification"] == "cloudy").sum())
    sc = "good" if sr > 0.97 else ("warn" if sr > 0.93 else "bad")

    # Compute avg soiling rates by season
    ev_idx = [0] + daily[daily["cleaning"]].index.tolist() + [len(daily) - 1]
    summer_rates, winter_rates = [], []
    for s in range(len(ev_idx) - 1):
        seg = daily.iloc[ev_idx[s] : ev_idx[s + 1] + 1]
        v = seg[seg["is_usable"] & seg["soiling_ratio"].notna()]
        if len(v) < 4:
            continue
        x = (
            pd.to_datetime(v["date"]) - pd.to_datetime(v["date"].iloc[0])
        ).dt.days.values.astype(float)
        if x[-1] - x[0] < 5:
            continue
        slope, _ = np.polyfit(x, v["soiling_ratio"].values, 1)
        mid = pd.to_datetime(v["date"].iloc[len(v) // 2]).month
        if mid in [5, 6, 7, 8, 9]:
            summer_rates.append(slope * 100)
        else:
            winter_rates.append(slope * 100)
    avg_summer = np.mean(summer_rates) if summer_rates else 0
    avg_winter = np.mean(winter_rates) if winter_rates else 0

    events = daily[daily["cleaning"]]

    html = f"""<!DOCTYPE html><html><head><title>YieldGuard Full Soiling Report</title>
<meta charset="utf-8">
<style>
*{{box-sizing:border-box}}
body{{font-family:'Segoe UI',system-ui,sans-serif;margin:0;padding:16px;background:#f0f2f5;color:#263238}}
.hdr{{background:linear-gradient(135deg,#0d47a1,#1976d2);color:#fff;padding:24px 28px;border-radius:12px;margin-bottom:16px}}
.hdr h1{{margin:0;font-size:22px}}.hdr p{{margin:5px 0 0;opacity:.85;font-size:12px}}
.cards{{display:flex;gap:10px;margin-bottom:14px;flex-wrap:wrap}}
.c{{background:#fff;border-radius:10px;padding:14px 16px;box-shadow:0 1px 3px rgba(0,0,0,.06);flex:1;min-width:140px}}
.c h3{{margin:0 0 2px;color:#78909c;font-size:10px;text-transform:uppercase;letter-spacing:.8px}}
.c .v{{font-size:20px;font-weight:700}}.c .s{{color:#b0bec5;font-size:11px;margin-top:2px}}
.c .v.good{{color:#2e7d32}}.c .v.warn{{color:#ef6c00}}.c .v.bad{{color:#c62828}}
.ch{{background:#fff;border-radius:10px;padding:12px;margin-bottom:12px;box-shadow:0 1px 3px rgba(0,0,0,.06)}}
.st{{font-size:15px;color:#263238;margin:18px 0 6px;border-bottom:2px solid #1976d2;padding-bottom:3px;font-weight:600}}
table.t{{width:100%;border-collapse:collapse;font-size:11px}}
table.t th{{background:#37474f;color:#fff;padding:5px 6px;text-align:left;position:sticky;top:0}}
table.t td{{padding:4px 6px;border-bottom:1px solid #eceff1}}
table.t tr:hover{{background:#e3f2fd}}
.b{{padding:2px 6px;border-radius:3px;font-size:10px;font-weight:600;white-space:nowrap}}
.b.hr{{background:#bbdefb;color:#0d47a1}}.b.r{{background:#b3e5fc;color:#01579b}}.b.m{{background:#c8e6c9;color:#1b5e20}}
.evtable{{max-height:400px;overflow-y:auto}}
</style></head><body>
<div class="hdr"><h1>YieldGuard &mdash; Full Historical Soiling Analysis</h1>
<p>{config.kwp} kWp &bull; Kramit, Negev ({config.lat:.2f}&deg;N {config.lon:.2f}&deg;E) &bull;
{daily['date'].min()} &rarr; {daily['date'].max()} ({len(daily)} days, {n_years:.1f} years)
&bull; 15-min curve matching: {n_clear} clear + {n_partial} partial + {n_cloudy} cloudy</p></div>
<div class="cards">
<div class="c"><h3>Current SR</h3><div class="v {sc}">{sr:.1%}</div><div class="s">{(1-sr)*100:.1f}% loss</div></div>
<div class="c"><h3>Total Lost</h3><div class="v warn">{tot_kwh:.0f} kWh</div><div class="s">&#8362;{tot_ils:.0f} lifetime</div></div>
<div class="c"><h3>Annual Loss</h3><div class="v warn">&#8362;{avg_annual_loss:.0f}/yr</div><div class="s">avg over {n_years:.1f}yr</div></div>
<div class="c"><h3>Summer Rate</h3><div class="v bad">{avg_summer:.3f}%/d</div><div class="s">May-Sep</div></div>
<div class="c"><h3>Winter Rate</h3><div class="v good">{avg_winter:.3f}%/d</div><div class="s">Oct-Apr</div></div>
<div class="c"><h3>Events</h3><div class="v good">{ne}</div><div class="s">cleaning</div></div>
<div class="c"><h3>Since Clean</h3>
<div class="v {'bad' if cum > config.clean_cost * .5 else 'warn' if cum > config.clean_cost * .25 else 'good'}">&#8362;{cum:.0f}</div>
<div class="s">/ &#8362;{config.clean_cost}</div></div>
</div>
"""

    # Events table
    if ne > 0:
        html += '<h2 class="st">Cleaning Events</h2><div class="evtable">\n'
        html += '<table class="t"><tr><th>Date</th><th>Type</th><th>Before</th><th>After</th><th>Recovery</th></tr>\n'
        for _, r in events.iterrows():
            ix = daily[daily["date"] == r["date"]].index[0]
            bef = daily.iloc[ix - 1]["soiling_ratio"] if ix > 0 else np.nan
            et = r["event_type"]
            bc = "hr" if "Heavy" in et else ("r" if "Rain" in et else "m")
            html += f'<tr><td>{r["date"]}</td><td><span class="b {bc}">{et}</span></td><td>{bef:.3f}</td><td>{r["soiling_ratio"]:.3f}</td><td>+{r["clean_mag"] * 100:.1f}%</td></tr>\n'
        html += '</table></div>\n'

    chart_names = ["timeline", "yearly", "envelope", "seasonal_rates", "monthly"]
    for i, name in enumerate(chart_names):
        include_js = "cdn" if i == 0 else False
        html += f'<div class="ch">{charts[name].to_html(full_html=False, include_plotlyjs=include_js)}</div>\n'

    html += '</body></html>'
    with open(path, "w") as f:
        f.write(html)
    print(f"Report: {path}")
    return path
