import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";

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

  // Always clear sync_coverage for this type
  await supabase
    .from("sync_coverage")
    .delete()
    .eq("system_id", systemId)
    .eq("source", type);

  if (type === "site_energy") {
    await supabase
      .from("site_energy_15min")
      .delete()
      .eq("system_id", systemId);

    return NextResponse.json({ cleared: "site_energy" });
  }

  const eqType = type === "inverter" ? "inverter" : "optimizer";
  const source = type === "inverter" ? "public_api" : "portal_api";

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

  // Delete fetched_periods for these equipment
  await supabase
    .from("fetched_periods")
    .delete()
    .in("equipment_id", equipIds)
    .eq("source", source);

  return NextResponse.json({
    cleared: type,
    equipment_count: equipIds.length,
  });
}
