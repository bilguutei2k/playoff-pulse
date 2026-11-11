// Bins for probability cells (class names .heat-0 to .heat-8 on a .heat cell). In the
// v8 design there is no fill: every cell prints its value in ink, under 1% in grey
// (.heat-0) and 50% and up in bold (.heat-5 to .heat-8); the rules are in
// src/app/styles/shared.css. The labels name each bin for a legend.

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
