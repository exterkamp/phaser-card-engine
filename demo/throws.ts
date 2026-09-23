import Phaser from 'phaser';
import {
  CARD_HEIGHT,
  Card,
  DEFAULT_DECK_THEME,
  DISPLAY_FONT,
  Stack,
  buildDeck,
  cardRect,
  defineStack,
  seeded,
  shuffle,
  stackPositions,
  stackUnder,
} from 'phaser-card-engine';
import {
  CardSprite, boardRoot, createBoard, dealCards, flightDuration, orderStack,
  preloadCardArt, throwCard, toBoard,
} from 'phaser-card-engine/phaser';

// Throwing cards at things.
//
// Two targets, which is the whole point: a bare point on the felt, and a
// stack. Throwing at a stack lands the card where that stack's next card
// goes - on top of what is already there, at the angle the pile draws at -
// so the pile can take the card over the instant it arrives.
const WIDTH = 480;
const HEIGHT = 640;

interface Pile {
  stack: Stack;
  cards: CardSprite[];
}

class ThrowDemo extends Phaser.Scene {
  private root!: Phaser.GameObjects.Container;
  private deck: CardSprite[] = [];
  private piles: Pile[] = [];
  private loose: CardSprite[] = [];
  private spins = 1;
  private thrown = 0;

  preload(): void {
    preloadCardArt(this, { themes: [DEFAULT_DECK_THEME] });
  }

