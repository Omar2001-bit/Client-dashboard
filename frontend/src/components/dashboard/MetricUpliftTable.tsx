import { Table, THead, TBody, TR, TH, TD } from "@/components/ui";
import type { ExperimentMetricKey, MetricUplift } from "@/types";

interface MetricUpliftTableProps {
  metrics: Array<{ key: ExperimentMetricKey; label: string }>;
  /** When provided, shows a read-only "Current uplift" column sourced from synced data. */
  getCurrent?: (key: ExperimentMetricKey) => MetricUplift | undefined;
  getOverrideUplift: (key: ExperimentMetricKey) => number | undefined;
  getOverridePercent: (key: ExperimentMetricKey) => number | undefined;
  onUpliftChange: (key: ExperimentMetricKey, value: string) => void;
  onPercentChange: (key: ExperimentMetricKey, value: string) => void;
  upliftLabel?: string;
  percentLabel?: string;
}

export function MetricUpliftTable({
  metrics,
  getCurrent,
  getOverrideUplift,
  getOverridePercent,
  onUpliftChange,
  onPercentChange,
  upliftLabel = "Uplift",
  percentLabel = "Uplift %",
}: MetricUpliftTableProps) {
  return (
    <div className="overflow-x-auto">
      <Table>
        <THead>
          <TR className="hover:bg-transparent">
            <TH className="w-24">Metric</TH>
            {getCurrent && <TH>Current uplift</TH>}
            <TH>{upliftLabel}</TH>
            <TH>{percentLabel}</TH>
          </TR>
        </THead>
        <TBody>
          {metrics.map(({ key, label }) => {
            const current = getCurrent?.(key);
            return (
              <TR key={key}>
                <TD className="font-medium text-ink/70">{label}</TD>
                {getCurrent && (
                  <TD className="text-ink/40">
                    {current ? `${current.uplift >= 0 ? "+" : ""}${current.uplift.toFixed(2)}` : "—"}
                  </TD>
                )}
                <TD>
                  <input
                    type="number"
                    step="0.01"
                    value={getOverrideUplift(key) ?? ""}
                    onChange={(e) => onUpliftChange(key, e.target.value)}
                    placeholder="—"
                    className="w-28 rounded-lg border border-ink/10 px-2 py-1 text-sm focus:outline-none focus:border-brand-300"
                  />
                </TD>
                <TD>
                  <input
                    type="number"
                    step="0.01"
                    value={getOverridePercent(key) ?? ""}
                    onChange={(e) => onPercentChange(key, e.target.value)}
                    placeholder="—"
                    className="w-28 rounded-lg border border-ink/10 px-2 py-1 text-sm focus:outline-none focus:border-brand-300"
                  />
                </TD>
              </TR>
            );
          })}
        </TBody>
      </Table>
    </div>
  );
}
