import { createClient } from "@/lib/supabase/server";
import { getSiteEnergy, SolarEdgeRateLimitError } from "@/lib/solaredge/client";
import { NextResponse } from "next/server";

function formatDate(d: Date): string {
  return d.toISOString().split("T")[0];
}

function addMonths(date: Date, months: number): Date {
  const d = new Date(date);
  d.setMonth(d.getMonth() + months);
  return d;
}

export async function POST() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: system, error: systemError } = await supabase
    .from("solar_systems")
    .select("id, site_id, api_key, installation_date")
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

  const today = new Date();
  const oneYearAgo = new Date(today);
  oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);

  let startDate = system.installation_date
    ? new Date(system.installation_date)
    : oneYearAgo;

  // Resume from last stored timestamp if data already exists
  const { data: latest } = await supabase
    .from("site_energy_15min")
    .select("ts")
    .eq("system_id", systemId)
    .order("ts", { ascending: false })
    .limit(1);

  if (latest && latest.length > 0) {
    const lastDate = new Date(latest[0].ts);
    lastDate.setDate(lastDate.getDate() + 1);
    if (lastDate > startDate) startDate = lastDate;
  }

  const endDate = today;

  if (startDate >= endDate) {
    return NextResponse.json({
      status: "up_to_date",
      message: "Site energy data is already up to date.",
    });
  }

  // Fetch month by month
  let cursor = new Date(startDate);
  cursor.setDate(1);
  let totalRecords = 0;
  let totalStored = 0;

  while (cursor <= endDate) {
    const monthEnd = new Date(
      Math.min(addMonths(cursor, 1).getTime() - 86400000, endDate.getTime())
    );
    const reqStart =
      cursor < startDate ? formatDate(startDate) : formatDate(cursor);
    const reqEnd = formatDate(monthEnd);

    let values;
    try {
      values = await getSiteEnergy(siteId, apiKey, reqStart, reqEnd);
    } catch (err) {
      if (err instanceof SolarEdgeRateLimitError) {
        return NextResponse.json(
          {
            error: `Rate limited by SolarEdge. Try again in ${err.retryAfterSeconds}s.`,
            records_stored: totalStored,
          },
          { status: 429 }
        );
      }
      return NextResponse.json(
        {
          error: `SolarEdge API error: ${err instanceof Error ? err.message : String(err)}`,
          period: `${reqStart} → ${reqEnd}`,
        },
        { status: 502 }
      );
    }

    const rows: Array<{ system_id: string; ts: string; energy_wh: number }> =
      [];
    for (const v of values) {
      if (v.value != null) {
        rows.push({ system_id: systemId, ts: v.date, energy_wh: v.value });
      }
    }

    totalRecords += rows.length;

    const BATCH = 500;
    for (let i = 0; i < rows.length; i += BATCH) {
      const batch = rows.slice(i, i + BATCH);
      const { error: insertError } = await supabase
        .from("site_energy_15min")
        .upsert(batch, { onConflict: "system_id,ts", ignoreDuplicates: true });

      if (!insertError) totalStored += batch.length;
    }

    cursor = addMonths(cursor, 1);
  }

  return NextResponse.json({
    status: "ok",
    records_fetched: totalRecords,
    records_stored: totalStored,
    period: { start: formatDate(startDate), end: formatDate(endDate) },
  });
}
