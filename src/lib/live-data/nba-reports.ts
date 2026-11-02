// Reads the NBA's injury report PDFs. These are unofficial for our purposes: this
// project is not affiliated with the NBA, and the format has already changed once.
//
// The parser works from positioned text, so it is pure and testable. It fails closed:
// if the header, the title or any row does not look right, it throws, and the caller
// keeps its last good report.

import { STATUS_CODES, teamIdFromReportName } from "@/lib/season/availability";
import type { LiveReport, LiveReportRow } from "@/lib/season/live-reports";

export type ReportStatus = "Out" | "Doubtful" | "Questionable" | "Probable" | "Available";

const STATUSES: readonly string[] = ["Out", "Doubtful", "Questionable", "Probable", "Available"];
const NOT_SUBMITTED = "NOT YET SUBMITTED";

/** A piece of text on the page, with the raw PDF coordinates. */
export type PdfTextItem = { text: string; x: number; y: number };

export type ReportRow = {
  /** Game date as YYYY-MM-DD. */
  gameDate: string;
  /** Matchup as printed, such as BOS@ORL. */
  matchup: string;
  /** Team name as printed. */
  team: string;
  /** "Last, First" as printed, or null when the team has not filed yet. */
  player: string | null;
  status: ReportStatus | null;
  reason: string;
};

export type ParsedReport = {
  /** The report's own timestamp, as Eastern wall-clock time: YYYY-MM-DDTHH:mm. */
  issuedEt: string;
  rows: ReportRow[];
};

type Column = "date" | "time" | "matchup" | "team" | "player" | "status" | "reason";

const COLUMN_ORDER: readonly Column[] = [
  "date",
  "time",
  "matchup",
  "team",
  "player",
  "status",
  "reason",
];

type Token = { text: string; along: number; down: number };

/**
 * Pages come in two layouts: older ones are rotated, so x runs down the page. Each
 * layout is detected from where the header sits, never from the report's date.
 */
function normalizePage(
  items: readonly PdfTextItem[],
  previouslyRotated: boolean | null,
): { tokens: Token[]; rotated: boolean } {
  const clean = items.filter((item) => item.text.trim() !== "");
  const heading = clean.find((item) => item.text.trim().startsWith("Matchup"));
  const reason = clean.find((item) => item.text.trim() === "Reason");
  const rotated =
    heading && reason
      ? Math.abs(heading.x - reason.x) < Math.abs(heading.y - reason.y)
      : previouslyRotated;
  if (rotated === null) throw new Error("Injury report: no header row on the first page.");
  return {
    rotated,
    tokens: clean.map((item) =>
      rotated
        ? { text: item.text.trim(), along: item.y, down: item.x }
        : { text: item.text.trim(), along: item.x, down: -item.y },
    ),
  };
}

/** Finds where each column starts from the header row. */
function locateColumns(tokens: readonly Token[]): {
  starts: Record<Column, number>;
  headerDown: number;
} | null {
  const matchup = tokens.find((token) => token.text.startsWith("Matchup"));
  if (!matchup) return null;
  const header = tokens
    .filter((token) => Math.abs(token.down - matchup.down) < 3)
    .sort((a, b) => a.along - b.along);
  const games = header.filter((token) => token.text.startsWith("Game"));
  const find = (prefix: string) => header.find((token) => token.text.startsWith(prefix));
  const team = find("Team");
  const player = find("Player");
  const status = find("Current");
  const reason = find("Reason");
  if (games.length < 2 || !team || !player || !status || !reason) {
    throw new Error("Injury report: the header row is missing a column.");
  }
  // Word-level PDFs split "Game Date" and "Game Time", so take the "Game" words.
  const dateStart = games[0].along;
  const timeStart = games[1].along;
  return {
    starts: {
      date: dateStart,
      time: timeStart,
      matchup: matchup.along,
      team: team.along,
      player: player.along,
      status: status.along,
      reason: reason.along,
    },
    headerDown: matchup.down,
  };
}

function columnOf(along: number, starts: Record<Column, number>): Column {
  let current: Column = "date";
  for (const column of COLUMN_ORDER) {
    if (along >= starts[column] - 3) current = column;
  }
  return current;
}

type Line = { down: number; text: string };

/** Joins a column's tokens into lines, top to bottom. */
function linesOf(tokens: readonly Token[]): Line[] {
  const sorted = [...tokens].sort((a, b) => a.down - b.down || a.along - b.along);
  const lines: Array<{ down: number; parts: Token[] }> = [];
  for (const token of sorted) {
    const last = lines.at(-1);
    if (last && Math.abs(last.down - token.down) < 2.5) last.parts.push(token);
    else lines.push({ down: token.down, parts: [token] });
  }
  return lines.map((line) => ({
    down: line.down,
    text: [...line.parts]
      .sort((a, b) => a.along - b.along)
      .map((part) => part.text)
      .join(" "),
  }));
}

