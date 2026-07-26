import { calculateUplifts } from "@/pages/dashboard/dashboardData";
import type { ExperimentMetricKey, ExperimentSummary, ExperimentUplifts, VariantSummary } from "@/types";

const DAY_MS = 24 * 60 * 60 * 1000;

export interface DailyRevenuePoint {
  date: string;
  revenue: number;
  breakdown?: Array<{ experimentId: string; experimentName: string; revenue: number }>;
}

export function sumMetric(
  experiments: Array<{ experiment: ExperimentSummary; uplifts: ExperimentUplifts | undefined }>,
  metric: ExperimentMetricKey
): number {
  return experiments.reduce((sum, entry) => sum + (entry.uplifts?.[metric].uplift ?? 0), 0);
}

export function calculateRangeUplifts(
  experiment: ExperimentSummary,
  rangeStart: Date,
  rangeEnd: Date
): ExperimentUplifts | undefined {
  if (!experiment.dailyVariants || experiment.dailyVariants.length === 0) return experiment.uplifts;

  const variants: VariantSummary[] = experiment.dailyVariants
    .map((series) => {
      const totals = series.points.reduce(
        (sum, point) => {
          const pointDate = parseDateValue(point.date);
          if (!pointDate) return sum;
          const day = startOfDay(pointDate).getTime();
          if (day < startOfDay(rangeStart).getTime() || day > startOfDay(rangeEnd).getTime()) return sum;
          sum.visitors += point.visitors;
          sum.revenue += point.revenue;
          sum.conversions += point.conversions;
          sum.products += point.products;
          return sum;
        },
        { visitors: 0, revenue: 0, conversions: 0, products: 0 }
      );

      const cvr = totals.visitors > 0 ? (totals.conversions / totals.visitors) * 100 : 0;
      const rpv = totals.visitors > 0 ? totals.revenue / totals.visitors : 0;
      const aov = totals.conversions > 0 ? totals.revenue / totals.conversions : 0;

      return {
        id: series.variationId,
        name: series.variationName,
        isOriginal: series.isOriginal,
        trafficSplit: series.trafficSplit,
        sessions: totals.visitors,
        transactions: totals.conversions,
        products: roundMetric(totals.products),
        revenue: roundMetric(totals.revenue),
        cvr: roundMetric(cvr),
        rpv: roundMetric(rpv),
        aov: roundMetric(aov),
      } satisfies VariantSummary;
    })
    .filter((variant) => variant.sessions > 0 || variant.revenue > 0 || variant.transactions > 0 || variant.products > 0);

  if (variants.length === 0) return experiment.uplifts;
  return calculateUplifts(variants);
}

export function roundMetric(value: number): number {
  return Math.round((Number.isFinite(value) ? value : 0) * 100) / 100;
}

export function buildDailyRevenueSeriesWithBreakdown(
  experiments: Array<{ experiment: ExperimentSummary; uplifts: ExperimentUplifts | undefined }>,
  engagementStart: Date,
  engagementEnd: Date
): DailyRevenuePoint[] {
  const start = startOfDay(engagementStart);
  const end = startOfDay(engagementEnd);
  if (end.getTime() < start.getTime()) return [{ date: toDateKey(start), revenue: 0 }];

  const dayCount = diffDays(start, end) + 1;
  const dailyRevenue = Array.from({ length: dayCount }, () => 0);
  const dailyBreakdown = Array.from({ length: dayCount }, () => [] as Array<{ experimentId: string; experimentName: string; revenue: number }>);

  experiments.forEach(({ experiment }) => {
    if (!experiment.dailySeries || experiment.dailySeries.length === 0) return;
    experiment.dailySeries.forEach((point) => {
      const pointDate = parseDateValue(point.date);
      if (!pointDate) return;
      const idx = diffDays(start, startOfDay(pointDate));
      if (idx >= 0 && idx < dayCount) {
        dailyRevenue[idx] += point.revenue;
        if (point.revenue !== 0) {
          dailyBreakdown[idx].push({
            experimentId: experiment.id,
            experimentName: experiment.name,
            revenue: Math.round(point.revenue * 100) / 100,
          });
        }
      }
    });
  });

  return dailyRevenue.map((value, index) => ({
    date: toDateKey(addDays(start, index)),
    revenue: Math.round(value * 100) / 100,
    breakdown: dailyBreakdown[index].length > 0 ? dailyBreakdown[index] : undefined,
  }));
}

export function getChartRange(experiments: ExperimentSummary[]): { chartStart: Date; chartEnd: Date } {
  const today = startOfDay(new Date());
  const starts: number[] = [];
  const ends: number[] = [];

  experiments.forEach((exp) => {
    const s = parseDateValue(exp.startDate);
    if (s) starts.push(startOfDay(s).getTime());

    if (exp.endDate) {
      const e = parseDateValue(exp.endDate);
      if (e) ends.push(startOfDay(e).getTime());
    } else if (exp.dailySeries && exp.dailySeries.length > 0) {
      const last = parseDateValue(exp.dailySeries[exp.dailySeries.length - 1].date);
      // Guard: ignore dates more than 10 years out to prevent runaway array allocation
      if (last && last.getTime() <= today.getTime() + 10 * 365 * DAY_MS) ends.push(startOfDay(last).getTime());
    } else {
      // Running experiment with no end date — extend to today
      ends.push(today.getTime());
    }
  });

  const chartStart = starts.length > 0 ? new Date(Math.min(...starts)) : today;
  const chartEnd = ends.length > 0 ? new Date(Math.max(...ends)) : today;
  return { chartStart, chartEnd };
}

export function parseDate(value: string): number {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

export function parseDateValue(value?: string): Date | null {
  if (!value) return null;
  const isoDate = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (isoDate) {
    return new Date(Number(isoDate[1]), Number(isoDate[2]) - 1, Number(isoDate[3]));
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

export function addDays(date: Date, days: number): Date {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + days);
  return copy;
}

export function diffDays(start: Date, end: Date): number {
  return Math.round((startOfDay(end).getTime() - startOfDay(start).getTime()) / DAY_MS);
}

export function toDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function formatDateLabel(value: string): string {
  const date = parseDateValue(value);
  if (!date) return value;
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(date);
}

export function formatRoiReturn(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "--";
  return `${value.toLocaleString(undefined, { maximumFractionDigits: 2 })}x`;
}
