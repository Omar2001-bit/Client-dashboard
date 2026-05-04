import { useEffect, useState } from "react";
import { doc, onSnapshot, setDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { DashboardSettings, ClientPreferences } from "@/types";

function stripUndefined<T>(obj: T): T {
  if (obj === null || obj === undefined) return obj;
  if (Array.isArray(obj)) return obj.map(stripUndefined) as unknown as T;
  if (typeof obj === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      if (v !== undefined) out[k] = stripUndefined(v);
    }
    return out as T;
  }
  return obj;
}

export function useDashboardSettings(clientId: string | null | undefined) {
  const [settings, setSettings] = useState<DashboardSettings>({});
  const [settingsLoaded, setSettingsLoaded] = useState(false);

  useEffect(() => {
    if (!clientId) return;
    setSettingsLoaded(false);
    return onSnapshot(doc(db, "clients", clientId, "settings", "dashboard"), (snap) => {
      setSettings(snap.exists() ? (snap.data() as DashboardSettings) : {});
      setSettingsLoaded(true);
    });
  }, [clientId]);

  const saveSettings = async (next: DashboardSettings) => {
    if (!clientId) return;
    await setDoc(doc(db, "clients", clientId, "settings", "dashboard"), stripUndefined(next));
  };

  return { settings, settingsLoaded, saveSettings };
}

export function useClientPreferences(clientId: string | null | undefined) {
  const [prefs, setPrefs] = useState<ClientPreferences>({});

  useEffect(() => {
    if (!clientId) return;
    return onSnapshot(doc(db, "clients", clientId, "settings", "clientPreferences"), (snap) => {
      setPrefs(snap.exists() ? (snap.data() as ClientPreferences) : {});
    });
  }, [clientId]);

  const toggleExclude = async (experimentId: string) => {
    if (!clientId) return;
    const current = prefs.excludedExperimentIds ?? [];
    const updated = current.includes(experimentId)
      ? current.filter((id) => id !== experimentId)
      : [...current, experimentId];
    await setDoc(doc(db, "clients", clientId, "settings", "clientPreferences"), {
      ...prefs,
      excludedExperimentIds: updated,
    });
  };

  return { prefs, toggleExclude };
}
