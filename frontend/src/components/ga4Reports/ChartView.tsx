import { TrendingUp } from "lucide-react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ReferenceArea,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { bucketDayCount, bucketOverlapsRange, bucketSpan, detectGranularity, type TimeGranularity } from "@/lib/ga4Reports/dates";
import { fmtBucketLabel, fmtCompact, fmtDelta, fmtValue, deltaPct } from "@/lib/ga4Reports/format";
import { metricLabel } from "@/lib/ga4Reports/metricLabels";
import {
  BASELINE,
  CATEGORICAL,
  DELTA_DOWN,
  DELTA_UP,
  GRID,
  HOVER_CURSOR_FILL,
  INK,
  INK_MUTED,
  INK_SECONDARY,
  SERIES_A,
  SERIES_B,
  SURFACE,
} from "@/lib/ga4Reports/theme";
import { metricIsInverted, type ChartType, type ColorPeriod, type MetaItem, type ReportResponse } from "@/lib/ga4Reports/types";

// Ported from VC3/GA4-simply-layer's src/components/ChartView.tsx, re-skinned to this
// app's light theme (source was dark-themed) — chart logic and Recharts usage unchanged
// (verified no 3.x-only Recharts APIs in use, so this ports cleanly against the target
// app's recharts 2.12.7). metricLabel() moved out to lib/ga4Reports/metricLabels.ts (see
// that file for why); dims fallback simplified since data.dimensions is always populated
// in this app's report model (no legacy singular `dimension` field).
export type GraphViewMode = "overlay" | "timeline";

interface Props {
  data: ReportResponse;
  chartType: ChartType;
  metricIndex: number; // which of data.metrics this chart plots
  metricsMeta?: MetaItem[]; // pretty names for tooltip/labels
  colorPeriods?: ColorPeriod[]; // named date-range highlights, see types.ts
  height?: number;
  compact?: boolean; // mini mode for dashboard cards
  /** "overlay" (default): x-axis is the current period only, previous period drawn on
   *  top day-aligned. "timeline": one continuous chronological x-axis from the start of
   *  the previous period through the end of the current one — previous phase dashed,
   *  current phase solid, with a divider where the current period begins. */
  viewMode?: GraphViewMode;
}

interface Datum {
  name: string;
  bName?: string;
  key: string; // raw bucket key, pre-label-formatting — tooltip needs this for day-count math
  bKey?: string;
  a?: number;
  b?: number;
}

function buildData(data: ReportResponse, metricIndex: number, granularity: TimeGranularity | null): Datum[] {
  const g = granularity ?? "date";
  return (
    data.rows
      // when the comparison range is longer than the current one, its unmatched
      // trailing days arrive as rows with an empty current bucket — alignment
      // artifacts, not plottable days (categorical "" is legit "(not set)")
      .filter((r) => !granularity || r.dim)
      .map((r) => ({
        name: fmtBucketLabel(g, r.dim),
        bName: r.bDim ? fmtBucketLabel(g, r.bDim) : undefined,
        key: r.dim,
        bKey: r.bDim,
        a: r.a[metricIndex] ?? 0,
        b: r.b ? r.b[metricIndex] ?? 0 : undefined,
      }))
  );
}

/** One continuous chronological axis: previous-period buckets first (their real dates,
 *  values in `b`), then current-period buckets (values in `a`). Where the two ranges
 *  overlap (growing-baseline compares), the current bucket wins so a date never appears
 *  twice. The first current bucket also carries a `b` value equal to its `a`, bridging
 *  the two series so the dashed previous phase connects seamlessly into the solid
 *  current phase instead of leaving a gap at the boundary. Returns null when the data
 *  can't support a timeline (no compare, or no aligned previous dates). */
