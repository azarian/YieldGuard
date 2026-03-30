#!/usr/bin/env python3
"""
YieldGuard — Dashboard & Algorithm Explainer Generator
=======================================================
Reads pre-computed JSON data and generates two standalone HTML files:
  1. soiling_dashboard.html — user-friendly status dashboard
  2. soiling_howto.html     — visual algorithm explainer (6 steps)
"""

import json
import math
import os
import sys

import numpy as np
import pandas as pd
import plotly.graph_objects as go
from plotly.subplots import make_subplots

DIR = os.path.dirname(os.path.abspath(__file__))

# Import system config from existing pipeline
sys.path.insert(0, DIR)
from clear_day import SYSTEM, CurveMatchDetector

PRICE = 0.48       # ILS/kWh
CLEAN_COST = 350   # ILS


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# DATA LOADING
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━


def load_soiling():
    path = os.path.join(DIR, "soiling_full.json")
    with open(path) as f:
        data = json.load(f)
    df = pd.DataFrame(data)
    df["date"] = pd.to_datetime(df["date"])
    return df


def load_clear_days():
    path = os.path.join(DIR, "clear_day_results.json")
    with open(path) as f:
        data = json.load(f)
    df = pd.DataFrame(data)
    df["date"] = pd.to_datetime(df["date"])
    return df


def load_energy_15min():
    path = os.path.join(DIR, "energy_15min_cache.csv")
    df = pd.read_csv(path, parse_dates=["timestamp"])
    df["date"] = df["timestamp"].dt.date
    return df


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# HERO CALCULATIONS
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━


def compute_hero_metrics(daily):
    """Derive dashboard hero section numbers from soiling data."""
    # Current cleanliness
    current_sr = daily["soiling_ratio"].iloc[-1]
    cleanliness = current_sr * 100

    # Days since last cleaning
    cleaning_events = daily[daily["cleaning"]]
    if len(cleaning_events) > 0:
        last_clean_date = cleaning_events["date"].iloc[-1]
        days_since_clean = (daily["date"].iloc[-1] - last_clean_date).days
    else:
        last_clean_date = daily["date"].iloc[0]
        days_since_clean = (daily["date"].iloc[-1] - daily["date"].iloc[0]).days

    # Soiling rate: linear fit to last 30 usable days
    usable = daily[daily["classification"].isin(["clear", "partial"])].tail(60)
    if len(usable) >= 5:
        x = (usable["date"] - usable["date"].iloc[0]).dt.days.values.astype(float)
        y = usable["soiling_ratio"].values
        slope, intercept = np.polyfit(x, y, 1)
        soiling_rate = slope  # SR units per day (negative = getting dirtier)
    else:
        soiling_rate = -0.001

    # Average daily energy (recent 30 days)
    recent = daily.tail(30)
    avg_daily_kwh = recent["actual_kwh"].mean()

    # Daily loss in kWh and ILS
    loss_fraction = max(0, 1 - current_sr)
    daily_loss_kwh = avg_daily_kwh * loss_fraction / max(current_sr, 0.5)
    daily_loss_ils = daily_loss_kwh * PRICE

    # Monthly projected loss
    monthly_loss = daily_loss_ils * 30

    # Losses since last cleaning
    mask = daily["date"] > last_clean_date
    losses_since_clean = daily.loc[mask, "lost_kwh"].sum() * PRICE

    # Break-even: how many more days until cleaning pays for itself
    if daily_loss_ils > 0.01:
        remaining_to_breakeven = max(0, CLEAN_COST - losses_since_clean) / daily_loss_ils
    else:
        remaining_to_breakeven = 999

    # Optimal cleaning interval: minimizes cost/day = sqrt(2 * C / r)
    # Use historical average soiling rate across all dry segments for stability
    ev_idx = [0] + daily[daily["cleaning"]].index.tolist() + [len(daily) - 1]
    all_rates = []
    for s in range(len(ev_idx) - 1):
        a, b = ev_idx[s], ev_idx[s + 1]
        seg = daily.iloc[a:b + 1]
        v = seg[seg["classification"].isin(["clear", "partial"]) & seg["soiling_ratio"].notna()]
        if len(v) < 5:
            continue
        xv = (v["date"] - v["date"].iloc[0]).dt.days.values.astype(float)
        if xv[-1] - xv[0] < 7:
            continue
        sl, _ = np.polyfit(xv, v["soiling_ratio"].values, 1)
        if sl < 0:
            all_rates.append(abs(sl))
    hist_rate = np.median(all_rates) if all_rates else abs(soiling_rate)

    daily_soiling_cost = avg_daily_kwh * hist_rate * PRICE
    if daily_soiling_cost > 0.001:
        optimal_interval = math.sqrt(2 * CLEAN_COST / daily_soiling_cost)
    else:
        optimal_interval = 365

    # Projected next 30 days loss (linear extrapolation of soiling rate)
    projected_30d = 0
    for d in range(1, 31):
        future_sr = max(0.5, current_sr + soiling_rate * d)
        future_loss_frac = max(0, 1 - future_sr)
        projected_30d += avg_daily_kwh * future_loss_frac / max(future_sr, 0.5) * PRICE

    return {
        "current_sr": current_sr,
        "cleanliness": cleanliness,
        "days_since_clean": days_since_clean,
        "last_clean_date": last_clean_date,
        "soiling_rate": soiling_rate,
        "monthly_loss": monthly_loss,
        "losses_since_clean": losses_since_clean,
        "projected_30d": projected_30d,
        "breakeven_days": remaining_to_breakeven,
        "optimal_interval": optimal_interval,
        "daily_loss_ils": daily_loss_ils,
        "avg_daily_kwh": avg_daily_kwh,
    }


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# USER-FRIENDLY CHARTS (no jargon — kWh, ₪, %, rain)
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━


def _season(month):
    if month in [12, 1, 2]: return "Winter"
    if month in [3, 4, 5]: return "Spring"
    if month in [6, 7, 8]: return "Summer"
    return "Autumn"


