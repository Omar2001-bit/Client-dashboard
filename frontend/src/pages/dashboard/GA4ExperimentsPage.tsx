import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { FlaskConical, ArrowLeft, ChevronLeft, ChevronRight, Search, RefreshCw } from "lucide-react";
import { useGA4Data } from "@/hooks/useGA4Data";
import { useDashboardSettings } from "@/hooks/useDashboardSettings";
import { calculateUplifts } from "@/pages/dashboard/dashboardData";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { useAuthStore } from "@/store/authStore";
import type { ExperimentMetricKey } from "@/types";
import type { GA4EnrichedExperiment as EnrichedExp } from "@/hooks/useGA4Data";

const PAGE_SIZE = 15;

const metricKeys: ExperimentMetricKey[] = ["revenue", "rpv", "purchases", "products", "cvr", "aov"];
type SortKey = ExperimentMetricKey | "name" | "status";

function formatDateRange(startDate: string, endDate: string): string {
  const fmt = (s: string) => {
    if (!s || s.includes("daysAgo") || s === "today") return s === "today" ? "present" : s;
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? s : d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  };
  return `${fmt(startDate)} – ${endDate === "today" ? "present" : fmt(endDate)}`;
}

export function GA4ExperimentsPage() {
  const clientId = useAuthStore((s) => s.clientId);
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("revenue");
  const [page, setPage] = useState(0);

  const { data, isLoading, error, refetch, isFetching } = useGA4Data();
  const { settings } = useDashboardSettings(clientId);

  const overrides = settings.experimentOverrides ?? {};

  // Apply the same overrides pattern as ExperimentListPage
  const processedExperiments = useMemo((): EnrichedExp[] => {
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
            if (mo && uplifts) uplifts[metric as ExperimentMetricKey] = { ...uplifts[metric as ExperimentMetricKey], ...mo };
          });
        }

        return { ...e, name: ov.displayName ?? e.name, variantSummaries, uplifts };
      });
  }, [data?.experiments, overrides]);

  const filtered = useMemo(() => {
    return [...processedExperiments]
      .filter((e) => e.name.toLowerCase().includes(search.toLowerCase()))
      .sort((a, b) => {
        if (isMetricKey(sortKey)) return (b.uplifts?.[sortKey]?.uplift ?? 0) - (a.uplifts?.[sortKey]?.uplift ?? 0);
        if (sortKey === "status") return a.status.localeCompare(b.status);
        return a.name.localeCompare(b.name);
      });
  }, [processedExperiments, search, sortKey]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages - 1);
  const experiments = filtered.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE);

  const currency = "USD";
  const money = useMemo(
    () => new Intl.NumberFormat(undefined, { style: "currency", currency, maximumFractionDigits: 0 }),
    []
  );
  const rpvMoney = useMemo(
    () => new Intl.NumberFormat(undefined, { style: "currency", currency, maximumFractionDigits: 2 }),
    []
  );
  const number = useMemo(() => new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }), []);

  return (
    <div className="p-8 space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <Link to="/dashboard/ga4" className="text-ink/40 hover:text-ink">
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-ink tracking-tight">GA4 Experiments</h1>
            <p className="mt-1 text-sm text-ink/50">
              Uplift compares original against the best variation. Data sourced from GA4 audiences.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <p className="text-xs text-ink/40">Each experiment uses its Convert running period</p>
          <button
            onClick={() => refetch()}
            disabled={isFetching}
            className="flex items-center gap-1.5 rounded-xl border border-ink/15 px-3 py-2 text-sm text-ink/60 hover:text-ink hover:bg-ink/5 disabled:opacity-40 transition-colors"
          >
            <RefreshCw className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
            Refresh
          </button>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="rounded-2xl border border-red-200 bg-red-50 px-5 py-4 text-sm text-red-700">
          {(error as Error).message}
        </div>
      )}

      {!error && (
        <>
          {/* Controls */}
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="relative max-w-sm flex-1">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-ink/40" />
              <input
                type="text"
                placeholder="Search experiments..."
                value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(0); }}
                className="w-full rounded-xl border border-ink/15 py-2 pl-9 pr-4 text-sm focus:outline-none focus:ring-2 focus:ring-brand-200 focus:border-brand-500 text-ink placeholder:text-ink/40"
              />
            </div>
            <select
              value={sortKey}
              onChange={(e) => { setSortKey(e.target.value as SortKey); setPage(0); }}
              className="rounded-xl border border-ink/15 bg-white px-3 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-brand-200"
            >
              <option value="revenue">Sort by revenue</option>
              <option value="rpv">Sort by RPV</option>
              <option value="purchases">Sort by purchases</option>
              <option value="products">Sort by products</option>
              <option value="cvr">Sort by CVR</option>
              <option value="aov">Sort by AOV</option>
              <option value="name">Sort by name</option>
              <option value="status">Sort by status</option>
            </select>
          </div>

          {/* Table */}
          <div className="overflow-hidden rounded-brand border border-ink/10 bg-white">
            <table className="w-full table-fixed text-sm">
              <colgroup>
                <col />
                <col className="w-[120px]" />
                <col className="w-[140px]" />
                <col className="w-[120px]" />
                <col className="w-[120px]" />
                <col className="w-[120px]" />
                <col className="w-[110px]" />
                <col className="w-[120px]" />
              </colgroup>
              <thead>
                <tr className="border-b border-ink/10 bg-ink/[0.02] text-left text-xs uppercase tracking-wider text-ink/50">
                  <th className="px-5 py-3 font-semibold">Experiment</th>
                  <th className="px-5 py-3 font-semibold">Status</th>
                  <th className="px-5 py-3 font-semibold">Revenue</th>
                  <th className="px-5 py-3 font-semibold">RPV</th>
                  <th className="px-5 py-3 font-semibold">Purchases</th>
                  <th className="px-5 py-3 font-semibold">Products</th>
                  <th className="px-5 py-3 font-semibold">CVR</th>
                  <th className="px-5 py-3 font-semibold">AOV</th>
                </tr>
              </thead>
              <tbody>
                {isLoading
                  ? Array.from({ length: PAGE_SIZE }).map((_, i) => (
                      <tr key={i} className="border-b border-ink/5">
                        <td className="px-5 py-4" colSpan={8}>
                          <div className="h-4 animate-pulse rounded bg-ink/5" />
                        </td>
                      </tr>
                    ))
                  : experiments.map((experiment) => (
                      <tr
                        key={experiment.experimentId}
                        className="border-b border-ink/5 transition-colors hover:bg-ink/[0.02]"
                      >
                        <td className="px-5 py-3 font-medium text-ink">
                          <span className="truncate block">{experiment.name}</span>
                          <span className="text-[10px] text-ink/40">
                            {formatDateRange(experiment.startDate, experiment.endDate)}
                          </span>
                        </td>
                        <td className="px-5 py-3">
                          <StatusBadge status={experiment.status} />
                        </td>
                        <MetricCell experiment={experiment} metric="revenue" formatValue={(v) => formatMoney(v, money)} />
                        <MetricCell experiment={experiment} metric="rpv" formatValue={(v) => formatMoney(v, rpvMoney)} />
                        <MetricCell experiment={experiment} metric="purchases" formatValue={(v) => formatSignedNumber(v, number)} />
                        <MetricCell experiment={experiment} metric="products" formatValue={(v) => formatSignedNumber(v, number)} />
                        <MetricCell experiment={experiment} metric="cvr" formatValue={(v) => `${formatSignedDecimal(v)}pts`} />
                        <MetricCell experiment={experiment} metric="aov" formatValue={(v) => formatMoney(v, rpvMoney)} />
                      </tr>
                    ))}
              </tbody>
            </table>

            {!isLoading && filtered.length === 0 && (
              <div className="px-6 py-12 text-center text-sm text-ink/50">
                No matched GA4 audiences found. Make sure experiments are synced from Convert first.
              </div>
            )}

            {!isLoading && filtered.length > 0 && (
              <div className="flex items-center justify-between border-t border-ink/10 px-6 py-3">
                <p className="text-xs text-ink/50">
                  Showing {currentPage * PAGE_SIZE + 1}–{Math.min((currentPage + 1) * PAGE_SIZE, filtered.length)} of {filtered.length} experiments
                </p>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setPage((p) => p - 1)}
                    disabled={currentPage === 0}
                    className="rounded-xl border border-ink/15 p-1.5 text-ink/60 transition-colors hover:bg-ink/5 disabled:cursor-not-allowed disabled:opacity-20"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </button>
                  <span className="min-w-[80px] text-center text-xs font-semibold text-ink/70">
                    Page {currentPage + 1} of {totalPages}
                  </span>
                  <button
                    onClick={() => setPage((p) => p + 1)}
                    disabled={currentPage >= totalPages - 1}
                    className="rounded-xl border border-ink/15 p-1.5 text-ink/60 transition-colors hover:bg-ink/5 disabled:cursor-not-allowed disabled:opacity-20"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </button>
                </div>
              </div>
            )}
          </div>
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
  experiment: EnrichedExp;
  metric: ExperimentMetricKey;
  formatValue: (value: number) => string;
}) {
  const uplift = experiment.uplifts?.[metric];
  if (!uplift) return <td className="whitespace-nowrap px-5 py-3 text-ink/40">--</td>;
  return (
    <td className="whitespace-nowrap px-5 py-3">
      <div className={`font-semibold ${toneClass(uplift.uplift)}`}>{formatValue(uplift.uplift)}</div>
      <div className="text-xs text-ink/45">{formatSignedDecimal(uplift.upliftPercent)}%</div>
    </td>
  );
}

function isMetricKey(value: SortKey): value is ExperimentMetricKey {
  return metricKeys.includes(value as ExperimentMetricKey);
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
