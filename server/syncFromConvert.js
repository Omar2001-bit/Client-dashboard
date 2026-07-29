const admin = require("firebase-admin");
const crypto = require("node:crypto");
const { readConvertCredential } = require("./lib/encryption");

const CONVERT_BASE = "https://api.convert.com/api/v2";
const REVENUE_GOAL_ID = 100479285;
const REQUEST_DELAY_MS = 6_000;
const NAMING_REGEX = /^id\s*\d+\s*[|[(]/i;

function matchesNamingConvention(name) {
  return typeof name === "string" && NAMING_REGEX.test(name);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function signHeaders(keyId, keySecret, url, body) {
  const expires = Math.floor(Date.now() / 1000) + 60;
  const message = `${keyId}\n${expires}\n${url}\n${body}`;
  const sig = crypto.createHmac("sha256", keySecret).update(message).digest("hex");
  return {
    "Content-Type": "application/json",
    "Convert-Application-ID": keyId,
    "Expires": String(expires),
    "Authorization": `Convert-HMAC-SHA256 Signature=${sig}`,
  };
}

async function fetchWithRetry(url, body, keyId, keySecret, maxAttempts = 5) {
  let lastError = null;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: signHeaders(keyId, keySecret, url, body),
        body,
      });
      if (res.ok) return await res.json();
      const text = await res.text();
      const isRateLimited = res.status === 429 || (res.status === 500 && /too many requests|rate/i.test(text));
      if (isRateLimited && attempt < maxAttempts - 1) {
        await sleep(1500 * Math.pow(2, attempt) + Math.random() * 500);
        continue;
      }
      throw new Error(`Convert API ${res.status}: ${text.slice(0, 200)}`);
    } catch (err) {
      lastError = err;
      if (!/too many requests|rate|429|Convert API 500/i.test(err.message)) throw err;
    }
  }
  throw lastError ?? new Error("Convert API request failed after retries.");
}

