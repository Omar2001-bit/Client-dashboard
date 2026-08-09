import type { ClientDoc } from "@/types";

export function isEngagementExpired(client: Pick<ClientDoc, "status" | "contractEndDate">): boolean {
  if (client.status !== "active" || !client.contractEndDate) return false;
  return client.contractEndDate.toDate() < new Date();
}
