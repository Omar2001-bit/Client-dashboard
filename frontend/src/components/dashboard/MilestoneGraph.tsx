import { formatRoiReturn } from "@/lib/dashboardMetrics";
import { formatSignedMoney } from "@/lib/experimentFormatting";

export function MilestoneGraph({
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
