import { ArrowRight, Check, Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Button, Input, Select } from "@/components/ui";
import DatePicker from "./DatePicker";
import MetaPicker from "./MetaPicker";
import { getGa4ReportsValues } from "@/lib/ga4Reports/api";
import { maxSelectableDate } from "@/lib/ga4Reports/dates";
import { humanizeEvent } from "@/lib/ga4Reports/format";
import { loadGa4Reports } from "@/lib/ga4Reports/storage";
import {
  CHART_TYPES,
  COLOR_PERIOD_PALETTE,
  FILTER_MATCHES,
  MAX_DIMENSIONS,
  isConvRateMetric,
  isEventMetric,
  makeConvRateMetric,
  makeEventMetric,
  type ColorPeriod,
  type FilterClause,
  type FunnelConfig,
  type MetadataResponse,
} from "@/lib/ga4Reports/types";
import type { GA4Property, Ga4ReportDoc } from "@/types";

// Ported from VC3/GA4-simply-layer's src/components/ReportEditor.tsx, re-skinned to
// this app's light theme. Adaptations: configDimensions()/legacy `dimension` field
// dropped (dims is always config.dimensions); the "existing groups" and "value
// suggestions"/"event names" fetches go through this app's Firestore/Express layer
// (loadGa4Reports, getGa4ReportsValues) instead of GA4-simply-layer's own Next.js API
// routes; the property picker renders this app's GA4Property shape (bare propertyId),
// not GA4-simply-layer's "properties/123"-prefixed PropertySummary shape.
const newId = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

interface Props {
  clientId: string;
  config: Ga4ReportDoc;
  onChange: (c: Ga4ReportDoc) => void;
  properties: GA4Property[];
  metadata: MetadataResponse | null;
  onSave: () => void;
  onDelete?: () => void;
  saving: boolean;
  savedAt: number | null;
}

const labelCls = "mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.14em] text-ink/50";
const smallFieldCls =
  "focus-ring rounded-lg border border-ink/15 bg-white px-2 py-1.5 text-xs text-ink transition-colors duration-150 hover:border-ink/30 focus:border-brand-500";

/** Common starting points — one click sets the breakdown. */
const QUICK_DIMS: { label: string; dim: string }[] = [
  { label: "Over time", dim: "date" },
  { label: "Events", dim: "eventName" },
  { label: "Audiences", dim: "audienceName" },
  { label: "Channels", dim: "sessionDefaultChannelGroup" },
  { label: "Pages", dim: "pagePath" },
  { label: "Countries", dim: "country" },
];

