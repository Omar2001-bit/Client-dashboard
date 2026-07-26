import { Fragment, useEffect, useMemo, useState } from "react";
import { collection, getDocs } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuthStore } from "@/store/authStore";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { useNavigate } from "react-router-dom";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from "recharts";
import {
  ArrowLeft,
  GitCompareArrows,
  CheckSquare,
  Square,
  BarChart3,
  Gauge,
  Eye,
  Shield,
  Search,
  Zap,
  Clock,
  Monitor,
  Smartphone,
  ChevronDown,
  ChevronUp,
} from "lucide-react";

/* ── Types ─────────────────────────────────────────────────────────────── */

interface PageSpeedScores {
  performance: number;
  accessibility: number;
  seo: number;
  bestPractices: number;
}

interface WebVitals {
  lcp: number | null;
  fcp: number | null;
  cls: number | null;
  tbt: number | null;
  si: number | null;
  inp: number | null;
}

interface PageSpeedResult {
  url: string;
  scores?: PageSpeedScores;
  webVitals?: WebVitals;
  metricValues?: Record<string, number>;
  auditSummaries?: Record<string, { title?: string; description?: string; score?: number | null; displayValue?: string | null; numericValue?: number | null; numericUnit?: string | null }>;
  screenshots?: {
    finalScreenshot?: string | null;
    thumbnails?: Array<{ timing: number | null; timestamp: number | null; data: string | null }>;
  };
  error?: string;
}

interface RunAverages {
  performance: number;
  accessibility: number;
  seo: number;
  bestPractices: number;
  lcp: number | null;
  fcp: number | null;
  cls: number | null;
  tbt: number | null;
  si: number | null;
  inp: number | null;
}

interface RunSnapshot {
  id: string;
  name: string;
  strategy: string;
  status?: string;
  ranAtISO: string;
  totalPages: number;
  completedPages?: number;
  successPages: number;
  errors: number;
  averages: RunAverages;
  metricAverages?: Record<string, number>;
  auditScoreAverages?: Record<string, number>;
  results: PageSpeedResult[];
}

/* ── Colour helpers ────────────────────────────────────────────────────── */

const RUN_COLORS = [
  "#6366f1", // indigo
  "#f59e0b", // amber
  "#10b981", // emerald
  "#ef4444", // red
  "#8b5cf6", // violet
  "#ec4899", // pink
  "#06b6d4", // cyan
  "#84cc16", // lime
];

function scoreBarColor(score: number): string {
  if (score >= 90) return "#0cce6b";
  if (score >= 50) return "#ffa400";
  return "#ff4e42";
}

function lighthouseAuditColor(score: number | null | undefined): string {
  if (score == null || !Number.isFinite(score)) return "#64748b";
  if (score >= 0.9) return "#0cce6b";
  if (score >= 0.5) return "#ffa400";
  return "#ff4e42";
}

function vitalBarColor(metric: string, value: number | null): string {
  if (value == null) return "#d1d5db";
  if (metric === "lcp") return value <= 2500 ? "#0cce6b" : value <= 4000 ? "#ffa400" : "#ff4e42";
  if (metric === "fcp") return value <= 1800 ? "#0cce6b" : value <= 3000 ? "#ffa400" : "#ff4e42";
  if (metric === "cls") return value <= 0.1 ? "#0cce6b" : value <= 0.25 ? "#ffa400" : "#ff4e42";
  if (metric === "tbt") return value <= 200 ? "#0cce6b" : value <= 600 ? "#ffa400" : "#ff4e42";
  if (metric === "inp") return value <= 200 ? "#0cce6b" : value <= 500 ? "#ffa400" : "#ff4e42";
  if (metric === "si") return value <= 3400 ? "#0cce6b" : value <= 5800 ? "#ffa400" : "#ff4e42";
  return "#6b7280";
}

function formatMs(ms: number | null): string {
  if (ms == null) return "—";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
}

function formatCls(value: number | null): string {
  if (value == null) return "—";
  return value.toFixed(3);
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return iso;
  }
}

function shortRunLabel(name: string): string {
  return name.replace("PAGESPEED-TEST-", "");
}

/* ── Metric configs ────────────────────────────────────────────────────── */

interface MetricConfig {
  key: string;
  label: string;
  fullLabel: string;
  description: string;
  icon: typeof Gauge;
  format: (v: number | null) => string;
  unit: string;
  isScore: boolean;
  colorFn: (v: number | null) => string;
}

