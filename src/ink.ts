import { colorOf } from './cards.js';

// What a suit is printed in.
//
// Separate from cards.ts because that file answers what a suit *counts as* -
// the question a rule asks - and this one answers what it looks like. A deck
// may print its hearts in green and they are still red to every rule that
// asks; keeping the two in one file is how that distinction gets quietly lost.
//
// And separate from the Phaser half because it is arithmetic. It lived in
// card-sprite.ts first, where it could not be tested without a browser, which
// is the thing this package has a rule against.

const INK_RED = 0xcf2436;
const INK_BLACK = 0x1a1a1a;
// A suit this package cannot color is drawn in neither - gold, the color a
// game generally reaches for when it has invented a suit of its own. Override
// it with `ink` if that is wrong for yours.
const INK_OTHER = 0xd8a838;

/** The ink a suit is drawn in, unless the game says otherwise. */
export function defaultInk(suit: string): number {
  const color = colorOf(suit);
  if (color === 'red') return INK_RED;
  if (color === 'black') return INK_BLACK;
  return INK_OTHER;
}

/**
 * How a style says what a suit is printed in.
 *
 * A map for the usual case - a game recoloring two or three suits - and a
 * function for one that computes it.
 */
export type SuitInk = Readonly<Record<string, number>> | ((suit: string) => number);

/**
 * Resolve either form, falling back to the default ink.
 *
 * Per suit rather than all-or-nothing, so a map may name only the suits it
 * changes and leave the rest alone.
 */
export function inkOf(ink: SuitInk | undefined, suit: string): number {
  if (typeof ink === 'function') return ink(suit);
  return ink?.[suit] ?? defaultInk(suit);
}

/** `0xfdfdfd` as `'#fdfdfd'`, for the parts of the pipeline that are CSS. */
export function colorCss(color: number): string {
  return `#${color.toString(16).padStart(6, '0')}`;
}

/** `'#fdfdfd'` as `0xfdfdfd`, for the parts that are Phaser. */
export function cssColor(css: string): number {
  return Number.parseInt(css.replace('#', ''), 16);
}
