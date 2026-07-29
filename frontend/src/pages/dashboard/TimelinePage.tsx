import { useAuthStore } from "@/store/authStore";
import { useClientTimeline } from "@/hooks/useClientTimeline";
import { ClickUpGanttChart } from "@/components/timeline/ClickUpGanttChart";

export function TimelinePage() {
  const clientId = useAuthStore((s) => s.clientId);
  const authLoading = useAuthStore((s) => s.loading);
  const { timeline, loaded, error } = useClientTimeline(clientId);

  if (!authLoading && !clientId) return <div className="p-8 text-sm text-ink/50">No client workspace is linked to this account.</div>;
  if (error) return <div className="p-8 text-sm text-red-600">Failed to load timeline: {error}</div>;
  if (!loaded) return <div className="p-8 text-sm text-ink/50">Loading timeline...</div>;

  return (
    <div className="p-8 space-y-6">
      <div data-tutorial="clickup-gantt">
        <h2 className="text-lg font-semibold text-ink">Task Gantt</h2>
        <p className="mb-3 text-sm text-ink/50">Automatically generated from your synced ClickUp tasks.</p>
        <ClickUpGanttChart
          tasks={timeline.clickup?.tasks ?? []}
          lists={timeline.clickup?.lists ?? []}
          connected={Boolean(timeline.clickup?.connected)}
        />
      </div>
    </div>
  );
}
