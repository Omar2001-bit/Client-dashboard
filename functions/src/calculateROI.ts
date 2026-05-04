import { onDocumentWritten } from "firebase-functions/v2/firestore";
import { getAdminFirestore } from "./lib/firebaseAdmin";
import * as admin from "firebase-admin";
import type { ExperimentROIEntry, ROISnapshot } from "./types";

export const calculateROI = onDocumentWritten(
  "clients/{clientId}/syncStatus/{syncType}",
  async (event) => {
    const { clientId, syncType } = event.params;
    if (syncType !== "convert") return;

    const db = getAdminFirestore();

    try {
      const clientDoc = await db.collection("clients").doc(clientId).get();
      if (!clientDoc.exists) return;
      const clientData = clientDoc.data()!;
      const experimentsSnap = await db
        .collection("clients").doc(clientId).collection("experiments").get();
      if (experimentsSnap.empty) return;

      const breakdown: ExperimentROIEntry[] = [];
      let totalRevenueGained = 0;
      let totalPurchasesGained = 0;

      for (const experimentDoc of experimentsSnap.docs) {
        const stored = experimentDoc.data() as StoredExperimentDoc;
        const summary = summarizeExperiment(stored);
        if (!summary) continue;

        totalRevenueGained += summary.revenueGained;
        totalPurchasesGained += summary.purchasesGained;

        breakdown.push(summary.breakdown);
      }

      const servicePrice = clientData.servicePrice ?? clientData.agencyFee ?? 0;
      const blendedROI = servicePrice > 0
        ? ((totalRevenueGained - servicePrice) / servicePrice) * 100
        : 0;

      const dateKey = new Date().toISOString().split("T")[0];
      const snapshot: ROISnapshot = {
        totalRevenueGained: Math.round(totalRevenueGained * 100) / 100,
        totalPurchasesGained: Math.round(totalPurchasesGained),
        productsGained: 0, // populated separately from products report
        productsLost: 0,
        blendedROI: Math.round(blendedROI * 100) / 100,
        calculatedAt: admin.firestore.Timestamp.now(),
        breakdown,
      };

      await db
        .collection("clients").doc(clientId).collection("roi").doc(dateKey).set(snapshot);

      console.info(
        `[calculateROI] client=${clientId} revenue=${snapshot.totalRevenueGained} ROI=${snapshot.blendedROI}%`
      );
    } catch (err) {
      console.error(`[calculateROI] client=${clientId} error:`, err);
    }
  }
);

interface StoredExperimentDoc {
  experiment?: Record<string, unknown>;
  report?: Record<string, unknown> | null;
}

interface GoalVariationStats {
  id?: unknown;
  visitors?: number;
  conversion_data?: {
    conversions?: number;
    conversion_rate?: number;
  } | null;
  revenue_data?: {
    total_revenue?: number;
    revenue_per_visitor?: number;
  } | null;
  products_data?: {
    total_products?: number;
  } | null;
}

interface GoalReport {
  goal_id?: number;
  variations?: GoalVariationStats[];
}

interface VariationMeta {
  id?: unknown;
  name?: unknown;
  is_baseline?: boolean;
  traffic_distribution?: number;
}

interface VariantSummary {
  id: string;
  name: string;
  isOriginal: boolean;
  trafficSplit: number;
  sessions: number;
  transactions: number;
  products: number;
  revenue: number;
  cvr: number;
  rpv: number;
  aov: number;
}

