// Extracted from VC3/GA4-simply-layer's src/components/AnalyticsView.tsx. Like
// metricLabel(), this is pure business logic with no JSX dependency — it belongs in lib,
// not in a component file (also resolves an ESLint react-refresh/only-export-components
// violation that mixing a plain function export into a components-only file triggers).
import { bucketOverlapsRange, detectGranularity } from "./dates";
import { fmtValue } from "./format";
import { metricLabel } from "./metricLabels";
import { analyzeReport, type EngineInsight } from "./insightEngine";
import type { ColorPeriod, MetaItem, ReportResponse } from "./types";

/** Sums a metric's current-period rows that fall inside a highlight period — used for
 *  the "which period performed best" comparison. */
export function periodTotal(
  data: ReportResponse,
  period: ColorPeriod,
  granularity: NonNullable<ReturnType<typeof detectGranularity>>,
  metricIdx: number
): number {
  let sum = 0;
  for (const r of data.rows) {
    if (r.dim && bucketOverlapsRange(granularity, r.dim, period.startDate, period.endDate)) {
      sum += r.a[metricIdx] ?? 0;
    }
  }
  return sum;
}

/** The full rule engine (see insightEngine.ts), plus the highlight-period comparison
 *  which needs periodTotal(). */
export function buildInsights(
  data: ReportResponse,
  metricsMeta: MetaItem[] | undefined,
  colorPeriods: ColorPeriod[] | undefined
): EngineInsight[] {
  const out = analyzeReport(data, metricsMeta);
  const granularity = detectGranularity(data.dimensions);

  // best vs worst highlight period, per metric
  if (colorPeriods && colorPeriods.length >= 2 && granularity) {
    data.metrics.forEach((m, i) => {
      const totals = colorPeriods.map((p) => ({ period: p, total: periodTotal(data, p, granularity, i) }));
      const withData = totals.filter((t) => t.total > 0);
      if (withData.length < 2) return;
      const best = withData.reduce((a, b) => (b.total > a.total ? b : a));
      const worst = withData.reduce((a, b) => (b.total < a.total ? b : a));
      if (best.period.id === worst.period.id) return;
      const upPct = ((best.total - worst.total) / worst.total) * 100;
      const type = data.metricHeaders[i]?.type;
      out.push({
        id: `highlight:${m}`,
        severity: "info",
        category: "trend",
        score: 25,
        title: `"${best.period.label || "Unnamed period"}" was your strongest highlighted period for ${metricLabel(m, metricsMeta)}`,
        text: `It beat "${worst.period.label || "an unnamed period"}" by ${upPct.toFixed(1)}% (${fmtValue(best.total, type, data.currencyCode)} vs ${fmtValue(worst.total, type, data.currencyCode)}).`,
      });
    });
  }

  return out;
}
