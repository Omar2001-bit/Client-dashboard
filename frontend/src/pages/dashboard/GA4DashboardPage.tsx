import { useMemo } from "react";
import { Link } from "react-router-dom";
import { BarChart3, ArrowLeft, RefreshCw } from "lucide-react";
import { useGA4Data } from "@/hooks/useGA4Data";
import { useDashboardSettings } from "@/hooks/useDashboardSettings";
import { calculateUplifts } from "@/pages/dashboard/dashboardData";
import {
  StatusBadge,
  Button,
  Alert,
  Table,
  THead,
  TBody,
  TR,
  TH,
  TD,
  EmptyState,
  Skeleton,
} from "@/components/ui";
import { useAuthStore } from "@/store/authStore";
import type { ExperimentMetricKey } from "@/types";
import type { GA4EnrichedExperiment } from "@/hooks/useGA4Data";

function formatDateRange(startDate: string, endDate: string): string {
  const fmt = (s: string) => {
    if (!s || s.includes("daysAgo") || s === "today") return s === "today" ? "present" : s;
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? s : d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  };
  const end = endDate === "today" ? "present" : fmt(endDate);
  return `${fmt(startDate)} – ${end}`;
}

function roundMetric(v: number): number {
  return Math.round((Number.isFinite(v) ? v : 0) * 100) / 100;
}

function formatMoney(value: number, formatter: Intl.NumberFormat): string {
  return value > 0 ? `+${formatter.format(value)}` : formatter.format(value);
}
function formatSignedNumber(value: number, formatter: Intl.NumberFormat): string {
  return value > 0 ? `+${formatter.format(value)}` : formatter.format(value);
}
function formatSignedDecimal(value: number): string {
  const f = Math.abs(value).toLocaleString(undefined, { maximumFractionDigits: 2 });
  if (value > 0) return `+${f}`;
  if (value < 0) return `-${f}`;
  return "0";
}
function toneClass(value: number): string {
  if (value > 0) return "text-emerald-700";
  if (value < 0) return "text-red-600";
  return "text-ink/60";
}

function KPICard({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "positive" | "negative" | "neutral";
}) {
  const color =
    tone === "positive" ? "text-emerald-700" : tone === "negative" ? "text-red-600" : "text-ink";
  return (
    <div className="rounded-brand border border-ink/10 bg-white p-5 shadow-card">
      <p className="text-xs font-semibold uppercase tracking-wider text-ink/40">{label}</p>
      <p className={`mt-2 text-2xl font-bold ${color}`}>{value}</p>
      {sub && <p className="mt-1 text-xs text-ink/50">{sub}</p>}
    </div>
  );
}

