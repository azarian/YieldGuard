import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";

const SOLAREDGE_BASE = "https://monitoringapi.solaredge.com";

function formatDateTime(date: string): string {
  return `${date} 00:00:00`;
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const jobId: string = body.job_id;
  if (!jobId) {
    return NextResponse.json({ error: "job_id is required" }, { status: 400 });
  }

  // Verify the job belongs to the user
  const { data: job, error: jobError } = await supabase
    .from("sync_jobs")
    .select("id, system_id, status, total_chunks, completed_chunks")
    .eq("id", jobId)
    .single();

  if (jobError || !job) {
    return NextResponse.json({ error: "Sync job not found" }, { status: 404 });
  }

  if (job.status !== "running") {
    return NextResponse.json({
      status: job.status,
      total_chunks: job.total_chunks,
      completed_chunks: job.completed_chunks,
      done: true,
    });
  }

  // Get the system's API key
  const { data: system } = await supabase
    .from("solar_systems")
    .select("site_id, api_key")
    .eq("id", job.system_id)
    .single();

  if (!system) {
    return NextResponse.json(
      { error: "Solar system not found" },
      { status: 404 }
    );
  }

  // Pick next pending chunk (oldest first)
  const { data: chunks } = await supabase
    .from("sync_chunks")
    .select("id, equipment_id, period_start, period_end")
    .eq("job_id", jobId)
    .eq("status", "pending")
    .order("period_start", { ascending: true })
    .limit(1);

  if (!chunks || chunks.length === 0) {
    // All chunks done — finalize
    await supabase
      .from("sync_jobs")
      .update({ status: "complete", updated_at: new Date().toISOString() })
      .eq("id", jobId);

    await supabase
      .from("solar_systems")
      .update({ last_synced_at: new Date().toISOString() })
      .eq("id", job.system_id);

    return NextResponse.json({
      status: "complete",
      total_chunks: job.total_chunks,
      completed_chunks: job.total_chunks,
      done: true,
    });
  }

  const chunk = chunks[0];

  // Get equipment info
  const { data: equipment } = await supabase
    .from("equipment")
    .select("serial_number, equipment_type, name")
    .eq("id", chunk.equipment_id)
    .single();

  if (!equipment) {
    await supabase
      .from("sync_chunks")
      .update({ status: "error", error_message: "Equipment not found" })
      .eq("id", chunk.id);

    return NextResponse.json({
      status: "running",
      total_chunks: job.total_chunks,
      completed_chunks: job.completed_chunks + 1,
      skipped: true,
    });
  }

  const siteId = system.site_id.trim();
  const apiKey = system.api_key.trim();
  const serial = equipment.serial_number;

  // Build SolarEdge equipment data URL
  const startTime = encodeURIComponent(formatDateTime(chunk.period_start));
  const endTime = encodeURIComponent(formatDateTime(chunk.period_end));
  const telemetryUrl = `${SOLAREDGE_BASE}/equipment/${siteId}/${serial}/data?startTime=${startTime}&endTime=${endTime}&api_key=${apiKey}`;

  try {
    const telemetryRes = await fetch(telemetryUrl);

    if (telemetryRes.status === 429) {
      // Rate limited — pause the job
      const retryAfter = telemetryRes.headers.get("Retry-After");
      const waitSeconds = retryAfter ? parseInt(retryAfter, 10) : 60;

      await supabase
        .from("sync_jobs")
        .update({ status: "paused", updated_at: new Date().toISOString() })
        .eq("id", jobId);

      return NextResponse.json({
        status: "rate_limited",
        retry_after: waitSeconds,
        total_chunks: job.total_chunks,
        completed_chunks: job.completed_chunks,
      });
    }

    if (!telemetryRes.ok) {
      const errorBody = await telemetryRes.text().catch(() => "");
      await supabase
        .from("sync_chunks")
        .update({
          status: "error",
          error_message: `HTTP ${telemetryRes.status}: ${errorBody.substring(0, 200)}`,
        })
        .eq("id", chunk.id);

      // Increment completed count and continue
      const newCompleted = job.completed_chunks + 1;
      await supabase
        .from("sync_jobs")
        .update({
          completed_chunks: newCompleted,
          current_equipment: equipment.name || serial,
          current_period: `${chunk.period_start} → ${chunk.period_end}`,
          updated_at: new Date().toISOString(),
        })
        .eq("id", jobId);

      return NextResponse.json({
        status: "running",
        total_chunks: job.total_chunks,
        completed_chunks: newCompleted,
        current_equipment: equipment.name || serial,
        current_period: `${chunk.period_start} → ${chunk.period_end}`,
        error: `Chunk failed: HTTP ${telemetryRes.status}`,
      });
    }

    const telemetryData = await telemetryRes.json();

    // Parse and insert telemetry rows
    const telemetries =
      telemetryData?.data?.telemetries ?? telemetryData?.telemetries ?? [];
    const rows: Array<{
      equipment_id: string;
      ts: string;
      power_w: number | null;
      voltage: number | null;
      current_a: number | null;
      energy_wh: number | null;
      temperature_c: number | null;
    }> = [];

    for (const t of telemetries) {
      if (!t.date) continue;
      rows.push({
        equipment_id: chunk.equipment_id,
        ts: t.date,
        power_w: t.totalActivePower ?? t.activePower ?? null,
        voltage: t.dcVoltage ?? t.voltage ?? null,
        current_a: t.current ?? null,
        energy_wh: t.totalEnergy ?? t.energy ?? null,
        temperature_c: t.temperature ?? null,
      });
    }

    if (rows.length > 0) {
      // Insert in batches, ignore conflicts (overlapping data)
      const BATCH = 500;
      for (let i = 0; i < rows.length; i += BATCH) {
        const batch = rows.slice(i, i + BATCH);
        await supabase
          .from("equipment_telemetry")
          .upsert(batch, { onConflict: "equipment_id,ts", ignoreDuplicates: true });
      }
    }

    // Mark chunk done
    await supabase
      .from("sync_chunks")
      .update({ status: "done" })
      .eq("id", chunk.id);

    const newCompleted = job.completed_chunks + 1;
    await supabase
      .from("sync_jobs")
      .update({
        completed_chunks: newCompleted,
        current_equipment: equipment.name || serial,
        current_period: `${chunk.period_start} → ${chunk.period_end}`,
        updated_at: new Date().toISOString(),
      })
      .eq("id", jobId);

    const allDone = newCompleted >= job.total_chunks;
    if (allDone) {
      await supabase
        .from("sync_jobs")
        .update({ status: "complete", updated_at: new Date().toISOString() })
        .eq("id", jobId);

      await supabase
        .from("solar_systems")
        .update({ last_synced_at: new Date().toISOString() })
        .eq("id", job.system_id);
    }

    return NextResponse.json({
      status: allDone ? "complete" : "running",
      total_chunks: job.total_chunks,
      completed_chunks: newCompleted,
      current_equipment: equipment.name || serial,
      current_period: `${chunk.period_start} → ${chunk.period_end}`,
      rows_inserted: rows.length,
      done: allDone,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    await supabase
      .from("sync_chunks")
      .update({ status: "error", error_message: message })
      .eq("id", chunk.id);

    const newCompleted = job.completed_chunks + 1;
    await supabase
      .from("sync_jobs")
      .update({
        completed_chunks: newCompleted,
        updated_at: new Date().toISOString(),
      })
      .eq("id", jobId);

    return NextResponse.json({
      status: "running",
      total_chunks: job.total_chunks,
      completed_chunks: newCompleted,
      error: message,
    });
  }
}
