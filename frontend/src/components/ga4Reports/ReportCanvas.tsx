import {
  closestCenter,
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useDroppable,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { ArrowLeft, ChevronRight, Lightbulb, Pencil, Plus } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { HighlightPeriodsSection } from "./AnalyticsView";
import type { GraphViewMode } from "./ChartView";
import DateControls from "./DateControls";
import EntryCard from "./EntryCard";
import FunnelView from "./FunnelView";
import MetricCarousel from "./MetricCarousel";
import NumbersView from "./NumbersView";
import ReportEditor from "./ReportEditor";
import SortableMetricCard from "./SortableMetricCard";
import SortableSection from "./SortableSection";
import { useGa4ReportData } from "@/hooks/useGa4ReportData";
import { getGa4ReportsMetadata, listGa4Properties } from "@/lib/ga4Reports/api";
import { buildInsights } from "@/lib/ga4Reports/buildInsights";
import { deleteGa4Report, saveGa4Report, updateGa4ReportLayout } from "@/lib/ga4Reports/storage";
import { Button, ConfirmDialog } from "@/components/ui";
import {
  blockKey,
  CHART_TYPES,
  entryKey,
  nextFloatId,
  reconcileLayout,
  SECTION_TITLES,
  type ChartType,
  type EntryRef,
  type LayoutBlock,
  type MetadataResponse,
  type ReportLayout,
  type ReportResponse,
  type SectionId,
} from "@/lib/ga4Reports/types";
import type { GA4Property, Ga4ReportDoc } from "@/types";

// Ported from VC3/GA4-simply-layer's src/components/ReportCanvas.tsx, re-skinned to
// this app's light theme. Adaptations: next/link + next/navigation replaced with
// react-router-dom; useReport(config) replaced with useGa4ReportData(clientId, config);
// persist/save/del go through Firestore client-SDK calls (lib/ga4Reports/storage.ts)
// instead of POST/DELETE to a Next.js API route; properties/metadata fetches go through
// lib/ga4Reports/api.ts. Layout drag-autosave (updateLayout) is guarded to skip while
// isNew, so dragging a card on a brand-new unsaved report doesn't litter Firestore with
// an abandoned bare-layout doc (the source's own documented rough edge — fixed here
// since it's a one-line guard, not carried forward).
interface Props {
  clientId: string;
  initial: Ga4ReportDoc;
  startEditing?: boolean; // client-share mode: never show edit affordances
  lockView?: boolean; // client-share mode: never show edit affordances
  isNew?: boolean; // builder flow: no delete button, no layout-drag autosave until first Save
  backHref: string; // route path the back button/post-delete redirect leads to
}

const ZONE_PREFIX = "zone:";
const GAP_PREFIX = "gap:";
const GRAPH_ANCHOR_ID = "graph-view-anchor";

/** Section header that folds its content — count badge keeps the collapsed state
 *  informative ("Insights · 14") so clients know something's inside. */
function CollapsibleHeader({
  id,
  icon,
  title,
  count,
  collapsed,
  onToggle,
}: {
  id: SectionId;
  icon?: ReactNode;
  title: string;
  count: number;
  collapsed: boolean;
  onToggle: (id: SectionId) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onToggle(id)}
      aria-expanded={!collapsed}
      className={`focus-ring flex items-center gap-1.5 pr-8 text-[11px] font-semibold uppercase tracking-[0.14em] text-ink/50 transition-colors duration-150 hover:text-ink ${
        collapsed ? "" : "mb-2"
      }`}
    >
      <ChevronRight
        size={11}
        className="shrink-0 transition-transform duration-150"
        style={{ transform: collapsed ? "rotate(0deg)" : "rotate(90deg)" }}
      />
      {icon}
      {title}
      {count > 0 && <span className="font-normal normal-case tracking-normal text-ink/50">· {count}</span>}
    </button>
  );
}

