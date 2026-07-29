import { collection, doc, getDoc, getDocs, serverTimestamp, writeBatch, setDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { matchesNamingConvention } from "@/lib/namingConvention";
import { fetchWithAuth, readJsonOrThrow } from "@/lib/apiClient";

const CONVERT_BASE = "https://api.convert.com/api/v2";
const REVENUE_GOAL_ID = 100479285;

// Pacing: 6 seconds between any Convert API request. Retry logic handles 429s automatically.
const REQUEST_DELAY_MS = 6_000;

interface ConvertCred {
  accountId?: string;
  projectId?: string;
  keyId?: string;
  keySecret?: string;
}

export interface SyncProgress {
  phase: "idle" | "listing" | "reports" | "writing" | "done" | "error";
  fetched: number;
  total: number;
  message?: string;
}

export interface SyncResult {
  experimentCount: number;
  syncedAt: Date;
  failedCount: number;
}

/**
 * Fetches a client's Convert credentials from the server, which decrypts keyId/keySecret
 * before returning them. Credentials may be AES-256-GCM encrypted at rest (after a
 * rotation) and the browser has no safe way to decrypt them itself.
 */
async function fetchConvertCredentials(clientId: string): Promise<ConvertCred> {
  const resp = await fetchWithAuth("/api/convert/credentials", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ clientId }),
  });
  return readJsonOrThrow<ConvertCred>(resp, "Failed to load Convert credentials.");
}

/**
 * Pulls all experiments + reports from Convert and writes each as its own
 * Firestore document under /clients/{clientId}/experiments/{experimentId}.
 * Stale documents (deleted on Convert) are removed.
 */
