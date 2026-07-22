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

export async function sendChatMessage({
  clientId,
  clientName,
  text,
  senderId,
  senderRole,
  senderName,
}: {
  clientId: string;
  clientName: string;
  text: string;
  senderId: string;
  senderRole: "client" | "admin";
  senderName: string;
}) {
  const ticketRef = await ensureTicketExists(clientId, clientName);
  const otherUnread = senderRole === "client" ? "unreadAdmin" : "unreadClient";

  await Promise.all([
    addDoc(collection(db, "supportTickets", clientId, "messages"), {
      text,
      senderId,
      senderRole,
      senderName,
      createdAt: serverTimestamp(),
    }),
    updateDoc(ticketRef, {
      lastMessage: text,
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
