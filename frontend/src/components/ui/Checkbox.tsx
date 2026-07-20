import type { InputHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

interface Props extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
}

export function Checkbox({ label, className, id, ...props }: Props) {
  const cbId = id ?? label?.toLowerCase().replace(/\s+/g, "-");
  return (
    <label
      htmlFor={cbId}
      className="inline-flex items-center gap-2 text-sm text-ink/80 cursor-pointer select-none"
    >
      <input
        id={cbId}
        type="checkbox"
        className={cn(
          "h-4 w-4 rounded border-ink/30 accent-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-200",
          className
        )}
        {...props}
      />
      {label && <span>{label}</span>}
    </label>
  );
}
