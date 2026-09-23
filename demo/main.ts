import Phaser from 'phaser';
import {
  CARD_HEIGHT,
  CARD_WIDTH,
  Card,
  DISPLAY_FONT,
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
// Tall enough for everything below at its full fan, and no taller: the board
// is fitted by width on a phone, so every unit of height beyond what the cards
// use is green nobody plays on.
const HEIGHT = 640;
const MARGIN = 12;
const COLUMNS = 6;
const PITCH = (WIDTH - 2 * MARGIN) / COLUMNS;
const centre = (column: number) => MARGIN + PITCH / 2 + column * PITCH;

// The room a fan has before it must squeeze. Unlimited on one setting and a
// hard cap on the other, which is what the Toggle squeeze button switches
// between - and everything here is dealt deep enough that the difference is
// the whole point rather than a detail.
const ROOMY = 0;
const TIGHT = 190;

// Where each band of the specimen sheet sits.
const TOP_ROW = 60;         // squared: foundations and a deck
const SIDEWAYS = 165;       // one fan running right, one running left
const COLUMN_TOP = 250;     // four fanning down
const UP_FOOT = 560;        // and one fanning up from its bottom card

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
  private readonly labels: Phaser.GameObjects.Text[] = [];
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
      ? `maxSpread ${TIGHT}: the ${deepest.cards.length}-card column fans at ${gap} units a card instead of 26. `
        + 'Every direction squeezes the same way.'
      : 'maxSpread 0: every pile fans at its full step, whatever it costs.';
  }

  // --- the stacks ----------------------------------------------------------

  private buildStacks(): void {
    const kept = new Map(this.piles.map((pile) => [pile.stack.id, pile.cards]));
    const spread = this.squeezed ? TIGHT : ROOMY;

    // One of everything the primitive can do, laid out as a specimen sheet.
    // A real game picks the two or three it needs; this shows all five.
    const stacks: Stack[] = [
      // Squared: no fan, so every card lands exactly on the last. A
      // foundation, a stock, a waste and a free cell are all this.
      ...[0, 1, 2, 3].map((i) =>
        defineStack({ id: `foundation-${i}`, x: centre(i), y: TOP_ROW })),
      defineStack({ id: 'deck', x: centre(5), y: TOP_ROW }),

      // Sideways, in both directions. A fan running right grows away from its
      // anchor; one running left grows back towards the other edge, which is
      // how you put a pile in the top-right corner and have it stay there.
      defineStack({
        id: 'fan-right', x: MARGIN + CARD_WIDTH / 2, y: SIDEWAYS,
        fan: 'right', step: 22, maxSpread: spread ? 150 : 0,
      }),
      defineStack({
        id: 'fan-left', x: WIDTH - MARGIN - CARD_WIDTH / 2, y: SIDEWAYS,
        fan: 'left', step: 22, maxSpread: spread ? 150 : 0,
      }),

      // Down, which is what a tableau column is.
      ...Array.from({ length: 4 }, (_, i) =>
        defineStack({
          id: `column-${i}`, x: centre(i), y: COLUMN_TOP + CARD_HEIGHT / 2,
          fan: 'down', step: 26, maxSpread: spread,
        })),

      // And up, anchored at its *bottom* card so the pile grows towards the
      // top of the screen - which is what you want for a pile near a bottom
      // edge, and for an opponent's hand across the table from you.
      //
      // Worth seeing rather than only reading: an upward fan shows the
      // *bottom* edges of the cards underneath, and a card's index is at its
      // top-left, so all but the newest card reads as a blank sliver. The
      // geometry does not care which way it goes; the card does. A game
      // fanning upward wants its index drawn at both ends, which is the
      // sprite's business and not this package's yet.
      defineStack({
        id: 'fan-up', x: centre(5), y: UP_FOOT,
        fan: 'up', step: 26, maxSpread: spread,
      }),
    ];

    this.piles = stacks.map((stack) => ({ stack, cards: kept.get(stack.id) ?? [] }));
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
    this.printLabels();
  }

  /** What each band is, since the whole point is telling them apart. */
  private printLabels(): void {
    for (const label of this.labels.splice(0)) label.destroy();
    const say = (x: number, y: number, text: string, origin = 0) => {
      const item = this.add.text(x, y, text, {
        fontFamily: DISPLAY_FONT,
        fontSize: '11px',
        color: '#7fae86',
      }).setOrigin(origin, 0.5).setDepth(0);
      this.labels.push(item);
    };
    say(MARGIN, TOP_ROW - CARD_HEIGHT / 2 - 10, 'SQUARED');
    say(MARGIN, SIDEWAYS - CARD_HEIGHT / 2 - 10, 'FAN RIGHT');
    say(WIDTH - MARGIN, SIDEWAYS - CARD_HEIGHT / 2 - 10, 'FAN LEFT', 1);
    say(MARGIN, COLUMN_TOP - 10, 'FAN DOWN');
    say(WIDTH - MARGIN, UP_FOOT + CARD_HEIGHT / 2 + 10, 'FAN UP', 1);
  }

  // --- dealing -------------------------------------------------------------

  private deal(): void {
    for (const pile of this.piles) {
      for (const view of pile.cards) view.destroy();
      pile.cards = [];
    }

    const deck = shuffle(buildDeck(), seeded(Date.now() % 100000));
    let next = 0;
    const give = (id: string, count: number) => {
      const pile = this.pile(id)!;
      for (let n = 0; n < count && next < deck.length; n++) {
        pile.cards.push(this.makeCard(deck[next++]));
      }
    };

    // Deliberately uneven, and the long ones deliberately longer than the cap:
    // three cards fit either way, twelve never do, and everything between is
    // where you can watch the fan tighten. Every direction gets one pile long
    // enough to squeeze, and it all has to add up to fifty-two - the first
    // arrangement of this gave the columns and the sideways fans the whole
    // deck and left the up-fan and the deck with nothing.
    // Every one of the four directions gets a pile past its cap, so the
    // squeeze is visible everywhere rather than only down the columns - the
    // first arrangement gave the sideways fans six cards each, which fit
    // comfortably either way and made the note under the board a claim the
    // board did not support.
    [2, 4, 6, 10].forEach((count, i) => give(`column-${i}`, count));   // 22
    give('fan-right', 9);                      // 31
    give('fan-left', 9);                       // 40
    give('fan-up', 9);                         // 49
    give('deck', deck.length - next);          // and the last three squared

    const total = this.piles.reduce((sum, pile) => sum + pile.cards.length, 0);
    if (total !== 52) throw new Error(`dealt ${total} cards, not 52`);

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
