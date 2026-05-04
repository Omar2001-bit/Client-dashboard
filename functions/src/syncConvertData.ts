import { onSchedule } from "firebase-functions/v2/scheduler";
import { getAdminFirestore } from "./lib/firebaseAdmin";
import { decrypt } from "./lib/encryption";
import axios from "axios";
import * as crypto from "crypto";
import * as admin from "firebase-admin";

const CONVERT_BASE = "https://api.convert.com/api/v2";

export const syncConvertData = onSchedule("every 30 minutes", async () => {
  const db = getAdminFirestore();
  const clientsSnap = await db.collection("clients").where("status", "==", "active").get();

  const jobs = clientsSnap.docs.map(async (clientDoc) => {
    const clientId = clientDoc.id;
    try {
      const credSnap = await db
        .collection("clients")
        .doc(clientId)
        .collection("credentials")
        .doc("convert")
        .get();

      if (!credSnap.exists) return;
      const cred = credSnap.data()!;
      const { accountId, projectId } = cred;
      const clientData = clientDoc.data();
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

      const experiencesRes = await axios.post(
        listUrl,
        listBody,
        { headers: getConvertHeaders(cred, listUrl, listBody) }
      );

      const experiences = (experiencesRes.data?.data ?? experiencesRes.data ?? []).map(compactExperience);

      const reportJobs = experiences.slice(0, 500).map(async (experience: { id: string | number }) => {
        try {
          const reportUrl = `${CONVERT_BASE}/accounts/${accountId}/projects/${projectId}/experiences/${experience.id}/aggregated_report`;
          const reportBody = JSON.stringify({
              utc_offset: 0,
              start_time: startTime,
              end_time: endTime,
            });
          const reportRes = await axios.post(
            reportUrl,
            reportBody,
            { headers: getConvertHeaders(cred, reportUrl, reportBody) }
          );
          return { experimentId: String(experience.id), report: compactReport(reportRes.data) };
        } catch {
          return { experimentId: String(experience.id), report: null };
        }
      });

      const reports = await Promise.all(reportJobs);
      const syncTimestamp = Date.now().toString();

      await db
        .collection("clients")
        .doc(clientId)
        .collection("data")
        .doc("convert")
        .collection("snapshots")
        .doc(syncTimestamp)
        .set({
          experiments: experiences,
          experiences,
          reports,
          syncedAt: admin.firestore.Timestamp.now(),
          accountId,
          projectId,
        });

      // Keep only the latest snapshot reference
      await db
        .collection("clients")
        .doc(clientId)
        .collection("data")
        .doc("convert")
        .set({ latestSync: syncTimestamp, syncedAt: admin.firestore.Timestamp.now() });

      console.info(`[syncConvert] client=${clientId} experiences=${experiences.length}`);
    } catch (err) {
      console.error(`[syncConvert] client=${clientId} error:`, err);
    }
  });

  await Promise.all(jobs);
});

function getConvertHeaders(cred: Record<string, unknown>, requestUrl: string, requestBody: string) {
  const applicationId = cred.keyId ? readCredential(String(cred.keyId)) : "";
  const secretKey = cred.keySecret ? readCredential(String(cred.keySecret)) : "";
  if (applicationId && secretKey) {
    const expires = Math.floor(Date.now() / 1000) + 60;
    const signString = `${applicationId}\n${expires}\n${requestUrl}\n${requestBody}`;
    const signature = crypto.createHmac("sha256", secretKey).update(signString).digest("hex");
    return {
      "Content-Type": "application/json",
      "Convert-Application-ID": applicationId,
      Expires: String(expires),
      Authorization: `Convert-HMAC-SHA256 Signature=${signature}`,
    };
  }

  const legacy = cred.apiKey ? readCredential(String(cred.apiKey)) : "";
  if (legacy) {
    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${legacy}`,
    };
  }

  throw new Error("Missing Convert credentials (keyId/keySecret).");
}

function readCredential(value: string): string {
  try {
    return decrypt(value);
  } catch {
    return value;
  }
}

function compactExperience(experience: Record<string, any>) {
  return {
    id: nullable(experience.id),
    name: nullable(experience.name),
    type: nullable(experience.type),
    status: nullable(experience.status),
    project: nullable(experience.project),
    start_date: nullable(experience.start_date),
    end_date: nullable(experience.end_date),
    created_at: nullable(experience.created_at),
    goals: compactArray(experience.goals, (goal) => ({
      id: nullable(goal.id),
      name: nullable(goal.name),
      type: nullable(goal.type),
    })),
    variations: compactArray(experience.variations, (variation) => ({
      id: nullable(variation.id),
      name: nullable(variation.name),
      status: nullable(variation.status),
      traffic_distribution: nullable(variation.traffic_distribution),
      is_baseline: nullable(variation.is_baseline),
    })),
  };
}

function compactReport(report: Record<string, any>) {
  const data = report?.data ?? report ?? {};
  return {
    data: {
      variations_data: compactArray(data.variations_data, (variation) => ({
        id: nullable(variation.id),
        name: nullable(variation.name),
        status: nullable(variation.status),
        traffic_distribution: nullable(variation.traffic_distribution),
        is_baseline: nullable(variation.is_baseline),
      })),
      reportData: {
        variations: compactArray(data.reportData?.variations, (variation) => ({
          id: nullable(variation.id),
          stats: compactArray(variation.stats, (stat) => ({
            timestamp: nullable(stat.timestamp),
            value: nullable(stat.value),
            totals: nullable(stat.totals),
            visitors: nullable(stat.visitors),
          })),
        })),
      },
    },
  };
}

function compactArray<R>(value: any[] | undefined, mapper: (item: any) => R): R[] {
  return Array.isArray(value) ? value.map(mapper) : [];
}

function nullable<T>(value: T | undefined): T | null {
  return value === undefined ? null : value;
}
