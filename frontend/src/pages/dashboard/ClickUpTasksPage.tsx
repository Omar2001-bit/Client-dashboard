import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight, ClipboardList } from "lucide-react";
import { useAuthStore } from "@/store/authStore";
import { useClientTimeline } from "@/hooks/useClientTimeline";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { ClickUpStatusBadge, TaskDetailDialog } from "@/components/clickup/ClickUpTaskDetail";
import { groupTasksByList, countTaskNodes, type ClickUpTaskNode } from "@/lib/clickupTasks";

function TaskRow({ task, depth, onSelect }: { task: ClickUpTaskNode; depth: number; onSelect: (task: ClickUpTaskNode) => void }) {
  return (
    <div>
      <button
        type="button"
        onClick={() => onSelect(task)}
        className="flex w-full flex-wrap items-center justify-between gap-2 border-b border-ink/5 px-4 py-2.5 text-left last:border-b-0 hover:bg-ink/[0.02]"
        style={{ paddingLeft: `${16 + depth * 24}px` }}
      >
        <div className="min-w-0">
          <p className="text-sm font-medium text-ink truncate">{task.name}</p>
          {(task.dueDate || task.assigneeNames?.length) ? (
            <p className="mt-0.5 text-xs text-ink/45">
              {task.dueDate ? `Due ${task.dueDate}` : ""}
              {task.dueDate && task.assigneeNames?.length ? " · " : ""}
              {task.assigneeNames?.length ? task.assigneeNames.join(", ") : ""}
            </p>
          ) : null}
        </div>
        <ClickUpStatusBadge status={task.status} statusColor={task.statusColor} />
      </button>
      {task.children.map((child) => (
        <TaskRow key={child.id} task={child} depth={depth + 1} onSelect={onSelect} />
      ))}
    </div>
  );
}

export function ClickUpTasksPage() {
  const clientId = useAuthStore((s) => s.clientId);
  const authLoading = useAuthStore((s) => s.loading);
  const { timeline, loaded, error } = useClientTimeline(clientId);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [selectedTask, setSelectedTask] = useState<ClickUpTaskNode | null>(null);

  const listGroups = useMemo(
    () => groupTasksByList(timeline.clickup?.tasks ?? [], timeline.clickup?.lists ?? []),
    [timeline.clickup?.tasks, timeline.clickup?.lists]
  );

  const toggleExpanded = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  if (!authLoading && !clientId) return <div className="p-8 text-sm text-ink/50">No client workspace is linked to this account.</div>;
  if (error) return <div className="p-8 text-sm text-red-600">Failed to load tasks: {error}</div>;
  if (!loaded) return <div className="p-8 text-sm text-ink/50">Loading tasks...</div>;
  if (!timeline.clickup?.connected) {
    return <div className="p-8 text-sm text-ink/50">Project tasks aren&apos;t connected for your account yet.</div>;
  }

  return (
    <div className="p-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-ink">Project Tasks</h1>
        <p className="mt-1 text-sm text-ink/50">
          {timeline.clickup.folderName || timeline.clickup.workspaceName || "Synced project tasks"}
        </p>
      </div>

      <div data-tutorial="tasks-viewer" className="space-y-4">
        {listGroups.length === 0 ? (
          <EmptyState
            icon={<ClipboardList className="h-8 w-8" />}
            title="No tasks yet"
            description="Tasks will appear here once they're synced."
            dashed
          />
        ) : (
          listGroups.map((group) => {
            const taskCount = countTaskNodes(group.tasks);
            const expanded = expandedIds.has(group.id);
            return (
              <Card key={group.id}>
                <CardHeader
                  onClick={() => toggleExpanded(group.id)}
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
                    {taskCount} task{taskCount === 1 ? "" : "s"}
                  </span>
                </CardHeader>
                {expanded && (
                  <CardBody className="p-0">
                    {group.tasks.length > 0 ? (
                      group.tasks.map((task) => <TaskRow key={task.id} task={task} depth={0} onSelect={setSelectedTask} />)
                    ) : (
                      <p className="px-4 py-6 text-center text-sm text-ink/45">No tasks in this list yet.</p>
                    )}
                  </CardBody>
                )}
              </Card>
            );
          })
        )}
      </div>

      <TaskDetailDialog task={selectedTask} onClose={() => setSelectedTask(null)} />
    </div>
  );
}
