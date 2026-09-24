import Phaser from 'phaser';
import {
  BACK_COLORS,
  BODY_FONT,
  CARD_HEIGHT,
  CARD_WIDTH,
  Card,
  DEFAULT_BACK_COLOR,
  DISPLAY_FONT,
  SEAT_COLORS,
  Suit,
  backColorCss,
  colourOf,
  defineSuits,
} from 'phaser-card-engine';
import {
  CardSprite, STANDARD_SUIT_ART, boardRoot, createBoard, defaultInk, preloadCardArt,
} from 'phaser-card-engine/phaser';

// The three colours a card has, which are three different questions.
//
//   1. What colour is the deck?   The fill behind the back's ink. Whose cards
//                                 these are, in a game with more than one
//                                 player at the table.
//   2. What is it printed in?     The ink a suit is drawn in - red, black, or
//                                 gold for a suit this package has never
//                                 heard of.
//   3. What does the rule think?  What `colourOf` answers when a tableau asks
//                                 whether two cards alternate.
//
// They come apart on exactly one card, and that card is the reason any of
// this is a function rather than a boolean: nertz's star is printed gold and
// counts as black. A package that answered `false` to isRed and let the
// caller infer black would be putting one game's rule into everybody's cards.
const WIDTH = 480;
const HEIGHT = 556;

// A game declaring a suit of its own, which is the whole point of the row at
// the bottom of this page.
const DECK = defineSuits({ star: { colour: 'black' } });
type DeckSuit = Suit | 'star';

const BACK_NAMES = ['petrol', 'oxblood', 'moss', 'plum', 'navy', 'tobacco'];
const FACES: DeckSuit[] = ['spades', 'hearts', 'diamonds', 'clubs', 'star'];

const BACK_W = 74;
const FACE_W = 72;
const INK_NAMES: Record<number, string> = {
  0xcf2436: 'red', 0x1a1a1a: 'black', 0xd8a838: 'gold',
};

class Colours extends Phaser.Scene {
  private root!: Phaser.GameObjects.Container;
  private backs: CardSprite[] = [];
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
    BACK_COLORS.forEach((colour, i) => {
      const x = 110 + (i % 3) * 130;
      const y = 96 + Math.floor(i / 3) * 144;
      const card: Card = { rank: 'A', suit: 'spades', id: `back-${i}`, faceUp: false };
      const sprite = new CardSprite(this, card, { width: BACK_W, backColor: colour });
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
      sprite.on('pointerdown', () => this.choose(colour));
      this.root.add(sprite);
      this.backs.push(sprite);

      this.label(x, y + 64, BACK_NAMES[i], SEAT_COLORS.includes(colour) ? '#cfead0' : '#7f9f88');
      this.label(x, y + 78, backColorCss(colour), '#5f7f68');
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
      // the one worth colouring differently.
      const loose = colourOf(suit);
      this.label(x, y + 92, `colourOf → ${loose ?? '—'}`, loose ? '#9fc4a4' : '#ffd166');
      this.label(x, y + 105, `deck → ${DECK.colourOf(suit)}`, loose ? '#9fc4a4' : '#ffd166');
    });
  }

  private choose(colour: number): void {
    this.chosen = colour;
    const i = BACK_COLORS.indexOf(colour as (typeof BACK_COLORS)[number]);
    const x = 110 + (i % 3) * 130;
    const y = 96 + Math.floor(i / 3) * 144;
    this.marker.clear();
    this.marker.lineStyle(2, 0xffd166, 1);
    this.marker.strokeRoundedRect(x - BACK_W / 2 - 4, y - 52 - 4, BACK_W + 8, 104 + 8, 8);
    this.marker.setVisible(true);
    const seat = SEAT_COLORS.indexOf(colour);
    this.say(seat >= 0
      ? `${BACK_NAMES[i]} — seat ${seat + 1}. seatColor(${seat}) is ${backColorCss(colour)}.`
      : `${BACK_NAMES[i]} — ${backColorCss(colour)}. Not a seat colour: the last two are for a table with nobody else at it.`);
  }

  /**
   * A dot in the ink itself, ringed so it survives the felt.
   *
   * The names are drawn in a readable colour rather than in the ink they
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

  private label(x: number, y: number, text: string, colour: string): void {
    const item = this.add.text(x, y, text, {
      fontFamily: BODY_FONT, fontSize: '10px', color: colour, align: 'center',
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
  scene: Colours,
});

(window as unknown as { __game: Phaser.Game }).__game = game;

// The three answers, for the smoke checks. The page's whole claim is that
// these are three different questions, and the star is where that stops being
// a pedantic distinction: printed gold, unknown to the package, black to the
// game that declared it.
(window as unknown as { __colours: unknown }).__colours = {
  printed: Object.fromEntries(FACES.map((suit) => [suit, defaultInk(suit)])),
  loose: Object.fromEntries(FACES.map((suit) => [suit, colourOf(suit) ?? null])),
  declared: Object.fromEntries(FACES.map((suit) => [suit, DECK.colourOf(suit)])),
};
