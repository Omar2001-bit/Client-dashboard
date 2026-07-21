import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { doc, getDoc } from "firebase/firestore";
import { ArrowLeft, CopyPlus, ExternalLink, GripVertical, Plus, Save, Send, Trash2, Unlink } from "lucide-react";
import { db } from "@/lib/firebase";
import { fetchWithAuth, readJsonOrThrow } from "@/lib/apiClient";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { TimelineViewer } from "@/components/timeline/TimelineViewer";
import { useClientTimeline } from "@/hooks/useClientTimeline";
import type { ClientDoc, ClientTimelineConfig, ClickUpFolder, ClickUpTask, ClickUpWorkspace, TimelinePhase } from "@/types";
import { sortPhases, toDateKey } from "@/lib/timeline";

const PHASE_COLORS = ["#6ae499", "#7cb7ff", "#fbbf24", "#f97316", "#f472b6", "#a78bfa", "#d94444"];

function createBlankPhase(client: ClientDoc | null, index: number): TimelinePhase {
  const start = toDateKey(client?.contractStartDate?.toDate?.() ?? new Date());
  const end = client?.contractEndDate?.toDate?.() ? toDateKey(client.contractEndDate.toDate()) : start;
  return {
    id: `phase_${Date.now()}_${index}`,
    title: `Phase ${index + 1}`,
    color: PHASE_COLORS[index % PHASE_COLORS.length],
    startDate: start,
    endDate: end,
    description: "",
    deliverables: [],
  };
}

