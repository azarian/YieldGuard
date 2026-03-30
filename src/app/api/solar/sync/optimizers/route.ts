import { createClient } from "@/lib/supabase/server";
import { decrypt } from "@/lib/crypto";
import { computeGaps } from "@/lib/sync-periods";
import { NextRequest, NextResponse } from "next/server";

const PY_BASE =
  process.env.NODE_ENV === "development"
    ? "http://127.0.0.1:8000"
    : "";

function formatDate(date: Date): string {
  return date.toISOString().split("T")[0];
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

export async function POST(request: NextRequest) {
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
      "id, site_id, api_key, se_portal_username, se_portal_password_encrypted, installation_date"
    )
    .eq("user_id", user.id)
    .single();

  if (!system) {
    return NextResponse.json(
      { error: "No solar system registered" },
      { status: 404 }
    );
  }

  if (!system.se_portal_username || !system.se_portal_password_encrypted) {
    return NextResponse.json(
      {
        error:
          "Portal credentials not configured. Add your SolarEdge portal username and password in My System settings.",
      },
      { status: 400 }
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

  const body = await request.json().catch(() => ({}));
  const dateFrom: string | null = body.date_from ?? null;
  const dateTo: string | null = body.date_to ?? null;

  const siteId = system.site_id.trim();
  const systemId = system.id;

  try {
    // Check for existing optimizer sync job
    const { data: existingJobs } = await supabase
      .from("sync_jobs")
      .select(
        "id, status, total_chunks, completed_chunks, current_equipment, current_period, updated_at"
      )
      .eq("system_id", systemId)
      .like("current_equipment", "%optimizer%")
      .in("status", ["running", "paused"])
      .order("created_at", { ascending: false })
      .limit(1);

    if (existingJobs && existingJobs.length > 0) {
      const job = existingJobs[0];
      const updatedAt = new Date(job.updated_at ?? 0);
      const staleMs = 30 * 60 * 1000;
      const isStale = Date.now() - updatedAt.getTime() > staleMs;

      if (isStale) {
        const finalStatus =
          job.completed_chunks > 0 ? "complete" : "error";
        await supabase
          .from("sync_jobs")
          .update({
            status: finalStatus,
            error_message:
              finalStatus === "error" ? "Abandoned (stale)" : null,
            updated_at: new Date().toISOString(),
          })
          .eq("id", job.id);
      } else {
        return NextResponse.json({
          job_id: job.id,
          total_chunks: job.total_chunks,
          completed_chunks: job.completed_chunks,
          status: job.status,
          current_equipment: job.current_equipment,
          current_period: job.current_period,
          resumed: true,
        });
      }
    }

    // Discover optimizers via the Python portal endpoint
    const origin = request.headers.get("origin") || request.nextUrl.origin;
    const pyUrl = PY_BASE
      ? `${PY_BASE}/api/py/portal/discover`
      : `${origin}/api/py/portal/discover`;

    const discoverRes = await fetch(pyUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        site_id: siteId,
        username: system.se_portal_username,
        password: portalPassword,
      }),
    });

    if (!discoverRes.ok) {
      const errBody = await discoverRes.json().catch(() => ({}));
      return NextResponse.json(
        {
          error:
            errBody.detail ||
            `Portal authentication failed (HTTP ${discoverRes.status})`,
        },
        { status: discoverRes.status }
      );
    }

    const discoverData = await discoverRes.json();
    const optimizers: Array<{
      internal_id: number;
      serial_number: string;
      name: string;
      today_energy_kwh: number;
    }> = discoverData.optimizers ?? [];

    if (optimizers.length === 0) {
      return NextResponse.json(
        { error: "No optimizers found for this site" },
        { status: 404 }
      );
    }

    // Upsert optimizers into equipment table
    const equipmentRows = optimizers.map((opt) => ({
      system_id: systemId,
      serial_number: opt.serial_number,
      equipment_type: "optimizer" as const,
      name: opt.name || null,
      manufacturer: "SolarEdge",
      model: null,
      connected_to: null,
    }));

    await supabase
      .from("equipment")
      .upsert(equipmentRows, { onConflict: "system_id,serial_number" });

    // Store internal_id mapping in a metadata column or use a join
    // For simplicity, we'll pass internal_id through the sync chunks
    const { data: dbOptimizers } = await supabase
      .from("equipment")
      .select("id, serial_number")
      .eq("system_id", systemId)
      .eq("equipment_type", "optimizer");

    if (!dbOptimizers || dbOptimizers.length === 0) {
      return NextResponse.json(
        { error: "Failed to save optimizer records" },
        { status: 500 }
      );
    }

    // Build a serial_number → internal_id map from the discovery response
    const snToInternalId = new Map(
      optimizers.map((o) => [o.serial_number, o.internal_id])
    );

    // Determine date range
    const today = new Date();
    let startFrom = new Date();
    startFrom.setFullYear(startFrom.getFullYear() - 1);

    if (system.installation_date) {
      const instDate = new Date(system.installation_date);
      if (instDate > startFrom) startFrom = instDate;
    }

    if (dateFrom) {
      const userStart = new Date(dateFrom);
      if (!isNaN(userStart.getTime())) startFrom = userStart;
    }

    let endAt = today;
    if (dateTo) {
      const userEnd = new Date(dateTo);
      if (!isNaN(userEnd.getTime()) && userEnd < today) endAt = userEnd;
    }

    const desiredStartStr = formatDate(startFrom);
    const desiredEndStr = formatDate(endAt);

    // Create 1-day chunks only for unfetched gaps
    const chunks: Array<{
      equipment_id: string;
      period_start: string;
      period_end: string;
    }> = [];

    for (const dbOpt of dbOptimizers) {
      const internalId = snToInternalId.get(dbOpt.serial_number);
      if (!internalId) continue;

      const { data: fetchedPeriods } = await supabase
        .from("fetched_periods")
        .select("period_start, period_end")
        .eq("equipment_id", dbOpt.id)
        .eq("source", "portal_api")
        .order("period_start", { ascending: true });

      const gaps = computeGaps(
        desiredStartStr,
        desiredEndStr,
        fetchedPeriods ?? []
      );

      for (const gap of gaps) {
        let cursor = new Date(gap.start + "T00:00:00Z");
        const gapEnd = new Date(gap.end + "T00:00:00Z");

        while (cursor < gapEnd) {
          chunks.push({
            equipment_id: dbOpt.id,
            period_start: formatDate(cursor),
            period_end: formatDate(addDays(cursor, 1)),
          });
          cursor = addDays(cursor, 1);
        }
      }
    }

    if (chunks.length === 0) {
      return NextResponse.json({
        job_id: null,
        total_chunks: 0,
        completed_chunks: 0,
        status: "complete",
        message: "Already up to date",
        optimizer_count: dbOptimizers.length,
      });
    }

    // Create sync job
    const { data: job, error: jobError } = await supabase
      .from("sync_jobs")
      .insert({
        system_id: systemId,
        status: "running",
        total_chunks: chunks.length,
        completed_chunks: 0,
        current_equipment: "optimizer sync",
      })
      .select()
      .single();

    if (jobError || !job) {
      return NextResponse.json(
        { error: `Failed to create sync job: ${jobError?.message}` },
        { status: 500 }
      );
    }

    // Insert chunks in batches
    const chunkRows = chunks.map((c) => ({
      job_id: job.id,
      equipment_id: c.equipment_id,
      period_start: c.period_start,
      period_end: c.period_end,
      status: "pending" as const,
    }));

    const BATCH = 500;
    for (let i = 0; i < chunkRows.length; i += BATCH) {
      const batch = chunkRows.slice(i, i + BATCH);
      const { error: chunkError } = await supabase
        .from("sync_chunks")
        .insert(batch);
      if (chunkError) {
        return NextResponse.json(
          { error: `Failed to create sync chunks: ${chunkError.message}` },
          { status: 500 }
        );
      }
    }

    // Store the internal_id mapping as job metadata so the chunk processor can use it
    // We'll store it as a JSON blob on the job's error_message field temporarily,
    // or better, pass it through the API. We'll use a helper table approach:
    // Store internal_id in connected_to field of equipment.
    for (const opt of optimizers) {
      await supabase
        .from("equipment")
        .update({ connected_to: String(opt.internal_id) })
        .eq("system_id", systemId)
        .eq("serial_number", opt.serial_number)
        .eq("equipment_type", "optimizer");
    }

    return NextResponse.json({
      job_id: job.id,
      total_chunks: chunks.length,
      completed_chunks: 0,
      status: "running",
      optimizer_count: dbOptimizers.length,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      { error: `Failed to start optimizer sync: ${message}` },
      { status: 500 }
    );
  }
}