export async function syncFromConvert(
  clientId: string,
  onProgress?: (p: SyncProgress) => void
): Promise<SyncResult> {
  const progress = (p: SyncProgress) => onProgress?.(p);

  // 1. Read credentials
  const cred = await fetchConvertCredentials(clientId);

  const accountId = String(cred.accountId ?? "");
  const projectId = String(cred.projectId ?? "");
  const keyId = String(cred.keyId ?? "");
  const keySecret = String(cred.keySecret ?? "");
  if (!accountId || !projectId || !keyId || !keySecret) {
    throw new Error("Convert credentials are incomplete.");
  }

  const clientSnap = await getDoc(doc(db, "clients", clientId));
  const startDate = (clientSnap.data()?.contractStartDate?.toDate?.() ?? new Date(0)) as Date;
  const engagementEndDate = (clientSnap.data()?.contractEndDate?.toDate?.() ?? new Date()) as Date;
  const reportEndDate = new Date(Math.min(engagementEndDate.getTime(), Date.now()));
  const startTime = Math.floor(startDate.getTime() / 1000);
  const endTime = Math.floor(reportEndDate.getTime() / 1000);

  // 2. List all experiments (paginated). NO status filter — all statuses are pulled
  //    so archived/paused/running/completed conventioned experiments are included.
  progress({ phase: "listing", fetched: 0, total: 0, message: "Listing experiments…" });
  const PAGE_SIZE = 50;
  const MAX_PAGES = 20;
  const experiences: Array<Record<string, unknown>> = [];
  let listingRequestCount = 0;

  for (let pageNum = 1; pageNum <= MAX_PAGES; pageNum++) {
    if (listingRequestCount > 0) await sleep(REQUEST_DELAY_MS);

    const listUrl = `${CONVERT_BASE}/accounts/${accountId}/projects/${projectId}/experiences`;
    const listBody = JSON.stringify({
      results_per_page: PAGE_SIZE,
      page: pageNum,
      sort_by: "id",
      sort_direction: "asc",
      include: ["variations", "goals", "audiences", "locations"],
      expand: ["variations", "goals", "audiences", "locations"],
    });
    const json = await fetchWithRetry(listUrl, listBody, keyId, keySecret);
    listingRequestCount++;
    const pageItems = (json.data ?? []) as Array<Record<string, unknown>>;
    experiences.push(...pageItems);
    progress({ phase: "listing", fetched: experiences.length, total: experiences.length });
    if (pageItems.length < PAGE_SIZE) break;
  }

  // 3. Filter to ONLY experiments matching the naming convention, regardless of status.
  const conventioned = experiences.filter((exp) => matchesNamingConvention(exp.name));
  progress({
    phase: "listing",
    fetched: conventioned.length,
    total: conventioned.length,
    message: `Found ${conventioned.length} conventioned experiments out of ${experiences.length} total`,
  });

  // 4. Reports — strictly sequential, 20 seconds between each request.
  // For each experiment: aggregated_report (totals) + daily_report (per-day revenue).
  progress({ phase: "reports", fetched: 0, total: conventioned.length });
  const enriched: Array<{
    experiment: Record<string, unknown>;
    report: Record<string, unknown> | null;
    dailyReport: Record<string, unknown> | null;
    dailyReports: {
      revenue: Record<string, unknown> | null;
      conversions: Record<string, unknown> | null;
      products: Record<string, unknown> | null;
    };
  }> = [];
  const failedExperimentIds = new Set<string>();

  for (let i = 0; i < conventioned.length; i++) {
    if (i > 0 || listingRequestCount > 0) await sleep(REQUEST_DELAY_MS);

    const exp = conventioned[i];

    // Aggregated report (existing)
    const aggUrl = `${CONVERT_BASE}/accounts/${accountId}/projects/${projectId}/experiences/${exp.id}/aggregated_report`;
    const aggBody = JSON.stringify({ utc_offset: 0, start_time: startTime, end_time: endTime });
    let report: Record<string, unknown> | null = null;
    try {
      report = await fetchWithRetry(aggUrl, aggBody, keyId, keySecret);
    } catch (err) {
      console.warn(`[convertSync] aggregated_report failed for ${exp.id}:`, (err as Error).message);
      failedExperimentIds.add(String(exp.id));
    }

    // Daily reports — revenue, conversions, products (non-cumulative, per-variant).
    // All three are needed so the date range filter can recompute CVR, AOV, and products correctly.
    await sleep(REQUEST_DELAY_MS);
    const expStartTime = exp.start_time ? Math.max(startTime, Number(exp.start_time)) : startTime;
    const dailyUrl = `${CONVERT_BASE}/accounts/${accountId}/projects/${projectId}/experiences/${exp.id}/daily_report`;
    const metricRequests = [
      ["revenue", "avg_revenue_per_visitor"],
      ["conversions", "conversion_rate"],
      ["products", "avg_products_ordered_per_visitor"],
    ] as const;
    const dailyReports: {
      revenue: Record<string, unknown> | null;
      conversions: Record<string, unknown> | null;
      products: Record<string, unknown> | null;
    } = { revenue: null, conversions: null, products: null };

    for (let metricIndex = 0; metricIndex < metricRequests.length; metricIndex++) {
      const [bucket, metric] = metricRequests[metricIndex];
      if (metricIndex > 0) await sleep(REQUEST_DELAY_MS);
      const dailyBody = JSON.stringify({
        utc_offset: 0,
        start_time: expStartTime,
        end_time: endTime,
        report_type: "non_cumulative",
        metric,
        goal_id: REVENUE_GOAL_ID,
      });
      try {
        dailyReports[bucket] = await fetchWithRetry(dailyUrl, dailyBody, keyId, keySecret);
      } catch (err) {
        console.warn(`[convertSync] daily_report(${metric}) failed for ${exp.id}:`, (err as Error).message);
        failedExperimentIds.add(String(exp.id));
      }
    }

    enriched.push({ experiment: exp, report, dailyReport: dailyReports.revenue, dailyReports });
    progress({ phase: "reports", fetched: i + 1, total: conventioned.length });
  }

  // 4. Write to Firestore — batched (max 500 ops per batch)
  progress({ phase: "writing", fetched: 0, total: enriched.length, message: "Writing to Firestore…" });

  // Find existing docs to clean up stale ones
  const existingSnap = await getDocs(collection(db, "clients", clientId, "experiments"));
  const existingIds = new Set(existingSnap.docs.map((d) => d.id));
  const newIds = new Set(enriched.map((e) => String(e.experiment.id)));

  const BATCH_LIMIT = 450; // leave headroom under 500
  let batch = writeBatch(db);
  let batchOps = 0;

  const flushIfNeeded = async () => {
    if (batchOps >= BATCH_LIMIT) {
      await batch.commit();
      batch = writeBatch(db);
      batchOps = 0;
    }
  };

  for (const { experiment, report, dailyReport, dailyReports } of enriched) {
    const expId = String(experiment.id);
    const ref = doc(db, "clients", clientId, "experiments", expId);
    batch.set(ref, {
      experiment,
      report,
      dailyReport,
      dailyReports,
      updatedAt: serverTimestamp(),
    });
    batchOps++;
    await flushIfNeeded();
  }

  // Delete stale docs
  for (const oldId of existingIds) {
    if (!newIds.has(oldId)) {
      batch.delete(doc(db, "clients", clientId, "experiments", oldId));
      batchOps++;
      await flushIfNeeded();
    }
  }

  // Sync status doc
  batch.set(doc(db, "clients", clientId, "syncStatus", "convert"), {
    lastSyncedAt: serverTimestamp(),
    experimentCount: enriched.length,
  });
  batchOps++;

  if (batchOps > 0) await batch.commit();

  progress({ phase: "done", fetched: enriched.length, total: enriched.length });
  return { experimentCount: enriched.length, syncedAt: new Date(), failedCount: failedExperimentIds.size };
}

