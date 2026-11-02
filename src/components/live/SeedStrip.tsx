import { ordinal } from "@/lib/view/teams";

/**
 * Fifteen thin columns, one per seed, height by probability on a shared scale. Seeds
 * 1 to 6 are teal, 7 to 10 (the play-in) a lighter teal, 11 to 15 gray. The label
 * names the likeliest seed so the strip is never the only way to read it.
 */
export function SeedStrip({ seeds, scale, name }: { seeds: number[]; scale: number; name: string }) {
  const height = 22;
  const bar = 4;
  const gap = 1;
  const likeliest = seeds.reduce((best, value, index) => (value > seeds[best] ? index : best), 0);
  const label = `${name}: likeliest seed ${ordinal(likeliest + 1)} (${Math.round(seeds[likeliest] * 100)}%)`;
  return (
    <svg
      role="img"
      aria-label={label}
      width={seeds.length * (bar + gap) - gap}
      height={height}
      viewBox={`0 0 ${seeds.length * (bar + gap) - gap} ${height}`}
      className="block"
    >
      <title>{label}</title>
      {seeds.map((value, index) => {
        const h = value <= 0 ? 0 : Math.max(1, (value / scale) * height);
        const fill = index < 6 ? "#0b6e55" : index < 10 ? "#8ab2a3" : "#b9b5ae";
        return (
          <g key={index}>
            <rect x={index * (bar + gap)} y={height - 1} width={bar} height={1} fill="#e6e3de" />
            {h > 0 ? (
              <rect x={index * (bar + gap)} y={height - h} width={bar} height={h} rx={1} fill={fill}>
                <title>{`${ordinal(index + 1)} seed: ${value < 0.005 && value > 0 ? "<1" : Math.round(value * 100)}%`}</title>
              </rect>
            ) : null}
          </g>
        );
      })}
    </svg>
  );
}
