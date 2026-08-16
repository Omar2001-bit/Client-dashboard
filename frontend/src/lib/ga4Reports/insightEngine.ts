// Rule-based analytics engine — no LLM at runtime. Ported from
// VC3/GA4-simply-layer's src/lib/insightEngine.ts, where every rule was derived by
// analyzing real 28-day e-commerce data from this stack (traffic collapse + AOV rise +
// funnel tracking change + paid-social quality drop), then generalized with guards so it
// degrades safely on reports that lack the metrics a rule needs. Rules only fire when
// their inputs exist.
//
// Copy style: every insight is written for the CLIENT (a shop owner, not an analyst) — a
// plain-language headline first, the numbers as supporting detail, and metric names
// translated to everyday words (sessions → "store visits"). No "decomposed", no "pp", no apiNames.
//
// Deviates from the source in one way: metricLabel is imported from ./metricLabels (a lib
// module) instead of a UI component file, and analyzeReport() takes the label resolver as
// an optional parameter instead of importing it directly — the source's own documented
// architectural wart (a lib file reaching into the component tree) is fixed here at the
// point it's introduced, not carried forward.
import { metricLabel as defaultMetricLabel } from "./metricLabels";
import { deltaPct, fmtValue, humanizeEvent } from "./format";
import {
  convRateDenom,
  convRateEventName,
  isConvRateMetric,
  isEventMetric,
  eventMetricName,
  metricIsInverted,
  type MetaItem,
  type ReportResponse,
} from "./types";

export type InsightSeverity = "critical" | "warning" | "good" | "info";

export interface EngineInsight {
  id: string; // stable across date-range changes so a dragged position survives
  severity: InsightSeverity;
  category: "traffic" | "conversion" | "revenue" | "funnel" | "behavior" | "quality" | "trend" | "benchmark";
  title: string; // plain-language headline a client can scan
  text: string; // supporting detail with the actual numbers
  recommendation?: string; // what to do about it, when the finding implies an action
  score: number; // ordering weight — bigger = earlier
}

export type LabelResolver = (apiName: string, meta?: MetaItem[]) => string;

// ---- guards (all derived from real failure modes seen in the data) ----

/** A +5500% delta on a previous value of 1 is noise, not news. */
const MIN_PREV_BASE = 30;
/** Rates on denominators under this are meaningless (13-session channels showing 7.7% CVR). */
const MIN_DENOMINATOR = 100;

const pctText = (d: number) => `${d > 0 ? "up" : "down"} ${Math.abs(d).toFixed(1)}%`;
const pp = (x: number) => `${(x * 100).toFixed(1)}%`;
const per100 = (x: number) => Math.round(x * 100);

/** Everyday-language names for the metrics clients see most. */
function plainLabel(apiName: string, meta: MetaItem[] | undefined, resolveLabel: LabelResolver): string {
  const FIXED: Record<string, string> = {
    sessions: "Store visits",
    totalUsers: "Visitors",
    newUsers: "First-time visitors",
    engagementRate: "Share of engaged visits",
    purchaseRevenue: "Revenue",
    averagePurchaseRevenue: "Average order value",
    averageRevenuePerUser: "Revenue per visitor",
  };
  if (FIXED[apiName]) return FIXED[apiName];
  if (isEventMetric(apiName)) return `"${humanizeEvent(eventMetricName(apiName))}" actions`;
  if (isConvRateMetric(apiName)) {
    const ev = humanizeEvent(convRateEventName(apiName));
    return convRateDenom(apiName) === "sessions"
      ? `Share of visits with "${ev}"`
      : `Share of visitors with "${ev}"`;
  }
  return resolveLabel(apiName, meta);
}

/** "20260630" → "Jun 30" — dates clients can read at a glance. */
function fmtDay(key: string): string {
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const m = Number(key.slice(4, 6));
  return `${MONTHS[m - 1] ?? "?"} ${Number(key.slice(6, 8))}`;
}

interface Ctx {
  data: ReportResponse;
  meta?: MetaItem[];
  resolveLabel: LabelResolver;
  out: EngineInsight[];
  cur: (name: string) => number | null;
  prev: (name: string) => number | null;
  has: (name: string) => boolean;
  label: (name: string) => string;
  money: (v: number) => string;
  hasCompare: boolean;
}

function findMetric(data: ReportResponse, name: string): number {
  return data.metrics.indexOf(name);
}

/** The e-commerce event sequence, in journey order. A report only needs a subset — rules
 *  use whichever consecutive pair actually exists. view_cart is deliberately NOT a gate:
 *  drawer-based shops legitimately skip it (observed: begin_checkout 2.5x view_cart on a
 *  drawer-checkout store). */
