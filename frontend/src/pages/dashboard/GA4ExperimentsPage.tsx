import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, Search, RefreshCw, ArrowUp, ArrowDown } from "lucide-react";
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
  Pagination,
  EmptyState,
  Skeleton,
  Select,
  Input,
} from "@/components/ui";
import { useAuthStore } from "@/store/authStore";
import { formatSignedDecimal, formatSignedMoney, formatSignedNumber } from "@/lib/experimentFormatting";
import { MetricCell } from "@/components/dashboard/MetricCell";
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
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
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
    const dir = sortDir === "asc" ? -1 : 1;
    return [...processedExperiments]
      .filter((e) => e.name.toLowerCase().includes(search.toLowerCase()))
      .sort((a, b) => {
        if (isMetricKey(sortKey)) return dir * ((b.uplifts?.[sortKey]?.uplift ?? 0) - (a.uplifts?.[sortKey]?.uplift ?? 0));
        if (sortKey === "status") return dir * a.status.localeCompare(b.status);
        return dir * a.name.localeCompare(b.name);
      });
  }, [processedExperiments, search, sortKey, sortDir]);

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
          <Button variant="secondary" size="sm" onClick={() => { track({ type: "ga4_refresh_click", metadata: { page: "experiments" } }); refetch(); }} disabled={isFetching}>
            <RefreshCw className={`mr-1.5 h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>
      </div>

      {/* Error */}
      {error && <Alert tone="danger">{(error as Error).message}</Alert>}

      {!error && (
        <>
          {/* Controls */}
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="relative max-w-sm flex-1">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-ink/40 z-10" />
              <Input
                type="text"
                placeholder="Search experiments..."
                value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(0); }}
                className="pl-9"
              />
            </div>
            <div className="flex items-center gap-2">
              <Select
                value={sortKey}
                onChange={(e) => { setSortKey(e.target.value as SortKey); setPage(0); }}
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
                onClick={() => { setSortDir((d) => (d === "asc" ? "desc" : "asc")); setPage(0); }}
                title={sortDir === "asc" ? "Ascending — click to reverse" : "Descending — click to reverse"}
                aria-label="Toggle sort direction"
                className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-ink/10 bg-white text-ink/60 transition-colors hover:bg-ink/5 hover:text-ink"
              >
                {sortDir === "asc" ? <ArrowUp className="h-4 w-4" /> : <ArrowDown className="h-4 w-4" />}
              </button>
            </div>
          </div>

          {/* Table */}
          <div className="overflow-hidden rounded-brand border border-ink/10 bg-white">
            <div className="overflow-x-auto">
              <Table className="table-fixed">
                <colgroup>
                  <col className="w-[220px]" />
                  <col className="w-[120px]" />
                  <col className="w-[140px]" />
                  <col className="w-[120px]" />
                  <col className="w-[120px]" />
                  <col className="w-[120px]" />
                  <col className="w-[110px]" />
                  <col className="w-[120px]" />
                </colgroup>
                <THead>
                  <TR className="bg-ink/[0.02] hover:bg-transparent">
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
                  {isLoading
                    ? Array.from({ length: PAGE_SIZE }).map((_, i) => (
                        <TR key={i} className="hover:bg-transparent">
                          <TD colSpan={8}>
                            <Skeleton className="h-4" />
                          </TD>
                        </TR>
                      ))
                    : experiments.map((experiment) => (
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

            {!isLoading && filtered.length === 0 && (
              <EmptyState
                className="py-12"
                title="No matched GA4 audiences found. Make sure experiments are synced from Convert first."
              />
            )}

            {!isLoading && filtered.length > 0 && (
              <div className="border-t border-ink/10 px-6 py-3">
                <Pagination
                  page={currentPage + 1}
                  pageCount={totalPages}
                  total={filtered.length}
                  pageSize={PAGE_SIZE}
                  onPageChange={(p) => setPage(p - 1)}
                />
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function isMetricKey(value: SortKey): value is ExperimentMetricKey {
  return metricKeys.includes(value as ExperimentMetricKey);
}
