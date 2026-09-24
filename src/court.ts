import { DeckTheme } from './deck-theme.js';
import { Rect } from './stack.js';

// The twelve court cards, and how to get one out of the source deck.
//
// The art is Dmitry Fomin's CC0 English pattern deck, in assets/cards/court -
// see ATTRIBUTION.md there. Everything in this file is what stands between
// those twelve files and a card you can put on a table, and none of it is
// guesswork: the numbers below were measured off the source by web-nert's
// tools/render-face-art.py, which baked them to WebP. This is the same
// pipeline with the baking taken out, so a palette can be chosen while the
// game is running rather than only while it is being built.
//
// The baked decks were 84 files and 4.1MB, and are gone: twelve sources gzip
// to about 490kB and cover every palette there will ever be, where seven
// directories of WebP covered exactly the seven somebody thought of.
//
// Nothing here touches a canvas - it is string and rectangle arithmetic, and
// it is in the Phaser-free half of the package on purpose.

/** The ranks that have a portrait. Everything else gets a pip. */
export const COURT_RANKS = ['J', 'Q', 'K'] as const;
export type CourtRank = (typeof COURT_RANKS)[number];

/** Rank letter to the word the source files are named with. */
export const COURT_FILE_RANK: Record<CourtRank, string> = {
  J: 'jack', Q: 'queen', K: 'king',
};

export function isCourtRank(rank: string): rank is CourtRank {
  return (COURT_RANKS as readonly string[]).includes(rank);
}

/**
 * Where a court source lives once the assets are served.
 *
 * Same contract as deckThemePath: copy `assets/cards` to `/cards`.
 */
export function courtSourcePath(rank: CourtRank, suit: string): string {
  return `/cards/court/${COURT_FILE_RANK[rank]}-${suit}.svg`;
}

// --- the five inks ------------------------------------------------------

/**
 * The source deck is drawn in five colors and nothing else.
 *
 * There are 24 distinct hex values across the twelve files; the other 19 are
 * Inkscape rounding strays a unit or two off one of these, which is why
 * anything read out of the art is snapped to the nearest of the five rather
 * than matched exactly.
 */
export const COURT_SOURCE_INKS = {
  ink: '#5555aa',
  black: '#000000',
  gold: '#ffff55',
  red: '#ff5555',
  paper: '#ffffff',
} as const;

export type CourtInkRole = keyof typeof COURT_SOURCE_INKS;

/**
 * The roles a theme may move.
 *
 * Gold and red are the garment fields and carry the deck's color. Ink is
 * every line on every face, hand and lock of hair - 12% of the art but the
 * whole of its drawing - and moving it changes the deck's character more than
 * either field does.
 *
 * Paper is 42% of the art, and the rule about it has always been that it has
 * to stay in step with the card fill drawn underneath it or the art reads as
 * a sticker stuck on a white card. That rule used to mean "never move it";
 * now that a game can choose its own card stock it means the opposite - paper
 * follows the card. Leave it out and it stays the near-white the source was
 * drawn on.
 *
 * Black stays put. It is the mass the line work sits on rather than a color
 * anything is printed in, and a deck that moves it is a deck whose faces
 * dissolve into their own garments.
 */
export interface CourtPalette {
  ink: string;
  gold: string;
  red: string;
  /** The card stock: the card's own background. Defaults to COURT_PAPER. */
  paper?: string;
  /**
   * The white *inside* the drawing: faces, hands, linen, the blade of a
   * sword. Defaults to COURT_PAPER, which is what the source was drawn on.
   *
   * Separate from `paper` because a dark deck needs them to be. The source
   * has no white skin to recolor - a face is a *hole* in the drawing, and
   * what shows through it is the card's own background. So one color for both
   * means a dark card takes the King's face with it and leaves line work
   * floating on nothing.
   *
   * The two are told apart by what they touch rather than by anything in the
   * file: the background reaches the edge of the card and a face does not.
   * See `partBackground` in phaser/court-art.ts.
   */
  highlight?: string;
}

/** The seven themes. These were seven directories of WebP until they were
 * three hex values each, which is all they had ever been. */
export const COURT_PALETTES: Record<DeckTheme, CourtPalette> = {
  // The source as drawn - a websafe ramp, bright and a little electric.
  classic: { ink: '#5555aa', gold: '#ffff55', red: '#ff5555' },
  // What four-color offset on uncoated stock actually gets you. No screen
  // palette reaches #ff0000 and neither did any card press.
  press: { ink: '#4a4892', gold: '#e8b422', red: '#cf2436' },
  // Against the table: its label gold, a deeper brick, and line work in the
  // felt's own green rather than blue.
  felt: { ink: '#2e584c', gold: '#d8b471', red: '#962d30' },
  // The shop's gold with the purple seat color. The ink goes near-neutral
  // here on purpose - a purple line over a purple field is one shape.
  royal: { ink: '#3a344a', gold: '#ffd166', red: '#7a4fa3' },
  // Cool throughout, line work included.
  steel: { ink: '#365468', gold: '#c6d6e0', red: '#2f6f8f' },
  // Aged: everything pulled toward brown, nothing fully saturated, and the
  // drawing in sepia rather than blue.
  antique: { ink: '#6b4a32', gold: '#e0c080', red: '#a85c4a' },
  // Green throughout. One hue for all three roles is the hardest case, and
  // the only thing holding it apart is lightness: the three sit on an even
  // ladder because hue does none of the work here.
  millionaire: { ink: '#1e5540', gold: '#9ccf7a', red: '#2f8f5b' },
};