const ECOM_SEQUENCE = ["add_to_cart", "begin_checkout", "add_shipping_info", "add_payment_info", "purchase"];

// [plural verb phrase ("shoppers who ___"), place name ("reach ___")]
const STEP_PLAIN: Record<string, [string, string]> = {
  add_to_cart: ["add something to the cart", "the cart"],
  begin_checkout: ["start checkout", "checkout"],
  add_shipping_info: ["enter shipping details", "the shipping step"],
  add_payment_info: ["enter payment details", "the payment step"],
  purchase: ["complete the purchase", "the purchase"],
};

const STEP_CRO: Record<string, string> = {
  "add_to_cart→begin_checkout":
    "This is where carts die. Show shipping costs inside the cart so there are no surprises later, add a free-shipping progress bar, and set up abandoned-cart reminders (email, SMS, or WhatsApp).",
  "begin_checkout→add_shipping_info":
    "Make the checkout form shorter: fewer fields, address autocomplete, guest checkout, and error messages that appear next to the field instead of after submitting.",
  "add_shipping_info→add_payment_info":
    "This drop usually means cost shock or a missing payment option: show the full total earlier, add locally-preferred payment methods (wallets, cash on delivery), and put trust badges near the total.",
  "add_payment_info→purchase":
    "Failures this late are often technical: check for payment errors and declines, card-verification friction, and make sure the final order button is obvious after entering payment.",
};

// ---- rules ----

/** Purchases = visits x visit-to-purchase rate. Telling the client whether to fix
 *  marketing (traffic) or the store itself is the single most decision-changing split in
 *  the whole report. */
function ruleConversionDecomposition(c: Ctx) {
  if (!c.hasCompare) return;
  const sA = c.cur("sessions");
  const sB = c.prev("sessions");
  const pA = c.cur("event:purchase");
  const pB = c.prev("event:purchase");
  if (sA === null || !sB || pA === null || !pB || pB < MIN_PREV_BASE || sB < MIN_DENOMINATOR) return;
  const dP = pA / pB;
  const dS = sA / sB;
  if (dP <= 0 || dS <= 0) return;
  const purchDelta = (dP - 1) * 100;
  if (Math.abs(purchDelta) < 10) return;
  const lnP = Math.log(dP);
  const trafficShare = Math.abs(lnP) > 1e-6 ? Math.log(dS) / lnP : 0;
  // Only trust the log-ratio magnitude as "traffic is the dominant cause" when traffic
  // and purchases actually moved the same direction — when they move opposite ways,
  // traffic mathematically can't be why purchases changed (it pulled the other way),
  // so conversion rate is the correct attribution regardless of the ratio's magnitude.
  const sameDirection = (dS >= 1) === (dP >= 1);
  const trafficDominant = sameDirection && Math.abs(trafficShare) >= 0.5;
  const cvrDelta = (dP / dS - 1) * 100;
  const sessDelta = (dS - 1) * 100;
  const down = purchDelta < 0;

  const title = down
    ? trafficDominant
      ? "Sales fell mostly because fewer people visited the store"
      : "Sales fell mostly because visitors bought less often, not because traffic dropped"
    : trafficDominant
      ? "Sales grew mostly because more people visited the store"
      : "Sales grew mostly because visitors bought more often";
  const text = `Sales are ${pctText(purchDelta)} (${fmtValue(pA, "TYPE_INTEGER")} vs ${fmtValue(pB, "TYPE_INTEGER")} last period). Store visits are ${pctText(sessDelta)}, and the share of visits that end in a purchase is ${pctText(cvrDelta)}.`;
  const recommendation = !down
    ? undefined
    : trafficDominant
      ? cvrDelta >= 0
        ? "The store itself is converting as well as before or better — the priority is bringing visitors back (check paused, fatigued, or under-funded campaigns), not redesigning the site."
        : "Both traffic and buying rate fell. Restore traffic first — it's the bigger lever — then work on the checkout leaks below."
      : "Traffic is holding up — the store itself is converting worse. Focus on the funnel leak flagged below before spending more on ads.";
  c.out.push({
    id: "decomp:purchases",
    severity: down ? "critical" : "good",
    category: "conversion",
    title,
    text,
    recommendation,
    score: 100 + Math.abs(purchDelta),
  });
}

/** Revenue = order count x average order value — and whether AOV cushioned or amplified
 *  the move (observed: -61% orders softened to -52% revenue by +20% AOV). */