function buildTimelineData(
  data: ReportResponse,
  metricIndex: number,
  granularity: TimeGranularity | null,
  bridge: boolean // line/area only — a bar chart would render the bridge as a duplicate bar
): { rows: Datum[] } | null {
  if (!granularity || !data.rangeB) return null;
  const g = granularity;
  // previous+current phases share one continuous axis here (unlike Overlay, which never
  // shows both at once) — so when they land in different calendar years, disambiguate every
  // label with its year or e.g. two "Jul 2" buckets a year apart look identical
  const includeYear = data.rangeA.startDate.slice(0, 4) !== data.rangeB.startDate.slice(0, 4);
  const curr = new Map<string, Datum>();
  const prev = new Map<string, Datum>();
  for (const r of data.rows) {
    // rows with an empty current bucket are alignment artifacts (comparison range
    // longer than the current one) — their bDim/b still belongs on the previous phase,
    // but they contribute no current-phase point
    if (r.dim) curr.set(r.dim, { name: fmtBucketLabel(g, r.dim, includeYear), key: r.dim, a: r.a[metricIndex] ?? 0 });
    if (r.bDim && r.b)
      prev.set(r.bDim, { name: fmtBucketLabel(g, r.bDim, includeYear), key: r.bDim, b: r.b[metricIndex] ?? 0 });
  }
  if (prev.size === 0 || curr.size === 0) return null;
  const prevRows = [...prev.values()].filter((p) => !curr.has(p.key)).sort((x, y) => (x.key < y.key ? -1 : 1));
  const currRows = [...curr.values()].sort((x, y) => (x.key < y.key ? -1 : 1));
  // connect the phases ONLY when they actually touch — overlapping or back-to-back
  // buckets. A real calendar gap between the two ranges stays a visible gap in the
  // line; drawing through it would invent data.
  if (bridge && prevRows.length > 0) {
    const prevEnd = bucketSpan(g, prevRows[prevRows.length - 1].key).end;
    const currStart = bucketSpan(g, currRows[0].key).start;
    const gapDays = (Date.parse(currStart) - Date.parse(prevEnd)) / 86_400_000;
    if (gapDays <= 1) currRows[0] = { ...currRows[0], b: currRows[0].a };
  }
  return { rows: [...prevRows, ...currRows] };
}

/** Which contiguous x-axis span (by row label) each color period covers, so it can be
 *  shaded on the chart. First-matching period wins where two periods overlap the same
 *  bucket. */
function periodBands(
  rows: Datum[],
  periods: ColorPeriod[] | undefined,
  g: TimeGranularity | null
): { period: ColorPeriod; x1: string; x2: string }[] {
  if (!periods?.length || !g) return [];
  const claimed = new Set<string>();
  const bands: { period: ColorPeriod; x1: string; x2: string }[] = [];
  for (const period of periods) {
    let x1: string | null = null;
    let x2: string | null = null;
    for (const r of rows) {
      if (!r.key || claimed.has(r.key) || !bucketOverlapsRange(g, r.key, period.startDate, period.endDate)) continue;
      claimed.add(r.key);
      if (x1 === null) x1 = r.name;
      x2 = r.name;
    }
    if (x1 !== null && x2 !== null) bands.push({ period, x1, x2 });
  }
  return bands;
}

const tooltipStyle = {
  backgroundColor: SURFACE,
  border: `1px solid ${GRID}`,
  borderRadius: 10,
  color: INK,
  fontSize: 12,
};

/** The period language: Current = solid dot, Previous = dashed ring. Same hue family, never new colors. */
export function PeriodChips({ data, compact }: { data: ReportResponse; compact?: boolean }) {
  if (!data.rangeB || compact) return null;
  return (
    <div className="mt-3 flex flex-wrap items-center justify-center gap-2 text-xs">
      <span
        className="flex items-center gap-1.5 rounded-full border border-ink/15 px-2.5 py-1"
        style={{ color: INK_SECONDARY }}
      >
        <span className="inline-block h-2 w-2 rounded-full" style={{ background: SERIES_A }} />
        <span className="font-semibold text-ink">Current</span>
        {data.rangeA.startDate} → {data.rangeA.endDate}
      </span>
      <span
        className="flex items-center gap-1.5 rounded-full px-2.5 py-1"
        style={{ color: INK_MUTED, border: `1px dashed ${SERIES_B}` }}
      >
        <span
          className="inline-block h-2 w-2 rounded-full"
          style={{ border: `1.5px dashed ${SERIES_B}`, background: "transparent" }}
        />
        <span className="font-semibold" style={{ color: INK_SECONDARY }}>
          Previous
        </span>
        {data.rangeB.startDate} → {data.rangeB.endDate}
      </span>
    </div>
  );
}

