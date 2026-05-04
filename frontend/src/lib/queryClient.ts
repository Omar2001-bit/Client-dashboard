import { QueryClient } from "@tanstack/react-query";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Data is considered fresh for 5 minutes — within this window, navigating
      // between pages won't refetch.
      staleTime: 5 * 60 * 1000,
      // Keep cached data in memory for 30 minutes after no component is using it.
      gcTime: 30 * 60 * 1000,
      // Don't refetch when window regains focus — Convert rate-limits hard.
      refetchOnWindowFocus: false,
      // Don't refetch on reconnect either.
      refetchOnReconnect: false,
      // Don't auto-retry; we already retry inside fetchWithRetry for rate limits.
      retry: false,
    },
  },
});
