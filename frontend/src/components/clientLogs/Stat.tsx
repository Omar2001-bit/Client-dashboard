export function Stat({ icon: Icon, label, value }: { icon: React.ElementType; label: string; value: string }) {
  return (
    <div className="flex items-center gap-2 whitespace-nowrap">
      <Icon className="h-3.5 w-3.5 text-ink/30" />
      <span className="text-xs text-ink/40">{label}</span>
      <span className="text-xs font-semibold text-ink">{value}</span>
    </div>
  );
}
