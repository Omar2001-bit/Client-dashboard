import { Link } from "react-router-dom";
import { Area, AreaChart, ResponsiveContainer, Tooltip } from "recharts";
import { track } from "@/lib/activityTracker";
import { useGa4ReportData } from "@/hooks/useGa4ReportData";
import { useGa4ReportsMetadata } from "@/hooks/useGa4ReportsMetadata";
import { metricLabel } from "@/lib/ga4Reports/metricLabels";
import { deltaPct, fmtCompact, fmtDelta } from "@/lib/ga4Reports/format";
import { DELTA_DOWN, DELTA_UP, INK_MUTED, SERIES_A } from "@/lib/ga4Reports/theme";
import type { Ga4ReportDoc } from "@/types";

interface Props {
  clientId: string;
  report: Ga4ReportDoc;
  to: string; // destination route — admin and client contexts link to different paths
}

// Ported from VC3/GA4-simply-layer's src/components/ReportPreviewCard.tsx, re-skinned to
// this app's light theme. Fixes the source's own documented labeling gap while porting:
// it calls metricLabel(metric) without metadata, falling back to a humanized apiName for
// every real GA4 metric even though the full report page resolves the real uiName. Here,
// useGa4ReportsMetadata dedupes identical per-property fetches across every card on the
// mega dashboard (TanStack Query cache, same queryKey), so this is a correct fix, not
// an N-cards-N-fetches cost.
/** Mega-dashboard card: one cheap query (single metric, date-only breakdown) so N cards
 *  on screen never repeats the "whole report, every metric" fetch storm — just enough
 *  graph + numbers to judge at a glance, full detail lives one click away. */
export default function ReportPreviewCard({ clientId, report, to }: Props) {
  const metric = report.metrics[0];
  const { data, error, isLoading: loading } = useGa4ReportData(clientId, report, {
    metrics: [metric],
    dimensions: ["date"],
  });
  const { data: metadata } = useGa4ReportsMetadata(report.property);

  const type = data?.metricHeaders[0]?.type;
  const current = data?.totalsA[0] ?? 0;
  const previous = data?.totalsB?.[0];
  const delta = deltaPct(current, previous);
  const spark = (data?.rows ?? []).map((r) => ({ v: r.a[0] ?? 0 }));

  return (
    <Link
      to={to}
      onClick={() => track({ type: "analytics_report_view", metadata: { reportId: report.id, reportName: report.name } })}
      className="focus-ring animate-rise-in group flex flex-col gap-1 rounded-2xl border border-ink/10 bg-white p-4 transition-all duration-150 hover:border-brand-500/40 hover:bg-ink/[0.02] active:scale-[0.99]"
    >
      <h3 className="truncate text-sm font-semibold text-ink group-hover:text-brand-700">{report.name}</h3>
      {report.description && <p className="truncate text-xs text-ink/50">{report.description}</p>}

      {error ? (
        <p className="mt-2 text-xs text-red-600">{error instanceof Error ? error.message : "Failed to load"}</p>
      ) : (
        <>
          <div className="mt-1.5 flex items-baseline gap-2">
            <span className="text-lg font-semibold tabular-nums text-ink">
              {loading && !data ? "…" : fmtCompact(current, type, data?.currencyCode)}
            </span>
            {delta !== null && (
              <span
                className="text-xs font-medium tabular-nums"
                style={{ color: delta < 0 ? DELTA_DOWN : DELTA_UP }}
              >
                {fmtDelta(delta)}
              </span>
            )}
          </div>
          <p className="text-[11px] text-ink/50">{metricLabel(metric, metadata?.metrics)}</p>

          <div className="mt-2 h-14 w-full">
            {spark.length > 1 ? (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={spark} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
                  <defs>
                    <linearGradient id={`spark-${report.id}`} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={SERIES_A} stopOpacity={0.35} />
                      <stop offset="100%" stopColor={SERIES_A} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <Tooltip
                    cursor={false}
                    content={({ active, payload }) =>
                      active && payload?.length ? (
                        <div className="rounded-md border border-ink/10 bg-white px-2 py-1 text-[11px] tabular-nums text-ink shadow-lg shadow-ink/10">
                          {fmtCompact(payload[0].value as number, type, data?.currencyCode)}
                        </div>
                      ) : null
                    }
                  />
                  <Area
                    type="monotone"
                    dataKey="v"
                    stroke={SERIES_A}
                    strokeWidth={1.5}
                    fill={`url(#spark-${report.id})`}
                    isAnimationActive={false}
                  />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex h-full items-center justify-center text-[11px]" style={{ color: INK_MUTED }}>
                {loading ? "Loading…" : "No data"}
              </div>
            )}
          </div>
        </>
      )}
    </Link>
  );
}