def chart_production(daily):
    """Simple: how much electricity your panels made, with a trend line."""
    fig = go.Figure()
    dates = daily["date"]

    # Daily production (thin, subtle)
    fig.add_trace(go.Scatter(
        x=dates, y=daily["actual_kwh"],
        mode="lines", name="Daily production",
        line=dict(color="rgba(33,150,243,0.25)", width=1),
        hovertemplate="%{x|%b %d, %Y}<br>%{y:.1f} kWh<extra></extra>",
    ))

    # 30-day moving average (bold)
    avg30 = daily["actual_kwh"].rolling(30, center=True, min_periods=5).mean()
    fig.add_trace(go.Scatter(
        x=dates, y=avg30,
        mode="lines", name="Monthly average",
        line=dict(color="#1565C0", width=3),
        hovertemplate="%{x|%b %Y}<br>Avg: %{y:.1f} kWh/day<extra></extra>",
    ))

    # What clean panels would have produced (envelope)
    clean_est = daily["est_clean_kwh"].rolling(30, center=True, min_periods=5).mean()
    fig.add_trace(go.Scatter(
        x=dates, y=clean_est,
        mode="lines", name="If panels were clean",
        line=dict(color="#43A047", width=2, dash="dot"),
        hovertemplate="%{x|%b %Y}<br>Clean: %{y:.1f} kWh/day<extra></extra>",
    ))

    fig.update_layout(
        height=380, margin=dict(t=10, b=10, l=50, r=20),
        plot_bgcolor="white",
        legend=dict(orientation="h", y=-0.12, x=0.5, xanchor="center"),
        yaxis_title="kWh per day",
    )
    fig.update_xaxes(gridcolor="#f0f0f0")
    fig.update_yaxes(gridcolor="#f0f0f0", rangemode="tozero")
    return fig


def chart_rain(daily):
    """Rainfall over time — people understand rain washes panels."""
    fig = go.Figure()
    dates = daily["date"]

    fig.add_trace(go.Bar(
        x=dates, y=daily["rain_mm"], name="Daily rainfall",
        marker=dict(color="rgba(33,150,243,0.5)"),
        hovertemplate="%{x|%b %d, %Y}<br>%{y:.1f} mm<extra></extra>",
    ))

    # Monthly rainfall totals as a line
    dc = daily.copy()
    dc["month"] = dc["date"].dt.to_period("M")
    monthly_rain = dc.groupby("month")["rain_mm"].sum().reset_index()
    monthly_rain["date"] = monthly_rain["month"].apply(lambda m: m.to_timestamp() + pd.Timedelta(days=14))
    fig.add_trace(go.Scatter(
        x=monthly_rain["date"], y=monthly_rain["rain_mm"],
        mode="lines+markers", name="Monthly total",
        line=dict(color="#0D47A1", width=2),
        marker=dict(size=5),
        yaxis="y2",
        hovertemplate="%{x|%b %Y}<br>Total: %{y:.0f} mm<extra></extra>",
    ))

    fig.update_layout(
        height=300, margin=dict(t=10, b=10, l=50, r=50),
        plot_bgcolor="white",
        legend=dict(orientation="h", y=-0.15, x=0.5, xanchor="center"),
        yaxis=dict(title="mm / day", gridcolor="#f0f0f0"),
        yaxis2=dict(title="mm / month", overlaying="y", side="right", gridcolor="#f0f0f0"),
    )
    fig.update_xaxes(gridcolor="#f0f0f0")
    return fig


def chart_cleanliness(daily):
    """Panel cleanliness as a simple percentage with color zones."""
    fig = go.Figure()
    dates = daily["date"]
    clean_pct = daily["soiling_ratio"] * 100

    # Color zone backgrounds
    fig.add_hrect(y0=95, y1=105, fillcolor="rgba(67,160,71,0.08)", line_width=0)
    fig.add_hrect(y0=90, y1=95, fillcolor="rgba(255,167,38,0.08)", line_width=0)
    fig.add_hrect(y0=60, y1=90, fillcolor="rgba(229,57,53,0.06)", line_width=0)

    # Zone labels on right side
    fig.add_annotation(x=1.01, y=97.5, text="Clean", xref="paper",
                       font=dict(size=11, color="#43A047"), showarrow=False, xanchor="left")
    fig.add_annotation(x=1.01, y=92.5, text="Getting dirty", xref="paper",
                       font=dict(size=11, color="#EF6C00"), showarrow=False, xanchor="left")
    fig.add_annotation(x=1.01, y=85, text="Needs cleaning", xref="paper",
                       font=dict(size=11, color="#E53935"), showarrow=False, xanchor="left")

    # Cleanliness line
    fig.add_trace(go.Scatter(
        x=dates, y=clean_pct,
        mode="lines", name="Panel cleanliness",
        line=dict(color="#1565C0", width=2),
        fill="tozeroy", fillcolor="rgba(21,101,192,0.06)",
        hovertemplate="%{x|%b %d, %Y}<br>Cleanliness: %{y:.1f}%<extra></extra>",
    ))

    # Cleaning events as stars
    events = daily[daily["cleaning"]]
    if len(events) > 0:
        fig.add_trace(go.Scatter(
            x=events["date"], y=events["soiling_ratio"] * 100,
            mode="markers", name="Cleaned",
            marker=dict(size=10, color="#43A047", symbol="star",
                        line=dict(width=1, color="#1B5E20")),
            text=[t if t else "Manual" for t in events["event_type"]],
            hovertemplate="%{x|%b %d, %Y}<br>Cleaned (%{text})<br>%{y:.1f}%<extra></extra>",
        ))

    fig.update_layout(
        height=380, margin=dict(t=10, b=10, l=50, r=90),
        plot_bgcolor="white",
        legend=dict(orientation="h", y=-0.12, x=0.5, xanchor="center"),
        yaxis=dict(title="Cleanliness %", range=[65, 105], gridcolor="#f0f0f0"),
    )
    fig.update_xaxes(gridcolor="#f0f0f0")
    return fig


