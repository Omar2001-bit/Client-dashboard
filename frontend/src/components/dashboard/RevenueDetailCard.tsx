import { Card, CardBody } from "@/components/ui/Card";
import { formatDateLabel, type DailyRevenuePoint } from "@/lib/dashboardMetrics";

export function RevenueDetailCard({ data, money }: { data: DailyRevenuePoint; money: Intl.NumberFormat }) {
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
