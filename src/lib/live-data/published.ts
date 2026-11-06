// The one way the site reads what the live job publishes (data/live/**). The job commits
// its data to the `live-data` branch, which Vercel never deploys (vercel.json), and pages
// render with incremental static regeneration and read that branch's files over HTTPS at
// render time. Scripts keep reading the filesystem.
//
// Freshness. raw.githubusercontent.com caches a branch URL for five minutes and ignores
// query strings, so a cache buster does not work (measured 2026-11-03). Each render
// therefore resolves the data branch's head commit from git's public smart-HTTP ref
// advertisement (`/info/refs?service=git-upload-pack`, the request behind `git ls-remote`;
// not the rate-limited REST API), kept 15 seconds per server instance, and reads every
// file at that commit. A commit URL is new to the CDN and never changes, so a render sees
// a commit once its snapshot (below) is assembled, and every file it reads comes from that
// one commit.
//
// Caching. Files are kept in Next's data cache under the content hash the job's manifest
// lists (data/live/site/manifest.json), so an unchanged file is stored once rather than
// once per commit. Items above 2 MB cannot be cached; the ledger passes that during the
// season, so the site reads the job's compact day and month files instead of the ledger
// (src/lib/season/site-files.ts).
//
// Snapshots, the unit of fallback. React renders a page's readers independently, so a
// file failing after another was already shown cannot be undone. Before a render sees any
// value, therefore, every manifest artifact this deployment reads (state, games, day and
// month files, model views) is downloaded at the pinned commit, checked against its
// manifest hash and validated. A server instance downloads all of them once (about 2 MB
// and 40 files on 2026-11-06, growing with the season) and afterwards only the ones whose
// hash changed; each read is retried once. Artifacts this deployment does not read are
// skipped, so a newer job can add files without breaking an older deployment.
//
// Failure. If the head, the manifest or any artifact cannot be read or validated, the
// render uses the last complete snapshot this server instance assembled (an older commit,
// coherent, shown with its own timestamp), or, when it has none, the copy bundled at build
// time from main for every file: ledger-derived files are rebuilt from the bundled ledger,
// and main's copy has no model views, so those are absent. A render never combines files
// from two commits. A failed commit is tried again after 15 seconds. Main's data/live
// stopped at the cutover to live-data, so the bundled copy only gets older: pages say when
// they show it (`getLiveStateSource`), and /api/live/health reports the head, the commit
// served and why they differ. Nothing here throws to a page. NBA reports are read from the
// bundled copy only (`getReportDay`).
//
// Environment overrides: LIVE_DATA_BASE_URL (raw base, default the repository on
// raw.githubusercontent.com), LIVE_DATA_REFS_URL (the ref advertisement), LIVE_DATA_BRANCH
// (default live-data), and LIVE_DATA_SOURCE=bundled to read only the bundled copies, e.g.
// for local pipeline work.

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import http from "node:http";
import https from "node:https";
import path from "node:path";
import { unstable_cache } from "next/cache";
import { cache } from "react";
import bundledStateJson from "../../../data/live/state.json";
import type { LiveReportDay } from "@/lib/season/live-reports";
import type { PlayerIndexFile, TeamPlayersFile } from "@/lib/season/player-stats";
import type { ProjectionsFile, TeamInjuriesFile } from "@/lib/season/projections";
import {
  deriveSiteFiles,
  manifestMonthPaths,
  SITE_MANIFEST_PATH,
  siteDayPath,
  sitePlayerIndexPath,
  siteProjectionsPath,
  siteTeamInjuriesPath,
  siteTeamPlayersPath,
  type DaySealsFile,
  type MonthRowsFile,
  type SiteManifest,
} from "@/lib/season/site-files";
import { upgradeLiveState } from "@/lib/season/state-schema";
import type { LedgerRow, LiveState, SealRow, SeasonGame } from "@/lib/season/types";

const REPOSITORY = "bilguutei2k/playoff-pulse";
/** The branch the live job commits data to. */
export const DATA_BRANCH = process.env.LIVE_DATA_BRANCH ?? "live-data";
/** Read instead while the data branch does not exist yet (before the cutover). */
const FALLBACK_BRANCH = "main";
const RAW_BASE = (process.env.LIVE_DATA_BASE_URL ?? `https://raw.githubusercontent.com/${REPOSITORY}`).replace(/\/+$/, "");
const REFS_URL = process.env.LIVE_DATA_REFS_URL ?? `https://github.com/${REPOSITORY}.git/info/refs?service=git-upload-pack`;
const BUNDLED_ONLY = process.env.LIVE_DATA_SOURCE === "bundled";

