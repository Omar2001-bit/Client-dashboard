import { Link } from "react-router-dom";
import { ArrowRight, type LucideIcon } from "lucide-react";

interface ChoiceCardProps {
  title: string;
  description: string;
  icon: LucideIcon;
  /** Internal route — renders as a react-router Link. Mutually exclusive with `href`. */
  to?: string;
  /** External URL — renders as an `<a target="_blank">`. Mutually exclusive with `to`. */
  href?: string;
  /** Icon chip background color. Defaults to the neutral ink-tinted chip. */
  accent?: string;
  ctaLabel?: string;
  onClick?: () => void;
}

export function ChoiceCard({ title, description, icon: Icon, to, href, accent, ctaLabel = "Open view", onClick }: ChoiceCardProps) {
  const className = "group block rounded-3xl border border-ink/10 bg-white p-6 shadow-[0_12px_30px_rgba(22,42,61,0.06)] transition-transform hover:-translate-y-1 hover:shadow-[0_18px_40px_rgba(22,42,61,0.1)]";

  const content = (
    <div className="flex items-start gap-4">
      <span
        className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl ${accent ? "" : "bg-ink/[0.04]"}`}
        style={accent ? { backgroundColor: accent } : undefined}
      >
        <Icon className={`h-6 w-6 ${accent ? "text-white" : "text-ink"}`} />
      </span>
      <div className="min-w-0">
        <p className="text-lg font-semibold text-ink">{title}</p>
        <p className="mt-1 text-sm leading-relaxed text-ink/60">{description}</p>
        <div className="mt-4 inline-flex items-center gap-2 rounded-full bg-ink/[0.03] px-4 py-2 text-sm font-medium text-ink/70 group-hover:text-ink">
          {ctaLabel}
          <ArrowRight className="h-4 w-4" />
        </div>
      </div>
    </div>
  );

  if (to) {
    return (
      <Link to={to} onClick={onClick} className={className}>
        {content}
      </Link>
    );
  }

  return (
    <a href={href} target="_blank" rel="noreferrer" onClick={onClick} className={className}>
      {content}
    </a>
  );
}
