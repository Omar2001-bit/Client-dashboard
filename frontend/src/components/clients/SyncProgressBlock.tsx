import type { SyncProgress } from "@/lib/convertSync";

export function SyncProgressBlock({ progress, label }: { progress: SyncProgress | null; label: string }) {
  if (!progress) return null;
  return (
    <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 text-sm text-blue-800">
      <p className="font-medium">
        {progress.phase === "listing" && (progress.message ?? `${label} — listing experiments… found ${progress.fetched}`)}
        {progress.phase === "reports" && `${label} — fetching reports ${progress.fetched} / ${progress.total}`}
        {progress.phase === "writing" && `${label} — writing to Firestore ${progress.fetched} / ${progress.total}`}
        {progress.phase === "done" && (progress.message ?? `${label} — done, ${progress.total} experiments.`)}
        {progress.phase === "error" && `${label} — error: ${progress.message}`}
      </p>
      {progress.total > 0 && progress.phase === "reports" && (
        <>
          <div className="mt-2 h-2 w-full rounded-full bg-blue-100">
            <div className="h-2 rounded-full bg-blue-500 transition-all" style={{ width: `${Math.round((progress.fetched / progress.total) * 100)}%` }} />
          </div>
          <p className="mt-2 text-xs text-blue-600">
            ~{Math.max(0, Math.ceil((progress.total - progress.fetched) * 16 / 60))} min remaining.
          </p>
        </>
      )}
    </div>
  );
}
