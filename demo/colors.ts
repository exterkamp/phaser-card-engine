import Phaser from 'phaser';
import {
  BACK_COLORS,
  BODY_FONT,
  COURT_PALETTES,
  CARD_HEIGHT,
  CARD_WIDTH,
  Card,
  DEFAULT_BACK_COLOR,
  DISPLAY_FONT,
  SEAT_COLORS,
  DeckTheme,
  Suit,
  backColorCss,
  colorOf,
  defineSuits,
} from 'phaser-card-engine';
import {
  CardSprite, STANDARD_SUIT_ART, boardRoot, createBoard, defaultInk, preloadCardArt,
  renderCourt,
} from 'phaser-card-engine/phaser';

// The colors a card has, which are four different questions.
//
//   1. What color is the deck?   The fill behind the back's ink. Whose cards
//                                these are, in a game with more than one
//                                player at the table.
//   2. What is it printed in?    The ink a suit is drawn in - red, black, or
//                                gold for a suit this package has never
//                                heard of.
//   3. What does a rule think?   What `colorOf` answers when a tableau asks
//                                whether two cards alternate.
//   4. And on a court?           None of the above. A court is a painting,
//                                and its colors come out of the deck's
//                                palette - so the King of spades is not
//                                drawn in the spade's black at all.
//
// The first three come apart on exactly one card, and that card is the reason
// any of this is a function rather than a boolean: nertz's star is printed
// gold and counts as black. A package that answered `false` to isRed and let
// the caller infer black would be putting one game's rule into everybody's
// cards.
const WIDTH = 480;
const HEIGHT = 752;

// A game declaring a suit of its own, which is the whole point of the row at
// the bottom of this page.
const DECK = defineSuits({ star: { color: 'black' } });
type DeckSuit = Suit | 'star';

const BACK_NAMES = ['petrol', 'oxblood', 'moss', 'plum', 'navy', 'tobacco'];
const FACES: DeckSuit[] = ['spades', 'hearts', 'diamonds', 'clubs', 'star'];

// Three of the seven, far enough apart to make the point in one row.
const COURT_DECKS: DeckTheme[] = ['press', 'felt', 'royal'];

const BACK_W = 74;
const FACE_W = 72;
const COURT_W = 62;
const COURT_RASTER = 480;
const INK_NAMES: Record<number, string> = {
  0xcf2436: 'red', 0x1a1a1a: 'black', 0xd8a838: 'gold',
};

class Colors extends Phaser.Scene {
  private root!: Phaser.GameObjects.Container;
  private backs: CardSprite[] = [];
  private courts: CardSprite[] = [];
  private chosen = DEFAULT_BACK_COLOR;
  private marker!: Phaser.GameObjects.Graphics;

  preload(): void {
    // The star is not a playing-card suit and the package does not assume it.
    // A game that wants one says so here and in `defineSuits`, and nothing in
    // between has to be told.
    preloadCardArt(this, { suitArt: { ...STANDARD_SUIT_ART, star: 'star' } });
  }

  create(): void {
    this.cameras.main.setBackgroundColor('#13463a');
    this.root = boardRoot(this);

    this.heading(34, 'Whose deck is this?');
    this.marker = this.add.graphics();
    this.root.add(this.marker);
    this.layBacks();

    this.heading(364, 'Printed in, and counted as');
    this.layFaces();

    this.heading(574, 'And a court is none of the above');
    this.label(240, 596,
      'the same King three times. Nothing here is the spade\u2019s black.', '#7f9f88');
    this.layCourts();
    this.choose(this.chosen);

    document.getElementById('flip')?.addEventListener('click', () => {
      const up = !this.backs[0].card.faceUp;
      for (const back of this.backs) back.setFaceUp(up);
      // The fill only shows through the back. Turned over, six decks are one
      // deck - which is the thing the setting is for and the thing it is not.
      this.marker.setVisible(!up);
      this.say(`Face ${up ? 'up they are one deck' : 'down they are six'}.`);
    });
  }

  private layBacks(): void {
    BACK_COLORS.forEach((color, i) => {
      const x = 110 + (i % 3) * 130;
      const y = 96 + Math.floor(i / 3) * 144;
      const card: Card = { rank: 'A', suit: 'spades', id: `back-${i}`, faceUp: false };
      const sprite = new CardSprite(this, card, { width: BACK_W, backColor: color });
      sprite.setPosition(x, y);
      // An explicit rectangle. A Container has no texture to derive a hit
      // area from, so `setInteractive({ useHandCursor: true })` hands it a
      // config with no shape in it and silently leaves the card untappable.
      //
      // From the top-left corner, not from the middle: a CardSprite draws its
      // children around its own centre, but Phaser measures a Container's hit
      // area from its display origin, which setSize put at half the card. The
      // centred rectangle that looks right puts the hit area half a card up
      // and to the left of the card.
      const height = BACK_W / (CARD_WIDTH / CARD_HEIGHT);
      sprite.setInteractive(
        new Phaser.Geom.Rectangle(0, 0, BACK_W, height),
        Phaser.Geom.Rectangle.Contains,
      );
      sprite.on('pointerdown', () => this.choose(color));
      this.root.add(sprite);
      this.backs.push(sprite);

      this.label(x, y + 64, BACK_NAMES[i], SEAT_COLORS.includes(color) ? '#cfead0' : '#7f9f88');
      this.label(x, y + 78, backColorCss(color), '#5f7f68');
    });
    this.label(240, 332, 'the first four are the seats a four-handed game deals out', '#7f9f88');
  }

