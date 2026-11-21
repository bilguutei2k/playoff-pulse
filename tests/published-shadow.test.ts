// v4's shadow file through src/lib/live-data/published.ts: read at the render's commit
// against the manifest's hash, null when absent or bad, and never able to cost the
// published pages their snapshot. Same local stand-in for GitHub as published-snapshot.test.ts.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ unstable_cache: (fn: unknown) => fn }));
vi.mock("react", () => ({ cache: (fn: unknown) => fn }));

const BUNDLED = JSON.parse(readFileSync("data/live/state.json", "utf8"));
const LABEL: string = BUNDLED.seasonLabel;
const SHADOW = `site/${LABEL}/shadow-v4.json`;
const A = "a".repeat(40);
const NONE = { brier: null, logLoss: null };

/** The job's shape (scripts/live/v4/live-v4.ts, `shadowFile`), trimmed. */
const shadow = (overrides: Record<string, unknown> = {}) =>
  JSON.stringify({
    version: 1,
    modelVersion: "live-2026.27-v4",
    label: "In testing: roster-state model v4. Not the published forecast.",
    firstEtDate: "2026-11-21",
    slate: "2026-11-21",
    record: { modelVersion: "live-2026.27-v4", sealed: 5, scored: 0, pending: 5, missed: 0, incomplete: 0, brier: null, logLoss: null },
    sameGames: { games: 0, v4: NONE, v2: NONE, v1: NONE },
    teams: [{ teamId: "1", strength: -0.333, projectedWins: 41.34, makePlayoffs: 0.6003, champion: 0.0023 }],
    sums: { champion: 1, makePlayoffs: 16, topSix: 12, playIn: 8 },
    absences: [],
    impact: { "2490149": 0.6 },
    ...overrides,
  });

function publication(extra: Record<string, string>) {
  const manifest = JSON.parse(readFileSync("data/live/site/manifest.json", "utf8"));
  const files: Record<string, string> = {};
  for (const relative of Object.keys(manifest.files)) files[relative] = readFileSync(`data/live/${relative}`, "utf8");
  files["state.json"] = JSON.stringify({ ...BUNDLED, generatedAt: "2026-11-21T08:00:00Z" });
  Object.assign(files, extra);
  manifest.files = Object.fromEntries(Object.entries(files).map(([key, value]) => [key, createHash("sha256").update(value).digest("hex")]));
  return { files, manifest };
}

let server: Server | undefined;
afterEach(async () => {
  server?.closeAllConnections();
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
  server = undefined;
  vi.unstubAllEnvs();
  vi.resetModules();
});

async function serve(published: ReturnType<typeof publication>, served: Record<string, string> = {}) {
  vi.resetModules();
  server = createServer((req, res) => {
    const url = req.url ?? "";
    if (url === "/refs") return res.end(`${A} refs/heads/live-data\n`);
    const relative = url.replace(`/${A}/data/live/`, "");
    if (relative === "site/manifest.json") return res.end(JSON.stringify(published.manifest));
    const body = served[relative] ?? published.files[relative];
    if (body === undefined) {
      res.statusCode = 404;
      return res.end();
    }
    res.end(body);
  });
  await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing test port");
  vi.stubEnv("LIVE_DATA_BASE_URL", `http://127.0.0.1:${address.port}`);
  vi.stubEnv("LIVE_DATA_REFS_URL", `http://127.0.0.1:${address.port}/refs`);
  vi.stubEnv("LIVE_DATA_SOURCE", "network");
  return import("@/lib/live-data/published");
}

describe("getShadowV4", () => {
  it("reads the listed file at the render's commit and keeps the typed view", async () => {
    const p = await serve(publication({ [SHADOW]: shadow() }));
    expect(await p.getShadowV4()).toEqual({
      modelVersion: "live-2026.27-v4",
      firstEtDate: "2026-11-21",
      slate: "2026-11-21",
      record: { sealed: 5, scored: 0, pending: 5, missed: 0, brier: null, logLoss: null },
      sameGames: { games: 0, v4: NONE, v2: NONE, v1: NONE },
      impact: { "2490149": 0.6 },
    });
    expect(await p.getLiveStateSource()).toBe("network");
  });

  it("is null when the manifest does not list it", async () => {
    const p = await serve(publication({}));
    expect(await p.getShadowV4()).toBeNull();
    expect((await p.getDelivery()).delivery).toBe("current");
  });

  it.each([
    ["the wrong model", { modelVersion: "live-2026.27-v2" }],
    ["a negative count", { record: { sealed: 5, scored: -1, pending: 5, missed: 0, brier: null, logLoss: null } }],
    ["no same-games lines", { sameGames: { games: 0 } }],
    ["a bad date", { firstEtDate: "Nov 21" }],
  ])("is null for a malformed file (%s), and the published pages keep their snapshot", async (_name, overrides) => {
    const p = await serve(publication({ [SHADOW]: shadow(overrides) }));
    expect(await p.getShadowV4()).toBeNull();
    expect(await p.getLiveStateSource()).toBe("network");
    expect((await p.getDelivery()).delivery).toBe("current");
  });

  it("is null when the file does not match the manifest's hash, or cannot be read, without costing the snapshot", async () => {
    const published = publication({ [SHADOW]: shadow() });
    const p = await serve(published, { [SHADOW]: shadow({ slate: "2026-11-22" }) });
    expect(await p.getShadowV4()).toBeNull();
    expect((await p.getLiveState()).generatedAt).toBe("2026-11-21T08:00:00Z");
    expect((await p.getDelivery()).delivery).toBe("current");
  });

  it("is null from the bundled copy, which has no shadow file", async () => {
    vi.resetModules();
    vi.stubEnv("LIVE_DATA_SOURCE", "bundled");
    const p = await import("@/lib/live-data/published");
    expect(await p.getShadowV4()).toBeNull();
  });
});
