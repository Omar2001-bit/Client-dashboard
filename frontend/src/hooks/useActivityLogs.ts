import { useCallback, useRef, useSyncExternalStore } from "react";
import { collection, limit, onSnapshot, orderBy, query } from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { LogEntry } from "@/lib/activityLog";

interface LogsSnapshot {
  logs: LogEntry[];
  loading: boolean;
}

/**
 * Subscribes to Firestore via useSyncExternalStore instead of useState+useEffect.
 * onSnapshot pushes updates from outside React's render cycle, which under
 * concurrent rendering (StrictMode) can tear this component's other state
 * (selectedTypes) across renders — useSyncExternalStore is React's prescribed
 * fix for exactly this class of external-store subscription.
 */
export function useActivityLogs(clientId: string): LogsSnapshot {
  const snapshotRef = useRef<LogsSnapshot>({ logs: [], loading: true });

  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      snapshotRef.current = { logs: [], loading: true };
      const q = query(
        collection(db, "clients", clientId, "activityLogs"),
        orderBy("timestamp", "desc"),
        limit(500)
      );
      return onSnapshot(q, (snap) => {
        snapshotRef.current = {
          logs: snap.docs.map((d) => ({ id: d.id, ...d.data() } as LogEntry)),
          loading: false,
        };
        onStoreChange();
      });
    },
    [clientId]
  );

  const getSnapshot = useCallback(() => snapshotRef.current, []);

  return useSyncExternalStore(subscribe, getSnapshot);
}
