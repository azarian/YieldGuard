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

interface Period { start: string; end: string }

interface CoverageData {
  fetched: Period[];
  missing: Period[];
}

interface PeriodsData {
  installation_date: string | null;
  inverter: CoverageData & { count: number };
  optimizer: CoverageData & { count: number };
  site_energy: CoverageData;
}

type SyncState = "idle" | "starting" | "running" | "rate_limited" | "complete" | "error";

/* ── Coverage Timeline ───────────────────────────────────────────────────── */

function CoverageTimeline({
  fetched, missing, installDate,
}: {
  fetched: Period[];
  missing: Period[];
  installDate: string | null;
}) {
  const t = useTranslations("sync");
  const today = new Date().toISOString().split("T")[0];
  const start = installDate ?? "2020-01-01";
  const rangeStartMs = new Date(start).getTime();
  const rangeEndMs = new Date(today).getTime();
  const totalMs = rangeEndMs - rangeStartMs;
  const totalDays = Math.max(1, Math.ceil(totalMs / 86400000));

  function countDays(periods: Period[]): number {
    let days = 0;
    for (const p of periods) {
      const pStart = Math.max(new Date(p.start).getTime(), rangeStartMs);
      const pEnd = Math.min(new Date(p.end).getTime(), rangeEndMs);
      if (pEnd > pStart) days += Math.ceil((pEnd - pStart) / 86400000);
    }
    return days;
  }

  const fetchedDays = countDays(fetched);
  const missingDays = countDays(missing);
  const coveredDays = fetchedDays + missingDays;
  const remainingDays = Math.max(0, totalDays - coveredDays);
  const pct = totalDays > 0 ? Math.min(100, Math.round((coveredDays / totalDays) * 100)) : 0;

  function positionPct(dateStr: string): number {
    const ms = new Date(dateStr).getTime() - rangeStartMs;
    return Math.max(0, Math.min(100, (ms / totalMs) * 100));
  }

  const hasPeriods = fetched.length > 0 || missing.length > 0;

  return (
    <div>
      <div className="relative h-5 overflow-hidden rounded-full bg-border-light">
        {fetched.map((p, i) => {
          const left = positionPct(p.start);
          const right = positionPct(p.end);
          const width = Math.max(0.5, right - left);
          return (
            <div key={`f${i}`} className="absolute inset-y-0 rounded-full bg-accent/70"
              style={{ left: `${left}%`, width: `${width}%` }}
              title={`${t("fetchedLabel")}: ${p.start} → ${p.end}`} />
          );
        })}
        {missing.map((p, i) => {
          const left = positionPct(p.start);
          const right = positionPct(p.end);
          const width = Math.max(0.5, right - left);
          return (
            <div key={`m${i}`} className="absolute inset-y-0 rounded-full bg-muted-light/50"
              style={{ left: `${left}%`, width: `${width}%`, backgroundImage: "repeating-linear-gradient(45deg, transparent, transparent 3px, rgba(0,0,0,0.08) 3px, rgba(0,0,0,0.08) 6px)" }}
              title={`${t("missingLabel")}: ${p.start} → ${p.end}`} />
          );
        })}
      </div>
      <div className="mt-1.5 flex items-center justify-between text-[10px] text-muted-light">
        <span>{start}</span>
        <span className="font-semibold text-muted">{pct}%</span>
        <span>{today}</span>
      </div>
      <div className="mt-1 flex flex-wrap gap-3 text-xs">
        {hasPeriods ? (
          <>
            {fetchedDays > 0 && (
              <span className="flex items-center gap-1 text-accent">
                <span className="inline-block h-2 w-2 rounded-sm bg-accent" />
                {t("totalDaysFetched", { count: fetchedDays })}
              </span>
            )}
            {missingDays > 0 && (
              <span className="flex items-center gap-1 text-muted">
                <span className="inline-block h-2 w-2 rounded-sm bg-muted-light/50" style={{ backgroundImage: "repeating-linear-gradient(45deg, transparent, transparent 2px, rgba(0,0,0,0.15) 2px, rgba(0,0,0,0.15) 4px)" }} />
                {t("totalDaysMissing", { count: missingDays })}
              </span>
            )}
            {remainingDays > 0 && (
              <span className="flex items-center gap-1 text-muted">
                <span className="inline-block h-2 w-2 rounded-sm bg-border-light" />
                {t("totalDaysGap", { count: remainingDays })}
              </span>
            )}
          </>
        ) : (
          <span className="text-muted">{t("noPeriodsYet")}</span>
        )}
      </div>
    </div>
  );
}

