import { clsx } from "clsx";
import type { ButtonHTMLAttributes } from "react";

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "danger" | "ghost";
  size?: "sm" | "md" | "lg";
  loading?: boolean;
}

export function Button({
  variant = "primary",
  size = "md",
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
      className={clsx(
        "inline-flex items-center justify-center font-semibold rounded-xl transition-all focus:outline-none focus:ring-2 focus:ring-offset-2",
        {
          // Brand rule: primary = accent fill, dark text
          "bg-brand-500 text-ink hover:bg-brand-400 active:bg-brand-600 focus:ring-brand-300":
            variant === "primary",
          "bg-white text-ink border border-ink/15 hover:bg-ink/5 focus:ring-brand-300":
            variant === "secondary",
          "bg-red-500 text-white hover:bg-red-600 focus:ring-red-300": variant === "danger",
          "text-ink/70 hover:text-ink hover:bg-ink/5 focus:ring-ink/20": variant === "ghost",
          "px-3 py-1.5 text-xs": size === "sm",
          "px-4 py-2 text-sm": size === "md",
          "px-6 py-3 text-base": size === "lg",
          "opacity-60 cursor-not-allowed": disabled || loading,
        },
        className
      )}
    >
      {loading && (
        <svg
          className="animate-spin -ml-1 mr-2 h-4 w-4"
          fill="none"
          viewBox="0 0 24 24"
        >
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path
            className="opacity-75"
            fill="currentColor"
            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
          />
        </svg>
      )}
      {children}
    </button>
  );
}
