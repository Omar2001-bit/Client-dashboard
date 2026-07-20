// One-off migration script: extracts audit findings from the tracking-dashboard
// project's live index.html (embedded JSON payload) and writes them into this
// project's Firestore under clients/{clientId}/auditFindings/{findingId}.
//
// Usage:
//   node scripts/importAuditFindings.js --client-id=<id> --html-path=<path/to/index.html> [--service-account=<path>]
//
// Env var equivalents (flag wins if both are set): AUDIT_CLIENT_ID, AUDIT_SOURCE_HTML, NEW_SERVICE_ACCOUNT_KEY_PATH
//
// Safe to re-run: every write is set(..., { merge: true }), and progress fields
// (progressStatus/note/deleted/...) are only initialized for documents that don't
// already exist — re-running this against an updated index.html will refresh
// content fields without resetting any fix-progress already tracked in Firestore.
const fs = require("fs");
const path = require("path");
const admin = require(path.join(process.cwd(), "functions", "node_modules", "firebase-admin"));

const BATCH_SIZE = 500;

function parseArgs(argv) {
  const args = {};
  for (const arg of argv) {
    const match = /^--([^=]+)=([\s\S]*)$/.exec(arg);
    if (match) args[match[1]] = match[2];
  }
  return args;
}

function usageAndExit(message) {
  console.error(message);
  console.error("");
  console.error("Usage:");
  console.error("  node scripts/importAuditFindings.js --client-id=<id> --html-path=<path/to/index.html> [--service-account=<path>]");
  console.error("");
  console.error("Env var equivalents: AUDIT_CLIENT_ID, AUDIT_SOURCE_HTML, NEW_SERVICE_ACCOUNT_KEY_PATH");
  process.exit(1);
}

function defaultServiceAccountPath() {
  const fallback = path.join(process.cwd(), "functions", "serviceAccountKey.json");
  return fs.existsSync(fallback) ? fallback : null;
}

const args = parseArgs(process.argv.slice(2));
const CLIENT_ID = args["client-id"] || process.env.AUDIT_CLIENT_ID;
const HTML_PATH = args["html-path"] || process.env.AUDIT_SOURCE_HTML;
const SERVICE_ACCOUNT_PATH =
  args["service-account"] || process.env.NEW_SERVICE_ACCOUNT_KEY_PATH || defaultServiceAccountPath();

if (!CLIENT_ID) usageAndExit("Missing --client-id / AUDIT_CLIENT_ID.");
if (!HTML_PATH) usageAndExit("Missing --html-path / AUDIT_SOURCE_HTML.");
if (!SERVICE_ACCOUNT_PATH) {
  usageAndExit(
    "Missing --service-account / NEW_SERVICE_ACCOUNT_KEY_PATH, and functions/serviceAccountKey.json does not exist locally."
  );
}
if (!fs.existsSync(HTML_PATH)) usageAndExit(`--html-path does not exist: ${HTML_PATH}`);

function getFirestore() {
  if (admin.apps.length === 0) {
    const serviceAccount = JSON.parse(fs.readFileSync(SERVICE_ACCOUNT_PATH, "utf8"));
    admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
  }
  return admin.firestore();
}

// Ported verbatim from VC2 tracking-dashboard's index.html (lines 812-835), so
// visibility scoping in the new app matches the source dashboard's own logic.
// (The source also computes an `isUnableToVerify` local that's never used in
// isChecklistRow's return expression — dead code, intentionally not carried over.)
function isCorrectRow(row) {
  return row.status === "Correct" || /\|\s*Correct\]/i.test(row.issue || "");
}

function isChecklistRow(row) {
  const label = `${row.tool || ""} ${row.sourceTab || ""}`;
  const isGsc = /google search console|gsc/i.test(label);
  return (
    /shopify|clarity/i.test(label) ||
    row.sourceTab === "QA Checklist - GTM" ||
    row.sourceTab === "QA Checklist - GA4" ||
    isGsc
  );
}

function extractAuditData(html) {
  const marker = '<script type="application/json" id="audit-data">';
  const markerStart = html.indexOf(marker);
  if (markerStart === -1) {
    throw new Error(`Could not find marker '${marker}' in ${HTML_PATH} — is this the right index.html?`);
  }
  const jsonStart = markerStart + marker.length;
  const jsonEnd = html.indexOf("</script>", jsonStart);
  if (jsonEnd === -1) throw new Error("Found the audit-data marker but no closing </script> after it.");
  return JSON.parse(html.slice(jsonStart, jsonEnd));
}

