// Ported from VC3/GA4-simply-layer's src/lib/types.ts. The Firestore-doc-shaped type
// (Ga4ReportDoc) lives in @/types alongside every other doc shape in this app — this
// module only owns the structural/logic types the ga4Reports feature needs internally.
//
// Deliberately dropped vs. the source (this is a brand-new collection with zero legacy
// saved reports, so there's no back-compat reason to carry any of it forward):
// - the legacy singular `dimension` field and `configDimensions()` normalizer
// - `PresetsFile`/`order` (Firestore's collection model replaces this wrapper directly)
// - the `"table"` chart type (present in the source's enum/dropdown but never rendered)

export type ChartType = "line" | "area" | "bar" | "hbar" | "pie" | "donut" | "scorecard";

export const CHART_TYPES: { value: ChartType; label: string }[] = [
  { value: "line", label: "Line" },
  { value: "area", label: "Area" },
  { value: "bar", label: "Bar" },
  { value: "hbar", label: "Horizontal Bar" },
  { value: "pie", label: "Pie" },
  { value: "donut", label: "Donut" },
  { value: "scorecard", label: "Scorecard" },
];

export type RangePreset =
  | "last7"
  | "last14"
  | "last28"
  | "last30"
  | "last90"
  | "thisMonth"
  | "lastMonth"
  | "since" // fixed start, end always rolls forward to yesterday
  | "custom";

export type ComparePreset =
  | "previousPeriod"
  | "samePeriodLastYear"
  | "fixedEnd" // fixed end, same length as the current period — grows backward as it does
  | "custom"
  | "none";

export interface DateRangeSel {
  preset: RangePreset;
  start?: string; // YYYY-MM-DD when preset === custom
  end?: string;
}

export interface CompareSel {
  preset: ComparePreset;
  start?: string;
  end?: string;
}

export type FilterMatch = "contains" | "exact" | "begins" | "ends" | "regex";

export const FILTER_MATCHES: { value: FilterMatch; label: string }[] = [
  { value: "contains", label: "contains" },
  { value: "exact", label: "is exactly" },
  { value: "begins", label: "begins with" },
  { value: "ends", label: "ends with" },
  { value: "regex", label: "matches regex" },
];

export interface FilterClause {
  field: string; // GA4 dimension apiName (eventName, audienceName, country, …)
  match: FilterMatch;
  value: string;
  not?: boolean;
}

// GA4 Data API hard limits per runReport request
export const MAX_METRICS = 10;
export const MAX_DIMENSIONS = 9;

// GA4 has no per-event "count" metric — event counts are eventCount (metric) filtered by
// eventName (dimension). A "virtual" metric like "event:purchase" carries that intent
// through the report config/ReportRequest/ReportResponse unchanged in shape; the server
// (server/ga4Reporting.js) is the only place that resolves it into the real query.
export const EVENT_METRIC_PREFIX = "event:";

export function isEventMetric(apiName: string): boolean {
  return apiName.startsWith(EVENT_METRIC_PREFIX);
}

export function eventMetricName(apiName: string): string {
  return apiName.slice(EVENT_METRIC_PREFIX.length);
}

export function makeEventMetric(eventName: string): string {
  return `${EVENT_METRIC_PREFIX}${eventName}`;
}

// Conversion rate for any event: eventCount for that event ÷ totalUsers (or ÷ sessions),
// computed row-by-row and — separately, NOT by averaging rows — as totals-over-totals.
// Same virtual-metric trick as event:*.
export const CONV_USER_PREFIX = "convu:";
export const CONV_SESSION_PREFIX = "convs:";
export type ConvDenom = "totalUsers" | "sessions";

export function isConvRateMetric(apiName: string): boolean {
  return apiName.startsWith(CONV_USER_PREFIX) || apiName.startsWith(CONV_SESSION_PREFIX);
}

export function convRateDenom(apiName: string): ConvDenom {
  return apiName.startsWith(CONV_USER_PREFIX) ? "totalUsers" : "sessions";
}

export function convRateEventName(apiName: string): string {
  return apiName.slice(apiName.indexOf(":") + 1);
}

export function makeConvRateMetric(eventName: string, denom: ConvDenom): string {
  return `${denom === "totalUsers" ? CONV_USER_PREFIX : CONV_SESSION_PREFIX}${eventName}`;
}

// Events where MORE is BAD — an increase should read red, a decrease green. Explicit
// names plus generic bad-signal patterns so future events (refund_requested,
// checkout_error…) invert automatically. Deliberately neutral: cart_drawer_close (closing
// a drawer is normal browsing) and cart_empty_cta_click (a recovery click).
const NEGATIVE_EVENT_PATTERN = /(remove|refund|return_request|error|fail|cancel|declin|exception|not_found|abandon)/;

export function isNegativeEventName(eventName: string): boolean {
  return NEGATIVE_EVENT_PATTERN.test(eventName);
}

/** True when a metric's delta colors should invert (up = red, down = green) because the
 *  underlying event is a bad signal. Applies to the event count and its conversion-rate variants. */
