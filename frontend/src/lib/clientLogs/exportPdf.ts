import type { ClientDoc } from "@/types";
import { EVENT_CONFIG, getFullDescription, formatDuration, type LogEntry } from "@/lib/activityLog";

const EVENT_COLORS: Record<string, string> = {
  page_view: "#3b82f6", page_exit: "#94a3b8",
  date_range_change: "#0d9488", full_range_reset: "#14b8a6",
  exclude_losses_toggle: "#f97316", metric_mode_change: "#6366f1",
  dashboard_experiment_click: "#8b5cf6", experiment_view: "#7c3aed",
  search: "#d97706", sort_change: "#64748b", list_page_change: "#64748b",
  experiment_visibility_toggle: "#ea580c", experiment_detail_hide_toggle: "#ea580c",
  variation_preview_click: "#2563eb", support_message_sent: "#16a34a",
  chat_opened: "#22c55e", chat_closed: "#94a3b8", chat_message_sent: "#16a34a",
  timeline_phase_selected: "#2563eb", meeting_type_selected: "#059669",
  password_changed: "#475569", ab_testing_view_selected: "#4f46e5",
  tab_hidden: "#94a3b8", tab_visible: "#059669",
  scroll_depth: "#64748b", chart_date_hover: "#0d9488", back_navigation: "#64748b",
};

