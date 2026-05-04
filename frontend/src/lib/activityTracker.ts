import { addDoc, collection, serverTimestamp } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuthStore } from "@/store/authStore";

export type ActivityEventType =
  | "page_view"
  | "page_exit"
  // Dashboard
  | "date_range_change"
  | "full_range_reset"
  | "exclude_losses_toggle"
  | "metric_mode_change"
  | "dashboard_experiment_click"
  // Experiment list
  | "experiment_view"
  | "search"
  | "sort_change"
  | "list_page_change"
  | "experiment_visibility_toggle"
  // Experiment detail
  | "variation_preview_click"
  | "experiment_detail_hide_toggle"
  // Support
  | "support_message_sent"
  // Meetings
  | "meeting_type_selected"
  // Profile
  | "password_changed"
  // A/B testing hub
  | "ab_testing_view_selected"
  // Floating chat
  | "chat_opened"
  | "chat_closed"
  | "chat_message_sent"
  // Timeline
  | "timeline_phase_selected"
  // Attention
  | "tab_hidden"
  | "tab_visible"
  // Scroll depth
  | "scroll_depth"
  // Chart
  | "chart_date_hover"
  // Navigation
  | "back_navigation"
  // Tutorial
  | "tutorial_started"
  | "tutorial_step_viewed"
  | "tutorial_step_skipped"
  | "tutorial_skipped"
  | "tutorial_completed"
  | "tutorial_reopened";

export interface ActivityEvent {
  type: ActivityEventType;
  page: string;
  pageTitle?: string;
  url?: string;
  referrer?: string;
  durationMs?: number;
  metadata?: Record<string, unknown>;
}

// Unique per browser tab — groups all events from one visit into a session
export const SESSION_ID = crypto.randomUUID();

// Read auth state directly from Zustand at call time — no stale closure risk
export function track(event: Omit<ActivityEvent, "page"> & { page?: string }): void {
  const { user, role, clientId } = useAuthStore.getState();
  if (role !== "client" || !clientId || !user?.uid) return;
  void trackActivity(clientId, user.uid, {
    page: window.location.pathname,
    ...event,
  });
}

export async function trackActivity(
  clientId: string,
  userId: string,
  event: ActivityEvent
): Promise<void> {
  try {
    await addDoc(collection(db, "clients", clientId, "activityLogs"), {
      ...event,
      url: event.url ?? window.location.href,
      sessionId: SESSION_ID,
      userId,
      clientId,
      timestamp: serverTimestamp(),
    });
  } catch {
    // Tracking must never break the UI
  }
}
