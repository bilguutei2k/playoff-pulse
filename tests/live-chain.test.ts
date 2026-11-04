// The live job's chain decision (scripts/live/chain-decision.sh) and its once-a-day
// failure issue (scripts/live/failure-alert.sh). The chain never stops on its own: three
// failures in a row slow it from every 10 minutes to every 30, and one success restores 10.
import fs from "node:fs";
import { afterAll, describe, expect, it } from "vitest";
import { installFakeTools, liveScript, removeTempDirs, run, tempDir } from "./support/shell";

afterAll(removeTempDirs);

interface Decision {
  streak: number;
  wait_minutes: number;
  open_issue: number;
}

function decide(thisStatus: string, earlier: string[]): Decision & { log: string } {
  const result = run("bash", [liveScript("chain-decision.sh"), thisStatus, ...earlier], process.cwd());
  expect(result.status, result.stderr).toBe(0);
  const out = Object.fromEntries(
    result.stdout
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const [key, value] = line.split("=");
        return [key, Number(value)];
      }),
  );
  expect(Object.keys(out).sort()).toEqual(["open_issue", "streak", "wait_minutes"]);
  return { ...(out as unknown as Decision), log: result.stderr };
}

const failures = (n: number) => Array.from({ length: n }, () => "failure");

describe("chain decision", () => {
  it("streak 0: a success after a success waits 10 minutes, no issue", () => {
    expect(decide("success", ["success", "failure"])).toMatchObject({ streak: 0, wait_minutes: 10, open_issue: 0 });
  });

  it("streak 2: two failures in a row still wait 10 minutes, no issue", () => {
    expect(decide("failure", ["failure", "success", "failure"])).toMatchObject({ streak: 2, wait_minutes: 10, open_issue: 0 });
  });

  it("streak 3: the third failure in a row backs off to 30 minutes and asks for the issue", () => {
    const decision = decide("failure", [...failures(2), "success"]);
    expect(decision).toMatchObject({ streak: 3, wait_minutes: 30, open_issue: 1 });
    expect(decision.log).toContain("3 failures in a row; backing off: the next run waits about 30 minutes.");
  });

  it("streak 7: a long streak keeps dispatching every 30 minutes, never stops", () => {
    expect(decide("failure", [...failures(6), "success"])).toMatchObject({ streak: 7, wait_minutes: 30, open_issue: 1 });
  });

  it("recovery: one success after seven failures returns to 10 minutes", () => {
    expect(decide("success", failures(7))).toMatchObject({ streak: 0, wait_minutes: 10, open_issue: 0 });
  });

  it("passes over cancelled and skipped runs, which never ran the job", () => {
    expect(decide("failure", ["cancelled", "failure", "skipped", "failure", "success"])).toMatchObject({
      streak: 3,
      wait_minutes: 30,
      open_issue: 1,
    });
  });

  it("counts timed-out and startup failures as failures", () => {
    expect(decide("failure", ["timed_out", "startup_failure", "success"])).toMatchObject({ streak: 3, wait_minutes: 30 });
  });

  it("a cancelled run keeps the earlier streak's wait but opens no issue", () => {
    expect(decide("cancelled", failures(3))).toMatchObject({ streak: 3, wait_minutes: 30, open_issue: 0 });
  });

  it("with no history, a first failure waits 10 minutes", () => {
    expect(decide("failure", [])).toMatchObject({ streak: 1, wait_minutes: 10, open_issue: 0 });
  });
});

describe("failure alert", () => {
  const RUN_URL = "https://github.com/bilguutei2k/playoff-pulse/actions/runs/123";

  function alert(env: Record<string, string>) {
    const dir = tempDir("pp-failure-alert-");
    const tools = installFakeTools(dir);
    const result = run("bash", [liveScript("failure-alert.sh"), "Live job failing", RUN_URL, "4"], dir, {
      PATH: tools.path,
      FAKE_LOG: tools.log,
      GH_TOKEN: "fake",
      ALERT_DATE: "2026-11-04",
      ...env,
    });
    return { ...result, calls: tools.calls() };
  }

  it("opens one issue titled for the UTC day, with the failing run's URL", () => {
    const result = alert({});
    expect(result.status).toBe(0);
    const creates = result.calls.filter((args) => args[0] === "issue" && args[1] === "create");
    expect(creates).toHaveLength(1);
    const create = creates[0];
    expect(create[create.indexOf("--title") + 1]).toBe("Live job failing on 2026-11-04");
    const body = create[create.indexOf("--body") + 1];
    expect(body).toContain(RUN_URL);
    expect(body).toContain("failed 4 runs in a row");
    expect(result.stderr).toContain("Opened issue: Live job failing on 2026-11-04");
  });

  it("does not open a second issue the same day", () => {
    const result = alert({ FAKE_GH_ISSUES: JSON.stringify([{ title: "Live job failing on 2026-11-04" }]) });
    expect(result.status).toBe(0);
    expect(result.stderr).toContain("Already reported: Live job failing on 2026-11-04");
    expect(result.calls.some((args) => args[1] === "create")).toBe(false);
  });

  it("opens a new one on the next day", () => {
    const result = alert({
      ALERT_DATE: "2026-11-05",
      FAKE_GH_ISSUES: JSON.stringify([{ title: "Live job failing on 2026-11-04" }]),
    });
    expect(result.calls.filter((args) => args[1] === "create")).toHaveLength(1);
  });

  it("on a dry run prints the issue and opens nothing", () => {
    const result = alert({ DRY_RUN: "1" });
    expect(result.status).toBe(0);
    expect(result.stderr).toContain("Dry run: would open issue: Live job failing on 2026-11-04");
    expect(result.calls.some((args) => args[1] === "create")).toBe(false);
  });

  it("never fails, even when gh does", () => {
    const result = alert({ FAKE_GH_FAIL: "1" });
    expect(result.status).toBe(0);
    expect(result.stderr).toContain("could not list issues; not opening one this run.");
    expect(result.calls.some((args) => args[1] === "create")).toBe(false);
    expect(fs.existsSync(liveScript("failure-alert.sh"))).toBe(true);
  });
});
