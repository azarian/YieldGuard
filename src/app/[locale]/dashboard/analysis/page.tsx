"use client";

import { useEffect, useState, useCallback } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { createClient } from "@/lib/supabase/client";

/* ── Types ───────────────────────────────────────────────────────────────── */

interface DayValue {
  date: string;
  kwh: number;
}

interface AnalysisResult {
  system: {
    system_name: string;
    site_id: string;
    last_synced_at: string | null;
  };
  analysis: {
    energy?: {
      total_kwh: number;
      average_daily_kwh: number;
      best_day: { date: string; kwh: number };
      worst_day: { date: string; kwh: number };
      trend: { direction: "up" | "down" | "stable"; change_pct: number };
      consistency_score: number;
      daily_values: DayValue[];
      days_analyzed: number;
    };
    power?: {
      peak_kw: number;
      peak_time: string;
      average_active_kw: number;
      active_intervals: number;
      total_intervals: number;
    };
    overview?: {
      lifetime_mwh: number;
      last_month_kwh: number;
      last_day_kwh: number;
      current_power_kw: number;
      is_producing: boolean;
    };
  };
  analyzed_at: string;
}

interface LossDay {
  date: string;
  actual_kwh: number;
  weather_expected_kwh: number;
  clear_sky_expected_kwh: number;
  cloud_loss_kwh: number;
  system_loss_kwh: number;
}

interface MonetaryLoss {
  currency_per_kwh: number;
  loss_today: number;
  loss_7d: number;
  loss_monthly_projected: number;
  loss_yearly_projected: number;
  avg_daily_loss: number;
}

interface LossResult {
  losses: {
    totals: {
      actual_kwh: number;
      weather_expected_kwh: number;
      clear_sky_expected_kwh: number;
      cloud_loss_kwh: number;
      system_loss_kwh: number;
      system_loss_pct: number;
      cloud_loss_pct: number;
    };
    daily: LossDay[];
  };
  monetary: MonetaryLoss | null;
  recommendations_created: number;
}

interface Recommendation {
  id: string;
  type: string;
  severity: "info" | "warning" | "critical";
  title: string;
  message: string;
  status: string;
  created_at: string;
}

/* ── Small components ────────────────────────────────────────────────────── */

