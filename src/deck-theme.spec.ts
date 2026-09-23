import { describe, expect, it } from 'vitest';
import {
  BACK_COLORS,
  DECK_THEMES,
  DECK_THEME_LABELS,
  DEFAULT_BACK_COLOR,
  DEFAULT_DECK_THEME,
  SEAT_COLORS,
  asBackColor,
  asDeckTheme,
  backColorCss,
  backColorHex,
  deckThemePath,
  seatColor,
} from './deck-theme.js';

describe('deck themes', () => {
  it('has a label for every theme and no more', () => {
    expect(Object.keys(DECK_THEME_LABELS).sort()).toEqual([...DECK_THEMES].sort());
  });

  it('falls back rather than letting an unknown name through', () => {
    expect(asDeckTheme('royal')).toBe('royal');
    expect(asDeckTheme('nonsense')).toBe(DEFAULT_DECK_THEME);
    expect(asDeckTheme(undefined)).toBe(DEFAULT_DECK_THEME);
    expect(asDeckTheme(7)).toBe(DEFAULT_DECK_THEME);
  });

  it('points at the art where a consumer is asked to serve it', () => {
    expect(deckThemePath('felt', 'king-spades.webp')).toBe('/cards/art/felt/king-spades.webp');
  });
});

describe('back colours', () => {
  it('gives the four seats four different colours', () => {
    expect(SEAT_COLORS).toHaveLength(4);
    expect(new Set(SEAT_COLORS).size).toBe(4);
    expect(SEAT_COLORS.every((c) => (BACK_COLORS as readonly number[]).includes(c))).toBe(true);
  });

  it('answers for a seat that does not exist rather than returning nothing', () => {
    expect(seatColor(0)).toBe(BACK_COLORS[0]);
    expect(seatColor(99)).toBe(SEAT_COLORS[SEAT_COLORS.length - 1]);
  });

  // The round trip that matters: a colour goes to storage as hex and has to
  // come back as the same number.
  it('round-trips through hex and back', () => {
    for (const color of BACK_COLORS) {
      expect(backColorHex(color)).toHaveLength(6);
      expect(asBackColor(backColorHex(color))).toBe(color);
      expect(asBackColor(backColorCss(color).slice(1))).toBe(color);
    }
  });

  it('refuses a colour that is not one of the deck colours', () => {
    expect(asBackColor('ff00ff')).toBe(DEFAULT_BACK_COLOR);
    expect(asBackColor(undefined)).toBe(DEFAULT_BACK_COLOR);
  });
});
