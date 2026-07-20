// Fetch wrappers for the Analytics Reports Express routes (server/index.js), all
// attaching the caller's Firebase ID token via fetchWithAuth. No Next.js API-route
// equivalent existed in this app before this port — every function here is new.
import { fetchWithAuth } from "@/lib/apiClient";
import type { GA4Property } from "@/types";
import type { FunnelResponse, MetadataResponse, ResolvedRange } from "./types";

async function readJsonOrThrow<T>(resp: Response, fallbackMessage: string): Promise<T> {
  if (!resp.ok) {
    const body = await resp.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? fallbackMessage);
  }
  return resp.json();
}

/** Every GA4 property the service account can see — reuses the existing
 *  /api/ga4/properties route (also used by the Convert-experiment GA4 feature), not a
 *  new endpoint. Returns this app's GA4Property shape (bare propertyId), not
 *  GA4-simply-layer's own "properties/123"-prefixed PropertySummary shape. */
export async function listGa4Properties(): Promise<GA4Property[]> {
  const resp = await fetchWithAuth("/api/ga4/properties");
  const data = await readJsonOrThrow<{ properties?: GA4Property[] }>(resp, "Failed to load GA4 properties");
  return data.properties ?? [];
}

export async function getGa4ReportsMetadata(property: string): Promise<MetadataResponse> {
  const resp = await fetchWithAuth(`/api/ga4-reports/metadata?property=${encodeURIComponent(property)}`);
  return readJsonOrThrow<MetadataResponse>(resp, "Failed to load GA4 metadata");
}

export async function getGa4ReportsValues(property: string, dimension: string): Promise<string[]> {
  const resp = await fetchWithAuth(
    `/api/ga4-reports/values?property=${encodeURIComponent(property)}&dimension=${encodeURIComponent(dimension)}`
  );
  const data = await readJsonOrThrow<{ values?: string[] }>(resp, "Failed to load dimension values");
  return data.values ?? [];
}

export interface FetchGa4ReportDataParams {
  clientId: string;
  reportId: string;
  rangeA: ResolvedRange;
  rangeB?: ResolvedRange | null;
  /** Optional override, used by the metric carousel to browse one metric/dimension at a
   *  time without editing the saved report. `metrics` must be a subset of the report's
   *  own metrics (enforced server-side); `dimensions` can be any valid GA4 dimension list
   *  since it never changes which GA4 property/metrics are being read. */
  metrics?: string[];
  dimensions?: string[];
  signal?: AbortSignal;
}

export async function fetchGa4ReportData(params: FetchGa4ReportDataParams): Promise<import("./types").ReportResponse> {
  const { clientId, reportId, rangeA, rangeB, metrics, dimensions, signal } = params;
  const resp = await fetchWithAuth("/api/ga4-reports/data", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ clientId, reportId, rangeA, rangeB: rangeB ?? null, metrics, dimensions }),
    signal,
  });
  return readJsonOrThrow(resp, "Failed to load report data");
}

export interface FetchGa4FunnelDataParams {
  clientId: string;
  reportId: string;
  funnelId: string;
  rangeA: ResolvedRange;
  rangeB?: ResolvedRange | null;
  signal?: AbortSignal;
}

export interface Ga4FunnelDataResult {
  current: FunnelResponse;
  previous: FunnelResponse | null;
}

export async function fetchGa4FunnelData(params: FetchGa4FunnelDataParams): Promise<Ga4FunnelDataResult> {
  const { clientId, reportId, funnelId, rangeA, rangeB, signal } = params;
  const resp = await fetchWithAuth("/api/ga4-reports/funnel", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ clientId, reportId, funnelId, rangeA, rangeB: rangeB ?? null }),
    signal,
  });
  return readJsonOrThrow<Ga4FunnelDataResult>(resp, "Failed to load funnel data");
}
