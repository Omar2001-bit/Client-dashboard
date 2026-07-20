import { useEffect, useState, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { collection, onSnapshot, orderBy, query, limit, getDocs, doc, getDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { ArrowLeft, Activity, Eye, EyeOff, Search, Calendar, ToggleLeft, BarChart2, ArrowUpDown, MessageSquare, Clock, Globe, Users, Wifi, ExternalLink, ChevronRight, RefreshCw, Shield, LayoutDashboard, FlaskConical, Download, FileText, Play, SkipForward, X, ListChecks, Filter } from "lucide-react";
import type { Timestamp } from "firebase/firestore";
import type { ClientDoc } from "@/types";
import type { ActivityEventType } from "@/lib/activityTracker";

interface LogEntry {
  id: string;
  type: ActivityEventType;
  page: string;
  pageTitle?: string;
  url?: string;
  referrer?: string;
  durationMs?: number;
  metadata?: Record<string, unknown>;
  sessionId: string;
  userId: string;
  timestamp: Timestamp | null;
}

const EVENT_CONFIG: Record<ActivityEventType, { label: string; icon: React.ElementType; color: string; bg: string }> = {
  // Navigation
  page_view:                    { label: "Visited page",          icon: Globe,         color: "text-blue-600",   bg: "bg-blue-50" },
  page_exit:                    { label: "Left page",             icon: Clock,         color: "text-ink/40",  bg: "bg-ink/5" },
  // Dashboard
  date_range_change:            { label: "Changed date range",    icon: Calendar,      color: "text-teal-600",   bg: "bg-teal-50" },
  full_range_reset:             { label: "Reset to full range",   icon: RefreshCw,     color: "text-teal-500",   bg: "bg-teal-50" },
  exclude_losses_toggle:        { label: "Toggled loss filter",   icon: ToggleLeft,    color: "text-orange-600", bg: "bg-orange-50" },
  metric_mode_change:           { label: "Changed metric mode",   icon: BarChart2,     color: "text-indigo-600", bg: "bg-indigo-50" },
  dashboard_experiment_click:   { label: "Clicked experiment",    icon: Eye,           color: "text-purple-500", bg: "bg-purple-50" },
  // Experiment list
  experiment_view:              { label: "Opened experiment",     icon: FlaskConical,  color: "text-purple-600", bg: "bg-purple-50" },
  search:                       { label: "Searched",              icon: Search,        color: "text-amber-600",  bg: "bg-amber-50" },
  sort_change:                  { label: "Changed sort order",    icon: ArrowUpDown,   color: "text-ink/70",  bg: "bg-ink/5" },
  list_page_change:             { label: "Changed list page",     icon: ChevronRight,  color: "text-ink/50",  bg: "bg-ink/5" },
  experiment_visibility_toggle: { label: "Toggled visibility",    icon: EyeOff,        color: "text-orange-500", bg: "bg-orange-50" },
  // Audit findings
  audit_finding_view:           { label: "Opened audit finding",  icon: ListChecks,    color: "text-purple-600", bg: "bg-purple-50" },
  audit_filter_change:          { label: "Filtered audit findings", icon: Filter,      color: "text-ink/70",  bg: "bg-ink/5" },
  // Experiment detail
  variation_preview_click:      { label: "Opened variation preview", icon: ExternalLink, color: "text-blue-500", bg: "bg-blue-50" },
  experiment_detail_hide_toggle:{ label: "Toggled experiment hide", icon: EyeOff,      color: "text-orange-600", bg: "bg-orange-50" },
  // Support
  support_message_sent:         { label: "Sent support message",  icon: MessageSquare, color: "text-green-600",  bg: "bg-green-50" },
  // Meetings
  meeting_type_selected:        { label: "Opened meeting booking",icon: Calendar,      color: "text-emerald-600",bg: "bg-emerald-50" },
  // Profile
  password_changed:             { label: "Changed password",      icon: Shield,        color: "text-ink/70",  bg: "bg-ink/5" },
  // A/B testing hub
  ab_testing_view_selected:     { label: "Selected A/B view",     icon: LayoutDashboard,color: "text-indigo-500",bg: "bg-indigo-50" },
  // Floating chat
  chat_opened:                  { label: "Opened chat",            icon: MessageSquare, color: "text-brand-600", bg: "bg-brand-50" },
  chat_closed:                  { label: "Closed chat",            icon: MessageSquare, color: "text-ink/40", bg: "bg-ink/5" },
  chat_message_sent:            { label: "Sent chat message",      icon: MessageSquare, color: "text-green-600", bg: "bg-green-50" },
  // Timeline
  timeline_phase_selected:      { label: "Opened timeline phase",  icon: Calendar,      color: "text-blue-600",  bg: "bg-blue-50" },
  // Tab attention
  tab_hidden:                   { label: "Switched away",          icon: EyeOff,        color: "text-ink/40", bg: "bg-ink/5" },
  tab_visible:                  { label: "Came back",              icon: Eye,           color: "text-emerald-600",bg: "bg-emerald-50" },
  // Scroll depth
  scroll_depth:                 { label: "Scrolled",               icon: ChevronRight,  color: "text-ink/50", bg: "bg-ink/5" },
  // Chart
  chart_date_hover:             { label: "Inspected chart date",   icon: BarChart2,     color: "text-teal-600",  bg: "bg-teal-50" },
  // Back navigation
  back_navigation:              { label: "Navigated back",         icon: ArrowLeft,     color: "text-ink/50", bg: "bg-ink/5" },
  // Tutorial
  tutorial_started:             { label: "Started tutorial",       icon: Play,          color: "text-brand-600", bg: "bg-brand-50" },
  tutorial_step_viewed:         { label: "Viewed tutorial step",   icon: Play,          color: "text-brand-500", bg: "bg-brand-50" },
  tutorial_step_skipped:        { label: "Skipped tutorial step",  icon: SkipForward,   color: "text-amber-500", bg: "bg-amber-50" },
  tutorial_skipped:             { label: "Skipped tutorial",       icon: X,             color: "text-red-400",   bg: "bg-red-50" },
  tutorial_completed:           { label: "Completed tutorial",     icon: Play,          color: "text-emerald-600",bg: "bg-emerald-50" },
  tutorial_reopened:            { label: "Re-launched tutorial",   icon: Play,          color: "text-brand-600", bg: "bg-brand-50" },
};

function formatDuration(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  if (m < 60) return rem > 0 ? `${m}m ${rem}s` : `${m}m`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

function formatTime(ts: Timestamp | null): string {
  if (!ts) return "—";
  const date = ts.toDate();
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) return "just now";
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function formatAbsTime(ts: Timestamp | null): string {
  if (!ts) return "";
  return ts.toDate().toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function getFullDescription(log: LogEntry): string {
  const m = log.metadata ?? {};
  const title = log.pageTitle ?? log.page;
  const dur = log.durationMs !== undefined ? formatDuration(log.durationMs) : null;

  switch (log.type) {
    case "page_view": {
      const ref = log.referrer ? ` They arrived from the ${getPageTitle(log.referrer)} page.` : "";
      return `The client opened the ${title} page.${ref}`;
    }
    case "page_exit":
      return `The client left the ${title} page after spending ${dur ?? "an unknown amount of time"} on it.`;
    case "date_range_change":
      return `The client changed the dashboard date filter to show data from ${m.start ?? "?"} to ${m.end ?? "?"}. All KPIs and charts updated to reflect only this period.`;
    case "full_range_reset":
      return `The client clicked the "${m.button ?? "Full Range"}" button to reset the date filter and show all available experiment data.`;
    case "exclude_losses_toggle":
      return m.excluded
        ? `The client turned ON the "Exclude revenue losses" filter. Revenue-losing experiments are now excluded from all dashboard totals.`
        : `The client turned OFF the "Exclude revenue losses" filter. All experiments, including losing ones, are now included in totals.`;
    case "metric_mode_change":
      return `The client clicked the "${m.button ?? m.mode}" button, switching the rate metrics display (RPV, CVR, AOV) to ${m.mode === "avg" ? "average per experiment" : "sum across all experiments"} mode.`;
    case "dashboard_experiment_click":
      return `The client clicked on experiment "${m.experimentName ?? m.experimentId}" in the Recent Experiments table on the main dashboard, navigating to its detail page.`;
    case "experiment_view":
      return `The client clicked "${m.button ?? "View detail"}" to open the full detail page for experiment "${m.experimentName ?? m.experimentId}" from the experiments list.`;
    case "search":
      return `The client typed "${m.query}" into the experiments search box to filter the list.`;
    case "sort_change":
      return `The client changed the experiments list sort order to "${m.sortKey}", reordering all experiments by that metric.`;
    case "list_page_change":
      return `The client navigated to page ${m.page} of the experiments list using the pagination controls.`;
    case "experiment_visibility_toggle":
      return `The client ${m.action === "hide" ? "hid" : "restored"} experiment "${m.experimentName ?? m.experimentId}" ${m.action === "hide" ? "from their dashboard" : "back onto their dashboard"} using the eye toggle in the experiments list.`;
    case "experiment_detail_hide_toggle":
      return `The client clicked "${m.action === "hide" ? "Hide from dashboard" : "Show in dashboard"}" on the detail page of experiment "${m.experimentName}", ${m.action === "hide" ? "removing it from" : "restoring it to"} their dashboard view.`;
    case "variation_preview_click":
      return `The client opened a live preview of variation "${m.variationName}" (ID: ${m.variationId ?? "?"}) for experiment "${m.experimentName}" in a new browser tab.`;
    case "support_message_sent":
      return m.message
        ? `The client sent a ${m.messageLength ?? "?"}-character support message from the Support page: "${String(m.message).slice(0, 400)}${String(m.message).length > 400 ? "…" : ""}"`
        : `The client sent a ${m.messageLength ?? "?"}-character message from the Support page.`;
    case "chat_opened":
      return `The client clicked the floating chat bubble to open the support chat panel.`;
    case "chat_closed":
      return `The client closed the floating support chat panel.`;
    case "chat_message_sent":
      return m.message
        ? `The client sent a ${m.messageLength ?? "?"}-character message via the floating chat widget: "${String(m.message).slice(0, 400)}${String(m.message).length > 400 ? "…" : ""}"`
        : `The client sent a ${m.messageLength ?? "?"}-character message via the floating chat widget.`;
    case "timeline_phase_selected":
      return `The client clicked on the "${m.phaseName ?? m.phaseId}" phase in the project timeline to expand and view its tasks and details.`;
    case "meeting_type_selected":
      return `The client clicked to book a "${m.meetingType}" via Calendly, which opened the booking calendar in a new tab.`;
    case "password_changed":
      return m.success
        ? `The client successfully changed their account password from the Profile settings page.`
        : `The client attempted to change their account password but the operation failed.`;
    case "ab_testing_view_selected":
      return `The client selected the "${m.view}" option on the A/B Testing Results hub page, navigating to that view.`;
    case "tab_hidden":
      return `The client switched away from the dashboard to another browser tab or window. They had been on the ${title} page for ${m.durationOnPageMs ? formatDuration(Number(m.durationOnPageMs)) : "an unknown duration"} before switching away.`;
    case "tab_visible":
      return `The client returned to the dashboard tab after being away. They came back to the ${title} page.`;
    case "scroll_depth":
      return `The client scrolled ${m.depthPercent}% down the ${title} page — ${
        Number(m.depthPercent) <= 25 ? "they started reading past the top section of the page." :
        Number(m.depthPercent) <= 50 ? "they read past the halfway point of the page." :
        Number(m.depthPercent) <= 75 ? "they read through most of the page content." :
        "they scrolled all the way to the bottom and read the entire page."
      }`;
    case "chart_date_hover":
      return `The client stopped hovering on ${m.date ?? "a date"} in the Revenue Uplift Over Time chart. Revenue uplift at that date: ${
        typeof m.revenue === "number"
          ? (m.revenue >= 0 ? `+${m.revenue.toLocaleString()}` : m.revenue.toLocaleString())
          : "unknown"
      }${m.breakdownCount ? `, with ${m.breakdownCount} experiment(s) contributing to that figure.` : "."}`;
    case "back_navigation":
      return `The client clicked "Back to experiments" from the detail page of experiment "${m.experimentName ?? m.experimentId}", returning to the full experiments list.`;
    case "tutorial_started":
      return `The client started the onboarding tutorial ${m.trigger === "auto" ? "automatically on first login" : "manually from the Docs page"}. The tutorial has ${m.totalSteps} steps.`;
    case "tutorial_step_viewed":
      return `The client viewed tutorial step ${(Number(m.stepIndex) ?? 0) + 1}: "${m.stepTitle ?? m.stepId}".`;
    case "tutorial_step_skipped":
      return `The client skipped tutorial step ${(Number(m.stepIndex) ?? 0) + 1}: "${m.stepTitle ?? m.stepId}" and moved to the next step.`;
    case "tutorial_skipped":
      return `The client exited the tutorial early at step ${(Number(m.atStep) ?? 0) + 1} ("${m.atStepTitle ?? m.atStepId}") by clicking "Skip tour".`;
    case "tutorial_completed":
      return `The client completed the full onboarding tutorial — all ${m.totalSteps} steps finished.`;
    case "tutorial_reopened":
      return `The client re-launched the tutorial from the Docs & Tutorial page.`;
    default:
      return `The client performed an action on the ${title} page.`;
  }
}

function getPageTitle(path: string): string {
  const titles: Record<string, string> = {
    "/dashboard": "Dashboard",
    "/dashboard/ab-testing": "A/B Testing Results",
    "/dashboard/experiments": "Experiments",
    "/dashboard/timeline": "Timeline",
    "/dashboard/book-meeting": "Book a Meeting",
    "/dashboard/support": "Support",
    "/dashboard/profile": "Profile",
  };
  if (titles[path]) return titles[path];
  if (path.startsWith("/dashboard/experiments/")) return "Experiment Detail";
  return path;
}

// ── CSV export ───────────────────────────────────────────────────────────────

function escapeCell(value: string): string {
  const str = String(value ?? "");
  if (str.includes(",") || str.includes('"') || str.includes("\n") || str.includes("\r")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function downloadCSV(logs: LogEntry[], client: ClientDoc) {
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

// ── PDF export ────────────────────────────────────────────────────────────────

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

function exportToPDF(logs: LogEntry[], client: ClientDoc) {
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
      const label = EVENT_CONFIG[type as ActivityEventType]?.label ?? type;
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

// ── Client selector ───────────────────────────────────────────────────────────

function ClientSelector({ onSelect }: { onSelect: (client: ClientDoc) => void }) {
  const [clients, setClients] = useState<ClientDoc[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getDocs(collection(db, "clients")).then((snap) => {
      setClients(snap.docs.map((d) => ({ id: d.id, ...d.data() } as ClientDoc)));
      setLoading(false);
    });
  }, []);

  return (
    <div className="p-8 max-w-4xl" data-tutorial="admin-logs-viewer">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-ink">Client Logs</h1>
        <p className="mt-1 text-sm text-ink/50">Select a client to view their full activity history in real time.</p>
      </div>
      {loading ? (
        <div className="grid grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-24 animate-pulse rounded-xl bg-ink/5" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {clients.map((c) => (
            <button
              key={c.id}
              onClick={() => onSelect(c)}
              className="flex items-center gap-4 rounded-xl border border-ink/10 bg-white px-5 py-4 text-left shadow-sm transition-all hover:border-brand-400 hover:shadow-md"
            >
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand-100 text-brand-700 font-bold text-lg">
                {c.name?.[0]?.toUpperCase() ?? "?"}
              </div>
              <div className="min-w-0">
                <p className="font-semibold text-ink truncate">{c.name}</p>
                <p className="text-xs text-ink/40 truncate">{c.contactEmail}</p>
              </div>
            </button>
          ))}
          {clients.length === 0 && (
            <p className="col-span-3 text-sm text-ink/40">No clients found.</p>
          )}
        </div>
      )}
    </div>
  );
}

// ── Log viewer ────────────────────────────────────────────────────────────────

function LogViewer({ client, onBack }: { client: ClientDoc; onBack: () => void }) {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [liveFlash, setLiveFlash] = useState(false);
  const [typeFilter, setTypeFilter] = useState<ActivityEventType | "all">("all");

  useEffect(() => {
    const q = query(
      collection(db, "clients", client.id, "activityLogs"),
      orderBy("timestamp", "desc"),
      limit(500)
    );
    const unsub = onSnapshot(q, (snap) => {
      setLogs(snap.docs.map((d) => ({ id: d.id, ...d.data() } as LogEntry)));
      setLoading(false);
      setLiveFlash(true);
      setTimeout(() => setLiveFlash(false), 600);
    });
    return unsub;
  }, [client.id]);

  // Summary stats
  const stats = useMemo(() => {
    const sessions = new Set(logs.map((l) => l.sessionId)).size;
    const exits = logs.filter((l) => l.type === "page_exit" && l.durationMs !== undefined);
    const totalMs = exits.reduce((s, l) => s + (l.durationMs ?? 0), 0);
    const avgMs = exits.length > 0 ? totalMs / exits.length : 0;
    const pageCounts: Record<string, number> = {};
    logs.filter((l) => l.type === "page_view").forEach((l) => {
      const title = l.pageTitle ?? l.page;
      pageCounts[title] = (pageCounts[title] ?? 0) + 1;
    });
    const topPage = Object.entries(pageCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "—";
    const lastActive = logs[0]?.timestamp;
    return { sessions, avgMs, topPage, lastActive };
  }, [logs]);

  // Group visible logs by session
  const filtered = useMemo(
    () => (typeFilter === "all" ? logs : logs.filter((l) => l.type === typeFilter)),
    [logs, typeFilter]
  );

  const grouped = useMemo(() => {
    const groups: { sessionId: string; events: LogEntry[] }[] = [];
    for (const log of filtered) {
      if (groups.length === 0 || groups[groups.length - 1].sessionId !== log.sessionId) {
        groups.push({ sessionId: log.sessionId, events: [log] });
      } else {
        groups[groups.length - 1].events.push(log);
      }
    }
    return groups;
  }, [filtered]);

  return (
    <div className="flex flex-col h-screen">
      {/* Header */}
      <div className="border-b border-ink/10 bg-white px-8 py-4 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="text-ink/40 hover:text-ink transition-colors">
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div>
            <h1 className="text-lg font-bold text-ink">{client.name} — Activity Logs</h1>
            <p className="text-xs text-ink/40">Real-time · last 500 events</p>
          </div>
        </div>
        <div className="flex items-center gap-3" data-tutorial="admin-logs-export">
          <span className={`flex items-center gap-1.5 text-xs font-medium transition-colors ${liveFlash ? "text-emerald-500" : "text-ink/40"}`}>
            <Wifi className="h-3.5 w-3.5" />
            Live
          </span>
          <button
            onClick={() => downloadCSV(logs, client)}
            disabled={logs.length === 0}
            className="flex items-center gap-1.5 rounded-lg border border-ink/10 bg-white px-3 py-1.5 text-xs font-medium text-ink/60 shadow-sm transition-colors hover:bg-ink/5 hover:text-ink disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <Download className="h-3.5 w-3.5" />
            Export CSV ({logs.length})
          </button>
          <button
            onClick={() => exportToPDF(logs, client)}
            disabled={logs.length === 0}
            className="flex items-center gap-1.5 rounded-lg border border-ink/10 bg-white px-3 py-1.5 text-xs font-medium text-ink/60 shadow-sm transition-colors hover:bg-ink/5 hover:text-ink disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <FileText className="h-3.5 w-3.5" />
            Export PDF ({logs.length})
          </button>
        </div>
      </div>

      {/* Summary stats */}
      <div className="border-b border-ink/10 bg-ink/[0.02] px-8 py-3 flex items-center gap-8 shrink-0 overflow-x-auto" data-tutorial="admin-logs-stats">
        <Stat icon={Users} label="Sessions" value={String(stats.sessions)} />
        <Stat icon={Activity} label="Events" value={String(logs.length)} />
        <Stat icon={Clock} label="Avg time/page" value={stats.avgMs > 0 ? formatDuration(stats.avgMs) : "—"} />
        <Stat icon={Globe} label="Top page" value={stats.topPage} />
        <Stat icon={Activity} label="Last active" value={formatTime(stats.lastActive ?? null)} />
      </div>

      {/* Type filter */}
      <div className="border-b border-ink/10 bg-white px-8 py-2 flex items-center gap-2 overflow-x-auto shrink-0" data-tutorial="admin-logs-filters">
        <button
          onClick={() => setTypeFilter("all")}
          className={`px-3 py-1 rounded-full text-xs font-medium transition-colors whitespace-nowrap ${typeFilter === "all" ? "bg-ink text-white" : "text-ink/50 hover:bg-ink/5"}`}
        >
          All events
        </button>
        {(Object.keys(EVENT_CONFIG) as ActivityEventType[]).map((type) => {
          const cfg = EVENT_CONFIG[type];
          return (
            <button
              key={type}
              onClick={() => setTypeFilter(type)}
              className={`px-3 py-1 rounded-full text-xs font-medium transition-colors whitespace-nowrap ${typeFilter === type ? "bg-ink text-white" : "text-ink/50 hover:bg-ink/5"}`}
            >
              {cfg.label}
            </button>
          );
        })}
      </div>

      {/* Log feed */}
      <div className="flex-1 overflow-y-auto p-8 space-y-6" data-tutorial="admin-logs-events">
        {loading && (
          <div className="space-y-3">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="h-12 animate-pulse rounded-xl bg-ink/5" />
            ))}
          </div>
        )}

        {!loading && filtered.length === 0 && (
          <div className="text-center py-20 text-ink/30 text-sm">No events recorded yet.</div>
        )}

        {grouped.map((group, gi) => (
          <div key={group.sessionId}>
            {/* Session divider */}
            <div className="flex items-center gap-3 mb-3">
              <div className="h-px flex-1 bg-ink/10" />
              <span className="text-[10px] font-semibold uppercase tracking-wider text-ink/30">
                Session {grouped.length - gi} · {group.events.length} event{group.events.length !== 1 ? "s" : ""}
              </span>
              <div className="h-px flex-1 bg-ink/10" />
            </div>

            <div className="space-y-1">
              {group.events.map((log) => {
                const cfg = EVENT_CONFIG[log.type] ?? EVENT_CONFIG.page_view;
                const Icon = cfg.icon;
                return (
                  <div
                    key={log.id}
                    className={`flex items-start gap-3 rounded-xl px-4 py-2.5 transition-colors hover:bg-ink/[0.02] ${log.type === "page_exit" ? "opacity-50" : ""}`}
                  >
                    <div className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${cfg.bg}`}>
                      <Icon className={`h-3.5 w-3.5 ${cfg.color}`} />
                    </div>
                    <div className="flex-1 min-w-0 space-y-1">
                      {/* Event type label */}
                      <span className={`text-[10px] font-bold uppercase tracking-widest ${cfg.color}`}>{cfg.label}</span>
                      {/* Full natural-language description */}
                      <p className="text-sm text-ink leading-relaxed">{getFullDescription(log)}</p>
                      {/* All metadata parameters as key: value pairs */}
                      {Object.keys(log.metadata ?? {}).length > 0 && (
                        <div className="flex flex-wrap gap-x-4 gap-y-0.5 pt-0.5">
                          {Object.entries(log.metadata ?? {}).map(([key, val]) => {
                            if (val === null || val === undefined) return null;
                            const display = key === "durationOnPageMs"
                              ? formatDuration(Number(val))
                              : String(val).length > 120
                                ? `${String(val).slice(0, 120)}…`
                                : String(val);
                            return (
                              <span key={key} className="text-[11px] text-ink/60">
                                <span className="font-semibold text-ink/40">{key}:</span>{" "}
                                <span className="text-ink/70">{display}</span>
                              </span>
                            );
                          })}
                          {log.durationMs !== undefined && (
                            <span className="text-[11px] text-ink/60">
                              <span className="font-semibold text-ink/40">timeOnPage:</span>{" "}
                              <span className="text-ink/70">{formatDuration(log.durationMs)}</span>
                            </span>
                          )}
                        </div>
                      )}
                      {/* URL — every event */}
                      {log.url && (
                        <p className="text-[10px] text-ink/30 font-mono truncate">{log.url}</p>
                      )}
                    </div>
                    <div className="shrink-0 text-right">
                      <span
                        className="text-xs text-ink/30 cursor-default"
                        title={formatAbsTime(log.timestamp)}
                      >
                        {formatTime(log.timestamp)}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Stat({ icon: Icon, label, value }: { icon: React.ElementType; label: string; value: string }) {
  return (
    <div className="flex items-center gap-2 whitespace-nowrap">
      <Icon className="h-3.5 w-3.5 text-ink/30" />
      <span className="text-xs text-ink/40">{label}</span>
      <span className="text-xs font-semibold text-ink">{value}</span>
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export function ClientLogsPage() {
  const [searchParams] = useSearchParams();
  const [selectedClient, setSelectedClient] = useState<ClientDoc | null>(null);

  // Tutorial: auto-select a client via ?client=<id> so the viewer opens directly
  useEffect(() => {
    const tutorialId = searchParams.get("client");
    if (!tutorialId) return;
    getDoc(doc(db, "clients", tutorialId)).then((snap) => {
      if (snap.exists()) setSelectedClient({ id: snap.id, ...snap.data() } as ClientDoc);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams.get("client")]);

  if (!selectedClient) {
    return <ClientSelector onSelect={setSelectedClient} />;
  }

  return <LogViewer client={selectedClient} onBack={() => setSelectedClient(null)} />;
}
