// Firestore CRUD for clients/{clientId}/ga4Reports/{reportId}, mirroring
// frontend/src/lib/auditFindings.ts's exact shape: direct client-SDK Firestore calls
// gated by firestore.rules, no server round-trip — report configs aren't secrets and
// need no privilege escalation beyond "is this user an admin," which the rules already
// enforce. This replaces GA4-simply-layer's src/lib/storage.ts, which used the Firebase
// Admin SDK from a Next.js server route; there is no equivalent server hop here.
import { collection, deleteDoc, doc, getDocs, serverTimestamp, setDoc, Timestamp } from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { Ga4ReportDoc } from "@/types";
import { defaultLayout } from "./types";

function reportsCollection(clientId: string) {
  return collection(db, "clients", clientId, "ga4Reports");
}

function reportRef(clientId: string, reportId: string) {
  return doc(db, "clients", clientId, "ga4Reports", reportId);
}

export async function loadGa4Reports(clientId: string): Promise<Ga4ReportDoc[]> {
  const snap = await getDocs(reportsCollection(clientId));
  return snap.docs.map((d) => d.data() as Ga4ReportDoc);
}

/** Groups reports by their `group` field for the mega-dashboard grid — named groups keep
 *  first-seen order, "Ungrouped" always sorts last. Shared by the admin and client
 *  report-list pages so the grouping rule lives in one place. */
export function groupGa4Reports(reports: Ga4ReportDoc[]): [string, Ga4ReportDoc[]][] {
  const order: string[] = [];
  const map = new Map<string, Ga4ReportDoc[]>();
  for (const r of reports) {
    const key = r.group?.trim() || "Ungrouped";
    if (!map.has(key)) {
      map.set(key, []);
      order.push(key);
    }
    map.get(key)!.push(r);
  }
  order.sort((a, b) => (a === "Ungrouped" ? 1 : b === "Ungrouped" ? -1 : 0));
  return order.map((k) => [k, map.get(k)!]);
}

/** `r-<timestamp36>-<random5>` — not cryptographically strong, but fine since report ids
 *  aren't security-sensitive (matches GA4-simply-layer's original newReportId()). */
export function newGa4ReportId(): string {
  return `r-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export function defaultGa4Report(property: string): Ga4ReportDoc {
  const now = Timestamp.now();
  return {
    id: newGa4ReportId(),
    name: "Untitled report",
    property,
    dimensions: ["date"],
    metrics: ["sessions"],
    chartType: "line",
    rangeA: { preset: "last28" },
    rangeB: { preset: "previousPeriod" },
    limit: 25,
    layout: defaultLayout(["sessions"]),
    createdAt: now,
    updatedAt: now,
  };
}

/** Full config save (the report builder's Save button). `isNew` controls whether
 *  createdAt gets server-stamped (first save) or left untouched (every save after) —
 *  the caller already knows this from its own new-vs-existing state, same as
 *  GA4-simply-layer's own ReportCanvas `isNew` prop. */
export async function saveGa4Report(clientId: string, report: Ga4ReportDoc, isNew: boolean): Promise<void> {
  const ref = reportRef(clientId, report.id);
  if (isNew) {
    await setDoc(ref, { ...report, createdAt: serverTimestamp(), updatedAt: serverTimestamp() }, { merge: true });
    return;
  }
  const rest: Partial<Ga4ReportDoc> = { ...report, updatedAt: serverTimestamp() as never };
  delete rest.createdAt;
  await setDoc(ref, rest, { merge: true });
}

/** Lightweight partial write for drag-and-drop layout autosave — only touches `layout`
 *  and `updatedAt`, not the full config. Uses setDoc+merge (not updateDoc) so this is
 *  safe to call even if the doc doesn't exist yet; callers should still avoid invoking
 *  this before a new report's first full save (see ReportCanvas's isNew guard) so a
 *  drag on an unsaved draft doesn't litter Firestore with a bare {layout} doc. */
export async function updateGa4ReportLayout(
  clientId: string,
  reportId: string,
  layout: Ga4ReportDoc["layout"]
): Promise<void> {
  await setDoc(reportRef(clientId, reportId), { layout, updatedAt: serverTimestamp() }, { merge: true });
}

export async function deleteGa4Report(clientId: string, reportId: string): Promise<void> {
  await deleteDoc(reportRef(clientId, reportId));
}
