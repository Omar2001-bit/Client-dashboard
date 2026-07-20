import type { SelectHTMLAttributes } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/cn";

interface Props extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  error?: string;
  hint?: string;
}

/** Styled native `<select>` — pass `<option>`s as children. Replaces the ad-hoc select classes. */
export function Select({ label, error, hint, className, id, children, ...props }: Props) {
  const selectId = id ?? label?.toLowerCase().replace(/\s+/g, "-");
  return (
    <div className="space-y-1">
      {label && (
        <label htmlFor={selectId} className="block text-sm font-medium text-ink/80">
          {label}
        </label>
      )}
      <div className="relative">
        <select
          id={selectId}
          className={cn(
            "block w-full appearance-none rounded-xl border bg-white px-3.5 py-2.5 pr-9 text-sm text-ink focus:outline-none focus:ring-2 transition-colors",
            error
              ? "border-red-300 focus:border-red-400 focus:ring-red-200"
              : "border-ink/15 focus:border-brand-500 focus:ring-brand-200",
            className
          )}
          {...props}
        >
          {children}
        </select>
        <ChevronDown className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-ink/40" />
      </div>
      {error && <p className="text-xs text-red-600">{error}</p>}
      {hint && !error && <p className="text-xs text-ink/50">{hint}</p>}
    </div>
  );
}
