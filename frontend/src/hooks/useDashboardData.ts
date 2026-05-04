import { useQuery } from "@tanstack/react-query";
import { loadDashboardData } from "@/pages/dashboard/dashboardData";
import type { DashboardData } from "@/pages/dashboard/dashboardData";

export function useDashboardData(clientId: string | null | undefined) {
  return useQuery<DashboardData>({
    queryKey: ["dashboardData", clientId],
    queryFn: () => loadDashboardData(clientId as string),
    enabled: !!clientId,
  });
}
