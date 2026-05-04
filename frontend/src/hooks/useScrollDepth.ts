import { useEffect, useRef } from "react";
import { track } from "@/lib/activityTracker";

// Fires once per milestone (25/50/75/100%) per page mount.
// Attaches to the <main> scroll container used by ClientLayout.
export function useScrollDepth() {
  const reached = useRef(new Set<number>());

  useEffect(() => {
    reached.current.clear();

    const container = document.querySelector("main") as HTMLElement | null;
    if (!container) return;

    const handleScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = container;
      const scrollable = scrollHeight - clientHeight;
      if (scrollable <= 0) return;
      const pct = Math.round((scrollTop / scrollable) * 100);

      for (const milestone of [25, 50, 75, 100]) {
        if (pct >= milestone && !reached.current.has(milestone)) {
          reached.current.add(milestone);
          track({ type: "scroll_depth", metadata: { depthPercent: milestone } });
        }
      }
    };

    container.addEventListener("scroll", handleScroll, { passive: true });
    return () => container.removeEventListener("scroll", handleScroll);
  }, []);
}
