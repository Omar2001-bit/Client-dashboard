export type TutorialPosition = "top" | "bottom" | "left" | "right" | "center";

export interface AdminTutorialStep {
  id: string;
  title: string;
  description: string;
  target: string | null;
  route: string; // use {clientId} placeholder where needed
  position: TutorialPosition;
  padding?: number;
  execAdminOnly?: boolean;
}

export const ADMIN_TUTORIAL_STEPS: AdminTutorialStep[] = [

  // ── Welcome ────────────────────────────────────────────────────────────────
  {
    id: "admin_welcome",
    title: "Welcome to the Optimizers Admin Panel",
    description:
      "This is your central hub for managing all client accounts, pulling experiment data, monitoring client behavior, handling support, and configuring integrations. Let's take a full walkthrough — we'll go inside every tab and every page so you know exactly what's where.",
    target: null,
    route: "/admin",
    position: "center",
  },

  // ── Overview ───────────────────────────────────────────────────────────────
  {
    id: "admin_kpi_cards",
    title: "Agency Overview — KPI Cards",
    description:
      "These three cards show the state of your portfolio at a glance: Active Clients, Total Clients, and Inactive Clients. They update every time you load the page.",
    target: "[data-tutorial='admin-kpi-cards']",
    route: "/admin",
    position: "bottom",
  },
  {
    id: "admin_roster",
    title: "Client Roster",
    description:
      "The roster lists every client with their contact email, status, and contract start date. Click 'Edit' on any row to open that client's management page. Click 'Manage all' to go to the full client list.",
    target: "[data-tutorial='admin-client-roster']",
    route: "/admin",
    position: "top",
  },
  {
    id: "admin_new_client",
    title: "Creating a New User",
    description:
      "Click 'New User' to create any type of account — not just clients. Three roles are available: Client (gets their own dashboard), Admin (full panel access, no pricing), and Executive Admin (everything an admin can do plus exclusive access to set the service price that drives ROI). Only one Executive Admin account is allowed at a time.",
    target: "[data-tutorial='admin-new-client']",
    route: "/admin",
    position: "bottom",
  },

  // ── Clients list ───────────────────────────────────────────────────────────
  {
    id: "clients_intro",
    title: "The Clients List",
    description:
      "The Clients page is the full directory of every account. You can search by name or email, and from each row you can preview the client dashboard or open the management page.",
    target: null,
    route: "/admin/clients",
    position: "center",
  },
  {
    id: "clients_search",
    title: "Search Clients",
    description:
      "Type any keyword — company name or email — to filter the list instantly. Essential when you have many accounts.",
    target: "[data-tutorial='admin-clients-search']",
    route: "/admin/clients",
    position: "bottom",
  },
  {
    id: "clients_table",
    title: "Client Table — Preview & Edit",
    description:
      "Each row shows company, contact, status (Active / Inactive), and engagement dates. 'Preview' opens the client's dashboard in a new tab exactly as they see it. 'Edit' opens the full 4-tab management page.",
    target: "[data-tutorial='admin-clients-table']",
    route: "/admin/clients",
    position: "top",
  },
  {
    id: "exec_client_paid",
    title: "Client Paid Column — Executive Admin Only",
    description:
      "As executive admin you can see the USD amount each client paid here. This figure is what drives the ROI panel on their dashboard. Regular admins cannot see this column at all.",
    target: "[data-tutorial='admin-client-paid']",
    route: "/admin/clients",
    position: "left",
    execAdminOnly: true,
  },

  // ── Client detail — intro ──────────────────────────────────────────────────
  {
    id: "client_detail_intro",
    title: "Inside a Client — 4 Tabs",
    description:
      "Opening a client takes you to a 4-tab page. We'll walk through each tab now. Watch the highlighted areas as we go.",
    target: null,
    route: "/admin/clients/{clientId}",
    position: "center",
  },
  {
    id: "client_detail_tabs",
    title: "Tab Navigation",
    description:
      "These four tabs separate all client management work. Overview handles details and credentials, Convert Data Pulls handles syncing, Dashboard Settings controls what the client sees, and Timeline Builder is the project roadmap editor.",
    target: "[data-tutorial='admin-client-tabs']",
    route: "/admin/clients/{clientId}",
    position: "bottom",
    padding: 6,
  },

  // ── Overview tab ───────────────────────────────────────────────────────────
  {
    id: "client_overview_content",
    title: "Overview Tab — Client Details",
    description:
      "This is where you manage the core account information: company name, contact, engagement dates, Convert.com credentials, status (Active/Inactive), and password management. Click Save Changes after editing.",
    target: "[data-tutorial='admin-client-overview']",
    route: "/admin/clients/{clientId}?tab=overview",
    position: "top",
    padding: 0,
  },
  {
    id: "exec_client_price_field",
    title: "Service Price Field — Executive Admin Only",
    description:
      "This field is only visible to executive admins. Enter the USD amount the client paid — this becomes the 'Service Investment' line on their ROI panel, used to compute net profit and the ROI multiplier. Without it, their ROI dashboard shows no data.",
    target: "[data-tutorial='admin-client-price']",
    route: "/admin/clients/{clientId}?tab=overview",
    position: "bottom",
    execAdminOnly: true,
  },

  // ── Convert tab ────────────────────────────────────────────────────────────
  {
    id: "client_convert_content",
    title: "Convert Data Pulls Tab",
    description:
      "'Pull New from Convert' fetches only new and recently changed experiments — fast and non-destructive, use it for routine updates. 'Full Refresh from Convert' replaces all data with a fresh copy — use it when data looks wrong. Both syncs also run automatically every day at 8 AM and 8 PM Cairo time.",
    target: "[data-tutorial='admin-client-convert']",
    route: "/admin/clients/{clientId}?tab=convert",
    position: "top",
  },

  // ── Settings tab ───────────────────────────────────────────────────────────
  {
    id: "client_settings_content",
    title: "Dashboard Settings Tab",
    description:
      "Control exactly what the client sees. Hide or show individual experiments, add manual experiments with custom uplift data, edit experiment names, and write admin notes the client can see inside the experiment detail view. 'Preview as Client' opens their dashboard in a new tab.",
    target: "[data-tutorial='admin-client-settings']",
    route: "/admin/clients/{clientId}?tab=settings",
    position: "top",
  },

  // ── Timeline tab ───────────────────────────────────────────────────────────
  {
    id: "client_timeline_content",
    title: "Timeline Builder Tab",
    description:
      "Build the project roadmap the client sees on their Timeline page. Add phases with names, colors, start and end dates, and descriptions. Link phases to ClickUp tasks so the client can see real-time task status. Connect ClickUp once via the Settings page to enable linking.",
    target: "[data-tutorial='admin-client-timeline']",
    route: "/admin/clients/{clientId}?tab=timeline",
    position: "top",
  },

  // ── Client logs — selector ─────────────────────────────────────────────────
  {
    id: "logs_intro",
    title: "Client Behavior Logs",
    description:
      "Client Logs is your analytics view of what each client does on their dashboard — every page visit, click, scroll, message sent, and experiment viewed is recorded as a timestamped event. Let's walk through the log viewer.",
    target: null,
    route: "/admin/logs",
    position: "center",
  },
  {
    id: "logs_selector",
    title: "Choose a Client to Inspect",
    description:
      "Click any client card to open their full activity log. The viewer loads instantly and stays live — new events appear automatically in real time as the client uses their dashboard.",
    target: "[data-tutorial='admin-logs-viewer']",
    route: "/admin/logs",
    position: "top",
  },

  // ── Client logs — inside viewer ────────────────────────────────────────────
  {
    id: "logs_stats",
    title: "Session Summary Stats",
    description:
      "This bar shows key stats for the selected client at a glance: total sessions, total events recorded, average time spent per page, their most visited page, and when they were last active.",
    target: "[data-tutorial='admin-logs-stats']",
    route: "/admin/logs?client={clientId}",
    position: "bottom",
  },
  {
    id: "logs_filters",
    title: "Event Type Filters",
    description:
      "Click any chip to filter the event feed to just that type — for example, show only support messages, only experiment views, or only page visits. Multiple chips can be active at once. Click 'All events' to reset.",
    target: "[data-tutorial='admin-logs-filters']",
    route: "/admin/logs?client={clientId}",
    position: "bottom",
  },
  {
    id: "logs_events",
    title: "The Event Feed",
    description:
      "Events are grouped into sessions (one session = one continuous visit) with dividers showing the start time. Each event shows exactly what the client did — including the page URL, time spent, and any relevant parameters like which button was clicked or what they searched for.",
    target: "[data-tutorial='admin-logs-events']",
    route: "/admin/logs?client={clientId}",
    position: "top",
    padding: 0,
  },
  {
    id: "logs_export",
    title: "Exporting Logs",
    description:
      "Export the full log history as CSV (a structured spreadsheet with all events, descriptions, timestamps, and parameters) or as PDF (a printable report with session summaries and full event detail). Both exports include everything shown in the feed.",
    target: "[data-tutorial='admin-logs-export']",
    route: "/admin/logs?client={clientId}",
    position: "bottom",
  },

  // ── Support ────────────────────────────────────────────────────────────────
  {
    id: "support_intro",
    title: "Support — Client Conversations",
    description:
      "All client support conversations arrive here in real time. New messages show a red unread badge. Each conversation is a ticket you reply to and mark resolved when done.",
    target: null,
    route: "/admin/support",
    position: "center",
  },
  {
    id: "support_tickets",
    title: "Tickets and Chat",
    description:
      "The left panel lists tickets filtered by Open, Resolved, or All. Click a ticket to open the full conversation on the right. Type and press Enter to reply. 'Mark resolved' closes the ticket. Unread red badges clear automatically when you open the ticket.",
    target: "[data-tutorial='admin-support-tickets']",
    route: "/admin/support",
    position: "right",
  },

  // ── Settings ───────────────────────────────────────────────────────────────
  {
    id: "settings_intro",
    title: "Integration Settings — ClickUp",
    description:
      "Configure the ClickUp OAuth credentials that all client timeline builders use. You only need to do this once — every client timeline then connects to their own ClickUp workspace through this same OAuth app.",
    target: null,
    route: "/admin/settings",
    position: "center",
  },
  {
    id: "settings_clickup",
    title: "ClickUp OAuth Configuration",
    description:
      "Paste your ClickUp app Client ID and Client Secret here, then click Save. The redirect URI is pre-filled — copy it and register it in your ClickUp app settings. Once saved, open any client's Timeline Builder and click 'Connect ClickUp' to authorize their workspace.",
    target: "[data-tutorial='admin-settings-clickup']",
    route: "/admin/settings",
    position: "bottom",
  },

  // ── Exec pricing recap ─────────────────────────────────────────────────────
  {
    id: "exec_pricing_recap",
    title: "Pricing Recap — Executive Admin",
    description:
      "Quick reminder: the service price you set on each client is the only thing that makes their ROI panel work. If a regular admin creates a client, you'll receive an automatic email with a direct link to set the price before the client logs in.",
    target: null,
    route: "/admin/settings",
    position: "center",
    execAdminOnly: true,
  },

  // ── Complete ───────────────────────────────────────────────────────────────
  {
    id: "admin_complete",
    title: "You're all set! 🎉",
    description:
      "You've seen everything — client management, all four detail tabs, the full log viewer, support, and settings. You can relaunch this tutorial any time from the Docs page in the sidebar.",
    target: null,
    route: "/admin",
    position: "center",
  },
];
