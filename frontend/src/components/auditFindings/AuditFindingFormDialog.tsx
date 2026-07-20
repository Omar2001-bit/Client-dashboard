import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Dialog } from "@/components/ui/Dialog";
import { Input } from "@/components/ui/Input";
import { Textarea } from "@/components/ui/Textarea";
import { Select } from "@/components/ui/Select";
import { Button } from "@/components/ui/Button";
import { createFinding, updateFindingContent, type AuditFindingFormInput } from "@/lib/auditFindings";
import type { AuditFindingDoc, AuditFindingTool, AuditSeverity } from "@/types";

interface Props {
  open: boolean;
  onClose: () => void;
  clientId: string;
  uid: string;
  finding: AuditFindingDoc | null; // null = create, non-null = edit
  onSaved: (findingId: string) => void;
}

const TOOL_OPTIONS: AuditFindingTool[] = ["GA4", "GTM", "Google Search Console", "Shopify", "Behavioral Tool"];
const SEVERITY_OPTIONS: AuditSeverity[] = ["Critical", "High", "Action Needed", "Unable to Verify", "Correct"];

function blankInput(): AuditFindingFormInput {
  return {
    tool: "GA4",
    auditStatus: "Action Needed",
    sourceTab: "",
    issue: "",
    businessIssue: "",
    detail: "",
    businessDetail: "",
    technicalExplanation: "",
    fix: "",
    businessFix: "",
    verify: "",
    businessVerify: "",
    docs: "",
    owner: "",
    qaOutcome: "",
    reviewStatus: "",
    routingNote: "",
    evidenceLink: "",
  };
}

function fromFinding(finding: AuditFindingDoc): AuditFindingFormInput {
  return {
    tool: finding.tool,
    auditStatus: finding.auditStatus,
    sourceTab: finding.sourceTab,
    issue: finding.issue,
    businessIssue: finding.businessIssue,
    detail: finding.detail,
    businessDetail: finding.businessDetail,
    technicalExplanation: finding.technicalExplanation ?? "",
    fix: finding.fix,
    businessFix: finding.businessFix,
    verify: finding.verify,
    businessVerify: finding.businessVerify,
    docs: finding.docs ?? "",
    owner: finding.owner ?? "",
    qaOutcome: finding.qaOutcome ?? "",
    reviewStatus: finding.reviewStatus ?? "",
    routingNote: finding.routingNote ?? "",
    evidenceLink: finding.evidenceLink ?? "",
  };
}

function hasRoutingData(finding: AuditFindingDoc | null): boolean {
  if (!finding) return false;
  return Boolean(
    finding.owner || finding.qaOutcome || finding.reviewStatus || finding.routingNote || finding.evidenceLink
  );
}

/** Create/edit dialog for a finding's content (issue/fix/verify/etc.). Progress fields
 *  (mark fixed, notes, delete/restore) stay owned by AuditFindingDetail's existing
 *  action buttons — this dialog never touches them. */