const SCORE_METRICS: MetricConfig[] = [
  { key: "performance", label: "Performance", fullLabel: "Performance Score", description: "Overall loading speed and runtime responsiveness score.", icon: Zap, format: (v) => v != null ? String(Math.round(v)) : "—", unit: "/100", isScore: true, colorFn: (v) => scoreBarColor(v ?? 0) },
  { key: "accessibility", label: "Accessibility", fullLabel: "Accessibility Score", description: "Automated accessibility checks for inclusive UX quality.", icon: Eye, format: (v) => v != null ? String(Math.round(v)) : "—", unit: "/100", isScore: true, colorFn: (v) => scoreBarColor(v ?? 0) },
  { key: "seo", label: "SEO", fullLabel: "SEO Score", description: "Search discoverability and metadata best-practice signals.", icon: Search, format: (v) => v != null ? String(Math.round(v)) : "—", unit: "/100", isScore: true, colorFn: (v) => scoreBarColor(v ?? 0) },
  { key: "bestPractices", label: "Best Practices", fullLabel: "Best Practices Score", description: "Security and modern web implementation quality checks.", icon: Shield, format: (v) => v != null ? String(Math.round(v)) : "—", unit: "/100", isScore: true, colorFn: (v) => scoreBarColor(v ?? 0) },
];

const VITAL_METRICS: MetricConfig[] = [
  { key: "lcp", label: "LCP", fullLabel: "Largest Contentful Paint", description: "Time until the largest above-the-fold content is rendered.", icon: Clock, format: formatMs, unit: "", isScore: false, colorFn: (v) => vitalBarColor("lcp", v) },
  { key: "fcp", label: "FCP", fullLabel: "First Contentful Paint", description: "Time until first text/image appears on screen.", icon: Clock, format: formatMs, unit: "", isScore: false, colorFn: (v) => vitalBarColor("fcp", v) },
  { key: "cls", label: "CLS", fullLabel: "Cumulative Layout Shift", description: "Visual stability score from unexpected layout movement.", icon: Clock, format: formatCls, unit: "", isScore: false, colorFn: (v) => vitalBarColor("cls", v) },
  { key: "tbt", label: "TBT", fullLabel: "Total Blocking Time", description: "Main-thread blocking time that harms interactivity.", icon: Clock, format: formatMs, unit: "", isScore: false, colorFn: (v) => vitalBarColor("tbt", v) },
  { key: "si", label: "SI", fullLabel: "Speed Index", description: "How fast the page becomes visually complete.", icon: Clock, format: formatMs, unit: "", isScore: false, colorFn: (v) => vitalBarColor("si", v) },
  { key: "inp", label: "INP", fullLabel: "Interaction to Next Paint", description: "Latency from user action to rendered feedback.", icon: Clock, format: formatMs, unit: "", isScore: false, colorFn: (v) => vitalBarColor("inp", v) },
];

