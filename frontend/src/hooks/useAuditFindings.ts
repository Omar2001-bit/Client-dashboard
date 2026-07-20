import { useQuery } from "@tanstack/react-query";
import { loadAuditFindings } from "@/lib/auditFindings";
import type { AuditFindingDoc } from "@/types";

export function useAuditFindings(clientId: string | null | undefined) {
  return useQuery<AuditFindingDoc[]>({
    queryKey: ["auditFindings", clientId],
    queryFn: () => loadAuditFindings(clientId as string),
    enabled: !!clientId,
  });
}
