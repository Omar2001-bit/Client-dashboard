import type { RefObject } from "react";
import { FileText, FileSpreadsheet, File as FileIcon, Download } from "lucide-react";
import type { ChatMessage } from "@/hooks/useSupportChatThread";

export function formatChatTimestamp(ts: { toDate(): Date } | null | undefined) {
  if (!ts?.toDate) return "";
  return ts.toDate().toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

type AttachmentKind = "document" | "spreadsheet" | "generic";

function kindForAttachment(contentType: string): AttachmentKind {
  if (contentType === "application/pdf" || contentType.includes("word")) return "document";
  if (contentType.includes("csv") || contentType.includes("sheet") || contentType.includes("excel")) return "spreadsheet";
  return "generic";
}

/** Renders an attachment inline in a chat bubble — an <img> thumbnail for images
 * (safe even for a maliciously crafted SVG, since browsers never execute embedded
 * <script> in an <img>-loaded SVG, only on top-level navigation/<object>/<iframe>/
 * inline <svg>), otherwise a generic file card that opens the stored URL. */
function AttachmentView({ attachment }: { attachment: NonNullable<ChatMessage["attachment"]> }) {
  if (attachment.contentType.startsWith("image/")) {
    return (
      <a href={attachment.url} target="_blank" rel="noopener noreferrer" className="mt-1 block">
        <img
          src={attachment.url}
          alt={attachment.name}
          className="max-h-64 max-w-full rounded-lg border border-ink/10 object-contain"
        />
      </a>
    );
  }
  const kind = kindForAttachment(attachment.contentType);
  return (
    <a
      href={attachment.url}
      target="_blank"
      rel="noopener noreferrer"
      className="mt-1 flex items-center gap-2 rounded-xl border border-ink/10 bg-white/40 px-3 py-2 transition-colors hover:bg-white/70"
    >
      {kind === "document" && <FileText className="h-5 w-5 shrink-0 text-ink/50" />}
      {kind === "spreadsheet" && <FileSpreadsheet className="h-5 w-5 shrink-0 text-ink/50" />}
      {kind === "generic" && <FileIcon className="h-5 w-5 shrink-0 text-ink/50" />}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs font-medium text-ink">{attachment.name}</span>
        <span className="block text-[10px] text-ink/40">{formatFileSize(attachment.size)}</span>
      </span>
      <Download className="h-3.5 w-3.5 shrink-0 text-ink/30" />
    </a>
  );
}

/** Message-bubble list shared by the client Support page, the admin support inbox,
 * and the FloatingChat widget (via `compact`, which matches the widget's denser
 * sizing). */
export function ChatThread({
  messages,
  isMine,
  bottomRef,
  compact = false,
}: {
  messages: ChatMessage[];
  isMine: (message: ChatMessage) => boolean;
  bottomRef: RefObject<HTMLDivElement | null>;
  compact?: boolean;
}) {
  return (
    <>
      {messages.map((msg) => {
        const isMe = isMine(msg);
        return (
          <div key={msg.id} className={`flex ${isMe ? "justify-end" : "justify-start"}`}>
            <div
              className={`rounded-2xl ${compact ? "max-w-[78%] px-3 py-2" : "max-w-[75%] px-4 py-2.5"} ${
                isMe ? "bg-brand-500 text-ink-deep" : "bg-ink/5 text-ink"
              }`}
            >
              {!isMe && (
                <p className={`font-semibold text-ink/40 mb-0.5 ${compact ? "text-[10px]" : "text-[11px]"}`}>
                  {msg.senderName}
                </p>
              )}
              {msg.text && <p className="text-sm leading-relaxed whitespace-pre-wrap break-words">{msg.text}</p>}
              {msg.attachment && <AttachmentView attachment={msg.attachment} />}
              <p className={`text-[10px] mt-1 ${isMe ? "text-ink/50 text-right" : "text-ink/30"}`}>
                {formatChatTimestamp(msg.createdAt)}
              </p>
            </div>
          </div>
        );
      })}
      <div ref={bottomRef} />
    </>
  );
}
