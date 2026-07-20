import { CompareMetricRow, InsightBubble } from "./AnalyticsView";
import { KpiTileContent } from "./NumbersView";
import type { EngineInsight } from "@/lib/ga4Reports/insightEngine";
import type { EntryRef, MetaItem, ReportResponse } from "@/lib/ga4Reports/types";

// Ported verbatim (no theme changes needed — pure dispatcher, no styling of its own)
// from VC3/GA4-simply-layer's src/components/EntryCard.tsx.
interface Props {
  entry: EntryRef;
  data: ReportResponse;
  metricsMeta?: MetaItem[];
  insightsById: Map<string, EngineInsight>; // insight id -> full engine insight
  shape: "tile" | "row"; // which section's native shell this is rendering inside
}

/** Renders any entry (kpi card, compare row, or insight) to fit whichever section it's
 *  currently in — a metric renders as a value+delta regardless of which container holds
 *  it, an insight always renders as its sentence. This is what makes "drag anything into
 *  any section" coherent: the section supplies the container shape, the entry supplies
 *  its own content. */
export default function EntryCard({ entry, data, metricsMeta, insightsById, shape }: Props) {
  if (entry.kind === "insight") {
    const insight = insightsById.get(entry.id);
    if (!insight) return null;
    return <InsightBubble insight={insight} />;
  }
  return shape === "tile" ? (
    <KpiTileContent apiName={entry.id} data={data} metricsMeta={metricsMeta} />
  ) : (
    <CompareMetricRow apiName={entry.id} data={data} metricsMeta={metricsMeta} />
  );
}
