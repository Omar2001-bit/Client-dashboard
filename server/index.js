const express = require("express");
const cors = require("cors");
const crypto = require("crypto");
const axios = require("axios");
const admin = require("firebase-admin");
const { google } = require("googleapis");
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const ga4Reporting = require("./ga4Reporting");
// Credentials: env vars on Render, local JSON files in development
const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT_JSON
  ? JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON)
  : require("./serviceAccountKey.json");
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
app.set("trust proxy", true); // Render sits behind a proxy — needed for req.ip to reflect the real client

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

// Like requireClientOrAdminOwnership, but excludes plain "admin" — used for routes that
// return a client's raw paid price, which only executiveAdmin (or the client themselves)
// should be able to read.
function requireExecutiveAdminOrClientOwnership(getClientId) {
  return async function (req, res, next) {
    try {
      const idToken = getAuthToken(req);
      if (!idToken) return res.status(401).json({ error: "Missing auth token" });

      const decoded = await admin.auth().verifyIdToken(idToken);
      if (decoded.role === "executiveAdmin") {
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
      if (userData?.role === "executiveAdmin") {
        req.user = decoded;
        return next();
      }
      if (userData?.role === "client" && userData.clientId && userData.clientId === requestedClientId) {
        req.user = decoded;
        return next();
      }

      return res.status(403).json({ error: "Not authorized for this client" });
    } catch (err) {
      console.error("[auth] executive-admin-or-client-ownership check failed:", err.message);
      return res.status(401).json({ error: "Invalid auth token" });
    }
  };
}

// One-off fix for /api/ga4/experiment-data, which historically took a bare `propertyId`
// with no clientId at all (finding C4 — it had no auth check whatsoever). The caller's
// clientId comes only from the verified token; the route then 403s unless that client's
// own configured ga4PropertyId matches the propertyId being requested, so a client can
// never pull another client's GA4 property through the shared service account.
// getPropertyId(req) locates the requested GA4 property id in the request — POST routes
// carry it in the body (propertyId), GET routes in the query string (property).
function requireClientOwnsGA4Property(getPropertyId) {
  return async function (req, res, next) {
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
      // clients/{id}.ga4PropertyId is always stored bare ("268549624"); callers can pass
      // either that or the "properties/268549624" resource-name form the ga4-reports
      // routes use internally (PROPERTY_RE) — normalize before comparing.
      const requestedPropertyId = String(getPropertyId(req) || "").replace(/^properties\//, "");
      if (!clientSnap.exists || clientSnap.data()?.ga4PropertyId !== requestedPropertyId) {
        return res.status(403).json({ error: "Not authorized for this GA4 property" });
      }

      req.user = decoded;
      return next();
    } catch (err) {
      console.error("[auth] GA4 property ownership check failed:", err.message);
      return res.status(401).json({ error: "Invalid auth token" });
    }
  };
}

// ── Encryption helpers (AES-256-GCM) ──────────────────────────────────────────
// See server/lib/encryption.js. Used for per-client secrets (Convert
// credentials, ClickUp OAuth tokens) stored in Firestore.
const { encrypt, decrypt, readConvertCredential } = require("./lib/encryption");

const SUPPORT_EMAIL = "omar@optimizers.agency";
const RESEND_FROM = process.env.RESEND_FROM || "Optimizers Support <onboarding@resend.dev>";
const CLICKUP_API_BASE = "https://api.clickup.com/api/v2";
const CLICKUP_ACCESS_DOC = "appConfig/clickupAccess";

// Sends over Resend's HTTPS API — not SMTP, so it isn't affected by Render's
// SMTP-port block, and it doesn't depend on a Gmail OAuth refresh token.
async function sendEmail({ to, subject, html }) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error("RESEND_API_KEY is not configured");

  await axios.post(
    "https://api.resend.com/emails",
    { from: RESEND_FROM, to: [to], subject, html },
    { headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" } }
  );
}

// ── Support emails → Resend ───────────────────────────────────────────────────

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
    description: String(task.description ?? ""),
    startDate: startDate ?? null,
    dueDate: dueDate ?? null,
    dateCreated: normalizeDate(task.date_created) ?? null,
    dateClosed: normalizeDate(task.date_closed) ?? null,
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

// ── ClickUp -> client timeline sync ────────────────────────────────────────────
// One shared personal token (above) browses the agency's own ClickUp workspace;
// this route lets an admin pick a workspace (+ optional folder scope) and pull
// a FLAT task list into a specific client's timeline config, matching the shape
// the Timeline Builder / TimelineViewer UI already expects (each task, including
// subtasks, independently assignable to a phase — so no tree-nesting here).

// normalizeTask() leaves some optional fields (e.g. checklist item `assignee`)
// as `undefined`, which is fine for a JSON response but Firestore rejects
// `undefined` on write. Strip it recursively before persisting.
function stripUndefinedForFirestore(value) {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map(stripUndefinedForFirestore);
  if (typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (v !== undefined) out[k] = stripUndefinedForFirestore(v);
    }
    return out;
  }
  return value;
}

