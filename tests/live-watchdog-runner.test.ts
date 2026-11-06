// The live watchdog's side effects (scripts/live/watchdog.mjs) against fake gh and git: no
// network and no repository. Every gh call is logged, so the tests see exactly what it
// would dispatch, open or comment.
import fs from "node:fs";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { removeTempDirs, REPO_ROOT, run, tempDir } from "./support/shell";

afterAll(removeTempDirs);

const FAKE_GH = `#!/usr/bin/env node
const fs = require("node:fs");
const args = process.argv.slice(2);
fs.appendFileSync(process.env.CALL_LOG, JSON.stringify(args) + "\\n");
const env = (name, fallback) => process.env[name] ?? fallback;
const fail = (what) => { console.error("fake gh: " + what + " failing on purpose"); process.exit(1); };
const path = args.find((arg) => arg.startsWith("repos/")) ?? "";
if (args[0] === "workflow") { if (env("FAIL_DISPATCH") === "1") fail("dispatch"); process.exit(0); }
if (args[0] === "issue" && args[1] === "list") { if (env("FAIL_ISSUES") === "1") fail("issue list"); console.log(env("ISSUES", "[]")); process.exit(0); }
if (args[0] === "issue") { if (env("FAIL_POST") === "1") fail("post"); process.exit(0); }
if (path.endsWith("/actions/workflows/live-forecast.yml")) { console.log(env("WORKFLOW_STATE", "active")); process.exit(0); }
if (path.includes("/runs?")) {
  if (env("FAIL_RUNS") === "1") fail("runs");
  console.log(JSON.stringify([{ workflow_runs: path.includes("created=") ? JSON.parse(env("RUNS", "[]")) : [] }]));
  process.exit(0);
}
if (/\\/issues\\/\\d+$/.test(path)) { console.log(env("ISSUE_BODY", "")); process.exit(0); }
if (path.includes("/comments")) { console.log(JSON.stringify([JSON.parse(env("COMMENTS", "[]")).map((body) => ({ body }))])); process.exit(0); }
fail("unhandled call " + args.join(" "));
`;

const FAKE_GIT = `#!/usr/bin/env node
const args = process.argv.slice(2);
const target = args[1] ?? "";
if (process.env.FAILED_READ && target.endsWith(process.env.FAILED_READ)) process.exit(128);
if (args[0] === "rev-parse") { console.log("c".repeat(40)); process.exit(0); }
if (target.endsWith("state.json")) console.log(process.env.STATE);
else if (target.includes("/games/")) console.log(process.env.GAMES ?? "[]");
else if (target.includes("/ledger/")) console.log(process.env.LEDGER ?? "");
else process.exit(128);
`;

interface Options {
  dry?: boolean;
  env?: Record<string, string>;
}

/** The test's clock is real, so fixtures are built relative to now. */
const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();
const today = () => new Date().toISOString().slice(0, 10);
const FRESH = JSON.stringify({ season: 2027, seasonLabel: "2026-27", generatedAt: minutesAgo(5) });
const STALE = JSON.stringify({ season: 2027, seasonLabel: "2026-27", generatedAt: "2026-11-01T00:00:00.000Z" });
const busy = JSON.stringify([{ id: 9, created_at: minutesAgo(3), status: "in_progress", conclusion: null, display_title: "Live forecast" }]);

function watchdog({ dry = false, env = {} }: Options = {}) {
  const dir = tempDir("pp-watchdog-");
  const bin = path.join(dir, "bin");
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, "gh"), FAKE_GH, { mode: 0o755 });
  fs.writeFileSync(path.join(bin, "git"), FAKE_GIT, { mode: 0o755 });
  const log = path.join(dir, "calls.jsonl");
  fs.writeFileSync(log, "");
  const result = run("node", [path.join(REPO_ROOT, "scripts/live/watchdog.mjs")], dir, {
    PATH: `${bin}:${process.env.PATH}`,
    CALL_LOG: log,
    GITHUB_REPOSITORY: "example/repo",
    GITHUB_RUN_ID: "123",
    DRY_RUN: dry ? "1" : "0",
    STATE: STALE,
    ...env,
  });
  const calls = fs.readFileSync(log, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line) as string[]);
  const writes = calls.filter((args) => args[0] === "workflow" || (args[0] === "issue" && args[1] !== "list"));
  const posted = writes.find((args) => args[0] === "issue")?.find((_, index, all) => all[index - 1] === "--body") ?? "";
  return { ...result, calls, writes, posted };
}

