import { useEffect, useState } from "react";
import { collection, getDocs } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { Tooltip } from "@/components/ui";
import type { ClientDoc } from "@/types";

export function ClientSelector({ onSelect }: { onSelect: (client: ClientDoc) => void }) {
  const [clients, setClients] = useState<ClientDoc[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getDocs(collection(db, "clients")).then((snap) => {
      setClients(snap.docs.map((d) => ({ id: d.id, ...d.data() } as ClientDoc)));
      setLoading(false);
    });
  }, []);

  return (
    <div className="p-8 max-w-4xl" data-tutorial="admin-logs-viewer">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-ink">Client Logs</h1>
        <p className="mt-1 text-sm text-ink/50">Select a client to view their full activity history in real time.</p>
      </div>
      {loading ? (
        <div className="grid grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-24 animate-pulse rounded-xl bg-ink/5" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {clients.map((c) => (
            <button
              key={c.id}
              onClick={() => onSelect(c)}
              className="flex items-center gap-4 rounded-xl border border-ink/10 bg-white px-5 py-4 text-left shadow-sm transition-all hover:border-brand-400 hover:shadow-md"
            >
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand-100 text-brand-700 font-bold text-lg">
                {c.name?.[0]?.toUpperCase() ?? "?"}
              </div>
              <div className="min-w-0">
                <Tooltip label={c.name} className="block w-full min-w-0">
                  <p className="font-semibold text-ink truncate">{c.name}</p>
                </Tooltip>
                <Tooltip label={c.contactEmail} className="block w-full min-w-0">
                  <p className="text-xs text-ink/40 truncate">{c.contactEmail}</p>
                </Tooltip>
              </div>
            </button>
          ))}
          {clients.length === 0 && (
            <p className="col-span-3 text-sm text-ink/40">No clients found.</p>
          )}
        </div>
      )}
    </div>
  );
}
