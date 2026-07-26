import { scoreColor, scoreRingColor } from "@/lib/pageSpeedScoreColor";

export function ScoreGauge({ score, size = 96, label }: { score: number; size?: number; label: string }) {
  const radius = (size - 10) / 2;
  const circumference = 2 * Math.PI * radius;
  const progress = (score / 100) * circumference;
  const color = scoreRingColor(score);

  return (
    <div className="flex flex-col items-center gap-2">
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="currentColor" strokeWidth={5} className="text-ink/5" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={5}
          strokeDasharray={circumference}
          strokeDashoffset={circumference - progress}
          strokeLinecap="round"
          className="transition-all duration-1000 ease-out"
        />
      </svg>
      <div className="absolute flex flex-col items-center justify-center" style={{ width: size, height: size }}>
        <span className={`text-2xl font-bold ${scoreColor(score)}`}>{score}</span>
      </div>
      <p className="text-xs font-semibold uppercase tracking-wider text-ink/40">{label}</p>
    </div>
  );
}