def chart_money_lost(daily):
    """Monthly money lost to dirty panels — everyone understands money."""
    fig = go.Figure()
    dc = daily.copy()
    dc["month"] = dc["date"].dt.to_period("M")
    dc["lost_ils"] = dc["lost_kwh"] * PRICE

    monthly = dc.groupby("month").agg(
        lost=("lost_ils", "sum"),
        produced=("actual_kwh", "sum"),
    ).reset_index()
    monthly["date"] = monthly["month"].apply(lambda m: m.to_timestamp())
    monthly["pct"] = monthly["lost"] / (monthly["lost"] + monthly["produced"] * PRICE) * 100

    fig.add_trace(go.Bar(
        x=monthly["date"], y=monthly["lost"],
        name="Money lost to dirt",
        marker=dict(color=[
            "#E53935" if v > 50 else "#FFA726" if v > 20 else "#43A047"
            for v in monthly["lost"]
        ]),
        hovertemplate="%{x|%b %Y}<br>Lost: ₪%{y:.0f}<extra></extra>",
    ))

    fig.update_layout(
        height=350, margin=dict(t=10, b=10, l=50, r=20),
        plot_bgcolor="white",
        legend=dict(orientation="h", y=-0.12, x=0.5, xanchor="center"),
        yaxis=dict(title="₪ lost / month", gridcolor="#f0f0f0"),
    )
    fig.update_xaxes(gridcolor="#f0f0f0")
    return fig


def chart_seasons(daily):
    """Production by month-of-year — show seasonal pattern simply."""
    fig = go.Figure()
    dc = daily.copy()
    dc["month_num"] = dc["date"].dt.month
    month_names = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
                   "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
    season_colors = ["#1565C0", "#1565C0", "#43A047", "#43A047", "#43A047",
                     "#E65100", "#E65100", "#E65100", "#6A1B9A", "#6A1B9A", "#6A1B9A", "#1565C0"]
    season_colors_light = [
        "rgba(21,101,192,0.2)", "rgba(21,101,192,0.2)",
        "rgba(67,160,71,0.2)", "rgba(67,160,71,0.2)", "rgba(67,160,71,0.2)",
        "rgba(230,81,0,0.2)", "rgba(230,81,0,0.2)", "rgba(230,81,0,0.2)",
        "rgba(106,27,154,0.2)", "rgba(106,27,154,0.2)", "rgba(106,27,154,0.2)",
        "rgba(21,101,192,0.2)",
    ]

    monthly_avg = dc.groupby("month_num")["actual_kwh"].mean().reindex(range(1, 13))
    monthly_clean = dc.groupby("month_num")["est_clean_kwh"].mean().reindex(range(1, 13))

    fig.add_trace(go.Bar(
        x=month_names, y=monthly_clean.values,
        name="If clean",
        marker=dict(color=season_colors_light),
        hovertemplate="%{x}<br>Clean: %{y:.1f} kWh/day<extra></extra>",
    ))
    fig.add_trace(go.Bar(
        x=month_names, y=monthly_avg.values,
        name="Actually produced",
        marker=dict(color=season_colors),
        hovertemplate="%{x}<br>Actual: %{y:.1f} kWh/day<extra></extra>",
    ))

    fig.update_layout(
        height=350, margin=dict(t=10, b=10, l=50, r=20),
        plot_bgcolor="white", barmode="overlay",
        legend=dict(orientation="h", y=-0.12, x=0.5, xanchor="center"),
        yaxis=dict(title="Avg kWh / day", gridcolor="#f0f0f0"),
    )
    fig.update_xaxes(gridcolor="#f0f0f0")
    return fig


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# DASHBOARD HTML
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━


