/**
 * Inverter telemetry worker.
 *
 * Fetches per-inverter 15-min telemetry from the SolarEdge public API.
 * Plans 7-day chunks for each inverter, skipping already-covered periods.
 */

import { SupabaseClient } from "@supabase/supabase-js";
import {
  getEquipmentData,
  getSiteDetails,
  getEquipmentList,
  SolarEdgeRateLimitError,
  SolarEdgeApiError,
} from "@/lib/solaredge/client";
import { computeGaps } from "@/lib/sync-periods";
import type { PipelineWorker, WorkUnit, WorkUnitResult } from "../types";

const CHUNK_DAYS = 7;

function formatDate(date: Date): string {
  return date.toISOString().split("T")[0];
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

const inverterTelemetryWorker: PipelineWorker = {
  id: "inverter_telemetry",

  async plan(systemId, supabase) {
    // Get system credentials and install date
    const { data: system } = await supabase
      .from("solar_systems")
      .select("site_id, api_key, installation_date")
      .eq("id", systemId)
      .single();

    if (!system) return [];

    const siteId = system.site_id.trim();
    const apiKey = system.api_key.trim();

    // Discover/refresh equipment from SolarEdge
    const [detailsData, equipmentData] = await Promise.all([
      getSiteDetails(siteId, apiKey).catch(() => null),
      getEquipmentList(siteId, apiKey),
    ]);

    // Update site details if available
    if (detailsData?.details) {
      const d = detailsData.details;
      const loc = d.location ?? {};
      await supabase
        .from("solar_systems")
        .update({
          latitude: loc.latitude ?? null,
          longitude: loc.longitude ?? null,
          peak_power_kwp: (d.peakPower as number) ?? null,
          azimuth: (d.azimuth as number) ?? null,
          tilt: (d.tilt as number) ?? null,
          installation_date: (d.installationDate as string) ?? system.installation_date,
        })
        .eq("id", systemId);
    }

    // Upsert equipment
    const reporters = equipmentData.reporters?.list ?? [];
    const equipmentRows = reporters.map((r) => ({
      system_id: systemId,
      serial_number: r.serialNumber,
      equipment_type: r.type?.toLowerCase().includes("optimizer")
        ? "optimizer"
        : "inverter",
      name: r.name || null,
      manufacturer: r.manufacturer || null,
      model: r.model || null,
      connected_to: r.connectedTo || null,
    }));

    if (equipmentRows.length > 0) {
      await supabase
        .from("equipment")
        .upsert(equipmentRows, { onConflict: "system_id,serial_number" });
    }

    // Get inverters from DB
    const { data: inverters } = await supabase
      .from("equipment")
      .select("id, serial_number")
      .eq("system_id", systemId)
      .eq("equipment_type", "inverter");

    if (!inverters || inverters.length === 0) return [];

    // Determine date range
    const today = new Date();
    const installDate = detailsData?.details?.installationDate as string
      ?? system.installation_date;
    let startFrom = new Date();
    startFrom.setFullYear(startFrom.getFullYear() - 7);
    if (installDate) {
      const inst = new Date(installDate);
      if (inst > startFrom) startFrom = inst;
    }

    const desiredStart = formatDate(startFrom);
    const desiredEnd = formatDate(today);

    // Build chunks from gaps
    const planned: Omit<WorkUnit, "id" | "status">[] = [];

    for (const inv of inverters) {
      const { data: covered } = await supabase
        .from("data_coverage")
        .select("period_start, period_end")
        .eq("system_id", systemId)
        .eq("worker_id", "inverter_telemetry")
        .eq("equipment_id", inv.id)
        .order("period_start", { ascending: true });

      const gaps = computeGaps(desiredStart, desiredEnd, covered ?? []);

      for (const gap of gaps) {
        let cursor = new Date(gap.start + "T00:00:00Z");
        const gapEnd = new Date(gap.end + "T00:00:00Z");

        while (cursor < gapEnd) {
          const chunkEnd = addDays(cursor, CHUNK_DAYS);
          const clamped = chunkEnd > gapEnd ? gapEnd : chunkEnd;
          planned.push({
            system_id: systemId,
            worker_id: "inverter_telemetry",
            equipment_id: inv.id,
            period_start: formatDate(cursor),
            period_end: formatDate(clamped),
          });
          cursor = clamped;
        }
      }
    }

    return planned;
  },

  async execute(unit, supabase) {
    // Get system credentials
    const { data: system } = await supabase
      .from("solar_systems")
      .select("site_id, api_key")
      .eq("id", unit.system_id)
      .single();

    if (!system) {
      return { status: "error", records_stored: 0, error_message: "System not found" };
    }

    // Get equipment serial number
    const { data: equipment } = await supabase
      .from("equipment")
      .select("serial_number, name")
      .eq("id", unit.equipment_id)
      .single();

    if (!equipment) {
      return { status: "error", records_stored: 0, error_message: "Equipment not found" };
    }

    const siteId = system.site_id.trim();
    const apiKey = system.api_key.trim();

    try {
      const telemetries = await getEquipmentData(
        siteId,
        equipment.serial_number,
        apiKey,
        unit.period_start!,
        unit.period_end!,
      );

      // Parse and insert telemetry rows
      const rows = telemetries
        .filter((t) => t.date)
        .map((t) => ({
          equipment_id: unit.equipment_id,
          ts: t.date,
          power_w: t.totalActivePower ?? t.activePower ?? t.power ?? null,
          voltage: t.dcVoltage ?? t.voltage ?? null,
          current_a: t.current ?? null,
          energy_wh: t.totalEnergy ?? t.energy ?? null,
          temperature_c: t.temperature ?? null,
        }));

      if (rows.length > 0) {
        const BATCH = 500;
        for (let i = 0; i < rows.length; i += BATCH) {
          await supabase
            .from("equipment_telemetry")
            .upsert(rows.slice(i, i + BATCH), {
              onConflict: "equipment_id,ts",
              ignoreDuplicates: true,
            });
        }
      }

      // Record coverage
      await supabase.from("data_coverage").insert({
        system_id: unit.system_id,
        worker_id: "inverter_telemetry",
        equipment_id: unit.equipment_id,
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

export default inverterTelemetryWorker;
