import { Zap, Eye, Search, Shield, Clock } from "lucide-react";

export type MetricUnit = "ms" | "s" | "bytes" | "score" | "number";

export interface MetricConfig {
  key: string;
  label: string;
  fullLabel: string;
  description: string;
  icon: typeof Zap;
  unit: MetricUnit;
  lowerIsBetter: boolean;
}

export const SCORE_METRICS: MetricConfig[] = [
  { key: "performance", label: "Performance", fullLabel: "Performance Score", description: "Overall loading speed and runtime responsiveness score.", icon: Zap, unit: "number", lowerIsBetter: false },
  { key: "accessibility", label: "Accessibility", fullLabel: "Accessibility Score", description: "Automated accessibility checks for inclusive UX quality.", icon: Eye, unit: "number", lowerIsBetter: false },
  { key: "seo", label: "SEO", fullLabel: "SEO Score", description: "Search discoverability and metadata best-practice signals.", icon: Search, unit: "number", lowerIsBetter: false },
  { key: "bestPractices", label: "Best Practices", fullLabel: "Best Practices Score", description: "Security and modern web implementation quality checks.", icon: Shield, unit: "number", lowerIsBetter: false },
];

export const VITAL_METRICS: MetricConfig[] = [
  { key: "lcp", label: "LCP", fullLabel: "Largest Contentful Paint", description: "Time until the largest above-the-fold content is rendered.", icon: Clock, unit: "ms", lowerIsBetter: true },
  { key: "fcp", label: "FCP", fullLabel: "First Contentful Paint", description: "Time until first text/image appears on screen.", icon: Clock, unit: "ms", lowerIsBetter: true },
  { key: "cls", label: "CLS", fullLabel: "Cumulative Layout Shift", description: "Visual stability score from unexpected layout movement.", icon: Clock, unit: "score", lowerIsBetter: true },
  { key: "tbt", label: "TBT", fullLabel: "Total Blocking Time", description: "Main-thread blocking time that harms interactivity.", icon: Clock, unit: "ms", lowerIsBetter: true },
  { key: "si", label: "SI", fullLabel: "Speed Index", description: "How fast the page becomes visually complete.", icon: Clock, unit: "ms", lowerIsBetter: true },
  { key: "inp", label: "INP", fullLabel: "Interaction to Next Paint", description: "Latency from user action to rendered feedback.", icon: Clock, unit: "ms", lowerIsBetter: true },
];

const METRIC_EXPLANATIONS: Record<string, string> = {
  "largest-contentful-paint": "Time until the largest visible content element is rendered.",
  "first-contentful-paint": "Time until the first piece of DOM content appears on screen.",
  "speed-index": "How quickly the page visually fills with content.",
  "total-blocking-time": "How long main-thread blocking prevents user interaction.",
  "interaction-to-next-paint": "Latency from interaction to next visual paint.",
  "cumulative-layout-shift": "Visual stability score from unexpected layout movement.",
  "server-response-time": "Back-end responsiveness to the initial HTML request.",
  "max-potential-fid": "Estimated worst-case first input delay under load.",
  "bootup-time": "Main-thread JavaScript startup execution time.",
  "mainthread-work-breakdown": "Total time spent on script/style/layout/paint tasks.",
  "unused-javascript": "Estimated savings from removing unused JS bytes.",
  "unused-css-rules": "Estimated savings from removing unused CSS bytes.",
  "render-blocking-resources": "Delay caused by blocking CSS/JS resources.",
  "unminified-javascript": "Estimated savings if JavaScript were minified.",
  "unminified-css": "Estimated savings if CSS were minified.",
  "uses-optimized-images": "Estimated savings from better image compression.",
  "uses-responsive-images": "Estimated savings from serving right-sized responsive images.",
  "efficient-animated-content": "Estimated savings from optimized animated image/video formats.",
  "modern-image-formats": "Estimated savings from next-generation image formats.",
  "offscreen-images": "Estimated savings from lazy-loading below-the-fold images.",
  "duplicated-javascript": "Estimated savings from reducing duplicated JavaScript modules.",
  "legacy-javascript": "Potential savings from avoiding legacy JavaScript for modern browsers.",
  "dom-size": "DOM complexity and depth that can slow style, layout, and scripting.",
  "third-party-summary": "Main-thread and transfer cost from third-party scripts.",
  "third-party-facades": "Opportunities to delay expensive third-party embeds with facades.",
  redirects: "Extra navigation redirects before the final document loads.",
  "uses-text-compression": "Estimated savings from gzip, Brotli, or similar text compression.",
  "uses-long-cache-ttl": "Static resources that could use longer browser cache lifetimes.",
  "total-byte-weight": "Total transferred resource weight for the page.",
  "network-requests": "Number and size of network requests made during load.",
  "critical-request-chains": "Render-critical dependency chains that delay first paint.",
  "resource-summary": "Transfer size and request counts by resource type.",
  "font-display": "Whether web fonts keep text visible while font files load.",
  "layout-shifts": "Elements contributing to layout movement.",
  "lcp-lazy-loaded": "Whether the LCP image was delayed by lazy-loading.",
  "prioritize-lcp-image": "Whether the LCP image should be prioritized.",
  "uses-rel-preconnect": "Origins that could benefit from early connection setup.",
  "uses-rel-preload": "Critical resources that could be preloaded earlier.",
};

export function explainMetric(key: string, fallback?: string): string {
  return METRIC_EXPLANATIONS[key] ?? fallback ?? "Lighthouse audit metric from PageSpeed Insights.";
}

export function toHumanLabel(key: string): string {
  return key
    .split("-")
    .map((p) => (p.length <= 3 ? p.toUpperCase() : p.charAt(0).toUpperCase() + p.slice(1)))
    .join(" ");
}

export function metricUnitForKey(key: string): MetricUnit {
  if (key.includes("layout-shift")) return "score";
  if (key.includes("time") || key.includes("paint") || key.includes("fid") || key.includes("blocking")) return "ms";
  if (key.includes("byte") || key.includes("javascript") || key.includes("css") || key.includes("resource")) return "bytes";
  return "number";
}

export function formatMetricValue(value: number | null | undefined, unit: MetricUnit): string {
  if (value == null || !Number.isFinite(value)) return "—";
  if (unit === "ms") return value < 1000 ? `${Math.round(value)} ms` : `${(value / 1000).toFixed(2)} s`;
  if (unit === "bytes") return `${Math.round(value).toLocaleString()} B`;
  if (unit === "score") return value.toFixed(3);
  return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

export function lighthouseScoreColor(score: number | null | undefined): string {
  if (score == null || !Number.isFinite(score)) return "text-ink/50";
  if (score >= 0.9) return "text-[#0cce6b]";
  if (score >= 0.5) return "text-[#ffa400]";
  return "text-[#ff4e42]";
}

export function lighthouseScoreBg(score: number | null | undefined): string {
  if (score == null || !Number.isFinite(score)) return "bg-ink/[0.02] border-ink/10";
  if (score >= 0.9) return "bg-[#0cce6b]/10 border-[#0cce6b]/25";
  if (score >= 0.5) return "bg-[#ffa400]/10 border-[#ffa400]/25";
  return "bg-[#ff4e42]/10 border-[#ff4e42]/25";
}
