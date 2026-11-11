import { describe, expect, it } from "vitest";
import {
  fold,
  foldWithMap,
  matchFolded,
  preparePlayers,
  prepareTeams,
  searchPlayers,
  searchTeamList,
  searchTeams,
  splitSpan,
} from "@/components/layout/site-search-match";

const teams = prepareTeams(searchTeamList());
const teamNames = (query: string) => searchTeams(teams, query).map((hit) => hit.team.name);

const players = preparePlayers([
  // Arrives most-used first, as /api/search-index sends it.
  { id: "1", name: "Shai Gilgeous-Alexander", team: "25" },
  { id: "2", name: "Nikola Jokić", team: "7" },
  { id: "3", name: "LeBron James", team: "13" },
  { id: "4", name: "P.J. Washington", team: "6" },
  { id: "5", name: "De'Aaron Fox", team: "24" },
  { id: "6", name: "Kristaps Porziņģis", team: "1" },
  { id: "7", name: "Jalen Williams", team: "25" },
  { id: "8", name: "James Harden", team: "12" },
]);
const playerNames = (query: string, limit = 8) => searchPlayers(players, query, limit).results.map((hit) => hit.player.name);

describe("fold", () => {
  it("drops accents, case and periods, and reads other punctuation as a space", () => {
    expect(fold("Nikola Jokić")).toBe("nikola jokic");
    expect(fold("P.J. Washington")).toBe("pj washington");
    expect(fold("De'Aaron Fox")).toBe("deaaron fox");
    expect(fold("Shai Gilgeous-Alexander")).toBe("shai gilgeous alexander");
    expect(fold("  Porziņģis  ")).toBe("porzingis");
    expect(fold("Philadelphia 76ers")).toBe("philadelphia 76ers");
  });

  it("maps each folded character back to the original text", () => {
    const folded = foldWithMap("Jokić x");
    expect(folded.text).toBe("jokic x");
    expect(folded.from).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });
});

describe("matchFolded", () => {
  const at = (text: string, query: string) => matchFolded(foldWithMap(text), fold(query), text);

  it("ranks whole, start, word start, inside a word, then every word in any order", () => {
    expect(at("Boston Celtics", "boston celtics")?.tier).toBe(0);
    expect(at("Boston Celtics", "bos")?.tier).toBe(1);
    expect(at("Boston Celtics", "celt")?.tier).toBe(2);
    expect(at("Boston Celtics", "eltic")?.tier).toBe(3);
    expect(at("Boston Celtics", "celtics bos")?.tier).toBe(4);
    expect(at("Boston Celtics", "x")).toBeNull();
  });

  it("does not match a single letter inside a word", () => {
    expect(at("Boston Celtics", "o")).toBeNull();
  });

  it("returns the span in the original, accented text", () => {
    const text = "Nikola Jokić";
    const hit = at(text, "jokic");
    expect(splitSpan(text, hit!.span)).toEqual(["Nikola ", "Jokić", ""]);
  });
});

describe("searchTeams", () => {
  it("matches city, nickname and tricode", () => {
    expect(teamNames("oklahoma")).toEqual(["Oklahoma City Thunder"]);
    expect(teamNames("thunder")).toEqual(["Oklahoma City Thunder"]);
    expect(teamNames("OKC")).toEqual(["Oklahoma City Thunder"]);
    expect(teamNames("gsw")[0]).toBe("Golden State Warriors");
    expect(teamNames("gs")[0]).toBe("Golden State Warriors");
    expect(teamNames("blazers")).toEqual(["Portland Trail Blazers"]);
    expect(teamNames("sixers")).toEqual(["Philadelphia 76ers"]);
    expect(teamNames("76")).toEqual(["Philadelphia 76ers"]);
  });

  it("puts exact codes and name starts first", () => {
    expect(teamNames("la").slice(0, 2)).toEqual(["LA Clippers", "Los Angeles Lakers"]);
    expect(teamNames("los angeles")).toEqual(expect.arrayContaining(["LA Clippers", "Los Angeles Lakers"]));
    expect(teamNames("ny")[0]).toBe("New York Knicks");
  });

  it("finds nothing for an empty query", () => {
    expect(teamNames("   ")).toEqual([]);
  });
});

describe("searchPlayers", () => {
  it("matches any part of the name, accent-insensitively", () => {
    expect(playerNames("jokic")).toEqual(["Nikola Jokić"]);
    expect(playerNames("Jokić")).toEqual(["Nikola Jokić"]);
    expect(playerNames("porzingis")).toEqual(["Kristaps Porziņģis"]);
    expect(playerNames("gilgeous alexander")).toEqual(["Shai Gilgeous-Alexander"]);
    expect(playerNames("alexander")).toEqual(["Shai Gilgeous-Alexander"]);
    expect(playerNames("pj")).toEqual(["P.J. Washington"]);
    expect(playerNames("deaaron")).toEqual(["De'Aaron Fox"]);
  });

  it("ranks name starts before later words, then keeps the index order", () => {
    // "James Harden" starts with it; "LeBron James" has it as a later word.
    expect(playerNames("james")).toEqual(["James Harden", "LeBron James"]);
    // Both names start with it: the index's order (most used first) breaks the tie.
    expect(playerNames("ja")).toEqual(["Jalen Williams", "James Harden", "LeBron James"]);
  });

  it("reports the total beyond the limit", () => {
    const found = searchPlayers(players, "j", 2);
    expect(found.results).toHaveLength(2);
    expect(found.total).toBeGreaterThan(2);
  });
});
