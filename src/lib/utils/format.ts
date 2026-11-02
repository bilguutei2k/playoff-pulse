export function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

export function formatNumber(value: number, decimals = 1): string {
  return value.toFixed(decimals);
}

export function formatSigned(value: number, decimals = 1): string {
  const formatted = value.toFixed(decimals);
  return value > 0 ? `+${formatted}` : formatted;
}

/** A short "how long ago" from an age in milliseconds. */
export function formatAge(ageMs: number): string {
  const minutes = Math.floor(Math.max(0, ageMs) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  return `${Math.floor(hours / 24)} days ago`;
}

/**
 * A probability as a whole percent for the live pages: "<1%" and ">99%" at the
 * ends, so a simulated long shot never reads as impossible. Pass `exact` where a
 * 0 or 1 is a settled fact rather than a simulation count, such as an eliminated
 * team in the playoffs, to show "0%" and "100%". The archive keeps `formatPercent`.
 */
export function formatChance(value: number, options: { exact?: boolean } = {}): string {
  const bounded = Math.min(1, Math.max(0, value));
  if (options.exact && bounded === 0) return "0%";
  if (options.exact && bounded === 1) return "100%";
  if (bounded < 0.005) return "<1%";
  if (bounded >= 0.995) return ">99%";
  return `${Math.round(bounded * 100)}%`;
}

/** A change in probability as signed percentage points, e.g. "+1.4" or "−0.6". */
export function formatPointChange(change: number): string {
  const points = change * 100;
  if (Math.abs(points) < 0.05) return "0.0";
  return `${points > 0 ? "+" : "−"}${Math.abs(points).toFixed(1)}`;
}
