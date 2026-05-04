/**
 * Deep verification: reads actual experiment dates from Firestore,
 * then fetches GA4 metrics for each experiment using those exact dates.
 * Run: node ga4-verify-dates.js <clientId>
 */

const { google } = require("googleapis");
const admin = require("firebase-admin");
const serviceAccount = require("../functions/serviceAccountKey.json");
const ga4SA = require("./ga4ServiceAccount.json");

const PROPERTY_ID = "268549624";

if (!admin.apps.length) {
  admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
}
const db = admin.firestore();

function getGA4Auth() {
  return new google.auth.GoogleAuth({
    credentials: ga4SA,
    scopes: ["https://www.googleapis.com/auth/analytics.readonly"],
  });
}

function parseConvertAudience(audience) {
  const match = audience.displayName?.match(/^Convert (\d+)-(\d+)\s*(.*)$/);
  if (!match) return null;
  const [, experimentId, variationId, description] = match;
  return {
    audienceId: audience.name?.split("/").pop(),
    experimentId,
    variationId,
    description: description.trim(),
    isOriginal: description.toLowerCase().includes("original"),
    displayName: audience.displayName,
  };
}

function toISODate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

function toDate(value) {
  if (!value) return null;
  if (typeof value === "object" && value.seconds != null) return new Date(value.seconds * 1000);
  if (typeof value === "number") return new Date(value > 1e12 ? value : value * 1000);
  const p = new Date(String(value));
  return isNaN(p.getTime()) ? null : p;
}