function ruleRevenueDecomposition(c: Ctx) {
  if (!c.hasCompare) return;
  const rA = c.cur("purchaseRevenue");
  const rB = c.prev("purchaseRevenue");
  const aovA = c.cur("averagePurchaseRevenue");
  const aovB = c.prev("averagePurchaseRevenue");
  const pA = c.cur("event:purchase");
  const pB = c.prev("event:purchase");
  if (rA === null || !rB || aovA === null || !aovB || pA === null || !pB || pB < MIN_PREV_BASE) return;
  const revDelta = ((rA - rB) / rB) * 100;
  const aovDelta = ((aovA - aovB) / aovB) * 100;
  const purchDelta = ((pA - pB) / pB) * 100;
  if (Math.abs(revDelta) < 10) return;
  const down = revDelta < 0;
  const cushioned = Math.sign(aovDelta) !== Math.sign(purchDelta) && Math.abs(aovDelta) > 5;
  const title = down
    ? cushioned && aovDelta > 0
      ? "Revenue fell with order count — but bigger orders softened the blow"
      : "Revenue fell"
    : cushioned && aovDelta < 0
      ? "Revenue grew on order volume, even though the average order shrank"
      : "Revenue grew";
  c.out.push({
    id: "decomp:revenue",
    severity: down ? "critical" : "good",
    category: "revenue",
    title,
    text: `Revenue is ${pctText(revDelta)} (${c.money(rA)} vs ${c.money(rB)} last period). Order count is ${pctText(purchDelta)}, and the average order value is ${pctText(aovDelta)} (${c.money(aovA)} vs ${c.money(aovB)}).`,
    recommendation:
      down && aovDelta > 5
        ? "Customers who do buy are spending more, so pricing is healthy. The problem to solve is order volume, not upsells."
        : down && aovDelta < -5
          ? "Both order count and order size are shrinking. Review discount depth and which products are being pushed — bundles and free-shipping thresholds can pull order value back up."
          : undefined,
    score: 95 + Math.abs(revDelta),
  });
}

/** Event-count funnel: where shoppers give up between journey steps, bottleneck +
 *  regressions, each with a step-specific action. */
function ruleFunnelSteps(c: Ctx) {
  const present = ECOM_SEQUENCE.filter((e) => c.has(`event:${e}`));
  if (present.length < 2) return;

  let worstRate = Infinity;
  let worstPair = "";
  let worstFrom = "";
  let worstTo = "";
  let worstDetail = "";
  for (let i = 1; i < present.length; i++) {
    const fromEv = present[i - 1];
    const toEv = present[i];
    const fromA = c.cur(`event:${fromEv}`);
    const toA = c.cur(`event:${toEv}`);
    if (!fromA || fromA < MIN_DENOMINATOR || toA === null) continue;
    const rate = toA / fromA;
    if (rate < worstRate) {
      worstRate = rate;
      worstPair = `${fromEv}→${toEv}`;
      worstFrom = fromEv;
      worstTo = toEv;
      worstDetail = `Out of ${fmtValue(fromA, "TYPE_INTEGER")} times shoppers ${STEP_PLAIN[fromEv]?.[0] ?? fromEv}, only ${fmtValue(toA, "TYPE_INTEGER")} (${pp(rate)}) went on to ${STEP_PLAIN[toEv]?.[1] ?? toEv} — ${fmtValue(fromA - toA, "TYPE_INTEGER")} were lost at this step.`;
    }

    if (c.hasCompare) {
      const fromB = c.prev(`event:${fromEv}`);
      const toB = c.prev(`event:${toEv}`);
      if (fromB && fromB >= MIN_DENOMINATOR && toB !== null) {
        const prevRate = toB / fromB;
        const ppChange = (rate - prevRate) * 100;
        // a >20-point swing on one step while neighbors hold is a tracking-change
        // signature, not user behavior (observed: 39% → 98% overnight)
        if (Math.abs(ppChange) > 20) {
          c.out.push({
            id: `funnel:trackshift:${toEv}`,
            severity: "warning",
            category: "quality",
            title: "One funnel step changed too much to be real shopper behavior",
            text: `The share of shoppers moving from ${STEP_PLAIN[fromEv]?.[1] ?? fromEv} to ${STEP_PLAIN[toEv]?.[1] ?? toEv} jumped from ${pp(prevRate)} to ${pp(rate)}. Swings this big usually mean the tracking or the checkout flow itself was changed — worth verifying before reading it as a win or a loss.`,
            score: 60 + Math.abs(ppChange) / 2,
          });
        } else if (ppChange < -5) {
          c.out.push({
            id: `funnel:regress:${toEv}`,
            severity: "critical",
            category: "funnel",
            title: `Fewer shoppers are making it from ${STEP_PLAIN[fromEv]?.[1] ?? fromEv} to ${STEP_PLAIN[toEv]?.[1] ?? toEv} than before`,
            text: `${pp(rate)} of shoppers continue past this step now, down from ${pp(prevRate)} last period.`,
            recommendation: STEP_CRO[`${fromEv}→${toEv}`],
            score: 85 + Math.abs(ppChange),
          });
        } else if (ppChange > 5) {
          c.out.push({
            id: `funnel:improve:${toEv}`,
            severity: "good",
            category: "funnel",
            title: `More shoppers are making it from ${STEP_PLAIN[fromEv]?.[1] ?? fromEv} to ${STEP_PLAIN[toEv]?.[1] ?? toEv}`,
            text: `${pp(rate)} of shoppers continue past this step now, up from ${pp(prevRate)} last period.`,
            score: 40 + ppChange,
          });
        }
      }
    }
  }

  if (worstPair && worstRate < 0.75) {
    c.out.push({
      id: "funnel:bottleneck",
      severity: worstRate < 0.5 ? "critical" : "warning",
      category: "funnel",
      title: `The biggest leak: shoppers who ${STEP_PLAIN[worstFrom]?.[0] ?? worstFrom} rarely reach ${STEP_PLAIN[worstTo]?.[1] ?? worstTo}`,
      text: `${worstDetail} No other step loses more potential buyers.`,
      recommendation: STEP_CRO[worstPair],
      score: 90 + (1 - worstRate) * 40,
    });
  }
}

