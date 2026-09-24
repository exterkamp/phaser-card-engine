import Phaser from 'phaser';
import './serve';
import {
  Card, DECK_STOCK, DECK_THEMES, DECK_THEME_LABELS, DeckTheme,
  defineStack, shuffledDeck, stackPositions,
} from 'phaser-card-engine';
import {
  CardSprite, TuckBox, boardRoot, createBoard, orderStack, preloadCardArt,
  riffleShuffle, supportsTuckBox,
} from 'phaser-card-engine/phaser';

// A deck, in the box it came in.
//
// The box is the first object in this package that is not flat, and the demo
// is built around the one thing that makes that worth doing: it turns. A card
// looks the same from every angle by construction; a box does not, and the
// slow rotation is there so you can see that the back and the sides are
// really there rather than painted on the front.
//
// The sequence at the bottom - turn to face, open, lift out, shuffle - is the
// whole feature. Everything above it is scenery.
const WIDTH = 480;
const HEIGHT = 560;

const CARD_W = 96;
const BOX_AT = { x: WIDTH / 2, y: 210 };
/** Where the deck lands once it is out and the shuffle can have it. */
const DEAL_AT = { x: WIDTH / 2, y: 392 };

/** Slow enough to read as a turntable rather than as a thing being spun. */
const SPIN = 0.52;
/** How far the box leans back, so you are looking slightly down into it. */
const TILT = -0.30;

class BoxTable extends Phaser.Scene {
  private root!: Phaser.GameObjects.Container;
  private box?: TuckBox;
  private cards: CardSprite[] = [];
  private theme: DeckTheme = 'press';
  private busy = false;
  private readonly stack = defineStack({ id: 'deck', ...DEAL_AT });

  preload(): void {
    preloadCardArt(this, { themes: [...DECK_THEMES] });
  }

  create(): void {
    this.root = boardRoot(this);
    if (!supportsTuckBox(this)) {
      this.note('This renderer has no WebGL, and a mesh needs it. '
        + 'The box is the one thing in this package that cannot fall back.');
      return;
    }
    this.build();

    on('open', () => void this.openAndDeal());
    on('reset', () => this.build());
    on('deck', () => {
      const next = (DECK_THEMES.indexOf(this.theme) + 1) % DECK_THEMES.length;
      this.theme = DECK_THEMES[next];
      this.build();
    });
    slide('lid', (v) => { if (this.box && !this.busy) this.box.open = v / 100; });
    slide('turn', (v) => {
      if (!this.box || this.busy) return;
      this.box.spin = 0;
      this.box.turn = (v / 180) * Math.PI;
    });
  }

  override update(_time: number, delta: number): void {
    this.box?.step(delta);
  }

  private build(): void {
    this.busy = false;
    this.box?.destroy();
    for (const card of this.cards) card.destroy();
    this.cards = [];

    this.box = new TuckBox(this, BOX_AT.x, BOX_AT.y, {
      cardWidth: CARD_W,
      art: { theme: this.theme, backColor: DECK_STOCK[this.theme].back },
    });
    this.box.tilt = TILT;
    this.box.spin = SPIN;
    set('lid', 0);
    this.note(`${DECK_THEME_LABELS[this.theme]}, sealed. Fifty-two inside.`);
  }

