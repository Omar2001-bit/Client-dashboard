const express = require("express");
const cors = require("cors");
const crypto = require("crypto");
const admin = require("firebase-admin");
const { google } = require("googleapis");
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const ga4Reporting = require("./ga4Reporting");
// Credentials: env vars on Render, local JSON files in development
const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT_JSON
  ? JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON)
  : require("../functions/serviceAccountKey.json");
const ga4ServiceAccount = process.env.GA4_SERVICE_ACCOUNT_JSON
  ? JSON.parse(process.env.GA4_SERVICE_ACCOUNT_JSON)
  : require("./ga4ServiceAccount.json");

loadLocalEnv();
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

function loadLocalEnv() {
  for (const filePath of [path.resolve(__dirname, ".env.local"), path.resolve(__dirname, "..", ".env.local")]) {
    if (!fs.existsSync(filePath)) continue;
    const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const separator = trimmed.indexOf("=");
      if (separator <= 0) continue;
      const key = trimmed.slice(0, separator).trim();
      const rawValue = trimmed.slice(separator + 1).trim();
      if (!process.env[key]) {
        process.env[key] = rawValue.replace(/^['"]|['"]$/g, "");
      }
    }
  }
}

function getAuthToken(req) {
  const header = String(req.headers.authorization || "");
  return header.startsWith("Bearer ") ? header.slice(7).trim() : "";
}

async function requireAdmin(req, res, next) {
  try {
    const idToken = getAuthToken(req);
    if (!idToken) return res.status(401).json({ error: "Missing auth token" });

    const decoded = await admin.auth().verifyIdToken(idToken);
    if (decoded.role === "admin" || decoded.role === "executiveAdmin") {
      req.user = decoded;
      return next();
    }

    const userSnap = await admin.firestore().doc(`users/${decoded.uid}`).get();
    const role = userSnap.data()?.role;
    if (role === "admin" || role === "executiveAdmin") {
      req.user = decoded;
      return next();
    }

    return res.status(403).json({ error: "Admin access required" });
  } catch (err) {
    console.error("[auth] admin check failed:", err.message);
    return res.status(401).json({ error: "Invalid auth token" });
  }
}

// Allows admin OR the client who owns `getClientId(req)` — clientId is read only from the
// verified token (or its Firestore-doc fallback), never trusted from the request body/query,
// so a client-role caller can't widen access by just passing a different clientId.
function requireClientOrAdminOwnership(getClientId) {
  return async function (req, res, next) {
    try {
      const idToken = getAuthToken(req);
      if (!idToken) return res.status(401).json({ error: "Missing auth token" });

      const decoded = await admin.auth().verifyIdToken(idToken);
      if (decoded.role === "admin" || decoded.role === "executiveAdmin") {
        req.user = decoded;
        return next();
      }

      const requestedClientId = getClientId(req);
      if (decoded.role === "client" && decoded.clientId && decoded.clientId === requestedClientId) {
        req.user = decoded;
        return next();
      }

      const userSnap = await admin.firestore().doc(`users/${decoded.uid}`).get();
      const userData = userSnap.data();
      if (userData?.role === "admin" || userData?.role === "executiveAdmin") {
        req.user = decoded;
        return next();
      }
      if (userData?.role === "client" && userData.clientId && userData.clientId === requestedClientId) {
        req.user = decoded;
        return next();
      }

      return res.status(403).json({ error: "Not authorized for this client" });
    } catch (err) {
      console.error("[auth] client-ownership check failed:", err.message);
      return res.status(401).json({ error: "Invalid auth token" });
    }
  };
}

// One-off fix for /api/ga4/experiment-data, which historically took a bare `propertyId`
// with no clientId at all (finding C4 — it had no auth check whatsoever). The caller's
// clientId comes only from the verified token; the route then 403s unless that client's
// own configured ga4PropertyId matches the propertyId being requested, so a client can
// never pull another client's GA4 property through the shared service account.
async function requireClientOwnsGA4Property(req, res, next) {
  try {
    const idToken = getAuthToken(req);
    if (!idToken) return res.status(401).json({ error: "Missing auth token" });

    const decoded = await admin.auth().verifyIdToken(idToken);
    if (decoded.role === "admin" || decoded.role === "executiveAdmin") {
      req.user = decoded;
      return next();
    }

    let clientId = decoded.role === "client" ? decoded.clientId : undefined;
    let role = decoded.role;
    if (!clientId) {
      const userSnap = await admin.firestore().doc(`users/${decoded.uid}`).get();
      const userData = userSnap.data();
      role = userData?.role;
      clientId = userData?.clientId;
    }
    if (role === "admin" || role === "executiveAdmin") {
      req.user = decoded;
      return next();
    }
    if (role !== "client" || !clientId) {
      return res.status(403).json({ error: "Not authorized" });
    }

    const clientSnap = await admin.firestore().doc(`clients/${clientId}`).get();
    const requestedPropertyId = String(req.body?.propertyId || "");
    if (!clientSnap.exists || clientSnap.data()?.ga4PropertyId !== requestedPropertyId) {
      return res.status(403).json({ error: "Not authorized for this GA4 property" });
    }

    req.user = decoded;
    return next();
  } catch (err) {
    console.error("[auth] GA4 property ownership check failed:", err.message);
    return res.status(401).json({ error: "Invalid auth token" });
  }
}

const GMAIL_USER = process.env.GMAIL_USER || "optimizerssupport@gmail.com";
const SUPPORT_EMAIL = "omar@optimizers.agency";
const CLICKUP_API_BASE = "https://api.clickup.com/api/v2";
const CLICKUP_ACCESS_DOC = "appConfig/clickupAccess";

function getGmailClient() {
  const auth = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET
  );
  auth.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });
  return google.gmail({ version: "v1", auth });
}

async function sendEmail({ to, subject, html }) {
  const raw = Buffer.from(
    [
      `From: Optimizers Support <${GMAIL_USER}>`,
      `To: ${to}`,
      `Subject: ${subject}`,
      "MIME-Version: 1.0",
      "Content-Type: text/html; charset=UTF-8",
      "",
      html,
    ].join("\r\n")
  ).toString("base64url");

  const gmail = getGmailClient();
  await gmail.users.messages.send({ userId: "me", requestBody: { raw } });
}

// ── Support emails → Gmail ────────────────────────────────────────────────────

async function readClickUpAccessConfig() {
  const envToken = String(process.env.CLICKUP_PERSONAL_TOKEN || process.env.CLICKUP_API_TOKEN || "").trim();
  const snap = await admin.firestore().doc(CLICKUP_ACCESS_DOC).get();
  const data = snap.exists ? snap.data() ?? {} : {};
  const storedToken = String(data.personalToken ?? data.accessToken ?? data.token ?? "").trim();
  const token = storedToken || envToken;
  const updatedAtDate = data.updatedAt?.toDate?.();

  return {
    token,
    configured: Boolean(token),
    source: storedToken ? "firestore" : envToken ? "env" : "",
    updatedAt: updatedAtDate?.toISOString?.() ?? null,
    updatedBy: data.updatedBy ?? null,
  };
}

async function fetchClickUpWithToken(token, pathname, params = {}) {
  if (!token) {
    const err = new Error("ClickUp personal token is not configured.");
    err.status = 500;
    throw err;
  }

  const url = new URL(`${CLICKUP_API_BASE}${pathname}`);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, String(value));
  }

  const response = await fetch(url, {
    headers: {
      Authorization: token,
      accept: "application/json",
    },
  });

  if (!response.ok) {
    const text = await response.text();
    const err = new Error(`ClickUp API error ${response.status}: ${text.slice(0, 300)}`);
    err.status = response.status;
    throw err;
  }

  return response.json();
}

async function fetchClickUp(pathname, params = {}) {
  const config = await readClickUpAccessConfig();
  return fetchClickUpWithToken(config.token, pathname, params);
}

function normalizeWorkspaces(payload) {
  const raw = Array.isArray(payload.teams) ? payload.teams : Array.isArray(payload.team) ? payload.team : [];
  return raw
    .map((workspace) => ({
      id: String(workspace.id ?? workspace.team_id ?? workspace.workspace_id ?? ""),
      name: String(workspace.name ?? workspace.username ?? workspace.url ?? "Workspace"),
    }))
    .filter((workspace) => workspace.id);
}

function normalizeDate(value) {
  if (value === null || value === undefined || value === "") return undefined;
  const asString = String(value);
  if (/^\d+$/.test(asString)) {
    const millis = Number(asString);
    if (Number.isFinite(millis)) return new Date(millis).toISOString().slice(0, 10);
  }
  const parsed = new Date(asString);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString().slice(0, 10);
}

