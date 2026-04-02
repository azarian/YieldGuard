import { createClient } from "@/lib/supabase/server";
import { getSiteDetails, getEquipmentList } from "@/lib/solaredge/client";
import { computeGaps } from "@/lib/sync-periods";
import { NextRequest, NextResponse } from "next/server";

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

  const { data: system, error: systemError } = await supabase
    .from("solar_systems")
    .select("*")
    .eq("user_id", user.id)
    .single();

  if (systemError || !system) {
    return NextResponse.json(
      { error: "No solar system registered" },
      { status: 404 }
    );
  }

  const siteId = system.site_id.trim();
  const apiKey = system.api_key.trim();
  const systemId = system.id;

  let dateFrom: string | null = null;
  let dateTo: string | null = null;

  try {
    const body = await request.json().catch(() => ({}));
    if (body.date_from) dateFrom = body.date_from;
    if (body.date_to) dateTo = body.date_to;
  } catch {
    // No body
  }

  try {
    // Check for existing running job
    const { data: existingJobs } = await supabase
      .from("sync_jobs")
      .select("id, status, total_chunks, completed_chunks, current_equipment, current_period, updated_at")
      .eq("system_id", systemId)
      .not("current_equipment", "ilike", "%optimizer%")
      .in("status", ["running", "paused"])
      .order("created_at", { ascending: false })
      .limit(1);

    if (existingJobs && existingJobs.length > 0) {
      const job = existingJobs[0];
      const updatedAt = new Date(job.updated_at ?? 0);
      const staleMs = 30 * 60 * 1000;
      const isStale = Date.now() - updatedAt.getTime() > staleMs;

      if (isStale) {
        const finalStatus = job.completed_chunks > 0 ? "complete" : "error";
        await supabase
          .from("sync_jobs")
          .update({
            status: finalStatus,
            error_message: finalStatus === "error" ? "Abandoned (stale)" : null,
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

    // Fetch site details and equipment list
    const [detailsData, equipmentData] = await Promise.all([
      getSiteDetails(siteId, apiKey).catch(() => null),
      getEquipmentList(siteId, apiKey),
    ]);

    let installationDate: string | null = null;
    if (detailsData?.details) {
      const d = detailsData.details;
      const loc = d.location ?? {};
      installationDate = (d.installationDate as string) ?? null;
      await supabase
        .from("solar_systems")
        .update({
          latitude: loc.latitude ?? null,
          longitude: loc.longitude ?? null,
          peak_power_kwp: (d.peakPower as number) ?? null,
          azimuth: (d.azimuth as number) ?? null,
          tilt: (d.tilt as number) ?? null,
          installation_date: installationDate,
        })
        .eq("id", systemId);
    }

    const reporters = equipmentData.reporters?.list ?? [];

    const equipmentRows = reporters.map((r) => ({
      system_id: systemId,
      serial_number: r.serialNumber,
      equipment_type: r.type?.toLowerCase().includes("optimizer")
        ? "optimizer"
        : "inverter",
      name: r.name || null,
      manufacturer: r.manufacturer || null,
      model: r.model || null,
      connected_to: r.connectedTo || null,
    }));

    if (equipmentRows.length > 0) {
      await supabase
        .from("equipment")
        .upsert(equipmentRows, { onConflict: "system_id,serial_number" });
    }

    const { data: dbEquipment } = await supabase
      .from("equipment")
      .select("id, serial_number, equipment_type")
      .eq("system_id", systemId)
      .eq("equipment_type", "inverter");

    if (!dbEquipment || dbEquipment.length === 0) {
      return NextResponse.json(
        { error: "No equipment found for this site" },
        { status: 404 }
      );
    }

    // Determine desired date range
    const today = new Date();
    let startFrom = new Date();
    startFrom.setFullYear(startFrom.getFullYear() - 7);

    if (installationDate) {
      const instDate = new Date(installationDate);
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

    // Build chunks using gap analysis against fetched_periods
    const chunks: Array<{
      equipment_id: string;
      period_start: string;
      period_end: string;
    }> = [];

    for (const equip of dbEquipment) {
      const { data: fetchedPeriods } = await supabase
        .from("fetched_periods")
        .select("period_start, period_end")
        .eq("equipment_id", equip.id)
        .eq("source", "public_api")
        .order("period_start", { ascending: true });

      const gaps = computeGaps(
        desiredStartStr,
        desiredEndStr,
        fetchedPeriods ?? []
      );

      const chunkSize = 7;
      for (const gap of gaps) {
        let cursor = new Date(gap.start + "T00:00:00Z");
        const gapEnd = new Date(gap.end + "T00:00:00Z");

        while (cursor < gapEnd) {
          const chunkEnd = addDays(cursor, chunkSize);
          const clamped = chunkEnd > gapEnd ? gapEnd : chunkEnd;
          chunks.push({
            equipment_id: equip.id,
            period_start: formatDate(cursor),
            period_end: formatDate(clamped),
          });
          cursor = clamped;
        }
      }
    }

    if (chunks.length === 0) {
      await supabase
        .from("solar_systems")
        .update({ last_synced_at: new Date().toISOString() })
        .eq("id", systemId);

      return NextResponse.json({
        job_id: null,
        total_chunks: 0,
        completed_chunks: 0,
        status: "complete",
        message: "Already up to date",
      });
    }

    const { data: job, error: jobError } = await supabase
      .from("sync_jobs")
      .insert({
        system_id: systemId,
        status: "running",
        total_chunks: chunks.length,
        completed_chunks: 0,
        current_equipment: "inverter sync",
      })
      .select()
      .single();

    if (jobError || !job) {
      return NextResponse.json(
        { error: `Failed to create sync job: ${jobError?.message}` },
        { status: 500 }
      );
    }

    const chunkRows = chunks.map((c) => ({
      job_id: job.id,
      equipment_id: c.equipment_id,
      period_start: c.period_start,
      period_end: c.period_end,
      status: "pending",
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

    return NextResponse.json({
      job_id: job.id,
      total_chunks: chunks.length,
      completed_chunks: 0,
      status: "running",
      equipment_count: dbEquipment.length,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      { error: `Failed to start sync: ${message}` },
      { status: 500 }
    );
  }
}
