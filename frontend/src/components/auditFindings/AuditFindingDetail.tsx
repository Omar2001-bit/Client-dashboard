import { useRef, useState } from "react";
import { Trash2, RotateCcw, CheckCircle2, XCircle, RefreshCcw, Pencil } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Checkbox } from "@/components/ui/Checkbox";
import { Textarea } from "@/components/ui/Textarea";
import { AuditSeverityBadge } from "@/components/ui/AuditSeverityBadge";
import { FixProgressBadge } from "@/components/ui/FixProgressBadge";
import type { AuditFindingDoc, FixProgressStatus } from "@/types";

interface Props {
  finding: AuditFindingDoc | null;
  mode: "admin" | "client";
  businessMode: boolean;
  onToggleBusinessMode: () => void;
  onMarkProgress?: (status: FixProgressStatus) => void;
  onNoteChange?: (note: string) => void;
  onDelete?: () => void;
  onRestore?: () => void;
  onEdit?: () => void;
}

function pick(businessMode: boolean, business: string | undefined, technical: string): string {
  return (businessMode && business ? business : technical) || "";
}

function DocsList({ docs }: { docs: string }) {
  const tokens = docs.split(/\s+/).filter(Boolean);
  return (
    <p className="text-sm text-ink/70 space-x-2">
      {tokens.map((token, i) =>
        /^https?:\/\//i.test(token) ? (
          <a key={i} href={token} target="_blank" rel="noopener noreferrer" className="text-brand-700 underline underline-offset-2 break-all">
            {token}
          </a>
        ) : (
          <span key={i}>{token}</span>
        )
      )}
    </p>
  );
}

