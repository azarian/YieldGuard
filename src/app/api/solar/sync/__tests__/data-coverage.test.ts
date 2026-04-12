/**
 * Tests for data_coverage integration in sync routes.
 *
 * Validates:
 * - Worker ID constants match the pipeline_workers seed data
 * - Source code references data_coverage (not old tables)
 * - Clear route correctly maps sync types to worker IDs
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const SYNC_DIR = join(__dirname, "..");

function readRoute(filename: string): string {
  return readFileSync(join(SYNC_DIR, filename), "utf-8");
}

// ── Source code validation tests ────────────────────────────────────────────
// These tests verify the source code contains the right table/field references
// without needing complex Supabase mocking.

describe("data_coverage integration", () => {

  describe("no references to old tables in sync routes", () => {
    const routeFiles = [
      "chunk/route.ts",
      "site-energy/route.ts",
      "clear/route.ts",
      "route.ts",              // main inverter sync
    ];

    for (const file of routeFiles) {
      it(`${file} does not reference fetched_periods`, () => {
        const src = readRoute(file);
        expect(src).not.toContain('"fetched_periods"');
        expect(src).not.toContain("'fetched_periods'");
      });

      it(`${file} does not reference sync_coverage`, () => {
        const src = readRoute(file);
        expect(src).not.toContain('"sync_coverage"');
        expect(src).not.toContain("'sync_coverage'");
      });
    }
  });

  describe("chunk route references data_coverage correctly", () => {
    it("inserts into data_coverage table", () => {
      const src = readRoute("chunk/route.ts");
      expect(src).toContain('.from("data_coverage").insert(');
    });

    it("uses worker_id inverter_telemetry", () => {
      const src = readRoute("chunk/route.ts");
      expect(src).toContain('worker_id: "inverter_telemetry"');
    });

    it("includes record_count in the insert", () => {
      const src = readRoute("chunk/route.ts");
      expect(src).toContain("record_count:");
    });

    it("uses rows.length for fetched/missing status", () => {
      const src = readRoute("chunk/route.ts");
      expect(src).toContain('rows.length > 0 ? "fetched" : "missing"');
    });
  });

  describe("site-energy route references data_coverage correctly", () => {
    it("reads from data_coverage for gap detection", () => {
      const src = readRoute("site-energy/route.ts");
      expect(src).toContain('.from("data_coverage")');
    });

    it("uses worker_id site_energy_15min", () => {
      const src = readRoute("site-energy/route.ts");
      expect(src).toContain('"site_energy_15min"');
    });

    it("inserts coverage record after fetching", () => {
      const src = readRoute("site-energy/route.ts");
      expect(src).toContain('.from("data_coverage").insert(');
    });
  });

  describe("optimizer chunk route references data_coverage correctly", () => {
    it("inserts into data_coverage table", () => {
      const src = readRoute("optimizers/chunk/route.ts");
      expect(src).toContain('.from("data_coverage").insert(');
    });

    it("uses worker_id optimizer_telemetry", () => {
      const src = readRoute("optimizers/chunk/route.ts");
      expect(src).toContain('worker_id: "optimizer_telemetry"');
    });
  });

  describe("optimizer route uses data_coverage for gap detection", () => {
    it("reads from data_coverage instead of fetched_periods", () => {
      const src = readRoute("optimizers/route.ts");
      expect(src).toContain('.from("data_coverage")');
      expect(src).not.toContain('"fetched_periods"');
    });

    it("filters by worker_id optimizer_telemetry", () => {
      const src = readRoute("optimizers/route.ts");
      expect(src).toContain('"optimizer_telemetry"');
    });
  });

  describe("main sync route uses data_coverage for gap detection", () => {
    it("reads from data_coverage instead of fetched_periods", () => {
      const src = readRoute("route.ts");
      expect(src).toContain('.from("data_coverage")');
    });

    it("filters by worker_id inverter_telemetry", () => {
      const src = readRoute("route.ts");
      expect(src).toContain('"inverter_telemetry"');
    });
  });

  describe("clear route worker_id mapping", () => {
    it("maps inverter → inverter_telemetry", () => {
      const src = readRoute("clear/route.ts");
      expect(src).toContain("inverter: \"inverter_telemetry\"");
    });

    it("maps site_energy → site_energy_15min", () => {
      const src = readRoute("clear/route.ts");
      expect(src).toContain("site_energy: \"site_energy_15min\"");
    });

    it("maps optimizer → optimizer_telemetry", () => {
      const src = readRoute("clear/route.ts");
      expect(src).toContain("optimizer: \"optimizer_telemetry\"");
    });

    it("deletes from data_coverage table", () => {
      const src = readRoute("clear/route.ts");
      expect(src).toContain('.from("data_coverage")');
    });

    it("does not reference old tables", () => {
      const src = readRoute("clear/route.ts");
      expect(src).not.toContain('"fetched_periods"');
      expect(src).not.toContain('"sync_coverage"');
      expect(src).not.toContain('"site_energy_daily"');
    });
  });

  describe("periods route reads from data_coverage", () => {
    it("queries data_coverage table", () => {
      const src = readRoute("periods/route.ts");
      expect(src).toContain('.from("data_coverage")');
    });

    it("does not reference old tables", () => {
      const src = readRoute("periods/route.ts");
      expect(src).not.toContain('"sync_coverage"');
      expect(src).not.toContain('"fetched_periods"');
    });

    it("filters by worker_id not source", () => {
      const src = readRoute("periods/route.ts");
      expect(src).toContain("worker_id");
      expect(src).not.toContain('.eq("source"');
    });
  });

  describe("worker_id constants match migration seed data", () => {
    it("all route worker IDs exist in the migration", () => {
      const migration = readFileSync(
        join(__dirname, "../../../../../../supabase/migrations/00016_pipeline_schema.sql"),
        "utf-8"
      );

      const workerIds = [
        "inverter_telemetry",
        "optimizer_telemetry",
        "site_energy_15min",
        "daily_energy",
        "soiling_analysis",
        "panel_comparison",
      ];

      for (const id of workerIds) {
        expect(migration).toContain(`'${id}'`);
      }
    });
  });
});
