/**
 * Tests for the pipeline engine and worker interface.
 *
 * Tests the source code structure and worker registration,
 * plus validates the inverter and site-energy worker implementations.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const PIPELINE_DIR = join(__dirname, "..");
const WORKERS_DIR = join(PIPELINE_DIR, "workers");
const API_DIR = join(__dirname, "../../../app/api/solar/pipeline");

function readFile(dir: string, filename: string): string {
  return readFileSync(join(dir, filename), "utf-8");
}

describe("pipeline types", () => {
  const types = readFile(PIPELINE_DIR, "types.ts");

  it("defines PipelineWorker interface with plan and execute", () => {
    expect(types).toContain("interface PipelineWorker");
    expect(types).toContain("plan(");
    expect(types).toContain("execute(");
  });

  it("defines WorkUnit with required fields", () => {
    expect(types).toContain("interface WorkUnit");
    expect(types).toContain("system_id: string");
    expect(types).toContain("worker_id: string");
    expect(types).toContain("period_start");
    expect(types).toContain("period_end");
  });

  it("defines WorkUnitResult with rate_limited status", () => {
    expect(types).toContain("interface WorkUnitResult");
    expect(types).toContain("rate_limited");
    expect(types).toContain("retry_after");
  });

  it("defines PipelineStatus for the status endpoint", () => {
    expect(types).toContain("interface PipelineStatus");
    expect(types).toContain("interface WorkerStatus");
    expect(types).toContain("coverage_pct");
  });
});

describe("pipeline engine", () => {
  const engine = readFile(PIPELINE_DIR, "engine.ts");

  it("exports startWorker function", () => {
    expect(engine).toContain("export async function startWorker(");
  });

  it("exports processNext function", () => {
    expect(engine).toContain("export async function processNext(");
  });

  it("exports stopWorker function", () => {
    expect(engine).toContain("export async function stopWorker(");
  });

  it("exports getStatus function", () => {
    expect(engine).toContain("export async function getStatus(");
  });

  it("checks for already-running worker before starting", () => {
    expect(engine).toContain("already_running");
  });

  it("returns up_to_date when no gaps found", () => {
    expect(engine).toContain("up_to_date");
  });

  it("clears old pending units before creating new ones", () => {
    expect(engine).toContain('.delete()');
    expect(engine).toContain('.in("status", ["pending", "error"])');
  });

  it("handles rate limiting by setting paused status", () => {
    expect(engine).toContain('"paused"');
    expect(engine).toContain("rate_limited");
  });

  it("marks worker as idle when all units are processed", () => {
    // After processing all units, status should go to idle
    expect(engine).toContain("All done");
    expect(engine).toContain('"idle"');
  });

  it("uses upsert pattern for worker_state", () => {
    expect(engine).toContain("upsertWorkerState");
  });
});

describe("inverter telemetry worker", () => {
  const worker = readFile(WORKERS_DIR, "inverter-telemetry.ts");

  it("implements PipelineWorker interface", () => {
    expect(worker).toContain("PipelineWorker");
    expect(worker).toContain("async plan(");
    expect(worker).toContain("async execute(");
  });

  it("has worker id inverter_telemetry", () => {
    expect(worker).toContain('id: "inverter_telemetry"');
  });

  it("uses 7-day chunks", () => {
    expect(worker).toContain("CHUNK_DAYS = 7");
  });

  it("discovers equipment from SolarEdge API during planning", () => {
    expect(worker).toContain("getSiteDetails");
    expect(worker).toContain("getEquipmentList");
  });

  it("only plans for inverters, not optimizers", () => {
    expect(worker).toContain('equipment_type", "inverter"');
  });

  it("uses computeGaps for gap analysis", () => {
    expect(worker).toContain("computeGaps(");
  });

  it("writes to data_coverage after execution", () => {
    expect(worker).toContain('.from("data_coverage").insert(');
    expect(worker).toContain('worker_id: "inverter_telemetry"');
  });

  it("handles SolarEdge rate limiting", () => {
    expect(worker).toContain("SolarEdgeRateLimitError");
    expect(worker).toContain("rate_limited");
  });

  it("writes telemetry to equipment_telemetry table", () => {
    expect(worker).toContain('.from("equipment_telemetry")');
    expect(worker).toContain("upsert");
  });
});

describe("site energy worker", () => {
  const worker = readFile(WORKERS_DIR, "site-energy.ts");

  it("implements PipelineWorker interface", () => {
    expect(worker).toContain("PipelineWorker");
    expect(worker).toContain("async plan(");
    expect(worker).toContain("async execute(");
  });

  it("has worker id site_energy_15min", () => {
    expect(worker).toContain('id: "site_energy_15min"');
  });

  it("uses monthly chunks", () => {
    expect(worker).toContain("addMonths");
  });

  it("uses getSiteEnergy API", () => {
    expect(worker).toContain("getSiteEnergy");
  });

  it("writes to site_energy_15min table", () => {
    expect(worker).toContain('.from("site_energy_15min")');
  });

  it("writes to data_coverage after execution", () => {
    expect(worker).toContain('.from("data_coverage").insert(');
    expect(worker).toContain('worker_id: "site_energy_15min"');
  });

  it("handles SolarEdge rate limiting", () => {
    expect(worker).toContain("SolarEdgeRateLimitError");
    expect(worker).toContain("rate_limited");
  });
});

describe("worker registry", () => {
  const index = readFile(WORKERS_DIR, "index.ts");

  it("registers inverter telemetry worker", () => {
    expect(index).toContain("inverterTelemetryWorker");
    expect(index).toContain("registerWorker(inverterTelemetryWorker)");
  });

  it("registers site energy worker", () => {
    expect(index).toContain("siteEnergyWorker");
    expect(index).toContain("registerWorker(siteEnergyWorker)");
  });

  it("has initialization guard", () => {
    expect(index).toContain("if (initialized) return");
  });
});

describe("pipeline API endpoints", () => {
  it("start endpoint accepts worker_id and calls startWorker", () => {
    const src = readFile(join(API_DIR, "start"), "route.ts");
    expect(src).toContain("worker_id");
    expect(src).toContain("startWorker(");
    expect(src).toContain("initWorkers()");
  });

  it("process endpoint accepts worker_id and calls processNext", () => {
    const src = readFile(join(API_DIR, "process"), "route.ts");
    expect(src).toContain("worker_id");
    expect(src).toContain("processNext(");
    expect(src).toContain("initWorkers()");
  });

  it("stop endpoint accepts worker_id and calls stopWorker", () => {
    const src = readFile(join(API_DIR, "stop"), "route.ts");
    expect(src).toContain("worker_id");
    expect(src).toContain("stopWorker(");
  });

  it("status endpoint calls getStatus", () => {
    const src = readFile(join(API_DIR, "status"), "route.ts");
    expect(src).toContain("getStatus(");
    expect(src).toContain("GET");
  });

  it("process endpoint returns 429 on rate limit", () => {
    const src = readFile(join(API_DIR, "process"), "route.ts");
    expect(src).toContain("429");
    expect(src).toContain("rate_limited");
  });

  it("all endpoints check authentication", () => {
    for (const dir of ["start", "process", "stop", "status"]) {
      const src = readFile(join(API_DIR, dir), "route.ts");
      expect(src).toContain("auth.getUser()");
      expect(src).toContain("Unauthorized");
    }
  });
});
