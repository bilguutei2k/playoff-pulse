import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

type RetirementDecision = {
  gate: {
    minimumMeaningfulDeficit: number;
    simpleComparators: string[];
  };
  comparisons: Array<{
    comparator: string;
    checks: Record<string, boolean>;
    retirementGateMet: boolean;
  }>;
  retirementGateMet: boolean;
  decision: string;
};

const artifact = JSON.parse(
  fs.readFileSync(
    path.join(
      process.cwd(),
      "docs",
      "backtest",
      "retirement-decision.json",
    ),
    "utf-8",
  ),
) as RetirementDecision;

describe("production retirement decision", () => {
  it("uses the symmetric threshold and named simple comparators", () => {
    expect(artifact.gate.minimumMeaningfulDeficit).toBe(0.005);
    expect(artifact.gate.simpleComparators).toEqual([
      "srs_proxy_only",
      "net_rating_only",
    ]);
  });

  it("derives each comparison verdict from every required check", () => {
    for (const comparison of artifact.comparisons) {
      expect(comparison.retirementGateMet).toBe(
        Object.values(comparison.checks).every(Boolean),
      );
    }
  });

  it("derives the final verdict from the comparator verdicts", () => {
    const retirementGateMet = artifact.comparisons.some(
      (comparison) => comparison.retirementGateMet,
    );
    expect(artifact.retirementGateMet).toBe(retirementGateMet);
    expect(artifact.decision).toBe(
      retirementGateMet
        ? "retire_production_to_research_only"
        : "retain_production_gate_not_met",
    );
  });
});
