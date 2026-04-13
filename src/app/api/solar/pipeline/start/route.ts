import { createClient } from "@/lib/supabase/server";
import { startWorker } from "@/lib/pipeline/engine";
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

  try {
    const result = await startWorker(workerId, system.id, supabase);
    return NextResponse.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
