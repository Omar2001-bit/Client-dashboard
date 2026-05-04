import { useMemo, useState, useCallback } from "react";
import { track } from "@/lib/activityTracker";
import { useAuthStore } from "@/store/authStore";
import { useDashboardData } from "@/hooks/useDashboardData";
import { useClientTimeline } from "@/hooks/useClientTimeline";
import { TimelineViewer } from "@/components/timeline/TimelineViewer";
import { sortPhases } from "@/lib/timeline";
import type { ClickUpTask } from "@/types";

export function TimelinePage() {
  const clientId = useAuthStore((s) => s.clientId);
  const authLoading = useAuthStore((s) => s.loading);
  const { data, isLoading } = useDashboardData(authLoading ? null : clientId);
  const { timeline, loaded, error } = useClientTimeline(clientId);
  const phases = useMemo(() => sortPhases(timeline.phases ?? []), [timeline.phases]);
  const [selectedPhaseId, setSelectedPhaseId] = useState<string | null>(null);
  const handleSelectPhase = useCallback((id: string | null) => {
    if (id) {
      const phase = phases.find((p) => p.id === id);
      track({ type: "timeline_phase_selected", metadata: { phaseId: id, phaseName: phase?.title ?? id } });
    }
    setSelectedPhaseId(id);
  }, [phases]);
  const phaseTasks = useMemo(() => {
    const map: Record<string, ClickUpTask[]> = {};
    (timeline.clickup?.tasks ?? []).forEach((task) => {
      const phaseId = timeline.clickup?.taskAssignments?.[task.id];
      if (!phaseId) return;
      if (!map[phaseId]) map[phaseId] = [];
      map[phaseId].push(task);
    });
    return map;
  }, [timeline.clickup?.taskAssignments, timeline.clickup?.tasks]);

  if (!authLoading && !clientId) return <div className="p-8 text-sm text-ink/50">No client workspace is linked to this account.</div>;
  if (error) return <div className="p-8 text-sm text-red-600">Failed to load timeline: {error}</div>;
  if (isLoading || !loaded) return <div className="p-8 text-sm text-ink/50">Loading timeline...</div>;

  return (
    <div className="p-8 space-y-6">
      <div data-tutorial="timeline-viewer"><TimelineViewer
        clientName={data?.client?.name}
        contractStartDate={data?.client?.contractStartDate ? data.client.contractStartDate.toDate().toISOString().slice(0, 10) : undefined}
        contractEndDate={data?.client?.contractEndDate ? data.client.contractEndDate.toDate().toISOString().slice(0, 10) : undefined}
        phases={phases}
        selectedPhaseId={selectedPhaseId}
        onSelectPhase={handleSelectPhase}
        phaseTasks={phaseTasks}
        emptySubtitle="The admin needs to build the engagement timeline first."
      /></div>
    </div>
  );
}
