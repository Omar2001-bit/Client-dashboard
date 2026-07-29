import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { doc, getDoc } from "firebase/firestore";
import { ArrowLeft, ExternalLink, Save, Send, Unlink } from "lucide-react";
import { db } from "@/lib/firebase";
import { fetchWithAuth, readJsonOrThrow } from "@/lib/apiClient";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Select } from "@/components/ui/Select";
import { Alert } from "@/components/ui/Alert";
import { useClientTimeline } from "@/hooks/useClientTimeline";
import type { ClientDoc, ClientTimelineConfig, ClickUpFolder, ClickUpWorkspace } from "@/types";

export function ClientTimelineEditorPage({ embedded = false }: { embedded?: boolean }) {
  const { clientId } = useParams<{ clientId: string }>();
  const { timeline, loaded, saveTimeline } = useClientTimeline(clientId);
  const [client, setClient] = useState<ClientDoc | null>(null);
  const [clientLoading, setClientLoading] = useState(true);
  const [local, setLocal] = useState<ClientTimelineConfig>({});
  const [ready, setReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [clickupLoading, setClickupLoading] = useState(false);
  const [clickupMessage, setClickupMessage] = useState<string>("");
  const [clickupConfigured, setClickupConfigured] = useState<boolean | null>(null);
  const [clickupWorkspaces, setClickupWorkspaces] = useState<ClickUpWorkspace[]>([]);
  const [clickupFolders, setClickupFolders] = useState<ClickUpFolder[]>([]);
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState("");
  const [selectedFolderId, setSelectedFolderId] = useState("");

  useEffect(() => {
    if (!clientId) return;
    getDoc(doc(db, "clients", clientId)).then((snap) => {
      if (snap.exists()) setClient({ id: snap.id, ...snap.data() } as ClientDoc);
      setClientLoading(false);
    });
  }, [clientId]);

  useEffect(() => {
    fetchWithAuth("/api/clickup/status")
      .then((resp) => readJsonOrThrow<{ configured?: boolean }>(resp, "Failed to check ClickUp status."))
      .then((data) => setClickupConfigured(Boolean(data.configured)))
      .catch(() => setClickupConfigured(false));
  }, []);

  useEffect(() => {
    if (!clickupConfigured) return;
    fetchWithAuth("/api/clickup/workspaces")
      .then((resp) => readJsonOrThrow<{ workspaces?: ClickUpWorkspace[] }>(resp, "Failed to load ClickUp workspaces."))
      .then((data) => setClickupWorkspaces(data.workspaces ?? []))
      .catch((err) => setClickupMessage(`Failed to load ClickUp workspaces: ${String(err)}`));
  }, [clickupConfigured]);

  useEffect(() => {
    if (!selectedWorkspaceId) return;
    fetchWithAuth(`/api/clickup/folders?workspaceId=${encodeURIComponent(selectedWorkspaceId)}`)
      .then((resp) => readJsonOrThrow<{ folders?: ClickUpFolder[] }>(resp, "Failed to load ClickUp folders."))
      .then((data) => setClickupFolders(data.folders ?? []))
      .catch((err) => setClickupMessage(`Failed to load ClickUp folders: ${String(err)}`));
  }, [selectedWorkspaceId]);

  useEffect(() => {
    if (loaded && !ready) {
      setLocal(timeline);
      setReady(true);
      if (timeline.clickup?.workspaceId) setSelectedWorkspaceId(timeline.clickup.workspaceId);
      if (timeline.clickup?.folderId) setSelectedFolderId(timeline.clickup.folderId);
    }
  }, [loaded, ready, timeline]);

  const clickup = local.clickup ?? {};
  const clickupTasks = clickup.tasks ?? [];
  const hasClickup = Boolean(clickup.connected && clickup.workspaceId);

  const handleSave = async () => {
    if (!clientId) return;
    setSaving(true);
    try {
      await saveTimeline(local);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } finally {
      setSaving(false);
    }
  };

  const handleSyncClickupTasks = async () => {
    if (!clientId || !selectedWorkspaceId) return;
    setClickupLoading(true);
    setClickupMessage("");
    try {
      const workspaceName = clickupWorkspaces.find((w) => w.id === selectedWorkspaceId)?.name ?? "";
      const folderName = selectedFolderId ? clickupFolders.find((f) => f.id === selectedFolderId)?.name ?? "" : "";
      const resp = await fetchWithAuth("/api/clickup/sync-to-client", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId,
          workspaceId: selectedWorkspaceId,
          workspaceName,
          folderId: selectedFolderId || undefined,
          folderName: selectedFolderId ? folderName : undefined,
        }),
      });
      const data = await readJsonOrThrow<{ taskCount?: number }>(resp, "ClickUp sync failed.");
      setClickupMessage(`Loaded ${data.taskCount ?? 0} ClickUp tasks.`);
      await refreshTimeline();
    } catch (err) {
      setClickupMessage(`ClickUp sync failed: ${String(err)}`);
    } finally {
      setClickupLoading(false);
    }
  };

  const handleDisconnectClickup = async () => {
    if (!clientId) return;
    setClickupLoading(true);
    setClickupMessage("");
    try {
      const resp = await fetchWithAuth("/api/clickup/disconnect-client", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId }),
      });
      await readJsonOrThrow(resp, "Clearing ClickUp scope failed.");
      setLocal((prev) => ({
        ...prev,
        clickup: { connected: false, workspaceId: null, workspaceName: "", folderId: null, folderName: "", tasks: [] },
      }));
      setSelectedWorkspaceId("");
      setSelectedFolderId("");
      setClickupMessage("ClickUp scope cleared for this client.");
    } catch (err) {
      setClickupMessage(`Clearing ClickUp scope failed: ${String(err)}`);
    } finally {
      setClickupLoading(false);
    }
  };

  const refreshTimeline = async () => {
    if (!clientId) return;
    const snap = await getDoc(doc(db, "clients", clientId, "timeline", "config"));
    if (snap.exists()) {
      setLocal(snap.data() as ClientTimelineConfig);
    }
  };

  if (clientLoading) return <div className="p-8 text-sm text-ink/50">Loading timeline editor...</div>;
  if (!client) return <div className="p-8 text-sm text-ink/50">Client not found.</div>;

  return (
    <div className="p-8 space-y-6">
      {!embedded && (
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Link to={`/admin/clients/${clientId}`} className="text-ink/40 hover:text-ink">
              <ArrowLeft className="h-5 w-5" />
            </Link>
            <div>
              <h1 className="text-2xl font-bold text-ink">Timeline Builder</h1>
              <p className="text-sm text-ink/50">{client.name}</p>
            </div>
          </div>
          <Button onClick={handleSave} loading={saving} className="flex items-center gap-2">
            <Save className="h-4 w-4" />
            {saved ? "Saved!" : "Save Timeline"}
          </Button>
        </div>
      )}
      {embedded && (
        <div className="flex justify-end">
          <Button onClick={handleSave} loading={saving} className="flex items-center gap-2">
            <Save className="h-4 w-4" />
            {saved ? "Saved!" : "Save Timeline"}
          </Button>
        </div>
      )}

      <div className="max-w-3xl">
        <Card>
          <CardHeader className="flex items-center justify-between">
            <div>
              <h2 className="font-semibold text-ink">ClickUp Tasks</h2>
              <p className="mt-1 text-xs text-ink/45">
                Pick a workspace and folder (usually named after the client), then sync tasks — the client sees them as an auto-generated Gantt chart.
              </p>
            </div>
            {hasClickup && (
              <Button variant="ghost" size="sm" onClick={handleDisconnectClickup} loading={clickupLoading} className="flex items-center gap-1.5">
                <Unlink className="h-4 w-4" />
                Clear
              </Button>
            )}
          </CardHeader>
          <CardBody className="space-y-4">
            {clickupConfigured === false ? (
              <Alert tone="info">
                ClickUp isn&apos;t connected yet.{" "}
                <Link to="/admin/settings" className="text-brand-700 hover:text-brand-800">
                  Save a personal API token in Settings
                </Link>{" "}
                first.
              </Alert>
            ) : (
              <>
                <div className="grid gap-3 md:grid-cols-[1fr_1fr_auto]">
                  <Select
                    label="Workspace"
                    value={selectedWorkspaceId}
                    onChange={(e) => {
                      setSelectedWorkspaceId(e.target.value);
                      setSelectedFolderId("");
                      setClickupFolders([]);
                    }}
                  >
                    <option value="">Select a workspace</option>
                    {clickupWorkspaces.map((workspace) => (
                      <option key={workspace.id} value={workspace.id}>
                        {workspace.name}
                      </option>
                    ))}
                  </Select>
                  <Select
                    label="Folder"
                    value={selectedFolderId}
                    onChange={(e) => setSelectedFolderId(e.target.value)}
                    disabled={!selectedWorkspaceId}
                  >
                    <option value="">Whole workspace</option>
                    {clickupFolders.map((folder) => (
                      <option key={folder.id} value={folder.id}>
                        {folder.name}
                      </option>
                    ))}
                  </Select>
                  <div className="flex items-end">
                    <Button
                      variant="secondary"
                      size="md"
                      onClick={handleSyncClickupTasks}
                      loading={clickupLoading}
                      disabled={!selectedWorkspaceId}
                      className="flex items-center gap-1.5 w-full"
                    >
                      <Send className="h-4 w-4" />
                      Sync
                    </Button>
                  </div>
                </div>

                {clickupMessage && <Alert tone="info">{clickupMessage}</Alert>}

                {hasClickup && (
                  <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                    <div className="rounded-2xl border border-ink/10 bg-white px-4 py-3">
                      <p className="text-xs uppercase tracking-wide text-ink/40">Tasks loaded</p>
                      <p className="mt-1 text-lg font-semibold text-ink">{clickupTasks.length}</p>
                    </div>
                    <div className="rounded-2xl border border-ink/10 bg-white px-4 py-3">
                      <p className="text-xs uppercase tracking-wide text-ink/40">Last sync</p>
                      <p className="mt-1 text-sm font-medium text-ink">{clickup.lastSyncedAt ? new Date(clickup.lastSyncedAt).toLocaleString() : "Never"}</p>
                    </div>
                    <div className="rounded-2xl border border-ink/10 bg-white px-4 py-3">
                      <p className="text-xs uppercase tracking-wide text-ink/40">Scope</p>
                      <p className="mt-1 text-sm font-medium text-ink">
                        {clickup.workspaceName || "Workspace"}
                        {clickup.folderName ? ` / ${clickup.folderName}` : " (whole workspace)"}
                      </p>
                    </div>
                  </div>
                )}

                <div className="max-h-[440px] overflow-auto rounded-2xl border border-ink/10">
                  {clickupTasks.length > 0 ? (
                    <div className="divide-y divide-ink/5">
                      {clickupTasks.map((task) => (
                        <div key={task.id} className="flex items-center justify-between gap-3 px-4 py-3">
                          <div className="min-w-0">
                            <p className="font-medium text-ink truncate">{task.name}</p>
                            <p className="text-xs text-ink/45">
                              {task.status || "Unknown status"}
                              {task.dueDate ? ` - Due ${task.dueDate}` : ""}
                              {task.listName ? ` - ${task.listName}` : ""}
                            </p>
                          </div>
                          {task.url && (
                            <a href={task.url} target="_blank" rel="noreferrer" className="shrink-0 text-ink/40 hover:text-ink">
                              <ExternalLink className="h-4 w-4" />
                            </a>
                          )}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="px-4 py-10 text-center text-sm text-ink/45">
                      Sync a workspace to load tasks here.
                    </div>
                  )}
                </div>
              </>
            )}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
