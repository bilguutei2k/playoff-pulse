// Display wording for injury statuses and players. Formatting only; the model's
// numbers come from the published state.

import type { StatusCode } from "@/lib/season/availability";
import type { AbsenceDriver } from "@/lib/season/types";

export const STATUS_LABELS: Record<StatusCode, string> = {
  O: "Out",
  D: "Doubtful",
  Q: "Questionable",
  P: "Probable",
  A: "Available",
};

const SUFFIXES = new Set(["jr", "jr.", "sr", "sr.", "ii", "iii", "iv", "v"]);

/** "Jimmy Butler III" as "Butler", "Kentavious Caldwell-Pope" as "Caldwell-Pope". */
export function surname(name: string): string {
  const words = name.trim().split(/\s+/);
  while (words.length > 1 && SUFFIXES.has(words[words.length - 1].toLowerCase())) words.pop();
  return words[words.length - 1] ?? name;
}

/** A driver's status as shown: the report's word, or why he is counted without one. */
export function driverStatus(driver: Pick<AbsenceDriver, "status">): string {
  return driver.status ? STATUS_LABELS[driver.status] : "missed last game";
}

/** "Banchero (Out), Suggs (Out)", plus "and others" when more players share the points. */
export function driversText(drivers: readonly AbsenceDriver[], totalPoints: number): string {
  const named = drivers.map((driver) => `${surname(driver.name)} (${driverStatus(driver)})`).join(", ");
  const shown = drivers.reduce((sum, driver) => sum + driver.points, 0);
  return totalPoints - shown > 0.05 ? `${named}, and others` : named;
}

/** Points with one decimal, the precision the cards use. */
export function formatPoints(points: number): string {
  return `${points.toFixed(1)} pts`;
}
