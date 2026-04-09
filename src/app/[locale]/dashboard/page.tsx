"use client";

import { useEffect, useState, useCallback } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { createClient } from "@/lib/supabase/client";
import { LogoIcon } from "@/components/Logo";

/* ── Types ───────────────────────────────────────────────────────────────── */

interface DayValue { date: string; kwh: number }

interface AnalysisResult {
  system: { system_name: string; site_id: string; last_synced_at: string | null };
  analysis: {
    energy?: {
      total_kwh: number; average_daily_kwh: number;
      best_day: { date: string; kwh: number }; worst_day: { date: string; kwh: number };
      trend: { direction: "up" | "down" | "stable"; change_pct: number };
      consistency_score: number; daily_values: DayValue[]; days_analyzed: number;
    };
    power?: { peak_kw: number; peak_time: string; average_active_kw: number; active_intervals: number; total_intervals: number };
    overview?: { lifetime_mwh: number; last_month_kwh: number; last_day_kwh: number; current_power_kw: number; is_producing: boolean };
  };
  analyzed_at: string;
}

interface SoilingDay { date: string; soiling_ratio: number | null; actual_kwh: number; clean_kwh: number; lost_kwh: number; classification: string; cleaning: boolean }
interface CleaningEvent { date: string; type: string; rain_mm: number }
interface SoilingMonetary { currency_per_kwh: number; currency: string; currency_symbol: string; total_lost_money: number; annual_avg_loss: number; loss_monthly_projected: number; loss_yearly_projected: number; avg_daily_loss: number }
interface SoilingResult {
  summary: { current_sr: number; current_loss_pct: number; total_lost_kwh: number; n_cleaning_events: number; loss_since_last_clean: number; avg_summer_rate: number; avg_winter_rate: number; analysis_start: string; analysis_end: string; n_days: number };
  daily: SoilingDay[];
  events: CleaningEvent[];
  monetary: SoilingMonetary;
  analyzed_at: string;
}

interface PanelData {
  serial_number: string;
  name: string | null;
  total_energy_kwh: number;
  avg_power_w: number;
  deviation_pct: number;
  status: "underperforming" | "normal" | "above_average";
}

/* ── Small components ────────────────────────────────────────────────────── */

