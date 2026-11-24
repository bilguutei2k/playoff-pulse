// The odds history on disk (scripts/live/odds-history-disk.ts): the guarded read of the
// snapshot directory that the job's builder and `verify:live` share, and the one check both
// run on the published file. The point of both is that an optional view can never stop a
// push that carries seals, so neither may throw and the two callers may never disagree.
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { checkOddsHistoryOnDisk, readSnapshotFiles } from "../scripts/live/odds-history-disk";
import { buildOddsHistory } from "@/lib/season/odds-history";
import { siteFileContent, siteOddsHistoryPath } from "@/lib/season/site-files";
import type { SeasonForecast, TeamHistoryPoint } from "@/lib/season/types";
import { etDates, syntheticForecast } from "./support/odds-history-fixtures";

const SEASON = 2027;
const LABEL = "2026-27";
const made: string[] = [];

afterEach(() => {
  for (const directory of made.splice(0)) {
    // A test may have removed read permission from an entry.
    for (const name of fs.existsSync(path.join(directory, "snapshots", LABEL)) ? fs.readdirSync(path.join(directory, "snapshots", LABEL)) : []) {
      try {
        fs.chmodSync(path.join(directory, "snapshots", LABEL, name), 0o644);
      } catch {
        // a directory entry
      }
    }
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

/** A live directory with `days` stored snapshots, the last being the slate's, and the state that goes with them. */
function liveDirectory(days: number) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "odds-history-disk-"));
  made.push(root);
  const snapshots = path.join(root, "snapshots", LABEL);
  fs.mkdirSync(snapshots, { recursive: true });
  const dates = etDates("2026-10-21", days);
  const forecasts = dates.map((_, index) => syntheticForecast(SEASON, index + 1));
  dates.forEach((date, index) => fs.writeFileSync(path.join(snapshots, `${date}.json`), `${JSON.stringify(forecasts[index])}\n`));
  const slate = dates.at(-1)!;
  const forecast = forecasts.at(-1)!;
  const champion = (value: SeasonForecast) => Object.fromEntries(value.teams.map((team) => [team.teamId, team.champion]));
  const history: TeamHistoryPoint[] = dates.map((date, index) => ({ date, champion: champion(forecasts[index]) }));
  const state = { season: SEASON, slateEtDate: slate, forecast, history };
  return { root, snapshots, dates, state };
}

/** Writes the view the job would publish for the directory as it stands. */
function publish(root: string, snapshots: string, state: ReturnType<typeof liveDirectory>["state"]) {
  const { file } = buildOddsHistory({ season: SEASON, seasonLabel: LABEL, slate: state.slateEtDate, forecast: state.forecast, snapshots: readSnapshotFiles(snapshots) });
  const target = path.join(root, siteOddsHistoryPath(LABEL));
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, siteFileContent(file));
  return target;
}

describe("readSnapshotFiles", () => {
  it("returns no entries for a missing directory", () => {
    expect(readSnapshotFiles(path.join(os.tmpdir(), "no-such-odds-history-directory"))).toEqual([]);
  });

  it("returns a directory among the snapshots as an unreadable entry instead of throwing", () => {
    const { snapshots, dates } = liveDirectory(3);
    fs.mkdirSync(path.join(snapshots, "stray"));
    const entries = readSnapshotFiles(snapshots);
    expect(entries.map((entry) => entry.name).sort()).toEqual([...dates.map((date) => `${date}.json`), "stray"].sort());
    const stray = entries.find((entry) => entry.name === "stray")!;
    expect(stray.text).toBeNull();
    expect(stray.error).toBeTruthy();
  });

  it("returns a file it cannot read as an unreadable entry instead of throwing", () => {
    const { snapshots, dates } = liveDirectory(3);
    const locked = path.join(snapshots, `${dates[0]}.json`);
    fs.chmodSync(locked, 0o000);
    let readable = true;
    try {
      fs.readFileSync(locked, "utf-8");
    } catch {
      readable = false;
    }
    // Skipped where permissions are not enforced (a root user).
    if (readable) return;
    const entry = readSnapshotFiles(snapshots).find((candidate) => candidate.name === `${dates[0]}.json`)!;
    expect(entry.text).toBeNull();
    expect(entry.error).toBeTruthy();
  });
});

describe("checkOddsHistoryOnDisk", () => {
  it("says the view is not published when there is no file", () => {
    const { root, state } = liveDirectory(3);
    expect(checkOddsHistoryOnDisk(root, state, LABEL)).toEqual({ published: false });
  });

  it("finds nothing wrong with the view the job writes", () => {
    const { root, snapshots, dates, state } = liveDirectory(6);
    publish(root, snapshots, state);
    const check = checkOddsHistoryOnDisk(root, state, LABEL);
    expect(check.published && check.problems).toEqual([]);
    expect(check.published && check.view?.dates).toEqual(dates);
  });

  it("agrees with the builder when a snapshot is unusable: the builder leaves it out, and the check accepts the result", () => {
    const { root, snapshots, dates, state } = liveDirectory(6);
    fs.mkdirSync(path.join(snapshots, "stray"));
    fs.writeFileSync(path.join(snapshots, `${dates[1]}.json`), "not json\n");
    publish(root, snapshots, state);
    const check = checkOddsHistoryOnDisk(root, state, LABEL);
    expect(check.published && check.problems).toEqual([]);
    expect(check.published && check.skipped.map((skip) => skip.name).sort()).toEqual([`${dates[1]}.json`, "stray"].sort());
    expect(check.published && check.view?.dates).toEqual(dates.filter((date) => date !== dates[1]));
  });

  it("reports a file that is not what the snapshots produce, a stale file and a file that is not JSON, without throwing", () => {
    const { root, snapshots, dates, state } = liveDirectory(6);
    const target = publish(root, snapshots, state);
    const good = fs.readFileSync(target, "utf-8");

    // One number changed by hand.
    const edited = JSON.parse(good);
    edited.rating[0][0] = Number((edited.rating[0][0] + 0.001).toFixed(3));
    fs.writeFileSync(target, siteFileContent(edited));
    const tampered = checkOddsHistoryOnDisk(root, state, LABEL);
    expect(tampered.published && tampered.problems.length).toBeGreaterThan(0);

    // A file from an earlier run: it ends before the slate.
    const earlier = buildOddsHistory({
      season: SEASON,
      seasonLabel: LABEL,
      slate: dates[4],
      forecast: syntheticForecast(SEASON, 5),
      snapshots: readSnapshotFiles(snapshots).filter((entry) => entry.name < `${dates[4]}.json`),
    }).file;
    fs.writeFileSync(target, siteFileContent(earlier));
    const stale = checkOddsHistoryOnDisk(root, state, LABEL);
    expect(stale.published && stale.problems.join("; ")).toMatch(/slate/);

    fs.writeFileSync(target, "{ not json");
    const garbage = checkOddsHistoryOnDisk(root, state, LABEL);
    expect(garbage.published && garbage.problems.length).toBeGreaterThan(0);

    // A directory where the file should be.
    fs.rmSync(target);
    fs.mkdirSync(target);
    const blocked = checkOddsHistoryOnDisk(root, state, LABEL);
    expect(blocked.published && blocked.problems.length).toBeGreaterThan(0);
  });
});
