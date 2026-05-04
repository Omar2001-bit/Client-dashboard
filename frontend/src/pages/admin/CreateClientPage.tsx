import { useState, useEffect } from "react";
import { useNavigate, Link } from "react-router-dom";
import { getAuth } from "firebase/auth";
import { collection, getDocs, query, where } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { createUserDirectly } from "@/lib/adminUsers";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Card, CardHeader, CardBody } from "@/components/ui/Card";
import { ArrowLeft, CheckCircle } from "lucide-react";
import { useAuthStore } from "@/store/authStore";
import type { CreateClientFormData, GA4Property } from "@/types";

const API_BASE = import.meta.env.VITE_API_URL ?? "http://localhost:3001";

export function CreateClientPage() {
  const navigate = useNavigate();
  const currentRole = useAuthStore((s) => s.role);
  const [form, setForm] = useState<CreateClientFormData>({
    role: "client",
    userName: "",
    userEmail: "",
    userPassword: "",
    clientName: "",
    contactName: "",
    contactEmail: "",
    contractStartDate: "",
    contractEndDate: "",
    servicePrice: 0,
    currency: "USD",
    convertAccountId: "",
    convertProjectId: "",
    convertKeyId: "",
    convertKeySecret: "",
    ga4PropertyId: "",
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const [executiveAdminExists, setExecutiveAdminExists] = useState(false);
  const [ga4Properties, setGa4Properties] = useState<GA4Property[]>([]);
  const [ga4Loading, setGa4Loading] = useState(false);

  useEffect(() => {
    getDocs(query(collection(db, "users"), where("role", "==", "executiveAdmin")))
      .then((snap) => setExecutiveAdminExists(!snap.empty));
    setGa4Loading(true);
    fetch(`${API_BASE}/api/ga4/properties`)
      .then((r) => r.json())
      .then((d) => setGa4Properties(d.properties ?? []))
      .catch(() => setGa4Properties([]))
      .finally(() => setGa4Loading(false));
  }, []);

  const set = (key: keyof CreateClientFormData) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((prev) => ({ ...prev, [key]: e.target.value }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (form.userPassword.length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }
    if (form.role === "executiveAdmin" && executiveAdminExists) {
      setError("An executive admin already exists. Only one executive admin is allowed at a time.");
      return;
    }
    if (form.role === "client" && (!form.convertAccountId || !form.convertProjectId || !form.convertKeyId || !form.convertKeySecret)) {
      setError("Convert account ID, project ID, key ID, and key secret are required.");
      return;
    }
    if (form.role === "client" && (!form.contractStartDate || !form.contractEndDate)) {
      setError("Engagement start and end dates are required.");
      return;
    }
    if (form.role === "client" && new Date(form.contractEndDate) < new Date(form.contractStartDate)) {
      setError("Engagement end date must be after the start date.");
      return;
    }
    setLoading(true);
    try {
      const result = await createUserDirectly(form);

      // Notify executive admin when a regular admin creates a client (they need to set the service price)
      if (form.role === "client" && currentRole !== "executiveAdmin") {
        const currentUser = getAuth().currentUser;
        const clientUrl = `${window.location.origin}/admin/clients/${result.clientId}`;
        try {
          const execSnap = await getDocs(query(collection(db, "users"), where("role", "==", "executiveAdmin")));
          if (!execSnap.empty) {
            const execAdmin = execSnap.docs[0].data();
            const resp = await fetch("http://localhost:3001/api/notify-executive-admin", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                executiveAdminEmail: execAdmin.email,
                adminName: currentUser?.displayName ?? "An admin",
                adminEmail: currentUser?.email ?? "",
                clientName: form.clientName,
                clientUrl,
              }),
            });
            if (!resp.ok) console.warn("[notify-executive-admin] server error:", await resp.text());
          } else {
            console.warn("[notify-executive-admin] no executive admin found in Firestore");
          }
        } catch (e) {
          console.warn("[notify-executive-admin] failed:", e);
        }
      }

      setSuccess(true);
      setTimeout(() => navigate("/admin/clients"), 2000);
    } catch (err: unknown) {
      const code = (err as { code?: string }).code;
      const msg = code === "auth/email-already-in-use"
        ? "That email already exists in Firebase Auth. It may be from an earlier failed save; delete it from Authentication or use a different email."
        : (err as { message?: string }).message ?? "Failed to create user.";
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  if (success) {
    return (
      <div className="p-8 flex flex-col items-center justify-center min-h-96 space-y-3">
        <CheckCircle className="h-12 w-12 text-green-500" />
        <p className="text-xl font-semibold text-gray-900">User created!</p>
        <p className="text-gray-500 text-sm">Credentials and role saved. Redirecting...</p>
      </div>
    );
  }

  return (
    <div className="p-8 max-w-3xl">
      <div className="flex items-center gap-3 mb-6">
        <Link to="/admin/clients" className="text-gray-400 hover:text-gray-600">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <h1 className="text-2xl font-bold text-gray-900">New User</h1>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        <Card>
          <CardHeader><h2 className="font-semibold text-gray-800">Account Access</h2></CardHeader>
          <CardBody className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <label className="block text-sm font-medium text-gray-700">Role</label>
                <select
                  value={form.role}
                  onChange={(e) => setForm((prev) => ({ ...prev, role: e.target.value as CreateClientFormData["role"] }))}
                  className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-brand-200"
                >
                  <option value="client">Client</option>
                  <option value="admin">Admin</option>
                  <option value="executiveAdmin" disabled={executiveAdminExists}>
                    Executive Admin{executiveAdminExists ? " (slot taken)" : ""}
                  </option>
                </select>
                {executiveAdminExists && form.role !== "executiveAdmin" && (
                  <p className="text-xs text-ink/40 mt-1">An executive admin already exists. Only one is permitted.</p>
                )}
              </div>
              <Input label="Name" value={form.userName} onChange={set("userName")} required />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <Input label="Email" type="email" value={form.userEmail} onChange={set("userEmail")} required />
              <Input
                label="Password"
                type="password"
                value={form.userPassword}
                onChange={set("userPassword")}
                hint="Saved to Firebase Auth"
                required
              />
            </div>
          </CardBody>
        </Card>

        {form.role === "client" && (
        <Card>
          <CardHeader><h2 className="font-semibold text-gray-800">Client Details</h2></CardHeader>
          <CardBody className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <Input label="Company Name" value={form.clientName} onChange={set("clientName")} required />
              <Input label="Contact Name" value={form.contactName} onChange={set("contactName")} required />
            </div>
            <Input label="Contact Email" type="email" value={form.contactEmail} onChange={set("contactEmail")} required />
            <div className="grid grid-cols-2 gap-4">
              <Input label="Engagement Start Date" type="date" value={form.contractStartDate} onChange={set("contractStartDate")} required />
              <Input label="Engagement End Date" type="date" value={form.contractEndDate} onChange={set("contractEndDate")} required />
            </div>
            <div className="grid grid-cols-2 gap-4">
              {currentRole === "executiveAdmin" ? (
                <Input
                  label="Client Paid Amount (USD)"
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.servicePrice}
                  onChange={(e) => setForm((p) => ({ ...p, servicePrice: parseFloat(e.target.value) }))}
                  hint="Stored in USD for ROI and reporting calculations."
                  required
                />
              ) : (
                <div className="rounded-lg border border-dashed border-gray-200 px-4 py-3 text-sm text-gray-500">
                  Payment amount is restricted to executive admins.
                </div>
              )}
              <Input
                label="Report Currency"
                value={form.currency}
                onChange={set("currency")}
                placeholder="USD"
                hint="Shown next to all money values in reports"
                required
              />
            </div>
          </CardBody>
        </Card>
        )}

        {form.role === "client" && (
        <Card>
          <CardHeader><h2 className="font-semibold text-gray-800">Convert.com Credentials</h2></CardHeader>
          <CardBody className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <Input label="Account ID" value={form.convertAccountId} onChange={set("convertAccountId")} required />
              <Input label="Project ID" value={form.convertProjectId} onChange={set("convertProjectId")} required />
            </div>
            <Input
              label="Key ID"
              type="password"
              value={form.convertKeyId}
              onChange={set("convertKeyId")}
              hint="Stored encrypted; never exposed to client view (KEY_ID)"
              required
            />
            <Input
              label="Key Secret"
              type="password"
              value={form.convertKeySecret}
              onChange={set("convertKeySecret")}
              hint="Stored encrypted; never exposed to client view (KEY_SECRET)"
              required
            />
          </CardBody>
        </Card>
        )}

        {form.role === "client" && (
        <Card>
          <CardHeader><h2 className="font-semibold text-gray-800">GA4 Property</h2></CardHeader>
          <CardBody className="space-y-2">
            <label className="block text-sm font-medium text-gray-700">GA4 Property</label>
            {ga4Loading ? (
              <div className="h-9 animate-pulse rounded-lg bg-gray-100" />
            ) : ga4Properties.length === 0 ? (
              <p className="text-sm text-gray-400">No GA4 properties found — server may be offline.</p>
            ) : (
              <select
                value={form.ga4PropertyId ?? ""}
                onChange={(e) => setForm((p) => ({ ...p, ga4PropertyId: e.target.value }))}
                className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-brand-200"
              >
                <option value="">— None (skip GA4) —</option>
                {ga4Properties.map((p) => (
                  <option key={p.propertyId} value={p.propertyId}>
                    {p.displayName} ({p.accountDisplayName} · {p.propertyId})
                  </option>
                ))}
              </select>
            )}
            <p className="text-xs text-gray-400">Links this client to a GA4 property for the GA4 Data View dashboard.</p>
          </CardBody>
        </Card>
        )}

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}

        <div className="flex gap-3">
          <Button type="submit" size="lg" loading={loading}>Save User</Button>
          <Link to="/admin/clients"><Button type="button" variant="secondary" size="lg">Cancel</Button></Link>
        </div>
      </form>
    </div>
  );
}