export default function ReportEditor({
  clientId,
  config,
  onChange,
  properties,
  metadata,
  onSave,
  onDelete,
  saving,
  savedAt,
}: Props) {
  const set = (patch: Partial<Ga4ReportDoc>) => onChange({ ...config, ...patch });
  const filters = config.filters ?? [];
  const dims = config.dimensions;
  const setDims = (next: string[]) => set({ dimensions: next.slice(0, MAX_DIMENSIONS) });
  const toggleDim = (d: string) =>
    setDims(dims.includes(d) ? dims.filter((x) => x !== d) : [...dims, d]);

  const setFilter = (i: number, patch: Partial<FilterClause>) => {
    const next = filters.map((f, idx) => (idx === i ? { ...f, ...patch } : f));
    set({ filters: next });
  };

  const colorPeriods = config.colorPeriods ?? [];
  const setColorPeriod = (i: number, patch: Partial<ColorPeriod>) =>
    set({ colorPeriods: colorPeriods.map((p, idx) => (idx === i ? { ...p, ...patch } : p)) });
  const addColorPeriod = () => {
    const today = maxSelectableDate();
    set({
      colorPeriods: [
        ...colorPeriods,
        {
          id: `p-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
          label: "",
          startDate: today,
          endDate: today,
          color: COLOR_PERIOD_PALETTE[colorPeriods.length % COLOR_PERIOD_PALETTE.length],
        },
      ],
    });
  };

  // other reports' group names, offered as datalist suggestions so the same group can
  // be reused by name instead of retyped exactly each time.
  const [existingGroups, setExistingGroups] = useState<string[]>([]);
  useEffect(() => {
    loadGa4Reports(clientId)
      .then((reports) => {
        const names = Array.from(new Set(reports.map((r) => r.group).filter((g): g is string => !!g)));
        setExistingGroups(names);
      })
      .catch(() => {});
  }, [clientId]);

  // real dimension values (event names, channels, countries…) for filter-value suggestions
  const [valueSuggestions, setValueSuggestions] = useState<Record<string, string[]>>({});
  const filterFields = filters.map((f) => f.field).filter(Boolean).join(",");
  useEffect(() => {
    const fields = filterFields ? filterFields.split(",") : [];
    for (const field of fields) {
      if (valueSuggestions[field]) continue;
      getGa4ReportsValues(config.property, field)
        .then((values) => setValueSuggestions((prev) => ({ ...prev, [field]: values })))
        .catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterFields, config.property]);

  const funnels = config.funnels ?? [];
  const setFunnel = (i: number, patch: Partial<FunnelConfig>) =>
    set({ funnels: funnels.map((f, idx) => (idx === i ? { ...f, ...patch } : f)) });

  // real event names actually firing in this property — GA4 has no per-event "count"
  // metric, so these are offered as virtual metrics ("event:purchase") the server
  // resolves into eventCount × eventName.
  const [eventNames, setEventNames] = useState<string[] | null>(null);
  useEffect(() => {
    if (!config.property) return;
    getGa4ReportsValues(config.property, "eventName")
      .then((values) => setEventNames(values))
      .catch(() => setEventNames([]));
  }, [config.property]);
  const toggleMetric = (m: string) =>
    set({
      metrics: config.metrics.includes(m)
        ? config.metrics.filter((x) => x !== m)
        : [...config.metrics, m],
    });

  // A render-time `Date.now() - savedAt < 4000` check only hides the badge if something
  // else happens to re-render the component after 4s pass — with no other state churn
  // it would just sit there forever. A real timer.
  const [showSaved, setShowSaved] = useState(false);
  useEffect(() => {
    if (!savedAt) return;
    // Synchronizing to a real external signal (a save event) with a real side effect
    // (a timer) — not derivable at render time, so this isn't the "you might not need
    // an effect" case the lint rule generally guards against.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setShowSaved(true);
    const t = setTimeout(() => setShowSaved(false), 4000);
    return () => clearTimeout(t);
  }, [savedAt]);

  return (
    <aside className="animate-rise-in w-full shrink-0 space-y-5 rounded-2xl border border-ink/10 bg-white p-5 lg:w-[21rem]">
      <div>
        <label className={labelCls}>Report name</label>
        <Input value={config.name} onChange={(e) => set({ name: e.target.value })} />
      </div>
      <div>
        <label className={labelCls}>Description</label>
        <Input
          value={config.description ?? ""}
          placeholder="What this report answers…"
          onChange={(e) => set({ description: e.target.value })}
        />
      </div>
      <div>
        <label className={labelCls}>Group</label>
        <Input
          value={config.group ?? ""}
          placeholder="e.g. Client A, Weekly reports…"
          list="existing-groups"
          onChange={(e) => set({ group: e.target.value })}
        />
        <datalist id="existing-groups">
          {existingGroups.map((g) => (
            <option key={g} value={g} />
          ))}
        </datalist>
        <p className="mt-1.5 text-[11px] leading-snug text-ink/50">
          Reports sharing a group name are sectioned together on the mega dashboard. Leave blank
          to leave it ungrouped.
        </p>
      </div>
      <div>
        <label className={labelCls}>GA4 property</label>
        <Select value={config.property} onChange={(e) => set({ property: e.target.value })}>
          {properties.map((p) => (
            <option key={p.propertyId} value={`properties/${p.propertyId}`}>
              {p.displayName} — {p.propertyId}
            </option>
          ))}
        </Select>
      </div>

      <div>
        <label className={labelCls}>Metrics</label>
        <MetaPicker
          items={metadata?.metrics ?? []}
          selected={config.metrics.filter((m) => !isEventMetric(m) && !isConvRateMetric(m))}
          onToggle={toggleMetric}
          max={Infinity}
          placeholder="Pick metrics"
        />
      </div>

      <div>
        <label className={labelCls}>Event counts</label>
        <MetaPicker
          items={(eventNames ?? []).map((n) => ({
            apiName: makeEventMetric(n),
            uiName: humanizeEvent(n),
            category: "Event",
          }))}
          selected={config.metrics.filter(isEventMetric)}
          onToggle={toggleMetric}
          max={Infinity}
          placeholder={eventNames === null ? "Loading events…" : eventNames.length === 0 ? "No events found" : "Pick events to count"}
        />
        <p className="mt-1.5 text-[11px] leading-snug text-ink/50">
          GA4 has no built-in metric per event, this counts occurrences of the event itself
          (eventCount filtered to that event name), same as &ldquo;Events&rdquo; breakdown below but as its own line.
        </p>
      </div>

      <div>
        <label className={labelCls}>Conversion rates</label>
        <MetaPicker
          items={(eventNames ?? []).flatMap((n) => [
            { apiName: makeConvRateMetric(n, "totalUsers"), uiName: `${humanizeEvent(n)} → per user`, category: "Conversion" },
            { apiName: makeConvRateMetric(n, "sessions"), uiName: `${humanizeEvent(n)} → per session`, category: "Conversion" },
          ])}
          selected={config.metrics.filter(isConvRateMetric)}
          onToggle={toggleMetric}
          max={Infinity}
          placeholder={eventNames === null ? "Loading events…" : "Pick a conversion rate"}
        />
        <p className="mt-1.5 text-[11px] leading-snug text-ink/50">
          That event&rsquo;s count as a share of total users, or of sessions, over this same range and
          breakdown, computed as one total over another total (never an average of daily rates).
        </p>
      </div>

      <div>
        <label className={labelCls}>Break down by (up to {MAX_DIMENSIONS})</label>
        <div className="mb-2 flex flex-wrap gap-1.5">
          {QUICK_DIMS.map((q) => (
            <button
              key={q.dim}
              type="button"
              onClick={() => toggleDim(q.dim)}
              className={`focus-ring rounded-full border px-2.5 py-1 text-xs transition-all duration-150 active:scale-95 ${
                dims.includes(q.dim)
                  ? "border-brand-500 bg-brand-500/10 text-brand-700"
                  : "border-ink/15 text-ink/50 hover:border-ink/30 hover:text-ink/70"
              }`}
            >
              {q.label}
            </button>
          ))}
        </div>
        <MetaPicker
          items={metadata?.dimensions ?? []}
          selected={dims}
          onToggle={toggleDim}
          max={MAX_DIMENSIONS}
          placeholder="Any dimensions"
          allowNone
        />
        {dims.length > 1 && dims.includes("date") && config.rangeB.preset !== "none" && (
          <p className="mt-1.5 text-[11px] leading-snug text-ink/50">
            Day-aligned comparison overlays need Date as the only breakdown, with extra dimensions,
            previous-period values pair only where the other values match.
          </p>
        )}
      </div>

      <div>
        <label className={labelCls}>Filters</label>
        <div className="space-y-2">
          {filters.map((f, i) => (
            <div key={i} className="animate-rise-in space-y-1.5 rounded-xl border border-ink/10 bg-ink/[0.03] p-2.5">
              <MetaPicker
                items={metadata?.dimensions ?? []}
                selected={f.field ? [f.field] : []}
                onToggle={(d) => setFilter(i, { field: f.field === d ? "" : d })}
                max={1}
                placeholder="Filter dimension"
              />
              <div className="flex gap-1.5">
                <select
                  className={`w-32 shrink-0 ${smallFieldCls}`}
                  value={f.match}
                  onChange={(e) => setFilter(i, { match: e.target.value as FilterClause["match"] })}
                >
                  {FILTER_MATCHES.map((m) => (
                    <option key={m.value} value={m.value}>
                      {m.label}
                    </option>
                  ))}
                </select>
                <input
                  className={`min-w-0 flex-1 ${smallFieldCls}`}
                  placeholder="Value (e.g. purchase)…"
                  value={f.value}
                  list={f.field ? `values-${f.field}` : undefined}
                  onChange={(e) => setFilter(i, { value: e.target.value })}
                />
                {f.field && valueSuggestions[f.field] && (
                  <datalist id={`values-${f.field}`}>
                    {valueSuggestions[f.field].map((v) => (
                      <option key={v} value={v} />
                    ))}
                  </datalist>
                )}
              </div>
              <div className="flex items-center justify-between">
                <label className="flex cursor-pointer items-center gap-1.5 text-xs text-ink/50 transition-colors duration-150 hover:text-ink/70">
                  <input
                    type="checkbox"
                    checked={!!f.not}
                    onChange={(e) => setFilter(i, { not: e.target.checked })}
                    className="focus-ring h-3.5 w-3.5 cursor-pointer accent-brand-500"
                  />
                  Exclude matches
                </label>
                <button
                  type="button"
                  onClick={() => set({ filters: filters.filter((_, idx) => idx !== i) })}
                  aria-label="Remove filter"
                  className="focus-ring flex items-center gap-1 rounded-md px-1.5 py-1 text-xs text-ink/50 transition-colors duration-150 hover:text-red-600"
                >
                  <Trash2 size={13} />
                  Remove
                </button>
              </div>
            </div>
          ))}
          <button
            type="button"
            onClick={() =>
              set({ filters: [...filters, { field: "", match: "contains", value: "" }] })
            }
            className="focus-ring flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-ink/20 px-3 py-2 text-xs text-ink/50 transition-colors duration-150 hover:border-brand-500/50 hover:text-brand-700"
          >
            <Plus size={13} />
            Add filter
          </button>
        </div>
      </div>

      <div>
        <label className={labelCls}>Highlight periods</label>
        <div className="space-y-2">
          {colorPeriods.map((p, i) => (
            <div key={p.id} className="animate-rise-in space-y-1.5 rounded-xl border border-ink/10 bg-ink/[0.03] p-2.5">
              <div className="flex items-center gap-1.5">
                <input
                  className={`min-w-0 flex-1 ${smallFieldCls}`}
                  placeholder="Label (e.g. Campaign Launch)…"
                  value={p.label}
                  onChange={(e) => setColorPeriod(i, { label: e.target.value })}
                />
                <button
                  type="button"
                  onClick={() => set({ colorPeriods: colorPeriods.filter((_, idx) => idx !== i) })}
                  aria-label="Remove highlight period"
                  className="focus-ring flex items-center gap-1 rounded-md px-1.5 py-1 text-xs text-ink/50 transition-colors duration-150 hover:text-red-600"
                >
                  <Trash2 size={13} />
                </button>
              </div>
              <div className="flex items-center gap-1.5">
                <DatePicker
                  value={p.startDate}
                  max={p.endDate}
                  onSelect={(d) => setColorPeriod(i, { startDate: d })}
                />
                <ArrowRight size={12} className="shrink-0 text-ink/50" />
                <DatePicker
                  value={p.endDate}
                  min={p.startDate}
                  max={maxSelectableDate()}
                  onSelect={(d) => setColorPeriod(i, { endDate: d })}
                />
              </div>
              <div className="flex flex-wrap gap-1.5">
                {COLOR_PERIOD_PALETTE.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setColorPeriod(i, { color: c })}
                    aria-label={`Use color ${c}`}
                    aria-pressed={p.color === c}
                    className="focus-ring h-5 w-5 shrink-0 rounded-full transition-transform duration-150 active:scale-90"
                    style={{
                      background: c,
                      boxShadow: p.color === c ? "0 0 0 2px #ffffff, 0 0 0 3.5px #162a3d" : undefined,
                    }}
                  />
                ))}
              </div>
            </div>
          ))}
          <button
            type="button"
            onClick={addColorPeriod}
            className="focus-ring flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-ink/20 px-3 py-2 text-xs text-ink/50 transition-colors duration-150 hover:border-brand-500/50 hover:text-brand-700"
          >
            <Plus size={13} />
            Add highlight period
          </button>
        </div>
        <p className="mt-1.5 text-[11px] leading-snug text-ink/50">
          Shaded on every graph, and broken out as its own stat block in Analytics. Overlapping
          periods: the first one defined wins.
        </p>
      </div>

      <div>
        <label className={labelCls}>Funnels</label>
        <div className="space-y-2">
          {funnels.map((fn, i) => (
            <div key={fn.id} className="animate-rise-in space-y-1.5 rounded-xl border border-ink/10 bg-ink/[0.03] p-2.5">
              <div className="flex items-center gap-1.5">
                <input
                  className={`min-w-0 flex-1 ${smallFieldCls}`}
                  placeholder="Funnel name (e.g. Checkout)…"
                  value={fn.name}
                  onChange={(e) => setFunnel(i, { name: e.target.value })}
                />
                <button
                  type="button"
                  onClick={() => set({ funnels: funnels.filter((_, idx) => idx !== i) })}
                  aria-label="Remove funnel"
                  className="focus-ring flex items-center gap-1 rounded-md px-1.5 py-1 text-xs text-ink/50 transition-colors duration-150 hover:text-red-600"
                >
                  <Trash2 size={13} />
                </button>
              </div>
              <select
                className={`w-full ${smallFieldCls}`}
                value={fn.open ? "open" : "closed"}
                onChange={(e) => setFunnel(i, { open: e.target.value === "open" })}
              >
                <option value="closed">Closed — users must enter at step 1</option>
                <option value="open">Open — users can enter at any step</option>
              </select>
              <div className="space-y-1">
                {fn.steps.map((s, si) => {
                  const setStep = (patch: Partial<(typeof fn.steps)[number]>) =>
                    setFunnel(i, { steps: fn.steps.map((x, xi) => (xi === si ? { ...x, ...patch } : x)) });
                  return (
                  <div key={s.id} className="space-y-1">
                    <div className="flex items-center gap-1.5">
                      <span className="w-4 shrink-0 text-right text-[11px] tabular-nums text-ink/50">{si + 1}.</span>
                      <select
                        className={`min-w-0 flex-1 ${smallFieldCls}`}
                        value={s.eventName}
                        onChange={(e) =>
                          setStep({ eventName: e.target.value, label: s.label || humanizeEvent(e.target.value) })
                        }
                      >
                        <option value="">Pick an event…</option>
                        {(eventNames ?? []).map((n) => (
                          <option key={n} value={n}>
                            {humanizeEvent(n)}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        onClick={() => setFunnel(i, { steps: fn.steps.filter((_, xi) => xi !== si) })}
                        aria-label="Remove step"
                        className="focus-ring shrink-0 rounded-md px-1 py-1 text-xs text-ink/50 transition-colors duration-150 hover:text-red-600"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                    <div className="flex items-center gap-1.5 pl-[1.375rem]">
                      <select
                        className={`w-32 shrink-0 ${smallFieldCls}`}
                        value={s.pageMatch ?? ""}
                        onChange={(e) => {
                          const v = e.target.value as "" | NonNullable<typeof s.pageMatch>;
                          setStep(v === "" ? { pageMatch: undefined, pagePath: undefined } : { pageMatch: v });
                        }}
                      >
                        <option value="">Any page</option>
                        <option value="exact">Page is exactly</option>
                        <option value="contains">Page contains</option>
                        <option value="begins">Page begins with</option>
                      </select>
                      {s.pageMatch && (
                        <input
                          className={`min-w-0 flex-1 ${smallFieldCls}`}
                          placeholder={s.pageMatch === "exact" ? "/ (homepage)" : "/products/"}
                          value={s.pagePath ?? ""}
                          onChange={(e) => setStep({ pagePath: e.target.value })}
                        />
                      )}
                    </div>
                  </div>
                  );
                })}
                {fn.steps.length < 10 && (
                  <button
                    type="button"
                    onClick={() =>
                      setFunnel(i, { steps: [...fn.steps, { id: newId("fs"), label: "", eventName: "" }] })
                    }
                    className="focus-ring flex w-full items-center justify-center gap-1 rounded-lg border border-dashed border-ink/20 px-2 py-1.5 text-[11px] text-ink/50 transition-colors duration-150 hover:border-brand-500/50 hover:text-brand-700"
                  >
                    <Plus size={11} />
                    Add step
                  </button>
                )}
              </div>
            </div>
          ))}
          <button
            type="button"
            onClick={() =>
              set({
                funnels: [
                  ...funnels,
                  { id: newId("fn"), name: "", open: false, steps: [{ id: newId("fs"), label: "", eventName: "" }] },
                ],
              })
            }
            className="focus-ring flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-ink/20 px-3 py-2 text-xs text-ink/50 transition-colors duration-150 hover:border-brand-500/50 hover:text-brand-700"
          >
            <Plus size={13} />
            Add funnel
          </button>
        </div>
        <p className="mt-1.5 text-[11px] leading-snug text-ink/50">
          Computed by GA4&rsquo;s own funnel engine (same math as Explorations), each step is an event,
          in order. At least two steps needed.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={labelCls}>Default chart</label>
          <Select
            value={config.chartType}
            onChange={(e) => set({ chartType: e.target.value as Ga4ReportDoc["chartType"] })}
          >
            {CHART_TYPES.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <label className={labelCls}>Row limit</label>
          <Input
            type="number"
            min={1}
            max={1000}
            className="tabular-nums"
            value={config.limit}
            onChange={(e) => set({ limit: Math.max(1, Math.min(1000, Number(e.target.value) || 25)) })}
          />
        </div>
      </div>

      <div className="flex items-center gap-2 border-t border-ink/10 pt-4">
        <Button
          type="button"
          onClick={onSave}
          disabled={saving || !config.name.trim() || config.metrics.length === 0}
        >
          {saving ? "Saving…" : "Save preset"}
        </Button>
        {onDelete && (
          <Button type="button" variant="danger" onClick={onDelete}>
            Delete
          </Button>
        )}
        {showSaved && (
          <span className="animate-pop-in flex items-center gap-1 text-xs font-medium text-brand-700">
            <Check size={13} />
            Saved
          </span>
        )}
      </div>
    </aside>
  );
}
