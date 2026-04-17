/**
 * Daily energy worker.
 *
 * Computes daily energy totals from equipment_telemetry (inverters only).
 * Uses power_w × dynamic interval, same algorithm as the analyze endpoint.
 * Stores results in the daily_energy table.
 */

import { SupabaseClient } from "@supabase/supabase-js";
import type { PipelineWorker, WorkUnit, WorkUnitResult } from "../types";
import { computeGaps } from "@/lib/sync-periods";

function formatDate(d: Date): string {
  return d.toISOString().split("T")[0];
}

const dailyEnergyWorker: PipelineWorker = {
  id: "daily_energy",

  async plan(systemId, supabase) {
    // Get system install date
    const { data: system } = await supabase
      .from("solar_systems")
      .select("installation_date")
      .eq("id", systemId)
      .single();

    if (!system) return [];

    // Check what inverter telemetry coverage we have (our input)
    const { data: inputCoverage } = await supabase
      .from("data_coverage")
      .select("period_start, period_end")
      .eq("system_id", systemId)
      .eq("worker_id", "inverter_telemetry")
      .eq("status", "fetched")
      .order("period_start", { ascending: true });

    if (!inputCoverage || inputCoverage.length === 0) return [];

    // Check what daily_energy coverage we already have
    const { data: outputCoverage } = await supabase
      .from("data_coverage")
      .select("period_start, period_end")
      .eq("system_id", systemId)
      .eq("worker_id", "daily_energy")
      .order("period_start", { ascending: true });

    // Find gaps: periods where we have inverter data but no daily_energy
    const inputStart = inputCoverage[0].period_start;
    const inputEnd = inputCoverage[inputCoverage.length - 1].period_end;
    const gaps = computeGaps(inputStart, inputEnd, outputCoverage ?? []);

    if (gaps.length === 0) return [];

    // Create 30-day chunks
    const planned: Omit<WorkUnit, "id" | "status">[] = [];
    for (const gap of gaps) {
      let cursor = new Date(gap.start + "T00:00:00Z");
      const gapEnd = new Date(gap.end + "T00:00:00Z");

      while (cursor < gapEnd) {
        const chunkEnd = new Date(cursor);
        chunkEnd.setDate(chunkEnd.getDate() + 30);
        const clamped = chunkEnd > gapEnd ? gapEnd : chunkEnd;
        planned.push({
          system_id: systemId,
          worker_id: "daily_energy",
          period_start: formatDate(cursor),
          period_end: formatDate(clamped),
        });
        cursor = clamped;
      }
    }

    return planned;
  },

  async execute(unit, supabase) {
    // Get inverters for this system
    const { data: inverters } = await supabase
      .from("equipment")
      .select("id")
      .eq("system_id", unit.system_id)
      .eq("equipment_type", "inverter");

    if (!inverters || inverters.length === 0) {
      return { status: "skipped", records_stored: 0, error_message: "No inverters found" };
    }

    // Fetch telemetry for all inverters in this period
    const allTelemetry: Array<{ ts: string; power_w: number }> = [];
    for (const inv of inverters) {
      const { data: tele } = await supabase
        .from("equipment_telemetry")
        .select("ts, power_w")
        .eq("equipment_id", inv.id)
        .gte("ts", unit.period_start!)
        .lte("ts", unit.period_end! + "T23:59:59Z")
        .order("ts", { ascending: true })
        .limit(10000);

      if (tele) allTelemetry.push(...tele);
    }

    if (allTelemetry.length === 0) {
      // Record coverage as missing
      await supabase.from("data_coverage").insert({
        system_id: unit.system_id,
        worker_id: "daily_energy",
        period_start: unit.period_start,
        period_end: unit.period_end,
        status: "missing",
        record_count: 0,
      });
      return { status: "done", records_stored: 0 };
    }

    // Sort by timestamp and compute daily energy using dynamic intervals
    allTelemetry.sort((a, b) => a.ts.localeCompare(b.ts));

    const dailyAgg = new Map<string, number>();
    for (let i = 0; i < allTelemetry.length; i++) {
      const t = allTelemetry[i];
      const power = t.power_w ?? 0;
      if (power <= 0) continue;

      // Compute interval in hours from gap to next reading
      let intervalH: number;
      if (i + 1 < allTelemetry.length) {
        const tsCur = new Date(t.ts).getTime();
        const tsNext = new Date(allTelemetry[i + 1].ts).getTime();
        intervalH = (tsNext - tsCur) / 3600000;
      } else {
        intervalH = 5 / 60; // default 5 min for last reading
      }
      // Clamp to reasonable range
      intervalH = Math.max(1 / 60, Math.min(1.0, intervalH));

      const day = t.ts.slice(0, 10);
      dailyAgg.set(day, (dailyAgg.get(day) ?? 0) + power * intervalH);
    }

    // Upsert daily energy rows
    const rows = Array.from(dailyAgg.entries()).map(([date, energy_wh]) => ({
      system_id: unit.system_id,
      date,
      energy_wh: Math.round(energy_wh * 100) / 100,
      source: "computed",
    }));

    if (rows.length > 0) {
      const BATCH = 500;
      for (let i = 0; i < rows.length; i += BATCH) {
        await supabase
          .from("daily_energy")
          .upsert(rows.slice(i, i + BATCH), {
            onConflict: "system_id,date",
            ignoreDuplicates: false,
          });
      }
    }

    // Record coverage
    await supabase.from("data_coverage").insert({
      system_id: unit.system_id,
      worker_id: "daily_energy",
      period_start: unit.period_start,
      period_end: unit.period_end,
      status: "fetched",
      record_count: rows.length,
    });

    return { status: "done", records_stored: rows.length };
  },
};

export default dailyEnergyWorker;
