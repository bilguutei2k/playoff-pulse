import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";

import { franchiseIdForTeamCode } from "../src/data/franchise-map";

const HISTORICAL_DATA_DIRECTORIES = [
  "series",
  "games",
  "team-snapshots",
  "play-in",
] as const;

const TEAM_CODE_FIELDS = [
  "teamId",
  "teamA",
  "teamB",
  "homeTeam",
  "awayTeam",
  "winner",
  "loser",
] as const;

function collectTeamCodes(value: unknown, output: Set<string>): void {
  if (Array.isArray(value)) {
    value.forEach((entry) => collectTeamCodes(entry, output));
    return;
  }
  if (!value || typeof value !== "object") {
    return;
  }

  const record = value as Record<string, unknown>;
  for (const field of TEAM_CODE_FIELDS) {
    if (typeof record[field] === "string") {
      output.add(record[field]);
    }
  }
  Object.values(record).forEach((entry) => collectTeamCodes(entry, output));
}

describe("historical NBA franchise identity map", () => {
  it.each([
    ["SEA", "OKC"],
    ["VAN", "MEM"],
    ["NJN", "BRK"],
    ["WSB", "WAS"],
    ["SDC", "LAC"],
    ["CHH", "NOP"],
    ["NOH", "NOP"],
    ["NOK", "NOP"],
    ["CHA", "CHA"],
    ["CHO", "CHA"],
    ["KCK", "SAC"],
  ] as const)("maps %s to stable franchise %s", (teamCode, franchiseId) => {
    expect(franchiseIdForTeamCode(teamCode)).toBe(franchiseId);
  });

  it("fails closed for an unknown code", () => {
    expect(() => franchiseIdForTeamCode("XXX")).toThrow(
      "Unmapped historical NBA team code",
    );
  });

  it("resolves every team code in every normalized historical data file", () => {
    const root = path.join(process.cwd(), "data", "historical");
    const teamCodes = new Set<string>();

    for (const directory of HISTORICAL_DATA_DIRECTORIES) {
      const directoryPath = path.join(root, directory);
      if (!fs.existsSync(directoryPath)) {
        continue;
      }
      for (const filename of fs.readdirSync(directoryPath)) {
        if (!filename.endsWith(".json")) {
          continue;
        }
        const value = JSON.parse(
          fs.readFileSync(path.join(directoryPath, filename), "utf8"),
        ) as unknown;
        collectTeamCodes(value, teamCodes);
      }
    }

    expect([...teamCodes].sort()).not.toHaveLength(0);
    for (const teamCode of teamCodes) {
      expect(() => franchiseIdForTeamCode(teamCode), teamCode).not.toThrow();
    }
  });
});
