import { useEffect, useRef, useState } from "react";
import { collection, onSnapshot, orderBy, query } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { sendChatMessage, markAsRead } from "@/lib/supportChat";

export interface ChatMessage {
  id: string;
  text: string;
  senderRole: "client" | "admin";
  senderName: string;
  createdAt: { toDate(): Date } | null;
}

interface UseSupportChatThreadArgs {
  clientId: string | null | undefined;
  clientName: string;
  myRole: "client" | "admin";
  myName: string;
  senderId: string | undefined;
  /** Called after a message is successfully sent — use for tracking/notification side effects. */
  onMessageSent?: (trimmedText: string) => void;
}

/** Shared subscribe/send mechanics for the support chat thread, used by both
 * the full Support page and the FloatingChat widget — each renders its own
 * message-bubble UI since the two surfaces have deliberately different sizing. */
export function useSupportChatThread({ clientId, clientName, myRole, myName, senderId, onMessageSent }: UseSupportChatThreadArgs) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!clientId) return;
    markAsRead(clientId, myRole);
    const q = query(
      collection(db, "supportTickets", clientId, "messages"),
      orderBy("createdAt", "asc")
    );
    return onSnapshot(q, (snap) => {
      setMessages(snap.docs.map((d) => ({ id: d.id, ...d.data() } as ChatMessage)));
    });
  }, [clientId, myRole]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSend = async () => {
    if (!text.trim() || !clientId || !senderId || sending) return;
    setSending(true);
    const trimmed = text.trim();
    setText("");
    try {
      await sendChatMessage({
        clientId,
        clientName,
        text: trimmed,
        senderId,
        senderRole: myRole,
        senderName: myName,
      });
      onMessageSent?.(trimmed);
    } catch (err) {
      console.error("[chat] send failed:", err);
      setText(trimmed);
    } finally {
      setSending(false);
    }
  };

  return { messages, text, setText, sending, handleSend, bottomRef };
}
