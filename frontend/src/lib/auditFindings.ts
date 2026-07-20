import { collection, doc, getDocs, serverTimestamp, setDoc, writeBatch, type Timestamp } from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { AuditFindingDoc, AuditSeverity, FixProgressStatus } from "@/types";

export async function loadAuditFindings(clientId: string): Promise<AuditFindingDoc[]> {
  const snap = await getDocs(collection(db, "clients", clientId, "auditFindings"));
  return snap.docs.map((d) => d.data() as AuditFindingDoc);
}

// A finding is noise for a client-facing progress view if it's already
// confirmed correct, or if it's an internal QA/checklist-only row (Shopify,
// Behavioral Tool/Clarity, QA-only GTM/GA4, all Google Search Console rows).
// Ported from VC2 tracking-dashboard's scopedRows() concept — see
// AuditFindingFilters.tsx for the admin-side toggle that lifts this filter.
export function isVisibleToClient(finding: AuditFindingDoc): boolean {
  return !finding.isCorrectRow && !finding.isChecklistRow && !finding.deleted;
}

export function requiresManualReview(finding: AuditFindingDoc): boolean {
  return finding.manualReview || finding.isChecklistRow;
}

export interface AuditFindingFilterState {
  search: string;
  tool: string; // "" = all
  sourceTab: string; // "" = all
  auditStatus: AuditSeverity | ""; // "" = all
  progressStatus: FixProgressStatus | ""; // "" = all
  manualReviewOnly: boolean;
  showCorrectAndChecklist: boolean; // admin-only toggle; ignored (always false) for client scoping
  deletedView: "active" | "deleted" | "all";
}

export const defaultAuditFindingFilters: AuditFindingFilterState = {
  search: "",
  tool: "",
  sourceTab: "",
  auditStatus: "",
  progressStatus: "",
  manualReviewOnly: false,
  showCorrectAndChecklist: false,
  deletedView: "active",
};

function haystack(finding: AuditFindingDoc): string {
  return [
    finding.issue,
    finding.businessIssue,
    finding.issueId,
    finding.tool,
    finding.sourceTab,
    finding.auditStatus,
    finding.summary,
    finding.fix,
    finding.businessFix,
    finding.verify,
    finding.businessVerify,
    finding.businessDetail,
    finding.technicalExplanation,
    finding.docs,
  ]
    .join("\n")
    .toLowerCase();
}

export function filterFindings(
  findings: AuditFindingDoc[],
  filters: AuditFindingFilterState,
  role: "admin" | "client"
): AuditFindingDoc[] {
  const query = filters.search.trim().toLowerCase();
  return findings.filter((finding) => {
    if (role === "client") {
      if (!isVisibleToClient(finding)) return false;
    } else {
      if (filters.deletedView === "active" && finding.deleted) return false;
      if (filters.deletedView === "deleted" && !finding.deleted) return false;
      if (!filters.showCorrectAndChecklist && (finding.isCorrectRow || finding.isChecklistRow)) return false;
    }
    if (filters.tool && finding.tool !== filters.tool) return false;
    if (filters.sourceTab && finding.sourceTab !== filters.sourceTab) return false;
    if (filters.auditStatus && finding.auditStatus !== filters.auditStatus) return false;
    if (filters.progressStatus && finding.progressStatus !== filters.progressStatus) return false;
    if (filters.manualReviewOnly && !requiresManualReview(finding)) return false;
    if (query && !haystack(finding).includes(query)) return false;
    return true;
  });
}

const severityRank: Record<AuditSeverity, number> = {
  Critical: 0,
  High: 1,
  "Action Needed": 2,
  "Unable to Verify": 3,
  Correct: 4,
};

export type AuditFindingSortKey = "severity" | "tool" | "progress";

export function sortFindings(findings: AuditFindingDoc[], sortKey: AuditFindingSortKey): AuditFindingDoc[] {
  const sorted = [...findings];
  if (sortKey === "severity") {
    sorted.sort((a, b) => severityRank[a.auditStatus] - severityRank[b.auditStatus]);
  } else if (sortKey === "tool") {
    sorted.sort((a, b) => a.tool.localeCompare(b.tool) || a.sourceTab.localeCompare(b.sourceTab));
  } else {
    sorted.sort((a, b) => a.progressStatus.localeCompare(b.progressStatus));
  }
  return sorted;
}

function findingRef(clientId: string, findingId: string) {
  return doc(db, "clients", clientId, "auditFindings", findingId);
}

export async function markFindingProgress(
  clientId: string,
  findingId: string,
  progressStatus: FixProgressStatus,
  uid: string
): Promise<void> {
  await setDoc(
    findingRef(clientId, findingId),
    { progressStatus, progressUpdatedAt: serverTimestamp(), progressUpdatedBy: uid },
    { merge: true }
  );
}

export async function setFindingNote(clientId: string, findingId: string, note: string, uid: string): Promise<void> {
  await setDoc(
    findingRef(clientId, findingId),
    { note, progressUpdatedAt: serverTimestamp(), progressUpdatedBy: uid },
    { merge: true }
  );
}

export async function deleteFinding(clientId: string, findingId: string, uid: string): Promise<void> {
  await setDoc(
    findingRef(clientId, findingId),
    {
      deleted: true,
      deletedAt: serverTimestamp(),
      progressUpdatedAt: serverTimestamp(),
      progressUpdatedBy: uid,
    },
    { merge: true }
  );
}

