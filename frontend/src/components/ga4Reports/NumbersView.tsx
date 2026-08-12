import { ChevronDown, ChevronUp, Inbox } from "lucide-react";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/Table";
import { metricLabel } from "@/lib/ga4Reports/metricLabels";
import { bucketOverlapsRange, detectGranularity } from "@/lib/ga4Reports/dates";
import { deltaPct, fmtBucketLabel, fmtDelta, fmtValue, humanize } from "@/lib/ga4Reports/format";
import { DELTA_DOWN, DELTA_UP } from "@/lib/ga4Reports/theme";
import { metricIsInverted, type ColorPeriod, type MetaItem, type ReportResponse } from "@/lib/ga4Reports/types";

// Ported from VC3/GA4-simply-layer's src/components/NumbersView.tsx, re-skinned to this
// app's light theme — logic unchanged.
interface Props {
  data: ReportResponse;
  metricsMeta?: MetaItem[]; // for pretty names
  compact?: boolean;
  colorPeriods?: ColorPeriod[]; // highlight-period tinting on date rows
}

/** `invert` flips the good/bad coloring for metrics where more is worse (cart removals,
 *  refunds…): an increase reads red, a decrease green. The arrow still follows the sign
 *  — only the judgment color inverts. */
export function Delta({ value, invert }: { value: number | null; invert?: boolean }) {
  if (value === null) return <span className="text-ink/50">–</span>;
  const good = invert ? value < 0 : value > 0;
  const color = value === 0 ? DELTA_UP : good ? DELTA_UP : DELTA_DOWN;
  return (
    <span style={{ color }} className="inline-flex items-center gap-0.5 font-medium tabular-nums">
      {value !== 0 &&
        (value > 0 ? <ChevronUp size={10} /> : <ChevronDown size={10} />)}
      {fmtDelta(value)}
    </span>
  );
}

interface TileProps {
  apiName: string;
  data: ReportResponse;
  metricsMeta?: MetaItem[];
  compact?: boolean;
}

/** A single KPI tile's content — no grid, no drag wrapper. Used both by the
 *  Numbers-view grid and (via EntryCard) by any other section a card gets dragged into. */
export function KpiTileContent({ apiName, data, metricsMeta, compact }: TileProps) {
  const i = data.metrics.indexOf(apiName);
  if (i === -1) return null;
  const a = data.totalsA[i] ?? 0;
  const b = data.totalsB?.[i];
  const type = data.metricHeaders[i]?.type;
  return (
    <div className="min-w-0 rounded-xl border border-ink/10 bg-white px-4 py-3 text-left">
      <div className="text-[11px] uppercase leading-tight tracking-wider text-ink/50">
        {metricLabel(apiName, metricsMeta)}
      </div>
      <div className={`mt-1 break-words font-semibold tabular-nums text-ink ${compact ? "text-lg" : "text-xl"}`}>
        {fmtValue(a, type, data.currencyCode)}
      </div>
      {data.rangeB && (
        <div className="mt-1 flex items-baseline gap-2 text-xs">
          <Delta value={deltaPct(a, b)} invert={metricIsInverted(apiName)} />
          <span className="text-ink/50">vs {fmtValue(b ?? 0, type, data.currencyCode)}</span>
        </div>
      )}
    </div>
  );
}

/** The dimension-breakdown table below the KPI grid — always driven by the report's
 *  full metric list, unrelated to the draggable card arrangement. Rows falling inside a
 *  highlight period get tinted with that period's color, so the same phases marked on
 *  the graphs read here too. */
