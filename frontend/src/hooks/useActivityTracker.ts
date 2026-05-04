import { useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";
import { useAuthStore } from "@/store/authStore";
import { trackActivity, SESSION_ID } from "@/lib/activityTracker";

export const PAGE_TITLES: Record<string, string> = {
  "/dashboard": "Dashboard",
  "/dashboard/ab-testing": "A/B Testing Results",
  "/dashboard/experiments": "Experiments",
  "/dashboard/timeline": "Timeline",
  "/dashboard/book-meeting": "Book a Meeting",
  "/dashboard/support": "Support",
  "/dashboard/profile": "Profile",
};

export function getPageTitle(pathname: string): string {
  if (PAGE_TITLES[pathname]) return PAGE_TITLES[pathname];
  if (pathname.startsWith("/dashboard/experiments/")) return "Experiment Detail";
  return pathname;
}

export function useActivityTracker() {
  const location = useLocation();
  const user = useAuthStore((s) => s.user);
  const clientId = useAuthStore((s) => s.clientId);
  const role = useAuthStore((s) => s.role);

  const active = role === "client" && !!clientId && !!user?.uid;

  const pageEnterTime = useRef(Date.now());
  const lastPath = useRef(location.pathname);
  const hasTrackedInitial = useRef(false);

  // Page view + time-on-page tracking
  useEffect(() => {
    if (!active || !clientId || !user?.uid) return;

    const path = location.pathname;
    const uid = user.uid;
    const now = Date.now();

    if (!hasTrackedInitial.current) {
      trackActivity(clientId, uid, {
        type: "page_view",
        page: path,
        pageTitle: getPageTitle(path),
        url: window.location.href,
        referrer: document.referrer || undefined,
      });
      hasTrackedInitial.current = true;
    } else if (path !== lastPath.current) {
      const exitUrl = window.location.href;
      trackActivity(clientId, uid, {
        type: "page_exit",
        page: lastPath.current,
        pageTitle: getPageTitle(lastPath.current),
        url: exitUrl,
        durationMs: now - pageEnterTime.current,
      });
      trackActivity(clientId, uid, {
        type: "page_view",
        page: path,
        pageTitle: getPageTitle(path),
        url: window.location.href,
        referrer: lastPath.current,
      });
    }

    pageEnterTime.current = now;
    lastPath.current = path;
  }, [location.pathname, active, clientId, user?.uid]);

  // Tab visibility tracking
  useEffect(() => {
    if (!active || !clientId || !user?.uid) return;
    const uid = user.uid;
    const cid = clientId;

    const handleVisibilityChange = () => {
      if (document.hidden) {
        trackActivity(cid, uid, {
          type: "tab_hidden",
          page: lastPath.current,
          pageTitle: getPageTitle(lastPath.current),
          url: window.location.href,
          metadata: { durationOnPageMs: Date.now() - pageEnterTime.current },
        });
      } else {
        trackActivity(cid, uid, {
          type: "tab_visible",
          page: lastPath.current,
          pageTitle: getPageTitle(lastPath.current),
          url: window.location.href,
        });
        // Reset timer — they're back
        pageEnterTime.current = Date.now();
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, [active, clientId, user?.uid]);

  // Final exit when layout unmounts (logout / tab close)
  useEffect(() => {
    if (!active || !clientId || !user?.uid) return;
    const uid = user.uid;
    const cid = clientId;
    return () => {
      trackActivity(cid, uid, {
        type: "page_exit",
        page: lastPath.current,
        pageTitle: getPageTitle(lastPath.current),
        url: window.location.href,
        durationMs: Date.now() - pageEnterTime.current,
      });
    };
  }, [active, clientId, user?.uid]);
}

// Re-export so SESSION_ID is accessible if needed
export { SESSION_ID };
