"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { createClient } from "@/lib/supabase/client";
import { SolarEdgeIcon } from "@/components/SolarEdgeLogo";

/* ── Types ───────────────────────────────────────────────────────────────── */

interface SyncJob {
  id: string;
  status: string;
  total_chunks: number;
  completed_chunks: number;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

interface InventoryData {
  system_name: string;
  last_synced_at: string | null;
  installation_date: string | null;
  equipment: Array<{ equipment_type: string }>;
  inverter_count: number;
  optimizer_count: number;
  date_range: { from: string; to: string } | null;
  sync_history: SyncJob[];
  portal_configured: boolean;
  portal_username: string | null;
}

interface FetchedPeriod {
  start: string;
  end: string;
}

interface PeriodsData {
  installation_date: string | null;
  inverter: { periods: FetchedPeriod[]; count: number };
  optimizer: { periods: FetchedPeriod[]; count: number };
}

type SyncState = "idle" | "starting" | "running" | "rate_limited" | "complete" | "error";

/* ── Timeline Component ──────────────────────────────────────────────────── */

function CoverageTimeline({
  label,
  icon,
  periods,
  installDate,
  count,
}: {
  label: string;
  icon: React.ReactNode;
  periods: FetchedPeriod[];
  installDate: string | null;
  count: number;
}) {
  const t = useTranslations("sync");

  if (count === 0) return null;

  const today = new Date().toISOString().split("T")[0];
  const start = installDate ?? "2020-01-01";
  const totalMs = new Date(today).getTime() - new Date(start).getTime();
  const totalDays = Math.max(1, Math.ceil(totalMs / 86400000));

  let fetchedDays = 0;
  for (const p of periods) {
    const ms = new Date(p.end).getTime() - new Date(p.start).getTime();
    fetchedDays += Math.max(1, Math.ceil(ms / 86400000));
  }
  const gapDays = Math.max(0, totalDays - fetchedDays);
  const pct = totalDays > 0 ? Math.round((fetchedDays / totalDays) * 100) : 0;

  function positionPct(dateStr: string): number {
    const ms = new Date(dateStr).getTime() - new Date(start).getTime();
    return Math.max(0, Math.min(100, (ms / totalMs) * 100));
  }

  return (
    <div className="rounded-xl border border-border bg-background p-4">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          {icon}
          <span className="text-sm font-semibold text-foreground">{label}</span>
        </div>
        <div className="flex items-center gap-3 text-xs">
          {periods.length > 0 ? (
            <>
              <span className="flex items-center gap-1 text-accent">
                <span className="inline-block h-2.5 w-2.5 rounded-sm bg-accent" />
                {t("totalDaysFetched", { count: fetchedDays })}
              </span>
              {gapDays > 0 && (
                <span className="flex items-center gap-1 text-muted">
                  <span className="inline-block h-2.5 w-2.5 rounded-sm bg-border-light" />
                  {t("totalDaysGap", { count: gapDays })}
                </span>
              )}
            </>
          ) : (
            <span className="text-muted">{t("noPeriodsYet")}</span>
          )}
        </div>
      </div>

      {/* Timeline bar */}
      <div className="relative h-6 overflow-hidden rounded-full bg-border-light">
        {periods.map((p, i) => {
          const left = positionPct(p.start);
          const right = positionPct(p.end);
          const width = Math.max(0.5, right - left);
          return (
            <div
              key={i}
              className="absolute inset-y-0 rounded-full bg-accent/70 transition-all"
              style={{ left: `${left}%`, width: `${width}%` }}
              title={`${p.start} → ${p.end}`}
            />
          );
        })}
      </div>

      {/* Date labels */}
      <div className="mt-1.5 flex items-center justify-between text-[10px] text-muted-light">
        <span>{start}</span>
        <span className="font-semibold text-muted">{pct}%</span>
        <span>{today}</span>
      </div>
    </div>
  );
}

/* ── Page ─────────────────────────────────────────────────────────────────── */

export default function SyncPage() {
  const t = useTranslations("sync");
  const supabase = createClient();

  const [loading, setLoading] = useState(true);
  const [inventory, setInventory] = useState<InventoryData | null>(null);
  const [periods, setPeriods] = useState<PeriodsData | null>(null);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  // Inverter sync state
  const [syncState, setSyncState] = useState<SyncState>("idle");
  const [jobId, setJobId] = useState<string | null>(null);
  const [totalChunks, setTotalChunks] = useState(0);
  const [completedChunks, setCompletedChunks] = useState(0);
  const [currentEquipment, setCurrentEquipment] = useState("");
  const [currentPeriod, setCurrentPeriod] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  const [retryCountdown, setRetryCountdown] = useState(0);
  const [rowsTotal, setRowsTotal] = useState(0);
  const cancelledRef = useRef(false);

  // Optimizer sync state
  const [optSyncState, setOptSyncState] = useState<SyncState>("idle");
  const [optJobId, setOptJobId] = useState<string | null>(null);
  const [optTotalChunks, setOptTotalChunks] = useState(0);
  const [optCompletedChunks, setOptCompletedChunks] = useState(0);
  const [optCurrentEquipment, setOptCurrentEquipment] = useState("");
  const [optCurrentPeriod, setOptCurrentPeriod] = useState("");
  const [optErrorMsg, setOptErrorMsg] = useState("");
  const [optRetryCountdown, setOptRetryCountdown] = useState(0);
  const [optRowsTotal, setOptRowsTotal] = useState(0);
  const optCancelledRef = useRef(false);

  // Collapsible history
  const [historyOpen, setHistoryOpen] = useState(false);

  const pct = totalChunks > 0 ? Math.round((completedChunks / totalChunks) * 100) : 0;
  const optPct = optTotalChunks > 0 ? Math.round((optCompletedChunks / optTotalChunks) * 100) : 0;

  const fetchInventory = useCallback(async () => {
    try {
      const res = await fetch("/api/solar/sync/inventory");
      const json = await res.json();
      if (res.ok) setInventory(json);
    } catch { /* ignore */ }
  }, []);

  const fetchPeriods = useCallback(async () => {
    try {
      const res = await fetch("/api/solar/sync/periods");
      const json = await res.json();
      if (res.ok) {
        setPeriods(json);
        // Smart default dates: last fetched end → today
        const today = new Date().toISOString().split("T")[0];
        if (!dateTo) setDateTo(today);
        if (!dateFrom) {
          const allPeriods = [
            ...(json.inverter?.periods ?? []),
            ...(json.optimizer?.periods ?? []),
          ];
          if (allPeriods.length > 0) {
            const latestEnd = allPeriods.reduce(
              (max: string, p: FetchedPeriod) => (p.end > max ? p.end : max),
              allPeriods[0].end
            );
            setDateFrom(latestEnd);
          } else if (json.installation_date) {
            setDateFrom(json.installation_date);
          }
        }
      }
    } catch { /* ignore */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setLoading(false); return; }
      await Promise.all([fetchInventory(), fetchPeriods()]);
      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Countdown timers ────────────────────────────────────────────────
  useEffect(() => {
    if (retryCountdown <= 0) return;
    const timer = setTimeout(() => setRetryCountdown((c) => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [retryCountdown]);

  useEffect(() => {
    if (syncState === "rate_limited" && retryCountdown === 0 && jobId) {
      setSyncState("running");
      processChunks(jobId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [retryCountdown, syncState]);

  useEffect(() => {
    if (optRetryCountdown <= 0) return;
    const timer = setTimeout(() => setOptRetryCountdown((c) => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [optRetryCountdown]);

  useEffect(() => {
    if (optSyncState === "rate_limited" && optRetryCountdown === 0 && optJobId) {
      setOptSyncState("running");
      processOptChunks(optJobId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [optRetryCountdown, optSyncState]);

  // ── Inverter sync logic ─────────────────────────────────────────────

  async function processChunks(jid: string) {
    while (!cancelledRef.current) {
      try {
        const res = await fetch("/api/solar/sync/chunk", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ job_id: jid }),
        });
        const json = await res.json();
        if (!res.ok) { setErrorMsg(json.error || "Unknown error"); setSyncState("error"); return; }
        setTotalChunks(json.total_chunks ?? 0);
        setCompletedChunks(json.completed_chunks ?? 0);
        if (json.current_equipment) setCurrentEquipment(json.current_equipment);
        if (json.current_period) setCurrentPeriod(json.current_period);
        if (json.rows_inserted) setRowsTotal((prev) => prev + json.rows_inserted);
        if (json.status === "rate_limited") { setRetryCountdown(json.retry_after ?? 60); setSyncState("rate_limited"); return; }
        if (json.done || json.status === "complete") {
          setSyncState("complete");
          fetchInventory();
          fetchPeriods();
          return;
        }
        await new Promise((r) => setTimeout(r, 200));
      } catch (err) { setErrorMsg(err instanceof Error ? err.message : "Network error"); setSyncState("error"); return; }
    }
  }

  async function handleStartSync() {
    cancelledRef.current = false;
    setSyncState("starting"); setErrorMsg(""); setRowsTotal(0); setCompletedChunks(0); setTotalChunks(0);
    try {
      const res = await fetch("/api/solar/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date_from: dateFrom || undefined, date_to: dateTo || undefined }),
      });
      const json = await res.json();
      if (!res.ok) { setErrorMsg(json.message || json.error || "Failed to start sync"); setSyncState("error"); return; }
      if (json.status === "complete" && !json.job_id) {
        setSyncState("complete");
        fetchInventory();
        fetchPeriods();
        return;
      }
      const jid = json.job_id; setJobId(jid); setTotalChunks(json.total_chunks ?? 0); setCompletedChunks(json.completed_chunks ?? 0);
      setSyncState("running"); await processChunks(jid);
    } catch (err) { setErrorMsg(err instanceof Error ? err.message : "Network error"); setSyncState("error"); }
  }

  function handleCancel() { cancelledRef.current = true; setSyncState("idle"); }

  // ── Optimizer sync logic ────────────────────────────────────────────

  async function processOptChunks(jid: string) {
    while (!optCancelledRef.current) {
      try {
        const res = await fetch("/api/solar/sync/optimizers/chunk", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ job_id: jid }),
        });
        const json = await res.json();
        if (!res.ok) { setOptErrorMsg(json.error || "Unknown error"); setOptSyncState("error"); return; }
        setOptTotalChunks(json.total_chunks ?? 0);
        setOptCompletedChunks(json.completed_chunks ?? 0);
        if (json.current_equipment) setOptCurrentEquipment(json.current_equipment);
        if (json.current_period) setOptCurrentPeriod(json.current_period);
        if (json.rows_inserted) setOptRowsTotal((prev) => prev + json.rows_inserted);
        if (json.status === "rate_limited") { setOptRetryCountdown(json.retry_after ?? 60); setOptSyncState("rate_limited"); return; }
        if (json.done || json.status === "complete") {
          setOptSyncState("complete");
          fetchInventory();
          fetchPeriods();
          return;
        }
        await new Promise((r) => setTimeout(r, 300));
      } catch (err) { setOptErrorMsg(err instanceof Error ? err.message : "Network error"); setOptSyncState("error"); return; }
    }
  }

  async function handleStartOptSync() {
    optCancelledRef.current = false;
    setOptSyncState("starting"); setOptErrorMsg(""); setOptRowsTotal(0); setOptCompletedChunks(0); setOptTotalChunks(0);
    try {
      const res = await fetch("/api/solar/sync/optimizers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date_from: dateFrom || undefined, date_to: dateTo || undefined }),
      });
      const json = await res.json();
      if (!res.ok) { setOptErrorMsg(json.message || json.error || "Failed to start optimizer sync"); setOptSyncState("error"); return; }
      if (json.status === "complete" && !json.job_id) {
        setOptSyncState("complete");
        fetchInventory();
        fetchPeriods();
        return;
      }
      const jid = json.job_id; setOptJobId(jid); setOptTotalChunks(json.total_chunks ?? 0); setOptCompletedChunks(json.completed_chunks ?? 0);
      setOptSyncState("running"); await processOptChunks(jid);
    } catch (err) { setOptErrorMsg(err instanceof Error ? err.message : "Network error"); setOptSyncState("error"); }
  }

  function handleOptCancel() { optCancelledRef.current = true; setOptSyncState("idle"); }

  /* ── Render ──────────────────────────────────────────────────── */

  if (loading) {
    return (
      <div className="mx-auto max-w-5xl px-6 py-12">
        <div className="h-8 w-48 animate-pulse rounded-lg bg-border-light" />
        <div className="mt-6 space-y-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-24 animate-pulse rounded-2xl bg-border-light" />
          ))}
        </div>
      </div>
    );
  }

  const isSyncing = syncState === "running" || syncState === "starting" || syncState === "rate_limited";
  const isOptSyncing = optSyncState === "running" || optSyncState === "starting" || optSyncState === "rate_limited";

  /* ── Shared sync progress component ─── */
  function renderSyncProgress(
    state: SyncState, total: number, completed: number, pctVal: number,
    equipName: string, period: string, rows: number, countdown: number,
    errMsg: string, label: string,
    onStart: () => void, onCancel: () => void, onDismiss: () => void,
  ) {
    if (state === "starting") {
      return (
        <div className="flex items-center gap-3 rounded-xl border border-brand/20 bg-brand-light/20 p-4">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-brand border-t-transparent" />
          <p className="text-sm font-medium text-foreground">{label === "optimizer" ? t("discoveringOptimizers") : t("discovering")}</p>
        </div>
      );
    }

    if (state === "running" || state === "rate_limited") {
      return (
        <div className="rounded-xl border border-brand/20 bg-brand-light/20 p-4">
          <div className="mb-3 flex items-center justify-between">
            <p className="text-sm font-semibold text-foreground">
              {state === "rate_limited" ? t("rateLimited") : (label === "optimizer" ? t("syncingOptimizers") : t("syncing"))}
            </p>
            <button onClick={onCancel} className="rounded-lg border border-border px-3 py-1 text-xs font-medium text-muted hover:bg-surface-hover">{t("cancel")}</button>
          </div>
          <div className="mb-2 h-3 overflow-hidden rounded-full bg-border-light">
            <div className="h-full rounded-full bg-brand transition-all duration-300" style={{ width: `${pctVal}%` }} />
          </div>
          <div className="flex items-center justify-between text-xs text-muted">
            <span>{completed}/{total} {t("chunks")} ({pctVal}%)</span>
            {rows > 0 && <span>{rows.toLocaleString()} {t("dataPoints")}</span>}
          </div>
          {equipName && <p className="mt-2 text-xs text-muted-light">{t("currentItem", { equipment: equipName, period })}</p>}
          {state === "rate_limited" && countdown > 0 && (
            <p className="mt-2 text-xs font-medium text-brand">{t("resumingIn", { seconds: countdown })}</p>
          )}
        </div>
      );
    }

    if (state === "complete") {
      return (
        <div className="flex items-center gap-3 rounded-xl border border-accent/20 bg-accent-light/20 p-4">
          <svg className="h-5 w-5 text-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <div className="flex-1">
            <p className="text-sm font-semibold text-foreground">{label === "optimizer" ? t("optimizerSyncComplete") : t("complete")}</p>
            {rows > 0 && <p className="text-xs text-muted">{t("completeSummary", { count: rows.toLocaleString() })}</p>}
          </div>
          <button onClick={onDismiss} className="rounded-lg border border-border px-3 py-1 text-xs font-medium text-muted hover:bg-surface-hover">{t("dismiss")}</button>
        </div>
      );
    }

    if (state === "error") {
      return (
        <div className="rounded-xl border border-red-200 bg-red-50/50 p-4 dark:border-red-800 dark:bg-red-900/10">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-red-700 dark:text-red-400">{label === "optimizer" ? t("optimizerSyncError") : t("error")}</p>
            <button onClick={onStart} className="rounded-lg bg-brand px-3 py-1 text-xs font-medium text-white hover:bg-brand-hover">{t("retry")}</button>
          </div>
          {errMsg && <p className="mt-2 text-xs text-red-600 dark:text-red-400">{errMsg}</p>}
        </div>
      );
    }

    return null;
  }

  return (
    <div className="mx-auto max-w-5xl px-6 py-8">
      {/* Header */}
      <div className="mb-8">
        <Link href="/dashboard" className="mb-3 inline-flex items-center gap-1 text-sm text-muted hover:text-foreground">
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
          </svg>
          {t("backToDashboard")}
        </Link>
        <h1 className="text-3xl font-bold text-foreground">{t("pageTitle")}</h1>
        <p className="mt-1 text-sm text-muted">{t("pageSubtitle")}</p>
      </div>

      {/* ── Data Coverage Timeline ──────────────────────────────── */}
      <div className="mb-8 rounded-2xl border border-border bg-surface p-6">
        <h2 className="mb-1 text-lg font-semibold text-foreground">{t("fetchedTimeline")}</h2>
        <p className="mb-5 text-xs text-muted">{t("fetchedTimelineDesc")}</p>

        <div className="space-y-4">
          <CoverageTimeline
            label={t("inverterData")}
            icon={
              <svg className="h-5 w-5 text-brand" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z" />
              </svg>
            }
            periods={periods?.inverter?.periods ?? []}
            installDate={periods?.installation_date ?? inventory?.installation_date ?? null}
            count={periods?.inverter?.count ?? inventory?.inverter_count ?? 0}
          />

          <CoverageTimeline
            label={t("optimizerData")}
            icon={<SolarEdgeIcon className="h-5 w-5" />}
            periods={periods?.optimizer?.periods ?? []}
            installDate={periods?.installation_date ?? inventory?.installation_date ?? null}
            count={periods?.optimizer?.count ?? inventory?.optimizer_count ?? 0}
          />

          {(periods?.inverter?.count === 0 && periods?.optimizer?.count === 0) && (
            <p className="py-4 text-center text-sm text-muted">{t("noPeriodsYet")}</p>
          )}
        </div>
      </div>

      {/* ── Sync Controls ──────────────────────────────────────── */}
      <div className="mb-8 rounded-2xl border border-border bg-surface p-6">
        <h2 className="mb-4 text-lg font-semibold text-foreground">{t("syncControls")}</h2>

        {/* Date range pickers */}
        <div className="mb-5 grid gap-4 sm:grid-cols-2">
          <div>
            <label className="mb-1.5 block text-sm font-medium text-foreground">{t("dateFrom")}</label>
            <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} disabled={isSyncing || isOptSyncing}
              className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm text-foreground focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand disabled:opacity-50" />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-foreground">{t("dateTo")}</label>
            <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} disabled={isSyncing || isOptSyncing}
              className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm text-foreground focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand disabled:opacity-50" />
          </div>
        </div>

        {/* ── Inverter Sync Section ─── */}
        <div className="mb-6">
          <h3 className="mb-3 text-sm font-semibold text-foreground">{t("inverterSync")}</h3>
          {syncState === "idle" && (
            <button onClick={handleStartSync} disabled={isOptSyncing}
              className="rounded-xl bg-brand px-6 py-3 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-hover disabled:opacity-50">
              {t("startSync")}
            </button>
          )}
          {renderSyncProgress(syncState, totalChunks, completedChunks, pct, currentEquipment, currentPeriod, rowsTotal, retryCountdown, errorMsg, "inverter", handleStartSync, handleCancel, () => setSyncState("idle"))}
        </div>

        {/* ── Optimizer Sync Section ─── */}
        <div className="border-t border-border pt-6">
          <div className="mb-3 flex items-center gap-2">
            <SolarEdgeIcon className="h-5 w-5" />
            <h3 className="text-sm font-semibold text-foreground">{t("optimizerSyncTitle")}</h3>
          </div>
          <p className="mb-4 text-xs text-muted">{t("optimizerSyncDesc")}</p>

          {!inventory?.portal_configured ? (
            <div className="rounded-xl border border-amber-200 bg-amber-50/50 p-4 dark:border-amber-800 dark:bg-amber-900/10">
              <p className="mb-1 text-sm font-medium text-amber-800 dark:text-amber-300">{t("portalNotConfigured")}</p>
              <p className="mb-3 text-xs text-amber-700 dark:text-amber-400">{t("portalNotConfiguredDesc")}</p>
              <Link href="/dashboard/system"
                className="inline-flex items-center gap-1 rounded-lg bg-brand px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-hover">
                {t("configureCreds")}
              </Link>
            </div>
          ) : (
            <>
              <p className="mb-4 text-xs font-medium text-accent">{t("portalConnectedAs", { username: inventory.portal_username ?? "" })}</p>
              {optSyncState === "idle" && (
                <button onClick={handleStartOptSync} disabled={isSyncing}
                  className="rounded-xl border-2 border-brand bg-white px-6 py-3 text-sm font-semibold text-brand shadow-sm transition-colors hover:bg-brand hover:text-white disabled:opacity-50 dark:bg-background">
                  {t("startOptimizerSync")}
                </button>
              )}
              {renderSyncProgress(optSyncState, optTotalChunks, optCompletedChunks, optPct, optCurrentEquipment, optCurrentPeriod, optRowsTotal, optRetryCountdown, optErrorMsg, "optimizer", handleStartOptSync, handleOptCancel, () => setOptSyncState("idle"))}
            </>
          )}
        </div>
      </div>

      {/* ── Collapsible Sync History ────────────────────────────── */}
      {inventory && inventory.sync_history.length > 0 && (
        <div className="rounded-2xl border border-border bg-surface">
          <button
            type="button"
            onClick={() => setHistoryOpen(!historyOpen)}
            className="flex w-full items-center justify-between p-5 text-start"
          >
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-light">
                <svg className="h-5 w-5 text-brand" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <div>
                <p className="text-sm font-semibold text-foreground">{t("syncHistory")}</p>
                <p className="mt-0.5 text-xs text-muted">
                  {historyOpen ? t("hideHistory") : t("showHistory")}
                </p>
              </div>
            </div>
            <svg
              className={`h-5 w-5 text-muted transition-transform ${historyOpen ? "rotate-180" : ""}`}
              fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
            </svg>
          </button>

          {historyOpen && (
            <div className="border-t border-border px-5 pb-5 pt-4">
              <div className="space-y-2">
                {inventory.sync_history.map((job) => {
                  const statusColors: Record<string, string> = {
                    complete: "bg-accent-light text-accent dark:bg-green-900/30 dark:text-green-400",
                    running: "bg-brand-light text-brand dark:bg-yellow-900/30 dark:text-yellow-400",
                    paused: "bg-brand-light text-brand dark:bg-yellow-900/30 dark:text-yellow-400",
                    error: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
                  };
                  return (
                    <div key={job.id} className="flex items-center justify-between rounded-xl border border-border p-3">
                      <div className="flex items-center gap-3">
                        <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold capitalize ${statusColors[job.status] ?? statusColors.error}`}>
                          {job.status}
                        </span>
                        <span className="text-sm text-foreground">
                          {job.completed_chunks}/{job.total_chunks} {t("chunks")}
                        </span>
                      </div>
                      <span className="text-xs text-muted">{new Date(job.created_at).toLocaleString()}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
