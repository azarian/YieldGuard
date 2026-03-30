/**
 * Compute date gaps between a desired range and already-fetched periods.
 * Returns an array of {start, end} date strings (YYYY-MM-DD) that still need fetching.
 */

interface Period {
  period_start: string;
  period_end: string;
}

export function computeGaps(
  desiredStart: string,
  desiredEnd: string,
  fetchedPeriods: Period[]
): Array<{ start: string; end: string }> {
  if (fetchedPeriods.length === 0) {
    return [{ start: desiredStart, end: desiredEnd }];
  }

  const sorted = [...fetchedPeriods].sort(
    (a, b) => a.period_start.localeCompare(b.period_start)
  );

  const merged: Array<{ start: string; end: string }> = [];
  let curStart = sorted[0].period_start;
  let curEnd = sorted[0].period_end;

  for (let i = 1; i < sorted.length; i++) {
    const nextStart = sorted[i].period_start;
    const nextEnd = sorted[i].period_end;
    if (nextStart <= addDaysStr(curEnd, 1)) {
      if (nextEnd > curEnd) curEnd = nextEnd;
    } else {
      merged.push({ start: curStart, end: curEnd });
      curStart = nextStart;
      curEnd = nextEnd;
    }
  }
  merged.push({ start: curStart, end: curEnd });

  const gaps: Array<{ start: string; end: string }> = [];
  let cursor = desiredStart;

  for (const period of merged) {
    if (period.start > cursor && period.start <= desiredEnd) {
      const gapEnd = period.start < desiredEnd ? period.start : desiredEnd;
      if (cursor < gapEnd) {
        gaps.push({ start: cursor, end: gapEnd });
      }
    }
    if (period.end >= cursor) {
      cursor = addDaysStr(period.end, 1);
    }
  }

  if (cursor <= desiredEnd) {
    gaps.push({ start: cursor, end: desiredEnd });
  }

  return gaps;
}

function addDaysStr(dateStr: string, days: number): string {
  const d = new Date(dateStr + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().split("T")[0];
}