/** remove_from_cart : add_to_cart ratio — second-thoughts signal. */
function ruleCartRemoval(c: Ctx) {
  const addA = c.cur("event:add_to_cart");
  const remA = c.cur("event:remove_from_cart");
  if (!addA || addA < MIN_DENOMINATOR || remA === null) return;
  const ratioA = remA / addA;
  let trendPart = "";
  let regressed = false;
  if (c.hasCompare) {
    const addB = c.prev("event:add_to_cart");
    const remB = c.prev("event:remove_from_cart");
    if (addB && addB >= MIN_DENOMINATOR && remB !== null) {
      const ratioB = remB / addB;
      if (Math.abs((ratioA - ratioB) * 100) >= 2) {
        regressed = ratioA > ratioB;
        trendPart = ` — ${regressed ? "up from" : "down from"} ${per100(ratioB)} last period`;
      }
    }
  }
  if (ratioA < 0.15 && !regressed) return;
  c.out.push({
    id: "behavior:cart-removal",
    severity: regressed ? "warning" : "info",
    category: "behavior",
    title: regressed ? "More shoppers are having second thoughts in the cart" : "A notable share of cart items get removed again",
    text: `For every 100 items added to the cart, about ${per100(ratioA)} get taken out again${trendPart}.`,
    recommendation: regressed
      ? "Rising removals usually mean price hesitation. Show the free-shipping threshold in the cart, anchor prices against a compare-at value, and consider a gentle save-for-later or small-incentive prompt when items are removed."
      : undefined,
    score: regressed ? 55 : 20,
  });
}

/** Engagement collapse alongside a traffic drop = the traffic got worse, not the site
 *  (observed: 87% → 46%, driven by the dominant paid channel). */
function ruleTrafficQuality(c: Ctx) {
  if (!c.hasCompare) return;
  const eA = c.cur("engagementRate");
  const eB = c.prev("engagementRate");
  if (eA === null || !eB) return;
  const drop = ((eA - eB) / eB) * 100;
  if (drop > -20) return;
  c.out.push({
    id: "traffic:quality",
    severity: "critical",
    category: "traffic",
    title: "The visitors arriving lately are far less interested than before",
    text: `Only ${pp(eA)} of visits show real engagement now, down from ${pp(eB)} last period (${pctText(drop)}). A shift this size almost always comes from the traffic itself — who the ads are reaching — not from anything that changed on the site.`,
    recommendation:
      "Break this report down by channel to find the source. It's usually one big ad channel whose targeting or creative has worn out: refresh the creatives, tighten the audiences, and make sure the ad's promise matches the landing page.",
    score: 80 + Math.abs(drop) / 2,
  });
}

/** New visitors flat while total visitors collapse = the returning base vanished
 *  (observed: totalUsers -42% with newUsers +3%). */
