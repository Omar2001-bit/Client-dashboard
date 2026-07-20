import { ChevronLeft, ChevronRight } from "lucide-react";
import { useState } from "react";
import ChartView, { type GraphViewMode } from "./ChartView";
import MetaPicker from "./MetaPicker";
import MetricJumpMenu from "./MetricJumpMenu";
import { useGa4ReportData } from "@/hooks/useGa4ReportData";
import { detectGranularity, granularityDims, type TimeGranularity } from "@/lib/ga4Reports/dates";
import { metricLabel } from "@/lib/ga4Reports/metricLabels";
import { deltaPct, fmtDelta, fmtValue } from "@/lib/ga4Reports/format";
import { DELTA_DOWN, DELTA_UP, INK_MUTED } from "@/lib/ga4Reports/theme";
import { metricIsInverted, type ChartType, type ColorPeriod, type MetaItem, type MetadataResponse } from "@/lib/ga4Reports/types";
import type { Ga4ReportDoc } from "@/types";

// Ported from VC3/GA4-simply-layer's src/components/MetricCarousel.tsx, re-skinned to
// this app's light theme. Adapted to fetch via useGa4ReportData's metrics/dimensions
// override (server-validated as a subset of the report's own metrics — see
// server/index.js's /api/ga4-reports/data) instead of the source's approach of building
// a whole bespoke ReportConfig per slide and posting it directly — simpler, and
// consistent with this app's locked-down, re-derive-from-Firestore data route.
interface Props {
  clientId: string;
  report: Ga4ReportDoc;
  metrics: string[];
  chartType: ChartType;
  viewMode?: GraphViewMode;
  defaultDims: string[]; // the report's own breakdown — each slide's starting point
  colorPeriods?: ColorPeriod[];
  metadata: MetadataResponse | null;
  metricsMeta?: MetaItem[];
  // controlled mode: the parent owns the active slide index (so e.g. clicking a KPI
  // card elsewhere on the page can jump the graph here)
  activeIndex?: number;
  onActiveIndexChange?: (i: number) => void;
}

const TIME_VIEWS: { value: TimeGranularity; label: string }[] = [
  { value: "date", label: "Day" },
  { value: "isoWeek", label: "Week" },
  { value: "month", label: "Month" },
];

interface SlideProps {
  clientId: string;
  report: Ga4ReportDoc;
  metric: string;
  index: number;
  total: number;
  chartType: ChartType;
  viewMode?: GraphViewMode;
  dims: string[];
  onDimsChange: (dims: string[]) => void;
  colorPeriods?: ColorPeriod[];
  metadata: MetadataResponse | null;
  metricsMeta?: MetaItem[];
}

