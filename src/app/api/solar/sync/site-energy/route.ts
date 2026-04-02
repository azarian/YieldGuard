import { createClient } from "@/lib/supabase/server";
import { getSiteEnergy, SolarEdgeRateLimitError } from "@/lib/solaredge/client";
import { NextRequest, NextResponse } from "next/server";

function formatDate(d: Date): string {
  return d.toISOString().split("T")[0];
}

function addMonths(date: Date, months: number): Date {
  const d = new Date(date);
  d.setMonth(d.getMonth() + months);
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
    .select("id, site_id, api_key, installation_date")
    .eq("user_id", user.id)
    .single();

  if (systemError || !system) {
    return NextResponse.json(
      { error: "No solar system registered" },
      { status: 404 }
    );
  }

  const body = await request.json().catch(() => ({}));
  const dateFrom: string | null = body.date_from ?? null;
  const dateTo: string | null = body.date_to ?? null;

  const siteId = system.site_id.trim();
  const apiKey = system.api_key.trim();
  const systemId = system.id;

  const today = new Date();
  const oneYearAgo = new Date(today);
  oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);

  let startDate = system.installation_date
    ? new Date(system.installation_date)
    : oneYearAgo;

  if (dateFrom) {
    const userStart = new Date(dateFrom);
    if (!isNaN(userStart.getTime())) startDate = userStart;
  }

  let endDate = today;
  if (dateTo) {
    const userEnd = new Date(dateTo);
    if (!isNaN(userEnd.getTime()) && userEnd <= today) endDate = userEnd;
  }

  // Check sync_coverage for already-covered periods (both fetched and missing)
  const { data: coveredPeriods } = await supabase
    .from("sync_coverage")
    .select("period_start, period_end")
    .eq("system_id", systemId)
    .eq("source", "site_energy")
    .order("period_start", { ascending: true });

  const { computeGaps } = await import("@/lib/sync-periods");
  const gaps = computeGaps(
    formatDate(startDate),
    formatDate(endDate),
    (coveredPeriods ?? []).map((p) => ({
      period_start: p.period_start,
      period_end: p.period_end,
    }))
  );

  if (gaps.length === 0) {
    return NextResponse.json({
      status: "up_to_date",
      message: "Site energy data is already up to date.",
    });
  }

  const ranges = gaps.map((g) => ({ start: new Date(g.start), end: new Date(g.end) }));

  // Fetch each range month by month
  let totalRecords = 0;
  let totalStored = 0;

  for (const range of ranges) {
    let cursor = new Date(range.start);
    cursor.setDate(1);
    const rangeEnd = range.end;

    while (cursor <= rangeEnd) {
      const monthEnd = new Date(
        Math.min(addMonths(cursor, 1).getTime() - 86400000, rangeEnd.getTime())
      );
      const reqStart =
        cursor < range.start ? formatDate(range.start) : formatDate(cursor);
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

      // Record coverage (fetched or missing)
      await supabase.from("sync_coverage").insert({
        system_id: systemId,
        source: "site_energy",
        period_start: reqStart,
        period_end: reqEnd,
        status: rows.length > 0 ? "fetched" : "missing",
      });

      cursor = addMonths(cursor, 1);
    }
  }

  return NextResponse.json({
    status: "ok",
    records_fetched: totalRecords,
    records_stored: totalStored,
    ranges: ranges.map((r) => ({
      start: formatDate(r.start),
      end: formatDate(r.end),
    })),
  });
}
