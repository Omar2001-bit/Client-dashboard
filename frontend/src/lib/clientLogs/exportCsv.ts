import type { ClientDoc } from "@/types";
import type { ActivityEventType } from "@/lib/activityTracker";
import { EVENT_CONFIG, getFullDescription, formatDuration, type LogEntry } from "@/lib/activityLog";

function escapeCell(value: string): string {
  const str = String(value ?? "");
  if (str.includes(",") || str.includes('"') || str.includes("\n") || str.includes("\r")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function downloadCSV(logs: LogEntry[], client: ClientDoc) {
  // Collect all unique metadata keys across every event
  const allMetaKeys = new Set<string>();
  logs.forEach((log) => Object.keys(log.metadata ?? {}).forEach((k) => allMetaKeys.add(k)));
  const metaKeys = Array.from(allMetaKeys).sort();

  // Event type count summary
  const typeCounts: Record<string, number> = {};
  logs.forEach((log) => { typeCounts[log.type] = (typeCounts[log.type] ?? 0) + 1; });
  const totalEvents = logs.length;
  const firstTs = logs[logs.length - 1]?.timestamp?.toDate();
  const lastTs = logs[0]?.timestamp?.toDate();

  const row = (...cells: string[]) => cells.map(escapeCell).join(",");

  const lines: string[] = [];

  // ── Cover block ──────────────────────────────────────────────────────────────
  lines.push(row("CLIENT ACTIVITY EXPORT"));
  lines.push(row("Client", client.name));
  lines.push(row("Export date", new Date().toLocaleString()));
  lines.push(row("Total events", String(totalEvents)));
  lines.push(row("Date range",
    firstTs ? firstTs.toLocaleString() : "?",
    "→",
    lastTs ? lastTs.toLocaleString() : "?",
  ));
  lines.push("");

  // ── Event type summary ───────────────────────────────────────────────────────
  lines.push(row("EVENT TYPE SUMMARY"));
  lines.push(row("Event Type", "Label", "Count", "% of Total"));
  Object.entries(typeCounts)
    .sort((a, b) => b[1] - a[1])
    .forEach(([type, count]) => {
      const label = EVENT_CONFIG[type as ActivityEventType]?.label ?? type;
      const pct = ((count / totalEvents) * 100).toFixed(1);
      lines.push(row(type, label, String(count), `${pct}%`));
    });
  lines.push("");

  // ── Full event log ───────────────────────────────────────────────────────────
  lines.push(row("FULL EVENT LOG (newest first)"));

  const headers = [
    "#",
    "Timestamp (ISO)",
    "Timestamp (Readable)",
    "Date",
    "Time",
    "Session ID",
    "Event Type",
    "Event Label",
    "Page Path",
    "Page Title",
    "Full URL",
    "Referrer URL",
    "Time on Page",
    "Time on Page (seconds)",
    "Full Description",
    ...metaKeys.map((k) => `param_${k}`),
  ];
  lines.push(row(...headers));

  logs.forEach((log, i) => {
    const ts = log.timestamp?.toDate();
    const label = EVENT_CONFIG[log.type]?.label ?? log.type;
    const durSec = log.durationMs !== undefined ? (log.durationMs / 1000).toFixed(1) : "";
    const durFormatted = log.durationMs !== undefined ? formatDuration(log.durationMs) : "";

    const metaValues = metaKeys.map((k) => {
      const val = log.metadata?.[k];
      if (val === null || val === undefined) return "";
      if (k === "durationOnPageMs") return formatDuration(Number(val));
      return String(val);
    });

    lines.push(row(
      String(i + 1),
      ts ? ts.toISOString() : "",
      ts ? ts.toLocaleString() : "",
      ts ? ts.toLocaleDateString() : "",
      ts ? ts.toLocaleTimeString() : "",
      log.sessionId,
      log.type,
      label,
      log.page,
      log.pageTitle ?? "",
      log.url ?? "",
      log.referrer ?? "",
      durFormatted,
      durSec,
      getFullDescription(log),
      ...metaValues,
    ));
  });

  const csv = "﻿" + lines.join("\r\n"); // UTF-8 BOM ensures Excel opens correctly
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${client.name.replace(/[^a-z0-9]/gi, "_")}_activity_logs_${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