function parseTitle(text: string): string | null {
  const match = /Injury Report:\s*(\d{2})\/(\d{2})\/(\d{2})\s+(\d{2}):(\d{2})\s*(AM|PM)/.exec(text);
  if (!match) return null;
  const [, month, day, year, hourText, minute, meridiem] = match;
  let hour = Number(hourText) % 12;
  if (meridiem === "PM") hour += 12;
  return `20${year}-${month}-${day}T${String(hour).padStart(2, "0")}:${minute}`;
}

function parseGameDate(text: string): string {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(text);
  if (!match) throw new Error(`Injury report: bad game date "${text}".`);
  return `${match[3]}-${match[1]}-${match[2]}`;
}

/** Parses one report from each page's positioned text. */
export function parseReportPages(pages: ReadonlyArray<readonly PdfTextItem[]>): ParsedReport {
  let issuedEt: string | null = null;
  let starts: Record<Column, number> | null = null;
  const rows: ReportRow[] = [];
  let gameDate: string | null = null;
  let matchup: string | null = null;
  let team: string | null = null;
  let rotated: boolean | null = null;

  for (const items of pages) {
    const normalized = normalizePage(items, rotated);
    rotated = normalized.rotated;
    const tokens = normalized.tokens;
    if (issuedEt === null) {
      const allText = linesOf(tokens).map((line) => line.text);
      for (const line of allText) {
        issuedEt = parseTitle(line);
        if (issuedEt) break;
      }
    }
    const located = locateColumns(tokens);
    if (located) starts = located.starts;
    if (!starts) throw new Error("Injury report: no header row on the first page.");
    const headerDown = located?.headerDown ?? Number.NEGATIVE_INFINITY;
    const belowHeader = tokens.filter((token) => token.down > headerDown + 3);
    // Later pages repeat the title and have a footer, neither of which is a row.
    const furniture = linesOf(belowHeader).filter(
      (line) => /^Page \d+ of \d+$/.test(line.text) || line.text.startsWith("Injury Report:"),
    );
    const body = belowHeader.filter((token) =>
      furniture.every((line) => Math.abs(token.down - line.down) >= 2.5),
    );

    const byColumn: Record<Column, Token[]> = {
      date: [],
      time: [],
      matchup: [],
      team: [],
      player: [],
      status: [],
      reason: [],
    };
    for (const token of body) byColumn[columnOf(token.along, starts)].push(token);

    const dateLines = linesOf(byColumn.date);
    const matchupLines = linesOf(byColumn.matchup);
    const teamLines = linesOf(byColumn.team);
    const playerLines = linesOf(byColumn.player);
    const statusLines = linesOf(byColumn.status);
    const reasonLines = linesOf(byColumn.reason);

    // Each record is anchored on its player, or on a NOT YET SUBMITTED note.
    type Anchor = {
      down: number;
      player: string | null;
      status: ReportStatus | null;
      reason: string[];
    };
    const anchors: Anchor[] = [];
    for (const line of playerLines) {
      const status = statusLines.find((row) => Math.abs(row.down - line.down) < 3);
      if (!status || !STATUSES.includes(status.text)) {
        throw new Error(`Injury report: "${line.text}" has no valid status.`);
      }
      if (!line.text.includes(",")) {
        throw new Error(`Injury report: player "${line.text}" is not "Last, First".`);
      }
      anchors.push({
        down: line.down,
        player: line.text,
        status: status.text as ReportStatus,
        reason: [],
      });
    }
    const remainingReasons: Line[] = [];
    for (const line of reasonLines) {
      if (line.text.includes(NOT_SUBMITTED)) {
        anchors.push({ down: line.down, player: null, status: null, reason: [NOT_SUBMITTED] });
      } else {
        remainingReasons.push(line);
      }
    }
    anchors.sort((a, b) => a.down - b.down);

    // A wrapped reason is centered on its row, so each line goes to the nearest anchor.
    // Lines above the first anchor continue the last row of the previous page.
    const rowHeight =
      anchors.length > 1
        ? Math.min(...anchors.slice(1).map((anchor, index) => anchor.down - anchors[index].down))
        : 20;
    for (const line of remainingReasons) {
      if (anchors.length === 0 || line.down < anchors[0].down - rowHeight) {
        const previous = rows.at(-1);
        if (previous) previous.reason = `${previous.reason} ${line.text}`.trim();
        continue;
      }
      let nearest = anchors[0];
      for (const anchor of anchors) {
        if (Math.abs(anchor.down - line.down) < Math.abs(nearest.down - line.down)) nearest = anchor;
      }
      nearest.reason.push(line.text);
    }

    for (const anchor of anchors) {
      const carry = (lines: Line[], current: string | null): string | null => {
        let value = current;
        for (const line of lines) {
          if (line.down <= anchor.down + 3) value = line.text;
        }
        return value;
      };
      const dateText = carry(dateLines, null);
      if (dateText) gameDate = parseGameDate(dateText);
      matchup = carry(matchupLines, matchup);
      team = carry(teamLines, team);
      if (!gameDate || !matchup || !team) {
        throw new Error("Injury report: a row has no game date, matchup or team.");
      }
      if (!/^[A-Z]{2,3}@[A-Z]{2,3}$/.test(matchup)) {
        throw new Error(`Injury report: bad matchup "${matchup}".`);
      }
      rows.push({
        gameDate,
        matchup,
        team,
        player: anchor.player,
        status: anchor.status,
        // Re-joins words the page wrapped at a hyphen, such as "Two- Way".
        reason: anchor.reason.join(" ").trim().replace(/(\w)- (\w)/g, "$1-$2"),
      });
    }
  }

  if (issuedEt === null) throw new Error("Injury report: no timestamp in the title.");
  return { issuedEt, rows };
}

