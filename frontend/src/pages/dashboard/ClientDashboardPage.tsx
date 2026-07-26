import { useCallback, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { DollarSign, Package, Percent, ShoppingCart, TrendingUp, Receipt } from "lucide-react";
import { track } from "@/lib/activityTracker";
import { useScrollDepth } from "@/hooks/useScrollDepth";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { KPICard } from "@/components/ui/KPICard";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui";
import { useAuthStore } from "@/store/authStore";
import { useDashboardData } from "@/hooks/useDashboardData";
import { useDashboardSettings, useClientPreferences } from "@/hooks/useDashboardSettings";
import { convertClientServicePrice } from "@/lib/servicePriceConversion";
import { calculateUplifts } from "@/pages/dashboard/dashboardData";
import {
  buildDailyRevenueSeriesWithBreakdown,
  calculateRangeUplifts,
  formatDateLabel,
  getChartRange,
  parseDate,
  parseDateValue,
  startOfDay,
  sumMetric,
  toDateKey,
  type DailyRevenuePoint,
} from "@/lib/dashboardMetrics";
import { formatSignedDecimal, formatSignedMoney, formatSignedNumber } from "@/lib/experimentFormatting";
import { MetricCell } from "@/components/dashboard/MetricCell";
import { ROIReturnsPanel } from "@/components/dashboard/ROIReturnsPanel";
import { RevenueDetailCard } from "@/components/dashboard/RevenueDetailCard";
import type { ExperimentMetricKey, ExperimentSummary, ExperimentUplifts } from "@/types";

interface Props {
  preview?: boolean;
}

const chartColors = ["#6ae499", "#d94444", "#162a3d"];

export function ClientDashboardPage({ preview = false }: Props) {
  const { clientId: previewClientId } = useParams<{ clientId: string }>();
  const authClientId = useAuthStore((s) => s.clientId);
  const authLoading = useAuthStore((s) => s.loading);
  const clientId = preview ? previewClientId : authClientId;
  const { data, isLoading, error: queryError } = useDashboardData(authLoading ? null : clientId);
  const loading = isLoading;
  const error = queryError ? "Failed to load dashboard data. Please refresh." : "";
  const [excludeRevenueLosses, setExcludeRevenueLosses] = useState(false);
  const [metricMode, setMetricMode] = useState<"avg" | "sum">("avg");
  useScrollDepth();

  const currency = data?.client?.currency ?? "USD";
  const money = useMemo(
    () => new Intl.NumberFormat(undefined, { style: "currency", currency, maximumFractionDigits: 0 }),
    [currency]
  );
  const rpvMoney = useMemo(
    () => new Intl.NumberFormat(undefined, { style: "currency", currency, maximumFractionDigits: 2 }),
    [currency]
  );
  const number = useMemo(() => new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }), []);
  const experiments = data?.experiments ?? [];
  const servicePriceUsd = Number(data?.client?.servicePrice ?? data?.client?.agencyFee ?? 0);
  const servicePriceConversion = useQuery({
    queryKey: ["servicePriceConversion", clientId, servicePriceUsd, currency],
    queryFn: () => convertClientServicePrice(clientId as string, servicePriceUsd, currency),
    enabled: Boolean(clientId && data?.client),
    staleTime: 12 * 60 * 60 * 1000,
    retry: 1,
  });
  const { settings } = useDashboardSettings(clientId);
  const { prefs } = useClientPreferences(clientId);

  const experimentsWithUplift = useMemo(
    () => experiments.filter((experiment) => experiment.uplifts),
    [experiments]
  );

  // Apply admin settings: display names, original/variation swap, metric overrides, exclusions, manual experiments
  const settingsProcessedExperiments = useMemo(() => {
    const overrides = settings.experimentOverrides ?? {};
    const clientExcluded = new Set(prefs.excludedExperimentIds ?? []);

    const synced = experimentsWithUplift
      .filter((exp) => !overrides[exp.id]?.isExcluded && !clientExcluded.has(exp.id))
      .map((exp) => {
        const ov = overrides[exp.id];
        if (!ov) return exp;

        let uplifts = exp.uplifts ?? ({} as ExperimentUplifts);

        // Swap original/variation
        if (ov.originalVariantId && exp.variants && exp.variants.length > 0) {
          const swapped = exp.variants.map((v) => ({
            ...v,
            isOriginal: v.id === ov.originalVariantId,
          }));
          uplifts = calculateUplifts(swapped);
        }

        // Apply metric overrides on top
        if (ov.metricOverrides) {
          uplifts = { ...uplifts };
          (Object.entries(ov.metricOverrides) as [ExperimentMetricKey, typeof ov.metricOverrides[ExperimentMetricKey]][]).forEach(([metric, mo]) => {
            if (!mo) return;
            uplifts[metric] = { ...uplifts[metric], ...mo };
          });
        }

        return {
          ...exp,
          name: ov.displayName ?? exp.name,
          uplifts,
          // Also swap dailyVariants isOriginal for date-range filtering
          dailyVariants: ov.originalVariantId && exp.dailyVariants
            ? exp.dailyVariants.map((dv) => ({ ...dv, isOriginal: dv.variationId === ov.originalVariantId }))
            : exp.dailyVariants,
        };
      });

    // Add manual experiments
    const manual: ExperimentSummary[] = (settings.manualExperiments ?? [])
      .filter((m) => !clientExcluded.has(m.id))
      .map((m) => ({
        id: m.id,
        name: m.name,
        status: m.status,
        startDate: m.startDate,
        endDate: m.endDate,
        uplifts: m.uplifts,
      }));

    return [...synced, ...manual];
  }, [experimentsWithUplift, settings, prefs]);

  const { chartStart, chartEnd } = useMemo(
    () => getChartRange(settingsProcessedExperiments),
    [settingsProcessedExperiments]
  );
  const [rangeStart, setRangeStart] = useState<string | null>(null);
  const [rangeEnd, setRangeEnd] = useState<string | null>(null);
  const effectiveStartKey = rangeStart ?? toDateKey(chartStart);
  const effectiveEndKey = rangeEnd ?? toDateKey(chartEnd);
  const effectiveStartDate = parseDateValue(effectiveStartKey) ?? chartStart;
  const effectiveEndDate = parseDateValue(effectiveEndKey) ?? chartEnd;
  const rangeExperiments = useMemo(() => {
    return settingsProcessedExperiments
      .filter((experiment) => {
        const expStart = parseDateValue(experiment.startDate);
        if (!expStart) return true;
        const expEnd = experiment.endDate ? parseDateValue(experiment.endDate) : null;
        const startedBeforeRangeEnd = startOfDay(expStart) <= startOfDay(effectiveEndDate);
        const endedAfterRangeStart = !expEnd || startOfDay(expEnd) >= startOfDay(effectiveStartDate);
        return startedBeforeRangeEnd && endedAfterRangeStart;
      })
      .map((experiment) => ({
        experiment,
        uplifts: calculateRangeUplifts(experiment, effectiveStartDate, effectiveEndDate) ?? experiment.uplifts,
      }));
  }, [effectiveEndDate, effectiveStartDate, settingsProcessedExperiments]);
  const totalExperiments = useMemo(() => {
    if (!excludeRevenueLosses) return rangeExperiments;
    return rangeExperiments.filter((entry) => (entry.uplifts?.revenue.uplift ?? 0) >= 0);
  }, [excludeRevenueLosses, rangeExperiments]);
  const excludedLossCount = rangeExperiments.length - totalExperiments.length;

  const totals = useMemo(() => {
    const count = Math.max(1, totalExperiments.length);
    const rpvSum = sumMetric(totalExperiments, "rpv");
    const cvrSum = sumMetric(totalExperiments, "cvr");
    const aovSum = sumMetric(totalExperiments, "aov");
    return {
      revenue: sumMetric(totalExperiments, "revenue"),
      purchases: sumMetric(totalExperiments, "purchases"),
      products: sumMetric(totalExperiments, "products"),
      rpv: rpvSum / count,
      rpvSum,
      cvr: cvrSum / count,
      cvrSum,
      aov: aovSum / count,
      aovSum,
    };
  }, [totalExperiments]);
  const convertedServicePrice = servicePriceConversion.data?.convertedAmount ?? (currency === "USD" ? servicePriceUsd : 0);
  const roiReturn = convertedServicePrice > 0 ? totals.revenue / convertedServicePrice : null;

  // Exclude draft experiments from the pie chart – only show actual (non-draft) results
  const nonDraftExperiments = rangeExperiments.filter((entry) => entry.experiment.status !== "draft");

  const revenueOutcomeChart = [
    { name: "Revenue gained", value: nonDraftExperiments.filter((e) => (e.uplifts?.revenue.uplift ?? 0) > 0).length },
    { name: "Revenue lost", value: nonDraftExperiments.filter((e) => (e.uplifts?.revenue.uplift ?? 0) < 0).length },
    { name: "Flat revenue", value: nonDraftExperiments.filter((e) => (e.uplifts?.revenue.uplift ?? 0) === 0).length },
  ].filter((entry) => entry.value > 0);

  const draftCount = rangeExperiments.length - nonDraftExperiments.length;

  // Win rate = winning / (winning + losing) × 100
  const winningCount = nonDraftExperiments.filter((e) => (e.uplifts?.revenue.uplift ?? 0) > 0).length;
  const losingCount = nonDraftExperiments.filter((e) => (e.uplifts?.revenue.uplift ?? 0) < 0).length;
  const decidedCount = winningCount + losingCount;
  const winRate = decidedCount > 0 ? Math.round((winningCount / decidedCount) * 100) : 0;

  const revenueSeriesWithBreakdown = buildDailyRevenueSeriesWithBreakdown(totalExperiments, effectiveStartDate, effectiveEndDate);

  const off = useMemo(() => {
    const dataMax = Math.max(...revenueSeriesWithBreakdown.map((i) => i.revenue), 0);
    const dataMin = Math.min(...revenueSeriesWithBreakdown.map((i) => i.revenue), 0);

    if (dataMax <= 0) return 0;
    if (dataMin >= 0) return 1;

    return dataMax / (dataMax - dataMin);
  }, [revenueSeriesWithBreakdown]);

  const [selectedRevenuePoint, setSelectedRevenuePoint] = useState<DailyRevenuePoint | null>(null);
  const activeRevenuePoint = selectedRevenuePoint ?? revenueSeriesWithBreakdown[0] ?? null;

  const handleChartMouseMove = useCallback((state: any) => {
    if (state?.activePayload?.[0]?.payload) {
      setSelectedRevenuePoint(state.activePayload[0].payload);
    }
  }, []);

  const recentExperiments = useMemo(() => {
    return [...rangeExperiments]
      .sort((a, b) => parseDate(b.experiment.startDate) - parseDate(a.experiment.startDate))
      .slice(0, 5);
  }, [rangeExperiments]);

  if (!authLoading && !clientId) return <div className="p-8 text-sm text-ink/50">No client workspace is linked to this account.</div>;
  if (error) return <div className="p-8 text-sm text-red-600">{error}</div>;
  const expError = data?.experimentsError;

  return (
    <div className="p-8 space-y-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm font-medium text-brand-700">{preview ? "Preview as client" : "Client dashboard"}</p>
          <h1 className="text-2xl font-bold text-ink">{data?.client?.name ?? "Dashboard"}</h1>
          <p className="text-sm text-ink/50">
            Uplift for {formatDateLabel(effectiveStartKey)} to {formatDateLabel(effectiveEndKey)}
          </p>
        </div>
        <div className="flex flex-col gap-3 sm:items-end">
          <div data-tutorial="date-range" className="flex flex-wrap items-end gap-3 rounded-xl border border-ink/10 bg-white px-4 py-3 text-sm text-ink shadow-[0_1px_3px_rgba(22,42,61,0.04)]">
            <label className="flex flex-col gap-1">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-ink/45">Start</span>
              <input
                type="date"
                value={effectiveStartKey}
                min={toDateKey(chartStart)}
                max={effectiveEndKey}
                onChange={(event) => { setRangeStart(event.target.value); track({ type: "date_range_change", metadata: { start: event.target.value, end: effectiveEndKey } }); }}
                className="rounded-lg border border-ink/10 px-3 py-2 text-sm text-ink focus:border-brand-300 focus:outline-none"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-ink/45">End</span>
              <input
                type="date"
                value={effectiveEndKey}
                min={effectiveStartKey}
                max={toDateKey(chartEnd)}
                onChange={(event) => { setRangeEnd(event.target.value); track({ type: "date_range_change", metadata: { start: effectiveStartKey, end: event.target.value } }); }}
                className="rounded-lg border border-ink/10 px-3 py-2 text-sm text-ink focus:border-brand-300 focus:outline-none"
              />
            </label>
            <button
              type="button"
              onClick={() => {
                setRangeStart(toDateKey(chartStart));
                setRangeEnd(toDateKey(chartEnd));
                track({ type: "full_range_reset", metadata: { button: "Full Range" } });
              }}
              className="rounded-lg border border-ink/10 px-3 py-2 text-sm font-medium text-ink/70 transition-colors hover:bg-ink/5"
            >
              Full Range
            </button>
          </div>
          <label data-tutorial="exclude-losses" className="inline-flex cursor-pointer items-center gap-3 rounded-xl border border-ink/10 bg-white px-4 py-3 text-sm font-medium text-ink shadow-[0_1px_3px_rgba(22,42,61,0.04)]">
            <input
              type="checkbox"
              checked={excludeRevenueLosses}
              onChange={(event) => { setExcludeRevenueLosses(event.target.checked); track({ type: "exclude_losses_toggle", metadata: { excluded: event.target.checked } }); }}
              className="h-4 w-4 rounded border-ink/20 text-brand-600 focus:ring-brand-300"
            />
            <span className="flex flex-col">
              <span>Exclude revenue losses from totals</span>
              <span className="text-xs font-normal text-ink/45">
                {excludeRevenueLosses ? `${excludedLossCount} losses excluded` : `${rangeExperiments.length} experiments included`}
              </span>
            </span>
          </label>
        </div>
      </div>

      {expError && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          <p className="font-medium">Could not load experiments from Convert.com</p>
          <p className="mt-1 text-xs">{expError}</p>
        </div>
      )}

      <div data-tutorial="kpi-cards" className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-3">
        <KPICard
          title="Revenue Uplift"
          value={formatSignedMoney(totals.revenue, money)}
          icon={<DollarSign className="h-5 w-5" />}
          loading={loading}
        />
        <KPICard
          title="Purchases Uplift"
          value={formatSignedNumber(totals.purchases, number)}
          icon={<ShoppingCart className="h-5 w-5" />}
          loading={loading}
        />
        <KPICard
          title="Products Uplift"
          value={formatSignedNumber(totals.products, number)}
          icon={<Package className="h-5 w-5" />}
          loading={loading}
        />
      </div>

      <div data-tutorial="roi-panel"><ROIReturnsPanel
        revenue={totals.revenue}
        servicePrice={convertedServicePrice}
        roiReturn={roiReturn}
        money={money}
        loading={loading || servicePriceConversion.isLoading}
        conversionError={Boolean(servicePriceConversion.error)}
        roiNodeCount={settings.roiNodeCount}
      /></div>

      <div data-tutorial="rate-metrics" className="space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-xs font-semibold uppercase tracking-wide text-ink/40">Rate Metrics</p>
          <div className="inline-flex overflow-hidden rounded-lg border border-ink/10 bg-white text-sm font-medium shadow-sm">
            <button
              onClick={() => { setMetricMode("avg"); track({ type: "metric_mode_change", metadata: { mode: "avg", button: "Average" } }); }}
              className={`px-3 py-1.5 transition-colors ${metricMode === "avg" ? "bg-ink text-white" : "text-ink/60 hover:bg-ink/5"}`}
            >
              Average
            </button>
            <button
              onClick={() => { setMetricMode("sum"); track({ type: "metric_mode_change", metadata: { mode: "sum", button: "Sum" } }); }}
              className={`px-3 py-1.5 transition-colors ${metricMode === "sum" ? "bg-ink text-white" : "text-ink/60 hover:bg-ink/5"}`}
            >
              Sum
            </button>
          </div>
        </div>
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-3">
          <KPICard
            title={metricMode === "avg" ? "Average RPV Uplift" : "Total RPV Uplift"}
            value={formatSignedMoney(metricMode === "avg" ? totals.rpv : totals.rpvSum, rpvMoney)}
            icon={<TrendingUp className="h-5 w-5" />}
            loading={loading}
          />
          <KPICard
            title={metricMode === "avg" ? "Average CVR Uplift" : "Total CVR Uplift"}
            value={`${formatSignedDecimal(metricMode === "avg" ? totals.cvr : totals.cvrSum)} pts`}
            icon={<Percent className="h-5 w-5" />}
            loading={loading}
          />
          <KPICard
            title={metricMode === "avg" ? "Average AOV Uplift" : "Total AOV Uplift"}
            value={formatSignedMoney(metricMode === "avg" ? totals.aov : totals.aovSum, rpvMoney)}
            icon={<Receipt className="h-5 w-5" />}
            loading={loading}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <Card data-tutorial="revenue-chart" className="xl:col-span-2">
          <CardHeader>
            <h2 className="font-semibold text-ink">Revenue Uplift Over Time</h2>
            <p className="mt-1 text-xs text-ink/45">
              Daily revenue uplift · {formatDateLabel(effectiveStartKey)} to {formatDateLabel(effectiveEndKey)}
            </p>
          </CardHeader>
          <CardBody className="h-80">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart
                data={revenueSeriesWithBreakdown}
                onMouseMove={handleChartMouseMove}
                onMouseLeave={() => {
                  if (selectedRevenuePoint) {
                    track({ type: "chart_date_hover", metadata: { date: selectedRevenuePoint.date, revenue: selectedRevenuePoint.revenue, breakdownCount: selectedRevenuePoint.breakdown?.length ?? 0 } });
                  }
                }}
              >
                <defs>
                  <linearGradient id="revenueGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset={off} stopColor="#6ae499" stopOpacity={0.2} />
                    <stop offset={off} stopColor="#d94444" stopOpacity={0.2} />
                  </linearGradient>
                  <linearGradient id="strokeGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset={off} stopColor="#6ae499" stopOpacity={1} />
                    <stop offset={off} stopColor="#d94444" stopOpacity={1} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
                <XAxis
                  dataKey="date"
                  minTickGap={32}
                  tickFormatter={(value) => formatDateLabel(String(value))}
                  stroke="#162a3d"
                  strokeOpacity={0.5}
                  fontSize={12}
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis
                  tickFormatter={(value) => number.format(Number(value))}
                  stroke="#162a3d"
                  strokeOpacity={0.5}
                  fontSize={12}
                  tickLine={false}
                  axisLine={false}
                  width={70}
                />
                <ReferenceLine y={0} stroke="#162a3d" strokeOpacity={0.2} />
                <Tooltip content={() => null} cursor={{ stroke: "#162a3d", strokeOpacity: 0.15, strokeDasharray: "4 4" }} />
                <Area
                  type="monotone"
                  dataKey="revenue"
                  stroke="url(#strokeGradient)"
                  strokeWidth={1}
                  fillOpacity={1}
                  fill="url(#revenueGradient)"
                  activeDot={{ r: 3, strokeWidth: 0, fill: "#162a3d" }}
                />
              </AreaChart>
            </ResponsiveContainer>
          </CardBody>
        </Card>

        {activeRevenuePoint && (
          <RevenueDetailCard data={activeRevenuePoint} money={money} />
        )}

        <Card>
          <CardHeader>
            <h2 className="font-semibold text-ink">Revenue Winning Criteria</h2>
            {draftCount > 0 && (
              <p className="mt-1 text-xs text-ink/45">
                {draftCount} draft experiment{draftCount !== 1 ? "s" : ""} excluded
              </p>
            )}
          </CardHeader>
          <CardBody className="h-80 flex flex-col items-center justify-center">
            {revenueOutcomeChart.length > 0 ? (
              <>
                <div className="relative w-full flex-1">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={revenueOutcomeChart} dataKey="value" nameKey="name" innerRadius={62} outerRadius={96} paddingAngle={2}>
                        {revenueOutcomeChart.map((_, index) => (
                          <Cell key={index} fill={chartColors[index % chartColors.length]} />
                        ))}
                      </Pie>
                      <Tooltip />
                    </PieChart>
                  </ResponsiveContainer>
                  {/* Win-rate label inside the donut hole */}
                  <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                    <span className="text-2xl font-bold text-ink">{winRate}%</span>
                    <span className="text-[10px] font-medium uppercase tracking-wide text-ink/45">Win Rate</span>
                  </div>
                </div>
                <div className="flex flex-wrap justify-center gap-3 pb-1">
                  {revenueOutcomeChart.map((entry, index) => (
                    <span key={entry.name} className="flex items-center gap-1.5 text-xs text-ink/60">
                      <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: chartColors[index % chartColors.length] }} />
                      {entry.name} ({entry.value})
                    </span>
                  ))}
                </div>
                <p className="pb-2 text-xs font-semibold text-ink/70">
                  Actual Win Rate: <span className="text-emerald-600">{winRate}%</span>
                  <span className="ml-1 font-normal text-ink/40">({winningCount}W – {losingCount}L)</span>
                </p>
              </>
            ) : (
              <div className="text-sm text-ink/50">No experiment uplift data yet.</div>
            )}
          </CardBody>
        </Card>
      </div>

      <Card data-tutorial="recent-experiments">
        <CardHeader>
          <h2 className="font-semibold text-ink">Recent Experiments</h2>
        </CardHeader>
        <CardBody className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <THead>
                <TR className="bg-ink/[0.02] hover:bg-transparent">
                  <TH className="px-6">Experiment</TH>
                  <TH className="px-6">Revenue</TH>
                  <TH className="px-6">RPV</TH>
                  <TH className="px-6">Purchases</TH>
                  <TH className="px-6">Products</TH>
                  <TH className="px-6">CVR</TH>
                  <TH className="px-6">AOV</TH>
                </TR>
              </THead>
              <TBody>
                {recentExperiments.map(({ experiment, uplifts }) => (
                  <TR key={experiment.id}>
                    <TD className="whitespace-nowrap px-6 py-4 font-medium text-ink">
                      <Link
                        to={`/dashboard/experiments/${experiment.id}`}
                        onClick={() => track({ type: "dashboard_experiment_click", metadata: { experimentId: experiment.id, experimentName: experiment.name } })}
                        className="underline-offset-4 hover:text-brand-700 hover:underline"
                      >
                        {experiment.name}
                      </Link>
                    </TD>
                    <MetricCell uplift={uplifts?.revenue} formatValue={(value) => formatSignedMoney(value, money)} showPercent={false} className="whitespace-nowrap px-6 py-4" />
                    <MetricCell uplift={uplifts?.rpv} formatValue={(value) => formatSignedMoney(value, rpvMoney)} showPercent={false} className="whitespace-nowrap px-6 py-4" />
                    <MetricCell uplift={uplifts?.purchases} formatValue={(value) => formatSignedNumber(value, number)} showPercent={false} className="whitespace-nowrap px-6 py-4" />
                    <MetricCell uplift={uplifts?.products} formatValue={(value) => formatSignedNumber(value, number)} showPercent={false} className="whitespace-nowrap px-6 py-4" />
                    <MetricCell uplift={uplifts?.cvr} formatValue={(value) => `${formatSignedDecimal(value)} pts`} showPercent={false} className="whitespace-nowrap px-6 py-4" />
                    <MetricCell uplift={uplifts?.aov} formatValue={(value) => formatSignedMoney(value, rpvMoney)} showPercent={false} className="whitespace-nowrap px-6 py-4" />
                  </TR>
                ))}
              </TBody>
            </Table>
          </div>
          {recentExperiments.length === 0 && (
            <div className="px-6 py-10 text-center text-sm text-ink/50">No experiment uplift data yet.</div>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
