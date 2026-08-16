import { Trophy } from "lucide-react";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/Table";
import { metricLabel } from "@/lib/ga4Reports/metricLabels";
import { detectGranularity } from "@/lib/ga4Reports/dates";
import { periodTotal } from "@/lib/ga4Reports/buildInsights";
import { deltaPct, fmtDelta, fmtValue } from "@/lib/ga4Reports/format";
import type { EngineInsight } from "@/lib/ga4Reports/insightEngine";
import { DELTA_DOWN, DELTA_UP, INK_MUTED } from "@/lib/ga4Reports/theme";
import { metricIsInverted, type ColorPeriod, type MetaItem, type ReportResponse } from "@/lib/ga4Reports/types";

// Ported from VC3/GA4-simply-layer's src/components/AnalyticsView.tsx, re-skinned to
// this app's light theme — logic unchanged. buildInsights()/periodTotal() (pure logic,
// no JSX) live in lib/ga4Reports/buildInsights.ts instead of here, same reasoning as
// metricLabel's move — a components-only file shouldn't also export plain functions
// (this also satisfies the react-refresh/only-export-components lint rule).
interface Props {
  data: ReportResponse;
  metricsMeta?: MetaItem[];
  colorPeriods?: ColorPeriod[];
}

const SEVERITY_DOT: Record<EngineInsight["severity"], string> = {
  critical: DELTA_DOWN,
  good: DELTA_UP,
  warning: "#e6a23c", // amber
  info: "#6ae499",
};

/** One insight's content — no section wrapper, so it can render inside whichever entry
 *  section it's currently placed in (see EntryCard). Dot color encodes severity;
 *  headline first so a client can scan, numbers underneath, and the → line is the action
 *  when the rule carries one. */
export function InsightBubble({ insight }: { insight: EngineInsight }) {
  return (
    <div className="rounded-lg border border-ink/10 bg-ink/[0.03] px-3 py-2 text-xs">
      <div className="flex items-start gap-2">
        <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: SEVERITY_DOT[insight.severity] }} />
        <span className="font-semibold leading-snug text-ink">{insight.title}</span>
      </div>
      <p className="mt-0.5 pl-3.5 leading-snug text-ink/70">{insight.text}</p>
      {insight.recommendation && (
        <div className="mt-1 flex items-start gap-2 pl-3.5">
          <span className="shrink-0 text-brand-700">→</span>
          <span className="leading-snug" style={{ color: INK_MUTED }}>
            {insight.recommendation}
          </span>
        </div>
      )}
    </div>
  );
}

export function HighlightPeriodsSection({ data, metricsMeta, colorPeriods }: Props) {
  const granularity = detectGranularity(data.dimensions);
  const periodRows =
    colorPeriods && colorPeriods.length > 0 && granularity
      ? colorPeriods.map((p) => ({
          period: p,
          totals: data.metrics.map((_, i) => periodTotal(data, p, granularity, i)),
        }))
      : [];

  if (periodRows.length === 0) {
    return (
      <div className="animate-fade-in">
        <h3 className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-ink/50">
          <Trophy size={13} />
          Highlight periods
        </h3>
        <p className="text-xs" style={{ color: INK_MUTED }}>
          Add two or more highlight periods (with a date breakdown selected) to compare them here.
        </p>
      </div>
    );
  }

  // Best period per metric COLUMN (which highlighted period wins for this one metric),
  // not per row — comparing different metrics' raw magnitudes against each other within
  // a single period is meaningless (a session count will always dwarf a percentage).
  // Respects metricIsInverted: for a metric where more is bad (refunds, cart removals),
  // "best" is the smallest value, matching buildInsights.ts's already-correct narrative
  // best/worst logic.
  const bestPeriodIdxByMetric = data.metrics.map((m, i) => {
    if (periodRows.length < 2) return -1;
    const inverted = metricIsInverted(m);
    let bestIdx = -1;
    let bestVal = inverted ? Infinity : -Infinity;
    periodRows.forEach((pr, idx) => {
      const v = pr.totals[i] ?? 0;
      if (v <= 0) return;
      if (inverted ? v < bestVal : v > bestVal) {
        bestVal = v;
        bestIdx = idx;
      }
    });
    return bestIdx;
  });

  return (
    <div className="animate-fade-in">
      <h3 className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-ink/50">
        <Trophy size={13} />
        Highlight periods
      </h3>
      <div className="overflow-x-auto rounded-xl border border-ink/10 bg-ink/[0.03]">
        <Table>
          <THead>
            <TR className="hover:bg-transparent">
              <TH className="px-4 py-2.5">Period</TH>
              {data.metrics.map((m) => (
                <TH key={m} className="px-4 py-2.5 text-right">
                  {metricLabel(m, metricsMeta)}
                </TH>
              ))}
            </TR>
          </THead>
          <TBody>
            {periodRows.map(({ period, totals }, rowIdx) => {
              return (
                <TR key={period.id} className="hover:bg-transparent">
                  <TD className="px-4 py-2.5 text-ink/70">
                    <span className="mr-1.5 inline-block h-2 w-2 rounded-full align-middle" style={{ background: period.color }} />
                    {period.label || "Unnamed period"}
                    <span className="ml-1.5 text-xs" style={{ color: INK_MUTED }}>
                      {period.startDate} → {period.endDate}
                    </span>
                  </TD>
                  {totals.map((t, i) => {
                    const type = data.metricHeaders[i]?.type;
                    const isBest = bestPeriodIdxByMetric[i] === rowIdx;
                    return (
                      <TD
                        key={i}
                        className="px-4 py-2.5 text-right tabular-nums"
                        style={{ color: isBest ? "#3ab36c" : "#162a3d" }}
                      >
                        {fmtValue(t, type, data.currencyCode)}
                      </TD>
                    );
                  })}
                </TR>
              );
            })}
          </TBody>
        </Table>
      </div>
    </div>
  );
}

interface CompareRowProps {
  apiName: string;
  data: ReportResponse;
  metricsMeta?: MetaItem[];
}

/** One row's content — split out so the drag-sortable wrapper in ReportCanvas can
 *  render it without duplicating the value/delta lookup logic. */
export function CompareMetricRow({ apiName, data, metricsMeta }: CompareRowProps) {
  const i = data.metrics.indexOf(apiName);
  if (i === -1) return null;
  const a = data.totalsA[i] ?? 0;
  const b = data.totalsB?.[i];
  const d = deltaPct(a, b);
  const type = data.metricHeaders[i]?.type;
  const good = d !== null && (metricIsInverted(apiName) ? d < 0 : d > 0);
  return (
    <div className="flex items-center justify-between rounded-lg border border-ink/10 bg-ink/[0.03] px-3 py-2 text-xs">
      <span className="truncate text-ink/70">{metricLabel(apiName, metricsMeta)}</span>
      <span className="flex shrink-0 items-center gap-2 tabular-nums">
        <span className="font-semibold text-ink">{fmtValue(a, type, data.currencyCode)}</span>
        {d !== null && (
          <span style={{ color: good || d === 0 ? DELTA_UP : DELTA_DOWN }} className="font-medium">
            {fmtDelta(d)}
          </span>
        )}
      </span>
    </div>
  );
}
