const fs = require("fs");
const path = require("path");
const admin = require(path.join(process.cwd(), "functions", "node_modules", "firebase-admin"));

const PROJECT_ID = "client-dash-9b027";
const DATABASE_ID = "(default)";
const CLIENT_ID = "5mVRYDuQ3e6mB0dZ9b9w";
const CONVERT_BASE = "https://api.convert.com/api/v2";
const REVENUE_GOAL_ID = 100479285;
const NAMING_REGEX = /^id\s*\d+\s*[|[(]/i;
const REPORT_PATH = path.join(process.cwd(), "convert-firebase-audit-report.json");

async function main() {
  const db = getFirestore();
  const clientDoc = await firestoreGetDocument(db, `clients/${CLIENT_ID}`);
  const convertCreds = await firestoreGetDocument(db, `clients/${CLIENT_ID}/credentials/convert`);
  const firestoreExperiments = await firestoreListCollection(db, `clients/${CLIENT_ID}/experiments`);

  const accountId = String(convertCreds.accountId);
  const projectId = String(convertCreds.projectId);
  const keyId = String(convertCreds.keyId);
  const keySecret = String(convertCreds.keySecret);
  const contractStartMs = toDateMillis(clientDoc.contractStartDate) ?? 0;
  const contractEndMs = toDateMillis(clientDoc.contractEndDate) ?? Date.now();
  const reportEndMs = Math.min(contractEndMs, Date.now());

  const firestoreById = new Map(
    firestoreExperiments.map((doc) => [String(doc.experiment?.id ?? doc.id), doc]),
  );

  const convertExperiments = await listConvertExperiments({
    accountId,
    projectId,
    keyId,
    keySecret,
  });
  const convertNamed = convertExperiments.filter((exp) =>
    NAMING_REGEX.test(String(exp.name ?? "")),
  );
  const convertById = new Map(
    convertNamed.map((exp) => [String(exp.id), exp]),
  );

  const unionIds = Array.from(
    new Set([...firestoreById.keys(), ...convertById.keys()]),
  ).sort();

  const auditResults = await mapWithConcurrency(unionIds, 2, async (experimentId) => {
    const firestoreDoc = firestoreById.get(experimentId) ?? null;
    const convertExperiment = convertById.get(experimentId) ?? null;

    if (!firestoreDoc || !convertExperiment) {
      return {
        item: buildPresenceMismatch(experimentId, firestoreDoc, convertExperiment),
        appLiveSeries: [],
        convertSeries: [],
      };
    }

    const expStartMs = toExperimentStartMs(convertExperiment, firestoreDoc);
    const startTime = Math.floor(Math.max(contractStartMs, expStartMs) / 1000);
    const endTime = Math.floor(reportEndMs / 1000);

    const [liveAggregated, liveDaily] = await Promise.all([
      fetchConvertReport({
        accountId,
        projectId,
        keyId,
        keySecret,
        experimentId,
        endpoint: "aggregated_report",
        body: { utc_offset: 0, start_time: startTime, end_time: endTime },
      }),
      fetchConvertReport({
        accountId,
        projectId,
        keyId,
        keySecret,
        experimentId,
        endpoint: "daily_report",
        body: {
          utc_offset: 0,
          start_time: startTime,
          end_time: endTime,
          report_type: "non_cumulative",
          metric: "avg_revenue_per_visitor",
          goal_id: REVENUE_GOAL_ID,
        },
      }),
    ]);

    const appLiveSeries = buildChartSeries(
      firestoreDoc.experiment,
      firestoreDoc.report,
      firestoreDoc.dailyReport,
    );
    const convertSeries = buildChartSeries(
      convertExperiment,
      liveAggregated,
      liveDaily,
    );

    return {
      item: compareSeries({
        experimentId,
        firestoreDoc,
        convertExperiment,
        appLiveSeries,
        convertSeries,
      }),
      appLiveSeries,
      convertSeries,
    };
  });

  const appLiveAggregateSeries = aggregateSeries(
    auditResults.map((result) => ({ dateSeries: result.appLiveSeries ?? [] })),
  );
  const convertAggregateSeries = aggregateSeries(
    auditResults.map((result) => ({ dateSeries: result.convertSeries ?? [] })),
  );
  const aggregateComparison = compareAggregateSeries(appLiveAggregateSeries, convertAggregateSeries);
  const auditItems = auditResults.map((result) => result.item);

  const summary = buildSummary({
    firestoreCount: firestoreById.size,
    convertCount: convertById.size,
    items: auditItems,
    aggregateComparison,
  });

  const report = {
    generatedAt: new Date().toISOString(),
    projectId: PROJECT_ID,
    clientId: CLIENT_ID,
    firestoreExperimentCount: firestoreById.size,
    convertExperimentCount: convertById.size,
    summary,
    appLive: {
      pointCount: appLiveAggregateSeries.length,
      totalUplift: roundMoney(sumSeries(appLiveAggregateSeries)),
      seriesStart: appLiveAggregateSeries[0]?.date ?? null,
      seriesEnd: appLiveAggregateSeries[appLiveAggregateSeries.length - 1]?.date ?? null,
      vsConvert: aggregateComparison,
    },
    items: auditItems,
  };

  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({
    reportPath: REPORT_PATH,
    summary,
  }, null, 2));
}

function getFirestore() {
  if (admin.apps.length === 0) {
    const serviceAccountPath = path.join(process.cwd(), "functions", "serviceAccountKey.json");
    const serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, "utf8"));
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });
  }
  return admin.firestore();
}

