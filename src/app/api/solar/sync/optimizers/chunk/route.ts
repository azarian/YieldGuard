import { createClient } from "@/lib/supabase/server";
import { decrypt } from "@/lib/crypto";
import { NextRequest, NextResponse } from "next/server";

const PY_BASE =
  process.env.NODE_ENV === "development"
    ? "http://127.0.0.1:8000"
    : "";

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
    return NextResponse.json(
      { error: "job_id is required" },
      { status: 400 }
    );
  }

  const { data: job, error: jobError } = await supabase
    .from("sync_jobs")
    .select("id, system_id, status, total_chunks, completed_chunks")
    .eq("id", jobId)
    .single();

  if (jobError || !job) {
    return NextResponse.json(
      { error: "Sync job not found" },
      { status: 404 }
    );
  }

  if (job.status !== "running") {
    return NextResponse.json({
      status: job.status,
      total_chunks: job.total_chunks,
      completed_chunks: job.completed_chunks,
      done: true,
    });
  }

  // Get system credentials
  const { data: system } = await supabase
    .from("solar_systems")
    .select(
      "site_id, se_portal_username, se_portal_password_encrypted"
    )
    .eq("id", job.system_id)
    .single();

  if (
    !system ||
    !system.se_portal_username ||
    !system.se_portal_password_encrypted
  ) {
    return NextResponse.json(
      { error: "Portal credentials not found" },
      { status: 404 }
    );
  }

  let portalPassword: string;
  try {
    portalPassword = decrypt(system.se_portal_password_encrypted);
  } catch {
    return NextResponse.json(
      { error: "Failed to decrypt portal credentials" },
      { status: 500 }
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
      .update({
        status: "complete",
        updated_at: new Date().toISOString(),
      })
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

  // Get equipment details (serial_number and internal_id stored in connected_to)
  const { data: equipment } = await supabase
    .from("equipment")
    .select("serial_number, name, connected_to")
    .eq("id", chunk.equipment_id)
    .single();

  if (!equipment || !equipment.connected_to) {
    await supabase
      .from("sync_chunks")
      .update({
        status: "error",
        error_message: "Equipment not found or missing internal_id",
      })
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
      skipped: true,
    });
  }

  const internalId = equipment.connected_to;
  const siteId = system.site_id.trim();

  try {
    // Call Python backend to fetch one day of telemetry
    const origin =
      request.headers.get("origin") || request.nextUrl.origin;
    const pyUrl = PY_BASE
      ? `${PY_BASE}/api/py/portal/fetch-chunk`
      : `${origin}/api/py/portal/fetch-chunk`;

    const pyRes = await fetch(pyUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        site_id: siteId,
        username: system.se_portal_username,
        password: portalPassword,
        internal_id: internalId,
        serial_number: equipment.serial_number,
        name: equipment.name || "",
        date: chunk.period_start,
        parameter: "Power",
      }),
    });

    if (!pyRes.ok) {
      const errBody = await pyRes.json().catch(() => ({}));
      const errMsg =
        errBody.detail || `Portal HTTP ${pyRes.status}`;

      // On 429 or rate-limit-like errors, pause the job
      if (pyRes.status === 429) {
        await supabase
          .from("sync_jobs")
          .update({
            status: "paused",
            updated_at: new Date().toISOString(),
          })
          .eq("id", jobId);

        return NextResponse.json({
          status: "rate_limited",
          retry_after: 60,
          total_chunks: job.total_chunks,
          completed_chunks: job.completed_chunks,
        });
      }

      await supabase
        .from("sync_chunks")
        .update({
          status: "error",
          error_message: errMsg.substring(0, 500),
        })
        .eq("id", chunk.id);

      const newCompleted = job.completed_chunks + 1;
      await supabase
        .from("sync_jobs")
        .update({
          completed_chunks: newCompleted,
          current_equipment: equipment.name || equipment.serial_number,
          current_period: chunk.period_start,
          updated_at: new Date().toISOString(),
        })
        .eq("id", jobId);

      return NextResponse.json({
        status: "running",
        total_chunks: job.total_chunks,
        completed_chunks: newCompleted,
        current_equipment: equipment.name || equipment.serial_number,
        current_period: chunk.period_start,
        error: `Chunk failed: ${errMsg}`,
      });
    }

    const pyData = await pyRes.json();
    const dataPoints: Array<{ ts: string; value: number }> =
      pyData.data_points ?? [];

    // Insert telemetry rows
    const rows = dataPoints.map((dp) => ({
      equipment_id: chunk.equipment_id,
      ts: dp.ts,
      power_w: dp.value,
      voltage: null,
      current_a: null,
      energy_wh: null,
      temperature_c: null,
    }));

    if (rows.length > 0) {
      const BATCH = 500;
      for (let i = 0; i < rows.length; i += BATCH) {
        const batch = rows.slice(i, i + BATCH);
        await supabase.from("equipment_telemetry").upsert(batch, {
          onConflict: "equipment_id,ts",
          ignoreDuplicates: true,
        });
      }
    }

    await supabase
      .from("sync_chunks")
      .update({ status: "done" })
      .eq("id", chunk.id);

    // Record the fetched period
    await supabase.from("fetched_periods").insert({
      equipment_id: chunk.equipment_id,
      source: "portal_api",
      period_start: chunk.period_start,
      period_end: chunk.period_end,
    });

    await supabase.from("sync_coverage").insert({
      system_id: job.system_id,
      source: "optimizer",
      period_start: chunk.period_start,
      period_end: chunk.period_end,
      status: rows.length > 0 ? "fetched" : "missing",
    });

    const newCompleted = job.completed_chunks + 1;
    await supabase
      .from("sync_jobs")
      .update({
        completed_chunks: newCompleted,
        current_equipment: equipment.name || equipment.serial_number,
        current_period: chunk.period_start,
        updated_at: new Date().toISOString(),
      })
      .eq("id", jobId);

    const allDone = newCompleted >= job.total_chunks;
    if (allDone) {
      await supabase
        .from("sync_jobs")
        .update({
          status: "complete",
          updated_at: new Date().toISOString(),
        })
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
      current_equipment: equipment.name || equipment.serial_number,
      current_period: chunk.period_start,
      rows_inserted: rows.length,
      done: allDone,
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Unknown error";
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