  /**
   * The whole sequence, as four beats.
   *
   * Each one waits for the last rather than being timed against it, because a
   * lid that is still moving when the deck starts to rise is a deck coming
   * out through a lid.
   */
  private async openAndDeal(): Promise<void> {
    const box = this.box;
    if (!box || this.busy) return;
    this.busy = true;

    // Square to the camera. It has been turning, so it is at some arbitrary
    // angle: the shortest way round to facing is whichever way it happens to
    // be going.
    box.spin = 0;
    this.note('Turning it to face you.');
    await this.turnTo(box, Math.round(box.turn / (Math.PI * 2)) * Math.PI * 2, 620);

    // Two beats rather than one, because they are two things. The lid is the
    // first 55% of `open` and the deck rises over the rest - see `deckRise` -
    // so tweening straight through squeezes the deck coming out into the last
    // third of a second and it is over before it reads.
    this.note('The lid hinges at the back; the tab comes out of the front.');
    await this.tween(box, 0, 0.55, 620, 'Sine.easeInOut');

    this.note('And the deck lifts out.');
    await this.tween(box, 0.55, 1, 900, 'Cubic.easeOut');
    await this.pause(160);

    // The block of cards becomes fifty-two real ones, at the place the block
    // had got to. `deckCentre` asks the mesh where its own vertices ended up
    // rather than working the projection out a second time.
    const from = box.deckCentre();
    this.handOver(from);
    // The box stays. It is an open, empty box now, which is what it should
    // be - hiding it would leave the cards having come from nowhere.
    box.showDeck(false);
    set('lid', 100);

    this.note('Fifty-two cards, and a riffle.');
    await this.slideTo(from, DEAL_AT, 420);
    await riffleShuffle(this, this.root, this.cards, this.stack, { rounds: 2 });
    orderStack(this.root, this.cards, this.stack, 0);

    this.note('Shuffled. "Put it back" seals a new one.');
    this.busy = false;
  }

  /** Real cards, stacked where the block was. */
  private handOver(at: { x: number; y: number }): void {
    this.cards = shuffledDeck().map((card: Card, i) => {
      const sprite = new CardSprite(this, { ...card, faceUp: false }, {
        width: CARD_W, theme: this.theme, backColor: DECK_STOCK[this.theme].back,
      });
      sprite.setPosition(at.x, at.y - i * 0.16);
      sprite.setDepth(i);
      this.root.add(sprite);
      return sprite;
    });
    this.root.sort('depth');
  }

  // --- the beats -----------------------------------------------------------

  private tween(box: TuckBox, from: number, to: number, duration: number,
    ease: string): Promise<void> {
    return new Promise((resolve) => {
      this.tweens.addCounter({
        from, to, duration, ease,
        onUpdate: (t) => { box.open = t.getValue() ?? to; },
        onComplete: () => resolve(),
      });
    });
  }

  private turnTo(box: TuckBox, to: number, duration: number): Promise<void> {
    return new Promise((resolve) => {
      this.tweens.addCounter({
        from: box.turn, to, duration, ease: 'Sine.easeInOut',
        onUpdate: (t) => { box.turn = t.getValue() ?? to; },
        onComplete: () => resolve(),
      });
    });
  }

  private slideTo(from: { x: number; y: number }, to: { x: number; y: number },
    duration: number): Promise<void> {
    const at = stackPositions(this.stack, this.cards.length);
    return new Promise((resolve) => {
      this.tweens.addCounter({
        from: 0, to: 1, duration, ease: 'Cubic.easeInOut',
        onUpdate: (t) => {
          const k = t.getValue() ?? 1;
          this.cards.forEach((card, i) => {
            card.setPosition(
              from.x + (at[i].x - from.x) * k,
              (from.y - i * 0.16) + (at[i].y - (from.y - i * 0.16)) * k,
            );
          });
        },
        onComplete: () => resolve(),
      });
    });
  }

  private pause(ms: number): Promise<void> {
    return new Promise((resolve) => this.time.delayedCall(ms, resolve));
  }

  private note(text: string): void {
    const note = document.getElementById('note');
    if (note) note.textContent = text;
  }
}

const on = (id: string, run: () => void) =>
  document.getElementById(id)?.addEventListener('click', run);

const slide = (id: string, run: (value: number) => void) =>
  document.getElementById(id)?.addEventListener('input', (event) =>
    run(Number((event.target as HTMLInputElement).value)));

const set = (id: string, value: number) => {
  const el = document.getElementById(id) as HTMLInputElement | null;
  if (el) el.value = String(value);
};

const game = createBoard({
  parent: 'board',
  width: WIDTH,
  height: HEIGHT,
  backgroundColor: '#13463a',
  scene: BoxTable,
});

(window as unknown as { __game: Phaser.Game }).__game = game;
