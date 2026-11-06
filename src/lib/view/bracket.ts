// The v8 game card ("bracket card") as plain data: each team's line, the tile at the
// end of the bracket, the status row and the context row. Formatting and bookkeeping
// only: every probability is a seal's, the provisional number, a projection or the
// in-game estimate, already computed upstream; whole percents come from
// `splitPercents`, so a game's two sides always add to 100.

import { formatTimeEt, formatWeekday } from "@/lib/utils/dates";
import { forecastBadge, splitPercents } from "@/lib/view/card";
import type { DayGame } from "@/lib/view/day";
import { formatRecord, teamDisplay, type TeamLine } from "@/lib/view/teams";

/** Solid: sealed, scored. Live: the in-game estimate. Dash: never scored. */
export type TileKind = "sealed" | "live" | "dash";

export type BracketSide = {
  teamId: string;
  code: string;
  shortName: string;
  name: string;
  record: string | null;
  score: number | null;
  /** The team's whole-percent chance in the shown number: the length of its line. */
  percent: number | null;
  /** Grey tick: the market's chance for this team, beside sealed pregame numbers only. */
  marketPercent: number | null;
  /** Black tick: the pregame seal's chance for this team, on a live estimate. */
  pregamePercent: number | null;
  /** The loser of a final, or the side behind in a live game. */
  dim: boolean;
};

export type BracketTile =
  | { kind: TileKind; percent: number; code: string; label: string }
  | { kind: "none"; text: string };

export type BracketView = {
  status: { lead: string; detail: string | null; right: string | null; title: string | null };
  away: BracketSide;
  home: BracketSide;
  tile: BracketTile;
  /** The bracket is dashed for numbers that are never scored. */
  dashed: boolean;
  /** Each side's expected absence points, largest gap first, and sides that had not filed. */
  out: Array<{ code: string; points: number }>;
  unfiled: string[];
  /** The market for the tile's team; "none" when a sealed pregame number has no line yet. */
  market: { code: string; percent: number } | "none" | null;
  /** On a live estimate: the pregame seal for the tile's team. */
  pregame: { code: string; percent: number } | null;
  notes: string[];
};

/** "7:30 PM": the card's clock. Day pages say "All times ET" once, above the cards. */
export function cardClock(iso: string): string {
  return formatTimeEt(iso).replace(/ ET$/, "");
}

/** ESPN's "0:20 - 4th" as "4th · 0:20"; anything else ("Halftime") as it is. */
export function cardLiveClock(detail: string): string {
  const match = /^([\d:.]+)\s*-\s*(.+)$/.exec(detail.trim());
  return match ? `${match[2]} · ${match[1]}` : detail.trim();
}

function sealWord(game: DayGame, modelVersion: string): string {
  const forecast = game.forecast;
  if (!forecast) return "";
  if (forecast.source === "provisional") return "provisional";
  if (forecast.modelVersion !== modelVersion) return `model ${forecast.modelVersion.split("-").at(-1)}`;
  if (game.noFinalSeal) return `${cardClock(forecast.issuedAt ?? game.tipUtc)} seal`;
  if (forecast.sealKind === "reissued") return "reissued";
  if (forecast.sealKind === "morning") return "morning seal";
  return "sealed";
}

function statusRow(game: DayGame, modelVersion: string, future: boolean): BracketView["status"] {
  const badge = forecastBadge(game, modelVersion);
  const clock = cardClock(game.tipUtc);
  const forecast = game.forecast;
  const sealedAt = forecast?.source === "sealed" && forecast.issuedAt ? cardClock(forecast.issuedAt) : null;
  let right: string | null = null;
  if (game.missed) right = "Missed";
  else if (forecast?.source === "provisional") right = "Not sealed yet";
  else if (forecast?.source === "sealed") {
    if (game.noFinalSeal) right = "No final seal";
    else if (forecast.inputsIncomplete) right = "Sealed, incomplete";
    else if (forecast.sealKind === "reissued") right = `Reissued ${sealedAt}`;
    else right = sealedAt ? `Sealed ${sealedAt}` : "Sealed";
  }
  const title = badge?.detail ?? null;
  switch (game.status) {
    case "in-progress":
      return { lead: "Live", detail: game.statusDetail ? cardLiveClock(game.statusDetail) : null, right, title };
    case "final": {
      const overtime = /OT/i.test(game.statusDetail) ? game.statusDetail.replace(/^Final\s*\/?\s*/i, "") : null;
      return { lead: "Final", detail: overtime ? `${overtime} · ${clock}` : clock, right, title };
    }
    case "postponed":
      return { lead: "Postponed", detail: `was ${clock}`, right, title };
    case "canceled":
      return { lead: "Canceled", detail: `was ${clock}`, right, title };
    default:
      return { lead: future ? `${formatWeekday(game.etDate)} ${clock}` : clock, detail: game.extras?.broadcast ?? null, right, title };
  }
}

