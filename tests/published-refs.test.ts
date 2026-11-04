import { describe, expect, it } from "vitest";
import { advertisedHead, DATA_BRANCH } from "@/lib/live-data/published";

// A trimmed smart-HTTP ref advertisement, as github.com serves it to `git ls-remote`.
const main = "a".repeat(40);
const data = "b".repeat(40);
const similar = "c".repeat(40);
const advertisement = [
  "001e# service=git-upload-pack",
  `0000015a${main} HEAD\0multi_ack thin-pack side-band symref=HEAD:refs/heads/main`,
  `0047${similar} refs/heads/live-data-old`,
  `003f${data} refs/heads/live-data`,
  `003f${main} refs/heads/main`,
  "0000",
].join("\n");

describe("the data branch's head from the ref advertisement", () => {
  it("reads live-data by default and main as well", () => {
    expect(DATA_BRANCH).toBe("live-data");
    expect(advertisedHead(advertisement, "live-data")).toBe(data);
    expect(advertisedHead(advertisement, "main")).toBe(main);
  });

  it("does not take a branch whose name only starts the same", () => {
    expect(advertisedHead(advertisement.replace(`${data} refs/heads/live-data\n`, ""), "live-data")).toBeNull();
  });
});
