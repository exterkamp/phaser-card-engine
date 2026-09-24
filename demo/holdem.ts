import Phaser from 'phaser';
import './serve';
import {
  CARD_HEIGHT,
  Card,
  COURT_PALETTES,
  DEFAULT_DECK_THEME,
  DISPLAY_FONT,
  Hand,
  Stack,
  buildDeck,
  cardRect,
  defineHand,
  defineStack,
  handBounds,
  handPositions,
  shuffle,
  stackPositions,
} from 'phaser-card-engine';
import {
  CardSprite, boardRoot, createBoard, layHand, orderStack, preloadCardArt, renderCourts, throwCard,
} from 'phaser-card-engine/phaser';

// Dealing a hand of hold'em, as a program.
//
// There are no rules in here and nothing is evaluated - no hands are ranked,
// nobody bets. What it is is the dealing: the order a real dealer goes in,
// expressed with the two primitives this package has. What lies on the table
// is a Stack; what a player holds is a Hand; every card gets to either by
// being thrown at it.
//
// The whole of the game logic is deal() at the bottom, and it reads like the
// instructions on the back of a rulebook, which is the point.
const WIDTH = 480;
const HEIGHT = 640;

// Each seat holds its two cards rather than stacking them, and holds them
// the way that seat is sitting: the player across the table has them upside
// down from here, and the two at the sides have them turned sideways. That
// is one field - `facing` - and it is the whole reason a hand is not a stack
// with a small step.
const SEATS = [
  { id: 'you', label: 'You', x: 240, y: 556, facing: 0, faceUp: true },
  { id: 'west', label: 'Seat 2', x: 66, y: 420, facing: 90, faceUp: false },
  { id: 'north', label: 'Seat 3', x: 240, y: 96, facing: 180, faceUp: false },
  { id: 'east', label: 'Seat 4', x: 402, y: 420, facing: 270, faceUp: false },
];

// The dealer's tray: the deck and the burned cards, side by side in the band
// between the top seat and the board. They started in the bottom-right
// corner, under seat 4, where the three piles stacked into one column of
// face-down cards that read as a single enormous hand.
const DECK = { x: 398, y: 180 };

/** Hole cards per seat - what each hand is sized and labelled around. */
const HOLE_CARDS = 2;
const BURN = { x: 318, y: 180 };

// Two kinds of place on this table: piles lying on it, and hands held by the
// people round it.
type Pile =
  | { kind: 'stack'; stack: Stack; cards: CardSprite[]; faceUp: boolean }
  | { kind: 'hand'; hand: Hand; cards: CardSprite[]; faceUp: boolean };

class HoldemTable extends Phaser.Scene {
  private root!: Phaser.GameObjects.Container;
  private deck: CardSprite[] = [];
  private piles = new Map<string, Pile>();
  private speed = 1;
  private dealing = false;

  preload(): void {
    preloadCardArt(this, { themes: [DEFAULT_DECK_THEME] });
  }

  create(): void {
    this.cameras.main.setBackgroundColor('#13463a');
    // The courts are rendered, not loaded, so this is what puts portraits on
    // the twelve. Not awaited: a card built before its portrait lands shows
    // its pip and takes the portrait when it arrives.
    void renderCourts(this, COURT_PALETTES[DEFAULT_DECK_THEME]);
    this.root = boardRoot(this);
    this.buildTable();
    this.newDeck();

    document.getElementById('deal')?.addEventListener('click', () => this.deal());
    document.getElementById('speed')?.addEventListener('click', () => {
      this.speed = this.speed === 1 ? 0.45 : this.speed === 0.45 ? 2 : 1;
      const button = document.getElementById('speed');
      if (button) {
        button.textContent = `Speed: ${this.speed === 1 ? 'normal' : this.speed < 1 ? 'fast' : 'slow'}`;
      }
    });
  }

  // --- the table -----------------------------------------------------------

  private buildTable(): void {
    // A seat's two hole cards, held in a slight fan and turned to face that
    // seat. A small spread and a close grip: two cards held at the corner,
    // not a rummy hand laid open.
    for (const seat of SEATS) {
      const hand = defineHand({
        id: seat.id, x: seat.x, y: seat.y,
        step: 14, maxSpread: 14, radius: 190, facing: seat.facing,
      });
      this.piles.set(seat.id, { kind: 'hand', hand, cards: [], faceUp: seat.faceUp });
      this.outline(handPositions(hand, HOLE_CARDS));
      // Labels clear of the cards, off `handBounds` rather than off a card's
      // own height - a fanned card is turned, and a turned card reaches
      // further than its own corner. Above the hand for three of the four
      // seats: the two at the sides hold their cards turned a quarter round,
      // so a label beside one of those would be a label off the felt.
      const box = handBounds(hand, HOLE_CARDS);
      const y = seat.facing === 0 ? box.y + box.height + 14 : box.y - 14;
      this.say(seat.x, y, seat.label);
    }

    // The board: five cards in a row, spaced so none covers another. A stack
    // whose step is wider than a card is still a stack.
    this.addPile(defineStack({
      id: 'board', x: 104, y: 280, fan: 'right', step: 68,
    }), true, 5);
    this.say(104, 280 - CARD_HEIGHT / 2 - 11, 'Board');

    // And the burn pile, squared, face down.
    this.addPile(defineStack({ id: 'burn', ...BURN }), false, 1);
    this.say(BURN.x, BURN.y - CARD_HEIGHT / 2 - 11, 'Burn');
    this.say(DECK.x, DECK.y - CARD_HEIGHT / 2 - 11, 'Deck');
  }

