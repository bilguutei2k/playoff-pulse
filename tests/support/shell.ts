// Helpers for tests that run the live job's shell scripts (scripts/live/*.sh) against
// throwaway git repositories and fake `gh` and `curl` commands.
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));

export function liveScript(name: string): string {
  return path.join(REPO_ROOT, "scripts", "live", name);
}

// Variables a developer's shell or a CI runner may set that would change what the scripts
// or git do. Tests pass the ones a script needs explicitly.
const DROPPED = /^(GIT_|GITHUB_|DATA_|RUNNER_|GH_|DRY_RUN$|HEALTH_FILE$|STATE_FILE$|SITE_URL$|LAG_MINUTES$|ALERT_DATE$)/;

export function cleanEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const key of Object.keys(env)) {
    if (DROPPED.test(key)) delete env[key];
  }
  return {
    ...env,
    // No global or system git config, so hooks, signing or a default branch cannot leak in;
    // C locale, so git's messages are the English ones the tests read.
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_TERMINAL_PROMPT: "0",
    LC_ALL: "C",
    GIT_AUTHOR_NAME: "Fixture",
    GIT_AUTHOR_EMAIL: "fixture@example.com",
    GIT_COMMITTER_NAME: "Fixture",
    GIT_COMMITTER_EMAIL: "fixture@example.com",
    ...extra,
  };
}

/** Runs git and returns its trimmed stdout; throws if git fails. */
export function git(cwd: string, args: string[], extra: Record<string, string> = {}): string {
  return execFileSync("git", args, { cwd, env: cleanEnv(extra), encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

export interface RunResult {
  status: number;
  stdout: string;
  stderr: string;
}

/** Runs a command to completion and reports its exit status and output; never throws. */
export function run(command: string, args: string[], cwd: string, extra: Record<string, string> = {}): RunResult {
  const result = spawnSync(command, args, { cwd, env: cleanEnv(extra), encoding: "utf8" });
  if (result.error) throw result.error;
  return { status: result.status ?? -1, stdout: result.stdout, stderr: result.stderr };
}

const created: string[] = [];

export function tempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  created.push(dir);
  return dir;
}

export function removeTempDirs(): void {
  for (const dir of created.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
}

/** Writes files under `dir`; a null value deletes the file. */
export function writeFiles(dir: string, files: Record<string, string | null>): void {
  for (const [relative, content] of Object.entries(files)) {
    const target = path.join(dir, relative);
    if (content === null) {
      fs.rmSync(target, { force: true });
    } else {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, content);
    }
  }
}

/** Stages everything and commits it; returns the new commit. */
export function commitAll(repo: string, message: string, files: Record<string, string | null>, extra: Record<string, string> = {}): string {
  writeFiles(repo, files);
  git(repo, ["add", "-A"], extra);
  git(repo, ["commit", "-q", "--allow-empty", "-m", message], extra);
  return git(repo, ["rev-parse", "HEAD"]);
}

// A fake `gh`. Every call is appended to $FAKE_LOG as a JSON array of its arguments.
//   gh issue list ... --jq <expr>   applies <expr> to $FAKE_GH_ISSUES (default [])
//   gh issue create ...             prints an issue URL
//   gh api <path> --jq <expr>       applies <expr> to $FAKE_GH_API_DIR/<path with / ? = & as _>.json
// FAKE_GH_FAIL=1 makes every call fail.
const FAKE_GH = `#!/usr/bin/env bash
printf '%s\\0' "$@" | jq -Rsc 'split("\\u0000")[:-1]' >> "$FAKE_LOG"
if [ "\${FAKE_GH_FAIL:-0}" = "1" ]; then echo "fake gh: failing on purpose" >&2; exit 1; fi
args=("$@")
expr=""
i=0
while [ "$i" -lt "$#" ]; do
  if [ "\${args[$i]}" = "--jq" ]; then expr="\${args[$((i + 1))]}"; fi
  i=$((i + 1))
done
emit() { if [ -n "$expr" ]; then jq -r "$expr"; else cat; fi; }
case "$1 \${2:-}" in
  "issue list") printf '%s' "\${FAKE_GH_ISSUES:-[]}" | emit ;;
  "issue create") echo "https://github.com/example/fixture/issues/1" ;;
  "api "*)
    file="\${FAKE_GH_API_DIR:-/nonexistent}/$(printf '%s' "$2" | tr '/?=&' '____').json"
    if [ -f "$file" ]; then emit < "$file"; else echo "fake gh: no response for $2" >&2; exit 1; fi ;;
  *) echo "fake gh: unhandled call: $*" >&2; exit 1 ;;
esac
`;

// A fake `curl`: prints $FAKE_CURL_BODY, or fails like curl -f on an HTTP error when it is
// unset. Calls are logged like gh's.
const FAKE_CURL = `#!/usr/bin/env bash
printf '%s\\0' curl "$@" | jq -Rsc 'split("\\u0000")[:-1]' >> "$FAKE_LOG"
if [ -z "\${FAKE_CURL_BODY:-}" ]; then echo "curl: (22) The requested URL returned error: 500" >&2; exit 22; fi
printf '%s' "$FAKE_CURL_BODY"
`;

export interface FakeTools {
  /** PATH with the fake gh and curl first. */
  path: string;
  log: string;
  calls(): string[][];
}

export function installFakeTools(dir: string): FakeTools {
  const bin = path.join(dir, "fake-bin");
  fs.mkdirSync(bin, { recursive: true });
  fs.writeFileSync(path.join(bin, "gh"), FAKE_GH, { mode: 0o755 });
  fs.writeFileSync(path.join(bin, "curl"), FAKE_CURL, { mode: 0o755 });
  const log = path.join(dir, "fake-calls.log");
  fs.writeFileSync(log, "");
  return {
    path: `${bin}:${process.env.PATH ?? ""}`,
    log,
    calls: () =>
      fs
        .readFileSync(log, "utf8")
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line) as string[]),
  };
}
