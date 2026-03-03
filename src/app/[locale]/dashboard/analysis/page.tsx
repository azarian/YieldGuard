"use client";

import { useEffect, useState, useCallback } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { createClient } from "@/lib/supabase/client";

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

function TrendBadge({ direction, pct }: { direction: string; pct: number }) {
  const colors = {
    up: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
    down: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
    stable:
      "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-400",
  };
  const arrows = { up: "↑", down: "↓", stable: "→" };
  const key = direction as keyof typeof colors;

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ${colors[key]}`}
    >
      {arrows[key]} {Math.abs(pct).toFixed(1)}%
    </span>
  );
}

export default function AnalysisPage() {
  const t = useTranslations("analysis");
  const supabase = createClient();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<AnalysisResult | null>(null);

  const fetchAnalysis = useCallback(async () => {
    setLoading(true);
    setError(null);

    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (!session) {
      setError(t("notAuthenticated"));
      setLoading(false);
      return;
    }

    try {
      const res = await fetch("/api/py/analyze", {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      const json = await res.json();

      if (!res.ok) {
        setError(json.detail || json.error || t("fetchError"));
        setLoading(false);
        return;
      }

      setData(json);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : t("fetchError")
      );
    }
    setLoading(false);
  }, [supabase, t]);

  useEffect(() => {
    fetchAnalysis();
  }, [fetchAnalysis]);

  if (loading) {
    return (
      <div className="mx-auto max-w-5xl px-6 py-12">
        <div className="h-8 w-56 animate-pulse rounded bg-gray-200 dark:bg-gray-700" />
        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className="h-28 animate-pulse rounded-xl bg-gray-100 dark:bg-gray-800"
            />
          ))}
        </div>
        <div className="mt-6 h-64 animate-pulse rounded-xl bg-gray-100 dark:bg-gray-800" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="mx-auto max-w-5xl px-6 py-12">
        <Link
          href="/dashboard"
          className="mb-6 inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
        >
          ← {t("backToDashboard")}
        </Link>
        <div className="rounded-xl border border-red-200 bg-red-50 p-8 text-center dark:border-red-800 dark:bg-red-900/20">
          <p className="text-red-700 dark:text-red-400">{error}</p>
          <button
            onClick={fetchAnalysis}
            className="mt-4 rounded-lg bg-yellow-500 px-4 py-2 text-sm font-semibold text-white hover:bg-yellow-600"
          >
            {t("retry")}
          </button>
        </div>
      </div>
    );
  }

  if (!data) return null;

  const { energy, power, overview } = data.analysis;
  const maxKwh = energy
    ? Math.max(...energy.daily_values.map((d) => d.kwh))
    : 0;

  return (
    <div className="mx-auto max-w-5xl px-6 py-12">
      <Link
        href="/dashboard"
        className="mb-6 inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
      >
        ← {t("backToDashboard")}
      </Link>

      <div className="mb-8 flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white">
            {t("title")}
          </h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            {data.system.system_name} · Site {data.system.site_id}
          </p>
        </div>
        <button
          onClick={fetchAnalysis}
          className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800"
        >
          {t("refresh")}
        </button>
      </div>

      {/* ── Key Metric Cards ─────────────────────────────────────── */}
      <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {/* Total Energy */}
        <div className="rounded-xl border border-gray-200 p-5 dark:border-gray-700">
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {t("totalEnergy")}
          </p>
          <p className="mt-1 text-2xl font-bold text-gray-900 dark:text-white">
            {energy ? `${energy.total_kwh} kWh` : "—"}
          </p>
          <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">
            {energy ? t("daysAnalyzed", { count: energy.days_analyzed }) : ""}
          </p>
        </div>

        {/* Avg Daily */}
        <div className="rounded-xl border border-gray-200 p-5 dark:border-gray-700">
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {t("avgDaily")}
          </p>
          <p className="mt-1 text-2xl font-bold text-gray-900 dark:text-white">
            {energy ? `${energy.average_daily_kwh} kWh` : "—"}
          </p>
          {energy && (
            <div className="mt-1">
              <TrendBadge
                direction={energy.trend.direction}
                pct={energy.trend.change_pct}
              />
            </div>
          )}
        </div>

        {/* Peak Power */}
        <div className="rounded-xl border border-gray-200 p-5 dark:border-gray-700">
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {t("peakPower")}
          </p>
          <p className="mt-1 text-2xl font-bold text-gray-900 dark:text-white">
            {power ? `${power.peak_kw} kW` : "—"}
          </p>
          <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">
            {power?.peak_time ?? ""}
          </p>
        </div>

        {/* Current Power */}
        <div className="rounded-xl border border-gray-200 p-5 dark:border-gray-700">
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {t("currentPower")}
          </p>
          <p
            className={`mt-1 text-2xl font-bold ${
              overview?.is_producing
                ? "text-green-600"
                : "text-gray-400 dark:text-gray-500"
            }`}
          >
            {overview ? `${overview.current_power_kw} kW` : "—"}
          </p>
          <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">
            {overview?.is_producing ? t("producing") : t("notProducing")}
          </p>
        </div>
      </div>

      {/* ── Daily Energy Bar Chart ───────────────────────────────── */}
      {energy && energy.daily_values.length > 0 && (
        <div className="mb-8 rounded-xl border border-gray-200 p-6 dark:border-gray-700">
          <h2 className="mb-4 text-lg font-semibold text-gray-900 dark:text-white">
            {t("dailyEnergyChart")}
          </h2>
          <div className="flex items-end gap-2" style={{ height: 200 }}>
            {energy.daily_values.map((d) => {
              const pct = maxKwh > 0 ? (d.kwh / maxKwh) * 100 : 0;
              return (
                <div
                  key={d.date}
                  className="group relative flex flex-1 flex-col items-center"
                  style={{ height: "100%" }}
                >
                  <div className="flex w-full flex-1 items-end">
                    <div
                      className="w-full rounded-t bg-yellow-400 transition-colors group-hover:bg-yellow-500"
                      style={{ height: `${pct}%`, minHeight: pct > 0 ? 4 : 0 }}
                    />
                  </div>
                  <p className="mt-2 text-[10px] text-gray-500 dark:text-gray-400">
                    {d.date.slice(5)}
                  </p>
                  {/* Tooltip */}
                  <div className="pointer-events-none absolute -top-8 rounded bg-gray-900 px-2 py-1 text-xs text-white opacity-0 transition-opacity group-hover:opacity-100 dark:bg-gray-700">
                    {d.kwh} kWh
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Insights Cards ───────────────────────────────────────── */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {/* Best Day */}
        {energy && (
          <div className="rounded-xl border border-gray-200 p-5 dark:border-gray-700">
            <div className="mb-2 text-2xl">🏆</div>
            <p className="text-sm font-medium text-gray-900 dark:text-white">
              {t("bestDay")}
            </p>
            <p className="mt-1 text-lg font-bold text-green-600">
              {energy.best_day.kwh} kWh
            </p>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              {energy.best_day.date}
            </p>
          </div>
        )}

        {/* Worst Day */}
        {energy && (
          <div className="rounded-xl border border-gray-200 p-5 dark:border-gray-700">
            <div className="mb-2 text-2xl">📉</div>
            <p className="text-sm font-medium text-gray-900 dark:text-white">
              {t("worstDay")}
            </p>
            <p className="mt-1 text-lg font-bold text-red-500">
              {energy.worst_day.kwh} kWh
            </p>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              {energy.worst_day.date}
            </p>
          </div>
        )}

        {/* Consistency */}
        {energy && (
          <div className="rounded-xl border border-gray-200 p-5 dark:border-gray-700">
            <div className="mb-2 text-2xl">📊</div>
            <p className="text-sm font-medium text-gray-900 dark:text-white">
              {t("consistency")}
            </p>
            <p
              className={`mt-1 text-lg font-bold ${
                energy.consistency_score >= 70
                  ? "text-green-600"
                  : energy.consistency_score >= 40
                    ? "text-yellow-600"
                    : "text-red-500"
              }`}
            >
              {energy.consistency_score}%
            </p>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              {energy.consistency_score >= 70
                ? t("consistencyGood")
                : energy.consistency_score >= 40
                  ? t("consistencyFair")
                  : t("consistencyPoor")}
            </p>
          </div>
        )}

        {/* Lifetime */}
        {overview && (
          <div className="rounded-xl border border-gray-200 p-5 dark:border-gray-700">
            <div className="mb-2 text-2xl">⚡</div>
            <p className="text-sm font-medium text-gray-900 dark:text-white">
              {t("lifetimeEnergy")}
            </p>
            <p className="mt-1 text-lg font-bold text-gray-900 dark:text-white">
              {overview.lifetime_mwh} MWh
            </p>
          </div>
        )}

        {/* Last Month */}
        {overview && (
          <div className="rounded-xl border border-gray-200 p-5 dark:border-gray-700">
            <div className="mb-2 text-2xl">📅</div>
            <p className="text-sm font-medium text-gray-900 dark:text-white">
              {t("lastMonth")}
            </p>
            <p className="mt-1 text-lg font-bold text-gray-900 dark:text-white">
              {overview.last_month_kwh} kWh
            </p>
          </div>
        )}

        {/* Avg Active Power */}
        {power && (
          <div className="rounded-xl border border-gray-200 p-5 dark:border-gray-700">
            <div className="mb-2 text-2xl">🔌</div>
            <p className="text-sm font-medium text-gray-900 dark:text-white">
              {t("avgActivePower")}
            </p>
            <p className="mt-1 text-lg font-bold text-gray-900 dark:text-white">
              {power.average_active_kw} kW
            </p>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              {t("activeIntervals", {
                active: power.active_intervals,
                total: power.total_intervals,
              })}
            </p>
          </div>
        )}
      </div>

      {/* Footer */}
      <p className="mt-8 text-center text-xs text-gray-400 dark:text-gray-500">
        {t("analyzedAt", {
          date: new Date(data.analyzed_at).toLocaleString(),
        })}
      </p>
    </div>
  );
}