const METRIC_EXPLANATIONS: Record<string, string> = {
  "largest-contentful-paint": "Time until the largest visible content element is rendered.",
  "first-contentful-paint": "Time until the first piece of DOM content appears on screen.",
  "speed-index": "How quickly the page visually fills with content.",
  "total-blocking-time": "How long main-thread blocking prevents user interaction.",
  "interaction-to-next-paint": "Latency from interaction to next visual paint.",
  "cumulative-layout-shift": "Visual stability score from unexpected layout movement.",
  "server-response-time": "Back-end responsiveness to the initial HTML request.",
  "max-potential-fid": "Estimated worst-case first input delay under load.",
  "bootup-time": "Main-thread JavaScript startup execution time.",
  "mainthread-work-breakdown": "Total time spent on script/style/layout/paint tasks.",
  "unused-javascript": "Estimated savings from removing unused JS bytes.",
  "unused-css-rules": "Estimated savings from removing unused CSS bytes.",
  "render-blocking-resources": "Delay caused by blocking CSS/JS resources.",
  "unminified-javascript": "Estimated savings if JavaScript were minified.",
  "unminified-css": "Estimated savings if CSS were minified.",
  "uses-optimized-images": "Estimated savings from better image compression.",
  "uses-responsive-images": "Estimated savings from serving right-sized responsive images.",
  "efficient-animated-content": "Estimated savings from optimized animated image/video formats.",
  "modern-image-formats": "Estimated savings from next-generation image formats.",
  "offscreen-images": "Estimated savings from lazy-loading below-the-fold images.",
  "duplicated-javascript": "Estimated savings from reducing duplicated JavaScript modules.",
  "legacy-javascript": "Potential savings from avoiding legacy JavaScript for modern browsers.",
  "dom-size": "DOM complexity and depth that can slow style, layout, and scripting.",
  "third-party-summary": "Main-thread and transfer cost from third-party scripts.",
  "third-party-facades": "Opportunities to delay expensive third-party embeds with facades.",
  redirects: "Extra navigation redirects before the final document loads.",
  "uses-text-compression": "Estimated savings from gzip, Brotli, or similar text compression.",
  "uses-long-cache-ttl": "Static resources that could use longer browser cache lifetimes.",
  "total-byte-weight": "Total transferred resource weight for the page.",
  "network-requests": "Number and size of network requests made during load.",
  "critical-request-chains": "Render-critical dependency chains that delay first paint.",
  "resource-summary": "Transfer size and request counts by resource type.",
  "font-display": "Whether web fonts keep text visible while font files load.",
  "layout-shifts": "Elements contributing to layout movement.",
  "lcp-lazy-loaded": "Whether the LCP image was delayed by lazy-loading.",
  "prioritize-lcp-image": "Whether the LCP image should be prioritized.",
  "uses-rel-preconnect": "Origins that could benefit from early connection setup.",
  "uses-rel-preload": "Critical resources that could be preloaded earlier.",
};

function toHumanLabel(key: string): string {
  return key
    .split("-")
    .map((p) => (p.length <= 3 ? p.toUpperCase() : p.charAt(0).toUpperCase() + p.slice(1)))
    .join(" ");
}

function metricUnitForKey(key: string): "ms" | "s" | "bytes" | "score" | "number" {
  if (key.includes("layout-shift")) return "score";
  if (key.includes("time") || key.includes("paint") || key.includes("fid") || key.includes("blocking")) return "ms";
  if (key.includes("byte") || key.includes("javascript") || key.includes("css") || key.includes("resource")) return "bytes";
  return "number";
}

function formatMetricValue(value: number | null | undefined, unit: ReturnType<typeof metricUnitForKey>): string {
  if (value == null || !Number.isFinite(value)) return "—";
  if (unit === "ms") return value < 1000 ? `${Math.round(value)} ms` : `${(value / 1000).toFixed(2)} s`;
  if (unit === "bytes") return `${Math.round(value).toLocaleString()} B`;
  if (unit === "score") return value.toFixed(3);
  return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

/* ── Custom tooltip ────────────────────────────────────────────────────── */

function CustomTooltip({ active, payload, label, metricConfig }: {
  active?: boolean;
  payload?: Array<{ value: number; dataKey: string; color: string }>;
  label?: string;
  metricConfig: MetricConfig;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-xl border border-ink/10 bg-white px-4 py-3 shadow-lg">
      <p className="text-xs font-semibold text-ink/50 mb-2">{label}</p>
      {payload.map((entry, i) => (
        <div key={i} className="flex items-center gap-2 text-sm">
          <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: entry.color }} />
          <span className="text-ink/70">{entry.dataKey}:</span>
          <span className="font-bold text-ink">{metricConfig.format(entry.value)}{metricConfig.unit}</span>
        </div>
      ))}
    </div>
  );
}

/* ── Main Page ─────────────────────────────────────────────────────────── */

