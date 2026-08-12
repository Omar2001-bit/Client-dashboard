import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { doc, getDoc, onSnapshot, collection, getDocs } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuthStore } from "@/store/authStore";
import { fetchWithColdStartRetry } from "@/lib/apiClient";
import { track } from "@/lib/activityTracker";
import { isInteractiveClickTarget } from "@/lib/domEvents";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/Table";
import { useNavigate } from "react-router-dom";
import {
  SCORE_METRICS,
  VITAL_METRICS,
  explainMetric,
  formatMetricValue,
  lighthouseScoreBg,
  lighthouseScoreColor,
  metricUnitForKey,
  toHumanLabel,
} from "@/lib/pageSpeedMetrics";
import { scoreColor, scoreBarColor, vitalColor, vitalRingColor, formatMs, formatCls } from "@/lib/pageSpeedScoreColor";
import { ScoreGauge } from "@/components/pageSpeed/ScoreGauge";
import { ScoreBadge } from "@/components/pageSpeed/ScoreBadge";
import {
  Gauge,
  Monitor,
  Smartphone,
  Play,
  Square,
  Search,
  ArrowUpDown,
  ExternalLink,
  AlertCircle,
  CheckCircle2,
  Clock,
  Globe,
  GitCompareArrows,
  Calendar,
  BarChart3,
} from "lucide-react";

const API_BASE = import.meta.env.VITE_API_URL ?? "http://localhost:3001";

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
  fieldData?: { metrics?: Partial<Record<keyof WebVitals | "fid" | "ttfb", number | null>> };
  screenshots?: {
    finalScreenshot?: string | null;
    thumbnails?: Array<{ timing: number | null; timestamp: number | null; data: string | null }>;
  };
  lighthouseVersion?: string | null;
  fetchTime?: string | null;
  userAgent?: string | null;
  detailPath?: string;
  error?: string;
}

interface StrategyResults {
  mobile?: PageSpeedResult[];
  desktop?: PageSpeedResult[];
}

interface SitemapEntry {
  loc: string;
  lastmod: string | null;
}

type SortKey = "url" | "performance" | "accessibility" | "seo" | "bestPractices" | "lcp" | "cls" | "fcp" | "tbt" | "si" | "inp";
type SortDir = "asc" | "desc";

interface PastRun {
  id: string;
  name: string;
  strategy: string;
  ranAtISO: string;
  totalPages: number;
  successPages: number;
  errors: number;
  averages: {
    performance: number;
    accessibility: number;
    seo: number;
    bestPractices: number;
  };
}

const FIXED_AUDIT_KEYS = new Set([
  "largest-contentful-paint",
  "first-contentful-paint",
  "cumulative-layout-shift",
  "total-blocking-time",
  "speed-index",
  "interaction-to-next-paint",
]);