/** Makes an otherwise-empty area of a card container a valid drop target, and tints it
 *  green while a card hovers over it. */
function DroppableZone({ id, children }: { id: string; children: ReactNode }) {
  const { setNodeRef, isOver, active } = useDroppable({ id, data: { type: "zone" } });
  const hot = isOver && active?.data.current?.type === "card";
  return (
    <div ref={setNodeRef} className={`rounded-xl ${hot ? "bg-brand-500/10 ring-1 ring-brand-500/40" : ""}`}>
      {children}
    </div>
  );
}

/** The slot between two top-level blocks. Only rendered while a card drag is in
 *  progress — dropping here pulls the card out of its container into a new
 *  free-floating group at this exact spot (e.g. above the graph). */
function GapZone({ index }: { index: number }) {
  const { setNodeRef, isOver, active } = useDroppable({ id: `${GAP_PREFIX}${index}`, data: { type: "gap" } });
  const hot = isOver && active?.data.current?.type === "card";
  return (
    <div
      ref={setNodeRef}
      className={`rounded-lg border border-dashed transition-all duration-100 ${
        hot ? "h-14 border-brand-500 bg-brand-500/15" : "h-7 border-brand-500/25 bg-brand-500/[0.03]"
      }`}
      aria-label="Drop here to place the card between sections"
    />
  );
}

/** closestCenter alone is unreliable when huge section blocks and small metric cards
 *  share one DndContext — a corner grip handle on a tall section can be closer (by
 *  center distance) to an unrelated card than to any other section, silently resolving
 *  `over` to the wrong kind of thing. Filter candidates to the active item's own kind
 *  before running it. */
const collisionDetection: CollisionDetection = (args) => {
  const activeType = args.active.data.current?.type;
  const relevant = args.droppableContainers.filter((c) => {
    const t = c.data.current?.type;
    return activeType === "section" ? t === "section" : t === "card" || t === "zone" || t === "gap";
  });
  return closestCenter({ ...args, droppableContainers: relevant });
};

function swap<T>(arr: T[], i: number, j: number): T[] {
  const copy = [...arr];
  [copy[i], copy[j]] = [copy[j], copy[i]];
  return copy;
}

/** Which metric a card corresponds to, for click-to-jump — metric cards map directly;
 *  insight sentences map through their id prefix ("delta:sessions" → "sessions"); the
 *  cross-metric "fastest-mover" insight maps to nothing. */
function entryMetric(entry: EntryRef): string | null {
  if (entry.kind !== "insight") return entry.id;
  const i = entry.id.indexOf(":");
  return i === -1 ? null : entry.id.slice(i + 1);
}

type ActiveDrag = { kind: "section"; key: string; title: string } | { kind: "card"; entry: EntryRef };

