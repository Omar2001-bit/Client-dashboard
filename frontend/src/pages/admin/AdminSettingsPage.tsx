import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, ExternalLink, ShieldCheck, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Alert } from "@/components/ui/Alert";
import { fetchWithAuth, readJsonOrThrow } from "@/lib/apiClient";
import type { ClickUpAccessConfig } from "@/types";

export function AdminSettingsPage() {
  const [status, setStatus] = useState<ClickUpAccessConfig>({ configured: false, source: "" });
  const [personalToken, setPersonalToken] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string>("");

  const displaySource = useMemo(() => {
    if (!status.source) return "Not configured";
    return status.source === "firestore" ? "Saved in Firestore" : "Using environment fallback";
  }, [status.source]);

  useEffect(() => {
    const load = async () => {
      try {
        const resp = await fetchWithAuth("/api/clickup/status");
        setStatus(await readJsonOrThrow<ClickUpAccessConfig>(resp, "Failed to load ClickUp status."));
      } catch (err) {
        setMessage(`Failed to load ClickUp status: ${String(err)}`);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  const handleSave = async () => {
    if (!personalToken.trim()) return;
    setSaving(true);
    setMessage("");
    try {
      const resp = await fetchWithAuth("/api/clickup/access", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ personalToken: personalToken.trim() }),
      });
      const data = await readJsonOrThrow<{ authorizedUserName?: string; authorizedUserEmail?: string }>(
        resp,
        "Failed to save ClickUp token."
      );
      setPersonalToken("");
      setStatus((prev) => ({
        ...prev,
        configured: true,
        source: "firestore",
        authorizedUserName: data.authorizedUserName,
        authorizedUserEmail: data.authorizedUserEmail,
        updatedAt: new Date().toISOString(),
      }));
      setMessage(`ClickUp connected as ${data.authorizedUserName || data.authorizedUserEmail || "you"}.`);
    } catch (err) {
      setMessage(`Save failed: ${String(err)}`);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="p-8 text-sm text-ink/50">Loading integration settings...</div>;
  }

  return (
    <div className="p-8 space-y-6">
      <div className="flex items-center gap-3">
        <Link to="/admin" className="text-ink/40 hover:text-ink">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-ink">Integration Settings</h1>
          <p className="text-sm text-ink/50">Configure ClickUp once and reuse it across all client timelines.</p>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
        <Card data-tutorial="admin-settings-clickup">
          <CardHeader className="flex items-center justify-between">
            <div>
              <h2 className="font-semibold text-ink">ClickUp Access</h2>
              <p className="mt-1 text-xs text-ink/45">
                One personal API token gives the dashboard read access to your ClickUp workspace. Each client&apos;s
                timeline is then scoped to a workspace folder when you sync it.
              </p>
            </div>
            <div className="inline-flex items-center gap-2 rounded-full bg-ink/[0.02] px-3 py-1 text-xs font-medium text-ink/60">
              <ShieldCheck className="h-3.5 w-3.5" />
              {displaySource}
            </div>
          </CardHeader>
          <CardBody className="space-y-4">
            {status.configured && status.authorizedUserName && (
              <Alert tone="info">
                Connected as <span className="font-medium text-ink">{status.authorizedUserName}</span>
                {status.authorizedUserEmail ? ` (${status.authorizedUserEmail})` : ""}
              </Alert>
            )}
            <Input
              label="ClickUp Personal API Token"
              value={personalToken}
              onChange={(e) => setPersonalToken(e.target.value)}
              placeholder={status.configured ? "Leave blank to keep the existing token" : "Paste your ClickUp personal API token (pk_...)"}
              type="password"
            />

            <Button onClick={handleSave} loading={saving} disabled={!personalToken.trim()} className="flex items-center gap-2">
              <Sparkles className="h-4 w-4" />
              Save Token
            </Button>

            {message && <Alert tone="info">{message}</Alert>}
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <h2 className="font-semibold text-ink">Setup Notes</h2>
          </CardHeader>
          <CardBody className="space-y-4 text-sm text-ink/65">
            <div className="rounded-2xl bg-ink/[0.02] p-4">
              <p className="font-medium text-ink">1. Generate a personal API token</p>
              <p className="mt-1">In ClickUp, go to your avatar &gt; Settings &gt; Apps &gt; API Token.</p>
              <a
                href="https://help.clickup.com/hc/articles/6303426241687-Getting-Started-with-the-ClickUp-API"
                target="_blank"
                rel="noreferrer"
                className="mt-2 inline-flex items-center gap-1 text-brand-700 hover:text-brand-800"
              >
                ClickUp setup guide
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
            </div>

            <div className="rounded-2xl bg-ink/[0.02] p-4">
              <p className="font-medium text-ink">2. Organize by client</p>
              <p className="mt-1">
                A folder (or list) per client in your workspace makes syncing straightforward &mdash; you&apos;ll pick
                that scope when connecting a client&apos;s timeline.
              </p>
            </div>

            <div className="rounded-2xl bg-ink/[0.02] p-4">
              <p className="font-medium text-ink">3. Use the timeline editor</p>
              <p className="mt-1">
                After saving the token here, open a client&apos;s Timeline Builder, pick the workspace and folder, and
                sync tasks.
              </p>
            </div>

            {status.updatedAt && (
              <div className="rounded-2xl border border-ink/10 bg-white px-4 py-3 text-xs text-ink/50">
                Last updated {new Date(status.updatedAt).toLocaleString()}
                {status.updatedBy ? ` by ${status.updatedBy}` : ""}
              </div>
            )}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
