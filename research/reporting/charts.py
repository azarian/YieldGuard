"""
Plotly chart builders for soiling analysis reports.

All functions are pure: they take DataFrames in and return Plotly figures.
No file I/O, no imports from analysis layer.
"""

from __future__ import annotations

import numpy as np
import pandas as pd
import plotly.graph_objects as go
from plotly.subplots import make_subplots


MONTH_STARTS = [1, 32, 60, 91, 121, 152, 182, 213, 244, 274, 305, 335]
MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]


def build_all_charts(daily: pd.DataFrame, envelope: pd.Series) -> dict[str, go.Figure]:
    """Build all report charts. Returns dict of name → figure."""
    return {
        "timeline": _timeline_chart(daily),
        "yearly": _yearly_chart(daily),
        "envelope": _envelope_chart(daily, envelope),
        "seasonal_rates": _seasonal_rates(daily),
        "monthly": _monthly_summary(daily),
    }


def _timeline_chart(daily: pd.DataFrame) -> go.Figure:
    """Full timeline: SR, rain, energy, cumulative loss."""
    dates = pd.to_datetime(daily["date"])
    events = daily[daily["cleaning"]]

    fig = make_subplots(
        rows=4, cols=1, shared_xaxes=True, vertical_spacing=0.04,
        subplot_titles=[
            "Daily Soiling Ratio (1.0 = clean)",
            "Precipitation (mm)",
            "Daily Energy Production (kWh)",
            "Cumulative Soiling Loss (\u20aa)",
        ],
        row_heights=[0.35, 0.10, 0.27, 0.28],
    )

    clear = daily[daily["is_clear"]]
    partial = daily[daily["classification"] == "partial"]

    fig.add_trace(go.Scatter(
        x=pd.to_datetime(clear["date"]), y=clear["sr_raw"],
        mode="markers", name="Clear-day SR",
        marker=dict(size=3, color="#2E7D32", opacity=0.5),
    ), row=1, col=1)

    fig.add_trace(go.Scatter(
        x=pd.to_datetime(partial["date"]), y=partial["sr_raw"],
        mode="markers", name="Partial-day SR",
        marker=dict(size=3, color="#FFA726", opacity=0.4),
    ), row=1, col=1)

    fig.add_trace(go.Scatter(
        x=dates, y=daily["soiling_ratio"],
        mode="lines", name="Soiling Ratio",
        line=dict(color="#1565C0", width=1.5),
    ), row=1, col=1)

    if len(events) > 0:
        fig.add_trace(go.Scatter(
            x=pd.to_datetime(events["date"]), y=events["soiling_ratio"],
            mode="markers", name="Cleaning Event",
            marker=dict(size=8, color="#2E7D32", symbol="star",
                        line=dict(width=1, color="#1B5E20")),
            text=[f"{t}<br>+{m * 100:.1f}%" for t, m in zip(events["event_type"], events["clean_mag"])],
            hovertemplate="%{text}<extra></extra>",
        ), row=1, col=1)

    for y_val, color in [(1.0, "green"), (0.95, "orange"), (0.90, "red")]:
        fig.add_hline(y=y_val, line_dash="dot", line_color=color, opacity=0.3, row=1, col=1)

    fig.add_trace(go.Bar(
        x=dates, y=daily["rain_mm"], name="Rain",
        marker=dict(color="rgba(33,150,243,0.4)"),
    ), row=2, col=1)

    fig.add_trace(go.Scatter(
        x=dates, y=daily["energy_kwh"], mode="lines", name="Daily kWh",
        line=dict(color="#1565C0", width=0.5),
    ), row=3, col=1)
    fig.add_trace(go.Scatter(
        x=dates, y=daily["energy_kwh"].rolling(30, center=True).mean(),
        mode="lines", name="30d avg",
        line=dict(color="#E65100", width=2),
    ), row=3, col=1)

    total_cumul = daily["lost_ils"].cumsum()
    fig.add_trace(go.Scatter(
        x=dates, y=total_cumul, mode="lines", name="Total cumulative \u20aa",
        line=dict(color="#B71C1C", width=2),
    ), row=4, col=1)

    fig.update_layout(height=1200, margin=dict(t=40),
                       legend=dict(orientation="h", y=-0.03, x=0.5, xanchor="center"))
    fig.update_yaxes(title_text="SR", range=[0.60, 1.10], row=1, col=1)
    fig.update_yaxes(title_text="mm", row=2, col=1)
    fig.update_yaxes(title_text="kWh", row=3, col=1)
    fig.update_yaxes(title_text="\u20aa", row=4, col=1)
    return fig


