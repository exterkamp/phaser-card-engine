import { describe, expect, it } from 'vitest';
import {
  CARD_ASPECT,
  CARD_HEIGHT,
  CARD_WIDTH,
  RANKS,
  SUITS,
  cardName,
  isRed,
  isSpecialSuit,
  rankValue,
  sameColour,
  sameFace,
  standardDeck,
} from './cards.js';

describe('the deck', () => {
  it('is fifty-two faces, one of each', () => {
    const deck = standardDeck();
    expect(deck).toHaveLength(52);
    expect(new Set(deck.map((c) => `${c.suit}-${c.rank}`)).size).toBe(52);
  });

  it('comes out suit by suit, in the order foundations sit in', () => {
    const deck = standardDeck();
    expect(deck.slice(0, 13).every((c) => c.suit === 'spades')).toBe(true);
    expect(deck[0]).toEqual({ suit: 'spades', rank: 'A' });
    expect(deck[12]).toEqual({ suit: 'spades', rank: 'K' });
  });

  it('is built twice without either build touching the other', () => {
    const first = standardDeck();
    first[0].rank = 'K';
    expect(standardDeck()[0].rank).toBe('A');
  });
});

describe('suits and colours', () => {
  it('knows which suits are red', () => {
    expect(SUITS.filter(isRed)).toEqual(['hearts', 'diamonds']);
  });

  it('answers the question a tableau actually asks', () => {
    expect(sameColour('hearts', 'diamonds')).toBe(true);
    expect(sameColour('spades', 'clubs')).toBe(true);
    expect(sameColour('hearts', 'spades')).toBe(false);
  });

  // The star is kept out of SUITS on purpose: that array builds the deck, and
  // a fifth entry would deal thirteen star cards nobody asked for.
  it('keeps special suits out of the deck', () => {
    expect(SUITS).not.toContain('star');
    expect(isSpecialSuit('star')).toBe(true);
    expect(isSpecialSuit('hearts')).toBe(false);
    expect(standardDeck().some((c) => isSpecialSuit(c.suit))).toBe(false);
  });
});

describe('ranks', () => {
  it('counts the ace as one and the king as thirteen', () => {
    expect(rankValue('A')).toBe(1);
    expect(rankValue('K')).toBe(13);
    expect(RANKS.map(rankValue)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]);
  });

  it('names a card the way a person would say it', () => {
    expect(cardName({ suit: 'hearts', rank: 'Q' })).toBe('Q of hearts');
  });

  it('compares two faces by rank and suit', () => {
    expect(sameFace({ suit: 'hearts', rank: '9' }, { suit: 'hearts', rank: '9' })).toBe(true);
    expect(sameFace({ suit: 'hearts', rank: '9' }, { suit: 'spades', rank: '9' })).toBe(false);
  });
});

describe('the shape of a card', () => {
  it('keeps poker proportions', () => {
    expect(CARD_ASPECT).toBeCloseTo(5 / 7);
    expect(CARD_WIDTH / CARD_HEIGHT).toBeCloseTo(CARD_ASPECT);
  });
});
