import Phaser from 'phaser';
import {
  CARD_HEIGHT,
  CARD_WIDTH,
  Card,
  DISPLAY_FONT,
  DEFAULT_DECK_THEME,
  FanDirection,
  Stack,
  StackOrder,
  buildDeck,
  cardRect,
  defineStack,
  nextPosition,
  seeded,
  shuffle,
  stackDepths,
  stackPositions,
  stackUnder,
  topCardIndex,
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
const HEIGHT = 760;
const MARGIN = 12;
const COLUMNS = 6;
const PITCH = (WIDTH - 2 * MARGIN) / COLUMNS;
const centre = (column: number) => MARGIN + PITCH / 2 + column * PITCH;

// Where each band of the specimen sheet sits. Every band holds the same fan
// twice - once with the newest card in front and once with the oldest - so
// the two are side by side rather than a button apart.
const TOP_ROW = 70;
const RIGHT_ROW = 175;
const LEFT_ROW = 280;
const COLUMN_TOP = 355;
const UP_FOOT = 700;

// Low caps, so that piles of five or six cards still reach them and the
// squeeze is visible on every one of these rather than only on the deepest.
const DOWN_CAP = 110;
const SIDE_CAP = 80;

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
    const column = this.pile('down-last-on-top');
    const gap = column && column.cards.length > 1
      ? Math.round((column.cards[1].y - column.cards[0].y) * 10) / 10
      : 0;
    note.textContent = this.squeezed
      ? `Each pair is the same stack twice, drawn newest-in-front and oldest-in-front. `
        + `maxSpread ${DOWN_CAP}: the six-card column fans at ${gap} units a card instead of 26.`
      : 'Each pair is the same stack twice, drawn newest-in-front and oldest-in-front. '
        + 'maxSpread 0: every pile fans at its full step, whatever it costs.';
  }

  // --- the stacks ----------------------------------------------------------

  private buildStacks(): void {
    const kept = new Map(this.piles.map((pile) => [pile.stack.id, pile.cards]));
    const capped = this.squeezed;

    // Every direction twice: once with the newest card drawn in front and
    // once with the oldest. Same anchors, same steps, same cards - the only
    // difference is which edge of each card the one beside it covers, which
    // is the whole of what the option does.
    const pair = (
      fan: FanDirection, step: number, cap: number,
      places: Record<StackOrder, { x: number; y: number }>,
    ): Stack[] =>
      (['last-on-top', 'first-on-top'] as StackOrder[]).map((order) =>
        defineStack({
          id: `${fan}-${order}`,
          ...places[order],
          fan,
          step,
          maxSpread: capped ? cap : 0,
          order,
        }));

    const stacks: Stack[] = [
      ...pair('none', 0, 0, {
        'last-on-top': { x: centre(0), y: TOP_ROW },
        'first-on-top': { x: centre(1), y: TOP_ROW },
      }),
      defineStack({ id: 'deck', x: centre(5), y: TOP_ROW }),

      ...pair('right', 22, SIDE_CAP, {
        'last-on-top': { x: MARGIN + CARD_WIDTH / 2, y: RIGHT_ROW },
        'first-on-top': { x: WIDTH / 2 + CARD_WIDTH / 2, y: RIGHT_ROW },
      }),
      ...pair('left', 22, SIDE_CAP, {
        'last-on-top': { x: WIDTH / 2 - CARD_WIDTH / 2, y: LEFT_ROW },
        'first-on-top': { x: WIDTH - MARGIN - CARD_WIDTH / 2, y: LEFT_ROW },
      }),
      ...pair('down', 26, DOWN_CAP, {
        'last-on-top': { x: centre(0), y: COLUMN_TOP + CARD_HEIGHT / 2 },
        'first-on-top': { x: centre(1), y: COLUMN_TOP + CARD_HEIGHT / 2 },
      }),
      ...pair('up', 26, DOWN_CAP, {
        'last-on-top': { x: centre(4), y: UP_FOOT },
        'first-on-top': { x: centre(5), y: UP_FOOT },
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

  /** Which direction each pile fans, and which end of it is drawn in front. */
  private printLabels(): void {
    for (const label of this.labels.splice(0)) label.destroy();

    const say = (x: number, y: number, text: string, colour: string, size = '10px') => {
      const item = this.add.text(x, y, text, {
        fontFamily: DISPLAY_FONT, fontSize: size, color: colour,
      }).setOrigin(0.5, 0.5).setDepth(0);
      this.labels.push(item);
      return item;
    };

    // Over each pile, only which end of it is in front. Short, because two
    // piles in a pair are 76 units apart and "squared · first on top" is
    // ninety units of text - the first attempt at this had every label
    // overlapping its neighbour and the outer ones running off the board.
    for (const { stack } of this.piles) {
      if (stack.id === 'deck') {
        say(stack.x, stack.y - CARD_HEIGHT / 2 - 9, 'deck', '#7fae86');
        continue;
      }
      const y = stack.fan === 'up'
        ? stack.y + CARD_HEIGHT / 2 + 9
        : stack.y - CARD_HEIGHT / 2 - 9;
      say(stack.x, y, stack.order === 'last-on-top' ? 'last' : 'first', '#cfead0');
    }

    // And the direction once per row, in whatever space that row has left.
    say(centre(3), TOP_ROW, 'SQUARED', '#7fae86', '11px');
    say(WIDTH - 56, RIGHT_ROW, 'RIGHT', '#7fae86', '11px');
    say(56, LEFT_ROW, 'LEFT', '#7fae86', '11px');
    say(WIDTH / 2 - 20, COLUMN_TOP + 60, 'DOWN', '#7fae86', '11px');
    say(WIDTH / 2 - 20, UP_FOOT - 60, 'UP', '#7fae86', '11px');
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

    // Both halves of every pair get the same number of cards, because the
    // pair only means anything if the two piles are otherwise identical. Five
    // or six is past every cap above, so each one squeezes.
    for (const order of ['last-on-top', 'first-on-top']) {
      give(`none-${order}`, 3);        // 6 across the pair
      give(`right-${order}`, 5);       // 10
      give(`left-${order}`, 5);        // 10
      give(`down-${order}`, 6);        // 12
      give(`up-${order}`, 6);          // 12
    }
    give('deck', deck.length - next);  // and the last two, squared

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
    // Where each card goes, and which of them is drawn over the others. The
    // positions are the same whichever order the stack is in; only these
    // depths change, and they are the whole difference on screen.
    const depth = stackDepths(pile.stack, pile.cards.length);
    pile.cards.forEach((view, i) => {
      view.setPosition(at[i].x, at[i].y);
      view.setDepth(1 + depth[i]);
    });
  }

  private layOutAll(): void {
    for (const pile of this.piles) this.layOut(pile);
  }

  // --- dragging ------------------------------------------------------------

  private pickUp(view: CardView): void {
    const from = this.piles.find((pile) => pile.cards.includes(view));
    if (!from) return;
    // The card drawn in front, which on a first-on-top stack is the *oldest*
    // one rather than the newest. That is the card a finger has actually
    // landed on, and picking up anything else would mean dragging a card out
    // from under the pile covering it.
    const front = topCardIndex(from.stack, from.cards.length);
    if (front === undefined || from.cards[front] !== view) return;
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