/** How long one server instance reuses the data branch's head commit before asking again. */
const HEAD_TTL_MS = 15_000;
const REFS_TIMEOUT_MS = 3_000;
const FILE_TIMEOUT_MS = 6_000;
/** Next's data cache refuses larger items; such a file is still read, just not cached. */
export const DATA_CACHE_ITEM_LIMIT_BYTES = 2 * 1024 * 1024;
const MAX_DOWNLOAD_BYTES = 32 * 1024 * 1024;
/** Parsed files kept per server instance, by content hash or commit. */
const MEMO_LIMIT = 48;
/** Parallel downloads while a snapshot is assembled, and tries per artifact. */
const SNAPSHOT_CONCURRENCY = 6;
const SNAPSHOT_ATTEMPTS = 2;
/** How long a commit whose snapshot failed is not tried again on this instance. */
const SNAPSHOT_RETRY_MS = 15_000;

const LIVE_DIRECTORY = path.join(process.cwd(), "data", "live");

export type DataVia = "network" | "bundled";

type NetworkSource = {
  kind: "network";
  /** The commit every file of this render is read at, or the branch if it is unknown. */
  ref: string;
  /** The branch the commit is the head of. */
  branch: string;
  commit: string | null;
  manifest: SiteManifest | null;
  /** Validated text of every artifact this deployment reads, by path under data/live. */
  snapshot?: ReadonlyMap<string, string>;
} & Selection;
/**
 * Set on a render's source: the data branch's head when this render resolved it (null if
 * unknown) and, when the render does not show that head, why.
 */
type Selection = { head?: string | null; problem?: string | null };
type Source = NetworkSource | ({ kind: "bundled" } & Selection);

class HttpStatusError extends Error {
  constructor(
    readonly status: number,
    url: string,
  ) {
    super(`HTTP ${status} for ${url}`);
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function sha256(content: Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}

/**
 * A GET that Next does not track. The patched `fetch` would turn an uncached request into
 * a dynamic render; this keeps pages static between regenerations.
 */
function httpGet(url: string, timeoutMs: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const client = url.startsWith("http:") ? http : https;
    const request = client.get(url, { headers: { "user-agent": "548-site" } }, (response) => {
      if (response.statusCode !== 200) {
        response.resume();
        reject(new HttpStatusError(response.statusCode ?? 0, url));
        return;
      }
      const chunks: Buffer[] = [];
      let size = 0;
      response.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > MAX_DOWNLOAD_BYTES) request.destroy(new Error(`${url} is larger than ${MAX_DOWNLOAD_BYTES} bytes`));
        else chunks.push(chunk);
      });
      response.on("end", () => resolve(Buffer.concat(chunks)));
      response.on("error", reject);
    });
    const timer = setTimeout(() => request.destroy(new Error(`${url} timed out after ${timeoutMs} ms`)), timeoutMs);
    request.on("close", () => clearTimeout(timer));
    request.on("error", reject);
  });
}

const memo = new Map<string, Promise<unknown>>();

/** One load per key per server instance; failures are forgotten so the next render retries. */
function remember<T>(key: string, load: () => Promise<T>): Promise<T> {
  const hit = memo.get(key);
  if (hit) {
    memo.delete(key);
    memo.set(key, hit);
    return hit as Promise<T>;
  }
  const promise = load();
  memo.set(key, promise);
  promise.catch(() => memo.delete(key));
  while (memo.size > MEMO_LIMIT) memo.delete(memo.keys().next().value as string);
  return promise;
}

// ---------------------------------------------------------------------------------------
// Validation. A file that does not look like what the job writes is a failed fetch.

type UnknownRecord = Record<string, unknown>;
const isRecord = (value: unknown): value is UnknownRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const isString = (value: unknown): value is string => typeof value === "string";
const isProbability = (value: unknown) => typeof value === "number" && value >= 0 && value <= 1;

