import { Filter } from "lucide-react";
import { useGa4FunnelData } from "@/hooks/useGa4FunnelData";
import { resolveCompare, resolveRange } from "@/lib/ga4Reports/dates";
import { fmtValue } from "@/lib/ga4Reports/format";
import { DELTA_DOWN, INK_MUTED, SERIES_A, SERIES_B } from "@/lib/ga4Reports/theme";
import type { CompareSel, DateRangeSel, FunnelConfig, FunnelResponse, ResolvedRange } from "@/lib/ga4Reports/types";

// Ported from VC3/GA4-simply-layer's src/components/FunnelView.tsx. Two real
// adaptations, not just a palette swap:
// 1. Fetching: replaced the source's own useEffect/AbortController double-fetch (one
//    client-driven request per period against /api/funnel) with useGa4FunnelData, which
//    calls this app's POST /api/ga4-reports/funnel — a single round trip that runs both
//    periods server-side via Promise.all (see server/index.js).
// 2. Step rendering: the source overlays white text directly on each bar using
//    mix-blend-difference so it stays legible against either a filled (brand-color) or
//    unfilled (near-black, low-opacity) bar segment on a DARK page. That trick inverts
//    the wrong way on a light background (an unfilled near-white track would make
//    mix-blend-difference text nearly invisible) — so here the label/value sit above a
//    slim progress bar instead of overlaid inside it, avoiding the contrast dependency
//    entirely rather than fighting it with blend modes.
interface Props {
  clientId: string;
  reportId: string; // server derives the GA4 property from this report's own stored doc
  funnel: FunnelConfig;
  rangeA: DateRangeSel;
  rangeB: CompareSel; // "none" preset -> no comparison funnel rendered
}

/** One period's complete funnel: a slim proportion bar per step, continue rates and
 *  drop-offs between steps. Current period renders in the brand series color, previous
 *  in the comparison color. */
function FunnelSteps({ data, color }: { data: FunnelResponse; color: string }) {
  const steps = data.steps;
  if (steps.length === 0) {
    return <p className="py-4 text-center text-xs text-ink/50">No data for this period.</p>;
  }
  return (
    <div className="space-y-2.5">
      {steps.map((s, i) => {
        const share = steps[0].users > 0 ? s.users / steps[0].users : 0;
        const dropped = i > 0 ? steps[i - 1].users - s.users : 0;
        return (
          <div key={i}>
            {i > 0 && (
              <div className="flex items-center justify-between px-0.5 py-0.5 text-[11px] tabular-nums text-ink/50">
                <span>↳ {s.rateFromPrevious !== null ? `${(s.rateFromPrevious * 100).toFixed(1)}% continue` : "–"}</span>
                {dropped > 0 && <span style={{ color: DELTA_DOWN }}>−{fmtValue(dropped, "TYPE_INTEGER")} dropped</span>}
              </div>
            )}
            <div className="mb-1 flex items-baseline justify-between gap-2 text-xs">
              <span className="truncate font-medium text-ink">{s.label}</span>
              <span className="shrink-0 tabular-nums font-semibold text-ink">
                {fmtValue(s.users, "TYPE_INTEGER")}
                {s.rateFromFirst !== null && (
                  <span className="ml-1.5 font-normal text-ink/50">({(s.rateFromFirst * 100).toFixed(1)}%)</span>
                )}
              </span>
            </div>
            <div className="relative h-3 overflow-hidden rounded-full bg-ink/5">
              <div
                className="h-full rounded-full transition-all duration-300"
                style={{ width: `${Math.max(share * 100, 2)}%`, background: color }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function PeriodHeader({ label, range, data }: { label: string; range: ResolvedRange; data: FunnelResponse }) {
  const overall = data.steps.length >= 2 ? data.steps[data.steps.length - 1].rateFromFirst : null;
  return (
    <div className="mb-1.5 flex flex-wrap items-baseline justify-between gap-1 text-[11px] uppercase tracking-wider text-ink/50">
      <span className="font-semibold text-ink/70">{label}</span>
      <span>
        {range.startDate} → {range.endDate}
        {overall !== null && (
          <>
            {" · "}
            <span className="font-semibold text-brand-700">{(overall * 100).toFixed(1)}%</span>
          </>
        )}
      </span>
    </div>
  );
}

/** One GA4-native funnel: numbers come from runGa4FunnelReport (GA4's own funnel engine
 *  — sequencing, dedup, open/closed semantics all computed at Google), so they match
 *  what Explorations shows for the same steps. When a comparison period is set, the SAME
 *  funnel runs for both periods and they render as two complete side-by-side funnels —
 *  previous on the left, current on the right — each with its own bars and rates. */
export default function FunnelView({ clientId, reportId, funnel, rangeA, rangeB }: Props) {
  const resolvedA = resolveRange(rangeA);
  const resolvedB = rangeB.preset !== "none" ? resolveCompare(rangeB, resolvedA) : null;
  const enabled = funnel.steps.filter((s) => s.eventName).length >= 2;

  const { data: result, error, isLoading } = useGa4FunnelData(
    clientId,
    reportId,
    enabled ? funnel.id : null,
    resolvedA,
    resolvedB
  );

  const data = result?.current ?? null;
  const prevData = result?.previous ?? null;

  return (
    <div className="rounded-xl border border-ink/10 bg-white p-4">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold text-ink">
          <Filter size={14} className="text-brand-700" />
          {funnel.name || "Untitled funnel"}
        </h3>
        <span className="text-[11px] uppercase tracking-wider" style={{ color: INK_MUTED }}>
          {funnel.open ? "Open funnel" : "Closed funnel"}
        </span>
      </div>

      {error ? (
        <p className="py-4 text-center text-sm text-red-600">{error instanceof Error ? error.message : "Failed to load"}</p>
      ) : !enabled ? (
        <p className="py-4 text-xs text-ink/50">Add at least two steps in the editor to run this funnel.</p>
      ) : !data ? (
        <p className="py-4 text-center text-xs text-ink/50">{isLoading ? "Loading funnel…" : "No data yet."}</p>
      ) : (
        <div className="relative">
          {isLoading && (
            <div className="absolute inset-0 z-10 flex items-center justify-center rounded-lg bg-white/70 text-xs text-ink/50">
              Refreshing…
            </div>
          )}
          {prevData && resolvedB ? (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <div>
                <PeriodHeader label="Previous" range={resolvedB} data={prevData} />
                <FunnelSteps data={prevData} color={SERIES_B} />
              </div>
              <div>
                <PeriodHeader label="Current" range={resolvedA} data={data} />
                <FunnelSteps data={data} color={SERIES_A} />
              </div>
            </div>
          ) : (
            <FunnelSteps data={data} color={SERIES_A} />
          )}
        </div>
      )}
    </div>
  );
}