export function bracketView(input: {
  game: DayGame;
  lines: Record<string, TeamLine>;
  modelVersion: string;
  /** Say on the card when its number predates the injury model. Off when the page says it. */
  modelNote?: boolean;
  /** Show the weekday in the status row (a future day's cards on another day's page). */
  future?: boolean;
}): BracketView {
  const { game, lines, modelVersion, modelNote = true, future = false } = input;
  const live = game.status === "in-progress" && game.inGameHomeProbability !== null;
  const tipped = game.status === "in-progress" || game.status === "final";
  const pregame = game.forecast?.homeWinProbability ?? game.projection?.homeWinProbability ?? null;
  const shown = live ? game.inGameHomeProbability : pregame;
  const percents = shown !== null ? splitPercents(shown) : null;
  const sealed = game.forecast?.source === "sealed";
  // The market sits beside sealed pregame numbers only: never beside a projection, a
  // provisional number or a live estimate.
  const market = game.market && sealed && !live ? splitPercents(game.market.homeWinProbability) : null;
  const pre = live && pregame !== null ? splitPercents(pregame) : null;
  const scores = tipped && game.homeScore !== null && game.awayScore !== null;
  const homeAhead = scores ? Math.sign(game.homeScore! - game.awayScore!) : 0;

  const side = (key: "home" | "away"): BracketSide => {
    const teamId = key === "home" ? game.homeId : game.awayId;
    const team = teamDisplay(teamId);
    const line = lines[teamId];
    const dim = scores && homeAhead !== 0 && (key === "home" ? homeAhead < 0 : homeAhead > 0);
    return {
      teamId,
      code: team.code,
      shortName: team.shortName,
      name: team.name,
      record: line && line.wins + line.losses > 0 ? formatRecord(line.wins, line.losses) : line ? "0–0" : null,
      score: scores ? (key === "home" ? game.homeScore : game.awayScore) : null,
      percent: percents ? percents[key] : null,
      marketPercent: market ? market[key] : null,
      pregamePercent: pre ? pre[key] : null,
      dim,
    };
  };
  const away = side("away");
  const home = side("home");

  // The tile names the side 548 favors in the shown number.
  const pick = percents ? (percents.home >= percents.away ? home : away) : null;
  let tile: BracketTile;
  if (game.missed) tile = { kind: "none", text: "No seal" };
  else if (game.beforeRecord) tile = { kind: "none", text: "Not in the record" };
  else if (!percents || !pick) tile = { kind: "none", text: "No number yet" };
  else if (live) tile = { kind: "live", percent: pick.percent!, code: pick.code, label: "live estimate" };
  else if (game.projection) tile = { kind: "dash", percent: pick.percent!, code: pick.code, label: "projection" };
  else if (game.forecast?.source === "provisional")
    tile = { kind: "dash", percent: pick.percent!, code: pick.code, label: "provisional" };
  else tile = { kind: "sealed", percent: pick.percent!, code: pick.code, label: sealWord(game, modelVersion) };

  const out: BracketView["out"] = [];
  const unfiled: string[] = [];
  if (game.absences) {
    for (const key of ["away", "home"] as const) {
      const absence = game.absences[key];
      const code = teamDisplay(absence.teamId).code;
      if (absence.points >= 0.05) out.push({ code, points: absence.points });
      if (absence.filing !== "filed" && absence.points < 0.05) unfiled.push(code);
    }
  }

  const notes: string[] = [];
  if (game.missed) notes.push("Counted as missed. Never backfilled.");
  else if (game.beforeRecord) notes.push("Tipped before the record began.");
  else if (game.projection) {
    const basis = game.projection.basis;
    notes.push(
      !game.projection.withInjuries || !basis
        ? "Before injuries. Never scored."
        : basis.kind === "current-absences"
          ? "Injuries from current absences; no report yet. Never scored."
          : "Injuries from the NBA report. Never scored.",
    );
  } else if (game.forecast?.source === "provisional") notes.push("Replaced by the seal. Never scored.");
  else if (game.forecast) {
    if (game.forecast.availabilityMissing) notes.push("No injury report yet");
    if (game.noFinalSeal) notes.push(`Scored on the ${game.forecast.sealKind === "reissued" ? "reissued" : "morning"} seal`);
    if (game.forecast.inputsIncomplete) notes.push("A prior result was missing. Still counts.");
    if (modelNote && game.forecast.absencePoints === null) notes.push("Before injuries");
    if (game.status === "postponed" || game.status === "canceled") notes.push("Seal kept as written");
  }

  return {
    status: statusRow(game, modelVersion, future),
    away,
    home,
    tile,
    dashed: tile.kind === "dash",
    out,
    unfiled,
    market:
      market && pick ? { code: pick.code, percent: pick === home ? market.home : market.away } : sealed && !live && !tipped && !game.market ? "none" : null,
    pregame: pre && pick ? { code: pick.code, percent: pick === home ? pre.home : pre.away } : null,
    notes,
  };
}

/** "−3.8": a side's expected absence points as the card prints them. */
export function outPoints(points: number): string {
  return `−${points.toFixed(1)}`;
}
