import { useQuery } from "@tanstack/react-query";
import { collection, doc, getDoc, getDocs } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuthStore } from "@/store/authStore";
import { calculateUplifts } from "@/pages/dashboard/dashboardData";
import type {
  GA4Experiment,
  GA4Variation,
  ExperimentUplifts,
  ExperimentSummary,
  VariantSummary,
} from "@/types";

const API_BASE = import.meta.env.VITE_API_URL ?? "http://localhost:3001";

export interface GA4EnrichedExperiment {
  experimentId: string;
  name: string;
  status: ExperimentSummary["status"];
  /** Actual date range fetched from GA4, derived from the Convert experiment's running period. */
  startDate: string;
  endDate: string;
  variations: GA4Variation[];
  variantSummaries: VariantSummary[];
  uplifts: ExperimentUplifts;
}

export interface GA4DataResult {
  experiments: GA4EnrichedExperiment[];
  propertyId: string;
}

// ── date helpers ─────────────────────────────────────────────────────────────

function toISODate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function convertDateToISO(value: unknown): string {
  if (!value) return "";
  // Firebase Timestamp object
  if (typeof value === "object" && value !== null && "seconds" in value) {
    const d = new Date((value as { seconds: number }).seconds * 1000);
    return Number.isNaN(d.getTime()) ? "" : toISODate(d);
  }
  if (typeof value === "number") {
    // Convert timestamps are Unix seconds (~1.7B); ms timestamps are >1e12
    const d = new Date(value > 1e12 ? value : value * 1000);
    return Number.isNaN(d.getTime()) ? "" : toISODate(d);
  }
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? "" : toISODate(parsed);
}

// ── metric helpers ────────────────────────────────────────────────────────────

function roundMetric(v: number): number {
  return Math.round((Number.isFinite(v) ? v : 0) * 100) / 100;
}

function normalizeStatus(value: unknown): ExperimentSummary["status"] {
  const s = String(value ?? "running").toLowerCase();
  if (s.includes("run") || s === "active") return "running";
  if (s.includes("complete") || s.includes("finish") || s.includes("stop")) return "completed";
  if (s.includes("pause")) return "paused";
  if (s.includes("archive")) return "archived";
  return "running";
}

// ── Firestore experiment metadata ─────────────────────────────────────────────

interface ConvertVariationInfo {
  name: string;
  isOriginal: boolean;
}

interface FirestoreExperimentMeta {
  name: string;
  status: ExperimentSummary["status"];
  startDate: string;
  endDate: string;
  /** variationId (string) → { name, isOriginal } */
  variations: Map<string, ConvertVariationInfo>;
}

function buildFirestoreMeta(
  raw: Record<string, unknown>,
  docId: string
): FirestoreExperimentMeta {
  const exp = ((raw.experiment ?? raw) as Record<string, unknown>);

  const name = String(exp.name ?? `Experiment ${docId}`);
  const status = normalizeStatus(exp.status);

  const rawStart = exp.start_time ?? exp.start_date ?? exp.created_at;
  const rawEnd = exp.end_time ?? exp.end_date;
  const startDate = convertDateToISO(rawStart) || "365daysAgo";
  const endDate = rawEnd ? (convertDateToISO(rawEnd) || "today") : "today";

  // Build variation map: variationId → { name, isOriginal }
  const rawVars = Array.isArray(exp.variations)
    ? (exp.variations as Array<Record<string, unknown>>)
    : [];

  // Find baseline: prefer is_baseline flag, then "original"/"control" name, then first
  const baselineByFlag = rawVars.find((v) => v.is_baseline === true);
  const baselineId = baselineByFlag
    ? String(baselineByFlag.id ?? "")
    : rawVars.length > 0
    ? String(rawVars[0].id ?? "")
    : "";

  const variations = new Map<string, ConvertVariationInfo>();
  rawVars.forEach((v, idx) => {
    const vid = String(v.id ?? "");
    if (!vid) return;
    variations.set(vid, {
      name: String(v.name ?? `Variation ${idx + 1}`),
      isOriginal: vid === baselineId,
    });
  });

  return { name, status, startDate, endDate, variations };
}

// ── GA4 variation → VariantSummary ───────────────────────────────────────────