async function syncClientIncremental(clientId) {
  const db = admin.firestore();

  const credSnap = await db.collection("clients").doc(clientId)
    .collection("credentials").doc("convert").get();
  if (!credSnap.exists) {
    console.log(`[sync] No credentials for client ${clientId}, skipping`);
    return { newCount: 0, updatedCount: 0 };
  }
  const { accountId, projectId, keyId: rawKeyId, keySecret: rawKeySecret } = credSnap.data();
  const keyId = readConvertCredential(rawKeyId);
  const keySecret = readConvertCredential(rawKeySecret);
  if (!accountId || !projectId || !keyId || !keySecret) {
    console.log(`[sync] Incomplete credentials for client ${clientId}, skipping`);
    return { newCount: 0, updatedCount: 0 };
  }

  const clientSnap = await db.collection("clients").doc(clientId).get();
  const clientData = clientSnap.data() ?? {};
  const startDate = clientData.contractStartDate?.toDate?.() ?? new Date(0);
  const engagementEnd = clientData.contractEndDate?.toDate?.() ?? new Date();
  const reportEnd = new Date(Math.min(engagementEnd.getTime(), Date.now()));
  const startTime = Math.floor(startDate.getTime() / 1000);
  const endTime = Math.floor(reportEnd.getTime() / 1000);

  // List all experiments
  const PAGE_SIZE = 50;
  const experiences = [];
  let listingCount = 0;
  for (let page = 1; page <= 20; page++) {
    if (listingCount > 0) await sleep(REQUEST_DELAY_MS);
    const listUrl = `${CONVERT_BASE}/accounts/${accountId}/projects/${projectId}/experiences`;
    const listBody = JSON.stringify({
      results_per_page: PAGE_SIZE, page,
      sort_by: "id", sort_direction: "asc",
      include: ["variations", "goals", "audiences", "locations"],
      expand: ["variations", "goals", "audiences", "locations"],
    });
    const json = await fetchWithRetry(listUrl, listBody, keyId, keySecret);
    listingCount++;
    const items = json.data ?? [];
    experiences.push(...items);
    if (items.length < PAGE_SIZE) break;
  }

  const conventioned = experiences.filter((e) => matchesNamingConvention(e.name));

  const existingSnap = await db.collection("clients").doc(clientId).collection("experiments").get();
  const existingMap = new Map(existingSnap.docs.map((d) => [d.id, d.data()]));

  const toFetch = conventioned.filter((exp) => {
    const expId = String(exp.id);
    const existing = existingMap.get(expId);
    if (!existing) return true;
    const convertStatus = String(exp.status ?? "").toLowerCase();
    const storedStatus = String(existing.experiment?.status ?? "").toLowerCase();
    return convertStatus !== storedStatus || convertStatus === "running" || convertStatus === "paused";
  });

  const newCount = toFetch.filter((exp) => !existingMap.has(String(exp.id))).length;
  const updatedCount = toFetch.length - newCount;
  console.log(`[sync] Client ${clientId}: ${conventioned.length} conventioned, ${newCount} new, ${updatedCount} to update`);

  if (toFetch.length === 0) return { newCount: 0, updatedCount: 0 };

  // Fetch reports
  const enriched = [];
  for (let i = 0; i < toFetch.length; i++) {
    if (i > 0 || listingCount > 0) await sleep(REQUEST_DELAY_MS);
    const exp = toFetch[i];

    const aggUrl = `${CONVERT_BASE}/accounts/${accountId}/projects/${projectId}/experiences/${exp.id}/aggregated_report`;
    const aggBody = JSON.stringify({ utc_offset: 0, start_time: startTime, end_time: endTime });
    let report = null;
    try { report = await fetchWithRetry(aggUrl, aggBody, keyId, keySecret); }
    catch (err) { console.warn(`[sync] aggregated_report failed for ${exp.id}:`, err.message); }

    await sleep(REQUEST_DELAY_MS);
    const expStart = exp.start_time ? Math.max(startTime, Number(exp.start_time)) : startTime;
    const dailyUrl = `${CONVERT_BASE}/accounts/${accountId}/projects/${projectId}/experiences/${exp.id}/daily_report`;
    const metrics = [
      ["revenue", "avg_revenue_per_visitor"],
      ["conversions", "conversion_rate"],
      ["products", "avg_products_ordered_per_visitor"],
    ];
    const dailyReports = { revenue: null, conversions: null, products: null };
    for (let mi = 0; mi < metrics.length; mi++) {
      const [bucket, metric] = metrics[mi];
      if (mi > 0) await sleep(REQUEST_DELAY_MS);
      const dailyBody = JSON.stringify({
        utc_offset: 0, start_time: expStart, end_time: endTime,
        report_type: "non_cumulative", metric, goal_id: REVENUE_GOAL_ID,
      });
      try { dailyReports[bucket] = await fetchWithRetry(dailyUrl, dailyBody, keyId, keySecret); }
      catch (err) { console.warn(`[sync] daily_report(${metric}) failed for ${exp.id}:`, err.message); }
    }

    enriched.push({ experiment: exp, report, dailyReport: dailyReports.revenue, dailyReports });
  }

  // Write to Firestore (upsert, no deletions)
  const BATCH_LIMIT = 450;
  let batch = db.batch();
  let batchOps = 0;
  const flush = async () => {
    if (batchOps >= BATCH_LIMIT) { await batch.commit(); batch = db.batch(); batchOps = 0; }
  };

  for (const { experiment, report, dailyReport, dailyReports } of enriched) {
    const ref = db.collection("clients").doc(clientId).collection("experiments").doc(String(experiment.id));
    batch.set(ref, { experiment, report, dailyReport, dailyReports, updatedAt: admin.firestore.FieldValue.serverTimestamp() });
    batchOps++;
    await flush();
  }

  const statusRef = db.collection("clients").doc(clientId).collection("syncStatus").doc("convert");
  batch.set(statusRef, { lastIncrementalSyncAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
  batchOps++;

  if (batchOps > 0) await batch.commit();
  return { newCount, updatedCount };
}

async function incrementalSyncAllClients() {
  const db = admin.firestore();
  console.log("[scheduled-sync] Starting incremental sync for all active clients…");

  const clientsSnap = await db.collection("clients").where("status", "==", "active").get();
  console.log(`[scheduled-sync] ${clientsSnap.size} active client(s) found`);

  for (const clientDoc of clientsSnap.docs) {
    const clientName = clientDoc.data().name ?? clientDoc.id;
    try {
      console.log(`[scheduled-sync] → ${clientName}`);
      const result = await syncClientIncremental(clientDoc.id);
      console.log(`[scheduled-sync] ✓ ${clientName}: ${result.newCount} new, ${result.updatedCount} updated`);
    } catch (err) {
      console.error(`[scheduled-sync] ✗ ${clientName}:`, err.message);
    }
  }

  console.log("[scheduled-sync] Done.");
}

module.exports = { incrementalSyncAllClients, syncClientIncremental };
