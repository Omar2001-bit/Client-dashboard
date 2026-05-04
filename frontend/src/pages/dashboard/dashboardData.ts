import { collection, doc, getDoc, getDocs, limit, orderBy, query } from "firebase/firestore";
import { db } from "@/lib/firebase";
import type {
  ClientDoc,
  DailyDataPoint,
  DailyVariantSeries,
  ExperimentAudience,
  ExperimentLocation,
  ExperimentMetricKey,
  ExperimentSummary,
  ExperimentUplifts,
  GoalStat,
  GoalSummary,
  MetricUplift,
  ROISnapshot,
  VariantSummary,
  VariationPreview,
} from "@/types";

export interface DashboardData {
  client: ClientDoc | null;
  roi: ROISnapshot | null;
  experiments: ExperimentSummary[];
  experimentsError: string | null;
  lastSyncedAt: Date | null;
}

export async function loadDashboardData(clientId: string): Promise<DashboardData> {
  const [clientResult, roiResult, experimentsResult, syncStatusResult] = await Promise.allSettled([
    getDoc(doc(db, "clients", clientId)),
    getDocs(query(collection(db, "clients", clientId, "roi"), orderBy("calculatedAt", "desc"), limit(1))),
    getDocs(collection(db, "clients", clientId, "experiments")),
    getDoc(doc(db, "clients", clientId, "syncStatus", "convert")),
  ]);

  const client =
    clientResult.status === "fulfilled" && clientResult.value.exists()
      ? ({ id: clientResult.value.id, ...clientResult.value.data() } as ClientDoc)
      : null;

  const roi =
    roiResult.status === "fulfilled" ? ((roiResult.value.docs[0]?.data() as ROISnapshot) ?? null) : null;

  let experiments: ExperimentSummary[] = [];
  let experimentsError: string | null = null;

  if (experimentsResult.status === "fulfilled") {
    const docs = experimentsResult.value.docs.map((d) => d.data());
    experiments = normalizeExperiments(docs);
  } else {
    experimentsError = (experimentsResult.reason as Error)?.message ?? "Failed to load experiments.";
    console.error("[dashboardData] read experiments failed:", experimentsResult.reason);
  }

  const lastSyncedAt =
    syncStatusResult.status === "fulfilled"
      ? (syncStatusResult.value.data()?.lastSyncedAt?.toDate?.() ?? null)
      : null;

  return { client, roi, experiments, experimentsError, lastSyncedAt };
}

// ---------------- Normalization (matches the actual Convert response shape) ----------------

interface DailyStat {
  timestamp?: number;  // Unix seconds — one entry per day
  value?: number;      // daily revenue for this variation on this day
  visitors?: number;
  conversions?: number;
}

interface GoalReport {
  goal_id?: number;
  variations?: Array<{
    id?: unknown;
    visitors?: number;
    conversion_data?: { conversions?: number; conversion_rate?: number; conversion_rate_change?: number } | null;
    revenue_data?: { total_revenue?: number; revenue_per_visitor?: number; revenue_per_visitor_change?: number } | null;
    products_data?: { total_products?: number; products_per_visitor?: number } | null;
    stats?: DailyStat[];
  }>;
}

interface VariationMeta {
  id?: unknown;
  name?: unknown;
  is_baseline?: boolean;
  status?: unknown;
  traffic_distribution?: number;
}

interface DailyReportBundle {
  revenue?: Record<string, unknown> | null;
  conversions?: Record<string, unknown> | null;
  products?: Record<string, unknown> | null;
}

/**
 * Normalizes Firestore docs that have shape:
 *   { experiment, report, dailyReport }
 */
