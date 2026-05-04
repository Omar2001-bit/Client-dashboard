export type TutorialPosition = "top" | "bottom" | "left" | "right" | "center";

export interface TutorialStep {
  id: string;
  title: string;
  description: string;
  target: string | null; // CSS selector using data-tutorial attribute
  route: string; // use {experimentId} placeholder where needed
  position: TutorialPosition;
  padding?: number;
}

export const TUTORIAL_STEPS: TutorialStep[] = [
  // ── Welcome ────────────────────────────────────────────────────────────────
  {
    id: "welcome",
    title: "Welcome to your Optimizers dashboard! 👋",
    description:
      "This is your central hub for tracking A/B testing performance, ROI, and experiment results. Data is refreshed automatically every day at 8 AM and 8 PM Cairo time — so everything you see reflects your latest experiment data. Let's take a quick 2-minute tour so you know exactly where everything is and how to use it.",
    target: null,
    route: "/dashboard",
    position: "center",
  },

  // ── Date range ─────────────────────────────────────────────────────────────
  {
    id: "date_range",
    title: "Date Range Filter",
    description:
      "Use these date pickers to zoom in on any time period. All KPI cards, the ROI panel, and the chart update instantly to show only the experiments that were running during your chosen window. Click 'Full Range' to reset to all available data.",
    target: "[data-tutorial='date-range']",
    route: "/dashboard",
    position: "bottom",
  },

  // ── KPI cards ──────────────────────────────────────────────────────────────
  {
    id: "kpi_cards",
    title: "Your Key Performance Metrics",
    description:
      "These three cards show the combined uplift from all your experiments in the selected date range. Revenue Uplift is the extra revenue generated compared to the original variation. Purchases and Products Uplift show the same for orders and items sold.",
    target: "[data-tutorial='kpi-cards']",
    route: "/dashboard",
    position: "bottom",
  },

  // ── ROI panel ──────────────────────────────────────────────────────────────
  {
    id: "roi_panel",
    title: "Return on Investment",
    description:
      "This progress bar shows how much value your experiments have generated relative to the service cost. The marker moves right as your ROI grows. Once it passes 'Breakeven' you're profitable. Below the bar you can see your Net Profit and exact ROI multiplier.",
    target: "[data-tutorial='roi-panel']",
    route: "/dashboard",
    position: "top",
    padding: 4,
  },

  // ── Revenue chart ──────────────────────────────────────────────────────────
  {
    id: "revenue_chart",
    title: "Revenue Uplift Over Time",
    description:
      "This chart shows your daily revenue uplift across all experiments. Hover over any date to see which experiments contributed and by how much. Green areas represent positive days; red areas represent days where experiments had a negative combined impact.",
    target: "[data-tutorial='revenue-chart']",
    route: "/dashboard",
    position: "top",
  },

  // ── Exclude losses ─────────────────────────────────────────────────────────
  {
    id: "exclude_losses",
    title: "Exclude Revenue Losses",
    description:
      "Tick this to remove any experiment with a negative revenue uplift from all totals. This shows your 'best case' scenario — only the experiments that are generating value. The count of excluded experiments is shown next to the checkbox.",
    target: "[data-tutorial='exclude-losses']",
    route: "/dashboard",
    position: "left",
  },

  // ── Rate metrics ───────────────────────────────────────────────────────────
  {
    id: "rate_metrics",
    title: "Rate Metrics",
    description:
      "RPV (Revenue Per Visitor), CVR (Conversion Rate), and AOV (Average Order Value) are shown here. Switch between Average mode — which shows the typical impact per experiment — and Sum mode — which shows the total combined impact across all experiments.",
    target: "[data-tutorial='rate-metrics']",
    route: "/dashboard",
    position: "top",
  },

  // ── Recent experiments ─────────────────────────────────────────────────────
  {
    id: "recent_experiments",
    title: "Recent Experiments",
    description:
      "The 5 most recently started experiments appear here with all their key metric uplifts. Click on any experiment name to open its full detail page, where you'll find per-variation data, goal breakdowns, and audience information.",
    target: "[data-tutorial='recent-experiments']",
    route: "/dashboard",
    position: "top",
  },

  // ── Experiments list ───────────────────────────────────────────────────────
  {
    id: "experiments_intro",
    title: "Experiments — Your Full List",
    description:
      "Now let's look at the Experiments page. This shows every single experiment with full metric columns, search, sort, and the ability to hide experiments from your dashboard view.",
    target: null,
    route: "/dashboard/experiments",
    position: "center",
  },

  {
    id: "experiments_search",
    title: "Search Experiments",
    description:
      "Type any keyword to instantly filter the experiments list. Search looks through experiment names, so you can quickly find a specific test by typing part of its name or ID.",
    target: "[data-tutorial='experiments-search']",
    route: "/dashboard/experiments",
    position: "bottom",
  },

  {
    id: "experiments_sort",
    title: "Sort by Any Metric",
    description:
      "Reorder the entire list by Revenue, RPV, Purchases, Products, CVR, AOV, name, or status. Revenue is the default — experiments with the highest revenue uplift appear at the top. This helps you instantly see which tests are performing best.",
    target: "[data-tutorial='experiments-sort']",
    route: "/dashboard/experiments",
    position: "bottom",
  },

  {
    id: "experiments_table",
    title: "Experiment Results",
    description:
      "Each row shows an experiment with its status badge and uplift across all 6 metrics. Green numbers mean positive uplift versus the original. Red means negative. Click 'View detail' on any row to open the full breakdown.",
    target: "[data-tutorial='experiments-table']",
    route: "/dashboard/experiments",
    position: "top",
    padding: 0,
  },

  {
    id: "experiments_hide",
    title: "Hide / Show Experiments",
    description:
      "Use the eye icon on any experiment row to hide it from your dashboard. Hidden experiments are faded and excluded from all totals — perfect for paused or irrelevant tests you don't want distorting your numbers. Click the eye again to restore.",
    target: "[data-tutorial='experiments-eye']",
    route: "/dashboard/experiments",
    position: "left",
  },

  // ── Experiment detail page ─────────────────────────────────────────────────
  {
    id: "experiment_detail_intro",
    title: "Inside an Experiment",
    description:
      "Click 'View detail' on any experiment to open this page. You'll see a full breakdown of that single experiment: status, hide toggle, metric uplift table, per-variation raw numbers, and goal-by-goal conversion data.",
    target: null,
    route: "/dashboard/experiments/{experimentId}",
    position: "center",
  },

  {
    id: "experiment_detail_header",
    title: "Status & Hide Toggle",
    description:
      "The experiment name and status badge (Running, Completed, Paused) are shown at the top. The 'Hide from dashboard' button lets you remove this experiment from your totals and charts without deleting any data — click it again to restore.",
    target: "[data-tutorial='experiment-detail-header']",
    route: "/dashboard/experiments/{experimentId}",
    position: "bottom",
  },

  {
    id: "experiment_details_card",
    title: "Experiment Details Card",
    description:
      "This card shows the context behind the experiment: the description or objective written by our team, the location (which page or URL the test ran on), the audience segment it targeted, and variation preview links so you can see exactly what each variation looked like. It only appears when this information is available.",
    target: "[data-tutorial='experiment-details-card']",
    route: "/dashboard/experiments/{experimentId}",
    position: "top",
  },

  {
    id: "experiment_metric_uplift",
    title: "Metric Uplift Table",
    description:
      "This table shows the full before/after comparison across all 6 metrics: Revenue, RPV, Purchases, Products, CVR, and AOV. Each row shows the original variation value, the best variation value, the absolute uplift, and the percentage uplift. Green = positive, red = negative.",
    target: "[data-tutorial='experiment-metric-uplift']",
    route: "/dashboard/experiments/{experimentId}",
    position: "top",
  },

  {
    id: "experiment_variation_metrics",
    title: "Variation Metrics Table",
    description:
      "This table shows the raw numbers for every variation side by side — not just the winner. Compare all variations across all 6 metrics to understand exactly which change drove which result and by how much.",
    target: "[data-tutorial='experiment-variation-metrics']",
    route: "/dashboard/experiments/{experimentId}",
    position: "top",
  },

  {
    id: "experiment_goals",
    title: "Goals Breakdown",
    description:
      "The Goals Breakdown shows conversion data per tracking goal per variation — visitors, conversions, conversion rate, and revenue. Each goal has its own table. This is the most granular view of how the experiment performed across different conversion events.",
    target: "[data-tutorial='experiment-goals']",
    route: "/dashboard/experiments/{experimentId}",
    position: "top",
  },

  // ── Support ────────────────────────────────────────────────────────────────
  {
    id: "support_intro",
    title: "Support — We're Here to Help",
    description:
      "The Support page gives you a direct chat line to our team. You can also reach us at any time via the floating chat bubble at the bottom right corner of every page — no need to navigate here.",
    target: null,
    route: "/dashboard/support",
    position: "center",
  },

  {
    id: "support_chat",
    title: "Send a Message",
    description:
      "Type your message in the box below and press Send or hit Enter to submit. Our team receives it instantly and responds as soon as possible. All previous messages are saved so you can see the full conversation history.",
    target: "[data-tutorial='support-chat']",
    route: "/dashboard/support",
    position: "top",
  },

  // ── Meetings ───────────────────────────────────────────────────────────────
  {
    id: "meetings_intro",
    title: "Book a Meeting",
    description:
      "Need to talk strategy or dig into a technical issue? The Book a Meeting page gives you direct access to our calendar. Choose the type of meeting that matches your need.",
    target: null,
    route: "/dashboard/book-meeting",
    position: "center",
  },

  {
    id: "meeting_business",
    title: "Business Meeting",
    description:
      "Use this for commercial discussions, priorities, planning, and strategy alignment with our team. Clicking opens our Calendly page in a new tab where you can pick a time that works for you.",
    target: "[data-tutorial='meeting-business']",
    route: "/dashboard/book-meeting",
    position: "bottom",
  },

  {
    id: "meeting_technical",
    title: "Technical Meeting",
    description:
      "Use this for implementation details, tracking issues, integrations, or deeper product and campaign questions. This connects you directly with our technical team.",
    target: "[data-tutorial='meeting-technical']",
    route: "/dashboard/book-meeting",
    position: "bottom",
  },

  // ── Timeline ───────────────────────────────────────────────────────────────
  {
    id: "timeline_intro",
    title: "Your Project Timeline",
    description:
      "The Timeline shows the full roadmap of your engagement with us — broken into phases with start and end dates, deliverables, and linked tasks. This keeps you informed on where we are and what's coming next.",
    target: null,
    route: "/dashboard/timeline",
    position: "center",
  },

  {
    id: "timeline_viewer",
    title: "Engagement Phases",
    description:
      "Each coloured block represents a phase of your project. Click on any phase to expand it and see its deliverables and any linked tasks. The timeline spans your full contract period so you always have a clear picture of the engagement.",
    target: "[data-tutorial='timeline-viewer']",
    route: "/dashboard/timeline",
    position: "bottom",
    padding: 4,
  },

  // ── Complete ───────────────────────────────────────────────────────────────
  {
    id: "complete",
    title: "You're all set! 🎉",
    description:
      "You now know your way around the dashboard. Everything is built to give you full visibility into the impact of your A/B testing programme. You can revisit this tutorial any time from the Docs tab in the sidebar — and our team is always one message away if you need anything.",
    target: null,
    route: "/dashboard",
    position: "center",
  },
];
