import { describe, expect, expectTypeOf, it } from 'vitest';
import { Card, CardFace, Rank, Suit, buildDeck, cloneCards, topOf } from './cards.js';

// The two card models this package was extracted from, written out here as
// the games actually declare them. These are the test: if the base type stops
// fitting either of them, this file stops compiling.
//
// Nertz: a card knows whose it is, which line of a deck list it came from,
// and what the shop did to it. Its deck can hold two of the same card, so ids
// are minted rather than derived.
type CardMark = 'gilded' | 'warded' | 'snake';
interface NertzCard extends Card {
  seat: number;
  entry: number;
  marks?: CardMark[];
}

// Solitaire: exactly the base, except that a plain deck has no special suits,
// so it narrows the suit to the four natural ones. Narrowing a property in an
// extending interface is allowed, and this is the case it exists for.
interface SolitaireCard extends Card {
  suit: Suit;
}

describe('the base card', () => {
  it('is a whole deck on its own', () => {
    const deck = buildDeck();
    expect(deck).toHaveLength(52);
    expect(deck[0]).toEqual({ suit: 'spades', rank: 'A', id: 'spades-A', faceUp: false });
    expect(new Set(deck.map((c) => c.id)).size).toBe(52);
    expect(deck.every((c) => !c.faceUp)).toBe(true);
  });

  it('is what one of the two games already had, field for field', () => {
    const card: SolitaireCard = { id: 'hearts-9', suit: 'hearts', rank: '9', faceUp: true };
    expectTypeOf(card).toExtend<Card>();
  });
});

describe('extending it', () => {
  it('builds a deck of a game-s own card, and keeps its type', () => {
    let minted = 0;
    const deck = buildDeck<NertzCard>((face: CardFace, index: number) => ({
      ...face,
      id: `s1-${face.suit}-${face.rank}-${minted++}`,
      faceUp: false,
      seat: 1,
      entry: index,
    }));

    expectTypeOf(deck).toEqualTypeOf<NertzCard[]>();
    expect(deck).toHaveLength(52);
    expect(deck[0].seat).toBe(1);
    expect(deck[51].entry).toBe(51);
    // Two decks for two seats, and no id collides - which is the whole reason
    // this game mints ids rather than deriving them.
    const second = buildDeck<NertzCard>((face, index) => ({
      ...face, id: `s2-${face.suit}-${face.rank}-${minted++}`, faceUp: false, seat: 2, entry: index,
    }));
    expect(new Set([...deck, ...second].map((c) => c.id)).size).toBe(104);
  });

  it('hands back the extended type from the helpers, not the base', () => {
    const deck = buildDeck<NertzCard>((face, index) => ({
      ...face, id: `${index}`, faceUp: false, seat: 0, entry: index, marks: ['gilded'],
    }));

    const top = topOf(deck);
    expectTypeOf(top).toEqualTypeOf<NertzCard | undefined>();
    expect(top?.seat).toBe(0);

    const copy = cloneCards(deck);
    expectTypeOf(copy).toEqualTypeOf<NertzCard[]>();
    expect(copy[0].marks).toEqual(['gilded']);
  });
});

describe('the helpers', () => {
  it('finds the top of a pile, and nothing in an empty one', () => {
    const pile = buildDeck().slice(0, 3);
    expect(topOf(pile)?.id).toBe('spades-3');
    expect(topOf([])).toBeUndefined();
  });

  it('copies a pile one level deep', () => {
    const pile = buildDeck().slice(0, 2);
    const copy = cloneCards(pile);
    copy[0].faceUp = true;
    expect(pile[0].faceUp).toBe(false);
    expect(copy[0]).not.toBe(pile[0]);
  });

  // Stated rather than assumed: a card holding an array of its own shares it
  // with the copy, which is why nertz replaces a card's marks rather than
  // pushing to them.
  it('shares a nested array with the copy', () => {
    const marked: NertzCard[] = [
      { id: 'a', suit: 'spades', rank: 'A', faceUp: true, seat: 0, entry: 0, marks: ['snake'] },
    ];
    const copy = cloneCards(marked);
    expect(copy[0].marks).toBe(marked[0].marks);
  });
});

// A rank is a rank whichever game is holding it.
describe('the vocabulary travels with the card', () => {
  it('types a card-s rank as the shared rank', () => {
    const card = buildDeck()[4];
    expectTypeOf(card.rank).toEqualTypeOf<Rank>();
  });
});