function normalizeAssigneeNames(assignees) {
  return Array.isArray(assignees)
    ? assignees.map((a) => String(a.username ?? a.email ?? a.name ?? a.id ?? "")).filter(Boolean)
    : [];
}

function normalizeTask(task) {
  const dueDate = normalizeDate(task.due_date ?? task.dueDate);
  const startDate = normalizeDate(task.start_date ?? task.startDate);

  const subtasks = Array.isArray(task.subtasks)
    ? task.subtasks
        .map((sub) => ({
          id: String(sub.id ?? ""),
          name: String(sub.name ?? ""),
          status: String(sub.status?.status ?? sub.status ?? ""),
          assigneeNames: normalizeAssigneeNames(sub.assignees),
        }))
        .filter((s) => s.id)
    : [];

  const checklists = Array.isArray(task.checklists)
    ? task.checklists.map((cl) => ({
        id: String(cl.id ?? ""),
        name: String(cl.name ?? "Checklist"),
        items: Array.isArray(cl.items)
          ? cl.items.map((item) => ({
              id: String(item.id ?? ""),
              name: String(item.name ?? ""),
              resolved: Boolean(item.resolved),
              assignee: item.assignee
                ? String(item.assignee.username ?? item.assignee.email ?? item.assignee.name ?? "")
                : undefined,
            }))
          : [],
      }))
    : [];

  return {
    id: String(task.id ?? ""),
    name: String(task.name ?? "Untitled task"),
    status: String(task.status?.status ?? task.status ?? ""),
    statusColor: task.status?.color ?? null,
    startDate: startDate ?? null,
    dueDate: dueDate ?? null,
    listId: String(task.list?.id ?? task.list_id ?? ""),
    listName: String(task.list?.name ?? task.list_name ?? ""),
    assigneeNames: normalizeAssigneeNames(task.assignees),
    url: String(task.url ?? ""),
    parentId: task.parent != null ? String(task.parent) : null,
    timeSpent: task.time_spent != null ? Number(task.time_spent) : null,
    subtasks,
    checklists,
  };
}

// ClickUp list endpoints return subtasks as flat sibling items (each with a `parent` field),
// not nested under the parent task. This rebuilds the proper tree from parentId relationships.
function buildTaskTree(flatTasks) {
  const byId = new Map();
  for (const task of flatTasks) {
    byId.set(task.id, { ...task, subtasks: [] });
  }

  const roots = [];
  for (const task of byId.values()) {
    if (task.parentId) {
      const parent = byId.get(task.parentId);
      if (parent) {
        parent.subtasks.push({
          id: task.id,
          name: task.name,
          status: task.status,
          assigneeNames: task.assigneeNames,
        });
      } else {
        roots.push(task); // orphaned subtask — include at root
      }
    } else {
      roots.push(task);
    }
  }

  return roots;
}

async function fetchWorkspaceTasks(workspaceId) {
  const flat = [];
  for (let page = 0; page < 100; page += 1) {
    const payload = await fetchClickUp(`/team/${encodeURIComponent(workspaceId)}/task`, {
      page,
      subtasks: true,
      include_closed: true,
      order_by: "updated",
      reverse: true,
    });
    const pageTasks = Array.isArray(payload.tasks) ? payload.tasks : Array.isArray(payload.data) ? payload.data : [];
    if (pageTasks.length === 0) break;
    flat.push(...pageTasks.map(normalizeTask).filter((t) => t.id));
    if (pageTasks.length < 100) break;
  }
  return buildTaskTree(flat);
}

async function fetchFolderTasks(folderId) {
  const listPayload = await fetchClickUp(`/folder/${encodeURIComponent(folderId)}/list`, {
    archived: false,
  });
  const lists = Array.isArray(listPayload.lists) ? listPayload.lists : [];

  const flat = [];
  await Promise.all(
    lists.map(async (list) => {
      const listFlat = [];
      for (let page = 0; page < 100; page += 1) {
        const payload = await fetchClickUp(`/list/${encodeURIComponent(list.id)}/task`, {
          page,
          subtasks: true,
          include_closed: true,
          order_by: "updated",
          reverse: true,
        });
        const pageTasks = Array.isArray(payload.tasks) ? payload.tasks : [];
        if (pageTasks.length === 0) break;
        listFlat.push(...pageTasks.map(normalizeTask).filter((t) => t.id));
        if (pageTasks.length < 100) break;
      }
      flat.push(...listFlat);
    })
  );

  return buildTaskTree(flat);
}

async function fetchFoldersForWorkspace(workspaceId) {
  const spacesPayload = await fetchClickUp(`/team/${encodeURIComponent(workspaceId)}/space`);
  const spaces = Array.isArray(spacesPayload.spaces) ? spacesPayload.spaces : [];
  const folders = [];
  await Promise.all(
    spaces.map(async (space) => {
      try {
        const folderPayload = await fetchClickUp(`/space/${encodeURIComponent(space.id)}/folder`);
        const spaceFolders = Array.isArray(folderPayload.folders) ? folderPayload.folders : [];
        for (const folder of spaceFolders) {
          const id = String(folder.id ?? "");
          if (!id) continue;
          folders.push({
            id,
            name: String(folder.name ?? "Untitled folder"),
            spaceId: String(space.id ?? ""),
            spaceName: String(space.name ?? ""),
          });
        }
      } catch {
        // skip spaces that fail
      }
    })
  );
  return folders;
}

