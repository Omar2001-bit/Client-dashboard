import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getAdminFirestore } from "./lib/firebaseAdmin";
import { decrypt } from "./lib/encryption";
import axios from "axios";
import * as crypto from "crypto";
import * as admin from "firebase-admin";

const CONVERT_BASE = "https://api.convert.com/api/v2";

export const triggerSync = onCall(async (request) => {
  const callerRole = request.auth?.token?.role as string | undefined;
  if (callerRole !== "admin" && callerRole !== "executiveAdmin") {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError("permission-denied", "Admin access required.");
    const db = getAdminFirestore();
    const userDoc = await db.collection("users").doc(uid).get();
    const userRole = userDoc.data()?.role as string | undefined;
    if (userRole !== "admin" && userRole !== "executiveAdmin") {
      throw new HttpsError("permission-denied", "Admin access required.");
    }
  }

  const { clientId } = request.data as { clientId: string };
  if (!clientId) throw new HttpsError("invalid-argument", "clientId required.");

  const db = getAdminFirestore();

  const credSnap = await db
    .collection("clients").doc(clientId)
    .collection("credentials").doc("convert").get();

  if (!credSnap.exists) throw new HttpsError("not-found", "No Convert credentials found for this client.");

  const cred = credSnap.data()!;
  const { accountId, projectId } = cred;
  const clientDoc = await db.collection("clients").doc(clientId).get();
  const clientData = clientDoc.data()!;
  const startDate = clientData.contractStartDate?.toDate?.() ?? new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const engagementEndDate = clientData.contractEndDate?.toDate?.() ?? new Date();
  const reportEndDate = new Date(Math.min(engagementEndDate.getTime(), Date.now()));
  const startTime = Math.floor(startDate.getTime() / 1000);
  const endTime = Math.floor(reportEndDate.getTime() / 1000);

  const listUrl = `${CONVERT_BASE}/accounts/${accountId}/projects/${projectId}/experiences`;
  const listBody = JSON.stringify({
    results_per_page: 500,
    sort_by: "id",
    sort_direction: "asc",
    include: ["variations", "goals"],
    expand: ["variations", "goals"],
  });

  const experiencesRes = await axios.post(listUrl, listBody, {
    headers: getConvertHeaders(cred, listUrl, listBody),
  });

  const experiences = (experiencesRes.data?.data ?? experiencesRes.data ?? []).map(compactExperience);

  const reportJobs = experiences.map(async (exp: { id: string | number }) => {
    try {
      const reportUrl = `${CONVERT_BASE}/accounts/${accountId}/projects/${projectId}/experiences/${exp.id}/aggregated_report`;
      const reportBody = JSON.stringify({ utc_offset: 0, start_time: startTime, end_time: endTime });
      const res = await axios.post(reportUrl, reportBody, {
        headers: getConvertHeaders(cred, reportUrl, reportBody),
      });
      return { experimentId: String(exp.id), report: compactReport(res.data) };
    } catch {
      return { experimentId: String(exp.id), report: null };
    }
  });

  const reports = await Promise.all(reportJobs);
  const syncTimestamp = Date.now().toString();

  await db.collection("clients").doc(clientId)
    .collection("data").doc("convert")
    .collection("snapshots").doc(syncTimestamp)
    .set({ experiments: experiences, experiences, reports, syncedAt: admin.firestore.Timestamp.now(), accountId, projectId });

  await db.collection("clients").doc(clientId)
    .collection("data").doc("convert")
    .set({ latestSync: syncTimestamp, syncedAt: admin.firestore.Timestamp.now() });

  return { success: true, experimentCount: experiences.length, syncTimestamp };
});

function getConvertHeaders(cred: Record<string, unknown>, requestUrl: string, requestBody: string) {
  const readCred = (v: unknown) => { try { return decrypt(String(v)); } catch { return String(v); } };
  const keyId = cred.keyId ? readCred(cred.keyId) : "";
  const keySecret = cred.keySecret ? readCred(cred.keySecret) : "";

  if (keyId && keySecret) {
    const expires = Math.floor(Date.now() / 1000) + 60;
    const sig = crypto.createHmac("sha256", keySecret)
      .update(`${keyId}\n${expires}\n${requestUrl}\n${requestBody}`).digest("hex");
    return {
      "Content-Type": "application/json",
      "Convert-Application-ID": keyId,
      "Expires": String(expires),
      "Authorization": `Convert-HMAC-SHA256 Signature=${sig}`,
    };
  }

  const legacy = cred.apiKey ? readCred(cred.apiKey) : "";
  if (legacy) return { "Content-Type": "application/json", "Authorization": `Bearer ${legacy}` };

  throw new HttpsError("failed-precondition", "Missing Convert credentials.");
}

function compactExperience(e: Record<string, unknown>) {
  return {
    id: e.id ?? null, name: e.name ?? null, type: e.type ?? null,
    status: e.status ?? null, start_date: e.start_date ?? null,
    end_date: e.end_date ?? null, created_at: e.created_at ?? null,
    goals: Array.isArray(e.goals) ? e.goals.map((g: Record<string, unknown>) => ({ id: g.id ?? null, name: g.name ?? null, type: g.type ?? null })) : [],
    variations: Array.isArray(e.variations) ? e.variations.map((v: Record<string, unknown>) => ({ id: v.id ?? null, name: v.name ?? null, status: v.status ?? null, traffic_distribution: v.traffic_distribution ?? null, is_baseline: v.is_baseline ?? null })) : [],
  };
}

function compactReport(report: Record<string, unknown>) {
  const data = (report?.data ?? report ?? {}) as Record<string, unknown>;
  return {
    data: {
      variations_data: Array.isArray(data.variations_data) ? data.variations_data.map((v: Record<string, unknown>) => ({ id: v.id ?? null, name: v.name ?? null, is_baseline: v.is_baseline ?? null, traffic_distribution: v.traffic_distribution ?? null })) : [],
      reportData: {
        variations: Array.isArray((data.reportData as Record<string, unknown>)?.variations)
          ? ((data.reportData as Record<string, unknown>).variations as Array<Record<string, unknown>>).map((v) => ({
              id: v.id ?? null,
              stats: Array.isArray(v.stats) ? v.stats.map((s: Record<string, unknown>) => ({ timestamp: s.timestamp ?? null, value: s.value ?? null, totals: s.totals ?? null, visitors: s.visitors ?? null })) : [],
            }))
          : [],
      },
    },
  };
}
