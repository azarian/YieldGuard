import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export async function GET() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: system } = await supabase
    .from("solar_systems")
    .select("id, installation_date")
    .eq("user_id", user.id)
    .single();

  if (!system) {
    return NextResponse.json({ error: "No system" }, { status: 404 });
  }

  const { data: equipment } = await supabase
    .from("equipment")
    .select("id, equipment_type")
    .eq("system_id", system.id);

  const inverterCount = equipment?.filter((e) => e.equipment_type === "inverter").length ?? 0;
  const optimizerCount = equipment?.filter((e) => e.equipment_type === "optimizer").length ?? 0;

  // Fetch all data_coverage for this system
  const { data: coverage } = await supabase
    .from("data_coverage")
    .select("worker_id, period_start, period_end, status")
    .eq("system_id", system.id)
    .order("period_start", { ascending: true });

  const allCoverage = coverage ?? [];

  function getCoverageByWorker(workerId: string) {
    const records = allCoverage.filter((c) => c.worker_id === workerId);
    const fetched = records.filter((c) => c.status === "fetched");
    const missing = records.filter((c) => c.status === "missing");
    return {
      fetched: mergePeriods(fetched),
      missing: mergePeriods(missing),
    };
  }

  const inverter = getCoverageByWorker("inverter_telemetry");
  const siteEnergy = getCoverageByWorker("site_energy_15min");
  const optimizer = getCoverageByWorker("optimizer_telemetry");

  return NextResponse.json({
    installation_date: system.installation_date,
    inverter: { ...inverter, count: inverterCount },
    optimizer: { ...optimizer, count: optimizerCount },
    site_energy: siteEnergy,
  });
}

function mergePeriods(
  periods: Array<{ period_start: string; period_end: string }>
) {
  if (periods.length === 0) return [];
  const sorted = [...periods].sort((a, b) =>
    a.period_start.localeCompare(b.period_start)
  );
  const merged: Array<{ start: string; end: string }> = [];
  let cur = { start: sorted[0].period_start, end: sorted[0].period_end };

  for (let i = 1; i < sorted.length; i++) {
    const next = sorted[i];
    if (next.period_start <= addDay(cur.end)) {
      if (next.period_end > cur.end) cur.end = next.period_end;
    } else {
      merged.push(cur);
      cur = { start: next.period_start, end: next.period_end };
    }
  }
  merged.push(cur);
  return merged;
}

function addDay(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().split("T")[0];
}