function summarizeExperiment(stored: StoredExperimentDoc): {
  revenueGained: number;
  purchasesGained: number;
  breakdown: ExperimentROIEntry;
} | null {
  const experiment = stored.experiment ?? {};
  const reportData = (stored.report?.data ?? stored.report ?? {}) as Record<string, unknown>;
  const variationsMeta = readVariationMeta(reportData, experiment);
  if (variationsMeta.length === 0) return null;

  const goals = Array.isArray(reportData.reportData) ? reportData.reportData as GoalReport[] : [];
  const primaryGoal = goals.find((goal) =>
    goal.variations?.some((variation) => variation.revenue_data != null),
  ) ?? goals[0];
  if (!primaryGoal?.variations?.length) return null;

  const baselineMeta = findBaselineVariation(variationsMeta);
  const baselineId = baselineMeta?.id != null ? String(baselineMeta.id) : undefined;
  const statsByVariationId = new Map<string, GoalVariationStats>();

  for (const variation of primaryGoal.variations) {
    if (variation.id != null) {
      statsByVariationId.set(String(variation.id), variation);
    }
  }

  const variants = variationsMeta.map((variation, index) => {
    const stats = statsByVariationId.get(String(variation.id ?? ""));
    const revenue = Number(stats?.revenue_data?.total_revenue ?? 0);
    const conversions = Number(stats?.conversion_data?.conversions ?? 0);
    const visitors = Number(stats?.visitors ?? 0);
    return {
      id: String(variation.id ?? ""),
      name: String(variation.name ?? "Variant"),
      isOriginal: baselineId
        ? String(variation.id ?? "") === baselineId
        : index === 0,
      trafficSplit: Number(variation.traffic_distribution ?? 0),
      sessions: visitors,
      transactions: conversions,
      products: Number(stats?.products_data?.total_products ?? 0),
      revenue,
      cvr: Number(stats?.conversion_data?.conversion_rate ?? 0),
      rpv: Number(stats?.revenue_data?.revenue_per_visitor ?? 0),
      aov: conversions > 0 ? revenue / conversions : 0,
    } satisfies VariantSummary;
  });

  const original = variants.find((variant) => variant.isOriginal) ?? variants[0];
  const candidates = variants.filter((variant) => variant.id !== original?.id);
  const bestRevenueVariant = pickBestVariant(candidates.length > 0 ? candidates : variants, "revenue");
  if (!original || !bestRevenueVariant || bestRevenueVariant.id === original.id) return null;

  const revenueUplift = roundMetric(bestRevenueVariant.revenue - original.revenue);
  if (revenueUplift <= 0) return null;

  const purchasesUplift = roundMetric(bestRevenueVariant.transactions - original.transactions);
  const upliftPercent = original.revenue === 0
    ? 0
    : roundMetric((revenueUplift / original.revenue) * 100);

  return {
    revenueGained: revenueUplift,
    purchasesGained: purchasesUplift,
    breakdown: {
      experimentId: String(experiment.id ?? ""),
      experimentName: String(experiment.name ?? experiment.id ?? "Unknown experiment"),
      upliftPercent,
      revenueGained: revenueUplift,
      purchasesGained: Math.round(purchasesUplift),
    },
  };
}

function readVariationMeta(
  reportData: Record<string, unknown>,
  experiment: Record<string, unknown>,
): VariationMeta[] {
  if (Array.isArray(reportData.variations_data)) {
    return reportData.variations_data as VariationMeta[];
  }
  if (Array.isArray(experiment.variations)) {
    return experiment.variations as VariationMeta[];
  }
  return [];
}

function findBaselineVariation(variations: VariationMeta[]): VariationMeta | undefined {
  return (
    variations.find((variation) => variation.is_baseline === true) ??
    variations.find((variation) => /original|control|baseline/i.test(String(variation.name ?? ""))) ??
    variations[0]
  );
}

function pickBestVariant(
  variants: VariantSummary[],
  metric: "revenue" | "transactions",
): VariantSummary | undefined {
  return variants.reduce<VariantSummary | undefined>((best, candidate) => {
    if (!best) return candidate;
    return candidate[metric] > best[metric] ? candidate : best;
  }, undefined);
}

function roundMetric(value: number): number {
  return Math.round((Number.isFinite(value) ? value : 0) * 100) / 100;
}
