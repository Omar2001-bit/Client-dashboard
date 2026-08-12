import {
  collection,
  doc,
  addDoc,
  getDoc,
  setDoc,
  updateDoc,
  serverTimestamp,
  increment,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { API_BASE } from "@/lib/apiClient";

export async function ensureTicketExists(clientId: string, clientName: string) {
  const ref = doc(db, "supportTickets", clientId);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    await setDoc(ref, {
      clientId,
      clientName,
      status: "open",
      createdAt: serverTimestamp(),
      lastMessageAt: serverTimestamp(),
      unreadAdmin: 0,
      unreadClient: 0,
    });
  }
  return ref;
}

export interface ChatAttachment {
  url: string;
  name: string;
  contentType: string;
  size: number;
  path: string;
}

/** Allocates a Firestore message doc ID client-side with zero network calls, so an
 * attachment's Storage path can be keyed 1:1 to its eventual message doc before the
 * doc itself is written (the upload must finish — and have a download URL — before
 * the message doc is created). */
export function newChatMessageRef(clientId: string) {
  return doc(collection(db, "supportTickets", clientId, "messages"));
}

export async function sendChatMessage({
  clientId,
  clientName,
  text,
  senderId,
  senderRole,
  senderName,
  attachment,
  messageRef,
}: {
  clientId: string;
  clientName: string;
  text: string;
  senderId: string;
  senderRole: "client" | "admin";
  senderName: string;
  attachment?: ChatAttachment;
  /** Pre-generated via newChatMessageRef() — used for attachment sends so the Storage
   * path can be chosen before the message doc is written. Omit for plain text sends. */
  messageRef?: ReturnType<typeof doc>;
}) {
  const ticketRef = await ensureTicketExists(clientId, clientName);
  const otherUnread = senderRole === "client" ? "unreadAdmin" : "unreadClient";
  const lastMessagePreview = text || (attachment ? `📎 ${attachment.name}` : "");

  const messageData = {
    text,
    senderId,
    senderRole,
    senderName,
    createdAt: serverTimestamp(),
    ...(attachment ? { attachment } : {}),
  };

  await Promise.all([
    messageRef
      ? setDoc(messageRef, messageData)
      : addDoc(collection(db, "supportTickets", clientId, "messages"), messageData),
    updateDoc(ticketRef, {
      lastMessage: lastMessagePreview,
      lastMessageAt: serverTimestamp(),
      status: "open",
      [otherUnread]: increment(1),
    }),
  ]);
}

export async function markAsRead(clientId: string, role: "client" | "admin") {
  const field = role === "client" ? "unreadClient" : "unreadAdmin";
  try {
    await updateDoc(doc(db, "supportTickets", clientId), { [field]: 0 });
  } catch {
    // ticket doc doesn't exist yet — nothing to mark
  }
}

export async function notifyAdminByEmail(
  message: string,
  senderName: string,
  clientName: string,
  senderEmail: string
) {
  try {
    const res = await fetch(`${API_BASE}/api/support-email`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message, senderName, clientName, senderEmail }),
    });
    if (!res.ok) {
      const detail = await res.json().catch(() => ({}));
      console.error("[support] email rejected by server:", detail);
    }
  } catch (err) {
    console.error("[support] email failed:", err);
  }
}
