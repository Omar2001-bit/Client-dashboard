import axios, { AxiosError } from "axios";
import * as admin from "firebase-admin";
import { randomUUID } from "crypto";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { onRequest } from "firebase-functions/v2/https";
import { callableCors } from "./lib/cors";
import { encrypt, decrypt } from "./lib/encryption";
import { getAdminFirestore } from "./lib/firebaseAdmin";

const CLICKUP_AUTH_URL = "https://app.clickup.com/api";
const CLICKUP_API_BASE = "https://api.clickup.com/api/v2";
const CLICKUP_ENV_CLIENT_ID = process.env.CLICKUP_CLIENT_ID ?? "";
const CLICKUP_ENV_CLIENT_SECRET = process.env.CLICKUP_CLIENT_SECRET ?? "";
const CLICKUP_ENV_REDIRECT_URI = process.env.CLICKUP_REDIRECT_URI ?? "";
const CLICKUP_CONFIG_DOC = "clickup";

interface CreateAuthSessionRequest {
  clientId: string;
  returnTo?: string;
}

interface SyncTasksRequest {
  clientId: string;
  workspaceId?: string;
}

interface ClickUpTokenResponse {
  access_token?: string;
  token?: string;
  refresh_token?: string;
}

interface ClickUpUserResponse {
  user?: Record<string, unknown>;
  teams?: Array<Record<string, unknown>>;
  team?: Array<Record<string, unknown>>;
}

interface ClickUpUserProfile {
  id?: string | number;
  username?: string;
  name?: string;
  email?: string;
}

interface ClickUpTaskResponse {
  tasks?: Array<Record<string, unknown>>;
  data?: Array<Record<string, unknown>>;
}

interface ClickUpAppConfigInput {
  clientId: string;
  clientSecret?: string;
  redirectUri: string;
}

interface ClickUpStoredConfig {
  clientId?: string;
  clientSecretEnc?: string;
  clientSecret?: string;
  redirectUri?: string;
  updatedAt?: admin.firestore.Timestamp;
  updatedBy?: string;
}

interface ClickUpResolvedConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  source: "firestore" | "env";
  configured: boolean;
}

interface ClickUpConfigResponse {
  clientId: string;
  redirectUri: string;
  hasSecret: boolean;
  source: "firestore" | "env";
  configured: boolean;
  updatedAt?: string;
  updatedBy?: string;
}

export const clickupGetAuthUrl = onCall({ cors: callableCors }, async (request) => {
  await assertAdmin(request.auth?.uid, request.auth?.token as Record<string, unknown> | undefined);

  const { clientId, returnTo } = request.data as CreateAuthSessionRequest;
  if (!clientId) throw new HttpsError("invalid-argument", "clientId required.");

  const config = await resolveClickUpConfig();
  if (!config.configured) {
    throw new HttpsError(
      "failed-precondition",
      "ClickUp is not configured yet. Save the ClickUp app credentials in admin settings first."
    );
  }

  const state = randomUUID();
  const db = getAdminFirestore();
  const now = admin.firestore.Timestamp.now();
  await db.collection("clickupOAuthSessions").doc(state).set({
    clientId,
    requestedBy: request.auth?.uid ?? null,
    returnTo: returnTo ?? null,
    createdAt: now,
    expiresAt: admin.firestore.Timestamp.fromMillis(now.toMillis() + 30 * 60 * 1000),
  });

  const authUrl =
    `${CLICKUP_AUTH_URL}?client_id=${encodeURIComponent(config.clientId)}` +
    `&redirect_uri=${encodeURIComponent(config.redirectUri)}` +
    `&state=${encodeURIComponent(state)}`;

  return { authUrl, state };
});

export const clickupGetConfig = onCall({ cors: callableCors }, async (request) => {
  await assertAdmin(request.auth?.uid, request.auth?.token as Record<string, unknown> | undefined);
  return await readClickUpConfigForClient();
});

