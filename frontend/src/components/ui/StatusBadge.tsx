import { Badge, type BadgeTone } from "./Badge";

type Status = "running" | "completed" | "paused" | "draft" | "active" | "inactive" | "archived";

const tone: Record<Status, BadgeTone> = {
  running: "brand",
  active: "brand",
  completed: "neutral",
  paused: "warning",
  draft: "muted",
  inactive: "danger",
  archived: "attention",
};

export function StatusBadge({ status }: { status: Status }) {
  return (
    <Badge tone={tone[status] ?? "muted"} className="capitalize">
      {status}
    </Badge>
  );
}
