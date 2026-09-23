import { describe, expect, it } from 'vitest';
import {
  CARD_ASPECT,
  CARD_HEIGHT,
  CARD_WIDTH,
  RANKS,
  STANDARD_SUITS,
  SUITS,
  cardName,
  colourOf,
  defineSuits,
  isBlack,
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

  it('gives the four their colours', () => {
    expect(SUITS.map(colourOf)).toEqual(['black', 'red', 'red', 'black']);
    expect(SUITS.filter(isRed)).toEqual(['hearts', 'diamonds']);
    expect(SUITS.filter(isBlack)).toEqual(['spades', 'clubs']);
  });

  // The reason isBlack exists rather than !isRed: once a game can add suits,
  // "not red" stops meaning "black", and a gold star is neither.
  it('says nothing about the colour of a suit it has never heard of', () => {
    expect(colourOf('star')).toBeUndefined();
    expect(isRed('star')).toBe(false);
    expect(isBlack('star')).toBe(false);
  });

  it('will not call an unknown suit the same colour as anything', () => {
    expect(sameColour('star', 'spades')).toBe(false);
    expect(sameColour('star', 'hearts')).toBe(false);
    expect(sameColour('star', 'star')).toBe(false);
    expect(sameColour('spades', 'clubs')).toBe(true);
  });
});

describe('a game adding suits of its own', () => {
  it('gets them in the vocabulary without this package knowing them', () => {
    const vocab = defineSuits({ star: { colour: 'gold' }, rose: { colour: 'red' } });
    expect(vocab.all).toEqual([...SUITS, 'star', 'rose']);
    expect(vocab.isStandard('star')).toBe(false);
    expect(vocab.isStandard('hearts')).toBe(true);
  });

  it('decides for itself what colour they are', () => {
    const vocab = defineSuits({ star: { colour: 'gold' }, rose: { colour: 'red' } });
    expect(vocab.colourOf('star')).toBe('gold');
    expect(vocab.isRed('rose')).toBe(true);
    expect(vocab.sameColour('rose', 'hearts')).toBe(true);
  });

  // A suit that is neither red nor black is both questions answered no, which
  // is what stops a rule about alternating colours quietly swallowing it.
  it('lets a suit be neither red nor black', () => {
    const vocab = defineSuits({ star: { colour: 'gold' } });
    expect(vocab.isRed('star')).toBe(false);
    expect(vocab.isBlack('star')).toBe(false);
    expect(vocab.sameColour('star', 'spades')).toBe(false);
    expect(vocab.sameColour('star', 'hearts')).toBe(false);
    // Two golds are the same colour as each other, though.
    expect(vocab.sameColour('star', 'star')).toBe(true);
  });

  // And a game whose rules want the new suit treated as one of the two says
  // so - which is nertz's case, where a star is gold on the card and black to
  // the tableau.
  it('lets a suit play as black while being printed in gold', () => {
    const vocab = defineSuits({ star: { colour: 'black' } });
    expect(vocab.isBlack('star')).toBe(true);
    expect(vocab.sameColour('star', 'clubs')).toBe(true);
    expect(vocab.sameColour('star', 'hearts')).toBe(false);
  });

  it('leaves the four standard suits exactly as they were', () => {
    const vocab = defineSuits({ rose: { colour: 'red' } });
    expect(SUITS.map((s) => vocab.colourOf(s))).toEqual(SUITS.map(colourOf));
    // And nothing global is mutated by anybody defining anything.
    expect(colourOf('rose')).toBeUndefined();
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
