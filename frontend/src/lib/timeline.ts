import type { TimelinePhase } from "@/types";

const DAY_MS = 24 * 60 * 60 * 1000;

export function parseDateKey(value?: string): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : startOfDay(date);
}

export function toDateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function startOfDay(date: Date): Date {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  return next;
}

export function sortPhases(phases: TimelinePhase[]): TimelinePhase[] {
  return [...phases].sort((left, right) => {
    const leftStart = parseDateKey(left.startDate)?.getTime() ?? 0;
    const rightStart = parseDateKey(right.startDate)?.getTime() ?? 0;
    const startDiff = leftStart - rightStart;
    if (startDiff !== 0) return startDiff;
    return left.title.localeCompare(right.title);
  });
}

export function getTimelineBounds(
  contractStart: string,
  contractEnd: string | undefined,
  phases: TimelinePhase[]
): { start: Date; end: Date } {
  const start = parseDateKey(contractStart) ?? new Date();
  const explicitEnd = parseDateKey(contractEnd);
  const phaseEnds = phases
    .map((phase) => parseDateKey(phase.endDate))
    .filter((date): date is Date => Boolean(date));
  const latestPhaseEnd = phaseEnds.reduce<Date | null>((latest, candidate) => {
    if (!latest || candidate > latest) return candidate;
    return latest;
  }, null);
  const fallbackEnd = new Date(start.getTime() + DAY_MS * 30);
  const end = explicitEnd ?? latestPhaseEnd ?? fallbackEnd;
  return { start: startOfDay(start), end: startOfDay(end) };
}

export function getPhaseLayout(phase: TimelinePhase, start: Date, end: Date) {
  const phaseStart = parseDateKey(phase.startDate) ?? start;
  const phaseEnd = parseDateKey(phase.endDate) ?? phaseStart;
  const span = Math.max(1, end.getTime() - start.getTime());
  const left = Math.max(0, ((phaseStart.getTime() - start.getTime()) / span) * 100);
  const width = Math.max(1.5, (((phaseEnd.getTime() - phaseStart.getTime()) + DAY_MS) / span) * 100);
  return { left, width };
}

export function getTimelineTicks(start: Date, end: Date, tickCount = 6): Array<{ date: Date; label: string; left: number }> {
  const safeTickCount = Math.max(2, tickCount);
  const span = Math.max(end.getTime() - start.getTime(), DAY_MS);
  return Array.from({ length: safeTickCount }, (_, index) => {
    const ratio = index / (safeTickCount - 1);
    const date = new Date(start.getTime() + span * ratio);
    return {
      date: startOfDay(date),
      label: formatAxisDate(date, index === 0 || index === safeTickCount - 1),
      left: ratio * 100,
    };
  });
}

export function formatTimelineDate(value?: string): string {
  const date = parseDateKey(value);
  if (!date) return "-";
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatAxisDate(date: Date, includeYear: boolean): string {
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    ...(includeYear ? { year: "numeric" } : {}),
  });
}
