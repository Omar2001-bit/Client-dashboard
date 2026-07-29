import { useEffect, useState } from "react";
import { useParams, Link, useSearchParams } from "react-router-dom";
import { doc, getDoc, getDocs, updateDoc, collection, query, where, Timestamp } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Alert } from "@/components/ui/Alert";
import { Card, CardHeader, CardBody } from "@/components/ui/Card";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { Tabs } from "@/components/ui/Tabs";
import { ArrowLeft, Eye, EyeOff, RefreshCw, Copy, Shuffle, Settings2, CalendarDays, User, ListChecks, LineChart } from "lucide-react";
import { syncFromConvert, pullNewFromConvert } from "@/lib/convertSync";
import { useQueryClient } from "@tanstack/react-query";
import type { ClientDoc, GA4Property } from "@/types";
import { useAuthStore } from "@/store/authStore";
import { ClientDashboardSettingsPage } from "@/pages/admin/ClientDashboardSettingsPage";
import { ClientTimelineEditorPage } from "@/pages/admin/ClientTimelineEditorPage";
import { AdminAuditFindingsPage } from "@/pages/admin/AdminAuditFindingsPage";
import { AdminAnalyticsReportsPage } from "@/pages/admin/AdminAnalyticsReportsPage";
import { API_BASE, fetchWithAuth, readJsonOrThrow } from "@/lib/apiClient";
import { SyncProgressBlock } from "@/components/clients/SyncProgressBlock";
import { useConvertSyncState } from "@/store/convertSyncStore";

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
  const [message, setMessage] = useState<{ text: string; type: "success" | "warning" | "error" } | null>(null);
  const { syncing, syncProgress, pulling, pullProgress, setSyncState, setPullState } = useConvertSyncState(clientId);
  const [searchParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState<"overview" | "convert" | "settings" | "timeline" | "audit" | "reports">("overview");

  // Allow the tutorial to switch tabs via ?tab= query param
  useEffect(() => {
    const tab = searchParams.get("tab");
    if (tab && ["overview", "convert", "settings", "timeline", "audit", "reports"].includes(tab)) {
      setActiveTab(tab as "overview" | "convert" | "settings" | "timeline" | "audit" | "reports");
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
    fetchWithAuth("/api/ga4/properties")
      .then((r) => r.json())
      .then((d) => setGa4Properties(d.properties ?? []))
      .catch(() => setGa4Properties([]))
      .finally(() => setGa4Loading(false));
  }, [clientId]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!client) return;
    if (client.contractEndDate && client.contractEndDate.toMillis() < client.contractStartDate.toMillis()) {
      setMessage({ text: "Engagement end date must be after the start date.", type: "error" });
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
      setMessage({ text: "Changes saved.", type: "success" });
    } catch {
      setMessage({ text: "Failed to save.", type: "error" });
    } finally {
      setSaving(false);
    }
  };

  const handleSync = async () => {
    if (!clientId || syncing) return;
    setSyncState({ syncing: true, syncProgress: { phase: "listing", fetched: 0, total: 0 } });
    setMessage(null);
    try {
      const result = await syncFromConvert(clientId, (p) => setSyncState({ syncProgress: p }));
      setMessage(
        result.failedCount > 0
          ? { text: `Sync complete — ${result.experimentCount} experiments saved, ${result.failedCount} had incomplete report data.`, type: "warning" }
          : { text: `Sync complete — ${result.experimentCount} experiments saved to Firestore.`, type: "success" }
      );
      // Invalidate cached dashboard data so it reloads from Firestore
      queryClient.invalidateQueries({ queryKey: ["dashboardData", clientId] });
    } catch (err) {
      setMessage({ text: `Sync failed: ${(err as Error).message}`, type: "error" });
      setSyncState({ syncProgress: { phase: "error", fetched: 0, total: 0, message: (err as Error).message } });
    } finally {
      setSyncState({ syncing: false });
    }
  };

  const handlePull = async () => {
    if (!clientId || pulling) return;
    setPullState({ pulling: true, pullProgress: { phase: "listing", fetched: 0, total: 0 } });
    setMessage(null);
    try {
      const result = await pullNewFromConvert(clientId, (p) => setPullState({ pullProgress: p }));
      setMessage(
        result.failedCount > 0
          ? { text: `Pull complete — ${result.newCount} new, ${result.updatedCount} updated, ${result.failedCount} had incomplete report data.`, type: "warning" }
          : { text: `Pull complete — ${result.newCount} new, ${result.updatedCount} updated.`, type: "success" }
      );
      queryClient.invalidateQueries({ queryKey: ["dashboardData", clientId] });
    } catch (err) {
      setMessage({ text: `Pull failed: ${(err as Error).message}`, type: "error" });
      setPullState({ pullProgress: { phase: "error", fetched: 0, total: 0, message: (err as Error).message } });
    } finally {
      setPullState({ pulling: false });
    }
  };

  const handleRotateCredentials = async () => {
    if (!newConvertKeyId && !newConvertKeySecret) return;
    setSaving(true);
    try {
      const resp = await fetchWithAuth("/api/admin/rotate-client-credentials", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId,
          ...(newConvertKeyId ? { convertKeyId: newConvertKeyId } : {}),
          ...(newConvertKeySecret ? { convertKeySecret: newConvertKeySecret } : {}),
        }),
      });
      await readJsonOrThrow(resp, "Failed to rotate credentials.");
      setNewConvertKeyId("");
      setNewConvertKeySecret("");
      setMessage({ text: "Credentials rotated.", type: "success" });
    } catch (err) {
      setMessage({ text: `Failed to rotate credentials: ${(err as Error).message}`, type: "error" });
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

      const res = await fetch(`${API_BASE}/api/send-password-reset`, {
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
      const resp = await fetchWithAuth("/api/admin/reset-client-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId, newPassword }),
      });
      await readJsonOrThrow(resp, "Failed to reset password.");
      setPasswordMessage({ text: "Password updated successfully. Share it with the client.", type: "success" });
    } catch (err) {
      setPasswordMessage({ text: `Failed: ${(err as Error).message}`, type: "error" });
    } finally {
      setPasswordResetting(false);
    }
  };

  if (loading) return <div className="p-8 text-ink/40">Loading...</div>;
  if (!client) return <div className="p-8 text-ink/40">Client not found.</div>;

  const TABS = [
    { key: "overview" as const,  label: "Overview",             icon: User },
    { key: "convert" as const,   label: "Convert Data Pulls",   icon: RefreshCw },
    { key: "settings" as const,  label: "Dashboard Settings",   icon: Settings2 },
    { key: "timeline" as const,  label: "Timeline Builder",     icon: CalendarDays },
    { key: "audit" as const,     label: "Audit Findings",       icon: ListChecks },
    { key: "reports" as const,   label: "Reports",              icon: LineChart },
  ];

  return (
    <div className="flex flex-col min-h-screen">
      {/* Header */}
      <div className="border-b border-ink/10 bg-white px-8 py-5 shrink-0">
        <div className="flex items-center gap-3">
          <Link to="/admin/clients" className="text-ink/40 hover:text-ink/70">
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-ink">{client.name}</h1>
            <StatusBadge status={client.status} />
          </div>
        </div>
      </div>

      {/* Tab navigation */}
      <div className="bg-white px-6 shrink-0" data-tutorial="admin-client-tabs">
        <Tabs
          items={TABS.map(({ key, label, icon: Icon }) => ({
            value: key,
            label: (
              <span className="flex items-center gap-2 whitespace-nowrap">
                <Icon className="h-4 w-4" />
                {label}
              </span>
            ),
          }))}
          value={activeTab}
          onChange={setActiveTab}
        />
      </div>

      {/* Tab content */}
      <div className="flex-1">

        {/* ── Overview ─────────────────────────────────────────────────────── */}
        {activeTab === "overview" && (
          <div className="p-8 max-w-3xl space-y-6" data-tutorial="admin-client-overview">
            {message && <Alert tone={message.type === "success" ? "success" : message.type === "warning" ? "warning" : "danger"}>{message.text}</Alert>}
            <form onSubmit={handleSave} className="space-y-6">
              <Card>
                <CardHeader><h2 className="font-semibold text-ink">Client Details</h2></CardHeader>
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
                      <div className="rounded-lg border border-dashed border-ink/10 px-4 py-3 text-sm text-ink/50">Payment amount is restricted to executive admins.</div>
                    )}
                    <Input label="Report Currency" value={client.currency} onChange={(e) => setClient((p) => p ? { ...p, currency: e.target.value } : p)} />
                  </div>
                  <Select label="Status" value={client.status} onChange={(e) => setClient((p) => p ? { ...p, status: e.target.value as "active" | "inactive" } : p)}>
                    <option value="active">Active</option>
                    <option value="inactive">Inactive</option>
                  </Select>
                </CardBody>
              </Card>
              <div className="flex gap-3">
                <Button type="submit" loading={saving}>Save Changes</Button>
              </div>
            </form>

            <div className="space-y-6" data-tutorial="admin-client-ga4">
              <Card>
                <CardHeader><h2 className="font-semibold text-ink">GA4 Property</h2></CardHeader>
                <CardBody className="space-y-3">
                  {ga4Loading ? (
                    <div className="h-9 animate-pulse rounded-lg bg-ink/10" />
                  ) : ga4Properties.length === 0 ? (
                    <p className="text-sm text-ink/40">No GA4 properties found — server may be offline.</p>
                  ) : (
                    <Select
                      value={client.ga4PropertyId ?? ""}
                      onChange={(e) => setClient((p) => p ? { ...p, ga4PropertyId: e.target.value || undefined } : p)}
                    >
                      <option value="">— None (disable GA4 view) —</option>
                      {ga4Properties.map((p) => (
                        <option key={p.propertyId} value={p.propertyId}>
                          {p.displayName} ({p.accountDisplayName} · {p.propertyId})
                        </option>
                      ))}
                    </Select>
                  )}
                  <p className="text-xs text-ink/40">Select the GA4 property to link with this client's GA4 Data View. Save changes above to apply.</p>
                </CardBody>
              </Card>
            </div>

            <Card>
              <CardHeader><h2 className="font-semibold text-ink">Rotate Convert Credentials</h2></CardHeader>
              <CardBody className="space-y-4">
                <Input label="New Convert Key ID (leave blank to keep current)" type="password" value={newConvertKeyId} onChange={(e) => setNewConvertKeyId(e.target.value)} />
                <Input label="New Convert Key Secret (leave blank to keep current)" type="password" value={newConvertKeySecret} onChange={(e) => setNewConvertKeySecret(e.target.value)} />
                <Button variant="danger" size="sm" onClick={handleRotateCredentials} loading={saving}>Rotate Convert Key</Button>
              </CardBody>
            </Card>

            <Card data-tutorial="admin-client-password">
              <CardHeader><h2 className="font-semibold text-ink">Password Management</h2></CardHeader>
              <CardBody className="space-y-5">
                <div className="space-y-2">
                  <p className="text-sm font-medium text-ink/80">Send password reset email</p>
                  <p className="text-xs text-ink/50">Sends a reset link to the client's login email.</p>
                  <Button variant="secondary" size="sm" onClick={handleSendResetEmail} loading={passwordResetting}>Send reset email</Button>
                </div>
                <div className="border-t border-ink/10" />
                <div className="space-y-2">
                  <p className="text-sm font-medium text-ink/80">Set a new password directly</p>
                  <p className="text-xs text-ink/50">Generate or type a password, then share it with the client.</p>
                  <div className="flex items-center gap-2">
                    <div className="relative flex-1">
                      <input type={showPassword ? "text" : "password"} value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder="Enter or generate a new password…" className="w-full rounded-lg border border-ink/15 px-3 py-2 text-sm pr-10 focus:outline-none focus:ring-2 focus:ring-brand-200" />
                      <button type="button" onClick={() => setShowPassword((v) => !v)} className="absolute right-2 top-1/2 -translate-y-1/2 text-ink/40 hover:text-ink/70">
                        {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                    <Button variant="secondary" size="sm" onClick={generatePassword} title="Generate random password"><Shuffle className="h-4 w-4" /></Button>
                    {newPassword && <Button variant="secondary" size="sm" onClick={() => navigator.clipboard.writeText(newPassword)} title="Copy password"><Copy className="h-4 w-4" /></Button>}
                  </div>
                  <Button variant="danger" size="sm" onClick={handleSetPassword} disabled={newPassword.length < 6} loading={passwordResetting}>Set password</Button>
                </div>
                {passwordMessage && (
                  <Alert tone={passwordMessage.type === "success" ? "success" : "danger"}>{passwordMessage.text}</Alert>
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

            {message && <Alert tone={message.type === "success" ? "success" : message.type === "warning" ? "warning" : "danger"}>{message.text}</Alert>}

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
                  <SyncProgressBlock progress={pullProgress} label="Incremental pull" />
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
                  <SyncProgressBlock progress={syncProgress} label="Full sync" />
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
              {currentRole === "executiveAdmin" && (
                <Link to={`/admin/clients/${clientId}/preview`} target="_blank" rel="noopener noreferrer">
                  <Button variant="secondary" size="sm" className="flex items-center gap-1.5">
                    <Eye className="h-4 w-4" /> Preview as Client
                  </Button>
                </Link>
              )}
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

        {/* ── Audit Findings ───────────────────────────────────────────────── */}
        {activeTab === "audit" && (
          <div data-tutorial="admin-client-audit">
            <AdminAuditFindingsPage />
          </div>
        )}

        {/* ── Reports ──────────────────────────────────────────────────────── */}
        {activeTab === "reports" && (
          <div data-tutorial="admin-client-reports">
            <AdminAnalyticsReportsPage embedded />
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