export function normalizeExperiments(rawDocs: unknown[]): ExperimentSummary[] {
  return rawDocs.map((raw, index) => {
    const stored = raw as {
      experiment?: Record<string, unknown>;
      report?: Record<string, unknown> | null;
      dailyReport?: Record<string, unknown> | null;
      dailyReports?: Record<string, Record<string, unknown> | null> | null;
    };
    const experiment = stored.experiment ?? (stored as Record<string, unknown>);
    const report = stored.report ?? null;
    const dailyReport = stored.dailyReport ?? null;
    const dailyReports = stored.dailyReports ?? null;

    const id = String(experiment.id ?? `experiment-${index + 1}`);
    const reportData = (report?.data ?? report ?? {}) as Record<string, unknown>;

    const variationsMeta: VariationMeta[] =
      (reportData.variations_data as VariationMeta[]) ??
      (experiment.variations as VariationMeta[]) ??
      [];

    const goals = (reportData.reportData as GoalReport[]) ?? [];
    const revenueGoal = goals.find((g) => g.variations?.some((v) => v.revenue_data != null));
    const primaryGoal = revenueGoal ?? goals[0];

    const statsByVariationId = new Map<string, NonNullable<GoalReport["variations"]>[number]>();
    primaryGoal?.variations?.forEach((v) => {
      if (v.id != null) statsByVariationId.set(String(v.id), v);
    });

    const variationRows: VariationMeta[] =
      variationsMeta.length > 0
        ? variationsMeta
        : (primaryGoal?.variations?.map((variant, variationIndex) => ({
            id: variant.id,
            name: variationIndex === 0 ? "Original" : `Variation ${variationIndex}`,
            is_baseline: variationIndex === 0,
            traffic_distribution: 0,
          })) ?? []);
    const baselineMeta = findBaselineVariation(variationRows);
    const baselineId = baselineMeta?.id != null ? String(baselineMeta.id) : undefined;

    const variants: VariantSummary[] = variationRows.map((variant, variantIndex) => {
      const stats = statsByVariationId.get(String(variant.id ?? ""));
      const visitors = Number(stats?.visitors ?? 0);
      const conversions = Number(stats?.conversion_data?.conversions ?? 0);
      const revenue = Number(stats?.revenue_data?.total_revenue ?? 0);
      const rpv = Number(stats?.revenue_data?.revenue_per_visitor ?? 0);
      const cvr = Number(stats?.conversion_data?.conversion_rate ?? 0);
      const products = Number(stats?.products_data?.total_products ?? 0);
      const aov = conversions > 0 ? revenue / conversions : 0;
      return {
        id: String(variant.id ?? ""),
        name: String(variant.name ?? "Variant"),
        isOriginal: baselineId ? String(variant.id ?? "") === baselineId : variantIndex === 0,
        trafficSplit: Number(variant.traffic_distribution ?? 0),
        sessions: visitors,
        transactions: conversions,
        products: roundMetric(products),
        revenue: Math.round(revenue * 100) / 100,
        cvr: roundMetric(cvr),
        rpv: roundMetric(rpv),
        aov: roundMetric(aov),
      };
    });

    const uplifts = calculateUplifts(variants);
    const winnerVariantId = uplifts.revenue.uplift > 0 ? uplifts.revenue.bestVariationId : undefined;
    const estimatedRevenueImpact = uplifts.revenue.uplift;

    // Extract per-day series from the daily_report API response (fetched during sync).
    // Net daily uplift = best variant's daily RPV − baseline's daily RPV.
    const dailySeries =
      parseDailyReport(dailyReport, uplifts.revenue.bestVariationId, baselineId) ||
      buildDailySeries(revenueGoal, uplifts.revenue.bestVariationId, baselineId);
    const dailyVariants = buildDailyVariantSeries(dailyReports, variationRows, baselineId);

    const rawGoals = Array.isArray(experiment.goals) ? experiment.goals : [];
    
    const variantNameMap = new Map<string, string>();
    variationRows.forEach(v => {
      if (v.id != null) variantNameMap.set(String(v.id), String(v.name ?? "Variant"));
    });

    const experimentGoals: GoalSummary[] = rawGoals.map((g: Record<string, unknown>) => {
      const gId = String(g.id ?? "");
      const gReport = goals.find(r => String(r.goal_id) === gId);
      
      const stats: GoalStat[] = (gReport?.variations ?? []).map(v => ({
        variationId: String(v.id ?? ""),
        variationName: variantNameMap.get(String(v.id ?? "")) ?? "Unknown Variation",
        visitors: Number(v.visitors ?? 0),
        conversions: Number(v.conversion_data?.conversions ?? 0),
        conversionRate: roundMetric(Number(v.conversion_data?.conversion_rate ?? 0)),
        revenue: Math.round(Number(v.revenue_data?.total_revenue ?? 0) * 100) / 100,
      }));

      return {
        id: gId,
        name: String(g.name ?? "Unnamed goal"),
        type: g.type != null ? String(g.type) : undefined,
        stats,
      };
    });

    // Extract experiment details (available after refresh with audiences+locations expanded)
    const siteUrl = String(experiment.url ?? "");
    const description = String(experiment.description ?? "").trim();
    const objective = stripHtml(String(experiment.objective ?? "")).trim();

    const audiences: ExperimentAudience[] = Array.isArray(experiment.audiences)
      ? (experiment.audiences as Array<Record<string, unknown>>).map((a) => ({
          id: String(a.id ?? ""),
          name: String(a.name ?? ""),
          description: String(a.description ?? ""),
        }))
      : [];

    const locations: ExperimentLocation[] = Array.isArray(experiment.locations)
      ? (experiment.locations as Array<Record<string, unknown>>).map((l) => ({
          id: String(l.id ?? ""),
          name: String(l.name ?? ""),
          description: String(l.description ?? ""),
        }))
      : [];

    const variationPreviews: VariationPreview[] = Array.isArray(experiment.variations)
      ? (experiment.variations as Array<Record<string, unknown>>).map((v) => ({
          id: String(v.id ?? ""),
          name: String(v.name ?? ""),
          isBaseline: Boolean(v.is_baseline),
          trafficSplit: Number(v.traffic_distribution ?? 0),
          previewUrl: siteUrl
            ? `${siteUrl}${siteUrl.includes("?") ? "&" : "?"}convert_action=convert_vpreview&convert_e=${id}&convert_v=${v.id}`
            : "",
        }))
      : [];

    return {
      id,
      name: String(experiment.name ?? `Experiment ${index + 1}`),
      status: normalizeStatus(experiment.status),
      startDate: formatConvertDate(experiment.start_time ?? experiment.start_date ?? experiment.created_at),
      endDate: (experiment.end_time ?? experiment.end_date)
        ? formatConvertDate(experiment.end_time ?? experiment.end_date)
        : undefined,
      winnerVariantId,
      primaryGoal: String((experiment.goals as Array<{ name?: string }>)?.[0]?.name ?? "Primary conversion"),
      goals: experimentGoals,
      estimatedRevenueImpact,
      uplifts,
      variants,
      ...(dailySeries.length > 0 ? { dailySeries } : {}),
      ...(dailyVariants.length > 0 ? { dailyVariants } : {}),
      ...(description ? { description } : {}),
      ...(objective ? { objective } : {}),
      ...(siteUrl ? { siteUrl } : {}),
      ...(audiences.length > 0 ? { audiences } : {}),
      ...(locations.length > 0 ? { locations } : {}),
      ...(variationPreviews.length > 0 ? { variationPreviews } : {}),
    };
  });
}