describe("watchdog side effects", () => {
  it("dry run logs the dispatch and the issue it would open, and writes nothing", () => {
    const result = watchdog({ dry: true });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('"dispatch": true');
    expect(result.stdout).toContain("Dry run: would dispatch live-forecast.yml on main.");
    expect(result.stdout).toContain(`Dry run: would open "Live watchdog on ${today()}"`);
    expect(result.stdout).toContain("Dry run: no dispatch and no issue create/comment.");
    expect(result.writes).toEqual([]);
  });

  it("restarts an idle chain on main and opens the day's issue with every alert's key", () => {
    const result = watchdog();
    expect(result.status, result.stderr).toBe(0);
    expect(result.writes[0]).toEqual(["workflow", "run", "live-forecast.yml", "--ref", "main"]);
    expect(result.writes[1].slice(0, 4)).toEqual(["issue", "create", "--title", `Live watchdog on ${today()}`]);
    expect(result.posted).toContain("started the chain");
    expect(result.posted).toContain("https://github.com/example/repo/actions/runs/123");
    expect(result.posted).toMatch(/<!-- live-watchdog: restart stale-2026-11-01T00:00:00.000Z -->$/);
  });

  it("does nothing on a healthy, busy chain", () => {
    const result = watchdog({ env: { RUNS: busy, STATE: FRESH } });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("No alerts.");
    expect(result.writes).toEqual([]);
  });

  it("does not repeat a condition already reported in the day's issue", () => {
    const issue = JSON.stringify([{ number: 42, title: `Live watchdog on ${today()}` }]);
    const reported = {
      ISSUES: issue,
      RUNS: busy,
      ISSUE_BODY: "first\n<!-- live-watchdog: restart -->",
      COMMENTS: JSON.stringify(["later\n<!-- live-watchdog: stale-2026-11-01T00:00:00.000Z -->"]),
    };
    const quiet = watchdog({ env: reported });
    expect(quiet.status, quiet.stderr).toBe(0);
    expect(quiet.stdout).toContain("Already reported in #42");
    expect(quiet.writes).toEqual([]);

    // A new condition the same day is appended to that issue, alone.
    const fresh = watchdog({ env: { ...reported, COMMENTS: "[]" } });
    expect(fresh.status, fresh.stderr).toBe(0);
    expect(fresh.writes.map((args) => args.slice(0, 3))).toEqual([["issue", "comment", "42"]]);
    expect(fresh.posted).toMatch(/<!-- live-watchdog: stale-2026-11-01T00:00:00.000Z -->$/);
  });

  it.each(["state.json", "2027.json", "2026-27.jsonl"])("still restarts and alerts when %s is unreadable", (file) => {
    const result = watchdog({ env: { FAILED_READ: file } });
    expect(result.status, result.stderr).toBe(0);
    expect(result.writes[0]).toEqual(["workflow", "run", "live-forecast.yml", "--ref", "main"]);
    expect(result.posted).toContain("Could not read");
  });

  it("still reports when the dispatch fails, then fails the watchdog run", () => {
    const result = watchdog({ env: { FAIL_DISPATCH: "1" } });
    expect(result.status).toBe(1);
    expect(result.posted).toContain("Could not dispatch live-forecast.yml");
    expect(result.posted).toContain("dispatch-failed");
  });

  it("neither dispatches nor guesses when runs cannot be listed, reports it and fails", () => {
    const result = watchdog({ env: { FAIL_RUNS: "1" } });
    expect(result.status).toBe(1);
    expect(result.writes.some((args) => args[0] === "workflow")).toBe(false);
    expect(result.posted).toContain("runs-unreadable");
  });

  it("opens nothing when it cannot look up the day's issue, and fails", () => {
    const result = watchdog({ env: { FAIL_ISSUES: "1" } });
    expect(result.status).toBe(1);
    expect(result.writes).toEqual([["workflow", "run", "live-forecast.yml", "--ref", "main"]]);
  });

  it("stays idle and silent while live-forecast is disabled by hand", () => {
    const result = watchdog({ env: { WORKFLOW_STATE: "disabled_manually" } });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("disabled by hand");
    expect(result.writes).toEqual([]);
  });
});
