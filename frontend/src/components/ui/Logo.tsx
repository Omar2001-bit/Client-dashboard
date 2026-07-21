import { cn } from "@/lib/cn";
import logoFull from "@/assets/brand/optimizers-logo-full.png";
import logoFullWhite from "@/assets/brand/optimizers-logo-white.png";
import logoMark from "@/assets/brand/optimizers-icon.png";

interface Props {
  variant?: "full" | "mark";
  tone?: "dark" | "white";
  className?: string;
}

/**
 * Optimizers logo — official artwork. Fixed-color raster PNGs (dark-ink or white wordmark for
 * `full`, brand-green monogram for `mark`), so unlike the old placeholder SVG they don't tint
 * via `currentColor` — `text-*` wrappers around <Logo> no longer affect it. `variant="full"`
 * defaults to the dark-on-transparent lockup (needs a light background); pass `tone="white"`
 * on dark backgrounds (e.g. AdminLayout's sidebar) for the reversed lockup instead.
 */
export function Logo({ variant = "full", tone = "dark", className }: Props) {
  if (variant === "mark") {
    return <img src={logoMark} alt="Optimizers" className={cn("object-contain", className)} />;
  }

  const src = tone === "white" ? logoFullWhite : logoFull;
  return <img src={src} alt="Optimizers" className={cn("object-contain", className)} />;
}
