import { describe, expect, it } from "vitest";
import { labelBox, placeLabels, possessive, type Box, type LabelRequest } from "@/app/game/[gameId]/labels";

describe("possessive", () => {
  it("adds 's to a name that does not end in s", () => {
    expect(possessive("Thunder")).toBe("Thunder's");
    expect(possessive("Jazz")).toBe("Jazz's");
    expect(possessive("Heat")).toBe("Heat's");
    expect(possessive("Magic")).toBe("Magic's");
  });

  it("adds an apostrophe alone to a plural name", () => {
    expect(possessive("76ers")).toBe("76ers'");
    expect(possessive("Trail Blazers")).toBe("Trail Blazers'");
    expect(possessive("Philadelphia 76ers")).toBe("Philadelphia 76ers'");
  });
});

const square = (px: number, py: number, size: number): Box => ({
  left: px - size / 2,
  right: px + size / 2,
  top: py - size / 2,
  bottom: py + size / 2,
});

const intersects = (a: Box, b: Box) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

describe("placeLabels", () => {
  // OKC at POR, 2026-11-10: the published morning seal (57%, scored square) and the
  // reference seal (v1 65%) at the same minute, the reference just above. The old rule
  // printed "57% Morning" above its square, on top of "v1 65%".
  it("keeps a published label and a reference label just above it apart", () => {
    const own = { px: 209, py: 116, size: 16 };
    const ref = { px: 209, py: 95, size: 10 };
    const labels: LabelRequest[] = [
      {
        text: "57% Morning",
        fontSize: 12.5,
        spots: [
          { x: own.px, y: own.py - own.size / 2 - 6, anchor: "middle" },
          { x: own.px, y: own.py + own.size / 2 + 15, anchor: "middle" },
        ],
      },
      {
        text: "v1 65%",
        fontSize: 12,
        spots: [
          { x: ref.px + 12, y: ref.py + 4, anchor: "start" },
          { x: ref.px - 5, y: ref.py - 10, anchor: "start" },
          { x: ref.px - 5, y: ref.py + 20, anchor: "start" },
        ],
      },
    ];
    const obstacles = [square(own.px, own.py, own.size), square(ref.px, ref.py, ref.size)];
    const spots = placeLabels(labels, obstacles, 400);
    const boxes = spots.map((spot, index) => labelBox(labels[index].text, labels[index].fontSize, spot));
    expect(intersects(boxes[0], boxes[1])).toBe(false);
    for (const box of boxes) for (const obstacle of obstacles) expect(intersects(box, obstacle)).toBe(false);
    // The published label gave way downwards; the reference keeps its place beside its square.
    expect(spots[0].y).toBeGreaterThan(own.py);
    expect(spots[1]).toEqual(labels[1].spots[0]);
  });

  it("keeps the first spot when it is free, and when no spot is free", () => {
    const label: LabelRequest = { text: "60% Final", fontSize: 12.5, spots: [{ x: 200, y: 50, anchor: "middle" }, { x: 200, y: 90, anchor: "middle" }] };
    expect(placeLabels([label], [], 400)).toEqual([label.spots[0]]);
    const everywhere: Box = { left: 0, right: 400, top: 0, bottom: 200 };
    expect(placeLabels([label], [everywhere], 400)).toEqual([label.spots[0]]);
  });

  it("does not place a label past the chart's edges", () => {
    const label: LabelRequest = {
      text: "v1 65%",
      fontSize: 12,
      spots: [
        { x: 390, y: 50, anchor: "start" },
        { x: 390, y: 50, anchor: "end" },
      ],
    };
    expect(placeLabels([label], [], 400)).toEqual([label.spots[1]]);
  });
});
