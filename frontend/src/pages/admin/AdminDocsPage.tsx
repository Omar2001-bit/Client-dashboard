import { useState } from "react";
import { useOutletContext } from "react-router-dom";
import {
  BookOpen, LayoutDashboard, Users, Activity, MessageSquare,
  Settings, ChevronRight, Play, Crown,
} from "lucide-react";
import { useAuthStore } from "@/store/authStore";

interface DocSection {
  id: string;
  icon: React.ElementType;
  title: string;
  subtitle: string;
  execAdminOnly?: boolean;
  content: DocItem[];
}

interface DocItem {
  title: string;
  description: string;
  steps?: string[];
  badge?: "exec-only";
}

const SECTIONS: DocSection[] = [
  {
    id: "getting-started",
    icon: BookOpen,
    title: "Getting Started",
    subtitle: "Your first steps in the admin panel",
    content: [
      {
        title: "What is the admin panel?",
        description:
          "The Optimizers admin panel is your complete management interface for all client accounts. From here you can onboard new clients, pull experiment data from Convert.com, monitor client behavior on their dashboards, manage support conversations, and configure integrations. Two admin roles exist: regular admin (can do everything except pricing) and executive admin (full access including service pricing).",
      },
      {
        title: "Navigating the admin panel",
        description: "Use the sidebar on the left to move between sections.",
        steps: [
          "Overview → Agency KPIs, client roster at a glance",
          "Clients → Full client directory with search and edit access",
          "Client Logs → Real-time behavior analytics for any client",
          "Support → All client support conversations in one inbox",
          "Settings → ClickUp OAuth configuration for timeline linking",
          "Docs → This documentation page (you are here)",
        ],
      },
      {
        title: "Re-launching the tutorial",
        description:
          "You can restart the full interactive walkthrough at any time by clicking the 'Launch Tutorial' button at the top of this page.",
      },
    ],
  },
  {
    id: "overview",
    icon: LayoutDashboard,
    title: "Overview",
    subtitle: "Agency-wide KPIs and client roster",
    content: [
      {
        title: "KPI Cards",
        description:
          "The three cards at the top of the Overview page show Active Clients, Total Clients, and Inactive Clients. These give you an instant read on the health of your portfolio and update every time the page loads.",
      },
      {
        title: "Client Roster",
        description:
          "The roster table lists all clients with their contact email, current status (Active/Inactive), and contract start date. It's a quick reference — click 'Edit' on any row to jump directly to that client's management page.",
        steps: [
          "Green status badge = Active client",
          "Gray status badge = Inactive client",
          "Click 'Edit' to open the client management page",
          "Click 'Manage all' to go to the full client list with search",
        ],
      },
      {
        title: "Creating a New User",
        description:
          "Click 'New User' in the top-right corner of Overview (or from the Clients page) to onboard a new account. You'll fill in company name, contact details, engagement dates, and Convert.com API credentials. The system creates a Firebase Auth account and Firestore document for the client automatically.",
        steps: [
          "Enter company name and contact details",
          "Set engagement start and end dates",
          "Paste the Convert.com Key ID and Key Secret",
          "Choose the client's role (usually 'client')",
          "Click Create — the client receives login credentials",
        ],
      },
    ],
  },
  {
    id: "clients",
    icon: Users,
    title: "Clients",
    subtitle: "Full client directory and per-client management",
    content: [
      {
        title: "The Client List",
        description:
          "The Clients page is the complete directory of all client accounts. Search by company name or email to filter the list. Each row shows company, contact, status, and engagement period.",
      },
      {
        title: "Searching Clients",
        description: "The search box filters the client list in real time as you type.",
        steps: [
          "Click the search box at the top of the client list",
          "Type any part of the company name or email",
          "The list filters instantly",
          "Clear the box to show all clients again",
        ],
      },
      {
        title: "Preview vs Edit",
        description:
          "Each client row has two action links. 'Preview' opens the client's dashboard in a new tab exactly as they see it — useful for verifying data and settings before a call. 'Edit' opens the full 4-tab management page.",
      },
      {
        title: "Client Management — 4 Tabs",
        description:
          "The client detail page is organized into four tabs to keep related work together.",
        steps: [
          "Overview — Company details, engagement dates, Convert credentials, password management",
          "Convert Data Pulls — Incremental pull and full refresh from Convert.com",
          "Dashboard Settings — Experiment visibility, manual experiments, admin notes",
          "Timeline Builder — Project phases linked to ClickUp tasks",
        ],
      },
      {
        title: "Convert Data Pulls Tab",
        description:
          "Use the Convert Data Pulls tab to sync experiment data from Convert.com into Firestore. Two options are available.",
        steps: [
          "Pull New from Convert — fetches only new and recently changed experiments. Fast and non-destructive. Use this for routine updates.",
          "Full Refresh from Convert — replaces ALL experiment data with a fresh copy from Convert.com. Use this when data looks stale or mismatched.",
          "Both syncs also run automatically every day at 8 AM and 8 PM Cairo time via the server scheduler.",
        ],
      },
      {
        title: "Dashboard Settings Tab",
        description:
          "Control exactly what the client sees on their dashboard from this tab.",
        steps: [
          "Hide or show individual experiments — hidden experiments are excluded from all KPI totals and charts",
          "Add manual experiments — enter custom uplift data for tests not yet in Convert.com",
          "Edit experiment names and add admin notes visible to the client inside the experiment detail view",
          "Click 'Preview as Client' to see the dashboard exactly as the client sees it",
        ],
      },
      {
        title: "Timeline Builder Tab",
        description:
          "Build the project roadmap the client sees on their Timeline page.",
        steps: [
          "Add phases with a name, color, start date, and end date",
          "Write a description that explains what the phase covers",
          "Link phases to ClickUp tasks — the client sees real-time task status",
          "Connect ClickUp once in the Settings page to enable task linking",
          "Click Save to publish the timeline to the client dashboard",
        ],
      },
      {
        title: "Password Management",
        description:
          "Inside the Overview tab you can manage the client's login credentials without involving Firebase manually.",
        steps: [
          "Send password reset email — sends a reset link to the client's login email",
          "Generate a new password — type or auto-generate a password, then share it with the client",
          "Copy the generated password before clicking Set Password",
        ],
      },
    ],
  },
  {
    id: "pricing",
    icon: Crown,
    title: "Pricing & ROI (Executive Admin)",
    subtitle: "Service pricing, ROI calculation, and access control",
    execAdminOnly: false,
    content: [
      {
        title: "Who can set pricing?",
        description:
          "Only the executive admin role can view and edit the 'Client Paid Amount' field. Regular admins see a placeholder message instead. This restriction ensures pricing stays controlled by agency leadership.",
        badge: "exec-only",
      },
      {
        title: "Setting the Service Price",
        description:
          "Open any client's Edit page and go to the Overview tab. Executive admins see a 'Client Paid Amount (USD)' input. Enter the total USD amount the client paid for the Optimizers service and click Save Changes.",
        steps: [
          "Go to Clients → click Edit on the target client",
          "Stay on the Overview tab",
          "Find the 'Client Paid Amount (USD)' input (executive admin only)",
          "Enter the USD amount and click Save Changes",
          "The client's ROI panel will update on their next dashboard load",
        ],
        badge: "exec-only",
      },
      {
        title: "How the Service Price Drives ROI",
        description:
          "The value you enter becomes the 'Service Investment' line on the client's ROI panel. The dashboard uses it to calculate net profit (Revenue Uplift minus Service Investment) and the ROI multiplier. The progress bar on the client dashboard moves right as revenue uplift approaches and then exceeds the service price.",
        steps: [
          "Service Investment = the USD amount you set here",
          "Net Profit = Revenue Uplift − Service Investment",
          "ROI Multiplier = Revenue Uplift ÷ Service Investment",
          "Breakeven = when Revenue Uplift equals Service Investment (ROI = 1×)",
          "Without a price set, the ROI panel shows '--' for all values",
        ],
      },
      {
        title: "Viewing Prices in the Client List",
        description:
          "Executive admins see an extra 'Client Paid' column in the full client list (Clients page). This lets you audit pricing across all accounts at a glance without opening each client individually.",
        badge: "exec-only",
      },
      {
        title: "Notification When a Regular Admin Creates a Client",
        description:
          "When a regular admin creates a new client, the system automatically sends an email notification to the executive admin's email address. The email includes a direct link to the new client's page so you can set the service price immediately and unblock the ROI calculation.",
      },
    ],
  },
  {
    id: "logs",
    icon: Activity,
    title: "Client Logs",
    subtitle: "Real-time behavior analytics for every client",
    content: [
      {
        title: "What is logged?",
        description:
          "Every action a client takes on their dashboard is recorded as a timestamped event: page visits, time spent per page, button clicks, search queries, experiment views, support messages sent, meeting bookings, tutorial progress, and more. Events are stored in Firestore in real time.",
      },
      {
        title: "Selecting a Client",
        description:
          "Open Client Logs from the sidebar and click on any client from the list to open their log viewer. The viewer stays live — new events appear automatically without refreshing.",
      },
      {
        title: "Reading the Log Viewer",
        description:
          "Events are grouped into sessions (one session = one continuous visit). Each event shows a full description of what the client did, including parameters like which page they were on, how long they spent, and what they clicked.",
        steps: [
          "Session dividers show the start of each visit with a date and time",
          "Each event has an icon, label, and full plain-language description",
          "URL, referrer, and time-on-page are shown for navigation events",
          "The Live indicator flashes green when new events arrive",
        ],
      },
      {
        title: "Filtering Events",
        description:
          "Use the event type filter chips at the top of the log viewer to focus on specific categories — for example, show only support messages or only experiment views.",
        steps: [
          "Click any event type chip to filter the list to that type only",
          "Click the chip again (or 'All') to clear the filter",
          "Multiple chips can be active at once",
        ],
      },
      {
        title: "Exporting Logs",
        description:
          "Export the full log history for a client as a CSV or PDF for reporting, review, or sharing with your team.",
        steps: [
          "Click 'Export CSV' to download a structured spreadsheet with all events, descriptions, and metadata",
          "Click 'Export PDF' to generate a printable report with session summaries and event detail",
          "Both exports include timestamps, event counts, and full parameter data",
        ],
      },
      {
        title: "Why Client Logs Matter",
        description:
          "Logs help you understand what each client is thinking and what they need. If a client keeps viewing the ROI panel, they may want a pricing conversation. If they're clicking the same experiment repeatedly, they may have questions about it. Use logs to prepare for client calls and anticipate their needs.",
      },
    ],
  },
  {
    id: "support",
    icon: MessageSquare,
    title: "Support",
    subtitle: "All client conversations in one inbox",
    content: [
      {
        title: "How client support works",
        description:
          "Clients can send messages from their Support page or from the floating chat bubble available on every page of their dashboard. All messages arrive here as support tickets in real time.",
      },
      {
        title: "Managing Tickets",
        description:
          "The left panel lists all tickets filtered by Open, Resolved, or All. Unread messages show a red count badge.",
        steps: [
          "Click any ticket to open the full conversation",
          "Type your reply in the text box and press Enter or click Send",
          "Click 'Mark resolved' to close a ticket when the conversation is done",
          "Resolved tickets are hidden from the Open filter but accessible via Resolved or All",
        ],
      },
      {
        title: "Unread Badges",
        description:
          "A red badge on a ticket means the client has sent a message you haven't read yet. The badge count shows how many unread messages are in that conversation. It clears automatically when you open the ticket.",
      },
    ],
  },
  {
    id: "settings",
    icon: Settings,
    title: "Settings",
    subtitle: "ClickUp OAuth integration for timeline linking",
    content: [
      {
        title: "What are Integration Settings for?",
        description:
          "The Settings page stores the ClickUp OAuth credentials used by all client timeline builders. You configure this once and every client timeline can then connect to their own ClickUp workspace using the same OAuth app.",
      },
      {
        title: "Setting up ClickUp OAuth",
        description:
          "You'll need to create a ClickUp OAuth app in your ClickUp developer settings to get the Client ID and Client Secret.",
        steps: [
          "Go to ClickUp → Settings → Apps → Build an App",
          "Name the app (e.g. 'Optimizers') and set the redirect URI to the pre-filled callback URL",
          "Copy the Client ID and Client Secret from ClickUp",
          "Paste them into the Settings form here and click 'Save ClickUp Config'",
          "Copy the Callback URL using the 'Copy callback URL' button and register it in ClickUp",
        ],
      },
      {
        title: "Connecting a Client's ClickUp Workspace",
        description:
          "After saving the ClickUp config here, open any client's detail page, go to the Timeline Builder tab, and click 'Connect ClickUp'. This walks the client (or you, if you're doing it for them) through authorizing the workspace. Once connected, ClickUp tasks can be linked to timeline phases.",
      },
    ],
  },
];

