import { clsx } from "clsx";

interface Props {
  variant?: "full" | "mark";
  className?: string;
}

/**
 * Optimizers wordmark and mark.
 * The mark is an "O" enclosing a forward-motion arrow — the brand's loops/motion motif.
 *
 * - variant="full" → mark + wordmark, sized via `className` (e.g. h-8)
 * - variant="mark" → just the icon, square, sized via `className` (e.g. h-7 w-7)
 *
 * Color is inherited via `currentColor`. The arrow inside the O picks up the brand
 * accent automatically when wrapped in `text-brand-500`.
 */
export function Logo({ variant = "full", className }: Props) {
  if (variant === "mark") {
    return (
      <svg
        viewBox="0 0 32 32"
        xmlns="http://www.w3.org/2000/svg"
        className={clsx(className)}
        aria-label="Optimizers"
      >
        <circle cx="16" cy="16" r="13" fill="none" stroke="currentColor" strokeWidth="2.5" />
        <path
          d="M 8 16 H 22 M 18 11 L 23 16 L 18 21"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  }

  return (
    <svg
      viewBox="0 0 220 40"
      xmlns="http://www.w3.org/2000/svg"
      className={clsx(className)}
      aria-label="Optimizers"
    >
      {/* Mark */}
      <g>
        <circle cx="20" cy="20" r="15" fill="none" stroke="currentColor" strokeWidth="2.6" />
        <path
          d="M 11 20 H 27 M 22 14 L 28 20 L 22 26"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </g>
      {/* Wordmark */}
      <text
        x="46"
        y="27"
        fontFamily="Sora, system-ui, sans-serif"
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