async function fetchFlatClickUpTasksForClient(workspaceId, folderId) {
  const flat = [];
  const lists = [];
  if (folderId) {
    const listPayload = await fetchClickUp(`/folder/${encodeURIComponent(folderId)}/list`, { archived: false });
    const folderLists = Array.isArray(listPayload.lists) ? listPayload.lists : [];
    lists.push(
      ...folderLists
        .map((list) => ({ id: String(list.id ?? ""), name: String(list.name ?? "Untitled list") }))
        .filter((list) => list.id)
    );
    await Promise.all(
      folderLists.map(async (list) => {
        for (let page = 0; page < 100; page += 1) {
          const payload = await fetchClickUp(`/list/${encodeURIComponent(list.id)}/task`, {
            page, subtasks: true, include_closed: true, order_by: "updated", reverse: true,
          });
          const pageTasks = Array.isArray(payload.tasks) ? payload.tasks : [];
          if (pageTasks.length === 0) break;
          flat.push(...pageTasks.map(normalizeTask).filter((t) => t.id));
          if (pageTasks.length < 100) break;
        }
      })
    );
  } else {
    for (let page = 0; page < 100; page += 1) {
      const payload = await fetchClickUp(`/team/${encodeURIComponent(workspaceId)}/task`, {
        page, subtasks: true, include_closed: true, order_by: "updated", reverse: true,
      });
      const pageTasks = Array.isArray(payload.tasks) ? payload.tasks : Array.isArray(payload.data) ? payload.data : [];
      if (pageTasks.length === 0) break;
      flat.push(...pageTasks.map(normalizeTask).filter((t) => t.id));
      if (pageTasks.length < 100) break;
    }
  }
  return { tasks: flat, lists };
}

function pruneClickUpTaskAssignments(assignments, tasks) {
  const taskIds = new Set(tasks.map((task) => task.id));
  return Object.fromEntries(Object.entries(assignments).filter(([taskId, phaseId]) => taskIds.has(taskId) && Boolean(phaseId)));
}

app.post("/api/clickup/sync-to-client", requireAdmin, async (req, res) => {
  const { clientId, workspaceId, workspaceName, folderId, folderName } = req.body ?? {};
  if (!clientId) return res.status(400).json({ error: "clientId required." });
  if (!workspaceId) return res.status(400).json({ error: "workspaceId required." });

  try {
    const db = admin.firestore();
    const timelineRef = db.collection("clients").doc(clientId).collection("timeline").doc("config");
    const timelineSnap = await timelineRef.get();
    const current = timelineSnap.exists ? timelineSnap.data() ?? {} : {};
    const existingClickup = current.clickup ?? {};

    const { tasks, lists } = await fetchFlatClickUpTasksForClient(workspaceId, folderId || undefined);
    const taskAssignments = pruneClickUpTaskAssignments(existingClickup.taskAssignments ?? {}, tasks);

    await timelineRef.set(
      stripUndefinedForFirestore({
        ...current,
        clickup: {
          connected: true,
          workspaceId,
          workspaceName: workspaceName ?? existingClickup.workspaceName ?? "",
          folderId: folderId || null,
          folderName: folderId ? (folderName ?? existingClickup.folderName ?? "") : null,
          tasks,
          lists,
          taskAssignments,
          lastSyncedAt: new Date().toISOString(),
        },
      }),
      { merge: true }
    );

    res.json({ success: true, taskCount: tasks.length, listCount: lists.length, workspaceId, folderId: folderId || null });
  } catch (err) {
    console.error("[clickup/sync-to-client]", err.message);
    res.status(err.status || 500).json({ error: err.message });
  }
});

