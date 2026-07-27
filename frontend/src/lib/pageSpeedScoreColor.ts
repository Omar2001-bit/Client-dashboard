/** Color helpers for 0-100 scale Lighthouse scores and Core Web Vitals (as opposed to
 * the 0-1 scale helpers in pageSpeedMetrics.ts, which cover extended audit metrics). */

export function scoreColor(score: number): string {
  if (score >= 90) return "text-[#0cce6b]";
  if (score >= 50) return "text-[#ffa400]";
  return "text-[#ff4e42]";
}

export function scoreRingColor(score: number): string {
  if (score >= 90) return "#0cce6b";
  if (score >= 50) return "#ffa400";
  return "#ff4e42";
}

/** Used for the Past Runs summary chips — an intentionally distinct, slightly muted palette. */
export function scoreBarColor(score: number): string {
  if (score >= 90) return "#10b981";
  if (score >= 50) return "#f59e0b";
  return "#ef4444";
}

export function vitalColor(metric: string, value: number | null): string {
  if (value == null) return "text-ink/40";
  if (metric === "lcp") return value <= 2500 ? "text-[#0cce6b]" : value <= 4000 ? "text-[#ffa400]" : "text-[#ff4e42]";
  if (metric === "fcp") return value <= 1800 ? "text-[#0cce6b]" : value <= 3000 ? "text-[#ffa400]" : "text-[#ff4e42]";
  if (metric === "cls") return value <= 0.1 ? "text-[#0cce6b]" : value <= 0.25 ? "text-[#ffa400]" : "text-[#ff4e42]";
  if (metric === "tbt") return value <= 200 ? "text-[#0cce6b]" : value <= 600 ? "text-[#ffa400]" : "text-[#ff4e42]";
  if (metric === "inp") return value <= 200 ? "text-[#0cce6b]" : value <= 500 ? "text-[#ffa400]" : "text-[#ff4e42]";
  if (metric === "si") return value <= 3400 ? "text-[#0cce6b]" : value <= 5800 ? "text-[#ffa400]" : "text-[#ff4e42]";
  return "text-ink/60";
}

export function formatMs(ms: number | null): string {
  if (ms == null) return "—";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
}

export function formatCls(value: number | null): string {
  if (value == null) return "—";
  return value.toFixed(3);
}
