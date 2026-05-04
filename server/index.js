const express = require("express");
const cors = require("cors");
const nodemailer = require("nodemailer");
const admin = require("firebase-admin");
const { google } = require("googleapis");
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
const ga4ServiceAccount = JSON.parse(process.env.GA4_SERVICE_ACCOUNT_JSON);

admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });

// Optional: cron + sync — loaded safely so a missing package never crashes the server
try {
  const cron = require("node-cron");
  const { incrementalSyncAllClients } = require("./syncFromConvert");
  cron.schedule("0 8 * * *", () => {
    console.log("[cron] 8:00 AM Cairo — starting scheduled incremental sync");
    incrementalSyncAllClients().catch(console.error);
  }, { timezone: "Africa/Cairo" });
  cron.schedule("0 20 * * *", () => {
    console.log("[cron] 8:00 PM Cairo — starting scheduled incremental sync");
    incrementalSyncAllClients().catch(console.error);
  }, { timezone: "Africa/Cairo" });
  console.log("[cron] Scheduled syncs registered (8 AM and 8 PM Cairo)");
} catch (err) {
  console.warn("[cron] Could not register scheduled syncs:", err.message);
}

const app = express();

app.use(cors({
  origin: process.env.NODE_ENV === "production"
    ? ["https://client-dash-9b027.web.app", "https://client-dash-9b027.firebaseapp.com"]
    : true,
}));
app.use(express.json());

const GMAIL_USER = process.env.GMAIL_USER;
const GMAIL_APP_PASSWORD = process.env.GMAIL_APP_PASSWORD;
const SUPPORT_EMAIL = "omar@optimizers.agency";

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: { user: GMAIL_USER, pass: GMAIL_APP_PASSWORD },
});

async function sendEmail({ to, subject, html }) {
  await transporter.sendMail({
    from: `Optimizers Support <${GMAIL_USER}>`,
    to,
    subject,
    html,
  });
}

// ── Support emails → Gmail ────────────────────────────────────────────────────

