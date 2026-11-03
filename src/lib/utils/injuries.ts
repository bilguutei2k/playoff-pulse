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

/**
 * The NBA report prints "Last, First": "Haliburton, Tyrese" reads "Tyrese Haliburton",
 * "Nance Jr., Larry" reads "Larry Nance Jr." and "Udeh, Jr., Ernest" reads "Ernest Udeh Jr.".
 * A name without a comma is returned as it is.
 */
export function displayName(printed: string): string {
  const parts = printed.split(",").map((part) => part.trim()).filter(Boolean);
  if (parts.length < 2) return printed.trim();
  const first = parts[parts.length - 1];
  return [first, ...parts.slice(0, -1)].join(" ");
}

/** A name reduced for matching: accents, punctuation and suffixes dropped, lower case. */
export function nameKey(name: string): string {
  return displayName(name)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z\s-]/g, "")
    .split(/[\s-]+/)
    .filter((word) => word && !SUFFIXES.has(word))
    .join(" ");
}

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
