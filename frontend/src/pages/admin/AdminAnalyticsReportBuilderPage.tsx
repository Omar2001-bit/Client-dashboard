import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { doc, getDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import ReportCanvas from "@/components/ga4Reports/ReportCanvas";
import { useGa4Reports } from "@/hooks/useGa4Reports";
import { defaultGa4Report } from "@/lib/ga4Reports/storage";
import type { ClientDoc } from "@/types";

export function AdminAnalyticsReportBuilderPage() {
  const { clientId, reportId } = useParams<{ clientId: string; reportId: string }>();
  const isNew = reportId === "new";
  const [client, setClient] = useState<ClientDoc | null>(null);
  const { data: reports = [], isLoading } = useGa4Reports(isNew ? undefined : clientId);

  useEffect(() => {
    if (!clientId) return;
    getDoc(doc(db, "clients", clientId)).then((snap) => {
      if (snap.exists()) setClient({ id: snap.id, ...snap.data() } as ClientDoc);
    });
  }, [clientId]);

  const backHref = `/admin/clients/${clientId}/analytics-reports`;

  if (isNew) {
    // Default the property to this client's own configured GA4 property (per the
    // integration plan's decision (c)) rather than GA4-simply-layer's original
    // "first property the service account can see" — in a multi-tenant app, the first
    // discoverable property could belong to a different client entirely.
    if (!client) return <div className="p-6 text-ink/40">Loading…</div>;
    const property = client.ga4PropertyId ? `properties/${client.ga4PropertyId}` : "";
    return (
      <div className="p-6">
        <ReportCanvas
          clientId={clientId as string}
          initial={defaultGa4Report(property)}
          startEditing
          isNew
          backHref={backHref}
        />
      </div>
    );
  }

  if (isLoading) return <div className="p-6 text-ink/40">Loading report…</div>;
  const report = reports.find((r) => r.id === reportId);
  if (!report) return <div className="p-6 text-ink/50">Report not found.</div>;

  return (
    <div className="p-6">
      <ReportCanvas clientId={clientId as string} initial={report} backHref={backHref} />
    </div>
  );
}
