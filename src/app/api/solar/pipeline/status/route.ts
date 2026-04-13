import { createClient } from "@/lib/supabase/server";
import { getStatus } from "@/lib/pipeline/engine";
import { initWorkers } from "@/lib/pipeline/workers";
import { NextResponse } from "next/server";

export async function GET() {
  initWorkers();
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: system } = await supabase
    .from("solar_systems")
    .select("id")
    .eq("user_id", user.id)
    .single();

  if (!system) {
    return NextResponse.json({ error: "No system registered" }, { status: 404 });
  }

  const status = await getStatus(system.id, supabase);
  return NextResponse.json(status);
}
