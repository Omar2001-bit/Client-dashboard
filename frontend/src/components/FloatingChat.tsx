import { useState, useEffect, useRef } from "react";
import { track } from "@/lib/activityTracker";
import {
  collection,
  doc,
  onSnapshot,
  query,
  orderBy,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuthStore } from "@/store/authStore";
import { sendChatMessage, markAsRead, notifyAdminByEmail } from "@/lib/supportChat";
import { MessageSquare, X, Send, ArrowLeft } from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

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
  unreadAdmin: number;
  unreadClient: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatTime(ts: { toDate(): Date } | null | undefined) {
  if (!ts?.toDate) return "";
  return ts.toDate().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

// ─── Chat view (shared between client and admin) ──────────────────────────────

function ChatMessages({
  clientId,
  clientName,
  myRole,
  myName,
  myEmail,
  onBack,
  headerTitle,
}: {
  clientId: string;
  clientName: string;
  myRole: "client" | "admin";
  myName: string;
  myEmail: string;
  onBack?: () => void;
  headerTitle: string;
}) {
  const { user } = useAuthStore();
  const [messages, setMessages] = useState<Message[]>([]);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    markAsRead(clientId, myRole);
    const q = query(
      collection(db, "supportTickets", clientId, "messages"),
      orderBy("createdAt", "asc")
    );
    return onSnapshot(q, (snap) => {
      setMessages(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Message)));
    });
  }, [clientId, myRole]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSend = async () => {
    if (!text.trim() || !user || sending) return;
    setSending(true);
    const trimmed = text.trim();
    setText("");
    try {
      await sendChatMessage({
        clientId,
        clientName,
        text: trimmed,
        senderId: user.uid,
        senderRole: myRole,
        senderName: myName,
      });
      if (myRole === "client") {
        track({ type: "chat_message_sent", metadata: { surface: "floating_widget", message: trimmed, messageLength: trimmed.length } });
        notifyAdminByEmail(trimmed, myName, clientName, myEmail);
      }
    } catch (err) {
      console.error("[chat] send failed:", err);
      setText(trimmed);
    } finally {
      setSending(false);
      inputRef.current?.focus();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <>
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-ink/10 shrink-0">
        {onBack && (
          <button
            onClick={onBack}
            className="text-ink/40 hover:text-ink transition-colors mr-1"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
        )}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-ink truncate">{headerTitle}</p>
          <p className="text-[11px] text-ink/40">Support chat</p>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-2">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <MessageSquare className="h-8 w-8 text-ink/10 mb-2" />
            <p className="text-xs text-ink/30">
              {myRole === "client"
                ? "Send us a message and we'll get back to you."
                : "No messages yet."}
            </p>
          </div>
        )}
        {messages.map((msg) => {
          const isMe = msg.senderRole === myRole;
          return (
            <div key={msg.id} className={`flex ${isMe ? "justify-end" : "justify-start"}`}>
              <div
                className={`max-w-[78%] rounded-2xl px-3 py-2 text-sm ${
                  isMe ? "bg-brand-500 text-ink-deep" : "bg-ink/5 text-ink"
                }`}
              >
                {!isMe && (
                  <p className="text-[10px] font-semibold text-ink/40 mb-0.5">
                    {msg.senderName}
                  </p>
                )}
                <p className="leading-relaxed whitespace-pre-wrap break-words">{msg.text}</p>
                <p className={`text-[10px] mt-0.5 ${isMe ? "text-ink/50 text-right" : "text-ink/30"}`}>
                  {formatTime(msg.createdAt)}
                </p>
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="flex items-end gap-2 px-3 py-3 border-t border-ink/10 shrink-0">
        <textarea
          ref={inputRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Type a message…"
          rows={1}
          className="flex-1 resize-none rounded-xl border border-ink/10 px-3 py-2 text-sm focus:outline-none focus:border-brand-300 max-h-24 leading-relaxed"
        />
        <button
          onClick={handleSend}
          disabled={!text.trim() || sending}
          className="h-9 w-9 rounded-xl bg-brand-500 flex items-center justify-center hover:bg-brand-400 transition-colors disabled:opacity-40 shrink-0"
        >
          <Send className="h-4 w-4 text-ink-deep" />
        </button>
      </div>
    </>
  );
}

// ─── Admin conversation list ──────────────────────────────────────────────────

function ConversationList({
  tickets,
  onSelect,
}: {
  tickets: Ticket[];
  onSelect: (t: Ticket) => void;
}) {
  return (
    <>
      <div className="px-4 py-3 border-b border-ink/10 shrink-0">
        <p className="text-sm font-semibold text-ink">Support</p>
        <p className="text-[11px] text-ink/40">
          {tickets.length} conversation{tickets.length !== 1 ? "s" : ""}
        </p>
      </div>
      <div className="flex-1 overflow-y-auto">
        {tickets.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center p-8">
            <MessageSquare className="h-8 w-8 text-ink/10 mb-2" />
            <p className="text-xs text-ink/30">No support tickets yet.</p>
          </div>
        )}
        {tickets.map((t) => (
          <button
            key={t.id}
            onClick={() => onSelect(t)}
            className="w-full flex items-center gap-3 px-4 py-3 hover:bg-ink/5 transition-colors text-left border-b border-ink/5 last:border-0"
          >
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-ink truncate">{t.clientName}</p>
              {t.lastMessage && (
                <p className="text-xs text-ink/40 truncate mt-0.5">{t.lastMessage}</p>
              )}
            </div>
            {t.unreadAdmin > 0 && (
              <span className="h-5 min-w-[20px] rounded-full bg-red-500 text-white text-[11px] flex items-center justify-center font-bold px-1.5 shrink-0">
                {t.unreadAdmin > 9 ? "9+" : t.unreadAdmin}
              </span>
            )}
          </button>
        ))}
      </div>
    </>
  );
}

// ─── Main export ──────────────────────────────────────────────────────────────

export function FloatingChat() {
  const { user, role, clientId } = useAuthStore();
  const [open, setOpen] = useState(false);
  const [selectedTicket, setSelectedTicket] = useState<Ticket | null>(null);
  const [clientTicket, setClientTicket] = useState<Ticket | null>(null);
  const [adminTickets, setAdminTickets] = useState<Ticket[]>([]);
  const [clientName, setClientName] = useState("");

  // Fetch client workspace name for the client user
  useEffect(() => {
    if (role !== "client" || !clientId) return;
    import("firebase/firestore").then(({ getDoc, doc }) =>
      getDoc(doc(db, "clients", clientId)).then((snap) => {
        if (snap.exists()) setClientName(String(snap.data()?.name ?? ""));
      })
    );
  }, [role, clientId]);

  // Client: watch their ticket for unread badge
  useEffect(() => {
    if (role !== "client" || !clientId) return;
    return onSnapshot(doc(db, "supportTickets", clientId), (snap) => {
      setClientTicket(snap.exists() ? ({ id: snap.id, ...snap.data() } as Ticket) : null);
    });
  }, [role, clientId]);

  // Admin: watch all tickets for unread badge + list
  useEffect(() => {
    if (role !== "admin" && role !== "executiveAdmin") return;
    const q = query(
      collection(db, "supportTickets"),
      orderBy("lastMessageAt", "desc")
    );
    return onSnapshot(q, (snap) => {
      setAdminTickets(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Ticket)));
    });
  }, [role]);

  // Mark client as read when they open the panel
  useEffect(() => {
    if (open && role === "client" && clientId) {
      markAsRead(clientId, "client");
    }
  }, [open, role, clientId]);

  if (!user || !role) return null;

  const myName = user.displayName ?? user.email ?? "";
  const myEmail = user.email ?? "";

  const unread =
    role === "client"
      ? (clientTicket?.unreadClient ?? 0)
      : adminTickets.reduce((sum, t) => sum + (t.unreadAdmin ?? 0), 0);

  const handleToggle = () => {
    setOpen((o) => {
      const next = !o;
      if (next) track({ type: "chat_opened", metadata: { surface: "floating_widget" } });
      else track({ type: "chat_closed", metadata: { surface: "floating_widget" } });
      if (o) setSelectedTicket(null);
      return next;
    });
  };

  return (
    <>
      {/* Chat panel */}
      {open && (
        <div
          style={{ position: "fixed", bottom: "80px", right: "24px", zIndex: 9999 }}
          className="w-80 h-[480px] bg-white rounded-2xl shadow-2xl border border-ink/10 flex flex-col overflow-hidden"
        >
          {role === "client" ? (
            <ChatMessages
              clientId={clientId!}
              clientName={clientName}
              myRole="client"
              myName={myName}
              myEmail={myEmail}
              headerTitle="Support"
            />
          ) : selectedTicket ? (
            <ChatMessages
              clientId={selectedTicket.id}
              clientName={selectedTicket.clientName}
              myRole="admin"
              myName={myName}
              myEmail={myEmail}
              onBack={() => setSelectedTicket(null)}
              headerTitle={selectedTicket.clientName}
            />
          ) : (
            <ConversationList
              tickets={adminTickets}
              onSelect={(t) => {
                setSelectedTicket(t);
                markAsRead(t.id, "admin");
              }}
            />
          )}
        </div>
      )}

      {/* Floating button */}
      <button
        onClick={handleToggle}
        aria-label="Support chat"
        style={{ position: "fixed", bottom: "24px", right: "24px", zIndex: 9999 }}
        className="h-[52px] w-[52px] rounded-full bg-brand-500 shadow-lg flex items-center justify-center hover:bg-brand-400 active:scale-95 transition-all relative"
      >
        {open ? (
          <X className="h-5 w-5 text-ink-deep" />
        ) : (
          <MessageSquare className="h-5 w-5 text-ink-deep" />
        )}
        {!open && unread > 0 && (
          <span className="absolute -top-1 -right-1 h-5 min-w-[20px] rounded-full bg-red-500 text-white text-[11px] flex items-center justify-center font-bold px-1.5">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>
    </>
  );
}
