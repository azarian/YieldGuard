/**
 * Pipeline types and worker interface.
 *
 * Each worker follows the reconciliation pattern:
 * 1. plan() — compare desired state vs data_coverage, return work units
 * 2. execute() — process one work unit, return result
 */

import { SupabaseClient } from "@supabase/supabase-js";

// ── Database row types ──────────────────────────────────────────────────────

export interface WorkerDefinition {
  id: string;
  display_name: string;
  description: string | null;
  worker_type: "raw" | "derived" | "analysis";
  depends_on: string[];
  trigger_type: "data" | "schedule" | "manual";
  enabled: boolean;
}

export interface WorkerState {
  system_id: string;
  worker_id: string;
  status: "idle" | "running" | "paused" | "error";
  last_run_at: string | null;
  next_run_at: string | null;
  progress: WorkerProgress;
  error_message: string | null;
  coverage_hash: string | null;
  updated_at: string;
}

export interface WorkerProgress {
  total_units?: number;
  completed_units?: number;
  current_item?: string;
}

export interface WorkUnit {
  id?: string;
  system_id: string;
  worker_id: string;
  equipment_id?: string | null;
  period_start?: string | null;
  period_end?: string | null;
  status: "pending" | "running" | "done" | "error" | "skipped";
  error_message?: string | null;
  records_stored?: number;
}

export interface CoverageRow {
  period_start: string;
  period_end: string;
  status: string;
  equipment_id?: string | null;
}

// ── Worker execution result ─────────────────────────────────────────────────

export interface WorkUnitResult {
  status: "done" | "error" | "skipped" | "rate_limited";
  records_stored: number;
  error_message?: string;
  retry_after?: number; // seconds, for rate limiting
}

// ── Worker interface ────────────────────────────────────────────────────────

export interface PipelineWorker {
  /** Worker ID — must match pipeline_workers table */
  id: string;

  /**
   * Plan work units by comparing desired state against data_coverage.
   * Returns the work units that need to be created/processed.
   */
  plan(
    systemId: string,
    supabase: SupabaseClient,
  ): Promise<Omit<WorkUnit, "id" | "status">[]>;

  /**
   * Execute a single work unit. Called by the engine one at a time.
   * Must be idempotent — safe to retry on failure.
   */
  execute(
    unit: WorkUnit,
    supabase: SupabaseClient,
  ): Promise<WorkUnitResult>;
}

// ── Pipeline status (returned by GET /pipeline/status) ──────────────────────

export interface WorkerStatus {
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

export interface PipelineStatus {
  system_id: string;
  system_name: string;
  installation_date: string | null;
  workers: WorkerStatus[];
}
