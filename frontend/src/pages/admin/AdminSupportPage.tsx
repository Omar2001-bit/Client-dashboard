import { useState, useEffect } from "react";
import { collection, doc, onSnapshot, query, orderBy, updateDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuthStore } from "@/store/authStore";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Textarea } from "@/components/ui/Textarea";
import { SegmentedControl } from "@/components/ui/Tabs";
import { useSupportChatThread } from "@/hooks/useSupportChatThread";
import { ChatThread, formatChatTimestamp } from "@/components/support/ChatThread";
import { SendHorizontal, Inbox, ArrowLeft, CheckCircle } from "lucide-react";

interface Ticket {
  id: string;
  clientName: string;
  lastMessage?: string;
  lastMessageAt?: { toDate(): Date } | null;
  status: "open" | "resolved";
  unreadAdmin: number;
  unreadClient: number;
}

export function AdminSupportPage() {
  const { user } = useAuthStore();
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [selected, setSelected] = useState<Ticket | null>(null);
  const [filter, setFilter] = useState<"open" | "resolved" | "all">("open");

  useEffect(() => {
    const q = query(collection(db, "supportTickets"), orderBy("lastMessageAt", "desc"));
    return onSnapshot(q, (snap) => {
      setTickets(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Ticket)));
    });
  }, []);

  const { messages, text, setText, sending, handleSend, bottomRef } = useSupportChatThread({
    clientId: selected?.id,
    clientName: selected?.clientName ?? "",
    myRole: "admin",
    myName: user?.displayName ?? user?.email ?? "Admin",
    senderId: user?.uid,
  });

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
        <SegmentedControl
          items={(["open", "resolved", "all"] as const).map((f) => ({ value: f, label: <span className="capitalize">{f}</span> }))}
          value={filter}
          onChange={setFilter}
        />
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
                onClick={() => setSelected(t)}
                className={`w-full text-left px-4 py-3 border-b border-ink/5 last:border-0 transition-colors ${
                  selected?.id === t.id ? "bg-brand-50" : "hover:bg-ink/5"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-ink truncate">{t.clientName}</p>
                  {t.unreadAdmin > 0 && (
                    <Badge tone="danger" className="justify-center rounded-full px-1.5 shrink-0">
                      {t.unreadAdmin}
                    </Badge>
                  )}
                </div>
                {t.lastMessage && (
                  <p className="text-xs text-ink/40 truncate mt-0.5">{t.lastMessage}</p>
                )}
                <p className="text-[10px] text-ink/30 mt-1">{formatChatTimestamp(t.lastMessageAt)}</p>
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
                <ChatThread messages={messages} isMine={(m) => m.senderRole === "admin"} bottomRef={bottomRef} />
              </CardBody>

              {selected.status === "open" && (
                <div className="px-6 py-4 border-t border-ink/5 flex items-end gap-3">
                  <div className="flex-1">
                    <Textarea
                      value={text}
                      onChange={(e) => setText(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
                      placeholder="Reply… (Enter to send)"
                      rows={2}
                      className="resize-none"
                    />
                  </div>
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