def _yearly_chart(daily: pd.DataFrame) -> go.Figure:
    """Soiling ratio by year overlay."""
    fig = go.Figure()
    dc = daily.copy()
    dc["year"] = pd.to_datetime(dc["date"]).dt.year
    dc["doy"] = pd.to_datetime(dc["date"]).dt.dayofyear

    for year in sorted(dc["year"].unique()):
        yr = dc[dc["year"] == year]
        sr_smooth = yr["soiling_ratio"].rolling(14, center=True, min_periods=3).mean()
        fig.add_trace(go.Scatter(
            x=yr["doy"], y=sr_smooth, mode="lines", name=str(year), line=dict(width=2),
        ))

    fig.update_layout(
        height=450, title_text="Soiling Ratio by Year (14-day rolling avg)",
        xaxis_title="Day of Year", yaxis_title="Soiling Ratio",
        yaxis_range=[0.65, 1.10],
    )
    fig.update_xaxes(tickvals=MONTH_STARTS, ticktext=MONTH_NAMES)
    return fig


def _envelope_chart(daily: pd.DataFrame, envelope: pd.Series) -> go.Figure:
    """Multi-year clear-day production vs seasonal envelope."""
    fig = make_subplots(
        rows=2, cols=1, shared_xaxes=True, vertical_spacing=0.08,
        subplot_titles=[
            "Clear-Day Production vs Clean Envelope (by Day of Year)",
            "Clear-Day Production vs Envelope (Timeline)",
        ],
        row_heights=[0.5, 0.5],
    )

    dc = daily.copy()
    dc["doy"] = pd.to_datetime(dc["date"]).dt.dayofyear
    dc["year"] = pd.to_datetime(dc["date"]).dt.year
    clear = dc[dc["is_clear"]]
    years = sorted(clear["year"].unique())
    n_years = len(years)
    colors = [f"hsl({240 - i * 240 / max(n_years - 1, 1)}, 70%, 50%)" for i in range(n_years)]

    for yr, color in zip(years, colors):
        yr_data = clear[clear["year"] == yr]
        fig.add_trace(go.Scatter(
            x=yr_data["doy"], y=yr_data["energy_kwh"],
            mode="markers", name=str(yr),
            marker=dict(size=4, color=color, opacity=0.6),
        ), row=1, col=1)

    doys = np.arange(1, 367)
    fig.add_trace(go.Scatter(
        x=doys, y=envelope.values,
        mode="lines", name="Clean Envelope (P95 fit)",
        line=dict(color="black", width=3),
    ), row=1, col=1)

    fig.update_xaxes(tickvals=MONTH_STARTS, ticktext=MONTH_NAMES, row=1, col=1)
    fig.update_yaxes(title_text="kWh", row=1, col=1)

    dates = pd.to_datetime(dc["date"])
    fig.add_trace(go.Scatter(
        x=dates, y=dc["envelope_kwh"],
        mode="lines", name="Clean Envelope",
        line=dict(color="black", width=2, dash="dot"), showlegend=False,
    ), row=2, col=1)
    fig.add_trace(go.Scatter(
        x=pd.to_datetime(clear["date"]), y=clear["energy_kwh"],
        mode="markers", name="Clear-day actual",
        marker=dict(size=4, color="#1565C0", opacity=0.5), showlegend=False,
    ), row=2, col=1)

    partial = dc[dc["classification"] == "partial"]
    fig.add_trace(go.Scatter(
        x=pd.to_datetime(partial["date"]), y=partial["est_clean_kwh"],
        mode="markers", name="Partial (est. clean)",
        marker=dict(size=3, color="#FFA726", opacity=0.3), showlegend=False,
    ), row=2, col=1)

    fig.update_yaxes(title_text="kWh", row=2, col=1)
    fig.update_layout(
        height=700,
        title_text="Seasonal Envelope \u2014 Clean System Production Ceiling",
        legend=dict(orientation="h", y=-0.05, x=0.5, xanchor="center"),
    )
    return fig


