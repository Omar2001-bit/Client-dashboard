import { ChevronDown, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { metricLabel } from "@/lib/ga4Reports/metricLabels";
import { isConvRateMetric, isEventMetric, type MetaItem } from "@/lib/ga4Reports/types";

// Ported from VC3/GA4-simply-layer's src/components/MetricJumpMenu.tsx, re-skinned to
// this app's light theme — logic unchanged.
interface Entry {
  index: number;
  apiName: string;
  label: string;
  group: string;
}

function groupFor(apiName: string, metricsMeta?: MetaItem[]): string {
  if (isEventMetric(apiName)) return "Events";
  if (isConvRateMetric(apiName)) return "Conversion rates";
  return metricsMeta?.find((m) => m.apiName === apiName)?.category ?? "Metrics";
}

interface Props {
  metrics: string[];
  active: number;
  onSelect: (index: number) => void;
  metricsMeta?: MetaItem[];
}

/** Search-and-jump menu for reports with many metrics — the old dot strip stopped being
 *  usable somewhere past a dozen. Same dropdown/search pattern as MetaPicker (button +
 *  floating searchable list), grouped by metric type so a 42-metric report reads as a
 *  handful of labeled clusters, not a wall. */
export default function MetricJumpMenu({ metrics, active, onSelect, metricsMeta }: Props) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);

  const entries = useMemo<Entry[]>(
    () =>
      metrics.map((apiName, index) => ({
        index,
        apiName,
        label: metricLabel(apiName, metricsMeta),
        group: groupFor(apiName, metricsMeta),
      })),
    [metrics, metricsMeta]
  );

  const filtered = useMemo(() => {
    const needle = q.toLowerCase();
    return needle
      ? entries.filter((e) => e.label.toLowerCase().includes(needle) || e.group.toLowerCase().includes(needle))
      : entries;
  }, [entries, q]);

  // Grouped in first-appearance order (matches how the report's metric list was built),
  // not alphabetically — keeps it predictable across sessions.
  const grouped = useMemo(() => {
    const map = new Map<string, Entry[]>();
    for (const e of filtered) {
      if (!map.has(e.group)) map.set(e.group, []);
      map.get(e.group)!.push(e);
    }
    return [...map.entries()];
  }, [filtered]);

  if (metrics.length < 6) return null; // a search menu adds nothing for a handful of metrics

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="Jump to metric"
        aria-expanded={open}
        className="focus-ring flex h-7 items-center gap-1.5 rounded-lg border border-ink/15 px-2.5 text-[11px] text-ink/50 transition-all duration-150 hover:border-ink/30 hover:text-ink active:scale-95"
      >
        <Search size={12} />
        Jump to…
        <ChevronDown
          size={11}
          className="transition-transform duration-150"
          style={{ transform: open ? "rotate(180deg)" : "rotate(0deg)" }}
        />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="animate-pop-in absolute right-0 z-20 mt-1.5 max-h-80 w-72 origin-top-right overflow-y-auto rounded-lg border border-ink/15 bg-white shadow-lg shadow-ink/10">
            <div className="sticky top-0 z-10 bg-white p-2">
              <input
                autoFocus
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder={`Search ${metrics.length} metrics…`}
                className="focus-ring w-full rounded-md border border-ink/15 bg-white px-2.5 py-1.5 text-sm text-ink transition-colors duration-150 focus:border-brand-500"
              />
            </div>
            {grouped.map(([group, items]) => (
              <div key={group}>
                <div className="sticky top-[42px] z-10 bg-white/95 px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-ink/50">
                  {group}
                </div>
                {items.map((e) => (
                  <button
                    key={e.apiName}
                    type="button"
                    onClick={() => {
                      onSelect(e.index);
                      setOpen(false);
                      setQ("");
                    }}
                    aria-current={e.index === active}
                    className={`focus-ring block w-full truncate px-3 py-1.5 text-left text-sm transition-colors duration-100 hover:bg-ink/5 ${
                      e.index === active ? "text-brand-700" : "text-ink/70"
                    }`}
                  >
                    {e.label}
                  </button>
                ))}
              </div>
            ))}
            {filtered.length === 0 && <div className="px-3 py-3 text-sm text-ink/50">No matches</div>}
          </div>
        </>
      )}
    </div>
  );
}
