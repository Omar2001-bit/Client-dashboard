import { cva, type VariantProps } from "class-variance-authority";
import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/cn";

export const alertVariants = cva("flex gap-3 rounded-xl border px-3.5 py-3 text-sm", {
  variants: {
    tone: {
      info: "border-ink/10 bg-ink/[0.03] text-ink/80",
      success: "border-emerald-200 bg-emerald-50 text-emerald-800",
      warning: "border-yellow-200 bg-yellow-50 text-yellow-800",
      danger: "border-red-200 bg-red-50 text-red-700",
    },
  },
  defaultVariants: { tone: "info" },
});

interface Props extends HTMLAttributes<HTMLDivElement>, VariantProps<typeof alertVariants> {
  icon?: ReactNode;
  title?: string;
}

/** Inline message block. Replaces ad-hoc `text-red-600 bg-red-50 …` error boxes. */
export function Alert({ tone, icon, title, className, children, ...props }: Props) {
  return (
    <div role="status" className={cn(alertVariants({ tone }), className)} {...props}>
      {icon && <span className="mt-0.5 shrink-0">{icon}</span>}
      <div className="min-w-0 space-y-0.5">
        {title && <p className="font-semibold">{title}</p>}
        {children}
      </div>
    </div>
  );
}
