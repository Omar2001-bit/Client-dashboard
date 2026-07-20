import { useAuthStore } from "@/store/authStore";
import { useGa4Reports } from "@/hooks/useGa4Reports";
import { groupGa4Reports } from "@/lib/ga4Reports/storage";
import ReportPreviewCard from "@/components/ga4Reports/ReportPreviewCard";

// Client-facing mega dashboard: read-only grid of every report the admin has built for
// this client, grouped the same way as the admin list page (see groupGa4Reports).
export function AnalyticsReportsPage() {
  const clientId = useAuthStore((s) => s.clientId);
  const authLoading = useAuthStore((s) => s.loading);
  const { data: reports = [], isLoading } = useGa4Reports(authLoading ? null : clientId);

  if (isLoading) return <div className="p-8 text-ink/40">Loading reports…</div>;

  if (reports.length === 0) {
    return (
      <div className="p-8">
        <h1 className="text-2xl font-bold text-ink tracking-tight">Analytics Reports</h1>
        <p className="mt-4 text-sm text-ink/50">No reports have been shared with you yet.</p>
      </div>
    );
  }

  const grouped = groupGa4Reports(reports);

  return (
    <div className="p-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-ink tracking-tight">Analytics Reports</h1>
        <p className="mt-1 text-sm text-ink/50">Custom GA4 reports built for your account.</p>
      </div>

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
                  to={`/dashboard/analytics-reports/${report.id}`}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
