// The injury lists as the injuries page, the team page and the game page show them: each
// team's list for its next game (`TeamInjuriesFile`), and for a game that is not a team's
// next one, the players its projection counts (`ProjectionsFile`). Wording and grouping
// only: statuses and reasons are the NBA report's, points are the model's as published.

import type { StatusCode } from "@/lib/season/availability";
import type {
  GameProjection,
  ProjectionBasis,
  ProjectionsFile,
  TeamInjuriesFile,
  TeamInjuryList,
  TeamInjuryRow,
} from "@/lib/season/projections";
import { formatLongDay, formatReportTime, formatShortDay, formatTimeEt, formatWeekday } from "@/lib/utils/dates";
import { displayName } from "@/lib/utils/injuries";
import { reportReason, statusView, type StatusFilterKey, type StatusView } from "@/lib/view/players";
import { teamDisplay } from "@/lib/view/teams";

/** Where a row comes from. "projection": a player the projection counts, for a game that is not his team's next. */
export type InjurySource = TeamInjuryRow["source"] | "projection";

export const SOURCE_LABELS: Record<InjurySource, string> = {
  report: "NBA report",
  "box-score": "Box scores",
  "earlier-report": "Earlier report",
  projection: "Model",
};

export type InjuryRowView = {
  key: string;
  athleteId: string | null;
  /** "First Last". */
  name: string;
  status: StatusCode | null;
  statusView: StatusView;
  source: InjurySource;
  /** The report's reason, prefix trimmed; null when he is not on a report. */
  reason: string | null;
  points: number;
  /** "−2.1", "<0.1" or "0". */
  pointsText: string;
};

export type InjuryBlock = {
  teamId: string;
  gameId: string;
  etDate: string;
  tipUtc: string;
  opponentId: string;
  home: boolean;
  /** "vs Pistons, Wed Nov 4, 7:00 PM ET". */
  gameLabel: string;
  /** "NBA report, 1:30 AM ET", "Not yet submitted", "No report yet". */
  sourceLabel: string;
  /** What the list is and how the model counts it, when that needs saying; null for a filed team on a current report. */
  note: string | null;
  /** The team has filed, and the report lists him or nobody: box-score rows count zero. */
  filed: boolean;
  unfiled: boolean;
  absencePoints: number;
  /** False for a list built from a projection's counted players only. */
  complete: boolean;
  rows: InjuryRowView[];
};

export type InjuryGame = {
  gameId: string;
  etDate: string;
  tipUtc: string;
  awayId: string;
  homeId: string;
  neutral: boolean;
  /** "7:00 PM ET". */
  time: string;
  away: InjuryBlock;
  home: InjuryBlock;
};

export type InjurySlate = { etDate: string; title: string; games: InjuryGame[] };

export type InjuryReportView = {
  slates: InjurySlate[];
  /** Teams not playing on those dates, with their list for their next game, by date then name. */
  others: InjuryBlock[];
  /** Newest report time any list uses, for the page header; Eastern wall clock. */
  latestReportAt: string | null;
};

/** A row's points as the lists print them: "−2.1", "<0.1" for a sliver, "0" for nothing. */
export function listPoints(points: number): string {
  if (points <= 0) return "0";
  return points >= 0.05 ? `−${points.toFixed(1)}` : "<0.1";
}

/** A side's total: "−6.3 pts", or "0.0 pts". */
export function totalPoints(points: number): string {
  return points >= 0.05 ? `−${points.toFixed(1)} pts` : "0.0 pts";
}

/** "the NBA's injury report of 1:30 AM ET" or "current absences", for a projection's basis. */
export function basisText(basis: ProjectionBasis | null, etDate: string): string {
  if (!basis) return "no injury term";
  if (basis.kind === "current-absences") return "current absences";
  const time = formatReportTime(basis.reportAt, etDate);
  return basis.stale ? `the NBA's injury report of ${time}, the last good one` : `the NBA's injury report of ${time}`;
}

/** The projection basis as a sentence, for notices and the game page. */
export function basisSentence(basis: ProjectionBasis | null, etDate: string): string {
  if (!basis) return "";
  if (basis.kind === "current-absences") {
    return "Injury term from current absences: no NBA injury report covers this game yet, so each team counts players out or doubtful on its latest report or who missed its last game, as the season odds do.";
  }
  const stale = basis.stale ? " The newest report could not be read, so this is the last good one." : "";
  return `Injury term from the NBA's injury report of ${formatReportTime(basis.reportAt, etDate)}, counted as a seal would count it.${stale}`;
}