function MetricSlide({
  clientId,
  report,
  metric,
  index,
  total,
  chartType,
  viewMode,
  dims,
  onDimsChange,
  colorPeriods,
  metadata,
  metricsMeta,
}: SlideProps) {
  const { data, error, isLoading } = useGa4ReportData(clientId, report, { metrics: [metric], dimensions: dims });
  const headlineDelta = data?.totalsB ? deltaPct(data.totalsA[0] ?? 0, data.totalsB[0]) : null;
  const headlineGood = headlineDelta !== null && (metricIsInverted(metric) ? headlineDelta < 0 : headlineDelta > 0);
  const type = data?.metricHeaders[0]?.type;
  // "Day/Week/Month" is really just three quick presets for `dims` — deriving the
  // active one from `dims` (instead of separate state) means picking a category
  // dimension in the MetaPicker below automatically clears whichever time view was
  // active, and vice versa, with no state to keep in sync.
  const activeGranularity = detectGranularity(dims);

  return (
    <div className="animate-fade-in w-full">
      <div className="rounded-xl border border-ink/10 bg-white p-4">
        <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-start sm:justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-ink/50">
                {index + 1} / {total}
              </span>
              <h3 className="truncate text-sm font-semibold text-ink">{metricLabel(metric, metricsMeta)}</h3>
            </div>
            {data && (
              <div className="mt-0.5 flex flex-wrap items-baseline gap-2 text-xs tabular-nums">
                <span className="font-semibold text-ink">
                  {fmtValue(data.totalsA[0] ?? 0, type, data.currencyCode)}
                </span>
                {data.totalsB && (
                  <>
                    <span style={{ color: INK_MUTED }}>
                      vs {fmtValue(data.totalsB[0] ?? 0, type, data.currencyCode)}
                    </span>
                    {headlineDelta !== null && (
                      <span style={{ color: headlineGood || headlineDelta === 0 ? DELTA_UP : DELTA_DOWN }} className="font-semibold">
                        {fmtDelta(headlineDelta)}
                      </span>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2 sm:shrink-0">
            <div className="flex overflow-hidden rounded-lg border border-ink/15">
              {TIME_VIEWS.map((tv) => (
                <button
                  key={tv.value}
                  type="button"
                  onClick={() => onDimsChange(granularityDims(tv.value))}
                  aria-pressed={activeGranularity === tv.value}
                  className={`focus-ring whitespace-nowrap px-2.5 py-1.5 text-[11px] transition-colors duration-150 ${
                    activeGranularity === tv.value
                      ? "bg-brand-500 text-ink-deep"
                      : "text-ink/50 hover:bg-ink/5 hover:text-ink/70"
                  }`}
                >
                  {tv.label}
                </button>
              ))}
            </div>
            <div className="w-full min-w-[11.5rem] flex-1 sm:w-48 sm:flex-none">
              <MetaPicker
                items={metadata?.dimensions ?? []}
                selected={activeGranularity ? [] : dims}
                onToggle={(d) => onDimsChange(dims.includes(d) ? [] : [d])}
                max={1}
                placeholder="Or break down by…"
                allowNone
              />
            </div>
          </div>
        </div>
        <div className="relative">
          {isLoading && (
            <div className="animate-fade-in absolute inset-0 z-10 flex items-center justify-center rounded-lg bg-white/70 text-xs" style={{ color: INK_MUTED }}>
              Loading…
            </div>
          )}
          {error ? (
            <div className="flex h-56 items-center justify-center text-sm text-red-600">
              {error instanceof Error ? error.message : "Failed to load"}
            </div>
          ) : data ? (
            <ChartView
              data={data}
              chartType={chartType}
              viewMode={viewMode}
              metricIndex={0}
              metricsMeta={metricsMeta}
              colorPeriods={colorPeriods}
              height={260}
            />
          ) : (
            <div className="h-56" />
          )}
        </div>
      </div>
    </div>
  );
}

/** Each selected metric gets its own graph, one at a time — instead of every metric
 *  fighting for space (and axis scale) on one shared chart, or every metric's chart
 *  mounted and fetching at once, which would mean a many-metric report firing many
 *  concurrent GA4 requests before you'd looked at a single one. Only the active metric's
 *  slide is mounted; moving to another metric (via Prev/Next or the jump menu) fetches
 *  on demand. Each slide's breakdown dimension (including its Day/Week/Month time view)
 *  is independent and persists per metric while you browse around. */
export default function MetricCarousel({
  clientId,
  report,
  metrics,
  chartType,
  viewMode,
  defaultDims,
  colorPeriods,
  metadata,
  metricsMeta,
  activeIndex,
  onActiveIndexChange,
}: Props) {
  const [slideDims, setSlideDims] = useState<Record<string, string[]>>({});
  const [internalActive, setInternalActive] = useState(0);

  if (metrics.length === 0) return null;

  // clamp at render time (not via effect+setState) so a shrinking metrics list — one got
  // removed in the editor — never points past the end
  const active = Math.min(activeIndex ?? internalActive, metrics.length - 1);
  const goTo = (i: number) => {
    const clamped = Math.max(0, Math.min(metrics.length - 1, i));
    if (onActiveIndexChange) onActiveIndexChange(clamped);
    else setInternalActive(clamped);
  };
  const metric = metrics[active];

  return (
    <div>
      {metrics.length > 1 && (
        <div className="mb-2 flex items-center justify-end gap-1.5">
          <MetricJumpMenu metrics={metrics} active={active} onSelect={goTo} metricsMeta={metricsMeta} />
          <button
            type="button"
            onClick={() => goTo(active - 1)}
            disabled={active === 0}
            aria-label="Previous metric"
            className="focus-ring flex h-7 w-7 items-center justify-center rounded-lg border border-ink/15 text-ink/50 transition-all duration-150 hover:border-ink/30 hover:text-ink active:scale-95 disabled:cursor-not-allowed disabled:opacity-30 disabled:active:scale-100"
          >
            <ChevronLeft size={13} />
          </button>
          <button
            type="button"
            onClick={() => goTo(active + 1)}
            disabled={active === metrics.length - 1}
            aria-label="Next metric"
            className="focus-ring flex h-7 w-7 items-center justify-center rounded-lg border border-ink/15 text-ink/50 transition-all duration-150 hover:border-ink/30 hover:text-ink active:scale-95 disabled:cursor-not-allowed disabled:opacity-30 disabled:active:scale-100"
          >
            <ChevronRight size={13} />
          </button>
        </div>
      )}
      <MetricSlide
        key={metric}
        clientId={clientId}
        report={report}
        metric={metric}
        index={active}
        total={metrics.length}
        chartType={chartType}
        viewMode={viewMode}
        dims={slideDims[metric] ?? defaultDims}
        onDimsChange={(d) => setSlideDims((prev) => ({ ...prev, [metric]: d }))}
        colorPeriods={colorPeriods}
        metadata={metadata}
        metricsMeta={metricsMeta}
      />
    </div>
  );
}
