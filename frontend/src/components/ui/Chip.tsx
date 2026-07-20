import { cva, type VariantProps } from "class-variance-authority";
import type { ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

/** Toggleable filter chip (e.g. tag/segment filters). Extracted from the ga4Reports chip pattern. */
export const chipVariants = cva(
  "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300",
  {
    variants: {
      active: {
        true: "border-brand-500 bg-brand-500/10 text-brand-700",
        false: "border-ink/15 text-ink/60 hover:border-ink/30 hover:text-ink",
      },
    },
    defaultVariants: { active: false },
  }
);

interface Props
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof chipVariants> {}

export function Chip({ active, className, type, ...props }: Props) {
  return (
    <button type={type ?? "button"} className={cn(chipVariants({ active }), className)} {...props} />
  );
}
