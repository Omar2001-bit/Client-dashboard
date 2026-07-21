import { Outlet, NavLink, useNavigate } from "react-router-dom";
import { LayoutDashboard, Users, Settings, LogOut, MessageSquare, Activity, BookOpen } from "lucide-react";
import { useLogout } from "@/hooks/useAuth";
import { Logo } from "@/components/ui/Logo";
import { FloatingChat } from "@/components/FloatingChat";
import { AdminTutorial } from "@/components/AdminTutorial";
import { useAdminTutorial } from "@/hooks/useAdminTutorial";

const navItems = [
  { to: "/admin", icon: LayoutDashboard, label: "Overview", end: true },
  { to: "/admin/clients", icon: Users, label: "Clients" },
  { to: "/admin/logs", icon: Activity, label: "Client Logs" },
  { to: "/admin/support", icon: MessageSquare, label: "Support" },
  { to: "/admin/settings", icon: Settings, label: "Settings" },
  { to: "/admin/docs", icon: BookOpen, label: "Docs & Tutorial" },
];

export function AdminLayout() {
  const logout = useLogout();
  const navigate = useNavigate();
  const { active, currentStep, steps, start, next, skipStep, skipAll } = useAdminTutorial();

  const handleLogout = async () => {
    await logout();
    navigate("/");
  };

  return (
    <div className="min-h-screen flex bg-canvas">
      {/* Sidebar */}
      <aside className="w-64 bg-ink text-white flex flex-col">
        <div className="pl-14 pr-4 py-4 border-b border-white/10 flex items-center text-white">
          <Logo variant="full" tone="white" className="h-auto w-[92px]" />
        </div>
        <nav className="flex-1 px-4 py-6 space-y-1">
          {navItems.map(({ to, icon: Icon, label, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all ${
                  isActive
                    ? "bg-brand-500 text-ink-deep shadow-[0_0_0_1px_rgba(106,228,153,0.4)]"
                    : "text-white/70 hover:bg-white/5 hover:text-white"
                }`
              }
            >
              <Icon className="h-4 w-4" />
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="px-4 py-4 border-t border-white/10">
          <button
            onClick={handleLogout}
            className="flex items-center gap-3 px-3 py-2 rounded-xl text-sm font-medium text-white/60 hover:text-white hover:bg-white/5 w-full transition-colors"
          >
            <LogOut className="h-4 w-4" />
            Sign out
          </button>
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 overflow-auto">
        <Outlet context={{ startTutorial: start }} />
      </main>

      <FloatingChat />

      {active && (
        <AdminTutorial
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
