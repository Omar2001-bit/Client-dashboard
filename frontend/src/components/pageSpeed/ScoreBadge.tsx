import { Badge } from "@/components/ui/Badge";

export function ScoreBadge({ score }: { score: number }) {
  const tone = score >= 90 ? "success" : score >= 50 ? "warning" : "danger";
  return (
    <Badge tone={tone} className="justify-center rounded-lg px-2.5 py-1 text-sm font-bold">
      {score}
    </Badge>
  );
}
