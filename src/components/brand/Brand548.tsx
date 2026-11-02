// The 548 mark: an ink tile with the numerals in Archivo Black and an orange square
// on the baseline after the 8. Inline styles only, so the same component renders in
// the page and inside ImageResponse (icons and the share image).
//
// Geometry comes from Archivo Black's own metrics, measured once in Chromium:
// digits advance 0.667em and stand 0.700em above the baseline; the font's ascent
// and descent are 0.878em and 0.210em. The numerals' ink spans 1.841em with
// -0.04em tracking, and it is set to fill 70% of the tile width.

const INK = "#121417";
const PULSE = "#ff5a1f";

const TRACKING = -0.04;
const INK_LEFT = 0.039; // left side bearing of the 5
const INK_WIDTH = 1.841; // from the 5's left edge to the 8's right edge, tracked
const DIGIT_HEIGHT = 0.7;
const ASCENT = 0.878;
const DESCENT = 0.21;
const DOT = 0.19; // side of the full stop, in em
const DOT_GAP = 0.06;

export const BRAND_FONT_FAMILY = "var(--font-archivo-black), 'Archivo Black', sans-serif";

export function Brand548({
  size = 36,
  fontFamily = BRAND_FONT_FAMILY,
  title,
}: {
  size?: number;
  /** In ImageResponse this must be the family name registered with the font data. */
  fontFamily?: string;
  /** Accessible name. Omit when visible text beside the mark already names the site. */
  title?: string;
}) {
  const fontSize = (0.7 * size) / INK_WIDTH;
  const gap = Math.max(DOT_GAP * fontSize, size >= 24 ? 1 : 0.5);
  const dot = DOT * fontSize;
  const groupWidth = INK_WIDTH * fontSize + gap + dot;
  const inkLeft = (size - groupWidth) / 2;
  // Centre the digits' ink, not the line box: baseline sits half a digit below the middle.
  const baseline = size / 2 + (DIGIT_HEIGHT * fontSize) / 2;
  const baselineInBox = ((1 - (ASCENT + DESCENT)) / 2 + ASCENT) * fontSize;
  return (
    <div
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      style={{
        display: "flex",
        position: "relative",
        flexShrink: 0,
        width: size,
        height: size,
        borderRadius: size * 0.22,
        background: INK,
        overflow: "hidden",
      }}
    >
      <div
        style={{
          display: "flex",
          position: "absolute",
          left: inkLeft - INK_LEFT * fontSize,
          top: baseline - baselineInBox,
          height: fontSize,
          fontFamily,
          fontSize,
          lineHeight: 1,
          letterSpacing: TRACKING * fontSize,
          color: "#ffffff",
          whiteSpace: "nowrap",
        }}
      >
        548
      </div>
      <div
        style={{
          display: "flex",
          position: "absolute",
          left: inkLeft + INK_WIDTH * fontSize + gap,
          top: baseline - dot,
          width: dot,
          height: dot,
          background: PULSE,
        }}
      />
    </div>
  );
}
