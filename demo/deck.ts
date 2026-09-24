import Phaser from 'phaser';
import {
  BACK_COLORS,
  BODY_FONT,
  COURT_PALETTES,
  Card,
  CourtPalette,
  DECK_THEMES,
  DECK_THEME_LABELS,
  DEFAULT_BACK_COLOR,
  DISPLAY_FONT,
  DeckTheme,
  RANKS,
  Rank,
  SUITS,
  Suit,
  colorCss,
  colorOf,
  cssColor,
  defaultInk,
  defineStack,
  isCourtRank,
  stackPositions,
} from 'phaser-card-engine';
import {
  CardSprite, boardRoot, createBoard, orderStack, preloadCardArt, renderCourt,
} from 'phaser-card-engine/phaser';

// A deck editor.
//
// Every color this package lets a game set, in one place, over a deck you can
// walk through a rank at a time. There are four separate color systems on
// screen and the point of putting them together is that they are separate:
//
//   the stock      the fill behind the face, which the courts print on too
//   the suit inks  what a pip is drawn in, per pair of suits
//   the back       the fill the back's ink is printed over, and which design
//   the court      a palette of its own, which the suit inks never touch,
//                  and which keeps the stock and the figure's own whites
//                  apart - skin and linen do not follow a dark card down
//
// Nothing here is a rule. `colorOf('hearts')` is `'red'` whatever the hearts
// are printed in, and the readout under each card says so.
const WIDTH = 480;
const HEIGHT = 322;

const COLUMN = 92;
const CARD_W = 86;
const ROW_Y = 172;
const COURT_RASTER = 480;

/** Two face-down under one face-up, so a column shows both sides at once. */
const PILE_DEEP = 3;

interface Editable {
  paper: number;
  redInk: number;
  blackInk: number;
  backColor: number;
  back: DeckTheme;
  court: CourtPalette;
}

function defaults(): Editable {
  return {
    paper: 0xfdfdfd,
    redInk: defaultInk('hearts'),
    blackInk: defaultInk('spades'),
    backColor: DEFAULT_BACK_COLOR,
    back: 'press',
    court: { ...COURT_PALETTES.press, highlight: '#fdfdfd' },
  };
}

class DeckEditor extends Phaser.Scene {
  private root!: Phaser.GameObjects.Container;
  private deck: Editable = defaults();
  private rank = 0;
  private cards: CardSprite[] = [];

  preload(): void {
    // Every back design, because picking one is half of what this page is.
    preloadCardArt(this, { themes: DECK_THEMES });
  }

  create(): void {
    this.cameras.main.setBackgroundColor('#13463a');
    this.root = boardRoot(this);
    this.wire();
    this.build();
  }

  // --- the board ----------------------------------------------------------

  /**
   * Every card, from scratch.
   *
   * Paper and the inks are baked into textures rather than set on a live
   * sprite, so changing one is a rebuild. Twenty sprites is cheap, and a
   * texture for a combination already seen is still in the manager - going
   * back to a color you have tried before costs nothing.
   */
  private build(): void {
    this.root.removeAll(true);
    this.cards = [];

    const rank = RANKS[this.rank] as Rank;
    // The courts are rendered, not loaded. Only the four on screen, not all
    // twelve, and not awaited - a card drawn before its portrait lands shows
    // its pip and takes the portrait when it arrives.
    if (isCourtRank(rank)) {
      for (const suit of SUITS) {
        void renderCourt(this, rank, suit, this.court(), COURT_RASTER);
      }
    }

    this.column(0, undefined);
    SUITS.forEach((suit, i) => this.column(i + 1, { suit, rank }));
    this.caption(rank);
  }

  /**
   * One pile. The first column is the deck, face down; the rest are a suit
   * each with its top card turned over.
   */
  private column(index: number, face: { suit: Suit; rank: Rank } | undefined): void {
    const x = 56 + index * COLUMN;
    const stack = defineStack({ id: `pile-${index}`, x, y: ROW_Y, fan: 'down', step: 5 });
    const places = stackPositions(stack, PILE_DEEP);
    const sprites: CardSprite[] = [];

    places.forEach((place, depth) => {
      const top = depth === places.length - 1;
      const card: Card = top && face
        ? { rank: face.rank, suit: face.suit, id: `${face.suit}-${face.rank}`, faceUp: true }
        : { rank: 'A', suit: 'spades', id: `under-${index}-${depth}`, faceUp: false };
      const sprite = new CardSprite(this, card, {
        width: CARD_W,
        paper: this.deck.paper,
        ink: this.ink(),
        backColor: this.deck.backColor,
        theme: this.deck.back,
        courtPalette: this.court(),
        courtWidth: COURT_RASTER,
      });
      sprite.setPosition(place.x, place.y);
      this.root.add(sprite);
      sprites.push(sprite);
      this.cards.push(sprite);
    });

    // Depth is not paint order inside a container - the list is. Without
    // this the bottom of the pile draws over its own top card.
    orderStack(this.root, sprites, stack);

    if (face) {
      const loose = colorOf(face.suit);
      this.label(x, ROW_Y + 88, face.suit, '#cfead0');
      this.label(x, ROW_Y + 101, `counts as ${loose}`, '#7f9f88');
    } else {
      this.label(x, ROW_Y + 88, 'the deck', '#cfead0');
      this.label(x, ROW_Y + 101, DECK_THEME_LABELS[this.deck.back].toLowerCase(), '#7f9f88');
    }
  }