function isSealRow(row: UnknownRecord): boolean {
  return (
    row.type === "seal" &&
    isString(row.gameId) &&
    isString(row.etDate) &&
    isString(row.tipUtc) &&
    isString(row.modelVersion) &&
    isString(row.homeId) &&
    isString(row.awayId) &&
    isProbability(row.homeWinProbability)
  );
}

function isLedgerRow(row: unknown): row is LedgerRow {
  if (!isRecord(row) || !isString(row.gameId)) return false;
  if (row.type === "seal") return isSealRow(row);
  if (row.type === "result") return typeof row.homeScore === "number" && typeof row.awayScore === "number";
  if (row.type === "missed") return isString(row.etDate);
  return false;
}

function isGame(game: unknown): game is SeasonGame {
  return (
    isRecord(game) &&
    isString(game.id) &&
    typeof game.season === "number" &&
    isString(game.etDate) &&
    isString(game.tipUtc) &&
    isString(game.homeId) &&
    isString(game.awayId) &&
    isString(game.status)
  );
}

function parseState(text: string): LiveState {
  const raw: unknown = JSON.parse(text);
  if (
    !isRecord(raw) ||
    typeof raw.season !== "number" ||
    !isString(raw.seasonLabel) ||
    !isString(raw.generatedAt) ||
    !isRecord(raw.forecast) ||
    !Array.isArray(raw.forecast.teams) ||
    !isRecord(raw.seals)
  ) {
    throw new Error("state.json is not a published state");
  }
  return upgradeLiveState(raw);
}

function sortGames(games: SeasonGame[], season: number): SeasonGame[] {
  return games
    .filter((game) => game.season === season)
    .sort((a, b) => Date.parse(a.tipUtc) - Date.parse(b.tipUtc) || a.id.localeCompare(b.id));
}

function parseGames(text: string, season: number): SeasonGame[] {
  const raw: unknown = JSON.parse(text);
  if (!Array.isArray(raw) || !raw.every(isGame)) throw new Error("games file is not a list of games");
  return sortGames(raw, season);
}

function parseLedger(text: string): LedgerRow[] {
  const rows: unknown[] = text
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line));
  if (!rows.every(isLedgerRow)) throw new Error("ledger has a row that is not a ledger row");
  return rows;
}

function parseDay(text: string, etDate: string): SealRow[] {
  const raw: unknown = JSON.parse(text);
  if (!isRecord(raw) || raw.etDate !== etDate || !Array.isArray(raw.seals)) throw new Error(`day file for ${etDate} is malformed`);
  const seals: unknown[] = raw.seals;
  if (!seals.every((row) => isRecord(row) && isSealRow(row) && row.etDate === etDate)) {
    throw new Error(`day file for ${etDate} has a row that is not one of its seals`);
  }
  return (raw as DaySealsFile).seals;
}

function parseMonth(text: string): LedgerRow[] {
  const raw: unknown = JSON.parse(text);
  if (!isRecord(raw) || !isString(raw.month) || !Array.isArray(raw.rows)) throw new Error("month file is malformed");
  const rows: unknown[] = raw.rows;
  if (!rows.every(isLedgerRow)) throw new Error(`month file ${raw.month} has a row that is not a ledger row`);
  return (raw as MonthRowsFile).rows;
}

function parseManifest(text: string): SiteManifest {
  const raw: unknown = JSON.parse(text);
  if (
    !isRecord(raw) ||
    raw.version !== 1 ||
    typeof raw.season !== "number" ||
    !isString(raw.seasonLabel) ||
    !isRecord(raw.files) ||
    !Object.values(raw.files).every((hash) => isString(hash) && /^[0-9a-f]{64}$/.test(hash))
  ) {
    throw new Error("site manifest is malformed");
  }
  return raw as SiteManifest;
}

/** A model view's common header: version 1 and the season it belongs to. */
function parseView<T>(text: string, what: string, seasonLabel: string, check: (raw: UnknownRecord) => boolean): T {
  const raw: unknown = JSON.parse(text);
  if (!isRecord(raw) || raw.version !== 1 || raw.seasonLabel !== seasonLabel || !check(raw)) {
    throw new Error(`${what} is malformed`);
  }
  return raw as T;
}

const parseProjections = (text: string, label: string) =>
  parseView<ProjectionsFile>(text, "projections", label, (raw) =>
    isString(raw.fromEtDate) &&
    Array.isArray(raw.games) &&
    raw.games.every(
      (game) =>
        isRecord(game) &&
        isString(game.gameId) &&
        isProbability(game.homeWinProbability) &&
        isProbability(game.awayWinProbability) &&
        isRecord(game.basis) &&
        isRecord(game.absencePoints) &&
        isRecord(game.drivers),
    ),
  );

