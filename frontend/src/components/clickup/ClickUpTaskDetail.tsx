import { Dialog } from "@/components/ui/Dialog";
import type { ClickUpTask } from "@/types";

export function ClickUpStatusBadge({ status, statusColor }: { status?: string; statusColor?: string | null }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-ink/5 px-2.5 py-0.5 text-xs font-medium text-ink/70">
      <span className="h-2 w-2 rounded-full" style={{ backgroundColor: statusColor || "#9CA3AF" }} />
      {status || "No status"}
    </span>
  );
}

export function TaskDetailDialog({ task, onClose }: { task: ClickUpTask | null; onClose: () => void }) {
  return (
    <Dialog open={task != null} onClose={onClose} title={task?.name} className="max-w-lg">
      {task && (
        <div className="space-y-4">
          <ClickUpStatusBadge status={task.status} statusColor={task.statusColor} />

          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-ink/40">Description</p>
            <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-ink/70">
              {task.description?.trim() || "No description provided."}
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-ink/40">Assigned to</p>
              <p className="mt-1 text-sm text-ink/70">
                {task.assigneeNames?.length ? task.assigneeNames.join(", ") : "Unassigned"}
              </p>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-ink/40">Dates</p>
              <p className="mt-1 text-sm text-ink/70">
                {task.startDate ? `Start ${task.startDate}` : "No start date"}
                <br />
                {task.dueDate ? `Due ${task.dueDate}` : "No due date"}
              </p>
            </div>
          </div>
        </div>
      )}
    </Dialog>
  );
}