export function PageSpeedPage() {
  const clientId = useAuthStore((s) => s.clientId);
  const navigate = useNavigate();
  const [websiteUrl, setWebsiteUrl] = useState<string>("");
  const [manualUrl, setManualUrl] = useState("");
  const [strategy, setStrategy] = useState<"mobile" | "desktop">("mobile");
  const [sitemapUrls, setSitemapUrls] = useState<SitemapEntry[]>([]);
  const [results, setResults] = useState<PageSpeedResult[]>([]);
  const [resultsByStrategy, setResultsByStrategy] = useState<StrategyResults>({});
  const [loading, setLoading] = useState(false);
  const [sitemapLoading, setSitemapLoading] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  const [error, setError] = useState("");
  const [stopping, setStopping] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("performance");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [clientLoading, setClientLoading] = useState(true);
  const [pastRuns, setPastRuns] = useState<PastRun[]>([]);
  const [pastRunsLoading, setPastRunsLoading] = useState(true);
  const [liveStatus, setLiveStatus] = useState<string>("");
  const [metricAverages, setMetricAverages] = useState<Record<string, number>>({});
  const [auditScoreAverages, setAuditScoreAverages] = useState<Record<string, number>>({});
  const [highlightedVitalKey, setHighlightedVitalKey] = useState<string | null>(null);
  const [selectedResultUrl, setSelectedResultUrl] = useState<string | null>(null);

  // Guard: prevents stale Firestore reads from resetting `loading` to false
  // during the window between clicking "Run Report" and the server writing
  // the new run's status: "running" to Firestore (can take 1-3 seconds).
  const runInitiatedRef = useRef(false);
  const highlightTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (highlightTimeoutRef.current) clearTimeout(highlightTimeoutRef.current);
    };
  }, []);

  const handleVitalCardClick = useCallback((key: string) => {
    document.getElementById(`metric-explain-${key}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    setHighlightedVitalKey(key);
    if (highlightTimeoutRef.current) clearTimeout(highlightTimeoutRef.current);
    highlightTimeoutRef.current = setTimeout(() => setHighlightedVitalKey(null), 2000);
  }, []);

  // Load client websiteUrl from Firestore
  useEffect(() => {
    if (!clientId) return;
    getDoc(doc(db, "clients", clientId))
      .then((snap) => {
        if (snap.exists()) {
          const data = snap.data();
          setWebsiteUrl(data.websiteUrl ?? "");
        }
      })
      .finally(() => setClientLoading(false));
  }, [clientId]);

  // Listen to Firestore for background job progress (real-time)
  useEffect(() => {
    if (!clientId) return;
    const unsub = onSnapshot(doc(db, "clients", clientId, "pagespeed", "latest"), (snap) => {
      if (!snap.exists()) return;
      const data = snap.data();
      const strategyResults = (data.resultsByStrategy ?? {}) as StrategyResults;
      const fallbackResults = (data.results ?? []) as PageSpeedResult[];
      const selectedResults =
        strategyResults[strategy] ??
        fallbackResults;

      setResultsByStrategy(strategyResults);
      setResults(selectedResults);
      setProgress({ current: data.completedPages ?? 0, total: data.totalPages ?? 0 });
      setLiveStatus(String(data.status ?? ""));
      setMetricAverages((data.metricAverages ?? {}) as Record<string, number>);
      setAuditScoreAverages((data.auditScoreAverages ?? {}) as Record<string, number>);
      if (data.status === "running") {
        setLoading(true);
        // Server has acknowledged the new run — safe to react to future status changes
        runInitiatedRef.current = false;
      } else if (!runInitiatedRef.current) {
        // Only reset loading if we're NOT in the brief window between clicking
        // "Run Report" and the server writing status: "running" to Firestore.
        setLoading(false);
        setStopping(false);
        // Refresh past runs list when a job completes
        if (data.status === "done") loadPastRuns();
      }
    });
    return () => unsub();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId, strategy]);

  // Poll fallback: keeps UI fresh if Firestore realtime channel drops.
  useEffect(() => {
    if (!clientId) return;
    const ref = doc(db, "clients", clientId, "pagespeed", "latest");
    const timer = setInterval(async () => {
      try {
        const snap = await getDoc(ref);
        if (!snap.exists()) return;
        const data = snap.data();
        const strategyResults = (data.resultsByStrategy ?? {}) as StrategyResults;
        const fallbackResults = (data.results ?? []) as PageSpeedResult[];
        setResultsByStrategy(strategyResults);
        setResults(strategyResults[strategy] ?? fallbackResults);
        setProgress({ current: data.completedPages ?? 0, total: data.totalPages ?? 0 });
        setMetricAverages((data.metricAverages ?? {}) as Record<string, number>);
        setAuditScoreAverages((data.auditScoreAverages ?? {}) as Record<string, number>);
        const status = String(data.status ?? "");
        setLiveStatus(status);
        if (status === "running") {
          runInitiatedRef.current = false;
        } else if (!runInitiatedRef.current) {
          setLoading(false);
          setStopping(false);
        }
      } catch {
        // best-effort fallback; ignore polling errors
      }
    }, 3000);
    return () => clearInterval(timer);
  }, [clientId, strategy]);

  useEffect(() => {
    const next = resultsByStrategy[strategy];
    if (next) {
      setResults(next);
      return;
    }
    // Keep legacy fallback results visible when resultsByStrategy doesn't exist yet.
    if (Object.keys(resultsByStrategy).length > 0) {
      setResults([]);
    }
  }, [strategy, resultsByStrategy]);

  // Load past runs from Firestore
  const loadPastRuns = useCallback(async () => {
    if (!clientId) return;
    setPastRunsLoading(true);
    try {
      const colRef = collection(db, "clients", clientId, "pagespeed", "runs", "list");
      const snap = await getDocs(colRef);
      const loaded: PastRun[] = [];
      snap.forEach((d) => loaded.push({ id: d.id, ...d.data() } as PastRun));
      loaded.sort((a, b) => {
        const aTs = Date.parse(a.ranAtISO ?? "");
        const bTs = Date.parse(b.ranAtISO ?? "");
        if (!Number.isNaN(aTs) && !Number.isNaN(bTs)) return bTs - aTs;
        if (!Number.isNaN(aTs)) return -1;
        if (!Number.isNaN(bTs)) return 1;
        return b.id.localeCompare(a.id);
      });
      setPastRuns(loaded);
    } catch (err) {
      console.error("[pagespeed] failed to load past runs:", err);
    } finally {
      setPastRunsLoading(false);
    }
  }, [clientId]);

  useEffect(() => { loadPastRuns(); }, [loadPastRuns]);

  const fetchSitemap = useCallback(async (url: string) => {
    setSitemapLoading(true);
    setError("");
    setSitemapUrls([]);
    try {
      const resp = await fetchWithColdStartRetry(`${API_BASE}/api/pagespeed/sitemap?url=${encodeURIComponent(url)}`);
      if (!resp.ok) throw new Error("Failed to fetch sitemap");
      const data = await resp.json();
      if (data.urls.length === 0) {
        setError("No pages found in sitemap. You can add URLs manually below.");
      }
      setSitemapUrls(data.urls);
    } catch (err) {
      setError(`Could not crawl sitemap: ${(err as Error).message}`);
    } finally {
      setSitemapLoading(false);
    }
  }, []);

  // Auto-fetch sitemap when websiteUrl is loaded
  useEffect(() => {
    if (websiteUrl && !clientLoading) {
      fetchSitemap(websiteUrl);
    }
  }, [websiteUrl, clientLoading, fetchSitemap]);

  const addManualUrl = () => {
    const trimmed = manualUrl.trim();
    if (!trimmed) return;
    const normalized = trimmed.startsWith("http") ? trimmed : `https://${trimmed}`;
    if (!sitemapUrls.some((u) => u.loc === normalized)) {
      setSitemapUrls((prev) => [...prev, { loc: normalized, lastmod: null }]);
    }
    setManualUrl("");
  };

  const runReport = async () => {
    if (sitemapUrls.length === 0 || !clientId || loading) return;
    track({ type: "pagespeed_run_started", metadata: { strategy, pageCount: sitemapUrls.length } });
    // Activate the guard BEFORE setting loading — this prevents stale
    // Firestore reads (from the polling fallback or onSnapshot) from
    // resetting loading=false before the server has written the new run.
    runInitiatedRef.current = true;
    setLoading(true);
    setError("");
    setResults([]);
    setResultsByStrategy({});
    setProgress({ current: 0, total: sitemapUrls.length });
    setMetricAverages({});
    setAuditScoreAverages({});

    try {
      const resp = await fetchWithColdStartRetry(`${API_BASE}/api/pagespeed/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          urls: sitemapUrls.map((u) => u.loc),
          strategy,
          clientId,
        }),
      });
      if (!resp.ok) throw new Error("Failed to start report");
      // Server responds immediately; Firestore listener handles progress.
      // Safety timeout: if the server never writes status:"running" within
      // 15 seconds, drop the guard so the UI isn't stuck forever.
      setTimeout(() => { runInitiatedRef.current = false; }, 15000);
    } catch (err) {
      runInitiatedRef.current = false;
      setError(`Failed to start report: ${(err as Error).message}`);
      setLoading(false);
    }
  };

  const stopReport = async () => {
    if (!clientId || !loading || stopping) return;
    track({ type: "pagespeed_run_stopped", metadata: { strategy } });
    setStopping(true);
    setError("");
    try {
      console.log("[pagespeed-ui] stop clicked", { clientId, loading, stopping });
      const resp = await fetch(`${API_BASE}/api/pagespeed/stop`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId }),
      });
      const data = await resp.json().catch(() => ({}));
      console.log("[pagespeed-ui] stop response", { ok: resp.ok, status: resp.status, data });
      if (!resp.ok) {
        throw new Error(data.error || "Failed to stop report");
      }
      if (data.forceCancelled) {
        setLoading(false);
        setStopping(false);
        setLiveStatus("cancelled");
      }
      // Firestore listener will transition the UI once backend marks job cancelled.
    } catch (err) {
      setError(`Failed to stop report: ${(err as Error).message}`);
      setStopping(false);
    }
  };

  const successResults = results.filter((r) => r.scores && !r.error);

  const averages = useMemo(() => {
    if (successResults.length === 0) return null;
    const sum = (key: keyof PageSpeedScores) =>
      successResults.reduce((acc, r) => acc + (r.scores?.[key] ?? 0), 0) / successResults.length;
    const vitalAvg = (key: keyof WebVitals) => {
      const valid = successResults.filter((r) => r.webVitals?.[key] != null);
      if (valid.length === 0) return null;
      return valid.reduce((acc, r) => acc + (r.webVitals?.[key] ?? 0), 0) / valid.length;
    };
    return {
      performance: Math.round(sum("performance")),
      accessibility: Math.round(sum("accessibility")),
      seo: Math.round(sum("seo")),
      bestPractices: Math.round(sum("bestPractices")),
      lcp: vitalAvg("lcp"),
      fcp: vitalAvg("fcp"),
      cls: vitalAvg("cls"),
      tbt: vitalAvg("tbt"),
      si: vitalAvg("si"),
      inp: vitalAvg("inp"),
    };
  }, [successResults]);

  const extendedMetricAverages = useMemo(() => {
    return Object.entries(metricAverages)
      .filter(([key, value]) => !FIXED_AUDIT_KEYS.has(key) && Number.isFinite(value))
      .map(([key, value]) => {
        const avgScore = auditScoreAverages[key] ?? null;
        return {
          key,
          value,
          audit: avgScore != null ? { score: avgScore } : undefined,
          title: toHumanLabel(key),
          description: explainMetric(key, undefined),
          unit: metricUnitForKey(key),
        };
      })
      .sort((a, b) => a.title.localeCompare(b.title));
  }, [metricAverages, auditScoreAverages]);

  const screenshotResults = useMemo(
    () => successResults.filter((result) => result.screenshots?.finalScreenshot || result.screenshots?.thumbnails?.length),
    [successResults]
  );

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  };

  const sortedResults = useMemo(() => {
    const filtered = results.filter((r) =>
      r.url.toLowerCase().includes(searchTerm.toLowerCase())
    );
    return filtered.sort((a, b) => {
      let aVal: number | string = 0;
      let bVal: number | string = 0;
      if (sortKey === "url") {
        aVal = a.url;
        bVal = b.url;
      } else if (["performance", "accessibility", "seo", "bestPractices"].includes(sortKey)) {
        aVal = a.scores?.[sortKey as keyof PageSpeedScores] ?? -1;
        bVal = b.scores?.[sortKey as keyof PageSpeedScores] ?? -1;
      } else if (["lcp", "cls", "fcp", "tbt", "si", "inp"].includes(sortKey)) {
        aVal = a.webVitals?.[sortKey as keyof WebVitals] ?? 99999;
        bVal = b.webVitals?.[sortKey as keyof WebVitals] ?? 99999;
      }
      if (typeof aVal === "string" && typeof bVal === "string") {
        return sortDir === "asc" ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
      }
      return sortDir === "asc" ? (aVal as number) - (bVal as number) : (bVal as number) - (aVal as number);
    });
  }, [results, searchTerm, sortKey, sortDir]);

  const SortHeader = ({ label, sortKeyName }: { label: string; sortKeyName: SortKey }) => (
    <button
      onClick={() => handleSort(sortKeyName)}
      className={`flex items-center gap-1 text-left text-xs uppercase tracking-wider font-semibold ${sortKey === sortKeyName ? "text-ink" : "text-ink/50"} hover:text-ink transition-colors`}
    >
      {label}
      <ArrowUpDown className="h-3 w-3" />
    </button>
  );

  const ScreenshotPreview = ({ result }: { result: PageSpeedResult }) => {
    const screenshot = result.screenshots?.finalScreenshot;
    if (!screenshot) return <span className="text-xs text-ink/25">—</span>;
    return (
      <a href={screenshot} target="_blank" rel="noreferrer" className="block h-14 w-20 overflow-hidden rounded border border-ink/10 bg-ink/5">
        <img src={screenshot} alt="PageSpeed final screenshot" className="h-full w-full object-cover object-top" />
      </a>
    );
  };

  if (clientLoading) {
    return <div className="p-8 text-sm text-ink/50">Loading...</div>;
  }

  return (
    <div className="p-8 space-y-8">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Gauge className="h-5 w-5 text-ink/50" />
            <h1 className="text-2xl font-bold text-ink tracking-tight">Page Speed Reports</h1>
          </div>
          <p className="mt-1 text-sm text-ink/50">
            Analyze page performance across your entire site using Google PageSpeed Insights.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3" data-tutorial="page-speed-controls">
          {/* Strategy Toggle */}
          <div className="inline-flex shrink-0 overflow-hidden rounded-lg border border-ink/10 bg-white text-sm font-medium shadow-sm">
            <button
              onClick={() => { setStrategy("mobile"); track({ type: "pagespeed_strategy_change", metadata: { strategy: "mobile" } }); }}
              className={`flex items-center gap-1.5 whitespace-nowrap px-3 py-2 transition-colors ${strategy === "mobile" ? "bg-ink text-white" : "text-ink/60 hover:bg-ink/5"}`}
            >
              <Smartphone className="h-4 w-4" />
              Mobile
            </button>
            <button
              onClick={() => { setStrategy("desktop"); track({ type: "pagespeed_strategy_change", metadata: { strategy: "desktop" } }); }}
              className={`flex items-center gap-1.5 whitespace-nowrap px-3 py-2 transition-colors ${strategy === "desktop" ? "bg-ink text-white" : "text-ink/60 hover:bg-ink/5"}`}
            >
              <Monitor className="h-4 w-4" />
              Desktop
            </button>
          </div>
          <Button
            variant="secondary"
            onClick={() => { track({ type: "pagespeed_compare_click", metadata: { pastRunsCount: pastRuns.length } }); navigate("/dashboard/page-speed/compare"); }}
            disabled={pastRuns.length < 2}
            className="flex items-center gap-2"
          >
            <GitCompareArrows className="h-4 w-4" />
            Compare Runs
          </Button>
          <Button
            onClick={runReport}
            loading={loading}
            disabled={sitemapUrls.length === 0}
            className="flex items-center gap-2"
          >
            <Play className="h-4 w-4" />
            {loading ? `Analyzing ${progress.current}/${progress.total}...` : "Run Report"}
          </Button>
          <Button
            variant="secondary"
            onClick={stopReport}
            disabled={!loading || stopping}
            className="flex items-center gap-2"
          >
            <Square className="h-4 w-4" />
            {stopping ? "Stopping..." : "Stop Report"}
          </Button>
        </div>
      </div>

      {/* No website URL configured */}
      {!websiteUrl && (
        <Card>
          <CardBody className="py-12 text-center">
            <Globe className="h-8 w-8 mx-auto text-ink/20 mb-3" />
            <p className="text-sm font-medium text-ink/60">No website URL configured for this client.</p>
            <p className="text-xs text-ink/40 mt-1">Ask your admin to set the website URL in client settings.</p>
          </CardBody>
        </Card>
      )}

      {/* Sitemap Status */}
      {websiteUrl && (
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 rounded-xl border border-ink/10 bg-white px-4 py-2.5 text-sm shadow-sm">
            <Globe className="h-4 w-4 text-ink/40" />
            <span className="text-ink/70">{websiteUrl}</span>
            <span className="text-ink/30">·</span>
            {sitemapLoading ? (
              <span className="text-ink/40">Crawling sitemap...</span>
            ) : (
              <span className="font-medium text-ink">{sitemapUrls.length} pages found</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={manualUrl}
              onChange={(e) => setManualUrl(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addManualUrl()}
              placeholder="Add URL manually..."
              className="rounded-lg border border-ink/10 px-3 py-2 text-sm text-ink focus:border-brand-300 focus:outline-none"
            />
            <Button variant="secondary" size="sm" onClick={addManualUrl}>
              Add
            </Button>
          </div>
        </div>
      )}

      {error && (
        <div className="flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
          <AlertCircle className="h-4 w-4 shrink-0" />
          {error}
        </div>
      )}
      {liveStatus === "cancelled" && (
        <div className="flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          <AlertCircle className="h-4 w-4 shrink-0" />
          Report cancelled. Partial results are shown below.
        </div>
      )}

      {/* Progress Bar */}
      {loading && (
        <div className="space-y-2">
          <div className="h-2 w-full rounded-full bg-ink/5">
            <div
              className="h-2 rounded-full bg-brand-500 transition-all duration-500"
              style={{ width: `${progress.total > 0 ? (progress.current / progress.total) * 100 : 0}%` }}
            />
          </div>
          <p className="text-xs text-ink/40">
            Analyzing page {progress.current} of {progress.total}...
          </p>
        </div>
      )}

      {/* Summary Cards */}
      {averages && (
        <>
          <div className="grid grid-cols-2 gap-5 xl:grid-cols-4">
            {SCORE_METRICS.map(({ key, label, description, icon: Icon }) => (
              <Card key={key}>
                <CardBody className="flex items-center gap-4 py-5">
                  <div className="relative">
                    <ScoreGauge score={averages[key as keyof PageSpeedScores]} size={72} label="" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <Icon className="h-4 w-4 text-ink/30" />
                      <p className="text-xs font-semibold uppercase tracking-wider text-ink/40">{label}</p>
                    </div>
                    <p className={`text-3xl font-bold ${scoreColor(averages[key as keyof PageSpeedScores])}`}>{averages[key as keyof PageSpeedScores]}</p>
                    <p className="text-xs text-ink/40" title={description}>avg across {successResults.length} pages</p>
                  </div>
                </CardBody>
              </Card>
            ))}
          </div>

          {/* Core Web Vitals */}
          <Card>
            <CardHeader>
              <h2 className="font-semibold text-ink">Core Web Vitals (Averages)</h2>
              <p className="mt-1 text-xs text-ink/45">Averaged across {successResults.length} analyzed pages</p>
            </CardHeader>
            <CardBody>
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-6">
                {VITAL_METRICS.map(({ key, label, fullLabel, description, unit }) => {
                  const value = averages[key as keyof typeof averages];
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => handleVitalCardClick(key)}
                      style={{ borderLeftColor: vitalRingColor(key, value), borderLeftWidth: 4 }}
                      className="cursor-pointer rounded-xl border border-ink/10 bg-ink/[0.01] p-4 text-center transition-colors hover:bg-ink/[0.03]"
                    >
                      <p className="text-[10px] font-bold uppercase tracking-widest text-ink/35">{label}</p>
                      <p className={`mt-1 text-xl font-bold ${vitalColor(key, value)}`}>
                        {formatMetricValue(value, unit)}
                      </p>
                      <p className="mt-1 text-[10px] text-ink/30" title={description}>{fullLabel}</p>
                    </button>
                  );
                })}
              </div>
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <h2 className="font-semibold text-ink">Metric Explanations</h2>
              <p className="mt-1 text-xs text-ink/45">Definitions for every primary PageSpeed metric shown in this report.</p>
            </CardHeader>
            <CardBody>
              <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                {[...SCORE_METRICS, ...VITAL_METRICS].map((metric) => {
                  const isHighlighted = highlightedVitalKey === metric.key;
                  const value = averages?.[metric.key as keyof typeof averages] ?? null;
                  return (
                    <div
                      key={metric.key}
                      id={`metric-explain-${metric.key}`}
                      style={
                        isHighlighted
                          ? {
                              borderColor: vitalRingColor(metric.key, value),
                              boxShadow: `0 0 0 2px ${vitalRingColor(metric.key, value)}33`,
                            }
                          : undefined
                      }
                      className="rounded-xl border border-ink/10 bg-white p-4 transition-shadow"
                    >
                      <div className="flex items-center gap-2">
                        <metric.icon className="h-4 w-4 text-ink/35" />
                        <p className="text-sm font-semibold text-ink">{metric.fullLabel}</p>
                        <span className="rounded bg-ink/5 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-ink/35">
                          {metric.lowerIsBetter ? "lower is better" : "higher is better"}
                        </span>
                      </div>
                      <p className="mt-2 text-xs leading-relaxed text-ink/55">{metric.description}</p>
                    </div>
                  );
                })}
              </div>
            </CardBody>
          </Card>

          {extendedMetricAverages.length > 0 && (
            <Card>
              <CardHeader>
                <h2 className="font-semibold text-ink">All Lighthouse Audit Metrics</h2>
                <p className="mt-1 text-xs text-ink/45">Every numeric audit value returned by PageSpeed Insights, averaged across successful pages.</p>
              </CardHeader>
              <CardBody>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {extendedMetricAverages.map((metric) => (
                    <div key={metric.key} className={`rounded-xl border p-4 ${lighthouseScoreBg(metric.audit?.score)}`}>
                      <p className="text-sm font-semibold text-ink">{metric.title}</p>
                      <div className="mt-1 flex items-baseline gap-2">
                        <p className={`text-xl font-bold ${lighthouseScoreColor(metric.audit?.score)}`}>
                          {formatMetricValue(metric.value, metric.unit)}
                        </p>
                        {metric.audit?.score != null && (
                          <span className="text-[10px] font-bold uppercase tracking-wider text-ink/35">
                            score {Math.round(metric.audit.score * 100)}
                          </span>
                        )}
                      </div>
                      <p className="mt-2 text-xs leading-relaxed text-ink/45">{metric.description}</p>
                    </div>
                  ))}
                </div>
              </CardBody>
            </Card>
          )}

          {screenshotResults.length > 0 && (
            <Card>
              <CardHeader>
                <h2 className="font-semibold text-ink">PageSpeed Screenshots</h2>
                <p className="mt-1 text-xs text-ink/45">Final screenshots and load filmstrips returned by PageSpeed Insights for every successful page in the selected strategy.</p>
              </CardHeader>
              <CardBody>
                <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
                  {screenshotResults.map((result) => {
                    const urlPath = (() => {
                      try {
                        return new URL(result.url).pathname || "/";
                      } catch {
                        return result.url;
                      }
                    })();
                    return (
                      <div key={result.url} className="rounded-xl border border-ink/10 bg-white p-4">
                        <div className="mb-3 flex items-center justify-between gap-3">
                          <p className="truncate text-sm font-semibold text-ink" title={result.url}>{urlPath}</p>
                          {result.lighthouseVersion && <span className="text-[10px] text-ink/35">LH {result.lighthouseVersion}</span>}
                        </div>
                        {result.screenshots?.finalScreenshot && (
                          <img src={result.screenshots.finalScreenshot} alt={`Final PageSpeed screenshot for ${urlPath}`} className="w-full rounded-lg border border-ink/10 bg-ink/5" />
                        )}
                        {Boolean(result.screenshots?.thumbnails?.length) && (
                          <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
                            {result.screenshots!.thumbnails!.map((shot, index) => (
                              shot.data ? (
                                <div key={`${result.url}-${index}`} className="shrink-0">
                                  <img src={shot.data} alt={`PageSpeed filmstrip ${index + 1}`} className="h-24 rounded border border-ink/10 bg-ink/5" />
                                  <p className="mt-1 text-center text-[10px] text-ink/35">{shot.timing != null ? formatMs(shot.timing) : `${index + 1}`}</p>
                                </div>
                              ) : null
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </CardBody>
            </Card>
          )}
        </>
      )}

      {/* Page-by-Page Table */}
      {results.length > 0 && (
        <Card data-tutorial="page-speed-table">
          <CardHeader className="flex items-center justify-between">
            <div>
              <h2 className="font-semibold text-ink">Page-by-Page Results</h2>
              <p className="mt-1 text-xs text-ink/45">
                {successResults.length} analyzed · {results.length - successResults.length} errors
              </p>
            </div>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink/30" />
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Filter by URL..."
                className="rounded-lg border border-ink/10 py-2 pl-9 pr-3 text-sm text-ink focus:border-brand-300 focus:outline-none"
              />
            </div>
          </CardHeader>
          <CardBody className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <THead>
                  <TR className="bg-ink/[0.02] hover:bg-transparent">
                    <TH className="px-5 py-3"><SortHeader label="Page" sortKeyName="url" /></TH>
                    <TH className="px-5 py-3 text-xs uppercase tracking-wider font-semibold text-ink/50">PSI Report</TH>
                    <TH className="px-5 py-3 text-xs uppercase tracking-wider font-semibold text-ink/50">Screenshot</TH>
                    <TH className="px-5 py-3"><SortHeader label="Perf" sortKeyName="performance" /></TH>
                    <TH className="px-5 py-3"><SortHeader label="A11y" sortKeyName="accessibility" /></TH>
                    <TH className="px-5 py-3"><SortHeader label="Best P." sortKeyName="bestPractices" /></TH>
                    <TH className="px-5 py-3"><SortHeader label="SEO" sortKeyName="seo" /></TH>
                    <TH className="px-5 py-3"><SortHeader label="LCP" sortKeyName="lcp" /></TH>
                    <TH className="px-5 py-3"><SortHeader label="CLS" sortKeyName="cls" /></TH>
                    <TH className="px-5 py-3"><SortHeader label="FCP" sortKeyName="fcp" /></TH>
                    <TH className="px-5 py-3"><SortHeader label="TBT" sortKeyName="tbt" /></TH>
                    <TH className="px-5 py-3"><SortHeader label="SI" sortKeyName="si" /></TH>
                    <TH className="px-5 py-3"><SortHeader label="INP" sortKeyName="inp" /></TH>
                  </TR>
                </THead>
                <TBody>
                  {sortedResults.map((r) => {
                    const urlPath = (() => {
                      try {
                        return new URL(r.url).pathname || "/";
                      } catch {
                        return r.url;
                      }
                    })();

                    if (r.error) {
                      return (
                        <TR
                          key={r.url}
                          selected={selectedResultUrl === r.url}
                          onClick={() => setSelectedResultUrl((cur) => (cur === r.url ? null : r.url))}
                          className="cursor-pointer hover:bg-transparent"
                        >
                          <TD className="px-5 py-3">
                            <div className="flex items-center gap-2">
                              <AlertCircle className="h-3.5 w-3.5 text-red-400 shrink-0" />
                              <span className="text-ink/50 truncate max-w-[280px]" title={r.url}>{urlPath}</span>
                            </div>
                          </TD>
                          <TD className="px-5 py-3 text-xs text-ink/25">—</TD>
                          <TD className="px-5 py-3 text-xs text-ink/25">—</TD>
                          <TD colSpan={10} className="px-5 py-3 text-xs text-red-500">{r.error}</TD>
                        </TR>
                      );
                    }

                    return (
                      <TR
                        key={r.url}
                        selected={selectedResultUrl === r.url}
                        onClick={(e) => {
                          if (isInteractiveClickTarget(e)) return;
                          setSelectedResultUrl((cur) => (cur === r.url ? null : r.url));
                        }}
                        className="cursor-pointer hover:bg-ink/[0.01]"
                      >
                        <TD className="px-5 py-3">
                          <a
                            href={r.url}
                            target="_blank"
                            rel="noreferrer"
                            className="group flex items-center gap-1.5 text-ink hover:text-brand-700"
                            title={r.url}
                          >
                            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                            <span className="truncate max-w-[280px]">{urlPath}</span>
                            <ExternalLink className="h-3 w-3 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" />
                          </a>
                        </TD>
                        <TD className="px-5 py-3">
                          <a
                            href={`https://pagespeed.web.dev/report?url=${encodeURIComponent(r.url)}`}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1.5 rounded-lg border border-ink/10 bg-ink/[0.02] px-2.5 py-1.5 text-xs font-medium text-ink/60 hover:border-brand-300 hover:text-brand-700 transition-colors"
                            title={`Open PageSpeed Insights report for ${r.url} (${strategy})`}
                          >
                            <Gauge className="h-3.5 w-3.5 shrink-0" />
                            {strategy === "mobile" ? <Smartphone className="h-3 w-3 shrink-0" /> : <Monitor className="h-3 w-3 shrink-0" />}
                            <ExternalLink className="h-3 w-3 shrink-0" />
                          </a>
                        </TD>
                        <TD className="px-5 py-3"><ScreenshotPreview result={r} /></TD>
                        <TD className="px-5 py-3"><ScoreBadge score={r.scores!.performance} /></TD>
                        <TD className="px-5 py-3"><ScoreBadge score={r.scores!.accessibility} /></TD>
                        <TD className="px-5 py-3"><ScoreBadge score={r.scores!.bestPractices} /></TD>
                        <TD className="px-5 py-3"><ScoreBadge score={r.scores!.seo} /></TD>
                        <TD className={`px-5 py-3 font-semibold ${vitalColor("lcp", r.webVitals?.lcp ?? null)}`}>
                          {formatMs(r.webVitals?.lcp ?? null)}
                        </TD>
                        <TD className={`px-5 py-3 font-semibold ${vitalColor("cls", r.webVitals?.cls ?? null)}`}>
                          {formatCls(r.webVitals?.cls ?? null)}
                        </TD>
                        <TD className={`px-5 py-3 font-semibold ${vitalColor("fcp", r.webVitals?.fcp ?? null)}`}>
                          {formatMs(r.webVitals?.fcp ?? null)}
                        </TD>
                        <TD className={`px-5 py-3 font-semibold ${vitalColor("tbt", r.webVitals?.tbt ?? null)}`}>
                          {formatMs(r.webVitals?.tbt ?? null)}
                        </TD>
                        <TD className={`px-5 py-3 font-semibold ${vitalColor("si", r.webVitals?.si ?? null)}`}>
                          {formatMs(r.webVitals?.si ?? null)}
                        </TD>
                        <TD className={`px-5 py-3 font-semibold ${vitalColor("inp", r.webVitals?.inp ?? null)}`}>
                          {formatMs(r.webVitals?.inp ?? null)}
                        </TD>
                      </TR>
                    );
                  })}
                </TBody>
              </Table>
            </div>
            {sortedResults.length === 0 && (
              <div className="py-10 text-center text-sm text-ink/50">
                {searchTerm ? "No pages match your filter." : "No results yet."}
              </div>
            )}
          </CardBody>
        </Card>
      )}

      {/* Empty State */}
      {results.length === 0 && !loading && sitemapUrls.length > 0 && (
        <Card>
          <CardBody className="py-16 text-center">
            <Clock className="h-8 w-8 mx-auto text-ink/15 mb-3" />
            <p className="text-sm font-medium text-ink/50">Ready to analyze {sitemapUrls.length} pages</p>
            <p className="text-xs text-ink/35 mt-1">
              Click "Run Report" to start. Each page takes about 15 seconds.
            </p>
          </CardBody>
        </Card>
      )}

      {/* Past Runs History */}
      {!pastRunsLoading && pastRuns.length > 0 && (
        <Card>
          <CardHeader className="flex items-center justify-between">
            <div>
              <h2 className="font-semibold text-ink flex items-center gap-2">
                <Calendar className="h-4 w-4 text-ink/30" />
                Past Runs
              </h2>
              <p className="mt-1 text-xs text-ink/45">{pastRuns.length} saved run{pastRuns.length !== 1 ? "s" : ""}</p>
            </div>
            {pastRuns.length >= 2 && (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => { track({ type: "pagespeed_compare_click", metadata: { pastRunsCount: pastRuns.length } }); navigate("/dashboard/page-speed/compare"); }}
                className="flex items-center gap-1.5"
              >
                <BarChart3 className="h-3.5 w-3.5" />
                Compare
              </Button>
            )}
          </CardHeader>
          <CardBody className="p-0">
            <div className="divide-y divide-ink/5">
              {pastRuns.map((run) => (
                <div key={run.id} className="flex items-center gap-4 px-6 py-4 hover:bg-ink/[0.01] transition-colors">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-sm text-ink">{run.name}</span>
                      <span className="inline-flex items-center gap-1 rounded-md bg-ink/5 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-ink/40">
                        {run.strategy === "mobile" ? <Smartphone className="h-3 w-3" /> : <Monitor className="h-3 w-3" />}
                        {run.strategy}
                      </span>
                    </div>
                    <p className="text-xs text-ink/40 mt-0.5">
                      {new Date(run.ranAtISO).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" })} · {run.successPages} pages
                      {run.errors > 0 && ` · ${run.errors} errors`}
                    </p>
                  </div>
                  <div className="hidden sm:flex items-center gap-3">
                    {(["performance", "accessibility", "seo", "bestPractices"] as const).map((key) => {
                      const val = run.averages[key];
                      return (
                        <div key={key} className="text-center">
                          <p className="text-[9px] font-bold uppercase tracking-widest text-ink/30">
                            {key === "bestPractices" ? "BP" : key.slice(0, 4).toUpperCase()}
                          </p>
                          <p className="text-sm font-bold" style={{ color: scoreBarColor(val) }}>{val}</p>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </CardBody>
        </Card>
      )}
    </div>
  );
}