const parseTeamInjuries = (text: string, label: string) =>
  parseView<TeamInjuriesFile>(text, "team injury lists", label, (raw) =>
    Array.isArray(raw.teams) &&
    raw.teams.every((team) => isRecord(team) && isString(team.teamId) && Array.isArray(team.rows) && typeof team.absencePoints === "number"),
  );

const parsePlayerIndex = (text: string, label: string) =>
  parseView<PlayerIndexFile>(text, "player index", label, (raw) =>
    Array.isArray(raw.players) &&
    raw.players.every((player) => isRecord(player) && isString(player.athleteId) && isString(player.name) && isString(player.teamId)),
  );

const parseTeamPlayers = (text: string, label: string, teamId: string) =>
  parseView<TeamPlayersFile>(text, `player file for team ${teamId}`, label, (raw) =>
    raw.teamId === teamId &&
    Array.isArray(raw.games) &&
    Array.isArray(raw.players) &&
    raw.players.every((player) => isRecord(player) && isString(player.athleteId) && Array.isArray(player.log) && Array.isArray(player.injuries)),
  );

// ---------------------------------------------------------------------------------------
// The bundled copies: what was in the repository when this deployment was built.

const bundledState: LiveState = upgradeLiveState(bundledStateJson);

const bundledCache = new Map<string, unknown>();

function bundled<T>(key: string, load: () => T, empty: T): T {
  if (bundledCache.has(key)) return bundledCache.get(key) as T;
  let value = empty;
  try {
    value = load();
  } catch (error) {
    console.error(`[live-data] bundled ${key} unreadable`, describe(error));
  }
  bundledCache.set(key, value);
  return value;
}

function bundledFile(relative: string): string | null {
  const file = path.join(LIVE_DIRECTORY, relative);
  return existsSync(file) ? readFileSync(file, "utf8") : null;
}

function bundledGames(season: number): SeasonGame[] {
  return bundled(`games/${season}`, () => {
    const text = bundledFile(`games/${season}.json`);
    return text ? parseGames(text, season) : [];
  }, []);
}

function bundledLedger(seasonLabel: string): LedgerRow[] {
  return bundled(`ledger/${seasonLabel}`, () => {
    const text = bundledFile(`ledger/${seasonLabel}.jsonl`);
    return text ? parseLedger(text) : [];
  }, []);
}

function bundledSiteFiles(seasonLabel: string) {
  return bundled(`site/${seasonLabel}`, () => deriveSiteFiles(bundledLedger(seasonLabel)), {
    days: new Map<string, DaySealsFile>(),
    months: new Map<string, MonthRowsFile>(),
  });
}

// ---------------------------------------------------------------------------------------
// The network source for one render.

type Head = { branch: string; commit: string | null };
let head: { at: number; value: Promise<Head> } | null = null;

/** A branch's head in a smart-HTTP ref advertisement (pkt-lines "<sha> refs/heads/<name>"). */
export function advertisedHead(advertisement: string, branch: string): string | null {
  const escaped = branch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`([0-9a-f]{40}) refs/heads/${escaped}(?=[\\n\\0])`).exec(advertisement);
  return match ? match[1] : null;
}

/** The data branch's head, or main's before the data branch exists. One request gives both. */
async function fetchHead(): Promise<Head> {
  const text = (await httpGet(REFS_URL, REFS_TIMEOUT_MS)).toString("utf8");
  for (const branch of [DATA_BRANCH, FALLBACK_BRANCH]) {
    const commit = advertisedHead(text, branch);
    if (commit) return { branch, commit };
  }
  throw new Error(`neither refs/heads/${DATA_BRANCH} nor refs/heads/${FALLBACK_BRANCH} is advertised`);
}

function currentHead(): Promise<Head> {
  const now = Date.now();
  if (!head || now - head.at > HEAD_TTL_MS) {
    head = {
      at: now,
      value: fetchHead().catch((error) => {
        console.error(`[live-data] head of ${DATA_BRANCH} unknown:`, describe(error));
        return { branch: DATA_BRANCH, commit: null };
      }),
    };
  }
  return head.value;
}

