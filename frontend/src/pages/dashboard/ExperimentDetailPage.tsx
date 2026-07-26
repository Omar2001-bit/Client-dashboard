import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, MapPin, Users, ExternalLink, FileText, EyeOff, Eye, StickyNote } from "lucide-react";
import { track } from "@/lib/activityTracker";
import { useScrollDepth } from "@/hooks/useScrollDepth";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { StatusBadge, Alert, Table, THead, TBody, TR, TH, TD } from "@/components/ui";
import { useAuthStore } from "@/store/authStore";
import { useDashboardData } from "@/hooks/useDashboardData";
import { useDashboardSettings, useClientPreferences } from "@/hooks/useDashboardSettings";
import { calculateUplifts } from "@/pages/dashboard/dashboardData";
import type { ExperimentMetricKey, ExperimentSummary, MetricUplift } from "@/types";

const metrics: Array<{ key: ExperimentMetricKey; label: string }> = [
  { key: "revenue", label: "Revenue" },
  { key: "rpv", label: "RPV" },
  { key: "purchases", label: "Purchases" },
  { key: "products", label: "Products" },
  { key: "cvr", label: "CVR" },
  { key: "aov", label: "AOV" },
];

export function ExperimentDetailPage() {
  const { experimentId } = useParams<{ experimentId: string }>();
  const clientId = useAuthStore((s) => s.clientId);
  const authLoading = useAuthStore((s) => s.loading);
  const { data, isLoading: loading } = useDashboardData(authLoading ? null : clientId);
  const { settings } = useDashboardSettings(clientId);
  const { prefs, toggleExclude } = useClientPreferences(clientId);
  const [toggling, setToggling] = useState(false);
  useScrollDepth();

  const rawExperiment = data?.experiments.find((item) => item.id === experimentId);

  // Apply settings overrides
  const experiment = useMemo(() => {
    if (!rawExperiment) return rawExperiment;
    const ov = settings.experimentOverrides?.[rawExperiment.id];
    if (!ov) return rawExperiment;
    let uplifts = rawExperiment.uplifts;
    if (ov.originalVariantId && rawExperiment.variants?.length) {
      uplifts = calculateUplifts(rawExperiment.variants.map((v) => ({ ...v, isOriginal: v.id === ov.originalVariantId })));
    }
    if (ov.metricOverrides && uplifts) {
      uplifts = { ...uplifts };
      Object.entries(ov.metricOverrides).forEach(([metric, mo]) => {
        if (mo) uplifts![metric as ExperimentMetricKey] = { ...uplifts![metric as ExperimentMetricKey], ...mo };
      });
    }
    return { ...rawExperiment, name: ov.displayName ?? rawExperiment.name, uplifts };
  }, [rawExperiment, settings]);

  const override = experimentId ? settings.experimentOverrides?.[experimentId] : undefined;
  const isClientHidden = experimentId ? (prefs.excludedExperimentIds ?? []).includes(experimentId) : false;

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

  if (loading) return <div className="p-8 text-sm text-ink/50">Loading experiment...</div>;
  if (!experiment) return <div className="p-8 text-sm text-ink/50">Experiment not found.</div>;

  const handleToggleHide = async () => {
    if (!experimentId) return;
    track({ type: "experiment_detail_hide_toggle", metadata: { experimentId, experimentName: experiment?.name, action: isClientHidden ? "show" : "hide" } });
    setToggling(true);
    await toggleExclude(experimentId);
    setToggling(false);
  };

  return (
    <div className="p-8 space-y-6">
      <Link
        to="/dashboard/experiments"
        onClick={() => track({ type: "back_navigation", metadata: { from: "experiment_detail", experimentId: experiment.id, experimentName: experiment.name } })}
        className="inline-flex items-center gap-2 text-sm text-ink/50 hover:text-ink"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to experiments
      </Link>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between" data-tutorial="experiment-detail-header">
        <div>
          <h1 className="text-2xl font-bold text-ink">{experiment.name}</h1>
          <p className="mt-1 text-sm text-ink/50">ID: {experiment.id}</p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={handleToggleHide}
            disabled={toggling}
            className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
              isClientHidden
                ? "border-brand-300 bg-brand-50 text-brand-700 hover:bg-brand-100"
                : "border-ink/10 text-ink/50 hover:bg-ink/5"
            }`}
          >
            {isClientHidden ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
            {isClientHidden ? "Show in dashboard" : "Hide from dashboard"}
          </button>
          <StatusBadge status={experiment.status} />
        </div>
      </div>

      {/* Admin notes */}
      {override?.notes && (
        <Alert tone="warning" icon={<StickyNote className="h-4 w-4" />}>
          {override.notes}
        </Alert>
      )}

      <ExperimentDetailsCard experiment={experiment} />

      <Card data-tutorial="experiment-metric-uplift">
        <CardHeader>
          <h2 className="font-semibold text-ink">Metric Uplift</h2>
        </CardHeader>
        <CardBody className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <THead>
                <TR className="bg-ink/[0.02] hover:bg-transparent">
                  <TH className="px-6">Metric</TH>
                  <TH className="px-6">Original</TH>
                  <TH className="px-6">Best variation</TH>
                  <TH className="px-6">Uplift</TH>
                  <TH className="px-6">Uplift %</TH>
                </TR>
              </THead>
              <TBody>
                {metrics.map((metric) => {
                  const uplift = experiment.uplifts?.[metric.key];
                  return (
                    <TR key={metric.key}>
                      <TD className="px-6 py-4 font-medium text-ink">{metric.label}</TD>
                      <TD className="px-6 py-4 text-ink/60">{formatMetric(metric.key, uplift?.original ?? 0, money, rpvMoney, number)}</TD>
                      <TD className="px-6 py-4 text-ink/60">
                        <div>{formatMetric(metric.key, uplift?.bestVariation ?? 0, money, rpvMoney, number)}</div>
                        {uplift?.bestVariationName && <div className="text-xs text-ink/40">{uplift.bestVariationName}</div>}
                      </TD>
                      <TD className={`px-6 py-4 font-semibold ${toneClass(uplift?.uplift ?? 0)}`}>
                        {formatMetricUplift(metric.key, uplift, money, rpvMoney, number)}
                      </TD>
                      <TD className={`px-6 py-4 font-semibold ${toneClass(uplift?.uplift ?? 0)}`}>
                        {formatSignedDecimal(uplift?.upliftPercent ?? 0)}%
                      </TD>
                    </TR>
                  );
                })}
              </TBody>
            </Table>
          </div>
        </CardBody>
      </Card>

      <Card data-tutorial="experiment-variation-metrics">
        <CardHeader>
          <h2 className="font-semibold text-ink">Variation Metrics</h2>
        </CardHeader>
        <CardBody className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <THead>
                <TR className="bg-ink/[0.02] hover:bg-transparent">
                  <TH className="px-6">Variation</TH>
                  <TH className="px-6">Revenue</TH>
                  <TH className="px-6">RPV</TH>
                  <TH className="px-6">Purchases</TH>
                  <TH className="px-6">Products</TH>
                  <TH className="px-6">CVR</TH>
                  <TH className="px-6">AOV</TH>
                </TR>
              </THead>
              <TBody>
                {(experiment.variants ?? []).map((variant) => (
                  <TR key={variant.id}>
                    <TD className="px-6 py-4 font-medium text-ink">
                      <div>{variant.name}</div>
                      {variant.isOriginal && <div className="text-xs text-ink/40">Original</div>}
                    </TD>
                    <TD className="px-6 py-4 text-ink/60">{money.format(variant.revenue)}</TD>
                    <TD className="px-6 py-4 text-ink/60">{rpvMoney.format(variant.rpv)}</TD>
                    <TD className="px-6 py-4 text-ink/60">{number.format(variant.transactions)}</TD>
                    <TD className="px-6 py-4 text-ink/60">{number.format(variant.products)}</TD>
                    <TD className="px-6 py-4 text-ink/60">{formatPlainDecimal(variant.cvr)}%</TD>
                    <TD className="px-6 py-4 text-ink/60">{rpvMoney.format(variant.aov)}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </div>
          {(experiment.variants ?? []).length === 0 && (
            <div className="px-6 py-10 text-center text-sm text-ink/50">No variation report has been synced yet.</div>
          )}
        </CardBody>
      </Card>

      {experiment.goals && experiment.goals.length > 0 ? (
        <div className="space-y-4" data-tutorial="experiment-goals">
          <h2 className="text-lg font-semibold text-ink">Goals Breakdown</h2>
          {experiment.goals.map((goal, idx) => (
            <Card key={goal.id || idx}>
              <CardHeader className="py-3 bg-ink/[0.02] border-b border-ink/10">
                <div className="flex items-center justify-between">
                  <h3 className="font-medium text-ink">{goal.name}</h3>
                  <div className="flex items-center gap-3 text-xs text-ink/50">
                    <span className="capitalize">{goal.type ?? "Unknown Type"}</span>
                    <span className="font-mono">ID: {goal.id}</span>
                  </div>
                </div>
              </CardHeader>
              <CardBody className="p-0">
                {goal.stats && goal.stats.length > 0 ? (
                  <div className="overflow-x-auto">
                    <Table>
                      <THead>
                        <TR className="hover:bg-transparent">
                          <TH className="px-6 py-2">Variation</TH>
                          <TH className="px-6 py-2">Visitors</TH>
                          <TH className="px-6 py-2">Conversions</TH>
                          <TH className="px-6 py-2">CVR</TH>
                          <TH className="px-6 py-2">Revenue</TH>
                        </TR>
                      </THead>
                      <TBody>
                        {goal.stats.map((stat) => (
                          <TR key={stat.variationId}>
                            <TD className="px-6 py-3 font-medium text-ink">{stat.variationName}</TD>
                            <TD className="px-6 py-3 text-ink/60">{number.format(stat.visitors)}</TD>
                            <TD className="px-6 py-3 text-ink/60">{number.format(stat.conversions)}</TD>
                            <TD className="px-6 py-3 text-ink/60">{formatPlainDecimal(stat.conversionRate)}%</TD>
                            <TD className="px-6 py-3 text-ink/60">{money.format(stat.revenue)}</TD>
                          </TR>
                        ))}
                      </TBody>
                    </Table>
                  </div>
                ) : (
                  <div className="px-6 py-4 text-center text-sm text-ink/50">No variation stats available for this goal.</div>
                )}
              </CardBody>
            </Card>
          ))}
        </div>
      ) : (
        <Card data-tutorial="experiment-goals-empty">
          <CardHeader>
            <h2 className="font-semibold text-ink">Goals</h2>
          </CardHeader>
          <CardBody className="p-0">
            <div className="px-6 py-10 text-center text-sm text-ink/50">No goals found for this experiment.</div>
          </CardBody>
        </Card>
      )}
    </div>
  );
}

function ExperimentDetailsCard({ experiment }: { experiment: ExperimentSummary }) {
  const hasDetails =
    experiment.description ||
    experiment.objective ||
    (experiment.audiences?.length ?? 0) > 0 ||
    (experiment.locations?.length ?? 0) > 0 ||
    (experiment.variationPreviews?.length ?? 0) > 0;

  if (!hasDetails) return null;

  return (
    <Card data-tutorial="experiment-details-card">
      <CardHeader>
        <h2 className="font-semibold text-ink">Experiment Details</h2>
      </CardHeader>
      <CardBody className="space-y-5">

        {/* Description / Objective */}
        {(experiment.description || experiment.objective) && (
          <div className="flex gap-3">
            <FileText className="h-4 w-4 mt-0.5 shrink-0 text-ink/40" />
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-ink/40 mb-1">Description</p>
              <p className="text-sm text-ink/70">
                {experiment.description || experiment.objective}
              </p>
            </div>
          </div>
        )}

        {/* Location — which page */}
        {(experiment.locations?.length ?? 0) > 0 && (
          <div className="flex gap-3">
            <MapPin className="h-4 w-4 mt-0.5 shrink-0 text-ink/40" />
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-ink/40 mb-1">Location</p>
              <div className="space-y-1">
                {experiment.locations!.map((loc) => (
                  <div key={loc.id}>
                    <span className="text-sm font-medium text-ink">{loc.name}</span>
                    {loc.description && (
                      <span className="ml-2 text-sm text-ink/50">{loc.description}</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Audience */}
        {(experiment.audiences?.length ?? 0) > 0 && (
          <div className="flex gap-3">
            <Users className="h-4 w-4 mt-0.5 shrink-0 text-ink/40" />
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-ink/40 mb-1">Audience</p>
              <div className="space-y-1">
                {experiment.audiences!.map((aud) => (
                  <div key={aud.id}>
                    <span className="text-sm font-medium text-ink">{aud.name}</span>
                    {aud.description && (
                      <span className="ml-2 text-sm text-ink/50">{aud.description}</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Variation preview links */}
        {(experiment.variationPreviews?.length ?? 0) > 0 && (
          <div className="flex gap-3">
            <ExternalLink className="h-4 w-4 mt-0.5 shrink-0 text-ink/40" />
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-ink/40 mb-2">Variation Previews</p>
              <div className="flex flex-wrap gap-2">
                {experiment.variationPreviews!.map((v) => (
                  <a
                    key={v.id}
                    href={v.previewUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={() => track({ type: "variation_preview_click", metadata: { variationName: v.name, variationId: v.id, experimentId: experiment.id, experimentName: experiment.name } })}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-ink/10 bg-ink/[0.02] px-3 py-1.5 text-sm text-ink hover:bg-ink/[0.06] transition-colors"
                  >
                    <span>{v.name}</span>
                    {v.isBaseline && <span className="text-xs text-ink/40">(Original)</span>}
                    <span className="text-xs text-ink/40">{v.trafficSplit}%</span>
                    <ExternalLink className="h-3 w-3 text-ink/30" />
                  </a>
                ))}
              </div>
            </div>
          </div>
        )}

      </CardBody>
    </Card>
  );
}

function formatMetric(
  metric: ExperimentMetricKey,
  value: number,
  money: Intl.NumberFormat,
  rpvMoney: Intl.NumberFormat,
  number: Intl.NumberFormat
): string {
  if (metric === "revenue") return money.format(value);
  if (metric === "rpv" || metric === "aov") return rpvMoney.format(value);
  if (metric === "cvr") return `${formatPlainDecimal(value)}%`;
  return number.format(value);
}

function formatMetricUplift(
  metric: ExperimentMetricKey,
  uplift: MetricUplift | undefined,
  money: Intl.NumberFormat,
  rpvMoney: Intl.NumberFormat,
  number: Intl.NumberFormat
): string {
  const value = uplift?.uplift ?? 0;
  if (metric === "revenue") return formatSignedMoney(value, money);
  if (metric === "rpv" || metric === "aov") return formatSignedMoney(value, rpvMoney);
  if (metric === "cvr") return `${formatSignedDecimal(value)} pts`;
  return formatSignedNumber(value, number);
}

function formatSignedMoney(value: number, formatter: Intl.NumberFormat): string {
  return value > 0 ? `+${formatter.format(value)}` : formatter.format(value);
}

function formatSignedNumber(value: number, formatter: Intl.NumberFormat): string {
  return value > 0 ? `+${formatter.format(value)}` : formatter.format(value);
}

function formatPlainDecimal(value: number): string {
  return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function formatSignedDecimal(value: number): string {
  const formatted = Math.abs(value).toLocaleString(undefined, { maximumFractionDigits: 2 });
  if (value > 0) return `+${formatted}`;
  if (value < 0) return `-${formatted}`;
  return "0";
}

function toneClass(value: number): string {
  if (value > 0) return "text-emerald-700";
  if (value < 0) return "text-red-600";
  return "text-ink/60";
}
