import { onCall, HttpsError } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import { getAdminAuth, getAdminFirestore } from "./lib/firebaseAdmin";
import { encrypt } from "./lib/encryption";
import { callableCors } from "./lib/cors";
import * as admin from "firebase-admin";

const SA_PRIVATE_KEY = defineSecret("FIREBASE_SA_PRIVATE_KEY");
const SA_CLIENT_EMAIL = defineSecret("FIREBASE_SA_CLIENT_EMAIL");

type UserRole = "admin" | "executiveAdmin" | "client";

interface CreateUserPayload {
  role: UserRole;
  userName: string;
  userEmail: string;
  userPassword: string;
  clientName: string;
  contactName: string;
  contactEmail: string;
  contractStartDate: string;
  contractEndDate: string;
  servicePrice?: number;
  agencyFee?: number;
  currency: string;
  convertAccountId: string;
  convertProjectId: string;
  convertKeyId: string;
  convertKeySecret: string;
}

export const createClientUser = onCall(
  { cors: callableCors, secrets: [SA_PRIVATE_KEY, SA_CLIENT_EMAIL] },
  async (request) => {
    const data = request.data as CreateUserPayload;
    const db = getAdminFirestore();
    const auth = getAdminAuth();
    const now = admin.firestore.Timestamp.now();
    const callerRole = request.auth?.token?.role as string | undefined;
    if (callerRole !== "admin" && callerRole !== "executiveAdmin") {
      const callerUid = request.auth?.uid;
      if (!callerUid) {
        throw new HttpsError("permission-denied", "Admin access required.");
      }
      const callerDoc = await db.collection("users").doc(callerUid).get();
      const callerDataRole = callerDoc.data()?.role as string | undefined;
      if (callerDataRole !== "admin" && callerDataRole !== "executiveAdmin") {
        throw new HttpsError("permission-denied", "Admin access required.");
      }
    }
    const role: UserRole = data.role === "executiveAdmin" ? "executiveAdmin" : data.role === "admin" ? "admin" : "client";
    if (role === "executiveAdmin" && callerRole !== "executiveAdmin") {
      throw new HttpsError("permission-denied", "Only an executive admin can create executive admins.");
    }
    const email = data.userEmail?.trim().toLowerCase();
    const displayName = data.userName?.trim();

    if (!email || !displayName || !data.userPassword) {
      throw new HttpsError("invalid-argument", "Name, email, and password are required.");
    }

    if (data.userPassword.length < 6) {
      throw new HttpsError("invalid-argument", "Password must be at least 6 characters.");
    }

    let clientId: string | null = null;
    let clientRef: FirebaseFirestore.DocumentReference | null = null;

    if (role === "client") {
      if (!data.clientName || !data.contactName || !data.contactEmail || !data.contractStartDate || !data.contractEndDate) {
        throw new HttpsError("invalid-argument", "Client details are required for client users.");
      }

      if (!data.convertAccountId || !data.convertProjectId || !data.convertKeyId || !data.convertKeySecret) {
        throw new HttpsError("invalid-argument", "Convert credentials are required for client users.");
      }

      if (new Date(data.contractEndDate).getTime() < new Date(data.contractStartDate).getTime()) {
        throw new HttpsError("invalid-argument", "Engagement end date must be after the start date.");
      }

      clientRef = db.collection("clients").doc();
      clientId = clientRef.id;
    }

    let user: admin.auth.UserRecord;
    try {
      user = await auth.getUserByEmail(email);
      user = await auth.updateUser(user.uid, {
        email,
        password: data.userPassword,
        displayName,
        disabled: false,
      });
    } catch (err: unknown) {
      const code = (err as { code?: string }).code;
      if (code !== "auth/user-not-found") {
        throw new HttpsError("internal", "Failed to create or update user.");
      }

      user = await auth.createUser({
        email,
        password: data.userPassword,
        displayName,
        emailVerified: false,
        disabled: false,
      });
    }

    if (role === "client" && clientRef && clientId) {
      const servicePrice = Number(data.servicePrice ?? data.agencyFee ?? 0);

      await clientRef.set({
        name: data.clientName,
        contactName: data.contactName,
        contactEmail: data.contactEmail,
        contractStartDate: admin.firestore.Timestamp.fromDate(new Date(data.contractStartDate)),
        contractEndDate: admin.firestore.Timestamp.fromDate(new Date(data.contractEndDate)),
        agencyFee: servicePrice,
        servicePrice,
        currency: data.currency || "USD",
        logoUrl: "",
        status: "active",
        createdAt: now,
        updatedAt: now,
      });

      await clientRef.collection("credentials").doc("convert").set({
        accountId: data.convertAccountId,
        projectId: data.convertProjectId,
        keyId: encrypt(data.convertKeyId),
        keySecret: encrypt(data.convertKeySecret),
        createdAt: now,
        updatedAt: now,
      });
    }

    await auth.setCustomUserClaims(
      user.uid,
      role === "client" ? { role, clientId } : { role }
    );

    await db.collection("users").doc(user.uid).set(
      {
        role,
        email,
        name: displayName,
        clientId,
        createdAt: now,
        updatedAt: now,
        lastLogin: null,
        skipOnboardingEmail: true,
      },
      { merge: true }
    );

    await db.collection("auditLog").add({
      action: role === "client" ? "createClientUser" : "createAdminUser",
      clientId,
      clientName: role === "client" ? data.clientName : null,
      targetUid: user.uid,
      targetEmail: email,
      targetRole: role,
      performedBy: request.auth?.uid ?? "unknown",
      timestamp: now,
    });

    return { success: true, clientId, uid: user.uid, role };
  }
);
