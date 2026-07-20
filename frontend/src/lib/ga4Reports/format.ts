// Ported verbatim from VC3/GA4-simply-layer's src/lib/format.ts — GA4-metric-type-aware
// value/percent/currency formatting, no framework dependency.
import { bucketSpan, type TimeGranularity } from "./dates";

/** Currency codes Intl.NumberFormat won't recognize as valid ISO 4217 — GA4 properties
 *  can be configured with these but the formatter throws on an unrecognized code, so fall
 *  back to plain-number + code suffix. */
function isValidCurrencyCode(code: string): boolean {
  try {
    new Intl.NumberFormat(undefined, { style: "currency", currency: code });
    return true;
  } catch {
    return false;
  }
}

/** Format a metric value according to its GA4 metric type. `currencyCode` is the
 *  property's real currency (from GA4's report metadata, e.g. "EGP") — when present,
 *  TYPE_CURRENCY renders with a real symbol/placement via Intl instead of a bare number
 *  that could be mistaken for a plain count. */
export function fmtValue(value: number, type?: string, currencyCode?: string): string {
  if (!Number.isFinite(value)) return "–";
  switch (type) {
    case "TYPE_RATE_PERCENT":
      // conversion rates can legitimately exceed 100% (repeat purchases per user) —
      // always show as percent, unlike TYPE_FLOAT's 0-1 heuristic.
      return `${(value * 100).toFixed(1)}%`;
    case "TYPE_SECONDS": {
      const s = Math.round(value);
      const m = Math.floor(s / 60);
      const rem = s % 60;
      return m > 0 ? `${m}m ${rem}s` : `${rem}s`;
    }
    case "TYPE_CURRENCY":
      if (currencyCode && isValidCurrencyCode(currencyCode)) {
        return new Intl.NumberFormat(undefined, {
          style: "currency",
          currency: currencyCode,
          maximumFractionDigits: 2,
        }).format(value);
      }
      return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
    case "TYPE_FLOAT": {
      // GA4 rates (bounceRate, engagementRate…) come back as 0–1 fractions
      if (value > 0 && value < 1) return `${(value * 100).toFixed(1)}%`;
      return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
    }
    default:
      return Math.round(value).toLocaleString();
  }
}

/** Compact display for tight spaces (cards, chart labels). */
export function fmtCompact(value: number, type?: string, currencyCode?: string): string {
  if (!Number.isFinite(value)) return "–";
  if (type === "TYPE_RATE_PERCENT" || type === "TYPE_SECONDS" || (type === "TYPE_FLOAT" && value > 0 && value < 1)) {
    return fmtValue(value, type, currencyCode);
  }
  if (Math.abs(value) >= 1000) {
    const compact = Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 }).format(value);
    if (type === "TYPE_CURRENCY" && currencyCode && isValidCurrencyCode(currencyCode)) {
      const symbol = (0)
        .toLocaleString(undefined, { style: "currency", currency: currencyCode, maximumFractionDigits: 0 })
        .replace(/[0-9]/g, "")
        .trim();
      return symbol ? `${symbol}${compact}` : compact;
    }
    return compact;
  }
  return fmtValue(value, type, currencyCode);
}

/** Percent change of a vs b. Returns null when not computable. */
export function deltaPct(a: number, b?: number): number | null {
  if (b === undefined || !Number.isFinite(b)) return null;
  if (b === 0) return a === 0 ? 0 : null;
  return ((a - b) / Math.abs(b)) * 100;
}

export function fmtDelta(d: number | null): string {
  if (d === null) return "–";
  const sign = d > 0 ? "+" : "";
  return `${sign}${d.toFixed(1)}%`;
}

/** "20260702" or "2026-07-02" -> "Jul 2" */
export function fmtDateLabel(raw: string): string {
  const s = raw.replaceAll("-", "");
  if (!/^\d{8}$/.test(s)) return raw;
  const d = new Date(Number(s.slice(0, 4)), Number(s.slice(4, 6)) - 1, Number(s.slice(6, 8)));
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** "20260706" -> "Jul 6" for daily; week/month buckets get their own span-based label
 *  ("Jul 6 – Jul 12", "Jul 2026") instead of showing the raw GA4 bucket key ("202628"). */
export function fmtBucketLabel(g: TimeGranularity, key: string): string {
  if (!key) return key;
  if (g === "date") return fmtDateLabel(key);
  const { start, end } = bucketSpan(g, key);
  if (g === "month") {
    return new Date(start + "T00:00:00").toLocaleDateString(undefined, { month: "short", year: "numeric" });
  }
  return `${fmtDateLabel(start.replaceAll("-", ""))} – ${fmtDateLabel(end.replaceAll("-", ""))}`;
}

/** Human label for a metric/dimension apiName when metadata isn't loaded. */
export function humanize(apiName: string): string {
  return apiName
    .replace(/([A-Z])/g, " $1")
    .replace(/^./, (c) => c.toUpperCase())
    .trim();
}

/** Human label for a GA4 event name — these are snake_case ("add_to_cart"), not
 *  camelCase, so humanize()'s capital-letter split does nothing for them. */
export function humanizeEvent(eventName: string): string {
  return eventName
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}