function parseDailyReport(
  dailyReport: Record<string, unknown> | null | undefined,
  bestVariationId: string | undefined,
  baselineId: string | undefined
): DailyDataPoint[] | null {
  if (!dailyReport) return null;

  type StatEntry = { timestamp?: number; value?: number; totals?: number; visitors?: number };
  type VariationEntry = { id?: unknown; stats?: StatEntry[] };

  // Convert daily_report response can have reportData as either:
  //   object: { variations: [...] }          (when a specific goal_id is requested)
  //   array:  [{ goal_id, variations: [...] }]  (same envelope as aggregated_report)
  const outer = (dailyReport.data ?? dailyReport) as Record<string, unknown>;
  const reportDataRaw = outer.reportData;
  let variations: VariationEntry[] = [];

  if (Array.isArray(reportDataRaw)) {
    const first = (reportDataRaw as Record<string, unknown>[])[0];
    if (first && Array.isArray(first.variations)) variations = first.variations as VariationEntry[];
  } else if (reportDataRaw && typeof reportDataRaw === "object") {
    const rd = reportDataRaw as Record<string, unknown>;
    if (Array.isArray(rd.variations)) variations = rd.variations as VariationEntry[];
  }

  if (variations.length === 0) return null;

  const findStats = (id: string | undefined): StatEntry[] =>
    id ? (variations.find((v) => String(v.id) === id)?.stats ?? []) : [];

  const bestStats = findStats(bestVariationId);
  const baseStats = findStats(baselineId);

  if (bestStats.length === 0) return null;

  // Index base stats by timestamp for aligned matching instead of fragile array-index access
  const baseByTs = new Map<number, StatEntry>();
  baseStats.forEach((s) => { if (s.timestamp != null) baseByTs.set(s.timestamp, s); });

  // Convert daily_report timestamps may be ms or seconds depending on endpoint version.
  // Values >1e12 are already ms (any real date after 2001); smaller values are seconds.
  const toMs = (ts: number) => (ts > 1e12 ? ts : ts * 1000);

  // Compute daily revenue from a stat entry.
  // Prefer totals (pre-computed total revenue) when present; otherwise derive from value (RPV) × visitors.
  const toRevenue = (s: StatEntry | undefined): number => {
    if (!s) return 0;
    if (s.totals != null && s.totals !== 0) return Number(s.totals);
    return Number(s.value ?? 0) * Number(s.visitors ?? 0);
  };

  return bestStats
    .map((stat) => {
      if (!stat.timestamp) return null;
      const date = toISODate(new Date(toMs(stat.timestamp)));
      if (!date) return null;
      const baseStat = baseByTs.get(stat.timestamp);
      return {
        date,
        revenue: Math.round((toRevenue(stat) - toRevenue(baseStat)) * 100) / 100,
        visitors: Number(stat.visitors ?? 0),
        conversions: 0,
      } satisfies DailyDataPoint;
    })
    .filter((d): d is DailyDataPoint => d !== null && d.date !== "");
}