async function firestoreGetDocument(db, documentPath) {
  const snap = await db.doc(documentPath).get();
  if (!snap.exists) {
    throw new Error(`Firestore document not found: ${documentPath}`);
  }
  return {
    id: snap.id,
    ...snap.data(),
  };
}

async function firestoreListCollection(db, collectionPath) {
  const snap = await db.collection(collectionPath).get();
  return snap.docs.map((doc) => ({
    id: doc.id,
    ...doc.data(),
  }));
}

async function listConvertExperiments({ accountId, projectId, keyId, keySecret }) {
  const rows = [];
  for (let page = 1; page <= 20; page += 1) {
    const body = {
      results_per_page: 50,
      page,
      sort_by: "id",
      sort_direction: "asc",
      include: ["variations", "goals", "audiences", "locations"],
      expand: ["variations", "goals", "audiences", "locations"],
    };
    const url = `${CONVERT_BASE}/accounts/${accountId}/projects/${projectId}/experiences`;
    const json = await postConvert(url, body, keyId, keySecret);
    const pageRows = json.data ?? [];
    rows.push(...pageRows);
    if (pageRows.length < 50) {
      break;
    }
  }
  return rows;
}

async function fetchConvertReport({
  accountId,
  projectId,
  keyId,
  keySecret,
  experimentId,
  endpoint,
  body,
}) {
  const url = `${CONVERT_BASE}/accounts/${accountId}/projects/${projectId}/experiences/${experimentId}/${endpoint}`;
  return postConvert(url, body, keyId, keySecret);
}

async function postConvert(url, bodyObj, keyId, keySecret, attempt = 0) {
  const body = JSON.stringify(bodyObj);
  const expires = Math.floor(Date.now() / 1000) + 60;
  const signature = signConvertRequest({
    keyId,
    keySecret,
    expires,
    url,
    body,
  });

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Convert-Application-ID": keyId,
      Expires: String(expires),
      Authorization: `Convert-HMAC-SHA256 Signature=${signature}`,
    },
    body,
  });

  if (res.ok) {
    return res.json();
  }

  const text = await res.text();
  const retriable = res.status === 429 || res.status >= 500;
  if (retriable && attempt < 4) {
    await sleep(1000 * (attempt + 1));
    return postConvert(url, bodyObj, keyId, keySecret, attempt + 1);
  }
  throw new Error(`Convert request failed ${res.status}: ${text.slice(0, 300)}`);
}

function signConvertRequest({ keyId, keySecret, expires, url, body }) {
  const crypto = require("crypto");
  const message = `${keyId}\n${expires}\n${url}\n${body}`;
  return crypto.createHmac("sha256", keySecret).update(message).digest("hex");
}