  private caption(rank: Rank): void {
    const text = this.add.text(240, 44, rank === '10' ? 'Ten' : rank, {
      fontFamily: DISPLAY_FONT, fontSize: '22px', fontStyle: '700', color: '#fdfdfd',
    }).setOrigin(0.5);
    this.root.add(text);
    this.label(240, 70,
      isCourtRank(rank) ? 'a court: its colors come from the palette, not the suit'
        : 'a pip, drawn in the suit’s own ink', '#7f9f88');
  }

  private label(x: number, y: number, text: string, color: string): void {
    const item = this.add.text(x, y, text, {
      fontFamily: BODY_FONT, fontSize: '10px', color, align: 'center',
    }).setOrigin(0.5);
    this.root.add(item);
  }

  // --- what the cards are made of ----------------------------------------

  /** The court palette, printed on the card's own stock. */
  private court(): CourtPalette {
    return { ...this.deck.court, paper: colorCss(this.deck.paper) };
  }

  /** What each suit is printed in. Not what any of them counts as. */
  private ink(): Record<string, number> {
    return {
      hearts: this.deck.redInk, diamonds: this.deck.redInk,
      spades: this.deck.blackInk, clubs: this.deck.blackInk,
    };
  }

  // --- controls -----------------------------------------------------------

  private step(by: number): void {
    this.rank = (this.rank + by + RANKS.length) % RANKS.length;
    this.build();
    this.report();
  }

  private wire(): void {
    const on = (id: string, event: string, run: (el: HTMLInputElement) => void) => {
      const el = document.getElementById(id) as HTMLInputElement | null;
      el?.addEventListener(event, () => run(el));
      return el;
    };

    // Colors, on `change` rather than `input`: a colour wheel fires a hundred
    // of those and each one is twenty cards and maybe four portraits.
    on('paper', 'change', (el) => this.set({ paper: cssColor(el.value) }));
    on('redink', 'change', (el) => this.set({ redInk: cssColor(el.value) }));
    on('blackink', 'change', (el) => this.set({ blackInk: cssColor(el.value) }));
    on('backcolor', 'change', (el) => this.set({ backColor: cssColor(el.value) }));
    for (const role of ['ink', 'gold', 'red', 'highlight'] as const) {
      on(`court-${role}`, 'change', (el) =>
        this.set({ court: { ...this.deck.court, [role]: el.value } }));
    }

    const backs = document.getElementById('backdesign') as HTMLSelectElement | null;
    if (backs) {
      for (const theme of DECK_THEMES) {
        backs.append(new Option(DECK_THEME_LABELS[theme], theme));
      }
      backs.value = this.deck.back;
      backs.addEventListener('change', () => this.set({ back: backs.value as DeckTheme }));
    }

    const preset = document.getElementById('courtpreset') as HTMLSelectElement | null;
    if (preset) {
      for (const theme of DECK_THEMES) {
        preset.append(new Option(DECK_THEME_LABELS[theme], theme));
      }
      preset.value = 'press';
      preset.addEventListener('change', () => {
        if (!preset.value) return;
        this.set({
          court: { ...COURT_PALETTES[preset.value as DeckTheme], highlight: '#fdfdfd' },
        });
      });
    }

    document.getElementById('prev')?.addEventListener('click', () => this.step(-1));
    document.getElementById('next')?.addEventListener('click', () => this.step(1));
    document.getElementById('reset')?.addEventListener('click', () => {
      this.deck = defaults();
      this.showControls();
      this.build();
      this.report();
    });
    document.getElementById('surprise')?.addEventListener('click', () => this.surprise());
    document.getElementById('deuter')?.addEventListener('click', (event) => {
      const board = document.getElementById('board');
      const isOn = board?.classList.toggle('deuter') ?? false;
      (event.currentTarget as HTMLElement).classList.toggle('on', isOn);
    });

    this.showControls();
    this.report();
  }

  private set(change: Partial<Editable>): void {
    this.deck = { ...this.deck, ...change };
    this.showControls();
    this.build();
    this.report();
  }

