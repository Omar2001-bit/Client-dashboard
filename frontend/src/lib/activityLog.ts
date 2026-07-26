import {
  ArrowLeft, Eye, EyeOff, Search, Calendar, ToggleLeft, BarChart2,
  ArrowUpDown, MessageSquare, Clock, Globe, ExternalLink, ChevronRight,
  RefreshCw, Shield, LayoutDashboard, FlaskConical, Play, SkipForward, X,
  ListChecks, Filter,
} from "lucide-react";
import type { Timestamp } from "firebase/firestore";
import type { ActivityEventType } from "@/lib/activityTracker";

export interface LogEntry {
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

export const EVENT_CONFIG: Record<ActivityEventType, { label: string; icon: React.ElementType; color: string; bg: string }> = {
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

export function formatDuration(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  if (m < 60) return rem > 0 ? `${m}m ${rem}s` : `${m}m`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

export function formatTime(ts: Timestamp | null): string {
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

export function formatAbsTime(ts: Timestamp | null): string {
  if (!ts) return "";
  return ts.toDate().toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export function getPageTitle(path: string): string {
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

export function getFullDescription(log: LogEntry): string {
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
