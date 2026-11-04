// The live workflow's git steps, run for real: scripts/live/data-checkout.sh and
// scripts/live/data-commit.sh against a throwaway bare "origin" holding main and
// live-data, with a real push. The pipeline is replaced by direct edits to data/live.
//
// On 2026-11-03 the commit step staged with `git rm --cached`, which git refuses once
// live-data's copy of a file differs from both main's and the working file, so every run
// with real data failed. The diverged case below is that situation.
import fs from "node:fs";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { commitAll, git, liveScript, removeTempDirs, run, tempDir, writeFiles } from "./support/shell";

afterAll(removeTempDirs);

const TIMEOUT = 30_000;
const VERCEL_OFF = `${JSON.stringify({ git: { deploymentEnabled: { "live-data": false } } }, null, 2)}\n`;
const MAIN_CODE = "export const version = 2;\n";
const CUT_CODE = "export const version = 1;\n";

// What the "pipeline" does in every case that publishes: modify a file whose live-data copy
// already differs from main's, add a nested file, delete a file.
const PIPELINE_CHANGES: Record<string, string | null> = {
  "data/live/state.json": '{ "v": 2 }\n',
  "data/live/ledger/2026-11-03.jsonl": '{"row":3}\n',
  "data/live/games.json": null,
};
const EXPECTED_CHANGES = [
  "A\tdata/live/ledger/2026-11-03.jsonl",
  "D\tdata/live/games.json",
  "M\tdata/live/state.json",
];

interface Fixture {
  root: string;
  origin: string;
  work: string;
  githubEnv: string;
  runnerTemp: string;
  pushLog: string;
  /** main's head on origin (the code the job runs). */
  main: string;
  /** live-data's head on origin before the run, or null when it does not exist. */
  liveData: string | null;
}

function makeFixture(options: { liveData: boolean; liveDataVercel?: string }): Fixture {
  const root = tempDir("pp-live-git-");
  const origin = path.join(root, "origin.git");
  const seed = path.join(root, "seed");
  git(root, ["init", "-q", "--bare", "-b", "main", origin]);
  git(root, ["init", "-q", "-b", "main", seed]);
  git(seed, ["remote", "add", "origin", `file://${origin}`]);

  // The cutover: main's frozen data/live, which live-data was cut from.
  commitAll(seed, "cutover", {
    "vercel.json": VERCEL_OFF,
    "package.json": '{ "name": "fixture" }\n',
    "src/model.ts": CUT_CODE,
    "data/live/state.json": '{ "v": 0 }\n',
    "data/live/games.json": '{ "games": [] }\n',
    "data/live/ledger/2026-11-01.jsonl": '{"row":1}\n',
    "data/live/obsolete.json": "{}\n",
  });
  git(seed, ["push", "-q", "origin", "main"]);

  let liveData: string | null = null;
  if (options.liveData) {
    // live-data's own history: data only (plus, for the guard case, a broken vercel.json).
    git(seed, ["checkout", "-q", "-b", "live-data"]);
    liveData = commitAll(seed, "chore(live): update forecasts", {
      "data/live/state.json": '{ "v": 1 }\n',
      "data/live/ledger/2026-11-02.jsonl": '{"row":2}\n',
      "data/live/obsolete.json": null,
      ...(options.liveDataVercel === undefined ? {} : { "vercel.json": options.liveDataVercel }),
    });
    git(seed, ["push", "-q", "origin", "live-data"]);
    git(seed, ["checkout", "-q", "main"]);
  }

  // Main moves on with code only, so the two branches have diverged.
  const main = commitAll(seed, "feat: new code", {
    "src/model.ts": MAIN_CODE,
    "src/feature.ts": "export const feature = true;\n",
  });
  git(seed, ["push", "-q", "origin", "main"]);

  // Every push origin receives from here on is logged.
  const pushLog = path.join(root, "pushes.log");
  fs.writeFileSync(pushLog, "");
  fs.writeFileSync(path.join(origin, "hooks", "pre-receive"), `#!/bin/sh\ncat >> "${pushLog}"\n`, { mode: 0o755 });

  // The job's checkout of main, shallow like actions/checkout with fetch-depth 20.
  const work = path.join(root, "work");
  git(root, ["clone", "-q", "--depth", "20", "--branch", "main", `file://${origin}`, work]);
  const runnerTemp = path.join(root, "runner-temp");
  fs.mkdirSync(runnerTemp);
  return { root, origin, work, githubEnv: path.join(root, "github-env"), runnerTemp, pushLog, main, liveData };
}