// ---- HTTP helpers ----

async function fetchWithRetry(
  url: string,
  body: string,
  keyId: string,
  keySecret: string,
  maxAttempts = 5
): Promise<{ data?: unknown[] } & Record<string, unknown>> {
  let lastError: Error | null = null;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: await signHeaders(keyId, keySecret, url, body),
        body,
      });
      if (res.ok) return await res.json();

      const text = await res.text();
      const isRateLimited =
        res.status === 429 ||
        (res.status === 500 && /too many requests|rate/i.test(text));

      if (isRateLimited && attempt < maxAttempts - 1) {
        await sleep(1500 * 2 ** attempt + Math.random() * 500);
        continue;
      }
      throw new Error(`Convert API ${res.status}: ${text.slice(0, 200)}`);
    } catch (err) {
      lastError = err as Error;
      if ((err as Error).message?.includes("Failed to fetch")) {
        throw new Error("Convert API blocked by browser CORS - needs a server proxy.", { cause: err });
      }
      if (!/too many requests|rate|429|Convert API 500/i.test((err as Error).message)) {
        throw err;
      }
    }
  }
  throw lastError ?? new Error("Convert API request failed after retries.");
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}


/**
 * Incremental pull — only fetches experiments that are new, have changed status,
 * or are still running (metrics change daily). Never deletes existing Firestore docs.
 */
