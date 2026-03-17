import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const jobId = request.nextUrl.searchParams.get("job_id");

  const { data: system } = await supabase
    .from("solar_systems")
    .select("id")
    .eq("user_id", user.id)
    .single();

  if (!system) {
    return NextResponse.json(
      { error: "No solar system registered" },
      { status: 404 }
    );
  }

  if (jobId) {
    const { data: job } = await supabase
      .from("sync_jobs")
      .select(
        "id, status, total_chunks, completed_chunks, current_equipment, current_period, error_message, created_at, updated_at"
      )
      .eq("id", jobId)
      .eq("system_id", system.id)
      .single();

    if (!job) {
      return NextResponse.json(
        { error: "Sync job not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({
      ...job,
      pct:
        job.total_chunks > 0
          ? Math.round((job.completed_chunks / job.total_chunks) * 100)
          : 0,
    });
  }

  // No specific job — return latest job
  const { data: jobs } = await supabase
    .from("sync_jobs")
    .select(
      "id, status, total_chunks, completed_chunks, current_equipment, current_period, error_message, created_at, updated_at"
    )
    .eq("system_id", system.id)
    .order("created_at", { ascending: false })
    .limit(1);

  if (!jobs || jobs.length === 0) {
    return NextResponse.json({ status: "none" });
  }

  const job = jobs[0];
  return NextResponse.json({
    ...job,
    pct:
      job.total_chunks > 0
        ? Math.round((job.completed_chunks / job.total_chunks) * 100)
        : 0,
  });
}