app.post("/api/clickup/disconnect-client", requireAdmin, async (req, res) => {
  const { clientId } = req.body ?? {};
  if (!clientId) return res.status(400).json({ error: "clientId required." });

  try {
    await admin.firestore().collection("clients").doc(clientId).collection("timeline").doc("config").set(
      { clickup: { connected: false, workspaceId: null, workspaceName: "", folderId: null, folderName: "", tasks: [], lists: [], taskAssignments: {} } },
      { merge: true }
    );
    res.json({ success: true });
  } catch (err) {
    console.error("[clickup/disconnect-client]", err.message);
    res.status(500).json({ error: err.message });
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

// ── Password reset emails → Resend (to client emails) ────────────────────────

// Plain in-memory per-IP limiter — good enough for a single Render instance;
// resets on redeploy, which is an acceptable tradeoff for this low-traffic route.
const passwordResetAttempts = new Map(); // ip -> timestamps[]
const PASSWORD_RESET_RATE_LIMIT = 5;
const PASSWORD_RESET_RATE_WINDOW_MS = 15 * 60 * 1000;

function rateLimitPasswordReset(req, res, next) {
  const ip = req.ip || "unknown";
  const now = Date.now();
  const attempts = (passwordResetAttempts.get(ip) || []).filter(
    (t) => now - t < PASSWORD_RESET_RATE_WINDOW_MS
  );
  if (attempts.length >= PASSWORD_RESET_RATE_LIMIT) {
    return res.status(429).json({ error: "Too many requests. Please try again later." });
  }
  attempts.push(now);
  passwordResetAttempts.set(ip, attempts);
  next();
}

app.post("/api/send-password-reset", rateLimitPasswordReset, async (req, res) => {
  const { email, clientName } = req.body ?? {};
  if (!email) return res.status(400).json({ error: "email is required" });

  // Always report success, even if the email has no account — otherwise this
  // (unauthenticated) route lets a caller enumerate which emails are registered.
  try {
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
  } catch (err) {
    console.error("[password-reset] error:", err.message);
  }
  res.json({ success: true });
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

// ── New-user invite emails → Resend ───────────────────────────────────────────

const FRONTEND_URL = process.env.FRONTEND_URL || "https://client-dash-9b027.web.app";

app.post("/api/send-invite-email", requireAdmin, async (req, res) => {
  try {
    const { email, name } = req.body ?? {};
    if (!email) return res.status(400).json({ error: "email is required" });

    const signInLink = await admin.auth().generateSignInWithEmailLink(email, {
      url: `${FRONTEND_URL}/set-password`,
      handleCodeInApp: true,
    });

    await sendEmail({
      to: email,
      subject: "You're invited to the Optimizers dashboard",
      html: `
        <div style="font-family:sans-serif;max-width:600px;color:#0e1c26">
          <h2 style="margin:0 0 16px">Welcome to Optimizers</h2>
          ${name ? `<p>Hi ${name},</p>` : ""}
          <p>An account has been created for you. Click below to set your password and sign in.</p>
          <p style="margin:24px 0">
            <a href="${signInLink}"
              style="background:#6ae499;color:#0e1c26;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;display:inline-block">
              Set my password
            </a>
          </p>
          <p style="font-size:12px;color:#999">
            This link expires in 1 hour. If you weren't expecting this, you can ignore this email.
          </p>
        </div>
      `,
    });

    console.log("[send-invite-email] sent to", email);
    res.json({ success: true });
  } catch (err) {
    console.error("[send-invite-email] error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Admin Auth Actions ─────────────────────────────────────────────────────────
// Ported from functions/src/resetClientPassword.ts, rotateClientCredentials.ts,
// and createClientUser.ts. Admin-role checks are handled by requireAdmin — the
// hand-rolled checks from the original Cloud Functions are dropped.

app.post("/api/admin/reset-client-password", requireAdmin, async (req, res) => {
  const { clientId, newPassword } = req.body ?? {};
  if (!clientId || !newPassword || String(newPassword).length < 6) {
    return res.status(400).json({ error: "clientId and a password of at least 6 characters are required." });
  }

  try {
    const db = admin.firestore();
    const usersSnap = await db.collection("users").where("clientId", "==", clientId).limit(1).get();
    if (usersSnap.empty) return res.status(404).json({ error: "No user found for this client." });

    const uid = usersSnap.docs[0].id;
    await admin.auth().updateUser(uid, { password: newPassword });

    res.json({ success: true });
  } catch (err) {
    console.error("[admin/reset-client-password]", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/admin/rotate-client-credentials", requireAdmin, async (req, res) => {
  const { clientId, convertKeyId, convertKeySecret } = req.body ?? {};
  if (!clientId) return res.status(400).json({ error: "clientId required." });

  try {
    const db = admin.firestore();
    const now = admin.firestore.Timestamp.now();

    if (convertKeyId || convertKeySecret) {
      const update = { updatedAt: now };
      if (convertKeyId) update.keyId = encrypt(convertKeyId);
      if (convertKeySecret) update.keySecret = encrypt(convertKeySecret);

      await db.collection("clients").doc(clientId).collection("credentials").doc("convert").set(update, { merge: true });

      await db.collection("auditLog").add({
        action: "rotateConvertKey",
        clientId,
        performedBy: req.user?.uid ?? "unknown",
        timestamp: now,
      });
    }

    res.json({ success: true });
  } catch (err) {
    console.error("[admin/rotate-client-credentials]", err.message);
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
app.post("/api/ga4/experiment-data", requireClientOwnsGA4Property((req) => req.body?.propertyId), async (req, res) => {
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

app.get("/api/ga4-reports/metadata", requireClientOwnsGA4Property((req) => req.query?.property), async (req, res) => {
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

// ── Convert Experiments & Pricing ─────────────────────────────────────────────
// Ported from functions/src/convertServicePrice.ts and functions/src/getExperiments.ts.
// Access control (admin OR the owning client) is handled entirely by
// requireClientOrAdminOwnership — no inline ownership checks needed here.

const CONVERT_API_BASE = "https://api.convert.com/api/v2";
const CONVERT_PRICE_BASE_CURRENCY = "USD";
const CONVERT_RATE_CACHE_TTL_MS = 12 * 60 * 60 * 1000;
const FRANKFURTER_BASE_URL = "https://api.frankfurter.dev/v2";
const EXCHANGE_RATE_API_BASE_URL = "https://v6.exchangerate-api.com/v6";
const EXCHANGE_RATE_API_KEY = process.env.EXCHANGE_RATE_API_KEY;

function normalizeConvertCurrency(value) {
  const currency = String(value ?? "").trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) {
    const err = new Error("Client reporting currency must be a 3-letter ISO code.");
    err.status = 400;
    throw err;
  }
  return currency;
}

function normalizeConvertAmount(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return 0;
  return Math.max(0, amount);
}

function roundMoney(value) {
  return Math.round(value * 100) / 100;
}

function isUnsupportedCurrencyError(err) {
  const status = err?.response?.status;
  return status === 400 || status === 404 || status === 422;
}

async function fetchFrankfurterRate(targetCurrency) {
  const url = `${FRANKFURTER_BASE_URL}/rate/${CONVERT_PRICE_BASE_CURRENCY}/${targetCurrency}`;
  const response = await axios.get(url, { timeout: 10000 });
  const rate = Number(response.data.rate ?? response.data.rates?.[targetCurrency]);
  if (!Number.isFinite(rate) || rate <= 0) {
    throw new Error(`No ${CONVERT_PRICE_BASE_CURRENCY}/${targetCurrency} exchange rate returned by Frankfurter.`);
  }
  return {
    exchangeRate: rate,
    rateDate: String(response.data.date ?? new Date().toISOString().slice(0, 10)),
    provider: "frankfurter",
    cached: false,
  };
}

async function fetchExchangeRateApiRate(targetCurrency) {
  const url = `${EXCHANGE_RATE_API_BASE_URL}/${EXCHANGE_RATE_API_KEY}/pair/${CONVERT_PRICE_BASE_CURRENCY}/${targetCurrency}`;
  const response = await axios.get(url, { timeout: 10000 });
  const result = response.data;
  if (result.result === "error") {
    const err = new Error(`ExchangeRate-API error: ${result["error-type"] ?? "unknown"}`);
    err.status = result["error-type"] === "unsupported-code" ? 400 : 503;
    throw err;
  }
  const rate = Number(result.conversion_rate);
  if (!Number.isFinite(rate) || rate <= 0) {
    throw new Error(`No ${CONVERT_PRICE_BASE_CURRENCY}/${targetCurrency} exchange rate returned by ExchangeRate-API.`);
  }
  const parsedDate = result.time_last_update_utc ? new Date(result.time_last_update_utc) : null;
  return {
    exchangeRate: rate,
    rateDate: parsedDate && !Number.isNaN(parsedDate.getTime()) ? parsedDate.toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10),
    provider: "exchangerate-api",
    cached: false,
  };
}

async function getUsdExchangeRate(targetCurrency) {
  if (targetCurrency === CONVERT_PRICE_BASE_CURRENCY) {
    return { exchangeRate: 1, rateDate: new Date().toISOString().slice(0, 10), provider: "identity", cached: false };
  }

  const db = admin.firestore();
  const cacheRef = db.collection("exchangeRates").doc(`${CONVERT_PRICE_BASE_CURRENCY}_${targetCurrency}`);
  const cached = await cacheRef.get();
  const cachedData = cached.data();
  const cachedFetchedAt = cachedData?.fetchedAt?.toDate?.();
  const cachedRate = Number(cachedData?.exchangeRate);

  if (Number.isFinite(cachedRate) && cachedRate > 0 && cachedFetchedAt && Date.now() - cachedFetchedAt.getTime() < CONVERT_RATE_CACHE_TTL_MS) {
    return {
      exchangeRate: cachedRate,
      rateDate: String(cachedData?.rateDate ?? cachedFetchedAt.toISOString().slice(0, 10)),
      provider: String(cachedData?.provider ?? "frankfurter"),
      cached: true,
    };
  }

  try {
    const freshRate = await fetchFrankfurterRate(targetCurrency);
    await cacheRef.set(
      { baseCurrency: CONVERT_PRICE_BASE_CURRENCY, targetCurrency, exchangeRate: freshRate.exchangeRate, rateDate: freshRate.rateDate, provider: freshRate.provider, fetchedAt: admin.firestore.Timestamp.now() },
      { merge: true }
    );
    return freshRate;
  } catch (err) {
    console.warn(`[convert/service-price] Frankfurter lookup failed for ${CONVERT_PRICE_BASE_CURRENCY}/${targetCurrency}:`, err.message);
    try {
      const fallbackRate = await fetchExchangeRateApiRate(targetCurrency);
      await cacheRef.set(
        { baseCurrency: CONVERT_PRICE_BASE_CURRENCY, targetCurrency, exchangeRate: fallbackRate.exchangeRate, rateDate: fallbackRate.rateDate, provider: fallbackRate.provider, fetchedAt: admin.firestore.Timestamp.now() },
        { merge: true }
      );
      return fallbackRate;
    } catch (fallbackErr) {
      if (isUnsupportedCurrencyError(err) && isUnsupportedCurrencyError(fallbackErr)) {
        const unsupportedErr = new Error(`Reporting currency ${targetCurrency} is not supported by the exchange-rate providers.`);
        unsupportedErr.status = 400;
        throw unsupportedErr;
      }
      const unavailableErr = new Error(`Could not fetch ${CONVERT_PRICE_BASE_CURRENCY}/${targetCurrency} exchange rate.`);
      unavailableErr.status = 503;
      throw unavailableErr;
    }
  }
}

app.post("/api/convert/service-price", requireExecutiveAdminOrClientOwnership((req) => req.body?.clientId), async (req, res) => {
  const clientId = String(req.body?.clientId || "");
  if (!clientId) return res.status(400).json({ error: "clientId required." });

  try {
    const db = admin.firestore();
    const clientDoc = await db.collection("clients").doc(clientId).get();
    if (!clientDoc.exists) return res.status(404).json({ error: "Client not found." });

    const clientData = clientDoc.data();
    const servicePriceUsd = normalizeConvertAmount(clientData.servicePrice ?? clientData.agencyFee ?? 0);
    const targetCurrency = normalizeConvertCurrency(clientData.currency ?? CONVERT_PRICE_BASE_CURRENCY);
    const conversion = await getUsdExchangeRate(targetCurrency);

    res.json({
      sourceCurrency: CONVERT_PRICE_BASE_CURRENCY,
      targetCurrency,
      sourceAmount: servicePriceUsd,
      convertedAmount: roundMoney(servicePriceUsd * conversion.exchangeRate),
      exchangeRate: conversion.exchangeRate,
      rateDate: conversion.rateDate,
      provider: conversion.provider,
      cached: conversion.cached,
    });
  } catch (err) {
    console.error("[convert/service-price]", err.message);
    res.status(err.status || 500).json({ error: err.message });
  }
});

function signConvertHeaders(keyId, keySecret, url, body) {
  const expires = Math.floor(Date.now() / 1000) + 60;
  const sig = crypto.createHmac("sha256", keySecret).update(`${keyId}\n${expires}\n${url}\n${body}`).digest("hex");
  return {
    "Content-Type": "application/json",
    "Convert-Application-ID": keyId,
    Expires: String(expires),
    Authorization: `Convert-HMAC-SHA256 Signature=${sig}`,
  };
}

function compactConvertExperience(e) {
  return {
    id: e.id ?? null,
    name: e.name ?? null,
    status: e.status ?? null,
    start_date: e.start_date ?? null,
    end_date: e.end_date ?? null,
    created_at: e.created_at ?? null,
    goals: Array.isArray(e.goals) ? e.goals.map((g) => ({ id: g.id ?? null, name: g.name ?? null, type: g.type ?? null })) : [],
    variations: Array.isArray(e.variations)
      ? e.variations.map((v) => ({ id: v.id ?? null, name: v.name ?? null, status: v.status ?? null, traffic_distribution: v.traffic_distribution ?? null, is_baseline: v.is_baseline ?? null }))
      : [],
  };
}

function compactConvertReport(report) {
  const data = report?.data ?? report ?? {};
  const rd = data.reportData ?? {};
  return {
    data: {
      variations_data: Array.isArray(data.variations_data)
        ? data.variations_data.map((v) => ({ id: v.id ?? null, name: v.name ?? null, is_baseline: v.is_baseline ?? null, traffic_distribution: v.traffic_distribution ?? null }))
        : [],
      reportData: {
        variations: Array.isArray(rd.variations)
          ? rd.variations.map((v) => ({
              id: v.id ?? null,
              stats: Array.isArray(v.stats)
                ? v.stats.map((s) => ({ timestamp: s.timestamp ?? null, value: s.value ?? null, totals: s.totals ?? null, visitors: s.visitors ?? null }))
                : [],
            }))
          : [],
      },
    },
  };
}

function httpErrorFromConvertAxios(err, action) {
  const status = err?.response?.status;
  const body = err?.response?.data;
  console.error(`[convert/experiments] ${action} failed:`, { status, body, message: err.message });

  const httpErr = new Error(
    status === 401 || status === 403
      ? `Convert API rejected credentials (${status}). Check the encrypted keyId/keySecret stored for this client.`
      : status === 404
        ? `Convert API returned 404 for ${action}. Check accountId/projectId.`
        : status
          ? `Convert API ${action} failed with HTTP ${status}: ${JSON.stringify(body).slice(0, 300)}`
          : `Convert API ${action} failed: ${err.message}`
  );
  httpErr.status = status === 401 || status === 403 ? 403 : status === 404 ? 404 : status ? 503 : 500;
  return httpErr;
}

// Returns a client's Convert credentials with keyId/keySecret decrypted. Needed by the
// browser-side sync (frontend/src/lib/convertSync.ts), which signs Convert API requests
// with Web Crypto and can't run the server's AES-256-GCM decryption itself. Doesn't expose
// anything the owning client couldn't already read directly from Firestore (see
// firestore.rules clients/{clientId}/credentials rule) — it just decrypts it first.
app.post("/api/convert/credentials", requireClientOrAdminOwnership((req) => req.body?.clientId), async (req, res) => {
  const clientId = String(req.body?.clientId || "");
  if (!clientId) return res.status(400).json({ error: "clientId required." });

  try {
    const db = admin.firestore();
    const credSnap = await db.collection("clients").doc(clientId).collection("credentials").doc("convert").get();
    if (!credSnap.exists) return res.status(404).json({ error: "No Convert credentials for this client." });

    const cred = credSnap.data();
    res.json({
      accountId: String(cred.accountId ?? ""),
      projectId: String(cred.projectId ?? ""),
      keyId: readConvertCredential(cred.keyId),
      keySecret: readConvertCredential(cred.keySecret),
    });
  } catch (err) {
    console.error("[convert/credentials]", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/convert/experiments", requireClientOrAdminOwnership((req) => req.body?.clientId), async (req, res) => {
  const clientId = String(req.body?.clientId || "");
  if (!clientId) return res.status(400).json({ error: "clientId required." });

  try {
    const db = admin.firestore();
    const credSnap = await db.collection("clients").doc(clientId).collection("credentials").doc("convert").get();
    if (!credSnap.exists) return res.status(404).json({ error: "No Convert credentials for this client." });

    const cred = credSnap.data();
    const accountId = String(cred.accountId ?? "");
    const projectId = String(cred.projectId ?? "");
    if (!accountId || !projectId) {
      return res.status(400).json({ error: "Convert credentials missing accountId or projectId." });
    }

    const keyId = readConvertCredential(cred.keyId);
    const keySecret = readConvertCredential(cred.keySecret);
    if (!keyId || !keySecret) {
      return res.status(400).json({ error: "Convert credentials missing keyId or keySecret." });
    }

    const clientDoc = await db.collection("clients").doc(clientId).get();
    const clientData = clientDoc.data() || {};
    const startDate = clientData.contractStartDate?.toDate?.() ?? new Date(0);
    const startTime = Math.floor(startDate.getTime() / 1000);
    const endTime = Math.floor(Date.now() / 1000);

    const listUrl = `${CONVERT_API_BASE}/accounts/${accountId}/projects/${projectId}/experiences`;
    const listBody = JSON.stringify({
      results_per_page: 500,
      sort_by: "id",
      sort_direction: "asc",
      include: ["variations", "goals"],
      expand: ["variations", "goals"],
    });

    let experiences;
    try {
      const listRes = await axios.post(listUrl, listBody, { headers: signConvertHeaders(keyId, keySecret, listUrl, listBody) });
      experiences = (listRes.data?.data ?? listRes.data ?? []).map(compactConvertExperience);
    } catch (err) {
      throw httpErrorFromConvertAxios(err, "list experiments");
    }

    const reports = await Promise.all(
      experiences.map(async (exp) => {
        try {
          const url = `${CONVERT_API_BASE}/accounts/${accountId}/projects/${projectId}/experiences/${exp.id}/aggregated_report`;
          const body = JSON.stringify({ utc_offset: 0, start_time: startTime, end_time: endTime });
          const reportRes = await axios.post(url, body, { headers: signConvertHeaders(keyId, keySecret, url, body) });
          return { experimentId: String(exp.id), report: compactConvertReport(reportRes.data) };
        } catch (err) {
          console.warn(`[convert/experiments] report failed for ${exp.id}:`, err?.response?.status, err.message);
          return { experimentId: String(exp.id), report: null };
        }
      })
    );

    res.json({ experiments, reports });
  } catch (err) {
    console.error("[convert/experiments]", err.message);
    res.status(err.status || 500).json({ error: err.message });
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