def build_dashboard(daily, clear_days, hero):
    """Generate soiling_dashboard.html — traffic-light design, user-friendly."""

    # ── Traffic light logic ──
    c_score = hero["cleanliness"]
    if c_score > 95:
        light = "green"
        light_hex = "#43A047"
        light_label = "Panels are clean"
        light_sub = "No action needed right now."
    elif c_score > 90:
        light = "amber"
        light_hex = "#F9A825"
        light_label = "Getting dirty"
        light_sub = "Keep an eye on it over the next few weeks."
    else:
        light = "red"
        light_hex = "#E53935"
        light_label = "Needs cleaning"
        light_sub = "Dirt is costing you real money."

    # ── Recommendation ──
    if hero["losses_since_clean"] >= CLEAN_COST:
        rec_text = "Clean now"
        rec_color = "#E53935"
        rec_detail = "You've already lost more than the cost of cleaning."
    elif hero["breakeven_days"] < 14:
        rec_text = f"Clean within {int(hero['breakeven_days'])} days"
        rec_color = "#EF6C00"
        rec_detail = "Cleaning will pay for itself soon."
    elif hero["breakeven_days"] < 45:
        weeks = max(1, int(hero["breakeven_days"] / 7))
        rec_text = f"Wait ~{weeks} more week{'s' if weeks > 1 else ''}"
        rec_color = "#F9A825"
        rec_detail = "Getting close to the point where cleaning pays off."
    else:
        rec_text = "No rush"
        rec_color = "#43A047"
        rec_detail = "Panels are relatively clean. Check again in a month."

    # ── Charts ──
    fig_production = chart_production(daily)
    fig_rain = chart_rain(daily)
    fig_cleanliness = chart_cleanliness(daily)
    fig_money = chart_money_lost(daily)
    fig_seasons = chart_seasons(daily)

    # ── Cleaning event timeline HTML ──
    events = daily[daily["cleaning"]].copy()
    events_html = ""
    if len(events) > 0:
        for _, ev in events.iloc[::-1].iterrows():  # newest first
            idx = daily[daily["date"] == ev["date"]].index[0]
            sr_before = daily.iloc[idx - 1]["soiling_ratio"] * 100 if idx > 0 else 0
            sr_after = ev["soiling_ratio"] * 100
            cause = ev["event_type"] if ev["event_type"] else "Manual"
            icon = "🌧️" if "Rain" in cause else "🧹"
            events_html += f"""
<div class="evt">
  <span class="evt-icon">{icon}</span>
  <div class="evt-body">
    <div class="evt-date">{ev['date'].strftime('%b %d, %Y')}</div>
    <div class="evt-detail">{cause} &mdash; cleanliness went from {sr_before:.0f}% to {sr_after:.0f}%</div>
  </div>
</div>"""

    # Total losses
    total_loss_ils = daily["lost_kwh"].sum() * PRICE
    total_loss_kwh = daily["lost_kwh"].sum()
    n_years = (daily["date"].max() - daily["date"].min()).days / 365.25
    annual_loss = total_loss_ils / max(n_years, 1)

    path = os.path.join(DIR, "soiling_dashboard.html")
    html = f"""<!DOCTYPE html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>YieldGuard — Panel Cleanliness Report</title>
<style>
*{{box-sizing:border-box;margin:0;padding:0}}
body{{font-family:'Segoe UI',system-ui,-apple-system,sans-serif;background:#f5f7fa;color:#263238;line-height:1.6}}
.w{{max-width:900px;margin:0 auto;padding:20px 16px}}

/* Header */
.hd{{background:linear-gradient(135deg,#1a237e 0%,#1565c0 50%,#42a5f5 100%);color:#fff;padding:28px 32px;border-radius:16px;margin-bottom:24px}}
.hd h1{{font-size:22px;font-weight:700;margin-bottom:4px}}.hd .sub{{opacity:.75;font-size:13px}}

/* Traffic light hero */
.tl-hero{{display:flex;align-items:center;gap:28px;background:#fff;border-radius:16px;padding:28px 32px;
  box-shadow:0 4px 20px rgba(0,0,0,.07);margin-bottom:24px}}
@media(max-width:640px){{.tl-hero{{flex-direction:column;text-align:center}}}}
.tl-stack{{display:flex;flex-direction:column;gap:6px;align-items:center}}
.tl-dot{{width:36px;height:36px;border-radius:50%;border:3px solid #e0e0e0}}
.tl-dot.on{{border-color:transparent;box-shadow:0 0 16px currentColor}}
.tl-dot.r{{background:#E53935;color:#E53935}}.tl-dot.a{{background:#F9A825;color:#F9A825}}.tl-dot.g{{background:#43A047;color:#43A047}}
.tl-dot.off{{background:#e0e0e0;opacity:.4}}
.tl-info{{flex:1}}
.tl-info h2{{font-size:26px;font-weight:800;color:{light_hex};margin-bottom:4px}}
.tl-info p{{color:#78909c;font-size:14px}}
.tl-stats{{display:flex;gap:20px;margin-top:12px;flex-wrap:wrap}}
.tl-stat{{text-align:center}}
.tl-stat .n{{font-size:22px;font-weight:800}}.tl-stat .l{{font-size:11px;color:#90a4ae;text-transform:uppercase;letter-spacing:.5px}}
.tl-stat .n.red{{color:#E53935}}.tl-stat .n.amb{{color:#F9A825}}.tl-stat .n.grn{{color:#43A047}}

/* Recommendation card */
.rec-card{{background:#fff;border-radius:14px;padding:20px 24px;box-shadow:0 2px 10px rgba(0,0,0,.05);
  margin-bottom:24px;border-left:5px solid {rec_color};display:flex;align-items:center;gap:16px}}
@media(max-width:640px){{.rec-card{{flex-direction:column;text-align:center}}}}
.rec-icon{{font-size:36px;flex-shrink:0}}
.rec-body h3{{font-size:18px;font-weight:700;color:{rec_color};margin-bottom:2px}}
.rec-body p{{color:#78909c;font-size:13px}}
.rec-body .roi-line{{font-size:12px;color:#546e7a;margin-top:6px}}

/* Sections */
.section{{margin-bottom:28px}}
.section h3{{font-size:17px;font-weight:700;color:#263238;margin-bottom:4px}}
.section .explain{{font-size:13px;color:#78909c;margin-bottom:12px}}
.chart-card{{background:#fff;border-radius:14px;padding:16px;box-shadow:0 2px 10px rgba(0,0,0,.05)}}

/* Events timeline */
.evt{{display:flex;gap:12px;padding:10px 0;border-bottom:1px solid #f0f0f0}}
.evt:last-child{{border-bottom:none}}
.evt-icon{{font-size:20px;flex-shrink:0;margin-top:2px}}
.evt-date{{font-size:13px;font-weight:700;color:#37474f}}.evt-detail{{font-size:12px;color:#78909c}}
.evt-list{{max-height:300px;overflow-y:auto;padding:8px 12px}}

/* Summary row */
.sum-row{{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:24px}}
@media(max-width:640px){{.sum-row{{grid-template-columns:1fr}}}}
.sum-card{{background:#fff;border-radius:12px;padding:16px 18px;box-shadow:0 2px 8px rgba(0,0,0,.05);text-align:center}}
.sum-card .sv{{font-size:24px;font-weight:800}}.sum-card .sl{{font-size:11px;color:#90a4ae;text-transform:uppercase;letter-spacing:.5px;margin-top:2px}}
.sv.red{{color:#E53935}}.sv.amb{{color:#F9A825}}.sv.grn{{color:#43A047}}

.footer{{text-align:center;color:#b0bec5;font-size:11px;margin-top:32px;padding:16px 0;border-top:1px solid #e8e8e8}}
</style>
</head><body>
<div class="w">

<div class="hd">
  <h1>YieldGuard &mdash; Panel Cleanliness Report</h1>
  <div class="sub">{SYSTEM['kwp']} kWp system &bull; Kramit, Negev &bull;
  Data from {daily['date'].min().strftime('%b %Y')} to {daily['date'].max().strftime('%b %Y')}</div>
</div>

<!-- ═══ TRAFFIC LIGHT HERO ═══ -->
<div class="tl-hero">
  <div class="tl-stack">
    <div class="tl-dot r {'on' if light=='red' else 'off'}"></div>
    <div class="tl-dot a {'on' if light=='amber' else 'off'}"></div>
    <div class="tl-dot g {'on' if light=='green' else 'off'}"></div>
  </div>
  <div class="tl-info">
    <h2>{light_label}</h2>
    <p>{light_sub}</p>
    <div class="tl-stats">
      <div class="tl-stat">
        <div class="n {'red' if hero['monthly_loss']>80 else 'amb' if hero['monthly_loss']>30 else 'grn'}">&#8362;{hero['monthly_loss']:.0f}</div>
        <div class="l">Lost / month</div>
      </div>
      <div class="tl-stat">
        <div class="n {'red' if hero['days_since_clean']>120 else 'amb' if hero['days_since_clean']>70 else 'grn'}">{hero['days_since_clean']}</div>
        <div class="l">Days since clean</div>
      </div>
      <div class="tl-stat">
        <div class="n" style="color:{light_hex}">{c_score:.0f}%</div>
        <div class="l">Cleanliness</div>
      </div>
    </div>
  </div>
</div>

<!-- ═══ RECOMMENDATION ═══ -->
<div class="rec-card">
  <div class="rec-icon">{'🔴' if rec_color=='#E53935' else '🟡' if rec_color in ['#EF6C00','#F9A825'] else '🟢'}</div>
  <div class="rec-body">
    <h3>{rec_text}</h3>
    <p>{rec_detail}</p>
    <div class="roi-line">
      Cleaning costs &#8362;{CLEAN_COST} &bull;
      You've lost &#8362;{hero['losses_since_clean']:.0f} since last cleaning &bull;
      Best interval: every ~{hero['optimal_interval']:.0f} days
    </div>
  </div>
</div>

<!-- ═══ SUMMARY NUMBERS ═══ -->
<div class="sum-row">
  <div class="sum-card"><div class="sv red">&#8362;{total_loss_ils:,.0f}</div><div class="sl">Total lost to dirt</div></div>
  <div class="sum-card"><div class="sv amb">&#8362;{annual_loss:,.0f}/yr</div><div class="sl">Avg annual loss</div></div>
  <div class="sum-card"><div class="sv grn">{len(events)}</div><div class="sl">Times panels were cleaned</div></div>
</div>

<!-- ═══ YOUR SOLAR PRODUCTION ═══ -->
<div class="section">
  <h3>Your Solar Production</h3>
  <p class="explain">How much electricity your panels produce each day.
  The green dotted line shows what you'd get if panels were perfectly clean.</p>
  <div class="chart-card">{fig_production.to_html(full_html=False, include_plotlyjs="cdn")}</div>
</div>

<!-- ═══ PANEL CLEANLINESS OVER TIME ═══ -->
<div class="section">
  <h3>Panel Cleanliness Over Time</h3>
  <p class="explain">100% = perfectly clean. Below 95% panels are getting dirty.
  Below 90% you're losing noticeable energy. Stars mark when panels were washed (by rain or manually).</p>
  <div class="chart-card">{fig_cleanliness.to_html(full_html=False, include_plotlyjs=False)}</div>
</div>

<!-- ═══ RAINFALL ═══ -->
<div class="section">
  <h3>Rainfall</h3>
  <p class="explain">Rain naturally washes your panels. In dry summer months panels get dirtier faster.
  Heavy rain events often show up as cleaning events above.</p>
  <div class="chart-card">{fig_rain.to_html(full_html=False, include_plotlyjs=False)}</div>
</div>

<!-- ═══ MONEY LOST EACH MONTH ═══ -->
<div class="section">
  <h3>Money Lost Each Month</h3>
  <p class="explain">How much money dirty panels cost you each month.
  Red bars = months where dirt cost you the most.</p>
  <div class="chart-card">{fig_money.to_html(full_html=False, include_plotlyjs=False)}</div>
</div>

<!-- ═══ SEASONAL PATTERN ═══ -->
<div class="section">
  <h3>Seasonal Pattern</h3>
  <p class="explain">Your panels produce more in summer (longer days, more sun) and less in winter.
  The faded bars show what you'd produce with clean panels &mdash; the gap is the dirt effect.</p>
  <div class="chart-card">{fig_seasons.to_html(full_html=False, include_plotlyjs=False)}</div>
</div>

<!-- ═══ CLEANING HISTORY ═══ -->
<div class="section">
  <h3>When Were Panels Cleaned?</h3>
  <p class="explain">Every time we detect that panels got significantly cleaner (from rain or manual washing).</p>
  <div class="chart-card">
    <div class="evt-list">
      {events_html if events_html else '<p style="color:#90a4ae;padding:12px">No cleaning events detected.</p>'}
    </div>
  </div>
</div>

<div class="footer">Generated by YieldGuard &bull; {pd.Timestamp.now().strftime('%Y-%m-%d %H:%M')}</div>
</div>
</body></html>"""

    with open(path, "w") as f:
        f.write(html)
    print(f"Dashboard: {path}")
    return path


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# HOWTO CHARTS
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━


