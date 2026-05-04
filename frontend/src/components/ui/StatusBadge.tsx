import { clsx } from "clsx";

type Status = "running" | "completed" | "paused" | "draft" | "active" | "inactive" | "archived";

const styles: Record<Status, string> = {
  running: "bg-brand-100 text-brand-800",
  active: "bg-brand-100 text-brand-800",
  completed: "bg-ink/10 text-ink",
  paused: "bg-yellow-100 text-yellow-800",
  draft: "bg-ink/5 text-ink/60",
  inactive: "bg-red-100 text-red-700",
  archived: "bg-orange-100 text-orange-700",
};

export function StatusBadge({ status }: { status: Status }) {
  return (
    <span
      className={clsx(
        "inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium capitalize",
        styles[status] ?? "bg-gray-100 text-gray-600"
      )}
    >
      {status}
    </span>
  );
}
