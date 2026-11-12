// Downloads ESPN game summaries for finished regular-season games and stores each one
// gzipped, trimmed to the keys the 548 score reads (box score, plays, header, game info).
// Restartable: a game already on disk is skipped, so a stopped run picks up where it
// left off. The files live under data/historical/raw/, which Git ignores.
//
// ESPN's feeds are unofficial and unlicensed for our purposes; fetch gently.
//
// Run: corepack pnpm exec tsx scripts/score/fetch-summaries.ts 2026 2025 2024 ...

import * as fs from "node:fs";
import { loadSeasonGames } from "../live/game-store";
import { summaryPath, writeGzipJson } from "./store";

const CONCURRENCY = 4;
const ATTEMPTS = 5;
const KEPT_KEYS = ["boxscore", "plays", "header", "gameInfo"] as const;
/** Stop when this many requests in a row fail after all their retries. */
const MAX_FAILURES_IN_A_ROW = 12;

const SUMMARY_URL = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/summary?event=";

const pause = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function fetchSummary(gameId: string): Promise<Record<string, unknown>> {
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(`${SUMMARY_URL}${gameId}`, {
        headers: { accept: "application/json", "user-agent": "Mozilla/5.0 (data backfill)" },
      });
      if (response.ok) {
        const payload = (await response.json()) as Record<string, unknown>;
        const kept: Record<string, unknown> = {};
        for (const key of KEPT_KEYS) if (payload[key] !== undefined) kept[key] = payload[key];
        return kept;
      }
      lastError = new Error(`HTTP ${response.status}`);
      // Refused or throttled: wait much longer before trying again.
      if (response.status === 429 || response.status === 403) await pause(30_000 * attempt);
    } catch (error) {
      lastError = error;
    }
    await pause(1500 * attempt);
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

async function collectSeason(season: number): Promise<{ fetched: number; failed: string[] }> {
  const games = loadSeasonGames(season).filter((game) => game.status === "final" && game.kind === "regular");
  const queue = games.filter((game) => !fs.existsSync(summaryPath(season, game.id)));
  console.log(`[summaries] ${season}: ${games.length} final regular-season games, ${queue.length} to fetch`);
  const failed: string[] = [];
  let cursor = 0;
  let fetched = 0;
  let failuresInARow = 0;
  let stopped = false;

  async function worker(): Promise<void> {
    while (!stopped) {
      const game = queue[cursor];
      cursor += 1;
      if (!game) return;
      try {
        const summary = await fetchSummary(game.id);
        writeGzipJson(summaryPath(season, game.id), summary);
        fetched += 1;
        failuresInARow = 0;
        if (fetched % 200 === 0) console.log(`[summaries] ${season}: ${fetched} of ${queue.length}`);
      } catch (error) {
        failed.push(`${game.id} (${game.etDate}): ${String(error)}`);
        failuresInARow += 1;
        if (failuresInARow >= MAX_FAILURES_IN_A_ROW) stopped = true;
      }
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));
  if (stopped) {
    for (const line of failed.slice(-MAX_FAILURES_IN_A_ROW)) console.log(`[summaries]   failed ${line}`);
    throw new Error(`${season}: ${MAX_FAILURES_IN_A_ROW} requests failed in a row; stopped. Run again to resume.`);
  }
  return { fetched, failed };
}

async function main(): Promise<void> {
  const seasons = process.argv.slice(2).map(Number);
  if (seasons.length === 0 || seasons.some((season) => !Number.isInteger(season))) {
    throw new Error("Usage: tsx scripts/score/fetch-summaries.ts <season> [<season> ...]");
  }
  for (const season of seasons) {
    const started = Date.now();
    const { fetched, failed } = await collectSeason(season);
    const seconds = Math.round((Date.now() - started) / 1000);
    console.log(`[summaries] ${season}: fetched ${fetched}, failed ${failed.length}, ${seconds}s`);
    for (const line of failed) console.log(`[summaries]   failed ${line}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
