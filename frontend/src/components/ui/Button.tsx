import { cva, type VariantProps } from "class-variance-authority";
import type { ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/cn";
import { Spinner } from "./Spinner";

export const buttonVariants = cva(
  "inline-flex items-center justify-center font-semibold rounded-xl transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:opacity-60 disabled:cursor-not-allowed",
  {
    variants: {
      variant: {
        // Brand rule: primary = green fill, Black Forest text
        primary:
          "bg-brand-500 text-ink-deep hover:bg-brand-400 active:bg-brand-600 focus-visible:ring-brand-300",
        // Brand rule: secondary = outline (black outline on light surfaces)
        secondary:
          "bg-white text-ink border border-ink/15 hover:bg-ink/5 focus-visible:ring-brand-300",
        danger: "bg-red-500 text-white hover:bg-red-600 focus-visible:ring-red-300",
        ghost: "text-ink/70 hover:text-ink hover:bg-ink/5 focus-visible:ring-ink/20",
        // Solid dark button on light surfaces (e.g. coach-marks)
        dark: "bg-ink text-white hover:bg-ink-700 focus-visible:ring-brand-300",
        // Brand rule: secondary on dark = white outline on dark surface
        onDark:
          "bg-transparent text-white border border-white/25 hover:bg-white/10 focus-visible:ring-white/40",
      },
      size: {
        sm: "px-3 py-1.5 text-xs",
        md: "px-4 py-2 text-sm",
        lg: "px-6 py-3 text-base",
      },
    },
    defaultVariants: { variant: "primary", size: "md" },
  }
);

interface Props
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  loading?: boolean;
}

export function Button({
  variant,
  size,
  loading,
  className,
  children,
  disabled,
  ...props
}: Props) {
  return (
    <button
      {...props}
      disabled={disabled || loading}
      className={cn(buttonVariants({ variant, size }), className)}
    >
      {loading && <Spinner className="-ml-1 mr-2" />}
      {children}
    </button>
  );
}
