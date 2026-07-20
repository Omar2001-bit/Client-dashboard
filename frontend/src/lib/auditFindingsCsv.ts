import Papa from "papaparse";
import type { AuditFindingFormInput } from "./auditFindings";
import type { AuditFindingTool, AuditSeverity } from "@/types";

const TOOL_VALUES: AuditFindingTool[] = ["GA4", "GTM", "Google Search Console", "Shopify", "Behavioral Tool"];
const SEVERITY_VALUES: AuditSeverity[] = ["Critical", "High", "Action Needed", "Unable to Verify", "Correct"];

const COLUMNS: { key: keyof AuditFindingFormInput; header: string }[] = [
  { key: "tool", header: "Tool" },
  { key: "auditStatus", header: "Severity" },
  { key: "sourceTab", header: "Source Tab" },
  { key: "issue", header: "Issue" },
  { key: "businessIssue", header: "Issue (Plain-English)" },
  { key: "detail", header: "Detail" },
  { key: "businessDetail", header: "Detail (Plain-English)" },
  { key: "technicalExplanation", header: "Technical Explanation" },
  { key: "fix", header: "Fix" },
  { key: "businessFix", header: "Fix (Plain-English)" },
  { key: "verify", header: "Verify" },
  { key: "businessVerify", header: "Verify (Plain-English)" },
  { key: "docs", header: "Docs" },
  { key: "owner", header: "Owner" },
  { key: "qaOutcome", header: "QA Outcome" },
  { key: "reviewStatus", header: "Review Status" },
  { key: "routingNote", header: "Routing Note" },
  { key: "evidenceLink", header: "Evidence Link" },
];

// Tolerant of an admin's own header casing/spacing when they hand-edit the template.
function normalizeHeader(h: string): string {
  return h.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

const NORMALIZED_TO_KEY = new Map(COLUMNS.map((c) => [normalizeHeader(c.header), c.key]));

const EXAMPLE_ROW: Record<string, string> = {
  Tool: "GA4",
  Severity: "Critical",
  "Source Tab": "Checkout",
  Issue: "Purchase event missing order value",
  "Issue (Plain-English)": "Your website isn't reporting sale amounts to Google Analytics correctly.",
  Detail: "The purchase event fires without a `value` parameter on some checkout completions.",
  "Detail (Plain-English)": "",
  "Technical Explanation": "",
  Fix: "Include `value: totalOrderAmount` in the dataLayer.push() before the GA4 purchase tag fires.",
  "Fix (Plain-English)": "",
  Verify: "Use GA4 DebugView on a test checkout and confirm the purchase event carries a non-zero value.",
  "Verify (Plain-English)": "",
  Docs: "https://support.google.com/analytics/answer/9267735",
  Owner: "",
  "QA Outcome": "",
  "Review Status": "",
  "Routing Note": "",
  "Evidence Link": "",
};

export function buildAuditFindingsCsvTemplate(): string {
  const headers = COLUMNS.map((c) => c.header);
  return Papa.unparse({ fields: headers, data: [headers.map((h) => EXAMPLE_ROW[h] ?? "")] });
}

export interface AuditFindingCsvError {
  row: number;
  message: string;
}

export interface AuditFindingCsvParseResult {
  rows: AuditFindingFormInput[];
  errors: AuditFindingCsvError[];
}

export function parseAuditFindingsCsv(csvText: string): AuditFindingCsvParseResult {
  const parsed = Papa.parse<Record<string, string>>(csvText, { header: true, skipEmptyLines: true });

  // Map each expected column key to whatever raw header the file actually used (tolerant match).
  const rawHeaderForKey = new Map<keyof AuditFindingFormInput, string>();
  for (const raw of parsed.meta.fields ?? []) {
    const key = NORMALIZED_TO_KEY.get(normalizeHeader(raw));
    if (key) rawHeaderForKey.set(key, raw);
  }

  const rows: AuditFindingFormInput[] = [];
  const errors: AuditFindingCsvError[] = [];

  parsed.data.forEach((rawRow, i) => {
    const rowNum = i + 2; // +1 for the header row, +1 to make it 1-indexed
    const get = (key: keyof AuditFindingFormInput): string => {
      const rawHeader = rawHeaderForKey.get(key);
      return rawHeader ? (rawRow[rawHeader] ?? "").trim() : "";
    };

    const issue = get("issue");
    if (!issue) {
      errors.push({ row: rowNum, message: "Missing required \"Issue\" value" });
      return;
    }

    const toolRaw = get("tool");
    const tool = toolRaw ? TOOL_VALUES.find((t) => t.toLowerCase() === toolRaw.toLowerCase()) : "GA4";
    if (!tool) {
      errors.push({ row: rowNum, message: `Unrecognized Tool "${toolRaw}" (expected one of ${TOOL_VALUES.join(", ")})` });
      return;
    }

    const severityRaw = get("auditStatus");
    const auditStatus = severityRaw
      ? SEVERITY_VALUES.find((s) => s.toLowerCase() === severityRaw.toLowerCase())
      : "Action Needed";
    if (!auditStatus) {
      errors.push({
        row: rowNum,
        message: `Unrecognized Severity "${severityRaw}" (expected one of ${SEVERITY_VALUES.join(", ")})`,
      });
      return;
    }

    rows.push({
      tool,
      auditStatus,
      sourceTab: get("sourceTab"),
      issue,
      businessIssue: get("businessIssue"),
      detail: get("detail"),
      businessDetail: get("businessDetail"),
      technicalExplanation: get("technicalExplanation"),
      fix: get("fix"),
      businessFix: get("businessFix"),
      verify: get("verify"),
      businessVerify: get("businessVerify"),
      docs: get("docs"),
      owner: get("owner"),
      qaOutcome: get("qaOutcome"),
      reviewStatus: get("reviewStatus"),
      routingNote: get("routingNote"),
      evidenceLink: get("evidenceLink"),
    });
  });

  return { rows, errors };
}