async function main() {
  const clientId = process.argv[2];
  if (!clientId) {
    console.error("Usage: node ga4-verify-dates.js <clientId>");
    process.exit(1);
  }

  // ── 1. Load Firestore experiments ─────────────────────────────────────────
  console.log(`\n=== Loading Firestore experiments for client ${clientId} ===\n`);
  const expSnap = await db.collection("clients").doc(clientId).collection("experiments").get();
  console.log(`Firestore experiments: ${expSnap.size}`);

  const firestoreMeta = new Map();
  for (const doc of expSnap.docs) {
    const raw = doc.data();
    const exp = raw.experiment ?? raw;
    const id = String(exp.id ?? doc.id);
    const startD = toDate(exp.start_time ?? exp.start_date ?? exp.created_at);
    const endD = toDate(exp.end_time ?? exp.end_date);
    const status = String(exp.status ?? "").toLowerCase();
    firestoreMeta.set(id, {
      name: String(exp.name ?? `Exp ${id}`),
      status,
      startDate: startD ? toISODate(startD) : null,
      endDate: endD ? toISODate(endD) : "today",
    });
  }

  // ── 2. Load GA4 audiences ─────────────────────────────────────────────────
  console.log("\n=== Loading GA4 audiences ===\n");
  const auth = getGA4Auth();
  const analyticsAdmin = google.analyticsadmin({ version: "v1alpha", auth });
  const analyticsData = google.analyticsdata({ version: "v1beta", auth });

  let allAudiences = [];
  let pageToken;
  do {
    const r = await analyticsAdmin.properties.audiences.list({
      parent: `properties/${PROPERTY_ID}`,
      pageSize: 200,
      ...(pageToken ? { pageToken } : {}),
    });
    allAudiences = allAudiences.concat(r.data.audiences || []);
    pageToken = r.data.nextPageToken;
  } while (pageToken);

  const convertAudiences = allAudiences.map(parseConvertAudience).filter(Boolean);
  const audiencesByExp = {};
  for (const a of convertAudiences) {
    if (!audiencesByExp[a.experimentId]) audiencesByExp[a.experimentId] = [];
    audiencesByExp[a.experimentId].push(a);
  }

  // ── 3. Match and validate every experiment ────────────────────────────────
  console.log("=== Experiment-by-experiment validation ===\n");

  let matched = 0, noGA4 = 0, noDate = 0, hasData = 0, noData = 0;
  const BATCH = 5;
  const knownIds = [...firestoreMeta.keys()].filter(id => audiencesByExp[id]);
  const missingFromGA4 = [...firestoreMeta.keys()].filter(id => !audiencesByExp[id]);

  console.log(`Firestore experiments with GA4 audiences: ${knownIds.length}`);
  console.log(`Firestore experiments WITHOUT GA4 audiences: ${missingFromGA4.length}`);
  if (missingFromGA4.length) console.log(`  Missing: ${missingFromGA4.join(", ")}`);

  // Process in batches of 5
  const results = [];
  for (let i = 0; i < knownIds.length; i += BATCH) {
    const chunk = knownIds.slice(i, i + BATCH);
    const batchRes = await Promise.all(chunk.map(async (experimentId) => {
      const meta = firestoreMeta.get(experimentId);
      const audiences = audiencesByExp[experimentId];
      const startDate = meta.startDate || "365daysAgo";
      const endDate = meta.endDate || "today";
      const audienceIdSet = new Set(audiences.map(a => a.audienceId));

      try {
        const r = await analyticsData.properties.runReport({
          property: `properties/${PROPERTY_ID}`,
          requestBody: {
            dimensions: [{ name: "audienceId" }],
            metrics: [
              { name: "activeUsers" }, { name: "sessions" },
              { name: "purchaseRevenue" }, { name: "transactions" }, { name: "itemsPurchased" },
            ],
            dateRanges: [{ startDate, endDate }],
            keepEmptyRows: false,
          },
        });

        const metricsMap = {};
        for (const row of r.data.rows || []) {
          const id = row.dimensionValues[0].value;
          if (!audienceIdSet.has(id)) continue;
          metricsMap[id] = {
            activeUsers: parseInt(row.metricValues[0].value || "0"),
            sessions: parseInt(row.metricValues[1].value || "0"),
            revenue: parseFloat(row.metricValues[2].value || "0"),
            transactions: parseInt(row.metricValues[3].value || "0"),
            products: parseInt(row.metricValues[4].value || "0"),
          };
        }

        const anyData = Object.keys(metricsMap).length > 0;
        const totalUsers = Object.values(metricsMap).reduce((s, m) => s + m.activeUsers, 0);
        const totalRev = Object.values(metricsMap).reduce((s, m) => s + m.revenue, 0);

        return { experimentId, meta, startDate, endDate, audiences, metricsMap, anyData, totalUsers, totalRev };
      } catch (err) {
        return { experimentId, meta, startDate, endDate, audiences, metricsMap: {}, anyData: false, error: err.message };
      }
    }));
    results.push(...batchRes);
  }

  // Print results
  results.sort((a, b) => a.experimentId.localeCompare(b.experimentId));

  let dateOk = 0, dateFallback = 0;
  for (const r of results) {
    const dateLabel = r.meta.startDate ? `${r.startDate} → ${r.endDate}` : `FALLBACK (no start_time)`;
    if (r.meta.startDate) dateOk++; else dateFallback++;
    const status = r.anyData ? "✓" : "✗";
    const usersStr = r.anyData ? `users=${r.totalUsers}  rev=$${r.totalRev.toFixed(0)}` : "NO DATA";
    console.log(`${status} ${r.experimentId} | ${dateLabel} | ${r.audiences.length} var(s) | ${usersStr}`);
    if (r.error) console.log(`  ERROR: ${r.error}`);
    if (r.anyData) {
      for (const a of r.audiences) {
        const m = r.metricsMap[a.audienceId];
        if (m) console.log(`    ${a.audienceId} (var ${a.variationId}): users=${m.activeUsers} sessions=${m.sessions} rev=$${m.revenue.toFixed(0)} txn=${m.transactions}`);
        else console.log(`    ${a.audienceId} (var ${a.variationId}): no rows in date range`);
      }
    }
  }

  const withData = results.filter(r => r.anyData).length;
  const withoutData = results.filter(r => !r.anyData && !r.error).length;
  const withError = results.filter(r => r.error).length;

  console.log(`\n=== Summary ===`);
  console.log(`Firestore total:         ${expSnap.size}`);
  console.log(`Has GA4 audience:        ${knownIds.length}`);
  console.log(`No GA4 audience:         ${missingFromGA4.length}  → shown with 0 metrics`);
  console.log(`Has date in Firestore:   ${dateOk}  (uses actual experiment period)`);
  console.log(`No date in Firestore:    ${dateFallback}  (fallback: 365daysAgo→today)`);
  console.log(`Returns GA4 data:        ${withData}`);
  console.log(`No GA4 data in range:    ${withoutData}`);
  console.log(`Errors:                  ${withError}`);
}

main().catch(e => { console.error(e); process.exit(1); });