function buildDailySeries(
  revenueGoal: GoalReport | undefined,
  bestVariationId: string | undefined,
  baselineId: string | undefined
): DailyDataPoint[] {
  if (!revenueGoal?.variations) return [];

  const findStats = (id: string | undefined) =>
    id ? revenueGoal.variations?.find((v) => String(v.id) === id)?.stats ?? [] : [];

  const bestStats = findStats(bestVariationId);
  const baseStats = findStats(baselineId);

  if (bestStats.length === 0) return [];

  return bestStats
    .map((stat, i) => {
      if (!stat.timestamp) return null;
      const date = toISODate(new Date(stat.timestamp * 1000));
      const bestRevenue = Number(stat.value ?? 0);
      const baseRevenue = Number(baseStats[i]?.value ?? 0);
      return {
        date,
        revenue: Math.round((bestRevenue - baseRevenue) * 100) / 100,
        visitors: Number(stat.visitors ?? 0),
        conversions: Number(stat.conversions ?? 0),
      } satisfies DailyDataPoint;
    })
    .filter((d): d is DailyDataPoint => d !== null && d.date !== "");
}

function buildDailyVariantSeries(
  dailyReports: DailyReportBundle | null,
  variationRows: VariationMeta[],
  baselineId: string | undefined,
): DailyVariantSeries[] {
  if (!dailyReports) return [];

  type StatEntry = { timestamp?: number; value?: number; totals?: number; visitors?: number };
  type VariationEntry = { id?: unknown; stats?: StatEntry[] };
  type MetricKey = "revenue" | "conversions" | "products";

  // Convert daily_report returns `value` (per-visitor metric) + `visitors`, not a pre-summed `totals`.
  // Derive the actual count: value * visitors. Mirror the same fallback used in parseDailyReport.
  const deriveMetric = (stat: StatEntry, metric: MetricKey): number => {
    if (stat.totals != null && stat.totals !== 0) return Number(stat.totals);
    const value = Number(stat.value ?? 0);
    const visitors = Number(stat.visitors ?? 0);
    // revenue: value = RPV → total = RPV * visitors
    // conversions: value = CVR (0–100) → count = (CVR / 100) * visitors
    // products: value = avg products/visitor → total = value * visitors
    if (metric === "conversions") return roundMetric((value / 100) * visitors);
    return roundMetric(value * visitors);
  };

  const metricEntries: Record<MetricKey, VariationEntry[]> = {
    revenue: extractDailyVariations(dailyReports.revenue),
    conversions: extractDailyVariations(dailyReports.conversions),
    products: extractDailyVariations(dailyReports.products),
  };

  const hasData = Object.values(metricEntries).some((entries) => entries.length > 0);
  if (!hasData) return [];

  return variationRows.map((variation, index) => {
    const variationId = String(variation.id ?? "");
    const pointsByDate = new Map<string, { visitors: number; revenue: number; conversions: number; products: number }>();

    (Object.entries(metricEntries) as Array<[MetricKey, VariationEntry[]]>).forEach(([metric, entries]) => {
      const stats = entries.find((entry) => String(entry.id) === variationId)?.stats ?? [];
      stats.forEach((stat) => {
        if (stat.timestamp == null) return;
        const date = toISODate(new Date(normalizeTimestamp(stat.timestamp)));
        const current = pointsByDate.get(date) ?? { visitors: 0, revenue: 0, conversions: 0, products: 0 };
        const visitors = Number(stat.visitors ?? 0);
        current.visitors = Math.max(current.visitors, visitors);
        current[metric] = deriveMetric(stat, metric);
        pointsByDate.set(date, current);
      });
    });

    const points = Array.from(pointsByDate.entries())
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([date, value]) => ({
        date,
        visitors: value.visitors,
        revenue: roundMetric(value.revenue),
        conversions: roundMetric(value.conversions),
        products: roundMetric(value.products),
      }));

    return {
      variationId,
      variationName: String(variation.name ?? "Variant"),
      isOriginal: baselineId ? variationId === baselineId : index === 0,
      trafficSplit: Number(variation.traffic_distribution ?? 0),
      points,
    };
  }).filter((series) => series.points.length > 0);
}