  private layFaces(): void {
    FACES.forEach((suit, i) => {
      const x = 60 + i * 90;
      const y = 436;
      const ink = defaultInk(suit);
      const card = { rank: 'A', suit, id: `face-${suit}`, faceUp: true } as Card<DeckSuit>;
      const sprite = new CardSprite<DeckSuit>(this, card, { width: FACE_W });
      sprite.setPosition(x, y);
      this.root.add(sprite);

      this.swatch(x, y + 62, ink);
      this.label(x, y + 76, INK_NAMES[ink] ?? 'other', '#cfead0');
      // What the package answers on its own, and what a game's own vocabulary
      // answers. They agree on four cards and differ on the fifth, which is
      // the one worth coloring differently.
      const loose = colorOf(suit);
      this.label(x, y + 92, `colorOf → ${loose ?? '—'}`, loose ? '#9fc4a4' : '#ffd166');
      this.label(x, y + 105, `deck → ${DECK.colorOf(suit)}`, loose ? '#9fc4a4' : '#ffd166');
    });
  }

  /**
   * The same court in three decks.
   *
   * A number card is drawn by this package - a pip in the suit's ink - and a
   * court is not. A court is a painting recolored out of `COURT_PALETTES`,
   * which is why the King of spades below is red and gold and blue and none
   * of them is the black that `colorOf('spades')` returns. The two systems
   * never meet; the full set is on the courts page.
   */
  private layCourts(): void {
    COURT_DECKS.forEach((theme, i) => {
      const palette = COURT_PALETTES[theme];
      const x = 120 + i * 120;
      const y = 652;
      const card: Card = { rank: 'K', suit: 'spades', id: `court-${theme}`, faceUp: true };
      const sprite = new CardSprite(this, card, {
        width: COURT_W, courtPalette: palette, courtWidth: COURT_RASTER,
      });
      sprite.setPosition(x, y);
      this.root.add(sprite);
      this.courts.push(sprite);

      // Not awaited: the card shows its pip until the portrait lands and
      // takes it then. Only the one card each, rather than all twelve - this
      // row needs three Kings, not three decks.
      void renderCourt(this, 'K', 'spades', palette, COURT_RASTER);

      this.label(x, y + 58, theme, '#cfead0');
      this.swatch(x - 14, y + 74, Number.parseInt(palette.ink.slice(1), 16));
      this.swatch(x, y + 74, Number.parseInt(palette.gold.slice(1), 16));
      this.swatch(x + 14, y + 74, Number.parseInt(palette.red.slice(1), 16));
    });
  }

  private choose(color: number): void {
    this.chosen = color;
    const i = BACK_COLORS.indexOf(color as (typeof BACK_COLORS)[number]);
    const x = 110 + (i % 3) * 130;
    const y = 96 + Math.floor(i / 3) * 144;
    this.marker.clear();
    this.marker.lineStyle(2, 0xffd166, 1);
    this.marker.strokeRoundedRect(x - BACK_W / 2 - 4, y - 52 - 4, BACK_W + 8, 104 + 8, 8);
    this.marker.setVisible(true);
    const seat = SEAT_COLORS.indexOf(color);
    this.say(seat >= 0
      ? `${BACK_NAMES[i]} — seat ${seat + 1}. seatColor(${seat}) is ${backColorCss(color)}.`
      : `${BACK_NAMES[i]} — ${backColorCss(color)}. Not a seat color: the last two are for a table with nobody else at it.`);
  }

  /**
   * A dot in the ink itself, ringed so it survives the felt.
   *
   * The names are drawn in a readable color rather than in the ink they
   * name, which sounds like the duller choice and is the only legible one:
   * `black` written in #1a1a1a on a dark green table is a label nobody can
   * read.
   */
  private swatch(x: number, y: number, ink: number): void {
    const dot = this.add.graphics();
    dot.fillStyle(ink, 1);
    dot.fillCircle(x, y, 5);
    dot.lineStyle(1, 0xcfead0, 0.85);
    dot.strokeCircle(x, y, 5);
    this.root.add(dot);
  }

  private heading(y: number, text: string): void {
    const label = this.add.text(240, y, text, {
      fontFamily: DISPLAY_FONT, fontSize: '13px', fontStyle: '700', color: '#fdfdfd',
    }).setOrigin(0.5);
    this.root.add(label);
  }

  private label(x: number, y: number, text: string, color: string): void {
    const item = this.add.text(x, y, text, {
      fontFamily: BODY_FONT, fontSize: '10px', color: color, align: 'center',
    }).setOrigin(0.5);
    this.root.add(item);
  }

  private say(text: string): void {
    const note = document.getElementById('note');
    if (note) note.textContent = text;
  }
}

const game = createBoard({
  parent: 'board',
  width: WIDTH,
  height: HEIGHT,
  backgroundColor: '#13463a',
  scene: Colors,
});

(window as unknown as { __game: Phaser.Game }).__game = game;

// The three answers, for the smoke checks. The page's whole claim is that
// these are three different questions, and the star is where that stops being
// a pedantic distinction: printed gold, unknown to the package, black to the
// game that declared it.
(window as unknown as { __colors: unknown }).__colors = {
  printed: Object.fromEntries(FACES.map((suit) => [suit, defaultInk(suit)])),
  loose: Object.fromEntries(FACES.map((suit) => [suit, colorOf(suit) ?? null])),
  declared: Object.fromEntries(FACES.map((suit) => [suit, DECK.colorOf(suit)])),
  // A court's colors come from the deck, not the suit: three Kings of the
  // same suit, three different sets of ink.
  courts: Object.fromEntries(COURT_DECKS.map((theme) => [theme, COURT_PALETTES[theme]])),
};
