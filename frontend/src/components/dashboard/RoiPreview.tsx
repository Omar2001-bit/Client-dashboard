export function RoiPreview({ nodeCount }: { nodeCount: number | undefined }) {
  const preNodes = [0, 0.25, 0.5, 0.75, 1];
  const postCount = nodeCount ?? 2;
  const postNodes = Array.from({ length: postCount }, (_, i) => i + 2);
  const allNodes = [...preNodes, ...postNodes];
  const max = postNodes.length > 0 ? postNodes[postNodes.length - 1] : 1;
  const preZone = 30;
  const toPos = (m: number) =>
    m <= 1 ? (m / 1) * preZone : preZone + ((m - 1) / Math.max(max - 1, 1)) * (100 - preZone);

  const labels: Record<number, string> = { 0: "0%", 0.25: "25%", 0.5: "50%", 0.75: "75%", 1: "Breakeven" };

  return (
    <div className="relative h-16 mt-6 mx-4">
      <div className="absolute inset-x-0 top-6 h-2 rounded-full bg-ink/10" />
      <div className="absolute top-6 h-2 w-[30%] rounded-full bg-brand-400/60" />
      {allNodes.map((m) => (
        <div
          key={m}
          className="absolute flex flex-col items-center"
          style={{ left: `${toPos(m)}%`, transform: "translateX(-50%)" }}
        >
          <span className="text-[9px] text-ink/40 mb-1 whitespace-nowrap">
            {labels[m] ?? `${m}x`}
          </span>
          <div className="w-0.5 h-3 bg-ink/30 mt-5" />
        </div>
      ))}
    </div>
  );
}