export function exportToPDF(logs: LogEntry[], client: ClientDoc) {
  const typeCounts: Record<string, number> = {};
  logs.forEach((log) => { typeCounts[log.type] = (typeCounts[log.type] ?? 0) + 1; });
  const totalEvents = logs.length;
  const sessions = new Set(logs.map((l) => l.sessionId)).size;
  const firstTs = logs[logs.length - 1]?.timestamp?.toDate();
  const lastTs = logs[0]?.timestamp?.toDate();
  const fmtDate = (d?: Date) => d ? d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "—";
  const fmtTime = (d?: Date) => d ? d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "—";

  const summaryRows = Object.entries(typeCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([type, count]) => {
      const label = EVENT_CONFIG[type as keyof typeof EVENT_CONFIG]?.label ?? type;
      const pct = ((count / totalEvents) * 100).toFixed(1);
      const barPct = Math.round((count / totalEvents) * 100);
      const color = EVENT_COLORS[type] ?? "#64748b";
      return `<tr>
        <td><span class="badge" style="background:${color}">${type.replace(/_/g, " ")}</span></td>
        <td>${label}</td>
        <td class="num">${count}</td>
        <td class="num">${pct}%</td>
        <td><div class="bar"><div class="bar-fill" style="width:${barPct}%;background:${color}"></div></div></td>
      </tr>`;
    }).join("");

  const eventRows = logs.map((log, i) => {
    const ts = log.timestamp?.toDate();
    const color = EVENT_COLORS[log.type] ?? "#64748b";
    const label = EVENT_CONFIG[log.type]?.label ?? log.type;
    const description = getFullDescription(log);
    const params = [
      ...Object.entries(log.metadata ?? {})
        .filter(([, v]) => v !== null && v !== undefined)
        .map(([k, v]) => {
          const val = k === "durationOnPageMs" ? formatDuration(Number(v)) : String(v);
          return `<span class="pk">${k}:</span> ${val.length > 200 ? val.slice(0, 200) + "…" : val}`;
        }),
      log.durationMs !== undefined ? `<span class="pk">timeOnPage:</span> ${formatDuration(log.durationMs)}` : "",
    ].filter(Boolean).join(" &nbsp;·&nbsp; ");

    return `<tr class="${i % 2 === 0 ? "even" : "odd"}">
      <td class="ts-cell">
        <div class="row-num">#${i + 1}</div>
        <div class="ts-time">${fmtTime(ts)}</div>
        <div class="ts-date">${ts ? ts.toLocaleDateString(undefined, { month: "short", day: "numeric" }) : ""}</div>
        <div class="ts-iso">${ts ? ts.toISOString() : ""}</div>
      </td>
      <td class="type-cell">
        <span class="badge" style="background:${color}">${label}</span>
        <div class="page-title">${log.pageTitle ?? ""}</div>
        <div class="page-path">${log.page}</div>
      </td>
      <td class="desc-cell">
        <div class="desc">${description.replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</div>
        ${params ? `<div class="params">${params}</div>` : ""}
        ${log.url ? `<div class="url">${log.url}</div>` : ""}
        ${log.referrer ? `<div class="url"><span class="pk">referrer:</span> ${log.referrer}</div>` : ""}
      </td>
    </tr>`;
  }).join("");

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>${client.name} — Activity Report</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:'Helvetica Neue',Arial,sans-serif;font-size:9pt;color:#162a3d;background:#fff;padding:28px}
  /* Cover */
  .cover{margin-bottom:28px;padding-bottom:20px;border-bottom:2px solid #162a3d}
  .cover h1{font-size:20pt;font-weight:800;letter-spacing:-0.02em;color:#162a3d}
  .cover .sub{font-size:10pt;color:#64748b;margin-top:4px}
  .stats{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-top:18px}
  .stat{background:#f8fafc;border-radius:8px;padding:12px 16px;border:1px solid #e2e8f0}
  .stat .lbl{font-size:6.5pt;text-transform:uppercase;letter-spacing:.1em;color:#94a3b8;margin-bottom:3px}
  .stat .val{font-size:13pt;font-weight:800;color:#162a3d}
  /* Section */
  h2{font-size:8pt;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:#64748b;margin:24px 0 8px;padding-bottom:6px;border-bottom:1px solid #e2e8f0}
  /* Summary table */
  .stbl{width:100%;border-collapse:collapse;margin-bottom:24px}
  .stbl th{background:#f1f5f9;padding:5px 8px;text-align:left;font-size:7pt;text-transform:uppercase;letter-spacing:.06em;color:#64748b;font-weight:700}
  .stbl td{padding:5px 8px;border-bottom:1px solid #f1f5f9;font-size:8pt}
  .num{text-align:right;font-weight:700}
  .bar{height:6px;background:#f1f5f9;border-radius:3px;width:120px}
  .bar-fill{height:100%;border-radius:3px}
  /* Event log */
  .etbl{width:100%;border-collapse:collapse}
  .etbl thead th{background:#162a3d;color:#fff;padding:7px 8px;text-align:left;font-size:7pt;text-transform:uppercase;letter-spacing:.06em;font-weight:700}
  .etbl tr.even td{background:#fafafa}
  .etbl tr.odd td{background:#fff}
  .etbl td{padding:8px 8px;border-bottom:1px solid #f1f5f9;vertical-align:top}
  .ts-cell{width:90px;min-width:90px}
  .type-cell{width:120px;min-width:120px}
  .row-num{font-size:6.5pt;color:#94a3b8;margin-bottom:3px}
  .ts-time{font-size:8.5pt;font-weight:700;color:#162a3d}
  .ts-date{font-size:7pt;color:#64748b}
  .ts-iso{font-size:5.5pt;color:#cbd5e1;font-family:monospace;margin-top:3px;word-break:break-all}
  .badge{display:inline-block;font-size:6pt;font-weight:700;text-transform:uppercase;letter-spacing:.08em;padding:2px 5px;border-radius:3px;color:#fff;margin-bottom:4px;-webkit-print-color-adjust:exact;print-color-adjust:exact}
  .page-title{font-size:7.5pt;font-weight:600;color:#162a3d}
  .page-path{font-size:6.5pt;color:#94a3b8;font-family:monospace;word-break:break-all}
  .desc{font-size:8.5pt;color:#162a3d;line-height:1.55;margin-bottom:5px}
  .params{font-size:7.5pt;color:#64748b;line-height:1.7;word-break:break-word}
  .pk{font-weight:700;color:#94a3b8}
  .url{font-size:6pt;color:#94a3b8;font-family:monospace;margin-top:3px;word-break:break-all}
  @media print{
    @page{margin:10mm 8mm;size:A4 landscape}
    body{padding:0}
    .etbl thead th{-webkit-print-color-adjust:exact;print-color-adjust:exact;background:#162a3d !important;color:#fff !important}
    .etbl tr.even td{-webkit-print-color-adjust:exact;print-color-adjust:exact;background:#fafafa !important}
    .stat{-webkit-print-color-adjust:exact;print-color-adjust:exact;background:#f8fafc !important}
    tr{page-break-inside:avoid}
  }
</style>
</head>
<body>

<div class="cover">
  <h1>${client.name}</h1>
  <div class="sub">Client Activity Report &nbsp;·&nbsp; Generated ${new Date().toLocaleString()}</div>
  <div class="stats">
    <div class="stat"><div class="lbl">Total Events</div><div class="val">${totalEvents.toLocaleString()}</div></div>
    <div class="stat"><div class="lbl">Sessions</div><div class="val">${sessions}</div></div>
    <div class="stat"><div class="lbl">First Event</div><div class="val" style="font-size:9pt">${fmtDate(firstTs)}</div></div>
    <div class="stat"><div class="lbl">Last Event</div><div class="val" style="font-size:9pt">${fmtDate(lastTs)}</div></div>
  </div>
</div>

<h2>Event Type Summary</h2>
<table class="stbl">
  <thead><tr><th>Event Type</th><th>Label</th><th class="num">Count</th><th class="num">% of Total</th><th>Volume</th></tr></thead>
  <tbody>${summaryRows}</tbody>
</table>

<h2>Full Event Log &mdash; ${totalEvents.toLocaleString()} events, newest first</h2>
<table class="etbl">
  <thead>
    <tr>
      <th># &amp; Timestamp</th>
      <th>Event Type &amp; Page</th>
      <th>Full Description, Parameters &amp; URL</th>
    </tr>
  </thead>
  <tbody>${eventRows}</tbody>
</table>

<script>window.onload=()=>{setTimeout(()=>window.print(),400)}</script>
</body>
</html>`;

  const win = window.open("", "_blank", "width=1400,height=900");
  if (!win) { alert("Allow popups to export PDF."); return; }
  win.document.write(html);
  win.document.close();
}