export default function NumbersView({ data, metricsMeta, colorPeriods }: Props) {
  const hasCompare = !!data.rangeB;
  const dimList = data.dimensions;
  const granularity = detectGranularity(dimList);
  const hasDim = dimList.length > 0 && data.rows.length > 0 && data.rows[0].dim !== "total";
  const colCount = 1 + data.metrics.length * (hasCompare ? 3 : 1);
  if (!hasDim) return null;
  const periodOf = (bucket: string): ColorPeriod | undefined =>
    granularity && bucket
      ? colorPeriods?.find((p) => bucketOverlapsRange(granularity, bucket, p.startDate, p.endDate))
      : undefined;
  return (
    <div className="animate-fade-in max-h-[560px] overflow-auto rounded-xl border border-ink/10 bg-white">
      <Table>
        <THead>
          <TR className="sticky top-0 z-10 bg-white hover:bg-transparent">
            <TH className="px-4 py-3">{dimList.map(humanize).join(" · ")}</TH>
            {data.metrics.map((m) => (
              <TH key={m} className="px-4 py-3 text-right" colSpan={hasCompare ? 3 : 1}>
                {metricLabel(m, metricsMeta)}
              </TH>
            ))}
          </TR>
          {hasCompare && (
            <TR className="sticky top-[40px] z-10 bg-white text-right text-[11px] text-ink/50 hover:bg-transparent">
              <TH className="px-4 py-1.5 text-left font-normal"></TH>
              {data.metrics.map((m) => (
                <FragmentHeads key={m} />
              ))}
            </TR>
          )}
        </THead>
        <TBody>
          {data.rows.length === 0 ? (
            <TR className="hover:bg-transparent">
              <TD colSpan={colCount} className="px-4 py-8 text-center text-xs text-ink/50">
                <div className="flex flex-col items-center gap-1.5">
                  <Inbox size={18} />
                  No rows for this breakdown.
                </div>
              </TD>
            </TR>
          ) : (
            data.rows.map((r, ri) => {
              const period = periodOf(r.dim);
              return (
              <TR
                key={`${r.dim}-${ri}`}
                className="hover:bg-ink/[0.03]"
                style={period ? { background: `${period.color}14` } : undefined}
              >
                <TD className="max-w-[280px] truncate px-4 py-2.5 text-ink/70">
                  {period && (
                    <span
                      className="mr-1.5 inline-block h-2 w-2 rounded-full align-middle"
                      style={{ background: period.color }}
                      title={period.label || "Highlight period"}
                    />
                  )}
                  {granularity ? fmtBucketLabel(granularity, r.dim) : r.dim || "(not set)"}
                  {r.bDim && (
                    <span className="ml-2 text-xs text-ink/50">
                      vs {granularity ? fmtBucketLabel(granularity, r.bDim) : r.bDim}
                    </span>
                  )}
                </TD>
                {data.metrics.map((m, mi) => {
                  const type = data.metricHeaders[mi]?.type;
                  const a = r.a[mi] ?? 0;
                  const b = r.b?.[mi];
                  return hasCompare ? (
                    <FragmentCells key={m} a={a} b={b} type={type} currencyCode={data.currencyCode} invert={metricIsInverted(m)} />
                  ) : (
                    <TD key={m} className="px-4 py-2.5 text-right tabular-nums text-ink">
                      {fmtValue(a, type, data.currencyCode)}
                    </TD>
                  );
                })}
              </TR>
              );
            })
          )}
        </TBody>
      </Table>
    </div>
  );
}

function FragmentHeads() {
  return (
    <>
      <TH className="px-2 py-1.5 font-normal">Current</TH>
      <TH className="px-2 py-1.5 font-normal">Previous</TH>
      <TH className="px-2 py-1.5 font-normal">Δ</TH>
    </>
  );
}

function FragmentCells({
  a,
  b,
  type,
  currencyCode,
  invert,
}: {
  a: number;
  b?: number;
  type?: string;
  currencyCode?: string;
  invert?: boolean;
}) {
  return (
    <>
      <TD className="px-2 py-2.5 text-right tabular-nums text-ink">{fmtValue(a, type, currencyCode)}</TD>
      <TD className="px-2 py-2.5 text-right tabular-nums text-ink/50">
        {b === undefined ? "–" : fmtValue(b, type, currencyCode)}
      </TD>
      <TD className="px-2 py-2.5 text-right">
        <Delta value={deltaPct(a, b)} invert={invert} />
      </TD>
    </>
  );
}