function checkout(fx: Fixture) {
  fs.writeFileSync(fx.githubEnv, "");
  const result = run("bash", [liveScript("data-checkout.sh")], fx.work, { DATA_BRANCH: "live-data", GITHUB_ENV: fx.githubEnv });
  const exported = Object.fromEntries(
    fs
      .readFileSync(fx.githubEnv, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((line) => line.split("=", 2) as [string, string]),
  );
  return { ...result, base: exported.DATA_BASE, bootstrap: exported.DATA_BOOTSTRAP };
}

function commit(fx: Fixture, base: string, bootstrap: string, extra: Record<string, string> = {}) {
  return run("bash", [liveScript("data-commit.sh")], fx.work, {
    DATA_BRANCH: "live-data",
    DATA_BASE: base,
    DATA_BOOTSTRAP: bootstrap,
    RUNNER_TEMP: fx.runnerTemp,
    PUSH_RETRY_SECONDS: "0",
    ...extra,
  });
}

function originHead(fx: Fixture, branch: string): string | null {
  const result = run("git", ["--git-dir", fx.origin, "rev-parse", "--verify", "-q", `refs/heads/${branch}`], fx.root);
  return result.status === 0 ? result.stdout.trim() : null;
}

function originGit(fx: Fixture, args: string[]): string {
  return git(fx.root, ["--git-dir", fx.origin, ...args]);
}

function changes(fx: Fixture, from: string, to: string): string[] {
  return originGit(fx, ["diff", "--name-status", from, to]).split("\n").filter(Boolean).sort();
}

function pushes(fx: Fixture): string[] {
  return fs.readFileSync(fx.pushLog, "utf8").split("\n").filter(Boolean);
}

/** data/live on disk, as path → blob id, read from the filesystem rather than through git's index. */
function dataOnDisk(work: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else out[path.relative(work, full)] = git(work, ["hash-object", full]);
    }
  };
  walk(path.join(work, "data", "live"));
  return out;
}

function dataInCommit(work: string, rev: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of git(work, ["ls-tree", "-r", rev, "--", "data/live"]).split("\n").filter(Boolean)) {
    const [meta, file] = line.split("\t");
    out[file] = meta.split(" ")[2];
  }
  return out;
}

/** The job's checkout still runs main's code: HEAD, index and every file outside data/live are main's. */
function expectCodeUntouched(fx: Fixture) {
  expect(git(fx.work, ["rev-parse", "HEAD"])).toBe(fx.main);
  expect(git(fx.work, ["status", "--porcelain", "--", ".", ":(exclude)data/live"])).toBe("");
  expect(run("git", ["diff", "--cached", "--quiet"], fx.work).status).toBe(0);
  expect(fs.readFileSync(path.join(fx.work, "src/model.ts"), "utf8")).toBe(MAIN_CODE);
}