  private addPile(stack: Stack, faceUp: boolean, places: number): void {
    this.piles.set(stack.id, { kind: 'stack', stack, cards: [], faceUp });
    this.outline(stackPositions(stack, places));
  }

  /** What an empty place looks like: a printed outline, turned if it is held. */
  private outline(places: readonly { x: number; y: number; angle?: number }[]): void {
    for (const at of places) {
      const rect = cardRect({ x: 0, y: 0 });
      const g = this.add.graphics().setDepth(0);
      g.lineStyle(1.5, 0xcfead0, 0.18);
      g.strokeRoundedRect(rect.x, rect.y, rect.width, rect.height, 5);
      g.setPosition(at.x, at.y);
      g.setAngle(at.angle ?? 0);
      this.root.add(g);
    }
  }

  private say(x: number, y: number, text: string): void {
    const label = this.add.text(x, y, text, {
      fontFamily: DISPLAY_FONT, fontSize: '10px', color: '#7fae86',
    }).setOrigin(0.5, 0.5).setDepth(0);
    this.root.add(label);
  }

  private newDeck(): void {
    for (const pile of this.piles.values()) {
      for (const card of pile.cards) card.destroy();
      pile.cards = [];
    }
    for (const card of this.deck) card.destroy();

    this.deck = shuffle(buildDeck()).map((card: Card, i) => {
      // Face down in the dealer's hands, like any deck.
      const sprite = new CardSprite(this, { ...card, faceUp: false });
      sprite.setPosition(DECK.x, DECK.y);
      sprite.setDepth(i);
      this.root.add(sprite);
      return sprite;
    });
    this.root.sort('depth');
  }

  // --- throwing one card ---------------------------------------------------

  /**
   * Off the top of the deck and onto a pile.
   *
   * The card is thrown at where that pile's next card goes, turned over on
   * arrival if the pile is a face-up one, and then handed to the pile - which
   * redraws it square. Nothing here knows what game is being dealt.
   */
  private async deliver(to: string): Promise<void> {
    const pile = this.piles.get(to)!;
    const card = this.deck.pop();
    if (!card) return;
    const base = [...this.piles.keys()].indexOf(to) * 100;

    card.setDepth(1000 + this.deck.length);
    this.root.sort('depth');

    if (pile.kind === 'hand') {
      // The hand is about to hold one more, so it opens to make room - with
      // the card in flight left out of that, because the throw is moving it.
      pile.cards.push(card);
      layHand(this, this.root, pile.cards, pile.hand, {
        base, duration: 140 * this.speed, except: [card],
      });
      await throwCard(this, card, { hand: pile.hand, count: pile.cards.length - 1 }, {
        duration: 260 * this.speed,
        spins: 1,
      });
      card.setFaceUp(pile.faceUp);
      layHand(this, this.root, pile.cards, pile.hand, { base, duration: 0 });
      return;
    }

    await throwCard(this, card, { stack: pile.stack, count: pile.cards.length }, {
      duration: 260 * this.speed,
      spins: 1,
    });
    card.setFaceUp(pile.faceUp);
    pile.cards.push(card);
    const at = stackPositions(pile.stack, pile.cards.length);
    pile.cards.forEach((sprite, i) => sprite.setPosition(at[i].x, at[i].y));
    orderStack(this.root, pile.cards, pile.stack, base);
  }

  private note(text: string): void {
    const note = document.getElementById('note');
    if (note) note.textContent = text;
  }

  private pause(ms: number): Promise<void> {
    return new Promise((resolve) => this.time.delayedCall(ms * this.speed, resolve));
  }

  // --- the hand ------------------------------------------------------------

  /**
   * One hand, dealt the way a dealer deals it.
   *
   * Two cards to each seat, one at a time, starting left of the button and
   * going round twice - not two cards to each seat in turn, which is the
   * thing everybody gets wrong and which looks wrong even when you cannot say
   * why. Then a card burned before each of the flop, the turn and the river.
   */
  private async deal(): Promise<void> {
    if (this.dealing) return;
    this.dealing = true;
    const button = document.getElementById('deal') as HTMLButtonElement | null;
    if (button) button.disabled = true;

    this.newDeck();
    this.note('Shuffling.');
    await this.pause(200);

    this.note('Hole cards: one at a time, twice round the table.');
    for (let round = 0; round < 2; round++) {
      for (const seat of SEATS) await this.deliver(seat.id);
    }

    await this.pause(350);
    this.note('Burn, and the flop.');
    await this.deliver('burn');
    for (let i = 0; i < 3; i++) await this.deliver('board');

    await this.pause(350);
    this.note('Burn, and the turn.');
    await this.deliver('burn');
    await this.deliver('board');

    await this.pause(350);
    this.note('Burn, and the river.');
    await this.deliver('burn');
    await this.deliver('board');

    const board = this.piles.get('board')!.cards.map((c) => `${c.card.rank}${c.card.suit[0]}`);
    const hole = this.piles.get('you')!.cards.map((c) => `${c.card.rank}${c.card.suit[0]}`);
    this.note(`You have ${hole.join(' ')}; the board is ${board.join(' ')}. `
      + `${this.deck.length} cards left in the deck.`);

    if (button) button.disabled = false;
    this.dealing = false;
  }
}

const game = createBoard({
  parent: 'board',
  width: WIDTH,
  height: HEIGHT,
  backgroundColor: '#13463a',
  scene: HoldemTable,
});

(window as unknown as { __game: Phaser.Game }).__game = game;
// The geometry, for the smoke checks: they ask where a hand *should* hold its
// cards and compare that against where the sprites actually came to rest,
// which is a question they cannot answer from the scene alone.
(window as unknown as { __pce: unknown }).__pce = { handPositions };
