import { useEffect, useState, useRef } from "react";
import { createPortal } from "react-dom";
import { useNavigate, useLocation } from "react-router-dom";
import { ChevronRight, X, SkipForward } from "lucide-react";
import { Button } from "@/components/ui";
import type { TutorialPosition } from "@/lib/tutorialSteps";

interface Rect { top: number; left: number; width: number; height: number; }

/** Structural shape shared by both the client (`TutorialStep`) and admin
 * (`AdminTutorialStep`) step lists — this component only ever reads these fields. */
interface TutorialStepLike {
  title: string;
  description: string;
  target: string | null;
  route: string;
  position: TutorialPosition;
  padding?: number;
}

interface Props {
  steps: TutorialStepLike[];
  currentStep: number;
  onNext: () => void;
  onSkipStep: () => void;
  onSkipAll: () => void;
}

function getTooltipStyle(position: TutorialPosition, rect: Rect | null): React.CSSProperties {
  const W = 340;
  const GAP = 16;
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  if (!rect || position === "center") {
    return { top: "50%", left: "50%", transform: "translate(-50%, -50%)" };
  }

  const clampX = (x: number) => Math.max(16, Math.min(x, vw - W - 16));
  const clampY = (y: number) => Math.max(16, Math.min(y, vh - 280));
  const midX = clampX(rect.left + rect.width / 2 - W / 2);

  switch (position) {
    case "bottom": return { top: clampY(rect.top + rect.height + GAP), left: midX };
    case "top":    return { top: clampY(rect.top - 260 - GAP), left: midX };
    case "right":  return { top: clampY(rect.top + rect.height / 2 - 130), left: clampX(rect.left + rect.width + GAP) };
    case "left":   return { top: clampY(rect.top + rect.height / 2 - 130), left: clampX(rect.left - W - GAP) };
    default:       return { top: "50%", left: "50%", transform: "translate(-50%, -50%)" };
  }
}

