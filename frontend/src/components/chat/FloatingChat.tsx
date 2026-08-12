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
import { markAsRead, notifyAdminByEmail } from "@/lib/supportChat";
import { useSupportChatThread } from "@/hooks/useSupportChatThread";
import { ChatThread } from "@/components/support/ChatThread";
import { PendingAttachmentRow } from "@/components/support/PendingAttachmentRow";
import { MessageSquare, X, Send, ArrowLeft, Paperclip } from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Ticket {
  id: string;
  clientName: string;
  lastMessage?: string;
  unreadAdmin: number;
  unreadClient: number;
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
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { messages, text, setText, sending, handleSend, bottomRef, pendingAttachment, handleAttach, cancelAttachment } = useSupportChatThread({
    clientId,
    clientName,
    myRole,
    myName,
    senderId: user?.uid,
    onMessageSent: (trimmed) => {
      if (myRole === "client") {
        track({ type: "chat_message_sent", metadata: { surface: "floating_widget", message: trimmed, messageLength: trimmed.length } });
        notifyAdminByEmail(trimmed, myName, clientName, myEmail);
      }
      inputRef.current?.focus();
    },
  });

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
        <ChatThread messages={messages} isMine={(msg) => msg.senderRole === myRole} bottomRef={bottomRef} compact />
      </div>

      {/* Input */}
      <div className="px-3 py-3 border-t border-ink/10 shrink-0 space-y-2">
        {pendingAttachment && <PendingAttachmentRow pending={pendingAttachment} onCancel={cancelAttachment} />}
        <div className="flex items-end gap-2">
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleAttach(file);
              e.target.value = "";
            }}
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={sending || !!pendingAttachment}
            title="Attach a file"
            aria-label="Attach a file"
            className="h-9 w-9 rounded-xl border border-ink/10 flex items-center justify-center text-ink/50 hover:bg-ink/5 hover:text-ink transition-colors disabled:opacity-40 shrink-0"
          >
            <Paperclip className="h-4 w-4" />
          </button>
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
