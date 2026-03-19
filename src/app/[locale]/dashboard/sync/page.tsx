"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { createClient } from "@/lib/supabase/client";
import { SolarEdgeIcon } from "@/components/SolarEdgeLogo";

/* ── Types ───────────────────────────────────────────────────────────────── */

interface EquipmentItem {
  id: string;
  serial_number: string;
  equipment_type: string;
  name: string | null;
  manufacturer: string | null;
  model: string | null;
  connected_to: string | null;
  earliest_data: string | null;
  latest_data: string | null;
  data_points: number;
  has_data: boolean;
}

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
  equipment: EquipmentItem[];
  inverter_count: number;
  optimizer_count: number;
  date_range: { from: string; to: string } | null;
  sync_history: SyncJob[];
  portal_configured: boolean;
  portal_username: string | null;
}

type SyncState = "idle" | "starting" | "running" | "rate_limited" | "complete" | "error";

/* ── Page ─────────────────────────────────────────────────────────────────── */

export default function SyncPage() {
  const t = useTranslations("sync");
  const supabase = createClient();

  const [loading, setLoading] = useState(true);
  const [inventory, setInventory] = useState<InventoryData | null>(null);
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

  const pct = totalChunks > 0 ? Math.round((completedChunks / totalChunks) * 100) : 0;
  const optPct = optTotalChunks > 0 ? Math.round((optCompletedChunks / optTotalChunks) * 100) : 0;

  const fetchInventory = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/solar/sync/inventory");
      const json = await res.json();
      if (res.ok) {
        setInventory(json);
        if (json.installation_date && !dateFrom) setDateFrom(json.installation_date);
        if (!dateTo) setDateTo(new Date().toISOString().split("T")[0]);
      }
    } catch { /* ignore */ }
    setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setLoading(false); return; }
      fetchInventory();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Inverter sync countdown ───────────────────────────────────────────
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

  // ── Optimizer sync countdown ──────────────────────────────────────────
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

  // ── Inverter sync logic ───────────────────────────────────────────────

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
        if (json.done || json.status === "complete") { setSyncState("complete"); fetchInventory(); return; }
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
      if (json.status === "complete" && !json.job_id) { setSyncState("complete"); fetchInventory(); return; }
      const jid = json.job_id; setJobId(jid); setTotalChunks(json.total_chunks ?? 0); setCompletedChunks(json.completed_chunks ?? 0);
      setSyncState("running"); await processChunks(jid);
    } catch (err) { setErrorMsg(err instanceof Error ? err.message : "Network error"); setSyncState("error"); }
  }

  function handleCancel() { cancelledRef.current = true; setSyncState("idle"); }

  // ── Optimizer sync logic ──────────────────────────────────────────────

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
        if (json.done || json.status === "complete") { setOptSyncState("complete"); fetchInventory(); return; }
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
      if (json.status === "complete" && !json.job_id) { setOptSyncState("complete"); fetchInventory(); return; }
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

  const inverters = inventory?.equipment.filter((e) => e.equipment_type === "inverter") ?? [];
  const optimizers = inventory?.equipment.filter((e) => e.equipment_type === "optimizer") ?? [];
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

      {/* ── Overview Stats ─────────────────────────────────────── */}
      <div className="mb-8 grid gap-4 sm:grid-cols-4">
        <div className="rounded-2xl border border-border bg-surface p-5">
          <p className="text-sm text-muted">{t("inverters")}</p>
          <p className="mt-1 text-2xl font-bold text-foreground">{inventory?.inverter_count ?? 0}</p>
        </div>
        <div className="rounded-2xl border border-border bg-surface p-5">
          <p className="text-sm text-muted">{t("optimizers")}</p>
          <p className="mt-1 text-2xl font-bold text-foreground">{inventory?.optimizer_count ?? 0}</p>
        </div>
        <div className="rounded-2xl border border-border bg-surface p-5">
          <p className="text-sm text-muted">{t("dataRange")}</p>
          <p className="mt-1 text-sm font-semibold text-foreground">
            {inventory?.date_range
              ? `${new Date(inventory.date_range.from).toLocaleDateString()} — ${new Date(inventory.date_range.to).toLocaleDateString()}`
              : t("noData")}
          </p>
        </div>
        <div className="rounded-2xl border border-border bg-surface p-5">
          <p className="text-sm text-muted">{t("lastSyncedLabel")}</p>
          <p className="mt-1 text-sm font-semibold text-foreground">
            {inventory?.last_synced_at
              ? new Date(inventory.last_synced_at).toLocaleString()
              : t("neverSynced")}
          </p>
        </div>
      </div>

      {/* ── Equipment Inventory ───────────────────────────────── */}
      <div className="mb-8 rounded-2xl border border-border bg-surface p-6">
        <h2 className="mb-4 text-lg font-semibold text-foreground">{t("equipmentTitle")}</h2>

        {inventory?.equipment.length === 0 && (
          <p className="text-sm text-muted">{t("noEquipment")}</p>
        )}

        {inverters.length > 0 && (
          <div className="mb-4">
            <h3 className="mb-2 text-sm font-medium text-muted">{t("inverters")}</h3>
            <div className="space-y-2">
              {inverters.map((eq) => (
                <div key={eq.id} className="flex items-center justify-between rounded-xl border border-border p-3">
                  <div>
                    <p className="text-sm font-medium text-foreground">{eq.name || eq.serial_number}</p>
                    <p className="text-xs text-muted">{eq.manufacturer} {eq.model}</p>
                  </div>
                  <div className="text-end">
                    {eq.has_data ? (
                      <p className="text-xs text-accent font-medium">
                        {new Date(eq.earliest_data!).toLocaleDateString()} — {new Date(eq.latest_data!).toLocaleDateString()}
                      </p>
                    ) : (
                      <p className="text-xs text-muted-light">{t("noData")}</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {optimizers.length > 0 && (
          <div>
            <h3 className="mb-2 flex items-center gap-2 text-sm font-medium text-muted">
              <SolarEdgeIcon className="h-4 w-4" />
              {t("optimizers")} ({optimizers.length})
            </h3>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {optimizers.map((eq) => (
                <div key={eq.id} className="flex items-center justify-between rounded-xl border border-border p-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-foreground">{eq.name || eq.serial_number}</p>
                    <p className="text-xs text-muted">{eq.serial_number}</p>
                  </div>
                  <div className="ms-2 text-end">
                    {eq.has_data ? (
                      <span className="inline-block rounded-full bg-accent-light px-2 py-0.5 text-[10px] font-semibold text-accent">
                        {new Date(eq.earliest_data!).toLocaleDateString()} — {new Date(eq.latest_data!).toLocaleDateString()}
                      </span>
                    ) : (
                      <span className="text-xs text-muted-light">{t("noData")}</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ── Date Range Picker (shared) ─────────────────────────── */}
      <div className="mb-8 rounded-2xl border border-border bg-surface p-6">
        <h2 className="mb-4 text-lg font-semibold text-foreground">{t("syncControls")}</h2>
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
              <p className="mb-4 text-xs text-accent font-medium">{t("portalConnectedAs", { username: inventory.portal_username ?? "" })}</p>
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

      {/* ── Sync History ──────────────────────────────────────── */}
      {inventory && inventory.sync_history.length > 0 && (
        <div className="rounded-2xl border border-border bg-surface p-6">
          <h2 className="mb-4 text-lg font-semibold text-foreground">{t("syncHistory")}</h2>
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
  );
}
