/**
 * Pipeline engine — orchestrates worker planning and execution.
 *
 * The engine is stateless; all state lives in the database tables:
 * - worker_state: per-system per-worker status
 * - work_units: the queue of chunks to process
 * - data_coverage: what data has been fetched
 *
 * The frontend drives execution by calling:
 * 1. startWorker()   — plan work units, set status=running
 * 2. processNext()   — execute the next pending unit (called in a polling loop)
 * 3. stopWorker()    — set status=idle, stop processing
 * 4. getStatus()     — return all worker states for the UI
 */

import { SupabaseClient } from "@supabase/supabase-js";
import { computeGaps } from "@/lib/sync-periods";
import type {
  PipelineWorker,
  WorkUnit,
  WorkUnitResult,
  WorkerState,
  WorkerProgress,
  WorkerStatus,
  PipelineStatus,
} from "./types";

// ── Worker registry ─────────────────────────────────────────────────────────

const workerRegistry = new Map<string, PipelineWorker>();

export function registerWorker(worker: PipelineWorker): void {
  workerRegistry.set(worker.id, worker);
}

export function getWorker(id: string): PipelineWorker | undefined {
  return workerRegistry.get(id);
}

// ── Start a worker ──────────────────────────────────────────────────────────

export async function startWorker(
  workerId: string,
  systemId: string,
  supabase: SupabaseClient,
): Promise<{ total_units: number; status: string }> {
  const worker = workerRegistry.get(workerId);
  if (!worker) {
    throw new Error(`Unknown worker: ${workerId}`);
  }

  // Check if already running
  const { data: existing } = await supabase
    .from("worker_state")
    .select("status")
    .eq("system_id", systemId)
    .eq("worker_id", workerId)
    .single();

  if (existing?.status === "running") {
    // Count remaining units
    const { count } = await supabase
      .from("work_units")
      .select("*", { count: "exact", head: true })
      .eq("system_id", systemId)
      .eq("worker_id", workerId)
      .eq("status", "pending");

    return { total_units: count ?? 0, status: "already_running" };
  }

  // Plan work units
  const planned = await worker.plan(systemId, supabase);

  if (planned.length === 0) {
    // Nothing to do — mark as idle with updated timestamp
    await upsertWorkerState(supabase, systemId, workerId, {
      status: "idle",
      last_run_at: new Date().toISOString(),
      progress: { total_units: 0, completed_units: 0 },
      error_message: null,
    });
    return { total_units: 0, status: "up_to_date" };
  }

  // Clear any old pending/error units for this worker
  await supabase
    .from("work_units")
    .delete()
    .eq("system_id", systemId)
    .eq("worker_id", workerId)
    .in("status", ["pending", "error"]);

  // Insert new work units
  const units = planned.map((u) => ({
    system_id: systemId,
    worker_id: workerId,
    equipment_id: u.equipment_id ?? null,
    period_start: u.period_start ?? null,
    period_end: u.period_end ?? null,
    status: "pending" as const,
  }));

  const BATCH = 500;
  for (let i = 0; i < units.length; i += BATCH) {
    await supabase.from("work_units").insert(units.slice(i, i + BATCH));
  }

  // Set worker state to running
  await upsertWorkerState(supabase, systemId, workerId, {
    status: "running",
    progress: { total_units: units.length, completed_units: 0 },
    error_message: null,
  });

  return { total_units: units.length, status: "started" };
}

// ── Process next work unit ──────────────────────────────────────────────────

export async function processNext(
  workerId: string,
  systemId: string,
  supabase: SupabaseClient,
): Promise<{
  status: string;
  progress: WorkerProgress;
  result?: WorkUnitResult;
  done: boolean;
}> {
  const worker = workerRegistry.get(workerId);
  if (!worker) {
    throw new Error(`Unknown worker: ${workerId}`);
  }

  // Check worker state
  const { data: state } = await supabase
    .from("worker_state")
    .select("status, progress")
    .eq("system_id", systemId)
    .eq("worker_id", workerId)
    .single();

  if (!state || state.status !== "running") {
    return {
      status: state?.status ?? "idle",
      progress: state?.progress ?? {},
      done: true,
    };
  }

  // Get next pending unit
  const { data: units } = await supabase
    .from("work_units")
    .select("*")
    .eq("system_id", systemId)
    .eq("worker_id", workerId)
    .eq("status", "pending")
    .order("period_start", { ascending: true })
    .limit(1);

  if (!units || units.length === 0) {
    // All done
    await upsertWorkerState(supabase, systemId, workerId, {
      status: "idle",
      last_run_at: new Date().toISOString(),
      progress: state.progress,
      error_message: null,
    });
    return { status: "complete", progress: state.progress, done: true };
  }

  const unit = units[0] as WorkUnit;

  // Mark unit as running
  await supabase
    .from("work_units")
    .update({ status: "running" })
    .eq("id", unit.id);

  // Execute
  const result = await worker.execute(unit, supabase);

  // Update unit status
  await supabase
    .from("work_units")
    .update({
      status: result.status === "rate_limited" ? "pending" : result.status,
      error_message: result.error_message ?? null,
      records_stored: result.records_stored,
      processed_at: new Date().toISOString(),
    })
    .eq("id", unit.id);

  // Update progress
  const completed = ((state.progress as WorkerProgress).completed_units ?? 0) + 1;
  const total = (state.progress as WorkerProgress).total_units ?? 0;
  const currentItem = unit.period_start
    ? `${unit.period_start} → ${unit.period_end}`
    : undefined;

  const newProgress: WorkerProgress = {
    total_units: total,
    completed_units: completed,
    current_item: currentItem,
  };

  if (result.status === "rate_limited") {
    await upsertWorkerState(supabase, systemId, workerId, {
      status: "paused",
      progress: newProgress,
      error_message: `Rate limited — retry after ${result.retry_after ?? 60}s`,
    });
    return {
      status: "rate_limited",
      progress: newProgress,
      result,
      done: false,
    };
  }

  await upsertWorkerState(supabase, systemId, workerId, {
    status: "running",
    progress: newProgress,
    error_message: result.status === "error" ? result.error_message : null,
  });

  return {
    status: "running",
    progress: newProgress,
    result,
    done: false,
  };
}

