import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { ListChecks } from "lucide-react";
import { KPICard } from "@/components/ui/KPICard";
import { Select } from "@/components/ui/Select";
import { AuditFindingFilters } from "@/components/auditFindings/AuditFindingFilters";
import { AuditFindingList } from "@/components/auditFindings/AuditFindingList";
import { AuditFindingDetail } from "@/components/auditFindings/AuditFindingDetail";
import { useAuditFindings } from "@/hooks/useAuditFindings";
import { useAuthStore } from "@/store/authStore";
import { useScrollDepth } from "@/hooks/useScrollDepth";
import { track } from "@/lib/activityTracker";
import {
  defaultAuditFindingFilters,
  filterFindings,
  isVisibleToClient,
  sortFindings,
  type AuditFindingSortKey,
} from "@/lib/auditFindings";

export function AuditFindingsPage() {
  const clientId = useAuthStore((s) => s.clientId);
  const authLoading = useAuthStore((s) => s.loading);
  const { data: findings = [], isLoading } = useAuditFindings(authLoading ? null : clientId);
  useScrollDepth();

  const [filters, setFilters] = useState(defaultAuditFindingFilters);
  const [sortKey, setSortKey] = useState<AuditFindingSortKey>("severity");
  const [businessMode, setBusinessMode] = useState(true);
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedId = searchParams.get("findingId");

  const visible = useMemo(() => findings.filter(isVisibleToClient), [findings]);
  const filtered = useMemo(() => filterFindings(visible, filters, "client"), [visible, filters]);
  const sorted = useMemo(() => sortFindings(filtered, sortKey), [filtered, sortKey]);
  const selected = visible.find((f) => f.id === selectedId) ?? null;

  const fixedCount = visible.filter((f) => f.progressStatus === "fixed").length;
  const total = visible.length;

  const handleSelect = (id: string) => {
    track({ type: "audit_finding_view", metadata: { findingId: id } });
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set("findingId", id);
      return next;
    });
  };

  const handleFilterChange = (next: typeof filters) => {
    track({ type: "audit_filter_change", metadata: { ...next } });
    setFilters(next);
  };

  if (isLoading) return <div className="p-8 text-ink/40">Loading audit findings…</div>;

  if (findings.length === 0) {
    return (
      <div className="p-8">
        <h1 className="text-2xl font-bold text-ink tracking-tight">Audit Findings</h1>
        <p className="mt-4 text-sm text-ink/50">No audit findings have been shared with you yet.</p>
      </div>
    );
  }

  return (
    <div className="p-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-ink tracking-tight">Audit Findings</h1>
        <p className="mt-1 text-sm text-ink/50">Track the progress of fixes from your tracking &amp; analytics audit.</p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
        <KPICard title="Total findings" value={String(total)} icon={<ListChecks className="h-4 w-4" />} />
        <KPICard title="Fixed" value={String(fixedCount)} />
        <KPICard title="Completion" value={total > 0 ? `${Math.round((fixedCount / total) * 100)}%` : "—"} />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <AuditFindingFilters findings={visible} filters={filters} onChange={handleFilterChange} mode="client" />
        <Select
          value={sortKey}
          onChange={(e) => setSortKey(e.target.value as AuditFindingSortKey)}
          className="sm:w-48"
        >
          <option value="severity">Sort by severity</option>
          <option value="sourceTab">Sort by tab</option>
          <option value="tool">Sort by tool</option>
          <option value="progress">Sort by progress</option>
        </Select>
      </div>

      <div
        className="grid grid-cols-1 lg:grid-cols-[380px_1fr] rounded-brand border border-ink/10 bg-white overflow-hidden"
        style={{ height: "70vh" }}
        data-tutorial="audit-findings-list"
      >
        <div className="border-b lg:border-b-0 lg:border-r border-ink/10 h-full min-h-0">
          <AuditFindingList findings={sorted} selectedId={selectedId} onSelect={handleSelect} businessMode={businessMode} />
        </div>
        <AuditFindingDetail
          key={selected?.id}
          finding={selected}
          mode="client"
          businessMode={businessMode}
          onToggleBusinessMode={() => setBusinessMode((v) => !v)}
        />
      </div>
    </div>
  );
}
