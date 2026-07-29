import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, Plus } from "lucide-react";
import { doc, getDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { Button } from "@/components/ui/Button";
import ReportPreviewCard from "@/components/ga4Reports/ReportPreviewCard";
import { useGa4Reports } from "@/hooks/useGa4Reports";
import { groupGa4Reports } from "@/lib/ga4Reports/storage";
import type { ClientDoc } from "@/types";

// Admin-side report list for one client. Rendered either standalone (its own route) or
// embedded inside ClientDetailPage's "Reports" tab.
export function AdminAnalyticsReportsPage({ embedded = false }: { embedded?: boolean } = {}) {
  const { clientId } = useParams<{ clientId: string }>();
  const [client, setClient] = useState<ClientDoc | null>(null);
  const { data: reports = [], isLoading } = useGa4Reports(clientId);

  useEffect(() => {
    if (!clientId) return;
    getDoc(doc(db, "clients", clientId)).then((snap) => {
      if (snap.exists()) setClient({ id: snap.id, ...snap.data() } as ClientDoc);
    });
  }, [clientId]);

  const grouped = groupGa4Reports(reports);

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between gap-3">
        {embedded ? (
          <div />
        ) : (
          <div className="flex items-center gap-3 min-w-0">
            <Link
              to={`/admin/clients/${clientId}`}
              aria-label="Back to client"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-ink/15 text-ink/70 transition-colors hover:border-ink/30 hover:text-ink"
            >
              <ArrowLeft className="h-4 w-4" />
            </Link>
            <div className="min-w-0">
              <h1 className="truncate text-xl font-semibold text-ink">Analytics Reports</h1>
              {client && <p className="truncate text-sm text-ink/50">{client.name}</p>}
            </div>
          </div>
        )}
        <div className="flex items-center gap-3">
          <Link to={`/admin/clients/${clientId}/analytics-reports/new`}>
            <Button className="flex items-center gap-1.5">
              <Plus className="h-4 w-4" />
              New report
            </Button>
          </Link>
        </div>
      </div>

      {client && !client.ga4PropertyId ? (
        <div className="rounded-brand border border-ink/10 bg-white p-8 text-center text-sm text-ink/50">
          This client has no GA4 property configured yet.{" "}
          <Link to={`/admin/clients/${clientId}?tab=overview`} className="text-brand-700 underline">
            Set one on the client's overview tab
          </Link>{" "}
          before building a report.
        </div>
      ) : isLoading ? (
        <div className="text-ink/40">Loading reports…</div>
      ) : reports.length === 0 ? (
        <div className="rounded-brand border border-dashed border-ink/20 bg-white p-10 text-center text-sm text-ink/50">
          No reports yet. Click "New report" to build the first one.
        </div>
      ) : (
        <div className="space-y-8">
          {grouped.map(([group, groupReports]) => (
            <div key={group}>
              {group !== "Ungrouped" && (
                <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-ink/50">{group}</h2>
              )}
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {groupReports.map((report) => (
                  <ReportPreviewCard
                    key={report.id}
                    clientId={clientId as string}
                    report={report}
                    to={`/admin/clients/${clientId}/analytics-reports/${report.id}`}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
