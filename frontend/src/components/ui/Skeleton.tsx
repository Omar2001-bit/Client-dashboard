import { cn } from "@/lib/cn";

/** Loading placeholder bar. Size it with utilities (e.g. `h-8 w-32`). */
export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded-md bg-ink/10", className)} />;
}
