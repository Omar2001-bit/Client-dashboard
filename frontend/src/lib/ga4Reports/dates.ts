// Ported near-verbatim from VC3/GA4-simply-layer's src/lib/dates.ts — pure date-arithmetic
// logic, no framework dependency. The comparison-alignment subset (detectGranularity,
// enumerateBuckets, granularityDims, isoWeek helpers) is duplicated in
// server/ga4Reporting.js as CommonJS, since server/ and frontend/ share no code in this
// repo — keep both copies in sync by hand if either is ever bug-fixed.
import type { CompareSel, DateRangeSel, ResolvedRange } from "./types";

function fmt(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function addDays(d: Date, n: number): Date {
  const c = new Date(d);
  c.setDate(c.getDate() + n);
  return c;
}

/** Latest date with (mostly) complete GA4 data — yesterday. Used as the ceiling everywhere. */
export function maxSelectableDate(today = new Date()): string {
  return fmt(addDays(today, -1));
}

/** Every calendar date from start to end inclusive, as "YYYY-MM-DD". Used to build a
 *  canonical day sequence for a range instead of trusting GA4 to return a dense row per
 *  day (it won't, once a dimension like eventName makes rows genuinely sparse).
 *
 *  Builds each day fresh from the original start Y/M/D + integer offset (never by
 *  incrementally mutating a previous iteration's Date) and compares formatted
 *  "YYYY-MM-DD" strings, not Date instants — a DST transition inside the range still
 *  shifts the wall-clock time-of-day, but never the calendar date each iteration lands
 *  on. The previous instant-comparison version silently dropped a range's last day
 *  whenever it crossed a spring-forward transition in the browser's local timezone
 *  (mirrors the equivalent bug already fixed in server/ga4Reporting.js). */
export function enumerateDates(start: string, end: string): string[] {
  const [sy, sm, sd] = start.split("-").map(Number);
  const out: string[] = [];
  for (let i = 0; ; i++) {
    const s = fmt(new Date(sy, sm - 1, sd + i));
    if (s > end) break;
    out.push(s);
  }
  return out;
}

// ---------- time granularity (daily / weekly / monthly bucketing) ----------

/** GA4 dimensions for each time granularity. "isoWeek" uses isoYear+isoWeek
 *  (Monday-start ISO 8601 weeks) rather than GA4's property-defined `week`, so bucketing
 *  is deterministic regardless of the property's week-start admin setting. */
export type TimeGranularity = "date" | "isoWeek" | "month";

export function granularityDims(g: TimeGranularity): string[] {
  if (g === "date") return ["date"];
  if (g === "isoWeek") return ["isoYear", "isoWeek"];
  return ["yearMonth"];
}

/** Does `dims` consist of exactly one granularity's dimension set (and nothing else)?
 *  That's the "pure time series" case where current/previous can be day/week/month-index
 *  aligned instead of only pairing when the literal bucket value happens to match across
 *  both ranges. */
export function detectGranularity(dims: string[]): TimeGranularity | null {
  if (dims.length === 1 && dims[0] === "date") return "date";
  if (dims.length === 2 && dims[0] === "isoYear" && dims[1] === "isoWeek") return "isoWeek";
  if (dims.length === 1 && dims[0] === "yearMonth") return "month";
  return null;
}

/** ISO 8601 week: Monday-start, week 1 is the week containing the year's first Thursday.
 *  Local-time arithmetic throughout, deliberately not Date.UTC — mixing UTC-based
 *  instants with the local-getter reads these helpers use is exactly how a bucket
 *  boundary silently shifts by a day on a negative-UTC-offset host. */
export function isoWeekOf(d: Date): { isoYear: number; isoWeek: number } {
  const date = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const dayNum = (date.getDay() + 6) % 7; // Mon=0 .. Sun=6
  date.setDate(date.getDate() - dayNum + 3); // now Thursday of this ISO week
  const isoYear = date.getFullYear();
  const jan4 = new Date(isoYear, 0, 4);
  const jan4DayNum = (jan4.getDay() + 6) % 7;
  const week1Monday = new Date(jan4);
  week1Monday.setDate(jan4.getDate() - jan4DayNum);
  const isoWeek = Math.round((date.getTime() - week1Monday.getTime()) / (7 * 86400000)) + 1;
  return { isoYear, isoWeek };
}

/** The Monday that starts a given ISO year/week. */
export function isoWeekMonday(isoYear: number, isoWeek: number): Date {
  const jan4 = new Date(isoYear, 0, 4);
  const jan4DayNum = (jan4.getDay() + 6) % 7;
  const week1Monday = new Date(jan4);
  week1Monday.setDate(jan4.getDate() - jan4DayNum);
  return addDays(week1Monday, (isoWeek - 1) * 7);
}

/** Bucket key GA4 would report for this date, at this granularity — zero-padded so the
 *  same format the API returns (isoWeek "01".."53", yearMonth "202607"). */
export function bucketKey(g: TimeGranularity, d: Date): string {
  if (g === "date") return fmt(d).replaceAll("-", "");
  if (g === "isoWeek") {
    const { isoYear, isoWeek } = isoWeekOf(d);
    return `${isoYear}${String(isoWeek).padStart(2, "0")}`;
  }
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** Every bucket (in GA4's own key format) whose span overlaps [start, end], in
 *  chronological order — the canonical bucket sequence for a range, independent of which
 *  buckets GA4 actually returned rows for. */
export function enumerateBuckets(g: TimeGranularity, start: string, end: string): string[] {
  if (g === "date") return enumerateDates(start, end).map((d) => d.replaceAll("-", ""));
  const startD = new Date(start + "T00:00:00");
  const endD = new Date(end + "T00:00:00");
  const seen = new Set<string>();
  const out: string[] = [];
  if (g === "month") {
    let d = new Date(startD.getFullYear(), startD.getMonth(), 1);
    while (d.getTime() <= endD.getTime()) {
      const k = bucketKey(g, d);
      if (!seen.has(k)) {
        seen.add(k);
        out.push(k);
      }
      d = new Date(d.getFullYear(), d.getMonth() + 1, 1);
    }
    return out;
  }
  // isoWeek: walk Monday-to-Monday. Same DST-safety technique as enumerateDates — each
  // Monday is rebuilt fresh from the anchor Monday's Y/M/D + integer week offset, never
  // by mutating the previous iteration's Date, and the boundary check compares formatted
  // date strings instead of instants.
  const { isoYear, isoWeek } = isoWeekOf(startD);
  const monday0 = isoWeekMonday(isoYear, isoWeek);
  const y0 = monday0.getFullYear();
  const m0 = monday0.getMonth();
  const d0 = monday0.getDate();
  for (let i = 0; ; i++) {
    const monday = new Date(y0, m0, d0 + i * 7);
    if (fmt(monday) > end) break;
    const k = bucketKey(g, monday);
    if (!seen.has(k)) {
      seen.add(k);
      out.push(k);
    }
  }
  return out;
}

/** How many days of [rangeStart, rangeEnd] actually fall inside this bucket — a partial
 *  edge bucket (range starts mid-week/mid-month) has fewer than 7 or the full month's
 *  days, which is what "average per bucket" needs. */
export function bucketDayCount(g: TimeGranularity, key: string, rangeStart: string, rangeEnd: string): number {
  const { start, end } = bucketSpan(g, key);
  const s = start > rangeStart ? start : rangeStart;
  const e = end < rangeEnd ? end : rangeEnd;
  if (s > e) return 0;
  return Math.round((new Date(e + "T00:00:00").getTime() - new Date(s + "T00:00:00").getTime()) / 86400000) + 1;
}

/** The full calendar span a bucket key covers, for date-range clamping and for
 *  chart/table labels ("Jul 6 – Jul 12", "July 2026"). */
export function bucketSpan(g: TimeGranularity, key: string): { start: string; end: string } {
  if (g === "date") {
    const iso = `${key.slice(0, 4)}-${key.slice(4, 6)}-${key.slice(6, 8)}`;
    return { start: iso, end: iso };
  }
  if (g === "month") {
    const y = Number(key.slice(0, 4));
    const m = Number(key.slice(4, 6));
    const start = new Date(y, m - 1, 1);
    const end = new Date(y, m, 0);
    return { start: fmt(start), end: fmt(end) };
  }
  const isoYear = Number(key.slice(0, 4));
  const isoWeek = Number(key.slice(4, 6));
  const monday = isoWeekMonday(isoYear, isoWeek);
  return { start: fmt(monday), end: fmt(addDays(monday, 6)) };
}

/** Does a bucket's calendar span overlap [rangeStart, rangeEnd] at all? Used for shading
 *  a chart with a user-defined highlight period, and for summing a metric's rows that
 *  fall inside one, without caring whether the overlap is partial. */
export function bucketOverlapsRange(g: TimeGranularity, key: string, rangeStart: string, rangeEnd: string): boolean {
  const { start, end } = g === "date" ? { start: dashDate(key), end: dashDate(key) } : bucketSpan(g, key);
  return start <= rangeEnd && end >= rangeStart;
}

function dashDate(yyyymmdd: string): string {
  return `${yyyymmdd.slice(0, 4)}-${yyyymmdd.slice(4, 6)}-${yyyymmdd.slice(6, 8)}`;
}

/** Clamp a custom start/end pair: nothing past yesterday, start never after end. */
function clampCustom(start: string, end: string, ceiling: string): { start: string; end: string } {
  const e = end > ceiling ? ceiling : end;
  let s = start > ceiling ? ceiling : start;
  if (s > e) s = e;
  return { start: s, end: e };
}

/** Resolve a range selection to concrete YYYY-MM-DD dates. GA4 data lags ~1 day, so "last N" ends yesterday. */
export function resolveRange(sel: DateRangeSel, today = new Date()): ResolvedRange {
  const yesterday = addDays(today, -1);
  switch (sel.preset) {
    case "last7":
      return { startDate: fmt(addDays(yesterday, -6)), endDate: fmt(yesterday) };
    case "last14":
      return { startDate: fmt(addDays(yesterday, -13)), endDate: fmt(yesterday) };
    case "last28":
      return { startDate: fmt(addDays(yesterday, -27)), endDate: fmt(yesterday) };
    case "last30":
      return { startDate: fmt(addDays(yesterday, -29)), endDate: fmt(yesterday) };
    case "last90":
      return { startDate: fmt(addDays(yesterday, -89)), endDate: fmt(yesterday) };
    case "thisMonth": {
      const start = new Date(today.getFullYear(), today.getMonth(), 1);
      if (yesterday < start) {
        // Day 1 of the month: zero complete days exist yet. GA4 rejects an
        // inverted (start > end) range outright, and showing today's still-
        // accruing data would break the never-past-yesterday rule every other
        // preset honors — fall back to the last complete month instead.
        return {
          startDate: fmt(new Date(today.getFullYear(), today.getMonth() - 1, 1)),
          endDate: fmt(new Date(today.getFullYear(), today.getMonth(), 0)),
        };
      }
      return { startDate: fmt(start), endDate: fmt(yesterday) };
    }
    case "lastMonth": {
      const start = new Date(today.getFullYear(), today.getMonth() - 1, 1);
      const end = new Date(today.getFullYear(), today.getMonth(), 0);
      return { startDate: fmt(start), endDate: fmt(end) };
    }
    case "custom": {
      const ceiling = fmt(yesterday);
      const raw = {
        start: sel.start || fmt(addDays(yesterday, -27)),
        end: sel.end || ceiling,
      };
      const c = clampCustom(raw.start, raw.end, ceiling);
      return { startDate: c.start, endDate: c.end };
    }
    case "since": {
      // fixed start, end always tracks yesterday — grows a day longer every day the
      // report is viewed, instead of a fixed-length rolling window.
      const ceiling = fmt(yesterday);
      const start = sel.start || fmt(addDays(yesterday, -27));
      return { startDate: start > ceiling ? ceiling : start, endDate: ceiling };
    }
  }
}

/** Resolve the comparison ("before") range relative to range A. */
export function resolveCompare(sel: CompareSel, rangeA: ResolvedRange): ResolvedRange | null {
  if (sel.preset === "none") return null;
  if (sel.preset === "custom") {
    const ceiling = maxSelectableDate();
    const c = clampCustom(sel.start || rangeA.startDate, sel.end || rangeA.endDate, ceiling);
    return { startDate: c.start, endDate: c.end };
  }
  const start = new Date(rangeA.startDate + "T00:00:00");
  const end = new Date(rangeA.endDate + "T00:00:00");
  const days = Math.round((end.getTime() - start.getTime()) / 86400000) + 1;
  if (sel.preset === "samePeriodLastYear") {
    // Date.setFullYear() silently rolls Feb 29 forward to Mar 1 in a non-leap
    // target year, which both anchors the wrong day and — if the end date were
    // shifted the same way — would silently shrink the comparison period by a
    // day. Clamp the start to Feb 28 instead, then always rebuild the end date
    // from the clamped start + the current period's own length, so the two
    // periods are guaranteed the same size regardless of leap-year quirks.
    const y = start.getFullYear() - 1;
    const daysInTargetMonth = new Date(y, start.getMonth() + 1, 0).getDate();
    const s = new Date(y, start.getMonth(), Math.min(start.getDate(), daysInTargetMonth));
    const e = new Date(s.getFullYear(), s.getMonth(), s.getDate() + days - 1);
    return { startDate: fmt(s), endDate: fmt(e) };
  }
  if (sel.preset === "fixedEnd") {
    // Same length as A, always ending at this fixed anchor date. As A grows (e.g. a
    // "since" current period picking up a new day), this grows backward from ITS OWN
    // end to match — unlike previousPeriod, which tracks immediately-before A's start
    // rather than a pinned end date, so it can't leave a fixed gap between the two periods.
    const endDate = sel.end || fmt(addDays(start, -1));
    const endD = new Date(endDate + "T00:00:00");
    return { startDate: fmt(addDays(endD, -(days - 1))), endDate };
  }
  // previousPeriod: same length, immediately before A
  return { startDate: fmt(addDays(start, -days)), endDate: fmt(addDays(start, -1)) };
}

export const RANGE_PRESETS: { value: string; label: string }[] = [
  { value: "last7", label: "Last 7 days" },
  { value: "last14", label: "Last 14 days" },
  { value: "last28", label: "Last 28 days" },
  { value: "last30", label: "Last 30 days" },
  { value: "last90", label: "Last 90 days" },
  { value: "thisMonth", label: "This month" },
  { value: "lastMonth", label: "Last month" },
  { value: "since", label: "Since date (rolls forward daily)" },
  { value: "custom", label: "Custom" },
];

export const COMPARE_PRESETS: { value: string; label: string }[] = [
  { value: "previousPeriod", label: "Previous period" },
  { value: "samePeriodLastYear", label: "Same period last year" },
  { value: "fixedEnd", label: "Fixed baseline (grows to match)" },
  { value: "custom", label: "Custom" },
  { value: "none", label: "No comparison" },
];
