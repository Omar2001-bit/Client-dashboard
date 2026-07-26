import { ClickUpStatusBadge } from "@/components/clickup/ClickUpTaskDetail";
import type { ClickUpTaskNode } from "@/lib/clickupTasks";

export function TaskRow({ task, depth, onSelect }: { task: ClickUpTaskNode; depth: number; onSelect: (task: ClickUpTaskNode) => void }) {
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