/** File names for a report at or before a time, newest first. Hourly until 2025-12-22. */
export function reportFileName(
  etDate: string,
  hour: number,
  minute: number,
  style: "hourly" | "quarter",
): string {
  const meridiem = hour >= 12 ? "PM" : "AM";
  const twelve = hour % 12 === 0 ? 12 : hour % 12;
  const hourText = String(twelve).padStart(2, "0");
  return style === "hourly"
    ? `${etDate}_${hourText}${meridiem}`
    : `${etDate}_${hourText}_${String(minute).padStart(2, "0")}${meridiem}`;
}

export function reportUrl(fileName: string): string {
  return `https://ak-static.cms.nba.com/referee/injury/Injury-Report_${fileName}.pdf`;
}

/**
 * Quarter-hour report names at or before an Eastern wall-clock time, newest first.
 * Reports have been issued every 15 minutes, around the clock, since 2025-12-22.
 */
export function quarterReportNames(nowEt: string, count: number): string[] {
  // Wall-clock stamps are treated as UTC only to step through them.
  const now = Date.parse(`${nowEt}:00Z`);
  if (Number.isNaN(now)) throw new Error(`Bad ET time "${nowEt}".`);
  const newest = Math.floor(now / 900_000) * 900_000;
  const names: string[] = [];
  for (let step = 0; step < count; step += 1) {
    const iso = new Date(newest - step * 900_000).toISOString();
    names.push(
      reportFileName(iso.slice(0, 10), Number(iso.slice(11, 13)), Number(iso.slice(14, 16)), "quarter"),
    );
  }
  return names;
}

export type SlateGamePair = { homeId: string; awayId: string };

/**
 * Cuts a parsed report to one slate and validates it: every slate game must have rows,
 * or NOT YET SUBMITTED, for both teams. Anything else makes the report unusable, and a
 * team name it cannot place fails closed.
 */
export function reportForSlate(
  report: ParsedReport,
  file: string,
  etDate: string,
  games: readonly SlateGamePair[],
): { ok: true; report: LiveReport } | { ok: false; problem: string } {
  const slateTeams = new Set(games.flatMap((game) => [game.homeId, game.awayId]));
  const seen = new Set<string>();
  const notSubmitted: string[] = [];
  const rows: LiveReportRow[] = [];
  try {
    for (const row of report.rows) {
      if (row.gameDate !== etDate) continue;
      const teamId = teamIdFromReportName(row.team);
      if (!slateTeams.has(teamId)) continue;
      seen.add(teamId);
      if (row.player === null || row.status === null) {
        if (!notSubmitted.includes(teamId)) notSubmitted.push(teamId);
      } else {
        rows.push([teamId, row.player, STATUS_CODES[row.status], row.reason]);
      }
    }
  } catch (error) {
    return { ok: false, problem: error instanceof Error ? error.message : String(error) };
  }
  const absent = [...slateTeams].filter((teamId) => !seen.has(teamId));
  if (games.length === 0) return { ok: false, problem: "no games on the slate" };
  if (absent.length > 0) {
    return {
      ok: false,
      problem: `no rows for team(s) ${absent.sort().join(", ")} on ${etDate}`,
    };
  }
  return { ok: true, report: { file, notSubmitted: notSubmitted.sort(), rows } };
}