export function Tutorial({ steps, currentStep, onNext, onSkipStep, onSkipAll }: Props) {
  const navigate = useNavigate();
  const location = useLocation();
  const [spotlight, setSpotlight] = useState<Rect | null>(null);
  const [visible, setVisible] = useState(false);
  const attemptsRef = useRef(0);
  const targetElRef = useRef<Element | null>(null);

  const step = steps[currentStep];
  const isLast = currentStep === steps.length - 1;
  const pad = step?.padding ?? 12;

  // Lock background scroll for the lifetime of the tour so the spotlight
  // can never drift away from its target while a step is showing.
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  useEffect(() => {
    if (!step) return;
    setVisible(false);
    setSpotlight(null);
    attemptsRef.current = 0;
    targetElRef.current = null;

    const doFind = () => {
      const fullPath = location.pathname + location.search;
      if (step.route && fullPath !== step.route) {
        navigate(step.route);
      }

      if (!step.target) {
        setTimeout(() => setVisible(true), 200);
        return;
      }

      const tryFind = () => {
        const el = document.querySelector(step.target!);
        if (el) {
          targetElRef.current = el;
          el.scrollIntoView({ behavior: "smooth", block: "center" });
          setTimeout(() => {
            const r = el.getBoundingClientRect();
            setSpotlight({ top: r.top - pad, left: r.left - pad, width: r.width + pad * 2, height: r.height + pad * 2 });
            setVisible(true);
          }, 400);
        } else if (attemptsRef.current < 30) {
          attemptsRef.current++;
          setTimeout(tryFind, 150);
        } else {
          setVisible(true);
        }
      };

      setTimeout(tryFind, 400);
    };

    doFind();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentStep]);

  // Keep the spotlight aligned with its target even if a nested scrollable
  // container scrolls or the window resizes (body scroll itself is locked above).
  useEffect(() => {
    const recompute = () => {
      const el = targetElRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      setSpotlight({ top: r.top - pad, left: r.left - pad, width: r.width + pad * 2, height: r.height + pad * 2 });
    };

    window.addEventListener("scroll", recompute, true);
    window.addEventListener("resize", recompute);
    return () => {
      window.removeEventListener("scroll", recompute, true);
      window.removeEventListener("resize", recompute);
    };
  }, [currentStep, pad]);

  if (!step || !visible) return null;

  const tooltipStyle = getTooltipStyle(step.position, spotlight);

  const dots = steps.map((_, i) => (
    <div
      key={i}
      className={`rounded-full transition-all duration-300 ${
        i === currentStep ? "w-5 h-1.5 bg-brand-500" : i < currentStep ? "w-1.5 h-1.5 bg-brand-300" : "w-1.5 h-1.5 bg-ink/15"
      }`}
    />
  ));

  return createPortal(
    <div style={{ position: "fixed", inset: 0, zIndex: 99990, pointerEvents: "none" }}>
      {/* Backdrop — 4 quadrants leaving the spotlight uncovered */}
      {spotlight ? (
        <>
          <div onClick={onSkipAll} style={{ position: "fixed", top: 0, left: 0, right: 0, height: Math.max(0, spotlight.top), background: "rgba(22,42,61,0.72)", pointerEvents: "auto" }} />
          <div onClick={onSkipAll} style={{ position: "fixed", top: spotlight.top + spotlight.height, left: 0, right: 0, bottom: 0, background: "rgba(22,42,61,0.72)", pointerEvents: "auto" }} />
          <div onClick={onSkipAll} style={{ position: "fixed", top: spotlight.top, left: 0, width: Math.max(0, spotlight.left), height: spotlight.height, background: "rgba(22,42,61,0.72)", pointerEvents: "auto" }} />
          <div onClick={onSkipAll} style={{ position: "fixed", top: spotlight.top, left: spotlight.left + spotlight.width, right: 0, height: spotlight.height, background: "rgba(22,42,61,0.72)", pointerEvents: "auto" }} />
          {/* Spotlight ring */}
          <div style={{ position: "fixed", top: spotlight.top, left: spotlight.left, width: spotlight.width, height: spotlight.height, border: "2px solid #6ae499", borderRadius: 10, boxShadow: "0 0 0 4px rgba(106,228,153,0.18), 0 0 20px rgba(106,228,153,0.12)", pointerEvents: "none" }} />
        </>
      ) : (
        <div onClick={onSkipAll} style={{ position: "fixed", inset: 0, background: "rgba(22,42,61,0.72)", pointerEvents: "auto" }} />
      )}

      {/* Tooltip card */}
      <div
        style={{ position: "fixed", zIndex: 99999, width: 340, pointerEvents: "auto", ...tooltipStyle }}
        className="rounded-2xl border border-ink/10 bg-white shadow-[0_20px_60px_rgba(22,42,61,0.25)] p-5"
      >
        {/* Progress dots */}
        <div className="flex items-center gap-1 mb-4">
          {dots}
          <span className="ml-auto text-[11px] font-medium text-ink/35 tabular-nums">{currentStep + 1} / {steps.length}</span>
        </div>

        <h3 className="font-bold text-ink text-base leading-snug mb-2">{step.title}</h3>
        <p className="text-sm text-ink/60 leading-relaxed mb-5">{step.description}</p>

        <div className="flex items-center justify-between">
          <button
            onClick={onSkipAll}
            className="flex items-center gap-1 text-xs text-ink/35 hover:text-ink/60 transition-colors"
          >
            <X className="h-3 w-3" />
            Skip tour
          </button>
          <div className="flex items-center gap-2">
            {!isLast && currentStep > 0 && (
              <button onClick={onSkipStep} className="flex items-center gap-1 text-xs text-ink/40 hover:text-ink/60 transition-colors px-2 py-1.5 rounded-lg hover:bg-ink/5">
                <SkipForward className="h-3.5 w-3.5" /> Skip
              </button>
            )}
            <Button variant="dark" onClick={onNext}>
              {isLast ? "Finish 🎉" : "Next"}
              {!isLast && <ChevronRight className="ml-1.5 h-4 w-4" />}
            </Button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
