import * as admin from "firebase-admin";

let adminApp: admin.app.App | null = null;

export function getAdminApp(): admin.app.App {
  if (adminApp) return adminApp;

  // In production: secrets injected via Firebase Secret Manager
  // In local dev: from functions/.env.local
  const privateKey = (process.env.FIREBASE_SA_PRIVATE_KEY || "").replace(/\\n/g, "\n");
  const clientEmail = process.env.FIREBASE_SA_CLIENT_EMAIL || "";
  const projectId = process.env.FIREBASE_PROJECT_ID || "client-dash-9b027";

  if (privateKey && clientEmail) {
    adminApp = admin.initializeApp(
      {
        credential: admin.credential.cert({ projectId, privateKey, clientEmail }),
        storageBucket: `${projectId}.appspot.com`,
      },
      "admin"
    );
  } else {
    // Fallback: use Application Default Credentials (works inside Firebase emulator)
    adminApp = admin.apps.find((a) => a?.name === "admin") ?? admin.initializeApp({}, "admin");
  }

  return adminApp;
}

export const getAdminAuth = () => admin.auth(getAdminApp());
export const getAdminFirestore = () => admin.firestore(getAdminApp());
export const getAdminStorage = () => admin.storage(getAdminApp());