app.get("/api/clickup/status", requireAdmin, async (_req, res) => {
  try {
    const config = await readClickUpAccessConfig();
    res.json({
      configured: config.configured,
      source: config.source,
      updatedAt: config.updatedAt,
      updatedBy: config.updatedBy,
      documentPath: CLICKUP_ACCESS_DOC,
    });
  } catch (err) {
    console.error("[clickup/status]", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/clickup/access", requireAdmin, async (req, res) => {
  const personalToken = String(req.body?.personalToken || "").trim();
  if (!personalToken) return res.status(400).json({ error: "personalToken is required" });

  try {
    const userPayload = await fetchClickUpWithToken(personalToken, "/user");
    const user = userPayload.user ?? userPayload ?? {};
    const now = admin.firestore.FieldValue.serverTimestamp();
    await admin.firestore().doc(CLICKUP_ACCESS_DOC).set(
      {
        personalToken,
        tokenPreview: `${personalToken.slice(0, 4)}...${personalToken.slice(-4)}`,
        method: "personal_api_token",
        updatedAt: now,
        updatedBy: req.user?.uid ?? null,
        authorizedUserName: String(user.username ?? user.name ?? ""),
        authorizedUserEmail: String(user.email ?? ""),
      },
      { merge: true }
    );

    res.json({
      success: true,
      configured: true,
      source: "firestore",
      documentPath: CLICKUP_ACCESS_DOC,
      authorizedUserName: String(user.username ?? user.name ?? ""),
      authorizedUserEmail: String(user.email ?? ""),
    });
  } catch (err) {
    console.error("[clickup/access]", err.message);
    res.status(err.status || 500).json({ error: err.message });
  }
});

app.get("/api/clickup/workspaces", requireAdmin, async (_req, res) => {
  try {
    const [userPayload, teamsPayload] = await Promise.all([
      fetchClickUp("/user"),
      fetchClickUp("/team"),
    ]);
    const user = userPayload.user ?? userPayload ?? {};
    res.json({
      connected: true,
      authorizedUserName: String(user.username ?? user.name ?? ""),
      authorizedUserEmail: String(user.email ?? ""),
      workspaces: normalizeWorkspaces(teamsPayload),
    });
  } catch (err) {
    console.error("[clickup/workspaces]", err.message);
    res.status(err.status || 500).json({ error: err.message });
  }
});

app.get("/api/clickup/folders", requireAdmin, async (req, res) => {
  const workspaceId = String(req.query.workspaceId || "").trim();
  if (!workspaceId) return res.status(400).json({ error: "workspaceId is required" });
  try {
    const folders = await fetchFoldersForWorkspace(workspaceId);
    res.json({ folders, workspaceId });
  } catch (err) {
    console.error("[clickup/folders]", err.message);
    res.status(err.status || 500).json({ error: err.message });
  }
});

app.get("/api/clickup/tasks", requireAdmin, async (req, res) => {
  const workspaceId = String(req.query.workspaceId || "").trim();
  const folderId = String(req.query.folderId || "").trim();
  if (!workspaceId) return res.status(400).json({ error: "workspaceId is required" });

  try {
    const tasks = folderId
      ? await fetchFolderTasks(folderId)
      : await fetchWorkspaceTasks(workspaceId);
    res.json({ tasks, taskCount: tasks.length, workspaceId, folderId: folderId || null });
  } catch (err) {
    console.error("[clickup/tasks]", err.message);
    res.status(err.status || 500).json({ error: err.message });
  }
});

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

// ── Admin signup approval flow ────────────────────────────────────────────────

const ADMIN_APPROVER_EMAIL = "oelkoshairy@gmail.com";
const PUBLIC_SERVER_URL =
  process.env.PUBLIC_SERVER_URL || "https://client-dashboard-zokm.onrender.com";

app.post("/api/admin-signup/request-approval", async (req, res) => {
  try {
    const idToken = getAuthToken(req);
    if (!idToken) return res.status(401).json({ error: "Missing auth token" });
    const decoded = await admin.auth().verifyIdToken(idToken);
    const uid = decoded.uid;

    const userSnap = await admin.firestore().doc(`users/${uid}`).get();
    const user = userSnap.data();
    if (!userSnap.exists || !user || user.role !== "pendingAdmin") {
      return res.status(400).json({ error: "No pending admin account for this user" });
    }

    const token = crypto.randomBytes(32).toString("hex");
    await admin.firestore().doc(`adminApprovals/${uid}`).set({
      token,
      email: user.email ?? "",
      name: user.name ?? "",
      status: "pending",
      createdAt: new Date(),
    });

    const approveUrl = `${PUBLIC_SERVER_URL}/api/admin-signup/approve?uid=${encodeURIComponent(uid)}&token=${token}`;
    const requestedAt = new Date().toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });

    await sendEmail({
      to: ADMIN_APPROVER_EMAIL,
      subject: `[Admin Approval] ${user.name || user.email} requested an admin account`,
      html: `
        <div style="font-family:sans-serif;max-width:600px;color:#0e1c26">
          <h2 style="margin:0 0 16px">New Admin Account Request</h2>
          <table style="border-collapse:collapse;margin-bottom:20px">
            <tr>
              <td style="padding:6px 16px 6px 0;color:#666">Name</td>
              <td style="font-weight:600">${user.name ?? ""}</td>
            </tr>
            <tr>
              <td style="padding:6px 16px 6px 0;color:#666">Email</td>
              <td>${user.email ?? ""}</td>
            </tr>
            <tr>
              <td style="padding:6px 16px 6px 0;color:#666">Requested</td>
              <td>${requestedAt}</td>
            </tr>
          </table>
          <p style="line-height:1.6;margin:0 0 24px">
            This account is on hold and cannot access the admin dashboard until you approve it.
          </p>
          <p style="margin:0 0 24px">
            <a href="${approveUrl}"
              style="background:#6ae499;color:#0e1c26;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;display:inline-block">
              Approve this account
            </a>
          </p>
          <p style="font-size:12px;color:#999">
            If you did not expect this request, ignore this email — the account stays blocked.
            <br>User ID: ${uid}
          </p>
        </div>
      `,
    });

    console.log("[admin-signup] approval email sent for", uid);
    res.json({ success: true });
  } catch (err) {
    console.error("[admin-signup/request-approval] error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

function approvalResultPage(title, body, ok) {
  return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title></head>
<body style="font-family:sans-serif;background:#f7fafb;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0">
  <div style="background:#fff;border:1px solid rgba(14,28,38,.1);border-radius:16px;padding:40px;max-width:420px;text-align:center">
    <div style="font-size:40px;margin-bottom:12px">${ok ? "✅" : "⚠️"}</div>
    <h1 style="font-size:20px;color:#0e1c26;margin:0 0 8px">${title}</h1>
    <p style="color:#5a6a72;line-height:1.6;margin:0">${body}</p>
  </div>
</body></html>`;
}

app.get("/api/admin-signup/approve", async (req, res) => {
  try {
    const uid = String(req.query.uid || "").trim();
    const token = String(req.query.token || "").trim();
    if (!uid || !token) {
      return res.status(400).send(approvalResultPage("Invalid link", "This approval link is missing required parameters.", false));
    }

    const approvalRef = admin.firestore().doc(`adminApprovals/${uid}`);
    const approvalSnap = await approvalRef.get();
    const approval = approvalSnap.data();

    if (!approvalSnap.exists || !approval) {
      return res.status(404).send(approvalResultPage("Request not found", "No pending approval exists for this account.", false));
    }
    if (approval.status === "approved") {
      return res.status(200).send(approvalResultPage("Already approved", "This account was already approved. No further action needed.", true));
    }

    const expected = Buffer.from(String(approval.token));
    const provided = Buffer.from(token);
    if (expected.length !== provided.length || !crypto.timingSafeEqual(expected, provided)) {
      return res.status(403).send(approvalResultPage("Invalid link", "This approval link is invalid.", false));
    }

    const now = new Date();
    await admin.firestore().doc(`users/${uid}`).update({ role: "admin", updatedAt: now });
    await admin.auth().setCustomUserClaims(uid, { role: "admin" });
    await approvalRef.update({ status: "approved", approvedAt: now });

    console.log("[admin-signup] account approved:", uid);
    res.status(200).send(
      approvalResultPage(
        "Account approved",
        `${approval.name || approval.email || "The user"} can now sign in to the admin dashboard.`,
        true
      )
    );
  } catch (err) {
    console.error("[admin-signup/approve] error:", err.message);
    res.status(500).send(approvalResultPage("Something went wrong", "Approval failed. Check the server logs and try the link again.", false));
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

app.get("/api/ga4/properties", requireAdmin, async (_req, res) => {
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
app.post("/api/ga4/experiment-data", requireClientOwnsGA4Property, async (req, res) => {
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

// ── Analytics Reports (ported from GA4-simply-layer) ─────────────────────────
// Data-fetching routes for the general-purpose GA4 report builder. Unlike the
// experiment-scoped routes above, these never trust property/metrics/dimensions/filters
// from the request body — the query is always rebuilt server-side from the client's own
// stored clients/{clientId}/ga4Reports/{reportId} Firestore doc, so a client-role caller
// editing the request can't redirect the query at another client's GA4 property.

const PROPERTY_RE = /^properties\/\d+$/;
const DIMENSION_RE = /^[A-Za-z0-9_:]+$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isValidResolvedRange(r) {
  return !!r && typeof r === "object" && DATE_RE.test(r.startDate) && DATE_RE.test(r.endDate);
}

// Fixed trailing 28 days ending yesterday — matches the source app's autocomplete
// behavior regardless of the report's own configured range (GA4 data lags ~1 day).
function trailing28DayRange() {
  const fmtDate = (d) => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  };
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const start = new Date(yesterday);
  start.setDate(start.getDate() - 27);
  return { startDate: fmtDate(start), endDate: fmtDate(yesterday) };
}

app.get("/api/ga4-reports/metadata", requireAdmin, async (req, res) => {
  const property = String(req.query.property || "");
  if (!PROPERTY_RE.test(property)) return res.status(400).json({ error: "Invalid property" });
  try {
    const meta = await ga4Reporting.getGa4Metadata(getGA4Auth(), property);
    res.json(meta);
  } catch (err) {
    console.error("[ga4-reports/metadata]", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/ga4-reports/values", requireAdmin, async (req, res) => {
  const property = String(req.query.property || "");
  const dimension = String(req.query.dimension || "");
  if (!PROPERTY_RE.test(property)) return res.status(400).json({ error: "Invalid property" });
  if (!DIMENSION_RE.test(dimension)) return res.status(400).json({ error: "Invalid dimension" });
  try {
    const data = await ga4Reporting.runGa4Report(getGA4Auth(), {
      property,
      dimensions: [dimension],
      metrics: ["eventCount"],
      rangeA: trailing28DayRange(),
      limit: 100,
    });
    const values = data.rows.map((r) => r.dim).filter(Boolean);
    res.json({ values });
  } catch (err) {
    console.error("[ga4-reports/values]", err.message);
    res.status(500).json({ error: err.message });
  }
});

// `metrics`/`dimensions` in the body are an OPTIONAL override — used by the metric
// carousel to browse one metric at a time and let a single slide explore its own
// breakdown dimension (Day/Week/Month, or a category) without editing/saving the report.
// `property`/`filters`/`limit` always come from the stored doc regardless — only the
// metric subset and dimension list are ever caller-influenced, and metrics must be a
// subset of the report's own already-authorized metrics (never an arbitrary GA4 metric),
// so this can't be used to read anything the report wasn't already configured to show.
app.post("/api/ga4-reports/data", requireClientOrAdminOwnership((req) => req.body?.clientId), async (req, res) => {
  const clientId = String(req.body?.clientId || "");
  const reportId = String(req.body?.reportId || "");
  const rangeA = req.body?.rangeA;
  const rangeB = req.body?.rangeB;
  if (!clientId || !reportId) return res.status(400).json({ error: "clientId and reportId required" });
  if (!isValidResolvedRange(rangeA)) return res.status(400).json({ error: "Invalid rangeA" });
  if (rangeB !== null && rangeB !== undefined && !isValidResolvedRange(rangeB)) {
    return res.status(400).json({ error: "Invalid rangeB" });
  }
  try {
    const reportSnap = await admin.firestore().doc(`clients/${clientId}/ga4Reports/${reportId}`).get();
    if (!reportSnap.exists) return res.status(404).json({ error: "Report not found" });
    const report = reportSnap.data();

    let metrics = report.metrics || [];
    if (Array.isArray(req.body?.metrics)) {
      const allowed = new Set(metrics);
      const requested = req.body.metrics.filter((m) => typeof m === "string" && allowed.has(m));
      if (requested.length > 0) metrics = requested;
    }
    const dimensions = Array.isArray(req.body?.dimensions)
      ? req.body.dimensions.filter((d) => typeof d === "string").slice(0, 9)
      : report.dimensions || [];

    const data = await ga4Reporting.runGa4Report(getGA4Auth(), {
      property: report.property,
      dimensions,
      metrics,
      rangeA,
      rangeB: rangeB || null,
      filters: report.filters,
      limit: report.limit,
    });
    res.json(data);
  } catch (err) {
    console.error("[ga4-reports/data]", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/ga4-reports/funnel", requireClientOrAdminOwnership((req) => req.body?.clientId), async (req, res) => {
  const clientId = String(req.body?.clientId || "");
  const reportId = String(req.body?.reportId || "");
  const funnelId = String(req.body?.funnelId || "");
  const rangeA = req.body?.rangeA;
  const rangeB = req.body?.rangeB;
  if (!clientId || !reportId || !funnelId) {
    return res.status(400).json({ error: "clientId, reportId and funnelId required" });
  }
  if (!isValidResolvedRange(rangeA)) return res.status(400).json({ error: "Invalid rangeA" });
  if (rangeB !== null && rangeB !== undefined && !isValidResolvedRange(rangeB)) {
    return res.status(400).json({ error: "Invalid rangeB" });
  }
  try {
    const reportSnap = await admin.firestore().doc(`clients/${clientId}/ga4Reports/${reportId}`).get();
    if (!reportSnap.exists) return res.status(404).json({ error: "Report not found" });
    const report = reportSnap.data();
    const funnel = (report.funnels || []).find((f) => f.id === funnelId);
    if (!funnel) return res.status(404).json({ error: "Funnel not found" });

    const auth = getGA4Auth();
    const [current, previous] = await Promise.all([
      ga4Reporting.runGa4FunnelReport(auth, report.property, funnel, rangeA),
      rangeB ? ga4Reporting.runGa4FunnelReport(auth, report.property, funnel, rangeB) : Promise.resolve(null),
    ]);
    res.json({ current, previous });
  } catch (err) {
    console.error("[ga4-reports/funnel]", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── PageSpeed Insights ────────────────────────────────────────────────────────

const { XMLParser } = require("fast-xml-parser");
const activePageSpeedJobs = new Map();
const PAGE_SPEED_KEYS = String(
  process.env.PAGESPEED_API_KEYS || process.env.PSI_API_KEYS || process.env.PSI_API_KEY || ""
)
  .split(",")
  .map((k) => k.trim())
  .filter(Boolean);
const PAGE_SPEED_CONCURRENCY = Math.max(
  1,
  Math.min(10, Number(process.env.PAGESPEED_CONCURRENCY || 3))
);
const PAGE_SPEED_TIMEOUT_MS = Math.max(
  30000,
  Math.min(180000, Number(process.env.PAGESPEED_TIMEOUT_MS || 60000))
);
const PAGE_SPEED_MAX_ATTEMPTS = Math.max(
  1,
  Math.min(3, Number(process.env.PAGESPEED_MAX_ATTEMPTS || 2))
);

let pageSpeedKeyCursor = 0;
function getNextPageSpeedApiKey() {
  if (PAGE_SPEED_KEYS.length === 0) return "";
  const key = PAGE_SPEED_KEYS[pageSpeedKeyCursor % PAGE_SPEED_KEYS.length];
  pageSpeedKeyCursor = (pageSpeedKeyCursor + 1) % PAGE_SPEED_KEYS.length;
  return key;
}

async function getNextPageSpeedRunId(clientId, date = new Date()) {
  const dateStr = date.toISOString().slice(0, 10);
  const baseRunId = `PAGESPEED-TEST-${dateStr}`;
  const runsCol = admin.firestore().collection(`clients/${clientId}/pagespeed/runs/list`);
  let runId = baseRunId;
  let suffix = 1;
  console.log(`[DEBUG][runId] generating run ID for client=${clientId} base=${baseRunId}`);
  while (true) {
    const existing = await runsCol.doc(runId).get();
    if (!existing.exists) break;
    console.log(`[DEBUG][runId] collision detected for ${runId}, incrementing suffix`);
    suffix += 1;
    runId = `${baseRunId}-${suffix}`;
  }
  console.log(`[DEBUG][runId] final runId=${runId}`);
  return runId;
}

function buildRunAverages(results) {
  const successItems = results.filter((r) => r.scores && !r.error);
  const avgScore = (key) => {
    if (successItems.length === 0) return 0;
    return Math.round(successItems.reduce((s, r) => s + (r.scores?.[key] ?? 0), 0) / successItems.length);
  };
  const avgVital = (key) => {
    const valid = successItems.filter((r) => r.webVitals?.[key] != null);
    if (valid.length === 0) return null;
    return valid.reduce((s, r) => s + (r.webVitals?.[key] ?? 0), 0) / valid.length;
  };
  const metricTotals = {};
  const metricCounts = {};
  for (const item of successItems) {
    const metricValues = item.metricValues && typeof item.metricValues === "object" ? item.metricValues : {};
    for (const [key, val] of Object.entries(metricValues)) {
      if (typeof val !== "number" || !Number.isFinite(val)) continue;
      metricTotals[key] = (metricTotals[key] ?? 0) + val;
      metricCounts[key] = (metricCounts[key] ?? 0) + 1;
    }
  }
  const metricAverages = {};
  for (const [key, total] of Object.entries(metricTotals)) {
    const count = metricCounts[key] ?? 0;
    if (count > 0) metricAverages[key] = total / count;
  }

  // Average 0–1 audit scores across pages — stored in summary docs so the
  // frontend can colour-code the "All Lighthouse Metrics" section and the
  // compare page without needing per-page auditSummaries.
  const auditScoreTotals = {};
  const auditScoreCounts = {};
  for (const item of successItems) {
    const summaries = (item.auditSummaries && typeof item.auditSummaries === "object") ? item.auditSummaries : {};
    for (const [auditId, audit] of Object.entries(summaries)) {
      const score = audit?.score;
      if (typeof score === "number" && Number.isFinite(score)) {
        auditScoreTotals[auditId] = (auditScoreTotals[auditId] ?? 0) + score;
        auditScoreCounts[auditId] = (auditScoreCounts[auditId] ?? 0) + 1;
      }
    }
  }
  const auditScoreAverages = {};
  for (const [key, total] of Object.entries(auditScoreTotals)) {
    const count = auditScoreCounts[key] ?? 0;
    if (count > 0) auditScoreAverages[key] = total / count;
  }

  return {
    successPages: successItems.length,
    averages: {
      performance: avgScore("performance"),
      accessibility: avgScore("accessibility"),
      seo: avgScore("seo"),
      bestPractices: avgScore("bestPractices"),
      lcp: avgVital("lcp"),
      fcp: avgVital("fcp"),
      cls: avgVital("cls"),
      tbt: avgVital("tbt"),
      si: avgVital("si"),
      inp: avgVital("inp"),
    },
    metricAverages,
    auditScoreAverages,
  };
}

function extractAuditNumericValues(audits = {}) {
  const out = {};
  for (const [auditId, audit] of Object.entries(audits)) {
    const value = audit?.numericValue;
    if (typeof value === "number" && Number.isFinite(value)) {
      out[auditId] = value;
    }
  }
  return out;
}

function extractPageSpeedScreenshots(audits = {}) {
  const finalScreenshot = audits["final-screenshot"]?.details?.data ?? null;
  const thumbnailItems = audits["screenshot-thumbnails"]?.details?.items;
  const thumbnails = Array.isArray(thumbnailItems)
    ? thumbnailItems
        .map((item) => ({
          timing: typeof item.timing === "number" ? item.timing : null,
          timestamp: typeof item.timestamp === "number" ? item.timestamp : null,
          data: typeof item.data === "string" ? item.data : null,
        }))
        .filter((item) => item.data)
    : [];

  return { finalScreenshot, thumbnails };
}

function extractAuditSummaries(audits = {}) {
  const summaries = {};
  for (const [auditId, audit] of Object.entries(audits)) {
    summaries[auditId] = {
      id: audit.id ?? auditId,
      title: audit.title ?? auditId,
      description: audit.description ?? "",
      score: typeof audit.score === "number" ? audit.score : null,
      scoreDisplayMode: audit.scoreDisplayMode ?? null,
      displayValue: audit.displayValue ?? null,
      numericValue: typeof audit.numericValue === "number" ? audit.numericValue : null,
      numericUnit: audit.numericUnit ?? null,
    };
  }
  return summaries;
}

function getFieldMetric(metrics = {}, ...keys) {
  for (const key of keys) {
    const metric = metrics[key];
    if (!metric) continue;
    const percentile = Number(metric.percentile);
    if (Number.isFinite(percentile)) return percentile;
  }
  return null;
}

function extractFieldData(payload = {}) {
  const loadingMetrics = payload.loadingExperience?.metrics ?? {};
  const originMetrics = payload.originLoadingExperience?.metrics ?? {};
  const pick = (...keys) => getFieldMetric(loadingMetrics, ...keys) ?? getFieldMetric(originMetrics, ...keys);

  return {
    loadingExperience: payload.loadingExperience ?? null,
    originLoadingExperience: payload.originLoadingExperience ?? null,
    metrics: {
      lcp: pick("LARGEST_CONTENTFUL_PAINT_MS"),
      fcp: pick("FIRST_CONTENTFUL_PAINT_MS"),
      cls: pick("CUMULATIVE_LAYOUT_SHIFT_SCORE"),
      inp: pick("INTERACTION_TO_NEXT_PAINT", "INTERACTION_TO_NEXT_PAINT_MS", "EXPERIMENTAL_INTERACTION_TO_NEXT_PAINT"),
      fid: pick("FIRST_INPUT_DELAY_MS"),
      ttfb: pick("EXPERIMENTAL_TIME_TO_FIRST_BYTE", "TIME_TO_FIRST_BYTE_MS"),
    },
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function compressPageSpeedReport(payload) {
  const raw = JSON.stringify(payload);
  const gz = zlib.gzipSync(raw);
  return {
    encoding: "gzip-base64",
    compressed: gz.toString("base64"),
    rawSizeBytes: Buffer.byteLength(raw, "utf8"),
    compressedSizeBytes: gz.byteLength,
  };
}

async function fetchSitemapUrls(sitemapUrl, depth = 0) {
  if (depth > 3) return []; // prevent infinite recursion
  try {
    const resp = await fetch(sitemapUrl);
    if (!resp.ok) return [];
    const xml = await resp.text();
    const parser = new XMLParser({ ignoreAttributes: false });
    const parsed = parser.parse(xml);

    // Sitemap index → recurse into child sitemaps
    if (parsed.sitemapindex && parsed.sitemapindex.sitemap) {
      const sitemaps = Array.isArray(parsed.sitemapindex.sitemap)
        ? parsed.sitemapindex.sitemap
        : [parsed.sitemapindex.sitemap];
      const nested = await Promise.all(
        sitemaps.map((s) => fetchSitemapUrls(s.loc, depth + 1))
      );
      return nested.flat();
    }

    // Regular sitemap → extract <url><loc> entries
    if (parsed.urlset && parsed.urlset.url) {
      const urls = Array.isArray(parsed.urlset.url)
        ? parsed.urlset.url
        : [parsed.urlset.url];
      return urls.map((u) => ({
        loc: u.loc,
        lastmod: u.lastmod || null,
      }));
    }

    return [];
  } catch (err) {
    console.warn(`[sitemap] failed to fetch ${sitemapUrl}:`, err.message);
    return [];
  }
}

app.get("/api/pagespeed/sitemap", async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).json({ error: "url query param required" });

  try {
    const baseUrl = url.replace(/\/+$/, "");
    let urls = await fetchSitemapUrls(`${baseUrl}/sitemap.xml`);
    if (urls.length === 0) {
      urls = await fetchSitemapUrls(`${baseUrl}/sitemap_index.xml`);
    }
    // Fallback: try robots.txt for sitemap location
    if (urls.length === 0) {
      try {
        const robotsResp = await fetch(`${baseUrl}/robots.txt`);
        if (robotsResp.ok) {
          const robotsTxt = await robotsResp.text();
          const sitemapMatches = robotsTxt.match(/^Sitemap:\s*(.+)$/gim);
          if (sitemapMatches) {
            for (const match of sitemapMatches) {
              const sitemapUrl = match.replace(/^Sitemap:\s*/i, "").trim();
              const found = await fetchSitemapUrls(sitemapUrl);
              urls.push(...found);
            }
          }
        }
      } catch (_) {}
    }

    console.log(`[pagespeed/sitemap] ${baseUrl} → ${urls.length} URLs found`);
    res.json({ urls });
  } catch (err) {
    console.error("[pagespeed/sitemap]", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/pagespeed/run", async (req, res) => {
  const { urls = [], strategy = "mobile", clientId } = req.body ?? {};
  if (PAGE_SPEED_KEYS.length === 0) {
    return res.status(500).json({ error: "No PageSpeed API keys configured on server" });
  }
  if (!clientId) return res.status(400).json({ error: "clientId required" });
  if (!Array.isArray(urls) || urls.length === 0) {
    return res.status(400).json({ error: "urls array required" });
  }

  const jobRef = admin.firestore().doc(`clients/${clientId}/pagespeed/latest`);
  const runsCol = admin.firestore().collection(`clients/${clientId}/pagespeed/runs/list`);
  const runStartTime = new Date();
  console.log(`[DEBUG][run] incoming request: clientId=${clientId} strategy=${strategy} urlCount=${urls.length}`);
  console.log(`[DEBUG][run] URL list (first 5):`, urls.slice(0, 5));
  console.log(`[DEBUG][run] API keys available=${PAGE_SPEED_KEYS.length} concurrency=${PAGE_SPEED_CONCURRENCY} maxAttempts=${PAGE_SPEED_MAX_ATTEMPTS} timeoutMs=${PAGE_SPEED_TIMEOUT_MS}`);
  const runId = await getNextPageSpeedRunId(clientId, runStartTime);
  const jobControl = { cancelRequested: false, controllers: new Set() };
  activePageSpeedJobs.set(clientId, jobControl);
  console.log(
    `[pagespeed] run requested client=${clientId} urls=${urls.length} strategy=${strategy} keys=${PAGE_SPEED_KEYS.length} concurrency=${PAGE_SPEED_CONCURRENCY}`
  );

  // Write initial job state and respond immediately
  console.log(`[DEBUG][run] writing initial job state to Firestore: clients/${clientId}/pagespeed/latest`);
  await jobRef.set({
    status: "running",
    strategy,
    availableStrategies: ["mobile", "desktop"],
    totalPages: urls.length,
    completedPages: 0,
    results: [],
    resultsByStrategy: {
      mobile: [],
      desktop: [],
    },
    errors: 0,
    errorsByStrategy: {
      mobile: 0,
      desktop: 0,
    },
    startedAt: admin.firestore.FieldValue.serverTimestamp(),
    completedAt: null,
    cancelRequested: false,
    cancelledAt: null,
    runId,
    runName: runId,
  });
  console.log(`[DEBUG][run] ✓ initial job state written to clients/${clientId}/pagespeed/latest`);

  console.log(`[DEBUG][run] writing initial run snapshot to Firestore: clients/${clientId}/pagespeed/runs/list/${runId}`);
  await runsCol.doc(runId).set({
    name: runId,
    strategy,
    availableStrategies: ["mobile", "desktop"],
    status: "running",
    ranAt: admin.firestore.FieldValue.serverTimestamp(),
    ranAtISO: runStartTime.toISOString(),
    totalPages: urls.length,
    completedPages: 0,
    successPages: 0,
    errors: 0,
    errorsByStrategy: { mobile: 0, desktop: 0 },
    averages: {
      performance: 0,
      accessibility: 0,
      seo: 0,
      bestPractices: 0,
      lcp: null,
      fcp: null,
      cls: null,
      tbt: null,
      si: null,
      inp: null,
    },
    metricAverages: {},
    auditScoreAverages: {},
    results: [],
    resultsByStrategy: { mobile: [], desktop: [] },
    completedAt: null,
    cancelledAt: null,
  });
  console.log(`[DEBUG][run] ✓ initial run snapshot written to clients/${clientId}/pagespeed/runs/list/${runId}`);

  res.json({ started: true, totalPages: urls.length });
  console.log(`[DEBUG][run] ✓ HTTP 200 response sent to client, launching background job`);

  // Run in background — do NOT await this in the request handler
  (async () => {
    console.log(`[DEBUG][bg] background job started: runId=${runId} clientId=${clientId} totalPages=${urls.length} strategies=[mobile,desktop]`);
    const STRATEGIES = ["mobile", "desktop"];
    const allResultsByStrategy = { mobile: [], desktop: [] };
    const errorCountByStrategy = { mobile: 0, desktop: 0 };

    async function isCancelRequested() {
      if (jobControl.cancelRequested) {
        console.log(`[pagespeed] cancel requested in-memory for client=${clientId}`);
        return true;
      }
      const latestJobSnap = await jobRef.get().catch(() => null);
      const latestJobData = latestJobSnap?.exists ? latestJobSnap.data() : null;
      const requested = Boolean(latestJobData?.cancelRequested);
      if (requested) console.log(`[pagespeed] cancel requested in-firestore for client=${clientId}`);
      return requested;
    }

    async function markCancelled(completedPages) {
      const defaultResults = allResultsByStrategy[strategy] ?? allResultsByStrategy.mobile;
      const defaultErrors = errorCountByStrategy[strategy] ?? errorCountByStrategy.mobile;
      const { successPages, averages, metricAverages, auditScoreAverages } = buildRunAverages(defaultResults);
      const slimCancelByStrategy = {
        mobile: allResultsByStrategy.mobile.map(toSlimResult),
        desktop: allResultsByStrategy.desktop.map(toSlimResult),
      };
      const slimDefaultResults = slimCancelByStrategy[strategy] ?? slimCancelByStrategy.mobile;
      await jobRef.update({
        status: "cancelled",
        completedPages,
        results: slimDefaultResults,
        resultsByStrategy: slimCancelByStrategy,
        errors: defaultErrors,
        errorsByStrategy: errorCountByStrategy,
        cancelledAt: admin.firestore.FieldValue.serverTimestamp(),
        completedAt: admin.firestore.FieldValue.serverTimestamp(),
      }).catch((e) => console.warn("[pagespeed] cancel update failed:", e.message));
      await runsCol.doc(runId).set({
        name: runId,
        strategy,
        availableStrategies: ["mobile", "desktop"],
        status: "cancelled",
        ranAtISO: runStartTime.toISOString(),
        totalPages: urls.length,
        completedPages,
        successPages,
        errors: defaultErrors,
        errorsByStrategy: errorCountByStrategy,
        averages,
        metricAverages,
        auditScoreAverages,
        results: slimDefaultResults,
        resultsByStrategy: slimCancelByStrategy,
        cancelledAt: admin.firestore.FieldValue.serverTimestamp(),
        completedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true }).catch((e) => console.warn("[pagespeed] cancel snapshot update failed:", e.message));
      console.log(`[pagespeed] job cancelled for ${clientId} after ${completedPages}/${urls.length} pages`);
      activePageSpeedJobs.delete(clientId);
    }

    async function fetchPageSpeedForStrategy(pageUrl, currentStrategy) {
      for (let attempt = 1; attempt <= PAGE_SPEED_MAX_ATTEMPTS; attempt += 1) {
        let timeoutId = null;
        let cancelPollId = null;
        let controller = null;
        try {
          const apiKey = getNextPageSpeedApiKey();
          controller = new AbortController();
          jobControl.controllers.add(controller);
          console.log(`[pagespeed] start PSI request client=${clientId} page=${pageUrl} strategy=${currentStrategy} attempt=${attempt}/${PAGE_SPEED_MAX_ATTEMPTS} keySlot=${(pageSpeedKeyCursor + PAGE_SPEED_KEYS.length - 1) % PAGE_SPEED_KEYS.length} timeoutMs=${PAGE_SPEED_TIMEOUT_MS} activeControllers=${jobControl.controllers.size}`);
          timeoutId = setTimeout(() => controller.abort(new Error("PSI timeout")), PAGE_SPEED_TIMEOUT_MS);
          cancelPollId = setInterval(async () => {
            const shouldCancel = await isCancelRequested().catch(() => false);
            if (shouldCancel) {
              controller.abort(new Error("cancelled"));
            }
          }, 1500);

          const params = new URLSearchParams({
            url: pageUrl,
            strategy: currentStrategy,
            key: apiKey,
            category: "performance",
          });
          params.append("category", "accessibility");
          params.append("category", "seo");
          params.append("category", "best-practices");

          const apiUrl = `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?${params.toString()}`;
          const resp = await fetch(apiUrl, { signal: controller.signal });
          console.log(`[pagespeed] PSI response client=${clientId} page=${pageUrl} strategy=${currentStrategy} status=${resp.status}`);

          if (!resp.ok) {
            const errText = await resp.text();
            console.warn(`[pagespeed] failed for ${pageUrl} (${currentStrategy}): ${resp.status} ${errText.substring(0, 200)}`);
            if (resp.status >= 500 && attempt < PAGE_SPEED_MAX_ATTEMPTS) {
              await sleep(1000 * attempt);
              continue;
            }
            return { url: pageUrl, error: `API error: ${resp.status}` };
          }

          console.log(`[DEBUG][psi] parsing JSON response for ${pageUrl} (${currentStrategy})`);
          const data = await resp.json();
          if (!data.lighthouseResult) {
            console.warn(`[DEBUG][psi] ⚠ no lighthouseResult in response for ${pageUrl} (${currentStrategy}). Top-level keys:`, Object.keys(data));
          }
          const categories = data.lighthouseResult?.categories || {};
          const audits = data.lighthouseResult?.audits || {};
          console.log(`[DEBUG][psi] categories found: [${Object.keys(categories).join(", ")}] auditCount=${Object.keys(audits).length}`);
          const metricValues = extractAuditNumericValues(audits);
          const screenshots = extractPageSpeedScreenshots(audits);
          const auditSummaries = extractAuditSummaries(audits);
          const fieldData = extractFieldData(data);
          const lighthouseVersion = data.lighthouseResult?.lighthouseVersion ?? null;
          const fetchTime = data.lighthouseResult?.fetchTime ?? null;
          const userAgent = data.lighthouseResult?.userAgent ?? null;

          const scores = {
            performance: Math.round((categories.performance?.score ?? 0) * 100),
            accessibility: Math.round((categories.accessibility?.score ?? 0) * 100),
            seo: Math.round((categories.seo?.score ?? 0) * 100),
            bestPractices: Math.round((categories["best-practices"]?.score ?? 0) * 100),
          };
          const webVitals = {
            lcp: audits["largest-contentful-paint"]?.numericValue ?? null,
            fcp: audits["first-contentful-paint"]?.numericValue ?? null,
            cls: audits["cumulative-layout-shift"]?.numericValue ?? null,
            tbt: audits["total-blocking-time"]?.numericValue ?? null,
            si: audits["speed-index"]?.numericValue ?? null,
            inp: audits["interaction-to-next-paint"]?.numericValue ?? fieldData.metrics.inp ?? null,
          };
          console.log(`[DEBUG][psi] ✓ extracted scores for ${pageUrl} (${currentStrategy}):`, scores);
          console.log(`[DEBUG][psi] ✓ extracted webVitals for ${pageUrl} (${currentStrategy}):`, webVitals);
          const compressed = compressPageSpeedReport(data);
          console.log(`[DEBUG][psi] ✓ compressed report for ${pageUrl} (${currentStrategy}): rawBytes=${compressed.rawSizeBytes} compressedBytes=${compressed.compressedSizeBytes}`);

          return {
            url: pageUrl,
            scores,
            webVitals,
            metricValues,
            auditSummaries,
            screenshots,
            fieldData,
            lighthouseVersion,
            fetchTime,
            userAgent,
            categoryAuditRefs: Object.fromEntries(
              Object.entries(categories).map(([key, category]) => [
                key,
                Array.isArray(category.auditRefs) ? category.auditRefs : [],
              ])
            ),
            fullReportCompressed: compressed,
          };
        } catch (err) {
          const msg = String(err?.message || "");
          const abortReason = String(controller?.signal?.reason?.message || controller?.signal?.reason || "");
          const timedOut = msg.toLowerCase().includes("timeout") || abortReason.toLowerCase().includes("timeout");
          if (timedOut) {
            console.warn(`[pagespeed] timeout for ${pageUrl} (${currentStrategy})`);
            if (attempt < PAGE_SPEED_MAX_ATTEMPTS) {
              await sleep(1000 * attempt);
              continue;
            }
            return { url: pageUrl, error: "PSI timeout" };
          }
          const wasCancelled = await isCancelRequested().catch(() => false);
          if (wasCancelled || controller?.signal?.aborted) {
            console.log(`[pagespeed] PSI request aborted client=${clientId} page=${pageUrl} strategy=${currentStrategy}`);
            return { cancelled: true };
          }
          console.warn(`[pagespeed] error for ${pageUrl} (${currentStrategy}):`, err.message);
          if (attempt < PAGE_SPEED_MAX_ATTEMPTS) {
            await sleep(1000 * attempt);
            continue;
          }
          return { url: pageUrl, error: err.message };
        } finally {
          if (timeoutId) clearTimeout(timeoutId);
          if (cancelPollId) clearInterval(cancelPollId);
          if (controller) jobControl.controllers.delete(controller);
          console.log(`[pagespeed] finish PSI request client=${clientId} page=${pageUrl} strategy=${currentStrategy} activeControllers=${jobControl.controllers.size}`);
        }
      }
    }

    const indexedResultsByStrategy = {
      mobile: new Array(urls.length).fill(null),
      desktop: new Array(urls.length).fill(null),
    };
    let completedPages = 0;
    let nextPageIndex = 0;
    let cancelAtPageIndex = null;

    const buildCurrentResults = () => ({
      mobile: indexedResultsByStrategy.mobile.filter(Boolean),
      desktop: indexedResultsByStrategy.desktop.filter(Boolean),
    });

    const toSummaryResult = (result) => {
      if (!result || result.error) return result;
      const { fullReportCompressed, ...summary } = result;
      return summary;
    };

    // Strip heavy fields (auditSummaries, metricValues, fieldData, screenshots, categoryAuditRefs)
    // for Firestore progress documents which must stay under the 1MB limit.
    // Full data is already persisted in the details sub-collection.
    const toSlimResult = (result) => {
      if (!result) return result;
      if (result.error) return { url: result.url, error: result.error, detailPath: result.detailPath ?? null };
      const { auditSummaries, metricValues, categoryAuditRefs, fieldData, screenshots, fullReportCompressed, userAgent, ...slim } = result;
      return slim;
    };

    const persistFullReport = async (index, currentStrategy, pageUrl, fullReportCompressed) => {
      if (!fullReportCompressed) {
        console.warn(`[DEBUG][persist] ⚠ no fullReportCompressed for index=${index} strategy=${currentStrategy} url=${pageUrl}`);
        return;
      }
      const detailDocId = `${String(index).padStart(4, "0")}-${currentStrategy}`;
      const detailPath = `clients/${clientId}/pagespeed/runs/details/${runId}/pages/${detailDocId}`;
      console.log(`[DEBUG][persist] saving full report: path=${detailPath} url=${pageUrl} strategy=${currentStrategy} compressedBytes=${fullReportCompressed.compressedSizeBytes ?? "?"}`);
      await admin
        .firestore()
        .doc(detailPath)
        .set(
          {
            runId,
            index,
            url: pageUrl,
            strategy: currentStrategy,
            fullReportCompressed,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true }
        )
        .then(() => console.log(`[DEBUG][persist] ✓ full report saved: ${detailPath}`))
        .catch((e) => console.warn("[pagespeed] failed to save detailed report:", e.message));
    };

    const persistProgress = async () => {
      const compactResultsByStrategy = buildCurrentResults();
      const progressResults = compactResultsByStrategy[strategy] ?? compactResultsByStrategy.mobile;
      const progressErrors = errorCountByStrategy[strategy] ?? errorCountByStrategy.mobile;
      console.log(`[DEBUG][progress] persisting progress: completedPages=${completedPages}/${urls.length} errors(mobile=${errorCountByStrategy.mobile} desktop=${errorCountByStrategy.desktop}) results(mobile=${compactResultsByStrategy.mobile.length} desktop=${compactResultsByStrategy.desktop.length})`);

      // Use slim results for Firestore docs to stay under the 1MB document size limit.
      // Heavy fields (auditSummaries, metricValues, fieldData, screenshots, categoryAuditRefs)
      // are already saved in the details sub-collection by persistFullReport.
      const slimResultsByStrategy = {
        mobile: compactResultsByStrategy.mobile.map(toSlimResult),
        desktop: compactResultsByStrategy.desktop.map(toSlimResult),
      };
      const slimProgressResults = slimResultsByStrategy[strategy] ?? slimResultsByStrategy.mobile;

      await jobRef.update({
        completedPages,
        results: slimProgressResults,
        resultsByStrategy: slimResultsByStrategy,
        errors: progressErrors,
        errorsByStrategy: errorCountByStrategy,
      })
        .then(() => console.log(`[DEBUG][progress] ✓ jobRef updated completedPages=${completedPages}`))
        .catch((e) => console.warn("[pagespeed] progress update failed:", e.message));
      const { successPages, averages, metricAverages, auditScoreAverages } = buildRunAverages(progressResults);
      console.log(`[DEBUG][progress] run averages: successPages=${successPages} perf=${averages.performance} a11y=${averages.accessibility} seo=${averages.seo} bp=${averages.bestPractices}`);
      await runsCol.doc(runId).set({
        name: runId,
        strategy,
        availableStrategies: ["mobile", "desktop"],
        status: "running",
        ranAtISO: runStartTime.toISOString(),
        totalPages: urls.length,
        completedPages,
        successPages,
        errors: progressErrors,
        errorsByStrategy: errorCountByStrategy,
        averages,
        metricAverages,
        auditScoreAverages,
        results: slimProgressResults,
        resultsByStrategy: slimResultsByStrategy,
      }, { merge: true })
        .then(() => console.log(`[DEBUG][progress] ✓ run snapshot updated completedPages=${completedPages}`))
        .catch((e) => console.warn("[pagespeed] progress snapshot update failed:", e.message));
    };

    async function processSinglePage(index) {
      if (await isCancelRequested()) {
        console.log(`[DEBUG][page] cancel detected before processing index=${index}, aborting worker`);
        cancelAtPageIndex = Math.min(cancelAtPageIndex ?? index, index);
        return false;
      }
      const pageUrl = urls[index];
      console.log(`[DEBUG][page] ▶ processing page index=${index}/${urls.length - 1} url=${pageUrl}`);

      // Run both strategies in parallel to halve per-page time
      console.log(`[DEBUG][page] launching parallel PSI fetch for both strategies: url=${pageUrl}`);
      const strategyResults = await Promise.all(
        STRATEGIES.map((currentStrategy) => fetchPageSpeedForStrategy(pageUrl, currentStrategy))
      );
      console.log(`[DEBUG][page] PSI fetch complete for both strategies: url=${pageUrl} cancelled=[${strategyResults.map(r => String(r?.cancelled ?? false)).join(",")}] errors=[${strategyResults.map(r => r?.error ?? "none").join(",")}]`);

      for (let i = 0; i < STRATEGIES.length; i++) {
        const currentStrategy = STRATEGIES[i];
        const result = strategyResults[i];
        if (result?.cancelled) {
          console.log(`[DEBUG][page] result cancelled for ${currentStrategy}, aborting processSinglePage`);
          cancelAtPageIndex = Math.min(cancelAtPageIndex ?? index, index);
          return false;
        }
        if (result?.error) {
          console.warn(`[DEBUG][page] ⚠ error result for index=${index} strategy=${currentStrategy} url=${pageUrl}: ${result.error}`);
        } else {
          console.log(`[DEBUG][page] ✓ success result for index=${index} strategy=${currentStrategy} url=${pageUrl} perf=${result?.scores?.performance ?? "?"}`);
        }
        await persistFullReport(index, currentStrategy, pageUrl, result.fullReportCompressed);
        const summaryResult = {
          ...toSummaryResult(result),
          detailPath: `clients/${clientId}/pagespeed/runs/details/${runId}/pages/${String(index).padStart(4, "0")}-${currentStrategy}`,
        };
        indexedResultsByStrategy[currentStrategy][index] = summaryResult;
        if (summaryResult.error) {
          errorCountByStrategy[currentStrategy] += 1;
          console.warn(`[DEBUG][page] errorCountByStrategy updated: mobile=${errorCountByStrategy.mobile} desktop=${errorCountByStrategy.desktop}`);
        }
      }

      completedPages += 1;
      console.log(`[DEBUG][page] ✓ page done index=${index} url=${pageUrl} completedPages=${completedPages}/${urls.length}`);
      await persistProgress();
      return true;
    }

    async function worker(workerId) {
      console.log(`[DEBUG][worker] worker #${workerId} started`);
      while (true) {
        if (await isCancelRequested()) {
          console.log(`[DEBUG][worker] worker #${workerId} exiting — cancel requested`);
          return;
        }
        const index = nextPageIndex;
        nextPageIndex += 1;
        if (index >= urls.length) {
          console.log(`[DEBUG][worker] worker #${workerId} exiting — no more pages (index=${index} totalUrls=${urls.length})`);
          return;
        }
        console.log(`[DEBUG][worker] worker #${workerId} picked up page index=${index}`);
        const ok = await processSinglePage(index);
        if (!ok) {
          console.log(`[DEBUG][worker] worker #${workerId} exiting — processSinglePage returned false at index=${index}`);
          return;
        }
      }
    }

    const workerCount = Math.min(urls.length, PAGE_SPEED_CONCURRENCY);
    console.log(`[DEBUG][bg] launching ${workerCount} worker(s) for ${urls.length} pages`);
    await Promise.all(Array.from({ length: workerCount }, (_, i) => worker(i + 1)));
    console.log(`[DEBUG][bg] all workers finished`);

    console.log(`[DEBUG][bg] checking cancel state after all workers finished: cancelAtPageIndex=${cancelAtPageIndex}`);
    if (cancelAtPageIndex != null || await isCancelRequested()) {
      console.log(`[DEBUG][bg] job was cancelled — calling markCancelled completedPages=${cancelAtPageIndex ?? completedPages}`);
      const compactResultsByStrategy = buildCurrentResults();
      allResultsByStrategy.mobile = compactResultsByStrategy.mobile;
      allResultsByStrategy.desktop = compactResultsByStrategy.desktop;
      await markCancelled(cancelAtPageIndex ?? completedPages);
      return;
    }

    const compactResultsByStrategy = buildCurrentResults();
    allResultsByStrategy.mobile = compactResultsByStrategy.mobile;
    allResultsByStrategy.desktop = compactResultsByStrategy.desktop;

    const defaultResults = allResultsByStrategy[strategy] ?? allResultsByStrategy.mobile;
    const defaultErrors = errorCountByStrategy[strategy] ?? errorCountByStrategy.mobile;

    const slimFinalByStrategy = {
      mobile: allResultsByStrategy.mobile.map(toSlimResult),
      desktop: allResultsByStrategy.desktop.map(toSlimResult),
    };
    const slimDefaultResults = slimFinalByStrategy[strategy] ?? slimFinalByStrategy.mobile;

    console.log(`[DEBUG][bg] marking job DONE: runId=${runId} totalPages=${urls.length} defaultStrategy=${strategy} successResults=${defaultResults.length} errors=${defaultErrors}`);

    // Mark job as complete
    await jobRef.update({
      status: "done",
      completedPages: urls.length,
      results: slimDefaultResults,
      resultsByStrategy: slimFinalByStrategy,
      errors: defaultErrors,
      errorsByStrategy: errorCountByStrategy,
      completedAt: admin.firestore.FieldValue.serverTimestamp(),
    })
      .then(() => console.log(`[DEBUG][bg] ✓ jobRef marked done`))
      .catch((e) => console.warn("[pagespeed] final update failed:", e.message));

    try {
      const { successPages, averages, metricAverages, auditScoreAverages } = buildRunAverages(defaultResults);
      console.log(`[DEBUG][bg] final averages: successPages=${successPages} perf=${averages.performance} a11y=${averages.accessibility} seo=${averages.seo} bp=${averages.bestPractices}`);
      console.log(`[DEBUG][bg] writing final run snapshot to ${runId}`);
      await runsCol.doc(runId).set({
        name: runId,
        strategy,
        availableStrategies: ["mobile", "desktop"],
        status: "done",
        ranAtISO: runStartTime.toISOString(),
        totalPages: urls.length,
        completedPages: urls.length,
        successPages,
        errors: defaultErrors,
        errorsByStrategy: errorCountByStrategy,
        averages,
        metricAverages,
        auditScoreAverages,
        results: slimDefaultResults,
        resultsByStrategy: slimFinalByStrategy,
        completedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
      console.log(`[pagespeed] saved run snapshot: ${runId}`);
    } catch (e) {
      console.warn("[pagespeed] failed to save run snapshot:", e.message);
      console.error(`[DEBUG][bg] ✗ FAILED to save run snapshot for ${runId}:`, e);
    }

    console.log(`[pagespeed] background job done for ${clientId}: ${urls.length} pages, mobile errors=${errorCountByStrategy.mobile}, desktop errors=${errorCountByStrategy.desktop}`);
    activePageSpeedJobs.delete(clientId);
  })();
});

app.post("/api/pagespeed/stop", async (req, res) => {
  const { clientId } = req.body ?? {};
  if (!clientId) return res.status(400).json({ error: "clientId required" });

  try {
    console.log(`[pagespeed/stop] request received client=${clientId}`);
    const control = activePageSpeedJobs.get(clientId);
    if (control) {
      control.cancelRequested = true;
      const beforeAbortCount = control.controllers.size;
      for (const controller of control.controllers) {
        try {
          controller.abort(new Error("cancelled"));
        } catch (_) {}
      }
      console.log(`[pagespeed/stop] in-memory cancel set client=${clientId} abortedControllers=${beforeAbortCount}`);
    } else {
      console.log(`[pagespeed/stop] no live in-memory job for client=${clientId}`);
    }

    const jobRef = admin.firestore().doc(`clients/${clientId}/pagespeed/latest`);
    const snap = await jobRef.get();
    if (!snap.exists) return res.status(404).json({ error: "No PageSpeed job found" });

    const data = snap.data() ?? {};
    console.log(`[pagespeed/stop] firestore status client=${clientId} status=${data.status ?? "unknown"} cancelRequested=${Boolean(data.cancelRequested)}`);
    if (data.status !== "running") {
      return res.status(409).json({ error: `Job is not running (status: ${data.status ?? "unknown"})` });
    }

    const shouldForceCancelNow = !control;
    const runId = String(data.runId || "").trim();
    const latestResults = Array.isArray(data.results) ? data.results : [];
    const latestResultsByStrategy = data.resultsByStrategy && typeof data.resultsByStrategy === "object"
      ? data.resultsByStrategy
      : { mobile: [], desktop: [] };
    const latestErrorsByStrategy = data.errorsByStrategy && typeof data.errorsByStrategy === "object"
      ? data.errorsByStrategy
      : { mobile: 0, desktop: 0 };
    const latestErrors = Number.isFinite(data.errors) ? Number(data.errors) : 0;
    const latestTotalPages = Number.isFinite(data.totalPages) ? Number(data.totalPages) : 0;
    const latestCompletedPages = Number.isFinite(data.completedPages) ? Number(data.completedPages) : 0;
    const { successPages, averages, metricAverages } = buildRunAverages(latestResults);

    await jobRef.update({
      cancelRequested: true,
      ...(shouldForceCancelNow
        ? {
            status: "cancelled",
            cancelledAt: admin.firestore.FieldValue.serverTimestamp(),
            completedAt: admin.firestore.FieldValue.serverTimestamp(),
          }
        : {}),
    });
    console.log(
      `[pagespeed/stop] firestore cancelRequested=true client=${clientId} forceCancelled=${shouldForceCancelNow}`
    );

    if (shouldForceCancelNow && runId) {
      await admin.firestore().doc(`clients/${clientId}/pagespeed/runs/list/${runId}`).set({
        name: runId,
        strategy: String(data.strategy || "mobile"),
        availableStrategies: ["mobile", "desktop"],
        status: "cancelled",
        ranAtISO: String(data.startedAt?.toDate?.()?.toISOString?.() || new Date().toISOString()),
        totalPages: latestTotalPages,
        completedPages: latestCompletedPages,
        successPages,
        errors: latestErrors,
        errorsByStrategy: latestErrorsByStrategy,
        averages,
        metricAverages,
        results: latestResults,
        resultsByStrategy: latestResultsByStrategy,
        cancelledAt: admin.firestore.FieldValue.serverTimestamp(),
        completedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true }).catch((e) => console.warn("[pagespeed/stop] forced cancel snapshot update failed:", e.message));
    }

    res.json({ stopped: true, liveJobFound: Boolean(control), forceCancelled: shouldForceCancelNow });
  } catch (err) {
    console.error("[pagespeed/stop]", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get("/health", (_req, res) => res.json({ ok: true }));

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Support server running on port ${PORT}`));