function TrendBadge({ direction, pct }: { direction: string; pct: number }) {
  const colors = {
    up: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
    down: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
    stable: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-400",
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
    warning: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400",
    critical: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
  };
  return (
    <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold capitalize ${styles[severity] ?? styles.info}`}>
      {severity}
    </span>
  );
}

/* ── Page ─────────────────────────────────────────────────────────────────── */

export default function AnalysisPage() {
  const t = useTranslations("analysis");
  const tl = useTranslations("losses");
  const tr = useTranslations("recommendations");
  const supabase = createClient();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<AnalysisResult | null>(null);

  const [lossLoading, setLossLoading] = useState(false);
  const [lossError, setLossError] = useState<string | null>(null);
  const [lossData, setLossData] = useState<LossResult | null>(null);

  const [recs, setRecs] = useState<Recommendation[]>([]);
  const [updatingRec, setUpdatingRec] = useState<string | null>(null);

  const getToken = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession();
    return session?.access_token ?? null;
  }, [supabase]);

  /* ── Fetch general analysis ──────────────────────────────── */

  const fetchAnalysis = useCallback(async () => {
    setLoading(true);
    setError(null);
    const token = await getToken();
    if (!token) { setError(t("notAuthenticated")); setLoading(false); return; }

    try {
      const res = await fetch("/api/py/analyze", { headers: { Authorization: `Bearer ${token}` } });
      const json = await res.json();
      if (!res.ok) { setError(json.detail || json.error || t("fetchError")); setLoading(false); return; }
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("fetchError"));
    }
    setLoading(false);
  }, [getToken, t]);

  /* ── Fetch loss analysis ─────────────────────────────────── */

  const fetchLosses = useCallback(async () => {
    setLossLoading(true);
    setLossError(null);
    const token = await getToken();
    if (!token) { setLossError(tl("notAvailable")); setLossLoading(false); return; }

    try {
      const res = await fetch("/api/py/analyze/losses", { headers: { Authorization: `Bearer ${token}` } });
      const json = await res.json();
      if (!res.ok) { setLossError(json.detail || json.error || tl("fetchError")); setLossLoading(false); return; }
      setLossData(json);
      fetchRecs();
    } catch (err) {
      setLossError(err instanceof Error ? err.message : tl("fetchError"));
    }
    setLossLoading(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [getToken, tl]);

  /* ── Fetch recommendations ───────────────────────────────── */

  const fetchRecs = useCallback(async () => {
    const token = await getToken();
    if (!token) return;
    try {
      const res = await fetch("/api/py/recommendations", { headers: { Authorization: `Bearer ${token}` } });
      const json = await res.json();
      if (res.ok) setRecs(json.recommendations ?? []);
    } catch { /* ignore */ }
  }, [getToken]);

  /* ── Update recommendation status ────────────────────────── */

  async function updateRec(id: string, status: "dismissed" | "resolved") {
    setUpdatingRec(id);
    const token = await getToken();
    if (!token) return;
    try {
      await fetch(`/api/py/recommendations/${id}`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      setRecs((prev) => prev.filter((r) => r.id !== id));
    } catch { /* ignore */ }
    setUpdatingRec(null);
  }

  /* ── Init ────────────────────────────────────────────────── */

  useEffect(() => {
    fetchAnalysis();
    fetchRecs();
  }, [fetchAnalysis, fetchRecs]);

  /* ── Loading / error states ──────────────────────────────── */

  if (loading) {
    return (
      <div className="mx-auto max-w-5xl px-6 py-12">
        <div className="h-8 w-56 animate-pulse rounded bg-gray-200 dark:bg-gray-700" />
        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-28 animate-pulse rounded-xl bg-gray-100 dark:bg-gray-800" />
          ))}
        </div>
        <div className="mt-6 h-64 animate-pulse rounded-xl bg-gray-100 dark:bg-gray-800" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="mx-auto max-w-5xl px-6 py-12">
        <Link href="/dashboard" className="mb-6 inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200">
          ← {t("backToDashboard")}
        </Link>
        <div className="rounded-xl border border-red-200 bg-red-50 p-8 text-center dark:border-red-800 dark:bg-red-900/20">
          <p className="text-red-700 dark:text-red-400">{error}</p>
          <button onClick={fetchAnalysis} className="mt-4 rounded-lg bg-yellow-500 px-4 py-2 text-sm font-semibold text-white hover:bg-yellow-600">
            {t("retry")}
          </button>
        </div>
      </div>
    );
  }

  if (!data) return null;

  const { energy, power, overview } = data.analysis;
  const maxKwh = energy ? Math.max(...energy.daily_values.map((d) => d.kwh)) : 0;

  return (
    <div className="mx-auto max-w-5xl px-6 py-12">
      <Link href="/dashboard" className="mb-6 inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200">
        ← {t("backToDashboard")}
      </Link>

      {/* ── Recommendations ───────────────────────────────────── */}
      {recs.length > 0 && (
        <div className="mb-8">
          <h2 className="mb-4 text-lg font-semibold text-gray-900 dark:text-white">
            {tr("title")}
          </h2>
          <div className="space-y-3">
            {recs.map((rec) => (
              <div
                key={rec.id}
                className={`rounded-xl border p-5 ${
                  rec.severity === "critical"
                    ? "border-red-200 bg-red-50/50 dark:border-red-800 dark:bg-red-900/10"
                    : rec.severity === "warning"
                      ? "border-yellow-200 bg-yellow-50/50 dark:border-yellow-800 dark:bg-yellow-900/10"
                      : "border-blue-200 bg-blue-50/50 dark:border-blue-800 dark:bg-blue-900/10"
                }`}
              >
                <div className="mb-2 flex items-center gap-3">
                  <SeverityBadge severity={rec.severity} />
                  <span className="text-sm font-semibold text-gray-900 dark:text-white">{rec.title}</span>
                </div>
                <p className="mb-3 text-sm text-gray-600 dark:text-gray-400">{rec.message}</p>
                <div className="flex gap-2">
                  <button
                    onClick={() => updateRec(rec.id, "dismissed")}
                    disabled={updatingRec === rec.id}
                    className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-100 disabled:opacity-50 dark:border-gray-600 dark:text-gray-400 dark:hover:bg-gray-800"
                  >
                    {tr("dismiss")}
                  </button>
                  <button
                    onClick={() => updateRec(rec.id, "resolved")}
                    disabled={updatingRec === rec.id}
                    className="rounded-lg bg-green-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-green-700 disabled:opacity-50"
                  >
                    {tr("resolve")}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Header ────────────────────────────────────────────── */}
      <div className="mb-8 flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white">{t("title")}</h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            {data.system.system_name} · Site {data.system.site_id}
          </p>
        </div>
        <button onClick={fetchAnalysis} className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800">
          {t("refresh")}
        </button>
      </div>

      {/* ── Key Metric Cards ──────────────────────────────────── */}
      <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl border border-gray-200 p-5 dark:border-gray-700">
          <p className="text-sm text-gray-500 dark:text-gray-400">{t("totalEnergy")}</p>
          <p className="mt-1 text-2xl font-bold text-gray-900 dark:text-white">
            {energy ? `${energy.total_kwh} kWh` : "—"}
          </p>
          <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">
            {energy ? t("daysAnalyzed", { count: energy.days_analyzed }) : ""}
          </p>
        </div>
        <div className="rounded-xl border border-gray-200 p-5 dark:border-gray-700">
          <p className="text-sm text-gray-500 dark:text-gray-400">{t("avgDaily")}</p>
          <p className="mt-1 text-2xl font-bold text-gray-900 dark:text-white">
            {energy ? `${energy.average_daily_kwh} kWh` : "—"}
          </p>
          {energy && <div className="mt-1"><TrendBadge direction={energy.trend.direction} pct={energy.trend.change_pct} /></div>}
        </div>
        <div className="rounded-xl border border-gray-200 p-5 dark:border-gray-700">
          <p className="text-sm text-gray-500 dark:text-gray-400">{t("peakPower")}</p>
          <p className="mt-1 text-2xl font-bold text-gray-900 dark:text-white">{power ? `${power.peak_kw} kW` : "—"}</p>
          <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">{power?.peak_time ?? ""}</p>
        </div>
        <div className="rounded-xl border border-gray-200 p-5 dark:border-gray-700">
          <p className="text-sm text-gray-500 dark:text-gray-400">{t("currentPower")}</p>
          <p className={`mt-1 text-2xl font-bold ${overview?.is_producing ? "text-green-600" : "text-gray-400 dark:text-gray-500"}`}>
            {overview ? `${overview.current_power_kw} kW` : "—"}
          </p>
          <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">
            {overview?.is_producing ? t("producing") : t("notProducing")}
          </p>
        </div>
      </div>

      {/* ── Daily Energy Bar Chart ────────────────────────────── */}
      {energy && energy.daily_values.length > 0 && (
        <div className="mb-8 rounded-xl border border-gray-200 p-6 dark:border-gray-700">
          <h2 className="mb-4 text-lg font-semibold text-gray-900 dark:text-white">{t("dailyEnergyChart")}</h2>
          <div className="flex items-end gap-2" style={{ height: 200 }}>
            {energy.daily_values.map((d) => {
              const pct = maxKwh > 0 ? (d.kwh / maxKwh) * 100 : 0;
              return (
                <div key={d.date} className="group relative flex flex-1 flex-col items-center" style={{ height: "100%" }}>
                  <div className="flex w-full flex-1 items-end">
                    <div className="w-full rounded-t bg-yellow-400 transition-colors group-hover:bg-yellow-500" style={{ height: `${pct}%`, minHeight: pct > 0 ? 4 : 0 }} />
                  </div>
                  <p className="mt-2 text-[10px] text-gray-500 dark:text-gray-400">{d.date.slice(5)}</p>
                  <div className="pointer-events-none absolute -top-8 rounded bg-gray-900 px-2 py-1 text-xs text-white opacity-0 transition-opacity group-hover:opacity-100 dark:bg-gray-700">
                    {d.kwh} kWh
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Loss Analysis Section ─────────────────────────────── */}
      <div className="mb-8 rounded-xl border border-gray-200 p-6 dark:border-gray-700">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">{tl("title")}</h2>
          <button
            onClick={fetchLosses}
            disabled={lossLoading}
            className="rounded-lg bg-yellow-500 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-yellow-600 disabled:opacity-50"
          >
            {lossLoading ? tl("analyzing") : tl("runAnalysis")}
          </button>
        </div>

        {lossError && (
          <div className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-900/30 dark:text-red-400">
            {lossError}
          </div>
        )}

        {!lossData && !lossError && !lossLoading && (
          <p className="text-sm text-gray-500 dark:text-gray-400">{tl("description")}</p>
        )}

        {lossData && (() => {
          const { totals, daily } = lossData.losses;
          const maxBar = Math.max(...daily.map((d) => d.clear_sky_expected_kwh));
          return (
            <>
              {/* Summary cards */}
              <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <div className="rounded-lg border border-gray-200 p-4 dark:border-gray-700">
                  <p className="text-xs text-gray-500 dark:text-gray-400">{tl("systemLoss")}</p>
                  <p className={`mt-1 text-xl font-bold ${totals.system_loss_pct > 15 ? "text-red-600" : totals.system_loss_pct > 8 ? "text-yellow-600" : "text-green-600"}`}>
                    {totals.system_loss_pct}%
                  </p>
                  <p className="text-xs text-gray-400">{totals.system_loss_kwh} kWh</p>
                </div>
                <div className="rounded-lg border border-gray-200 p-4 dark:border-gray-700">
                  <p className="text-xs text-gray-500 dark:text-gray-400">{tl("cloudLoss")}</p>
                  <p className="mt-1 text-xl font-bold text-gray-600 dark:text-gray-300">{totals.cloud_loss_pct}%</p>
                  <p className="text-xs text-gray-400">{totals.cloud_loss_kwh} kWh</p>
                </div>
                <div className="rounded-lg border border-gray-200 p-4 dark:border-gray-700">
                  <p className="text-xs text-gray-500 dark:text-gray-400">{tl("actualProduction")}</p>
                  <p className="mt-1 text-xl font-bold text-gray-900 dark:text-white">{totals.actual_kwh} kWh</p>
                </div>
                <div className="rounded-lg border border-gray-200 p-4 dark:border-gray-700">
                  <p className="text-xs text-gray-500 dark:text-gray-400">{tl("clearSkyPotential")}</p>
                  <p className="mt-1 text-xl font-bold text-gray-900 dark:text-white">{totals.clear_sky_expected_kwh} kWh</p>
                </div>
              </div>

              {/* Monetary loss cards */}
              {lossData.monetary && (
                <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  <div className="rounded-lg border border-red-200 bg-red-50/50 p-4 dark:border-red-800 dark:bg-red-900/10">
                    <p className="text-xs text-gray-500 dark:text-gray-400">{tl("moneyLossToday")}</p>
                    <p className="mt-1 text-xl font-bold text-red-600">{lossData.monetary.loss_today.toFixed(2)}</p>
                    <p className="text-xs text-gray-400">{tl("perDay")}: {lossData.monetary.avg_daily_loss.toFixed(2)}</p>
                  </div>
                  <div className="rounded-lg border border-red-200 bg-red-50/50 p-4 dark:border-red-800 dark:bg-red-900/10">
                    <p className="text-xs text-gray-500 dark:text-gray-400">{tl("moneyLoss7d")}</p>
                    <p className="mt-1 text-xl font-bold text-red-600">{lossData.monetary.loss_7d.toFixed(2)}</p>
                  </div>
                  <div className="rounded-lg border border-orange-200 bg-orange-50/50 p-4 dark:border-orange-800 dark:bg-orange-900/10">
                    <p className="text-xs text-gray-500 dark:text-gray-400">{tl("moneyLossMonthly")}</p>
                    <p className="mt-1 text-xl font-bold text-orange-600">{lossData.monetary.loss_monthly_projected.toFixed(2)}</p>
                    <p className="text-xs text-gray-400">{tl("projected")}</p>
                  </div>
                  <div className="rounded-lg border border-orange-200 bg-orange-50/50 p-4 dark:border-orange-800 dark:bg-orange-900/10">
                    <p className="text-xs text-gray-500 dark:text-gray-400">{tl("moneyLossYearly")}</p>
                    <p className="mt-1 text-xl font-bold text-orange-600">{lossData.monetary.loss_yearly_projected.toFixed(2)}</p>
                    <p className="text-xs text-gray-400">{tl("projected")}</p>
                  </div>
                </div>
              )}
              {!lossData.monetary && (
                <div className="mb-6 rounded-lg border border-gray-200 bg-gray-50 p-4 text-sm text-gray-500 dark:border-gray-700 dark:bg-gray-800/50 dark:text-gray-400">
                  {tl("noPriceSet")}
                </div>
              )}

              {/* Stacked bar chart */}
              <h3 className="mb-3 text-sm font-medium text-gray-700 dark:text-gray-300">{tl("dailyBreakdown")}</h3>
              <div className="flex items-end gap-2" style={{ height: 220 }}>
                {daily.map((d) => {
                  const total = d.clear_sky_expected_kwh || 1;
                  const actualPct = (d.actual_kwh / (maxBar || 1)) * 100;
                  const cloudPct = (d.cloud_loss_kwh / (maxBar || 1)) * 100;
                  const sysPct = (d.system_loss_kwh / (maxBar || 1)) * 100;
                  return (
                    <div key={d.date} className="group relative flex flex-1 flex-col items-center" style={{ height: "100%" }}>
                      <div className="flex w-full flex-1 flex-col-reverse">
                        <div className="w-full bg-yellow-400" style={{ height: `${actualPct}%`, minHeight: actualPct > 0 ? 2 : 0 }} />
                        <div className="w-full bg-gray-300 dark:bg-gray-600" style={{ height: `${cloudPct}%`, minHeight: cloudPct > 0 ? 1 : 0 }} />
                        <div className="w-full rounded-t bg-red-400" style={{ height: `${sysPct}%`, minHeight: sysPct > 0 ? 1 : 0 }} />
                      </div>
                      <p className="mt-2 text-[10px] text-gray-500 dark:text-gray-400">{d.date.slice(5)}</p>
                      <div className="pointer-events-none absolute -top-12 z-10 w-max rounded bg-gray-900 px-2 py-1 text-[10px] leading-relaxed text-white opacity-0 transition-opacity group-hover:opacity-100 dark:bg-gray-700">
                        {tl("actual")}: {d.actual_kwh} kWh<br />
                        {tl("cloudLossShort")}: {d.cloud_loss_kwh} kWh<br />
                        {tl("systemLossShort")}: {d.system_loss_kwh} kWh
                      </div>
                    </div>
                  );
                })}
              </div>
              {/* Legend */}
              <div className="mt-3 flex gap-4 text-xs text-gray-500 dark:text-gray-400">
                <span className="flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded-sm bg-yellow-400" />{tl("actual")}</span>
                <span className="flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded-sm bg-gray-300 dark:bg-gray-600" />{tl("cloudLossShort")}</span>
                <span className="flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded-sm bg-red-400" />{tl("systemLossShort")}</span>
              </div>
            </>
          );
        })()}
      </div>

      {/* ── Insight Cards ─────────────────────────────────────── */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {energy && (
          <div className="rounded-xl border border-gray-200 p-5 dark:border-gray-700">
            <div className="mb-2 text-2xl">🏆</div>
            <p className="text-sm font-medium text-gray-900 dark:text-white">{t("bestDay")}</p>
            <p className="mt-1 text-lg font-bold text-green-600">{energy.best_day.kwh} kWh</p>
            <p className="text-xs text-gray-500 dark:text-gray-400">{energy.best_day.date}</p>
          </div>
        )}
        {energy && (
          <div className="rounded-xl border border-gray-200 p-5 dark:border-gray-700">
            <div className="mb-2 text-2xl">📉</div>
            <p className="text-sm font-medium text-gray-900 dark:text-white">{t("worstDay")}</p>
            <p className="mt-1 text-lg font-bold text-red-500">{energy.worst_day.kwh} kWh</p>
            <p className="text-xs text-gray-500 dark:text-gray-400">{energy.worst_day.date}</p>
          </div>
        )}
        {energy && (
          <div className="rounded-xl border border-gray-200 p-5 dark:border-gray-700">
            <div className="mb-2 text-2xl">📊</div>
            <p className="text-sm font-medium text-gray-900 dark:text-white">{t("consistency")}</p>
            <p className={`mt-1 text-lg font-bold ${energy.consistency_score >= 70 ? "text-green-600" : energy.consistency_score >= 40 ? "text-yellow-600" : "text-red-500"}`}>
              {energy.consistency_score}%
            </p>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              {energy.consistency_score >= 70 ? t("consistencyGood") : energy.consistency_score >= 40 ? t("consistencyFair") : t("consistencyPoor")}
            </p>
          </div>
        )}
        {overview && (
          <div className="rounded-xl border border-gray-200 p-5 dark:border-gray-700">
            <div className="mb-2 text-2xl">⚡</div>
            <p className="text-sm font-medium text-gray-900 dark:text-white">{t("lifetimeEnergy")}</p>
            <p className="mt-1 text-lg font-bold text-gray-900 dark:text-white">{overview.lifetime_mwh} MWh</p>
          </div>
        )}
        {overview && (
          <div className="rounded-xl border border-gray-200 p-5 dark:border-gray-700">
            <div className="mb-2 text-2xl">📅</div>
            <p className="text-sm font-medium text-gray-900 dark:text-white">{t("lastMonth")}</p>
            <p className="mt-1 text-lg font-bold text-gray-900 dark:text-white">{overview.last_month_kwh} kWh</p>
          </div>
        )}
        {power && (
          <div className="rounded-xl border border-gray-200 p-5 dark:border-gray-700">
            <div className="mb-2 text-2xl">🔌</div>
            <p className="text-sm font-medium text-gray-900 dark:text-white">{t("avgActivePower")}</p>
            <p className="mt-1 text-lg font-bold text-gray-900 dark:text-white">{power.average_active_kw} kW</p>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              {t("activeIntervals", { active: power.active_intervals, total: power.total_intervals })}
            </p>
          </div>
        )}
      </div>

      <p className="mt-8 text-center text-xs text-gray-400 dark:text-gray-500">
        {t("analyzedAt", { date: new Date(data.analyzed_at).toLocaleString() })}
      </p>
    </div>
  );
}
