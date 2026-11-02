// Words and numbers for a game card and the game page, from a day view's game.
// Formatting only: every probability and margin comes from a seal, a provisional
// number, a projection or the in-game estimate already computed upstream.

import { STATUS_LABELS, surname } from "@/lib/utils/injuries";
import { formatTimeEt } from "@/lib/utils/dates";
import type { DayGame } from "@/lib/view/day";
import { teamDisplay } from "@/lib/view/teams";

export type Tone = "good" | "warn" | "bad" | "quiet";

export type Badge = { label: string; tone: Tone; detail: string };

/** Whole percents for the two sides that always add to 100. */
export function splitPercents(homeProbability: number): { home: number; away: number } {
  const home = Math.min(99, Math.max(1, Math.round(homeProbability * 100)));
  return { home, away: 100 - home };
}

/** "+3", "−3" or "0": the model's whole percent minus the market's. */
export function formatDiff(model: number, market: number): string {
  const diff = model - market;
  if (diff === 0) return "0";
  return `${diff > 0 ? "+" : "−"}${Math.abs(diff)}`;
}

/** "548 favors CLE by 2.0", or an even game. */
export function marginText(expectedMargin: number, homeId: string, awayId: string): string {
  if (Math.abs(expectedMargin) < 0.05) return "548 has it even";
  const favorite = teamDisplay(expectedMargin > 0 ? homeId : awayId).code;
  return `548 favors ${favorite} by ${Math.abs(expectedMargin).toFixed(1)}`;
}

/** "CLE −4.5" from the market's home spread, or "Pick'em". */
export function spreadText(homeSpread: number, homeId: string, awayId: string): string {
  if (homeSpread === 0) return "Pick'em";
  const favoriteId = homeSpread < 0 ? homeId : awayId;
  return `${teamDisplay(favoriteId).code} −${Math.abs(homeSpread).toFixed(1)}`;
}

/** ESPN's "9:56 - 3rd" reads better as "3rd 9:56". */
export function liveClock(detail: string): string {
  const match = /^([\d:.]+)\s*-\s*(.+)$/.exec(detail.trim());
  return match ? `${match[2]} ${match[1]}` : detail.trim();
}

export function statusLabel(game: Pick<DayGame, "status" | "statusDetail">): {
  label: string;
  live: boolean;
} {
  switch (game.status) {
    case "in-progress":
      return { label: game.statusDetail ? `Live · ${liveClock(game.statusDetail)}` : "Live", live: true };
    case "final":
      return { label: /OT/i.test(game.statusDetail) ? game.statusDetail.replace(/^Final\s*\/?\s*/i, "Final/") : "Final", live: false };
    case "postponed":
      return { label: "Postponed", live: false };
    case "canceled":
      return { label: "Canceled", live: false };
    default:
      return { label: "Scheduled", live: false };
  }
}

/** "7:30 PM ET · Rocket Arena, Cleveland, OH · NBCSN". */
export function metaLine(game: Pick<DayGame, "tipUtc" | "extras" | "neutral">): string[] {
  const parts = [formatTimeEt(game.tipUtc)];
  if (game.extras?.venue) parts.push(game.extras.city ? `${game.extras.venue}, ${game.extras.city}` : game.extras.venue);
  else if (game.neutral) parts.push("Neutral site");
  if (game.extras?.broadcast) parts.push(game.extras.broadcast);
  return parts;
}

