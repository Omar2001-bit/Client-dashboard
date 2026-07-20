import { Badge, type BadgeTone } from "./Badge";
import type { AuditSeverity } from "@/types";

const tone: Record<AuditSeverity, BadgeTone> = {
  Critical: "danger",
  High: "attention",
  "Action Needed": "warning",
  "Unable to Verify": "muted",
  Correct: "success",
};

export function AuditSeverityBadge({ status }: { status: AuditSeverity }) {
  return <Badge tone={tone[status] ?? "muted"}>{status}</Badge>;
}
