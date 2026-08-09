import { useMemo, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { ListChecks, Plus, Upload } from "lucide-react";
import { KPICard } from "@/components/ui/KPICard";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Select";
import { Alert } from "@/components/ui/Alert";
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
  bulkDeleteFindings,
  type AuditFindingSortKey,
  type AuditFindingFilterState,
  type AuditImportResult,
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
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [importMessage, setImportMessage] = useState("");

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
  const notReviewedCount = activeFindings.filter((f) => f.progressStatus === "unreviewed").length;
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

  const handleFiltersChange = (next: AuditFindingFilterState) => {
    setFilters(next);
    setSelectedIds(new Set());
  };

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectPage = (ids: string[], checked: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      for (const id of ids) {
        if (checked) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  };

  const handleDeleteOne = async (id: string) => {
    if (!clientId || !uid) return;
    await deleteFinding(clientId, id, uid);
    setSelectedIds((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
    invalidate();
  };

  const handleBulkDelete = async () => {
    if (!clientId || !uid || selectedIds.size === 0) return;
    await bulkDeleteFindings(clientId, [...selectedIds], uid);
    setSelectedIds(new Set());
    invalidate();
  };

  const handleImported = (result: AuditImportResult) => {
    const parts: string[] = [];
    if (result.created > 0) parts.push(`${result.created} new`);
    if (result.updated > 0) parts.push(`${result.updated} updated`);
    if (result.replaced > 0) parts.push(`${result.replaced} replaced`);
    setImportMessage(parts.length > 0 ? `Import complete — ${parts.join(", ")}.` : "Import complete — no rows found.");
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
      onImported={handleImported}
    />
  );

  if (isLoading) return <div className="p-8 text-ink/40">Loading audit findings…</div>;

  if (findings.length === 0) {
    return (
      <div className="p-8 text-center text-sm text-ink/50 space-y-4">
        {importMessage && <Alert tone="info">{importMessage}</Alert>}
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
      {importMessage && <Alert tone="info">{importMessage}</Alert>}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
        <KPICard title="Total findings" value={String(total)} icon={<ListChecks className="h-4 w-4" />} />
        <KPICard title="Fixed" value={String(fixedCount)} />
        <KPICard title="Not fixed" value={String(notFixedCount)} />
        <KPICard title="Not reviewed" value={String(notReviewedCount)} />
        <KPICard title="Completion" value={total > 0 ? `${Math.round((fixedCount / total) * 100)}%` : "—"} />
      </div>

      <AuditFindingFilters findings={findings} filters={filters} onChange={handleFiltersChange} mode="admin" />

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

      {selectedIds.size > 0 && (
        <div className="flex items-center justify-between rounded-brand border border-ink/10 bg-ink/[0.02] px-4 py-2.5">
          <p className="text-sm font-medium text-ink/70">{selectedIds.size} selected</p>
          <div className="flex items-center gap-2">
            <Button variant="secondary" size="sm" onClick={() => setSelectedIds(new Set())}>
              Clear
            </Button>
            <Button variant="danger" size="sm" onClick={handleBulkDelete}>
              Delete selected
            </Button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[380px_1fr] rounded-brand border border-ink/10 bg-white overflow-hidden" style={{ height: "70vh" }}>
        <div className="border-b lg:border-b-0 lg:border-r border-ink/10 h-full min-h-0">
          <AuditFindingList
            findings={sorted}
            selectedId={selectedId}
            onSelect={handleSelect}
            businessMode={businessMode}
            selectedIds={selectedIds}
            onToggleSelect={toggleSelect}
            onToggleSelectPage={toggleSelectPage}
            onDeleteOne={handleDeleteOne}
          />
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
