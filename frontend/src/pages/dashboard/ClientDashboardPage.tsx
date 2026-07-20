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
import type { ExperimentMetricKey, ExperimentSummary, ExperimentUplifts, VariantSummary } from "@/types";

interface Props {
  preview?: boolean;
}

const chartColors = ["#6ae499", "#d94444", "#162a3d"];
const DAY_MS = 24 * 60 * 60 * 1000;

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
                    <MetricCell uplifts={uplifts} metric="revenue" formatValue={(value) => formatSignedMoney(value, money)} />
                    <MetricCell uplifts={uplifts} metric="rpv" formatValue={(value) => formatSignedMoney(value, rpvMoney)} />
                    <MetricCell uplifts={uplifts} metric="purchases" formatValue={(value) => formatSignedNumber(value, number)} />
                    <MetricCell uplifts={uplifts} metric="products" formatValue={(value) => formatSignedNumber(value, number)} />
                    <MetricCell uplifts={uplifts} metric="cvr" formatValue={(value) => `${formatSignedDecimal(value)} pts`} />
                    <MetricCell uplifts={uplifts} metric="aov" formatValue={(value) => formatSignedMoney(value, rpvMoney)} />
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

function MetricCell({
  uplifts,
  metric,
  formatValue,
}: {
  uplifts: ExperimentUplifts | undefined;
  metric: ExperimentMetricKey;
  formatValue: (value: number) => string;
}) {
  const value = uplifts?.[metric].uplift ?? 0;
  return <TD className={`whitespace-nowrap px-6 py-4 font-semibold ${toneClass(value)}`}>{formatValue(value)}</TD>;
}

function ROIReturnsPanel({
  revenue,
  servicePrice,
  roiReturn,
  money,
  loading,
  conversionError,
  roiNodeCount,
}: {
  revenue: number;
  servicePrice: number;
  roiReturn: number | null;
  money: Intl.NumberFormat;
  loading: boolean;
  conversionError: boolean;
  roiNodeCount?: number;
}) {
  const actualRoi = roiReturn ?? 0;
  const actualProfit = revenue - servicePrice;

  return (
    <Card className="overflow-hidden border-brand-200/70 shadow-sm">
      <CardBody className="p-0">
        <div className="px-6 py-6 sm:px-8 sm:pt-8">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand-100 text-brand-700">
              <TrendingUp className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-ink">Return on Investment</h2>
              <p className="text-sm text-ink/60">
                Tracking your uplift and profit against the total service investment.
              </p>
            </div>
          </div>
        </div>

        <div className="border-y border-ink/5 bg-ink/[0.01] px-6 py-12 sm:px-12 overflow-x-auto">
          {loading ? (
            <div className="mx-auto h-20 w-full max-w-4xl animate-pulse rounded-full bg-ink/5" />
          ) : conversionError || servicePrice <= 0 ? (
            <div className="py-8 text-center text-sm text-ink/50">
              {conversionError ? "ROI conversion data is unavailable." : "ROI baseline is not available."}
            </div>
          ) : (
            <MilestoneGraph
              revenue={revenue}
              servicePrice={servicePrice}
              roiReturn={actualRoi}
              money={money}
              roiNodeCount={roiNodeCount}
            />
          )}
        </div>

        <div className="grid grid-cols-2 divide-x divide-y divide-ink/5 bg-white lg:grid-cols-4 lg:divide-y-0">
          <div className="px-6 py-5 sm:px-8">
            <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-ink/40">Service Investment</p>
            <p className="text-xl font-bold text-ink">{money.format(servicePrice)}</p>
          </div>
          <div className="px-6 py-5 sm:px-8">
            <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-ink/40">Revenue Uplift</p>
            <p className={`text-xl font-bold ${toneClass(revenue)}`}>{formatSignedMoney(revenue, money)}</p>
          </div>
          <div className="px-6 py-5 sm:px-8">
            <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-ink/40">Net Profit</p>
            <p className={`text-xl font-bold ${toneClass(actualProfit)}`}>{formatSignedMoney(actualProfit, money)}</p>
          </div>
          <div className="px-6 py-5 sm:px-8">
            <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-ink/40">Current ROI</p>
            <p className={`text-xl font-bold ${roiReturn !== null && roiReturn >= 1 ? "text-emerald-600" : "text-ink"}`}>
              {formatRoiReturn(roiReturn)}
            </p>
          </div>
        </div>
      </CardBody>
    </Card>
  );
}

