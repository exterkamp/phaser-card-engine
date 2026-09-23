import Phaser from 'phaser';
import {
  CARD_HEIGHT,
  CARD_WIDTH,
  Card,
  DEFAULT_DECK_THEME,
  DISPLAY_FONT,
  Stack,
  buildDeck,
  cardRect,
  defineStack,
  shuffle,
  stackPositions,
} from 'phaser-card-engine';
import {
  CardSprite, boardRoot, createBoard, orderStack, preloadCardArt, throwCard,
} from 'phaser-card-engine/phaser';

// Dealing a hand of hold'em, as a program.
//
// There are no rules in here and nothing is evaluated - no hands are ranked,
// nobody bets. What it is is the dealing: the order a real dealer goes in,
// expressed with the two primitives this package has. Every place a card can
// end up is a Stack, and every card gets there by being thrown at one.
//
// The whole of the game logic is deal() at the bottom, and it reads like the
// instructions on the back of a rulebook, which is the point.
const WIDTH = 480;
const HEIGHT = 640;

const SEATS = [
  { id: 'you', label: 'You', x: 210, y: 560, faceUp: true },
  { id: 'west', label: 'Seat 2', x: 62, y: 420, faceUp: false },
  { id: 'north', label: 'Seat 3', x: 210, y: 92, faceUp: false },
  { id: 'east', label: 'Seat 4', x: 396, y: 420, faceUp: false },
];

// The dealer's tray: the deck and the burned cards, side by side in the band
// between the top seat and the board. They started in the bottom-right
// corner, under seat 4, where the three piles stacked into one column of
// face-down cards that read as a single enormous hand.
const DECK = { x: 398, y: 180 };
const BURN = { x: 318, y: 180 };

interface Pile {
  stack: Stack;
  cards: CardSprite[];
  faceUp: boolean;
}

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
    // A seat's two hole cards, side by side and overlapping a little - which
    // is a fan running right with a step narrower than a card.
    for (const seat of SEATS) {
      this.addPile(defineStack({
        id: seat.id, x: seat.x, y: seat.y, fan: 'right', step: 38,
      }), seat.faceUp);
      this.say(seat.x + 19, seat.y - CARD_HEIGHT / 2 - 11, seat.label);
    }

    // The board: five cards in a row, spaced so none covers another. A stack
    // whose step is wider than a card is still a stack.
    this.addPile(defineStack({
      id: 'board', x: 104, y: 280, fan: 'right', step: 68,
    }), true);
    this.say(104, 280 - CARD_HEIGHT / 2 - 11, 'Board');

    // And the burn pile, squared, face down.
    this.addPile(defineStack({ id: 'burn', ...BURN }), false);
    this.say(BURN.x, BURN.y - CARD_HEIGHT / 2 - 11, 'Burn');
    this.say(DECK.x, DECK.y - CARD_HEIGHT / 2 - 11, 'Deck');
  }

  private addPile(stack: Stack, faceUp: boolean): void {
    this.piles.set(stack.id, { stack, cards: [], faceUp });
    // The outline, which is what an empty seat looks like. Two of them for a
    // seat, because two cards are coming.
    const places = stack.id === 'board' ? 5 : stack.fan === 'none' ? 1 : 2;
    for (const at of stackPositions(stack, places)) {
      const rect = cardRect(at);
      const g = this.add.graphics().setDepth(0);
      g.lineStyle(1.5, 0xcfead0, 0.18);
      g.strokeRoundedRect(rect.x, rect.y, rect.width, rect.height, 5);
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

    card.setDepth(1000 + this.deck.length);
    this.root.sort('depth');
    await throwCard(this, card, { stack: pile.stack, count: pile.cards.length }, {
      duration: 260 * this.speed,
      spins: 1,
    });
    card.setFaceUp(pile.faceUp);
    pile.cards.push(card);
    const at = stackPositions(pile.stack, pile.cards.length);
    pile.cards.forEach((sprite, i) => sprite.setPosition(at[i].x, at[i].y));
    orderStack(this.root, pile.cards, pile.stack, [...this.piles.keys()].indexOf(to) * 100);
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
