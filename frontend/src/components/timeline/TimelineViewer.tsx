import { useMemo } from "react";
import { CalendarDays, ChevronRight, ExternalLink, ListChecks } from "lucide-react";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { formatTimelineDate, getPhaseLayout, getTimelineBounds, getTimelineTicks, sortPhases, toDateKey } from "@/lib/timeline";
import type { ClickUpTask, TimelinePhase } from "@/types";

interface Props {
  clientName?: string;
  contractStartDate?: string;
  contractEndDate?: string;
  phases: TimelinePhase[];
  selectedPhaseId: string | null;
  onSelectPhase: (phaseId: string) => void;
  phaseTasks?: Record<string, ClickUpTask[]>;
  emptyTitle?: string;
  emptySubtitle?: string;
}

export function TimelineViewer({
  clientName,
  contractStartDate,
  contractEndDate,
  phases,
  selectedPhaseId,
  onSelectPhase,
  phaseTasks,
  emptyTitle = "No timeline phases have been created yet.",
  emptySubtitle = "The admin needs to build the engagement timeline first.",
}: Props) {
  const sortedPhases = useMemo(() => sortPhases(phases), [phases]);
  const selectedPhase = sortedPhases.find((phase) => phase.id === selectedPhaseId) ?? sortedPhases[0] ?? null;

  const bounds = useMemo(() => {
    const start = contractStartDate ?? sortedPhases[0]?.startDate ?? toDateKey(new Date());
    const end = contractEndDate ?? sortedPhases[sortedPhases.length - 1]?.endDate;
    return getTimelineBounds(start, end, sortedPhases);
  }, [contractEndDate, contractStartDate, sortedPhases]);
  const ticks = useMemo(() => getTimelineTicks(bounds.start, bounds.end, 6), [bounds.end, bounds.start]);

  return (
    <div className="space-y-6">
      {(clientName || contractStartDate || contractEndDate) && (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            {clientName && <h1 className="text-2xl font-bold text-ink">{clientName}</h1>}
            <p className="mt-1 text-sm text-ink/50">Built by the admin for the full engagement period.</p>
          </div>
          <div className="rounded-xl border border-ink/10 bg-white px-4 py-3 text-sm text-ink/60 shadow-[0_1px_3px_rgba(14,28,38,0.04)]">
            <div className="flex items-center gap-2 font-medium text-ink">
              <CalendarDays className="h-4 w-4 text-brand-700" />
              {formatTimelineDate(contractStartDate)}
              <ChevronRight className="h-4 w-4 text-ink/30" />
              {formatTimelineDate(contractEndDate)}
            </div>
          </div>
        </div>
      )}

      <Card>
        <CardHeader className="flex items-center justify-between">
          <div>
            <h2 className="font-semibold text-ink">Timeline / Gantt Chart</h2>
            <p className="mt-1 text-xs text-ink/45">Click any phase to inspect the description and deliverables.</p>
          </div>
          <div className="inline-flex items-center gap-2 rounded-full bg-ink/[0.02] px-3 py-1 text-xs font-medium text-ink/60">
            <CalendarDays className="h-3.5 w-3.5" />
            {sortedPhases.length} phases
          </div>
        </CardHeader>
        <CardBody className="space-y-4">
          {sortedPhases.length > 0 ? (
            <div className="overflow-x-auto">
              <div className="min-w-[920px] space-y-3">
                <div className="grid grid-cols-[220px_140px_1fr] gap-3 text-[11px] font-semibold uppercase tracking-wide text-ink/40">
                  <div>Phase</div>
                  <div>Range</div>
                  <div className="relative h-10 rounded-xl border border-ink/10 bg-ink/[0.02]">
                    {ticks.map((tick, index) => (
                      <div
                        key={`${tick.label}-${index}`}
                        className="absolute inset-y-0 flex -translate-x-1/2 flex-col justify-start"
                        style={{ left: `${tick.left}%` }}
                      >
                        <span className="whitespace-nowrap pt-1 text-[10px] font-medium normal-case tracking-normal text-ink/45">
                          {tick.label}
                        </span>
                        <span className="mt-auto h-full w-px bg-ink/10" />
                      </div>
                    ))}
                  </div>
                </div>
                <div className="space-y-2">
              {sortedPhases.map((phase) => {
                const layout = getPhaseLayout(phase, bounds.start, bounds.end);
                const active = selectedPhase?.id === phase.id;
                return (
                  <button
                    key={phase.id}
                    type="button"
                    onClick={() => onSelectPhase(phase.id)}
                    className={`grid w-full grid-cols-[220px_140px_1fr] items-center gap-3 rounded-2xl border px-3 py-3 text-left transition-colors ${
                      active ? "border-brand-300 bg-brand-50/60" : "border-ink/10 bg-white hover:bg-ink/[0.02]"
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <span className="h-10 w-1.5 rounded-full" style={{ backgroundColor: phase.color }} />
                      <div>
                        <p className="font-medium text-ink">{phase.title || "Untitled phase"}</p>
                        <p className="text-xs text-ink/45 truncate">{phase.description || "No description provided."}</p>
                      </div>
                    </div>
                    <div className="text-sm text-ink/60">
                      {formatTimelineDate(phase.startDate)}
                      <span className="mx-1 text-ink/30">-</span>
                      {formatTimelineDate(phase.endDate)}
                    </div>
                    <div className="relative h-12 overflow-hidden rounded-xl border border-ink/10 bg-ink/[0.02]">
                      {ticks.map((tick, index) => (
                        <div
                          key={`${phase.id}-${index}`}
                          className="absolute inset-y-0 w-px bg-ink/10"
                          style={{ left: `${tick.left}%` }}
                        />
                      ))}
                      <div
                        className="absolute inset-y-1 rounded-full shadow-sm ring-1 ring-black/5"
                        style={{
                          left: `${layout.left}%`,
                          width: `${layout.width}%`,
                          backgroundColor: phase.color,
                        }}
                      />
                      <div className="absolute inset-x-0 bottom-0 h-1 bg-ink/[0.02]" />
                    </div>
                  </button>
                );
              })}
                </div>
              </div>
            </div>
          ) : (
            <div className="rounded-2xl border border-dashed border-ink/15 bg-ink/[0.02] p-10 text-center">
              <CalendarDays className="mx-auto mb-3 h-8 w-8 text-ink/20" />
              <p className="text-sm font-medium text-ink">{emptyTitle}</p>
              <p className="mt-1 text-sm text-ink/45">{emptySubtitle}</p>
            </div>
          )}
        </CardBody>
      </Card>

      <div className="grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
        <Card>
          <CardHeader>
            <h2 className="font-semibold text-ink">Selected Phase</h2>
          </CardHeader>
          <CardBody>
            {selectedPhase ? (
              <div className="space-y-4">
                <div className="flex items-center gap-3">
                  <span className="h-12 w-12 rounded-2xl" style={{ backgroundColor: selectedPhase.color }} />
                  <div>
                    <p className="text-lg font-semibold text-ink">{selectedPhase.title}</p>
                    <p className="text-sm text-ink/50">
                      {formatTimelineDate(selectedPhase.startDate)} - {formatTimelineDate(selectedPhase.endDate)}
                    </p>
                  </div>
                </div>
                <div className="rounded-2xl bg-ink/[0.02] p-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-ink/40">What happens in this phase</p>
                  <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-ink/70">
                    {selectedPhase.description?.trim() || "No description was added for this phase."}
                  </p>
                </div>
                <div className="rounded-2xl bg-ink/[0.02] p-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-ink/40">Deliverables</p>
                  {selectedPhase.deliverables?.length ? (
                    <ul className="mt-2 space-y-2 text-sm text-ink/70">
                      {selectedPhase.deliverables.map((item) => (
                        <li key={item} className="flex gap-2">
                          <span className="mt-2 h-1.5 w-1.5 rounded-full bg-ink/30" />
                          <span>{item}</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-2 text-sm text-ink/45">No deliverables were listed.</p>
                  )}
                </div>
                {phaseTasks?.[selectedPhase.id]?.length ? (
                  <div className="rounded-2xl bg-ink/[0.02] p-4">
                    <p className="text-xs font-semibold uppercase tracking-wide text-ink/40">ClickUp Tasks</p>
                    <div className="mt-2 space-y-2">
                      {phaseTasks[selectedPhase.id].map((task) => (
                        <div key={task.id} className="rounded-xl border border-ink/10 bg-white px-3 py-2">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <p className="text-sm font-medium text-ink">{task.name}</p>
                              <p className="text-xs text-ink/45">
                                {task.status || "Unknown status"}
                                {task.dueDate ? ` - Due ${task.dueDate}` : ""}
                              </p>
                              {task.listName && <p className="text-xs text-ink/40">{task.listName}</p>}
                            </div>
                            {task.url && (
                              <a
                                href={task.url}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex items-center gap-1 text-xs font-medium text-brand-700 hover:text-brand-800"
                              >
                                Open
                                <ExternalLink className="h-3 w-3" />
                              </a>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="rounded-2xl border border-dashed border-ink/15 bg-ink/[0.02] p-8 text-center">
                <ListChecks className="mx-auto mb-3 h-8 w-8 text-ink/20" />
                <p className="text-sm font-medium text-ink">Select a phase to see the details.</p>
              </div>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <h2 className="font-semibold text-ink">All Deliverables</h2>
          </CardHeader>
          <CardBody className="space-y-3">
            {sortedPhases.length > 0 ? (
              sortedPhases.map((phase) => (
                <button
                  key={phase.id}
                  type="button"
                  onClick={() => onSelectPhase(phase.id)}
                  className={`w-full rounded-2xl border px-4 py-3 text-left transition-colors ${
                    selectedPhase?.id === phase.id ? "border-brand-300 bg-brand-50/50" : "border-ink/10 hover:bg-ink/[0.02]"
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <span className="mt-1 h-3.5 w-3.5 rounded-full shrink-0" style={{ backgroundColor: phase.color }} />
                    <div className="min-w-0">
                      <p className="font-medium text-ink">{phase.title}</p>
                      <p className="text-xs text-ink/45">{formatTimelineDate(phase.startDate)} - {formatTimelineDate(phase.endDate)}</p>
                      <p className="mt-1 text-sm text-ink/60 truncate">{phase.description || "No description provided."}</p>
                    </div>
                  </div>
                </button>
              ))
            ) : (
              <p className="text-sm text-ink/45">No deliverables to display.</p>
            )}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
