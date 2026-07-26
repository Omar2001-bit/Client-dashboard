import { TD } from "@/components/ui";
import { formatSignedDecimal, toneClass } from "@/lib/experimentFormatting";
import type { MetricUplift } from "@/types";

export function MetricCell({
  uplift,
  formatValue,
  showPercent = true,
  className = "whitespace-nowrap",
}: {
  uplift: MetricUplift | undefined;
  formatValue: (value: number) => string;
  showPercent?: boolean;
  className?: string;
}) {
  if (!uplift) return <TD className={`${className} text-ink/40`}>--</TD>;
  return (
    <TD className={className}>
      <div className={`font-semibold ${toneClass(uplift.uplift)}`}>{formatValue(uplift.uplift)}</div>
      {showPercent && <div className="text-xs text-ink/45">{formatSignedDecimal(uplift.upliftPercent)}%</div>}
    </TD>
  );
}
