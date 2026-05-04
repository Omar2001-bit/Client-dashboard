const admin = require("firebase-admin");
const axios = require("axios");
const crypto = require("crypto");
const path = require("path");

const CONVERT_BASE = "https://api.convert.com/api/v2";
const [targetClientId] = process.argv.slice(2);

const serviceAccount = require(path.join(__dirname, "..", "serviceAccountKey.json"));

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

async function syncConvertDataLocal() {
  const db = admin.firestore();
  let clientsQuery = db.collection("clients").where("status", "==", "active");
  const clientsSnap = await clientsQuery.get();
  const clients = targetClientId
    ? clientsSnap.docs.filter((doc) => doc.id === targetClientId)
    : clientsSnap.docs;

  for (const clientDoc of clients) {
    const clientId = clientDoc.id;
    const clientData = clientDoc.data();
    const credSnap = await db.collection("clients").doc(clientId).collection("credentials").doc("convert").get();

    if (!credSnap.exists) {
      console.log(`Skipping ${clientId}: no Convert credentials`);
      continue;
    }

    const cred = credSnap.data();
    const accountId = cred.accountId;
    const projectId = cred.projectId;
    const contractStart = clientData.contractStartDate?.toDate?.() ?? new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const engagementEnd = clientData.contractEndDate?.toDate?.() ?? new Date();
    const reportEnd = new Date(Math.min(engagementEnd.getTime(), Date.now()));
    const startTime = Math.floor(contractStart.getTime() / 1000);
    const endTime = Math.floor(reportEnd.getTime() / 1000);
    const listUrl = `${CONVERT_BASE}/accounts/${accountId}/projects/${projectId}/experiences`;
    const listBody = JSON.stringify({
      results_per_page: 50,
      sort_by: "id",
      sort_direction: "desc",
      include: ["variations", "goals"],
      expand: ["variations", "goals"],
    });

    const experiencesRes = await axios.post(listUrl, listBody, {
      headers: getConvertHeaders(cred, listUrl, listBody),
    });

    const experiences = (experiencesRes.data?.data ?? experiencesRes.data ?? []).map(compactExperience);
    const reports = await Promise.all(
      experiences.slice(0, 50).map(async (experience) => {
        try {
          const reportUrl = `${CONVERT_BASE}/accounts/${accountId}/projects/${projectId}/experiences/${experience.id}/aggregated_report`;
          const reportBody = JSON.stringify({
              utc_offset: 0,
              start_time: startTime,
              end_time: endTime,
          });
          const reportRes = await axios.post(reportUrl, reportBody, {
            headers: getConvertHeaders(cred, reportUrl, reportBody),
          });
          return { experimentId: String(experience.id), report: compactReport(reportRes.data) };
        } catch (error) {
          const message = error.response?.data?.message ?? error.message;
          console.log(`Report failed for ${clientId}/${experience.id}: ${message}`);
          return { experimentId: String(experience.id), report: null };
        }
      })
    );

    const syncTimestamp = Date.now().toString();
    await db.collection("clients").doc(clientId).collection("data").doc("convert")
      .collection("snapshots").doc(syncTimestamp).set({
        experiments: experiences,
        experiences,
        reports,
        syncedAt: admin.firestore.Timestamp.now(),
        accountId,
        projectId,
      });

    await db.collection("clients").doc(clientId).collection("data").doc("convert").set({
      latestSync: syncTimestamp,
      syncedAt: admin.firestore.Timestamp.now(),
    });

    console.log(`Synced ${experiences.length} experiences for ${clientId}`);
  }
}

function readCredential(value) {
  return String(value ?? "");
}

function getConvertHeaders(cred, requestUrl, requestBody) {
  const applicationId = readCredential(cred.keyId);
  const secretKey = readCredential(cred.keySecret);
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

function compactExperience(experience) {
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

function compactReport(report) {
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

function compactArray(value, mapper) {
  return Array.isArray(value) ? value.map(mapper) : [];
}

function nullable(value) {
  return value === undefined ? null : value;
}

syncConvertDataLocal()
  .then(() => process.exit(0))
  .catch((error) => {
    const details = error.response?.data ?? error;
    console.error(details);
    process.exit(1);
  });
