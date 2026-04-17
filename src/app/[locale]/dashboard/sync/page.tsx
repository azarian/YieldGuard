"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { createClient } from "@/lib/supabase/client";

/* ── Types ───────────────────────────────────────────────────────────────── */

interface WorkerProgress {
  total_units?: number;
  completed_units?: number;
  current_item?: string;
}

interface WorkerStatus {
  worker_id: string;
  display_name: string;
  description: string | null;
  worker_type: "raw" | "derived" | "analysis";
  status: "idle" | "running" | "paused" | "error";
  progress: WorkerProgress;
  coverage_pct: number;
  last_run_at: string | null;
  error_message: string | null;
  pending_units: number;
}

interface PipelineStatus {
  system_id: string;
  system_name: string;
  installation_date: string | null;
  workers: WorkerStatus[];
}

/* ── Worker Card ─────────────────────────────────────────────────────────── */

function WorkerCard({
  worker,
  isActive,
  onStart,
  onStop,
}: {
  worker: WorkerStatus;
  isActive: boolean;
  onStart: () => void;
  onStop: () => void;
}) {
  const pct = worker.progress.total_units
    ? Math.round(((worker.progress.completed_units ?? 0) / worker.progress.total_units) * 100)
    : 0;

  const statusColors: Record<string, string> = {
    idle: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400",
    running: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
    paused: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
    error: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
  };

  return (
    <div className="rounded-xl border border-border bg-surface p-5">
      <div className="flex items-center justify-between">
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <h3 className="font-semibold text-foreground">{worker.display_name}</h3>
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold capitalize ${statusColors[worker.status]}`}>
              {worker.status}
            </span>
          </div>
          {worker.description && (
            <p className="mt-0.5 text-xs text-muted">{worker.description}</p>
          )}
        </div>
        <div className="flex items-center gap-2">
          {worker.status === "running" || worker.status === "paused" ? (
            <button
              onClick={onStop}
              className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted hover:bg-surface-hover"
            >
              Stop
            </button>
          ) : (
            <button
              onClick={onStart}
              disabled={isActive}
              className="rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-brand-hover disabled:opacity-50"
            >
              {worker.coverage_pct >= 100 ? "Re-sync" : "Start"}
            </button>
          )}
        </div>
      </div>

      {/* Coverage bar */}
      <div className="mt-3">
        <div className="flex items-center justify-between text-[10px] text-muted mb-1">
          <span>Coverage</span>
          <span className="font-semibold">{worker.coverage_pct}%</span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-border-light">
          <div
            className="h-full rounded-full bg-accent/70 transition-all duration-300"
            style={{ width: `${worker.coverage_pct}%` }}
          />
        </div>
      </div>

      {/* Progress (when running) */}
      {(worker.status === "running" || worker.status === "paused") && worker.progress.total_units && (
        <div className="mt-3">
          <div className="h-2.5 overflow-hidden rounded-full bg-border-light">
            <div
              className="h-full rounded-full bg-brand transition-all duration-300"
              style={{ width: `${pct}%` }}
            />
          </div>
          <div className="mt-1 flex items-center justify-between text-xs text-muted">
            <span>
              {worker.progress.completed_units ?? 0}/{worker.progress.total_units} chunks ({pct}%)
            </span>
            {worker.progress.current_item && (
              <span className="text-muted-light">{worker.progress.current_item}</span>
            )}
          </div>
          {worker.status === "paused" && worker.error_message && (
            <p className="mt-1 text-xs font-medium text-amber-600 dark:text-amber-400">
              {worker.error_message}
            </p>
          )}
        </div>
      )}

      {/* Error message */}
      {worker.status === "error" && worker.error_message && (
        <p className="mt-2 text-xs text-red-600 dark:text-red-400">{worker.error_message}</p>
      )}

      {/* Last run */}
      {worker.last_run_at && worker.status === "idle" && (
        <p className="mt-2 text-[10px] text-muted-light">
          Last run: {new Date(worker.last_run_at).toLocaleString()}
        </p>
      )}
    </div>
  );
}

/* ── Worker Group ────────────────────────────────────────────────────────── */

function WorkerGroup({
  title,
  icon,
  workers,
  activeWorkerId,
  onStart,
  onStop,
}: {
  title: string;
  icon: React.ReactNode;
  workers: WorkerStatus[];
  activeWorkerId: string | null;
  onStart: (id: string) => void;
  onStop: (id: string) => void;
}) {
  if (workers.length === 0) return null;

  return (
    <div className="mb-6">
      <div className="mb-3 flex items-center gap-2">
        {icon}
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted">{title}</h2>
      </div>
      <div className="space-y-3">
        {workers.map((w) => (
          <WorkerCard
            key={w.worker_id}
            worker={w}
            isActive={activeWorkerId !== null && activeWorkerId !== w.worker_id}
            onStart={() => onStart(w.worker_id)}
            onStop={() => onStop(w.worker_id)}
          />
        ))}
      </div>
    </div>
  );
}

/* ── Page ─────────────────────────────────────────────────────────────────── */

export default function SyncPage() {
  const t = useTranslations("sync");
  const supabase = createClient();

  const getToken = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession();
    return session?.access_token ?? null;
  }, [supabase]);

  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<PipelineStatus | null>(null);
  const [activeWorkerId, setActiveWorkerId] = useState<string | null>(null);
  const cancelledRef = useRef(false);
  const [countdown, setCountdown] = useState(0);
  const [toast, setToast] = useState<{ type: "success" | "error"; message: string } | null>(null);

  // Fetch pipeline status
  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/solar/pipeline/status");
      if (res.ok) {
        const data: PipelineStatus = await res.json();
        setStatus(data);
        // Detect if any worker is still running (e.g., from a previous session)
        const running = data.workers.find((w) => w.status === "running" || w.status === "paused");
        if (running && !activeWorkerId) {
          setActiveWorkerId(running.worker_id);
        }
      }
    } catch { /* ignore */ }
  }, [activeWorkerId]);

  useEffect(() => {
    fetchStatus().then(() => setLoading(false));
  }, [fetchStatus]);

  // Countdown timer for rate limiting
  useEffect(() => {
    if (countdown <= 0) return;
    const timer = setTimeout(() => setCountdown((c) => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [countdown]);

  // Resume processing after countdown
  useEffect(() => {
    if (countdown === 0 && activeWorkerId) {
      const worker = status?.workers.find((w) => w.worker_id === activeWorkerId);
      if (worker?.status === "paused") {
        processLoop(activeWorkerId);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [countdown]);

  // Process loop — polls /pipeline/process until done
  async function processLoop(workerId: string) {
    cancelledRef.current = false;

    while (!cancelledRef.current) {
      try {
        const res = await fetch("/api/solar/pipeline/process", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ worker_id: workerId }),
        });

        if (res.status === 429) {
          const json = await res.json();
          const retryAfter = json.result?.retry_after ?? 60;
          setCountdown(retryAfter);
          await fetchStatus();
          return; // countdown effect will resume
        }

        const json = await res.json();
        await fetchStatus();

        if (json.done) {
          showToast("success", json.status === "complete" ? "Worker completed successfully" : "Worker finished");
          setActiveWorkerId(null);
          return;
        }

        await new Promise((r) => setTimeout(r, 200));
      } catch {
        await fetchStatus();
        setActiveWorkerId(null);
        return;
      }
    }
  }

  // Show a toast notification
  function showToast(type: "success" | "error", message: string) {
    setToast({ type, message });
    setTimeout(() => setToast(null), 5000);
  }

  // Start a worker
  async function handleStart(workerId: string) {
    setActiveWorkerId(workerId);
    setToast(null);
    try {
      const res = await fetch("/api/solar/pipeline/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ worker_id: workerId }),
      });
      const json = await res.json();

      if (!res.ok) {
        showToast("error", json.error || `Failed to start ${workerId}`);
        setActiveWorkerId(null);
        return;
      }

      if (json.status === "up_to_date" || json.total_units === 0) {
        showToast("success", `${workerId}: already up to date`);
        await fetchStatus();
        setActiveWorkerId(null);
        return;
      }

      showToast("success", `Started ${workerId}: ${json.total_units} chunks to process`);
      await fetchStatus();
      await processLoop(workerId);
    } catch (err) {
      showToast("error", `Failed to start ${workerId}`);
      await fetchStatus();
      setActiveWorkerId(null);
    }
  }

  // Stop a worker
  async function handleStop(workerId: string) {
    cancelledRef.current = true;
    try {
      await fetch("/api/solar/pipeline/stop", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ worker_id: workerId }),
      });
    } catch { /* ignore */ }
    setActiveWorkerId(null);
    setCountdown(0);
    await fetchStatus();
  }

  // Start all workers in dependency order
  async function handleSyncAll() {
    const order = ["inverter_telemetry", "site_energy_15min"];
    for (const workerId of order) {
      const worker = status?.workers.find((w) => w.worker_id === workerId);
      if (worker && worker.coverage_pct < 100) {
        await handleStart(workerId);
        // Wait a beat between workers
        await new Promise((r) => setTimeout(r, 500));
      }
    }
  }

  // Run soiling analysis
  async function handleRunSoiling() {
    setActiveWorkerId("soiling_analysis");
    setToast(null);
    const token = await getToken();
    if (!token) { showToast("error", "Not authenticated"); setActiveWorkerId(null); return; }
    try {
      const res = await fetch("/api/py/analyze/soiling/run", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await res.json();
      if (!res.ok) {
        showToast("error", json.detail || json.error || "Soiling analysis failed");
      } else {
        showToast("success", json.cached ? "Soiling analysis is up to date (cached)" : "Soiling analysis completed");
      }
    } catch {
      showToast("error", "Failed to run soiling analysis");
    }
    setActiveWorkerId(null);
    await fetchStatus();
  }

  // Backfill soiling analysis
  async function handleBackfillSoiling() {
    setActiveWorkerId("soiling_analysis");
    setToast(null);
    const token = await getToken();
    if (!token) { showToast("error", "Not authenticated"); setActiveWorkerId(null); return; }
    try {
      const res = await fetch("/api/py/analyze/soiling/backfill", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await res.json();
      if (!res.ok) {
        showToast("error", json.detail || json.error || "Soiling backfill failed");
      } else {
        showToast("success", "Soiling analysis backfilled successfully");
      }
    } catch {
      showToast("error", "Failed to backfill soiling analysis");
    }
    setActiveWorkerId(null);
    await fetchStatus();
  }

  /* ── Render ──────────────────────────────────────────────────── */

  if (loading) {
    return (
      <div className="mx-auto max-w-3xl px-6 py-12">
        <div className="h-8 w-48 animate-pulse rounded-lg bg-border-light" />
        <div className="mt-6 space-y-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-32 animate-pulse rounded-2xl bg-border-light" />
          ))}
        </div>
      </div>
    );
  }

  const rawWorkers = status?.workers.filter((w) => w.worker_type === "raw") ?? [];
  const derivedWorkers = status?.workers.filter((w) => w.worker_type === "derived") ?? [];
  const analysisWorkers = status?.workers.filter((w) => w.worker_type === "analysis") ?? [];
  const anySyncing = activeWorkerId !== null;

  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      {/* Header */}
      <div className="mb-6">
        <Link href="/dashboard" className="mb-3 inline-flex items-center gap-1 text-sm text-muted hover:text-foreground">
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
          </svg>
          {t("backToDashboard")}
        </Link>
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-foreground">{t("pageTitle")}</h1>
            <p className="mt-1 text-sm text-muted">{t("pageSubtitle")}</p>
          </div>
          <button
            onClick={handleSyncAll}
            disabled={anySyncing}
            className="rounded-xl bg-brand px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-brand-hover disabled:opacity-50"
          >
            Sync All Data
          </button>
        </div>
      </div>

      {/* System info */}
      {status && (
        <div className="mb-6 rounded-xl border border-border bg-surface p-4">
          <div className="flex items-center justify-between text-sm">
            <span className="font-medium text-foreground">{status.system_name}</span>
            <span className="text-xs text-muted">
              Installed: {status.installation_date ?? "Unknown"}
            </span>
          </div>
        </div>
      )}

      {/* Toast notification */}
      {toast && (
        <div className={`mb-4 rounded-xl border p-3 text-sm ${
          toast.type === "error"
            ? "border-red-200 bg-red-50/50 text-red-700 dark:border-red-800 dark:bg-red-900/10 dark:text-red-400"
            : "border-accent/20 bg-accent-light/20 text-accent"
        }`}>
          {toast.message}
        </div>
      )}

      {/* Rate limit countdown */}
      {countdown > 0 && (
        <div className="mb-6 rounded-xl border border-amber-200 bg-amber-50/50 p-4 dark:border-amber-800 dark:bg-amber-900/10">
          <p className="text-sm font-medium text-amber-800 dark:text-amber-300">
            Rate limited by SolarEdge — resuming in {countdown}s...
          </p>
        </div>
      )}

      {/* Raw Data Workers */}
      <WorkerGroup
        title="Raw Data"
        icon={
          <svg className="h-4 w-4 text-brand" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z" />
          </svg>
        }
        workers={rawWorkers}
        activeWorkerId={activeWorkerId}
        onStart={handleStart}
        onStop={handleStop}
      />

      {/* Derived Data Workers */}
      <WorkerGroup
        title="Derived Data"
        icon={
          <svg className="h-4 w-4 text-brand" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v2.25m6.364.386l-1.591 1.591M21 12h-2.25m-.386 6.364l-1.591-1.591M12 18.75V21m-4.773-4.227l-1.591 1.591M5.25 12H3m4.227-4.773L5.636 5.636M15.75 12a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0z" />
          </svg>
        }
        workers={derivedWorkers}
        activeWorkerId={activeWorkerId}
        onStart={handleStart}
        onStop={handleStop}
      />

      {/* Analysis Workers */}
      <div className="mb-6">
        <div className="mb-3 flex items-center gap-2">
          <svg className="h-4 w-4 text-brand" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9.75 3.104v5.714a2.25 2.25 0 01-.659 1.591L5 14.5M9.75 3.104c-.251.023-.501.05-.75.082m.75-.082a24.301 24.301 0 014.5 0m0 0v5.714c0 .597.237 1.17.659 1.591L19.8 15.3M14.25 3.104c.251.023.501.05.75.082M19.8 15.3l-1.57.393A9.065 9.065 0 0112 15a9.065 9.065 0 00-6.23.693L5 14.5m14.8.8l1.402 1.402c1.232 1.232.65 3.318-1.067 3.611l-.772.136a18.156 18.156 0 01-6.326 0l-.772-.136c-1.717-.293-2.3-2.379-1.067-3.61L5 14.5" />
          </svg>
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted">Analysis</h2>
        </div>
        <div className="space-y-3">
          {analysisWorkers.map((w) => (
            <div key={w.worker_id} className="rounded-xl border border-border bg-surface p-5">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-semibold text-foreground">{w.display_name}</h3>
                  {w.description && (
                    <p className="mt-0.5 text-xs text-muted">{w.description}</p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {w.worker_id === "soiling_analysis" && (
                    <>
                      <button
                        onClick={handleRunSoiling}
                        disabled={anySyncing}
                        className="rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-brand-hover disabled:opacity-50"
                      >
                        Run
                      </button>
                      <button
                        onClick={handleBackfillSoiling}
                        disabled={anySyncing}
                        className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted hover:bg-surface-hover disabled:opacity-50"
                      >
                        Backfill
                      </button>
                    </>
                  )}
                </div>
              </div>
              {w.last_run_at && (
                <p className="mt-2 text-[10px] text-muted-light">
                  Last run: {new Date(w.last_run_at).toLocaleString()}
                </p>
              )}
              {activeWorkerId === w.worker_id && (
                <div className="mt-3 flex items-center gap-2">
                  <div className="h-4 w-4 animate-spin rounded-full border-2 border-brand border-t-transparent" />
                  <span className="text-xs text-muted">Running analysis...</span>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