// ── Stop a worker ───────────────────────────────────────────────────────────

export async function stopWorker(
  workerId: string,
  systemId: string,
  supabase: SupabaseClient,
): Promise<void> {
  await upsertWorkerState(supabase, systemId, workerId, {
    status: "idle",
  });
}

// ── Get pipeline status ─────────────────────────────────────────────────────

export async function getStatus(
  systemId: string,
  supabase: SupabaseClient,
): Promise<PipelineStatus> {
  // Get system info
  const { data: system } = await supabase
    .from("solar_systems")
    .select("id, system_name, installation_date")
    .eq("id", systemId)
    .single();

  // Get worker definitions
  const { data: workerDefs } = await supabase
    .from("pipeline_workers")
    .select("*")
    .eq("enabled", true)
    .order("id");

  // Get worker states
  const { data: states } = await supabase
    .from("worker_state")
    .select("*")
    .eq("system_id", systemId);

  // Get pending unit counts
  const { data: pendingCounts } = await supabase
    .from("work_units")
    .select("worker_id")
    .eq("system_id", systemId)
    .eq("status", "pending");

  // Get coverage data for computing percentages
  const { data: coverage } = await supabase
    .from("data_coverage")
    .select("worker_id, period_start, period_end, status")
    .eq("system_id", systemId);

  // Get analysis results for analysis workers' coverage
  const { data: analysisResults } = await supabase
    .from("analysis_results")
    .select("worker_id, computed_at")
    .eq("system_id", systemId);

  const stateMap = new Map(
    (states ?? []).map((s: WorkerState) => [s.worker_id, s])
  );

  const pendingMap = new Map<string, number>();
  for (const p of pendingCounts ?? []) {
    pendingMap.set(p.worker_id, (pendingMap.get(p.worker_id) ?? 0) + 1);
  }

  const installDate = system?.installation_date;
  const today = new Date().toISOString().split("T")[0];

  const analysisResultMap = new Map(
    (analysisResults ?? []).map((r) => [r.worker_id, r.computed_at])
  );

  const workers: WorkerStatus[] = (workerDefs ?? []).map((def) => {
    const state = stateMap.get(def.id);

    // Compute coverage percentage
    let coveragePct = 0;

    if (def.worker_type === "analysis") {
      // Analysis workers: coverage = has a cached result or not
      coveragePct = analysisResultMap.has(def.id) ? 100 : 0;
    } else if (installDate) {
      // Data workers: coverage = fetched days / total days since install
      const workerCoverage = (coverage ?? []).filter(
        (c) => c.worker_id === def.id && c.status === "fetched"
      );
      if (workerCoverage.length > 0) {
        const totalDays = Math.max(
          1,
          (new Date(today).getTime() - new Date(installDate).getTime()) / 86400000
        );
        const fetchedDays = workerCoverage.reduce((sum, c) => {
          const start = new Date(c.period_start).getTime();
          const end = new Date(c.period_end).getTime();
          return sum + Math.max(0, (end - start) / 86400000);
        }, 0);
        coveragePct = Math.min(100, Math.round((fetchedDays / totalDays) * 100));
      }
    }

    // For analysis workers, use the analysis_results computed_at as last_run_at
    const lastRunAt = def.worker_type === "analysis"
      ? (analysisResultMap.get(def.id) ?? state?.last_run_at ?? null)
      : (state?.last_run_at ?? null);

    return {
      worker_id: def.id,
      display_name: def.display_name,
      description: def.description,
      worker_type: def.worker_type,
      status: state?.status ?? "idle",
      progress: state?.progress ?? {},
      coverage_pct: coveragePct,
      last_run_at: lastRunAt,
      error_message: state?.error_message ?? null,
      pending_units: pendingMap.get(def.id) ?? 0,
    };
  });

  return {
    system_id: systemId,
    system_name: system?.system_name ?? "",
    installation_date: installDate ?? null,
    workers,
  };
}

// ── Helpers ─────────────────────────────────────────────────────────────────

async function upsertWorkerState(
  supabase: SupabaseClient,
  systemId: string,
  workerId: string,
  updates: Partial<Omit<WorkerState, "system_id" | "worker_id" | "updated_at">>,
): Promise<void> {
  const { data: existing } = await supabase
    .from("worker_state")
    .select("system_id")
    .eq("system_id", systemId)
    .eq("worker_id", workerId)
    .single();

  if (existing) {
    await supabase
      .from("worker_state")
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq("system_id", systemId)
      .eq("worker_id", workerId);
  } else {
    await supabase.from("worker_state").insert({
      system_id: systemId,
      worker_id: workerId,
      status: "idle",
      ...updates,
      updated_at: new Date().toISOString(),
    });
  }
}
