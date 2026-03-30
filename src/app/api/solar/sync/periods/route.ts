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
    .select("id, serial_number, equipment_type, name")
    .eq("system_id", system.id);

  if (!equipment || equipment.length === 0) {
    return NextResponse.json({
      installation_date: system.installation_date,
      inverter: { periods: [], equipment: [] },
      optimizer: { periods: [], equipment: [] },
    });
  }

  const inverters = equipment.filter((e) => e.equipment_type === "inverter");
  const optimizers = equipment.filter((e) => e.equipment_type === "optimizer");

  const inverterIds = inverters.map((e) => e.id);
  const optimizerIds = optimizers.map((e) => e.id);

  // Fetch periods for inverters (public_api)
  let inverterPeriods: Array<{ period_start: string; period_end: string }> = [];
  if (inverterIds.length > 0) {
    const { data } = await supabase
      .from("fetched_periods")
      .select("period_start, period_end")
      .in("equipment_id", inverterIds)
      .eq("source", "public_api")
      .order("period_start", { ascending: true });
    inverterPeriods = data ?? [];
  }

  // Fetch periods for optimizers (portal_api) — aggregate across all optimizers
  let optimizerPeriods: Array<{ period_start: string; period_end: string }> = [];
  if (optimizerIds.length > 0) {
    const { data } = await supabase
      .from("fetched_periods")
      .select("period_start, period_end")
      .in("equipment_id", optimizerIds)
      .eq("source", "portal_api")
      .order("period_start", { ascending: true });
    optimizerPeriods = data ?? [];
  }

  // Merge overlapping periods for display
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

  return NextResponse.json({
    installation_date: system.installation_date,
    inverter: {
      periods: mergePeriods(inverterPeriods),
      count: inverters.length,
    },
    optimizer: {
      periods: mergePeriods(optimizerPeriods),
      count: optimizers.length,
    },
  });
}