export function PageSpeedComparePage() {
  const clientId = useAuthStore((s) => s.clientId);
  const navigate = useNavigate();

  const [runs, setRuns] = useState<RunSnapshot[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [comparing, setComparing] = useState(false);
  const [expandedPages, setExpandedPages] = useState(false);

  /* ── Load all runs ───────────────────────────────────────────────────── */
  useEffect(() => {
    if (!clientId) return;
    const colRef = collection(db, "clients", clientId, "pagespeed", "runs", "list");
    getDocs(colRef)
      .then((snap) => {
        const loaded: RunSnapshot[] = [];
        snap.forEach((doc) => {
          loaded.push({ id: doc.id, ...doc.data() } as RunSnapshot);
        });
        loaded.sort((a, b) => {
          const aTs = Date.parse(a.ranAtISO ?? "");
          const bTs = Date.parse(b.ranAtISO ?? "");
          if (!Number.isNaN(aTs) && !Number.isNaN(bTs)) return bTs - aTs;
          if (!Number.isNaN(aTs)) return -1;
          if (!Number.isNaN(bTs)) return 1;
          return b.id.localeCompare(a.id);
        });
        setRuns(loaded);
      })
      .catch((err) => console.error("[compare] failed to load runs:", err))
      .finally(() => setLoading(false));
  }, [clientId]);

  /* ── Selection helpers ───────────────────────────────────────────────── */
  const toggleSelection = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectedRuns = useMemo(
    () => runs.filter((r) => selectedIds.has(r.id)),
    [runs, selectedIds]
  );

  const hasIncompleteSelection = useMemo(
    () => selectedRuns.some((run) => run.status === "running" || run.status === "cancelled"),
    [selectedRuns]
  );

  const dynamicMetricKeys = useMemo(() => {
    const fixedKeys = new Set<string>([
      "largest-contentful-paint",
      "first-contentful-paint",
      "cumulative-layout-shift",
      "total-blocking-time",
      "speed-index",
      "interaction-to-next-paint",
    ]);
    const found = new Set<string>();
    selectedRuns.forEach((run) => {
      Object.keys(run.metricAverages ?? {}).forEach((k) => {
        if (!fixedKeys.has(k)) found.add(k);
      });
    });
    return Array.from(found).sort();
  }, [selectedRuns]);

  /* ── Chart data builders ─────────────────────────────────────────────── */
  const buildOverviewData = (metricKey: string) => {
    return selectedRuns.map((run, i) => ({
      name: shortRunLabel(run.name),
      value: run.averages[metricKey as keyof RunAverages] ?? 0,
      color: RUN_COLORS[i % RUN_COLORS.length],
    }));
  };

  /* ── Per-page breakdown data ─────────────────────────────────────────── */
  const allUrls = useMemo(() => {
    const perRunUrlSets = selectedRuns.map((run) => {
      const set = new Set<string>();
      run.results.forEach((r) => {
        if (r.scores && !r.error) set.add(r.url);
      });
      return set;
    });
    if (perRunUrlSets.length === 0) return [];
    if (hasIncompleteSelection) {
      const [first, ...rest] = perRunUrlSets;
      return Array.from(first).filter((url) => rest.every((set) => set.has(url))).sort();
    }
    const union = new Set<string>();
    perRunUrlSets.forEach((set) => {
      set.forEach((url) => union.add(url));
    });
    return Array.from(union).sort();
  }, [selectedRuns, hasIncompleteSelection]);

  const buildDynamicOverviewData = (metricKey: string) =>
    selectedRuns.map((run, i) => ({
      name: shortRunLabel(run.name),
      value: run.metricAverages?.[metricKey] ?? 0,
      color: lighthouseAuditColor(averageAuditScore(run, metricKey)) || RUN_COLORS[i % RUN_COLORS.length],
    }));

  const averageAuditScore = (run: RunSnapshot, metricKey: string): number | null => {
    return run.auditScoreAverages?.[metricKey] ?? null;
  };

  /* ── Render ──────────────────────────────────────────────────────────── */
  if (loading) {
    return (
      <div className="p-8 text-sm text-ink/50 animate-pulse">Loading past runs…</div>
    );
  }

  return (
    <div className="p-8 space-y-8">
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <button
            onClick={() => navigate("/dashboard/page-speed")}
            className="flex items-center gap-1.5 text-sm text-ink/50 hover:text-ink transition-colors mb-3"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Page Speed
          </button>
          <div className="flex items-center gap-2">
            <GitCompareArrows className="h-5 w-5 text-ink/50" />
            <h1 className="text-2xl font-bold text-ink tracking-tight">Compare Runs</h1>
          </div>
          <p className="mt-1 text-sm text-ink/50">
            Select 2 or more past runs to compare performance metrics side-by-side.
          </p>
        </div>
        {!comparing && (
          <Button
            onClick={() => setComparing(true)}
            disabled={selectedIds.size < 2}
            className="flex items-center gap-2"
          >
            <BarChart3 className="h-4 w-4" />
            Compare {selectedIds.size > 0 ? `(${selectedIds.size})` : ""} Selected
          </Button>
        )}
        {comparing && (
          <Button
            variant="secondary"
            onClick={() => setComparing(false)}
            className="flex items-center gap-2"
          >
            <ArrowLeft className="h-4 w-4" />
            Change Selection
          </Button>
        )}
      </div>

      {/* ── No runs state ──────────────────────────────────────────────── */}
      {runs.length === 0 && (
        <Card>
          <CardBody className="py-16 text-center">
            <BarChart3 className="h-8 w-8 mx-auto text-ink/15 mb-3" />
            <p className="text-sm font-medium text-ink/50">No past runs found</p>
            <p className="text-xs text-ink/35 mt-1">
              Run a PageSpeed report first, then come back here to compare over time.
            </p>
          </CardBody>
        </Card>
      )}

      {/* ── Run selection phase ────────────────────────────────────────── */}
      {runs.length > 0 && !comparing && (
        <Card>
          <CardHeader>
            <h2 className="font-semibold text-ink">Select Runs to Compare</h2>
            <p className="mt-1 text-xs text-ink/45">{runs.length} runs available · Select at least 2</p>
          </CardHeader>
          <CardBody className="p-0">
            <div className="divide-y divide-ink/5">
              {runs.map((run) => {
                const isSelected = selectedIds.has(run.id);
                return (
                  <button
                    key={run.id}
                    onClick={() => toggleSelection(run.id)}
                    className={`w-full flex items-center gap-4 px-6 py-4 text-left transition-colors hover:bg-ink/[0.02] ${
                      isSelected ? "bg-brand-50/50" : ""
                    }`}
                  >
                    {/* Checkbox */}
                    <div className="shrink-0">
                      {isSelected ? (
                        <CheckSquare className="h-5 w-5 text-brand-600" />
                      ) : (
                        <Square className="h-5 w-5 text-ink/20" />
                      )}
                    </div>

                    {/* Run info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-sm text-ink truncate">{run.name}</span>
                        <span className="inline-flex items-center gap-1 rounded-md bg-ink/5 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-ink/40">
                          {run.strategy === "mobile" ? (
                            <Smartphone className="h-3 w-3" />
                          ) : (
                            <Monitor className="h-3 w-3" />
                          )}
                          {run.strategy}
                        </span>
                      </div>
                      <p className="text-xs text-ink/40 mt-0.5">
                        {formatDate(run.ranAtISO)} · {run.successPages} pages analyzed
                        {run.errors > 0 && ` · ${run.errors} errors`}
                      </p>
                    </div>

                    {/* Quick scores */}
                    <div className="hidden sm:flex items-center gap-3">
                      {(["performance", "accessibility", "seo", "bestPractices"] as const).map((key) => {
                        const val = run.averages[key];
                        return (
                          <div key={key} className="text-center">
                            <p className="text-[9px] font-bold uppercase tracking-widest text-ink/30">
                              {key === "bestPractices" ? "BP" : key.slice(0, 4).toUpperCase()}
                            </p>
                            <p
                              className="text-sm font-bold"
                              style={{ color: scoreBarColor(val) }}
                            >
                              {val}
                            </p>
                          </div>
                        );
                      })}
                    </div>
                  </button>
                );
              })}
            </div>
          </CardBody>
        </Card>
      )}

      {/* ── Comparison charts ──────────────────────────────────────────── */}
      {comparing && selectedRuns.length >= 2 && (
        <>
          {/* Score charts */}
          <div>
            <h2 className="text-lg font-bold text-ink mb-4 flex items-center gap-2">
              <Gauge className="h-5 w-5 text-ink/40" />
              Lighthouse Scores
            </h2>
            <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
              {SCORE_METRICS.map((metric) => {
                const data = buildOverviewData(metric.key);
                return (
                  <Card key={metric.key}>
                    <CardHeader className="flex items-center gap-2">
                      <metric.icon className="h-4 w-4 text-ink/30" />
                      <div>
                        <h3 className="font-semibold text-sm text-ink">{metric.fullLabel}</h3>
                        <p className="text-xs text-ink/45">{metric.description}</p>
                      </div>
                    </CardHeader>
                    <CardBody>
                      <ResponsiveContainer width="100%" height={220}>
                        <BarChart data={data} barCategoryGap="25%">
                          <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
                          <XAxis
                            dataKey="name"
                            tick={{ fontSize: 11, fill: "#9ca3af" }}
                            axisLine={{ stroke: "#e5e7eb" }}
                            tickLine={false}
                          />
                          <YAxis
                            domain={[0, 100]}
                            tick={{ fontSize: 11, fill: "#9ca3af" }}
                            axisLine={false}
                            tickLine={false}
                          />
                          <Tooltip content={<CustomTooltip metricConfig={metric} />} />
                          <Bar dataKey="value" name={metric.label} radius={[6, 6, 0, 0]} maxBarSize={56}>
                            {data.map((entry, idx) => (
                              <Cell key={idx} fill={metric.colorFn(entry.value)} />
                            ))}
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    </CardBody>
                  </Card>
                );
              })}
            </div>
          </div>

          {/* Web Vitals charts */}
          <div>
            <h2 className="text-lg font-bold text-ink mb-4 flex items-center gap-2">
              <Zap className="h-5 w-5 text-ink/40" />
              Core Web Vitals
            </h2>
            <div className="grid grid-cols-1 gap-5 lg:grid-cols-2 xl:grid-cols-3">
              {VITAL_METRICS.map((metric) => {
                const data = buildOverviewData(metric.key);
                return (
                  <Card key={metric.key}>
                    <CardHeader className="flex items-center gap-2">
                      <div>
                        <h3 className="font-semibold text-sm text-ink">{metric.label}</h3>
                        <p className="text-xs text-ink/45">{metric.description}</p>
                      </div>
                    </CardHeader>
                    <CardBody>
                      <ResponsiveContainer width="100%" height={200}>
                        <BarChart data={data} barCategoryGap="25%">
                          <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
                          <XAxis
                            dataKey="name"
                            tick={{ fontSize: 11, fill: "#9ca3af" }}
                            axisLine={{ stroke: "#e5e7eb" }}
                            tickLine={false}
                          />
                          <YAxis
                            tick={{ fontSize: 11, fill: "#9ca3af" }}
                            axisLine={false}
                            tickLine={false}
                          />
                          <Tooltip content={<CustomTooltip metricConfig={metric} />} />
                          <Bar dataKey="value" name={metric.label} radius={[6, 6, 0, 0]} maxBarSize={44}>
                            {data.map((entry, idx) => (
                              <Cell key={idx} fill={metric.colorFn(entry.value)} />
                            ))}
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    </CardBody>
                  </Card>
                );
              })}
            </div>
          </div>

          {/* Extended Lighthouse metrics */}
          {dynamicMetricKeys.length > 0 && (
            <div>
              <h2 className="text-lg font-bold text-ink mb-4 flex items-center gap-2">
                <BarChart3 className="h-5 w-5 text-ink/40" />
                Extended Lighthouse Metrics
              </h2>
              <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
                {dynamicMetricKeys.map((metricKey) => {
                  const data = buildDynamicOverviewData(metricKey);
                  const unit = metricUnitForKey(metricKey);
                  return (
                    <Card key={metricKey}>
                      <CardHeader>
                        <h3 className="font-semibold text-sm text-ink">{toHumanLabel(metricKey)}</h3>
                        <p className="mt-1 text-xs text-ink/45">
                          {METRIC_EXPLANATIONS[metricKey] ?? "Lighthouse audit metric from PageSpeed Insights."}
                        </p>
                      </CardHeader>
                      <CardBody>
                        <ResponsiveContainer width="100%" height={220}>
                          <BarChart data={data} barCategoryGap="25%">
                            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
                            <XAxis
                              dataKey="name"
                              tick={{ fontSize: 11, fill: "#9ca3af" }}
                              axisLine={{ stroke: "#e5e7eb" }}
                              tickLine={false}
                            />
                            <YAxis
                              tick={{ fontSize: 11, fill: "#9ca3af" }}
                              axisLine={false}
                              tickLine={false}
                            />
                            <Tooltip
                              formatter={(val: number) => formatMetricValue(val, unit)}
                            />
                            <Bar dataKey="value" name={toHumanLabel(metricKey)} radius={[6, 6, 0, 0]} maxBarSize={56}>
                              {data.map((entry, idx) => (
                                <Cell key={idx} fill={entry.color} />
                              ))}
                            </Bar>
                          </BarChart>
                        </ResponsiveContainer>
                      </CardBody>
                    </Card>
                  );
                })}
              </div>
            </div>
          )}

          {/* ── Per-page breakdown ──────────────────────────────────────── */}
          <Card>
            <CardHeader>
              <button
                onClick={() => setExpandedPages(!expandedPages)}
                className="w-full flex items-center justify-between"
              >
                <div>
                  <h2 className="font-semibold text-ink text-left">Per-Page Breakdown</h2>
                  <p className="mt-1 text-xs text-ink/45 text-left">
                    {allUrls.length} {hasIncompleteSelection ? "overlapping" : ""} pages across selected runs
                  </p>
                </div>
                {expandedPages ? (
                  <ChevronUp className="h-5 w-5 text-ink/30" />
                ) : (
                  <ChevronDown className="h-5 w-5 text-ink/30" />
                )}
              </button>
            </CardHeader>
            {expandedPages && (
              <CardBody className="p-0">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-ink/10 bg-ink/[0.02] text-left">
                        <th className="px-5 py-3 text-xs font-semibold uppercase tracking-wider text-ink/50 sticky left-0 bg-ink/[0.02]">
                          Page
                        </th>
                        {selectedRuns.map((run, i) => (
                          <th
                            key={run.id}
                            colSpan={4}
                            className="px-3 py-3 text-center text-xs font-semibold uppercase tracking-wider border-l border-ink/10"
                            style={{ color: RUN_COLORS[i % RUN_COLORS.length] }}
                          >
                            {shortRunLabel(run.name)}
                          </th>
                        ))}
                      </tr>
                      <tr className="border-b border-ink/5 bg-ink/[0.01]">
                        <th className="px-5 py-2 sticky left-0 bg-ink/[0.01]" />
                        {selectedRuns.map((run) => (
                          <Fragment key={`sub-${run.id}`}>
                            <th className="px-2 py-2 text-[10px] font-bold uppercase tracking-widest text-ink/30 border-l border-ink/10">Perf</th>
                            <th className="px-2 py-2 text-[10px] font-bold uppercase tracking-widest text-ink/30">A11y</th>
                            <th className="px-2 py-2 text-[10px] font-bold uppercase tracking-widest text-ink/30">SEO</th>
                            <th className="px-2 py-2 text-[10px] font-bold uppercase tracking-widest text-ink/30">LCP</th>
                          </Fragment>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {allUrls.map((url) => {
                        let urlPath: string;
                        try {
                          urlPath = new URL(url).pathname || "/";
                        } catch {
                          urlPath = url;
                        }

                        return (
                          <tr key={url} className="border-b border-ink/5 hover:bg-ink/[0.01] transition-colors">
                            <td className="px-5 py-3 sticky left-0 bg-white">
                              <span className="text-ink/70 truncate block max-w-[240px]" title={url}>
                                {urlPath}
                              </span>
                            </td>
                            {selectedRuns.map((run) => {
                              const pageResult = run.results.find((r) => r.url === url);
                              if (!pageResult?.scores) {
                                return (
                                  <Fragment key={`${run.id}-${url}`}>
                                    <td className="px-2 py-3 text-center text-ink/20 border-l border-ink/10">—</td>
                                    <td className="px-2 py-3 text-center text-ink/20">—</td>
                                    <td className="px-2 py-3 text-center text-ink/20">—</td>
                                    <td className="px-2 py-3 text-center text-ink/20">—</td>
                                  </Fragment>
                                );
                              }
                              return (
                                <Fragment key={`${run.id}-${url}`}>
                                  <td className="px-2 py-3 text-center font-bold border-l border-ink/10" style={{ color: scoreBarColor(pageResult.scores.performance) }}>
                                    {pageResult.scores.performance}
                                  </td>
                                  <td className="px-2 py-3 text-center font-bold" style={{ color: scoreBarColor(pageResult.scores.accessibility) }}>
                                    {pageResult.scores.accessibility}
                                  </td>
                                  <td className="px-2 py-3 text-center font-bold" style={{ color: scoreBarColor(pageResult.scores.seo) }}>
                                    {pageResult.scores.seo}
                                  </td>
                                  <td className="px-2 py-3 text-center font-bold" style={{ color: vitalBarColor("lcp", pageResult.webVitals?.lcp ?? null) }}>
                                    {formatMs(pageResult.webVitals?.lcp ?? null)}
                                  </td>
                                </Fragment>
                              );
                            })}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </CardBody>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