/**
 * Reads one published file at the render's commit. With a manifest hash, the parsed file
 * is cached under that hash and the download must match it; at a known commit without
 * one, under the commit; at the branch URL (commit unknown), only briefly in memory.
 */
function fetchPublished<T>(source: NetworkSource, relative: string, parse: (text: string) => T): Promise<T> {
  if (source.snapshot) {
    const text = source.snapshot.get(relative);
    if (text === undefined) return Promise.reject(new Error(`Unlisted snapshot file: ${relative}`));
    return Promise.resolve(parse(text));
  }
  const hash = source.commit ? (source.manifest?.files[relative] ?? null) : null;
  const url = `${RAW_BASE}/${source.ref}/data/live/${relative}`;
  const download = async (): Promise<T> => {
    const body = await httpGet(url, FILE_TIMEOUT_MS);
    if (hash && sha256(body) !== hash) throw new Error(`${relative} at ${source.ref} does not match the manifest`);
    if (body.length > DATA_CACHE_ITEM_LIMIT_BYTES) {
      console.warn(`[live-data] ${relative} is ${body.length} bytes, over the data cache's item limit; it is read on every render`);
    }
    return parse(body.toString("utf8"));
  };
  if (hash) return remember(`snapshot-v2:sha256:${hash}`, () => unstable_cache(download, ["live-data-snapshot-v2", relative, hash], { revalidate: false })());
  if (source.commit) {
    const commit = source.commit;
    return remember(`snapshot-v2:${commit}:${relative}`, () => unstable_cache(download, ["live-data-snapshot-v2", relative, commit], { revalidate: false })());
  }
  return remember(`${source.ref}:${relative}:${Math.floor(Date.now() / HEAD_TTL_MS)}`, download);
}

async function loadManifest(ref: string, branch: string, commit: string | null): Promise<SiteManifest | null> {
  const source: NetworkSource = { kind: "network", ref, branch, commit, manifest: null };
  try {
    return await fetchPublished(source, SITE_MANIFEST_PATH, parseManifest);
  } catch (error) {
    // Without a readable manifest no snapshot can be assembled at this commit.
    if (!(error instanceof HttpStatusError && error.status === 404)) {
      console.error("[live-data] site manifest unavailable:", describe(error));
    }
    return null;
  }
}

type Snapshot = NetworkSource & { commit: string; manifest: SiteManifest; snapshot: ReadonlyMap<string, string> };

/** The check for an artifact this deployment reads, or null for one it never reads. */
function artifactCheck(relative: string, manifest: SiteManifest): ((text: string) => unknown) | null {
  const label = manifest.seasonLabel;
  const name = path.basename(relative, ".json");
  if (relative === "state.json") {
    return (text) => {
      const state = parseState(text);
      if (state.season !== manifest.season || state.seasonLabel !== label) throw new Error("state.json is not the manifest's season");
    };
  }
  if (relative === `games/${manifest.season}.json`) return (text) => parseGames(text, manifest.season);
  if (relative.startsWith(`site/${label}/days/`)) return (text) => parseDay(text, name);
  if (relative.startsWith(`site/${label}/months/`)) return parseMonth;
  if (relative === siteProjectionsPath(label)) return (text) => parseProjections(text, label);
  if (relative === siteTeamInjuriesPath(label)) return (text) => parseTeamInjuries(text, label);
  if (relative === sitePlayerIndexPath(label)) return (text) => parsePlayerIndex(text, label);
  if (relative.startsWith(`site/${label}/players/teams/`)) return (text) => parseTeamPlayers(text, label, name);
  return null;
}

async function withRetry<T>(load: () => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await load();
    } catch (error) {
      if (attempt >= SNAPSHOT_ATTEMPTS) throw error;
    }
  }
}

/**
 * Every artifact this deployment reads at one commit, validated, or a rejection. Files
 * whose hash matches `previous` are taken from it rather than downloaded again.
 */