function ruleReturningUsers(c: Ctx) {
  if (!c.hasCompare) return;
  const tA = c.cur("totalUsers");
  const tB = c.prev("totalUsers");
  const nA = c.cur("newUsers");
  const nB = c.prev("newUsers");
  if (tA === null || !tB || nA === null || !nB || tB < MIN_DENOMINATOR) return;
  if (nA > tA) {
    c.out.push({
      id: "quality:newusers-anomaly",
      severity: "info",
      category: "quality",
      title: "A measurement quirk: more “new visitors” than visitors in total",
      text: `Google Analytics counted ${fmtValue(nA, "TYPE_INTEGER")} first-time visitors but only ${fmtValue(tA, "TYPE_INTEGER")} visitors overall. This happens with consent banners, bot filtering, or people switching devices — treat new-vs-returning numbers on this property as approximate.`,
      score: 15,
    });
  }
  const tDelta = ((tA - tB) / tB) * 100;
  const nDelta = ((nA - nB) / nB) * 100;
  if (tDelta < -20 && nDelta > -5) {
    c.out.push({
      id: "traffic:returning-collapse",
      severity: "warning",
      category: "traffic",
      title: "Past customers stopped coming back — new-visitor flow is fine",
      text: `Visitors overall are ${pctText(tDelta)}, yet first-time visitors held steady (${pctText(nDelta)}). The missing people are the ones who had visited before.`,
      recommendation:
        "Give past visitors a reason to return: remarketing audiences, email/SMS win-back campaigns, restock alerts, or loyalty points. Returning visitors typically buy at several times the rate of cold traffic.",
      score: 65 + Math.abs(tDelta) / 2,
    });
  }
}

/** Daily-series rules: spikes/dips with a quality verdict, momentum, losing streaks, best
 *  revenue day, weekday-vs-weekend pattern. */
