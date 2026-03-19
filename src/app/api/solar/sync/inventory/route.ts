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
    .select(
      "id, system_name, last_synced_at, installation_date, se_portal_username"
    )
    .eq("user_id", user.id)
    .single();

  if (!system) {
    return NextResponse.json(
      { error: "No solar system registered" },
      { status: 404 }
    );
  }

  // Fetch ALL equipment (inverters and optimizers)
  const { data: equipment } = await supabase
    .from("equipment")
    .select(
      "id, serial_number, equipment_type, name, manufacturer, model, connected_to"
    )
    .eq("system_id", system.id)
    .order("equipment_type", { ascending: true });

  if (!equipment || equipment.length === 0) {
    return NextResponse.json({
      system_name: system.system_name,
      last_synced_at: system.last_synced_at,
      installation_date: system.installation_date,
      equipment: [],
      inverter_count: 0,
      optimizer_count: 0,
      date_range: null,
      sync_history: [],
      portal_configured: !!system.se_portal_username,
      portal_username: system.se_portal_username ?? null,
    });
  }

  // Get data coverage per equipment
  const equipmentWithCoverage = await Promise.all(
    equipment.map(async (eq) => {
      const [{ data: earliest }, { data: latest }, { data: countResult }] =
        await Promise.all([
          supabase
            .from("equipment_telemetry")
            .select("ts")
            .eq("equipment_id", eq.id)
            .order("ts", { ascending: true })
            .limit(1),
          supabase
            .from("equipment_telemetry")
            .select("ts")
            .eq("equipment_id", eq.id)
            .order("ts", { ascending: false })
            .limit(1),
          supabase
            .from("equipment_telemetry")
            .select("ts", { count: "exact", head: true })
            .eq("equipment_id", eq.id),
        ]);

      const earliestTs = earliest?.[0]?.ts ?? null;
      const latestTs = latest?.[0]?.ts ?? null;
      const dataPoints = countResult ? 0 : 0;

      return {
        ...eq,
        earliest_data: earliestTs,
        latest_data: latestTs,
        data_points: dataPoints,
        has_data: !!earliestTs,
      };
    })
  );

  // Overall stats
  const allEarliest = equipmentWithCoverage
    .filter((e) => e.earliest_data)
    .map((e) => new Date(e.earliest_data!).getTime());
  const allLatest = equipmentWithCoverage
    .filter((e) => e.latest_data)
    .map((e) => new Date(e.latest_data!).getTime());

  const overallEarliest =
    allEarliest.length > 0
      ? new Date(Math.min(...allEarliest)).toISOString()
      : null;
  const overallLatest =
    allLatest.length > 0
      ? new Date(Math.max(...allLatest)).toISOString()
      : null;

  // Get sync history (last 10 jobs)
  const { data: syncJobs } = await supabase
    .from("sync_jobs")
    .select(
      "id, status, total_chunks, completed_chunks, error_message, created_at, updated_at"
    )
    .eq("system_id", system.id)
    .order("created_at", { ascending: false })
    .limit(10);

  const inverterCount = equipmentWithCoverage.filter(
    (e) => e.equipment_type === "inverter"
  ).length;
  const optimizerCount = equipmentWithCoverage.filter(
    (e) => e.equipment_type === "optimizer"
  ).length;

  return NextResponse.json({
    system_name: system.system_name,
    last_synced_at: system.last_synced_at,
    installation_date: system.installation_date,
    equipment: equipmentWithCoverage,
    inverter_count: inverterCount,
    optimizer_count: optimizerCount,
    date_range: overallEarliest
      ? { from: overallEarliest, to: overallLatest }
      : null,
    sync_history: syncJobs ?? [],
    portal_configured: !!system.se_portal_username,
    portal_username: system.se_portal_username ?? null,
  });
}