export function metricIsInverted(apiName: string): boolean {
  if (isEventMetric(apiName)) return isNegativeEventName(eventMetricName(apiName));
  if (isConvRateMetric(apiName)) return isNegativeEventName(convRateEventName(apiName));
  return false;
}

/** Metric type for conversion-rate columns — always renders as a percent, even above 100%
 *  (repeat purchases per user are real), unlike TYPE_FLOAT's "only if between 0 and 1" heuristic. */
export const TYPE_RATE_PERCENT = "TYPE_RATE_PERCENT";

/** Named date-range highlight ("Campaign Launch", "Holiday Season") a user can define on
 *  a report — shaded on the chart, broken out as its own stat block in Analytics.
 *  First-matching period wins if ranges overlap. */
export interface ColorPeriod {
  id: string;
  label: string;
  startDate: string; // YYYY-MM-DD
  endDate: string;
  color: string; // hex
}

// Preset palette for color periods — an arbitrary categorical set distinct from the
// brand/chart-series colors, so period highlights never clash with the rest of the UI.
export const COLOR_PERIOD_PALETTE = [
  "#3987e5",
  "#e6a23c",
  "#e66767",
  "#9085e9",
  "#19c2c2",
  "#d55181",
  "#d95926",
  "#c9d94a",
  "#5ea8ff",
  "#199e70",
];

// ---- funnels (GA4 native funnel reports) ----

export type FunnelPageMatch = "exact" | "contains" | "begins";

export interface FunnelStep {
  id: string;
  label: string; // display name for the step ("Added to cart")
  eventName: string; // GA4 event that defines the step ("add_to_cart")
  // optional page condition ANDed with the event: exact "/" for the homepage, contains "/products/", etc.
  pageMatch?: FunnelPageMatch;
  pagePath?: string;
}

/** One funnel definition — executed by GA4's own funnel engine (runGa4FunnelReport), not
 *  recomputed client-side from event counts. `open` maps to GA4's isOpenFunnel: open
 *  funnels let users enter at any step; closed funnels only count users who entered at step 1. */
export interface FunnelConfig {
  id: string;
  name: string;
  open: boolean;
  steps: FunnelStep[]; // 2-10 steps, GA4's own limit
}

export interface FunnelStepResult {
  label: string;
  users: number;
  rateFromFirst: number | null; // share of step-1 users who reached this step
  rateFromPrevious: number | null; // share of previous-step users who continued
}

export interface FunnelResponse {
  steps: FunnelStepResult[];
}

// ---- customizable report layout ----

// "graph" is a single chart block and "highlights" is a period x metric matrix table —
// neither has an atomic per-row unit to drag, so both stay whole-section-only draggable.
// "numbers", "compare", and "insights" are entry containers: any card can move freely
// between any of the three.
export const SECTION_IDS = ["graph", "numbers", "insights", "funnels", "highlights", "compare"] as const;
export type SectionId = (typeof SECTION_IDS)[number];

export const SECTION_TITLES: Record<SectionId, string> = {
  graph: "Graph view",
  numbers: "Numbers view",
  insights: "Insights",
  funnels: "Funnels",
  highlights: "Highlight periods",
  compare: "Compare metrics",
};

export const ENTRY_SECTIONS = ["numbers", "compare", "insights"] as const;
export type EntrySectionId = (typeof ENTRY_SECTIONS)[number];

export type EntryKind = "kpi" | "compare" | "insight";

export interface EntryRef {
  kind: EntryKind; // "kpi"/"compare" -> id is a metric apiName; "insight" -> id is an insight id
  id: string;
}

export function entryKey(e: EntryRef): string {
  return `${e.kind}:${e.id}`;
}

/** Default home section for an entry kind — where strays/new entries land. */
export function homeSection(kind: EntryKind): EntrySectionId {
  return kind === "kpi" ? "numbers" : kind === "compare" ? "compare" : "insights";
}

/** The page is an ordered list of blocks. A "section" block is one of the 6 named
 *  sections (entry sections carry their card list inline); a "float" block is a
 *  free-standing card group living between sections — created by dropping a card into
 *  the gap between two blocks, removed automatically when its last card leaves. This is
 *  what lets a card sit ABOVE the graph while the Numbers section itself stays put. */
export type LayoutBlock =
  | { kind: "section"; id: SectionId; entries?: EntryRef[] } // entries only for numbers/compare/insights
  | { kind: "float"; id: string; entries: EntryRef[] };

export function blockKey(b: LayoutBlock): string {
  return `${b.kind}:${b.id}`;
}

export interface ReportLayout {
  blocks: LayoutBlock[];
}

export function defaultLayout(metrics: string[]): ReportLayout {
  return {
    blocks: SECTION_IDS.map((id) => {
      if (id === "numbers") return { kind: "section", id, entries: metrics.map((m) => ({ kind: "kpi" as const, id: m })) };
      if (id === "compare")
        return {
          kind: "section",
          id,
          entries: metrics.length >= 2 ? metrics.map((m) => ({ kind: "compare" as const, id: m })) : [],
        };
      if (id === "insights") return { kind: "section", id, entries: [] };
      return { kind: "section", id };
    }),
  };
}

