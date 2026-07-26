import { useState, useEffect } from "react";
import { doc, getDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuthStore } from "@/store/authStore";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Textarea } from "@/components/ui/Textarea";
import { notifyAdminByEmail } from "@/lib/supportChat";
import { useSupportChatThread } from "@/hooks/useSupportChatThread";
import { ChatThread } from "@/components/support/ChatThread";
import { SendHorizontal, MessageSquare } from "lucide-react";
import { track } from "@/lib/activityTracker";

export function SupportPage() {
  const { user, clientId } = useAuthStore();
  const [clientName, setClientName] = useState("");

  useEffect(() => {
    if (!clientId) return;
    getDoc(doc(db, "clients", clientId)).then((snap) => {
      if (snap.exists()) setClientName(String(snap.data()?.name ?? ""));
    });
  }, [clientId]);

  const myName = user?.displayName ?? user?.email ?? "";

  const { messages, text, setText, sending, handleSend, bottomRef } = useSupportChatThread({
    clientId,
    clientName,
    myRole: "client",
    myName,
    senderId: user?.uid,
    onMessageSent: (trimmed) => {
      track({ type: "support_message_sent", metadata: { message: trimmed, messageLength: trimmed.length } });
      notifyAdminByEmail(trimmed, myName, clientName, user?.email ?? "");
    },
  });

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
          <ChatThread messages={messages} isMine={(m) => m.senderRole === "client"} bottomRef={bottomRef} />
        </CardBody>

        {/* Input */}
        <div className="px-6 py-4 border-t border-ink/5 flex items-end gap-3">
          <div className="flex-1">
            <Textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
              placeholder="Type your message… (Enter to send)"
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
      </Card>
    </div>
  );
}
