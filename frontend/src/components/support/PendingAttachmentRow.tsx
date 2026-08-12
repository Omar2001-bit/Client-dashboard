import { Loader2, X } from "lucide-react";
import type { PendingAttachment } from "@/hooks/useSupportChatThread";

/** Local-only upload progress/error row shown above the chat input while an
 * attachment is uploading — the real message only appears (via onSnapshot) once
 * the upload finishes and the Firestore doc is written. Shared by all 3 composing
 * surfaces (Support page, Admin support inbox, FloatingChat). */
export function PendingAttachmentRow({ pending, onCancel }: { pending: PendingAttachment; onCancel: () => void }) {
  return (
    <div className="flex items-center gap-2 rounded-xl border border-ink/10 bg-ink/[0.02] px-3 py-2 text-xs">
      {pending.error ? (
        <span className="flex-1 min-w-0 text-red-600">{pending.error}</span>
      ) : (
        <>
          <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-ink/40" />
          <span className="min-w-0 flex-1 truncate text-ink/60">{pending.file.name}</span>
          <span className="shrink-0 tabular-nums text-ink/40">{pending.progress}%</span>
        </>
      )}
      <button
        type="button"
        onClick={onCancel}
        aria-label={pending.error ? "Dismiss" : "Cancel upload"}
        className="shrink-0 text-ink/30 transition-colors hover:text-ink/60"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