export const clickupSaveConfig = onCall({ cors: callableCors }, async (request) => {
  await assertAdmin(request.auth?.uid, request.auth?.token as Record<string, unknown> | undefined);

  const data = request.data as Partial<ClickUpAppConfigInput>;
  const clientId = String(data.clientId ?? "").trim();
  const clientSecret = String(data.clientSecret ?? "").trim();
  const redirectUri = String(data.redirectUri ?? "").trim();

  const db = getAdminFirestore();
  const existingSnap = await db.collection("appConfig").doc(CLICKUP_CONFIG_DOC).get();
  const existing = existingSnap.exists ? (existingSnap.data() as ClickUpStoredConfig) : {};

  const nextClientId = clientId || String(existing.clientId ?? CLICKUP_ENV_CLIENT_ID ?? "").trim();
  const nextRedirectUri = redirectUri || String(existing.redirectUri ?? CLICKUP_ENV_REDIRECT_URI ?? "").trim();
  const nextSecretEnc =
    clientSecret.length > 0
      ? encrypt(clientSecret)
      : String(
          existing.clientSecretEnc ??
            (existing.clientSecret ? encrypt(existing.clientSecret) : "") ??
            (CLICKUP_ENV_CLIENT_SECRET ? encrypt(CLICKUP_ENV_CLIENT_SECRET) : "")
        ).trim();

  if (!nextClientId || !nextRedirectUri || !nextSecretEnc) {
    throw new HttpsError(
      "invalid-argument",
      "clientId, redirectUri, and clientSecret are required at least once."
    );
  }

  const now = admin.firestore.Timestamp.now();
  await db.collection("appConfig").doc(CLICKUP_CONFIG_DOC).set(
    {
      clientId: nextClientId,
      clientSecretEnc: nextSecretEnc,
      redirectUri: nextRedirectUri,
      updatedAt: now,
      updatedBy: request.auth?.uid ?? null,
    },
    { merge: true }
  );

  return {
    success: true,
    ...formatStoredConfig({
      clientId,
      clientSecretEnc: "present",
      redirectUri,
      updatedAt: now,
      updatedBy: request.auth?.uid ?? undefined,
    }),
  };
});

export const clickupOAuthCallback = onRequest(async (req, res) => {
  try {
    if (req.method !== "GET") {
      res.status(405).send("Method not allowed");
      return;
    }

    const code = String(req.query.code ?? "").trim();
    const state = String(req.query.state ?? "").trim();
    if (!code || !state) {
      res.status(400).send("Missing code or state");
      return;
    }
    const config = await resolveClickUpConfig();
    if (!config.configured) {
      res.status(500).send("ClickUp app credentials are not configured yet");
      return;
    }

    const db = getAdminFirestore();
    const sessionRef = db.collection("clickupOAuthSessions").doc(state);
    const sessionSnap = await sessionRef.get();
    if (!sessionSnap.exists) {
      res.status(400).send("Invalid or expired OAuth session");
      return;
    }

    const session = sessionSnap.data() as { clientId?: string; returnTo?: string; expiresAt?: admin.firestore.Timestamp };
    const expiresAt = session.expiresAt?.toMillis?.() ?? 0;
    if (expiresAt > 0 && expiresAt < Date.now()) {
      await sessionRef.delete();
      res.status(400).send("OAuth session expired");
      return;
    }

    const clientId = String(session.clientId ?? "");
    if (!clientId) {
      await sessionRef.delete();
      res.status(400).send("OAuth session missing clientId");
      return;
    }

    const tokenRes = await axios.post<ClickUpTokenResponse>(
      `${CLICKUP_API_BASE}/oauth/token`,
      {
        client_id: config.clientId,
        client_secret: config.clientSecret,
        code,
      },
      { headers: { accept: "application/json", "content-type": "application/json" }, timeout: 20000 }
    );

    const accessToken = String(tokenRes.data.access_token ?? tokenRes.data.token ?? "");
    if (!accessToken) {
      throw new Error("ClickUp did not return an access token.");
    }

    const authHeaders = {
      Authorization: `Bearer ${accessToken}`,
      accept: "application/json",
    };

    const [userRes, teamsRes] = await Promise.all([
      axios.get<ClickUpUserResponse>(`${CLICKUP_API_BASE}/user`, { headers: authHeaders, timeout: 15000 }),
      axios.get<ClickUpUserResponse>(`${CLICKUP_API_BASE}/team`, { headers: authHeaders, timeout: 15000 }),
    ]);

    const user = (userRes.data.user ?? userRes.data ?? {}) as ClickUpUserProfile;
    const teams = normalizeWorkspaces(teamsRes.data);
    const now = admin.firestore.Timestamp.now();

    await db.collection("clients").doc(clientId).collection("credentials").doc("clickup").set(
      {
        accessToken: encrypt(accessToken),
        authorizedUserId: String(user.id ?? ""),
        authorizedUserName: String(user.username ?? user.name ?? ""),
        authorizedUserEmail: String(user.email ?? ""),
        connectedAt: now,
        updatedAt: now,
      },
      { merge: true }
    );

    const timelineRef = db.collection("clients").doc(clientId).collection("timeline").doc("config");
    const timelineSnap = await timelineRef.get();
    const existing = timelineSnap.exists ? timelineSnap.data() ?? {} : {};
    const firstWorkspace = teams[0] ?? null;
    await timelineRef.set(
      {
        ...existing,
        clickup: {
          ...(existing as { clickup?: Record<string, unknown> }).clickup,
          connected: true,
          authorizedUserName: String(user.username ?? user.name ?? ""),
          authorizedUserEmail: String(user.email ?? ""),
          workspaces: teams,
          activeWorkspaceId:
            (existing as { clickup?: { activeWorkspaceId?: string } }).clickup?.activeWorkspaceId ??
            firstWorkspace?.id ??
            "",
          activeWorkspaceName:
            (existing as { clickup?: { activeWorkspaceName?: string } }).clickup?.activeWorkspaceName ??
            firstWorkspace?.name ??
            "",
          tasks: (existing as { clickup?: { tasks?: unknown[] } }).clickup?.tasks ?? [],
          taskAssignments:
            (existing as { clickup?: { taskAssignments?: Record<string, string> } }).clickup?.taskAssignments ??
            {},
          lastSyncedAt: now.toDate().toISOString(),
        },
      },
      { merge: true }
    );

    await sessionRef.delete();
    res.redirect(String(session.returnTo ?? `/admin/clients/${clientId}/timeline`));
  } catch (err) {
    console.error("[clickupOAuthCallback] failed:", err);
    res.status(500).send(`ClickUp OAuth failed: ${summarizeError(err)}`);
  }
});