/** Daily tooltips show the value only. Weekly/monthly show Total + Average + how many
 *  underlying days fed that bucket (fewer than 7/full-month at a range edge). */
function ChartTooltip({
  active,
  payload,
  label,
  metricType,
  currencyCode,
  hasCompare,
  granularity,
  rangeA,
  rangeB,
  invert,
  timeline,
}: {
  active?: boolean;
  payload?: { payload: Datum }[];
  label?: string;
  metricType?: string;
  currencyCode?: string;
  hasCompare: boolean;
  granularity: TimeGranularity | null;
  rangeA: { startDate: string; endDate: string };
  rangeB?: { startDate: string; endDate: string } | null;
  invert?: boolean;
  timeline?: boolean;
}) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;

  // timeline rows carry ONE phase's value each — show it with its phase name
  if (timeline) {
    const isCurrent = d.a !== undefined;
    const v = isCurrent ? d.a : d.b;
    return (
      <div style={tooltipStyle} className="px-3 py-2 shadow-xl">
        <div style={{ color: INK_SECONDARY }} className="mb-1.5 font-semibold">
          {label}
        </div>
        <div className="flex items-center justify-between gap-4">
          <span className="flex items-center gap-1.5" style={{ color: INK_MUTED }}>
            {isCurrent ? (
              <span style={{ background: SERIES_A }} className="inline-block h-2 w-2 rounded-full" />
            ) : (
              <span className="inline-block h-2 w-2 rounded-full" style={{ border: `1.5px dashed ${SERIES_B}` }} />
            )}
            {isCurrent ? "Current period" : "Previous period"}
          </span>
          <span className="font-semibold tabular-nums">{fmtValue(v ?? 0, metricType, currencyCode)}</span>
        </div>
      </div>
    );
  }

  const aVal = d.a ?? 0;
  const delta = deltaPct(aVal, d.b);
  const deltaGood = delta !== null && (invert ? delta < 0 : delta > 0);
  const isBucketed = granularity !== null && granularity !== "date";
  const countA = isBucketed && d.key ? bucketDayCount(granularity!, d.key, rangeA.startDate, rangeA.endDate) : 0;
  const countB =
    isBucketed && d.bKey && rangeB ? bucketDayCount(granularity!, d.bKey, rangeB.startDate, rangeB.endDate) : 0;
  const avgA = countA > 0 ? aVal / countA : aVal;
  const avgB = countB > 0 && d.b !== undefined ? d.b / countB : d.b;
  return (
    <div style={tooltipStyle} className="px-3 py-2 shadow-xl">
      <div style={{ color: INK_SECONDARY }} className="mb-1.5 font-semibold">
        {label}
      </div>
      <div className="flex items-center justify-between gap-4">
        <span className="flex items-center gap-1.5" style={{ color: INK_MUTED }}>
          <span style={{ background: SERIES_A }} className="inline-block h-2 w-2 rounded-full" />
          {isBucketed ? "Total" : "Current"}
        </span>
        <span className="font-semibold tabular-nums">{fmtValue(aVal, metricType, currencyCode)}</span>
      </div>
      {isBucketed && (
        <div className="flex items-center justify-between gap-4 pl-3.5 text-[11px]" style={{ color: INK_SECONDARY }}>
          <span>Average · {countA} day{countA === 1 ? "" : "s"}</span>
          <span className="tabular-nums">{fmtValue(avgA, metricType, currencyCode)}</span>
        </div>
      )}
      {hasCompare && d.b !== undefined && (
        <>
          <div className="mt-1.5 flex items-center justify-between gap-4">
            <span className="flex items-center gap-1.5" style={{ color: INK_MUTED }}>
              <span
                className="inline-block h-2 w-2 rounded-full"
                style={{ border: `1.5px dashed ${SERIES_B}` }}
              />
              {isBucketed ? "Previous total" : "Previous"}
              {d.bName ? ` · ${d.bName}` : ""}
            </span>
            <span className="tabular-nums" style={{ color: INK_SECONDARY }}>
              {fmtValue(d.b, metricType, currencyCode)}
            </span>
          </div>
          {isBucketed && avgB !== undefined && (
            <div className="flex items-center justify-between gap-4 pl-3.5 text-[11px]" style={{ color: INK_MUTED }}>
              <span>Average · {countB} day{countB === 1 ? "" : "s"}</span>
              <span className="tabular-nums">{fmtValue(avgB, metricType, currencyCode)}</span>
            </div>
          )}
          <div
            style={{ color: deltaGood || delta === 0 ? DELTA_UP : DELTA_DOWN }}
            className="mt-1 text-right font-semibold"
          >
            {fmtDelta(delta)}
          </div>
        </>
      )}
    </div>
  );
}

