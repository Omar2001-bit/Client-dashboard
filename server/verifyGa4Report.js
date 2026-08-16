// GA4 ground-truth check. Two modes:
//
//  --property=<id> --metrics=a,b,c --start=... --end=...
//    Queries the GA4 Data API directly (same service account server/index.js uses,
//    bypassing Express/ga4Reporting.js entirely) and just prints the raw totals — a
//    second opinion when there's no GA4 UI login available to cross-check against
//    (the service account is API-only, it has no interactive login of its own).
//
//  --clientId=<id> --reportId=<id> --start=... --end=... [--compareStart=... --compareEnd=...]
//    Same independent GA4 query, PLUS calls the app's real POST /api/ga4-reports/data
//    (authenticating as that client automatically — no password involved, see
//    getIdTokenForClient below) and diffs every metric against it: exact match required
//    for TYPE_INTEGER, small relative tolerance for float/currency/computed-rate metrics
//    (floating-point summation order can differ by ~1e-9 between two independent sums of
//    the same numbers — that's noise, not a bug). Prints a PASS/FAIL table and exits
//    non-zero if anything mismatches, so this can be re-run as a real regression check.
//
// --start/--end are always required — read the exact dates off the dashboard report
// (shown under PREVIOUS/CURRENT) rather than a preset name, this script doesn't
// re-implement "last 28 days"-style preset resolution.
//
// --baseUrl (default http://127.0.0.1:3002) points the live-diff call at local or
// deployed. --asUid overrides the automatic clientId -> Firebase uid lookup.
//
// Only handles totals (no dimension breakdown) and does not apply a report's saved
// dimension filters — it warns if the report has any configured, since the dashboard's
// number will legitimately be narrower in that case. For everything else (real metrics,
// event: pivots, convu:/convs: rates) the totals here should match the dashboard exactly.

const fs = require("fs");
const path = require("path");
const admin = require("firebase-admin");
const { google } = require("googleapis");

const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT_JSON
  ? JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON)
  : require("./serviceAccountKey.json");
const ga4ServiceAccount = process.env.GA4_SERVICE_ACCOUNT_JSON
  ? JSON.parse(process.env.GA4_SERVICE_ACCOUNT_JSON)
  : require("./ga4ServiceAccount.json");

const EVENT_PREFIX = "event:";
const CONVU_PREFIX = "convu:";
const CONVS_PREFIX = "convs:";

function parseArgs() {
  const args = {};
  for (const raw of process.argv.slice(2)) {
    const m = raw.match(/^--([^=]+)=(.*)$/);
    if (m) args[m[1]] = m[2];
  }
  return args;
}

function getGA4Auth() {
  return new google.auth.GoogleAuth({
    credentials: ga4ServiceAccount,
    scopes: ["https://www.googleapis.com/auth/analytics.readonly"],
  });
}

async function runReport(analyticsData, property, requestBody) {
  const resp = await analyticsData.properties.runReport({ property, requestBody });
  return resp.data;
}

// Real GA4 metric totals, no dimension breakdown — reads GA4's own TOTAL row directly.
async function fetchRealMetricTotals(analyticsData, property, metricNames, dateRange) {
  if (metricNames.length === 0) return {};
  const data = await runReport(analyticsData, property, {
    dateRanges: [dateRange],
    metrics: metricNames.map((name) => ({ name })),
    metricAggregations: ["TOTAL"],
  });
  const totalsRow = (data.totals || [])[0];
  const out = {};
  metricNames.forEach((name, i) => {
    out[name] = totalsRow ? Number(totalsRow.metricValues?.[i]?.value ?? 0) : 0;
  });
  return out;
}

// event:<name> -> eventCount filtered to eventName == <name>
async function fetchEventTotal(analyticsData, property, eventName, dateRange) {
  const data = await runReport(analyticsData, property, {
    dateRanges: [dateRange],
    metrics: [{ name: "eventCount" }],
    dimensionFilter: {
      filter: { fieldName: "eventName", stringFilter: { value: eventName, matchType: "EXACT" } },
    },
    metricAggregations: ["TOTAL"],
  });
  const totalsRow = (data.totals || [])[0];
  return totalsRow ? Number(totalsRow.metricValues?.[0]?.value ?? 0) : 0;
}

function pad(s, w) {
  return String(s).padEnd(w);
}

// VITE_FIREBASE_API_KEY is a public Firebase web key (safe to read, not a secret) —
// read it from frontend/.env at runtime instead of duplicating it into a second file.
function readViteFirebaseApiKey() {
  const envPath = path.join(__dirname, "..", "frontend", ".env");
  const text = fs.readFileSync(envPath, "utf8");
  const m = text.match(/^VITE_FIREBASE_API_KEY=(.+)$/m);
  if (!m) throw new Error(`Could not find VITE_FIREBASE_API_KEY in ${envPath}`);
  return m[1].trim();
}