export function ClientTimelineEditorPage({ embedded = false }: { embedded?: boolean }) {
  const { clientId } = useParams<{ clientId: string }>();
  const { timeline, loaded, saveTimeline } = useClientTimeline(clientId);
  const [client, setClient] = useState<ClientDoc | null>(null);
  const [clientLoading, setClientLoading] = useState(true);
  const [local, setLocal] = useState<ClientTimelineConfig>({});
  const [ready, setReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [selectedPhaseId, setSelectedPhaseId] = useState<string | null>(null);
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
      const first = timeline.phases?.[0]?.id ?? null;
      setSelectedPhaseId(first);
      if (timeline.clickup?.workspaceId) setSelectedWorkspaceId(timeline.clickup.workspaceId);
      if (timeline.clickup?.folderId) setSelectedFolderId(timeline.clickup.folderId);
    }
  }, [loaded, ready, timeline]);

  const sortedPhases = useMemo(() => sortPhases(local.phases ?? []), [local.phases]);
  const selectedPhase = sortedPhases.find((phase) => phase.id === selectedPhaseId) ?? sortedPhases[0] ?? null;
  const clickup = local.clickup ?? {};
  const clickupTasks = clickup.tasks ?? [];
  const phaseTaskMap = useMemo(() => {
    const map: Record<string, ClickUpTask[]> = {};
    clickupTasks.forEach((task) => {
      const phaseId = clickup.taskAssignments?.[task.id];
      if (!phaseId) return;
      if (!map[phaseId]) map[phaseId] = [];
      map[phaseId].push(task);
    });
    return map;
  }, [clickup.taskAssignments, clickupTasks]);
  const hasClickup = Boolean(clickup.connected && clickup.workspaceId);

  const updatePhase = (id: string, patch: Partial<TimelinePhase>) => {
    setLocal((prev) => ({
      ...prev,
      phases: (prev.phases ?? []).map((phase) => (phase.id !== id ? phase : { ...phase, ...patch })),
    }));
  };

  const setTaskAssignment = (taskId: string, phaseId: string) => {
    setLocal((prev) => {
      const current = prev.clickup?.taskAssignments ?? {};
      const nextAssignments = { ...current };
      if (phaseId) nextAssignments[taskId] = phaseId;
      else delete nextAssignments[taskId];
      return {
        ...prev,
        clickup: {
          ...(prev.clickup ?? {}),
          taskAssignments: nextAssignments,
        },
      };
    });
  };

  const addPhase = () => {
    const next = createBlankPhase(client, (local.phases ?? []).length);
    setSelectedPhaseId(next.id);
    setLocal((prev) => ({
      ...prev,
      phases: [...(prev.phases ?? []), next],
    }));
  };

  const duplicatePhase = (phase: TimelinePhase) => {
    const copy: TimelinePhase = {
      ...phase,
      id: `phase_${Date.now()}`,
      title: `${phase.title} Copy`,
    };
    setSelectedPhaseId(copy.id);
    setLocal((prev) => ({
      ...prev,
      phases: [...(prev.phases ?? []), copy],
    }));
  };

  const removePhase = (id: string) => {
    setLocal((prev) => ({
      ...prev,
      phases: (prev.phases ?? []).filter((phase) => phase.id !== id),
    }));
    setSelectedPhaseId((current) => (current === id ? null : current));
  };

  const handleSave = async () => {
    if (!clientId) return;
    setSaving(true);
    try {
      await saveTimeline({
        ...local,
        phases: sortPhases(local.phases ?? []),
      });
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
        clickup: { connected: false, workspaceId: null, workspaceName: "", folderId: null, folderName: "", tasks: [], taskAssignments: {} },
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

      <div className="grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
        <Card>
          <CardHeader className="flex items-center justify-between">
            <div>
              <h2 className="font-semibold text-ink">Phase Builder</h2>
              <p className="mt-1 text-xs text-ink/45">Admin-controlled settings for every phase block.</p>
            </div>
            <Button variant="secondary" size="sm" onClick={addPhase} className="flex items-center gap-1.5">
              <Plus className="h-4 w-4" />
              Create Phase
            </Button>
          </CardHeader>
          <CardBody className="space-y-4">
            {(sortedPhases.length === 0) && (
              <p className="text-sm text-ink/45">No phases configured yet.</p>
            )}
            {sortedPhases.map((phase, index) => (
              <div key={phase.id} className={`rounded-2xl border p-4 ${selectedPhase?.id === phase.id ? "border-brand-300 bg-brand-50/30" : "border-ink/10 bg-white"}`}>
                <div className="mb-4 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <GripVertical className="h-4 w-4 text-ink/30" />
                    <p className="font-medium text-ink">Phase {index + 1}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button variant="ghost" size="sm" onClick={() => duplicatePhase(phase)} className="flex items-center gap-1.5">
                      <CopyPlus className="h-4 w-4" />
                      Duplicate
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => removePhase(phase.id)} className="flex items-center gap-1.5 text-red-600 hover:text-red-700">
                      <Trash2 className="h-4 w-4" />
                      Delete
                    </Button>
                  </div>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <Input
                    label="Phase title"
                    value={phase.title}
                    onChange={(e) => updatePhase(phase.id, { title: e.target.value })}
                    placeholder="Onboarding"
                  />
                  <div className="space-y-1">
                    <label className="block text-sm font-medium text-ink/80">Color</label>
                    <div className="flex items-center gap-3">
                      <input
                        type="color"
                        value={phase.color}
                        onChange={(e) => updatePhase(phase.id, { color: e.target.value })}
                        className="h-11 w-14 rounded-xl border border-ink/10 bg-white p-1"
                      />
                      <Input
                        value={phase.color}
                        onChange={(e) => updatePhase(phase.id, { color: e.target.value })}
                        placeholder="#6ae499"
                      />
                    </div>
                  </div>
                </div>

                <div className="mt-4 grid gap-4 md:grid-cols-2">
                  <Input
                    label="Start date"
                    type="date"
                    value={phase.startDate}
                    min={client.contractStartDate.toDate().toISOString().slice(0, 10)}
                    max={phase.endDate}
                    onChange={(e) => updatePhase(phase.id, { startDate: e.target.value })}
                  />
                  <Input
                    label="End date"
                    type="date"
                    value={phase.endDate}
                    min={phase.startDate}
                    max={client.contractEndDate ? client.contractEndDate.toDate().toISOString().slice(0, 10) : undefined}
                    onChange={(e) => updatePhase(phase.id, { endDate: e.target.value })}
                  />
                </div>

                <div className="mt-4 space-y-1">
                  <label className="block text-sm font-medium text-ink/80">Description</label>
                  <textarea
                    value={phase.description ?? ""}
                    onChange={(e) => updatePhase(phase.id, { description: e.target.value })}
                    rows={3}
                    placeholder="Explain what happens during this phase and the expected outcomes."
                    className="w-full resize-none rounded-xl border border-ink/15 bg-white px-3.5 py-2.5 text-sm text-ink placeholder:text-ink/40 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-200"
                  />
                </div>

                <div className="mt-4 space-y-1">
                  <label className="block text-sm font-medium text-ink/80">Deliverables</label>
                  <textarea
                    value={(phase.deliverables ?? []).join("\n")}
                    onChange={(e) =>
                      updatePhase(phase.id, {
                        deliverables: e.target.value
                          .split("\n")
                          .map((item) => item.trim())
                          .filter(Boolean),
                      })
                    }
                    rows={4}
                    placeholder={"One deliverable per line\nExample: Kickoff plan\nExample: Creative brief"}
                    className="w-full resize-none rounded-xl border border-ink/15 bg-white px-3.5 py-2.5 text-sm text-ink placeholder:text-ink/40 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-200"
                  />
                </div>
              </div>
            ))}
          </CardBody>
        </Card>

        <Card>
          <CardHeader className="flex items-center justify-between">
            <div>
              <h2 className="font-semibold text-ink">ClickUp Tasks</h2>
              <p className="mt-1 text-xs text-ink/45">
                Pick a workspace and folder (usually named after the client), sync tasks, then assign them to phases.
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
              <div className="rounded-2xl border border-dashed border-ink/15 bg-ink/[0.02] p-6 text-sm text-ink/50">
                ClickUp isn&apos;t connected yet.{" "}
                <Link to="/admin/settings" className="text-brand-700 hover:text-brand-800">
                  Save a personal API token in Settings
                </Link>{" "}
                first.
              </div>
            ) : (
              <>
                <div className="grid gap-3 md:grid-cols-[1fr_1fr_auto]">
                  <div className="space-y-1">
                    <label className="block text-sm font-medium text-ink/80">Workspace</label>
                    <select
                      value={selectedWorkspaceId}
                      onChange={(e) => {
                        setSelectedWorkspaceId(e.target.value);
                        setSelectedFolderId("");
                        setClickupFolders([]);
                      }}
                      className="w-full rounded-xl border border-ink/15 bg-white px-3.5 py-2.5 text-sm text-ink focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-200"
                    >
                      <option value="">Select a workspace</option>
                      {clickupWorkspaces.map((workspace) => (
                        <option key={workspace.id} value={workspace.id}>
                          {workspace.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1">
                    <label className="block text-sm font-medium text-ink/80">Folder</label>
                    <select
                      value={selectedFolderId}
                      onChange={(e) => setSelectedFolderId(e.target.value)}
                      disabled={!selectedWorkspaceId}
                      className="w-full rounded-xl border border-ink/15 bg-white px-3.5 py-2.5 text-sm text-ink focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-200 disabled:opacity-50"
                    >
                      <option value="">Whole workspace</option>
                      {clickupFolders.map((folder) => (
                        <option key={folder.id} value={folder.id}>
                          {folder.name}
                        </option>
                      ))}
                    </select>
                  </div>
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

                {clickupMessage && (
                  <div className="rounded-xl border border-ink/10 bg-ink/[0.02] px-4 py-3 text-sm text-ink/60">
                    {clickupMessage}
                  </div>
                )}

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
                        <div key={task.id} className="grid gap-3 px-4 py-3 md:grid-cols-[1.1fr_0.9fr]">
                          <div className="min-w-0">
                            <p className="font-medium text-ink truncate">{task.name}</p>
                            <p className="text-xs text-ink/45">
                              {task.status || "Unknown status"}
                              {task.dueDate ? ` - Due ${task.dueDate}` : ""}
                              {task.listName ? ` - ${task.listName}` : ""}
                            </p>
                          </div>
                          <div className="flex items-center gap-2">
                            <select
                              value={clickup.taskAssignments?.[task.id] ?? ""}
                              onChange={(e) => setTaskAssignment(task.id, e.target.value)}
                              className="w-full rounded-xl border border-ink/15 bg-white px-3 py-2 text-sm text-ink focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-200"
                            >
                              <option value="">Unassigned</option>
                              {sortedPhases.map((phase) => (
                                <option key={phase.id} value={phase.id}>
                                  {phase.title}
                                </option>
                              ))}
                            </select>
                            {task.url && (
                              <a href={task.url} target="_blank" rel="noreferrer" className="text-ink/40 hover:text-ink">
                                <ExternalLink className="h-4 w-4" />
                              </a>
                            )}
                          </div>
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

        <div className="space-y-3">
          <div className="flex items-center justify-between px-1">
            <div>
              <p className="text-sm font-semibold text-ink">Live client preview</p>
              <p className="text-xs text-ink/45">This uses the exact client-side layout and updates as you edit.</p>
            </div>
            <Button variant="secondary" size="sm" onClick={() => setSelectedPhaseId(sortedPhases[0]?.id ?? null)}>
              Focus first phase
            </Button>
          </div>
          <TimelineViewer
            clientName={client.name}
            contractStartDate={toDateKey(client.contractStartDate.toDate())}
            contractEndDate={client.contractEndDate ? toDateKey(client.contractEndDate.toDate()) : undefined}
            phases={sortedPhases}
            selectedPhaseId={selectedPhase?.id ?? null}
            onSelectPhase={setSelectedPhaseId}
            phaseTasks={phaseTaskMap}
            emptyTitle="No phases yet."
            emptySubtitle="Create phases to build the engagement timeline."
          />
        </div>
      </div>
    </div>
  );
}