const RGB = (hex: string): [number, number, number] => [
  Number.parseInt(hex.slice(1, 3), 16),
  Number.parseInt(hex.slice(3, 5), 16),
  Number.parseInt(hex.slice(5, 7), 16),
];

const CORE = (Object.keys(COURT_SOURCE_INKS) as CourtInkRole[])
  .map((role) => ({ role, rgb: RGB(COURT_SOURCE_INKS[role]) }));

/** Which of the five a color out of the source art is, strays included. */
export function snapCourtInk(hex: string): CourtInkRole {
  const full = hex.length === 4
    ? `#${hex.slice(1).split('').map((c) => c + c).join('')}`
    : hex;
  const rgb = RGB(full.toLowerCase());
  let best = CORE[0];
  let closest = Infinity;
  for (const candidate of CORE) {
    const distance = candidate.rgb.reduce((sum, v, i) => sum + (v - rgb[i]) ** 2, 0);
    if (distance < closest) { closest = distance; best = candidate; }
  }
  return best.role;
}

// --- the source, and the window taken out of it -------------------------

/**
 * The source geometry. Every fraction here was measured, not chosen.
 *
 * `seam`: the deck is double-ended, so the top half is one complete figure
 * and the bottom half is that same figure upside down, carrying nothing new.
 *
 * `ruleWipe`: the source clips each figure to a border rule at y 0.054, and
 * that rule doubles as the top edge of every crown, hat and sword in the
 * deck. Cropping below it decapitates all twelve. So the crop starts above
 * the rule and the rule itself gets painted out.
 *
 * `left`/`right`: set to where the *figure* reaches rather than to the border
 * rule. Between the rule at x 0.042 and the garment at 0.081 the source
 * leaves a white margin, and cropping at the rule carries that margin into
 * the art as a pale strip down the side of every court. Measured just above
 * the seam, where the figure is widest: 0.081 to 0.919 on all twelve, with
 * both edges set a hair inside so the garment bleeds off rather than stopping
 * on the card.
 *
 * `indexBox`: the source's own rank and its big decorative pip, painted out
 * because the board draws its own index over the top. Cropping in from the
 * left to dodge it does not work - the index sits directly above the
 * shoulder, so any window narrow enough to miss it also cuts off the crown.
 * The bottom edge is measured: the pip ends at y 0.250 and the figure starts
 * at 0.254 on every card, so the box stops in that gap.
 */
export const COURT_SOURCE = {
  width: 360,
  height: 540,
  seam: 0.50,
  left: 0.083,
  right: 0.911,
  top: 0.036,
  ruleWipe: 0.0585,
  indexBox: { left: 0.015, top: 0.010, right: 0.334, bottom: 0.252 },
} as const;

/**
 * The default card stock, and what the source's own marks get painted out
 * with.
 *
 * Not pure white: it has to match the card fill the board draws, or the patch
 * reads as a lighter rectangle sitting on the card. A game that sets its own
 * paper has to move both together, which is why `CourtPalette.paper` and
 * `CardStyle.paper` are the same decision stated once - see `courtPaper`.
 */
export const COURT_PAPER = '#fdfdfd';

/** The stock a palette is printed on, defaulted. */
export function courtPaper(palette: CourtPalette): string {
  return palette.paper ?? COURT_PAPER;
}

/** The white inside the drawing, defaulted. */
export function courtHighlight(palette: CourtPalette): string {
  return palette.highlight ?? COURT_PAPER;
}

/**
 * Background the edges of the art cannot reach, as fractions of the finished
 * picture.
 *
 * Telling the card's background from the figure's own whites is done by where
 * they connect, and on two of the twelve there is a piece of background that
 * connects to nothing: the band to the right of the jack of clubs' head, and
 * the sliver between the king of hearts' hair and his sword. Both are walled
 * in by the figure on every side and by the crop on none.
 *
 * No rule found them, and the reason is that no rule can. A face is a hole in
 * the drawing and so is one of these; they are the same thing to anything
 * that looks at shape or connection, which is why a flood that reaches these
 * also eats the queen of hearts' face. What separates them is knowing what
 * the picture is *of*.
 *
 * So they are written down. These twelve files are public-domain art from
 * 2012 that has not changed and will not, in the same way the crop window
 * above is measured off them rather than computed - and if one is ever
 * replaced, `court.spec.ts` checks that every seat here still lands on
 * something pale.
 */
