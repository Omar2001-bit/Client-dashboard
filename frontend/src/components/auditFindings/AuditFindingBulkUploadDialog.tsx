import { useRef, useState } from "react";
import { Download, Upload as UploadIcon } from "lucide-react";
import { Dialog } from "@/components/ui/Dialog";
import { Button } from "@/components/ui/Button";
import { bulkCreateFindings } from "@/lib/auditFindings";
import { buildAuditFindingsCsvTemplate, parseAuditFindingsCsv, type AuditFindingCsvParseResult } from "@/lib/auditFindingsCsv";

interface Props {
  open: boolean;
  onClose: () => void;
  clientId: string;
  uid: string;
  onImported: (count: number) => void;
}

const MAX_ERRORS_SHOWN = 10;

function downloadTemplate() {
  const blob = new Blob([buildAuditFindingsCsvTemplate()], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "audit-findings-template.csv";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function AuditFindingBulkUploadDialog({ open, onClose, clientId, uid, onImported }: Props) {
  const [fileName, setFileName] = useState<string | null>(null);
  const [result, setResult] = useState<AuditFindingCsvParseResult | null>(null);
  const [parsing, setParsing] = useState(false);
  const [saving, setSaving] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setParsing(true);
    const text = await file.text();
    setResult(parseAuditFindingsCsv(text));
    setParsing(false);
  };

  const handleImport = async () => {
    if (!result || result.rows.length === 0) return;
    setSaving(true);
    const ids = await bulkCreateFindings(clientId, result.rows, uid);
    setSaving(false);
    onImported(ids.length);
    onClose();
  };

  const errorsShown = result?.errors.slice(0, MAX_ERRORS_SHOWN) ?? [];
  const extraErrorCount = (result?.errors.length ?? 0) - errorsShown.length;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Bulk upload findings from CSV"
      className="max-w-xl"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            loading={saving}
            disabled={!result || result.rows.length === 0}
            onClick={handleImport}
          >
            {result ? `Import ${result.rows.length} finding${result.rows.length === 1 ? "" : "s"}` : "Import"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="flex items-start justify-between gap-3 rounded-xl border border-ink/10 bg-canvas p-3">
          <div className="text-sm text-ink/70">
            Not sure of the format? Download a template with the expected columns and one filled example row.
          </div>
          <Button variant="secondary" size="sm" onClick={downloadTemplate} className="flex shrink-0 items-center gap-1.5">
            <Download className="h-4 w-4" /> Template
          </Button>
        </div>

        <div>
          <label className="block text-sm font-medium text-ink/80 mb-1">CSV file</label>
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,text/csv"
            onChange={handleFileChange}
            className="block w-full rounded-xl border border-ink/15 bg-white px-3.5 py-2.5 text-sm text-ink file:mr-3 file:rounded-lg file:border-0 file:bg-ink/5 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-ink hover:file:bg-ink/10"
          />
          {fileName && !parsing && result && (
            <p className="mt-1 text-xs text-ink/50">
              {fileName} — {result.rows.length} row{result.rows.length === 1 ? "" : "s"} ready
              {result.errors.length > 0 ? `, ${result.errors.length} skipped` : ""}
            </p>
          )}
          {parsing && <p className="mt-1 text-xs text-ink/50">Reading {fileName}…</p>}
        </div>

        {result && result.errors.length > 0 && (
          <div className="rounded-xl border border-red-200 bg-red-50 p-3">
            <p className="text-xs font-semibold text-red-700 mb-1">
              {result.errors.length} row{result.errors.length === 1 ? "" : "s"} will be skipped:
            </p>
            <ul className="space-y-0.5 text-xs text-red-700">
              {errorsShown.map((err) => (
                <li key={err.row}>
                  Row {err.row}: {err.message}
                </li>
              ))}
            </ul>
            {extraErrorCount > 0 && <p className="mt-1 text-xs text-red-700/70">…and {extraErrorCount} more.</p>}
          </div>
        )}

        {result && result.rows.length === 0 && result.errors.length === 0 && (
          <p className="flex items-center gap-1.5 text-sm text-ink/50">
            <UploadIcon className="h-4 w-4" /> No rows found in that file.
          </p>
        )}
      </div>
    </Dialog>
  );
}
