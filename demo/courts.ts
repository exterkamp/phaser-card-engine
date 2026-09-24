import Phaser from 'phaser';
import {
  COURT_PALETTES,
  COURT_RANKS,
  Card,
  CourtPalette,
  DECK_THEMES,
  DECK_THEME_LABELS,
  DeckTheme,
  buildDeck,
  isCourtRank,
} from 'phaser-card-engine';
import {
  CardSprite, boardRoot, createBoard, preloadCardArt, renderCourts,
} from 'phaser-card-engine/phaser';

// The twelve courts, coloured while the game is running.
//
// Every card on this page is drawn from the same twelve SVG files; what
// changes when you move a slider is three hex values substituted into the
// source before it is rasterised. The baked decks in assets/cards/art are
// these same twelve, put through the same steps at build time - so the seven
// presets below are not seven sets of art, they are seven palettes.
const WIDTH = 480;
const HEIGHT = 520;   // three rows of 164 from y=106, plus a margin
const COURT_RASTER = 480;   // what the baked art is, so the comparison is fair

const SUITS = ['spades', 'hearts', 'diamonds', 'clubs'] as const;
const CARD_W = 104;

class CourtTable extends Phaser.Scene {
  private root!: Phaser.GameObjects.Container;
  private cards: CardSprite[] = [];
  private palette: CourtPalette = { ...COURT_PALETTES.press };
  private busy = false;

  preload(): void {
    preloadCardArt(this);
  }

  create(): void {
    this.cameras.main.setBackgroundColor('#13463a');
    this.root = boardRoot(this);
    this.wireControls();
    void this.repaint();
  }

  /** Re-render every court in the current palette, and rebuild the board. */
  private async repaint(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    const note = document.getElementById('note');
    if (note) note.textContent = 'rendering twelve courts…';

    const started = performance.now();
    await renderCourts(this, this.palette, { width: COURT_RASTER });
    const took = Math.round(performance.now() - started);

    for (const card of this.cards) card.destroy();
    this.cards = [];

    const courts = buildDeck().filter((c) => isCourtRank(c.rank));
    for (const [row, rank] of COURT_RANKS.entries()) {
      for (const [column, suit] of SUITS.entries()) {
        const face = courts.find((c) => c.rank === rank && c.suit === suit) as Card;
        const sprite = new CardSprite(this, { ...face, faceUp: true }, {
          width: CARD_W,
          courtPalette: this.palette,
          courtWidth: COURT_RASTER,
        });
        sprite.setPosition(60 + column * 120, 106 + row * 164);
        this.root.add(sprite);
        this.cards.push(sprite);
      }
    }

    if (note) {
      // Only the first pass pays: after that the textures are in the manager
      // and the same palette costs nothing to ask for again.
      note.textContent = `twelve courts in ${took} ms · ${took === 0 ? 'already rendered' : `${Math.round(took / 12)} ms each`}`;
    }
    this.busy = false;
  }

  private wireControls(): void {
    const preset = document.getElementById('preset') as HTMLSelectElement | null;
    if (preset) {
      for (const theme of DECK_THEMES) {
        const option = document.createElement('option');
        option.value = theme;
        option.textContent = DECK_THEME_LABELS[theme];
        preset.append(option);
      }
      preset.value = 'press';
      preset.addEventListener('change', () => {
        this.palette = { ...COURT_PALETTES[preset.value as DeckTheme] };
        this.showPalette();
        void this.repaint();
      });
    }

    for (const role of ['ink', 'gold', 'red'] as const) {
      const input = document.getElementById(role) as HTMLInputElement | null;
      input?.addEventListener('change', () => {
        this.palette = { ...this.palette, [role]: input.value };
        if (preset) preset.value = '';
        void this.repaint();
      });
    }

    document.getElementById('random')?.addEventListener('click', () => {
      // A deck nobody baked, which is the only thing this page is arguing
      // for - the seven presets could all have been directories of WebP.
      const hue = () => Math.floor(Math.random() * 360);
      const base = hue();
      this.palette = {
        ink: hsl(base, 55, 30),
        gold: hsl((base + 150) % 360, 62, 62),
        red: hsl((base + 40) % 360, 58, 44),
      };
      if (document.getElementById('preset')) {
        (document.getElementById('preset') as HTMLSelectElement).value = '';
      }
      this.showPalette();
      void this.repaint();
    });

    this.showPalette();
  }

  private showPalette(): void {
    for (const role of ['ink', 'gold', 'red'] as const) {
      const input = document.getElementById(role) as HTMLInputElement | null;
      if (input) input.value = this.palette[role];
    }
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
  scene: CourtTable,
});

(window as unknown as { __game: Phaser.Game }).__game = game;
