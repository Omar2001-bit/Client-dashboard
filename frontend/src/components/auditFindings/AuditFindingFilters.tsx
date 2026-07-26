import { useMemo } from "react";
import { Search } from "lucide-react";
import { Select } from "@/components/ui/Select";
import { Input } from "@/components/ui/Input";
import type { AuditFindingDoc, AuditSeverity, FixProgressStatus } from "@/types";
import type { AuditFindingFilterState } from "@/lib/auditFindings";

const SEVERITIES: AuditSeverity[] = ["Critical", "High", "Action Needed", "Unable to Verify", "Correct"];
const PROGRESS_STATUSES: FixProgressStatus[] = ["unreviewed", "fixed", "notfixed"];
const PROGRESS_LABELS: Record<FixProgressStatus, string> = {
  unreviewed: "Not reviewed",
  fixed: "Fixed",
  notfixed: "Not fixed",
};

interface Props {
  findings: AuditFindingDoc[];
  filters: AuditFindingFilterState;
  onChange: (next: AuditFindingFilterState) => void;
  mode: "admin" | "client";
}

export function AuditFindingFilters({ findings, filters, onChange, mode }: Props) {
  const tools = useMemo(() => Array.from(new Set(findings.map((f) => f.tool))).sort(), [findings]);
  const sourceTabs = useMemo(() => Array.from(new Set(findings.map((f) => f.sourceTab))).sort(), [findings]);

  const set = <K extends keyof AuditFindingFilterState>(key: K, value: AuditFindingFilterState[K]) =>
    onChange({ ...filters, [key]: value });

  return (
    <div className="flex flex-col gap-3">
      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-2.5 h-4 w-4 text-ink/40 z-10" />
        <Input
          type="text"
          placeholder="Search findings..."
          value={filters.search}
          onChange={(e) => set("search", e.target.value)}
          className="pl-9"
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Select value={filters.tool} onChange={(e) => set("tool", e.target.value)} className="w-auto">
          <option value="">All tools</option>
          {tools.map((tool) => (
            <option key={tool} value={tool}>
              {tool}
            </option>
          ))}
        </Select>

        <Select
          value={filters.sourceTab}
          onChange={(e) => set("sourceTab", e.target.value)}
          className="w-auto"
        >
          <option value="">All source tabs</option>
          {sourceTabs.map((tab) => (
            <option key={tab} value={tab}>
              {tab}
            </option>
          ))}
        </Select>

        <Select
          value={filters.auditStatus}
          onChange={(e) => set("auditStatus", e.target.value as AuditSeverity | "")}
          className="w-auto"
        >
          <option value="">All severities</option>
          {SEVERITIES.map((severity) => (
            <option key={severity} value={severity}>
              {severity}
            </option>
          ))}
        </Select>

        <Select
          value={filters.progressStatus}
          onChange={(e) => set("progressStatus", e.target.value as FixProgressStatus | "")}
          className="w-auto"
        >
          <option value="">All progress</option>
          {PROGRESS_STATUSES.map((status) => (
            <option key={status} value={status}>
              {PROGRESS_LABELS[status]}
            </option>
          ))}
        </Select>

        <label className="flex items-center gap-2 text-sm text-ink/70">
          <input
            type="checkbox"
            checked={filters.manualReviewOnly}
            onChange={(e) => set("manualReviewOnly", e.target.checked)}
            className="rounded border-ink/30"
          />
          Needs manual review
        </label>

        {mode === "admin" && (
          <>
            <label className="flex items-center gap-2 text-sm text-ink/70">
              <input
                type="checkbox"
                checked={filters.showCorrectAndChecklist}
                onChange={(e) => set("showCorrectAndChecklist", e.target.checked)}
                className="rounded border-ink/30"
              />
              Show Correct/Checklist rows
            </label>

            <Select
              value={filters.deletedView}
              onChange={(e) => set("deletedView", e.target.value as AuditFindingFilterState["deletedView"])}
              className="w-auto"
            >
              <option value="active">Active</option>
              <option value="deleted">Deleted</option>
              <option value="all">All</option>
            </Select>
          </>
        )}
      </div>
    </div>
  );
}
