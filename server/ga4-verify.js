/**
 * Diagnostic script — run with:  node ga4-verify.js
 * Connects to GA4 property 268549624 using the service account,
 * lists all Convert audiences, then fetches live metrics for the
 * first 5 experiments using their real date ranges from the request body.
 *
 * Pass experiment dates as a JSON file argument, e.g.:
 *   node ga4-verify.js dates.json
 * or leave blank to test with a wide fallback date range.
 */

const { google } = require("googleapis");
const fs = require("fs");
const path = require("path");

const ga4ServiceAccount = require("./ga4ServiceAccount.json");
const PROPERTY_ID = "268549624";

function getAuth() {
  return new google.auth.GoogleAuth({
    credentials: ga4ServiceAccount,
    scopes: ["https://www.googleapis.com/auth/analytics.readonly"],
  });
}

function parseConvertAudience(audience) {
  const match = audience.displayName?.match(/^Convert (\d+)-(\d+)\s*(.*)$/);
  if (!match) return null;
  const [, experimentId, variationId, description] = match;
  const audienceId = audience.name?.split("/").pop();
  return { audienceId, experimentId, variationId, description: description.trim(), isOriginal: description.toLowerCase().includes("original"), displayName: audience.displayName };
}

async function main() {
  const auth = getAuth();
  const analyticsAdmin = google.analyticsadmin({ version: "v1alpha", auth });
  const analyticsData = google.analyticsdata({ version: "v1beta", auth });

  // ── 1. List all audiences ──────────────────────────────────────────────────
  console.log(`\n=== GA4 Property ${PROPERTY_ID} — Audience List ===\n`);

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

  console.log(`Total audiences in property: ${allAudiences.length}`);

  const convertAudiences = allAudiences.map(parseConvertAudience).filter(Boolean);
  console.log(`Convert audiences found: ${convertAudiences.length}`);

  // Group by experimentId
  const byExp = {};
  for (const a of convertAudiences) {
    if (!byExp[a.experimentId]) byExp[a.experimentId] = [];
    byExp[a.experimentId].push(a);
  }

  const experimentIds = Object.keys(byExp);
  console.log(`Unique experiment IDs in GA4: ${experimentIds.length}`);

  // Print all experiment IDs and their variation counts
  console.log("\n--- All Convert experiments found in GA4 ---");
  for (const expId of experimentIds.sort()) {
    const vars = byExp[expId];
    const origVar = vars.find(v => v.isOriginal);
    console.log(`  Exp ${expId}: ${vars.length} variation(s) | audienceIds: [${vars.map(v => v.audienceId).join(", ")}]`);
    vars.forEach(v => console.log(`    • ${v.audienceId} — ${v.displayName}`));
  }

  // ── 2. Load optional dates file ────────────────────────────────────────────
  let experimentDates = {};
  const datesFile = process.argv[2];
  if (datesFile && fs.existsSync(datesFile)) {
    experimentDates = JSON.parse(fs.readFileSync(datesFile, "utf8"));
    console.log(`\nLoaded ${Object.keys(experimentDates).length} date ranges from ${datesFile}`);
  } else {
    console.log("\nNo dates file provided — using 365daysAgo–today for sample experiments.");
  }

  // ── 3. Fetch metrics for first 5 experiments ───────────────────────────────
  const sampleIds = experimentIds.slice(0, 5);
  console.log(`\n=== Fetching metrics for sample experiments: [${sampleIds.join(", ")}] ===\n`);

  for (const experimentId of sampleIds) {
    const audiences = byExp[experimentId];
    const dates = experimentDates[experimentId];
    const startDate = dates?.startDate || "365daysAgo";
    const endDate = dates?.endDate || "today";
    const audienceIdSet = new Set(audiences.map(a => a.audienceId));

    console.log(`\nExp ${experimentId} | date range: ${startDate} → ${endDate}`);
    console.log(`  Audiences: ${[...audienceIdSet].join(", ")}`);

    try {
      const reportResp = await analyticsData.properties.runReport({
        property: `properties/${PROPERTY_ID}`,
        requestBody: {
          dimensions: [{ name: "audienceId" }],
          metrics: [
            { name: "activeUsers" },
            { name: "sessions" },
            { name: "purchaseRevenue" },
            { name: "transactions" },
            { name: "itemsPurchased" },
          ],
          dateRanges: [{ startDate, endDate }],
          keepEmptyRows: false,
        },
      });

      const rows = reportResp.data.rows || [];
      console.log(`  Total rows returned by GA4: ${rows.length}`);

      let matched = 0;
      for (const row of rows) {
        const id = row.dimensionValues[0].value;
        if (!audienceIdSet.has(id)) continue;
        matched++;
        const [activeUsers, sessions, revenue, transactions, products] = row.metricValues.map(m => m.value);
        const audience = audiences.find(a => a.audienceId === id);
        console.log(`  ✓ audienceId ${id} (${audience?.displayName})`);
        console.log(`      activeUsers=${activeUsers}  sessions=${sessions}  revenue=${revenue}  transactions=${transactions}  products=${products}`);
      }

      if (matched === 0) {
        console.log(`  ✗ No matching rows found for this experiment's audiences in the date range.`);
        console.log(`    (GA4 may have no data for these audiences in ${startDate}–${endDate})`);
      }
    } catch (err) {
      console.error(`  ERROR fetching exp ${experimentId}: ${err.message}`);
    }
  }

  // ── 4. Property access confirmation ───────────────────────────────────────
  console.log("\n=== Property Access Summary ===");
  try {
    const summaries = await analyticsAdmin.accountSummaries.list({ pageSize: 200 });
    for (const account of summaries.data.accountSummaries || []) {
      for (const prop of account.propertySummaries || []) {
        if (prop.property === `properties/${PROPERTY_ID}`) {
          console.log(`✓ Property confirmed: ${prop.displayName} (${prop.property})`);
          console.log(`  Account: ${account.displayName} (${account.account})`);
        }
      }
    }
  } catch (err) {
    console.error(`Property access check failed: ${err.message}`);
  }

  console.log("\nDone.\n");
}

main().catch(err => {
  console.error("Fatal:", err.message);
  process.exit(1);
});
