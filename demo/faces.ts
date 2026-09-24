import Phaser from 'phaser';
import './serve';
import {
  BODY_FONT, COURT_PALETTES, Card, CourtPalette, DECK_STOCK, DECK_THEMES,
  DECK_THEME_LABELS, DISPLAY_FONT, DeckTheme, FACE_STYLES, FaceStyle, Rank,
  SUITS, Suit, cardFaceMetrics, colorCss,
} from 'phaser-card-engine';
import {
  CardSprite, boardRoot, createBoard, preloadCardArt, renderCourts,
} from 'phaser-card-engine/phaser';

// Three layouts, side by side, at a size you can drag.
//
// The comparison is the demo. Any one of these faces looks fine on its own -
// what you cannot see from one is that the mobile face is the only one of the
// three that survives being shrunk, or that it is the only one that has a
// right way up. Four ranks, because four is what it takes to show the
// argument: an ace, a seven (the arrangement nobody draws correctly from
// memory), a ten (the most crowded), and a court.
const WIDTH = 480;
const HEIGHT = 660;

const RANKS: Rank[] = ['A', '7', '10', 'K'];
const HEAD_Y = 30;

class Faces extends Phaser.Scene {
  private root!: Phaser.GameObjects.Container;
  private cards: CardSprite[] = [];
  private labels: Phaser.GameObjects.Text[] = [];
  private width = 92;
  private suit: Suit = 'spades';
  private theme: DeckTheme = 'press';

  preload(): void {
    preloadCardArt(this, { themes: [...DECK_THEMES] });
  }

  create(): void {
    this.root = boardRoot(this);
    this.paint();

    document.getElementById('size')?.addEventListener('input', (event) => {
      this.width = Number((event.target as HTMLInputElement).value);
      this.lay();
    });
    document.getElementById('suit')?.addEventListener('click', () => {
      this.suit = SUITS[(SUITS.indexOf(this.suit) + 1) % SUITS.length];
      this.lay();
    });
    document.getElementById('deck')?.addEventListener('click', () => {
      this.theme = DECK_THEMES[(DECK_THEMES.indexOf(this.theme) + 1) % DECK_THEMES.length];
      this.paint();
    });
  }

  /** Re-renders the courts for the chosen deck, then re-lays. */
  private paint(): void {
    void renderCourts(this, courtStart(this.theme)).then(() => this.lay());
    this.lay();
  }

  private lay(): void {
    for (const card of this.cards) card.destroy();
    for (const label of this.labels) label.destroy();
    this.cards = [];
    this.labels = [];

    const height = this.width / (5 / 7);
    const column = WIDTH / FACE_STYLES.length;
    const rowGap = Math.max(6, this.width * 0.09);
    const top = HEAD_Y + 26 + height / 2;

    FACE_STYLES.forEach((face, col) => {
      const x = column * (col + 0.5);
      this.say(x, HEAD_Y, label(face), '#fdfdfd', 11);
      // The one number that says what each face is trading: how much of a
      // card has to show before its index can be read. It is the number a
      // fanned pile's step is chosen against.
      const peek = cardFaceMetrics(this.width, face).peek;
      this.say(x, HEAD_Y + 13, `peek ${peek.toFixed(1)}`, '#7fae86', 9);

      RANKS.forEach((rank, row) => {
        const card: Card = {
          id: `${face}-${rank}`, rank, suit: this.suit, faceUp: true,
        };
        const sprite = new CardSprite(this, card, {
          width: this.width,
          face,
          theme: this.theme,
          backColor: DECK_STOCK[this.theme].back,
        });
        sprite.setPosition(x, top + row * (height + rowGap));
        this.root.add(sprite);
        this.cards.push(sprite);
      });
    });

    this.note(`${DECK_THEME_LABELS[this.theme]}, ${this.suit}, `
      + `${this.width} units across.`);
  }

  private say(x: number, y: number, text: string, color: string, size: number): void {
    const label = this.add.text(x, y, text, {
      fontFamily: size > 10 ? DISPLAY_FONT : BODY_FONT,
      fontSize: `${size}px`,
      color,
    }).setOrigin(0.5, 0.5);
    this.root.add(label);
    this.labels.push(label);
  }

  private note(text: string): void {
    const note = document.getElementById('note');
    if (note) note.textContent = text;
  }
}

/** A deck's court palette, printed on the deck's own stock. */
const courtStart = (theme: DeckTheme): CourtPalette => ({
  ...COURT_PALETTES[theme],
  paper: COURT_PALETTES[theme].paper ?? colorCss(DECK_STOCK[theme].paper),
  highlight: COURT_PALETTES[theme].highlight ?? '#fdfdfd',
});

const label = (face: FaceStyle) =>
  face === 'jumbo' ? 'Jumbo index' : face[0].toUpperCase() + face.slice(1);

const game = createBoard({
  parent: 'board',
  width: WIDTH,
  height: HEIGHT,
  backgroundColor: '#13463a',
  scene: Faces,
});

(window as unknown as { __game: Phaser.Game }).__game = game;