export function AuditFindingDetail({
  finding,
  mode,
  businessMode,
  onToggleBusinessMode,
  onMarkProgress,
  onNoteChange,
  onDelete,
  onRestore,
  onEdit,
}: Props) {
  // Initial value only — the parent remounts this component (via key={finding.id})
  // whenever the selected finding changes, so this never needs to be reset in an effect.
  const [noteDraft, setNoteDraft] = useState(finding?.note ?? "");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Client-only, unpersisted — resets to hidden whenever the selected finding changes,
  // same as every other piece of local state here (component remounts via key={finding.id}).
  const [showFullDetails, setShowFullDetails] = useState(false);

  if (!finding) {
    return <div className="p-8 text-center text-sm text-ink/50">Select a finding to see details.</div>;
  }

  const title = pick(businessMode, finding.businessIssue, finding.issue);
  const explanation = pick(businessMode, finding.businessDetail, finding.detail || finding.technicalExplanation || "");
  // Fix/verify/docs/routing are hidden from clients by default (they're written with an
  // admin audience in mind) but not a security boundary — Firestore already lets the client
  // role read the full document. A client can reveal them for themselves via the checkbox
  // below. The note is different: it's meant to reach the client (see AuditFindingDoc.note's
  // "admin-write-only, client read-only" contract), just never editable by them — rendered
  // separately below regardless of showFullDetails. The action buttons stay admin-only.
  const showContentFields = mode === "admin" || (mode === "client" && showFullDetails);

  const handleNoteChange = (value: string) => {
    setNoteDraft(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => onNoteChange?.(value), 450);
  };

  return (
    <div className="p-6 space-y-6 overflow-y-auto h-full min-h-0">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[11px] uppercase tracking-wide text-ink/40">
            {finding.tool} · {finding.sourceTab}
          </div>
          <h2 className="mt-1 text-lg font-bold text-ink">{title}</h2>
          <div className="mt-2 flex items-center gap-1.5">
            <AuditSeverityBadge status={finding.auditStatus} />
            <FixProgressBadge status={finding.progressStatus} />
            {finding.deleted && <span className="text-xs text-red-600 font-medium">Deleted</span>}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          {mode === "client" && (
            <Checkbox
              label="Show full details"
              checked={showFullDetails}
              onChange={(e) => setShowFullDetails(e.target.checked)}
            />
          )}
          <button
            type="button"
            onClick={onToggleBusinessMode}
            className="rounded-xl border border-ink/15 px-3 py-1.5 text-xs font-medium text-ink/70 hover:bg-ink/5"
          >
            {businessMode ? "Show technical" : "Show plain-English"}
          </button>
        </div>
      </div>

      <div>
        <h3 className="text-sm font-semibold text-ink">Why it matters</h3>
        <p className="mt-1 text-sm text-ink/70 whitespace-pre-line">{explanation}</p>
      </div>

      {showContentFields && (
        <>
          <div>
            <h3 className="text-sm font-semibold text-ink">How to fix</h3>
            <p className="mt-1 text-sm text-ink/70 whitespace-pre-line">
              {pick(businessMode, finding.businessFix, finding.fix)}
            </p>
          </div>

          <div>
            <h3 className="text-sm font-semibold text-ink">How to verify</h3>
            <p className="mt-1 text-sm text-ink/70 whitespace-pre-line">
              {pick(businessMode, finding.businessVerify, finding.verify)}
            </p>
          </div>

          {finding.docs && (
            <div>
              <h3 className="text-sm font-semibold text-ink">Official docs</h3>
              <DocsList docs={finding.docs} />
            </div>
          )}

          {(finding.owner || finding.qaOutcome || finding.reviewStatus || finding.routingNote || finding.evidenceLink) && (
            <div>
              <h3 className="text-sm font-semibold text-ink">Routing details</h3>
              <dl className="mt-1 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-ink/60">
                {finding.owner && (
                  <>
                    <dt className="text-ink/40">Owner</dt>
                    <dd>{finding.owner}</dd>
                  </>
                )}
                {finding.reviewStatus && (
                  <>
                    <dt className="text-ink/40">Review status</dt>
                    <dd>{finding.reviewStatus}</dd>
                  </>
                )}
                {finding.qaOutcome && (
                  <>
                    <dt className="text-ink/40">QA outcome</dt>
                    <dd>{finding.qaOutcome}</dd>
                  </>
                )}
                {finding.routingNote && (
                  <>
                    <dt className="text-ink/40">Routing note</dt>
                    <dd>{finding.routingNote}</dd>
                  </>
                )}
                {finding.evidenceLink && (
                  <>
                    <dt className="text-ink/40">Evidence</dt>
                    <dd className="break-all">{finding.evidenceLink}</dd>
                  </>
                )}
                <dt className="text-ink/40">Source</dt>
                <dd>Row {finding.row} ({finding.sourceTab})</dd>
              </dl>
            </div>
          )}
        </>
      )}

      {mode === "client" && finding.note?.trim() && (
        <div>
          <h3 className="text-sm font-semibold text-ink">Note from your account team</h3>
          <p className="mt-1 text-sm text-ink/70 whitespace-pre-line">{finding.note}</p>
        </div>
      )}

      {mode === "admin" && (
        <>
          <div>
            <h3 className="text-sm font-semibold text-ink">My notes</h3>
            <Textarea
              value={noteDraft}
              onChange={(e) => handleNoteChange(e.target.value)}
              rows={3}
              placeholder="Add a note — your client will see this…"
              className="mt-1"
            />
          </div>

          <div className="flex flex-wrap gap-2 pt-2">
            {onEdit && (
              <Button variant="secondary" size="sm" onClick={onEdit} className="flex items-center gap-1.5">
                <Pencil className="h-4 w-4" /> Edit
              </Button>
            )}
            <Button variant="primary" size="sm" onClick={() => onMarkProgress?.("fixed")} className="flex items-center gap-1.5">
              <CheckCircle2 className="h-4 w-4" /> Mark fixed
            </Button>
            <Button variant="secondary" size="sm" onClick={() => onMarkProgress?.("notfixed")} className="flex items-center gap-1.5">
              <XCircle className="h-4 w-4" /> Mark not fixed
            </Button>
            <Button variant="ghost" size="sm" onClick={() => onMarkProgress?.("unreviewed")} className="flex items-center gap-1.5">
              <RefreshCcw className="h-4 w-4" /> Reset status
            </Button>
            {finding.deleted ? (
              <Button variant="secondary" size="sm" onClick={onRestore} className="flex items-center gap-1.5">
                <RotateCcw className="h-4 w-4" /> Restore
              </Button>
            ) : (
              <Button variant="danger" size="sm" onClick={onDelete} className="flex items-center gap-1.5">
                <Trash2 className="h-4 w-4" /> Delete
              </Button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
