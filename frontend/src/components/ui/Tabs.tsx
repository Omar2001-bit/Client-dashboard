import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

interface TabItem<T extends string> {
  value: T;
  label: ReactNode;
}

interface TabsProps<T extends string> {
  items: TabItem<T>[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
}

/** Underline tabs for page-level navigation (e.g. ClientDetailPage sections). */
export function Tabs<T extends string>({ items, value, onChange, className }: TabsProps<T>) {
  return (
    <div className={cn("flex gap-1 border-b border-ink/10", className)} role="tablist">
      {items.map((it) => {
        const active = it.value === value;
        return (
          <button
            key={it.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(it.value)}
            className={cn(
              "relative -mb-px border-b-2 px-3.5 py-2.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:text-ink",
              active
                ? "border-brand-500 text-ink"
                : "border-transparent text-ink/50 hover:border-ink/20 hover:text-ink"
            )}
          >
            {it.label}
          </button>
        );
      })}
    </div>
  );
}

interface SegmentedProps<T extends string> extends TabsProps<T> {
  size?: "sm" | "md";
}

/** Pill segmented control (chart-type / period toggles). Green segment = active. */
export function SegmentedControl<T extends string>({
  items,
  value,
  onChange,
  size = "md",
  className,
}: SegmentedProps<T>) {
  return (
    <div
      className={cn("inline-flex overflow-hidden rounded-lg border border-ink/15", className)}
      role="tablist"
    >
      {items.map((it) => {
        const active = it.value === value;
        return (
          <button
            key={it.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(it.value)}
            className={cn(
              "transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-300",
              size === "sm" ? "px-2.5 py-1.5 text-xs" : "px-3.5 py-2 text-sm",
              active
                ? "bg-brand-500 font-semibold text-ink-deep"
                : "text-ink/50 hover:bg-ink/5 hover:text-ink/70"
            )}
          >
            {it.label}
          </button>
        );
      })}
    </div>
  );
}
