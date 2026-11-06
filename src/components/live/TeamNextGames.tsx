import type { NextGameBar } from "@/lib/view/team-page";

function Bars({ bars, color, width }: { bars: NextGameBar[]; color: string; width: number }) {
  const height = 194;
  const left = 26;
  const floor = 160;
  const top = 20;
  const y = (percent: number) => floor - (percent / 100) * (floor - top);
  const slot = (width - left) / Math.max(bars.length, 1);
  const bar = Math.min(47, slot * 0.8);
  const dates = slot >= 40;
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="block h-auto w-full" aria-hidden>
      {[0, 50, 100].map((tick) => (
        <g key={tick}>
          <line
            x1={left}
            x2={width}
            y1={y(tick)}
            y2={y(tick)}
            stroke={tick === 0 ? "#111111" : "#dcdcdc"}
            strokeDasharray={tick === 50 ? "4 4" : undefined}
          />
          <text x={0} y={y(tick) + 4} fontSize={11} fill="#666666">
            {tick}%
          </text>
        </g>
      ))}
      {bars.map((entry, index) => {
        const x = left + index * slot + (slot - bar) / 2;
        const barTop = y(entry.percent);
        return (
          <g key={entry.gameId}>
            {entry.sealed ? (
              <rect x={x} y={barTop} width={bar} height={floor - barTop} fill={color} />
            ) : (
              <rect
                x={x + 1}
                y={barTop}
                width={bar - 2}
                height={floor - barTop}
                fill="#ffffff"
                stroke={color}
                strokeWidth={2}
                strokeDasharray="5 3"
              />
            )}
            <text x={x + bar / 2} y={barTop - 7} fontSize={11.5} fontWeight={700} fill="#111111" textAnchor="middle">
              {entry.percent}
            </text>
            <text x={x + bar / 2} y={175} fontSize={10.5} fill="#666666" textAnchor="middle">
              {entry.label}
            </text>
            {dates ? (
              <text x={x + bar / 2} y={189} fontSize={10} fill="#666666" textAnchor="middle">
                {entry.date}
              </text>
            ) : null}
          </g>
        );
      })}
    </svg>
  );
}

/**
 * The team's chance in each of its next games. Dashed outline: a projection, never
 * scored. Solid: a sealed number. Drawn at a fixed width per breakpoint so labels
 * stay legible.
 */
export function TeamNextGames({ bars, color, name }: { bars: NextGameBar[]; color: string; name: string }) {
  const summary = bars
    .map((entry) => `${entry.label} ${entry.date}: ${entry.percent}%${entry.sealed ? ", sealed" : ", projection"}`)
    .join("; ");
  return (
    <figure role="img" aria-label={`${name} chance in the next ${bars.length} games. ${summary}.`}>
      <div className="sm:hidden">
        <Bars bars={bars} color={color} width={360} />
      </div>
      <div className="hidden sm:block">
        <Bars bars={bars} color={color} width={616} />
      </div>
    </figure>
  );
}
