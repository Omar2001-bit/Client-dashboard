import { parseDateKey, startOfDay } from "@/lib/timeline";
import type { ClickUpTask } from "@/types";

const DAY_MS = 24 * 60 * 60 * 1000;

function barStart(task: ClickUpTask): Date | null {
  return parseDateKey(task.startDate ?? undefined) ?? parseDateKey(task.dateCreated ?? undefined);
}

function barEnd(task: ClickUpTask): Date {
  return parseDateKey(task.dateClosed ?? undefined) ?? startOfDay(new Date());
}

/** Axis for one list's tasks: earliest task start in that list through today. Using
 *  "today" as the fixed ceiling (rather than each task's own close date) keeps every
 *  list's axis an honest "elapsed so far" window instead of stretching to whichever
 *  task happened to close latest. */
export function getTaskGanttBounds(tasks: ClickUpTask[]): { start: Date; end: Date } {
  const starts = tasks.map(barStart).filter((d): d is Date => Boolean(d));
  const today = startOfDay(new Date());
  if (starts.length === 0) return { start: today, end: new Date(today.getTime() + DAY_MS * 30) };
  const min = starts.reduce((a, b) => (b < a ? b : a));
  const end = min.getTime() >= today.getTime() ? new Date(min.getTime() + DAY_MS) : today;
  return { start: min, end };
}

export interface TaskGanttLayout {
  left: number;
  width: number;
  isOpen: boolean;
}

/** Every task gets a bar — no exclusions. Falls back to `start` if a task genuinely has
 *  no startDate/dateCreated at all (shouldn't happen once tasks are synced with the newer
 *  fields, but keeps this safe for any pre-existing synced data missing them). Width is the
 *  bar's true span (no inclusive-day padding) so its right edge lands exactly on `taskEnd`'s
 *  real position — an open task's bar ends exactly at "today", never past it. The 1.5% floor
 *  keeps same-day/zero-duration tasks visible without needing to overstate their real end. */
export function getTaskGanttLayout(task: ClickUpTask, start: Date, end: Date): TaskGanttLayout {
  const span = Math.max(1, end.getTime() - start.getTime());
  const taskStart = barStart(task) ?? start;
  const taskEnd = barEnd(task);
  const left = Math.max(0, ((taskStart.getTime() - start.getTime()) / span) * 100);
  const width = Math.max(1.5, ((taskEnd.getTime() - taskStart.getTime()) / span) * 100);
  return { left, width, isOpen: !task.dateClosed };
}

export function formatGanttRange(task: ClickUpTask): string {
  const start = barStart(task);
  const startLabel = start ? start.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "-";
  const endLabel = task.dateClosed
    ? new Date(task.dateClosed).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })
    : "Ongoing";
  return `${startLabel} → ${endLabel}`;
}
