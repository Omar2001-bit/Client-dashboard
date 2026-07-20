import { useQuery } from "@tanstack/react-query";
import { getGa4ReportsMetadata } from "@/lib/ga4Reports/api";

// Shared across every ReportPreviewCard on the mega dashboard — TanStack Query dedupes
// identical (queryKey) fetches across simultaneously-mounted components, so N cards
// targeting the same GA4 property cost one network request, not N. This is what lets
// preview cards resolve real GA4 uiNames instead of falling back to a humanized apiName
// (the source app's own documented labeling gap — see ReportPreviewCard.tsx).
export function useGa4ReportsMetadata(property: string | null | undefined) {
  return useQuery({
    queryKey: ["ga4ReportsMetadata", property],
    queryFn: () => getGa4ReportsMetadata(property as string),
    enabled: !!property,
    staleTime: 5 * 60 * 1000,
  });
}
