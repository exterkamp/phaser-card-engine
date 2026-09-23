import Phaser from 'phaser';
import {
  CARD_HEIGHT,
  CARD_WIDTH,
  Card,
  DEFAULT_DECK_THEME,
  Stack,
  buildDeck,
  cardRect,
  defineStack,
  nextPosition,
  seeded,
  shuffle,
  stackPositions,
  stackUnder,
} from 'phaser-card-engine';
import { CardView, preload } from './cards.js';

// A board made of nothing but stacks.
//
// Four squared foundations along the top, a deck beside them, and six columns
// that fan down and squeeze when they get long. None of these is a solitaire:
// there are no rules here at all, and a card may be dropped on any stack.
// What the demo is showing is the placement primitive - where a stack is,
// where its nth card sits, and which stack a dragged card is being offered to.
const WIDTH = 480;
// Tall enough for the longest column at full fan (210 + 312 + a card) and no
// taller. The board is fitted by width on a phone, so every unit of height
// beyond what the cards use is green nobody plays on.
const HEIGHT = 640;
const MARGIN = 12;
const COLUMNS = 6;
const PITCH = (WIDTH - 2 * MARGIN) / COLUMNS;
const centre = (column: number) => MARGIN + PITCH / 2 + column * PITCH;

// The room a column has before it must squeeze. Unlimited on one setting and
// a hard cap on the other, which is what the Toggle squeeze button switches
// between - and the columns are dealt deep enough that the difference is the
// whole point rather than a detail.
const COLUMN_TOP = 210;
const ROOMY = 0;
const TIGHT = 190;

interface Pile {
  stack: Stack;
  cards: CardView[];
}

class StackDemo extends Phaser.Scene {
  readonly theme = DEFAULT_DECK_THEME;
  private piles: Pile[] = [];
  private squeezed = true;
  private dragging?: { view: CardView; from: Pile; offset: Phaser.Math.Vector2 };
  private readonly marks: Phaser.GameObjects.Graphics[] = [];
  private highlight?: Phaser.GameObjects.Graphics;

  preload(): void {
    preload(this, this.theme);
  }

  create(): void {
    this.cameras.main.setBackgroundColor('#13463a');
    this.highlight = this.add.graphics().setDepth(5);
    this.buildStacks();
    this.deal();

    this.input.on('dragstart', (_p: unknown, view: CardView) => this.pickUp(view));
    this.input.on('drag', (pointer: Phaser.Input.Pointer) => this.carry(pointer));
    this.input.on('dragend', () => this.drop());

    document.getElementById('deal')?.addEventListener('click', () => this.deal());
    document.getElementById('squeeze')?.addEventListener('click', () => {
      this.squeezed = !this.squeezed;
      this.buildStacks();
      this.layOutAll();
      this.report();
    });
    this.report();
  }

  /** What the page says under the board, so the numbers are visible too. */
  private report(): void {
    const note = document.getElementById('note');
    if (!note) return;
    const deepest = this.piles
      .filter((pile) => pile.stack.fan === 'down')
      .reduce((most, pile) => (pile.cards.length > most.cards.length ? pile : most));
    const gap = deepest.cards.length > 1
      ? Math.round((deepest.cards[1].y - deepest.cards[0].y) * 10) / 10
      : 0;
    note.textContent = this.squeezed
      ? `maxSpread ${TIGHT}: the ${deepest.cards.length}-card column fans at ${gap} units a card instead of 26.`
      : 'maxSpread 0: every column fans at its full 26 units a card, whatever it costs.';
  }

  // --- the stacks ----------------------------------------------------------

  private buildStacks(): void {
    const kept = this.piles.map((pile) => pile.cards);
    const spread = this.squeezed ? TIGHT : ROOMY;

    const stacks: Stack[] = [
      // Four squared foundations: no fan, so every card lands on the last.
      ...[0, 1, 2, 3].map((i) =>
        defineStack({ id: `foundation-${i}`, x: centre(i), y: 70 })),
      // A deck, also squared, over at the end of the row.
      defineStack({ id: 'deck', x: centre(5), y: 70 }),
      // And the columns, fanning down with a cap on how far they may run.
      ...Array.from({ length: COLUMNS }, (_, i) =>
        defineStack({
          id: `column-${i}`,
          x: centre(i),
          y: COLUMN_TOP + CARD_HEIGHT / 2,
          fan: 'down',
          step: 26,
          maxSpread: spread,
        })),
    ];

    this.piles = stacks.map((stack, i) => ({ stack, cards: kept[i] ?? [] }));
    this.printFelt();
  }

  /** The outline of every stack, which is what an empty one looks like. */
  private printFelt(): void {
    for (const mark of this.marks.splice(0)) mark.destroy();
    for (const { stack } of this.piles) {
      const rect = cardRect({ x: stack.x, y: stack.y });
      const g = this.add.graphics().setDepth(0);
      g.lineStyle(1.5, 0xcfead0, 0.25);
      g.strokeRoundedRect(rect.x, rect.y, rect.width, rect.height, 5);
      this.marks.push(g);
    }
  }

