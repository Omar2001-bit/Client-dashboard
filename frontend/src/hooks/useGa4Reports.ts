import { useQuery } from "@tanstack/react-query";
import { loadGa4Reports } from "@/lib/ga4Reports/storage";
import type { Ga4ReportDoc } from "@/types";

export function useGa4Reports(clientId: string | null | undefined) {
  return useQuery<Ga4ReportDoc[]>({
    queryKey: ["ga4Reports", clientId],
    queryFn: () => loadGa4Reports(clientId as string),
    enabled: !!clientId,
  });
}
