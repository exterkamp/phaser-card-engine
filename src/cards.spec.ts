import { describe, expect, it } from 'vitest';
import {
  CARD_ASPECT,
  CARD_HEIGHT,
  CARD_WIDTH,
  RANKS,
  STANDARD_SUITS,
  SUITS,
  cardName,
  defineSuits,
  isRed,
  isStandardSuit,
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

  it('knows which suits a deck is built from', () => {
    expect(SUITS.every(isStandardSuit)).toBe(true);
    expect(isStandardSuit('star')).toBe(false);
  });

  // A suit this package has never heard of is not red, which is the right
  // answer for a rule about red and black to give about a gold star.
  it('calls an unknown suit black rather than refusing to answer', () => {
    expect(isRed('star')).toBe(false);
    expect(sameColour('star', 'spades')).toBe(true);
    expect(sameColour('star', 'hearts')).toBe(false);
  });
});

describe('a game adding suits of its own', () => {
  it('gets them in the vocabulary without this package knowing them', () => {
    const vocab = defineSuits({ star: { red: false }, rose: { red: true } });
    expect(vocab.all).toEqual([...SUITS, 'star', 'rose']);
    expect(vocab.isStandard('star')).toBe(false);
    expect(vocab.isStandard('hearts')).toBe(true);
  });

  it('decides for itself what colour they are', () => {
    const vocab = defineSuits({ star: { red: false }, rose: { red: true } });
    expect(vocab.isRed('star')).toBe(false);
    expect(vocab.isRed('rose')).toBe(true);
    expect(vocab.sameColour('rose', 'hearts')).toBe(true);
    expect(vocab.sameColour('star', 'clubs')).toBe(true);
  });

  it('leaves the four standard suits exactly as they were', () => {
    const vocab = defineSuits({ rose: { red: true } });
    expect(SUITS.map((s) => vocab.isRed(s))).toEqual(SUITS.map(isRed));
    // And the shared set is not mutated by anybody defining anything.
    expect(isRed('rose')).toBe(false);
  });

  it('is the four and nothing else when a game adds none', () => {
    expect(STANDARD_SUITS.all).toEqual([...SUITS]);
    expect(defineSuits().all).toEqual([...SUITS]);
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