function extractDailyVariations(report: Record<string, unknown> | null | undefined) {
  if (!report) return [];

  type VariationEntry = { id?: unknown; stats?: Array<{ timestamp?: number; value?: number; totals?: number; visitors?: number }> };

  const outer = (report.data ?? report) as Record<string, unknown>;
  const reportDataRaw = outer.reportData;
  if (Array.isArray(reportDataRaw)) {
    const first = (reportDataRaw as Record<string, unknown>[])[0];
    if (first && Array.isArray(first.variations)) return first.variations as VariationEntry[];
  }
  if (reportDataRaw && typeof reportDataRaw === "object") {
    const raw = reportDataRaw as Record<string, unknown>;
    if (Array.isArray(raw.variations)) return raw.variations as VariationEntry[];
  }
  return [];
}

function normalizeTimestamp(timestamp: number): number {
  return timestamp > 1e12 ? timestamp : timestamp * 1000;
}

function findBaselineVariation(variations: VariationMeta[]): VariationMeta | undefined {
  return (
    variations.find((variant) => variant.is_baseline === true) ??
    variations.find((variant) => /original|control|baseline/i.test(String(variant.name ?? ""))) ??
    variations[0]
  );
}

export function calculateUplifts(variants: VariantSummary[]): ExperimentUplifts {
  const original = variants.find((variant) => variant.isOriginal) ?? variants[0];
  const variationCandidates = variants.filter((variant) => variant.id !== original?.id);
  const candidates = variationCandidates.length > 0 ? variationCandidates : variants;

  return {
    revenue: calculateMetricUplift(original, candidates, "revenue"),
    rpv: calculateMetricUplift(original, candidates, "rpv"),
    purchases: calculateMetricUplift(original, candidates, "purchases"),
    products: calculateMetricUplift(original, candidates, "products"),
    cvr: calculateMetricUplift(original, candidates, "cvr"),
    aov: calculateMetricUplift(original, candidates, "aov"),
  };
}

function calculateMetricUplift(
  original: VariantSummary | undefined,
  candidates: VariantSummary[],
  metric: ExperimentMetricKey
): MetricUplift {
  const originalValue = getMetricValue(original, metric);
  const best = candidates.reduce<VariantSummary | undefined>((currentBest, candidate) => {
    if (!currentBest) return candidate;
    return getMetricValue(candidate, metric) > getMetricValue(currentBest, metric) ? candidate : currentBest;
  }, undefined);
  const bestValue = getMetricValue(best, metric);
  const uplift = roundMetric(bestValue - originalValue);
  const upliftPercent = originalValue === 0 ? 0 : roundMetric((uplift / originalValue) * 100);

  return {
    original: originalValue,
    bestVariation: bestValue,
    uplift,
    upliftPercent,
    bestVariationId: best?.id,
    bestVariationName: best?.name,
  };
}

function getMetricValue(variant: VariantSummary | undefined, metric: ExperimentMetricKey): number {
  if (!variant) return 0;
  if (metric === "purchases") return variant.transactions;
  if (metric === "aov") return variant.aov;
  return variant[metric];
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ");
}

function roundMetric(value: number): number {
  return Math.round((Number.isFinite(value) ? value : 0) * 100) / 100;
}

function normalizeStatus(value: unknown): ExperimentSummary["status"] {
  const s = String(value ?? "draft").toLowerCase();
  if (s.includes("run") || s === "active") return "running";
  if (s.includes("complete") || s.includes("finish") || s.includes("stop")) return "completed";
  if (s.includes("pause")) return "paused";
  if (s.includes("archive")) return "archived";
  return "draft";
}

function formatConvertDate(value: unknown): string {
  if (!value) return "";
  if (typeof value === "number") return toISODate(new Date(value * 1000));
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? String(value) : toISODate(parsed);
}

function toISODate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
