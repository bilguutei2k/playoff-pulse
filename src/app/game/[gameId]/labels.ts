// Small text helpers for the game page: the possessive of a team name, and where the
// seal chart's labels go so that none of them print on top of another. Layout only.

/**
 * "Thunder's", "Jazz's", "Heat's", "76ers'", "Trail Blazers'": a plural nickname
 * (ending in s) takes an apostrophe alone, everything else 's.
 */
export function possessive(name: string): string {
  return /s$/i.test(name) ? `${name}'` : `${name}'s`;
}

export type LabelAnchor = "start" | "middle" | "end";

/** One place a label may go: (x, y) is the text's anchor point on its baseline. */
export type LabelSpot = { x: number; y: number; anchor: LabelAnchor };

export type LabelRequest = {
  text: string;
  fontSize: number;
  /** Where the label may go, best first. */
  spots: LabelSpot[];
};

export type Box = { left: number; top: number; right: number; bottom: number };

/** Average advance of this font's characters, as a share of the font size (a bound, not a measure). */
const CHAR_EM = 0.6;

/** The box a label's text takes at a spot, from an estimate of its width. */
export function labelBox(text: string, fontSize: number, spot: LabelSpot): Box {
  const width = text.length * fontSize * CHAR_EM;
  const left = spot.anchor === "start" ? spot.x : spot.anchor === "end" ? spot.x - width : spot.x - width / 2;
  return { left, right: left + width, top: spot.y - fontSize * 0.8, bottom: spot.y + fontSize * 0.25 };
}

function overlaps(a: Box, b: Box): boolean {
  return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
}

/**
 * Places each label, in order, at its first spot that overlaps neither a label placed
 * before it nor an obstacle (the chart's squares) and stays inside the chart's width.
 * A label with no free spot keeps its first. Returns one spot per label.
 */
export function placeLabels(labels: LabelRequest[], obstacles: Box[] = [], width = Infinity): LabelSpot[] {
  const placed: Box[] = [];
  return labels.map((label) => {
    const fits = (spot: LabelSpot) => {
      const box = labelBox(label.text, label.fontSize, spot);
      if (box.left < 0 || box.right > width) return false;
      return ![...placed, ...obstacles].some((other) => overlaps(box, other));
    };
    const spot = label.spots.find(fits) ?? label.spots[0];
    placed.push(labelBox(label.text, label.fontSize, spot));
    return spot;
  });
}