/** One sentence for a day's projections, which usually share one basis. */
export function basisSummary(bases: ReadonlyArray<ProjectionBasis | null>, etDate: string): string {
  const reports = [...new Set(bases.flatMap((basis) => (basis?.kind === "report" ? [basis.reportAt] : [])))].sort();
  const current = bases.some((basis) => basis?.kind === "current-absences");
  const latest = reports.at(-1);
  if (latest && !current) {
    return `The injury term comes from the NBA's injury report of ${formatReportTime(latest, etDate)}, counted as a seal would count it.`;
  }
  if (latest) {
    return `The injury term comes from the NBA's injury report of ${formatReportTime(latest, etDate)} where it covers a game, and from current absences otherwise.`;
  }
  if (current) {
    return "No NBA injury report covers this day yet, so the injury term counts current absences: players out or doubtful on their team's latest report, or who missed its last game.";
  }
  return "";
}

/** "vs Pistons, Wed Nov 4, 7:00 PM ET". */
function gameLabel(opponentId: string, home: boolean, etDate: string, tipUtc: string): string {
  return `${home ? "vs" : "at"} ${teamDisplay(opponentId).shortName}, ${formatWeekday(etDate)} ${formatShortDay(etDate)}, ${formatTimeEt(tipUtc)}`;
}

function sortRows(rows: InjuryRowView[]): InjuryRowView[] {
  return rows.sort(
    (a, b) => a.statusView.order - b.statusView.order || b.points - a.points || a.name.localeCompare(b.name),
  );
}

/** One team's list for its next game, from the team injury lists. */
export function blockFromList(list: TeamInjuryList): InjuryBlock | null {
  const next = list.nextGame;
  if (!next) return null;
  const code = teamDisplay(list.teamId).code;
  const reportTime = list.report ? formatReportTime(list.report.at, next.etDate) : null;
  const inferred = list.rows.some((row) => row.source === "box-score");
  const zero = inferred ? " Players not on it who missed recent games are shown from box scores and count 0 on a filed side; since revision 2, an unfiled side instead uses current inferred absences." : "";
  let sourceLabel: string;
  let note: string | null;
  switch (list.filing) {
    case "filed":
      sourceLabel = `NBA report, ${reportTime}`;
      note = list.report?.stale ? "The newest report could not be read, so this is the last good one." : null;
      break;
    case "not-listed":
      sourceLabel = `NBA report, ${reportTime}`;
      note = `${code} is not on the NBA's injury report of ${reportTime}, which means nobody is listed.${zero}`;
      break;
    case "not-yet-submitted":
      sourceLabel = "Not yet submitted";
      note = `${code} had not submitted its injury report as of the NBA's report of ${reportTime}. Until it does, the model counts its current absences, chiefly players who missed its last game.`;
      break;
    default:
      sourceLabel = "No report yet";
      note =
        "No NBA injury report covers this game yet. The model counts current absences: players out or doubtful on the team's latest report, or who missed its last game.";
  }
  const rows = list.rows.map((row, index): InjuryRowView => {
    return {
      key: `${list.teamId}-${row.athleteId ?? row.name}-${index}`,
      athleteId: row.athleteId,
      name: displayName(row.name),
      status: row.status,
      statusView: statusView(row),
      source: row.source,
      // A status carried from an earlier report says so beside its reason.
      reason: row.reason && row.source !== "report" ? `${reportReason(row.reason)} (earlier report)` : reportReason(row.reason),
      points: row.points,
      pointsText: listPoints(row.points),
    };
  });
  return {
    teamId: list.teamId,
    gameId: next.gameId,
    etDate: next.etDate,
    tipUtc: next.tipUtc,
    opponentId: next.opponentId,
    home: next.home,
    gameLabel: gameLabel(next.opponentId, next.home, next.etDate, next.tipUtc),
    sourceLabel,
    note,
    filed: list.filing === "filed" || list.filing === "not-listed",
    unfiled: list.filing === "not-yet-submitted",
    absencePoints: list.absencePoints,
    complete: true,
    rows: sortRows(rows),
  };
}

/** A side of a game that is not the team's next one: the players its projection counts. */
export function blockFromProjection(projection: GameProjection, side: "home" | "away", nextEtDate: string | null): InjuryBlock {
  const teamId = side === "home" ? projection.homeId : projection.awayId;
  const opponentId = side === "home" ? projection.awayId : projection.homeId;
  const drivers = projection.drivers[side];
  const fromReport = projection.basis.kind === "report" && !projection.unfiled[side];
  const rows = drivers.map(
    (driver, index): InjuryRowView => ({
      key: `${teamId}-${driver.athleteId}-${index}`,
      athleteId: driver.athleteId,
      name: displayName(driver.name),
      status: driver.status,
      statusView: statusView({ status: driver.status, source: fromReport ? "report" : "earlier-report", gamesMissed: 1 }),
      source: "projection",
      reason: null,
      points: driver.points,
      pointsText: listPoints(driver.points),
    }),
  );
  const before = nextEtDate ? ` Its full list for this game appears after its game on ${formatShortDay(nextEtDate)}.` : "";
  return {
    teamId,
    gameId: projection.gameId,
    etDate: projection.etDate,
    tipUtc: projection.tipUtc,
    opponentId,
    home: side === "home",
    gameLabel: gameLabel(opponentId, side === "home", projection.etDate, projection.tipUtc),
    sourceLabel: projection.basis.kind === "report" ? `NBA report, ${formatReportTime(projection.basis.reportAt, projection.etDate)}` : "No report yet",
    note: `The players this game's projection counts, from ${basisText(projection.basis, projection.etDate)}.${before}`,
    filed: projection.basis.kind === "report" && !projection.unfiled[side],
    unfiled: projection.unfiled[side],
    absencePoints: projection.absencePoints[side],
    complete: false,
    rows: sortRows(rows),
  };
}

