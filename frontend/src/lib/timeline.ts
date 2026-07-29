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

function formatAxisDate(date: Date, includeYear: boolean): string {
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    ...(includeYear ? { year: "numeric" } : {}),
  });
}