def _find_example_days(clear_days):
    """Find one good clear, partial, and cloudy day for the howto.
    Returns dict of cls -> dict with keys date, fit_score, model_scale, etc."""
    best = {}
    for cls in ["clear", "partial", "cloudy"]:
        subset = clear_days[clear_days["classification"] == cls].copy()
        if cls == "clear":
            subset = subset.sort_values("fit_score", ascending=False)
        elif cls == "partial":
            subset = subset.sort_values("fit_score", ascending=False)
            mid = len(subset) // 4
            subset = subset.iloc[mid:mid + 1] if len(subset) > mid else subset.head(1)
        else:
            subset = subset[subset["fit_score"] > -2].sort_values("fit_score", ascending=True)
        if len(subset) > 0:
            best[cls] = subset.iloc[0].to_dict()
    return best


def howto_step1(energy_15min, clear_days, detector):
    """Step 1: One clear day — actual vs model curve."""
    clear = clear_days[clear_days["classification"] == "clear"].sort_values("fit_score", ascending=False)
    if len(clear) == 0:
        return go.Figure()

    day_row = clear.iloc[0]
    day = pd.Timestamp(day_row["date"]).date()
    day_data = energy_15min[energy_15min["date"] == day]

    model_power, model_times = detector.compute_model_profile(day)
    model_energy = model_power * (15 / 60)
    actual = detector._align_actual(day_data, model_times)
    scale = day_row["model_scale"]
    scaled = model_energy * scale

    hours = [(t - model_times[0]).total_seconds() / 3600 for t in model_times]

    fig = go.Figure()
    fig.add_trace(go.Scatter(x=hours, y=model_energy, mode="lines", name="PVlib Model (raw)",
                             line=dict(color="#90CAF9", width=1.5, dash="dot")))
    fig.add_trace(go.Scatter(x=hours, y=scaled, mode="lines", name=f"Scaled Model (×{scale:.3f})",
                             line=dict(color="#1565C0", width=2.5)))
    fig.add_trace(go.Scatter(x=hours, y=actual, mode="lines+markers", name="Your Panels (actual)",
                             line=dict(color="#E65100", width=2), marker=dict(size=4)))

    fig.update_layout(
        height=350, margin=dict(t=30, b=30, l=50, r=20), plot_bgcolor="white",
        title=dict(text=f"{day} — Clear Day (R² = {day_row['fit_score']:.4f})",
                   font=dict(size=13)),
        xaxis_title="Hour of Day", yaxis_title="Energy (Wh / 15 min)",
        legend=dict(orientation="h", y=-0.2, x=0.5, xanchor="center"),
    )
    fig.update_xaxes(range=[5, 20], dtick=2, gridcolor="#f0f0f0")
    fig.update_yaxes(gridcolor="#f0f0f0")
    return fig