async function assembleSnapshot(branch: string, commit: string, previous: Snapshot | null): Promise<Snapshot> {
  const manifest = await loadManifest(commit, branch, commit);
  if (!manifest) throw new Error(`no readable site manifest at ${commit}`);
  for (const required of ["state.json", `games/${manifest.season}.json`]) {
    if (!(required in manifest.files)) throw new Error(`the manifest at ${commit} does not list ${required}`);
  }
  const source: NetworkSource = { kind: "network", ref: commit, branch, commit, manifest };
  const reuse = previous?.manifest.season === manifest.season && previous.manifest.seasonLabel === manifest.seasonLabel ? previous : null;
  const work = Object.keys(manifest.files).flatMap((relative) => {
    const check = artifactCheck(relative, manifest);
    return check ? [{ relative, check }] : [];
  });
  const files = new Map<string, string>();
  let next = 0;
  let failed = false;
  const worker = async () => {
    while (!failed && next < work.length) {
      const { relative, check } = work[next++];
      const kept = reuse && reuse.manifest.files[relative] === manifest.files[relative] ? reuse.snapshot.get(relative) : undefined;
      if (kept !== undefined) {
        files.set(relative, kept);
        continue;
      }
      try {
        files.set(relative, await withRetry(() => fetchPublished(source, relative, (text) => (check(text), text))));
      } catch (error) {
        failed = true;
        throw new Error(`${relative} at ${commit}: ${describe(error)}`);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(SNAPSHOT_CONCURRENCY, work.length) }, worker));
  return { ...source, commit, manifest, snapshot: files };
}

// One server instance keeps the last complete snapshot (the fallback, and the base the next
// one reuses files from), the one being assembled, and the last failure.
let lastGood: (Snapshot & { order: number }) | null = null;
let assembling: { commit: string; promise: Promise<Snapshot> } | null = null;
let lastFailure: { commit: string; at: number; problem: string } | null = null;
let assembled = 0;

function snapshotAt(branch: string, commit: string): Promise<Snapshot> {
  if (lastGood?.commit === commit) return Promise.resolve(lastGood);
  if (lastFailure?.commit === commit && Date.now() - lastFailure.at < SNAPSHOT_RETRY_MS) {
    return Promise.reject(new Error(lastFailure.problem));
  }
  if (assembling?.commit !== commit) {
    const order = ++assembled;
    const promise = assembleSnapshot(branch, commit, lastGood);
    assembling = { commit, promise };
    promise
      .then(
        (snapshot) => {
          // A slower, older commit finishing late must not replace a newer one.
          if (!lastGood || lastGood.order < order) lastGood = { ...snapshot, order };
          if (lastFailure?.commit === commit) lastFailure = null;
        },
        (error) => {
          lastFailure = { commit, at: Date.now(), problem: describe(error) };
        },
      )
      .finally(() => {
        if (assembling?.promise === promise) assembling = null;
      });
  }
  return assembling.promise;
}

/** Where this render reads from: one complete snapshot, resolved once per render. */
const renderSource = cache(async (): Promise<Source> => {
  if (BUNDLED_ONLY) return { kind: "bundled", head: null, problem: null };
  let headCommit: string | null = null;
  try {
    const { branch, commit } = await currentHead();
    headCommit = commit;
    if (!commit) throw new Error(`the head commit of ${DATA_BRANCH} is unknown`);
    return { ...(await snapshotAt(branch, commit)), head: commit, problem: null };
  } catch (error) {
    const problem = describe(error);
    const fallback = lastGood ? `the last complete snapshot, ${lastGood.commit}` : "the bundled copy";
    console.error(`[live-data] no complete snapshot at the head; using ${fallback}:`, problem);
    return lastGood ? { ...lastGood, head: headCommit, problem } : { kind: "bundled", head: headCommit, problem };
  }
});

type Loaded<T> = { value: T; via: DataVia };

/**
 * A network read from a snapshot cannot fail for a file the manifest lists: it was read and
 * validated before the render started. The fallback is for the bundled source only.
 */
async function withFallback<T>(what: string, network: (() => Promise<T>) | null, fallback: () => T): Promise<Loaded<T>> {
  if (network) {
    try {
      return { value: await network(), via: "network" };
    } catch (error) {
      console.error(`[live-data] ${what} unavailable, using the bundled copy:`, describe(error));
    }
  }
  return { value: fallback(), via: "bundled" };
}

const network = (source: Source) => (source.kind === "network" ? source : null);

const loadState = cache(async (): Promise<Loaded<LiveState>> => {
  const source = network(await renderSource());
  return withFallback("state.json", source && (() => fetchPublished(source, "state.json", parseState)), () => bundledState);
});

