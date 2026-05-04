import { clsx } from "clsx";
import type { InputHTMLAttributes } from "react";

interface Props extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  hint?: string;
}

export function Input({ label, error, hint, className, id, ...props }: Props) {
  const inputId = id ?? label?.toLowerCase().replace(/\s+/g, "-");
  return (
    <div className="space-y-1">
      {label && (
        <label htmlFor={inputId} className="block text-sm font-medium text-ink/80">
          {label}
        </label>
      )}
      <input
        id={inputId}
        className={clsx(
          "block w-full rounded-xl border px-3.5 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 transition-colors text-ink placeholder:text-ink/40",
          error
            ? "border-red-300 focus:border-red-400 focus:ring-red-200"
            : "border-ink/15 focus:border-brand-500 focus:ring-brand-200",
          className
        )}
        {...props}
      />
      {error && <p className="text-xs text-red-600">{error}</p>}
      {hint && !error && <p className="text-xs text-ink/50">{hint}</p>}
    </div>
  );
}
