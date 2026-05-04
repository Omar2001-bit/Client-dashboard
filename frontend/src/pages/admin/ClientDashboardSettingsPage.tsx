import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { collection, getDocs, doc, getDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { ArrowLeft, ChevronDown, ChevronUp, Plus, Trash2, Save, RotateCcw } from "lucide-react";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { useDashboardSettings } from "@/hooks/useDashboardSettings";
import { normalizeExperiments } from "@/pages/dashboard/dashboardData";
import type {
  ClientDoc,
  DashboardSettings,
  ExperimentMetricKey,
  ExperimentOverride,
  ExperimentSummary,
  ManualExperiment,
  ExperimentUplifts,
} from "@/types";

const METRICS: { key: ExperimentMetricKey; label: string }[] = [
  { key: "revenue", label: "Revenue" },
  { key: "rpv", label: "RPV" },
  { key: "purchases", label: "Purchases" },
  { key: "products", label: "Products" },
  { key: "cvr", label: "CVR" },
  { key: "aov", label: "AOV" },
];

const EMPTY_UPLIFTS: ExperimentUplifts = {
  revenue: { uplift: 0, upliftPercent: 0, original: 0, bestVariation: 0 },
  rpv: { uplift: 0, upliftPercent: 0, original: 0, bestVariation: 0 },
  purchases: { uplift: 0, upliftPercent: 0, original: 0, bestVariation: 0 },
  products: { uplift: 0, upliftPercent: 0, original: 0, bestVariation: 0 },
  cvr: { uplift: 0, upliftPercent: 0, original: 0, bestVariation: 0 },
  aov: { uplift: 0, upliftPercent: 0, original: 0, bestVariation: 0 },
};

function RoiPreview({ nodeCount }: { nodeCount: number | undefined }) {
  const preNodes = [0, 0.25, 0.5, 0.75, 1];
  const postCount = nodeCount ?? 2;
  const postNodes = Array.from({ length: postCount }, (_, i) => i + 2);
  const allNodes = [...preNodes, ...postNodes];
  const max = postNodes.length > 0 ? postNodes[postNodes.length - 1] : 1;
  const preZone = 30;
  const toPos = (m: number) =>
    m <= 1 ? (m / 1) * preZone : preZone + ((m - 1) / Math.max(max - 1, 1)) * (100 - preZone);

  const labels: Record<number, string> = { 0: "0%", 0.25: "25%", 0.5: "50%", 0.75: "75%", 1: "Breakeven" };

  return (
    <div className="relative h-16 mt-6 mx-4">
      <div className="absolute inset-x-0 top-6 h-2 rounded-full bg-ink/10" />
      <div className="absolute top-6 h-2 w-[30%] rounded-full bg-brand-400/60" />
      {allNodes.map((m) => (
        <div
          key={m}
          className="absolute flex flex-col items-center"
          style={{ left: `${toPos(m)}%`, transform: "translateX(-50%)" }}
        >
          <span className="text-[9px] text-ink/40 mb-1 whitespace-nowrap">
            {labels[m] ?? `${m}x`}
          </span>
          <div className="w-0.5 h-3 bg-ink/30 mt-5" />
        </div>
      ))}
    </div>
  );
}

export function ClientDashboardSettingsPage({ embedded = false }: { embedded?: boolean }) {
  const { clientId } = useParams<{ clientId: string }>();
  const { settings, settingsLoaded, saveSettings } = useDashboardSettings(clientId);

  const [client, setClient] = useState<ClientDoc | null>(null);
  const [experiments, setExperiments] = useState<ExperimentSummary[]>([]);
  const [experimentsLoading, setExperimentsLoading] = useState(true);
  const [local, setLocal] = useState<DashboardSettings>({});
  const [settingsReady, setSettingsReady] = useState(false);
  const [savedOverrides, setSavedOverrides] = useState<Record<string, ExperimentOverride>>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [search, setSearch] = useState("");
  const [showAddManual, setShowAddManual] = useState(false);
  const [newManual, setNewManual] = useState<Omit<ManualExperiment, "id">>({
    name: "", status: "completed", startDate: "", uplifts: EMPTY_UPLIFTS,
  });

  // Lightweight direct Firestore load — avoids the heavy useDashboardData pipeline
  useEffect(() => {
    if (!clientId) return;
    getDoc(doc(db, "clients", clientId)).then((snap) => {
      if (snap.exists()) setClient({ id: snap.id, ...snap.data() } as ClientDoc);
    });
    getDocs(collection(db, "clients", clientId, "experiments"))
      .then((snap) => {
        setExperiments(normalizeExperiments(snap.docs.map((d) => d.data())));
      })
      .finally(() => setExperimentsLoading(false));
  }, [clientId]);

  // Sync settings into local state once Firestore has responded (even if doc doesn't exist)
  useEffect(() => {
    if (settingsLoaded && !settingsReady) {
      setLocal(settings);
      setSavedOverrides(settings.experimentOverrides ?? {});
      setSettingsReady(true);
    }
  }, [settingsLoaded, settings, settingsReady]);

  const filtered = experiments.filter((e) =>
    e.name.toLowerCase().includes(search.toLowerCase())
  );

  const getOverride = (id: string): ExperimentOverride =>
    local.experimentOverrides?.[id] ?? {};

  const setOverride = (id: string, patch: Partial<ExperimentOverride>) => {
    setLocal((prev) => ({
      ...prev,
      experimentOverrides: {
        ...prev.experimentOverrides,
        [id]: { ...(prev.experimentOverrides?.[id] ?? {}), ...patch },
      },
    }));
  };

  const setMetricOverride = (
    expId: string,
    metric: ExperimentMetricKey,
    field: "uplift" | "upliftPercent",
    value: string
  ) => {
    const num = parseFloat(value);
    setLocal((prev) => {
      const prevOverride = prev.experimentOverrides?.[expId] ?? {};
      const prevMetricOverrides = prevOverride.metricOverrides ?? {};
      const prevMetric = { ...(prevMetricOverrides[metric] ?? {}) };

      if (isNaN(num)) {
        delete prevMetric[field];
      } else {
        prevMetric[field] = num;
      }

      const newMetricOverrides = { ...prevMetricOverrides };
      if (Object.keys(prevMetric).length === 0) {
        delete newMetricOverrides[metric];
      } else {
        newMetricOverrides[metric] = prevMetric;
      }

      return {
        ...prev,
        experimentOverrides: {
          ...prev.experimentOverrides,
          [expId]: {
            ...prevOverride,
            metricOverrides: Object.keys(newMetricOverrides).length === 0 ? undefined : newMetricOverrides,
          },
        },
      };
    });
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await saveSettings(local);
      setSavedOverrides(local.experimentOverrides ?? {});
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      console.error("Failed to save settings:", err);
      alert(`Save failed: ${String(err)}`);
    } finally {
      setSaving(false);
    }
  };

  const undoExperiment = (id: string) => {
    setLocal((prev) => ({
      ...prev,
      experimentOverrides: {
        ...prev.experimentOverrides,
        [id]: savedOverrides[id] ?? {},
      },
    }));
  };

  const hasExperimentChanges = (id: string): boolean =>
    JSON.stringify(getOverride(id)) !== JSON.stringify(savedOverrides[id] ?? {});

  const addManualExperiment = () => {
    if (!newManual.name || !newManual.startDate) return;
    const manual: ManualExperiment = { ...newManual, id: `manual_${Date.now()}` };
    setLocal((prev) => ({
      ...prev,
      manualExperiments: [...(prev.manualExperiments ?? []), manual],
    }));
    setNewManual({ name: "", status: "completed", startDate: "", uplifts: EMPTY_UPLIFTS });
    setShowAddManual(false);
  };

  const removeManual = (id: string) => {
    setLocal((prev) => ({
      ...prev,
      manualExperiments: (prev.manualExperiments ?? []).filter((m) => m.id !== id),
    }));
  };

  const setManualMetric = (
    id: string,
    metric: ExperimentMetricKey,
    field: "uplift" | "upliftPercent",
    value: string
  ) => {
    const num = parseFloat(value);
    setLocal((prev) => ({
      ...prev,
      manualExperiments: (prev.manualExperiments ?? []).map((m) =>
        m.id !== id ? m : {
          ...m,
          uplifts: {
            ...m.uplifts,
            [metric]: { ...m.uplifts[metric], [field]: isNaN(num) ? 0 : num },
          },
        }
      ),
    }));
  };

  return (
    <div className="p-8 max-w-4xl space-y-6">
      {/* Header — hidden when embedded inside the tab layout */}
      {!embedded && (
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link to={`/admin/clients/${clientId}`} className="text-ink/40 hover:text-ink">
              <ArrowLeft className="h-5 w-5" />
            </Link>
            <div>
              <h1 className="text-2xl font-bold text-ink">Dashboard Settings</h1>
              <p className="text-sm text-ink/50">{client?.name}</p>
            </div>
          </div>
          <Button onClick={handleSave} loading={saving} className="flex items-center gap-2">
            <Save className="h-4 w-4" />
            {saved ? "Saved!" : "Save Changes"}
          </Button>
        </div>
      )}

      {/* ROI Card Settings */}
      <Card>
        <CardHeader><h2 className="font-semibold text-ink">ROI Card — Node Count</h2></CardHeader>
        <CardBody className="space-y-4">
          <p className="text-sm text-ink/50">
            Control how many milestone nodes appear on the ROI progress bar. Auto adjusts based on the client's ROI.
          </p>
          <div className="flex flex-wrap gap-2">
            {[undefined, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => (
              <button
                key={n ?? "auto"}
                onClick={() => setLocal((p) => ({ ...p, roiNodeCount: n }))}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${
                  local.roiNodeCount === n
                    ? "bg-ink text-white border-ink"
                    : "border-ink/10 text-ink/60 hover:bg-ink/5"
                }`}
              >
                {n === undefined ? "Auto" : n}
              </button>
            ))}
          </div>
          <RoiPreview nodeCount={local.roiNodeCount} />
        </CardBody>
      </Card>

      {/* Experiment Overrides */}
      <Card>
        <CardHeader className="flex items-center justify-between">
          <h2 className="font-semibold text-ink">Experiment Settings</h2>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search experiments…"
            className="rounded-lg border border-ink/10 px-3 py-1.5 text-sm focus:outline-none focus:border-brand-300 w-56"
          />
        </CardHeader>
        <CardBody className="p-0 divide-y divide-ink/5">
          {experimentsLoading && (
            <div className="p-6 space-y-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="h-8 animate-pulse rounded-lg bg-ink/5" />
              ))}
            </div>
          )}
          {!experimentsLoading && filtered.length === 0 && (
            <p className="p-6 text-sm text-ink/40">No experiments found.</p>
          )}
          {filtered.map((exp) => {
            const override = getOverride(exp.id);
            const isOpen = expanded[exp.id];
            return (
              <div key={exp.id}>
                {/* Row header */}
                <div className="flex items-center gap-3 px-6 py-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-ink truncate">
                      {override.displayName || exp.name}
                    </p>
                    {override.displayName && (
                      <p className="text-xs text-ink/40 truncate">Original: {exp.name}</p>
                    )}
                  </div>
                  <label className="flex items-center gap-1.5 text-xs text-ink/50 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={override.isExcluded ?? false}
                      onChange={(e) => setOverride(exp.id, { isExcluded: e.target.checked })}
                      className="accent-red-500"
                    />
                    Exclude from KPIs
                  </label>
                  {hasExperimentChanges(exp.id) && (
                    <button
                      onClick={() => undoExperiment(exp.id)}
                      title="Undo unsaved changes to this experiment"
                      className="text-amber-500 hover:text-amber-700 transition-colors"
                    >
                      <RotateCcw className="h-3.5 w-3.5" />
                    </button>
                  )}
                  <button
                    onClick={() => setExpanded((p) => ({ ...p, [exp.id]: !p[exp.id] }))}
                    className="text-ink/30 hover:text-ink transition-colors"
                  >
                    {isOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                  </button>
                </div>

                {/* Expanded controls */}
                {isOpen && (
                  <div className="px-6 pb-5 space-y-4 bg-ink/[0.02]">
                    <div className="grid grid-cols-2 gap-4">
                      <Input
                        label="Display name (client-facing)"
                        value={override.displayName ?? ""}
                        onChange={(e) => setOverride(exp.id, { displayName: e.target.value || undefined })}
                        placeholder={exp.name}
                      />
                      <div className="space-y-1">
                        <label className="block text-sm font-medium text-gray-700">Original variant</label>
                        <select
                          value={override.originalVariantId ?? ""}
                          onChange={(e) => setOverride(exp.id, { originalVariantId: e.target.value || undefined })}
                          className="border border-gray-300 rounded-lg px-3 py-2 text-sm w-full focus:outline-none focus:ring-2 focus:ring-brand-200"
                        >
                          <option value="">Auto (from sync data)</option>
                          {(exp.variants ?? []).map((v) => (
                            <option key={v.id} value={v.id}>
                              {v.name} {v.isOriginal ? "(current original)" : ""}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>

                    <div className="space-y-1">
                      <label className="block text-sm font-medium text-gray-700">
                        Notes for client
                      </label>
                      <textarea
                        value={override.notes ?? ""}
                        onChange={(e) => setOverride(exp.id, { notes: e.target.value || undefined })}
                        placeholder="e.g. This test ran during a sale period — results may not reflect steady state."
                        rows={2}
                        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-brand-200"
                      />
                    </div>

                    <div className="space-y-2">
                      <p className="text-sm font-medium text-gray-700">Metric overrides</p>
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="text-xs text-ink/40">
                              <th className="text-left py-1 font-medium w-24">Metric</th>
                              <th className="text-left py-1 font-medium">Current uplift</th>
                              <th className="text-left py-1 font-medium">Override uplift</th>
                              <th className="text-left py-1 font-medium">Override uplift %</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-ink/5">
                            {METRICS.map(({ key, label }) => {
                              const current = exp.uplifts?.[key];
                              const mo = override.metricOverrides?.[key];
                              return (
                                <tr key={key}>
                                  <td className="py-1.5 font-medium text-ink/70">{label}</td>
                                  <td className="py-1.5 text-ink/40 pr-4">
                                    {current ? `${current.uplift >= 0 ? "+" : ""}${current.uplift.toFixed(2)}` : "—"}
                                  </td>
                                  <td className="py-1.5 pr-2">
                                    <input
                                      type="number"
                                      step="0.01"
                                      value={mo?.uplift ?? ""}
                                      onChange={(e) => setMetricOverride(exp.id, key, "uplift", e.target.value)}
                                      placeholder="—"
                                      className="w-28 rounded-lg border border-ink/10 px-2 py-1 text-sm focus:outline-none focus:border-brand-300"
                                    />
                                  </td>
                                  <td className="py-1.5">
                                    <input
                                      type="number"
                                      step="0.01"
                                      value={mo?.upliftPercent ?? ""}
                                      onChange={(e) => setMetricOverride(exp.id, key, "upliftPercent", e.target.value)}
                                      placeholder="—"
                                      className="w-28 rounded-lg border border-ink/10 px-2 py-1 text-sm focus:outline-none focus:border-brand-300"
                                    />
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </CardBody>
      </Card>

      {/* Manual Experiments */}
      <Card>
        <CardHeader className="flex items-center justify-between">
          <h2 className="font-semibold text-ink">Manual Experiments</h2>
          <Button variant="secondary" size="sm" onClick={() => setShowAddManual(true)} className="flex items-center gap-1.5">
            <Plus className="h-4 w-4" /> Add experiment
          </Button>
        </CardHeader>
        <CardBody className="space-y-4">
          {(local.manualExperiments ?? []).length === 0 && !showAddManual && (
            <p className="text-sm text-ink/40">No manual experiments added yet.</p>
          )}

          {(local.manualExperiments ?? []).map((m) => (
            <div key={m.id} className="rounded-xl border border-ink/10 p-4 space-y-3">
              <div className="flex items-center justify-between">
                <p className="font-medium text-ink text-sm">{m.name}</p>
                <button onClick={() => removeManual(m.id)} className="text-red-400 hover:text-red-600">
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1">
                  <label className="text-xs font-medium text-gray-600">Name</label>
                  <input
                    value={m.name}
                    onChange={(e) => setLocal((prev) => ({
                      ...prev,
                      manualExperiments: (prev.manualExperiments ?? []).map((x) =>
                        x.id !== m.id ? x : { ...x, name: e.target.value }
                      ),
                    }))}
                    className="w-full rounded-lg border border-ink/10 px-2 py-1.5 text-sm focus:outline-none"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-gray-600">Start date</label>
                  <input
                    type="date"
                    value={m.startDate}
                    onChange={(e) => setLocal((prev) => ({
                      ...prev,
                      manualExperiments: (prev.manualExperiments ?? []).map((x) =>
                        x.id !== m.id ? x : { ...x, startDate: e.target.value }
                      ),
                    }))}
                    className="w-full rounded-lg border border-ink/10 px-2 py-1.5 text-sm focus:outline-none"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-gray-600">Status</label>
                  <select
                    value={m.status}
                    onChange={(e) => setLocal((prev) => ({
                      ...prev,
                      manualExperiments: (prev.manualExperiments ?? []).map((x) =>
                        x.id !== m.id ? x : { ...x, status: e.target.value as ManualExperiment["status"] }
                      ),
                    }))}
                    className="w-full rounded-lg border border-ink/10 px-2 py-1.5 text-sm focus:outline-none"
                  >
                    {["running", "completed", "paused", "draft", "archived"].map((s) => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-gray-600">Notes</label>
                <input
                  value={m.notes ?? ""}
                  onChange={(e) => setLocal((prev) => ({
                    ...prev,
                    manualExperiments: (prev.manualExperiments ?? []).map((x) =>
                      x.id !== m.id ? x : { ...x, notes: e.target.value || undefined }
                    ),
                  }))}
                  placeholder="Optional notes…"
                  className="w-full rounded-lg border border-ink/10 px-2 py-1.5 text-sm focus:outline-none"
                />
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-xs text-ink/40">
                      <th className="text-left py-1 font-medium w-24">Metric</th>
                      <th className="text-left py-1 font-medium">Uplift</th>
                      <th className="text-left py-1 font-medium">Uplift %</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-ink/5">
                    {METRICS.map(({ key, label }) => (
                      <tr key={key}>
                        <td className="py-1 font-medium text-ink/70">{label}</td>
                        <td className="py-1 pr-2">
                          <input
                            type="number"
                            step="0.01"
                            value={m.uplifts[key]?.uplift ?? ""}
                            onChange={(e) => setManualMetric(m.id, key, "uplift", e.target.value)}
                            className="w-28 rounded-lg border border-ink/10 px-2 py-1 text-sm focus:outline-none"
                          />
                        </td>
                        <td className="py-1">
                          <input
                            type="number"
                            step="0.01"
                            value={m.uplifts[key]?.upliftPercent ?? ""}
                            onChange={(e) => setManualMetric(m.id, key, "upliftPercent", e.target.value)}
                            className="w-28 rounded-lg border border-ink/10 px-2 py-1 text-sm focus:outline-none"
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}

          {showAddManual && (
            <div className="rounded-xl border border-brand-300 bg-brand-50/30 p-4 space-y-3">
              <p className="font-medium text-ink text-sm">New manual experiment</p>
              <div className="grid grid-cols-3 gap-3">
                <Input
                  label="Name"
                  value={newManual.name}
                  onChange={(e) => setNewManual((p) => ({ ...p, name: e.target.value }))}
                  placeholder="Experiment name"
                />
                <Input
                  label="Start date"
                  type="date"
                  value={newManual.startDate}
                  onChange={(e) => setNewManual((p) => ({ ...p, startDate: e.target.value }))}
                />
                <div className="space-y-1">
                  <label className="block text-sm font-medium text-gray-700">Status</label>
                  <select
                    value={newManual.status}
                    onChange={(e) => setNewManual((p) => ({ ...p, status: e.target.value as ManualExperiment["status"] }))}
                    className="border border-gray-300 rounded-lg px-3 py-2 text-sm w-full"
                  >
                    {["running", "completed", "paused", "draft", "archived"].map((s) => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-xs text-ink/40">
                      <th className="text-left py-1 font-medium w-24">Metric</th>
                      <th className="text-left py-1 font-medium">Uplift</th>
                      <th className="text-left py-1 font-medium">Uplift %</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-ink/5">
                    {METRICS.map(({ key, label }) => (
                      <tr key={key}>
                        <td className="py-1 font-medium text-ink/70">{label}</td>
                        <td className="py-1 pr-2">
                          <input
                            type="number"
                            step="0.01"
                            value={newManual.uplifts[key]?.uplift ?? 0}
                            onChange={(e) => setNewManual((p) => ({
                              ...p,
                              uplifts: {
                                ...p.uplifts,
                                [key]: { ...p.uplifts[key], uplift: parseFloat(e.target.value) || 0 },
                              },
                            }))}
                            className="w-28 rounded-lg border border-ink/10 px-2 py-1 text-sm focus:outline-none"
                          />
                        </td>
                        <td className="py-1">
                          <input
                            type="number"
                            step="0.01"
                            value={newManual.uplifts[key]?.upliftPercent ?? 0}
                            onChange={(e) => setNewManual((p) => ({
                              ...p,
                              uplifts: {
                                ...p.uplifts,
                                [key]: { ...p.uplifts[key], upliftPercent: parseFloat(e.target.value) || 0 },
                              },
                            }))}
                            className="w-28 rounded-lg border border-ink/10 px-2 py-1 text-sm focus:outline-none"
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex gap-2">
                <Button size="sm" onClick={addManualExperiment} disabled={!newManual.name || !newManual.startDate}>
                  Add
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setShowAddManual(false)}>Cancel</Button>
              </div>
            </div>
          )}
        </CardBody>
      </Card>

      <div className="flex justify-end">
        <Button onClick={handleSave} loading={saving} className="flex items-center gap-2">
          <Save className="h-4 w-4" />
          {saved ? "Saved!" : "Save Changes"}
        </Button>
      </div>
    </div>
  );
}
