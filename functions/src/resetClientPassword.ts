import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getAdminAuth, getAdminFirestore } from "./lib/firebaseAdmin";
import { callableCors } from "./lib/cors";

export const resetClientPassword = onCall(
  { cors: callableCors },
  async (request) => {
    // Must be called by an admin
    const callerRole = request.auth?.token?.role as string | undefined;
    if (callerRole !== "admin" && callerRole !== "executiveAdmin") {
      const db = getAdminFirestore();
      const uid = request.auth?.uid;
      if (!uid) {
        throw new HttpsError("permission-denied", "Admin access required.");
      }
      const userDoc = await db.collection("users").doc(uid).get();
      if (userDoc.data()?.role !== "admin" && userDoc.data()?.role !== "executiveAdmin") {
        throw new HttpsError("permission-denied", "Admin access required.");
      }
    }

    const { clientId, newPassword } = request.data as { clientId: string; newPassword: string };

    if (!clientId || !newPassword || newPassword.length < 6) {
      throw new HttpsError("invalid-argument", "clientId and a password of at least 6 characters are required.");
    }

    const db = getAdminFirestore();
    const auth = getAdminAuth();

    // Find the user whose clientId matches
    const usersSnap = await db.collection("users").where("clientId", "==", clientId).limit(1).get();
    if (usersSnap.empty) {
      throw new HttpsError("not-found", "No user found for this client.");
    }

    const uid = usersSnap.docs[0].id;
    await auth.updateUser(uid, { password: newPassword });

    return { success: true };
  }
);
