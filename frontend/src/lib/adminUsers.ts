import { deleteApp, initializeApp } from "firebase/app";
import { createUserWithEmailAndPassword, deleteUser, getAuth, signOut, updateProfile } from "firebase/auth";
import { collection, doc, serverTimestamp, setDoc, Timestamp } from "firebase/firestore";
import { db, firebaseConfig } from "@/lib/firebase";
import type { CreateClientFormData } from "@/types";

export async function createUserDirectly(form: CreateClientFormData) {
  const secondaryApp = initializeApp(firebaseConfig, `admin-create-${crypto.randomUUID()}`);
  const secondaryAuth = getAuth(secondaryApp);

  try {
    const email = form.userEmail.trim().toLowerCase();
    const credential = await createUserWithEmailAndPassword(secondaryAuth, email, form.userPassword);

    try {
      await updateProfile(credential.user, { displayName: form.userName.trim() });

      const clientId = form.role === "client" ? doc(collection(db, "clients")).id : null;

      if (form.role === "client" && clientId) {
        await setDoc(doc(db, "clients", clientId), {
          name: form.clientName,
          contactName: form.contactName,
          contactEmail: form.contactEmail,
          contractStartDate: Timestamp.fromDate(new Date(form.contractStartDate)),
          contractEndDate: Timestamp.fromDate(new Date(form.contractEndDate)),
          agencyFee: Number(form.servicePrice || 0),
          servicePrice: Number(form.servicePrice || 0),
          currency: form.currency || "USD",
          logoUrl: "",
          status: "active",
          ...(form.ga4PropertyId ? { ga4PropertyId: form.ga4PropertyId } : {}),
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });

        await setDoc(doc(db, "clients", clientId, "credentials", "convert"), {
          accountId: form.convertAccountId,
          projectId: form.convertProjectId,
          keyId: form.convertKeyId,
          keySecret: form.convertKeySecret,
          storageMode: "firestore-rules-protected",
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }

      await setDoc(doc(db, "users", credential.user.uid), {
        role: form.role,
        email,
        name: form.userName.trim(),
        clientId,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        lastLogin: null,
      });

      return { uid: credential.user.uid, clientId };
    } catch (error) {
      await deleteUser(credential.user).catch(() => undefined);
      throw error;
    }
  } finally {
    await signOut(secondaryAuth).catch(() => undefined);
    await deleteApp(secondaryApp).catch(() => undefined);
  }
}
