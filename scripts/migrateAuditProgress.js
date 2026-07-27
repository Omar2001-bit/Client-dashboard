// One-off migration script: pulls fix-progress (status/note/deleted) from the
// OLD tracking-dashboard Firebase project and merges it into this project's
// clients/{clientId}/auditFindings/{findingId} docs (written by
// scripts/importAuditFindings.js, which must be run first).
//
// Usage:
//   node scripts/migrateAuditProgress.js --client-id=<id> --old-service-account=<path> [--new-service-account=<path>]
//
// Env var equivalents: AUDIT_CLIENT_ID, LEGACY_SERVICE_ACCOUNT_KEY_PATH, NEW_SERVICE_ACCOUNT_KEY_PATH
//
// The old project's service account key is NOT something this repo already
// has — it must be downloaded from the dashboard-fb7e9 Firebase console
// (Project Settings -> Service Accounts -> Generate new private key) by
// whoever has access to that project. There is no default/fallback for it.
//
// Safe to re-run: writes are set(..., { merge: true }) restricted to the
// progress-field subset only — this script never touches the static/content
// fields importAuditFindings.js owns.
const fs = require("fs");
const path = require("path");
const admin = require(path.join(process.cwd(), "functions", "node_modules", "firebase-admin"));

const BATCH_SIZE = 500;
const DEFAULT_LEGACY_PROGRESS_PATH = "dashboards/tharaa-audit-fixing-dashboard/progress";

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
  console.error(
    "  node scripts/migrateAuditProgress.js --client-id=<id> --old-service-account=<path> [--new-service-account=<path>] [--legacy-progress-path=<path>]"
  );
  console.error("");
  console.error(
    "Env var equivalents: AUDIT_CLIENT_ID, LEGACY_SERVICE_ACCOUNT_KEY_PATH, NEW_SERVICE_ACCOUNT_KEY_PATH, LEGACY_PROGRESS_COLLECTION_PATH"
  );
  process.exit(1);
}

function defaultServiceAccountPath() {
  const fallback = path.join(process.cwd(), "server", "serviceAccountKey.json");
  return fs.existsSync(fallback) ? fallback : null;
}

const args = parseArgs(process.argv.slice(2));
const CLIENT_ID = args["client-id"] || process.env.AUDIT_CLIENT_ID;
const OLD_SERVICE_ACCOUNT_PATH = args["old-service-account"] || process.env.LEGACY_SERVICE_ACCOUNT_KEY_PATH;
const NEW_SERVICE_ACCOUNT_PATH =
  args["new-service-account"] || process.env.NEW_SERVICE_ACCOUNT_KEY_PATH || defaultServiceAccountPath();
const LEGACY_PROGRESS_PATH =
  args["legacy-progress-path"] || process.env.LEGACY_PROGRESS_COLLECTION_PATH || DEFAULT_LEGACY_PROGRESS_PATH;

if (!CLIENT_ID) usageAndExit("Missing --client-id / AUDIT_CLIENT_ID.");
if (!OLD_SERVICE_ACCOUNT_PATH) {
  usageAndExit(
    "Missing --old-service-account / LEGACY_SERVICE_ACCOUNT_KEY_PATH.\n" +
      "This key must be downloaded from the dashboard-fb7e9 Firebase console\n" +
      "(Project Settings -> Service Accounts -> Generate new private key) by\n" +
      "whoever has access to that project — this repo cannot produce it."
  );
}
if (!fs.existsSync(OLD_SERVICE_ACCOUNT_PATH)) {
  usageAndExit(`--old-service-account path does not exist: ${OLD_SERVICE_ACCOUNT_PATH}`);
}
if (!NEW_SERVICE_ACCOUNT_PATH) {
  usageAndExit(
    "Missing --new-service-account / NEW_SERVICE_ACCOUNT_KEY_PATH, and server/serviceAccountKey.json does not exist locally."
  );
}

function initApps() {
  const legacyCert = JSON.parse(fs.readFileSync(OLD_SERVICE_ACCOUNT_PATH, "utf8"));
  const currentCert = JSON.parse(fs.readFileSync(NEW_SERVICE_ACCOUNT_PATH, "utf8"));
  const legacyApp =
    admin.apps.find((a) => a.name === "legacy") ||
    admin.initializeApp({ credential: admin.credential.cert(legacyCert) }, "legacy");
  const currentApp =
    admin.apps.find((a) => a.name === "current") ||
    admin.initializeApp({ credential: admin.credential.cert(currentCert) }, "current");
  return { legacyDb: legacyApp.firestore(), currentDb: currentApp.firestore() };
}

function toTimestampOrNull(isoOrEmpty) {
  if (!isoOrEmpty) return null;
  const parsed = new Date(isoOrEmpty);
  if (Number.isNaN(parsed.getTime())) return null;
  return admin.firestore.Timestamp.fromDate(parsed);
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
  const { legacyDb, currentDb } = initApps();

  const legacySnap = await legacyDb.collection(LEGACY_PROGRESS_PATH).get();
  const findingsRef = currentDb.collection("clients").doc(CLIENT_ID).collection("auditFindings");
  const existingSnap = await findingsRef.get();
  const existingIds = new Set(existingSnap.docs.map((doc) => doc.id));

  const writes = [];
  const orphaned = [];
  const byProgressStatus = {};

  for (const doc of legacySnap.docs) {
    const legacy = doc.data();
    const pointId = legacy.pointId || doc.id;

    if (!existingIds.has(pointId)) {
      orphaned.push(pointId);
      continue;
    }

    const progressStatus = legacy.status || "unreviewed";
    byProgressStatus[progressStatus] = (byProgressStatus[progressStatus] || 0) + 1;

    writes.push({
      ref: findingsRef.doc(pointId),
      data: {
        progressStatus,
        note: legacy.note || "",
        deleted: Boolean(legacy.deleted),
        deletedAt: toTimestampOrNull(legacy.deletedAt),
        progressUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
        progressUpdatedBy: "migrated-from-legacy",
        legacyProgressMigrated: true,
        legacyUpdatedAtIso: legacy.updatedAtIso || null,
      },
    });
  }

  await commitInChunks(currentDb, writes);

  console.log(
    JSON.stringify(
      {
        clientId: CLIENT_ID,
        legacyProgressPath: LEGACY_PROGRESS_PATH,
        legacyDocCount: legacySnap.size,
        migrated: writes.length,
        orphanedCount: orphaned.length,
        orphanedIds: orphaned.slice(0, 20),
        byProgressStatus,
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
