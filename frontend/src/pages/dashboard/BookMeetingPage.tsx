import { CalendarPlus, BriefcaseBusiness, Wrench } from "lucide-react";
import { track } from "@/lib/activityTracker";

const BUSINESS_MEETING_URL = "https://calendly.com/alia-optimizers/30min";
const TECHNICAL_MEETING_URL = "https://calendly.com/omar-optimizers/30min";

function MeetingOption({
  title,
  description,
  href,
  icon: Icon,
  accent,
}: {
  title: string;
  description: string;
  href: string;
  icon: typeof CalendarPlus;
  accent: string;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      onClick={() => track({ type: "meeting_type_selected", metadata: { meetingType: title } })}
      className="group block rounded-3xl border border-ink/10 bg-white p-6 shadow-[0_12px_30px_rgba(14,28,38,0.06)] transition-transform hover:-translate-y-1 hover:shadow-[0_18px_40px_rgba(14,28,38,0.1)]"
    >
      <div className="flex items-start gap-4">
        <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl" style={{ backgroundColor: accent }}>
          <Icon className="h-6 w-6 text-white" />
        </span>
        <div className="min-w-0">
          <p className="text-lg font-semibold text-ink">{title}</p>
          <p className="mt-1 text-sm leading-relaxed text-ink/60">{description}</p>
          <div className="mt-4 inline-flex items-center gap-2 rounded-full bg-ink/[0.03] px-4 py-2 text-sm font-medium text-ink/70 group-hover:text-ink">
            Open Calendly
            <span className="text-ink/30">→</span>
          </div>
        </div>
      </div>
    </a>
  );
}

export function BookMeetingPage() {
  return (
    <div className="p-8">
      <div className="mx-auto max-w-5xl space-y-8">
        <div className="rounded-[2rem] border border-ink/10 bg-[radial-gradient(circle_at_top_left,_rgba(106,228,153,0.22),_transparent_34%),linear-gradient(135deg,_#f8fbfc_0%,_#ffffff_52%,_#f3f7fb_100%)] p-8 shadow-[0_12px_35px_rgba(14,28,38,0.05)]">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full bg-white px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-ink/50 shadow-sm">
                <CalendarPlus className="h-3.5 w-3.5" />
                Book a Meeting
              </div>
              <h1 className="mt-4 text-3xl font-bold tracking-tight text-ink sm:text-4xl">
                Choose the meeting type that fits the next step.
              </h1>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-ink/60">
                Pick a business meeting for strategy and commercial discussion, or a technical meeting for implementation and product details.
              </p>
            </div>
            <div className="rounded-2xl border border-ink/10 bg-white/80 px-4 py-3 text-sm text-ink/60 shadow-sm backdrop-blur">
              Click once, then continue in Calendly.
            </div>
          </div>
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          <div data-tutorial="meeting-business">
            <MeetingOption
              title="Business Meeting"
              description="Use this for commercial discussions, priorities, planning, and next-step alignment with the team."
              href={BUSINESS_MEETING_URL}
              icon={BriefcaseBusiness}
              accent="#6ae499"
            />
          </div>
          <div data-tutorial="meeting-technical">
            <MeetingOption
              title="Technical Meeting"
              description="Use this for implementation details, tracking issues, integrations, or deeper product and campaign questions."
              href={TECHNICAL_MEETING_URL}
              icon={Wrench}
              accent="#7cb7ff"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
