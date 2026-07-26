import { useMemo, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { ListChecks, Plus, Upload } from "lucide-react";
import { KPICard } from "@/components/ui/KPICard";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Select";
import { AuditFindingFilters } from "@/components/auditFindings/AuditFindingFilters";
import { AuditFindingList } from "@/components/auditFindings/AuditFindingList";
import { AuditFindingDetail } from "@/components/auditFindings/AuditFindingDetail";
import { AuditFindingFormDialog } from "@/components/auditFindings/AuditFindingFormDialog";
import { AuditFindingBulkUploadDialog } from "@/components/auditFindings/AuditFindingBulkUploadDialog";
import { useAuditFindings } from "@/hooks/useAuditFindings";
import { useAuthStore } from "@/store/authStore";
import {
  defaultAuditFindingFilters,
  filterFindings,
  sortFindings,
  markFindingProgress,
  setFindingNote,
  deleteFinding,
  restoreFinding,
  type AuditFindingSortKey,
} from "@/lib/auditFindings";
import type { FixProgressStatus } from "@/types";

export function AdminAuditFindingsPage() {
  const { clientId } = useParams<{ clientId: string }>();
  const uid = useAuthStore((s) => s.user?.uid);
  const queryClient = useQueryClient();
  const { data: findings = [], isLoading } = useAuditFindings(clientId);

  const [filters, setFilters] = useState(defaultAuditFindingFilters);
  const [sortKey, setSortKey] = useState<AuditFindingSortKey>("severity");
  const [businessMode, setBusinessMode] = useState(false);
  const [formOpen, setFormOpen] = useState<"create" | "edit" | null>(null);
  const [bulkUploadOpen, setBulkUploadOpen] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedId = searchParams.get("findingId");

  const visible = useMemo(
    () => findings.filter((f) => !f.deleted || filters.deletedView !== "active"),
    [findings, filters.deletedView]
  );
  const filtered = useMemo(() => filterFindings(visible, filters, "admin"), [visible, filters]);
  const sorted = useMemo(() => sortFindings(filtered, sortKey), [filtered, sortKey]);
  const selected = findings.find((f) => f.id === selectedId) ?? null;

  const activeFindings = findings.filter((f) => !f.deleted);
  const fixedCount = activeFindings.filter((f) => f.progressStatus === "fixed").length;
  const notFixedCount = activeFindings.filter((f) => f.progressStatus === "notfixed").length;
  const total = activeFindings.length;

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["auditFindings", clientId] });

  const handleSelect = (id: string) => setSearchParams((prev) => {
    const next = new URLSearchParams(prev);
    next.set("findingId", id);
    return next;
  });

  const handleMarkProgress = async (status: FixProgressStatus) => {
    if (!clientId || !selectedId || !uid) return;
    await markFindingProgress(clientId, selectedId, status, uid);
    invalidate();
  };

  const handleNoteChange = async (note: string) => {
    if (!clientId || !selectedId || !uid) return;
    await setFindingNote(clientId, selectedId, note, uid);
    invalidate();
  };

  const handleDelete = async () => {
    if (!clientId || !selectedId || !uid) return;
    await deleteFinding(clientId, selectedId, uid);
    invalidate();
  };

  const handleRestore = async () => {
    if (!clientId || !selectedId || !uid) return;
    await restoreFinding(clientId, selectedId, uid);
    invalidate();
  };

  // Conditionally mounted (not just `open`-toggled) so AuditFindingFormDialog's internal
  // form state — seeded once from `finding` via a useState initializer — is guaranteed
  // fresh every time it opens, instead of persisting stale values from a prior open.
  const formDialog = clientId && uid && formOpen !== null && (
    <AuditFindingFormDialog
      open
      onClose={() => setFormOpen(null)}
      clientId={clientId}
      uid={uid}
      finding={formOpen === "edit" ? selected : null}
      onSaved={(id) => {
        invalidate();
        if (formOpen === "create") handleSelect(id);
      }}
    />
  );

  // Same conditional-mount reasoning as formDialog above.
  const bulkUploadDialog = clientId && uid && bulkUploadOpen && (
    <AuditFindingBulkUploadDialog
      open
      onClose={() => setBulkUploadOpen(false)}
      clientId={clientId}
      uid={uid}
      onImported={() => invalidate()}
    />
  );

  if (isLoading) return <div className="p-8 text-ink/40">Loading audit findings…</div>;

  if (findings.length === 0) {
    return (
      <div className="p-8 text-center text-sm text-ink/50 space-y-4">
        <p>
          No audit findings yet. Run <code>scripts/importAuditFindings.js</code> to bulk-import from a prior audit,
          or add one directly.
        </p>
        <div className="flex items-center justify-center gap-2">
          <Button variant="primary" size="sm" onClick={() => setFormOpen("create")} className="flex items-center gap-1.5">
            <Plus className="h-4 w-4" /> New finding
          </Button>
          <Button variant="secondary" size="sm" onClick={() => setBulkUploadOpen(true)} className="flex items-center gap-1.5">
            <Upload className="h-4 w-4" /> Bulk upload CSV
          </Button>
        </div>
        {formDialog}
        {bulkUploadDialog}
      </div>
    );
  }

  return (
    <div className="p-6 space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <KPICard title="Total findings" value={String(total)} icon={<ListChecks className="h-4 w-4" />} />
        <KPICard title="Fixed" value={String(fixedCount)} />
        <KPICard title="Not fixed" value={String(notFixedCount)} />
        <KPICard title="Completion" value={total > 0 ? `${Math.round((fixedCount / total) * 100)}%` : "—"} />
      </div>

      <AuditFindingFilters findings={findings} filters={filters} onChange={setFilters} mode="admin" />

      <div className="flex items-center justify-end gap-3">
        <Button variant="secondary" size="sm" onClick={() => setBulkUploadOpen(true)} className="flex items-center gap-1.5">
          <Upload className="h-4 w-4" /> Bulk upload CSV
        </Button>
        <Button variant="primary" size="sm" onClick={() => setFormOpen("create")} className="flex items-center gap-1.5">
          <Plus className="h-4 w-4" /> New finding
        </Button>
        <Select
          value={sortKey}
          onChange={(e) => setSortKey(e.target.value as AuditFindingSortKey)}
          className="sm:w-48"
        >
          <option value="severity">Sort by severity</option>
          <option value="tool">Sort by tool</option>
          <option value="progress">Sort by progress</option>
        </Select>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[380px_1fr] rounded-brand border border-ink/10 bg-white overflow-hidden" style={{ height: "70vh" }}>
        <div className="border-b lg:border-b-0 lg:border-r border-ink/10 h-full">
          <AuditFindingList findings={sorted} selectedId={selectedId} onSelect={handleSelect} businessMode={businessMode} />
        </div>
        <AuditFindingDetail
          key={selected?.id}
          finding={selected}
          mode="admin"
          businessMode={businessMode}
          onToggleBusinessMode={() => setBusinessMode((v) => !v)}
          onMarkProgress={handleMarkProgress}
          onNoteChange={handleNoteChange}
          onDelete={handleDelete}
          onRestore={handleRestore}
          onEdit={selected ? () => setFormOpen("edit") : undefined}
        />
      </div>

      {formDialog}
      {bulkUploadDialog}
    </div>
  );
}
