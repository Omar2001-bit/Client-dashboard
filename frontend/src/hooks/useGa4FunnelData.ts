import { useQuery } from "@tanstack/react-query";
import { fetchGa4FunnelData } from "@/lib/ga4Reports/api";
import type { ResolvedRange } from "@/lib/ga4Reports/types";

// Replaces GA4-simply-layer's FunnelView-internal useEffect/AbortController fetch with a
// useQuery, matching this app's convention. Takes already-resolved ranges (computed once
// by the parent report canvas via useGa4ReportData's own resolveRange/resolveCompare)
// rather than re-resolving DateRangeSel/CompareSel itself.
export function useGa4FunnelData(
  clientId: string | null | undefined,
  reportId: string | null | undefined,
  funnelId: string | null | undefined,
  rangeA: ResolvedRange | null | undefined,
  rangeB: ResolvedRange | null | undefined
) {
  return useQuery({
    queryKey: ["ga4FunnelData", clientId, reportId, funnelId, rangeA, rangeB],
    queryFn: ({ signal }) =>
      fetchGa4FunnelData({
        clientId: clientId as string,
        reportId: reportId as string,
        funnelId: funnelId as string,
        rangeA: rangeA as ResolvedRange,
        rangeB,
        signal,
      }),
    enabled: !!clientId && !!reportId && !!funnelId && !!rangeA,
  });
}
