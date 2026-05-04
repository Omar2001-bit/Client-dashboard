import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getAdminFirestore } from "./lib/firebaseAdmin";
import { decrypt } from "./lib/encryption";
import { callableCors } from "./lib/cors";
import axios, { AxiosError } from "axios";
import * as crypto from "crypto";

const CONVERT_BASE = "https://api.convert.com/api/v2";

// Credentials may be stored either as plaintext (legacy createUserDirectly flow)
// or as AES-encrypted blobs (createClientUser cloud function flow). Try decrypt,
// fall back to the raw value if it doesn't look encrypted.
function readCredential(value: unknown): string {
  const s = String(value ?? "");
  if (!s) return "";
  // Encrypted format is "iv:authTag:ciphertext" (all hex). Plaintext won't have that shape.
  if (/^[0-9a-f]+:[0-9a-f]+:[0-9a-f]+$/i.test(s)) {
    try { return decrypt(s); } catch { /* fall through */ }
  }
  return s;
}

export const getExperiments = onCall(
  { cors: callableCors, timeoutSeconds: 120 },
  async (request) => {
    const { clientId } = request.data as { clientId: string };
    if (!clientId) throw new HttpsError("invalid-argument", "clientId required.");

    const auth = request.auth;
    if (!auth) throw new HttpsError("unauthenticated", "Must be signed in.");

    const db = getAdminFirestore();

    // Allow admin, or the client whose workspace this is.
    const tokenRole = auth.token.role as string | undefined;
    const tokenClientId = auth.token.clientId as string | undefined;
    let isAllowed = tokenRole === "admin" || tokenRole === "executiveAdmin" || tokenClientId === clientId;
    if (!isAllowed) {
      const userDoc = await db.collection("users").doc(auth.uid).get();
      const userData = userDoc.data();
      isAllowed = userData?.role === "admin" || userData?.role === "executiveAdmin" || userData?.clientId === clientId;
    }
    if (!isAllowed) throw new HttpsError("permission-denied", "Access denied.");

    const credSnap = await db
      .collection("clients").doc(clientId)
      .collection("credentials").doc("convert").get();
    if (!credSnap.exists) throw new HttpsError("not-found", "No Convert credentials for this client.");

    const cred = credSnap.data()!;
    const accountId = String(cred.accountId ?? "");
    const projectId = String(cred.projectId ?? "");
    if (!accountId || !projectId) {
      throw new HttpsError("failed-precondition", "Convert credentials missing accountId or projectId.");
    }

    const keyId = readCredential(cred.keyId);
    const keySecret = readCredential(cred.keySecret);
    if (!keyId || !keySecret) {
      throw new HttpsError("failed-precondition", "Convert credentials missing keyId or keySecret.");
    }

    const clientDoc = await db.collection("clients").doc(clientId).get();
    const clientData = clientDoc.data()!;
    const startDate = clientData.contractStartDate?.toDate?.() ?? new Date(0);
    const startTime = Math.floor(startDate.getTime() / 1000);
    const endTime = Math.floor(Date.now() / 1000);

    // 1) List experiments
    const listUrl = `${CONVERT_BASE}/accounts/${accountId}/projects/${projectId}/experiences`;
    const listBody = JSON.stringify({
      results_per_page: 500,
      sort_by: "id",
      sort_direction: "asc",
      include: ["variations", "goals"],
      expand: ["variations", "goals"],
    });

    let experiences: ExperienceRaw[];
    try {
      const res = await axios.post(listUrl, listBody, {
        headers: signHeaders(keyId, keySecret, listUrl, listBody),
      });
      experiences = (res.data?.data ?? res.data ?? []).map(compactExperience);
    } catch (err) {
      throw httpFromAxios(err, "list experiments");
    }

    // 2) Fetch reports per experiment in parallel — failures here are non-fatal
    const reports = await Promise.all(
      experiences.map(async (exp) => {
        try {
          const url = `${CONVERT_BASE}/accounts/${accountId}/projects/${projectId}/experiences/${exp.id}/aggregated_report`;
          const body = JSON.stringify({ utc_offset: 0, start_time: startTime, end_time: endTime });
          const res = await axios.post(url, body, { headers: signHeaders(keyId, keySecret, url, body) });
          return { experimentId: String(exp.id), report: compactReport(res.data) };
        } catch (err) {
          console.warn(`[getExperiments] report failed for ${exp.id}:`, summarizeAxios(err));
          return { experimentId: String(exp.id), report: null };
        }
      })
    );

    return { experiments: experiences, reports };
  }
);

