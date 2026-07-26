import { LayoutDashboard, FlaskConical } from "lucide-react";
import { track } from "@/lib/activityTracker";
import { ChoiceCard } from "@/components/ui";

export function ABTestingResultsPage() {
  return (
    <div className="p-8">
      <div className="mx-auto max-w-5xl space-y-8">
        <div className="rounded-[2rem] border border-ink/10 bg-[radial-gradient(circle_at_top_left,_rgba(124,183,255,0.24),_transparent_30%),linear-gradient(135deg,_#f8fbfc_0%,_#ffffff_52%,_#f3f7fb_100%)] p-8 shadow-[0_12px_35px_rgba(22,42,61,0.05)]">
          <div className="inline-flex items-center gap-2 rounded-full bg-white px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-ink/50 shadow-sm">
            <FlaskConical className="h-3.5 w-3.5" />
            A/B Testing Results
          </div>
          <h1 className="mt-4 text-3xl font-bold tracking-tight text-ink sm:text-4xl">
            Choose which A/B testing view you want to open.
          </h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-ink/60">
            The dashboard gives the summary view of the experiment outcomes. The experiments page shows the per-experiment breakdown.
          </p>
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          <ChoiceCard
            to="/dashboard"
            title="Dashboard View"
            description="Open the main A/B testing dashboard with topline results, revenue, ROI, and aggregated performance."
            icon={LayoutDashboard}
            onClick={() => track({ type: "ab_testing_view_selected", metadata: { view: "Dashboard View" } })}
          />
          <ChoiceCard
            to="/dashboard/experiments"
            title="Experiments View"
            description="Open the experiments list to inspect each test, metrics, overrides, and experiment-level details."
            icon={FlaskConical}
            onClick={() => track({ type: "ab_testing_view_selected", metadata: { view: "Experiments View" } })}
          />
        </div>
      </div>
    </div>
  );
}