function toDateMillis(value) {
  if (!value) return null;
  if (typeof value?.toMillis === "function") {
    return value.toMillis();
  }
  if (typeof value?._seconds === "number") {
    return value._seconds * 1000;
  }
  if (typeof value?.seconds === "number") {
    return value.seconds * 1000;
  }
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : null;
}

function toExperimentStartMs(convertExperiment, firestoreDoc) {
  const direct = Number(convertExperiment?.start_time ?? 0);
  if (direct > 0) return direct * 1000;
  const firestoreStart = Number(firestoreDoc?.experiment?.start_time ?? 0);
  if (firestoreStart > 0) return firestoreStart * 1000;
  return 0;
}

function buildChartSeries(experiment, report, dailyReport) {
  const reportData = (report?.data ?? report ?? {});
  const variationsMeta = reportData.variations_data ?? experiment?.variations ?? [];
  const goals = Array.isArray(reportData.reportData) ? reportData.reportData : [];
  const revenueGoal = goals.find((goal) =>
    Array.isArray(goal?.variations) && goal.variations.some((variation) => variation?.revenue_data != null),
  ) ?? goals[0];
  const baselineMeta = findBaselineVariation(variationsMeta);
  const baselineId = baselineMeta?.id != null ? String(baselineMeta.id) : undefined;

  const statsByVariationId = new Map();
  for (const variation of revenueGoal?.variations ?? []) {
    if (variation?.id != null) {
      statsByVariationId.set(String(variation.id), variation);
    }
  }

  const variants = variationsMeta.map((variation, index) => {
    const stats = statsByVariationId.get(String(variation?.id ?? ""));
    const conversions = Number(stats?.conversion_data?.conversions ?? 0);
    const revenue = Number(stats?.revenue_data?.total_revenue ?? 0);
    return {
      id: String(variation?.id ?? ""),
      name: String(variation?.name ?? "Variant"),
      isOriginal: baselineId
        ? String(variation?.id ?? "") === baselineId
        : index === 0,
      trafficSplit: Number(variation?.traffic_distribution ?? 0),
      sessions: Number(stats?.visitors ?? 0),
      transactions: conversions,
      products: Number(stats?.products_data?.total_products ?? 0),
      revenue,
      cvr: Number(stats?.conversion_data?.conversion_rate ?? 0),
      rpv: Number(stats?.revenue_data?.revenue_per_visitor ?? 0),
      aov: conversions > 0 ? revenue / conversions : 0,
    };
  });

  const revenueUplift = calculateMetricUplift(variants, "revenue");
  const bestVariationId = revenueUplift.bestVariationId;
  const rawSeries = parseDailyReport(dailyReport, bestVariationId, baselineId);

  return rawSeries.sort((a, b) => a.date.localeCompare(b.date));
}

function findBaselineVariation(variations) {
  return (
    variations.find((variation) => variation?.is_baseline === true) ??
    variations.find((variation) =>
      /original|control|baseline/i.test(String(variation?.name ?? "")),
    ) ??
    variations[0]
  );
}

function calculateMetricUplift(variants, metric) {
  const original = variants.find((variant) => variant.isOriginal) ?? variants[0];
  const variationCandidates = variants.filter((variant) => variant.id !== original?.id);
  const candidates = variationCandidates.length > 0 ? variationCandidates : variants;

  let best = candidates[0];
  for (const candidate of candidates.slice(1)) {
    if (getMetricValue(candidate, metric) > getMetricValue(best, metric)) {
      best = candidate;
    }
  }

  return {
    bestVariationId: best?.id,
  };
}

function getMetricValue(variant, metric) {
  if (!variant) return 0;
  if (metric === "purchases") return variant.transactions;
  if (metric === "aov") return variant.aov;
  return variant[metric] ?? 0;
}

