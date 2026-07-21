import { useEffect, useState } from "react";
import { doc, onSnapshot, setDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { ClientTimelineConfig } from "@/types";

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

export function useClientTimeline(clientId: string | null | undefined) {
  const [timeline, setTimeline] = useState<ClientTimelineConfig>({});
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!clientId) {
      setTimeline({});
      setLoaded(true);
      setError(null);
      return;
    }
    setLoaded(false);
    setError(null);
    return onSnapshot(
      doc(db, "clients", clientId, "timeline", "config"),
      (snap) => {
        setTimeline(snap.exists() ? (snap.data() as ClientTimelineConfig) : {});
        setLoaded(true);
      },
      (err) => {
        console.error("[useClientTimeline] snapshot failed:", err);
        setTimeline({});
        setError(err.message);
        setLoaded(true);
      }
    );
  }, [clientId]);

  const saveTimeline = async (next: ClientTimelineConfig) => {
    if (!clientId) return;
    await setDoc(doc(db, "clients", clientId, "timeline", "config"), stripUndefined(next));
  };

  return { timeline, loaded, error, saveTimeline };
}

/** Narrow, layout-level read: is ClickUp connected for this client? Used to gate nav-item
 *  visibility without holding the full timeline (incl. a potentially large clickup.tasks
 *  array) in every client page's render tree. */
export function useClickUpConnected(clientId: string | null | undefined): boolean {
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    if (!clientId) return;
    return onSnapshot(
      doc(db, "clients", clientId, "timeline", "config"),
      (snap) => {
        const next = Boolean((snap.data() as ClientTimelineConfig | undefined)?.clickup?.connected);
        setConnected((prev) => (prev === next ? prev : next));
      },
      () => setConnected(false)
    );
  }, [clientId]);

  return connected;
}
