import { create } from "zustand";
import type { User } from "firebase/auth";
import type { UserRole } from "@/types";

interface AuthState {
  user: User | null;
  role: UserRole | null;
  clientId: string | null;
  loading: boolean;
  setUser: (user: User | null) => void;
  setClaims: (role: UserRole | null, clientId: string | null) => void;
  setLoading: (loading: boolean) => void;
  reset: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  role: null,
  clientId: null,
  loading: true,
  setUser: (user) => set({ user }),
  setClaims: (role, clientId) => set({ role, clientId }),
  setLoading: (loading) => set({ loading }),
  reset: () => set({ user: null, role: null, clientId: null, loading: false }),
}));
