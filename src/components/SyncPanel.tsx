"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { useTranslations } from "next-intl";

type SyncState = "idle" | "starting" | "running" | "rate_limited" | "complete" | "error";

interface SyncPanelProps {
  lastSyncedAt: string | null;
  onSyncComplete: () => void;
}

export default function SyncPanel({ lastSyncedAt, onSyncComplete }: SyncPanelProps) {
  const t = useTranslations("sync");
  const [state, setState] = useState<SyncState>("idle");
  const [jobId, setJobId] = useState<string | null>(null);
  const [totalChunks, setTotalChunks] = useState(0);
  const [completedChunks, setCompletedChunks] = useState(0);
  const [currentEquipment, setCurrentEquipment] = useState("");
  const [currentPeriod, setCurrentPeriod] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  const [retryCountdown, setRetryCountdown] = useState(0);
  const [rowsTotal, setRowsTotal] = useState(0);
  const cancelledRef = useRef(false);

  const pct = totalChunks > 0 ? Math.round((completedChunks / totalChunks) * 100) : 0;

  // Countdown timer for rate limiting
  useEffect(() => {
    if (retryCountdown <= 0) return;
    const timer = setTimeout(() => setRetryCountdown((c) => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [retryCountdown]);

  // Auto-resume after rate limit countdown
  useEffect(() => {
    if (state === "rate_limited" && retryCountdown === 0 && jobId) {
      resumeSync(jobId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [retryCountdown, state]);

  const resumeSync = useCallback(async (jid: string) => {
    setState("running");
    await processChunks(jid);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function processChunks(jid: string) {
    while (!cancelledRef.current) {
      try {
        const res = await fetch("/api/solar/sync/chunk", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ job_id: jid }),
        });
        const json = await res.json();

        if (!res.ok) {
          setErrorMsg(json.error || "Unknown error");
          setState("error");
          return;
        }

        setTotalChunks(json.total_chunks ?? 0);
        setCompletedChunks(json.completed_chunks ?? 0);
        if (json.current_equipment) setCurrentEquipment(json.current_equipment);
        if (json.current_period) setCurrentPeriod(json.current_period);
        if (json.rows_inserted) setRowsTotal((prev) => prev + json.rows_inserted);

        if (json.status === "rate_limited") {
          const wait = json.retry_after ?? 60;
          setRetryCountdown(wait);
          setState("rate_limited");
          return;
        }

        if (json.done || json.status === "complete") {
          setState("complete");
          onSyncComplete();
          return;
        }

        // Brief delay between chunks to avoid overwhelming the API
        await new Promise((r) => setTimeout(r, 200));
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Network error";
        setErrorMsg(msg);
        setState("error");
        return;
      }
    }
  }

  async function handleStart() {
    cancelledRef.current = false;
    setState("starting");
    setErrorMsg("");
    setRowsTotal(0);
    setCompletedChunks(0);
    setTotalChunks(0);
    setCurrentEquipment("");
    setCurrentPeriod("");

    try {
      const res = await fetch("/api/solar/sync", { method: "POST" });
      const json = await res.json();

      if (!res.ok) {
        setErrorMsg(json.error || "Failed to start sync");
        setState("error");
        return;
      }

      if (json.status === "complete" && !json.job_id) {
        setState("complete");
        onSyncComplete();
        return;
      }

      const jid = json.job_id;
      setJobId(jid);
      setTotalChunks(json.total_chunks ?? 0);
      setCompletedChunks(json.completed_chunks ?? 0);
      setState("running");

      await processChunks(jid);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Network error";
      setErrorMsg(msg);
      setState("error");
    }
  }

  function handleCancel() {
    cancelledRef.current = true;
    setState("idle");
  }

  function handleDismiss() {
    setState("idle");
  }

  if (state === "idle") {
    return (
      <div className="flex items-center gap-3">
        <button
          onClick={handleStart}
          className="rounded-xl bg-brand px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-hover"
        >
          {t("syncNow")}
        </button>
        {lastSyncedAt && (
          <span className="text-xs text-muted">
            {t("lastSynced", { date: new Date(lastSyncedAt).toLocaleString() })}
          </span>
        )}
      </div>
    );
  }

  if (state === "starting") {
    return (
      <div className="rounded-2xl border border-brand/20 bg-brand-light/20 p-5">
        <div className="flex items-center gap-3">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-brand border-t-transparent" />
          <p className="text-sm font-medium text-foreground">{t("discovering")}</p>
        </div>
      </div>
    );
  }

  if (state === "running" || state === "rate_limited") {
    return (
      <div className="rounded-2xl border border-brand/20 bg-brand-light/20 p-5">
        <div className="mb-3 flex items-center justify-between">
          <p className="text-sm font-semibold text-foreground">
            {state === "rate_limited" ? t("rateLimited") : t("syncing")}
          </p>
          <button
            onClick={handleCancel}
            className="rounded-lg border border-border px-3 py-1 text-xs font-medium text-muted hover:bg-surface-hover"
          >
            {t("cancel")}
          </button>
        </div>

        {/* Progress bar */}
        <div className="mb-2 h-3 overflow-hidden rounded-full bg-border-light">
          <div
            className="h-full rounded-full bg-brand transition-all duration-300"
            style={{ width: `${pct}%` }}
          />
        </div>

        <div className="flex items-center justify-between text-xs text-muted">
          <span>
            {completedChunks}/{totalChunks} {t("chunks")} ({pct}%)
          </span>
          {rowsTotal > 0 && (
            <span>
              {rowsTotal.toLocaleString()} {t("dataPoints")}
            </span>
          )}
        </div>

        {currentEquipment && (
          <p className="mt-2 text-xs text-muted-light">
            {t("currentItem", { equipment: currentEquipment, period: currentPeriod })}
          </p>
        )}

        {state === "rate_limited" && retryCountdown > 0 && (
          <p className="mt-2 text-xs font-medium text-brand">
            {t("resumingIn", { seconds: retryCountdown })}
          </p>
        )}
      </div>
    );
  }

  if (state === "complete") {
    return (
      <div className="rounded-2xl border border-accent/20 bg-accent-light/20 p-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <svg className="h-5 w-5 text-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <p className="text-sm font-semibold text-foreground">{t("complete")}</p>
          </div>
          <button
            onClick={handleDismiss}
            className="rounded-lg border border-border px-3 py-1 text-xs font-medium text-muted hover:bg-surface-hover"
          >
            {t("dismiss")}
          </button>
        </div>
        {rowsTotal > 0 && (
          <p className="mt-2 text-xs text-muted">
            {t("completeSummary", { count: rowsTotal.toLocaleString() })}
          </p>
        )}
      </div>
    );
  }

  // Error state
  return (
    <div className="rounded-2xl border border-red-200 bg-red-50/50 p-5 dark:border-red-800 dark:bg-red-900/10">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-red-700 dark:text-red-400">{t("error")}</p>
        <button
          onClick={handleStart}
          className="rounded-lg bg-brand px-3 py-1 text-xs font-medium text-white hover:bg-brand-hover"
        >
          {t("retry")}
        </button>
      </div>
      {errorMsg && <p className="mt-2 text-xs text-red-600 dark:text-red-400">{errorMsg}</p>}
    </div>
  );
}