/* ── Sync Progress ───────────────────────────────────────────────────────── */

function SyncProgress({
  state, total, completed, equipName, period, rows, countdown,
  errMsg, label, onStart, onCancel, onDismiss,
}: {
  state: SyncState; total: number; completed: number;
  equipName: string; period: string; rows: number; countdown: number;
  errMsg: string; label: string;
  onStart: () => void; onCancel: () => void; onDismiss: () => void;
}) {
  const t = useTranslations("sync");
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0;

  if (state === "starting") {
    return (
      <div className="flex items-center gap-3 rounded-xl border border-brand/20 bg-brand-light/20 p-4">
        <div className="h-5 w-5 animate-spin rounded-full border-2 border-brand border-t-transparent" />
        <p className="text-sm font-medium text-foreground">
          {label === "optimizer" ? t("discoveringOptimizers") : label === "site_energy" ? t("siteEnergySyncing") : t("discovering")}
        </p>
      </div>
    );
  }

  if (state === "running" || state === "rate_limited") {
    return (
      <div className="rounded-xl border border-brand/20 bg-brand-light/20 p-4">
        <div className="mb-3 flex items-center justify-between">
          <p className="text-sm font-semibold text-foreground">
            {state === "rate_limited" ? t("rateLimited") : label === "optimizer" ? t("syncingOptimizers") : t("syncing")}
          </p>
          <button onClick={onCancel} className="rounded-lg border border-border px-3 py-1 text-xs font-medium text-muted hover:bg-surface-hover">{t("cancel")}</button>
        </div>
        <div className="mb-2 h-3 overflow-hidden rounded-full bg-border-light">
          <div className="h-full rounded-full bg-brand transition-all duration-300" style={{ width: `${pct}%` }} />
        </div>
        <div className="flex items-center justify-between text-xs text-muted">
          <span>{completed}/{total} {t("chunks")} ({pct}%)</span>
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
          <p className="text-sm font-semibold text-foreground">{t("complete")}</p>
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
          <p className="text-sm font-semibold text-red-700 dark:text-red-400">{t("error")}</p>
          <button onClick={onStart} className="rounded-lg bg-brand px-3 py-1 text-xs font-medium text-white hover:bg-brand-hover">{t("retry")}</button>
        </div>
        {errMsg && <p className="mt-2 text-xs text-red-600 dark:text-red-400">{errMsg}</p>}
      </div>
    );
  }

  return null;
}

/* ── Page ─────────────────────────────────────────────────────────────────── */

