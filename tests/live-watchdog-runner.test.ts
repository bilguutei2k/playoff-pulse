import fs from "node:fs";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { removeTempDirs, run, tempDir } from "./support/shell";

afterAll(removeTempDirs);
function execute(dry: boolean, existing = false, failedRead = "", failDispatch = false) {
  const dir = tempDir("pp-watchdog-");
  const bin = path.join(dir, "bin");
  fs.mkdirSync(bin);
  const log = path.join(dir, "calls.jsonl");
  // Deterministic local stand-ins for GitHub and git; no network or repository writes.
  fs.writeFileSync(path.join(bin, "gh"), `#!/usr/bin/env node
const fs = require("node:fs");
const args = process.argv.slice(2);
fs.appendFileSync(process.env.CALL_LOG, JSON.stringify(args) + "\\n");
if (args[0] === "workflow" && process.env.FAIL_DISPATCH === "1") process.exit(1);
if (args[0] === "api") {
  if (args.at(-1).includes("/issues?")) {
    console.log(JSON.stringify([${existing ? '[{ number: 42, title: "Live watchdog on " + new Date().toISOString().slice(0, 10) }]' : "[]"}]));
  } else console.log('[{"workflow_runs":[]}]');
}
`, { mode: 0o755 });
  fs.writeFileSync(path.join(bin, "git"), `#!/usr/bin/env node
const args = process.argv.slice(2);
if (process.env.FAILED_READ && args[1]?.endsWith(process.env.FAILED_READ)) process.exit(1);
if (args[0] === "rev-parse") console.log("a".repeat(40));
else if (args[1].endsWith("state.json")) console.log(JSON.stringify({ season: 2027, seasonLabel: "2026-27", generatedAt: "2026-11-01T00:00:00Z" }));
else if (args[1].includes("/games/")) console.log("[]");
else if (args[1].endsWith("health.json")) console.log('{"viewsProblem":"broken views"}');
`, { mode: 0o755 });
  const result = run("node", [path.resolve("scripts/live/watchdog.mjs")], dir, {
    PATH: `${bin}:${process.env.PATH}`, CALL_LOG: log, GITHUB_REPOSITORY: "example/repo",
    GITHUB_RUN_ID: "123", DRY_RUN: dry ? "1" : "0",
    FAILED_READ: failedRead, FAIL_DISPATCH: failDispatch ? "1" : "0",
  });
  return { ...result, calls: fs.readFileSync(log, "utf8").trim().split("\n").map((line) => JSON.parse(line) as string[]) };
}
describe("watchdog side effects", () => {
  it("dry run logs dispatch and alert decisions without any write", () => {
    const result = execute(true);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('"dispatch": true');
    expect(result.stdout).toContain("viewsProblem: broken views");
    expect(result.stdout).toContain("Dry run: no dispatch and no issue create/comment.");
    expect(result.calls.every((args) => args[0] === "api")).toBe(true);
  });
  it("restarts an idle chain and creates the UTC-day issue", () => {
    const result = execute(false);
    expect(result.status, result.stderr).toBe(0);
    expect(result.calls).toContainEqual(["workflow", "run", "live-forecast.yml", "--ref", "main"]);
    expect(result.calls.some((args) => args[0] === "issue" && args[1] === "create")).toBe(true);
  });
  it.each(["state.json", "health.json", "2026-27.jsonl"])("still restarts and alerts when %s is unreadable", (file) => {
    const result = execute(false, false, file);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("Cannot read published");
    expect(result.calls).toContainEqual(["workflow", "run", "live-forecast.yml", "--ref", "main"]);
    expect(result.calls.some((args) => args[0] === "issue" && args[1] === "create")).toBe(true);
  });
  it("still delivers alerts when chain dispatch fails", () => {
    const result = execute(false, false, "", true);
    expect(result.status).not.toBe(0);
    expect(result.calls.some((args) => args[0] === "issue" && args[1] === "create")).toBe(true);
  });
  it("appends to the existing UTC-day issue instead of creating another", () => {
    const result = execute(false, true);
    expect(result.status, result.stderr).toBe(0);
    expect(result.calls.some((args) => args[0] === "issue" && args[1] === "create")).toBe(false);
    expect(result.calls.some((args) => args[0] === "issue" && args[1] === "comment" && args[2] === "42")).toBe(true);
  });
});