function ruleDailyPatterns(c: Ctx) {
  const { data } = c;
  const dims = data.dimensions;
  if (dims[0] !== "date" || data.rows.length < 10) return;
  const si = findMetric(data, "sessions");
  if (si === -1) return;
  // ignore a trailing partial bucket (today) — it always reads as a cliff
  const today = new Date();
  const todayKey = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, "0")}${String(today.getDate()).padStart(2, "0")}`;
  const rows = data.rows.filter((r) => r.dim !== todayKey);
  if (rows.length < 10) return;

  const sessions = rows.map((r) => r.a[si] ?? 0);
  const median = [...sessions].sort((a, b) => a - b)[Math.floor(sessions.length / 2)];
  if (median < 50) return;

  const pi = data.metrics.findIndex(
    (m) => m === "event:purchase" || (isConvRateMetric(m) && convRateEventName(m) === "purchase" && convRateDenom(m) === "sessions")
  );
  const cvrOf = (r: (typeof rows)[number]) => {
    if (pi === -1 || !r.a[si]) return null;
    const v = r.a[pi] ?? 0;
    return data.metrics[pi] === "event:purchase" ? v / r.a[si] : v;
  };
  const cvrs = rows.map(cvrOf).filter((x): x is number => x !== null);
  const medianCvr = cvrs.length ? [...cvrs].sort((a, b) => a - b)[Math.floor(cvrs.length / 2)] : null;

  // spike/dip days with a quality verdict
  for (const r of rows) {
    const s = r.a[si] ?? 0;
    if (s > median * 2.2) {
      const dayCvr = cvrOf(r);
      const lowQuality = dayCvr !== null && medianCvr !== null && dayCvr < medianCvr * 0.7;
      c.out.push({
        id: `trend:spike:${r.dim}`,
        severity: lowQuality ? "warning" : "info",
        category: "trend",
        title: lowQuality
          ? `The ${fmtDay(r.dim)} traffic spike didn't bring real shoppers`
          : `${fmtDay(r.dim)} was an unusually big traffic day`,
        text: `${fmtDay(r.dim)} brought ${fmtValue(s, "TYPE_INTEGER")} visits — ${(s / median).toFixed(1)}× a normal day${
          lowQuality ? " — but those visitors bought at roughly half the usual rate" : ""
        }.`,
        recommendation: lowQuality
          ? "For big campaign pushes, make sure the landing page matches the ad's promise and the ad pre-qualifies the audience — raw volume without intent just waters down results."
          : undefined,
        score: 45,
      });
    }
  }

  // momentum: second half vs first half of the period
  const half = Math.floor(rows.length / 2);
  const sum = (arr: number[]) => arr.reduce((a, b) => a + b, 0);
  const firstS = sum(sessions.slice(0, half)) / half;
  const secondS = sum(sessions.slice(rows.length - half)) / half;
  const momo = ((secondS - firstS) / firstS) * 100;
  if (Math.abs(momo) > 20 && firstS > 50) {
    let cvrPart = "";
    if (medianCvr !== null && cvrs.length === rows.length) {
      const firstC = sum(cvrs.slice(0, half)) / half;
      const secondC = sum(cvrs.slice(rows.length - half)) / half;
      const cMomo = firstC > 0 ? ((secondC - firstC) / firstC) * 100 : 0;
      if (Math.sign(cMomo) !== Math.sign(momo) && Math.abs(cMomo) > 10) {
        cvrPart =
          momo < 0
            ? " The visitors who remain are actually buying at a better rate — the traffic that disappeared was the least valuable."
            : " But the buying rate is slipping as traffic grows — the new traffic converts worse.";
      }
    }
    c.out.push({
      id: "trend:momentum",
      severity: momo < 0 ? "warning" : "good",
      category: "trend",
      title: momo < 0 ? "Traffic is still sliding within this period" : "Traffic is building within this period",
      text: `Recent days average ${fmtValue(Math.round(secondS), "TYPE_INTEGER")} visits vs ${fmtValue(Math.round(firstS), "TYPE_INTEGER")} earlier in the period (${pctText(momo)}).${cvrPart}`,
      score: 50 + Math.abs(momo) / 4,
    });
  }

  // losing streak: consecutive declining days at the end of the period
  let streak = 0;
  for (let i = sessions.length - 1; i > 0 && sessions[i] < sessions[i - 1]; i--) streak++;
  if (streak >= 5) {
    c.out.push({
      id: "trend:streak",
      severity: "warning",
      category: "trend",
      title: `Visits have now fallen ${streak} days in a row`,
      text: `Each of the last ${streak} days brought fewer visits than the day before — worth checking whether campaigns are winding down or budgets ran out.`,
      score: 62,
    });
  }

  // best revenue day + its share of the period
  const ri = findMetric(data, "purchaseRevenue");
  if (ri !== -1) {
    const totalRev = rows.reduce((s, r) => s + (r.a[ri] ?? 0), 0);
    const best = rows.reduce((a, b) => ((b.a[ri] ?? 0) > (a.a[ri] ?? 0) ? b : a));
    const bestRev = best.a[ri] ?? 0;
    if (totalRev > 0 && bestRev > 0) {
      c.out.push({
        id: "trend:best-day",
        severity: "info",
        category: "revenue",
        title: `Your best sales day was ${fmtDay(best.dim)}`,
        text: `${fmtDay(best.dim)} brought in ${c.money(bestRev)} — ${pp(bestRev / totalRev)} of the whole period's revenue.`,
        score: 22,
      });
    }
    // zero-sales days that weren't just dead-traffic days
    const zeroDays = rows.filter((r) => (r.a[ri] ?? 0) === 0 && (r.a[si] ?? 0) > median * 0.3);
    if (zeroDays.length > 0) {
      c.out.push({
        id: "trend:zero-days",
        severity: "warning",
        category: "revenue",
        title: `${zeroDays.length === 1 ? "One day" : `${zeroDays.length} days`} had normal traffic but zero sales`,
        text: `${zeroDays
          .slice(0, 3)
          .map((r) => fmtDay(r.dim))
          .join(", ")} had visitors but no recorded purchases — either something broke in checkout that day or purchase tracking dropped out.`,
        score: 66,
      });
    }
  }

  // Weekday vs weekend pattern (needs at least two weeks of data). KNOWN LIMITATION,
  // carried over as-is from the source per this port's "full parity" scope: Fri+Sat is
  // hardcoded as "the weekend" (a retail-week assumption for EG/GCC markets) rather than
  // configurable per client/locale — this will misclassify weekday/weekend for a non-EG/GCC
  // client. Flagged here rather than silently changed; worth a follow-up to parameterize.
  if (rows.length >= 14) {
    const dayOfWeek = (key: string) =>
      new Date(Number(key.slice(0, 4)), Number(key.slice(4, 6)) - 1, Number(key.slice(6, 8))).getDay();
    const weekend = rows.filter((r) => [5, 6].includes(dayOfWeek(r.dim))); // Fri+Sat — retail weekend in EG/GCC
    const weekday = rows.filter((r) => ![5, 6].includes(dayOfWeek(r.dim)));
    if (weekend.length >= 4 && weekday.length >= 8) {
      const avg = (rs: typeof rows) => rs.reduce((s, r) => s + (r.a[si] ?? 0), 0) / rs.length;
      const wS = avg(weekend);
      const dS = avg(weekday);
      const diff = dS > 0 ? ((wS - dS) / dS) * 100 : 0;
      if (Math.abs(diff) > 25) {
        c.out.push({
          id: "trend:weekend",
          severity: "info",
          category: "trend",
          title: diff > 0 ? "Weekends are clearly your busiest days" : "Weekdays clearly outperform weekends",
          text: `Weekend days (Fri–Sat) average ${fmtValue(Math.round(wS), "TYPE_INTEGER")} visits vs ${fmtValue(Math.round(dS), "TYPE_INTEGER")} on weekdays (${pctText(diff)}).`,
          recommendation:
            diff > 0
              ? "Schedule launches, promos, and the biggest ad budgets to land on the weekend peak rather than spreading spend evenly."
              : "Your audience shops during the week — consider shifting promo timing and ad budget away from weekends.",
          score: 35,
        });
      }
    }
  }
}

