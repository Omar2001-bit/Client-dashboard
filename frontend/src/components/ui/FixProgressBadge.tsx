import { Badge, type BadgeTone } from "./Badge";
import type { FixProgressStatus } from "@/types";

const tone: Record<FixProgressStatus, BadgeTone> = {
  fixed: "success",
  notfixed: "danger",
  unreviewed: "muted",
};

const labels: Record<FixProgressStatus, string> = {
  fixed: "Fixed",
  notfixed: "Not fixed",
  unreviewed: "Not reviewed",
};

export function FixProgressBadge({ status }: { status: FixProgressStatus }) {
  return <Badge tone={tone[status]}>{labels[status]}</Badge>;
}
