import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { doc, getDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { ClientDoc } from "@/types";
import { ClientSelector } from "@/components/clientLogs/ClientSelector";
import { LogViewer } from "@/components/clientLogs/LogViewer";

export function ClientLogsPage() {
  const [searchParams] = useSearchParams();
  const [selectedClient, setSelectedClient] = useState<ClientDoc | null>(null);

  // Tutorial: auto-select a client via ?client=<id> so the viewer opens directly
  useEffect(() => {
    const tutorialId = searchParams.get("client");
    if (!tutorialId) return;
    getDoc(doc(db, "clients", tutorialId)).then((snap) => {
      if (snap.exists()) setSelectedClient({ id: snap.id, ...snap.data() } as ClientDoc);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams.get("client")]);

  if (!selectedClient) {
    return <ClientSelector onSelect={setSelectedClient} />;
  }

  return <LogViewer client={selectedClient} onBack={() => setSelectedClient(null)} />;
}