// Benchmark bands — e-commerce reference ranges (1-3% CVR, 40-60% checkout completion),
// stated as context rather than alarms. KNOWN LIMITATION, carried over as-is per this
// port's "full parity" scope: these are static and not derived from the property's own
// history or industry — will read oddly for a non-e-commerce property. Flagged, not
// silently changed; worth a future follow-up to make these configurable per client.
function ruleBenchmarks(c: Ctx) {
  const sessions = c.cur("sessions");
  const purchases = c.cur("event:purchase");
  if (sessions && sessions >= 1000 && purchases !== null) {
    const cvr = purchases / sessions;
    const band =
      cvr < 0.01
        ? "below the typical 1–3 range for online stores"
        : cvr <= 0.03
          ? "normal for online stores (typical range: 1–3)"
          : "above the typical 1–3 range — genuinely strong";
    c.out.push({
      id: "benchmark:cvr",
      severity: cvr < 0.01 ? "warning" : "info",
      category: "benchmark",
      title: `About ${per100(cvr)} in every 100 visits ends in a purchase`,
      text: `That's ${band}.`,
      recommendation:
        cvr < 0.01
          ? "Below 1 in 100, the fastest wins are usually the basics: page speed, mobile checkout friction, upfront shipping costs, and offering the payment methods people here actually use."
          : undefined,
      score: cvr < 0.01 ? 45 : 12,
    });
  }
  const checkout = c.cur("event:begin_checkout");
  if (checkout && checkout >= MIN_DENOMINATOR && purchases !== null) {
    const rate = purchases / checkout;
    if (rate < 0.4) {
      c.out.push({
        id: "benchmark:checkout",
        severity: "warning",
        category: "benchmark",
        title: "Most people who start checkout don't finish it",
        text: `Only ${pp(rate)} of started checkouts end in a purchase — typical stores manage 40–60%.`,
        recommendation:
          "Walk through your own checkout on a phone: count the steps, look for forced account creation, surprise costs on the last page, and failed payments. Each one is a classic cause.",
        score: 58,
      });
    }
  }
}

/** Categorical-breakdown mix analysis (channels, devices, countries…): dominant-source
 *  degradation and best-source shrinkage. */
function ruleMixShift(c: Ctx) {
  const { data } = c;
  const dims = data.dimensions;
  if (dims.length === 0 || dims[0] === "date" || dims[0] === "isoWeek" || dims[0] === "month" || !c.hasCompare) return;
  const si = findMetric(data, "sessions");
  if (si === -1 || data.rows.length < 2) return;
  // Purchase rate specifically — not just the first convs:* metric in the report, which
  // could be a different event entirely (e.g. convs:add_to_cart) and get mislabeled
  // "buying rate" below. Same filter ruleDailyPatterns uses.
  const cvrIdx = data.metrics.findIndex((m) => isConvRateMetric(m) && convRateEventName(m) === "purchase" && convRateDenom(m) === "sessions");
  const totalA = data.rows.reduce((s, r) => s + (r.a[si] ?? 0), 0);
  const totalB = data.rows.reduce((s, r) => s + (r.b?.[si] ?? 0), 0);
  if (totalA < MIN_DENOMINATOR || totalB < MIN_DENOMINATOR) return;

  const top = [...data.rows].sort((a, b) => (b.a[si] ?? 0) - (a.a[si] ?? 0))[0];
  const topShareA = (top.a[si] ?? 0) / totalA;
  if (topShareA > 0.4 && cvrIdx !== -1 && top.b?.[si] && top.b[si] >= MIN_DENOMINATOR) {
    const cvrA = top.a[cvrIdx] ?? 0;
    const cvrB = top.b[cvrIdx] ?? 0;
    if (cvrB > 0 && ((cvrA - cvrB) / cvrB) * 100 < -15) {
      c.out.push({
        id: `mix:dominant:${top.dim}`,
        severity: "critical",
        category: "traffic",
        title: `Your biggest traffic source, "${top.dim}", is converting noticeably worse`,
        text: `"${top.dim}" brings ${pp(topShareA)} of all visits, and its buying rate fell from ${pp(cvrB)} to ${pp(cvrA)}. When the biggest source weakens, every overall number weakens with it.`,
        recommendation:
          "Treat this source as its own project: refresh the creatives and audiences, re-check that the landing page matches the ads, and compare its cost per sale against the smaller sources before putting more budget in.",
        score: 88,
      });
    }
  }

  for (const r of data.rows) {
    const sA = r.a[si] ?? 0;
    const sB = r.b?.[si] ?? 0;
    if (sB < 1000 || cvrIdx === -1) continue;
    const shrink = ((sA - sB) / sB) * 100;
    const cvrA = r.a[cvrIdx] ?? 0;
    const blendedCvr = data.totalsA[cvrIdx] ?? 0;
    if (shrink < -50 && blendedCvr > 0 && cvrA > blendedCvr * 1.5) {
      c.out.push({
        id: `mix:shrunk:${r.dim}`,
        severity: "warning",
        category: "traffic",
        title: `You lost your best traffic, not your worst: "${r.dim}" shrank hard`,
        text: `Visits from "${r.dim}" are ${pctText(shrink)}, yet its visitors buy at ${pp(cvrA)} — well above the store-wide ${pp(blendedCvr)}.`,
        recommendation: "Rebuild this source before buying more of anything else — each of its visitors is worth a multiple of the average one.",
        score: 70 + Math.abs(shrink) / 5,
      });
    }
  }
}