app.post("/api/support-email", async (req, res) => {
  try {
    const { message, senderName, clientName, senderEmail } = req.body ?? {};
    if (!message || !clientName) {
      return res.status(400).json({ error: "message and clientName are required" });
    }

    await sendEmail({
      to: SUPPORT_EMAIL,
      subject: `[Support] New message from ${clientName}`,
      html: `
        <div style="font-family:sans-serif;max-width:600px;color:#0e1c26">
          <h2 style="margin:0 0 16px">New Support Message</h2>
          <table style="border-collapse:collapse;margin-bottom:20px">
            <tr>
              <td style="padding:6px 16px 6px 0;color:#666">Client</td>
              <td style="font-weight:600">${clientName}</td>
            </tr>
            <tr>
              <td style="padding:6px 16px 6px 0;color:#666">From</td>
              <td>${senderName} &lt;${senderEmail}&gt;</td>
            </tr>
          </table>
          <div style="background:#f7fafb;border-left:4px solid #6ae499;border-radius:4px;padding:16px">
            <p style="margin:0;line-height:1.6">${message.replace(/\n/g, "<br>")}</p>
          </div>
        </div>
      `,
    });

    console.log("[support-email] sent to", SUPPORT_EMAIL);
    res.json({ success: true });
  } catch (err) {
    console.error("[support-email] error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Password reset emails → Gmail (to client emails) ─────────────────────────

app.post("/api/send-password-reset", async (req, res) => {
  try {
    const { email, clientName } = req.body ?? {};
    if (!email) return res.status(400).json({ error: "email is required" });

    const resetLink = await admin.auth().generatePasswordResetLink(email);

    await sendEmail({
      to: email,
      subject: "Reset your dashboard password",
      html: `
        <div style="font-family:sans-serif;max-width:600px;color:#0e1c26">
          <h2 style="margin:0 0 16px">Password Reset</h2>
          ${clientName ? `<p>Hi ${clientName},</p>` : ""}
          <p>Your admin has requested a password reset for your dashboard account.</p>
          <p style="margin:24px 0">
            <a href="${resetLink}"
              style="background:#6ae499;color:#0e1c26;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;display:inline-block">
              Reset my password
            </a>
          </p>
          <p style="font-size:12px;color:#999">
            This link expires in 1 hour. If you didn't request this, ignore this email.
          </p>
        </div>
      `,
    });

    console.log("[password-reset] sent to", email);
    res.json({ success: true });
  } catch (err) {
    console.error("[password-reset] error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Notify executive admin when a regular admin creates a client ──────────────

app.post("/api/notify-executive-admin", async (req, res) => {
  try {
    const { executiveAdminEmail, adminName, adminEmail, clientName, clientUrl } = req.body ?? {};
    if (!clientName || !executiveAdminEmail) {
      return res.status(400).json({ error: "clientName and executiveAdminEmail are required" });
    }

    await sendEmail({
      to: executiveAdminEmail,
      subject: `[Action Required] New client "${clientName}" needs a service price`,
      html: `
        <div style="font-family:sans-serif;max-width:600px;color:#0e1c26">
          <h2 style="margin:0 0 8px">New Client Created</h2>
          <p style="margin:0 0 20px;color:#666">A client was created by an admin and needs your attention.</p>
          <table style="border-collapse:collapse;margin-bottom:24px;width:100%">
            <tr>
              <td style="padding:8px 16px 8px 0;color:#666;white-space:nowrap">Client</td>
              <td style="font-weight:600">${clientName}</td>
            </tr>
            <tr>
              <td style="padding:8px 16px 8px 0;color:#666;white-space:nowrap">Created by</td>
              <td>${adminName}${adminEmail ? ` &lt;${adminEmail}&gt;` : ""}</td>
            </tr>
          </table>
          <div style="background:#fff8e1;border-left:4px solid #f59e0b;border-radius:4px;padding:16px;margin-bottom:28px">
            <p style="margin:0;font-weight:600;color:#92400e">Service price is missing</p>
            <p style="margin:8px 0 0;color:#78350f;line-height:1.6">
              The ROI dashboard cannot be calculated until you set the USD amount this client paid.
            </p>
          </div>
          ${clientUrl ? `
          <a href="${clientUrl}"
            style="display:inline-block;background:#0e1c26;color:#ffffff;padding:14px 28px;border-radius:8px;text-decoration:none;font-weight:600;font-size:15px">
            Set service price for ${clientName}
          </a>` : ""}
          <p style="font-size:12px;color:#999;margin:24px 0 0">Sent automatically by Optimizers dashboard.</p>
        </div>
      `,
    });

    console.log("[notify-executive-admin] sent to executive admin:", executiveAdminEmail);
    res.json({ success: true });
  } catch (err) {
    console.error("[notify-executive-admin] error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── GA4 Analytics ─────────────────────────────────────────────────────────────

function getGA4Auth() {
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
  return {
    audienceId,
    experimentId,
    variationId,
    description: description.trim(),
    isOriginal: description.toLowerCase().includes("original"),
    displayName: audience.displayName,
  };
}

app.get("/api/ga4/properties", async (_req, res) => {
  try {
    const auth = getGA4Auth();
    const analyticsAdmin = google.analyticsadmin({ version: "v1alpha", auth });
    const resp = await analyticsAdmin.accountSummaries.list({ pageSize: 200 });
    const accountSummaries = resp.data.accountSummaries || [];
    const properties = [];
    for (const account of accountSummaries) {
      for (const prop of account.propertySummaries || []) {
        properties.push({
          propertyId: prop.property.replace("properties/", ""),
          displayName: prop.displayName,
          accountId: account.account.replace("accounts/", ""),
          accountDisplayName: account.displayName,
        });
      }
    }
    res.json({ properties });
  } catch (err) {
    console.error("[ga4/properties]", err.message);
    res.status(500).json({ error: err.message });
  }
});

// Body: { propertyId, experimentDates: { [experimentId]: { startDate: "YYYY-MM-DD", endDate: "YYYY-MM-DD"|"today" } } }
app.post("/api/ga4/experiment-data", async (req, res) => {
  const { propertyId, experimentDates = {} } = req.body ?? {};
  if (!propertyId) return res.status(400).json({ error: "propertyId required" });
  try {
    const auth = getGA4Auth();
    const analyticsAdmin = google.analyticsadmin({ version: "v1alpha", auth });
    const analyticsData = google.analyticsdata({ version: "v1beta", auth });

    // Collect all audiences (paginated)
    let allAudiences = [];
    let pageToken;
    do {
      const r = await analyticsAdmin.properties.audiences.list({
        parent: `properties/${propertyId}`,
        pageSize: 200,
        ...(pageToken ? { pageToken } : {}),
      });
      allAudiences = allAudiences.concat(r.data.audiences || []);
      pageToken = r.data.nextPageToken;
    } while (pageToken);

    const convertAudiences = allAudiences.map(parseConvertAudience).filter(Boolean);
    if (convertAudiences.length === 0) return res.json({ experiments: [] });

    // Group audiences by experimentId
    const audiencesByExp = {};
    for (const a of convertAudiences) {
      if (!audiencesByExp[a.experimentId]) audiencesByExp[a.experimentId] = [];
      audiencesByExp[a.experimentId].push(a);
    }

    // Only process experiments that have known dates from Convert/Firestore.
    // Audiences whose experimentId isn't in experimentDates are from outside
    // this client's Convert data and must be ignored.
    const knownExperimentIds = Object.keys(audiencesByExp).filter((id) => experimentDates[id]);
    if (knownExperimentIds.length === 0) return res.json({ experiments: [] });

    // NOTE: audienceId is NOT a filterable dimension in GA4 Data API.
    // We run each report WITHOUT a dimensionFilter and filter rows in JS.
    // Process in batches of 5 to stay within GA4's 10-concurrent-request limit.
    const BATCH_SIZE = 5;
    const results = [];

    for (let i = 0; i < knownExperimentIds.length; i += BATCH_SIZE) {
      const chunk = knownExperimentIds.slice(i, i + BATCH_SIZE);

      const batchResults = await Promise.all(
        chunk.map(async (experimentId) => {
          const audiences = audiencesByExp[experimentId];
          const dates = experimentDates[experimentId];
          const startDate = dates.startDate;
          const endDate = dates.endDate;
          // Set of audienceIds belonging to this experiment (for JS-side filtering)
          const audienceIdSet = new Set(audiences.map((a) => a.audienceId));

          try {
            const reportResp = await analyticsData.properties.runReport({
              property: `properties/${propertyId}`,
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

            // Filter rows to only those whose audienceId belongs to this experiment
            const metricsMap = {};
            for (const row of reportResp.data.rows || []) {
              const id = row.dimensionValues[0].value;
              if (!audienceIdSet.has(id)) continue;
              metricsMap[id] = {
                activeUsers: parseInt(row.metricValues[0].value || "0"),
                sessions: parseInt(row.metricValues[1].value || "0"),
                purchaseRevenue: parseFloat(row.metricValues[2].value || "0"),
                transactions: parseInt(row.metricValues[3].value || "0"),
                products: parseInt(row.metricValues[4].value || "0"),
              };
            }

            console.log(`[ga4] exp ${experimentId}: ${Object.keys(metricsMap).length}/${audienceIdSet.size} audiences matched in ${startDate}–${endDate}`);

            return {
              experimentId,
              startDate,
              endDate,
              variations: audiences.map((a) => ({
                ...a,
                ...(metricsMap[a.audienceId] || { activeUsers: 0, sessions: 0, purchaseRevenue: 0, transactions: 0, products: 0 }),
              })),
            };
          } catch (err) {
            console.warn(`[ga4] report failed for exp ${experimentId}:`, err.message);
            return {
              experimentId,
              startDate,
              endDate,
              variations: audiences.map((a) => ({ ...a, activeUsers: 0, sessions: 0, purchaseRevenue: 0, transactions: 0, products: 0 })),
            };
          }
        })
      );

      results.push(...batchResults);
    }

    res.json({ experiments: results });
  } catch (err) {
    console.error("[ga4/experiment-data]", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get("/health", (_req, res) => res.json({ ok: true }));

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Support server running on port ${PORT}`));
