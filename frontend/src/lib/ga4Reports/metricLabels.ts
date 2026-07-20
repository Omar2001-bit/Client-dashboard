// Extracted from VC3/GA4-simply-layer's src/components/ChartView.tsx, where metricLabel()
// lived in a UI component file despite having zero JSX dependency — a lib function
// importing from a component file is backwards. Moved here so every consumer (ChartView,
// NumbersView, AnalyticsView, EntryCard, insightEngine, ReportPreviewCard) imports it from
// lib, never from each other's component files.
import { convRateDenom, convRateEventName, eventMetricName, isConvRateMetric, isEventMetric } from "./types";
import { humanize, humanizeEvent } from "./format";
import type { MetaItem } from "./types";

/** Resolves a real or virtual metric apiName to a display label: conversion-rate and
 *  event virtual metrics get a synthesized label from the underlying event name; real
 *  GA4 metrics use their metadata uiName when available, falling back to a humanized apiName. */
export function metricLabel(apiName: string, meta?: MetaItem[]): string {
  if (isConvRateMetric(apiName)) {
    const denomLabel = convRateDenom(apiName) === "totalUsers" ? "per user" : "per session";
    return `${humanizeEvent(convRateEventName(apiName))} → ${denomLabel}`;
  }
  if (isEventMetric(apiName)) return `${humanizeEvent(eventMetricName(apiName))} (event)`;
  return meta?.find((m) => m.apiName === apiName)?.uiName ?? humanize(apiName);
}
