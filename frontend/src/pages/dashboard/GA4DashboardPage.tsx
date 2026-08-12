import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { BarChart3, ArrowLeft, RefreshCw, ArrowUp, ArrowDown } from "lucide-react";
import { useGA4Data } from "@/hooks/useGA4Data";
import { useDashboardSettings } from "@/hooks/useDashboardSettings";
import { track } from "@/lib/activityTracker";
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
  KPICard,
  Select,
} from "@/components/ui";
import { useAuthStore } from "@/store/authStore";
import { formatSignedDecimal, formatSignedMoney, formatSignedNumber } from "@/lib/experimentFormatting";
import { MetricCell } from "@/components/dashboard/MetricCell";
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

const metricKeys: ExperimentMetricKey[] = ["revenue", "rpv", "purchases", "products", "cvr", "aov"];
type SortKey = ExperimentMetricKey | "name" | "status";
function isMetricKey(value: SortKey): value is ExperimentMetricKey {
  return metricKeys.includes(value as ExperimentMetricKey);
}

export function GA4DashboardPage() {
  const clientId = useAuthStore((s) => s.clientId);
  const { data, isLoading, error, refetch, isFetching } = useGA4Data();
  const { settings } = useDashboardSettings(clientId);
  const [selectedExperimentId, setSelectedExperimentId] = useState<string | null>(null);

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

  const [sortKey, setSortKey] = useState<SortKey>("revenue");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const sortedExperiments = useMemo(() => {
    const dir = sortDir === "asc" ? -1 : 1;
    return [...experiments].sort((a, b) => {
      if (isMetricKey(sortKey)) return dir * ((b.uplifts?.[sortKey]?.uplift ?? 0) - (a.uplifts?.[sortKey]?.uplift ?? 0));
      return dir * String(a[sortKey]).localeCompare(String(b[sortKey]));
    });
  }, [experiments, sortKey, sortDir]);

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
          <Button variant="secondary" size="sm" onClick={() => { track({ type: "ga4_refresh_click", metadata: { page: "dashboard" } }); refetch(); }} disabled={isFetching}>
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
              title="Revenue Uplift"
              value={formatSignedMoney(aggregated.revenue, money)}
              note={`${aggregated.count} experiment${aggregated.count !== 1 ? "s" : ""} · GA4 audiences`}
            />
            <KPICard
              title="Purchases Uplift"
              value={formatSignedNumber(aggregated.purchases, number)}
              note="Total across all experiments"
            />
            <KPICard
              title="Products Uplift"
              value={formatSignedNumber(aggregated.products, number)}
              note="Total items purchased uplift"
            />
          </div>

          {/* Secondary rate KPIs */}
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <KPICard
              title="Avg. CVR Uplift"
              value={`${formatSignedDecimal(aggregated.cvr)}pts`}
              note="Average across experiments"
            />
            <KPICard
              title="Avg. RPV Uplift"
              value={formatSignedMoney(aggregated.rpv, rpvMoney)}
              note="Average across experiments"
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
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-sm font-semibold uppercase tracking-wider text-ink/40">
                  Experiments ({experiments.length})
                </h2>
                <div className="flex items-center gap-2">
                  <Select
                    value={sortKey}
                    onChange={(e) => setSortKey(e.target.value as SortKey)}
                    className="sm:w-56"
                  >
                    <option value="revenue">Sort by revenue</option>
                    <option value="rpv">Sort by RPV</option>
                    <option value="purchases">Sort by purchases</option>
                    <option value="products">Sort by products</option>
                    <option value="cvr">Sort by CVR</option>
                    <option value="aov">Sort by AOV</option>
                    <option value="name">Sort by name</option>
                    <option value="status">Sort by status</option>
                  </Select>
                  <button
                    type="button"
                    onClick={() => setSortDir((d) => (d === "asc" ? "desc" : "asc"))}
                    title={sortDir === "asc" ? "Ascending — click to reverse" : "Descending — click to reverse"}
                    aria-label="Toggle sort direction"
                    className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-ink/10 bg-white text-ink/60 transition-colors hover:bg-ink/5 hover:text-ink"
                  >
                    {sortDir === "asc" ? <ArrowUp className="h-4 w-4" /> : <ArrowDown className="h-4 w-4" />}
                  </button>
                </div>
              </div>
              <div className="overflow-hidden rounded-brand border border-ink/10 bg-white">
                <div className="max-h-[560px] overflow-auto">
                  <Table className="table-fixed">
                    <colgroup>
                      <col className="w-[220px]" />
                      <col className="w-[110px]" />
                      <col className="w-[130px]" />
                      <col className="w-[110px]" />
                      <col className="w-[110px]" />
                      <col className="w-[110px]" />
                      <col className="w-[100px]" />
                      <col className="w-[110px]" />
                    </colgroup>
                    <THead>
                      <TR className="sticky top-0 z-10 bg-white hover:bg-transparent">
                        <TH className="whitespace-nowrap">Experiment</TH>
                        <TH className="whitespace-nowrap">Status</TH>
                        <TH>Revenue</TH>
                        <TH>RPV</TH>
                        <TH>Purchases</TH>
                        <TH>Products</TH>
                        <TH>CVR</TH>
                        <TH>AOV</TH>
                      </TR>
                    </THead>
                    <TBody>
                      {sortedExperiments.map((experiment) => (
                        <TR
                          key={experiment.experimentId}
                          selected={selectedExperimentId === experiment.experimentId}
                          onClick={() =>
                            setSelectedExperimentId((cur) => (cur === experiment.experimentId ? null : experiment.experimentId))
                          }
                          className="cursor-pointer"
                        >
                          <TD className="font-medium text-ink">
                            <span className="block truncate">{experiment.name}</span>
                            <span className="text-[10px] text-ink/40">
                              {formatDateRange(experiment.startDate, experiment.endDate)}
                            </span>
                          </TD>
                          <TD>
                            <StatusBadge status={experiment.status} />
                          </TD>
                          <MetricCell uplift={experiment.uplifts?.revenue} formatValue={(v) => formatSignedMoney(v, money)} />
                          <MetricCell uplift={experiment.uplifts?.rpv} formatValue={(v) => formatSignedMoney(v, rpvMoney)} />
                          <MetricCell uplift={experiment.uplifts?.purchases} formatValue={(v) => formatSignedNumber(v, number)} />
                          <MetricCell uplift={experiment.uplifts?.products} formatValue={(v) => formatSignedNumber(v, number)} />
                          <MetricCell uplift={experiment.uplifts?.cvr} formatValue={(v) => `${formatSignedDecimal(v)}pts`} />
                          <MetricCell uplift={experiment.uplifts?.aov} formatValue={(v) => formatSignedMoney(v, rpvMoney)} />
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
