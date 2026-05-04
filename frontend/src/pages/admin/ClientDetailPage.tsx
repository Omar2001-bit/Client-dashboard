import { useEffect, useState } from "react";
import { useParams, Link, useSearchParams } from "react-router-dom";
import { doc, getDoc, getDocs, updateDoc, collection, query, where, Timestamp } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "@/lib/firebase";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Card, CardHeader, CardBody } from "@/components/ui/Card";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { ArrowLeft, Eye, EyeOff, RefreshCw, Copy, Shuffle, Settings2, CalendarDays, User } from "lucide-react";
import { syncFromConvert, pullNewFromConvert, type SyncProgress } from "@/lib/convertSync";
import { useQueryClient } from "@tanstack/react-query";
import type { ClientDoc, GA4Property } from "@/types";
import { useAuthStore } from "@/store/authStore";
import { ClientDashboardSettingsPage } from "@/pages/admin/ClientDashboardSettingsPage";
import { ClientTimelineEditorPage } from "@/pages/admin/ClientTimelineEditorPage";

const API_BASE = import.meta.env.VITE_API_URL ?? "http://localhost:3001";

export function ClientDetailPage() {
  const { clientId } = useParams<{ clientId: string }>();
  const currentRole = useAuthStore((s) => s.role);
  const [client, setClient] = useState<ClientDoc | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [newConvertKeyId, setNewConvertKeyId] = useState("");
  const [newConvertKeySecret, setNewConvertKeySecret] = useState("");
  const [ga4Properties, setGa4Properties] = useState<GA4Property[]>([]);
  const [ga4Loading, setGa4Loading] = useState(false);
  const [message, setMessage] = useState("");
  const [syncing, setSyncing] = useState(false);
  const [syncProgress, setSyncProgress] = useState<SyncProgress | null>(null);
  const [pulling, setPulling] = useState(false);
  const [pullProgress, setPullProgress] = useState<SyncProgress | null>(null);
  const [searchParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState<"overview" | "convert" | "settings" | "timeline">("overview");

  // Allow the tutorial to switch tabs via ?tab= query param
  useEffect(() => {
    const tab = searchParams.get("tab");
    if (tab && ["overview", "convert", "settings", "timeline"].includes(tab)) {
      setActiveTab(tab as "overview" | "convert" | "settings" | "timeline");
    }
  }, [searchParams]);
  const [newPassword, setNewPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [passwordResetting, setPasswordResetting] = useState(false);
  const [passwordMessage, setPasswordMessage] = useState<{ text: string; type: "success" | "error" } | null>(null);
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!clientId) return;
    getDoc(doc(db, "clients", clientId)).then((snap) => {
      if (snap.exists()) setClient({ id: snap.id, ...snap.data() } as ClientDoc);
      setLoading(false);
    });
    setGa4Loading(true);
    fetch(`${API_BASE}/api/ga4/properties`)
      .then((r) => r.json())
      .then((d) => setGa4Properties(d.properties ?? []))
      .catch(() => setGa4Properties([]))
      .finally(() => setGa4Loading(false));
  }, [clientId]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!client) return;
    if (client.contractEndDate && client.contractEndDate.toMillis() < client.contractStartDate.toMillis()) {
      setMessage("Engagement end date must be after the start date.");
      return;
    }
    setSaving(true);
    try {
      await updateDoc(doc(db, "clients", clientId!), {
        name: client.name,
        contactName: client.contactName,
        contactEmail: client.contactEmail,
        contractStartDate: client.contractStartDate,
        ...(client.contractEndDate ? { contractEndDate: client.contractEndDate } : {}),
        ...(currentRole === "executiveAdmin"
          ? {
              agencyFee: client.agencyFee,
              servicePrice: client.servicePrice ?? client.agencyFee,
            }
          : {}),
        currency: client.currency,
        status: client.status,
        ...(client.ga4PropertyId !== undefined ? { ga4PropertyId: client.ga4PropertyId } : {}),
        updatedAt: Timestamp.now(),
      });
      setMessage("Changes saved.");
    } catch {
      setMessage("Failed to save.");
    } finally {
      setSaving(false);
    }
  };

  const handleSync = async () => {
    if (!clientId || syncing) return;
    setSyncing(true);
    setMessage("");
    setSyncProgress({ phase: "listing", fetched: 0, total: 0 });
    try {
      const result = await syncFromConvert(clientId, setSyncProgress);
      setMessage(`Sync complete — ${result.experimentCount} experiments saved to Firestore.`);
      // Invalidate cached dashboard data so it reloads from Firestore
      queryClient.invalidateQueries({ queryKey: ["dashboardData", clientId] });
    } catch (err) {
      setMessage(`Sync failed: ${(err as Error).message}`);
      setSyncProgress({ phase: "error", fetched: 0, total: 0, message: (err as Error).message });
    } finally {
      setSyncing(false);
    }
  };

  const handlePull = async () => {
    if (!clientId || pulling) return;
    setPulling(true);
    setMessage("");
    setPullProgress({ phase: "listing", fetched: 0, total: 0 });
    try {
      const result = await pullNewFromConvert(clientId, setPullProgress);
      setMessage(`Pull complete — ${result.newCount} new, ${result.updatedCount} updated.`);
      queryClient.invalidateQueries({ queryKey: ["dashboardData", clientId] });
    } catch (err) {
      setMessage(`Pull failed: ${(err as Error).message}`);
      setPullProgress({ phase: "error", fetched: 0, total: 0, message: (err as Error).message });
    } finally {
      setPulling(false);
    }
  };

  const handleRotateCredentials = async () => {
    if (!newConvertKeyId && !newConvertKeySecret) return;
    setSaving(true);
    try {
      const rotate = httpsCallable(functions, "rotateClientCredentials");
      await rotate({
        clientId,
        ...(newConvertKeyId ? { convertKeyId: newConvertKeyId } : {}),
        ...(newConvertKeySecret ? { convertKeySecret: newConvertKeySecret } : {}),
      });
      setNewConvertKeyId("");
      setNewConvertKeySecret("");
      setMessage("Credentials rotated.");
    } catch {
      setMessage("Failed to rotate credentials.");
    } finally {
      setSaving(false);
    }
  };

  const generatePassword = () => {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$%";
    const password = Array.from(crypto.getRandomValues(new Uint8Array(12)))
      .map((b) => chars[b % chars.length])
      .join("");
    setNewPassword(password);
    setShowPassword(true);
  };

  const handleSendResetEmail = async () => {
    if (!clientId) return;
    setPasswordResetting(true);
    setPasswordMessage(null);
    try {
      const usersSnap = await getDocs(query(collection(db, "users"), where("clientId", "==", clientId)));
      if (usersSnap.empty) throw new Error("No user account found for this client.");
      const userEmail = usersSnap.docs[0].data().email as string;

      const res = await fetch(`${import.meta.env.VITE_API_URL ?? "http://localhost:3001"}/api/send-password-reset`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: userEmail, clientName: client?.contactName }),
      });
      if (!res.ok) {
        const detail = await res.json().catch(() => ({}));
        throw new Error(detail.error ?? "Server error");
      }
      setPasswordMessage({ text: `Password reset email sent to ${userEmail}.`, type: "success" });
    } catch (err) {
      setPasswordMessage({ text: `Failed: ${(err as Error).message}`, type: "error" });
    } finally {
      setPasswordResetting(false);
    }
  };

  const handleSetPassword = async () => {
    if (!newPassword || newPassword.length < 6 || !clientId) return;
    setPasswordResetting(true);
    setPasswordMessage(null);
    try {
      const reset = httpsCallable(functions, "resetClientPassword");
      await reset({ clientId, newPassword });
      setPasswordMessage({ text: "Password updated successfully. Share it with the client.", type: "success" });
    } catch (err) {
      setPasswordMessage({ text: `Failed: ${(err as Error).message}`, type: "error" });
    } finally {
      setPasswordResetting(false);
    }
  };

  if (loading) return <div className="p-8 text-gray-400">Loading...</div>;
  if (!client) return <div className="p-8 text-gray-400">Client not found.</div>;

  const TABS = [
    { key: "overview" as const,  label: "Overview",             icon: User },
    { key: "convert" as const,   label: "Convert Data Pulls",   icon: RefreshCw },
    { key: "settings" as const,  label: "Dashboard Settings",   icon: Settings2 },
    { key: "timeline" as const,  label: "Timeline Builder",     icon: CalendarDays },
  ];

  const SyncProgressBlock = ({ progress, label }: { progress: SyncProgress | null; label: string }) => {
    if (!progress) return null;
    return (
      <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 text-sm text-blue-800">
        <p className="font-medium">
          {progress.phase === "listing" && (progress.message ?? `${label} — listing experiments… found ${progress.fetched}`)}
          {progress.phase === "reports" && `${label} — fetching reports ${progress.fetched} / ${progress.total}`}
          {progress.phase === "writing" && `${label} — writing to Firestore ${progress.fetched} / ${progress.total}`}
          {progress.phase === "done" && (progress.message ?? `${label} — done, ${progress.total} experiments.`)}
          {progress.phase === "error" && `${label} — error: ${progress.message}`}
        </p>
        {progress.total > 0 && progress.phase === "reports" && (
          <>
            <div className="mt-2 h-2 w-full rounded-full bg-blue-100">
              <div className="h-2 rounded-full bg-blue-500 transition-all" style={{ width: `${Math.round((progress.fetched / progress.total) * 100)}%` }} />
            </div>
            <p className="mt-2 text-xs text-blue-600">
              ~{Math.max(0, Math.ceil((progress.total - progress.fetched) * 16 / 60))} min remaining.
            </p>
          </>
        )}
      </div>
    );
  };

  return (
    <div className="flex flex-col min-h-screen">
      {/* Header */}
      <div className="border-b border-ink/10 bg-white px-8 py-5 shrink-0">
        <div className="flex items-center gap-3">
          <Link to="/admin/clients" className="text-gray-400 hover:text-gray-600">
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{client.name}</h1>
            <StatusBadge status={client.status} />
          </div>
        </div>
      </div>

      {/* Tab navigation */}
      <div className="border-b border-ink/10 bg-white px-6 flex shrink-0" data-tutorial="admin-client-tabs">
        {TABS.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setActiveTab(key)}
            className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 -mb-px transition-colors whitespace-nowrap ${
              activeTab === key
                ? "border-brand-500 text-ink"
                : "border-transparent text-ink/50 hover:text-ink hover:border-ink/20"
            }`}
          >
            <Icon className="h-4 w-4" />
            {label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="flex-1">

        {/* ── Overview ─────────────────────────────────────────────────────── */}
        {activeTab === "overview" && (
          <div className="p-8 max-w-3xl space-y-6" data-tutorial="admin-client-overview">
            {message && (
              <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800">{message}</div>
            )}
            <form onSubmit={handleSave} className="space-y-6">
              <Card>
                <CardHeader><h2 className="font-semibold text-gray-800">Client Details</h2></CardHeader>
                <CardBody className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <Input label="Company Name" value={client.name} onChange={(e) => setClient((p) => p ? { ...p, name: e.target.value } : p)} required />
                    <Input label="Contact Name" value={client.contactName} onChange={(e) => setClient((p) => p ? { ...p, contactName: e.target.value } : p)} required />
                  </div>
                  <Input label="Contact Email" type="email" value={client.contactEmail} onChange={(e) => setClient((p) => p ? { ...p, contactEmail: e.target.value } : p)} required />
                  <div className="grid grid-cols-2 gap-4">
                    <Input label="Engagement Start Date" type="date" value={toDateInputValue(client.contractStartDate)} onChange={(e) => setClient((p) => p ? { ...p, contractStartDate: Timestamp.fromDate(new Date(e.target.value)) } : p)} required />
                    <Input label="Engagement End Date" type="date" value={toDateInputValue(client.contractEndDate)} onChange={(e) => setClient((p) => p ? { ...p, contractEndDate: Timestamp.fromDate(new Date(e.target.value)) } : p)} required />
                  </div>
                  <div className="grid grid-cols-2 gap-4" data-tutorial="admin-client-price">
                    {currentRole === "executiveAdmin" ? (
                      <Input label="Client Paid Amount (USD)" type="number" value={client.servicePrice ?? client.agencyFee} onChange={(e) => setClient((p) => p ? { ...p, agencyFee: parseFloat(e.target.value), servicePrice: parseFloat(e.target.value) } : p)} hint="Stored in USD for ROI and reporting calculations." />
                    ) : (
                      <div className="rounded-lg border border-dashed border-gray-200 px-4 py-3 text-sm text-gray-500">Payment amount is restricted to executive admins.</div>
                    )}
                    <Input label="Report Currency" value={client.currency} onChange={(e) => setClient((p) => p ? { ...p, currency: e.target.value } : p)} />
                  </div>
                  <div className="space-y-1">
                    <label className="block text-sm font-medium text-gray-700">Status</label>
                    <select value={client.status} onChange={(e) => setClient((p) => p ? { ...p, status: e.target.value as "active" | "inactive" } : p)} className="border border-gray-300 rounded-lg px-3 py-2 text-sm w-full focus:outline-none focus:ring-2 focus:ring-brand-200">
                      <option value="active">Active</option>
                      <option value="inactive">Inactive</option>
                    </select>
                  </div>
                </CardBody>
              </Card>
              <div className="flex gap-3">
                <Button type="submit" loading={saving}>Save Changes</Button>
              </div>
            </form>

            <Card>
              <CardHeader><h2 className="font-semibold text-gray-800">GA4 Property</h2></CardHeader>
              <CardBody className="space-y-3">
                {ga4Loading ? (
                  <div className="h-9 animate-pulse rounded-lg bg-gray-100" />
                ) : ga4Properties.length === 0 ? (
                  <p className="text-sm text-gray-400">No GA4 properties found — server may be offline.</p>
                ) : (
                  <select
                    value={client.ga4PropertyId ?? ""}
                    onChange={(e) => setClient((p) => p ? { ...p, ga4PropertyId: e.target.value || undefined } : p)}
                    className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-brand-200"
                  >
                    <option value="">— None (disable GA4 view) —</option>
                    {ga4Properties.map((p) => (
                      <option key={p.propertyId} value={p.propertyId}>
                        {p.displayName} ({p.accountDisplayName} · {p.propertyId})
                      </option>
                    ))}
                  </select>
                )}
                <p className="text-xs text-gray-400">Select the GA4 property to link with this client's GA4 Data View. Save changes above to apply.</p>
              </CardBody>
            </Card>

            <Card>
              <CardHeader><h2 className="font-semibold text-gray-800">Rotate Convert Credentials</h2></CardHeader>
              <CardBody className="space-y-4">
                <Input label="New Convert Key ID (leave blank to keep current)" type="password" value={newConvertKeyId} onChange={(e) => setNewConvertKeyId(e.target.value)} />
                <Input label="New Convert Key Secret (leave blank to keep current)" type="password" value={newConvertKeySecret} onChange={(e) => setNewConvertKeySecret(e.target.value)} />
                <Button variant="danger" size="sm" onClick={handleRotateCredentials} loading={saving}>Rotate Convert Key</Button>
              </CardBody>
            </Card>

            <Card>
              <CardHeader><h2 className="font-semibold text-gray-800">Password Management</h2></CardHeader>
              <CardBody className="space-y-5">
                <div className="space-y-2">
                  <p className="text-sm font-medium text-gray-700">Send password reset email</p>
                  <p className="text-xs text-gray-500">Sends a reset link to the client's login email.</p>
                  <Button variant="secondary" size="sm" onClick={handleSendResetEmail} loading={passwordResetting}>Send reset email</Button>
                </div>
                <div className="border-t border-gray-100" />
                <div className="space-y-2">
                  <p className="text-sm font-medium text-gray-700">Set a new password directly</p>
                  <p className="text-xs text-gray-500">Generate or type a password, then share it with the client.</p>
                  <div className="flex items-center gap-2">
                    <div className="relative flex-1">
                      <input type={showPassword ? "text" : "password"} value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder="Enter or generate a new password…" className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm pr-10 focus:outline-none focus:ring-2 focus:ring-brand-200" />
                      <button type="button" onClick={() => setShowPassword((v) => !v)} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                        {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                    <Button variant="secondary" size="sm" onClick={generatePassword} title="Generate random password"><Shuffle className="h-4 w-4" /></Button>
                    {newPassword && <Button variant="secondary" size="sm" onClick={() => navigator.clipboard.writeText(newPassword)} title="Copy password"><Copy className="h-4 w-4" /></Button>}
                  </div>
                  <Button variant="danger" size="sm" onClick={handleSetPassword} disabled={newPassword.length < 6} loading={passwordResetting}>Set password</Button>
                </div>
                {passwordMessage && (
                  <p className={`text-sm rounded-lg px-4 py-2 ${passwordMessage.type === "success" ? "text-green-700 bg-green-50" : "text-red-700 bg-red-50"}`}>{passwordMessage.text}</p>
                )}
              </CardBody>
            </Card>
          </div>
        )}

        {/* ── Convert Data Pulls ───────────────────────────────────────────── */}
        {activeTab === "convert" && (
          <div className="p-8 max-w-3xl space-y-6" data-tutorial="admin-client-convert">
            <div>
              <h2 className="text-lg font-bold text-ink">Convert Data Pulls</h2>
              <p className="text-sm text-ink/50 mt-1">Pull experiment data from Convert.com into Firestore.</p>
            </div>

            {message && (
              <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800">{message}</div>
            )}

            <div className="grid gap-4 sm:grid-cols-2">
              <Card>
                <CardHeader>
                  <h3 className="font-semibold text-ink">Pull New from Convert</h3>
                  <p className="text-xs text-ink/50 mt-1">Incremental — only fetches new, running, and status-changed experiments. Faster and non-destructive.</p>
                </CardHeader>
                <CardBody>
                  <Button variant="secondary" onClick={handlePull} loading={pulling} className="flex items-center gap-2 w-full justify-center">
                    <RefreshCw className="h-4 w-4" /> {pulling ? "Pulling…" : "Pull New from Convert"}
                  </Button>
                  <SyncProgressBlock progress={pulling ? pullProgress : null} label="Incremental pull" />
                </CardBody>
              </Card>

              <Card>
                <CardHeader>
                  <h3 className="font-semibold text-ink">Full Refresh from Convert</h3>
                  <p className="text-xs text-ink/50 mt-1">Full overwrite — fetches all experiments and replaces Firestore data. Use when data is stale or corrupted.</p>
                </CardHeader>
                <CardBody>
                  <Button variant="primary" onClick={handleSync} loading={syncing} className="flex items-center gap-2 w-full justify-center">
                    <RefreshCw className="h-4 w-4" /> {syncing ? "Syncing…" : "Full Refresh from Convert"}
                  </Button>
                  <SyncProgressBlock progress={syncing ? syncProgress : null} label="Full sync" />
                </CardBody>
              </Card>
            </div>
          </div>
        )}

        {/* ── Dashboard Settings ───────────────────────────────────────────── */}
        {activeTab === "settings" && (
          <div data-tutorial="admin-client-settings">
            <div className="flex items-center justify-between px-8 pt-6 pb-2">
              <div />
              <Link to={`/admin/clients/${clientId}/preview`} target="_blank" rel="noopener noreferrer">
                <Button variant="secondary" size="sm" className="flex items-center gap-1.5">
                  <Eye className="h-4 w-4" /> Preview as Client
                </Button>
              </Link>
            </div>
            <ClientDashboardSettingsPage embedded />
          </div>
        )}

        {/* ── Timeline Builder ─────────────────────────────────────────────── */}
        {activeTab === "timeline" && (
          <div data-tutorial="admin-client-timeline">
            <ClientTimelineEditorPage embedded />
          </div>
        )}

      </div>
    </div>
  );

}

function toDateInputValue(timestamp?: Timestamp): string {
  if (!timestamp?.toDate) return "";
  const date = timestamp.toDate();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
