import { CARD_ASPECT, CARD_WIDTH } from './cards.js';

// What a card face looks like, as numbers.
//
// The layout is Nertz's, which is the one of the two games that had thought
// hardest about it: a large index with its suit beside it on one line in the
// top-left, and one big suit - or a court portrait, full bleed - filling the
// bottom. No mirrored bottom-right corner, because once a card is legible at
// a glance the second index is redundant, and dropping it is what paid for
// everything else being bigger.
//
// Here rather than in the sprite so it can be checked without a browser. The
// sprite is fifteen setPosition calls against these numbers; the numbers are
// the part that can be wrong in a way nobody notices until a card is fanned
// under another one.

/** The size everything below was measured at. */
export const BASE_CARD_WIDTH = CARD_WIDTH;

export interface CardFaceMetrics {
  width: number;
  height: number;
  /** Corner radius of the card body. */
  radius: number;
  /** Room around the body for its shadow, on every side. */
  pad: number;
  index: {
    /** Where the rank's left edge and vertical middle sit, from the centre. */
    x: number;
    y: number;
    fontSize: number;
    /** Gap between the rank's right edge and its suit. */
    gap: number;
    suitSize: number;
  };
  /** The one big suit a number card carries, centred on this point. */
  pip: { y: number; size: number };
  /**
   * How much of a card has to show for its index to be readable - the ink
   * plus its two margins, and nothing else.
   *
   * This is the number a fanned pile's step is chosen against: less than
   * this and the pile is a column of half-indexes; much more and the pile is
   * longer than it needs to be. A font box is substantially taller than the
   * glyphs in it, so this is measured off the ink rather than taken from a
   * Text object's height.
   */
  peek: number;
}

// Measured off rendered cards at 60 units wide, and every one of them is a
// ratio of the width so a card can be drawn at any size. The comments are
// Nertz's reasoning, kept because the numbers are otherwise arbitrary.
const RATIOS = {
  radius: 6 / 60,
  pad: 7 / 60,
  // Archivo at 27px puts down 19px of ink, which is the proportion the corner
  // was laid out against.
  indexFontSize: 27 / 60,
  indexLeft: 5 / 60,
  indexGap: 1 / 60,
  indexSuitSize: 20 / 60,
  // Half-height of the index's actual ink, and the gaps above and below it.
  inkHalfHeight: 9.7 / 60,
  inkTopMargin: 6 / 60,
  inkBottomMargin: 4 / 60,
  // One big suit rather than a true pip count: five rows of small glyphs at
  // this size reads as a blurry cluster rather than as a card.
  pipSize: 48 / 60,
  pipCentreY: 12.5 / 60,
};

export function cardFaceMetrics(width: number = BASE_CARD_WIDTH): CardFaceMetrics {
  const height = width / CARD_ASPECT;
  const at = (ratio: number) => ratio * width;
  const inkHalf = at(RATIOS.inkHalfHeight);
  const inkTop = at(RATIOS.inkTopMargin);

  return {
    width,
    height,
    radius: at(RATIOS.radius),
    pad: at(RATIOS.pad),
    index: {
      x: -width / 2 + at(RATIOS.indexLeft),
      // Up from the middle by everything above the ink's own middle.
      y: -(height / 2 - (inkTop + inkHalf)),
      fontSize: at(RATIOS.indexFontSize),
      gap: at(RATIOS.indexGap),
      suitSize: at(RATIOS.indexSuitSize),
    },
    pip: { y: at(RATIOS.pipCentreY), size: at(RATIOS.pipSize) },
    peek: inkTop + 2 * inkHalf + at(RATIOS.inkBottomMargin),
  };
}

/**
 * Where a court portrait sits: full width, flush with the bottom edge, its
 * height taken from the art's own proportions.
 *
 * Full bleed on purpose - the figure runs to the card's edges rather than
 * sitting in a frame - and the height comes from the texture rather than
 * being named here, because the crop is decided when the art is cut and this
 * has to follow it.
 */
export function courtArtRect(
  metrics: CardFaceMetrics, art: { width: number; height: number },
): { x: number; y: number; width: number; height: number } {
  const height = (metrics.width * art.height) / art.width;
  return { x: 0, y: metrics.height / 2 - height / 2, width: metrics.width, height };
}