def howto_step2(energy_15min, clear_days, detector):
    """Step 2: Three example days side-by-side."""
    examples = _find_example_days(clear_days)
    titles = []
    for cls in ["clear", "partial", "cloudy"]:
        if cls in examples:
            titles.append(f"{cls.title()} (R\u00b2={examples[cls]['fit_score']:.2f})")
        else:
            titles.append(cls.title())
    fig = make_subplots(rows=1, cols=3, shared_yaxes=True, subplot_titles=titles)

    colors = {"clear": "#43A047", "partial": "#FFA726", "cloudy": "#E53935"}

    for col, cls in enumerate(["clear", "partial", "cloudy"], 1):
        if cls not in examples:
            continue
        row = examples[cls]
        day = pd.Timestamp(row["date"]).date()
        day_data = energy_15min[energy_15min["date"] == day]
        model_power, model_times = detector.compute_model_profile(day)
        model_energy = model_power * (15 / 60)
        actual = detector._align_actual(day_data, model_times)
        scale = row["model_scale"]
        scaled = model_energy * scale
        hours = [(t - model_times[0]).total_seconds() / 3600 for t in model_times]

        fig.add_trace(go.Scatter(
            x=hours, y=scaled, mode="lines", name="Model",
            line=dict(color="#1565C0", width=2), showlegend=(col == 1),
        ), row=1, col=col)
        fig.add_trace(go.Scatter(
            x=hours, y=actual, mode="lines", name="Actual",
            line=dict(color=colors[cls], width=2), showlegend=(col == 1),
        ), row=1, col=col)
        fig.update_xaxes(range=[5, 20], dtick=4, gridcolor="#f0f0f0", row=1, col=col)

    fig.update_yaxes(title_text="Wh / 15 min", gridcolor="#f0f0f0", row=1, col=1)
    fig.update_layout(
        height=300, margin=dict(t=40, b=30, l=50, r=20),
        plot_bgcolor="white",
        legend=dict(orientation="h", y=-0.2, x=0.5, xanchor="center"),
    )
    return fig


def howto_step3(clear_days):
    """Step 3: DOY scatter + envelope curve."""
    fig = go.Figure()
    clear = clear_days[clear_days["classification"] == "clear"].copy()
    clear["doy"] = clear["date"].dt.dayofyear
    clear["year"] = clear["date"].dt.year

    years = sorted(clear["year"].unique())
    n_years = len(years)
    colors = [f"hsl({240 - i * 240 / max(n_years - 1, 1)}, 70%, 55%)" for i in range(n_years)]

    for yr, color in zip(years, colors):
        yr_data = clear[clear["year"] == yr]
        fig.add_trace(go.Scatter(
            x=yr_data["doy"], y=yr_data["actual_kwh"],
            mode="markers", name=str(yr),
            marker=dict(size=4, color=color, opacity=0.6),
        ))

    if len(clear) > 20:
        clear["bin"] = pd.cut(clear["doy"], bins=36)
        bins = clear.groupby("bin").agg(
            p95=("actual_kwh", lambda x: x.quantile(0.95)),
            mid=("doy", "mean"),
        ).dropna()
        if len(bins) > 5:
            from scipy.interpolate import UnivariateSpline
            spl = UnivariateSpline(bins["mid"], bins["p95"], s=len(bins) * 10)
            doys = np.arange(1, 367)
            fig.add_trace(go.Scatter(
                x=doys, y=spl(doys), mode="lines", name="Clean Envelope (P95)",
                line=dict(color="black", width=3),
            ))

    month_starts = [1, 32, 60, 91, 121, 152, 182, 213, 244, 274, 305, 335]
    month_names = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
    fig.update_xaxes(tickvals=month_starts, ticktext=month_names, gridcolor="#f0f0f0")
    fig.update_yaxes(title_text="kWh", gridcolor="#f0f0f0")
    fig.update_layout(
        height=400, margin=dict(t=10, b=10, l=50, r=20), plot_bgcolor="white",
        legend=dict(orientation="h", y=-0.12, x=0.5, xanchor="center"),
    )
    return fig