// Reverse of how server/index.js's requireClientOrAdminOwnership resolves a caller's
// clientId from users/{uid} — here we go clientId -> uid, to find someone to authenticate
// as. --asUid overrides this when a client has multiple users or the lookup picks wrong.
async function findClientUid(clientId, asUid) {
  if (asUid) return asUid;
  const snap = await admin.firestore().collection("users").where("clientId", "==", clientId).limit(1).get();
  if (snap.empty) {
    throw new Error(`No user found with clientId=${clientId} in the "users" collection — pass --asUid=<uid> to override`);
  }
  return snap.docs[0].id;
}

// Mints a custom token via the Admin SDK (already fully privileged locally through
// serviceAccountKey.json) and exchanges it for a real ID token — the same kind of token
// fetchWithAuth() attaches as Authorization: Bearer. Never touches the client's password.
async function getIdTokenForClient(clientId, asUid, apiKey) {
  const uid = await findClientUid(clientId, asUid);
  const customToken = await admin.auth().createCustomToken(uid);
  const resp = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: customToken, returnSecureToken: true }),
  });
  const data = await resp.json();
  if (!resp.ok) throw new Error(`signInWithCustomToken failed: ${data.error?.message || resp.status}`);
  return data.idToken;
}

async function fetchAppReportData(baseUrl, idToken, clientId, reportId, rangeA, rangeB) {
  const resp = await fetch(`${baseUrl}/api/ga4-reports/data`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${idToken}` },
    body: JSON.stringify({ clientId, reportId, rangeA, rangeB: rangeB || null }),
  });
  const data = await resp.json();
  if (!resp.ok) throw new Error(`App API error (${resp.status} from ${baseUrl}): ${data.error || JSON.stringify(data)}`);
  return data;
}

// TYPE_INTEGER must match exactly; everything else (float/currency/computed rates)
// tolerates ~1e-6 relative difference — well above the ~1e-9-1e-13 float-summation noise
// observed between two independently-ordered sums of the same underlying numbers, far
// below anything that would indicate a real discrepancy.
function metricsMatch(type, a, b) {
  if (a === undefined || b === undefined) return false;
  if (type === "TYPE_INTEGER") return a === b;
  const scale = Math.max(Math.abs(a), Math.abs(b), 1e-9);
  return Math.abs(a - b) / scale < 1e-6;
}

async function main() {
  const args = parseArgs();
  admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
  const auth = getGA4Auth();
  const analyticsData = google.analyticsdata({ version: "v1beta", auth });

  let property = args.property;
  let metrics = args.metrics
    ? args.metrics.split(",").map((s) => s.trim()).filter(Boolean)
    : [];

  if (args.clientId && args.reportId) {
    const snap = await admin.firestore().doc(`clients/${args.clientId}/ga4Reports/${args.reportId}`).get();
    if (!snap.exists) throw new Error(`No such report: clients/${args.clientId}/ga4Reports/${args.reportId}`);
    const report = snap.data();
    property = property || report.property;
    if (metrics.length === 0) metrics = report.metrics || [];
    console.log(
      `Report config: property=${report.property} metrics=[${(report.metrics || []).join(", ")}] dimensions=[${(report.dimensions || []).join(", ")}]`
    );
    if (report.filters && report.filters.length > 0) {
      console.log(
        `NOTE: this report has dimension filters configured in Firestore — this script does not replicate them, so the totals below may legitimately run wider than the dashboard's filtered view. Filters: ${JSON.stringify(report.filters)}`
      );
    }
  }

  if (!property) throw new Error("Need --property=<id> or --clientId=... --reportId=...");
  if (!property.startsWith("properties/")) property = `properties/${property}`;
  if (metrics.length === 0) throw new Error("Need --metrics=metricA,metricB,... (or a --reportId that has metrics configured)");
  if (!args.start || !args.end) {
    throw new Error("Need --start=YYYY-MM-DD --end=YYYY-MM-DD — read the exact range off the dashboard report, this script doesn't resolve date presets");
  }

  const ranges = [{ label: "A", startDate: args.start, endDate: args.end }];
  if (args.compareStart && args.compareEnd) {
    ranges.push({ label: "B", startDate: args.compareStart, endDate: args.compareEnd });
  }

  const metaResp = await analyticsData.properties.getMetadata({ name: `${property}/metadata` });
  const typeByName = {};
  (metaResp.data.metrics || []).forEach((m) => {
    typeByName[m.apiName] = m.type;
  });

  const realMetrics = metrics.filter(
    (m) => !m.startsWith(EVENT_PREFIX) && !m.startsWith(CONVU_PREFIX) && !m.startsWith(CONVS_PREFIX)
  );
  const eventMetrics = metrics.filter((m) => m.startsWith(EVENT_PREFIX));
  const convMetrics = metrics.filter((m) => m.startsWith(CONVU_PREFIX) || m.startsWith(CONVS_PREFIX));

  const results = {};
  for (const range of ranges) {
    results[range.label] = {};
    const dateRange = { startDate: range.startDate, endDate: range.endDate };

    Object.assign(results[range.label], await fetchRealMetricTotals(analyticsData, property, realMetrics, dateRange));

    for (const m of eventMetrics) {
      const eventName = m.slice(EVENT_PREFIX.length);
      results[range.label][m] = await fetchEventTotal(analyticsData, property, eventName, dateRange);
    }

    if (convMetrics.length > 0) {
      const needUsers = convMetrics.some((m) => m.startsWith(CONVU_PREFIX));
      const needSessions = convMetrics.some((m) => m.startsWith(CONVS_PREFIX));
      const denomMetrics = [...(needUsers ? ["totalUsers"] : []), ...(needSessions ? ["sessions"] : [])];
      const denomTotals = await fetchRealMetricTotals(analyticsData, property, denomMetrics, dateRange);
      for (const m of convMetrics) {
        const isUsers = m.startsWith(CONVU_PREFIX);
        const eventName = m.slice(m.indexOf(":") + 1);
        const eventTotal = await fetchEventTotal(analyticsData, property, eventName, dateRange);
        const denom = isUsers ? denomTotals.totalUsers : denomTotals.sessions;
        results[range.label][m] = denom ? eventTotal / denom : 0;
      }
    }
  }

  console.log("");
  console.log(`Property: ${property}`);
  console.log(
    `Range A: ${args.start} -> ${args.end}` + (ranges[1] ? `   Range B: ${args.compareStart} -> ${args.compareEnd}` : "")
  );
  console.log("");

  const typeOf = (m) =>
    typeByName[m] ||
    (m.startsWith(CONVU_PREFIX) || m.startsWith(CONVS_PREFIX)
      ? "TYPE_RATE_PERCENT"
      : m.startsWith(EVENT_PREFIX)
        ? "TYPE_INTEGER"
        : "unknown");

  if (args.clientId && args.reportId) {
    // Live-diff mode: fetch the app's real answer through its real API and compare.
    const apiKey = readViteFirebaseApiKey();
    const baseUrl = (args.baseUrl || "http://127.0.0.1:3002").replace(/\/$/, "");
    const idToken = await getIdTokenForClient(args.clientId, args.asUid, apiKey);
    const rangeAObj = { startDate: args.start, endDate: args.end };
    const rangeBObj = ranges[1] ? { startDate: args.compareStart, endDate: args.compareEnd } : null;
    const appData = await fetchAppReportData(baseUrl, idToken, args.clientId, args.reportId, rangeAObj, rangeBObj);

    console.log(`Diffing against ${baseUrl}/api/ga4-reports/data (authenticated as clientId=${args.clientId})`);
    console.log("");

    const rows = metrics.map((m) => {
      const type = typeOf(m);
      const appIdx = appData.metrics.indexOf(m);
      const appA = appIdx >= 0 ? appData.totalsA[appIdx] : undefined;
      const appB = appIdx >= 0 && appData.totalsB ? appData.totalsB[appIdx] : undefined;
      const indepA = results.A[m];
      const indepB = ranges[1] ? results.B[m] : undefined;
      return {
        metric: m,
        type,
        appA,
        indepA,
        matchA: metricsMatch(type, appA, indepA),
        appB,
        indepB,
        matchB: ranges[1] ? metricsMatch(type, appB, indepB) : undefined,
      };
    });

    const metricW = Math.max(6, ...rows.map((r) => r.metric.length));
    console.log(
      pad("metric", metricW),
      "| range A: app / independent".padEnd(34),
      "| ok",
      ranges[1] ? "| range B: app / independent".padEnd(34) + "| ok" : ""
    );
    let failCount = 0;
    for (const r of rows) {
      if (!r.matchA || (ranges[1] && !r.matchB)) failCount++;
      const aStr = `${r.appA} / ${r.indepA}`;
      const bStr = ranges[1] ? `${r.appB} / ${r.indepB}` : "";
      console.log(
        pad(r.metric, metricW),
        "|",
        pad(aStr, 32),
        "|",
        r.matchA ? "PASS" : "FAIL",
        ranges[1] ? "| " + pad(bStr, 32) + "| " + (r.matchB ? "PASS" : "FAIL") : ""
      );
    }
    console.log("");
    const total = rows.length;
    const passed = total - failCount;
    console.log(`${passed}/${total} metrics matched.` + (failCount > 0 ? " See FAIL rows above." : ""));
    if (failCount > 0) process.exitCode = 1;
    return;
  }

  const rows = metrics.map((m) => ({ metric: m, type: typeOf(m), a: results.A[m], b: ranges[1] ? results.B[m] : undefined }));

  const metricW = Math.max(6, ...rows.map((r) => r.metric.length));
  const typeW = Math.max(4, ...rows.map((r) => String(r.type).length));
  console.log(pad("metric", metricW), "|", pad("type", typeW), "|", "range A".padStart(16), ranges[1] ? "| " + "range B".padStart(16) : "");
  for (const r of rows) {
    console.log(
      pad(r.metric, metricW),
      "|",
      pad(r.type, typeW),
      "|",
      String(r.a).padStart(16),
      ranges[1] ? "| " + String(r.b).padStart(16) : ""
    );
  }
  console.log("");
  console.log("These are raw GA4 totals from an independent query — compare directly against the dashboard's Numbers/Compare view for the same metrics and date range.");
}

main()
  .then(() => process.exit(process.exitCode ?? 0))
  .catch((err) => {
    console.error("ERROR:", err.message);
    process.exit(1);
  });
