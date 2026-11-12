// Decision logic of the live job's two side scripts, with fake `gh` and `curl` on PATH:
// scripts/live/report-alert.sh (one issue per slate on a report or views problem) and
// scripts/live/deploy-check.sh (retry a deploy Vercel refused; never fails). deploy-check
// runs against a throwaway origin whose commits are backdated, and really pushes to it.
import fs from "node:fs";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { commitAll, git, installFakeTools, liveScript, removeTempDirs, run, tempDir } from "./support/shell";

afterAll(removeTempDirs);

const TIMEOUT = 30_000;

describe("report-alert.sh", () => {
  function reportAlert(health: object, env: Record<string, string> = {}, args = ["Injury report problem"]) {
    const dir = tempDir("pp-report-alert-");
    const tools = installFakeTools(dir);
    fs.writeFileSync(path.join(dir, "health.json"), JSON.stringify(health));
    fs.writeFileSync(path.join(dir, "state.json"), JSON.stringify({ slateEtDate: "2026-11-04" }));
    const result = run("bash", [liveScript("report-alert.sh"), ...args], dir, {
      PATH: tools.path,
      FAKE_LOG: tools.log,
      GH_TOKEN: "fake",
      HEALTH_FILE: path.join(dir, "health.json"),
      STATE_FILE: path.join(dir, "state.json"),
      ...env,
    });
    return { ...result, calls: tools.calls() };
  }
  const creates = (calls: string[][]) => calls.filter((args) => args[0] === "issue" && args[1] === "create");

  it("does nothing, and calls nothing, without a report problem", () => {
    const result = reportAlert({ reportProblem: null });
    expect(result.status).toBe(0);
    expect(result.calls).toEqual([]);
  });

  it("opens one issue per slate with the problem in the body", () => {
    const result = reportAlert({ reportProblem: "The 11:30 AM report failed to parse." });
    expect(result.status, result.stderr).toBe(0);
    const [create] = creates(result.calls);
    expect(create[create.indexOf("--title") + 1]).toBe("Injury report problem on 2026-11-04");
    expect(create[create.indexOf("--body") + 1]).toContain("The 11:30 AM report failed to parse.");
  });

  it("does not open it twice for the same slate", () => {
    const result = reportAlert(
      { reportProblem: "still broken" },
      { FAKE_GH_ISSUES: JSON.stringify([{ title: "Injury report problem on 2026-11-04" }]) },
    );
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Already reported: Injury report problem on 2026-11-04");
    expect(creates(result.calls)).toEqual([]);
  });

  it("on a dry run prints the issue and opens nothing", () => {
    const result = reportAlert({ reportProblem: "broken" }, { DRY_RUN: "1" });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Dry run: would open issue: Injury report problem on 2026-11-04");
    expect(creates(result.calls)).toEqual([]);
  });

  const views = ["Model views problem", "viewsProblem"];

  it("opens one issue per slate for a views problem, even without a report problem", () => {
    const result = reportAlert({ reportProblem: null, viewsProblem: "player index is 1.6 MB" }, {}, views);
    expect(result.status, result.stderr).toBe(0);
    const [create] = creates(result.calls);
    expect(create[create.indexOf("--title") + 1]).toBe("Model views problem on 2026-11-04");
    const body = create[create.indexOf("--body") + 1];
    expect(body).toContain("player index is 1.6 MB");
    expect(body).toContain("Seals and the record are unaffected.");
  });

  it("keeps the two problems apart", () => {
    expect(reportAlert({ reportProblem: "report broken", viewsProblem: null }, {}, views).calls).toEqual([]);
    expect(reportAlert({ reportProblem: null, viewsProblem: "views broken" }).calls).toEqual([]);
  });

  it("opens one issue per slate for a 548 score problem, apart from the other two", () => {
    const score = ["548 score problem", "scoreProblem"];
    const result = reportAlert({ reportProblem: null, viewsProblem: null, scoreProblem: "548 score prior prior-2026.json is missing" }, {}, score);
    expect(result.status, result.stderr).toBe(0);
    const [create] = creates(result.calls);
    expect(create[create.indexOf("--title") + 1]).toBe("548 score problem on 2026-11-04");
    const body = create[create.indexOf("--body") + 1];
    expect(body).toContain("prior-2026.json is missing");
    expect(body).toContain("forecasts, seals, the record and every other view are unaffected");
    expect(reportAlert({ reportProblem: null, viewsProblem: "views broken", scoreProblem: null }, {}, score).calls).toEqual([]);
    expect(reportAlert({ reportProblem: null, viewsProblem: null, scoreProblem: "x" }, {}, views).calls).toEqual([]);
  });

  it("refuses an unknown field", () => {
    const result = reportAlert({ reportProblem: "x" }, {}, ["Prefix", "stuckGames"]);
    expect(result.status).toBe(2);
    expect(result.calls).toEqual([]);
  });
});

