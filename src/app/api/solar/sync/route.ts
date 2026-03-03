import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

const SOLAREDGE_BASE = "https://monitoringapi.solaredge.com";

function formatDate(date: Date): string {
  return date.toISOString().split("T")[0]; // YYYY-MM-DD
}

function formatDateTime(date: Date): string {
  // SolarEdge expects: YYYY-MM-DD HH:MM:SS
  return date.toISOString().replace("T", " ").substring(0, 19);
}

export async function POST() {
  const supabase = await createClient();

  // 1. Authenticate user
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // 2. Get the user's solar system
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

  // 3. Calculate date range (last 7 days)
  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(endDate.getDate() - 7);

  const startDateStr = formatDate(startDate);
  const endDateStr = formatDate(endDate);
  const startDateTimeStr = formatDateTime(startDate);
  const endDateTimeStr = formatDateTime(endDate);

  try {
    // 4. Fetch from all three SolarEdge endpoints in parallel
    const overviewUrl = `${SOLAREDGE_BASE}/site/${siteId}/overview?api_key=${apiKey}`;
    const energyUrl = `${SOLAREDGE_BASE}/site/${siteId}/energy?timeUnit=DAY&startDate=${startDateStr}&endDate=${endDateStr}&api_key=${apiKey}`;
    const powerUrl = `${SOLAREDGE_BASE}/site/${siteId}/power?startTime=${encodeURIComponent(startDateTimeStr)}&endTime=${encodeURIComponent(endDateTimeStr)}&api_key=${apiKey}`;

    const [overviewRes, energyRes, powerRes] = await Promise.all([
      fetch(overviewUrl),
      fetch(energyUrl),
      fetch(powerUrl),
    ]);

    // Read all response bodies (even on error, SolarEdge returns useful info)
    const overviewData = await overviewRes.json().catch(() => null);
    const energyData = await energyRes.json().catch(() => null);
    const powerData = await powerRes.json().catch(() => null);

    // Check for API errors
    if (!overviewRes.ok || !energyRes.ok || !powerRes.ok) {
      const errors = [];
      if (!overviewRes.ok)
        errors.push(`Overview ${overviewRes.status}: ${JSON.stringify(overviewData)}`);
      if (!energyRes.ok)
        errors.push(`Energy ${energyRes.status}: ${JSON.stringify(energyData)}`);
      if (!powerRes.ok)
        errors.push(`Power ${powerRes.status}: ${JSON.stringify(powerData)}`);
      return NextResponse.json(
        { error: `SolarEdge API error — ${errors.join(" | ")}` },
        { status: 502 }
      );
    }

    // 5. Delete old sync data for this system, then insert fresh
    await supabase
      .from("sync_data")
      .delete()
      .eq("system_id", systemId);

    // Insert all three data types
    const { error: insertError } = await supabase.from("sync_data").insert([
      {
        system_id: systemId,
        sync_type: "overview",
        data: overviewData,
        period_start: startDateStr,
        period_end: endDateStr,
      },
      {
        system_id: systemId,
        sync_type: "energy",
        data: energyData,
        period_start: startDateStr,
        period_end: endDateStr,
      },
      {
        system_id: systemId,
        sync_type: "power",
        data: powerData,
        period_start: startDateStr,
        period_end: endDateStr,
      },
    ]);

    if (insertError) {
      return NextResponse.json(
        { error: `Failed to store sync data: ${insertError.message}` },
        { status: 500 }
      );
    }

    // 6. Update last_synced_at on the system
    await supabase
      .from("solar_systems")
      .update({ last_synced_at: new Date().toISOString() })
      .eq("id", systemId);

    // 7. Return the fetched data
    return NextResponse.json({
      success: true,
      data: {
        overview: overviewData,
        energy: energyData,
        power: powerData,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      { error: `Failed to sync: ${message}` },
      { status: 500 }
    );
  }
}