describe("live job git steps: data-checkout.sh and data-commit.sh", () => {
  it(
    "publishes exactly the pipeline's changes once live-data has diverged from main",
    () => {
      const fx = makeFixture({ liveData: true });
      const ld = fx.liveData as string;

      const co = checkout(fx);
      expect(co.status, co.stderr).toBe(0);
      expect(co.stdout).toContain(`Code: main at ${fx.main}.`);
      expect(co.stdout).toContain(`Data: live-data at ${ld}.`);
      expect(co.base).toBe(ld);
      expect(co.bootstrap).toBe("0");
      // data/live is live-data's exactly (main's obsolete.json gone, live-data's ledger day
      // present); everything else is main's code.
      expect(dataOnDisk(fx.work)).toEqual(dataInCommit(fx.work, ld));
      expectCodeUntouched(fx);

      writeFiles(fx.work, PIPELINE_CHANGES);
      const result = commit(fx, co.base, co.bootstrap);
      expect(result.status, result.stderr).toBe(0);

      const pushed = originHead(fx, "live-data") as string;
      expect(pushed).not.toBe(ld);
      expect(result.stdout).toContain(`Pushed: fast-forward live-data from ${ld} to ${pushed}.`);
      expect(pushes(fx)).toHaveLength(1);
      expect(originGit(fx, ["rev-parse", `${pushed}^`])).toBe(ld);
      expect(originGit(fx, ["log", "-1", "--format=%s", pushed])).toBe("chore(live): update forecasts");
      // The pushed tree is live-data's previous tree plus exactly the pipeline's changes:
      // vercel.json and the code stay as live-data was cut, not main's newer code.
      expect(changes(fx, ld, pushed)).toEqual(EXPECTED_CHANGES);
      expect(originGit(fx, ["show", `${pushed}:data/live/state.json`])).toBe('{ "v": 2 }');
      expect(originGit(fx, ["show", `${pushed}:src/model.ts`])).toBe(CUT_CODE.trim());
      expect(dataInCommit(fx.work, pushed)).toEqual(dataOnDisk(fx.work));
      expectCodeUntouched(fx);
    },
    TIMEOUT,
  );

  it(
    "bootstraps live-data from main's HEAD when it does not exist yet",
    () => {
      const fx = makeFixture({ liveData: false });

      const co = checkout(fx);
      expect(co.status, co.stderr).toBe(0);
      expect(co.stdout).toContain(`Data: live-data does not exist yet; this run bootstraps it from main's HEAD ${fx.main}.`);
      expect(co.base).toBe(fx.main);
      expect(co.bootstrap).toBe("1");
      expect(dataOnDisk(fx.work)).toEqual(dataInCommit(fx.work, fx.main));
      expectCodeUntouched(fx);

      writeFiles(fx.work, PIPELINE_CHANGES);
      const result = commit(fx, co.base, co.bootstrap);
      expect(result.status, result.stderr).toBe(0);

      const created = originHead(fx, "live-data") as string;
      expect(created).not.toBeNull();
      expect(result.stdout).toContain(`Pushed: create live-data at ${created}, cut from main's HEAD ${fx.main}.`);
      expect(pushes(fx)).toHaveLength(1);
      expect(originGit(fx, ["rev-parse", `${created}^`])).toBe(fx.main);
      expect(changes(fx, fx.main, created)).toEqual(EXPECTED_CHANGES);
      // Every code file comes from main's tree, untouched.
      expect(originGit(fx, ["diff", "--name-only", fx.main, created, "--", ".", ":(exclude)data/live"])).toBe("");
      expect(originHead(fx, "main")).toBe(fx.main);
      expectCodeUntouched(fx);
    },
    TIMEOUT,
  );

  it(
    "bootstraps live-data at main's HEAD itself when the first run changes nothing",
    () => {
      const fx = makeFixture({ liveData: false });
      const co = checkout(fx);
      const result = commit(fx, co.base, co.bootstrap);
      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout).toContain(`Pushed: create live-data at ${fx.main}, cut from main's HEAD ${fx.main}.`);
      expect(originHead(fx, "live-data")).toBe(fx.main);
    },
    TIMEOUT,
  );

  it(
    "pushes nothing when the pipeline changed nothing",
    () => {
      const fx = makeFixture({ liveData: true });
      const co = checkout(fx);
      // Rewritten with identical content, as the pipeline does on a quiet run.
      writeFiles(fx.work, { "data/live/state.json": '{ "v": 1 }\n' });
      const result = commit(fx, co.base, co.bootstrap);
      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout).toContain("No real change to publish.");
      expect(result.stdout).not.toContain("Pushed");
      expect(pushes(fx)).toEqual([]);
      expect(originHead(fx, "live-data")).toBe(fx.liveData);
      expectCodeUntouched(fx);
    },
    TIMEOUT,
  );

  it(
    "refuses to push when live-data's vercel.json does not turn off its deployments",
    () => {
      const fx = makeFixture({ liveData: true, liveDataVercel: '{ "git": {} }\n' });
      const co = checkout(fx);
      writeFiles(fx.work, PIPELINE_CHANGES);
      const result = commit(fx, co.base, co.bootstrap);
      expect(result.status).toBe(1);
      expect(result.stdout).toContain(
        "::error::vercel.json in live-data's tree does not turn off deployments for live-data; refusing to push.",
      );
      expect(result.stdout).not.toContain("Pushed");
      expect(pushes(fx)).toEqual([]);
      expect(originHead(fx, "live-data")).toBe(fx.liveData);
    },
    TIMEOUT,
  );

  it(
    "on a dry run prints the fast-forward it would push and pushes nothing",
    () => {
      const fx = makeFixture({ liveData: true });
      const ld = fx.liveData as string;
      const co = checkout(fx);
      writeFiles(fx.work, PIPELINE_CHANGES);
      const result = commit(fx, co.base, co.bootstrap, { DRY_RUN: "1" });
      expect(result.status, result.stderr).toBe(0);
      const match = result.stdout.match(
        /Dry run: would fast-forward live-data from ([0-9a-f]{40}) to ([0-9a-f]{40}) \(git push origin \2:refs\/heads\/live-data\)\./,
      );
      expect(match, result.stdout).not.toBeNull();
      const [, from, wouldPush] = match as RegExpMatchArray;
      expect(from).toBe(ld);
      // The commit it would push is right, and exists only in the job's checkout.
      expect(git(fx.work, ["diff", "--name-status", ld, wouldPush]).split("\n").sort()).toEqual(EXPECTED_CHANGES);
      expect(run("git", ["--git-dir", fx.origin, "cat-file", "-e", wouldPush], fx.root).status).not.toBe(0);
      expect(pushes(fx)).toEqual([]);
      expect(originHead(fx, "live-data")).toBe(ld);
      expectCodeUntouched(fx);
    },
    TIMEOUT,
  );

  it(
    "on a dry run of a bootstrap prints the branch it would create and pushes nothing",
    () => {
      const fx = makeFixture({ liveData: false });
      const co = checkout(fx);
      writeFiles(fx.work, PIPELINE_CHANGES);
      const result = commit(fx, co.base, co.bootstrap, { DRY_RUN: "1" });
      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout).toMatch(
        new RegExp(`Dry run: would create live-data at ([0-9a-f]{40}), cut from main's HEAD ${fx.main} \\(git push origin \\1:refs/heads/live-data\\)\\.`),
      );
      expect(pushes(fx)).toEqual([]);
      expect(originHead(fx, "live-data")).toBeNull();
    },
    TIMEOUT,
  );

  it(
    "on a dry run reports a vercel.json problem without failing, and pushes nothing",
    () => {
      const fx = makeFixture({ liveData: true, liveDataVercel: '{ "git": {} }\n' });
      const co = checkout(fx);
      writeFiles(fx.work, PIPELINE_CHANGES);
      const result = commit(fx, co.base, co.bootstrap, { DRY_RUN: "1" });
      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout).toContain("::error::vercel.json in live-data's tree does not turn off deployments for live-data; refusing to push.");
      expect(result.stdout).toContain(`Dry run: would fast-forward live-data from ${fx.liveData} to `);
      expect(pushes(fx)).toEqual([]);
      expect(originHead(fx, "live-data")).toBe(fx.liveData);
    },
    TIMEOUT,
  );
});