def howto_step4(daily, clear_days):
    """Step 4: Timeline — envelope line vs actual clear-day dots, soiling annotated."""
    fig = go.Figure()
    clear = daily[daily["classification"] == "clear"]

    # We need the envelope from soiling data; approximate it from est_clean_kwh on clear days
    # or from the soiling_ratio applied to actual_kwh
    # actual_kwh / soiling_ratio ≈ envelope_kwh
    dates = daily["date"]
    envelope_approx = daily["actual_kwh"] / daily["soiling_ratio"].clip(lower=0.5)

    fig.add_trace(go.Scatter(
        x=dates, y=envelope_approx.rolling(14, center=True, min_periods=3).mean(),
        mode="lines", name="Clean Ceiling (envelope)",
        line=dict(color="black", width=2, dash="dot"),
    ))
    fig.add_trace(go.Scatter(
        x=clear["date"], y=clear["actual_kwh"],
        mode="markers", name="Clear-day Actual",
        marker=dict(size=4, color="#1565C0", opacity=0.5),
    ))

    # Annotate a dirty period and a clean period
    recent_sr = daily.tail(60)
    dirty_point = recent_sr.loc[recent_sr["soiling_ratio"].idxmin()]
    fig.add_annotation(
        x=dirty_point["date"], y=dirty_point["actual_kwh"],
        text=f"Dirty: SR={dirty_point['soiling_ratio']:.2f}",
        showarrow=True, arrowhead=2, ax=0, ay=-40,
        font=dict(size=11, color="#E53935"),
    )

    fig.update_layout(
        height=400, margin=dict(t=10, b=10, l=50, r=20),
        plot_bgcolor="white",
        legend=dict(orientation="h", y=-0.1, x=0.5, xanchor="center"),
        yaxis_title="kWh",
    )
    fig.update_xaxes(gridcolor="#f0f0f0")
    fig.update_yaxes(gridcolor="#f0f0f0")
    return fig


def howto_step5(daily):
    """Step 5: Zoomed view of one cleaning event."""
    events = daily[daily["cleaning"]]
    if len(events) == 0:
        fig = go.Figure()
        fig.add_annotation(text="No cleaning events detected", x=0.5, y=0.5,
                           xref="paper", yref="paper", showarrow=False, font=dict(size=16))
        return fig

    # Pick the event with the largest magnitude
    best_idx = events["soiling_ratio"].idxmax()
    # Find event with best recovery that's not near edges
    for _, ev in events.iterrows():
        ev_idx = daily[daily["date"] == ev["date"]].index[0]
        if ev_idx > 20 and ev_idx < len(daily) - 20:
            best_idx = ev_idx
            break

    # Window: 30 days before to 30 days after
    start = max(0, best_idx - 30)
    end = min(len(daily), best_idx + 31)
    window = daily.iloc[start:end]
    usable = window[window["classification"].isin(["clear", "partial"])]

    fig = go.Figure()
    fig.add_trace(go.Scatter(
        x=usable["date"], y=usable["soiling_ratio"],
        mode="markers", name="Usable-day SR",
        marker=dict(size=6, color="#1565C0", opacity=0.6),
    ))
    fig.add_trace(go.Scatter(
        x=window["date"], y=window["soiling_ratio"],
        mode="lines", name="Soiling Ratio",
        line=dict(color="#1565C0", width=2),
    ))

    ev_date = daily.iloc[best_idx]["date"]
    ev_sr = daily.iloc[best_idx]["soiling_ratio"]
    fig.add_trace(go.Scatter(
        x=[ev_date], y=[ev_sr], mode="markers", name="Cleaning Event",
        marker=dict(size=14, color="#43A047", symbol="star",
                    line=dict(width=2, color="#1B5E20")),
    ))

    fig.add_annotation(
        x=ev_date, y=ev_sr, text="Panels cleaned!",
        showarrow=True, arrowhead=2, ax=50, ay=-30,
        font=dict(size=12, color="#2E7D32", weight="bold"),
    )

    fig.update_layout(
        height=350, margin=dict(t=10, b=10, l=50, r=20),
        plot_bgcolor="white",
        legend=dict(orientation="h", y=-0.15, x=0.5, xanchor="center"),
        yaxis_title="Soiling Ratio",
    )
    fig.update_yaxes(gridcolor="#f0f0f0")
    fig.update_xaxes(gridcolor="#f0f0f0")
    return fig


def howto_step6(daily):
    """Step 6: Full SR timeline with cleaning events and loss annotations."""
    fig = go.Figure()
    dates = daily["date"]
    events = daily[daily["cleaning"]]

    fig.add_trace(go.Scatter(
        x=dates, y=daily["soiling_ratio"],
        mode="lines", name="Soiling Ratio",
        line=dict(color="#1565C0", width=2),
        fill="tozeroy", fillcolor="rgba(21,101,192,0.08)",
    ))

    if len(events) > 0:
        fig.add_trace(go.Scatter(
            x=events["date"], y=events["soiling_ratio"],
            mode="markers", name="Cleaning",
            marker=dict(size=10, color="#43A047", symbol="star",
                        line=dict(width=1, color="#1B5E20")),
        ))

    for y, c in [(1.0, "#43A047"), (0.95, "#FFA726"), (0.90, "#E53935")]:
        fig.add_hline(y=y, line_dash="dot", line_color=c, opacity=0.3)

    # Annotate total loss
    total_loss = daily["lost_kwh"].sum() * PRICE
    fig.add_annotation(
        text=f"Total soiling loss: ₪{total_loss:,.0f}",
        x=0.98, y=0.02, xref="paper", yref="paper",
        showarrow=False, font=dict(size=12, color="#E53935"),
        bgcolor="rgba(255,255,255,0.8)", bordercolor="#E53935", borderwidth=1,
        borderpad=6, xanchor="right",
    )

    fig.update_layout(
        height=400, margin=dict(t=10, b=10, l=50, r=20),
        plot_bgcolor="white",
        legend=dict(orientation="h", y=-0.1, x=0.5, xanchor="center"),
        yaxis_title="Soiling Ratio", yaxis_range=[0.65, 1.08],
    )
    fig.update_xaxes(gridcolor="#f0f0f0")
    fig.update_yaxes(gridcolor="#f0f0f0")
    return fig


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# HOWTO HTML
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━


