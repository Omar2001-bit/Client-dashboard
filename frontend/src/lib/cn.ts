import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Merge class names with `clsx` and de-conflict Tailwind utilities with
 * `tailwind-merge`. The single class helper for the design system — prefer this
 * over bare `clsx` so later utilities correctly override earlier ones.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
