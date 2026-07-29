import { useState } from "react";
import { ChevronLeft, ChevronRight, StickyNote, AlertTriangle, Trash2 } from "lucide-react";
import { clsx } from "clsx";
import { AuditSeverityBadge } from "@/components/ui/AuditSeverityBadge";
import { FixProgressBadge } from "@/components/ui/FixProgressBadge";
import { Checkbox } from "@/components/ui/Checkbox";
import { requiresManualReview } from "@/lib/auditFindings";
import type { AuditFindingDoc } from "@/types";

const PAGE_SIZE = 50;

interface Props {
  findings: AuditFindingDoc[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  businessMode: boolean;
  // Selection/delete are admin-only affordances — omitted entirely (no checkboxes,
  // no select-all header, no trash icon) when the caller doesn't pass them, e.g.
  // the read-only client-facing findings list.
  selectedIds?: Set<string>;
  onToggleSelect?: (id: string) => void;
  onToggleSelectPage?: (ids: string[], checked: boolean) => void;
  onDeleteOne?: (id: string) => void;
}

const EMPTY_SELECTION: Set<string> = new Set();

export function AuditFindingList({
  findings,
  selectedId,
  onSelect,
  businessMode,
  selectedIds = EMPTY_SELECTION,
  onToggleSelect,
  onToggleSelectPage,
  onDeleteOne,
}: Props) {
  const [page, setPage] = useState(0);
  // Reset to page 0 whenever the filtered/sorted set changes identity (new
  // filters, new sort, new data) — adjusting state during render like this,
  // rather than in a useEffect, avoids an extra commit/re-render pass.
  const [prevFindings, setPrevFindings] = useState(findings);
  if (findings !== prevFindings) {
    setPrevFindings(findings);
    setPage(0);
  }

  const totalPages = Math.max(1, Math.ceil(findings.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages - 1);
  const pageItems = findings.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE);

  const pageIds = pageItems.map((f) => f.id);
  const allPageSelected = pageIds.length > 0 && pageIds.every((id) => selectedIds.has(id));

  return (
    <div className="flex flex-col h-full min-h-0">
      {pageItems.length > 0 && onToggleSelectPage && (
        <div className="flex items-center gap-2 border-b border-ink/10 px-4 py-2 shrink-0">
          <Checkbox
            checked={allPageSelected}
            onChange={(e) => onToggleSelectPage(pageIds, e.target.checked)}
          />
          <span className="text-xs text-ink/50">Select all on this page</span>
        </div>
      )}
      <div className="flex-1 min-h-0 overflow-y-auto divide-y divide-ink/5">
        {pageItems.length === 0 && (
          <div className="px-4 py-12 text-center text-sm text-ink/50">No findings match these filters.</div>
        )}
        {pageItems.map((finding) => {
          const title = (businessMode && finding.businessIssue ? finding.businessIssue : finding.issue) || finding.issueId;
          return (
            <div
              key={finding.id}
              className={clsx(
                "group flex items-start gap-2 px-4 py-3 transition-colors hover:bg-ink/[0.03]",
                selectedId === finding.id && "bg-brand-50"
              )}
            >
              {onToggleSelect && (
                <Checkbox
                  checked={selectedIds.has(finding.id)}
                  onChange={() => onToggleSelect(finding.id)}
                  className="mt-1"
                />
              )}
              <button type="button" onClick={() => onSelect(finding.id)} className="min-w-0 flex-1 text-left">
                <div className="flex items-center gap-2 text-[11px] uppercase tracking-wide text-ink/40">
                  <span>{finding.tool}</span>
                  {requiresManualReview(finding) && <AlertTriangle className="h-3 w-3 text-amber-500" />}
                  {finding.note && <StickyNote className="h-3 w-3 text-amber-400" />}
                </div>
                <div className="mt-1 text-sm font-medium text-ink line-clamp-2">{title}</div>
                <div className="mt-2 flex items-center gap-1.5">
                  <AuditSeverityBadge status={finding.auditStatus} />
                  <FixProgressBadge status={finding.progressStatus} />
                </div>
              </button>
              {onDeleteOne && (
                <button
                  type="button"
                  aria-label="Delete finding"
                  onClick={() => onDeleteOne(finding.id)}
                  className="shrink-0 rounded-lg p-1.5 text-ink/30 opacity-0 transition-colors hover:bg-red-50 hover:text-red-600 group-hover:opacity-100"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          );
        })}
      </div>

      {findings.length > 0 && (
        <div className="flex items-center justify-between border-t border-ink/10 px-4 py-2.5 shrink-0">
          <p className="text-xs text-ink/50">
            {currentPage * PAGE_SIZE + 1}–{Math.min((currentPage + 1) * PAGE_SIZE, findings.length)} of {findings.length}
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage(currentPage - 1)}
              disabled={currentPage === 0}
              className="rounded-xl border border-ink/15 p-1.5 text-ink/60 transition-colors hover:bg-ink/5 disabled:cursor-not-allowed disabled:opacity-30"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="text-xs font-semibold text-ink/70">
              {currentPage + 1} / {totalPages}
            </span>
            <button
              onClick={() => setPage(currentPage + 1)}
              disabled={currentPage >= totalPages - 1}
              className="rounded-xl border border-ink/15 p-1.5 text-ink/60 transition-colors hover:bg-ink/5 disabled:cursor-not-allowed disabled:opacity-30"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