export async function pullNewFromConvert(
  clientId: string,
  onProgress?: (p: SyncProgress) => void
): Promise<SyncResult & { newCount: number; updatedCount: number }> {
  const progress = (p: SyncProgress) => onProgress?.(p);

  // 1. Credentials
  const cred = await fetchConvertCredentials(clientId);
  const accountId = String(cred.accountId ?? "");
  const projectId = String(cred.projectId ?? "");
  const keyId = String(cred.keyId ?? "");
  const keySecret = String(cred.keySecret ?? "");
  if (!accountId || !projectId || !keyId || !keySecret) throw new Error("Convert credentials are incomplete.");

  const clientSnap = await getDoc(doc(db, "clients", clientId));
  const startDate = (clientSnap.data()?.contractStartDate?.toDate?.() ?? new Date(0)) as Date;
  const engagementEndDate = (clientSnap.data()?.contractEndDate?.toDate?.() ?? new Date()) as Date;
  const reportEndDate = new Date(Math.min(engagementEndDate.getTime(), Date.now()));
  const startTime = Math.floor(startDate.getTime() / 1000);
  const endTime = Math.floor(reportEndDate.getTime() / 1000);

  // 2. List all experiments from Convert
  progress({ phase: "listing", fetched: 0, total: 0, message: "Listing experiments…" });
  const PAGE_SIZE = 50;
  const MAX_PAGES = 20;
  const experiences: Array<Record<string, unknown>> = [];
  let listingRequestCount = 0;

  for (let pageNum = 1; pageNum <= MAX_PAGES; pageNum++) {
    if (listingRequestCount > 0) await sleep(REQUEST_DELAY_MS);
    const listUrl = `${CONVERT_BASE}/accounts/${accountId}/projects/${projectId}/experiences`;
    const listBody = JSON.stringify({
      results_per_page: PAGE_SIZE, page: pageNum,
      sort_by: "id", sort_direction: "asc",
      include: ["variations", "goals", "audiences", "locations"],
      expand: ["variations", "goals", "audiences", "locations"],
    });
    const json = await fetchWithRetry(listUrl, listBody, keyId, keySecret);
    listingRequestCount++;
    const pageItems = (json.data ?? []) as Array<Record<string, unknown>>;
    experiences.push(...pageItems);
    progress({ phase: "listing", fetched: experiences.length, total: experiences.length });
    if (pageItems.length < PAGE_SIZE) break;
  }

  // 3. Filter by naming convention
  const conventioned = experiences.filter((exp) => matchesNamingConvention(exp.name));

  // 4. Compare with existing Firestore docs
  const existingSnap = await getDocs(collection(db, "clients", clientId, "experiments"));
  const existingMap = new Map(existingSnap.docs.map((d) => [d.id, d.data()]));

  // 5. Decide what needs fetching: new, status-changed, or still running
  const toFetch = conventioned.filter((exp) => {
    const expId = String(exp.id);
    const existing = existingMap.get(expId);
    if (!existing) return true;
    const convertStatus = String(exp.status ?? "").toLowerCase();
    const storedStatus = String((existing.experiment as Record<string, unknown>)?.status ?? "").toLowerCase();
    return convertStatus !== storedStatus || convertStatus === "running" || convertStatus === "paused";
  });

  const newCount = toFetch.filter((exp) => !existingMap.has(String(exp.id))).length;
  const updatedCount = toFetch.length - newCount;

  progress({
    phase: "reports", fetched: 0, total: toFetch.length,
    message: toFetch.length === 0
      ? "Everything is already up to date."
      : `${newCount} new · ${updatedCount} to update`,
  });

  if (toFetch.length === 0) {
    progress({ phase: "done", fetched: 0, total: 0, message: "Everything is already up to date." });
    return { experimentCount: existingMap.size, syncedAt: new Date(), failedCount: 0, newCount: 0, updatedCount: 0 };
  }

  // 6. Fetch full reports for each experiment that needs it
  const enriched: Array<{
    experiment: Record<string, unknown>;
    report: Record<string, unknown> | null;
    dailyReport: Record<string, unknown> | null;
    dailyReports: { revenue: Record<string, unknown> | null; conversions: Record<string, unknown> | null; products: Record<string, unknown> | null };
  }> = [];
  const failedExperimentIds = new Set<string>();

  for (let i = 0; i < toFetch.length; i++) {
    if (i > 0 || listingRequestCount > 0) await sleep(REQUEST_DELAY_MS);
    const exp = toFetch[i];

    const aggUrl = `${CONVERT_BASE}/accounts/${accountId}/projects/${projectId}/experiences/${exp.id}/aggregated_report`;
    const aggBody = JSON.stringify({ utc_offset: 0, start_time: startTime, end_time: endTime });
    let report: Record<string, unknown> | null = null;
    try { report = await fetchWithRetry(aggUrl, aggBody, keyId, keySecret); }
    catch (err) {
      console.warn(`[pullNew] aggregated_report failed for ${exp.id}:`, (err as Error).message);
      failedExperimentIds.add(String(exp.id));
    }

    await sleep(REQUEST_DELAY_MS);
    const expStartTime = exp.start_time ? Math.max(startTime, Number(exp.start_time)) : startTime;
    const dailyUrl = `${CONVERT_BASE}/accounts/${accountId}/projects/${projectId}/experiences/${exp.id}/daily_report`;
    const metricRequests = [
      ["revenue", "avg_revenue_per_visitor"],
      ["conversions", "conversion_rate"],
      ["products", "avg_products_ordered_per_visitor"],
    ] as const;
    const dailyReports: { revenue: Record<string, unknown> | null; conversions: Record<string, unknown> | null; products: Record<string, unknown> | null } =
      { revenue: null, conversions: null, products: null };

    for (let mi = 0; mi < metricRequests.length; mi++) {
      const [bucket, metric] = metricRequests[mi];
      if (mi > 0) await sleep(REQUEST_DELAY_MS);
      const dailyBody = JSON.stringify({
        utc_offset: 0, start_time: expStartTime, end_time: endTime,
        report_type: "non_cumulative", metric, goal_id: REVENUE_GOAL_ID,
      });
      try { dailyReports[bucket] = await fetchWithRetry(dailyUrl, dailyBody, keyId, keySecret); }
      catch (err) {
        console.warn(`[pullNew] daily_report(${metric}) failed for ${exp.id}:`, (err as Error).message);
        failedExperimentIds.add(String(exp.id));
      }
    }

    enriched.push({ experiment: exp, report, dailyReport: dailyReports.revenue, dailyReports });
    progress({ phase: "reports", fetched: i + 1, total: toFetch.length });
  }

  // 7. Upsert into Firestore — no deletions
  progress({ phase: "writing", fetched: 0, total: enriched.length, message: "Writing to Firestore…" });

  const BATCH_LIMIT = 450;
  let batch = writeBatch(db);
  let batchOps = 0;
  const flushIfNeeded = async () => {
    if (batchOps >= BATCH_LIMIT) { await batch.commit(); batch = writeBatch(db); batchOps = 0; }
  };

  for (const { experiment, report, dailyReport, dailyReports } of enriched) {
    const ref = doc(db, "clients", clientId, "experiments", String(experiment.id));
    batch.set(ref, { experiment, report, dailyReport, dailyReports, updatedAt: serverTimestamp() });
    batchOps++;
    await flushIfNeeded();
  }

  await setDoc(
    doc(db, "clients", clientId, "syncStatus", "convert"),
    { lastIncrementalSyncAt: serverTimestamp() },
    { merge: true }
  );

  if (batchOps > 0) await batch.commit();

  progress({ phase: "done", fetched: enriched.length, total: enriched.length });
  return { experimentCount: existingMap.size + newCount, syncedAt: new Date(), failedCount: failedExperimentIds.size, newCount, updatedCount };
}

async function signHeaders(keyId: string, keySecret: string, url: string, body: string) {
  const expires = Math.floor(Date.now() / 1000) + 60;
  const message = `${keyId}\n${expires}\n${url}\n${body}`;
  const enc = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    "raw", enc.encode(keySecret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const sigBuf = await crypto.subtle.sign("HMAC", cryptoKey, enc.encode(message));
  const sig = Array.from(new Uint8Array(sigBuf)).map((b) => b.toString(16).padStart(2, "0")).join("");
  return {
    "Content-Type": "application/json",
    "Convert-Application-ID": keyId,
    "Expires": String(expires),
    "Authorization": `Convert-HMAC-SHA256 Signature=${sig}`,
  };
}
