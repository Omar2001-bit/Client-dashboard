import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight, GanttChartSquare } from "lucide-react";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { TaskDetailDialog } from "@/components/clickup/ClickUpTaskDetail";
import { groupTasksByList, type ClickUpTaskNode } from "@/lib/clickupTasks";
import { getTaskGanttBounds, getTaskGanttLayout } from "@/lib/clickupGantt";
import { getTimelineTicks } from "@/lib/timeline";
import { track } from "@/lib/activityTracker";
import type { ClickUpList, ClickUpTask } from "@/types";

interface Props {
  tasks: ClickUpTask[];
  lists: ClickUpList[];
  connected: boolean;
}

// Shared within a single list (its ruler row, gridline overlay, and every task row) so
// tick positions and bar tracks line up pixel-for-pixel inside that list's card.
const GANTT_GRID_COLS = "grid-cols-[240px_1fr]";

function flattenNodes(nodes: ClickUpTaskNode[]): ClickUpTaskNode[] {
  return nodes.flatMap((node) => [node, ...flattenNodes(node.children)]);
}

export function ClickUpGanttChart({ tasks, lists, connected }: Props) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [selectedTask, setSelectedTask] = useState<ClickUpTask | null>(null);

  const groups = useMemo(() => groupTasksByList(tasks, lists), [tasks, lists]);

  const toggleExpanded = (id: string, groupName: string) => {
    const expanding = expandedId !== id;
    setExpandedId(expanding ? id : null);
    track({ type: "clickup_group_toggle", metadata: { source: "timeline_gantt", groupName, action: expanding ? "expand" : "collapse" } });
  };

  const handleSelectTask = (task: ClickUpTask) => {
    track({ type: "clickup_task_view", metadata: { source: "timeline_gantt", taskId: task.id, taskName: task.name } });
    setSelectedTask(task);
  };

  if (!connected) {
    return (
      <EmptyState
        icon={<GanttChartSquare className="h-8 w-8" />}
        title="Project tasks aren't connected yet"
        description="Once your ClickUp workspace is connected, task bars will appear here automatically."
        dashed
      />
    );
  }

  if (tasks.length === 0) {
    return (
      <EmptyState
        icon={<GanttChartSquare className="h-8 w-8" />}
        title="No tasks yet"
        description="Tasks will appear here once they're synced."
        dashed
      />
    );
  }

  return (
    <div className="space-y-3">
      <div className="overflow-x-auto">
        <div className="min-w-[920px] space-y-3">
          {groups.map((group) => {
            const flatTasks = flattenNodes(group.tasks);
            const expanded = expandedId === group.id;
            // Own axis per list — earliest start among this list's tasks through today —
            // so bars fill this list's real time window instead of a whole-project range.
            const groupBounds = expanded && flatTasks.length > 0 ? getTaskGanttBounds(flatTasks) : null;
            const groupTicks = groupBounds ? getTimelineTicks(groupBounds.start, groupBounds.end, 6) : [];
            return (
              <Card key={group.id}>
                <CardHeader
                  onClick={() => toggleExpanded(group.id, group.name)}
                  className="flex cursor-pointer items-center justify-between select-none"
                >
                  <div className="flex items-center gap-2">
                    {expanded ? (
                      <ChevronDown className="h-4 w-4 text-ink/40" />
                    ) : (
                      <ChevronRight className="h-4 w-4 text-ink/40" />
                    )}
                    <h2 className="font-semibold text-ink">{group.name}</h2>
                  </div>
                  <span className="text-xs text-ink/40">
                    {flatTasks.length} task{flatTasks.length === 1 ? "" : "s"}
                  </span>
                </CardHeader>
                {expanded && (
                  <CardBody className="p-0">
                    {flatTasks.length > 0 && groupBounds ? (
                      <div className="max-h-[440px] overflow-y-auto">
                        {/* This list's own date ruler — ticks run from its earliest task's
                            start date to today, not a shared project-wide range. Sticky +
                            solid background so it stays visible (and opaque over the rows
                            scrolling beneath it) while this list's rows scroll underneath. */}
                        <div className={`sticky top-0 z-10 grid ${GANTT_GRID_COLS} gap-0 border-b border-ink/10 bg-white`}>
                          <div />
                          <div className="relative h-9">
                            {groupTicks.map((tick, index) => (
                              <div
                                key={`${group.id}-tick-${index}`}
                                className="absolute inset-y-0 flex -translate-x-1/2 flex-col justify-start"
                                style={{ left: `${tick.left}%` }}
                              >
                                <span className="whitespace-nowrap pt-1 text-[10px] font-medium text-ink/45">
                                  {tick.label}
                                </span>
                                <span className="mt-auto h-full w-px bg-ink/10" />
                              </div>
                            ))}
                          </div>
                        </div>

                        <div className="relative">
                          {/* Shared gridline layer — drawn once behind every row in this list,
                              using the same column template so ticks align with the rows below. */}
                          <div className={`pointer-events-none absolute inset-0 grid ${GANTT_GRID_COLS}`}>
                            <div />
                            <div className="relative">
                              {groupTicks.map((tick, index) => (
                                <div
                                  key={`grid-${index}`}
                                  className="absolute inset-y-0 w-px bg-ink/[0.06]"
                                  style={{ left: `${tick.left}%` }}
                                />
                              ))}
                            </div>
                          </div>

                          {flatTasks
                            .map((task) => ({ task, layout: getTaskGanttLayout(task, groupBounds.start, groupBounds.end) }))
                            .sort((a, b) => a.layout.left - b.layout.left)
                            .map(({ task, layout }) => (
                              <button
                                key={task.id}
                                type="button"
                                onClick={() => handleSelectTask(task)}
                                className={`grid w-full ${GANTT_GRID_COLS} items-center gap-0 border-b border-ink/5 py-2 text-left last:border-b-0 hover:bg-ink/[0.02]`}
                              >
                                <p className="truncate px-3 text-sm text-ink">{task.name}</p>
                                <div className="relative h-6">
                                  <div
                                    className="absolute inset-y-0 rounded-full shadow-sm ring-1 ring-black/5"
                                    style={{
                                      left: `${layout.left}%`,
                                      width: `${layout.width}%`,
                                      backgroundColor: task.statusColor || "#6ae499",
                                      opacity: layout.isOpen ? 0.85 : 1,
                                    }}
                                  />
                                </div>
                              </button>
                            ))}
                        </div>
                      </div>
                    ) : (
                      <p className="px-4 py-6 text-center text-sm text-ink/45">No tasks in this list yet.</p>
                    )}
                  </CardBody>
                )}
              </Card>
            );
          })}
        </div>
      </div>

      <TaskDetailDialog task={selectedTask} onClose={() => setSelectedTask(null)} />
    </div>
  );
}
