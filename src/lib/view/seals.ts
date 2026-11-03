// Seal rows for a game from two published copies that can come from different commits
// for a moment: the ledger's (day or month file) and the state's window. Every seal
// appears once, keyed as the ledger keys seals (game, model version, seal kind), the
// ledger's rows first in ledger order. When the two copies agree this is exactly the
// ledger's rows; when one is behind, the other's newer seals still show.

import { sealKindOf } from "@/lib/season/live-state";
import type { SealRow } from "@/lib/season/types";

const sealKey = (row: SealRow) => `${row.modelVersion}|${sealKindOf(row)}`;

export function mergeSealRows(ledgerRows: readonly SealRow[], stateRows: readonly SealRow[]): SealRow[] {
  const seen = new Set(ledgerRows.map(sealKey));
  return [...ledgerRows, ...stateRows.filter((row) => !seen.has(sealKey(row)))];
}

/** The state's seals with each game the ledger covers merged with the ledger's rows. */
export function mergeSeals(
  stateSeals: Readonly<Record<string, SealRow[]>>,
  ledgerSeals: Readonly<Record<string, SealRow[]>>,
): Record<string, SealRow[]> {
  const merged: Record<string, SealRow[]> = { ...stateSeals };
  for (const [gameId, rows] of Object.entries(ledgerSeals)) {
    merged[gameId] = mergeSealRows(rows, stateSeals[gameId] ?? []);
  }
  return merged;
}