/** Totals-only fallback (no time/dimension breakdown selected): a real trend line needs
 *  more than one row, so show the metric as a number instead of a broken single-point line. */
function TotalsOnlyView({
  data,
  metricIndex,
  metricsMeta,
}: {
  data: ReportResponse;
  metricIndex: number;
  metricsMeta?: MetaItem[];
}) {
  const a = data.totalsA[metricIndex] ?? 0;
  const b = data.totalsB?.[metricIndex];
  const type = data.metricHeaders[metricIndex]?.type;
  const delta = deltaPct(a, b);
  const invert = metricIsInverted(data.metrics[metricIndex] ?? "");
  return (
    <div className="animate-fade-in flex h-full min-h-[160px] flex-col items-center justify-center gap-2 px-4 text-center">
      <div className="text-xs uppercase tracking-[0.1em]" style={{ color: INK_MUTED }}>
        {metricLabel(data.metrics[metricIndex] ?? "", metricsMeta)}
      </div>
      <div style={{ color: INK }} className="text-3xl font-semibold tabular-nums">
        {fmtValue(a, type, data.currencyCode)}
      </div>
      {delta !== null && (
        <div style={{ color: (invert ? delta < 0 : delta > 0) || delta === 0 ? DELTA_UP : DELTA_DOWN }} className="text-xs font-medium">
          {fmtDelta(delta)} vs previous
        </div>
      )}
      <p className="flex max-w-xs items-center gap-1.5 text-xs leading-snug" style={{ color: INK_MUTED }}>
        <TrendingUp size={13} className="shrink-0" />
        No trend to draw, add a breakdown to see this as a line.
      </p>
    </div>
  );
}

