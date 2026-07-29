import { create } from "zustand";
import type { SyncProgress } from "@/lib/convertSync";

interface ClientSyncState {
  syncing: boolean;
  syncProgress: SyncProgress | null;
  pulling: boolean;
  pullProgress: SyncProgress | null;
}

const EMPTY_STATE: ClientSyncState = { syncing: false, syncProgress: null, pulling: false, pullProgress: null };

interface ConvertSyncStore {
  byClient: Record<string, ClientSyncState>;
  setSyncState: (clientId: string, patch: Partial<ClientSyncState>) => void;
  setPullState: (clientId: string, patch: Partial<ClientSyncState>) => void;
}

// Keeps Convert sync progress alive across route navigation — the sync itself is a
// plain async function that keeps running in the tab after ClientDetailPage unmounts,
// so its progress needs to live outside that component's local state.
const useConvertSyncStore = create<ConvertSyncStore>((set) => ({
  byClient: {},
  setSyncState: (clientId, patch) =>
    set((state) => ({
      byClient: {
        ...state.byClient,
        [clientId]: { ...(state.byClient[clientId] ?? EMPTY_STATE), ...patch },
      },
    })),
  setPullState: (clientId, patch) =>
    set((state) => ({
      byClient: {
        ...state.byClient,
        [clientId]: { ...(state.byClient[clientId] ?? EMPTY_STATE), ...patch },
      },
    })),
}));

export function useConvertSyncState(clientId: string | undefined) {
  const state = useConvertSyncStore((s) => (clientId ? s.byClient[clientId] : undefined)) ?? EMPTY_STATE;
  const setSyncState = useConvertSyncStore((s) => s.setSyncState);
  const setPullState = useConvertSyncStore((s) => s.setPullState);
  return {
    ...state,
    setSyncState: (patch: Partial<ClientSyncState>) => clientId && setSyncState(clientId, patch),
    setPullState: (patch: Partial<ClientSyncState>) => clientId && setPullState(clientId, patch),
  };
}