export function GA4DashboardPage() {
  const clientId = useAuthStore((s) => s.clientId);
  const { data, isLoading, error, refetch, isFetching } = useGA4Data();
  const { settings } = useDashboardSettings(clientId);

  const overrides = settings.experimentOverrides ?? {};

  // Apply same overrides pattern as ExperimentListPage / GA4ExperimentsPage
  const experiments = useMemo((): GA4EnrichedExperiment[] => {
    return (data?.experiments ?? [])
      .filter((e) => !overrides[e.experimentId]?.isExcluded)
      .map((e) => {
        const ov = overrides[e.experimentId];
        if (!ov) return e;

        let variantSummaries = e.variantSummaries;
        let uplifts = e.uplifts;

        if (ov.originalVariantId && variantSummaries.length) {
          variantSummaries = variantSummaries.map((v) => ({ ...v, isOriginal: v.id === ov.originalVariantId }));
          uplifts = calculateUplifts(variantSummaries);
        }
        if (ov.metricOverrides && uplifts) {
          uplifts = { ...uplifts };
          Object.entries(ov.metricOverrides).forEach(([metric, mo]) => {
            if (mo && uplifts)
              uplifts[metric as ExperimentMetricKey] = { ...uplifts[metric as ExperimentMetricKey], ...mo };
          });
        }

        return { ...e, name: ov.displayName ?? e.name, variantSummaries, uplifts };
      });
  }, [data?.experiments, overrides]);

  // Aggregate uplifts across all experiments for KPI cards (sum revenue/purchases/products, avg rates)
  const aggregated = useMemo(() => {
    let revenue = 0, purchases = 0, products = 0;
    let cvrSum = 0, rpvSum = 0, count = 0;
    for (const exp of experiments) {
      revenue += exp.uplifts.revenue.uplift;
      purchases += exp.uplifts.purchases.uplift;
      products += exp.uplifts.products.uplift;
      cvrSum += exp.uplifts.cvr.uplift;
      rpvSum += exp.uplifts.rpv.uplift;
      count++;
    }
    return {
      revenue: roundMetric(revenue),
      purchases: roundMetric(purchases),
      products: roundMetric(products),
      cvr: count > 0 ? roundMetric(cvrSum / count) : 0,
      rpv: count > 0 ? roundMetric(rpvSum / count) : 0,
      count,
    };
  }, [experiments]);

  const money = useMemo(
    () => new Intl.NumberFormat(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 }),
    []
  );
  const rpvMoney = useMemo(
    () => new Intl.NumberFormat(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 2 }),
    []
  );
  const number = useMemo(() => new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }), []);

  return (
    <div className="p-8 space-y-8">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <Link to="/dashboard/ga4" className="text-ink/40 hover:text-ink">
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <div>
            <div className="flex items-center gap-2">
              <BarChart3 className="h-5 w-5 text-ink/50" />
              <h1 className="text-2xl font-bold text-ink tracking-tight">GA4 Dashboard</h1>
            </div>
            <p className="mt-0.5 text-sm text-ink/50">
              Audience-based metrics from GA4. Uplift = best variation vs original.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <p className="text-xs text-ink/40">Each experiment uses its Convert running period</p>
          <Button variant="secondary" size="sm" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw className={`mr-1.5 h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>
      </div>

      {/* Error */}
      {error && <Alert tone="danger">{(error as Error).message}</Alert>}

      {/* Loading */}
      {isLoading && !error && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-24 rounded-2xl" />
            ))}
          </div>
          <div className="space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-20 rounded-2xl" />
            ))}
          </div>
        </div>
      )}

      {!isLoading && !error && (
        <>
          {/* KPI Cards — same 3 primary metrics as Convert dashboard */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3" data-tutorial="ga4-kpi-cards">
            <KPICard
              label="Revenue Uplift"
              value={formatMoney(aggregated.revenue, money)}
              sub={`${aggregated.count} experiment${aggregated.count !== 1 ? "s" : ""} · GA4 audiences`}
              tone={aggregated.revenue > 0 ? "positive" : aggregated.revenue < 0 ? "negative" : "neutral"}
            />
            <KPICard
              label="Purchases Uplift"
              value={formatSignedNumber(aggregated.purchases, number)}
              sub="Total across all experiments"
              tone={aggregated.purchases > 0 ? "positive" : aggregated.purchases < 0 ? "negative" : "neutral"}
            />
            <KPICard
              label="Products Uplift"
              value={formatSignedNumber(aggregated.products, number)}
              sub="Total items purchased uplift"
              tone={aggregated.products > 0 ? "positive" : aggregated.products < 0 ? "negative" : "neutral"}
            />
          </div>

          {/* Secondary rate KPIs */}
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <KPICard
              label="Avg. CVR Uplift"
              value={`${formatSignedDecimal(aggregated.cvr)}pts`}
              sub="Average across experiments"
              tone={aggregated.cvr > 0 ? "positive" : aggregated.cvr < 0 ? "negative" : "neutral"}
            />
            <KPICard
              label="Avg. RPV Uplift"
              value={formatMoney(aggregated.rpv, rpvMoney)}
              sub="Average across experiments"
              tone={aggregated.rpv > 0 ? "positive" : aggregated.rpv < 0 ? "negative" : "neutral"}
            />
          </div>

          {/* Experiments table */}
          {experiments.length === 0 ? (
            <EmptyState
              className="rounded-brand border border-ink/10 bg-white py-16"
              title="No matched GA4 audiences found. Make sure experiments are synced from Convert first."
            />
          ) : (
            <div className="space-y-3">
              <h2 className="text-sm font-semibold uppercase tracking-wider text-ink/40">
                Experiments ({experiments.length})
              </h2>
              <div className="overflow-hidden rounded-brand border border-ink/10 bg-white">
                <div className="overflow-x-auto">
                  <Table className="table-fixed">
                    <colgroup>
                      <col />
                      <col className="w-[110px]" />
                      <col className="w-[130px]" />
                      <col className="w-[110px]" />
                      <col className="w-[110px]" />
                      <col className="w-[110px]" />
                      <col className="w-[100px]" />
                      <col className="w-[110px]" />
                    </colgroup>
                    <THead>
                      <TR className="bg-ink/[0.02] hover:bg-transparent">
                        <TH>Experiment</TH>
                        <TH>Status</TH>
                        <TH>Revenue</TH>
                        <TH>RPV</TH>
                        <TH>Purchases</TH>
                        <TH>Products</TH>
                        <TH>CVR</TH>
                        <TH>AOV</TH>
                      </TR>
                    </THead>
                    <TBody>
                      {experiments.map((experiment) => (
                        <TR key={experiment.experimentId}>
                          <TD className="font-medium text-ink">
                            <span className="block truncate">{experiment.name}</span>
                            <span className="text-[10px] text-ink/40">
                              {formatDateRange(experiment.startDate, experiment.endDate)}
                            </span>
                          </TD>
                          <TD>
                            <StatusBadge status={experiment.status} />
                          </TD>
                          <MetricCell experiment={experiment} metric="revenue" formatValue={(v) => formatMoney(v, money)} />
                          <MetricCell experiment={experiment} metric="rpv" formatValue={(v) => formatMoney(v, rpvMoney)} />
                          <MetricCell experiment={experiment} metric="purchases" formatValue={(v) => formatSignedNumber(v, number)} />
                          <MetricCell experiment={experiment} metric="products" formatValue={(v) => formatSignedNumber(v, number)} />
                          <MetricCell experiment={experiment} metric="cvr" formatValue={(v) => `${formatSignedDecimal(v)}pts`} />
                          <MetricCell experiment={experiment} metric="aov" formatValue={(v) => formatMoney(v, rpvMoney)} />
                        </TR>
                      ))}
                    </TBody>
                  </Table>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function MetricCell({
  experiment,
  metric,
  formatValue,
}: {
  experiment: GA4EnrichedExperiment;
  metric: ExperimentMetricKey;
  formatValue: (value: number) => string;
}) {
  const uplift = experiment.uplifts?.[metric];
  if (!uplift) return <TD className="whitespace-nowrap text-ink/40">--</TD>;
  return (
    <TD className="whitespace-nowrap">
      <div className={`font-semibold ${toneClass(uplift.uplift)}`}>{formatValue(uplift.uplift)}</div>
      <div className="text-xs text-ink/45">{formatSignedDecimal(uplift.upliftPercent)}%</div>
    </TD>
  );
}