export const clickupSyncTasks = onCall({ cors: callableCors, timeoutSeconds: 120 }, async (request) => {
  await assertAdmin(request.auth?.uid, request.auth?.token as Record<string, unknown> | undefined);

  const { clientId, workspaceId } = request.data as SyncTasksRequest;
  if (!clientId) throw new HttpsError("invalid-argument", "clientId required.");
  if (!request.auth) throw new HttpsError("unauthenticated", "Must be signed in.");

  const db = getAdminFirestore();
  const credSnap = await db.collection("clients").doc(clientId).collection("credentials").doc("clickup").get();
  if (!credSnap.exists) {
    throw new HttpsError("not-found", "No ClickUp credentials found for this client.");
  }

  const cred = credSnap.data() as { accessToken?: string };
  const accessToken = readToken(cred.accessToken);
  if (!accessToken) {
    throw new HttpsError("failed-precondition", "ClickUp access token missing.");
  }

  const timelineRef = db.collection("clients").doc(clientId).collection("timeline").doc("config");
  const timelineSnap = await timelineRef.get();
  const current = timelineSnap.exists ? timelineSnap.data() ?? {} : {};
  const clickup = ((current as { clickup?: Record<string, unknown> }).clickup ?? {}) as {
    activeWorkspaceId?: string;
    workspaces?: Array<{ id?: string; name?: string }>;
    taskAssignments?: Record<string, string>;
  };
  const activeWorkspaceId = workspaceId ?? clickup.activeWorkspaceId ?? clickup.workspaces?.[0]?.id ?? "";
  if (!activeWorkspaceId) {
    throw new HttpsError("failed-precondition", "No ClickUp workspace selected.");
  }

  const tasks = await fetchWorkspaceTasks(accessToken, activeWorkspaceId);
  const taskAssignments = pruneAssignments(clickup.taskAssignments ?? {}, tasks);
  const activeWorkspaceName = clickup.workspaces?.find((workspace) => workspace.id === activeWorkspaceId)?.name;

  await timelineRef.set(
    {
      ...current,
      clickup: {
        ...(clickup as Record<string, unknown>),
        connected: true,
        activeWorkspaceId,
        activeWorkspaceName: activeWorkspaceName ?? String(activeWorkspaceId),
        tasks,
        taskAssignments,
        lastSyncedAt: new Date().toISOString(),
      },
    },
    { merge: true }
  );

  return { success: true, taskCount: tasks.length, workspaceId: activeWorkspaceId };
});

