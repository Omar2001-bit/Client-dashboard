import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

interface Props {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
  dashed?: boolean;
  className?: string;
}

/** Standard empty state. `dashed` gives the dashed-border "drop zone / nothing here" look. */
export function EmptyState({ icon, title, description, action, dashed, className }: Props) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center rounded-2xl p-10 text-center",
        dashed && "border border-dashed border-ink/20 bg-white/60",
        className
      )}
    >
      {icon && <div className="mb-3 text-ink/30">{icon}</div>}
      <p className="text-sm font-semibold text-ink">{title}</p>
      {description && <p className="mt-1 max-w-sm text-sm text-ink/50">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
