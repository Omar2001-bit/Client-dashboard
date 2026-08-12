import { useEffect, useRef, useState } from "react";
import { collection, onSnapshot, orderBy, query } from "firebase/firestore";
import type { UploadTask } from "firebase/storage";
import { db } from "@/lib/firebase";
import { sendChatMessage, markAsRead, newChatMessageRef } from "@/lib/supportChat";
import { validateAttachment, uploadChatAttachment } from "@/lib/chatAttachments";

export interface ChatMessage {
  id: string;
  text: string;
  senderRole: "client" | "admin";
  senderName: string;
  createdAt: { toDate(): Date } | null;
  attachment?: {
    url: string;
    name: string;
    contentType: string;
    size: number;
    path: string;
  };
}

export interface PendingAttachment {
  file: File;
  progress: number; // 0-100
  error: string | null;
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
  const [pendingAttachment, setPendingAttachment] = useState<PendingAttachment | null>(null);
  const uploadTaskRef = useRef<UploadTask | null>(null);
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

  const handleAttach = async (file: File) => {
    if (!clientId || !senderId || pendingAttachment) return; // one upload in flight per thread at a time
    const validationError = validateAttachment(file);
    if (validationError) {
      setPendingAttachment({ file, progress: 0, error: validationError });
      return;
    }
    const caption = text.trim();
    setText("");
    setPendingAttachment({ file, progress: 0, error: null });
    const messageRef = newChatMessageRef(clientId);
    const { task, result } = uploadChatAttachment(clientId, messageRef.id, file, (pct) =>
      setPendingAttachment((p) => (p ? { ...p, progress: pct } : p))
    );
    uploadTaskRef.current = task;
    try {
      const { url, path } = await result;
      await sendChatMessage({
        clientId,
        clientName,
        text: caption,
        senderId,
        senderRole: myRole,
        senderName: myName,
        attachment: { url, path, name: file.name, contentType: file.type || "application/octet-stream", size: file.size },
        messageRef,
      });
      onMessageSent?.(caption);
      setPendingAttachment(null);
    } catch (err: unknown) {
      if ((err as { code?: string })?.code === "storage/canceled") {
        setPendingAttachment(null);
      } else {
        console.error("[chat] attachment upload failed:", err);
        setPendingAttachment((p) => (p ? { ...p, error: "Upload failed — try again." } : p));
      }
    } finally {
      uploadTaskRef.current = null;
    }
  };

  const cancelAttachment = () => {
    uploadTaskRef.current?.cancel();
    uploadTaskRef.current = null;
    setPendingAttachment(null);
  };

  return { messages, text, setText, sending, handleSend, bottomRef, pendingAttachment, handleAttach, cancelAttachment };
}