export const clickupDisconnect = onCall({ cors: callableCors }, async (request) => {
  await assertAdmin(request.auth?.uid, request.auth?.token as Record<string, unknown> | undefined);

  const { clientId } = request.data as { clientId: string };
  if (!clientId) throw new HttpsError("invalid-argument", "clientId required.");

  const db = getAdminFirestore();
  await Promise.all([
    db.collection("clients").doc(clientId).collection("credentials").doc("clickup").delete(),
    db.collection("clients").doc(clientId).collection("timeline").doc("config").set(
      {
        clickup: {
          connected: false,
          workspaces: [],
          tasks: [],
          taskAssignments: {},
        },
      },
      { merge: true }
    ),
  ]);

  return { success: true };
});

function normalizeWorkspaces(payload: ClickUpUserResponse): Array<{ id: string; name: string }> {
  const raw = Array.isArray(payload.teams) ? payload.teams : Array.isArray(payload.team) ? payload.team : [];
  return raw
    .map((workspace) => ({
      id: String(workspace.id ?? workspace.team_id ?? workspace.workspace_id ?? ""),
      name: String(workspace.name ?? workspace.username ?? workspace.url ?? "Workspace"),
    }))
    .filter((workspace) => workspace.id);
}

async function readClickUpConfigForClient(): Promise<ClickUpConfigResponse> {
  const db = getAdminFirestore();
  const snap = await db.collection("appConfig").doc(CLICKUP_CONFIG_DOC).get();
  if (!snap.exists) {
    return {
      clientId: CLICKUP_ENV_CLIENT_ID,
      redirectUri: CLICKUP_ENV_REDIRECT_URI,
      hasSecret: Boolean(CLICKUP_ENV_CLIENT_SECRET),
      source: "env",
      configured: Boolean(CLICKUP_ENV_CLIENT_ID && CLICKUP_ENV_CLIENT_SECRET && CLICKUP_ENV_REDIRECT_URI),
    };
  }

  const stored = snap.data() as ClickUpStoredConfig;
  const clientId = String(stored.clientId ?? CLICKUP_ENV_CLIENT_ID ?? "").trim();
  const redirectUri = String(stored.redirectUri ?? CLICKUP_ENV_REDIRECT_URI ?? "").trim();
  const hasSecret = Boolean(stored.clientSecretEnc ?? stored.clientSecret ?? CLICKUP_ENV_CLIENT_SECRET);
  return {
    clientId,
    redirectUri,
    hasSecret,
    source: "firestore",
    configured: Boolean(clientId && redirectUri && hasSecret),
    updatedAt: stored.updatedAt?.toDate?.().toISOString(),
    updatedBy: stored.updatedBy,
  };
}

async function resolveClickUpConfig(): Promise<ClickUpResolvedConfig> {
  const db = getAdminFirestore();
  const snap = await db.collection("appConfig").doc(CLICKUP_CONFIG_DOC).get();

  if (snap.exists) {
    const stored = snap.data() as ClickUpStoredConfig;
    const clientId = String(stored.clientId ?? CLICKUP_ENV_CLIENT_ID ?? "").trim();
    const redirectUri = String(stored.redirectUri ?? CLICKUP_ENV_REDIRECT_URI ?? "").trim();
    const clientSecret = stored.clientSecretEnc
      ? decrypt(stored.clientSecretEnc)
      : String(stored.clientSecret ?? CLICKUP_ENV_CLIENT_SECRET ?? "");
    const configured = Boolean(clientId && clientSecret && redirectUri);
    return {
      clientId,
      clientSecret,
      redirectUri,
      source: "firestore",
      configured,
    };
  }

  return {
    clientId: CLICKUP_ENV_CLIENT_ID,
    clientSecret: CLICKUP_ENV_CLIENT_SECRET,
    redirectUri: CLICKUP_ENV_REDIRECT_URI,
    source: "env",
    configured: Boolean(CLICKUP_ENV_CLIENT_ID && CLICKUP_ENV_CLIENT_SECRET && CLICKUP_ENV_REDIRECT_URI),
  };
}