  private surprise(): void {
    const base = Math.floor(Math.random() * 360);
    // A dark deck one time in four, because it is the case that shows the
    // court's highlight doing its job and the case a light-only button would
    // never produce.
    const dark = Math.random() < 0.25;
    const stockLight = dark ? 8 + Math.random() * 8 : 88 + Math.random() * 10;
    this.deck = {
      paper: cssColor(hsl(base, dark ? 22 : 30, stockLight)),
      // The inks have to read against whatever stock was just chosen, which
      // means flipping them for a dark one rather than hoping.
      redInk: cssColor(hsl(base, 62, dark ? 64 : 42)),
      blackInk: cssColor(hsl((base + 190) % 360, 45, dark ? 78 : 24)),
      backColor: BACK_COLORS[Math.floor(Math.random() * BACK_COLORS.length)],
      back: DECK_THEMES[Math.floor(Math.random() * DECK_THEMES.length)],
      // Ink dark, field light, garment between - the three have to differ in
      // lightness and not only in hue, or two of them merge into one shape at
      // the size a card is played at.
      court: {
        ink: hsl((base + 210) % 360, 52, 28),
        gold: hsl((base + 60) % 360, 62, 66),
        red: hsl((base + 320) % 360, 56, 46),
        // The figure's own whites stay pale whatever the stock does. The
        // court's line work and black are drawn against this, not against
        // the card.
        highlight: hsl(base, 18, 94),
      },
    };
    this.showControls();
    this.build();
    this.report();
  }

  private showControls(): void {
    const put = (id: string, value: string) => {
      const el = document.getElementById(id) as HTMLInputElement | null;
      if (el) el.value = value;
      const hex = document.getElementById(`${id}-hex`);
      if (hex) hex.textContent = value;
    };
    put('paper', colorCss(this.deck.paper));
    put('redink', colorCss(this.deck.redInk));
    put('blackink', colorCss(this.deck.blackInk));
    put('backcolor', colorCss(this.deck.backColor));
    put('court-ink', this.deck.court.ink);
    put('court-gold', this.deck.court.gold);
    put('court-red', this.deck.court.red);
    put('court-highlight', this.deck.court.highlight ?? '#fdfdfd');
    const backs = document.getElementById('backdesign') as HTMLSelectElement | null;
    if (backs) backs.value = this.deck.back;
    const preset = document.getElementById('courtpreset') as HTMLSelectElement | null;
    if (preset) {
      const match = DECK_THEMES.find((theme) => {
        const p = COURT_PALETTES[theme];
        return p.ink === this.deck.court.ink && p.gold === this.deck.court.gold
          && p.red === this.deck.court.red
          && (this.deck.court.highlight ?? '#fdfdfd') === '#fdfdfd';
      });
      preset.value = match ?? '';
    }
  }

  /** The deck as the style object that would produce it. */
  private report(): void {
    const out = document.getElementById('style');
    if (!out) return;
    const ink = this.ink();
    out.textContent = `{
  paper: ${colorCss(this.deck.paper).replace('#', '0x')},
  backColor: ${colorCss(this.deck.backColor).replace('#', '0x')},
  theme: '${this.deck.back}',
  ink: {
    hearts: ${colorCss(ink.hearts).replace('#', '0x')}, diamonds: ${colorCss(ink.diamonds).replace('#', '0x')},
    spades: ${colorCss(ink.spades).replace('#', '0x')}, clubs: ${colorCss(ink.clubs).replace('#', '0x')},
  },
  courtPalette: {
    ink: '${this.deck.court.ink}', gold: '${this.deck.court.gold}',
    red: '${this.deck.court.red}', paper: '${colorCss(this.deck.paper)}',
    highlight: '${this.deck.court.highlight ?? '#fdfdfd'}',
  },
}`;
  }
}

/** Hex, because an <input type=color> will not take anything else. */
function hsl(h: number, s: number, l: number): string {
  const a = (s / 100) * Math.min(l / 100, 1 - l / 100);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const v = l / 100 - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(255 * v).toString(16).padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

const game = createBoard({
  parent: 'board',
  width: WIDTH,
  height: HEIGHT,
  backgroundColor: '#13463a',
  scene: DeckEditor,
});

(window as unknown as { __game: Phaser.Game }).__game = game;

// What a rule says about each suit, for the smoke checks. None of it moves
// when the inks do, and that is the thing worth holding: an editor that let
// you recolor a deck into changing its own rules would be a bug wearing a
// feature's clothes.
(window as unknown as { __deck: unknown }).__deck = {
  rules: Object.fromEntries(SUITS.map((suit) => [suit, colorOf(suit)])),
};
