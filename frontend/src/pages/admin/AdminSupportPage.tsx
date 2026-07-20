import { useState, useEffect, useRef } from "react";
import { collection, doc, onSnapshot, query, orderBy, updateDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuthStore } from "@/store/authStore";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { sendChatMessage, markAsRead } from "@/lib/supportChat";
import { SendHorizontal, Inbox, ArrowLeft, CheckCircle } from "lucide-react";

interface Message {
  id: string;
  text: string;
  senderRole: "client" | "admin";
  senderName: string;
  createdAt: { toDate(): Date } | null;
}

interface Ticket {
  id: string;
  clientName: string;
  lastMessage?: string;
  lastMessageAt?: { toDate(): Date } | null;
  status: "open" | "resolved";
  unreadAdmin: number;
  unreadClient: number;
}

function formatDate(ts: { toDate(): Date } | null | undefined) {
  if (!ts?.toDate) return "";
  return ts.toDate().toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export function AdminSupportPage() {
  const { user } = useAuthStore();
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [selected, setSelected] = useState<Ticket | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [filter, setFilter] = useState<"open" | "resolved" | "all">("open");
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const q = query(collection(db, "supportTickets"), orderBy("lastMessageAt", "desc"));
    return onSnapshot(q, (snap) => {
      setTickets(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Ticket)));
    });
  }, []);

  useEffect(() => {
    if (!selected) { setMessages([]); return; }
    markAsRead(selected.id, "admin");
    const q = query(
      collection(db, "supportTickets", selected.id, "messages"),
      orderBy("createdAt", "asc")
    );
    return onSnapshot(q, (snap) => {
      setMessages(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Message)));
      setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
    });
  }, [selected]);

  const handleSend = async () => {
    if (!text.trim() || !user || !selected || sending) return;
    setSending(true);
    const trimmed = text.trim();
    setText("");
    try {
      await sendChatMessage({
        clientId: selected.id,
        clientName: selected.clientName,
        text: trimmed,
        senderId: user.uid,
        senderRole: "admin",
        senderName: user.displayName ?? user.email ?? "Admin",
      });
    } finally {
      setSending(false);
    }
  };

  const handleResolve = async (ticketId: string) => {
    await updateDoc(doc(db, "supportTickets", ticketId), { status: "resolved" });
    if (selected?.id === ticketId) setSelected(null);
  };

  const openCount = tickets.filter((t) => t.status === "open").length;
  const filtered = tickets.filter((t) => filter === "all" || t.status === filter);

  return (
    <div className="p-8 h-full flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-ink">Support Tickets</h1>
          <p className="text-sm text-ink/50 mt-1">{openCount} open</p>
        </div>
        <div className="flex items-center gap-1 rounded-xl border border-ink/10 bg-white p-1 text-sm shadow-sm">
          {(["open", "resolved", "all"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-3 py-1.5 rounded-lg font-medium capitalize transition-colors ${
                filter === f ? "bg-ink text-white" : "text-ink/60 hover:text-ink hover:bg-ink/5"
              }`}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      <div className="flex gap-6 flex-1 min-h-0" style={{ height: "calc(100vh - 200px)" }}>
        {/* Ticket list */}
        <Card className="w-72 shrink-0 flex flex-col overflow-hidden" data-tutorial="admin-support-tickets">
          <div className="flex-1 overflow-y-auto">
            {filtered.length === 0 && (
              <div className="flex flex-col items-center justify-center h-full py-16 text-ink/30">
                <Inbox className="h-8 w-8 mb-2" />
                <p className="text-sm">No {filter !== "all" ? filter : ""} tickets</p>
              </div>
            )}
            {filtered.map((t) => (
              <button
                key={t.id}
                onClick={() => { setSelected(t); markAsRead(t.id, "admin"); }}
                className={`w-full text-left px-4 py-3 border-b border-ink/5 last:border-0 transition-colors ${
                  selected?.id === t.id ? "bg-brand-50" : "hover:bg-ink/5"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-ink truncate">{t.clientName}</p>
                  {t.unreadAdmin > 0 && (
                    <span className="h-5 min-w-[20px] rounded-full bg-red-500 text-white text-[11px] flex items-center justify-center font-bold px-1.5 shrink-0">
                      {t.unreadAdmin}
                    </span>
                  )}
                </div>
                {t.lastMessage && (
                  <p className="text-xs text-ink/40 truncate mt-0.5">{t.lastMessage}</p>
                )}
                <p className="text-[10px] text-ink/30 mt-1">{formatDate(t.lastMessageAt)}</p>
              </button>
            ))}
          </div>
        </Card>

        {/* Chat panel */}
        <Card className="flex-1 flex flex-col overflow-hidden">
          {!selected ? (
            <CardBody className="flex flex-col items-center justify-center h-full text-center text-ink/30">
              <Inbox className="h-10 w-10 mb-3" />
              <p className="font-medium text-sm">Select a conversation</p>
              <p className="text-xs mt-1">Choose a ticket from the list to view the chat</p>
            </CardBody>
          ) : (
            <>
              <CardHeader className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setSelected(null)}
                    className="text-ink/40 hover:text-ink transition-colors md:hidden"
                  >
                    <ArrowLeft className="h-4 w-4" />
                  </button>
                  <div>
                    <p className="font-semibold text-ink">{selected.clientName}</p>
                    <p className="text-xs text-ink/40">
                      {selected.status === "resolved" ? "Resolved" : "Open"}
                    </p>
                  </div>
                </div>
                {selected.status === "open" && (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => handleResolve(selected.id)}
                    className="flex items-center gap-1.5"
                  >
                    <CheckCircle className="h-3.5 w-3.5" />
                    Mark resolved
                  </Button>
                )}
              </CardHeader>

              <CardBody className="flex-1 overflow-y-auto space-y-3 min-h-0">
                {messages.length === 0 && (
                  <div className="flex items-center justify-center h-full text-ink/30 text-sm">
                    No messages yet.
                  </div>
                )}
                {messages.map((msg) => {
                  const isMe = msg.senderRole === "admin";
                  return (
                    <div key={msg.id} className={`flex ${isMe ? "justify-end" : "justify-start"}`}>
                      <div className={`max-w-[75%] rounded-2xl px-4 py-2.5 ${isMe ? "bg-brand-500 text-ink-deep" : "bg-ink/5 text-ink"}`}>
                        {!isMe && (
                          <p className="text-[11px] font-semibold text-ink/40 mb-0.5">{msg.senderName}</p>
                        )}
                        <p className="text-sm leading-relaxed whitespace-pre-wrap">{msg.text}</p>
                        <p className={`text-[10px] mt-1 ${isMe ? "text-ink/50 text-right" : "text-ink/30"}`}>
                          {formatDate(msg.createdAt)}
                        </p>
                      </div>
                    </div>
                  );
                })}
                <div ref={bottomRef} />
              </CardBody>

              {selected.status === "open" && (
                <div className="px-6 py-4 border-t border-ink/5 flex items-end gap-3">
                  <textarea
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
                    placeholder="Reply… (Enter to send)"
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
              )}
            </>
          )}
        </Card>
      </div>
    </div>
  );
}
