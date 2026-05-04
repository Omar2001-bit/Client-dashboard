import { useEffect } from "react";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { auth, db } from "@/lib/firebase";
import { useAuthStore } from "@/store/authStore";
import type { UserRole } from "@/types";

export function useAuthInit() {
  const { setUser, setClaims, setLoading } = useAuthStore();

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      setUser(user);
      if (user) {
        const result = await user.getIdTokenResult(true);
        let role = (result.claims.role as UserRole) ?? null;
        let clientId = (result.claims.clientId as string) ?? null;
        if (!role) {
          const userDoc = await getDoc(doc(db, "users", user.uid));
          const data = userDoc.data();
          role = (data?.role as UserRole) ?? null;
          clientId = (data?.clientId as string) ?? null;
        }
        setClaims(role, clientId);
      } else {
        setClaims(null, null);
      }
      setLoading(false);
    });
    return unsubscribe;
  }, [setUser, setClaims, setLoading]);
}

export function useLogout() {
  const reset = useAuthStore((s) => s.reset);
  return async () => {
    await signOut(auth);
    reset();
  };
}