function parseDailyReport(dailyReport, bestVariationId, baselineId) {
  if (!dailyReport) return [];
  const outer = dailyReport?.data ?? dailyReport;
  const reportDataRaw = outer.reportData;
  let variations = [];

  if (Array.isArray(reportDataRaw)) {
    const first = reportDataRaw[0];
    if (first && Array.isArray(first.variations)) {
      variations = first.variations;
    }
  } else if (reportDataRaw && typeof reportDataRaw === "object") {
    if (Array.isArray(reportDataRaw.variations)) {
      variations = reportDataRaw.variations;
    }
  }

  if (variations.length === 0) return [];

  const findStats = (id) =>
    id ? (variations.find((variation) => String(variation.id) === id)?.stats ?? []) : [];

  const bestStats = findStats(bestVariationId);
  const baseStats = findStats(baselineId);
  const baseByTimestamp = new Map(
    baseStats
      .filter((stat) => stat?.timestamp != null)
      .map((stat) => [Number(stat.timestamp), stat]),
  );

  return bestStats
    .map((stat) => {
      if (stat?.timestamp == null) return null;
      const timestamp = Number(stat.timestamp);
      const date = new Date(timestamp > 1e12 ? timestamp : timestamp * 1000)
        .toISOString()
        .slice(0, 10);
      const baseStat = baseByTimestamp.get(timestamp);
      const revenue = roundMoney(toRevenue(stat) - toRevenue(baseStat));
      return {
        date,
        revenue,
      };
    })
    .filter(Boolean);
}

function toRevenue(stat) {
  if (!stat) return 0;
  if (stat.totals != null && Number(stat.totals) !== 0) {
    return Number(stat.totals);
  }
  return Number(stat.value ?? 0) * Number(stat.visitors ?? 0);
}

function roundMoney(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function compareSeries({
  experimentId,
  firestoreDoc,
  convertExperiment,
  appLiveSeries,
  convertSeries,
}) {
  const appLiveMap = new Map(appLiveSeries.map((point) => [point.date, point.revenue]));
  const convertMap = new Map(convertSeries.map((point) => [point.date, point.revenue]));
  const dates = Array.from(new Set([...appLiveMap.keys(), ...convertMap.keys()])).sort();

  const mismatches = [];
  let maxAbsDelta = 0;
  let totalDelta = 0;

  for (const date of dates) {
    const appLiveValue = roundMoney(appLiveMap.get(date) ?? 0);
    const convertValue = roundMoney(convertMap.get(date) ?? 0);
    const delta = roundMoney(appLiveValue - convertValue);
    totalDelta = roundMoney(totalDelta + delta);
    maxAbsDelta = Math.max(maxAbsDelta, Math.abs(delta));

    if (Math.abs(delta) > 0.01) {
      mismatches.push({
        date,
        appLive: appLiveValue,
        convert: convertValue,
        delta,
      });
    }
  }

  return {
    experimentId,
    experimentName: String(convertExperiment?.name ?? firestoreDoc?.experiment?.name ?? experimentId),
    firestorePresent: true,
    convertPresent: true,
    firestorePointCount: appLiveSeries.length,
    appLivePointCount: appLiveSeries.length,
    convertPointCount: convertSeries.length,
    firestoreTotalUplift: roundMoney(sumSeries(appLiveSeries)),
    appLiveTotalUplift: roundMoney(sumSeries(appLiveSeries)),
    convertTotalUplift: roundMoney(sumSeries(convertSeries)),
    totalDelta,
    appVsConvertDelta: totalDelta,
    maxAbsDelta: roundMoney(maxAbsDelta),
    mismatchCount: mismatches.length,
    status: mismatches.length === 0 ? "match" : "mismatch",
    appStatus: mismatches.length === 0 ? "match" : "mismatch",
    mismatches: mismatches.slice(0, 10),
  };
}

function buildPresenceMismatch(experimentId, firestoreDoc, convertExperiment) {
  return {
    experimentId,
    experimentName: String(convertExperiment?.name ?? firestoreDoc?.experiment?.name ?? experimentId),
    firestorePresent: Boolean(firestoreDoc),
    convertPresent: Boolean(convertExperiment),
    firestorePointCount: firestoreDoc ? 1 : 0,
    convertPointCount: convertExperiment ? 1 : 0,
    firestoreTotalUplift: 0,
    convertTotalUplift: 0,
    totalDelta: 0,
    maxAbsDelta: 0,
    mismatchCount: 1,
    status: "missing",
    mismatches: [
      {
        issue: firestoreDoc ? "missing_in_convert" : "missing_in_firestore",
      },
    ],
  };
}

function buildSummary({ firestoreCount, convertCount, items, aggregateComparison }) {
  const matches = items.filter((item) => item.status === "match").length;
  const mismatches = items.filter((item) => item.status === "mismatch").length;
  const missing = items.filter((item) => item.status === "missing").length;
  const nonZeroDelta = items.filter((item) => Math.abs(item.totalDelta) > 0.01).length;
  const totalFirestoreUplift = roundMoney(
    items.reduce((sum, item) => sum + item.firestoreTotalUplift, 0),
  );
  const totalAppLiveUplift = roundMoney(
    items.reduce((sum, item) => sum + Number(item.appLiveTotalUplift ?? 0), 0),
  );
  const totalConvertUplift = roundMoney(
    items.reduce((sum, item) => sum + item.convertTotalUplift, 0),
  );

  return {
    firestoreCount,
    convertCount,
    audited: items.length,
    matches,
    mismatches,
    missing,
    nonZeroDelta,
    totalFirestoreUplift,
    totalAppLiveUplift,
    totalConvertUplift,
    totalDelta: roundMoney(totalFirestoreUplift - totalConvertUplift),
    appVsConvertDelta: roundMoney(totalAppLiveUplift - totalConvertUplift),
    appLivePointCount: aggregateComparison.pointCount,
    appLiveSeriesStart: aggregateComparison.seriesStart,
    appLiveSeriesEnd: aggregateComparison.seriesEnd,
    aggregateAppVsConvertMismatchCount: aggregateComparison.mismatchCount,
    aggregateAppVsConvertMaxAbsDelta: aggregateComparison.maxAbsDelta,
  };
}

function aggregateSeries(entries) {
  const totals = new Map();
  for (const entry of entries) {
    for (const point of entry.dateSeries) {
      totals.set(point.date, roundMoney((totals.get(point.date) ?? 0) + Number(point.revenue ?? 0)));
    }
  }
  return Array.from(totals.entries())
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([date, revenue]) => ({ date, revenue }));
}

