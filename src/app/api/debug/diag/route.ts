import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export async function GET() {
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { data: system } = await supabase
    .from("solar_systems")
    .select("id, system_name, site_id, installation_date, last_synced_at")
    .eq("user_id", user.id)
    .single();

  if (!system) {
    return NextResponse.json({ error: "No system found" }, { status: 404 });
  }

  const systemId = system.id;

  // Equipment count
  const { data: equipment } = await supabase
    .from("equipment")
    .select("id, serial_number, equipment_type, name")
    .eq("system_id", systemId);

  const inverters = equipment?.filter(e => e.equipment_type === "inverter") ?? [];
  const optimizers = equipment?.filter(e => e.equipment_type === "optimizer") ?? [];

  // Recent telemetry stats — ALL equipment (same as analyze endpoint)
  const now = new Date();
  const weekAgo = new Date(now);
  weekAgo.setDate(weekAgo.getDate() - 7);
  const startStr = weekAgo.toISOString().split("T")[0];

  let totalReadings = 0;
  let readingsWithPower = 0;
  let totalEnergyWh = 0;
  const daysWithData = new Set<string>();
  const perEquipment: Record<string, { type: string; name: string; readings: number; power_readings: number }> = {};

  for (const eq of equipment ?? []) {
    const { data: tele } = await supabase
      .from("equipment_telemetry")
      .select("ts, power_w")
      .eq("equipment_id", eq.id)
      .gte("ts", startStr)
      .order("ts", { ascending: true })
      .limit(2000);

    let eqReadings = 0;
    let eqPowerReadings = 0;
    for (const t of tele ?? []) {
      totalReadings++;
      eqReadings++;
      const pw = t.power_w ?? 0;
      if (pw > 0) {
        readingsWithPower++;
        eqPowerReadings++;
        totalEnergyWh += pw * 0.25;
        daysWithData.add((t.ts as string).slice(0, 10));
      }
    }
    if (eqReadings > 0) {
      perEquipment[eq.serial_number] = {
        type: eq.equipment_type,
        name: eq.name ?? eq.serial_number,
        readings: eqReadings,
        power_readings: eqPowerReadings,
      };
    }
  }

  // Debug: check if telemetry exists AT ALL for these equipment IDs (no date filter)
  const telemetryCheck: Record<string, number> = {};
  for (const eq of (equipment ?? []).slice(0, 5)) { // check first 5 only
    const { count } = await supabase
      .from("equipment_telemetry")
      .select("*", { count: "exact", head: true })
      .eq("equipment_id", eq.id);
    telemetryCheck[`${eq.equipment_type}:${eq.name ?? eq.serial_number}`] = count ?? 0;
  }

  // Debug: try querying telemetry WITHOUT equipment_id filter (raw RLS check)
  const { data: rawTele, count: rawCount } = await supabase
    .from("equipment_telemetry")
    .select("equipment_id, ts, power_w", { count: "exact" })
    .gte("ts", startStr)
    .order("ts", { ascending: false })
    .limit(5);

  // Debug: check which equipment IDs have the MOST RECENT data
  const equipIds = (equipment ?? []).map(e => e.id);
  const latestPerEquip: Record<string, string> = {};
  for (const eq of (equipment ?? []).slice(0, 5)) {
    const { data: latest } = await supabase
      .from("equipment_telemetry")
      .select("ts")
      .eq("equipment_id", eq.id)
      .order("ts", { ascending: false })
      .limit(1);
    latestPerEquip[`${eq.equipment_type}:${eq.name ?? eq.serial_number}`] =
      latest?.[0]?.ts ?? "no data";
  }

  // Check new tables
  const { data: coverage } = await supabase
    .from("data_coverage")
    .select("worker_id, period_start, period_end, status")
    .eq("system_id", systemId)
    .order("period_start", { ascending: true })
    .limit(20);

  const { data: dailyEnergy } = await supabase
    .from("daily_energy")
    .select("date, energy_wh")
    .eq("system_id", systemId)
    .order("date", { ascending: false })
    .limit(5);

  const { data: analysisResults } = await supabase
    .from("analysis_results")
    .select("worker_id, data_start, data_end, coverage_hash, computed_at")
    .eq("system_id", systemId)
    .limit(5);

  return NextResponse.json({
    system: {
      id: systemId,
      name: system.system_name,
      site_id: system.site_id,
      installation_date: system.installation_date,
      last_synced_at: system.last_synced_at,
    },
    equipment: {
      inverters: inverters.length,
      optimizers: optimizers.length,
      inverter_names: inverters.map(i => i.name ?? i.serial_number),
    },
    recent_telemetry: {
      period: `${startStr} → today`,
      total_readings: totalReadings,
      readings_with_power_gt_0: readingsWithPower,
      energy_kwh: Math.round(totalEnergyWh / 1000 * 10) / 10,
      days_with_data: [...daysWithData].sort(),
      equipment_with_data: perEquipment,
    },
    telemetry_debug: {
      per_equipment_total_rows: telemetryCheck,
      raw_query_without_equipment_filter: {
        count: rawCount,
        sample: rawTele,
      },
      latest_ts_per_equipment: latestPerEquip,
    },
    data_coverage: coverage ?? [],
    daily_energy: dailyEnergy ?? [],
    analysis_results: analysisResults ?? [],
  });
}