export default function SyncPage() {
  const t = useTranslations("sync");
  const supabase = createClient();

  const [loading, setLoading] = useState(true);
  const [inventory, setInventory] = useState<InventoryData | null>(null);
  const [periods, setPeriods] = useState<PeriodsData | null>(null);

  // Inverter sync
  const [invFrom, setInvFrom] = useState("");
  const [invTo, setInvTo] = useState("");
  const [invState, setInvState] = useState<SyncState>("idle");
  const [invJobId, setInvJobId] = useState<string | null>(null);
  const [invTotal, setInvTotal] = useState(0);
  const [invCompleted, setInvCompleted] = useState(0);
  const [invEquip, setInvEquip] = useState("");
  const [invPeriod, setInvPeriod] = useState("");
  const [invError, setInvError] = useState("");
  const [invRetry, setInvRetry] = useState(0);
  const [invRows, setInvRows] = useState(0);
  const invCancelled = useRef(false);

  // Site energy sync
  const [seFrom, setSeFrom] = useState("");
  const [seTo, setSeTo] = useState("");
  const [seState, setSeState] = useState<SyncState>("idle");
  const [seError, setSeError] = useState("");
  const [seRows, setSeRows] = useState(0);

  // Optimizer sync
  const [optFrom, setOptFrom] = useState("");
  const [optTo, setOptTo] = useState("");
  const [optState, setOptState] = useState<SyncState>("idle");
  const [optJobId, setOptJobId] = useState<string | null>(null);
  const [optTotal, setOptTotal] = useState(0);
  const [optCompleted, setOptCompleted] = useState(0);
  const [optEquip, setOptEquip] = useState("");
  const [optPeriod, setOptPeriod] = useState("");
  const [optError, setOptError] = useState("");
  const [optRetry, setOptRetry] = useState(0);
  const [optRows, setOptRows] = useState(0);
  const optCancelled = useRef(false);

  const [historyOpen, setHistoryOpen] = useState(false);
  const [clearing, setClearing] = useState<string | null>(null);
  const [clearConfirmType, setClearConfirmType] = useState<"inverter" | "site_energy" | "optimizer" | null>(null);

  const anySyncing = invState === "running" || invState === "starting" || invState === "rate_limited"
    || seState === "starting" || optState === "running" || optState === "starting" || optState === "rate_limited";

  async function executeClear(type: "inverter" | "site_energy" | "optimizer") {
    setClearConfirmType(null);
    setClearing(type);
    try {
      const res = await fetch("/api/solar/sync/clear", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type }),
      });
      if (res.ok) {
        await fetchPeriods();
      }
    } catch { /* ignore */ }
    setClearing(null);
  }

  // ── Data fetching ──────────────────────────────────────────────

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
        const today = new Date().toISOString().split("T")[0];
        if (!invTo) setInvTo(today);
        if (!seTo) setSeTo(today);
        if (!optTo) setOptTo(today);
        const instDate = json.installation_date;
        if (!invFrom && instDate) setInvFrom(instDate);
        if (!seFrom && instDate) setSeFrom(instDate);
        if (!optFrom && instDate) setOptFrom(instDate);
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

  // ── Inverter chunk sync ────────────────────────────────────────

  useEffect(() => {
    if (invRetry <= 0) return;
    const timer = setTimeout(() => setInvRetry((c) => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [invRetry]);

  useEffect(() => {
    if (invState === "rate_limited" && invRetry === 0 && invJobId) {
      setInvState("running");
      processInvChunks(invJobId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invRetry, invState]);

  async function processInvChunks(jid: string) {
    while (!invCancelled.current) {
      try {
        const res = await fetch("/api/solar/sync/chunk", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ job_id: jid }),
        });
        const json = await res.json();
        if (!res.ok) { setInvError(json.error || "Unknown error"); setInvState("error"); return; }
        setInvTotal(json.total_chunks ?? 0);
        setInvCompleted(json.completed_chunks ?? 0);
        if (json.current_equipment) setInvEquip(json.current_equipment);
        if (json.current_period) setInvPeriod(json.current_period);
        if (json.rows_inserted) setInvRows((p) => p + json.rows_inserted);
        if (json.status === "rate_limited") { setInvRetry(json.retry_after ?? 60); setInvState("rate_limited"); return; }
        if (json.done || json.status === "complete") { setInvState("complete"); fetchInventory(); fetchPeriods(); return; }
        await new Promise((r) => setTimeout(r, 200));
      } catch (err) { setInvError(err instanceof Error ? err.message : "Network error"); setInvState("error"); return; }
    }
  }

  async function handleInvSync() {
    invCancelled.current = false;
    setInvState("starting"); setInvError(""); setInvRows(0); setInvCompleted(0); setInvTotal(0);
    try {
      const res = await fetch("/api/solar/sync", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date_from: invFrom || undefined, date_to: invTo || undefined }),
      });
      const json = await res.json();
      if (!res.ok) { setInvError(json.message || json.error || "Failed"); setInvState("error"); return; }
      if (json.status === "complete" && !json.job_id) { setInvState("complete"); fetchInventory(); fetchPeriods(); return; }
      const jid = json.job_id; setInvJobId(jid); setInvTotal(json.total_chunks ?? 0);
      setInvState("running"); await processInvChunks(jid);
    } catch (err) { setInvError(err instanceof Error ? err.message : "Network error"); setInvState("error"); }
  }

  // ── Site energy sync ───────────────────────────────────────────

  async function handleSeSync() {
    setSeState("starting"); setSeError(""); setSeRows(0);
    try {
      const res = await fetch("/api/solar/sync/site-energy", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date_from: seFrom || undefined, date_to: seTo || undefined }),
      });
      const json = await res.json();
      if (!res.ok) { setSeError(json.error || "Failed"); setSeState("error"); return; }
      if (json.status === "up_to_date") { setSeRows(0); setSeState("complete"); return; }
      setSeRows(json.records_stored ?? 0);
      setSeState("complete");
      fetchPeriods();
    } catch (err) { setSeError(err instanceof Error ? err.message : "Network error"); setSeState("error"); }
  }

  // ── Optimizer chunk sync ───────────────────────────────────────

  useEffect(() => {
    if (optRetry <= 0) return;
    const timer = setTimeout(() => setOptRetry((c) => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [optRetry]);

  useEffect(() => {
    if (optState === "rate_limited" && optRetry === 0 && optJobId) {
      setOptState("running");
      processOptChunks(optJobId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [optRetry, optState]);

  async function processOptChunks(jid: string) {
    while (!optCancelled.current) {
      try {
        const res = await fetch("/api/solar/sync/optimizers/chunk", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ job_id: jid }),
        });
        const json = await res.json();
        if (!res.ok) { setOptError(json.error || "Unknown error"); setOptState("error"); return; }
        setOptTotal(json.total_chunks ?? 0);
        setOptCompleted(json.completed_chunks ?? 0);
        if (json.current_equipment) setOptEquip(json.current_equipment);
        if (json.current_period) setOptPeriod(json.current_period);
        if (json.rows_inserted) setOptRows((p) => p + json.rows_inserted);
        if (json.status === "rate_limited") { setOptRetry(json.retry_after ?? 60); setOptState("rate_limited"); return; }
        if (json.done || json.status === "complete") { setOptState("complete"); fetchInventory(); fetchPeriods(); return; }
        await new Promise((r) => setTimeout(r, 300));
      } catch (err) { setOptError(err instanceof Error ? err.message : "Network error"); setOptState("error"); return; }
    }
  }

  async function handleOptSync() {
    optCancelled.current = false;
    setOptState("starting"); setOptError(""); setOptRows(0); setOptCompleted(0); setOptTotal(0);
    try {
      const res = await fetch("/api/solar/sync/optimizers", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date_from: optFrom || undefined, date_to: optTo || undefined }),
      });
      const json = await res.json();
      if (!res.ok) { setOptError(json.message || json.error || "Failed"); setOptState("error"); return; }
      if (json.status === "complete" && !json.job_id) { setOptState("complete"); fetchInventory(); fetchPeriods(); return; }
      const jid = json.job_id; setOptJobId(jid); setOptTotal(json.total_chunks ?? 0);
      setOptState("running"); await processOptChunks(jid);
    } catch (err) { setOptError(err instanceof Error ? err.message : "Network error"); setOptState("error"); }
  }

  /* ── Render ──────────────────────────────────────────────────── */

  if (loading) {
    return (
      <div className="mx-auto max-w-5xl px-6 py-12">
        <div className="h-8 w-48 animate-pulse rounded-lg bg-border-light" />
        <div className="mt-6 space-y-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-48 animate-pulse rounded-2xl bg-border-light" />
          ))}
        </div>
      </div>
    );
  }

  const inputClass = "w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm text-foreground focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand disabled:opacity-50";
  const installDate = periods?.installation_date ?? inventory?.installation_date ?? null;

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

      {/* ── Card 1: Inverter Telemetry ───────────────────────────── */}
      <div className="mb-6 rounded-2xl border border-border bg-surface p-6">
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <svg className="h-5 w-5 text-brand" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z" />
            </svg>
            <h2 className="text-lg font-semibold text-foreground">{t("inverterData")}</h2>
            {(periods?.inverter?.count ?? 0) > 0 && (
              <span className="text-xs text-muted">({periods?.inverter?.count} {t("inverterLabel")})</span>
            )}
          </div>
          {(periods?.inverter?.fetched?.length ?? 0) > 0 && (
            <button onClick={() => setClearConfirmType("inverter")} disabled={anySyncing || clearing === "inverter"}
              className="text-muted hover:text-red-600 disabled:opacity-50" title={t("clearData")}>
              {clearing === "inverter" ? (
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-red-400 border-t-transparent" />
              ) : (
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                </svg>
              )}
            </button>
          )}
        </div>
        <p className="mb-4 text-xs text-muted">{t("inverterSyncDesc")}</p>

        <CoverageTimeline
          fetched={periods?.inverter?.fetched ?? []}
          missing={periods?.inverter?.missing ?? []}
          installDate={installDate}
        />

        <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="flex-1">
            <label className="mb-1 block text-xs font-medium text-foreground">{t("dateFrom")}</label>
            <input type="date" value={invFrom} onChange={(e) => setInvFrom(e.target.value)} disabled={anySyncing} className={inputClass} />
          </div>
          <div className="flex-1">
            <label className="mb-1 block text-xs font-medium text-foreground">{t("dateTo")}</label>
            <input type="date" value={invTo} onChange={(e) => setInvTo(e.target.value)} disabled={anySyncing} className={inputClass} />
          </div>
          {invState === "idle" && (
            <button onClick={handleInvSync} disabled={anySyncing}
              className="rounded-xl bg-brand px-6 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-hover disabled:opacity-50">
              {t("startSync")}
            </button>
          )}
        </div>

        <div className="mt-4">
          <SyncProgress state={invState} total={invTotal} completed={invCompleted}
            equipName={invEquip} period={invPeriod} rows={invRows} countdown={invRetry}
            errMsg={invError} label="inverter"
            onStart={handleInvSync} onCancel={() => { invCancelled.current = true; setInvState("idle"); }}
            onDismiss={() => setInvState("idle")} />
        </div>
      </div>

      {/* ── Card 2: Site Energy (15-min) ─────────────────────────── */}
      <div className="mb-6 rounded-2xl border border-border bg-surface p-6">
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <svg className="h-5 w-5 text-brand" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v2.25m6.364.386l-1.591 1.591M21 12h-2.25m-.386 6.364l-1.591-1.591M12 18.75V21m-4.773-4.227l-1.591 1.591M5.25 12H3m4.227-4.773L5.636 5.636M15.75 12a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0z" />
            </svg>
            <h2 className="text-lg font-semibold text-foreground">{t("siteEnergySyncTitle")}</h2>
          </div>
          {(periods?.site_energy?.fetched?.length ?? 0) > 0 && (
            <button onClick={() => setClearConfirmType("site_energy")} disabled={anySyncing || clearing === "site_energy"}
              className="text-muted hover:text-red-600 disabled:opacity-50" title={t("clearData")}>
              {clearing === "site_energy" ? (
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-red-400 border-t-transparent" />
              ) : (
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                </svg>
              )}
            </button>
          )}
        </div>
        <p className="mb-4 text-xs text-muted">{t("siteEnergySyncDesc")}</p>

        <CoverageTimeline
          fetched={periods?.site_energy?.fetched ?? []}
          missing={periods?.site_energy?.missing ?? []}
          installDate={installDate}
        />

        <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="flex-1">
            <label className="mb-1 block text-xs font-medium text-foreground">{t("dateFrom")}</label>
            <input type="date" value={seFrom} onChange={(e) => setSeFrom(e.target.value)} disabled={anySyncing} className={inputClass} />
          </div>
          <div className="flex-1">
            <label className="mb-1 block text-xs font-medium text-foreground">{t("dateTo")}</label>
            <input type="date" value={seTo} onChange={(e) => setSeTo(e.target.value)} disabled={anySyncing} className={inputClass} />
          </div>
          {seState === "idle" && (
            <button onClick={handleSeSync} disabled={anySyncing}
              className="rounded-xl bg-brand px-6 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-hover disabled:opacity-50">
              {t("startSync")}
            </button>
          )}
        </div>

        <div className="mt-4">
          <SyncProgress state={seState} total={1} completed={seState === "complete" ? 1 : 0}
            equipName="" period="" rows={seRows} countdown={0}
            errMsg={seError} label="site_energy"
            onStart={handleSeSync} onCancel={() => setSeState("idle")}
            onDismiss={() => setSeState("idle")} />
        </div>
      </div>

      {/* ── Card 3: Optimizer Telemetry ───────────────────────────── */}
      <div className="mb-6 rounded-2xl border border-border bg-surface p-6">
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <SolarEdgeIcon className="h-5 w-5" />
            <h2 className="text-lg font-semibold text-foreground">{t("optimizerSyncTitle")}</h2>
            {(periods?.optimizer?.count ?? 0) > 0 && (
              <span className="text-xs text-muted">({periods?.optimizer?.count} {t("optimizers")})</span>
            )}
          </div>
          {(periods?.optimizer?.fetched?.length ?? 0) > 0 && (
            <button onClick={() => setClearConfirmType("optimizer")} disabled={anySyncing || clearing === "optimizer"}
              className="text-muted hover:text-red-600 disabled:opacity-50" title={t("clearData")}>
              {clearing === "optimizer" ? (
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-red-400 border-t-transparent" />
              ) : (
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                </svg>
              )}
            </button>
          )}
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
            <p className="mb-4 text-xs font-medium text-accent">{t("portalConnectedAs", { username: inventory?.portal_username ?? "" })}</p>

            <CoverageTimeline
              fetched={periods?.optimizer?.fetched ?? []}
              missing={periods?.optimizer?.missing ?? []}
              installDate={installDate}
            />

            <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end">
              <div className="flex-1">
                <label className="mb-1 block text-xs font-medium text-foreground">{t("dateFrom")}</label>
                <input type="date" value={optFrom} onChange={(e) => setOptFrom(e.target.value)} disabled={anySyncing} className={inputClass} />
              </div>
              <div className="flex-1">
                <label className="mb-1 block text-xs font-medium text-foreground">{t("dateTo")}</label>
                <input type="date" value={optTo} onChange={(e) => setOptTo(e.target.value)} disabled={anySyncing} className={inputClass} />
              </div>
              {optState === "idle" && (
                <button onClick={handleOptSync} disabled={anySyncing}
                  className="rounded-xl bg-brand px-6 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-hover disabled:opacity-50">
                  {t("startSync")}
                </button>
              )}
            </div>

            <div className="mt-4">
              <SyncProgress state={optState} total={optTotal} completed={optCompleted}
                equipName={optEquip} period={optPeriod} rows={optRows} countdown={optRetry}
                errMsg={optError} label="optimizer"
                onStart={handleOptSync} onCancel={() => { optCancelled.current = true; setOptState("idle"); }}
                onDismiss={() => setOptState("idle")} />
            </div>
          </>
        )}
      </div>

      {/* ── Sync History ─────────────────────────────────────────── */}
      {inventory && inventory.sync_history.length > 0 && (
        <div className="rounded-2xl border border-border bg-surface">
          <button type="button" onClick={() => setHistoryOpen(!historyOpen)}
            className="flex w-full items-center justify-between p-5 text-start">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-light">
                <svg className="h-5 w-5 text-brand" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <div>
                <p className="text-sm font-semibold text-foreground">{t("syncHistory")}</p>
                <p className="mt-0.5 text-xs text-muted">{historyOpen ? t("hideHistory") : t("showHistory")}</p>
              </div>
            </div>
            <svg className={`h-5 w-5 text-muted transition-transform ${historyOpen ? "rotate-180" : ""}`}
              fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
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

      {/* ── Clear Confirmation Modal ─────────────────────────────── */}
      {clearConfirmType && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-sm rounded-2xl border border-border bg-surface p-6 shadow-xl">
            <div className="mb-4 flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-red-100 dark:bg-red-900/30">
                <svg className="h-5 w-5 text-red-600 dark:text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                </svg>
              </div>
              <h3 className="text-lg font-semibold text-foreground">{t("clearData")}</h3>
            </div>
            <p className="mb-6 text-sm text-muted">{t("clearConfirm")}</p>
            <div className="flex gap-3 justify-end">
              <button onClick={() => setClearConfirmType(null)}
                className="rounded-xl border border-border px-4 py-2 text-sm font-medium text-muted hover:bg-surface-hover">
                {t("cancel")}
              </button>
              <button onClick={() => executeClear(clearConfirmType)}
                className="rounded-xl bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700">
                {t("clearData")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