export async function restoreFinding(clientId: string, findingId: string, uid: string): Promise<void> {
  await setDoc(
    findingRef(clientId, findingId),
    {
      deleted: false,
      deletedAt: null,
      progressUpdatedAt: serverTimestamp(),
      progressUpdatedBy: uid,
    },
    { merge: true }
  );
}

export function newFindingId(): string {
  return `manual-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

// Content fields an admin authors directly from the dashboard — everything else on
// AuditFindingDoc (provenance, classification flags, progress, import bookkeeping) is
// either derived or left at its "freshly created" default. See createFinding/updateFindingContent.
export type AuditFindingFormInput = Pick<
  AuditFindingDoc,
  | "tool"
  | "auditStatus"
  | "sourceTab"
  | "issue"
  | "businessIssue"
  | "detail"
  | "businessDetail"
  | "technicalExplanation"
  | "fix"
  | "businessFix"
  | "verify"
  | "businessVerify"
  | "docs"
  | "owner"
  | "qaOutcome"
  | "reviewStatus"
  | "routingNote"
  | "evidenceLink"
>;

// Shared by createFinding() and bulkCreateFindings() so the two never drift on what a
// "freshly authored" finding's non-form fields default to.
function buildFindingData(input: AuditFindingFormInput, id: string, importBatchId: string): AuditFindingDoc {
  return {
    id,
    row: "",
    sourceRow: "",
    sourceTab: input.sourceTab.trim() || "Manual",
    tool: input.tool,
    issueId: id,

    auditStatus: input.auditStatus,
    manualReview: false,
    isCorrectRow: false,
    isChecklistRow: false,

    issue: input.issue,
    businessIssue: input.businessIssue,
    summary: input.issue,
    detail: input.detail,
    businessDetail: input.businessDetail,
    technicalExplanation: input.technicalExplanation,
    fix: input.fix,
    businessFix: input.businessFix,
    verify: input.verify,
    businessVerify: input.businessVerify,
    docs: input.docs,
    owner: input.owner,
    qaOutcome: input.qaOutcome,
    reviewStatus: input.reviewStatus,
    routingNote: input.routingNote,
    evidenceLink: input.evidenceLink,

    progressStatus: "unreviewed",
    note: "",
    deleted: false,
    deletedAt: null,
    progressUpdatedAt: null,
    progressUpdatedBy: null,

    importedAt: serverTimestamp() as unknown as Timestamp,
    importBatchId,
    legacyProgressMigrated: false,
  };
}

async function enableAuditTracking(clientId: string): Promise<void> {
  await setDoc(doc(db, "clients", clientId, "settings", "dashboard"), { auditTrackingEnabled: true }, { merge: true });
}

/** Creates a manually-authored finding and (idempotently) turns on the client's
 *  "Audit Findings" nav item — today that flag is otherwise only ever set by
 *  scripts/importAuditFindings.js, so a client who never had an import run would
 *  otherwise never see findings created purely through this UI. */
export async function createFinding(clientId: string, input: AuditFindingFormInput, uid: string): Promise<string> {
  const id = newFindingId();
  await setDoc(findingRef(clientId, id), buildFindingData(input, id, `manual-${uid}`));
  await enableAuditTracking(clientId);
  return id;
}

/** Bulk-creates findings from parsed CSV rows (see lib/auditFindingsCsv.ts). Every row gets
 *  its own doc/id (no upsert), written via a chunked writeBatch mirroring convertSync.ts's
 *  BATCH_LIMIT/flushIfNeeded pattern so an arbitrarily large CSV doesn't hit Firestore's
 *  500-op-per-batch cap. All rows from one upload share a single importBatchId so they're
 *  traceable together and distinguishable from single manual creates ("manual-{uid}") and
 *  from the old JSON importer's batches (an ISO timestamp string). */
export async function bulkCreateFindings(clientId: string, rows: AuditFindingFormInput[], uid: string): Promise<string[]> {
  const importBatchId = `csv-${uid}-${Date.now()}`;
  const BATCH_LIMIT = 450; // leave headroom under 500, same margin convertSync.ts uses
  const ids: string[] = [];

  let batch = writeBatch(db);
  let batchOps = 0;
  const flushIfNeeded = async () => {
    if (batchOps >= BATCH_LIMIT) {
      await batch.commit();
      batch = writeBatch(db);
      batchOps = 0;
    }
  };

  for (const row of rows) {
    const id = newFindingId();
    ids.push(id);
    batch.set(findingRef(clientId, id), buildFindingData(row, id, importBatchId));
    batchOps++;
    await flushIfNeeded();
  }
  if (batchOps > 0) await batch.commit();

  if (ids.length > 0) await enableAuditTracking(clientId);
  return ids;
}

/** Content-only update — deliberately never touches progressStatus/note/deleted/
 *  progressUpdatedAt/progressUpdatedBy, so editing a finding's text doesn't disturb
 *  its fix-progress trail. markFindingProgress/setFindingNote/deleteFinding/restoreFinding
 *  remain the only writers of those fields. */
export async function updateFindingContent(
  clientId: string,
  findingId: string,
  input: AuditFindingFormInput
): Promise<void> {
  await setDoc(
    findingRef(clientId, findingId),
    { ...input, sourceTab: input.sourceTab.trim() || "Manual" },
    { merge: true }
  );
}
