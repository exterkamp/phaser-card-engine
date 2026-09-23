import Phaser from 'phaser';
import {
  Card,
  DECK_THEMES,
  DeckTheme,
  DISPLAY_FONT,
  Rank,
  Suit,
  buildDeck,
  cardFaceMetrics,
} from 'phaser-card-engine';
import { CardSprite, boardRoot, createBoard, preloadCardArt } from 'phaser-card-engine/phaser';

// The same card at seven sizes.
//
// A card is drawn at whatever width it is asked for rather than drawn once
// and scaled, which is the whole reason cardFaceMetrics takes a width: the
// index is rasterised for the size it is shown at. Scaling a 24-unit card up
// to 160 gives you a blurred 24-unit card.
const WIDTH = 480;
const HEIGHT = 560;

// A hand's worth of widths, from "ten columns on a phone" to "one card filling
// the screen". 37 is the size Seahaven's ten columns come out at on a 412-pixel
// phone, and 51 is Klondike's on the same screen - the two ends of what the
// games this came from actually ask for.
const WIDTHS = [24, 37, 51, 60, 84, 120, 168];

// Three cards worth showing at every size: a number card, a court, and a ten,
// whose index is half as wide again as any other and is what the suit beside
// it has to be placed against.
const SAMPLES: { rank: Rank; suit: Suit }[] = [
  { rank: '7', suit: 'hearts' },
  { rank: 'K', suit: 'spades' },
  { rank: '10', suit: 'diamonds' },
];

class SizesDemo extends Phaser.Scene {
  private theme: DeckTheme = 'press';
  private faceUp = true;
  private sample = 0;
  private cards: CardSprite[] = [];
  private labels: Phaser.GameObjects.Text[] = [];
  private root!: Phaser.GameObjects.Container;

  preload(): void {
    preloadCardArt(this, { themes: DECK_THEMES });
  }

  create(): void {
    this.cameras.main.setBackgroundColor('#13463a');
    this.root = boardRoot(this);
    this.lay();

    document.getElementById('flip')?.addEventListener('click', () => {
      this.faceUp = !this.faceUp;
      for (const card of this.cards) card.setFaceUp(this.faceUp);
      this.report();
    });
    document.getElementById('theme')?.addEventListener('click', () => {
      this.theme = DECK_THEMES[(DECK_THEMES.indexOf(this.theme) + 1) % DECK_THEMES.length];
      this.lay();
    });
    document.getElementById('ranks')?.addEventListener('click', () => {
      this.sample = (this.sample + 1) % SAMPLES.length;
      this.lay();
    });
  }

  private lay(): void {
    for (const card of this.cards) card.destroy();
    for (const label of this.labels) label.destroy();
    this.cards = [];
    this.labels = [];

    const { rank, suit } = SAMPLES[this.sample];
    const face = buildDeck().find((c) => c.rank === rank && c.suit === suit)!;

    // Packed into as many rows as it takes. Seven cards from 24 to 168 come
    // to 604 units on a 480-unit board, and the first version of this laid
    // them in one line and quietly cut the ends off - so the widths decide
    // the rows rather than the other way round.
    const gap = 12;
    const margin = 14;
    const rows: number[][] = [[]];
    let used = 0;
    for (const width of WIDTHS) {
      const extra = used ? gap + width : width;
      if (used + extra > WIDTH - 2 * margin && rows[rows.length - 1].length) {
        rows.push([]);
        used = width;
      } else {
        used += extra;
      }
      rows[rows.length - 1].push(width);
    }

    // Each row sits on its own baseline, and a row is as tall as its tallest
    // card - so a row of small cards takes the room a row of small cards
    // needs and no more.
    const heights = rows.map((row) => cardFaceMetrics(Math.max(...row)).height);
    const spare = HEIGHT - heights.reduce((sum, h) => sum + h + 26, 0);
    let top = Math.max(20, spare / 2);

    for (const [index, row] of rows.entries()) {
      const total = row.reduce((sum, w) => sum + w, 0) + gap * (row.length - 1);
      const baseline = top + heights[index];
      let x = (WIDTH - total) / 2;

      for (const width of row) {
        const metrics = cardFaceMetrics(width);
        const card: Card = { ...face, faceUp: this.faceUp };
        // No pixelRatio here: the card takes the board's, which is what it
        // will actually be shown at.
        const sprite = new CardSprite(this, card, { width, theme: this.theme });
        this.root.add(sprite);
        // On the row's baseline, so the sizes are read against each other.
        sprite.setPosition(x + width / 2, baseline - metrics.height / 2);
        this.cards.push(sprite);

        const label = this.add.text(x + width / 2, baseline + 8, String(width), {
          fontFamily: DISPLAY_FONT, fontSize: '10px', color: '#7fae86',
          resolution: window.devicePixelRatio || 2,
        }).setOrigin(0.5, 0);
        this.root.add(label);
        this.labels.push(label);
        x += width + gap;
      }
      top = baseline + 26;
    }

    this.report();
  }

  private report(): void {
    const note = document.getElementById('note');
    if (!note) return;
    const { rank, suit } = SAMPLES[this.sample];
    const small = cardFaceMetrics(WIDTHS[0]);
    const large = cardFaceMetrics(WIDTHS[WIDTHS.length - 1]);
    note.textContent =
      `${rank} of ${suit}, ${this.theme} deck, ${this.faceUp ? 'face up' : 'face down'}. `
      + `The index is ${small.index.fontSize.toFixed(1)} units at ${WIDTHS[0]} wide and `
      + `${large.index.fontSize.toFixed(1)} at ${WIDTHS[WIDTHS.length - 1]}, `
      + `and a fanned pile of each would need to show ${small.peek.toFixed(1)} and `
      + `${large.peek.toFixed(1)} units to keep it readable.`;
  }
}

const game = createBoard({
  parent: 'board',
  width: WIDTH,
  height: HEIGHT,
  backgroundColor: '#13463a',
  scene: SizesDemo,
});

(window as unknown as { __game: Phaser.Game }).__game = game;
