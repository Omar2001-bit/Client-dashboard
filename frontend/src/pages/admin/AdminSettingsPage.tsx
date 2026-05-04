import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { deleteField, doc, getDoc, setDoc, Timestamp } from "firebase/firestore";
import { ArrowLeft, Copy, ExternalLink, ShieldCheck, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { db, firebaseConfig } from "@/lib/firebase";
import type { ClickUpAppConfig } from "@/types";

const DEFAULT_CALLBACK_URL = `https://us-central1-${firebaseConfig.projectId}.cloudfunctions.net/clickupOAuthCallback`;

type ClickUpConfigState = Omit<ClickUpAppConfig, "clientSecret"> & {
  clientSecret: string;
  source: "firestore" | "env" | "";
};

export function AdminSettingsPage() {
  const [state, setState] = useState<ClickUpConfigState>({
    clientId: "",
    redirectUri: DEFAULT_CALLBACK_URL,
    clientSecret: "",
    hasSecret: false,
    source: "",
    configured: false,
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string>("");

  const displaySource = useMemo(() => {
    if (!state.source) return "Not configured";
    return state.source === "firestore" ? "Saved in Firestore" : "Using environment fallback";
  }, [state.source]);

  useEffect(() => {
    const load = async () => {
      try {
        const snap = await getDoc(doc(db, "appConfig", "clickup"));
        const data = (snap.exists() ? (snap.data() as Partial<ClickUpAppConfig> & { clientSecretEnc?: string }) : {}) ?? {};
        const storedSecret = Boolean((data as { clientSecretEnc?: string }).clientSecretEnc ?? data.clientSecret ?? data.hasSecret);
        const updatedAt =
          data.updatedAt && typeof data.updatedAt === "object" && "toDate" in data.updatedAt
            ? (data.updatedAt as Timestamp).toDate().toISOString()
            : typeof data.updatedAt === "string"
              ? data.updatedAt
              : undefined;
        setState((prev) => ({
          ...prev,
          clientId: data.clientId ?? "",
          redirectUri: data.redirectUri ?? DEFAULT_CALLBACK_URL,
          clientSecret: "",
          hasSecret: storedSecret,
          source: snap.exists() ? "firestore" : "",
          configured: Boolean(data.configured ?? (data.clientId && data.redirectUri && storedSecret)),
          updatedAt,
          updatedBy: data.updatedBy,
        }));
      } catch (err) {
        setMessage(`Failed to load ClickUp config: ${String(err)}`);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  const copyCallback = async () => {
    await navigator.clipboard.writeText(DEFAULT_CALLBACK_URL);
    setMessage("Callback URL copied.");
  };

  const handleSave = async () => {
    setSaving(true);
    setMessage("");
    try {
      const payload: Record<string, unknown> = {
        clientId: state.clientId.trim(),
        redirectUri: state.redirectUri.trim(),
        updatedAt: Timestamp.now(),
      };
      if (state.clientSecret.trim()) {
        payload.clientSecret = state.clientSecret.trim();
        payload.clientSecretEnc = deleteField();
      }
      await setDoc(doc(db, "appConfig", "clickup"), payload, { merge: true });
      const nextHasSecret = state.hasSecret || Boolean(state.clientSecret.trim());
      setState((prev) => ({
        ...prev,
        clientSecret: "",
        hasSecret: nextHasSecret,
        source: "firestore",
        configured: Boolean(state.clientId.trim() && state.redirectUri.trim() && nextHasSecret),
        updatedAt: new Date().toISOString(),
        updatedBy: undefined,
      }));
      setMessage("ClickUp integration saved.");
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
              <h2 className="font-semibold text-ink">ClickUp OAuth</h2>
              <p className="mt-1 text-xs text-ink/45">Store the app credentials here so the timeline editor can connect later.</p>
            </div>
            <div className="inline-flex items-center gap-2 rounded-full bg-ink/[0.02] px-3 py-1 text-xs font-medium text-ink/60">
              <ShieldCheck className="h-3.5 w-3.5" />
              {displaySource}
            </div>
          </CardHeader>
          <CardBody className="space-y-4">
            <Input
              label="ClickUp Client ID"
              value={state.clientId}
              onChange={(e) => setState((prev) => ({ ...prev, clientId: e.target.value }))}
              placeholder="Paste the ClickUp app Client ID"
            />
            <Input
              label="ClickUp Client Secret"
              value={state.clientSecret}
              onChange={(e) => setState((prev) => ({ ...prev, clientSecret: e.target.value }))}
              placeholder={state.hasSecret ? "Leave blank to keep the existing secret" : "Paste the ClickUp app Client Secret"}
            />
            <Input
              label="Redirect URI"
              value={state.redirectUri}
              onChange={(e) => setState((prev) => ({ ...prev, redirectUri: e.target.value }))}
              placeholder={DEFAULT_CALLBACK_URL}
            />

            <div className="flex flex-wrap gap-3">
              <Button onClick={handleSave} loading={saving} className="flex items-center gap-2">
                <Sparkles className="h-4 w-4" />
                Save ClickUp Config
              </Button>
              <Button variant="secondary" onClick={copyCallback} className="flex items-center gap-2">
                <Copy className="h-4 w-4" />
                Copy callback URL
              </Button>
            </div>

            {message && (
              <div className="rounded-xl border border-ink/10 bg-ink/[0.02] px-4 py-3 text-sm text-ink/60">
                {message}
              </div>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <h2 className="font-semibold text-ink">Setup Notes</h2>
          </CardHeader>
          <CardBody className="space-y-4 text-sm text-ink/65">
            <div className="rounded-2xl bg-ink/[0.02] p-4">
              <p className="font-medium text-ink">1. Create the ClickUp app</p>
              <p className="mt-1">
                Use ClickUp&apos;s OAuth app settings to generate the Client ID and Client Secret.
              </p>
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
              <p className="font-medium text-ink">2. Register the redirect URL</p>
              <p className="mt-1 break-all text-xs text-ink/55">{DEFAULT_CALLBACK_URL}</p>
              <p className="mt-2">Paste this exact URL into the ClickUp app redirect list.</p>
            </div>

            <div className="rounded-2xl bg-ink/[0.02] p-4">
              <p className="font-medium text-ink">3. Use the timeline editor</p>
              <p className="mt-1">
                After saving the config, open a client timeline and click Connect ClickUp to authorize the workspace.
              </p>
            </div>

            {state.updatedAt && (
              <div className="rounded-2xl border border-ink/10 bg-white px-4 py-3 text-xs text-ink/50">
                Last updated {new Date(state.updatedAt).toLocaleString()}
                {state.updatedBy ? ` by ${state.updatedBy}` : ""}
              </div>
            )}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
