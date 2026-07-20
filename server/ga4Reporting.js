// GA4 reporting engine — ported from VC3/GA4-simply-layer's src/lib/ga4.ts.
// Adapted to reuse this app's existing `googleapis` + GoogleAuth pattern (see getGA4Auth()
// in index.js) instead of the source app's own google-auth-library/JWT + raw-fetch client —
// there should be exactly one way this app talks to GA4, not two. Every exported function
// here takes `auth` (the object getGA4Auth() returns) as its first argument.
//
// The one exception: runGa4FunnelReport must use a raw authenticated REST request. The
// installed googleapis client (verified directly against
// node_modules/googleapis/build/src/apis/analyticsdata/v1alpha.d.ts) has no typed method
// for v1alpha's runFunnelReport — only getMetadata/runReport exist there.
const { google } = require("googleapis");

const DATA_API_ALPHA = "https://analyticsdata.googleapis.com/v1alpha";

// ---------- date/bucket helpers ----------
// Ported from VC3's src/lib/dates.ts (only the subset runGa4Report's comparison-period
// alignment needs). Duplicated in frontend/src/lib/ga4Reports/dates.ts — server and
// frontend share no code in this repo, so keep both copies in sync by hand if either
// is ever bug-fixed.

function fmt(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function addDays(d, n) {
  const c = new Date(d);
  c.setDate(c.getDate() + n);
  return c;
}

function enumerateDates(start, end) {
  const out = [];
  let d = new Date(start + "T00:00:00");
  const endD = new Date(end + "T00:00:00");
  while (d.getTime() <= endD.getTime()) {
    out.push(fmt(d));
    d = addDays(d, 1);
  }
  return out;
}

function granularityDims(g) {
  if (g === "date") return ["date"];
  if (g === "isoWeek") return ["isoYear", "isoWeek"];
  return ["yearMonth"];
}

// Pure time series iff dims is EXACTLY one granularity's dim-set — that's the case where
// current/previous can be bucket-index aligned instead of only pairing on literal date match.
function detectGranularity(dims) {
  if (dims.length === 1 && dims[0] === "date") return "date";
  if (dims.length === 2 && dims[0] === "isoYear" && dims[1] === "isoWeek") return "isoWeek";
  if (dims.length === 1 && dims[0] === "yearMonth") return "month";
  return null;
}

// ISO 8601 week: Monday-start, week 1 = the week containing the year's first Thursday.
// Local-time arithmetic throughout, deliberately not Date.UTC — mixing UTC instants with
// local getters is how a bucket boundary silently shifts a day on a negative-UTC-offset host.
function isoWeekOf(d) {
  const date = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const dayNum = (date.getDay() + 6) % 7; // Mon=0 .. Sun=6
  date.setDate(date.getDate() - dayNum + 3); // now Thursday of this ISO week
  const isoYear = date.getFullYear();
  const jan4 = new Date(isoYear, 0, 4);
  const jan4DayNum = (jan4.getDay() + 6) % 7;
  const week1Monday = new Date(jan4);
  week1Monday.setDate(jan4.getDate() - jan4DayNum);
  const isoWeek = Math.round((date.getTime() - week1Monday.getTime()) / (7 * 86400000)) + 1;
  return { isoYear, isoWeek };
}

function isoWeekMonday(isoYear, isoWeek) {
  const jan4 = new Date(isoYear, 0, 4);
  const jan4DayNum = (jan4.getDay() + 6) % 7;
  const week1Monday = new Date(jan4);
  week1Monday.setDate(jan4.getDate() - jan4DayNum);
  return addDays(week1Monday, (isoWeek - 1) * 7);
}

function bucketKey(g, d) {
  if (g === "date") return fmt(d).replaceAll("-", "");
  if (g === "isoWeek") {
    const { isoYear, isoWeek } = isoWeekOf(d);
    return `${isoYear}${String(isoWeek).padStart(2, "0")}`;
  }
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}`;
}

// Every bucket (GA4's own key format) whose span overlaps [start, end], in chronological
// order — the canonical bucket sequence for a range, independent of which buckets GA4
// actually returned rows for (it drops empty ones via keepEmptyRows: false).
function enumerateBuckets(g, start, end) {
  if (g === "date") return enumerateDates(start, end).map((d) => d.replaceAll("-", ""));
  const startD = new Date(start + "T00:00:00");
  const endD = new Date(end + "T00:00:00");
  const seen = new Set();
  const out = [];
  if (g === "month") {
    let d = new Date(startD.getFullYear(), startD.getMonth(), 1);
    while (d.getTime() <= endD.getTime()) {
      const k = bucketKey(g, d);
      if (!seen.has(k)) {
        seen.add(k);
        out.push(k);
      }
      d = new Date(d.getFullYear(), d.getMonth() + 1, 1);
    }
    return out;
  }
  const { isoYear, isoWeek } = isoWeekOf(startD);
  let monday = isoWeekMonday(isoYear, isoWeek);
  while (monday.getTime() <= endD.getTime()) {
    const k = bucketKey(g, monday);
    if (!seen.has(k)) {
      seen.add(k);
      out.push(k);
    }
    monday = addDays(monday, 7);
  }
  return out;
}

// ---------- virtual-metric helpers ----------
// Ported from VC3's src/lib/types.ts. GA4 has no native "count of a specific event" or
// "conversion rate for event X" metric — these string-prefixed pseudo-metrics carry that
// intent through the report config; this module is where they get resolved into real queries.

const EVENT_METRIC_PREFIX = "event:";
const CONV_USER_PREFIX = "convu:";
const CONV_SESSION_PREFIX = "convs:";
const TYPE_RATE_PERCENT = "TYPE_RATE_PERCENT";

function isEventMetric(apiName) {
  return apiName.startsWith(EVENT_METRIC_PREFIX);
}
function eventMetricName(apiName) {
  return apiName.slice(EVENT_METRIC_PREFIX.length);
}
function makeEventMetric(eventName) {
  return `${EVENT_METRIC_PREFIX}${eventName}`;
}
function isConvRateMetric(apiName) {
  return apiName.startsWith(CONV_USER_PREFIX) || apiName.startsWith(CONV_SESSION_PREFIX);
}
function convRateDenom(apiName) {
  return apiName.startsWith(CONV_USER_PREFIX) ? "totalUsers" : "sessions";
}
function convRateEventName(apiName) {
  return apiName.slice(apiName.indexOf(":") + 1);
}

// ---------- GA4 Data API: filters ----------

const MATCH_MAP = {
  contains: "CONTAINS",
  exact: "EXACT",
  begins: "BEGINS_WITH",
  ends: "ENDS_WITH",
  // PARTIAL_REGEXP behaves like grep — matches anywhere in the value. (FULL_REGEXP
  // requires the regex to consume the entire string, which silently matches nothing
  // for the patterns people actually type.)
  regex: "PARTIAL_REGEXP",
};

function buildDimensionFilter(filters) {
  const clauses = (filters ?? []).filter((f) => f.field && f.value);
  if (!clauses.length) return undefined;
  const expressions = clauses.map((f) => {
    const filter = {
      filter: {
        fieldName: f.field,
        stringFilter: { matchType: MATCH_MAP[f.match] ?? "CONTAINS", value: f.value, caseSensitive: false },
      },
    };
    return f.not ? { notExpression: filter } : filter;
  });
  return expressions.length === 1 ? expressions[0] : { andGroup: { expressions } };
}

function buildEventNameInListFilter(names) {
  return { filter: { fieldName: "eventName", inListFilter: { values: names } } };
}

function combineFilters(...exprs) {
  const list = exprs.filter((e) => !!e);
  if (list.length === 0) return undefined;
  if (list.length === 1) return list[0];
  return { andGroup: { expressions: list } };
}

// Reads a row's bucket key in the SAME format enumerateBuckets/bucketKey produce
// ("202628", not "2026 · 28") — used wherever a row needs to match the canonical bucket
// sequence for its granularity, not the generic " · "-joined key for category dimensions.
function readGranularityKey(g, dvals, gIdxs) {
  if (g === "isoWeek") {
    const isoYear = dvals[gIdxs[0]]?.value ?? "";
    const isoWeek = (dvals[gIdxs[1]]?.value ?? "").padStart(2, "0");
    return `${isoYear}${isoWeek}`;
  }
  return dvals[gIdxs[0]]?.value ?? ""; // date and month: GA4's own value already matches
}

// GA4's own hard cap — not a limit this app imposes.
const GA4_METRIC_CAP = 10;

function chunkMetrics(metrics) {
  const out = [];
  for (let i = 0; i < metrics.length; i += GA4_METRIC_CAP) out.push(metrics.slice(i, i + GA4_METRIC_CAP));
  return out.length ? out : [[]];
}

// Restricts a later metric-chunk's query to exactly the dimension-value combinations the
// FIRST chunk's own sort+limit already chose — otherwise each chunk independently ranks
// rows by its own first metric and could return a different top-N row set, silently
// misaligning columns that are supposed to describe the same row.
function buildRowRestrictFilter(dims, dimValues) {
  if (!dimValues.length) return undefined;
  if (dims.length === 1) {
    return { filter: { fieldName: dims[0], inListFilter: { values: dimValues } } };
  }
  const expressions = dimValues.map((combo) => {
    const parts = combo.split(" · ");
    return {
      andGroup: {
        expressions: dims.map((d, i) => ({
          filter: { fieldName: d, stringFilter: { matchType: "EXACT", value: parts[i] ?? "", caseSensitive: true } },
        })),
      },
    };
  });
  return expressions.length === 1 ? expressions[0] : { orGroup: { expressions } };
}

// Column-concatenates N metric-chunk responses (same dims/ranges/filters, different
// metrics) into one. Rows are matched by dim+bDim key, not position — chunk 2+ may
// legitimately come back in a different row order than chunk 1 once a restrict filter
// is involved.
function mergeCoreReportChunks(first, rest) {
  const all = [first, ...rest];
  const hasCompare = !!first.totalsB;
  const restMaps = rest.map((c) => new Map(c.rows.map((r) => [`${r.dim} ${r.bDim ?? ""}`, r])));
  const rows = first.rows.map((r) => {
    const key = `${r.dim} ${r.bDim ?? ""}`;
    const a = [...r.a, ...rest.flatMap((c, i) => restMaps[i].get(key)?.a ?? c.metrics.map(() => 0))];
    const b = hasCompare
      ? [
          ...(r.b ?? r.a.map(() => 0)),
          ...rest.flatMap((c, i) => restMaps[i].get(key)?.b ?? restMaps[i].get(key)?.a ?? c.metrics.map(() => 0)),
        ]
      : undefined;
    return { dim: r.dim, bDim: r.bDim, a, b };
  });
  return {
    metrics: all.flatMap((c) => c.metrics),
    metricHeaders: all.flatMap((c) => c.metricHeaders),
    dimension: first.dimension,
    dimensions: first.dimensions,
    rows,
    totalsA: all.flatMap((c) => c.totalsA),
    totalsB: hasCompare ? all.flatMap((c) => c.totalsB ?? c.metrics.map(() => 0)) : undefined,
    rangeA: first.rangeA,
    rangeB: first.rangeB,
    rowCount: first.rowCount,
    currencyCode: first.currencyCode,
  };
}

// Core report fetch — assumes req.metrics are all real GA4 metric apiNames (event:*
// virtual metrics are resolved separately, see runEventPivot). Any number of metrics is
// supported: batches of GA4_METRIC_CAP run as separate requests and merge back into one.
async function runCoreReportChunk(auth, req, metricsChunk, dims, extraFilter) {
  const analyticsData = google.analyticsdata({ version: "v1beta", auth });
  const hasDim = dims.length > 0;
  const granularity = detectGranularity(dims);
  const isDateOnly = granularity !== null;
  const hasCompare = !!req.rangeB;
  const metrics = metricsChunk.map((m) => ({ name: m }));
  const dimensions = dims.map((d) => ({ name: d }));
  const dimensionFilter = combineFilters(buildDimensionFilter(req.filters), extraFilter);

  const requestBody = {
    dateRanges: hasCompare ? [req.rangeA, req.rangeB] : [req.rangeA],
    metrics,
    dimensions,
    // time series must never truncate mid-range; categorical rows honor the user limit
    limit: isDateOnly ? "10000" : String(Math.min(req.limit ?? 25, 1000) * (hasCompare ? 2 : 1)),
    metricAggregations: ["TOTAL"],
    keepEmptyRows: false,
  };
  if (dimensionFilter) requestBody.dimensionFilter = dimensionFilter;
  if (granularity) {
    requestBody.orderBys = granularityDims(granularity).map((d) => ({ dimension: { dimensionName: d } }));
  } else if (hasDim) {
    requestBody.orderBys = [{ metric: { metricName: metricsChunk[0] }, desc: true }];
  }

  const resp = await analyticsData.properties.runReport({ property: req.property, requestBody });
  const data = resp.data;

  const metricHeaders = (data.metricHeaders ?? []).map((h) => ({ name: h.name, type: h.type }));
  const dimHeaders = (data.dimensionHeaders ?? []).map((h) => h.name);
  // when 2 dateRanges are sent, GA4 appends a "dateRange" dimension
  const drIdx = dimHeaders.indexOf("dateRange");
  const dimIdxs = dims.map((d) => dimHeaders.indexOf(d)).filter((i) => i >= 0);

  const rowMap = new Map();
  const order = [];
  // day-aligned overlay only works for a pure date breakdown
  const isDateCompare = isDateOnly && hasCompare;
  const gIdxs = granularity ? granularityDims(granularity).map((d) => dimHeaders.indexOf(d)) : [];
  const seriesA = [];
  const seriesB = [];
  for (const r of data.rows ?? []) {
    const dvals = r.dimensionValues ?? [];
    const mets = (r.metricValues ?? []).map((v) => Number(v.value) || 0);
    const which = drIdx >= 0 ? dvals[drIdx]?.value ?? "date_range_0" : "date_range_0";
    if (isDateCompare) {
      const key = readGranularityKey(granularity, dvals, gIdxs);
      if (which === "date_range_0") seriesA.push({ dim: key, mets });
      else seriesB.push({ dim: key, mets });
      continue;
    }
    const dimVal = dimIdxs.length ? dimIdxs.map((idx) => dvals[idx]?.value ?? "").join(" · ") : "total";
    let row = rowMap.get(dimVal);
    if (!row) {
      row = { dim: dimVal, a: new Array(metrics.length).fill(0) };
      rowMap.set(dimVal, row);
      order.push(dimVal);
    }
    if (which === "date_range_0") row.a = mets;
    else row.b = mets;
  }
  if (isDateCompare) {
    // Canonical bucket-by-bucket enumeration — NOT "sort what GA4 returned and zip by
    // position." A bucket with genuinely zero of every requested metric is dropped
    // entirely by GA4 (keepEmptyRows:false), which desyncs a positional zip the moment
    // one side is short a bucket the other side has.
    const bucketsA = enumerateBuckets(granularity, req.rangeA.startDate, req.rangeA.endDate);
    const bucketsB = req.rangeB ? enumerateBuckets(granularity, req.rangeB.startDate, req.rangeB.endDate) : [];
    const valsA = new Map(seriesA.map((s) => [s.dim, s.mets]));
    const valsB = new Map(seriesB.map((s) => [s.dim, s.mets]));
    const n = Math.max(bucketsA.length, bucketsB.length);
    for (let i = 0; i < n; i++) {
      const kA = bucketsA[i];
      const kB = bucketsB[i];
      const key = kA ?? `b-${kB ?? i}`;
      rowMap.set(key, {
        dim: kA ?? "",
        bDim: kB,
        a: (kA ? valsA.get(kA) : undefined) ?? new Array(metrics.length).fill(0),
        b: kB ? valsB.get(kB) : undefined,
      });
      order.push(key);
    }
  }

  // totals per range
  let totalsA = new Array(metrics.length).fill(0);
  let totalsB = hasCompare ? new Array(metrics.length).fill(0) : undefined;
  const rawTotals = data.totals ?? [];
  if (rawTotals.length) {
    for (const t of rawTotals) {
      const tdims = t.dimensionValues ?? [];
      const mets = (t.metricValues ?? []).map((v) => Number(v.value) || 0);
      const which = drIdx >= 0 ? tdims[drIdx]?.value ?? "date_range_0" : "date_range_0";
      if (which === "date_range_0") totalsA = mets;
      else totalsB = mets;
    }
  } else {
    // fall back to summing rows
    for (const row of rowMap.values()) {
      row.a.forEach((v, i) => (totalsA[i] += v));
      if (row.b && totalsB) row.b.forEach((v, i) => (totalsB[i] += v));
    }
  }

  let rows = order.map((k) => rowMap.get(k));
  const limit = Math.min(req.limit ?? 25, 1000);
  if (isDateCompare) {
    // already aligned + ordered by bucket index
  } else if (isDateOnly) {
    rows = rows.sort((x, y) => x.dim.localeCompare(y.dim)); // never truncate a pure time series
  } else {
    rows = rows.sort((x, y) => (y.a[0] ?? 0) - (x.a[0] ?? 0)).slice(0, limit);
  }

  return {
    metrics: metricsChunk,
    metricHeaders,
    dimension: dims[0] ?? "",
    dimensions: dims,
    rows,
    totalsA,
    totalsB,
    rangeA: req.rangeA,
    rangeB: req.rangeB ?? null,
    rowCount: data.rowCount ?? rows.length,
    currencyCode: data.metadata?.currencyCode,
  };
}

async function runCoreReport(auth, req) {
  // GA4 caps dimensions at 9 per request; metrics are chunked below instead of capped.
  const dims = (req.dimensions ?? []).slice(0, 9);
  const chunks = chunkMetrics(req.metrics);
  const first = await runCoreReportChunk(auth, req, chunks[0], dims);
  if (chunks.length === 1) return first;

  const granularity = detectGranularity(dims);
  // categorical (non-time-series) breakdown: chunk 1's sort+limit picked a specific
  // top-N row set — pin every later chunk to that exact set.
  const needsRestrict = dims.length > 0 && !granularity;
  const restrictFilter = needsRestrict ? buildRowRestrictFilter(dims, first.rows.map((r) => r.dim)) : undefined;
  const rest = await Promise.all(chunks.slice(1).map((m) => runCoreReportChunk(auth, req, m, dims, restrictFilter)));
  return mergeCoreReportChunks(first, rest);
}

// Resolves N "event:*" virtual metrics into real GA4 data: one eventCount × eventName
// query (filtered to just the requested events), reshaped into N columns aligned with
// eventNames order. Keyed identically to how runCoreReport keys its own rows, so the
// two merge cleanly by dim.
async function runEventPivot(auth, opts) {
  const { property, dims, eventNames, rangeA, rangeB, filters, limit } = opts;
  const analyticsData = google.analyticsdata({ version: "v1beta", auth });
  const hasCompare = !!rangeB;
  const granularity = detectGranularity(dims);
  const isDateOnly = granularity !== null;
  const n = eventNames.length;
  const eventIndex = new Map(eventNames.map((name, i) => [name, i]));
  const blank = () => new Array(n).fill(0);

  const pivotDims = [...dims, "eventName"];
  const dimensionFilter = combineFilters(buildDimensionFilter(filters), buildEventNameInListFilter(eventNames));

  const requestBody = {
    dateRanges: hasCompare ? [rangeA, rangeB] : [rangeA],
    metrics: [{ name: "eventCount" }],
    dimensions: pivotDims.map((d) => ({ name: d })),
    limit: isDateOnly ? "10000" : String(Math.min(limit ?? 25, 1000) * (hasCompare ? 2 : 1) * Math.max(n, 1)),
    keepEmptyRows: false,
  };
  if (dimensionFilter) requestBody.dimensionFilter = dimensionFilter;
  if (granularity) requestBody.orderBys = granularityDims(granularity).map((d) => ({ dimension: { dimensionName: d } }));

  const resp = await analyticsData.properties.runReport({ property, requestBody });
  const data = resp.data;
  const dimHeaders = (data.dimensionHeaders ?? []).map((h) => h.name);
  const drIdx = dimHeaders.indexOf("dateRange");
  const evIdx = dimHeaders.indexOf("eventName");
  const restIdxs = dims.map((d) => dimHeaders.indexOf(d)).filter((i) => i >= 0);

  if (granularity && hasCompare) {
    // Canonical bucket-by-bucket enumeration, same reasoning as runCoreReportChunk —
    // once eventName joins the breakdown, buckets with zero of a given event are
    // genuinely absent (keepEmptyRows:false), not just zero-filled.
    const gIdxs = granularityDims(granularity).map((d) => dimHeaders.indexOf(d));
    const bucketsA = enumerateBuckets(granularity, rangeA.startDate, rangeA.endDate);
    const bucketsB = rangeB ? enumerateBuckets(granularity, rangeB.startDate, rangeB.endDate) : [];
    const valsA = new Map();
    const valsB = new Map();
    for (const r of data.rows ?? []) {
      const dvals = r.dimensionValues ?? [];
      const key = readGranularityKey(granularity, dvals, gIdxs);
      const ev = dvals[evIdx]?.value ?? "";
      const idx = eventIndex.get(ev);
      if (idx === undefined) continue;
      const count = Number(r.metricValues?.[0]?.value) || 0;
      const which = drIdx >= 0 ? dvals[drIdx]?.value ?? "date_range_0" : "date_range_0";
      const target = which === "date_range_0" ? valsA : valsB;
      const arr = target.get(key) ?? blank();
      arr[idx] = count;
      target.set(key, arr);
    }
    const len = Math.max(bucketsA.length, bucketsB.length);
    const rows = [];
    const totalsA = blank();
    const totalsB = hasCompare ? blank() : undefined;
    for (let i = 0; i < len; i++) {
      const kA = bucketsA[i];
      const kB = bucketsB[i];
      const a = kA ? valsA.get(kA) ?? blank() : blank();
      const b = kB ? valsB.get(kB) ?? blank() : undefined;
      a.forEach((v, k) => (totalsA[k] += v));
      b?.forEach((v, k) => (totalsB[k] += v));
      rows.push({ dim: kA ?? "", bDim: kB, a, b });
    }
    return { rows, totalsA, totalsB };
  }

  // Generic path: key by the report's real dims only (dropping eventName from the key)
  // — same convention runCoreReport's non-date-compare branch uses, so current/previous
  // pair up whenever the rest-of-dims literally match, and pivot rows merge with base
  // rows by identical dim string.
  const rowMap = new Map();
  const order = [];
  for (const r of data.rows ?? []) {
    const dvals = r.dimensionValues ?? [];
    const key = restIdxs.length ? restIdxs.map((idx) => dvals[idx]?.value ?? "").join(" · ") : "total";
    const ev = dvals[evIdx]?.value ?? "";
    const idx = eventIndex.get(ev);
    if (idx === undefined) continue;
    const count = Number(r.metricValues?.[0]?.value) || 0;
    const which = drIdx >= 0 ? dvals[drIdx]?.value ?? "date_range_0" : "date_range_0";
    let row = rowMap.get(key);
    if (!row) {
      row = { dim: key, a: blank(), b: hasCompare ? blank() : undefined };
      rowMap.set(key, row);
      order.push(key);
    }
    if (which === "date_range_0") row.a[idx] = count;
    else if (row.b) row.b[idx] = count;
  }

  let rows = order.map((k) => rowMap.get(k));
  const lim = Math.min(limit ?? 25, 1000);
  if (isDateOnly) {
    rows = rows.sort((x, y) => x.dim.localeCompare(y.dim)); // never truncate a pure time series
  } else {
    rows = rows.sort((x, y) => (y.a[0] ?? 0) - (x.a[0] ?? 0)).slice(0, lim);
  }

  const totalsA = blank();
  const totalsB = hasCompare ? blank() : undefined;
  for (const row of rows) {
    row.a.forEach((v, k) => (totalsA[k] += v));
    row.b?.forEach((v, k) => (totalsB[k] += v));
  }
  return { rows, totalsA, totalsB };
}

// Splices real-metric columns (runCoreReport), event-metric columns (runEventPivot), and
// conversion-rate columns (event count ÷ users or ÷ sessions) back into rawMetrics'
// original order. Rows union across all three sources by dim key — a row can legitimately
// appear in only one (e.g. traffic that day but zero of the chosen event still needs a
// row so the conversion rate reads 0% instead of silently vanishing).
function mergeReports(req, rawMetrics, realMetrics, eventNames, convRateMetrics, base, pivot, denom, dims) {
  const hasCompare = !!req.rangeB;
  const nTotal = rawMetrics.length;
  const blank = () => new Array(nTotal).fill(0);
  const realIdxInRaw = realMetrics.map((m) => rawMetrics.indexOf(m));
  const eventIdxInRaw = eventNames.map((name) => rawMetrics.indexOf(makeEventMetric(name)));
  // for each conv-rate metric: which pivot column (event) and which denom column
  // (0=totalUsers, 1=sessions) feeds it
  const convRateInfo = convRateMetrics.map((m) => ({
    rawI: rawMetrics.indexOf(m),
    eventIdx: eventNames.indexOf(convRateEventName(m)),
    denomIdx: convRateDenom(m) === "totalUsers" ? 0 : 1,
  }));

  const metricHeaders = rawMetrics.map((m) => {
    if (isConvRateMetric(m)) return { name: m, type: TYPE_RATE_PERCENT };
    if (isEventMetric(m)) return { name: m, type: "TYPE_INTEGER" };
    const i = realMetrics.indexOf(m);
    return base?.metricHeaders[i] ?? { name: m, type: "TYPE_INTEGER" };
  });

  const rowMap = new Map();
  const order = [];
  const ensureRow = (dim, bDim) => {
    let row = rowMap.get(dim);
    if (!row) {
      row = { dim, bDim, a: blank(), b: hasCompare ? blank() : undefined };
      rowMap.set(dim, row);
      order.push(dim);
    } else if (!row.bDim && bDim) {
      row.bDim = bDim;
    }
    return row;
  };

  if (base) {
    for (const r of base.rows) {
      const row = ensureRow(r.dim, r.bDim);
      realIdxInRaw.forEach((rawI, i) => {
        row.a[rawI] = r.a[i] ?? 0;
        if (row.b && r.b) row.b[rawI] = r.b[i] ?? 0;
      });
    }
  }
  if (pivot) {
    for (const r of pivot.rows) {
      const row = ensureRow(r.dim, r.bDim);
      eventIdxInRaw.forEach((rawI, i) => {
        row.a[rawI] = r.a[i] ?? 0;
        if (row.b && r.b) row.b[rawI] = r.b[i] ?? 0;
      });
    }
  }
  // denom rows aren't written into any column directly — read back out below by dim key
  // — but still need to exist in the row set so a day with traffic and zero of the event
  // reads 0%, not "missing".
  if (denom) {
    for (const r of denom.rows) ensureRow(r.dim, r.bDim);
  }

  const rateOf = (count, denomVal) => (denomVal && denomVal > 0 ? count / denomVal : 0);

  if (convRateInfo.length) {
    const denomByDim = new Map(denom?.rows.map((r) => [r.dim, r]) ?? []);
    const pivotByDim = new Map(pivot?.rows.map((r) => [r.dim, r]) ?? []);
    for (const dim of order) {
      const row = rowMap.get(dim);
      const pRow = pivotByDim.get(dim);
      const dRow = denomByDim.get(dim);
      for (const { rawI, eventIdx, denomIdx } of convRateInfo) {
        row.a[rawI] = rateOf(pRow?.a[eventIdx] ?? 0, dRow?.a[denomIdx]);
        if (row.b) row.b[rawI] = rateOf(pRow?.b?.[eventIdx] ?? 0, dRow?.b?.[denomIdx]);
      }
    }
  }

  const totalsA = blank();
  const totalsB = hasCompare ? blank() : undefined;
  if (base) {
    realIdxInRaw.forEach((rawI, i) => {
      totalsA[rawI] = base.totalsA[i] ?? 0;
      if (totalsB && base.totalsB) totalsB[rawI] = base.totalsB[i] ?? 0;
    });
  }
  if (pivot) {
    eventIdxInRaw.forEach((rawI, i) => {
      totalsA[rawI] = pivot.totalsA[i] ?? 0;
      if (totalsB && pivot.totalsB) totalsB[rawI] = pivot.totalsB[i] ?? 0;
    });
  }
  // conversion-rate totals are always totals-over-totals, never an average of the
  // per-row rates above (one anomalous day would otherwise skew a week's aggregate rate).
  for (const { rawI, eventIdx, denomIdx } of convRateInfo) {
    totalsA[rawI] = pivot && denom ? rateOf(pivot.totalsA[eventIdx] ?? 0, denom.totalsA[denomIdx]) : 0;
    if (totalsB && pivot?.totalsB && denom?.totalsB) {
      totalsB[rawI] = rateOf(pivot.totalsB[eventIdx] ?? 0, denom.totalsB[denomIdx]);
    }
  }

  return {
    metrics: rawMetrics,
    metricHeaders,
    dimension: dims[0] ?? "",
    dimensions: dims,
    rows: order.map((k) => rowMap.get(k)),
    totalsA,
    totalsB,
    rangeA: req.rangeA,
    rangeB: req.rangeB ?? null,
    rowCount: order.length,
    currencyCode: base?.currencyCode ?? denom?.currencyCode,
  };
}

// Public entry point. Splits three kinds of metric out of req.metrics: real GA4
// apiNames, `event:*` virtual metrics, and `convu:*`/`convs:*` virtual metrics. Each kind
// runs as its own query — sharing one pivot call across every event:/conv: metric
// referencing the same event — then everything merges back into the caller's original
// metric order.
//
// req shape: { property, dimensions: string[], metrics: string[], rangeA, rangeB?,
// filters?, limit? } — always pass `dimensions` (no legacy singular `dimension` field
// in this app's report model).
async function runGa4Report(auth, req) {
  const rawMetrics = req.metrics;
  const realMetrics = rawMetrics.filter((m) => !isEventMetric(m) && !isConvRateMetric(m));
  const convRateMetrics = rawMetrics.filter(isConvRateMetric);
  const eventNames = [
    ...new Set([
      ...rawMetrics.filter(isEventMetric).map(eventMetricName),
      ...convRateMetrics.map(convRateEventName),
    ]),
  ];
  const needsDenom = convRateMetrics.length > 0;

  if (eventNames.length === 0 && !needsDenom) {
    return runCoreReport(auth, { ...req, metrics: realMetrics });
  }

  const dims = (req.dimensions ?? []).slice(0, 9);
  const denomMetrics = ["totalUsers", "sessions"];
  const [base, pivot, denom] = await Promise.all([
    realMetrics.length > 0 ? runCoreReport(auth, { ...req, metrics: realMetrics }) : Promise.resolve(null),
    eventNames.length > 0
      ? runEventPivot(auth, {
          property: req.property,
          dims,
          eventNames,
          rangeA: req.rangeA,
          rangeB: req.rangeB,
          filters: req.filters,
          limit: req.limit,
        })
      : Promise.resolve(null),
    needsDenom ? runCoreReport(auth, { ...req, metrics: denomMetrics }) : Promise.resolve(null),
  ]);

  return mergeReports(req, rawMetrics, realMetrics, eventNames, convRateMetrics, base, pivot, denom, dims);
}

async function listGa4Properties(auth) {
  const analyticsAdmin = google.analyticsadmin({ version: "v1alpha", auth });
  const out = [];
  let pageToken;
  do {
    const resp = await analyticsAdmin.accountSummaries.list({
      pageSize: 200,
      ...(pageToken ? { pageToken } : {}),
    });
    for (const acc of resp.data.accountSummaries ?? []) {
      for (const p of acc.propertySummaries ?? []) {
        out.push({
          property: p.property,
          displayName: p.displayName,
          account: acc.account,
          accountName: acc.displayName,
        });
      }
    }
    pageToken = resp.data.nextPageToken;
  } while (pageToken);
  return out;
}

async function getGa4Metadata(auth, property) {
  const analyticsData = google.analyticsdata({ version: "v1beta", auth });
  const resp = await analyticsData.properties.getMetadata({ name: `${property}/metadata` });
  const data = resp.data;
  const map = (items) =>
    (items ?? []).map((i) => ({
      apiName: i.apiName,
      uiName: i.uiName,
      category: i.category || (i.customDefinition ? "Custom" : "Other"),
      description: i.description,
    }));
  return { dimensions: map(data.dimensions), metrics: map(data.metrics) };
}

// Runs a funnel through GA4's own funnel engine (v1alpha runFunnelReport) — step
// sequencing, user dedup, and open/closed semantics all happen server-side at Google. We
// only read back active users per step and derive the two completion rates.
//
// See the module header: this is the one call that must go through a raw authenticated
// REST request rather than a typed googleapis method.
async function runGa4FunnelReport(auth, property, funnel, range) {
  const steps = funnel.steps.filter((s) => s.eventName).slice(0, 10);
  if (steps.length < 2) return { steps: [] };

  const PAGE_MATCH = { exact: "EXACT", contains: "CONTAINS", begins: "BEGINS_WITH" };
  // a step is its event, optionally ANDed with "…and it happened on this page".
  // unifiedPagePathScreen is the page path without query string (plain pagePath is
  // rejected by this endpoint), so exact "/" matches the homepage even with UTM params.
  const stepExpression = (s) => {
    const eventExpr = { funnelEventFilter: { eventName: s.eventName } };
    if (!s.pagePath || !s.pageMatch || !PAGE_MATCH[s.pageMatch]) return eventExpr;
    return {
      andGroup: {
        expressions: [
          eventExpr,
          {
            funnelFieldFilter: {
              fieldName: "unifiedPagePathScreen",
              stringFilter: { matchType: PAGE_MATCH[s.pageMatch], value: s.pagePath, caseSensitive: false },
            },
          },
        ],
      },
    };
  };

  const body = {
    dateRanges: [{ startDate: range.startDate, endDate: range.endDate }],
    funnel: {
      isOpenFunnel: funnel.open,
      steps: steps.map((s) => ({ name: s.label || s.eventName, filterExpression: stepExpression(s) })),
    },
  };

  const client = await auth.getClient();
  const resp = await client.request({
    url: `${DATA_API_ALPHA}/${property}:runFunnelReport`,
    method: "POST",
    data: body,
  });
  const data = resp.data;

  // funnelTable rows: one per step (dimension "1. <name>"), metric activeUsers. Parse
  // defensively by leading step number since no extra grouping dimensions are requested.
  const users = new Array(steps.length).fill(0);
  for (const row of data.funnelTable?.rows ?? []) {
    const dim = row.dimensionValues?.[0]?.value ?? "";
    const idx = Number(dim.split(".")[0]) - 1;
    if (!Number.isInteger(idx) || idx < 0 || idx >= steps.length) continue;
    users[idx] = Math.max(users[idx], Number(row.metricValues?.[0]?.value ?? 0));
  }

  return {
    steps: steps.map((s, i) => ({
      label: s.label || s.eventName,
      users: users[i],
      rateFromFirst: i === 0 ? null : users[0] > 0 ? users[i] / users[0] : null,
      rateFromPrevious: i === 0 ? null : users[i - 1] > 0 ? users[i] / users[i - 1] : null,
    })),
  };
}

module.exports = {
  listGa4Properties,
  getGa4Metadata,
  runGa4Report,
  runGa4FunnelReport,
};
