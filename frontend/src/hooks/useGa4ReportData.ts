import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchGa4ReportData } from "@/lib/ga4Reports/api";
import { resolveCompare, resolveRange } from "@/lib/ga4Reports/dates";
import type { ReportResponse } from "@/lib/ga4Reports/types";
import type { Ga4ReportDoc } from "@/types";

// Replaces GA4-simply-layer's hand-rolled src/lib/useReport.ts (its own useState/
// useEffect/AbortController fetch hook) with a TanStack Query useQuery, matching this
// app's existing convention (useAuditFindings, useGA4Data). Two side effects of that
// switch, not extra work: TanStack Query already swallows the stale-request case
// (no manual AbortError handling needed), and its cache de-dup on a matching queryKey
// directly resolves the source's own documented flaw of firing duplicate parallel
// fetches when e.g. the full report and a metric carousel request overlapping data.
export interface Ga4ReportDataOverride {
  /** Must be a subset of the report's own metrics (enforced server-side). */
  metrics?: string[];
  dimensions?: string[];
}

export function useGa4ReportData(
  clientId: string | null | undefined,
  report: Ga4ReportDoc | null | undefined,
  override?: Ga4ReportDataOverride
) {
  // Deliberately memoized on only the two date-selector fields, not the whole `report`
  // object — cosmetic report edits (name, description, layout) shouldn't recompute the
  // resolved range or bust the query key below.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const rangeA = useMemo(() => (report ? resolveRange(report.rangeA) : null), [report?.rangeA]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const rangeB = useMemo(() => (report && rangeA ? resolveCompare(report.rangeB, rangeA) : null), [report?.rangeB, rangeA]);

  return useQuery<ReportResponse>({
    queryKey: [
      "ga4ReportData",
      clientId,
      report?.id,
      report?.property,
      override?.dimensions ?? report?.dimensions,
      override?.metrics ?? report?.metrics,
      report?.filters,
      report?.limit,
      rangeA,
      rangeB,
    ],
    queryFn: ({ signal }) =>
      fetchGa4ReportData({
        clientId: clientId as string,
        reportId: (report as Ga4ReportDoc).id,
        rangeA: rangeA as NonNullable<typeof rangeA>,
        rangeB,
        metrics: override?.metrics,
        dimensions: override?.dimensions,
        signal,
      }),
    enabled: !!clientId && !!report && !!rangeA,
  });
}