function compareAggregateSeries(appLiveSeries, convertSeries) {
  const appLiveMap = new Map(appLiveSeries.map((point) => [point.date, point.revenue]));
  const convertMap = new Map(convertSeries.map((point) => [point.date, point.revenue]));
  const dates = Array.from(new Set([...appLiveMap.keys(), ...convertMap.keys()])).sort();

  let maxAbsDelta = 0;
  let totalDelta = 0;
  let mismatchCount = 0;

  for (const date of dates) {
    const appLiveValue = roundMoney(appLiveMap.get(date) ?? 0);
    const convertValue = roundMoney(convertMap.get(date) ?? 0);
    const delta = roundMoney(appLiveValue - convertValue);
    totalDelta = roundMoney(totalDelta + delta);
    maxAbsDelta = Math.max(maxAbsDelta, Math.abs(delta));
    if (Math.abs(delta) > 0.01) mismatchCount += 1;
  }

  return {
    pointCount: appLiveSeries.length,
    seriesStart: appLiveSeries[0]?.date ?? null,
    seriesEnd: appLiveSeries[appLiveSeries.length - 1]?.date ?? null,
    totalDelta,
    maxAbsDelta: roundMoney(maxAbsDelta),
    mismatchCount,
    status: mismatchCount === 0 ? "match" : "mismatch",
  };
}

function sumSeries(series) {
  return series.reduce((sum, point) => sum + Number(point.revenue ?? 0), 0);
}

async function mapWithConcurrency(items, concurrency, mapper) {
  const results = new Array(items.length);
  let index = 0;

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (true) {
      const current = index;
      index += 1;
      if (current >= items.length) break;
      results[current] = await mapper(items[current], current);
    }
  });

  await Promise.all(workers);
  return results;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
