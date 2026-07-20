import { useParams } from "react-router-dom";
import { useAuthStore } from "@/store/authStore";
import ReportCanvas from "@/components/ga4Reports/ReportCanvas";
import { useGa4Reports } from "@/hooks/useGa4Reports";

// Client-facing read-only report view. lockView is always true here — the same
// ReportCanvas component the admin builder uses, but with every edit/drag affordance
// hidden (a component-level mode split, the same pattern the Audit Findings feature
// established: Firestore rules already restrict this client to their own client's
// reports, and lockView additionally hides editing UI on top of that).
export function AnalyticsReportViewPage() {
  const { reportId } = useParams<{ reportId: string }>();
  const clientId = useAuthStore((s) => s.clientId);
  const authLoading = useAuthStore((s) => s.loading);
  const { data: reports = [], isLoading } = useGa4Reports(authLoading ? null : clientId);

  if (isLoading) return <div className="p-8 text-ink/40">Loading report…</div>;
  const report = reports.find((r) => r.id === reportId);
  if (!report) return <div className="p-8 text-sm text-ink/50">Report not found.</div>;

  return (
    <div className="p-8">
      <ReportCanvas
        clientId={clientId as string}
        initial={report}
        lockView
        backHref="/dashboard/analytics-reports"
      />
    </div>
  );
}
