import { describe, expect, it } from "vitest";
import { ARCHIVE_PAGES, isArchivePath } from "@/components/forecast/ArchiveHeader";
import { readableLabel } from "@/components/forecast/EvidenceExplorer";

describe("archive row labels", () => {
  it("reads a game row ID as season, round, teams and game", () => {
    expect(readableLabel("2025-finals-finals-okc-ind:game-1")).toBe("2025 NBA Finals · OKC–IND · G1");
  });
  it("reads a series row ID without a game", () => {
    expect(readableLabel("2007-west-r1-dal-gsw")).toBe("2007 First Round · DAL–GSW");
  });
  it("falls back to the ID when the series is not indexed", () => {
    expect(readableLabel("1900-nowhere:game-3")).toBe("1900-nowhere:game-3");
  });
});

describe("archive routes", () => {
  it("lists the five frozen pages", () => {
    expect(ARCHIVE_PAGES.map((page) => page.href)).toEqual(["/retrospective", "/snapshot", "/evidence", "/methodology", "/lab"]);
  });
  it("tells archive paths from live ones", () => {
    expect(isArchivePath("/evidence")).toBe(true);
    expect(isArchivePath("/lab/")).toBe(true);
    expect(isArchivePath("/record")).toBe(false);
    expect(isArchivePath("/laboratory")).toBe(false);
    expect(isArchivePath("/how-it-works")).toBe(false);
  });
});
