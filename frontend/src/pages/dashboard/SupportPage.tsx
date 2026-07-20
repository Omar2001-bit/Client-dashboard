import { useState, useEffect, useRef } from "react";
import { collection, doc, onSnapshot, query, orderBy, getDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuthStore } from "@/store/authStore";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { sendChatMessage, markAsRead, notifyAdminByEmail } from "@/lib/supportChat";
import { SendHorizontal, MessageSquare } from "lucide-react";
import { track } from "@/lib/activityTracker";

interface Message {
  id: string;
  text: string;
  senderRole: "client" | "admin";
  senderName: string;
  createdAt: { toDate(): Date } | null;
}

function formatTime(ts: { toDate(): Date } | null | undefined) {
  if (!ts?.toDate) return "";
  return ts.toDate().toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export function SupportPage() {
  const { user, clientId } = useAuthStore();
  const [messages, setMessages] = useState<Message[]>([]);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [clientName, setClientName] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!clientId) return;
    getDoc(doc(db, "clients", clientId)).then((snap) => {
      if (snap.exists()) setClientName(String(snap.data()?.name ?? ""));
    });
  }, [clientId]);

  useEffect(() => {
    if (!clientId) return;
    markAsRead(clientId, "client");
    const q = query(
      collection(db, "supportTickets", clientId, "messages"),
      orderBy("createdAt", "asc")
    );
    return onSnapshot(q, (snap) => {
      setMessages(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Message)));
      setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
    });
  }, [clientId]);

  const handleSend = async () => {
    if (!text.trim() || !user || !clientId || sending) return;
    setSending(true);
    const trimmed = text.trim();
    const name = user.displayName ?? user.email ?? "";
    setText("");
    try {
      await sendChatMessage({
        clientId,
        clientName,
        text: trimmed,
        senderId: user.uid,
        senderRole: "client",
        senderName: name,
      });
      track({ type: "support_message_sent", metadata: { message: trimmed, messageLength: trimmed.length } });
      notifyAdminByEmail(trimmed, name, clientName, user.email ?? "");
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="p-8 space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-bold text-ink">Support</h1>
        <p className="text-sm text-ink/50 mt-1">
          Chat with our team — we typically reply within a few hours.
        </p>
      </div>

      <Card data-tutorial="support-chat" className="flex flex-col" style={{ height: "560px" }}>
        <CardHeader className="flex items-center gap-2">
          <MessageSquare className="h-4 w-4 text-brand-500" />
          <span className="font-semibold text-ink">Conversation</span>
        </CardHeader>

        {/* Messages */}
        <CardBody className="flex-1 overflow-y-auto space-y-3 min-h-0">
          {messages.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full text-center">
              <MessageSquare className="h-10 w-10 text-ink/10 mb-3" />
              <p className="text-sm text-ink/40">No messages yet.</p>
              <p className="text-xs text-ink/30 mt-1">Send us a message and we'll get back to you.</p>
            </div>
          )}
          {messages.map((msg) => {
            const isMe = msg.senderRole === "client";
            return (
              <div key={msg.id} className={`flex ${isMe ? "justify-end" : "justify-start"}`}>
                <div className={`max-w-[75%] rounded-2xl px-4 py-2.5 ${isMe ? "bg-brand-500 text-ink-deep" : "bg-ink/5 text-ink"}`}>
                  {!isMe && (
                    <p className="text-[11px] font-semibold text-ink/40 mb-0.5">{msg.senderName}</p>
                  )}
                  <p className="text-sm leading-relaxed whitespace-pre-wrap">{msg.text}</p>
                  <p className={`text-[10px] mt-1 ${isMe ? "text-ink/50 text-right" : "text-ink/30"}`}>
                    {formatTime(msg.createdAt)}
                  </p>
                </div>
              </div>
            );
          })}
          <div ref={bottomRef} />
        </CardBody>

        {/* Input */}
        <div className="px-6 py-4 border-t border-ink/5 flex items-end gap-3">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
            placeholder="Type your message… (Enter to send)"
            rows={2}
            className="flex-1 resize-none rounded-xl border border-ink/10 px-4 py-2.5 text-sm text-ink placeholder:text-ink/30 focus:border-brand-300 focus:outline-none"
          />
          <Button
            onClick={handleSend}
            disabled={!text.trim() || sending}
            className="flex items-center gap-2 shrink-0"
          >
            <SendHorizontal className="h-4 w-4" />
            Send
          </Button>
        </div>
      </Card>
    </div>
  );
}
