// Heat bins for probability cells. Every cell prints its value; the tint repeats
// it as magnitude on a single blue ramp (see the --heat-* tokens in globals.css).

export const HEAT_BINS: Array<{ upTo: number; className: string; label: string }> = [
  { upTo: 0.005, className: "pp-heat-zero", label: "Under 1%" },
  { upTo: 0.1, className: "pp-heat-1", label: "1-10%" },
  { upTo: 0.25, className: "pp-heat-2", label: "10-25%" },
  { upTo: 0.5, className: "pp-heat-3", label: "25-50%" },
  { upTo: 0.75, className: "pp-heat-4", label: "50-75%" },
  { upTo: Number.POSITIVE_INFINITY, className: "pp-heat-5", label: "75% or more" },
];

export function heatClass(value: number): string {
  return (HEAT_BINS.find((bin) => value < bin.upTo) ?? HEAT_BINS[HEAT_BINS.length - 1]).className;
}