function TrendBadge({ direction, pct }: { direction: string; pct: number }) {
  const colors = {
    up: "bg-accent-light text-accent dark:bg-green-900/30 dark:text-green-400",
    down: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
    stable: "bg-surface-hover text-muted",
  };
  const arrows = { up: "↑", down: "↓", stable: "→" };
  const key = direction as keyof typeof colors;
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ${colors[key]}`}>
      {arrows[key]} {Math.abs(pct).toFixed(1)}%
    </span>
  );
}

function MetricCard({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div className="rounded-2xl border border-border bg-surface p-5">
      <p className="text-sm text-muted">{label}</p>
      <p className={`mt-1 text-2xl font-bold ${color ?? "text-foreground"}`}>{value}</p>
      {sub && <p className="mt-1 text-xs text-muted-light">{sub}</p>}
    </div>
  );
}

/* ── Page ─────────────────────────────────────────────────────────────────── */

export default function DashboardPage() {
  const t = useTranslations("dashboard");
  const ta = useTranslations("analysis");
  const tl = useTranslations("losses");
  const tp = useTranslations("panels");
  const supabase = createClient();

  const ts = useTranslations("sync");
  const [authLoading, setAuthLoading] = useState(true);
  const [hasSystem, setHasSystem] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const [pricePerKwh, setPricePerKwh] = useState<number | null>(null);
  const [currency, setCurrency] = useState("ILS");
  const [syncStats, setSyncStats] = useState<{ inverters: number; hasData: boolean } | null>(null);
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [data, setData] = useState<AnalysisResult | null>(null);
  const [soilingLoading, setSoilingLoading] = useState(false);
  const [soilingError, setSoilingError] = useState<string | null>(null);
  const [soilingData, setSoilingData] = useState<SoilingResult | null>(null);
  const [panelData, setPanelData] = useState<PanelData[] | null>(null);
  const [panelLoading, setPanelLoading] = useState(false);

  const getToken = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession();
    return session?.access_token ?? null;
  }, [supabase]);

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setAuthLoading(false); return; }
      const { data: profile } = await supabase.from("profiles").select("full_name").eq("id", user.id).single();
      setDisplayName(profile?.full_name ?? user.email ?? "");
      const { data: sys } = await supabase.from("solar_systems").select("id, last_synced_at, electricity_price_per_kwh, currency").eq("user_id", user.id).single();
      setHasSystem(!!sys);
      if (sys) {
        setLastSyncedAt(sys.last_synced_at);
        setPricePerKwh(sys.electricity_price_per_kwh ?? null);
        setCurrency(sys.currency ?? "ILS");
      }
      setAuthLoading(false);
      if (sys) { fetchAnalysis(); fetchPanels(); fetchSyncStats(); }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fetchSyncStats = useCallback(async () => {
    try {
      const res = await fetch("/api/solar/sync/inventory");
      const json = await res.json();
      if (res.ok) {
        setSyncStats({
          inverters: json.inverter_count ?? 0,
          hasData: !!json.date_range,
        });
        if (json.last_synced_at) setLastSyncedAt(json.last_synced_at);
      }
    } catch { /* ignore */ }
  }, []);

  const fetchAnalysis = useCallback(async () => {
    setAnalysisLoading(true); setAnalysisError(null);
    const token = await getToken();
    if (!token) { setAnalysisError(ta("notAuthenticated")); setAnalysisLoading(false); return; }
    try {
      const res = await fetch("/api/py/analyze", { headers: { Authorization: `Bearer ${token}` } });
      const json = await res.json();
      if (!res.ok) { setAnalysisError(json.detail || json.error || ta("fetchError")); setAnalysisLoading(false); return; }
      setData(json);
    } catch (err) { setAnalysisError(err instanceof Error ? err.message : ta("fetchError")); }
    setAnalysisLoading(false);
  }, [getToken, ta]);

  const fetchSoiling = useCallback(async () => {
    setSoilingLoading(true); setSoilingError(null);
    const token = await getToken();
    if (!token) { setSoilingError(tl("notAvailable")); setSoilingLoading(false); return; }
    try {
      const res = await fetch("/api/py/analyze/soiling", { headers: { Authorization: `Bearer ${token}` } });
      const json = await res.json();
      if (!res.ok) { setSoilingError(json.detail || json.error || tl("fetchError")); setSoilingLoading(false); return; }
      setSoilingData(json);
    } catch (err) { setSoilingError(err instanceof Error ? err.message : tl("fetchError")); }
    setSoilingLoading(false);
  }, [getToken, tl]);

  const fetchPanels = useCallback(async () => {
    setPanelLoading(true);
    const token = await getToken();
    if (!token) { setPanelLoading(false); return; }
    try {
      const res = await fetch("/api/py/analyze/panels", { headers: { Authorization: `Bearer ${token}` } });
      const json = await res.json();
      if (res.ok && json.panels) setPanelData(json.panels);
    } catch { /* ignore */ }
    setPanelLoading(false);
  }, [getToken]);

  /* ── Loading ────────────────────────────────────────────────── */
  if (authLoading) {
    return (
      <div className="mx-auto max-w-6xl px-6 py-12">
        <div className="h-8 w-56 animate-pulse rounded-lg bg-border-light" />
        <div className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-28 animate-pulse rounded-2xl bg-border-light" />
          ))}
        </div>
      </div>
    );
  }

  /* ── No system ──────────────────────────────────────────────── */
  if (!hasSystem) {
    return (
      <div className="mx-auto max-w-4xl px-6 py-16">
        <h1 className="mb-2 text-3xl font-bold text-foreground">{t("title")}</h1>
        <p className="mb-10 text-muted">{t("welcomeBack", { name: displayName })}</p>
        <div className="rounded-2xl border border-border bg-surface p-10 text-center">
          <LogoIcon className="mx-auto mb-5 h-14 w-14 text-brand" />
          <h2 className="mb-2 text-xl font-semibold text-foreground">{t("noSystemTitle")}</h2>
          <p className="mb-8 text-muted">{t("noSystemDesc")}</p>
          <Link
            href="/dashboard/system"
            className="inline-flex items-center gap-2 rounded-xl bg-brand px-6 py-3 text-base font-semibold text-white shadow-md shadow-brand/20 transition-all hover:bg-brand-hover hover:shadow-lg hover:shadow-brand/30"
          >
            {t("registerSystem")}
          </Link>
        </div>
      </div>
    );
  }

  /* ── Dashboard ──────────────────────────────────────────────── */
  const energy = data?.analysis?.energy;
  const power = data?.analysis?.power;
  const overview = data?.analysis?.overview;
  const maxKwh = energy ? Math.max(...energy.daily_values.map((d) => d.kwh)) : 0;

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      {/* Header */}
      <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold text-foreground">{t("title")}</h1>
          <p className="mt-1 text-sm text-muted">{t("welcomeBack", { name: displayName })}</p>
        </div>
        <button onClick={fetchAnalysis} disabled={analysisLoading}
          className="rounded-xl border border-border px-4 py-2 text-sm font-medium text-muted transition-colors hover:bg-surface-hover hover:text-foreground disabled:opacity-50">
          <svg className="me-1.5 inline h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182" />
          </svg>
          {ta("refresh")}
        </button>
      </div>

      {/* Sync Summary Card */}
      <div className="mb-8 rounded-2xl border border-border bg-surface p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-light">
              <svg className="h-5 w-5 text-brand" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182" />
              </svg>
            </div>
            <div>
              <p className="text-sm font-semibold text-foreground">{ts("dataSyncTitle")}</p>
              <p className="text-xs text-muted">
                {lastSyncedAt
                  ? ts("lastSynced", { date: new Date(lastSyncedAt).toLocaleString() })
                  : ts("neverSynced")}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {syncStats && (
              <div className="flex gap-3 text-xs text-muted">
                <span>{syncStats.inverters} {ts("inverterLabel")}</span>
              </div>
            )}
            <Link
              href="/dashboard/sync"
              className="inline-flex items-center gap-1.5 rounded-xl bg-brand px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-hover"
            >
              {ts("manageSyncLink")}
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
              </svg>
            </Link>
          </div>
        </div>
      </div>

      {/* Analysis loading */}
      {analysisLoading && (
        <div className="mb-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-28 animate-pulse rounded-2xl bg-border-light" />
          ))}
        </div>
      )}

      {/* Analysis error */}
      {analysisError && (
        <div className="mb-8 rounded-2xl border border-red-200 bg-red-50 p-6 text-center dark:border-red-800 dark:bg-red-900/20">
          <p className="text-sm text-red-700 dark:text-red-400">{analysisError}</p>
          <button onClick={fetchAnalysis} className="mt-3 rounded-xl bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-hover">{ta("retry")}</button>
        </div>
      )}

      {/* Hero Cards */}
      {data && (
        <>
          <div className="mb-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {/* Current Power */}
            <div className="rounded-2xl border border-border bg-surface p-5">
              <div className="mb-2 flex h-9 w-9 items-center justify-center rounded-xl bg-brand-light">
                <svg className="h-5 w-5 text-brand" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z" />
                </svg>
              </div>
              <p className="text-sm text-muted">{ta("currentPower")}</p>
              <p className={`mt-1 text-2xl font-bold ${overview?.is_producing ? "text-accent" : "text-muted-light"}`}>
                {overview ? `${overview.current_power_kw} kW` : "—"}
              </p>
              <p className="mt-1 text-xs text-muted-light">{overview?.is_producing ? ta("producing") : overview ? ta("notProducing") : ""}</p>
            </div>

            {/* Today\'s Energy */}
            <div className="rounded-2xl border border-border bg-surface p-5">
              <div className="mb-2 flex h-9 w-9 items-center justify-center rounded-xl bg-accent-light">
                <svg className="h-5 w-5 text-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v2.25m6.364.386l-1.591 1.591M21 12h-2.25m-.386 6.364l-1.591-1.591M12 18.75V21m-4.773-4.227l-1.591 1.591M5.25 12H3m4.227-4.773L5.636 5.636M15.75 12a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0z" />
                </svg>
              </div>
              <p className="text-sm text-muted">{ta("todayEnergy")}</p>
              <p className="mt-1 text-2xl font-bold text-foreground">{overview ? `${overview.last_day_kwh} kWh` : "—"}</p>
              {energy && <div className="mt-1"><TrendBadge direction={energy.trend.direction} pct={energy.trend.change_pct} /></div>}
            </div>

            {/* System Health */}
            {(() => {
              const loss = soilingData?.summary.current_loss_pct;
              const level = loss != null ? (loss > 15 ? "poor" : loss > 5 ? "fair" : "good") : "good";
              const bg = { good: "bg-accent-light", fair: "bg-brand-light", poor: "bg-red-100 dark:bg-red-900/30" }[level];
              const clr = { good: "text-accent", fair: "text-brand", poor: "text-red-500" }[level];
              const label = { good: ta("healthGood"), fair: ta("healthFair"), poor: ta("healthPoor") }[level];
              const desc = { good: ta("allSystemsNormal"), fair: ta("healthFairDesc"), poor: ta("healthPoorDesc") }[level];
              return (
                <div className="rounded-2xl border border-border bg-surface p-5">
                  <div className={`mb-2 flex h-9 w-9 items-center justify-center rounded-xl ${bg}`}>
                    <svg className={`h-5 w-5 ${clr}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </div>
                  <p className="text-sm text-muted">{ta("systemHealth")}</p>
                  <p className={`mt-1 text-2xl font-bold ${clr}`}>{label}</p>
                  <p className="mt-1 text-xs text-muted-light">{desc}</p>
                </div>
              );
            })()}

            {/* Monthly Savings */}
            <div className="rounded-2xl border border-border bg-surface p-5">
              <div className="mb-2 flex h-9 w-9 items-center justify-center rounded-xl bg-brand-light">
                <svg className="h-5 w-5 text-brand" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 18.75a60.07 60.07 0 0115.797 2.101c.727.198 1.453-.342 1.453-1.096V18.75M3.75 4.5v.75A.75.75 0 013 6h-.75m0 0v-.375c0-.621.504-1.125 1.125-1.125H20.25M2.25 6v9m18-10.5v.75c0 .414.336.75.75.75h.75m-1.5-1.5h.375c.621 0 1.125.504 1.125 1.125v9.75c0 .621-.504 1.125-1.125 1.125h-.375m1.5-1.5H21a.75.75 0 00-.75.75v.75m0 0H3.75m0 0h-.375a1.125 1.125 0 01-1.125-1.125V15m1.5 1.5v-.75A.75.75 0 003 15h-.75M15 10.5a3 3 0 11-6 0 3 3 0 016 0zm3 0h.008v.008H18V10.5zm-12 0h.008v.008H6V10.5z" />
                </svg>
              </div>
              <p className="text-sm text-muted">{ta("monthlySavings")}</p>
              <p className="mt-1 text-2xl font-bold text-foreground">
                {overview && pricePerKwh ? `${({ILS: "₪", USD: "$", EUR: "€"} as Record<string,string>)[currency] ?? currency}${Math.round(overview.last_month_kwh * pricePerKwh)}` : "—"}
              </p>
              <p className="mt-1 text-xs text-muted-light">{overview ? `${overview.last_month_kwh} kWh` : ""}</p>
            </div>
          </div>

          {/* Daily Energy Bar Chart */}
          {energy && energy.daily_values.length > 0 && (
            <div className="mb-8 rounded-2xl border border-border bg-surface p-6">
              <h2 className="mb-5 text-lg font-semibold text-foreground">{ta("dailyEnergyChart")}</h2>
              <div className="flex items-end gap-2" style={{ height: 200 }}>
                {energy.daily_values.map((d) => {
                  const pct = maxKwh > 0 ? (d.kwh / maxKwh) * 100 : 0;
                  return (
                    <div key={d.date} className="group relative flex flex-1 flex-col items-center" style={{ height: "100%" }}>
                      <div className="flex w-full flex-1 items-end">
                        <div className="w-full rounded-t-md bg-brand/80 transition-colors group-hover:bg-brand" style={{ height: `${pct}%`, minHeight: pct > 0 ? 4 : 0 }} />
                      </div>
                      <p className="mt-2 text-[10px] text-muted-light">{d.date.slice(5)}</p>
                      <div className="pointer-events-none absolute -top-8 rounded-lg bg-brand-secondary px-2 py-1 text-xs text-white opacity-0 shadow-lg transition-opacity group-hover:opacity-100">
                        {d.kwh} kWh
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}

      {/* ── Soiling Analysis Section ────────────────────────────── */}
      <div className="mb-8 rounded-2xl border border-border bg-surface p-6">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-foreground">{tl("title")}</h2>
          <button onClick={fetchSoiling} disabled={soilingLoading}
            className="rounded-xl bg-brand px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-hover disabled:opacity-50">
            {soilingLoading ? tl("analyzing") : tl("runAnalysis")}
          </button>
        </div>

        {soilingError && (
          <div className="mb-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400">{soilingError}</div>
        )}
        {!soilingData && !soilingError && !soilingLoading && (
          <p className="text-sm text-muted">{tl("description")}</p>
        )}

        {soilingData && (() => {
          const { summary, daily, events, monetary } = soilingData;
          const sym = monetary.currency_symbol;
          return (
            <>
              {/* Summary cards */}
              <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <div className="rounded-xl border border-border p-4">
                  <p className="text-xs text-muted">{tl("soilingRatio")}</p>
                  <p className={`mt-1 text-xl font-bold ${summary.current_sr >= 0.95 ? "text-accent" : summary.current_sr >= 0.90 ? "text-brand" : "text-red-600"}`}>
                    {(summary.current_sr * 100).toFixed(1)}%
                  </p>
                </div>
                <div className="rounded-xl border border-border p-4">
                  <p className="text-xs text-muted">{tl("currentLoss")}</p>
                  <p className={`mt-1 text-xl font-bold ${summary.current_loss_pct > 15 ? "text-red-600" : summary.current_loss_pct > 5 ? "text-brand" : "text-accent"}`}>
                    {summary.current_loss_pct.toFixed(1)}%
                  </p>
                </div>
                <div className="rounded-xl border border-border p-4">
                  <p className="text-xs text-muted">{tl("totalLostEnergy")}</p>
                  <p className="mt-1 text-xl font-bold text-foreground">{Math.round(summary.total_lost_kwh)} kWh</p>
                </div>
                <div className="rounded-xl border border-border p-4">
                  <p className="text-xs text-muted">{tl("cleaningEvents")}</p>
                  <p className="mt-1 text-xl font-bold text-foreground">{summary.n_cleaning_events}</p>
                </div>
              </div>

              {/* Seasonal rates */}
              <div className="mb-6 grid gap-4 sm:grid-cols-3">
                <div className="rounded-xl border border-border p-4">
                  <p className="text-xs text-muted">{tl("lossSinceClean")}</p>
                  <p className="mt-1 text-xl font-bold text-foreground">{summary.loss_since_last_clean.toFixed(1)}%</p>
                </div>
                <div className="rounded-xl border border-border p-4">
                  <p className="text-xs text-muted">{tl("summerRate")}</p>
                  <p className="mt-1 text-xl font-bold text-foreground">{summary.avg_summer_rate.toFixed(2)} {tl("perDay")}</p>
                </div>
                <div className="rounded-xl border border-border p-4">
                  <p className="text-xs text-muted">{tl("winterRate")}</p>
                  <p className="mt-1 text-xl font-bold text-foreground">{summary.avg_winter_rate.toFixed(2)} {tl("perDay")}</p>
                </div>
              </div>

              {/* Monetary */}
              {monetary.currency_per_kwh > 0 ? (
                <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  <div className="rounded-xl border border-brand/20 bg-brand-light/30 p-4 dark:border-orange-800 dark:bg-orange-900/10">
                    <p className="text-xs text-muted">{tl("moneyLossMonthly")}</p>
                    <p className="mt-1 text-xl font-bold text-brand">{sym}{monetary.loss_monthly_projected.toFixed(2)}</p>
                    <p className="text-xs text-muted-light">{tl("projected")}</p>
                  </div>
                  <div className="rounded-xl border border-brand/20 bg-brand-light/30 p-4 dark:border-orange-800 dark:bg-orange-900/10">
                    <p className="text-xs text-muted">{tl("moneyLossYearly")}</p>
                    <p className="mt-1 text-xl font-bold text-brand">{sym}{monetary.loss_yearly_projected.toFixed(2)}</p>
                    <p className="text-xs text-muted-light">{tl("projected")}</p>
                  </div>
                  <div className="rounded-xl border border-red-200 bg-red-50/50 p-4 dark:border-red-800 dark:bg-red-900/10">
                    <p className="text-xs text-muted">{tl("totalLostMoney")}</p>
                    <p className="mt-1 text-xl font-bold text-red-600">{sym}{monetary.total_lost_money.toFixed(2)}</p>
                  </div>
                  <div className="rounded-xl border border-red-200 bg-red-50/50 p-4 dark:border-red-800 dark:bg-red-900/10">
                    <p className="text-xs text-muted">{tl("annualAvgLoss")}</p>
                    <p className="mt-1 text-xl font-bold text-red-600">{sym}{monetary.annual_avg_loss.toFixed(2)}</p>
                    <p className="text-xs text-muted-light">{tl("avgDailyLoss")}: {sym}{monetary.avg_daily_loss.toFixed(2)}</p>
                  </div>
                </div>
              ) : (
                <div className="mb-6 rounded-xl border border-border bg-surface-hover p-4 text-sm text-muted">{tl("noPriceSet")}</div>
              )}

              {/* Soiling Timeline */}
              <h3 className="mb-3 text-sm font-medium text-muted">{tl("soilingTimeline")}</h3>
              <div className="flex items-end gap-px" style={{ height: 160 }}>
                {daily.map((d) => {
                  const sr = d.soiling_ratio;
                  if (sr == null) return <div key={d.date} className="flex-1" />;
                  const pct = Math.max(0, Math.min(100, ((sr - 0.8) / 0.2) * 100));
                  const barColor = sr >= 0.95 ? "bg-accent/70" : sr >= 0.90 ? "bg-brand/70" : "bg-red-400";
                  return (
                    <div key={d.date} className="group relative flex flex-1 flex-col items-center" style={{ height: "100%" }}>
                      <div className="flex w-full flex-1 items-end">
                        <div className={`w-full rounded-t-sm ${barColor} opacity-80 transition-opacity group-hover:opacity-100`}
                             style={{ height: `${pct}%`, minHeight: pct > 0 ? 2 : 0 }} />
                      </div>
                      {d.cleaning && <div className="absolute top-0 h-1.5 w-1.5 rounded-full bg-blue-500" />}
                      <div className="pointer-events-none absolute -top-10 z-10 w-max rounded-lg bg-brand-secondary px-2 py-1 text-[10px] leading-relaxed text-white opacity-0 shadow-lg transition-opacity group-hover:opacity-100">
                        {d.date.slice(5)}: {(sr * 100).toFixed(1)}%{d.cleaning ? " ✦" : ""}
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="mt-3 flex gap-4 text-xs text-muted">
                <span className="flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded-sm bg-accent/70" />&gt;95%</span>
                <span className="flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded-sm bg-brand/70" />90–95%</span>
                <span className="flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded-sm bg-red-400" />&lt;90%</span>
                <span className="flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded-full bg-blue-500" />{tl("cleaningEvents")}</span>
              </div>

              {/* Cleaning Events */}
              {events.length > 0 && (
                <div className="mt-6">
                  <h3 className="mb-3 text-sm font-medium text-muted">{tl("cleaningEventsList")}</h3>
                  <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    {events.map((ev) => (
                      <div key={ev.date} className="flex items-center gap-3 rounded-xl border border-border p-3">
                        <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${ev.type === "rain" ? "bg-blue-100 dark:bg-blue-900/30" : "bg-surface-hover"}`}>
                          {ev.type === "rain" ? (
                            <svg className="h-4 w-4 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15a4.5 4.5 0 004.5 4.5H18a3.75 3.75 0 001.332-7.257 3 3 0 00-3.758-3.848 5.25 5.25 0 00-10.233 2.33A4.502 4.502 0 002.25 15z" /></svg>
                          ) : (
                            <svg className="h-4 w-4 text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" /></svg>
                          )}
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-foreground">{ev.date}</p>
                          <p className="truncate text-xs text-muted">
                            {ev.type === "rain" ? tl("eventRain") : tl("eventManual")}
                            {ev.type === "rain" && ev.rain_mm > 0 && ` · ${tl("rainMm", { mm: ev.rain_mm.toFixed(1) })}`}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Analysis range */}
              <p className="mt-6 text-xs text-muted-light">{tl("analysisRange", { start: summary.analysis_start, end: summary.analysis_end, days: summary.n_days })}</p>
            </>
          );
        })()}
      </div>

      {/* ── Panel Performance Section ─────────────────────────── */}
      <div className="mb-8 rounded-2xl border border-border bg-surface p-6">
        <h2 className="mb-2 text-lg font-semibold text-foreground">{tp("title")}</h2>
        <p className="mb-4 text-sm text-muted">{tp("description")}</p>

        {panelLoading && (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-20 animate-pulse rounded-xl bg-border-light" />
            ))}
          </div>
        )}

        {!panelLoading && panelData && panelData.length > 0 && (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {panelData.map((panel) => {
              const statusColors = {
                underperforming: "border-red-200 bg-red-50/50 dark:border-red-800 dark:bg-red-900/10",
                normal: "border-border bg-surface",
                above_average: "border-accent/20 bg-accent-light/20 dark:border-green-800 dark:bg-green-900/10",
              };
              const deviationColor = panel.deviation_pct < -10 ? "text-red-600" : panel.deviation_pct > 10 ? "text-accent" : "text-muted";
              const statusLabel = panel.status === "underperforming" ? tp("underperforming") : panel.status === "above_average" ? tp("aboveAvg") : tp("normal");

              return (
                <div key={panel.serial_number} className={`rounded-xl border p-4 ${statusColors[panel.status]}`}>
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-medium text-foreground">{panel.name || panel.serial_number}</p>
                    <span className={`text-xs font-semibold ${deviationColor}`}>
                      {panel.deviation_pct > 0 ? "+" : ""}{panel.deviation_pct.toFixed(1)}%
                    </span>
                  </div>
                  <div className="mt-2 flex items-center justify-between">
                    <span className="text-xs text-muted">{panel.total_energy_kwh.toFixed(1)} kWh</span>
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                      panel.status === "underperforming" ? "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
                        : panel.status === "above_average" ? "bg-accent-light text-accent dark:bg-green-900/30 dark:text-green-400"
                        : "bg-surface-hover text-muted"
                    }`}>
                      {statusLabel}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {!panelLoading && (!panelData || panelData.length === 0) && (
          <p className="text-sm text-muted-light">{tp("noData")}</p>
        )}
      </div>

      {/* Insight Cards */}
      {data && (
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {energy && (
            <div className="rounded-2xl border border-border bg-surface p-5">
              <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-accent-light">
                <svg className="h-5 w-5 text-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M16.5 18.75h-9m9 0a3 3 0 013 3h-15a3 3 0 013-3m9 0v-3.375c0-.621-.503-1.125-1.125-1.125h-.871M7.5 18.75v-3.375c0-.621.504-1.125 1.125-1.125h.872m5.007 0H9.497m5.007 0a7.454 7.454 0 01-.982-3.172M9.497 14.25a7.454 7.454 0 00.981-3.172M5.25 4.236c-.996.178-1.768.921-1.768 1.764 0 .966.933 1.75 2.084 1.75.253 0 .496-.032.724-.09M17.75 4.236c.996.178 1.768.921 1.768 1.764 0 .966-.933 1.75-2.084 1.75-.253 0-.496-.032-.724-.09" /></svg>
              </div>
              <p className="text-sm font-medium text-foreground">{ta("bestDay")}</p>
              <p className="mt-1 text-lg font-bold text-accent">{energy.best_day.kwh} kWh</p>
              <p className="text-xs text-muted-light">{energy.best_day.date}</p>
            </div>
          )}
          {energy && (
            <div className="rounded-2xl border border-border bg-surface p-5">
              <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-red-100 dark:bg-red-900/30">
                <svg className="h-5 w-5 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M2.25 6L9 12.75l4.286-4.286a11.948 11.948 0 014.306 6.43l.776 2.898m0 0l3.182-5.511m-3.182 5.51l-5.511-3.181" /></svg>
              </div>
              <p className="text-sm font-medium text-foreground">{ta("worstDay")}</p>
              <p className="mt-1 text-lg font-bold text-red-500">{energy.worst_day.kwh} kWh</p>
              <p className="text-xs text-muted-light">{energy.worst_day.date}</p>
            </div>
          )}
          {energy && (
            <div className="rounded-2xl border border-border bg-surface p-5">
              <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-blue-100 dark:bg-blue-900/30">
                <svg className="h-5 w-5 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" /></svg>
              </div>
              <p className="text-sm font-medium text-foreground">{ta("consistency")}</p>
              <p className={`mt-1 text-lg font-bold ${energy.consistency_score >= 70 ? "text-accent" : energy.consistency_score >= 40 ? "text-brand" : "text-red-500"}`}>
                {energy.consistency_score}%
              </p>
              <p className="text-xs text-muted-light">{energy.consistency_score >= 70 ? ta("consistencyGood") : energy.consistency_score >= 40 ? ta("consistencyFair") : ta("consistencyPoor")}</p>
            </div>
          )}
          {overview && <MetricCard label={ta("lifetimeEnergy")} value={`${overview.lifetime_mwh} MWh`} />}
          {overview && <MetricCard label={ta("lastMonth")} value={`${overview.last_month_kwh} kWh`} />}
          {power && <MetricCard label={ta("avgActivePower")} value={`${power.average_active_kw} kW`} sub={ta("activeIntervals", { active: power.active_intervals, total: power.total_intervals })} />}
        </div>
      )}

      {data && (
        <p className="mt-8 text-center text-xs text-muted-light">{ta("analyzedAt", { date: new Date(data.analyzed_at).toLocaleString() })}</p>
      )}
    </div>
  );
}
