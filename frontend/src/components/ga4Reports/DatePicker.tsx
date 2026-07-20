import { Calendar, ChevronLeft, ChevronRight } from "lucide-react";
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { fmtDateLabel } from "@/lib/ga4Reports/format";

export interface DatePickerHandle {
  open: () => void;
  close: () => void;
}

interface Props {
  value: string; // YYYY-MM-DD
  onSelect: (date: string) => void;
  min?: string; // YYYY-MM-DD, inclusive
  max?: string; // YYYY-MM-DD, inclusive
  align?: "left" | "right";
}

function parseISO(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y || 2026, (m || 1) - 1, d || 1);
}
function toISO(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

const WEEKDAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
const MONTH_FMT = new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" });
const today = new Date();

// Ported from VC3/GA4-simply-layer's src/components/DatePicker.tsx, re-skinned to this
// app's light theme — logic unchanged.
/** A calendar we fully own: month-nav arrows only ever touch local view state, day
 *  cells are the only thing that can ever call onSelect. No native <input type="date">
 *  ambiguity between "browsing" and "picking" left to guess at from a single opaque
 *  `change` event. */
const DatePicker = forwardRef<DatePickerHandle, Props>(function DatePicker(
  { value, onSelect, min, max, align = "left" },
  ref
) {
  const [open, setOpen] = useState(false);
  const selected = parseISO(value);
  const [viewMonth, setViewMonth] = useState(() => new Date(selected.getFullYear(), selected.getMonth(), 1));
  const rootRef = useRef<HTMLDivElement>(null);

  useImperativeHandle(ref, () => ({
    open: () => {
      setViewMonth(new Date(selected.getFullYear(), selected.getMonth(), 1));
      setOpen(true);
    },
    close: () => setOpen(false),
  }));

  useEffect(() => {
    if (!open) return;
    const onDocDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDocDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const minD = min ? parseISO(min) : null;
  const maxD = max ? parseISO(max) : null;

  const firstOfMonth = new Date(viewMonth.getFullYear(), viewMonth.getMonth(), 1);
  const startWeekday = firstOfMonth.getDay();
  const daysInMonth = new Date(viewMonth.getFullYear(), viewMonth.getMonth() + 1, 0).getDate();

  const cells: (Date | null)[] = [];
  for (let i = 0; i < startWeekday; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(viewMonth.getFullYear(), viewMonth.getMonth(), d));
  while (cells.length % 7 !== 0) cells.push(null);

  const isDisabled = (d: Date) => (!!minD && d < minD) || (!!maxD && d > maxD);
  const atMaxMonth = maxD ? viewMonth.getFullYear() === maxD.getFullYear() && viewMonth.getMonth() === maxD.getMonth() : false;
  const atMinMonth = minD ? viewMonth.getFullYear() === minD.getFullYear() && viewMonth.getMonth() === minD.getMonth() : false;

  return (
    <div className="relative inline-block" ref={rootRef}>
      <button
        type="button"
        onClick={() => {
          setViewMonth(new Date(selected.getFullYear(), selected.getMonth(), 1));
          setOpen((v) => !v);
        }}
        className="focus-ring flex items-center gap-1.5 rounded-lg border border-ink/15 bg-white px-2 py-1.5 text-sm tabular-nums text-ink/70 transition-colors duration-150 hover:border-ink/30 hover:text-ink"
      >
        <Calendar size={13} className="shrink-0 text-ink/50" />
        {fmtDateLabel(value)}
      </button>
      {open && (
        <div
          // Mobile: centered under the trigger, capped to the viewport width — a fixed
          // left-0/right-0 anchor can push a 256px popover off-screen when the trigger
          // itself sits near a narrow viewport's edge. From sm: up there's enough room
          // for the original align-based anchor.
          className={`animate-pop-in absolute top-[calc(100%+4px)] left-1/2 z-50 w-64 max-w-[calc(100vw-2rem)] -translate-x-1/2 origin-top rounded-xl border border-ink/15 bg-white p-3 shadow-lg shadow-ink/10 sm:left-auto sm:translate-x-0 ${
            align === "right" ? "sm:right-0 sm:origin-top-right" : "sm:left-0 sm:origin-top-left"
          }`}
        >
          <div className="mb-2 flex items-center justify-between">
            <button
              type="button"
              // month-nav: local view state only — never selects a date
              onClick={(e) => {
                e.stopPropagation();
                setViewMonth((m) => new Date(m.getFullYear(), m.getMonth() - 1, 1));
              }}
              disabled={atMinMonth}
              aria-label="Previous month"
              className="focus-ring flex h-7 w-7 items-center justify-center rounded-md text-ink/50 transition-colors duration-150 hover:bg-ink/5 hover:text-ink disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent"
            >
              <ChevronLeft size={13} />
            </button>
            <span className="text-xs font-semibold text-ink">{MONTH_FMT.format(viewMonth)}</span>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setViewMonth((m) => new Date(m.getFullYear(), m.getMonth() + 1, 1));
              }}
              disabled={atMaxMonth}
              aria-label="Next month"
              className="focus-ring flex h-7 w-7 items-center justify-center rounded-md text-ink/50 transition-colors duration-150 hover:bg-ink/5 hover:text-ink disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent"
            >
              <ChevronRight size={13} />
            </button>
          </div>
          <div className="grid grid-cols-7 gap-y-1 text-center text-[10px] font-medium uppercase tracking-wide text-ink/50">
            {WEEKDAYS.map((w) => (
              <span key={w}>{w}</span>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-y-1 text-center text-xs tabular-nums">
            {cells.map((d, i) => {
              if (!d) return <span key={`empty-${i}`} />;
              const disabled = isDisabled(d);
              const isSelected = sameDay(d, selected);
              const isToday = sameDay(d, today);
              return (
                <button
                  key={d.toISOString()}
                  type="button"
                  disabled={disabled}
                  // the only handler in this whole component allowed to call onSelect
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelect(toISO(d));
                    setOpen(false);
                  }}
                  className={`focus-ring mx-auto flex h-8 w-8 items-center justify-center rounded-full transition-all duration-150 active:scale-90 ${
                    disabled
                      ? "cursor-not-allowed text-ink/20"
                      : isSelected
                        ? "font-semibold text-ink"
                        : isToday
                          ? "text-ink ring-1 ring-inset ring-ink/20 hover:bg-ink/10"
                          : "text-ink/70 hover:bg-ink/10"
                  }`}
                  style={isSelected && !disabled ? { background: "#6ae499" } : undefined}
                >
                  {d.getDate()}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
});

export default DatePicker;