export const COURT_BACKGROUND_SEEDS: Readonly<Record<string, readonly CourtSeed[]>> = {
  'J-clubs': [{ x: 0.850, y: 0.380 }],
  'K-hearts': [{ x: 0.769, y: 0.362 }],
};

/** A place in the finished art, as fractions of its width and height. */
export interface CourtSeed { x: number; y: number }

/** The seeds for one card, in fractions of the finished art. */
export function courtSeeds(rank: string, suit: string): readonly CourtSeed[] {
  return COURT_BACKGROUND_SEEDS[`${rank}-${suit}`] ?? [];
}

/**
 * How tall the finished art is for a given width.
 *
 * Taken from the crop's own proportions rather than fixed. The window is
 * chosen to hold the figure and the card's art slot is then whatever shape
 * that turns out to be; sizing it the other way round is what forced the
 * crop to cut crowns off in the first place.
 */
export function courtArtHeight(width: number): number {
  const { seam, top, left, right, width: sw, height: sh } = COURT_SOURCE;
  return Math.round((width * ((seam - top) * sh)) / ((right - left) * sw));
}

/**
 * How big to render the whole source so that the crop lands at `width`.
 *
 * The crop is a window onto the middle of the page, so the page has to be
 * drawn bigger than the piece wanted from it.
 */
export function courtSourceSize(width: number): { width: number; height: number } {
  const full = Math.round(width / (COURT_SOURCE.right - COURT_SOURCE.left));
  return { width: full, height: Math.round((full * COURT_SOURCE.height) / COURT_SOURCE.width) };
}

/** The window to lift out of a rendered source of this size. */
export function courtCropRect(source: { width: number; height: number }): Rect {
  const { left, right, top, seam } = COURT_SOURCE;
  return {
    x: Math.round(left * source.width),
    y: Math.round(top * source.height),
    width: Math.round((right - left) * source.width),
    height: Math.round((seam - top) * source.height),
  };
}

/**
 * The rectangles to paint over in paper before cropping: the border rule with
 * everything above it, and the source's own index.
 *
 * Wiping the full width above the rule costs nothing - the source clips its
 * figure to that line, so there is only white margin up there.
 */
export function courtWipeRects(source: { width: number; height: number }): Rect[] {
  const { ruleWipe, indexBox } = COURT_SOURCE;
  return [
    { x: 0, y: 0, width: source.width, height: Math.round(ruleWipe * source.height) },
    {
      x: Math.round(indexBox.left * source.width),
      y: Math.round(indexBox.top * source.height),
      width: Math.round((indexBox.right - indexBox.left) * source.width),
      height: Math.round((indexBox.bottom - indexBox.top) * source.height),
    },
  ];
}

// --- preparing one file -------------------------------------------------

// Only fills and strokes, so a color mentioned in metadata or in an editor
// attribute is left alone.
const PAINT = /((?:fill|stroke)\s*[:=]\s*"?)(#[0-9a-fA-F]{3}(?:[0-9a-fA-F]{3})?)\b/g;

/**
 * Swap the three movable roles, in the SVG rather than in the bitmap.
 *
 * Done before rasterising so the browser regenerates the blends: about 15% of
 * the art is antialiased pixels lying between two of the five colors, and
 * remapping those by nearest-neighbour after the fact bands every edge in the
 * deck.
 */
export function recolorCourt(svg: string, palette: CourtPalette): string {
  // Every white goes to the highlight, the card's background included. The
  // background is pulled back to the stock afterwards, on the canvas, by
  // `partBackground` - see there for why it cannot be done here.
  return svg.replace(PAINT, (whole, lead: string, hex: string) => {
    const role = snapCourtInk(hex);
    const want = role === 'ink' ? palette.ink
      : role === 'gold' ? palette.gold
        : role === 'red' ? palette.red
          : role === 'paper' ? courtHighlight(palette)
            : undefined;
    return want === undefined ? whole : lead + want;
  });
}

/**
 * Give the source the viewBox it should have had.
 *
 * These come out of Inkscape with width="360" height="540" and *no* viewBox,
 * which is the trap: without one there is no mapping from user units to the
 * viewport, so enlarging the svg element only enlarges the canvas. The
 * drawing stays 360x540 in the top-left corner and the rest comes back blank,
 * which looks exactly like art that failed to scale and is easy to go hunting
 * for in the renderer instead.
 */
export function withCourtViewBox(svg: string): string {
  if (svg.includes('viewBox')) return svg;
  return svg.replace('<svg', `<svg viewBox="0 0 ${COURT_SOURCE.width} ${COURT_SOURCE.height}"`);
}

/** One source file, recolored and made scalable. */
export function prepareCourt(svg: string, palette: CourtPalette): string {
  return recolorCourt(withCourtViewBox(svg), palette);
}
