import { initializeApp } from "firebase/app";
import { connectAuthEmulator, getAuth } from "firebase/auth";
import { connectFirestoreEmulator, getFirestore } from "firebase/firestore";
import { connectStorageEmulator, getStorage } from "firebase/storage";

export const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: "client-dash-9b027.firebaseapp.com",
  projectId: "client-dash-9b027",
  storageBucket: "client-dash-9b027.firebasestorage.app",
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);

// Opt-in local emulator wiring — off by default, zero effect unless explicitly enabled
// via frontend/.env.local (VITE_USE_FIREBASE_EMULATOR=true), for testing security-rules
// changes against `firebase emulators:start` instead of the live production project.
if (import.meta.env.DEV && import.meta.env.VITE_USE_FIREBASE_EMULATOR === "true") {
  connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
  connectFirestoreEmulator(db, "127.0.0.1", 8080);
  connectStorageEmulator(storage, "127.0.0.1", 9199);
}