export function AdminDocsPage() {
  const { startTutorial: onLaunchTutorial } = useOutletContext<{ startTutorial: () => void }>();
  const role = useAuthStore((s) => s.role);
  const [activeSection, setActiveSection] = useState(SECTIONS[0].id);
  const section = SECTIONS.find((s) => s.id === activeSection) ?? SECTIONS[0];

  return (
    <div className="flex min-h-screen">
      {/* Sidebar TOC */}
      <aside className="w-64 shrink-0 border-r border-ink/10 bg-white flex flex-col">
        <div className="px-5 py-6 border-b border-ink/10">
          <p className="text-[10px] font-bold uppercase tracking-widest text-ink/40 mb-3">Admin Documentation</p>
          <button
            onClick={onLaunchTutorial}
            className="flex items-center gap-2 w-full rounded-xl bg-brand-500 px-4 py-2.5 text-sm font-semibold text-ink hover:bg-brand-400 transition-colors"
          >
            <Play className="h-4 w-4" />
            Launch Tutorial
          </button>
        </div>
        <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
          {SECTIONS.map(({ id, icon: Icon, title, execAdminOnly }) => (
            <button
              key={id}
              onClick={() => setActiveSection(id)}
              className={`flex items-center gap-3 w-full px-3 py-2.5 rounded-xl text-sm font-medium transition-all text-left ${
                activeSection === id
                  ? "bg-brand-500/10 text-ink"
                  : "text-ink/50 hover:bg-ink/5 hover:text-ink"
              }`}
            >
              <Icon className="h-4 w-4 shrink-0" />
              <span className="flex-1">{title}</span>
              {execAdminOnly && role === "executiveAdmin" && (
                <span className="text-[9px] font-bold uppercase tracking-wider text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded-full">Exec</span>
              )}
            </button>
          ))}
        </nav>
      </aside>

      {/* Content */}
      <main className="flex-1 overflow-y-auto">
        <div className="max-w-3xl px-10 py-10">
          {/* Section header */}
          <div className="mb-8">
            <div className="flex items-center gap-3 mb-2">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-100 text-brand-700">
                <section.icon className="h-5 w-5" />
              </div>
              <h1 className="text-2xl font-bold text-ink">{section.title}</h1>
            </div>
            <p className="text-sm text-ink/50">{section.subtitle}</p>
          </div>

          {/* Items */}
          <div className="space-y-8">
            {section.content.map((item, i) => (
              <div key={i} className="rounded-2xl border border-ink/8 bg-white p-6">
                <div className="flex items-start justify-between gap-3 mb-2">
                  <h2 className="font-semibold text-ink text-base">{item.title}</h2>
                  {item.badge === "exec-only" && (
                    <span className="shrink-0 text-[10px] font-bold uppercase tracking-wider text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full mt-0.5">
                      Executive Admin Only
                    </span>
                  )}
                </div>
                <p className="text-sm text-ink/60 leading-relaxed mb-4">{item.description}</p>
                {item.steps && (
                  <ol className="space-y-2">
                    {item.steps.map((step, j) => (
                      <li key={j} className="flex items-start gap-3 text-sm">
                        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand-100 text-brand-700 text-[10px] font-bold mt-0.5">
                          {j + 1}
                        </span>
                        <span className="text-ink/70 leading-relaxed">{step}</span>
                      </li>
                    ))}
                  </ol>
                )}
              </div>
            ))}
          </div>

          {/* Next section hint */}
          {SECTIONS.findIndex((s) => s.id === activeSection) < SECTIONS.length - 1 && (
            <button
              onClick={() => {
                const idx = SECTIONS.findIndex((s) => s.id === activeSection);
                setActiveSection(SECTIONS[idx + 1].id);
              }}
              className="mt-8 flex items-center gap-2 text-sm text-ink/40 hover:text-ink transition-colors"
            >
              Next: {SECTIONS[SECTIONS.findIndex((s) => s.id === activeSection) + 1].title}
              <ChevronRight className="h-4 w-4" />
            </button>
          )}
        </div>
      </main>
    </div>
  );
}
