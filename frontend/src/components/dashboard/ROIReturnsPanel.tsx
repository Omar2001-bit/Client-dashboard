import { TrendingUp } from "lucide-react";
import { Card, CardBody } from "@/components/ui/Card";
import { formatRoiReturn } from "@/lib/dashboardMetrics";
import { formatSignedMoney, toneClass } from "@/lib/experimentFormatting";
import { MilestoneGraph } from "./MilestoneGraph";

export function ROIReturnsPanel({
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
