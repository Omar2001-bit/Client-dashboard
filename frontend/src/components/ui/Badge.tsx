import { cva, type VariantProps } from "class-variance-authority";
import type { HTMLAttributes } from "react";
import { cn } from "@/lib/cn";

/**
 * The one status pill. Unifies what used to be three copy-pasted badge components
 * (StatusBadge, AuditSeverityBadge, FixProgressBadge) — those are now thin wrappers
 * that map their domain status to a `tone` here.
 *
 * Neutral tones use `ink` (never gray/slate); semantic tones use the status palette.
 */
export const badgeVariants = cva(
  "inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium",
  {
    variants: {
      tone: {
        neutral: "bg-ink/10 text-ink",
        muted: "bg-ink/5 text-ink/60",
        brand: "bg-brand-100 text-brand-800",
        success: "bg-emerald-100 text-emerald-700",
        warning: "bg-yellow-100 text-yellow-800",
        attention: "bg-orange-100 text-orange-700",
        danger: "bg-red-100 text-red-700",
      },
    },
    defaultVariants: { tone: "neutral" },
  }
);

export type BadgeTone = NonNullable<VariantProps<typeof badgeVariants>["tone"]>;

export interface BadgeProps
  extends HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ tone, className, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />;
}
