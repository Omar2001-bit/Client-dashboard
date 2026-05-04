import { useState, useCallback, useEffect, useMemo } from "react";
import { collection, getDocs, limit, query } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { ADMIN_TUTORIAL_STEPS } from "@/lib/adminTutorialSteps";
import { useAuthStore } from "@/store/authStore";

const STORAGE_KEY = "optimizers_admin_tutorial_done_v1";

export function useAdminTutorial() {
  const role = useAuthStore((s) => s.role);
  const [active, setActive] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);
  const [firstClientId, setFirstClientId] = useState<string | null>(null);

  // Fetch the first available clientId so tutorial can navigate into a real client
  useEffect(() => {
    if (!role || role === "client") return;
    getDocs(query(collection(db, "clients"), limit(1))).then((snap) => {
      if (!snap.empty) setFirstClientId(snap.docs[0].id);
    });
  }, [role]);

  // Build resolved steps — filter by role and replace {clientId} in routes
  const steps = useMemo(() => {
    const cid = firstClientId ?? "";
    return ADMIN_TUTORIAL_STEPS
      .filter((s) => !s.execAdminOnly || role === "executiveAdmin")
      .map((s) => ({
        ...s,
        // Replace placeholder in route; if no client yet, fall back gracefully
        route: cid
          ? s.route.replace("{clientId}", cid)
          : s.route
              .replace("/admin/clients/{clientId}", "/admin/clients")
              .replace("?client={clientId}", ""),
        // Clear target if we have no client (the element won't exist)
        target: !cid && s.route.includes("{clientId}") ? null : s.target,
      }));
  }, [role, firstClientId]);

  // Auto-trigger on first admin visit
  useEffect(() => {
    if (!role || role === "client") return;
    if (localStorage.getItem(STORAGE_KEY)) return;
    const t = setTimeout(() => setActive(true), 1200);
    return () => clearTimeout(t);
  }, [role]);

  const start = useCallback(() => {
    setCurrentStep(0);
    setActive(true);
  }, []);

  const next = useCallback(() => {
    setCurrentStep((i) => {
      if (i >= steps.length - 1) {
        setActive(false);
        localStorage.setItem(STORAGE_KEY, "1");
        return 0;
      }
      return i + 1;
    });
  }, [steps.length]);

  const skipStep = useCallback(() => {
    setCurrentStep((i) => {
      if (i >= steps.length - 1) {
        setActive(false);
        localStorage.setItem(STORAGE_KEY, "1");
        return 0;
      }
      return i + 1;
    });
  }, [steps.length]);

  const skipAll = useCallback(() => {
    setActive(false);
    localStorage.setItem(STORAGE_KEY, "1");
    setCurrentStep(0);
  }, []);

  return { active, currentStep, steps, start, next, skipStep, skipAll };
}