  // --- dealing -------------------------------------------------------------

  private deal(): void {
    for (const pile of this.piles) {
      for (const view of pile.cards) view.destroy();
      pile.cards = [];
    }

    const deck = shuffle(buildDeck(), seeded(Date.now() % 100000));
    // Deliberately uneven, and the long ones deliberately longer than the cap:
    // three cards fit either way, thirteen never do, and everything between
    // is where you can watch the fan tighten.
    const perColumn = [3, 5, 7, 9, 11, 13];
    let next = 0;
    this.piles
      .filter((pile) => pile.stack.id.startsWith('column-'))
      .forEach((pile, i) => {
        for (let n = 0; n < perColumn[i]; n++) pile.cards.push(this.makeCard(deck[next++]));
      });
    const deckPile = this.pile('deck')!;
    for (; next < deck.length; next++) deckPile.cards.push(this.makeCard(deck[next]));

    this.layOutAll();
  }

  private makeCard(card: Card): CardView {
    const view = new CardView(this, card);
    view.setDepth(1);
    view.setInteractive(
      new Phaser.Geom.Rectangle(0, 0, CARD_WIDTH, CARD_HEIGHT),
      Phaser.Geom.Rectangle.Contains,
    );
    this.input.setDraggable(view);
    return view;
  }

  private pile(id: string): Pile | undefined {
    return this.piles.find((pile) => pile.stack.id === id);
  }

  // --- putting the cards where the engine says ------------------------------

  private layOut(pile: Pile): void {
    const at = stackPositions(pile.stack, pile.cards.length);
    pile.cards.forEach((view, i) => {
      view.setPosition(at[i].x, at[i].y);
      view.setDepth(1 + i);
    });
  }

  private layOutAll(): void {
    for (const pile of this.piles) this.layOut(pile);
  }

  // --- dragging ------------------------------------------------------------

  private pickUp(view: CardView): void {
    const from = this.piles.find((pile) => pile.cards.includes(view));
    if (!from) return;
    // Only the top card, which is all a squared stack ever offers anyway.
    if (from.cards[from.cards.length - 1] !== view) return;
    this.dragging = { view, from, offset: new Phaser.Math.Vector2(0, 0) };
    view.setDepth(100);
  }

  private carry(pointer: Phaser.Input.Pointer): void {
    const drag = this.dragging;
    if (!drag) return;
    drag.view.setPosition(pointer.worldX, pointer.worldY);

    // Which stack is it being offered to? Overlap, not the pointer - see
    // stackUnder, and note the card rectangle rather than the finger.
    const target = this.targetFor(drag.view);
    this.showHighlight(target);
  }

  private targetFor(view: CardView): Stack | undefined {
    return stackUnder(
      cardRect({ x: view.x, y: view.y }),
      this.piles
        .filter((pile) => !pile.cards.includes(view))
        .map((pile) => ({ stack: pile.stack, count: pile.cards.length })),
    );
  }

  private showHighlight(stack: Stack | undefined): void {
    this.highlight?.clear();
    if (!stack) return;
    const pile = this.pile(stack.id);
    const at = nextPosition(stack, pile?.cards.length ?? 0);
    const rect = cardRect(at);
    this.highlight
      ?.lineStyle(2, 0xffd166, 0.9)
      .strokeRoundedRect(rect.x, rect.y, rect.width, rect.height, 5);
  }

  private drop(): void {
    const drag = this.dragging;
    this.dragging = undefined;
    this.highlight?.clear();
    if (!drag) return;

    const target = this.targetFor(drag.view);
    const to = target ? this.pile(target.id) : undefined;
    if (to && to !== drag.from) {
      drag.from.cards = drag.from.cards.filter((card) => card !== drag.view);
      to.cards.push(drag.view);
      this.layOut(drag.from);
    }
    // Either way every card goes back to where the stack says it belongs,
    // which is also how a refused drop snaps back.
    this.layOut(to ?? drag.from);
  }
}

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'board',
  width: WIDTH,
  height: HEIGHT,
  backgroundColor: '#13463a',
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.NO_CENTER },
  // Let Phaser preventDefault the touches it handles. Without this a drag on
  // a phone is also a page scroll, and the card stays where it was while the
  // whole demo slides up the screen - which is the first thing anybody
  // testing this on a phone would hit.
  input: { touch: { capture: true } },
  scene: StackDemo,
});

// The handle a console session - or a test driving a real browser - reaches
// the board through. Both games here do the same thing, and it is how this
// demo is checked: open the console and ask a stack where its cards are.
(window as unknown as { __game: Phaser.Game }).__game = game;