type SlateGame = Pick<GameProjection, "gameId" | "etDate" | "tipUtc" | "homeId" | "awayId" | "neutral">;

/**
 * The injuries page: the first two ET dates with projected games (the current slate's
 * games still to tip, and the next slate), game by game in tip order, then every other
 * team's list for its next game.
 */
export function buildInjuryReport(input: {
  lists: TeamInjuriesFile;
  projections: ProjectionsFile | null;
}): InjuryReportView {
  const { lists, projections } = input;
  const listByTeam = new Map(lists.teams.map((team) => [team.teamId, team]));
  const projectionById = new Map((projections?.games ?? []).map((game) => [game.gameId, game]));

  // Games in tip order: the projections when published, else each team's next game.
  let games: SlateGame[] = projections?.games ?? [];
  if (!projections) {
    const seen = new Map<string, SlateGame>();
    for (const team of lists.teams) {
      const next = team.nextGame;
      if (!next || seen.has(next.gameId)) continue;
      seen.set(next.gameId, {
        gameId: next.gameId,
        etDate: next.etDate,
        tipUtc: next.tipUtc,
        homeId: next.home ? team.teamId : next.opponentId,
        awayId: next.home ? next.opponentId : team.teamId,
        neutral: false,
      });
    }
    games = [...seen.values()].sort((a, b) => Date.parse(a.tipUtc) - Date.parse(b.tipUtc) || a.gameId.localeCompare(b.gameId));
  }
  const dates = [...new Set(games.map((game) => game.etDate))].sort().slice(0, 2);

  const side = (game: SlateGame, which: "home" | "away"): InjuryBlock | null => {
    const teamId = which === "home" ? game.homeId : game.awayId;
    const list = listByTeam.get(teamId);
    if (list?.nextGame?.gameId === game.gameId) return blockFromList(list);
    const projection = projectionById.get(game.gameId);
    if (projection) return blockFromProjection(projection, which, list?.nextGame?.etDate ?? null);
    // Without projections, a team whose list covers an earlier game has nothing for this one yet.
    const opponentId = which === "home" ? game.awayId : game.homeId;
    const next = list?.nextGame?.etDate;
    return {
      teamId,
      gameId: game.gameId,
      etDate: game.etDate,
      tipUtc: game.tipUtc,
      opponentId,
      home: which === "home",
      gameLabel: gameLabel(opponentId, which === "home", game.etDate, game.tipUtc),
      sourceLabel: "Not published yet",
      note: next ? `Its list for this game appears after its game on ${formatShortDay(next)}.` : "Its list for this game is not published.",
      filed: false,
      unfiled: false,
      absencePoints: 0,
      complete: false,
      rows: [],
    };
  };

  const playing = new Set<string>();
  const slates: InjurySlate[] = dates.map((etDate) => ({
    etDate,
    title: formatLongDay(etDate),
    games: games
      .filter((game) => game.etDate === etDate)
      .flatMap((game): InjuryGame[] => {
        const away = side(game, "away");
        const home = side(game, "home");
        if (!away || !home) return [];
        playing.add(game.awayId);
        playing.add(game.homeId);
        return [
          {
            gameId: game.gameId,
            etDate: game.etDate,
            tipUtc: game.tipUtc,
            awayId: game.awayId,
            homeId: game.homeId,
            neutral: game.neutral,
            time: formatTimeEt(game.tipUtc),
            away,
            home,
          },
        ];
      }),
  }));

  const others = lists.teams
    .filter((team) => !playing.has(team.teamId))
    .flatMap((team) => {
      const block = blockFromList(team);
      return block ? [block] : [];
    })
    .sort(
      (a, b) =>
        Date.parse(a.tipUtc) - Date.parse(b.tipUtc) ||
        teamDisplay(a.teamId).shortName.localeCompare(teamDisplay(b.teamId).shortName),
    );

  const latestReportAt =
    lists.teams
      .map((team) => team.report?.at ?? null)
      .filter((at): at is string => at !== null)
      .sort()
      .at(-1) ?? null;

  return { slates: slates.filter((slate) => slate.games.length > 0), others, latestReportAt };
}

export const STATUS_FILTERS: Array<{ key: StatusFilterKey | "all"; label: string }> = [
  { key: "all", label: "All" },
  { key: "O", label: "Out" },
  { key: "D", label: "Doubtful" },
  { key: "Q", label: "Questionable" },
  { key: "P", label: "Probable or available" },
  { key: "missed", label: "Missed, not listed" },
];