function formatStoredConfig(config: ClickUpStoredConfig): ClickUpConfigResponse {
  return {
    clientId: String(config.clientId ?? ""),
    redirectUri: String(config.redirectUri ?? ""),
    hasSecret: Boolean(config.clientSecretEnc),
    source: "firestore",
    configured: Boolean(config.clientId && config.clientSecretEnc && config.redirectUri),
    updatedAt: config.updatedAt?.toDate?.().toISOString(),
    updatedBy: config.updatedBy,
  };
}

async function fetchWorkspaceTasks(accessToken: string, workspaceId: string) {
  const tasks: Array<{ id: string; name: string; status?: string; dueDate?: string; listId?: string; listName?: string; assigneeNames?: string[]; url?: string; parentId?: string | null; }> = [];
  const headers = { Authorization: `Bearer ${accessToken}`, accept: "application/json" };
  for (let page = 0; page < 100; page += 1) {
    const response = await axios.get<ClickUpTaskResponse>(`${CLICKUP_API_BASE}/team/${workspaceId}/task`, {
      headers,
      params: { page, subtasks: true, order_by: "updated", reverse: true },
      timeout: 20000,
    });
    const pageTasks = extractTaskArray(response.data);
    if (pageTasks.length === 0) break;
    tasks.push(...pageTasks.map(normalizeTask));
    if (pageTasks.length < 100) break;
  }
  return tasks;
}

function extractTaskArray(payload: ClickUpTaskResponse): Array<Record<string, unknown>> {
  if (Array.isArray(payload.tasks)) return payload.tasks;
  if (Array.isArray(payload.data)) return payload.data;
  return [];
}

function normalizeTask(task: Record<string, unknown>) {
  const dueDate = normalizeDate(task.due_date ?? task.dueDate);
  const assigneeNames = Array.isArray(task.assignees)
    ? task.assignees
        .map((assignee: Record<string, unknown>) => String(assignee.username ?? assignee.email ?? assignee.name ?? assignee.id ?? ""))
        .filter(Boolean)
    : [];

  return {
    id: String(task.id ?? ""),
    name: String(task.name ?? "Untitled task"),
    status: String((task.status as Record<string, unknown> | undefined)?.status ?? task.status ?? ""),
    dueDate,
    listId: String((task.list as Record<string, unknown> | undefined)?.id ?? task.list_id ?? ""),
    listName: String((task.list as Record<string, unknown> | undefined)?.name ?? task.list_name ?? ""),
    assigneeNames,
    url: String(task.url ?? ""),
    parentId: task.parent != null ? String(task.parent) : null,
  };
}

function normalizeDate(value: unknown): string | undefined {
  if (value === null || value === undefined || value === "") return undefined;
  const asString = String(value);
  if (/^\d+$/.test(asString)) {
    const millis = Number(asString);
    if (Number.isFinite(millis)) {
      return new Date(millis).toISOString().slice(0, 10);
    }
  }
  const parsed = new Date(asString);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString().slice(0, 10);
}

function pruneAssignments(assignments: Record<string, string>, tasks: Array<{ id: string }>) {
  const taskIds = new Set(tasks.map((task) => task.id));
  return Object.fromEntries(Object.entries(assignments).filter(([taskId, phaseId]) => taskIds.has(taskId) && Boolean(phaseId)));
}

function readToken(value: unknown): string {
  const s = String(value ?? "");
  if (!s) return "";
  if (/^[0-9a-f]+:[0-9a-f]+:[0-9a-f]+$/i.test(s)) {
    try {
      return decrypt(s);
    } catch {
      return s;
    }
  }
  return s;
}

async function assertAdmin(uid: string | undefined, token?: Record<string, unknown>) {
  if (!uid) throw new HttpsError("unauthenticated", "Must be signed in.");
  if (token?.role === "admin" || token?.role === "executiveAdmin") return;
  const db = getAdminFirestore();
  const userDoc = await db.collection("users").doc(uid).get();
  if (userDoc.data()?.role === "admin" || userDoc.data()?.role === "executiveAdmin") return;
  throw new HttpsError("permission-denied", "Admin access required.");
}

function summarizeError(err: unknown): string {
  if (err instanceof HttpsError) return `${err.code}: ${err.message}`;
  const axiosErr = err as AxiosError<{ message?: string }>;
  return axiosErr.response?.data?.message ?? axiosErr.message ?? String(err);
}
