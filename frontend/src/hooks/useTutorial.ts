import { useState, useCallback, useEffect, useMemo } from "react";
import { collection, getDocs, limit, query } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { track } from "@/lib/activityTracker";
import { TUTORIAL_STEPS } from "@/lib/tutorialSteps";
import { useAuthStore } from "@/store/authStore";

const STORAGE_KEY = "optimizers_tutorial_done_v1";

export function useTutorial() {
  const { clientId, role } = useAuthStore((s) => ({ clientId: s.clientId, role: s.role }));
  const [active, setActive] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);
  const [firstExperimentId, setFirstExperimentId] = useState<string | null>(null);

  // Fetch the first available experimentId so the tutorial can navigate into a real detail page
  useEffect(() => {
    if (!clientId || role !== "client") return;
    getDocs(query(collection(db, "clients", clientId, "experiments"), limit(1))).then((snap) => {
      if (!snap.empty) setFirstExperimentId(snap.docs[0].id);
    });
  }, [clientId, role]);

  // Build resolved steps — replace {experimentId} placeholder with a real ID
  const steps = useMemo(() => {
    const eid = firstExperimentId ?? "";
    return TUTORIAL_STEPS.map((s) => ({
      ...s,
      route: eid
        ? s.route.replace("{experimentId}", eid)
        : s.route.replace("/dashboard/experiments/{experimentId}", "/dashboard/experiments"),
      // Clear target if no experiment available (element won't exist)
      target: !eid && s.route.includes("{experimentId}") ? null : s.target,
    }));
  }, [firstExperimentId]);

  // Auto-trigger on first visit
  useEffect(() => {
    if (!localStorage.getItem(STORAGE_KEY)) {
      const t = setTimeout(() => {
        setActive(true);
        track({ type: "tutorial_started", metadata: { trigger: "auto", totalSteps: steps.length } });
      }, 1200);
      return () => clearTimeout(t);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const start = useCallback(() => {
    setCurrentStep(0);
    setActive(true);
    track({ type: "tutorial_reopened", metadata: { trigger: "manual", totalSteps: steps.length } });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const next = useCallback(() => {
    setCurrentStep((i) => {
      const step = steps[i];
      track({
        type: "tutorial_step_viewed",
        metadata: { stepIndex: i, stepId: step?.id, stepTitle: step?.title },
      });
      if (i >= steps.length - 1) {
        setActive(false);
        localStorage.setItem(STORAGE_KEY, "1");
        track({ type: "tutorial_completed", metadata: { totalSteps: steps.length } });
        return 0;
      }
      return i + 1;
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [steps]);

  const skipStep = useCallback(() => {
    setCurrentStep((i) => {
      const step = steps[i];
      track({
        type: "tutorial_step_skipped",
        metadata: { stepIndex: i, stepId: step?.id, stepTitle: step?.title },
      });
      if (i >= steps.length - 1) {
        setActive(false);
        localStorage.setItem(STORAGE_KEY, "1");
        return 0;
      }
      return i + 1;
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [steps]);

  const skipAll = useCallback(() => {
    setCurrentStep((i) => {
      const step = steps[i];
      track({
        type: "tutorial_skipped",
        metadata: { atStep: i, atStepId: step?.id, atStepTitle: step?.title },
      });
      return 0;
    });
    setActive(false);
    localStorage.setItem(STORAGE_KEY, "1");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [steps]);

  return { active, currentStep, steps, start, next, skipStep, skipAll };
}