function ga4VariationToVariantSummary(
  v: GA4Variation,
  convertInfo?: ConvertVariationInfo
): VariantSummary {
  const sessions = v.sessions;
  const transactions = v.transactions;
  const revenue = v.purchaseRevenue;
  return {
    id: v.variationId,
    name: convertInfo?.name ?? v.description ?? v.variationId,
    isOriginal: convertInfo?.isOriginal ?? v.isOriginal,
    trafficSplit: 0,
    sessions,
    transactions,
    products: v.products,
    revenue,
    cvr: sessions > 0 ? roundMetric((transactions / sessions) * 100) : 0,
    rpv: sessions > 0 ? roundMetric(revenue / sessions) : 0,
    aov: transactions > 0 ? roundMetric(revenue / transactions) : 0,
  };
}

// ── hook ─────────────────────────────────────────────────────────────────────

export function useGA4Data() {
  const clientId = useAuthStore((s) => s.clientId);

  return useQuery<GA4DataResult>({
    queryKey: ["ga4Data", clientId],
    queryFn: async () => {
      if (!clientId) throw new Error("No client ID");

      const [clientSnap, experimentsSnap] = await Promise.all([
        getDoc(doc(db, "clients", clientId)),
        getDocs(collection(db, "clients", clientId, "experiments")),
      ]);

      if (!clientSnap.exists()) throw new Error("Client not found");
      const ga4PropertyId = clientSnap.data().ga4PropertyId as string | undefined;
      if (!ga4PropertyId) throw new Error("No GA4 property configured for this client.");

      // Build Firestore metadata map (source of truth for names, dates, variations)
      const firestoreMap = new Map<string, FirestoreExperimentMeta>();
      for (const d of experimentsSnap.docs) {
        const raw = d.data() as Record<string, unknown>;
        const exp = (raw.experiment ?? raw) as Record<string, unknown>;
        // Use the document ID (= Convert experiment ID) as the key
        const id = String(exp.id ?? d.id);
        firestoreMap.set(id, buildFirestoreMeta(raw, id));
      }

      if (firestoreMap.size === 0) {
        return { experiments: [], propertyId: ga4PropertyId };
      }

      // POST experiment dates to server — only for experiments we have in Firestore
      const experimentDates: Record<string, { startDate: string; endDate: string }> = {};
      for (const [id, meta] of firestoreMap) {
        experimentDates[id] = { startDate: meta.startDate, endDate: meta.endDate };
      }

      const resp = await fetch(`${API_BASE}/api/ga4/experiment-data`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ propertyId: ga4PropertyId, experimentDates }),
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error ?? "Failed to fetch GA4 data");
      }
      const ga4Data = (await resp.json()) as { experiments: GA4Experiment[] };

      // Index GA4 results by experimentId for fast lookup
      const ga4Map = new Map(ga4Data.experiments.map((e) => [e.experimentId, e]));

      // Build enriched list for ALL Firestore experiments.
      // If an experiment has no GA4 audiences, it still appears with 0 metrics
      // so the count matches what the admin sees in the Convert dashboard.
      const enriched: GA4EnrichedExperiment[] = Array.from(firestoreMap.entries()).map(
        ([experimentId, meta]) => {
          const ga4Exp = ga4Map.get(experimentId);

          const ga4Variations = ga4Exp?.variations ?? [];
          const variantSummaries: VariantSummary[] =
            ga4Variations.length > 0
              ? ga4Variations.map((v) => {
                  const convertInfo = meta.variations.get(v.variationId);
                  return ga4VariationToVariantSummary(v, convertInfo);
                })
              : // No GA4 audiences found — build zero-metric summaries from Convert variation data
                Array.from(meta.variations.entries()).map(([vid, info]) => ({
                  id: vid,
                  name: info.name,
                  isOriginal: info.isOriginal,
                  trafficSplit: 0,
                  sessions: 0,
                  transactions: 0,
                  products: 0,
                  revenue: 0,
                  cvr: 0,
                  rpv: 0,
                  aov: 0,
                }));

          const uplifts = calculateUplifts(variantSummaries);

          return {
            experimentId,
            name: meta.name,
            status: meta.status,
            startDate: ga4Exp?.startDate ?? meta.startDate,
            endDate: ga4Exp?.endDate ?? meta.endDate,
            variations: ga4Variations,
            variantSummaries,
            uplifts,
          };
        }
      );

      return { experiments: enriched, propertyId: ga4PropertyId };
    },
    enabled: !!clientId,
    staleTime: 5 * 60 * 1000,
    retry: false,
  });
}
