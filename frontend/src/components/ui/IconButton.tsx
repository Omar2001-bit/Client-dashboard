import { cva, type VariantProps } from "class-variance-authority";
import type { ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

export const iconButtonVariants = cva(
  "inline-flex items-center justify-center rounded-xl transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300 disabled:opacity-40 disabled:cursor-not-allowed",
  {
    variants: {
      variant: {
        outline: "border border-ink/15 text-ink/70 hover:bg-ink/5 hover:text-ink",
        ghost: "text-ink/60 hover:bg-ink/5 hover:text-ink",
      },
      size: {
        sm: "h-7 w-7",
        md: "h-9 w-9",
        lg: "h-10 w-10",
      },
    },
    defaultVariants: { variant: "outline", size: "md" },
  }
);

interface Props
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof iconButtonVariants> {}

/** Square icon-only button (nav arrows, close, prev/next). Provide an `aria-label`. */
export function IconButton({ variant, size, className, type, ...props }: Props) {
  return (
    <button
      type={type ?? "button"}
      className={cn(iconButtonVariants({ variant, size }), className)}
      {...props}
    />
  );
}