export default function ReportCanvas({
  clientId,
  initial,
  startEditing = false,
  lockView = false,
  isNew = false,
  backHref,
}: Props) {
  const navigate = useNavigate();
  const [config, setConfig] = useState<Ga4ReportDoc>(initial);
  const [editing, setEditing] = useState(startEditing && !lockView);
  const [chartType, setChartType] = useState<ChartType>(initial.chartType);
  // keep the quick chart-type toggle in sync when the editor panel's own chart-type
  // dropdown changes config.chartType directly — adjusted during render (React's
  // documented pattern) instead of an effect, since an effect here would setState
  // synchronously and cascade an extra render.
  const [syncedChartType, setSyncedChartType] = useState(config.chartType);
  if (config.chartType !== syncedChartType) {
    setSyncedChartType(config.chartType);
    setChartType(config.chartType);
  }
  // Insights and Compare metrics start folded — they're the densest blocks, and a
  // client scanning the report opens them when they want the detail.
  const [collapsed, setCollapsed] = useState<Partial<Record<SectionId, boolean>>>({
    insights: true,
    compare: true,
  });
  const toggleCollapsed = (id: SectionId) => setCollapsed((c) => ({ ...c, [id]: !c[id] }));
  // "overlay": x-axis is the current period, previous drawn on top aligned. "timeline":
  // one chronological axis from previous-period start through current-period end,
  // dashed phase flowing into solid.
  const [graphView, setGraphView] = useState<GraphViewMode>("overlay");
  const [properties, setProperties] = useState<GA4Property[]>([]);
  const [metadata, setMetadata] = useState<MetadataResponse | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [activeDrag, setActiveDrag] = useState<ActiveDrag | null>(null);
  const [graphIndex, setGraphIndex] = useState(0);
  const [confirmDelete, setConfirmDelete] = useState(false);
  // a click event fires on the card right after a drop lands on it — this flag eats
  // that one so releasing a drag never also jumps the graph
  const suppressClick = useRef(false);
  // Numbers view still shows every selected metric side by side (unrelated to how the
  // graph section visualizes them), so it keeps the one full-config fetch.
  const { data, error, isLoading: loading } = useGa4ReportData(clientId, config);
  const hasMetrics = config.metrics.length > 0;
  const insights = data ? buildInsights(data, metadata?.metrics, config.colorPeriods) : [];
  const insightsById = new Map(insights.map((i) => [i.id, i]));
  const layout = reconcileLayout(
    config.layout,
    config.metrics,
    insights.map((i) => i.id)
  );
  const draggable = !lockView;

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  useEffect(() => {
    listGa4Properties()
      .then(setProperties)
      .catch(() => {});
  }, []);
  useEffect(() => {
    if (!config.property) return;
    getGa4ReportsMetadata(config.property)
      .then(setMetadata)
      .catch(() => {});
  }, [config.property]);

  const persist = async (next: Ga4ReportDoc) => {
    setSaving(true);
    try {
      await saveGa4Report(clientId, next, isNew);
      setSavedAt(Date.now());
    } finally {
      setSaving(false);
    }
  };

  const save = () => persist({ ...config, chartType });

  // Layout changes (drag) persist immediately — rearranging is a viewing preference,
  // not a report-definition edit, so it shouldn't require opening the editor panel and
  // clicking Save first. Skipped while isNew: a report that's never been explicitly
  // saved once shouldn't get written to Firestore just from a drag.
  const updateLayout = (next: ReportLayout) => {
    const nextConfig = { ...config, layout: next };
    setConfig(nextConfig);
    if (!isNew) {
      updateGa4ReportLayout(clientId, config.id, next)
        .then(() => setSavedAt(Date.now()))
        .catch(() => {});
    }
  };

  const del = () => setConfirmDelete(true);

  const doDelete = async () => {
    await deleteGa4Report(clientId, config.id);
    navigate(backHref);
  };

  const jumpToMetric = (entry: EntryRef) => {
    if (suppressClick.current) return;
    const metric = entryMetric(entry);
    if (!metric) return;
    const i = config.metrics.indexOf(metric);
    if (i === -1) return;
    setGraphIndex(i);
    document.getElementById(GRAPH_ANCHOR_ID)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  function onDragStart(event: DragStartEvent) {
    const t = event.active.data.current?.type;
    if (t === "section") {
      const key = String(event.active.id);
      const block = layout.blocks.find((b) => blockKey(b) === key);
      const title = block?.kind === "section" ? SECTION_TITLES[block.id] : "Card group";
      setActiveDrag({ kind: "section", key, title });
    } else if (t === "card") {
      setActiveDrag({ kind: "card", entry: event.active.data.current!.entry as EntryRef });
    }
  }

  function onDragEnd(event: DragEndEvent) {
    setActiveDrag(null);
    suppressClick.current = true;
    setTimeout(() => (suppressClick.current = false), 0);
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const activeType = active.data.current?.type;

    // Block reorder: dropping onto another block's slot swaps the two — no shifting
    // of the blocks in between.
    if (activeType === "section") {
      const keys = layout.blocks.map(blockKey);
      const oldIndex = keys.indexOf(String(active.id));
      const newIndex = keys.indexOf(String(over.id));
      if (oldIndex === -1 || newIndex === -1) return;
      updateLayout({ blocks: swap(layout.blocks, oldIndex, newIndex) });
      return;
    }

    if (activeType !== "card") return;
    const fromEntry = active.data.current?.entry as EntryRef | undefined;
    const fromContainer = active.data.current?.container as string | undefined;
    if (!fromEntry || !fromContainer) return;

    // deep-ish copy so block entry arrays can be mutated safely
    const blocks: LayoutBlock[] = layout.blocks.map((b) => (b.entries ? { ...b, entries: [...b.entries] } : { ...b }));
    const srcBlock = blocks.find((b) => blockKey(b) === fromContainer);
    if (!srcBlock?.entries) return;
    const srcIndex = srcBlock.entries.findIndex((e) => entryKey(e) === entryKey(fromEntry));
    if (srcIndex === -1) return;

    const finish = () => {
      updateLayout({ blocks: blocks.filter((b) => b.kind !== "float" || b.entries.length > 0) });
    };

    const overId = String(over.id);
    const overData = over.data.current;

    // dropped into the gap between two blocks → new floating group there
    if (overData?.type === "gap") {
      const gapIndex = Number(overId.slice(GAP_PREFIX.length));
      if (!Number.isFinite(gapIndex)) return;
      srcBlock.entries.splice(srcIndex, 1);
      blocks.splice(Math.max(0, Math.min(blocks.length, gapIndex)), 0, {
        kind: "float",
        id: nextFloatId(blocks),
        entries: [fromEntry],
      });
      finish();
      return;
    }

    // dropped on a container's empty area → append to that container
    if (overData?.type === "zone") {
      const destKey = overId.slice(ZONE_PREFIX.length);
      const destBlock = blocks.find((b) => blockKey(b) === destKey);
      if (!destBlock?.entries) return;
      if (destBlock === srcBlock) {
        srcBlock.entries.splice(srcIndex, 1);
        srcBlock.entries.push(fromEntry);
      } else {
        srcBlock.entries.splice(srcIndex, 1);
        if (!destBlock.entries.some((e) => entryKey(e) === entryKey(fromEntry))) destBlock.entries.push(fromEntry);
      }
      finish();
      return;
    }

    // dropped on another card → the two trade places (swap), regardless of whether
    // they're in the same container or different ones
    if (overData?.type === "card") {
      const overEntry = overData.entry as EntryRef;
      const overContainer = overData.container as string;
      const destBlock = blocks.find((b) => blockKey(b) === overContainer);
      if (!destBlock?.entries) return;
      const destIndex = destBlock.entries.findIndex((e) => entryKey(e) === entryKey(overEntry));
      if (destIndex === -1) return;
      if (destBlock === srcBlock && destIndex === srcIndex) return;
      srcBlock.entries[srcIndex] = overEntry;
      destBlock.entries[destIndex] = fromEntry;
      finish();
    }
  }

  /** Any block's card list — entry sections and floating groups render through the
   *  same path: the container supplies the grid, each entry supplies its own content shape. */
  function renderEntries(reportData: ReportResponse, block: LayoutBlock, shape: "tile" | "row", containerClass: string) {
    const items = block.entries ?? [];
    const container = blockKey(block);
    return (
      <DroppableZone id={ZONE_PREFIX + container}>
        <SortableContext items={items.map(entryKey)} strategy={verticalListSortingStrategy}>
          <div className={containerClass}>
            {items.map((entry) => (
              <SortableMetricCard
                key={entryKey(entry)}
                id={entryKey(entry)}
                data={{ type: "card", container, entry }}
                draggable={draggable}
                onClick={() => jumpToMetric(entry)}
              >
                <EntryCard
                  entry={entry}
                  data={reportData}
                  metricsMeta={metadata?.metrics}
                  insightsById={insightsById}
                  shape={entry.kind === "insight" ? "row" : shape}
                />
              </SortableMetricCard>
            ))}
          </div>
        </SortableContext>
      </DroppableZone>
    );
  }

  function renderSectionContent(block: LayoutBlock): ReactNode {
    if (block.kind === "float") {
      return data ? (
        renderEntries(data, block, "tile", "grid grid-cols-2 md:grid-cols-4 gap-3")
      ) : (
        <div className="h-24" />
      );
    }
    switch (block.id) {
      case "graph":
        return (
          <div id={GRAPH_ANCHOR_ID} className="scroll-mt-20">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2 pr-8">
              <h2 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink/50">Graph view</h2>
              <div className="flex max-w-full flex-wrap items-center gap-2 overflow-x-auto">
                {config.rangeB.preset !== "none" && (chartType === "line" || chartType === "area" || chartType === "bar") && (
                  <div className="flex w-max overflow-hidden rounded-lg border border-ink/15">
                    {(
                      [
                        { value: "overlay", label: "Overlay" },
                        { value: "timeline", label: "Timeline" },
                      ] as { value: GraphViewMode; label: string }[]
                    ).map((v) => (
                      <button
                        key={v.value}
                        type="button"
                        onClick={() => setGraphView(v.value)}
                        aria-pressed={graphView === v.value}
                        title={
                          v.value === "overlay"
                            ? "Current period on the x-axis, previous period drawn on top"
                            : "One continuous axis from the previous period into the current one"
                        }
                        className={`focus-ring whitespace-nowrap px-2.5 py-1.5 text-xs transition-colors duration-150 ${
                          graphView === v.value
                            ? "bg-brand-500 text-ink-deep"
                            : "text-ink/50 hover:bg-ink/5 hover:text-ink/70"
                        }`}
                      >
                        {v.label}
                      </button>
                    ))}
                  </div>
                )}
                <div className="flex w-max overflow-hidden rounded-lg border border-ink/15">
                  {CHART_TYPES.filter((c) => c.value !== "scorecard").map((c) => (
                    <button
                      key={c.value}
                      type="button"
                      onClick={() => setChartType(c.value)}
                      aria-pressed={chartType === c.value}
                      className={`focus-ring whitespace-nowrap px-2.5 py-1.5 text-xs transition-colors duration-150 ${
                        chartType === c.value
                          ? "bg-brand-500 text-ink-deep"
                          : "text-ink/50 hover:bg-ink/5 hover:text-ink/70"
                      }`}
                    >
                      {c.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <MetricCarousel
              clientId={clientId}
              report={config}
              metrics={config.metrics}
              chartType={chartType}
              viewMode={graphView}
              defaultDims={config.dimensions}
              colorPeriods={config.colorPeriods}
              metadata={metadata}
              metricsMeta={metadata?.metrics}
              activeIndex={graphIndex}
              onActiveIndexChange={setGraphIndex}
            />
          </div>
        );
      case "numbers":
        return (
          <>
            <h2 className="mb-3 pr-8 text-[11px] font-semibold uppercase tracking-[0.14em] text-ink/50">
              Numbers view
            </h2>
            {error ? (
              <div className="flex h-24 items-center justify-center text-sm text-red-600">
                {error instanceof Error ? error.message : "Failed to load"}
              </div>
            ) : data ? (
              <>
                {(block.entries?.length ?? 0) === 0 ? (
                  <DroppableZone id={ZONE_PREFIX + blockKey(block)}>
                    <p className="rounded-xl px-1 py-3 text-xs text-ink/50">Drag cards here.</p>
                  </DroppableZone>
                ) : (
                  renderEntries(data, block, "tile", "grid grid-cols-2 md:grid-cols-4 gap-3")
                )}
                <div className="mt-4">
                  <NumbersView data={data} metricsMeta={metadata?.metrics} colorPeriods={config.colorPeriods} />
                </div>
              </>
            ) : (
              <div className="h-24" />
            )}
            {loading && data && <p className="mt-2 text-center text-xs text-ink/50">Refreshing…</p>}
          </>
        );
      case "insights":
        return (
          <>
            <CollapsibleHeader
              id="insights"
              icon={<Lightbulb size={13} />}
              title="Insights"
              count={block.entries?.length ?? 0}
              collapsed={!!collapsed.insights}
              onToggle={toggleCollapsed}
            />
            {!collapsed.insights &&
              (data ? (
                (block.entries?.length ?? 0) === 0 ? (
                  <DroppableZone id={ZONE_PREFIX + blockKey(block)}>
                    <p className="rounded-xl px-1 py-3 text-xs text-ink/50">
                      Nothing here — auto-written observations appear once you add a comparison period or a highlight
                      period, or drag a card in from another section.
                    </p>
                  </DroppableZone>
                ) : (
                  renderEntries(data, block, "row", "space-y-1.5")
                )
              ) : (
                <div className="h-24" />
              ))}
          </>
        );
      case "funnels":
        return (
          <>
            <h2 className="mb-3 pr-8 text-[11px] font-semibold uppercase tracking-[0.14em] text-ink/50">
              Funnels
            </h2>
            {(config.funnels?.length ?? 0) === 0 ? (
              <p className="text-xs text-ink/50">
                No funnels yet — define event steps in the editor and GA4&rsquo;s own funnel engine computes
                who made it through each one.
              </p>
            ) : (
              <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
                {config.funnels!.map((fn) => (
                  <FunnelView
                    key={fn.id}
                    clientId={clientId}
                    reportId={config.id}
                    funnel={fn}
                    rangeA={config.rangeA}
                    rangeB={config.rangeB}
                  />
                ))}
              </div>
            )}
          </>
        );
      case "highlights":
        return data ? (
          <HighlightPeriodsSection data={data} metricsMeta={metadata?.metrics} colorPeriods={config.colorPeriods} />
        ) : (
          <div className="h-24" />
        );
      case "compare":
        return (
          <>
            <CollapsibleHeader
              id="compare"
              title="Compare metrics"
              count={block.entries?.length ?? 0}
              collapsed={!!collapsed.compare}
              onToggle={toggleCollapsed}
            />
            {!collapsed.compare &&
              (data ? (
                (block.entries?.length ?? 0) === 0 ? (
                  <DroppableZone id={ZONE_PREFIX + blockKey(block)}>
                    <p className="rounded-xl px-1 py-3 text-xs text-ink/50">
                      Drag a card here from another section to compare it.
                    </p>
                  </DroppableZone>
                ) : (
                  renderEntries(data, block, "row", "grid grid-cols-1 gap-2 sm:grid-cols-2")
                )
              ) : (
                <div className="h-24" />
              ))}
          </>
        );
    }
  }

  const sectionBg = (block: LayoutBlock): string => {
    if (block.kind === "float") return "bg-ink/[0.02]";
    return block.id === "numbers" ? "bg-ink/[0.02]" : "bg-white";
  };

  const showGaps = draggable && activeDrag?.kind === "card";

  return (
    <div className="animate-fade-in space-y-4">
      {/* header row */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          {!lockView && (
            <Link
              to={backHref}
              aria-label="Back to dashboard"
              className="focus-ring flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-ink/15 text-ink/70 transition-all duration-150 hover:border-brand-500/50 hover:text-brand-700 active:scale-95"
            >
              <ArrowLeft size={16} />
            </Link>
          )}
          <div className="min-w-0">
            <h1 className="truncate text-xl font-semibold text-ink">{config.name}</h1>
            {config.description && <p className="truncate text-sm text-ink/50">{config.description}</p>}
          </div>
        </div>
        {!lockView && (
          <button
            type="button"
            onClick={() => setEditing((v) => !v)}
            className={`focus-ring flex items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-medium transition-all duration-150 active:scale-[0.98] ${
              editing
                ? "bg-brand-500 text-ink-deep hover:bg-brand-600"
                : "border border-ink/15 text-ink/70 hover:border-ink/30"
            }`}
          >
            <Pencil size={14} />
            {editing ? "Done, view mode" : "Edit report"}
          </button>
        )}
      </div>

      {/* date controls always live, even in view mode */}
      <div className="rounded-2xl border border-ink/10 bg-white px-4 py-3">
        <DateControls
          rangeA={config.rangeA}
          rangeB={config.rangeB}
          onChange={(rangeA, rangeB) => setConfig((c) => ({ ...c, rangeA, rangeB }))}
        />
      </div>

      <div className="flex flex-col gap-4 lg:flex-row">
        {editing && (
          <ReportEditor
            clientId={clientId}
            config={config}
            onChange={setConfig}
            properties={properties}
            metadata={metadata}
            onSave={save}
            onDelete={isNew ? undefined : del}
            saving={saving}
            savedAt={savedAt}
          />
        )}

        <ConfirmDialog
          open={confirmDelete}
          onClose={() => setConfirmDelete(false)}
          onConfirm={doDelete}
          title="Delete report?"
          message={`Delete report "${config.name}"? This can't be undone.`}
          confirmLabel="Delete"
          danger
        />

        <div className="min-w-0 flex-1 space-y-4">
          {!hasMetrics ? (
            /* blank slate: the report is an empty canvas waiting for its first metric */
            <section className="animate-rise-in flex min-h-[320px] flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-ink/20 bg-white/60 p-10 text-center">
              <span className="flex h-12 w-12 items-center justify-center rounded-2xl border border-brand-500/30 bg-brand-500/10 text-brand-700">
                <Plus size={20} />
              </span>
              <p className="text-base font-medium text-ink">Start with a metric</p>
              <p className="max-w-sm text-sm text-ink/50">
                Pick one or more metrics{editing ? " in the panel" : " in the editor"}, then break them down by
                any dimension, event, or audience, and filter to exactly what you need.
              </p>
              {!editing && !lockView && (
                <Button type="button" className="mt-1" onClick={() => setEditing(true)}>
                  Open editor
                </Button>
              )}
            </section>
          ) : (
            <DndContext
              sensors={sensors}
              collisionDetection={collisionDetection}
              onDragStart={onDragStart}
              onDragEnd={onDragEnd}
              onDragCancel={() => setActiveDrag(null)}
            >
              <SortableContext items={layout.blocks.map(blockKey)} strategy={verticalListSortingStrategy}>
                <div className="space-y-2">
                  {showGaps && <GapZone index={0} />}
                  {layout.blocks.map((block, i) => (
                    <div key={blockKey(block)} className="space-y-2">
                      <SortableSection id={blockKey(block)} draggable={draggable} className={sectionBg(block)}>
                        {renderSectionContent(block)}
                      </SortableSection>
                      {showGaps && <GapZone index={i + 1} />}
                    </div>
                  ))}
                </div>
              </SortableContext>
              <DragOverlay dropAnimation={{ duration: 150, easing: "ease-out" }}>
                {activeDrag?.kind === "section" && (
                  <div className="rounded-2xl border border-brand-500/40 bg-white px-4 py-3 text-sm font-semibold text-ink shadow-lg shadow-ink/20">
                    {activeDrag.title}
                  </div>
                )}
                {activeDrag?.kind === "card" && data && (
                  <div className="rounded-xl shadow-lg shadow-ink/20">
                    <EntryCard
                      entry={activeDrag.entry}
                      data={data}
                      metricsMeta={metadata?.metrics}
                      insightsById={insightsById}
                      shape={activeDrag.entry.kind === "kpi" ? "tile" : "row"}
                    />
                  </div>
                )}
              </DragOverlay>
            </DndContext>
          )}
        </div>
      </div>
    </div>
  );
}
