// Heat bins for probability cells. Every cell prints its value; the fill repeats it
// as magnitude on one ramp from the panel to teal (the --color-heat-* tokens in
// globals.css). Text flips to white at 60%, where the ramp jumps to its dark steps,
// so both sides of the flip keep AA contrast.

export const HEAT_BINS: Array<{ upTo: number; className: string; label: string }> = [
  { upTo: 0.005, className: "heat-0", label: "Under 1%" },
  { upTo: 0.1, className: "heat-1", label: "1 to 10%" },
  { upTo: 0.25, className: "heat-2", label: "10 to 25%" },
  { upTo: 0.4, className: "heat-3", label: "25 to 40%" },
  { upTo: 0.5, className: "heat-4", label: "40 to 50%" },
  { upTo: 0.6, className: "heat-5", label: "50 to 60%" },
  { upTo: 0.8, className: "heat-6", label: "60 to 80%" },
  { upTo: 0.95, className: "heat-7", label: "80 to 95%" },
  { upTo: Number.POSITIVE_INFINITY, className: "heat-8", label: "95% or more" },
];

export function heatClass(value: number): string {
  return (HEAT_BINS.find((bin) => value < bin.upTo) ?? HEAT_BINS[HEAT_BINS.length - 1]).className;
}
