// Public copy must not say that every game or forecast is sealed: a game can tip unsealed,
// and the record counts it as missed. The approved wording and the rule are in
// docs/claims-ledger.md (live section, "How sealing is described in public").
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { SEALS_SENTENCE, TILE_GLYPHS } from "@/lib/view/how-to-read";

const LEDGER = "docs/claims-ledger.md";

/** The universal forms. "Sealed before tip and scored in public" alone is not one of them. */
const BANNED: Array<{ form: string; pattern: RegExp }> = [
  { form: "Every 548 forecast is sealed", pattern: /every 548 forecast is sealed/i },
  { form: "Each game is sealed in the morning", pattern: /each game is sealed in the morning/i },
  { form: "Every game's win probability, sealed", pattern: /every game's win probability,? sealed/i },
  { form: "every NBA game, sealed / every NBA game today, sealed", pattern: /every nba game(?: today)?,? sealed/i },
];

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const full = path.join(directory, name);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.(ts|tsx)$/.test(name) ? [full] : [];
  });
}

/** The file's text as a reader would get it: entities decoded, line breaks and indents as one space. */
function readable(file: string): string {
  return readFileSync(file, "utf8")
    .replace(/&apos;|&#39;|&rsquo;|’/g, "'")
    .replace(/\{" "\}/g, " ")
    .replace(/\s+/g, " ");
}

describe("sealing copy follows the claims ledger", () => {
  const files = sourceFiles("src");

  it("scans the site's source", () => {
    expect(files.length).toBeGreaterThan(100);
    expect(files).toContain(path.join("src", "app", "layout.tsx"));
  });

  it.each(BANNED)("never says \"$form\"", ({ pattern }) => {
    const hits = files.filter((file) => pattern.test(readable(file)));
    expect(hits, `Overstating sealing copy; use the approved wording in ${LEDGER} (live section)`).toEqual([]);
  });

  it("keeps the approved sentence word for word in the ledger", () => {
    expect(readable(LEDGER)).toContain(SEALS_SENTENCE);
  });

  it("still allows the tile's meaning and the conditional all-sealed line", () => {
    expect(TILE_GLYPHS.sealed.text).toBe("sealed before tip and scored.");
    for (const banned of BANNED) expect(banned.pattern.test(TILE_GLYPHS.sealed.text)).toBe(false);
    // Shown only when a version's missed count is zero (src/app/record/page.tsx).
    expect(readable("src/app/record/page.tsx")).toContain("Every game sealed before tip");
    for (const banned of BANNED) expect(banned.pattern.test("Every game sealed before tip")).toBe(false);
  });

  it("catches the old wordings, so a regression fails", () => {
    const old = [
      "Every 548 forecast is sealed before tip and scored after the final, in public",
      "Each game is sealed in the morning and again in the hour before tip; the final seal is the one scored.",
      "Every game's win probability, sealed before tip and scored in public.",
      "Win probabilities for every NBA game, sealed before tip and scored in public",
      "Win probabilities for every NBA game today, sealed before tip and scored in public",
    ];
    for (const text of old) expect(BANNED.some(({ pattern }) => pattern.test(text)), text).toBe(true);
    expect(BANNED.some(({ pattern }) => pattern.test("NBA forecasts, sealed before tip and scored in public"))).toBe(false);
  });
});