const loadGames = cache(async (): Promise<Loaded<SeasonGame[]>> => {
  const source = network(await renderSource());
  const { value: state } = await loadState();
  const relative = `games/${state.season}.json`;
  return withFallback(
    relative,
    source && (() => fetchPublished(source, relative, (text) => parseGames(text, state.season))),
    () => bundledGames(state.season),
  );
});

/** The whole ledger, only while main has no site manifest yet: at the render's commit, else bundled. */
const loadLedger = cache(async (): Promise<LedgerRow[]> => {
  const source = network(await renderSource());
  const { value: state } = await loadState();
  const relative = `ledger/${state.seasonLabel}.jsonl`;
  return (await withFallback(relative, source && (() => fetchPublished(source, relative, parseLedger)), () => bundledLedger(state.seasonLabel))).value;
});

// ---------------------------------------------------------------------------------------
// What pages use. Every function is memoized per render and never throws.

/** The published state (schema 2) for this render. */
export const getLiveState = cache(async (): Promise<LiveState> => (await loadState()).value);

/**
 * Whether this render's state came from the data branch or the copy bundled with the
 * deployment. The bundled copy can be days old, so pages label it.
 */
export const getLiveStateSource = cache(async (): Promise<DataVia> => (await loadState()).via);

/** Every game of the live season, in tip order. Empty if no copy can be read. */
export const getSeasonGames = cache(async (): Promise<SeasonGame[]> => (await loadGames()).value);

/** Every seal row for games on one ET date, all versions and kinds, in ledger order. */
export const getDaySeals = cache(async (etDate: string): Promise<SealRow[]> => {
  const source = network(await renderSource());
  const { value: state } = await loadState();
  const label = state.seasonLabel;
  if (source?.manifest) {
    const relative = siteDayPath(label, etDate);
    // The manifest lists every day with a seal; a date it does not list has none yet.
    if (!(relative in source.manifest.files)) return [];
    return (
      await withFallback(
        relative,
        () => fetchPublished(source, relative, (text) => parseDay(text, etDate)),
        () => bundledSiteFiles(label).days.get(etDate)?.seals ?? [],
      )
    ).value;
  }
  return deriveSiteFiles(await loadLedger()).days.get(etDate)?.seals ?? [];
});

/**
 * The season's ledger rows for the record and team pages: every row, grouped by its
 * game's month, with seals' `drivers` lists omitted. Use `getDaySeals` for drivers.
 */
export const getSeasonLedger = cache(async (): Promise<LedgerRow[]> => {
  const source = network(await renderSource());
  const { value: state } = await loadState();
  const label = state.seasonLabel;
  const manifest = source?.manifest;
  if (source && manifest && manifest.seasonLabel === label) {
    const months = await Promise.all(
      manifestMonthPaths(manifest).map(async (relative) => {
        const month = relative.slice(relative.lastIndexOf("/") + 1, -".json".length);
        return (
          await withFallback(
            relative,
            () => fetchPublished(source, relative, parseMonth),
            () => bundledSiteFiles(label).months.get(month)?.rows ?? [],
          )
        ).value;
      }),
    );
    return months.flat();
  }
  return [...deriveSiteFiles(await loadLedger()).months.values()].flatMap((file) => file.rows);
});

export async function getGameById(gameId: string): Promise<SeasonGame | null> {
  return (await getSeasonGames()).find((game) => game.id === gameId) ?? null;
}

/** Games per ET date, for the date strip; canceled games do not count. */
export const getGameCountsByDate = cache(async (): Promise<Record<string, number>> => {
  const counts: Record<string, number> = {};
  for (const game of await getSeasonGames()) {
    if (game.status === "canceled") continue;
    counts[game.etDate] = (counts[game.etDate] ?? 0) + 1;
  }
  return counts;
});

/**
 * The NBA reports the job stored for one ET date, or null. Pages need them only for
 * seals written before `driversComplete` (early November 2026), which kept three drivers
 * a side; those days are finished, so the copy bundled with the deployment is complete
 * and is the only one read (see `next.config.ts`).
 */
export async function getReportDay(etDate: string): Promise<LiveReportDay | null> {
  const { value: state } = await loadState();
  return bundled(`reports/${etDate}`, () => {
    const text = bundledFile(`reports/${state.seasonLabel}/${etDate}.json`);
    return text ? (JSON.parse(text) as LiveReportDay) : null;
  }, null);
}

