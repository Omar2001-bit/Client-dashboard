import { Outlet, NavLink, Link, useLocation, useNavigate } from "react-router-dom";
import { FlaskConical, LogOut, MessageSquare, CalendarDays, CalendarPlus, BookOpen, User, BarChart3, ListChecks, LineChart, ClipboardList, Gauge } from "lucide-react";
import { useLogout } from "@/hooks/useAuth";
import { useActivityTracker } from "@/hooks/useActivityTracker";
import { useTutorial } from "@/hooks/useTutorial";
import { Tutorial } from "@/components/tutorial/Tutorial";
import { Logo } from "@/components/ui/Logo";
import { FloatingChat } from "@/components/chat/FloatingChat";

const navItems = [
  {
    to: "/dashboard/ab-testing",
    icon: FlaskConical,
    label: "A/B Testing Results",
    // Dashboard View (/dashboard) and Experiments View (/dashboard/experiments) are
    // sibling routes, not nested under /dashboard/ab-testing, so NavLink's default
    // prefix matching can't highlight this item while inside either sub-view.
    isActiveMatch: (pathname: string) =>
      pathname === "/dashboard" ||
      pathname === "/dashboard/ab-testing" || pathname.startsWith("/dashboard/ab-testing/") ||
      pathname === "/dashboard/experiments" || pathname.startsWith("/dashboard/experiments/"),
  },
  { to: "/dashboard/ga4", icon: BarChart3, label: "GA4 Data View" },
  { to: "/dashboard/analytics-reports", icon: LineChart, label: "Analytics Reports" },
  { to: "/dashboard/page-speed", icon: Gauge, label: "Page Speed" },
  { to: "/dashboard/tasks", icon: ClipboardList, label: "Project Tasks" },
  { to: "/dashboard/timeline", icon: CalendarDays, label: "Timeline" },
  { to: "/dashboard/audit-findings", icon: ListChecks, label: "Audit Findings" },
  { to: "/dashboard/book-meeting", icon: CalendarPlus, label: "Book a Meeting" },
  { to: "/dashboard/support", icon: MessageSquare, label: "Support" },
  { to: "/dashboard/docs", icon: BookOpen, label: "Docs & Tutorial" },
  { to: "/dashboard/profile", icon: User, label: "Profile" },
];

export function ClientLayout() {
  const logout = useLogout();
  const navigate = useNavigate();
  const location = useLocation();
  useActivityTracker();
  const { active, currentStep, steps, start, next, skipStep, skipAll } = useTutorial();

  const handleLogout = async () => {
    await logout();
    navigate("/");
  };

  return (
    <div className="min-h-screen flex bg-canvas">
      <aside className="w-64 bg-white border-r border-ink/10 flex flex-col">
        <div className="pl-14 pr-4 py-4 border-b border-ink/5 flex items-center text-ink">
          <Logo variant="full" className="h-auto w-[92px]" />
        </div>
        <nav className="flex-1 px-4 py-6 space-y-1">
          {navItems.map(({ to, icon: Icon, label, isActiveMatch }) => {
            const linkClasses = (active: boolean) =>
              `flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all ${
                active
                  ? "bg-brand-500 text-ink-deep"
                  : "text-ink/60 hover:bg-ink/5 hover:text-ink"
              }`;

            if (isActiveMatch) {
              return (
                <Link key={to} to={to} className={linkClasses(isActiveMatch(location.pathname))}>
                  <Icon className="h-4 w-4" />
                  {label}
                </Link>
              );
            }

            return (
              <NavLink key={to} to={to} className={({ isActive }) => linkClasses(isActive)}>
                <Icon className="h-4 w-4" />
                {label}
              </NavLink>
            );
          })}
        </nav>
        <div className="px-4 py-4 border-t border-ink/5">
          <button
            onClick={handleLogout}
            className="flex items-center gap-3 px-3 py-2 rounded-xl text-sm font-medium text-ink/50 hover:text-ink hover:bg-ink/5 w-full transition-colors"
          >
            <LogOut className="h-4 w-4" />
            Sign out
          </button>
        </div>
      </aside>

      <main className="flex-1 overflow-auto">
        <Outlet context={{ startTutorial: start }} />
      </main>

      <FloatingChat />

      {active && (
        <Tutorial
          steps={steps}
          currentStep={currentStep}
          onNext={next}
          onSkipStep={skipStep}
          onSkipAll={skipAll}
        />
      )}
    </div>
  );
}