def build_howto(daily, clear_days, energy_15min, detector):
    """Generate soiling_howto.html."""

    steps = [
        {
            "num": 1,
            "title": "We know what your panels SHOULD produce",
            "desc": "Using physics-based solar modeling (pvlib), we compute the expected power curve for every 15-minute interval of every day, accounting for your panel tilt, location, and temperature.",
            "chart": howto_step1(energy_15min, clear_days, detector),
        },
        {
            "num": 2,
            "title": "We identify clear-sky days",
            "desc": "By comparing the actual power curve shape to the model, we score each day. Clear days match perfectly (R\u00b2 \u2248 1.0); clouds create dips that lower the score.",
            "chart": howto_step2(energy_15min, clear_days, detector),
        },
        {
            "num": 3,
            "title": "We build a seasonal ceiling",
            "desc": "Plotting the cleanest days across years reveals a smooth seasonal pattern \u2014 the maximum your system can produce on any given day. This is the \u201cclean envelope.\u201d",
            "chart": howto_step3(clear_days),
        },
        {
            "num": 4,
            "title": "The gap = soiling",
            "desc": "When actual clear-day production falls below the envelope, the difference is caused by dirt on the panels. The bigger the gap, the more energy you\u2019re losing.",
            "chart": howto_step4(daily, clear_days),
        },
        {
            "num": 5,
            "title": "We detect when panels were cleaned",
            "desc": "A sudden jump in the soiling ratio that stays elevated means the panels were cleaned \u2014 either by rain or manual washing. We classify each event automatically.",
            "chart": howto_step5(daily),
        },
        {
            "num": 6,
            "title": "Putting it all together",
            "desc": "The full soiling timeline reveals patterns: how fast panels get dirty, when they get cleaned, and how much energy is lost. This drives the cleaning ROI calculation.",
            "chart": howto_step6(daily),
        },
    ]

    steps_html = ""
    for i, s in enumerate(steps):
        plotly_js = "cdn" if i == 0 else False
        steps_html += f"""
<div class="step">
  <div class="step-num">{s['num']}</div>
  <div class="step-content">
    <h2>{s['title']}</h2>
    <p class="step-desc">{s['desc']}</p>
    <div class="step-chart">{s['chart'].to_html(full_html=False, include_plotlyjs=plotly_js)}</div>
  </div>
</div>
"""

    path = os.path.join(DIR, "soiling_howto.html")
    html = f"""<!DOCTYPE html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>YieldGuard — How Soiling Detection Works</title>
<style>
*{{box-sizing:border-box;margin:0;padding:0}}
body{{font-family:'Segoe UI',system-ui,-apple-system,sans-serif;background:#fff;color:#263238;line-height:1.6}}
.wrap{{max-width:820px;margin:0 auto;padding:32px 20px}}

.header{{text-align:center;margin-bottom:48px}}
.header h1{{font-size:28px;font-weight:800;color:#0d47a1;margin-bottom:8px}}
.header p{{font-size:15px;color:#78909c;max-width:560px;margin:0 auto}}

.step{{display:flex;gap:20px;margin-bottom:48px;align-items:flex-start}}
@media(max-width:640px){{.step{{flex-direction:column;gap:12px}}}}
.step-num{{flex-shrink:0;width:48px;height:48px;border-radius:50%;background:linear-gradient(135deg,#0d47a1,#42a5f5);
  color:#fff;font-size:22px;font-weight:800;display:flex;align-items:center;justify-content:center;margin-top:2px}}
.step-content{{flex:1;min-width:0}}
.step-content h2{{font-size:20px;font-weight:700;color:#263238;margin-bottom:6px}}
.step-desc{{font-size:14px;color:#546e7a;margin-bottom:14px}}
.step-chart{{background:#fafafa;border-radius:12px;padding:12px;border:1px solid #e0e0e0}}

.footer{{text-align:center;color:#b0bec5;font-size:12px;margin-top:40px;padding:20px 0;border-top:1px solid #e0e0e0}}
</style>
</head><body>
<div class="wrap">

<div class="header">
  <h1>How YieldGuard Detects Soiling</h1>
  <p>Your solar panels get dirty over time, losing energy. Here's how we measure it &mdash; using real data from your {SYSTEM['kwp']} kWp system.</p>
</div>

{steps_html}

<div class="footer">YieldGuard &bull; {SYSTEM['kwp']} kWp &bull; Kramit, Negev &bull; Generated {pd.Timestamp.now().strftime('%Y-%m-%d %H:%M')}</div>
</div>
</body></html>"""

    with open(path, "w") as f:
        f.write(html)
    print(f"Howto:     {path}")
    return path


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# MAIN
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━


def main():
    print("=" * 60)
    print("YieldGuard — Building Dashboard & Howto")
    print("=" * 60)

    print("\n1. Loading data...")
    daily = load_soiling()
    clear_days = load_clear_days()
    energy_15min = load_energy_15min()

    print(f"   Soiling:    {len(daily)} days")
    print(f"   Clear-day:  {len(clear_days)} days")
    print(f"   15-min:     {len(energy_15min)} records")

    print("\n2. Computing hero metrics...")
    hero = compute_hero_metrics(daily)
    print(f"   Cleanliness: {hero['cleanliness']:.1f}")
    print(f"   Monthly loss: ₪{hero['monthly_loss']:.0f}")
    print(f"   Days since clean: {hero['days_since_clean']}")
    print(f"   Optimal interval: {hero['optimal_interval']:.0f} days")

    print("\n3. Building dashboard...")
    build_dashboard(daily, clear_days, hero)

    print("\n4. Building howto (initializing pvlib model)...")
    detector = CurveMatchDetector()
    build_howto(daily, clear_days, energy_15min, detector)

    print("\n" + "=" * 60)
    print("Done! Open in browser:")
    print(f"  soiling_dashboard.html")
    print(f"  soiling_howto.html")


if __name__ == "__main__":
    main()
