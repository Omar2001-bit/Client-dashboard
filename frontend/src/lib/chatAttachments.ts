import { ref, uploadBytesResumable, getDownloadURL, type UploadTask } from "firebase/storage";
import { storage } from "@/lib/firebase";

export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024; // 10 MB

const BLOCKED_EXTENSIONS = ["exe", "bat", "cmd", "msi", "sh", "dll", "js"];

/** Returns a user-facing rejection reason, or null if the file is OK to upload. */
export function validateAttachment(file: File): string | null {
  if (file.size > MAX_ATTACHMENT_BYTES) {
    return `${file.name} is larger than 10 MB.`;
  }
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (BLOCKED_EXTENSIONS.includes(ext)) {
    return `.${ext} files can't be attached.`;
  }
  return null;
}

/** Strips path separators and control characters so the filename is safe to use as a
 * Storage object's final path segment. The original name is kept separately (in the
 * Firestore message doc) for display — this sanitized version is only ever used as
 * the object key. */
export function sanitizeFileNameForStorage(name: string): string {
  const noSeparators = name.replace(/[/\\]/g, "_");
  const noControlChars = Array.from(noSeparators)
    .filter((ch) => ch.charCodeAt(0) > 0x1f)
    .join("");
  const cleaned = noControlChars.trim();
  return cleaned.slice(-150) || "file";
}

/** Uploads a chat attachment to supportAttachments/{clientId}/{messageId}/{fileName},
 * reporting 0-100 progress. `messageId` should come from newChatMessageRef() so the
 * Storage object is keyed 1:1 to its eventual message doc. */
export function uploadChatAttachment(
  clientId: string,
  messageId: string,
  file: File,
  onProgress: (pct: number) => void
): { task: UploadTask; result: Promise<{ url: string; path: string }> } {
  const path = `supportAttachments/${clientId}/${messageId}/${sanitizeFileNameForStorage(file.name)}`;
  const storageRef = ref(storage, path);
  const task = uploadBytesResumable(storageRef, file, {
    contentType: file.type || "application/octet-stream",
  });

  const result = new Promise<{ url: string; path: string }>((resolve, reject) => {
    task.on(
      "state_changed",
      (snap) => onProgress(Math.round((snap.bytesTransferred / snap.totalBytes) * 100)),
      reject,
      async () => {
        const url = await getDownloadURL(task.snapshot.ref);
        resolve({ url, path });
      }
    );
  });

  return { task, result };
}
