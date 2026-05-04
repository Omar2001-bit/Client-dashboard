import { clsx } from "clsx";
import type { ReactNode } from "react";

interface Props {
  title: string;
  value: string;
  delta?: string;
  deltaPositive?: boolean;
  note?: string;
  icon?: ReactNode;
  sparkline?: number[];
  loading?: boolean;
}

export function KPICard({ title, value, delta, deltaPositive, note, icon, loading }: Props) {
  return (
    <div className="bg-white rounded-brand border border-ink/10 shadow-[0_1px_3px_rgba(14,28,38,0.04)] p-6 transition-shadow hover:shadow-[0_4px_12px_rgba(14,28,38,0.06)]">
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs font-semibold uppercase tracking-wider text-ink/50">{title}</p>
        {icon && <div className="p-2 bg-brand-100 rounded-xl text-ink">{icon}</div>}
      </div>
      {loading ? (
        <div className="animate-pulse">
          <div className="h-8 w-32 bg-ink/10 rounded mb-2" />
          <div className="h-4 w-20 bg-ink/5 rounded" />
        </div>
      ) : (
        <>
          <p className="text-3xl font-bold text-ink tracking-tight">{value}</p>
          {delta && (
            <p
              className={clsx(
                "mt-1 text-sm font-medium",
                deltaPositive ? "text-brand-700" : "text-red-600"
              )}
            >
              {deltaPositive ? "\u25B2" : "\u25BC"} {delta}
            </p>
          )}
          {note && <p className="mt-1 text-sm text-ink/50">{note}</p>}
        </>
      )}
    </div>
  );
}
