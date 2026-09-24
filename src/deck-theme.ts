// The decks a player can hold. Each is a whole palette - the courts' line
// work and garment colours, and a card back with its own field, medallion and
// border.
//
// A theme is a palette and a back. The courts it names are rendered from the
// twelve SVG sources - see court.ts, where COURT_PALETTES holds the seven -
// and only the back is a file, under assets/cards/art/<theme>/back.webp.
//
// This file and that art are the reason the package exists: both games had
// their own copy of the directory, byte for byte the same.
//
// A theme name is effectively a wire format in a game with a lobby - renaming
// one breaks a match in progress - and it is a storage format in a game
// without one. Either way it is a name that outlives the session, which is
// why nothing here is generated and why asDeckTheme exists.
export const DECK_THEMES = [
  'classic',
  'press',
  'felt',
  'royal',
  'steel',
  'antique',
  'millionaire',
] as const;

export type DeckTheme = (typeof DECK_THEMES)[number];

/** What a player gets before choosing, and where an unknown name lands. */
export const DEFAULT_DECK_THEME: DeckTheme = 'press';

/** Shown in a settings list. Kept here so nothing else has to name a deck. */
export const DECK_THEME_LABELS: Record<DeckTheme, string> = {
  classic: 'Classic',
  press: 'Press',
  felt: 'Felt',
  royal: 'Royal',
  steel: 'Steel',
  antique: 'Antique',
  millionaire: 'Millionaire',
};

/**
 * Anything off the wire or out of storage comes through here.
 *
 * Both are places a stale or hand-edited value can arrive from, and a bad
 * theme name would otherwise become a 404 on a texture and a card with no art
 * on it at all.
 */
export function asDeckTheme(value: unknown): DeckTheme {
  return DECK_THEMES.includes(value as DeckTheme)
    ? (value as DeckTheme)
    : DEFAULT_DECK_THEME;
}

/**
 * Where a theme's art lives once the assets are served.
 *
 * Absolute from the site root, and that is the contract this package asks of
 * a consumer: copy `assets/cards` to `/cards` when you build. Both games
 * already serve it from exactly there - see the README.
 */
export function deckThemePath(theme: DeckTheme, file: string): string {
  return `/cards/art/${theme}/${file}`;
}

/**
 * What the back's ink is printed over.
 *
 * The back art is line work on transparency, so the colour under it is a
 * choice rather than part of the picture. In a four-player game that is how
 * you tell whose deck is whose; in a solitaire it is simply the colour of
 * your deck.
 *
 * Muted rather than primary, which is what stops four decks on one table
 * looking like a toy, and dark enough to carry a light ink. Two things worth
 * knowing before changing them: desaturating pulls the red and the green
 * toward each other - this pair is the weakest of the sets tried under
 * deuteranopia - and these are close to a dark felt's own value, so a
 * face-down card leans on its shadow for its edge.
 *
 * The first four are the seat colours a four-handed game deals out. The last
 * two exist for a game where nobody else is at the table and the palette is
 * just a choice.
 */
export const BACK_COLORS = [
  0x2a5866, // petrol
  0x7a2e35, // oxblood
  0x4f6b38, // moss
  0x5e3a5c, // plum
  0x1f3a5f, // navy
  0x6b4a2a, // tobacco
] as const;

export const DEFAULT_BACK_COLOR = BACK_COLORS[0];

/** The first four, which are the ones that have to be told apart at a table. */
export const SEAT_COLORS: readonly number[] = BACK_COLORS.slice(0, 4);

export function seatColor(seat: number): number {
  return SEAT_COLORS[seat] ?? SEAT_COLORS[SEAT_COLORS.length - 1];
}

export function asBackColor(value: unknown): number {
  const parsed = typeof value === 'string' ? Number.parseInt(value, 16) : Number(value);
  return (BACK_COLORS as readonly number[]).includes(parsed) ? parsed : DEFAULT_BACK_COLOR;
}

/**
 * Six digits, always, because `'#2a5866'.slice(1)` has to round-trip through
 * asBackColor and a colour whose top byte is small would otherwise be written
 * short.
 */
export function backColorHex(color: number): string {
  return color.toString(16).padStart(6, '0');
}

export function backColorCss(color: number): string {
  return `#${backColorHex(color)}`;
}
