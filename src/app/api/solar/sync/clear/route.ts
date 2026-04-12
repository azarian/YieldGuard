import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";

const WORKER_MAP: Record<string, string> = {
  inverter: "inverter_telemetry",
  site_energy: "site_energy_15min",
  optimizer: "optimizer_telemetry",
};

export async function DELETE(request: NextRequest) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: system } = await supabase
    .from("solar_systems")
    .select("id")
    .eq("user_id", user.id)
    .single();

  if (!system) {
    return NextResponse.json({ error: "No system" }, { status: 404 });
  }

  const body = await request.json().catch(() => ({}));
  const type: string = body.type;

  if (!type || !["inverter", "site_energy", "optimizer"].includes(type)) {
    return NextResponse.json(
      { error: "type must be one of: inverter, site_energy, optimizer" },
      { status: 400 }
    );
  }

  const systemId = system.id;
  const workerId = WORKER_MAP[type];

  // Clear data_coverage for this worker
  await supabase
    .from("data_coverage")
    .delete()
    .eq("system_id", systemId)
    .eq("worker_id", workerId);

  if (type === "site_energy") {
    await supabase
      .from("site_energy_15min")
      .delete()
      .eq("system_id", systemId);

    return NextResponse.json({ cleared: "site_energy" });
  }

  const eqType = type === "inverter" ? "inverter" : "optimizer";

  const { data: equipment } = await supabase
    .from("equipment")
    .select("id")
    .eq("system_id", systemId)
    .eq("equipment_type", eqType);

  if (!equipment || equipment.length === 0) {
    return NextResponse.json({ cleared: type, message: "No equipment found" });
  }

  const equipIds = equipment.map((e) => e.id);

  // Delete telemetry for these equipment
  for (const eqId of equipIds) {
    await supabase
      .from("equipment_telemetry")
      .delete()
      .eq("equipment_id", eqId);
  }

  return NextResponse.json({
    cleared: type,
    equipment_count: equipIds.length,
  });
}
