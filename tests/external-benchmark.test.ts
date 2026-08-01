import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";

import { auditExternalBenchmarks, type ExternalSeriesBenchmark } from "../src/lib/backtest/input-observations";
import { loadSeries } from "../scripts/backtest/build-snapshots";

describe("FiveThirtyEight external model benchmark", () => {
  const observations = JSON.parse(
    fs.readFileSync(
      path.join(process.cwd(), "data", "historical", "external-series-benchmarks.json"),
      "utf8",
    ),
  ) as ExternalSeriesBenchmark[];
  const series = Array.from({ length: 7 }, (_, index) => 2016 + index).flatMap(loadSeries);

  it("covers every eligible 2016-2022 series and passes the fail-closed contract", () => {
    expect(observations).toHaveLength(105);
    expect(new Set(observations.map((row) => row.seriesId)).size).toBe(105);
    expect(auditExternalBenchmarks(observations, series)).toEqual([]);
  });

  it("keeps public model forecasts distinct from no-vig market prices", () => {
    expect(observations.every((row) => row.method === "public_probability")).toBe(true);
    expect(
      observations.filter((row) => row.method === "no_vig_two_sided_series_price"),
    ).toHaveLength(0);
  });
});