/** Self-heals a layout against the report's current metric list and live insight ids —
 *  drops entries that no longer resolve to anything (a metric got removed, or an insight
 *  no longer clears its significance bar for the current date range), dedupes an entry
 *  that ended up in two places at once, appends newly-introduced entries to their default
 *  home section, removes float blocks that emptied out, and re-adds any missing sections.
 *  Safe to call on every render; only a real drag actually persists a layout. */
export function reconcileLayout(layout: ReportLayout | undefined, metrics: string[], insightIds: string[]): ReportLayout {
  const rawBlocks: LayoutBlock[] = Array.isArray(layout?.blocks) ? layout.blocks : defaultLayout(metrics).blocks;
  const metricSet = new Set(metrics);
  const insightSet = new Set(insightIds);
  const isValid = (e: EntryRef) => (e.kind === "insight" ? insightSet.has(e.id) : metricSet.has(e.id));

  const seenEntries = new Set<string>();
  const keep = (list: EntryRef[] | undefined) =>
    (list ?? []).filter((e) => {
      if (!e || !isValid(e)) return false;
      const key = entryKey(e);
      if (seenEntries.has(key)) return false;
      seenEntries.add(key);
      return true;
    });

  const seenSections = new Set<SectionId>();
  const blocks: LayoutBlock[] = [];
  for (const b of rawBlocks) {
    if (b?.kind === "section" && (SECTION_IDS as readonly string[]).includes(b.id)) {
      if (seenSections.has(b.id)) continue;
      seenSections.add(b.id);
      if (b.id === "numbers" || b.id === "compare" || b.id === "insights") {
        blocks.push({ kind: "section", id: b.id, entries: keep(b.entries) });
      } else {
        blocks.push({ kind: "section", id: b.id });
      }
    } else if (b?.kind === "float" && typeof b.id === "string") {
      blocks.push({ kind: "float", id: b.id, entries: keep(b.entries) });
    }
  }
  for (const s of SECTION_IDS) {
    if (!seenSections.has(s)) {
      if (s === "numbers" || s === "compare" || s === "insights") blocks.push({ kind: "section", id: s, entries: [] });
      else blocks.push({ kind: "section", id: s });
    }
  }

  // append never-seen entries to their home sections
  const wanted: EntryRef[] = [
    ...metrics.map((m) => ({ kind: "kpi" as const, id: m })),
    ...(metrics.length >= 2 ? metrics.map((m) => ({ kind: "compare" as const, id: m })) : []),
    ...insightIds.map((id) => ({ kind: "insight" as const, id })),
  ];
  for (const e of wanted) {
    const key = entryKey(e);
    if (seenEntries.has(key)) continue;
    seenEntries.add(key);
    const home = blocks.find((b) => b.kind === "section" && b.id === homeSection(e.kind));
    if (home?.entries) home.entries.push(e);
  }

  return { blocks: blocks.filter((b) => b.kind !== "float" || b.entries.length > 0) };
}

/** Fresh float-block id, unique against the ids already in the layout. */
export function nextFloatId(blocks: LayoutBlock[]): string {
  let max = 0;
  for (const b of blocks) {
    if (b.kind !== "float") continue;
    const n = Number(b.id.replace(/^float-/, ""));
    if (Number.isFinite(n) && n > max) max = n;
  }
  return `float-${max + 1}`;
}

// ---- report API payloads ----

export interface ResolvedRange {
  startDate: string;
  endDate: string;
}

export interface ReportRequest {
  property: string;
  dimensions: string[];
  metrics: string[];
  rangeA: ResolvedRange;
  rangeB?: ResolvedRange | null;
  filters?: FilterClause[];
  limit?: number;
}

export interface ReportRow {
  dim: string;
  bDim?: string; // for date-dimension comparisons: the matching date in range B
  a: number[]; // metric values for range A, aligned with metrics[]
  b?: number[]; // metric values for range B
}

export interface ReportResponse {
  metrics: string[];
  metricHeaders: { name: string; type: string }[];
  dimension: string; // first dimension ("" = totals only) — kept for existing consumers
  dimensions: string[]; // all requested dimensions in order
  rows: ReportRow[];
  totalsA: number[];
  totalsB?: number[];
  rangeA: ResolvedRange;
  rangeB?: ResolvedRange | null;
  rowCount: number;
  currencyCode?: string; // property's real currency (e.g. "EGP"), for TYPE_CURRENCY formatting
}

export interface PropertySummary {
  property: string;
  displayName: string;
  account: string;
  accountName: string;
}

export interface MetaItem {
  apiName: string;
  uiName: string;
  category: string;
  description?: string;
}

export interface MetadataResponse {
  dimensions: MetaItem[];
  metrics: MetaItem[];
}
