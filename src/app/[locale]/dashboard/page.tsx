"use client";

import { useEffect, useState, useCallback } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { createClient } from "@/lib/supabase/client";
import { LogoIcon } from "@/components/Logo";
import SyncPanel from "@/components/SyncPanel";

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

interface LossDay { date: string; actual_kwh: number; weather_expected_kwh: number; clear_sky_expected_kwh: number; cloud_loss_kwh: number; system_loss_kwh: number }
interface MonetaryLoss { currency_per_kwh: number; loss_today: number; loss_7d: number; loss_monthly_projected: number; loss_yearly_projected: number; avg_daily_loss: number }
interface LossResult {
  losses: { totals: { actual_kwh: number; weather_expected_kwh: number; clear_sky_expected_kwh: number; cloud_loss_kwh: number; system_loss_kwh: number; system_loss_pct: number; cloud_loss_pct: number }; daily: LossDay[] };
  monetary: MonetaryLoss | null; recommendations_created: number;
}
interface Recommendation { id: string; type: string; severity: "info" | "warning" | "critical"; title: string; message: string; status: string; created_at: string }

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

function SeverityBadge({ severity }: { severity: string }) {
  const styles: Record<string, string> = {
    info: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
    warning: "bg-brand-light text-brand dark:bg-yellow-900/30 dark:text-yellow-400",
    critical: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
  };
  return (
    <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold capitalize ${styles[severity] ?? styles.info}`}>
      {severity}
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
  const tr = useTranslations("recommendations");
  const tp = useTranslations("panels");
  const supabase = createClient();

  const [authLoading, setAuthLoading] = useState(true);
  const [hasSystem, setHasSystem] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [data, setData] = useState<AnalysisResult | null>(null);
  const [lossLoading, setLossLoading] = useState(false);
  const [lossError, setLossError] = useState<string | null>(null);
  const [lossData, setLossData] = useState<LossResult | null>(null);
  const [recs, setRecs] = useState<Recommendation[]>([]);
  const [updatingRec, setUpdatingRec] = useState<string | null>(null);
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
      const { data: sys } = await supabase.from("solar_systems").select("id, last_synced_at").eq("user_id", user.id).single();
      setHasSystem(!!sys);
      if (sys) setLastSyncedAt(sys.last_synced_at);
      setAuthLoading(false);
      if (sys) { fetchAnalysis(); fetchRecs(); fetchPanels(); }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleSyncComplete() {
    setLastSyncedAt(new Date().toISOString());
    fetchAnalysis();
    fetchRecs();
    fetchPanels();
  }

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

  const fetchLosses = useCallback(async () => {
    setLossLoading(true); setLossError(null);
    const token = await getToken();
    if (!token) { setLossError(tl("notAvailable")); setLossLoading(false); return; }
    try {
      const res = await fetch("/api/py/analyze/losses", { headers: { Authorization: `Bearer ${token}` } });
      const json = await res.json();
      if (!res.ok) { setLossError(json.detail || json.error || tl("fetchError")); setLossLoading(false); return; }
      setLossData(json); fetchRecs();
    } catch (err) { setLossError(err instanceof Error ? err.message : tl("fetchError")); }
    setLossLoading(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [getToken, tl]);

  const fetchRecs = useCallback(async () => {
    const token = await getToken(); if (!token) return;
    try { const res = await fetch("/api/py/recommendations", { headers: { Authorization: `Bearer ${token}` } }); const json = await res.json(); if (res.ok) setRecs(json.recommendations ?? []); } catch { /* ignore */ }
  }, [getToken]);

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

  async function updateRec(id: string, status: "dismissed" | "resolved") {
    setUpdatingRec(id); const token = await getToken(); if (!token) return;
    try { await fetch(`/api/py/recommendations/${id}`, { method: "PATCH", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ status }) }); setRecs((prev) => prev.filter((r) => r.id !== id)); } catch { /* ignore */ }
    setUpdatingRec(null);
  }

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

      {/* Sync Panel */}
      <div className="mb-8">
        <SyncPanel lastSyncedAt={lastSyncedAt} onSyncComplete={handleSyncComplete} />
      </div>

      {/* Recommendations */}
      {recs.length > 0 && (
        <div className="mb-8">
          <h2 className="mb-4 text-lg font-semibold text-foreground">{tr("title")}</h2>
          <div className="space-y-3">
            {recs.map((rec) => (
              <div key={rec.id}
                className={`rounded-2xl border p-5 ${
                  rec.severity === "critical" ? "border-red-200 bg-red-50/50 dark:border-red-800 dark:bg-red-900/10"
                    : rec.severity === "warning" ? "border-brand/20 bg-brand-light/30 dark:border-yellow-800 dark:bg-yellow-900/10"
                    : "border-blue-200 bg-blue-50/50 dark:border-blue-800 dark:bg-blue-900/10"
                }`}>
                <div className="mb-2 flex items-center gap-3">
                  <SeverityBadge severity={rec.severity} />
                  <span className="text-sm font-semibold text-foreground">{rec.title}</span>
                </div>
                <p className="mb-3 text-sm text-muted">{rec.message}</p>
                <div className="flex gap-2">
                  <button onClick={() => updateRec(rec.id, "dismissed")} disabled={updatingRec === rec.id}
                    className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted hover:bg-surface-hover disabled:opacity-50">
                    {tr("dismiss")}
                  </button>
                  <button onClick={() => updateRec(rec.id, "resolved")} disabled={updatingRec === rec.id}
                    className="rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-hover disabled:opacity-50">
                    {tr("resolve")}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

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

      {/* Key Metric Cards */}
      {data && (
        <>
          <div className="mb-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-2xl border border-border bg-surface p-5">
              <p className="text-sm text-muted">{ta("totalEnergy")}</p>
              <p className="mt-1 text-2xl font-bold text-foreground">{energy ? `${energy.total_kwh} kWh` : "—"}</p>
              <p className="mt-1 text-xs text-muted-light">{energy ? ta("daysAnalyzed", { count: energy.days_analyzed }) : ""}</p>
            </div>
            <div className="rounded-2xl border border-border bg-surface p-5">
              <p className="text-sm text-muted">{ta("avgDaily")}</p>
              <p className="mt-1 text-2xl font-bold text-foreground">{energy ? `${energy.average_daily_kwh} kWh` : "—"}</p>
              {energy && <div className="mt-1"><TrendBadge direction={energy.trend.direction} pct={energy.trend.change_pct} /></div>}
            </div>
            <MetricCard label={ta("peakPower")} value={power ? `${power.peak_kw} kW` : "—"} sub={power?.peak_time ?? ""} />
            <div className="rounded-2xl border border-border bg-surface p-5">
              <p className="text-sm text-muted">{ta("currentPower")}</p>
              <p className={`mt-1 text-2xl font-bold ${overview?.is_producing ? "text-accent" : "text-muted-light"}`}>
                {overview ? `${overview.current_power_kw} kW` : "—"}
              </p>
              <p className="mt-1 text-xs text-muted-light">{overview?.is_producing ? ta("producing") : overview ? ta("notProducing") : ""}</p>
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

      {/* ── Loss Analysis Section ─────────────────────────────── */}
      <div className="mb-8 rounded-2xl border border-border bg-surface p-6">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-foreground">{tl("title")}</h2>
          <button onClick={fetchLosses} disabled={lossLoading}
            className="rounded-xl bg-brand px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-hover disabled:opacity-50">
            {lossLoading ? tl("analyzing") : tl("runAnalysis")}
          </button>
        </div>

        {lossError && (
          <div className="mb-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400">{lossError}</div>
        )}
        {!lossData && !lossError && !lossLoading && (
          <p className="text-sm text-muted">{tl("description")}</p>
        )}

        {lossData && (() => {
          const { totals, daily } = lossData.losses;
          const maxBar = Math.max(...daily.map((d) => d.clear_sky_expected_kwh));
          return (
            <>
              <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <div className="rounded-xl border border-border p-4">
                  <p className="text-xs text-muted">{tl("systemLoss")}</p>
                  <p className={`mt-1 text-xl font-bold ${totals.system_loss_pct > 15 ? "text-red-600" : totals.system_loss_pct > 8 ? "text-brand" : "text-accent"}`}>
                    {totals.system_loss_pct}%
                  </p>
                  <p className="text-xs text-muted-light">{totals.system_loss_kwh} kWh</p>
                </div>
                <div className="rounded-xl border border-border p-4">
                  <p className="text-xs text-muted">{tl("cloudLoss")}</p>
                  <p className="mt-1 text-xl font-bold text-muted">{totals.cloud_loss_pct}%</p>
                  <p className="text-xs text-muted-light">{totals.cloud_loss_kwh} kWh</p>
                </div>
                <MetricCard label={tl("actualProduction")} value={`${totals.actual_kwh} kWh`} />
                <MetricCard label={tl("clearSkyPotential")} value={`${totals.clear_sky_expected_kwh} kWh`} />
              </div>

              {lossData.monetary && (
                <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  <div className="rounded-xl border border-red-200 bg-red-50/50 p-4 dark:border-red-800 dark:bg-red-900/10">
                    <p className="text-xs text-muted">{tl("moneyLossToday")}</p>
                    <p className="mt-1 text-xl font-bold text-red-600">{lossData.monetary.loss_today.toFixed(2)}</p>
                    <p className="text-xs text-muted-light">{tl("perDay")}: {lossData.monetary.avg_daily_loss.toFixed(2)}</p>
                  </div>
                  <div className="rounded-xl border border-red-200 bg-red-50/50 p-4 dark:border-red-800 dark:bg-red-900/10">
                    <p className="text-xs text-muted">{tl("moneyLoss7d")}</p>
                    <p className="mt-1 text-xl font-bold text-red-600">{lossData.monetary.loss_7d.toFixed(2)}</p>
                  </div>
                  <div className="rounded-xl border border-brand/20 bg-brand-light/30 p-4 dark:border-orange-800 dark:bg-orange-900/10">
                    <p className="text-xs text-muted">{tl("moneyLossMonthly")}</p>
                    <p className="mt-1 text-xl font-bold text-brand">{lossData.monetary.loss_monthly_projected.toFixed(2)}</p>
                    <p className="text-xs text-muted-light">{tl("projected")}</p>
                  </div>
                  <div className="rounded-xl border border-brand/20 bg-brand-light/30 p-4 dark:border-orange-800 dark:bg-orange-900/10">
                    <p className="text-xs text-muted">{tl("moneyLossYearly")}</p>
                    <p className="mt-1 text-xl font-bold text-brand">{lossData.monetary.loss_yearly_projected.toFixed(2)}</p>
                    <p className="text-xs text-muted-light">{tl("projected")}</p>
                  </div>
                </div>
              )}
              {!lossData.monetary && (
                <div className="mb-6 rounded-xl border border-border bg-surface-hover p-4 text-sm text-muted">{tl("noPriceSet")}</div>
              )}

              <h3 className="mb-3 text-sm font-medium text-muted">{tl("dailyBreakdown")}</h3>
              <div className="flex items-end gap-2" style={{ height: 220 }}>
                {daily.map((d) => {
                  const actualPct = (d.actual_kwh / (maxBar || 1)) * 100;
                  const cloudPct = (d.cloud_loss_kwh / (maxBar || 1)) * 100;
                  const sysPct = (d.system_loss_kwh / (maxBar || 1)) * 100;
                  return (
                    <div key={d.date} className="group relative flex flex-1 flex-col items-center" style={{ height: "100%" }}>
                      <div className="flex w-full flex-1 flex-col-reverse">
                        <div className="w-full bg-brand/70" style={{ height: `${actualPct}%`, minHeight: actualPct > 0 ? 2 : 0 }} />
                        <div className="w-full bg-muted-light/30" style={{ height: `${cloudPct}%`, minHeight: cloudPct > 0 ? 1 : 0 }} />
                        <div className="w-full rounded-t bg-red-400" style={{ height: `${sysPct}%`, minHeight: sysPct > 0 ? 1 : 0 }} />
                      </div>
                      <p className="mt-2 text-[10px] text-muted-light">{d.date.slice(5)}</p>
                      <div className="pointer-events-none absolute -top-12 z-10 w-max rounded-lg bg-brand-secondary px-2 py-1 text-[10px] leading-relaxed text-white opacity-0 shadow-lg transition-opacity group-hover:opacity-100">
                        {tl("actual")}: {d.actual_kwh} kWh<br />
                        {tl("cloudLossShort")}: {d.cloud_loss_kwh} kWh<br />
                        {tl("systemLossShort")}: {d.system_loss_kwh} kWh
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="mt-3 flex gap-4 text-xs text-muted">
                <span className="flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded-sm bg-brand/70" />{tl("actual")}</span>
                <span className="flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded-sm bg-muted-light/30" />{tl("cloudLossShort")}</span>
                <span className="flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded-sm bg-red-400" />{tl("systemLossShort")}</span>
              </div>
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
