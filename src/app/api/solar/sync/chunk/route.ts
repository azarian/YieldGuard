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

  // Pick next pending chunk
  const { data: chunks } = await supabase
    .from("sync_chunks")
    .select("id, equipment_id, period_start, period_end")
    .eq("job_id", jobId)
    .eq("status", "pending")
    .order("period_start", { ascending: true })
    .limit(1);

  if (!chunks || chunks.length === 0) {
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

  try {
    let telemetries: Array<Record<string, unknown>> = [];

    const startTime = encodeURIComponent(formatDateTime(chunk.period_start));
    const endTime = encodeURIComponent(formatDateTime(chunk.period_end));
    const telemetryUrl = `${SOLAREDGE_BASE}/equipment/${siteId}/${serial}/data?startTime=${startTime}&endTime=${endTime}&api_key=${apiKey}`;

    const telemetryRes = await fetch(telemetryUrl);

    if (telemetryRes.status === 429) {
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

    if (telemetryRes.ok) {
      const telemetryData = await telemetryRes.json();
      telemetries =
        telemetryData?.data?.telemetries ?? telemetryData?.telemetries ?? [];
    }

    if (!telemetryRes.ok && telemetries.length === 0) {
      const errorBody = await telemetryRes.text().catch(() => "");
      await supabase
        .from("sync_chunks")
        .update({
          status: "error",
          error_message: `HTTP ${telemetryRes.status}: ${errorBody.substring(0, 200)}`,
        })
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

      return NextResponse.json({
        status: "running",
        total_chunks: job.total_chunks,
        completed_chunks: newCompleted,
        current_equipment: equipment.name || serial,
        current_period: `${chunk.period_start} → ${chunk.period_end}`,
        error: `Chunk failed: HTTP ${telemetryRes.status}`,
      });
    }

    // Parse and insert telemetry rows
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
      const date = t.date as string | undefined;
      if (!date) continue;
      rows.push({
        equipment_id: chunk.equipment_id,
        ts: date,
        power_w:
          (t.totalActivePower as number) ??
          (t.activePower as number) ??
          (t.power as number) ??
          null,
        voltage:
          (t.dcVoltage as number) ?? (t.voltage as number) ?? null,
        current_a: (t.current as number) ?? null,
        energy_wh:
          (t.totalEnergy as number) ?? (t.energy as number) ?? null,
        temperature_c: (t.temperature as number) ?? null,
      });
    }

    if (rows.length > 0) {
      const BATCH = 500;
      for (let i = 0; i < rows.length; i += BATCH) {
        const batch = rows.slice(i, i + BATCH);
        await supabase
          .from("equipment_telemetry")
          .upsert(batch, {
            onConflict: "equipment_id,ts",
            ignoreDuplicates: true,
          });
      }
    }

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