describe("deploy-check.sh", () => {
  const RETRY_SUBJECT = "chore(deploy): retry production deploy";
  const today = () => new Date().toISOString().slice(0, 10);

  interface Repo {
    root: string;
    origin: string;
    seed: string;
    work: string;
    pushLog: string;
    commit(message: string, files: Record<string, string | null>, minutesAgo: number): string;
  }

  function makeRepo(): Repo {
    const root = tempDir("pp-deploy-check-");
    const origin = path.join(root, "origin.git");
    const seed = path.join(root, "seed");
    git(root, ["init", "-q", "--bare", "-b", "main", origin]);
    git(root, ["init", "-q", "-b", "main", seed]);
    git(seed, ["remote", "add", "origin", `file://${origin}`]);
    const pushLog = path.join(root, "pushes.log");
    const work = path.join(root, "work");
    return {
      root,
      origin,
      seed,
      work,
      pushLog,
      commit(message, files, minutesAgo) {
        const date = `@${Math.floor(Date.now() / 1000) - minutesAgo * 60} +0000`;
        return commitAll(seed, message, files, { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date });
      },
    };
  }

  /** Pushes the seed's main to origin, logs later pushes, and clones the job's checkout. */
  function publish(repo: Repo) {
    git(repo.seed, ["push", "-q", "origin", "main"]);
    fs.writeFileSync(repo.pushLog, "");
    fs.writeFileSync(path.join(repo.origin, "hooks", "pre-receive"), `#!/bin/sh\ncat >> "${repo.pushLog}"\n`, { mode: 0o755 });
    git(repo.root, ["clone", "-q", "--depth", "20", "--branch", "main", `file://${repo.origin}`, repo.work]);
  }

  function deployCheck(repo: Repo, deployed: string | null, env: Record<string, string> = {}) {
    const tools = installFakeTools(repo.root);
    const result = run("bash", [liveScript("deploy-check.sh")], repo.work, {
      PATH: tools.path,
      FAKE_LOG: tools.log,
      GH_TOKEN: "fake",
      GITHUB_REPOSITORY: "bilguutei2k/playoff-pulse",
      SITE_URL: "https://example.test",
      ...(deployed === null ? {} : { FAKE_CURL_BODY: JSON.stringify({ deployment: { commit: deployed } }) }),
      ...env,
    });
    const pushes = fs.readFileSync(repo.pushLog, "utf8").split("\n").filter(Boolean);
    const originMain = git(repo.root, ["--git-dir", repo.origin, "rev-parse", "refs/heads/main"]);
    return { ...result, calls: tools.calls(), pushes, originMain };
  }

  const issueCreates = (calls: string[][]) => calls.filter((args) => args[0] === "issue" && args[1] === "create");

  function base(repo: Repo): string {
    return repo.commit("feat: deployed code", { "src/app.ts": "v1\n", "data/live/state.json": "{}\n" }, 180);
  }

  it(
    "leaves production alone when it runs main's head",
    () => {
      const repo = makeRepo();
      const deployed = base(repo);
      publish(repo);
      const result = deployCheck(repo, deployed);
      expect(result.status).toBe(0);
      expect(result.stderr).toContain(`production is current: nothing deployable on main since ${deployed}`);
      expect(result.pushes).toEqual([]);
    },
    TIMEOUT,
  );

  it(
    "ignores commits that change only data/live and docs/design",
    () => {
      const repo = makeRepo();
      const deployed = base(repo);
      repo.commit("chore(live): update forecasts", { "data/live/state.json": '{"v":2}\n' }, 120);
      repo.commit("docs: design", { "docs/design/notes.md": "x\n" }, 90);
      publish(repo);
      const result = deployCheck(repo, deployed);
      expect(result.stderr).toContain("production is current");
      expect(result.pushes).toEqual([]);
    },
    TIMEOUT,
  );

  it(
    "waits while a deployable commit is under 20 minutes old",
    () => {
      const repo = makeRepo();
      const deployed = base(repo);
      repo.commit("feat: new code", { "src/app.ts": "v2\n" }, 5);
      publish(repo);
      const result = deployCheck(repo, deployed);
      expect(result.stderr).toContain("within 20 min; Vercel may still be building it.");
      expect(result.pushes).toEqual([]);
    },
    TIMEOUT,
  );

  it(
    "pushes one empty commit to main when a deployable commit has waited over 20 minutes",
    () => {
      const repo = makeRepo();
      const deployed = base(repo);
      const pending = repo.commit("feat: new code", { "src/app.ts": "v2\n" }, 60);
      publish(repo);
      const result = deployCheck(repo, deployed);
      expect(result.status).toBe(0);
      expect(result.stderr).toContain("(retry 1 of 3 today)");
      expect(result.pushes).toHaveLength(1);
      expect(result.originMain).not.toBe(pending);
      const originGit = (args: string[]) => git(repo.root, ["--git-dir", repo.origin, ...args]);
      expect(originGit(["log", "-1", "--format=%s", result.originMain])).toBe(RETRY_SUBJECT);
      expect(originGit(["rev-parse", `${result.originMain}^`])).toBe(pending);
      expect(originGit(["rev-parse", `${result.originMain}^{tree}`])).toBe(originGit(["rev-parse", `${pending}^{tree}`]));
    },
    TIMEOUT,
  );

  it(
    "on a dry run prints the retry and pushes nothing",
    () => {
      const repo = makeRepo();
      const deployed = base(repo);
      const pending = repo.commit("feat: new code", { "src/app.ts": "v2\n" }, 60);
      publish(repo);
      const result = deployCheck(repo, deployed, { DRY_RUN: "1" });
      expect(result.stderr).toContain("Dry run: would push empty commit");
      expect(result.pushes).toEqual([]);
      expect(result.originMain).toBe(pending);
    },
    TIMEOUT,
  );

  it(
    "retries at most once an hour",
    () => {
      const repo = makeRepo();
      const deployed = base(repo);
      repo.commit("feat: new code", { "src/app.ts": "v2\n" }, 90);
      repo.commit(RETRY_SUBJECT, {}, 30);
      publish(repo);
      const result = deployCheck(repo, deployed);
      expect(result.stderr).toContain("already retried within the hour; waiting.");
      expect(result.pushes).toEqual([]);
    },
    TIMEOUT,
  );

  it(
    "after three retries in 24 hours opens one issue for the day instead",
    () => {
      const repo = makeRepo();
      const deployed = base(repo);
      repo.commit("feat: new code", { "src/app.ts": "v2\n" }, 170);
      for (const minutesAgo of [160, 120, 80]) repo.commit(RETRY_SUBJECT, {}, minutesAgo);
      publish(repo);
      const result = deployCheck(repo, deployed);
      expect(result.status).toBe(0);
      expect(result.stderr).toContain("three retries in 24 hours already; opening an issue instead.");
      const [create] = issueCreates(result.calls);
      expect(create[create.indexOf("--title") + 1]).toBe(`Production deploy stuck on ${today()}`);
      expect(result.pushes).toEqual([]);

      const again = deployCheck(repo, deployed, { FAKE_GH_ISSUES: JSON.stringify([{ title: `Production deploy stuck on ${today()}` }]) });
      expect(again.stderr).toContain(`Already reported: Production deploy stuck on ${today()}`);
      expect(issueCreates(again.calls)).toEqual([]);
    },
    TIMEOUT,
  );

  it(
    "falls back to GitHub's last successful Production deployment when the site does not say",
    () => {
      const repo = makeRepo();
      const deployed = base(repo);
      publish(repo);
      const api = path.join(repo.root, "api");
      fs.mkdirSync(api);
      const key = (p: string) => p.replace(/[/?=&]/g, "_");
      const prefix = "repos/bilguutei2k/playoff-pulse/deployments";
      fs.writeFileSync(path.join(api, `${key(`${prefix}?environment=Production&per_page=10`)}.json`), JSON.stringify([{ id: 2 }, { id: 1 }]));
      fs.writeFileSync(path.join(api, `${key(`${prefix}/2/statuses?per_page=1`)}.json`), JSON.stringify([{ state: "failure" }]));
      fs.writeFileSync(path.join(api, `${key(`${prefix}/1/statuses?per_page=1`)}.json`), JSON.stringify([{ state: "success" }]));
      fs.writeFileSync(path.join(api, `${key(`${prefix}/1`)}.json`), JSON.stringify({ sha: deployed }));
      const result = deployCheck(repo, null, { FAKE_GH_API_DIR: api });
      expect(result.stderr).toContain(`GitHub's last successful Production deployment is ${deployed}.`);
      expect(result.stderr).toContain("production is current");
    },
    TIMEOUT,
  );

  it(
    "never fails, even when the site and GitHub are both unreachable",
    () => {
      const repo = makeRepo();
      base(repo);
      publish(repo);
      const result = deployCheck(repo, null, { FAKE_GH_FAIL: "1" });
      expect(result.status).toBe(0);
      expect(result.stderr).toContain("deployed commit unknown; skipping.");
      expect(result.pushes).toEqual([]);
    },
    TIMEOUT,
  );
});