function MilestoneGraph({
  revenue,
  servicePrice,
  roiReturn,
  money,
  roiNodeCount,
}: {
  revenue: number;
  servicePrice: number;
  roiReturn: number;
  money: Intl.NumberFormat;
  roiNodeCount?: number;
}) {
  // Build post-breakeven milestones: intermediate steps leading up to the actual ROI
  const buildPostBreakevenMilestones = (roi: number): number[] => {
    if (roi <= 1) return []; // no post-breakeven nodes if below breakeven
    const autoTargetNodeCount = roi <= 5 ? 2 : roi <= 20 ? 3 : 4;
    const targetNodeCount = Math.max(0, Math.floor(roiNodeCount ?? autoTargetNodeCount));
    if (targetNodeCount === 0) return [];

    // When the admin sets a node count, keep that count visible instead of
    // collapsing back to fewer nodes just because the ROI is small.
    if (roiNodeCount != null) {
      const span = Math.max(roi, targetNodeCount + 1) - 1;
      const step = span / (targetNodeCount + 1);
      return Array.from({ length: targetNodeCount }, (_, index) => {
        const value = 1 + step * (index + 1);
        return Math.round(value * 10) / 10;
      });
    }

    // Automatic mode keeps the previous responsive layout behavior.
    const raw = roi / (targetNodeCount + 1);
    const magnitude = Math.pow(10, Math.floor(Math.log10(Math.max(raw, 0.1))));
    const niceSteps = [1, 2, 2.5, 5, 10];
    let step = niceSteps[niceSteps.length - 1] * magnitude;
    for (const ns of niceSteps) {
      if (ns * magnitude >= raw) { step = ns * magnitude; break; }
    }
    if (step < 1) step = 1;
    const nodes: number[] = [];
    for (let v = step; nodes.length < targetNodeCount; v += step) {
      const rounded = Math.round(v * 10) / 10;
      if (rounded >= roi) break; // don't add nodes at or past the actual ROI
      nodes.push(rounded);
    }
    return nodes;
  };

  const postBreakeven = buildPostBreakevenMilestones(roiReturn);
  // The actual ROI is the last milestone — the end of the line
  const autoTargetNodeCount = roiReturn <= 5 ? 2 : roiReturn <= 20 ? 3 : 4;
  const configuredTargetNodeCount = Math.max(0, Math.floor(roiNodeCount ?? autoTargetNodeCount));
  const maxMilestone =
    roiReturn > 1
      ? (roiNodeCount != null ? Math.max(roiReturn, configuredTargetNodeCount + 1) : roiReturn)
      : 2.0;

  const milestones = [0, 0.25, 0.5, 0.75, 1.0, ...postBreakeven];

  // Split-scale: reserve 30% of the bar for 0→breakeven, 70% for breakeven→max
  const preZone = 30; // percent of bar for 0→1x
  const toPosition = (m: number) => {
    if (m <= 1) return (m / 1) * preZone;
    return preZone + ((m - 1) / (maxMilestone - 1)) * (100 - preZone);
  };

  // Progress always fills to 100% since the actual ROI IS the end of the line
  const progressPercent = roiReturn > 0 ? 100 : 0;
  const actualProfit = revenue - servicePrice;

  const getLabel = (m: number) => {
    if (m === 0) return "0%";
    if (m === 0.25) return "25%";
    if (m === 0.5) return "50%";
    if (m === 0.75) return "75%";
    if (m === 1.0) return "Breakeven";
    return `${m}x ROI`;
  };

  return (
    <div className="mx-auto w-full min-w-[1100px] max-w-7xl px-10 py-16 sm:px-16">
      <div className="relative h-3 w-full rounded-full bg-ink/5 shadow-inner">
        <div
          className={`absolute left-0 top-0 h-full rounded-full transition-all duration-1000 ${
            roiReturn >= 1
              ? "bg-emerald-500 shadow-[0_0_15px_rgba(16,185,129,0.4)]"
              : roiReturn > 0
                ? "bg-brand-400 shadow-[0_0_15px_rgba(251,191,36,0.4)]"
                : "bg-red-500 shadow-[0_0_15px_rgba(239,68,68,0.4)]"
          }`}
          style={{ width: `${progressPercent}%` }}
        />

        {milestones.map((m) => {
          const pos = toPosition(m);
          const isPassed = roiReturn >= m;
          const profit = m * servicePrice - servicePrice;
          const label = getLabel(m);

          return (
            <div
              key={m}
              className="absolute top-1/2 flex -translate-x-1/2 -translate-y-1/2 flex-col items-center"
              style={{ left: `${pos}%` }}
            >
              <div className={`h-4 w-1 rounded-full ${isPassed ? "bg-white/60" : "bg-ink/15"}`} />

              <div className="absolute bottom-full mb-3 flex flex-col items-center">
                <span
                  className={`whitespace-nowrap text-[10px] font-bold uppercase tracking-wider ${
                    m === 1.0 ? "rounded-md bg-ink/5 px-2 py-0.5 text-ink/60" : "text-ink/40"
                  }`}
                >
                  {label}
                </span>
              </div>

              <div className="absolute top-full mt-3 flex flex-col items-center">
                <span
                  className={`whitespace-nowrap text-[10px] font-semibold ${
                    profit > 0 ? "text-emerald-600/70" : profit < 0 ? "text-red-600/70" : "text-ink/40"
                  }`}
                >
                  {formatSignedMoney(profit, money)}
                </span>
              </div>
            </div>
          );
        })}

        <div
          className="absolute top-1/2 z-20 flex -translate-x-1/2 -translate-y-1/2 flex-col items-center transition-all duration-1000"
          style={{ left: `${progressPercent}%` }}
        >
          <div className="flex h-6 w-6 items-center justify-center rounded-full border-4 border-white bg-ink shadow-md" />

          <div className="absolute bottom-full mb-4 flex flex-col items-center">
            <div className="relative whitespace-nowrap rounded-lg bg-ink px-3 py-2 text-center shadow-xl">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-white/70">Actual ROI</p>
              <p className="text-sm font-bold text-white">{formatRoiReturn(roiReturn)}</p>
              <div className="absolute -bottom-1 left-1/2 h-2 w-2 -translate-x-1/2 rotate-45 bg-ink" />
            </div>
          </div>

          <div className="absolute top-full mt-4 flex flex-col items-center">
            <div className="relative whitespace-nowrap rounded-lg border border-ink/10 bg-white px-3 py-2 text-center shadow-lg">
              <div className="absolute -top-1 left-1/2 h-2 w-2 -translate-x-1/2 rotate-45 border-l border-t border-ink/10 bg-white" />
              <p className="relative text-[10px] font-semibold uppercase tracking-wide text-ink/40">Actual Profit</p>
              <p className={`relative text-xs font-bold ${actualProfit >= 0 ? "text-emerald-600" : "text-red-600"}`}>
                {formatSignedMoney(actualProfit, money)}
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function sumMetric(
  experiments: Array<{ experiment: ExperimentSummary; uplifts: ExperimentUplifts | undefined }>,
  metric: ExperimentMetricKey
): number {
  return experiments.reduce((sum, entry) => sum + (entry.uplifts?.[metric].uplift ?? 0), 0);
}

function calculateRangeUplifts(
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
  return calculateVariantUplifts(variants);
}

function calculateVariantUplifts(variants: VariantSummary[]): ExperimentUplifts {
  const original = variants.find((variant) => variant.isOriginal) ?? variants[0];
  const variationCandidates = variants.filter((variant) => variant.id !== original?.id);
  const candidates = variationCandidates.length > 0 ? variationCandidates : variants;

  return {
    revenue: calculateMetricUplift(original, candidates, "revenue"),
    rpv: calculateMetricUplift(original, candidates, "rpv"),
    purchases: calculateMetricUplift(original, candidates, "purchases"),
    products: calculateMetricUplift(original, candidates, "products"),
    cvr: calculateMetricUplift(original, candidates, "cvr"),
    aov: calculateMetricUplift(original, candidates, "aov"),
  };
}

function calculateMetricUplift(
  original: VariantSummary | undefined,
  candidates: VariantSummary[],
  metric: ExperimentMetricKey
) {
  const originalValue = getMetricValue(original, metric);
  const best = candidates.reduce<VariantSummary | undefined>((currentBest, candidate) => {
    if (!currentBest) return candidate;
    return getMetricValue(candidate, metric) > getMetricValue(currentBest, metric) ? candidate : currentBest;
  }, undefined);
  const bestValue = getMetricValue(best, metric);
  const uplift = roundMetric(bestValue - originalValue);
  const upliftPercent = originalValue === 0 ? 0 : roundMetric((uplift / originalValue) * 100);

  return {
    original: originalValue,
    bestVariation: bestValue,
    uplift,
    upliftPercent,
    bestVariationId: best?.id,
    bestVariationName: best?.name,
  };
}

function getMetricValue(variant: VariantSummary | undefined, metric: ExperimentMetricKey): number {
  if (!variant) return 0;
  if (metric === "purchases") return variant.transactions;
  if (metric === "aov") return variant.aov;
  return variant[metric];
}

function roundMetric(value: number): number {
  return Math.round((Number.isFinite(value) ? value : 0) * 100) / 100;
}

interface DailyRevenuePoint {
  date: string;
  revenue: number;
  breakdown?: Array<{ experimentId: string; experimentName: string; revenue: number }>;
}

function buildDailyRevenueSeriesWithBreakdown(
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

function getChartRange(experiments: ExperimentSummary[]): { chartStart: Date; chartEnd: Date } {
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

function parseDate(value: string): number {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function parseDateValue(value?: string): Date | null {
  if (!value) return null;
  const isoDate = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (isoDate) {
    return new Date(Number(isoDate[1]), Number(isoDate[2]) - 1, Number(isoDate[3]));
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function addDays(date: Date, days: number): Date {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + days);
  return copy;
}

function diffDays(start: Date, end: Date): number {
  return Math.round((startOfDay(end).getTime() - startOfDay(start).getTime()) / DAY_MS);
}

function toDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatDateLabel(value: string): string {
  const date = parseDateValue(value);
  if (!date) return value;
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(date);
}

function formatSignedMoney(value: number, formatter: Intl.NumberFormat): string {
  return value > 0 ? `+${formatter.format(value)}` : formatter.format(value);
}

function formatSignedNumber(value: number, formatter: Intl.NumberFormat): string {
  return value > 0 ? `+${formatter.format(value)}` : formatter.format(value);
}

function formatSignedDecimal(value: number): string {
  const formatted = Math.abs(value).toLocaleString(undefined, { maximumFractionDigits: 2 });
  if (value > 0) return `+${formatted}`;
  if (value < 0) return `-${formatted}`;
  return "0";
}

function formatRoiReturn(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "--";
  return `${value.toLocaleString(undefined, { maximumFractionDigits: 2 })}x`;
}


function toneClass(value: number): string {
  if (value > 0) return "text-emerald-700";
  if (value < 0) return "text-red-600";
  return "text-ink/60";
}

function RevenueDetailCard({ data, money }: { data: DailyRevenuePoint; money: Intl.NumberFormat }) {
  const totalRevenue = data.revenue;
  const breakdown = data.breakdown ?? [];
  const hasBreakdown = breakdown.length > 0;

  return (
    <Card className="xl:col-span-2">
      <CardBody className="px-5 py-4">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-ink/40">Selected Date</p>
            <p className="mt-1 text-lg font-bold text-ink">{formatDateLabel(data.date)}</p>
          </div>
          <div className="text-right">
            <p className="text-xs font-semibold uppercase tracking-wide text-ink/40">Total Uplift</p>
            <p className={`mt-1 text-lg font-bold ${totalRevenue >= 0 ? "text-emerald-600" : "text-red-600"}`}>
              {totalRevenue >= 0 ? "+" : ""}{money.format(totalRevenue)}
            </p>
          </div>
        </div>

        {hasBreakdown && (
          <div className="mt-4 border-t border-ink/10 pt-3">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink/40">Experiment Breakdown</p>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {[...breakdown].sort((a, b) => b.revenue - a.revenue).map((item, index) => (
                <div key={item.experimentId} className="flex items-center justify-between gap-3 rounded-lg border border-ink/5 bg-ink/[0.02] px-3 py-2">
                  <span className="flex-1 truncate text-xs font-medium text-ink/70" title={item.experimentName}>
                    {index + 1}. {item.experimentName}
                  </span>
                  <span className={`shrink-0 text-sm font-semibold ${item.revenue >= 0 ? "text-emerald-600" : "text-red-600"}`}>
                    {item.revenue >= 0 ? "+" : ""}{money.format(item.revenue)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardBody>
    </Card>
  );
}
