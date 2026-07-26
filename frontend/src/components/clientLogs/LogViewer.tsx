import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft, Activity, Filter, Clock, Globe, Users, Wifi, Download, FileText,
} from "lucide-react";
import { Chip } from "@/components/ui/Chip";
import type { ClientDoc } from "@/types";
import type { ActivityEventType } from "@/lib/activityTracker";
import { EVENT_CONFIG, formatDuration, formatTime, formatAbsTime, getFullDescription, type LogEntry } from "@/lib/activityLog";
import { useActivityLogs } from "@/hooks/useActivityLogs";
import { downloadCSV } from "@/lib/clientLogs/exportCsv";
import { exportToPDF } from "@/lib/clientLogs/exportPdf";
import { Stat } from "./Stat";

export function LogViewer({ client, onBack }: { client: ClientDoc; onBack: () => void }) {
  const { logs, loading } = useActivityLogs(client.id);
  const [liveFlash, setLiveFlash] = useState(false);
  const [selectedTypes, setSelectedTypes] = useState<Set<ActivityEventType>>(new Set());
  const toggleType = (type: ActivityEventType) =>
    setSelectedTypes((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });

  useEffect(() => {
    if (loading) return;
    setLiveFlash(true);
    const t = setTimeout(() => setLiveFlash(false), 600);
    return () => clearTimeout(t);
  }, [logs, loading]);

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
    () => (selectedTypes.size === 0 ? logs : logs.filter((l) => selectedTypes.has(l.type))),
    [logs, selectedTypes]
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
          {selectedTypes.size > 0 && (
            <span className="flex items-center gap-1.5 rounded-full bg-brand-500/10 px-3 py-1 text-xs font-medium text-brand-700">
              <Filter className="h-3.5 w-3.5" />
              {selectedTypes.size} filter{selectedTypes.size !== 1 ? "s" : ""} active
              <button
                onClick={() => setSelectedTypes(new Set())}
                className="font-semibold text-brand-800 hover:underline"
              >
                Clear
              </button>
            </span>
          )}
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
      <div className="border-b border-ink/10 bg-white px-8 py-2 flex flex-wrap items-center gap-1.5 shrink-0" data-tutorial="admin-logs-filters">
        <Chip active={selectedTypes.size === 0} onClick={() => setSelectedTypes(new Set())}>
          All events
        </Chip>
        {(Object.keys(EVENT_CONFIG) as ActivityEventType[]).map((type) => {
          const cfg = EVENT_CONFIG[type];
          return (
            <Chip key={type} active={selectedTypes.has(type)} onClick={() => toggleType(type)}>
              {cfg.label}
            </Chip>
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
          <div key={`${group.sessionId}_${group.events[0]?.id ?? gi}`}>
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
