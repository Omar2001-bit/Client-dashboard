import { ChevronRight } from "lucide-react";
import { ClickUpStatusBadge } from "@/components/clickup/ClickUpTaskDetail";
import type { ClickUpTaskNode } from "@/lib/clickupTasks";

export function TaskRow({ task, depth, onSelect }: { task: ClickUpTaskNode; depth: number; onSelect: (task: ClickUpTaskNode) => void }) {
  return (
    <div>
      <button
        type="button"
        onClick={() => onSelect(task)}
        className="flex w-full flex-wrap items-center justify-between gap-2 border-b border-ink/10 px-4 py-2.5 text-left last:border-b-0 hover:bg-ink/[0.02]"
        style={{ paddingLeft: `${16 + depth * 24}px` }}
      >
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-1.5">
            {depth === 0 ? (
              <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-ink/30" />
            ) : (
              <ChevronRight size={13} className="shrink-0 text-ink/40" />
            )}
            <p className="min-w-0 flex-1 truncate text-sm font-medium text-ink">{task.name}</p>
          </div>
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
