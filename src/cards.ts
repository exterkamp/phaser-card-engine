// What a card is, before anybody decides what game is being played with it.
//
// The vocabulary two games already agreed on without meaning to: web-nert and
// web-solitaire each grew their own copy of this file, and the copies were
// identical apart from the comments. That is the test for whether something
// belongs in here - not "could this be shared" but "was it already written
// twice the same way".
//
// What is deliberately *not* here is a Card type. Nertz cards carry a seat, a
// deck-list entry and a set of marks, and mint their ids from a counter
// because one deck can hold two of the same card; solitaire cards carry a
// face-up flag and take their id from the suit and rank because a deck holds
// exactly one of each. Neither model is wrong and neither fits the other, so
// this offers the face - the part they do agree on - and lets each game build
// its own card around it.

/** The four natural suits, in the order foundations are usually laid out. */
export const SUITS = ['spades', 'hearts', 'diamonds', 'clubs'] as const;
export type Suit = (typeof SUITS)[number];

/**
 * Suits that exist only because something modified the deck.
 *
 * Kept out of SUITS on purpose: that array is what builds a deck and drives
 * the foundation columns, and a fifth entry there would deal thirteen star
 * cards and add a column nobody asked for. A game with no modifiers never
 * mentions these and is unaffected by their existing.
 */
export const SPECIAL_SUITS = ['star'] as const;
export type SpecialSuit = (typeof SPECIAL_SUITS)[number];

/** What a card can carry once modifiers have had a go at it. */
export type CardSuit = Suit | SpecialSuit;

export function isSpecialSuit(suit: CardSuit): suit is SpecialSuit {
  return (SPECIAL_SUITS as readonly string[]).includes(suit);
}

export const RANKS = [
  'A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K',
] as const;
export type Rank = (typeof RANKS)[number];

export const RED_SUITS: ReadonlySet<CardSuit> = new Set<CardSuit>(['hearts', 'diamonds']);

export function isRed(suit: CardSuit): boolean {
  return RED_SUITS.has(suit);
}

/**
 * Whether two suits are the same colour.
 *
 * Most tableaus alternate colour rather than suit, so this - not the suit -
 * is what a placement rule actually asks about.
 */
export function sameColour(a: CardSuit, b: CardSuit): boolean {
  return isRed(a) === isRed(b);
}

/**
 * Ace is 1 and king is 13.
 *
 * The number every rank comparison goes through. Whether the sequence wraps
 * past the king is the game's business and not this function's: Tri Peaks and
 * Black Hole wrap, Golf does not, and each says so where it compares.
 */
export function rankValue(rank: Rank): number {
  return RANKS.indexOf(rank) + 1;
}

/** Enough to name a card without holding one. */
export interface CardFace {
  suit: CardSuit;
  rank: Rank;
}

export function sameFace(a: CardFace, b: CardFace): boolean {
  return a.rank === b.rank && a.suit === b.suit;
}

export function cardName(face: CardFace): string {
  return `${face.rank} of ${face.suit}`;
}

/**
 * The fifty-two faces of a standard deck, suit by suit.
 *
 * Faces rather than cards, for the reason given at the top of this file: an
 * id, a face-up flag and an owner are all decisions the game makes. A
 * solitaire builds its deck as `standardDeck().map(face => ({ ...face, id:
 * `${face.suit}-${face.rank}`, faceUp: false }))` and a game with duplicate
 * cards mints ids some other way.
 */
export function standardDeck(): CardFace[] {
  return SUITS.flatMap((suit) => RANKS.map((rank) => ({ suit, rank })));
}

// Poker size is 2.5 x 3.5 inches - a 5:7 ratio - and cards look wrong at
// anything else, so anything drawing one should keep that proportion exactly.
export const CARD_ASPECT = 5 / 7;

/**
 * The card size both games settled on, in the 480-unit-wide logical space
 * they both draw in.
 *
 * Here because they agreed, not because anybody has to use them: a board with
 * different room should pick its own and keep CARD_ASPECT.
 */
export const CARD_WIDTH = 60;
export const CARD_HEIGHT = CARD_WIDTH / CARD_ASPECT;