export default function ChartView({
  data,
  chartType,
  metricIndex,
  metricsMeta,
  colorPeriods,
  height = 320,
  compact = false,
  viewMode = "overlay",
}: Props) {
  const metricType = data.metricHeaders[metricIndex]?.type;
  const metricName = data.metrics[metricIndex] ?? "";
  const hasCompare = !!data.rangeB;
  const axisTick = { fill: INK_MUTED, fontSize: compact ? 10 : 11 };
  const yFmt = (v: number) => fmtCompact(v, metricType, data.currencyCode);
  const chips = <PeriodChips data={data} compact={compact} />;

  const dimList = data.dimensions;
  const isTotalsOnly = dimList.length === 0 || (data.rows.length === 1 && data.rows[0]?.dim === "total");
  const granularity = detectGranularity(dimList);
  const inverted = metricIsInverted(metricName);
  // timeline only makes sense for time-bucketed data with an aligned compare; anything
  // else silently falls back to the overlay rendering
  const timeline =
    viewMode === "timeline" && (chartType === "line" || chartType === "area" || chartType === "bar")
      ? buildTimelineData(data, metricIndex, granularity, chartType !== "bar")
      : null;
  const chartTooltip = (
    <ChartTooltip
      metricType={metricType}
      currencyCode={data.currencyCode}
      hasCompare={hasCompare}
      granularity={granularity}
      rangeA={data.rangeA}
      rangeB={data.rangeB}
      invert={inverted}
      timeline={!!timeline}
    />
  );

  if (chartType === "scorecard") {
    const a = data.totalsA[metricIndex] ?? 0;
    const b = data.totalsB?.[metricIndex];
    const delta = deltaPct(a, b);
    return (
      <div className="flex h-full min-h-[160px] flex-col items-center justify-center gap-1">
        <div style={{ color: INK_MUTED }} className="text-xs uppercase tracking-[0.14em]">
          {metricLabel(metricName, metricsMeta)}
        </div>
        <div style={{ color: INK }} className="text-5xl font-semibold tabular-nums">
          {fmtValue(a, metricType, data.currencyCode)}
        </div>
        {delta !== null && (
          <div
            style={{ color: (inverted ? delta < 0 : delta > 0) || delta === 0 ? DELTA_UP : DELTA_DOWN }}
            className="text-sm font-medium"
          >
            {fmtDelta(delta)} vs previous ({fmtValue(b ?? 0, metricType, data.currencyCode)})
          </div>
        )}
        {chips}
      </div>
    );
  }

  // No breakdown selected at all: nothing to plot a trend against. Show the metric as a
  // number instead of a broken single-dot line.
  if (isTotalsOnly && (chartType === "line" || chartType === "area" || chartType === "bar" || chartType === "hbar")) {
    return <TotalsOnlyView data={data} metricIndex={metricIndex} metricsMeta={metricsMeta} />;
  }

  // Timeline was requested but couldn't be built — show why instead of silently falling
  // back to the overlay chart below (which would render with the Timeline tab still
  // showing as selected, looking like Timeline "does nothing").
  if (viewMode === "timeline" && (chartType === "line" || chartType === "area" || chartType === "bar") && !timeline) {
    const message = !granularity
      ? "Select a Day/Week/Month breakdown to view the Timeline."
      : !data.rangeB
        ? "Add a comparison period to view the Timeline."
        : "No comparable data available for this period.";
    return (
      <div
        className="animate-fade-in flex h-full min-h-[160px] flex-col items-center justify-center gap-1.5 px-4 text-center text-xs"
        style={{ color: INK_MUTED }}
      >
        <TrendingUp size={18} />
        {message}
      </div>
    );
  }

  // ---- timeline rendering: previous phase (dashed) flows into current (solid) ----
  if (timeline) {
    const tRows = timeline.rows;
    const tBands = periodBands(tRows, colorPeriods, granularity).map(({ period, x1, x2 }) => (
      <ReferenceArea
        key={period.id}
        x1={x1}
        x2={x2}
        fill={period.color}
        fillOpacity={0.1}
        stroke={period.color}
        strokeOpacity={0.35}
        ifOverflow="visible"
        label={{ value: period.label, position: "insideTopLeft", fill: period.color, fontSize: 10 }}
      />
    ));
    // Recharts discovers CartesianGrid/XAxis/YAxis/Tooltip by scanning each chart's direct
    // children — it won't reach into a Fragment passed as a single indirect child, so these
    // must be inlined literally in each branch below (matching the Overlay branches further
    // down) rather than built once as a shared `<>...</>` variable.
    return (
      <div>
        <ResponsiveContainer width="100%" height={height}>
          {chartType === "bar" ? (
            <BarChart data={tRows} margin={{ right: 12 }}>
              <CartesianGrid stroke={GRID} vertical={false} />
              {tBands}
              <XAxis dataKey="name" tick={axisTick} stroke={BASELINE} interval="preserveStartEnd" />
              <YAxis tick={axisTick} tickFormatter={yFmt} stroke={BASELINE} width={48} />
              <Tooltip content={chartTooltip} cursor={{ fill: HOVER_CURSOR_FILL }} />
              <Bar
                dataKey="b"
                fill={SERIES_B}
                fillOpacity={0.25}
                stroke={SERIES_B}
                strokeWidth={1.5}
                strokeDasharray="4 3"
                radius={[4, 4, 0, 0]}
                maxBarSize={22}
              />
              <Bar dataKey="a" fill={SERIES_A} radius={[4, 4, 0, 0]} maxBarSize={22} />
            </BarChart>
          ) : chartType === "area" ? (
            <AreaChart data={tRows} margin={{ right: 12 }}>
              <defs>
                <linearGradient id="fillTimeline" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={SERIES_A} stopOpacity={0.35} />
                  <stop offset="100%" stopColor={SERIES_A} stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke={GRID} vertical={false} />
              {tBands}
              <XAxis dataKey="name" tick={axisTick} stroke={BASELINE} interval="preserveStartEnd" />
              <YAxis tick={axisTick} tickFormatter={yFmt} stroke={BASELINE} width={48} />
              <Tooltip content={chartTooltip} />
              <Area
                type="monotone"
                dataKey="b"
                stroke={SERIES_B}
                strokeWidth={1.75}
                strokeOpacity={0.85}
                strokeDasharray="6 4"
                fill="none"
                dot={false}
                connectNulls={false}
              />
              <Area
                type="monotone"
                dataKey="a"
                stroke={SERIES_A}
                strokeWidth={2.5}
                fill="url(#fillTimeline)"
                dot={false}
                connectNulls={false}
              />
            </AreaChart>
          ) : (
            <LineChart data={tRows} margin={{ right: 12 }}>
              <CartesianGrid stroke={GRID} vertical={false} />
              {tBands}
              <XAxis dataKey="name" tick={axisTick} stroke={BASELINE} interval="preserveStartEnd" />
              <YAxis tick={axisTick} tickFormatter={yFmt} stroke={BASELINE} width={48} />
              <Tooltip content={chartTooltip} />
              <Line
                type="monotone"
                dataKey="b"
                stroke={SERIES_B}
                strokeWidth={1.75}
                strokeOpacity={0.85}
                strokeDasharray="6 4"
                dot={false}
                activeDot={{ r: 3.5 }}
                connectNulls={false}
              />
              <Line
                type="monotone"
                dataKey="a"
                stroke={SERIES_A}
                strokeWidth={2.5}
                dot={false}
                activeDot={{ r: 4.5 }}
                connectNulls={false}
              />
            </LineChart>
          )}
        </ResponsiveContainer>
        {chips}
      </div>
    );
  }

  const rows = buildData(data, metricIndex, granularity);
  const bands = periodBands(rows, colorPeriods, granularity);
  const bandAreas = bands.map(({ period, x1, x2 }) => (
    <ReferenceArea
      key={period.id}
      x1={x1}
      x2={x2}
      fill={period.color}
      fillOpacity={0.1}
      stroke={period.color}
      strokeOpacity={0.35}
      ifOverflow="visible"
      label={{ value: period.label, position: "insideTopLeft", fill: period.color, fontSize: 10 }}
    />
  ));

  if (rows.length === 0) {
    return (
      <div
        className="animate-fade-in flex h-full min-h-[160px] flex-col items-center justify-center gap-1.5 text-xs"
        style={{ color: INK_MUTED }}
      >
        <TrendingUp size={18} />
        No data for this range.
      </div>
    );
  }

  if (chartType === "pie" || chartType === "donut") {
    // cap at 8 fixed-order slices; fold the tail into "Other"
    const top = rows.slice(0, 8);
    const rest = rows.slice(8);
    const slices = [...top];
    if (rest.length) {
      slices.push({ name: "Other", key: "", a: rest.reduce((s, r) => s + (r.a ?? 0), 0), b: undefined });
    }
    return (
      <ResponsiveContainer width="100%" height={height}>
        <PieChart>
          <Pie
            data={slices}
            dataKey="a"
            nameKey="name"
            innerRadius={chartType === "donut" ? "55%" : 0}
            outerRadius="85%"
            paddingAngle={2}
            stroke={SURFACE}
            strokeWidth={2}
          >
            {slices.map((s, i) => (
              <Cell key={s.name} fill={i < 8 ? CATEGORICAL[i % 8] : INK_MUTED} />
            ))}
          </Pie>
          <Tooltip
            contentStyle={tooltipStyle}
            formatter={(v) => fmtValue(Number(v), metricType, data.currencyCode)}
          />
          {!compact && <Legend wrapperStyle={{ color: INK_SECONDARY, fontSize: 12 }} />}
        </PieChart>
      </ResponsiveContainer>
    );
  }

  if (chartType === "hbar") {
    const h = compact ? height : Math.max(height, rows.length * 34 + 60);
    return (
      <div>
        <ResponsiveContainer width="100%" height={h}>
          <BarChart data={rows} layout="vertical" margin={{ left: 8, right: 24 }}>
            <CartesianGrid stroke={GRID} horizontal={false} />
            <XAxis type="number" tick={axisTick} tickFormatter={yFmt} stroke={BASELINE} />
            <YAxis
              type="category"
              dataKey="name"
              tick={{ ...axisTick, fill: INK_SECONDARY }}
              width={compact ? 80 : 120}
              stroke={BASELINE}
            />
            <Tooltip content={chartTooltip} cursor={{ fill: HOVER_CURSOR_FILL }} />
            <Bar dataKey="a" fill={SERIES_A} radius={[0, 4, 4, 0]} maxBarSize={18} />
            {hasCompare && (
              <Bar
                dataKey="b"
                fill={SERIES_B}
                fillOpacity={0.25}
                stroke={SERIES_B}
                strokeWidth={1.5}
                strokeDasharray="4 3"
                radius={[0, 4, 4, 0]}
                maxBarSize={18}
              />
            )}
          </BarChart>
        </ResponsiveContainer>
        {chips}
      </div>
    );
  }

  if (chartType === "bar") {
    return (
      <div>
        <ResponsiveContainer width="100%" height={height}>
          <BarChart data={rows} margin={{ right: 12 }}>
            <CartesianGrid stroke={GRID} vertical={false} />
            {bandAreas}
            <XAxis dataKey="name" tick={axisTick} stroke={BASELINE} interval="preserveStartEnd" />
            <YAxis tick={axisTick} tickFormatter={yFmt} stroke={BASELINE} width={48} />
            <Tooltip content={chartTooltip} cursor={{ fill: HOVER_CURSOR_FILL }} />
            <Bar dataKey="a" fill={SERIES_A} radius={[4, 4, 0, 0]} maxBarSize={22} />
            {hasCompare && (
              <Bar
                dataKey="b"
                fill={SERIES_B}
                fillOpacity={0.25}
                stroke={SERIES_B}
                strokeWidth={1.5}
                strokeDasharray="4 3"
                radius={[4, 4, 0, 0]}
                maxBarSize={22}
              />
            )}
          </BarChart>
        </ResponsiveContainer>
        {chips}
      </div>
    );
  }

  if (chartType === "area") {
    return (
      <div>
        <ResponsiveContainer width="100%" height={height}>
          <AreaChart data={rows} margin={{ right: 12 }}>
            <defs>
              <linearGradient id="fillA" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={SERIES_A} stopOpacity={0.35} />
                <stop offset="100%" stopColor={SERIES_A} stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke={GRID} vertical={false} />
            {bandAreas}
            <XAxis dataKey="name" tick={axisTick} stroke={BASELINE} interval="preserveStartEnd" />
            <YAxis tick={axisTick} tickFormatter={yFmt} stroke={BASELINE} width={48} />
            <Tooltip content={chartTooltip} />
            <Area
              type="monotone"
              dataKey="a"
              stroke={SERIES_A}
              strokeWidth={2.5}
              fill="url(#fillA)"
              dot={rows.length === 1}
            />
            {hasCompare && (
              <Area
                type="monotone"
                dataKey="b"
                stroke={SERIES_B}
                strokeWidth={1.75}
                strokeOpacity={0.85}
                strokeDasharray="6 4"
                fill="none"
                dot={false}
              />
            )}
          </AreaChart>
        </ResponsiveContainer>
        {chips}
      </div>
    );
  }

  // default: line — Current solid & heavier, Previous dashed & lighter weight
  return (
    <div>
      <ResponsiveContainer width="100%" height={height}>
        <LineChart data={rows} margin={{ right: 12 }}>
          <CartesianGrid stroke={GRID} vertical={false} />
          {bandAreas}
          <XAxis dataKey="name" tick={axisTick} stroke={BASELINE} interval="preserveStartEnd" />
          <YAxis tick={axisTick} tickFormatter={yFmt} stroke={BASELINE} width={48} />
          <Tooltip content={chartTooltip} />
          <Line
            type="monotone"
            dataKey="a"
            stroke={SERIES_A}
            strokeWidth={2.5}
            dot={rows.length === 1}
            activeDot={{ r: 4.5 }}
          />
          {hasCompare && (
            <Line
              type="monotone"
              dataKey="b"
              stroke={SERIES_B}
              strokeWidth={1.75}
              strokeOpacity={0.85}
              strokeDasharray="6 4"
              dot={false}
              activeDot={{ r: 3.5 }}
            />
          )}
        </LineChart>
      </ResponsiveContainer>
      {chips}
    </div>
  );
}