/** Generic top movers — the floor so every report gets something, with the tiny-base
 *  guard and client-friendly metric names. */
function ruleTopMovers(c: Ctx) {
  if (!c.hasCompare) return;
  const { data } = c;
  const movers: { m: string; d: number; i: number }[] = [];
  data.metrics.forEach((m, i) => {
    const a = data.totalsA[i] ?? 0;
    const b = data.totalsB?.[i];
    const d = deltaPct(a, b);
    if (d === null || Math.abs(d) <= 5) return;
    // suppress screaming percentages on trivial bases (56 vs 1 = "+5500%")
    if ((isEventMetric(m) || m === "sessions" || m === "totalUsers" || m === "newUsers") && (b ?? 0) < MIN_PREV_BASE) return;
    movers.push({ m, d, i });
  });
  movers.sort((a, b) => Math.abs(b.d) - Math.abs(a.d));
  for (const { m, d, i } of movers.slice(0, 6)) {
    const type = data.metricHeaders[i]?.type;
    // for bad-when-up metrics (cart removals, refunds…) an increase is the warning
    const good = metricIsInverted(m) ? d < 0 : d > 0;
    c.out.push({
      id: `delta:${m}`,
      severity: Math.abs(d) > 25 ? (good ? "good" : "warning") : "info",
      category: "trend",
      title: `${plainLabel(m, c.meta, c.resolveLabel)}: ${pctText(d)}`,
      text: `${fmtValue(data.totalsA[i] ?? 0, type, data.currencyCode)} this period vs ${fmtValue(data.totalsB?.[i] ?? 0, type, data.currencyCode)} last period.`,
      score: 30 + Math.min(Math.abs(d) / 5, 15),
    });
  }
}

// ---- entry point ----

export function analyzeReport(data: ReportResponse, meta?: MetaItem[], resolveLabel: LabelResolver = defaultMetricLabel): EngineInsight[] {
  const cur = (name: string) => {
    const i = findMetric(data, name);
    return i === -1 ? null : data.totalsA[i] ?? 0;
  };
  const prev = (name: string) => {
    const i = findMetric(data, name);
    return i === -1 || !data.totalsB ? null : data.totalsB[i] ?? 0;
  };
  const ctx: Ctx = {
    data,
    meta,
    resolveLabel,
    out: [],
    cur,
    prev,
    has: (name) => findMetric(data, name) !== -1,
    label: (name) => plainLabel(name, meta, resolveLabel),
    money: (v) => fmtValue(v, "TYPE_CURRENCY", data.currencyCode),
    hasCompare: !!data.rangeB && !!data.totalsB,
  };

  ruleConversionDecomposition(ctx);
  ruleRevenueDecomposition(ctx);
  ruleFunnelSteps(ctx);
  ruleCartRemoval(ctx);
  ruleTrafficQuality(ctx);
  ruleReturningUsers(ctx);
  ruleDailyPatterns(ctx);
  ruleBenchmarks(ctx);
  ruleMixShift(ctx);
  ruleTopMovers(ctx);

  // a top-mover line that duplicates a decomposition's subject is noise — decompositions
  // already state the number with more context
  const hasDecompP = ctx.out.some((o) => o.id === "decomp:purchases");
  const hasDecompR = ctx.out.some((o) => o.id === "decomp:revenue");
  const filtered = ctx.out.filter((o) => {
    if (hasDecompP && (o.id === "delta:event:purchase" || o.id === "delta:sessions")) return false;
    if (hasDecompR && (o.id === "delta:purchaseRevenue" || o.id === "delta:averagePurchaseRevenue")) return false;
    return true;
  });

  return filtered.sort((a, b) => b.score - a.score);
}