/** What the number on the card is, and how it counts. */
export function forecastBadge(game: DayGame, modelVersion: string): Badge | null {
  if (game.missed) {
    return {
      label: "Missed",
      tone: "bad",
      detail: "Tipped before a forecast was sealed. Counted as missed in the record, never backfilled.",
    };
  }
  if (game.beforeRecord) {
    return { label: "Before the record", tone: "quiet", detail: "Tipped before the first seal, so it was never in the record." };
  }
  if (game.projection) {
    return { label: "Projection", tone: "quiet", detail: "From current ratings, before injuries. Not sealed, never scored." };
  }
  const forecast = game.forecast;
  if (!forecast) return null;
  if (forecast.source === "provisional") {
    return {
      label: "Provisional",
      tone: "warn",
      detail: "Not sealed yet. From the latest ratings and published absences; replaced by the seal and never scored.",
    };
  }
  const time = forecast.issuedAt ? formatTimeEt(forecast.issuedAt) : "";
  const incomplete = forecast.inputsIncomplete ? " An earlier result was missing from its ratings; it still counts." : "";
  if (forecast.modelVersion !== modelVersion) {
    return {
      label: `Sealed ${time}`.trim(),
      tone: forecast.inputsIncomplete ? "warn" : "good",
      detail: `Sealed by ${forecast.modelVersion}, which does not account for injuries.${incomplete}`,
    };
  }
  // Only a version that seals twice can lack a final seal; v1 rows carry no seal kind.
  const row = game.sealRows.find(
    (candidate) => candidate.modelVersion === forecast.modelVersion && candidate.issuedAt === forecast.issuedAt,
  );
  const twoSeals = row?.sealKind !== undefined;
  if (!twoSeals) {
    return {
      label: `Sealed ${time}`.trim(),
      tone: forecast.inputsIncomplete ? "warn" : "good",
      detail: `Sealed ${time} by ${forecast.modelVersion}, which seals each game once and does not account for injuries. This is the number the record scores.${incomplete}`,
    };
  }
  if (game.noFinalSeal) {
    return {
      label: "No final seal",
      tone: "warn",
      detail: `No final seal in the hour before tip, so the ${forecast.sealKind === "reissued" ? "reissued " : ""}morning seal from ${time} is scored.${incomplete}`,
    };
  }
  const kind =
    forecast.sealKind === "final"
      ? "Final seal"
      : forecast.sealKind === "morning"
        ? "Morning seal"
        : forecast.sealKind === "reissued"
          ? "Reissued"
          : "Sealed";
  return {
    label: `${kind} ${time}`.trim(),
    tone: forecast.inputsIncomplete ? "warn" : "good",
    detail:
      forecast.sealKind === "reissued"
        ? `Reissued ${time}, because the morning seal was made before a usable NBA injury report arrived. A final seal replaces it in the hour before tip.${incomplete}`
        : forecast.sealKind === "morning"
          ? `Sealed ${time}. A final seal replaces it in the hour before tip.${incomplete}`
          : `Sealed ${time}. This is the number the record scores.${incomplete}`,
  };
}

const STATUS_WORDS: Record<string, string> = {
  O: "out",
  D: "doubtful",
  Q: "questionable",
  P: "probable",
  A: "available",
};

/**
 * "BOS −3.1: Tatum out, Brown doubtful" for each side whose expected absences move
 * the line by at least a point. Null for a number without the injury term.
 */
export function injuryNotes(game: Pick<DayGame, "forecast" | "homeId" | "awayId">, threshold = 1): string[] | null {
  const forecast = game.forecast;
  if (!forecast || !forecast.absencePoints || !forecast.drivers) return null;
  const notes: string[] = [];
  for (const side of ["away", "home"] as const) {
    const points = forecast.absencePoints[side];
    if (points < threshold) continue;
    const teamId = side === "home" ? game.homeId : game.awayId;
    const names = forecast.drivers[side]
      .map((driver) => `${surname(driver.name)} ${driver.status ? STATUS_WORDS[driver.status] ?? STATUS_LABELS[driver.status].toLowerCase() : "missed last game"}`)
      .join(", ");
    notes.push(`${teamDisplay(teamId).code} −${points.toFixed(1)}${names ? `: ${names}` : ""}`);
  }
  return notes;
}

/** "Cavaliers won 112–104. 548 gave them 57%." for a final with a sealed number. */
export function resultLine(game: DayGame): string | null {
  if (game.status !== "final" || game.homeScore === null || game.awayScore === null) return null;
  const homeWon = game.homeScore > game.awayScore;
  const winner = teamDisplay(homeWon ? game.homeId : game.awayId).shortName;
  const high = Math.max(game.homeScore, game.awayScore);
  const low = Math.min(game.homeScore, game.awayScore);
  const base = `${winner} won ${high}–${low}.`;
  if (!game.forecast || game.forecast.source !== "sealed") return base;
  const { home, away } = splitPercents(game.forecast.homeWinProbability);
  return `${base} 548 gave them ${homeWon ? home : away}%.`;
}
