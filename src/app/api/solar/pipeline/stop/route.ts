import { createClient } from "@/lib/supabase/server";
import { stopWorker } from "@/lib/pipeline/engine";
import { initWorkers } from "@/lib/pipeline/workers";
import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
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

  const body = await request.json().catch(() => ({}));
  const workerId: string = body.worker_id;

  if (!workerId) {
    return NextResponse.json(
      { error: "worker_id is required" },
      { status: 400 },
    );
  }

  await stopWorker(workerId, system.id, supabase);
  return NextResponse.json({ status: "stopped", worker_id: workerId });
}
