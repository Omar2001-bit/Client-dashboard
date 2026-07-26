import type { RefObject } from "react";
import type { ChatMessage } from "@/hooks/useSupportChatThread";

export function formatChatTimestamp(ts: { toDate(): Date } | null | undefined) {
  if (!ts?.toDate) return "";
  return ts.toDate().toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

/** Message-bubble list shared by the client Support page and the admin support inbox. */
export function ChatThread({
  messages,
  isMine,
  bottomRef,
}: {
  messages: ChatMessage[];
  isMine: (message: ChatMessage) => boolean;
  bottomRef: RefObject<HTMLDivElement | null>;
}) {
  return (
    <>
      {messages.map((msg) => {
        const isMe = isMine(msg);
        return (
          <div key={msg.id} className={`flex ${isMe ? "justify-end" : "justify-start"}`}>
            <div className={`max-w-[75%] rounded-2xl px-4 py-2.5 ${isMe ? "bg-brand-500 text-ink-deep" : "bg-ink/5 text-ink"}`}>
              {!isMe && (
                <p className="text-[11px] font-semibold text-ink/40 mb-0.5">{msg.senderName}</p>
              )}
              <p className="text-sm leading-relaxed whitespace-pre-wrap">{msg.text}</p>
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
