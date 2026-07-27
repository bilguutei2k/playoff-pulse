import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.join(__dirname, "..", "..");
const FROZEN_DIR = path.join(
  ROOT,
  "docs",
  "backtest",
  "frozen-2003-2025",
);
const CHECKSUM_PATH = path.join(FROZEN_DIR, "SHA256SUMS");

function sha256(filePath: string): string {
  return createHash("sha256")
    .update(fs.readFileSync(filePath))
    .digest("hex");
}

export function verifyFrozenArtifacts() {
  const entries = fs
    .readFileSync(CHECKSUM_PATH, "utf-8")
    .trim()
    .split("\n")
    .map((line) => {
      const match = line.match(/^([a-f0-9]{64}) {2}(.+\.json)$/);
      if (!match) {
        throw new Error(`Invalid frozen checksum entry: ${line}`);
      }
      return { expected: match[1], fileName: match[2] };
    });

  const recordedFiles = entries.map(({ fileName }) => fileName).sort();
  const frozenFiles = fs
    .readdirSync(FROZEN_DIR)
    .filter((fileName) => fileName.endsWith(".json"))
    .sort();

  if (JSON.stringify(recordedFiles) !== JSON.stringify(frozenFiles)) {
    throw new Error(
      `Frozen artifact inventory mismatch.\nRecorded: ${recordedFiles.join(", ")}\nPresent: ${frozenFiles.join(", ")}`,
    );
  }

  const mismatches = entries.flatMap(({ expected, fileName }) => {
    const actual = sha256(path.join(FROZEN_DIR, fileName));
    return actual === expected
      ? []
      : [`${fileName}: expected ${expected}, received ${actual}`];
  });

  if (mismatches.length > 0) {
    throw new Error(`Frozen artifact checksum mismatch:\n${mismatches.join("\n")}`);
  }

  console.log(`Verified ${entries.length} frozen 2003–2025 artifacts.`);
}

if (typeof require !== "undefined" && require.main === module) {
  verifyFrozenArtifacts();
}
