/**
 * Site energy worker.
 *
 * Fetches site-level 15-min energy from the SolarEdge public API.
 * Plans monthly chunks, skipping already-covered periods.
 */

import { SupabaseClient } from "@supabase/supabase-js";
import { getSiteEnergy, SolarEdgeRateLimitError } from "@/lib/solaredge/client";
import { computeGaps } from "@/lib/sync-periods";
import type { PipelineWorker, WorkUnit, WorkUnitResult } from "../types";

function formatDate(d: Date): string {
  return d.toISOString().split("T")[0];
}

function addMonths(date: Date, months: number): Date {
  const d = new Date(date);
  d.setMonth(d.getMonth() + months);
  return d;
}

const siteEnergyWorker: PipelineWorker = {
  id: "site_energy_15min",

  async plan(systemId, supabase) {
    const { data: system } = await supabase
      .from("solar_systems")
      .select("site_id, api_key, installation_date")
      .eq("id", systemId)
      .single();

    if (!system) return [];

    const today = new Date();
    const installDate = system.installation_date;
    let startFrom = new Date();
    startFrom.setFullYear(startFrom.getFullYear() - 1);
    if (installDate) {
      const inst = new Date(installDate);
      if (inst > startFrom) startFrom = inst;
    }

    // Get existing coverage
    const { data: covered } = await supabase
      .from("data_coverage")
      .select("period_start, period_end")
      .eq("system_id", systemId)
      .eq("worker_id", "site_energy_15min")
      .order("period_start", { ascending: true });

    const gaps = computeGaps(
      formatDate(startFrom),
      formatDate(today),
      covered ?? [],
    );

    if (gaps.length === 0) return [];

    // Create monthly chunks from gaps
    const planned: Omit<WorkUnit, "id" | "status">[] = [];
    for (const gap of gaps) {
      let cursor = new Date(gap.start + "T00:00:00Z");
      cursor.setDate(1); // align to month start
      const gapEnd = new Date(gap.end + "T00:00:00Z");

      while (cursor <= gapEnd) {
        const monthEnd = new Date(
          Math.min(addMonths(cursor, 1).getTime() - 86400000, gapEnd.getTime())
        );
        const reqStart = cursor < new Date(gap.start + "T00:00:00Z")
          ? gap.start
          : formatDate(cursor);

        planned.push({
          system_id: systemId,
          worker_id: "site_energy_15min",
          period_start: reqStart,
          period_end: formatDate(monthEnd),
        });
        cursor = addMonths(cursor, 1);
      }
    }

    return planned;
  },

  async execute(unit, supabase) {
    const { data: system } = await supabase
      .from("solar_systems")
      .select("site_id, api_key")
      .eq("id", unit.system_id)
      .single();

    if (!system) {
      return { status: "error", records_stored: 0, error_message: "System not found" };
    }

    const siteId = system.site_id.trim();
    const apiKey = system.api_key.trim();

    try {
      const values = await getSiteEnergy(
        siteId, apiKey, unit.period_start!, unit.period_end!,
      );

      const rows = values
        .filter((v) => v.value != null)
        .map((v) => ({
          system_id: unit.system_id,
          ts: v.date,
          energy_wh: v.value,
        }));

      if (rows.length > 0) {
        const BATCH = 500;
        for (let i = 0; i < rows.length; i += BATCH) {
          await supabase
            .from("site_energy_15min")
            .upsert(rows.slice(i, i + BATCH), {
              onConflict: "system_id,ts",
              ignoreDuplicates: true,
            });
        }
      }

      await supabase.from("data_coverage").insert({
        system_id: unit.system_id,
        worker_id: "site_energy_15min",
        period_start: unit.period_start,
        period_end: unit.period_end,
        status: rows.length > 0 ? "fetched" : "missing",
        record_count: rows.length,
      });

      return { status: "done", records_stored: rows.length };
    } catch (err) {
      if (err instanceof SolarEdgeRateLimitError) {
        return {
          status: "rate_limited",
          records_stored: 0,
          retry_after: err.retryAfterSeconds,
        };
      }
      const msg = err instanceof Error ? err.message : String(err);
      return { status: "error", records_stored: 0, error_message: msg.substring(0, 200) };
    }
  },
};

export default siteEnergyWorker;
