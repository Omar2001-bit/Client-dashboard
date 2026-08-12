import type { MouseEvent } from "react";

/** True when a click originated on (or inside) a link or button — used to let a row's
 * own click handler (e.g. row selection) step aside for nested interactive elements
 * that should keep their own behavior (navigate, open a new tab, toggle) instead of
 * also triggering the row-level action. */
export function isInteractiveClickTarget(e: MouseEvent): boolean {
  return !!(e.target as HTMLElement).closest("a, button");
}
