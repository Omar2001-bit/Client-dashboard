import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getAdminFirestore } from "./lib/firebaseAdmin";
import { encrypt } from "./lib/encryption";
import { callableCors } from "./lib/cors";
import * as admin from "firebase-admin";

interface RotatePayload {
  clientId: string;
  convertKeyId?: string;
  convertKeySecret?: string;
}

export const rotateClientCredentials = onCall({ cors: callableCors }, async (request) => {
  const callerRole = request.auth?.token?.role as string | undefined;
  if (callerRole !== "admin" && callerRole !== "executiveAdmin") {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError("permission-denied", "Admin access required.");
    const db = getAdminFirestore();
    const userDoc = await db.collection("users").doc(uid).get();
    const userRole = userDoc.data()?.role as string | undefined;
    if (userRole !== "admin" && userRole !== "executiveAdmin") {
      throw new HttpsError("permission-denied", "Admin access required.");
    }
  }

  const { clientId, convertKeyId, convertKeySecret } = request.data as RotatePayload;
  if (!clientId) throw new HttpsError("invalid-argument", "clientId required.");

  const db = getAdminFirestore();
  const now = admin.firestore.Timestamp.now();

  if (convertKeyId || convertKeySecret) {
    const update: Record<string, unknown> = { updatedAt: now };
    if (convertKeyId) update.keyId = encrypt(convertKeyId);
    if (convertKeySecret) update.keySecret = encrypt(convertKeySecret);

    await db
      .collection("clients").doc(clientId).collection("credentials").doc("convert")
      .set(update, { merge: true });

    await db.collection("auditLog").add({
      action: "rotateConvertKey",
      clientId,
      performedBy: request.auth?.uid ?? "unknown",
      timestamp: now,
    });
  }
  return { success: true };
});