export function AuditFindingFormDialog({ open, onClose, clientId, uid, finding, onSaved }: Props) {
  const isEdit = finding != null;
  // Dialog unmounts its children while closed, so this state naturally resets fresh
  // every time it reopens — no effect needed to sync it to a changing `finding` prop.
  const [form, setForm] = useState<AuditFindingFormInput>(() => (finding ? fromFinding(finding) : blankInput()));
  const [advancedOpen, setAdvancedOpen] = useState(() => hasRoutingData(finding));
  const [issueError, setIssueError] = useState<string | undefined>();
  const [saving, setSaving] = useState(false);

  const set = <K extends keyof AuditFindingFormInput>(key: K, value: AuditFindingFormInput[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const handleSave = async () => {
    if (!form.issue.trim()) {
      setIssueError("Required");
      return;
    }
    setSaving(true);
    const id = isEdit
      ? await updateFindingContent(clientId, finding!.id, form).then(() => finding!.id)
      : await createFinding(clientId, form, uid);
    setSaving(false);
    onSaved(id);
    onClose();
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={isEdit ? "Edit finding" : "New finding"}
      className="max-w-2xl"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" loading={saving} onClick={handleSave}>
            {isEdit ? "Save changes" : "Create finding"}
          </Button>
        </>
      }
    >
      <div className="max-h-[65vh] space-y-4 overflow-y-auto pr-1 -mr-1">
        <div className="grid grid-cols-2 gap-4">
          <Select label="Tool" value={form.tool} onChange={(e) => set("tool", e.target.value as AuditFindingTool)}>
            {TOOL_OPTIONS.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </Select>
          <Select
            label="Severity"
            value={form.auditStatus}
            onChange={(e) => set("auditStatus", e.target.value as AuditSeverity)}
          >
            {SEVERITY_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </Select>
        </div>

        <Input
          label="Source tab"
          value={form.sourceTab}
          onChange={(e) => set("sourceTab", e.target.value)}
          placeholder="Manual"
          hint='Defaults to "Manual" if left blank — used to group/filter findings.'
        />

        <div className="grid grid-cols-2 gap-4">
          <Input
            label="Issue"
            value={form.issue}
            onChange={(e) => {
              set("issue", e.target.value);
              if (issueError) setIssueError(undefined);
            }}
            error={issueError}
          />
          <Input
            label="Issue — plain-English"
            value={form.businessIssue}
            onChange={(e) => set("businessIssue", e.target.value)}
            hint="Optional — falls back to the technical text when blank."
          />
        </div>

        <Textarea label="Detail" rows={3} value={form.detail} onChange={(e) => set("detail", e.target.value)} />
        <Textarea
          label="Detail — plain-English"
          rows={3}
          value={form.businessDetail}
          onChange={(e) => set("businessDetail", e.target.value)}
          hint="Optional — falls back to the technical text when blank."
        />
        <Textarea
          label="Technical explanation"
          rows={2}
          value={form.technicalExplanation}
          onChange={(e) => set("technicalExplanation", e.target.value)}
        />

        <Textarea label="Fix" rows={3} value={form.fix} onChange={(e) => set("fix", e.target.value)} />
        <Textarea
          label="Fix — plain-English"
          rows={3}
          value={form.businessFix}
          onChange={(e) => set("businessFix", e.target.value)}
          hint="Optional — falls back to the technical text when blank."
        />

        <Textarea label="Verify" rows={2} value={form.verify} onChange={(e) => set("verify", e.target.value)} />
        <Textarea
          label="Verify — plain-English"
          rows={2}
          value={form.businessVerify}
          onChange={(e) => set("businessVerify", e.target.value)}
          hint="Optional — falls back to the technical text when blank."
        />

        <Input
          label="Docs"
          value={form.docs}
          onChange={(e) => set("docs", e.target.value)}
          hint="Space-separated URLs or notes — links are auto-detected."
        />

        <button
          type="button"
          onClick={() => setAdvancedOpen((v) => !v)}
          className="flex items-center gap-1.5 text-sm font-medium text-ink/70 hover:text-ink"
        >
          {advancedOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          Advanced (routing)
        </button>

        {advancedOpen && (
          <div className="grid grid-cols-2 gap-4 rounded-xl border border-ink/10 p-4">
            <Input label="Owner" value={form.owner} onChange={(e) => set("owner", e.target.value)} />
            <Input label="QA outcome" value={form.qaOutcome} onChange={(e) => set("qaOutcome", e.target.value)} />
            <Input
              label="Review status"
              value={form.reviewStatus}
              onChange={(e) => set("reviewStatus", e.target.value)}
            />
            <Input
              label="Evidence link"
              value={form.evidenceLink}
              onChange={(e) => set("evidenceLink", e.target.value)}
            />
            <div className="col-span-2">
              <Input
                label="Routing note"
                value={form.routingNote}
                onChange={(e) => set("routingNote", e.target.value)}
              />
            </div>
          </div>
        )}
      </div>
    </Dialog>
  );
}
