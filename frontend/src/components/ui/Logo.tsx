import { cn } from "@/lib/cn";

interface Props {
  variant?: "full" | "mark";
  className?: string;
}

/**
 * Optimizers logo — the "OP" monogram (the O and P letters with an arrow motif, forming an
 * integrated, continuous "infinity" process; see docs/brand/01-logo.md).
 *
 * Color follows `currentColor`, so the brand's three color variations come from the parent's
 * text color:
 *   • primary   → dark   (wrap in `text-ink`)      — on white / green
 *   • secondary → white  (wrap in `text-white`)    — on black / green
 *   • tertiary  → green  (wrap in `text-brand-500`)— on black
 *
 * ⚠ PLACEHOLDER artwork approximating the official OP monogram. Replace with the official
 * vector when supplied (see frontend/src/assets/brand/README.md).
 */
function Mark() {
  return (
    <>
      {/* O — ring with a forward arrow (optimization / motion) */}
      <circle cx="15" cy="20" r="12" fill="none" stroke="currentColor" strokeWidth="2.8" />
      <path
        d="M9 20 H20 M16 15 L21 20 L16 25"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* P — stem + bowl */}
      <path d="M31 7 V33" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" />
      <path
        d="M31 8 H35 A7 7 0 0 1 35 22 H31"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </>
  );
}

export function Logo({ variant = "full", className }: Props) {
  if (variant === "mark") {
    return (
      <svg
        viewBox="0 0 44 40"
        xmlns="http://www.w3.org/2000/svg"
        className={cn(className)}
        role="img"
        aria-label="Optimizers"
      >
        <Mark />
      </svg>
    );
  }

  return (
    <svg
      viewBox="0 0 230 40"
      xmlns="http://www.w3.org/2000/svg"
      className={cn(className)}
      role="img"
      aria-label="Optimizers"
    >
      <Mark />
      <text
        x="54"
        y="27"
        fontFamily="Sora, ui-sans-serif, system-ui, sans-serif"
        fontWeight="700"
        fontSize="22"
        letterSpacing="-0.5"
        fill="currentColor"
      >
        Optimizers
      </text>
    </svg>
  );
}