  create(): void {
    this.cameras.main.setBackgroundColor('#13463a');
    this.root = boardRoot(this);

    // Three piles to throw at, and a deck in the corner to throw from.
    this.piles = [
      defineStack({ id: 'fan', x: 120, y: 180, fan: 'down', step: 26, maxSpread: 150 }),
      defineStack({ id: 'squared', x: 300, y: 180 }),
      defineStack({ id: 'row', x: 110, y: 420, fan: 'right', step: 24, maxSpread: 200 }),
    ].map((stack) => ({ stack, cards: [] }));

    this.printFelt();
    this.fillDeck();

    // A tap on the felt is a throw at that spot; a tap on a pile is a throw
    // at the pile. Which one it was is stackUnder's answer.
    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      const at = toBoard(this, pointer);
      const pile = this.pileUnder(at);
      if (pile) this.throwAtPile(pile);
      else this.throwAtPoint(at);
    });

    document.getElementById('deal')?.addEventListener('click', () => this.dealHand());
    document.getElementById('gather')?.addEventListener('click', () => this.gather());
    document.getElementById('spins')?.addEventListener('click', () => {
      this.spins = (this.spins + 1) % 4;
      const button = document.getElementById('spins');
      if (button) button.textContent = `Spins: ${this.spins}`;
      this.report();
    });
    this.report();
  }

  // --- the table -----------------------------------------------------------

  private printFelt(): void {
    for (const { stack } of this.piles) {
      const rect = cardRect({ x: stack.x, y: stack.y });
      const g = this.add.graphics().setDepth(0);
      g.lineStyle(1.5, 0xcfead0, 0.25);
      g.strokeRoundedRect(rect.x, rect.y, rect.width, rect.height, 5);
      this.root.add(g);

      const label = this.add.text(stack.x, stack.y - CARD_HEIGHT / 2 - 10, stack.id, {
        fontFamily: DISPLAY_FONT, fontSize: '10px', color: '#7fae86',
      }).setOrigin(0.5, 0.5).setDepth(0);
      this.root.add(label);
    }
  }

  private fillDeck(): void {
    for (const card of this.deck) card.destroy();
    this.deck = shuffle(buildDeck(), seeded(Date.now() % 99991)).map((card: Card) => {
      const sprite = new CardSprite(this, { ...card, faceUp: true });
      sprite.setPosition(WIDTH - 50, HEIGHT - 70);
      sprite.setDepth(1);
      this.root.add(sprite);
      return sprite;
    });
    // Squared in the corner, so the deck reads as one pile.
    this.deck.forEach((sprite, i) => sprite.setDepth(1 + i));
  }

  private pileUnder(at: { x: number; y: number }): Pile | undefined {
    const stack = stackUnder(
      cardRect(at),
      this.piles.map((pile) => ({ stack: pile.stack, count: pile.cards.length })),
    );
    return stack ? this.piles.find((pile) => pile.stack.id === stack.id) : undefined;
  }

  // --- throwing ------------------------------------------------------------

  private take(): CardSprite | undefined {
    const card = this.deck.pop();
    if (!card) this.report('The deck is out - gather them up.');
    return card;
  }

  private async throwAtPoint(at: { x: number; y: number }): Promise<void> {
    const card = this.take();
    if (!card) return;
    this.loose.push(card);
    card.setDepth(500 + this.thrown++);
    this.root.sort('depth');
    // A point target, and a resting angle of its own so a scatter of cards
    // looks thrown rather than filed.
    await throwCard(this, card, at, {
      spins: this.spins,
      settleAngle: Phaser.Math.Between(-18, 18),
    });
    this.report(`Thrown at a point: ${Math.round(at.x)}, ${Math.round(at.y)}.`);
  }

  private async throwAtPile(pile: Pile): Promise<void> {
    const card = this.take();
    if (!card) return;
    card.setDepth(500 + this.thrown++);
    this.root.sort('depth');
    // A stack target: the card lands where that pile's next card goes, square
    // to the table, and the pile takes it over on arrival.
    await throwCard(this, card, { stack: pile.stack, count: pile.cards.length }, {
      spins: this.spins,
    });
    pile.cards.push(card);
    this.layOut(pile);
    this.report(`Thrown onto ${pile.stack.id}, now ${pile.cards.length} cards.`);
  }

  private async dealHand(): Promise<void> {
    const pile = this.piles[0];
    const hand = this.deck.splice(-5).reverse();
    if (!hand.length) return this.report('The deck is out - gather them up.');
    hand.forEach((card, i) => card.setDepth(500 + this.thrown + i));
    this.thrown += hand.length;
    this.root.sort('depth');
    await dealCards(this, hand, { stack: pile.stack, count: pile.cards.length }, {
      spins: this.spins,
      stagger: 110,
    });
    pile.cards.push(...hand);
    this.layOut(pile);
    this.report(`Dealt five onto ${pile.stack.id}, one every 110ms.`);
  }

  /** Everything back to the deck, thrown the other way. */
  private async gather(): Promise<void> {
    const coming = [...this.loose, ...this.piles.flatMap((pile) => pile.cards)];
    this.loose = [];
    for (const pile of this.piles) pile.cards = [];
    if (!coming.length) return;

    await Promise.all(coming.map((card, i) =>
      throwCard(this, card, { x: WIDTH - 50, y: HEIGHT - 70 }, {
        spins: this.spins, delay: i * 25, pop: false,
      }),
    ));
    this.deck.push(...coming);
    this.deck.forEach((card, i) => card.setDepth(1 + i));
    this.root.sort('depth');
    this.report('Gathered up.');
  }

  private layOut(pile: Pile): void {
    const at = stackPositions(pile.stack, pile.cards.length);
    pile.cards.forEach((card, i) => card.setPosition(at[i].x, at[i].y));
    orderStack(this.root, pile.cards, pile.stack, this.piles.indexOf(pile) * 100);
  }

  private report(what = ''): void {
    const note = document.getElementById('note');
    if (!note) return;
    const far = Math.round(flightDuration(400));
    const near = Math.round(flightDuration(80));
    note.textContent = `${what} ${this.deck.length} left in the deck. `
      + `A throw takes ${near}ms near and ${far}ms across the board, and spins `
      + `${this.spins === 0 ? 'not at all' : `${this.spins} turn${this.spins > 1 ? 's' : ''}`}.`;
  }
}

const game = createBoard({
  parent: 'board',
  width: WIDTH,
  height: HEIGHT,
  backgroundColor: '#13463a',
  scene: ThrowDemo,
});

(window as unknown as { __game: Phaser.Game }).__game = game;