def _seasonal_rates(daily: pd.DataFrame) -> go.Figure:
    """Soiling rate distribution by season + monthly avg SR."""
    fig = make_subplots(rows=1, cols=2, subplot_titles=[
        "Soiling Rate Distribution by Season",
        "Monthly Average Soiling Ratio",
    ])

    dc = daily.copy()
    dc["month"] = pd.to_datetime(dc["date"]).dt.month

    ev_idx = [0] + daily[daily["cleaning"]].index.tolist() + [len(daily) - 1]
    rate_data = []
    for s in range(len(ev_idx) - 1):
        a, b = ev_idx[s], ev_idx[s + 1]
        seg = daily.iloc[a : b + 1]
        v = seg[seg["is_usable"] & seg["soiling_ratio"].notna()]
        if len(v) < 4:
            continue
        x = (pd.to_datetime(v["date"]) - pd.to_datetime(v["date"].iloc[0])).dt.days.values.astype(float)
        if x[-1] - x[0] < 5:
            continue
        slope, _ = np.polyfit(x, v["soiling_ratio"].values, 1)
        mid_month = pd.to_datetime(v["date"].iloc[len(v) // 2]).month
        season = _season(mid_month)
        rate_data.append({"rate": slope * 100, "season": season})

    if rate_data:
        rdf = pd.DataFrame(rate_data)
        season_order = ["Winter", "Spring", "Summer", "Autumn"]
        season_colors = {"Winter": "#1565C0", "Spring": "#2E7D32", "Summer": "#E65100", "Autumn": "#6A1B9A"}
        for s in season_order:
            ss = rdf[rdf["season"] == s]
            if len(ss) > 0:
                fig.add_trace(go.Box(y=ss["rate"], name=s, marker_color=season_colors[s]), row=1, col=1)

    monthly_sr = dc.groupby("month")["soiling_ratio"].mean()
    month_colors = [
        "#1565C0", "#1565C0", "#2E7D32", "#2E7D32", "#2E7D32",
        "#E65100", "#E65100", "#E65100", "#6A1B9A", "#6A1B9A", "#6A1B9A", "#1565C0",
    ]
    fig.add_trace(go.Bar(
        x=MONTH_NAMES[:len(monthly_sr)],
        y=monthly_sr.values,
        marker=dict(color=month_colors[:len(monthly_sr)]),
        name="Avg SR",
    ), row=1, col=2)

    fig.update_yaxes(title_text="%/day", row=1, col=1)
    fig.update_yaxes(title_text="SR", range=[0.80, 1.05], row=1, col=2)
    fig.update_layout(height=400, title_text="Seasonal Soiling Analysis")
    return fig


def _monthly_summary(daily: pd.DataFrame) -> go.Figure:
    """Monthly energy, loss, and avg SR."""
    dc = daily.copy()
    dc["month"] = pd.to_datetime(dc["date"]).dt.to_period("M").astype(str)
    monthly = dc.groupby("month").agg(
        avg_sr=("soiling_ratio", "mean"),
        energy=("energy_kwh", "sum"),
        lost=("lost_kwh", "sum"),
    ).reset_index()

    fig = make_subplots(
        rows=2, cols=1, shared_xaxes=True, vertical_spacing=0.08,
        subplot_titles=["Monthly Energy & Loss (kWh)", "Monthly Avg Soiling Ratio"],
    )

    fig.add_trace(go.Bar(x=monthly["month"], y=monthly["energy"], name="Production",
                         marker=dict(color="rgba(33,150,243,0.5)")), row=1, col=1)
    fig.add_trace(go.Bar(x=monthly["month"], y=monthly["lost"], name="Lost to soiling",
                         marker=dict(color="rgba(244,67,54,0.6)")), row=1, col=1)
    fig.add_trace(go.Scatter(x=monthly["month"], y=monthly["avg_sr"], mode="lines+markers",
                             name="Avg SR", line=dict(color="#1565C0", width=2),
                             marker=dict(size=5)), row=2, col=1)
    fig.add_hline(y=0.95, line_dash="dot", line_color="orange", opacity=0.4, row=2, col=1)

    fig.update_yaxes(title_text="kWh", row=1, col=1)
    fig.update_yaxes(title_text="SR", range=[0.75, 1.05], row=2, col=1)
    fig.update_layout(height=600, title_text="Monthly Summary", barmode="overlay")
    fig.update_xaxes(tickangle=45)
    return fig


def _season(month: int) -> str:
    if month in [12, 1, 2]: return "Winter"
    if month in [3, 4, 5]: return "Spring"
    if month in [6, 7, 8]: return "Summer"
    return "Autumn"