/**
 * One model view (projections, team injury lists, player files) from the render's
 * snapshot: null when the manifest does not list it (the job did not publish it). From the
 * bundled source, the bundled copy, which main's frozen data/live does not have, so null.
 * Never throws.
 */
async function loadView<T>(relative: string, parse: (text: string) => T): Promise<T | null> {
  const source = network(await renderSource());
  const fallback = () =>
    bundled(relative, () => {
      const text = bundledFile(relative);
      return text ? parse(text) : null;
    }, null);
  if (source?.manifest && !(relative in source.manifest.files)) return null;
  if (!source) return fallback();
  return (await withFallback<T | null>(relative, () => fetchPublished(source, relative, parse), fallback)).value;
}

/**
 * Projections with the injury term for every scheduled game from the published slate's
 * date through six days later (`ProjectionsFile`, src/lib/season/projections.ts). Each
 * carries its basis: the seal rules on a stored report (`report`, with `reportAt`) or the
 * season simulation's charge from current absences (`current-absences`). Never a seal,
 * never scored: label every one as a projection. Null when not published.
 */
export const getProjections = cache(async (): Promise<ProjectionsFile | null> => {
  const { value: state } = await loadState();
  return loadView(siteProjectionsPath(state.seasonLabel), (text) => parseProjections(text, state.seasonLabel));
});

/**
 * Every team's injury list for its next scheduled game (`TeamInjuriesFile`): rows from
 * the report covering it with status, reason and report time, its filing state, and
 * players counted from box scores, each with the model's points. Null when not published.
 */
export const getTeamInjuryLists = cache(async (): Promise<TeamInjuriesFile | null> => {
  const { value: state } = await loadState();
  return loadView(siteTeamInjuriesPath(state.seasonLabel), (text) => parseTeamInjuries(text, state.seasonLabel));
});

/** Every player of the live season with averages, shooting and 548 impact (`PlayerIndexFile`). Null when not published. */
export const getPlayerIndex = cache(async (): Promise<PlayerIndexFile | null> => {
  const { value: state } = await loadState();
  return loadView(sitePlayerIndexPath(state.seasonLabel), (text) => parsePlayerIndex(text, state.seasonLabel));
});

/**
 * One team's players with their game logs (lines and did-not-play rows) and injury-report
 * listings (`TeamPlayersFile`). A traded player appears in each team's file for his games
 * there. Null when not published or for an unknown team.
 */
export const getTeamPlayers = cache(async (teamId: string): Promise<TeamPlayersFile | null> => {
  if (!/^\d+$/.test(teamId)) return null;
  const { value: state } = await loadState();
  return loadView(siteTeamPlayersPath(state.seasonLabel, teamId), (text) => parseTeamPlayers(text, state.seasonLabel, teamId));
});

/**
 * The state, games and data provenance for /api/live/health, from one source. Route
 * handlers are not React renders, so `cache` does not memoize there; selecting the source
 * once keeps a response from mixing two selections.
 */
export async function getLiveHealthSnapshot(): Promise<{
  liveState: LiveState;
  games: SeasonGame[];
  data: {
    source: DataVia;
    branch: string | null;
    /** The data commit this response read, or null for the bundled copy. */
    commit: string | null;
    /** The data branch's head when this response resolved it, or null if unknown. */
    head: string | null;
    manifest: boolean;
    state: DataVia;
    games: DataVia;
    /** Why this response does not show the head, or null when it does. */
    problem: string | null;
  };
}> {
  const source = await renderSource();
  const liveState = source.kind === "network" ? await fetchPublished(source, "state.json", parseState) : bundledState;
  const games =
    source.kind === "network"
      ? await fetchPublished(source, `games/${liveState.season}.json`, (text) => parseGames(text, liveState.season))
      : bundledGames(liveState.season);
  return {
    liveState,
    games,
    data: {
      source: source.kind,
      branch: source.kind === "network" ? source.branch : null,
      commit: source.kind === "network" ? source.commit : null,
      head: source.head ?? null,
      manifest: source.kind === "network" && source.manifest !== null,
      state: source.kind,
      games: source.kind,
      problem: source.problem ?? null,
    },
  };
}

/** Where this response's state and games came from. */
export async function getLiveDataStatus() {
  return (await getLiveHealthSnapshot()).data;
}
