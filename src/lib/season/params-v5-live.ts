// The live constants of `live-2026.27-v5` as the second shadow model (docs/live/registration-v5.md,
// "Wiring as built"). The registered files (params-v5.ts, roster-state-v5.ts) stay byte for
// byte as registered, so the dates and the warm checkpoint's hash live here.

/** First ET date with v5 seals (shadow only). Moved by a commit before merging if the merge slips. */
export const V5_FIRST_ET_DATE: string | null = "2026-11-25";

/**
 * The stop switch: the last ET date with v5 seals, inclusive, or null while v5 keeps sealing.
 * Once v5 has sealed, its rows sit in an append-only ledger, so setting the first date back
 * to null or reverting the code would make the checks reject rows already written. Setting
 * this date is how v5 is stopped after its first seal: no v5 seal or missed row after it,
 * `verify-ledger` rejects a v5 seal after it, and the watchdog expects none after it.
 */
export const V5_LAST_ET_DATE: string | null = null;

/** sha256 of data/season/v5/warm-2026.bin.gz, v5's state after 2025-26 the live job starts from. */
export const V5_WARM_SHA256 = "7683554d7b96f6a5fc3ca829df2f3fd1c0ff397a276ba59778593a7bb1290065";

/** Whether a game on `etDate` is inside v5's sealing range. */
export function inV5Range(etDate: string, first: string | null = V5_FIRST_ET_DATE, last: string | null = V5_LAST_ET_DATE): boolean {
  return first !== null && etDate >= first && (last === null || etDate <= last);
}
