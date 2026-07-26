import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Search, EyeOff, Eye, StickyNote } from "lucide-react";
import { track } from "@/lib/activityTracker";
import { useScrollDepth } from "@/hooks/useScrollDepth";
import {
  StatusBadge,
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
import { useDashboardData } from "@/hooks/useDashboardData";
import { useDashboardSettings, useClientPreferences } from "@/hooks/useDashboardSettings";
import { matchesNamingConvention } from "@/lib/namingConvention";
import { calculateUplifts } from "@/pages/dashboard/dashboardData";
import { formatSignedDecimal, formatSignedMoney, formatSignedNumber } from "@/lib/experimentFormatting";
import { MetricCell } from "@/components/dashboard/MetricCell";
import type { ExperimentMetricKey, ExperimentSummary } from "@/types";

const PAGE_SIZE = 15;
const metricKeys: ExperimentMetricKey[] = ["revenue", "rpv", "purchases", "products", "cvr", "aov"];
type SortKey = ExperimentMetricKey | "name" | "status";

export function ExperimentListPage() {
  const clientId = useAuthStore((s) => s.clientId);
  const authLoading = useAuthStore((s) => s.loading);
  const { data, isLoading: loading } = useDashboardData(authLoading ? null : clientId);
  const { settings } = useDashboardSettings(clientId);
  const { prefs, toggleExclude } = useClientPreferences(clientId);
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("revenue");
  const [page, setPage] = useState(0);
  const [toggling, setToggling] = useState<string | null>(null);
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

  const clientExcluded = new Set(prefs.excludedExperimentIds ?? []);
  const overrides = settings.experimentOverrides ?? {};

  const getExperimentNote = (id: string): string | undefined =>
    overrides[id]?.notes ?? settings.manualExperiments?.find((m) => m.id === id)?.notes;

  // Apply settings to experiments
  const processedExperiments = useMemo(() => {
    const raw = data?.experiments ?? [];
    const synced = raw
      .filter((e) => matchesNamingConvention(e.name))
      .filter((e) => !overrides[e.id]?.isExcluded)
      .map((e) => {
        const ov = overrides[e.id];
        if (!ov) return e;
        let uplifts = e.uplifts;
        if (ov.originalVariantId && e.variants?.length) {
          uplifts = calculateUplifts(e.variants.map((v) => ({ ...v, isOriginal: v.id === ov.originalVariantId })));
        }
        if (ov.metricOverrides && uplifts) {
          uplifts = { ...uplifts };
          Object.entries(ov.metricOverrides).forEach(([metric, mo]) => {
            if (mo && uplifts) uplifts[metric as ExperimentMetricKey] = { ...uplifts[metric as ExperimentMetricKey], ...mo };
          });
        }
        return { ...e, name: ov.displayName ?? e.name, uplifts };
      });

    const manual: ExperimentSummary[] = (settings.manualExperiments ?? []).map((m) => ({
      id: m.id, name: m.name, status: m.status, startDate: m.startDate, endDate: m.endDate, uplifts: m.uplifts,
    }));

    return [...synced, ...manual];
  }, [data?.experiments, overrides, settings.manualExperiments]);

  const filtered = useMemo(() => {
    return [...processedExperiments]
      .filter((e) => e.name.toLowerCase().includes(search.toLowerCase()))
      .sort((a, b) => {
        if (isMetricKey(sortKey)) return (b.uplifts?.[sortKey]?.uplift ?? 0) - (a.uplifts?.[sortKey]?.uplift ?? 0);
        return String(a[sortKey]).localeCompare(String(b[sortKey]));
      });
  }, [processedExperiments, search, sortKey]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages - 1);
  const experiments = filtered.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE);

  const handleToggle = async (id: string, name: string) => {
    const isHiding = !clientExcluded.has(id);
    track({ type: "experiment_visibility_toggle", metadata: { experimentId: id, experimentName: name, action: isHiding ? "hide" : "show" } });
    setToggling(id);
    await toggleExclude(id);
    setToggling(null);
  };

  return (
    <div className="p-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-ink tracking-tight">Experiments</h1>
        <p className="mt-1 text-sm text-ink/50">Uplift compares original against the best variation for each metric.</p>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div data-tutorial="experiments-search" className="relative max-w-sm flex-1">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-ink/40 z-10" />
          <Input
            type="text"
            placeholder="Search experiments..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(0); if (e.target.value.length > 2) track({ type: "search", metadata: { query: e.target.value } }); }}
            className="pl-9"
          />
        </div>
        <Select
          data-tutorial="experiments-sort"
          value={sortKey}
          onChange={(e) => { setSortKey(e.target.value as SortKey); setPage(0); track({ type: "sort_change", metadata: { sortKey: e.target.value } }); }}
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
      </div>

      <div className="overflow-hidden rounded-brand border border-ink/10 bg-white">
        <div data-tutorial="experiments-table" className="overflow-x-auto">
          <Table className="table-fixed">
            <colgroup>
              <col />
              <col className="w-[120px]" />
              <col className="w-[140px]" />
              <col className="w-[120px]" />
              <col className="w-[120px]" />
              <col className="w-[120px]" />
              <col className="w-[110px]" />
              <col className="w-[120px]" />
              <col className="w-[140px]" />
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
                <TH />
              </TR>
            </THead>
            <TBody>
              {loading
                ? Array.from({ length: PAGE_SIZE }).map((_, i) => (
                    <TR key={i} className="hover:bg-transparent">
                      <TD colSpan={9}>
                        <Skeleton className="h-4" />
                      </TD>
                    </TR>
                  ))
                : experiments.map((experiment) => {
                    const isClientHidden = clientExcluded.has(experiment.id);
                    return (
                      <TR key={experiment.id} className={isClientHidden ? "opacity-40" : ""}>
                        <TD className="font-medium text-ink">
                          <div className="flex min-w-0 items-center gap-1.5">
                            <span className="truncate">{experiment.name}</span>
                            {getExperimentNote(experiment.id) && (
                              <span title={getExperimentNote(experiment.id)} className="cursor-help shrink-0">
                                <StickyNote className="h-3.5 w-3.5 text-amber-400" />
                              </span>
                            )}
                          </div>
                          {isClientHidden && (
                            <div className="text-[10px] font-normal text-ink/40">Hidden</div>
                          )}
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
                        <TD className="text-right">
                          <div className="flex items-center justify-end gap-2">
                            <button
                              data-tutorial="experiments-eye"
                              onClick={() => handleToggle(experiment.id, experiment.name)}
                              disabled={toggling === experiment.id}
                              title={isClientHidden ? "Show in dashboard" : "Hide from dashboard"}
                              className="text-ink/30 transition-colors hover:text-ink/60"
                            >
                              {isClientHidden ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
                            </button>
                            <Link
                              to={`/dashboard/experiments/${experiment.id}`}
                              onClick={() => track({ type: "experiment_view", metadata: { experimentId: experiment.id, experimentName: experiment.name, button: "View detail" } })}
                              className="whitespace-nowrap text-xs font-semibold text-ink underline-offset-4 hover:text-brand-700 hover:underline"
                            >
                              View detail
                            </Link>
                          </div>
                        </TD>
                      </TR>
                    );
                  })}
            </TBody>
          </Table>
        </div>

        {!loading && filtered.length === 0 && (
          <EmptyState className="py-12" title="No experiments have been synced yet." />
        )}

        {!loading && filtered.length > 0 && (
          <div className="border-t border-ink/10 px-6 py-3">
            <Pagination
              page={currentPage + 1}
              pageCount={totalPages}
              total={filtered.length}
              pageSize={PAGE_SIZE}
              onPageChange={(p) => {
                setPage(p - 1);
                track({ type: "list_page_change", metadata: { page: p } });
              }}
            />
          </div>
        )}
      </div>
    </div>
  );
}

function isMetricKey(value: SortKey): value is ExperimentMetricKey { return metricKeys.includes(value as ExperimentMetricKey); }