function isValidFirestoreId(id) {
  if (typeof id !== "string" || id.length === 0 || id.length > 1500) return false;
  if (id === "." || id === "..") return false;
  if (id.includes("/")) return false;
  return true;
}

function staticFieldsFor(row) {
  return {
    id: row.id,
    row: String(row.row ?? ""),
    sourceRow: String(row.sourceRow ?? ""),
    sourceTab: row.sourceTab ?? "",
    tool: row.tool ?? "",
    issueId: row.issueId ?? "",

    auditStatus: row.status ?? "Action Needed",
    manualReview: Boolean(row.manualReview),
    isCorrectRow: isCorrectRow(row),
    isChecklistRow: isChecklistRow(row),

    issue: row.issue ?? "",
    businessIssue: row.businessIssue ?? "",
    summary: row.summary ?? "",
    detail: row.detail ?? "",
    businessDetail: row.businessDetail ?? "",
    technicalExplanation: row.technicalExplanation ?? "",
    fix: row.fix ?? "",
    businessFix: row.businessFix ?? "",
    verify: row.verify ?? "",
    businessVerify: row.businessVerify ?? "",
    docs: row.docs ?? "",
    owner: row.owner ?? "",
    qaOutcome: row.qaOutcome ?? "",
    reviewStatus: row.reviewStatus ?? "",
    routingNote: row.routingNote ?? "",
    evidenceLink: row.evidenceLink ?? "",
  };
}

function progressDefaults() {
  return {
    progressStatus: "unreviewed",
    note: "",
    deleted: false,
    deletedAt: null,
    progressUpdatedAt: null,
    progressUpdatedBy: null,
    legacyProgressMigrated: false,
  };
}

async function commitInChunks(db, writes) {
  for (let i = 0; i < writes.length; i += BATCH_SIZE) {
    const batch = db.batch();
    for (const { ref, data } of writes.slice(i, i + BATCH_SIZE)) {
      batch.set(ref, data, { merge: true });
    }
    await batch.commit();
  }
}

async function main() {
  const db = getFirestore();
  const html = fs.readFileSync(HTML_PATH, "utf8");
  const auditData = extractAuditData(html);

  if (!Array.isArray(auditData)) throw new Error("Extracted audit-data payload is not an array.");

  const invalid = auditData.filter((row) => !isValidFirestoreId(row.id));
  if (invalid.length > 0) {
    console.error(`${invalid.length} row(s) have an invalid/missing Firestore doc id:`);
    console.error(JSON.stringify(invalid.slice(0, 5), null, 2));
    throw new Error("Aborting — fix the source data or the id-generation logic before importing.");
  }

  const findingsRef = db.collection("clients").doc(CLIENT_ID).collection("auditFindings");

  // Read existing docs first so progress fields are only initialized for
  // genuinely new findings — this is what makes the script safely re-runnable
  // without ever resetting fix-progress already tracked in Firestore.
  const existingSnap = await findingsRef.get();
  const existingIds = new Set(existingSnap.docs.map((doc) => doc.id));

  const importBatchId = new Date().toISOString();
  const now = admin.firestore.FieldValue.serverTimestamp();

  const writes = auditData.map((row) => {
    const isNew = !existingIds.has(row.id);
    const data = {
      ...staticFieldsFor(row),
      importedAt: now,
      importBatchId,
      ...(isNew ? progressDefaults() : {}),
    };
    return { ref: findingsRef.doc(row.id), data, isNew };
  });

  await commitInChunks(db, writes);

  await db
    .collection("clients")
    .doc(CLIENT_ID)
    .collection("settings")
    .doc("dashboard")
    .set({ auditTrackingEnabled: true }, { merge: true });

  const createdCount = writes.filter((w) => w.isNew).length;
  const byTool = {};
  const byAuditStatus = {};
  for (const row of auditData) {
    byTool[row.tool ?? "unknown"] = (byTool[row.tool ?? "unknown"] || 0) + 1;
    const status = row.status ?? "Action Needed";
    byAuditStatus[status] = (byAuditStatus[status] || 0) + 1;
  }

  console.log(
    JSON.stringify(
      {
        clientId: CLIENT_ID,
        htmlPath: HTML_PATH,
        importBatchId,
        totalRows: auditData.length,
        created: createdCount,
        updated: writes.length - createdCount,
        byTool,
        byAuditStatus,
        auditTrackingEnabled: true,
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