function signHeaders(keyId: string, keySecret: string, url: string, body: string) {
  const expires = Math.floor(Date.now() / 1000) + 60;
  const sig = crypto
    .createHmac("sha256", keySecret)
    .update(`${keyId}\n${expires}\n${url}\n${body}`)
    .digest("hex");
  return {
    "Content-Type": "application/json",
    "Convert-Application-ID": keyId,
    Expires: String(expires),
    Authorization: `Convert-HMAC-SHA256 Signature=${sig}`,
  };
}

function httpFromAxios(err: unknown, action: string): HttpsError {
  const a = err as AxiosError;
  const status = a.response?.status;
  const body = a.response?.data;
  console.error(`[getExperiments] ${action} failed:`, { status, body, message: a.message });

  if (status === 401 || status === 403) {
    return new HttpsError("permission-denied", `Convert API rejected credentials (${status}). Check the encrypted keyId/keySecret stored for this client.`);
  }
  if (status === 404) {
    return new HttpsError("not-found", `Convert API returned 404 for ${action}. Check accountId/projectId.`);
  }
  if (status) {
    return new HttpsError("unavailable", `Convert API ${action} failed with HTTP ${status}: ${JSON.stringify(body).slice(0, 300)}`);
  }
  return new HttpsError("internal", `Convert API ${action} failed: ${a.message}`);
}

function summarizeAxios(err: unknown) {
  const a = err as AxiosError;
  return { status: a.response?.status, message: a.message };
}

interface ExperienceRaw {
  id: unknown;
  name: unknown;
  status: unknown;
  start_date: unknown;
  end_date: unknown;
  created_at: unknown;
  goals: unknown[];
  variations: unknown[];
}

function compactExperience(e: Record<string, unknown>): ExperienceRaw {
  return {
    id: e.id ?? null,
    name: e.name ?? null,
    status: e.status ?? null,
    start_date: e.start_date ?? null,
    end_date: e.end_date ?? null,
    created_at: e.created_at ?? null,
    goals: Array.isArray(e.goals)
      ? e.goals.map((g: Record<string, unknown>) => ({ id: g.id ?? null, name: g.name ?? null, type: g.type ?? null }))
      : [],
    variations: Array.isArray(e.variations)
      ? e.variations.map((v: Record<string, unknown>) => ({
          id: v.id ?? null,
          name: v.name ?? null,
          status: v.status ?? null,
          traffic_distribution: v.traffic_distribution ?? null,
          is_baseline: v.is_baseline ?? null,
        }))
      : [],
  };
}

function compactReport(report: Record<string, unknown>) {
  const data = (report?.data ?? report ?? {}) as Record<string, unknown>;
  const rd = (data.reportData ?? {}) as Record<string, unknown>;
  return {
    data: {
      variations_data: Array.isArray(data.variations_data)
        ? data.variations_data.map((v: Record<string, unknown>) => ({
            id: v.id ?? null,
            name: v.name ?? null,
            is_baseline: v.is_baseline ?? null,
            traffic_distribution: v.traffic_distribution ?? null,
          }))
        : [],
      reportData: {
        variations: Array.isArray(rd.variations)
          ? (rd.variations as Array<Record<string, unknown>>).map((v) => ({
              id: v.id ?? null,
              stats: Array.isArray(v.stats)
                ? (v.stats as Array<Record<string, unknown>>).map((s) => ({
                    timestamp: s.timestamp ?? null,
                    value: s.value ?? null,
                    totals: s.totals ?? null,
                    visitors: s.visitors ?? null,
                  }))
                : [],
            }))
          : [],
      },
    },
  };
}
