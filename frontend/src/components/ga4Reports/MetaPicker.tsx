import { ChevronDown, Check } from "lucide-react";
import { useMemo, useState } from "react";
import type { MetaItem } from "@/lib/ga4Reports/types";

interface Props {
  items: MetaItem[];
  selected: string[]; // apiNames
  onToggle: (apiName: string) => void;
  max?: number; // max selectable (1 = radio behavior)
  placeholder: string;
  allowNone?: boolean;
}

// Ported from VC3/GA4-simply-layer's src/components/MetaPicker.tsx, re-skinned to this
// app's light theme (source was dark-themed) — logic unchanged.
/** Searchable multi/single select over GA4 metadata items. */
export default function MetaPicker({ items, selected, onToggle, max = 1, placeholder, allowNone }: Props) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);

  const filtered = useMemo(() => {
    const needle = q.toLowerCase();
    const match = needle
      ? items.filter(
          (i) =>
            i.uiName.toLowerCase().includes(needle) ||
            i.apiName.toLowerCase().includes(needle) ||
            i.category.toLowerCase().includes(needle)
        )
      : items;
    return match.slice(0, 60);
  }, [items, q]);

  const label =
    selected.length === 0
      ? allowNone
        ? "Choose a dimension"
        : placeholder
      : selected
          .map((s) => items.find((i) => i.apiName === s)?.uiName ?? s)
          .join(", ");

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="focus-ring flex w-full items-center gap-2 rounded-lg border border-ink/15 bg-white px-3 py-2 text-left text-sm text-ink transition-colors duration-150 hover:border-ink/30"
      >
        <span className="min-w-0 flex-1 truncate">{label}</span>
        <ChevronDown
          size={14}
          className="shrink-0 text-ink/50 transition-transform duration-150"
          style={{ transform: open ? "rotate(180deg)" : "rotate(0deg)" }}
        />
      </button>
      {open && (
        <div className="animate-pop-in absolute z-20 mt-1.5 max-h-72 w-full origin-top overflow-y-auto rounded-lg border border-ink/15 bg-white shadow-lg shadow-ink/10">
          <div className="sticky top-0 bg-white p-2">
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={`Search ${placeholder.toLowerCase()}…`}
              className="focus-ring w-full rounded-md border border-ink/15 bg-white px-2.5 py-1.5 text-sm text-ink transition-colors duration-150 focus:border-brand-500"
            />
          </div>
          {allowNone && (
            <button
              type="button"
              onClick={() => {
                if (selected.length) selected.forEach((s) => onToggle(s));
                setOpen(false);
              }}
              className="focus-ring block w-full px-3 py-2 text-left text-sm text-ink/50 transition-colors duration-100 hover:bg-ink/5 hover:text-ink/70"
            >
              None (totals only)
            </button>
          )}
          {filtered.map((i) => {
            const isSel = selected.includes(i.apiName);
            const disabled = !isSel && max > 1 && selected.length >= max;
            return (
              <button
                key={i.apiName}
                type="button"
                disabled={disabled}
                onClick={() => {
                  if (max === 1) {
                    // radio: clear others first
                    selected.filter((s) => s !== i.apiName).forEach((s) => onToggle(s));
                    if (!isSel) onToggle(i.apiName);
                    setOpen(false);
                  } else {
                    onToggle(i.apiName);
                  }
                }}
                className={`focus-ring flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors duration-100 hover:bg-ink/5 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent ${
                  isSel ? "text-brand-700" : "text-ink/70"
                }`}
              >
                <span className="flex h-4 w-4 shrink-0 items-center justify-center">
                  {isSel && <Check size={13} className="animate-check-pop" />}
                </span>
                <span className="min-w-0 flex-1 truncate">{i.uiName}</span>
                <span className="shrink-0 text-xs text-ink/50">{i.category}</span>
              </button>
            );
          })}
          {filtered.length === 0 && <div className="px-3 py-3 text-sm text-ink/50">No matches</div>}
        </div>
      )}
    </div>
  );
}
