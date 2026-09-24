import Phaser from 'phaser';
import { boardPixelRatio } from './board.js';
import { courtTextureKey } from './court-art.js';
import {
  BASE_CARD_WIDTH,
  Card,
  CardFaceMetrics,
  COURT_PALETTES,
  Suit,
  CourtPalette,
  DeckTheme,
  DEFAULT_BACK_COLOR,
  DEFAULT_DECK_THEME,
  CARD_INDEX_FONT,
  TEXT_OVERSAMPLE,
  cardFaceMetrics,
  colourOf,
  courtArtRect,
  deckThemePath,
  isCourtRank,
} from '../index.js';

// A card, drawn.
//
// The face is Nertz's: a large index with its suit beside it on one line in
// the top-left, and one big suit - or a court portrait, full bleed - filling
// the bottom. Where everything goes is card-face.ts, which is arithmetic and
// has tests; this is the part that needs a canvas.
//
// Drawn at whatever width it is asked for rather than at one size and scaled,
// so the text is rasterised for the size it is shown at. A card at 24 units
// and a card at 240 are both sharp; the same card scaled up from 24 is not.

/** Which file in assets/cards/suits each suit is drawn from. */
export const STANDARD_SUIT_ART: Readonly<Record<string, string>> = {
  spades: 'spade',
  hearts: 'heart',
  diamonds: 'diamond',
  clubs: 'club',
};

const INK_RED = 0xcf2436;
const INK_BLACK = 0x1a1a1a;
// A suit this package cannot colour is drawn in neither - gold, the colour a
// game generally reaches for when it has invented a suit of its own. Override
// it with `ink` if that is wrong for yours.
const INK_OTHER = 0xd8a838;

const CARD_FACE = 0xfdfdfd;
const CARD_EDGE = 0xd6d6d6;
const SHADOW = 0x000000;
const SHADOW_LAYERS = [
  { grow: 3.8, alpha: 0.10 },
  { grow: 2.2, alpha: 0.13 },
  { grow: 1.0, alpha: 0.16 },
];
const SHADOW_DROP = 2.5;

export interface CardArtOptions {
  themes?: readonly DeckTheme[];
  /** suit -> file name in assets/cards/suits, for a game with its own suits. */
  suitArt?: Readonly<Record<string, string>>;
}

/**
 * Loads the artwork a CardSprite needs. Call it from a scene's `preload`.
 *
 * The suits are SVG and are loaded large, because they are recoloured into
 * their own textures and then drawn down to whatever size a card is - a pip
 * loaded at pip size is a pip that blurs the moment somebody asks for a big
 * card.
 */
export function preloadCardArt(scene: Phaser.Scene, options: CardArtOptions = {}): void {
  const themes = options.themes ?? [DEFAULT_DECK_THEME];
  const suitArt = options.suitArt ?? STANDARD_SUIT_ART;

  for (const [suit, file] of Object.entries(suitArt)) {
    if (!scene.textures.exists(suitKey(suit))) {
      scene.load.svg(suitKey(suit), `/cards/suits/${file}.svg`, { width: 200, height: 200 });
    }
  }
  // Backs only. The courts are not bitmaps any more - they are rendered from
  // their SVG sources by renderCourts, which cannot go through Phaser's
  // loader because rasterising twelve of them is asynchronous in a way the
  // loader has no way to wait for.
  for (const theme of themes) {
    if (!scene.textures.exists(backKey(theme))) {
      scene.load.image(backKey(theme), deckThemePath(theme, 'back.webp'));
    }
  }
}

const suitKey = (suit: string) => `pce-suit-${suit}`;
const backKey = (theme: DeckTheme) => `pce-back-${theme}`;

/** The ink a suit is drawn in, unless the game says otherwise. */
export function defaultInk(suit: string): number {
  const colour = colourOf(suit);
  if (colour === 'red') return INK_RED;
  if (colour === 'black') return INK_BLACK;
  return INK_OTHER;
}

/**
 * A suit pip in the colour it is drawn in, baked into its own texture.
 *
 * The SVGs are white on transparency so one file can serve red, black and
 * whatever a game's own suit needs. `setTint` did this until it turned out to
 * need WebGL - a canvas fallback drew every pip white - so the colour is
 * composited in here instead, once per suit and colour.
 */
function inkedSuit(scene: Phaser.Scene, suit: string, ink: number): string {
  const key = `${suitKey(suit)}-${ink.toString(16)}`;
  if (scene.textures.exists(key)) return key;
  // A missing suit texture is Phaser's opaque __MISSING placeholder, and
  // painting *that* fills the whole rectangle with ink - which reads as a
  // deliberate solid block rather than as a failed request. Better to draw
  // nothing recognisable than something confidently wrong.
  if (!scene.textures.exists(suitKey(suit))) return suitKey(suit);

  const source = scene.textures.get(suitKey(suit)).getSourceImage();
  const texture = scene.textures.createCanvas(key, source.width, source.height);
  if (!texture) return suitKey(suit);

  const ctx = texture.getContext();
  ctx.drawImage(source as CanvasImageSource, 0, 0);
  // Keep the shape just drawn, replace everything it is made of.
  ctx.globalCompositeOperation = 'source-in';
  ctx.fillStyle = Phaser.Display.Color.IntegerToColor(ink).rgba;
  ctx.fillRect(0, 0, source.width, source.height);
  texture.refresh();
  return key;
}

/** The card body and its shadow, baked once per size and colour. */
function cardBody(
  scene: Phaser.Scene, metrics: CardFaceMetrics, faceUp: boolean, border: number, dpr: number,
): string {
  const key = `pce-body-${Math.round(metrics.width)}-${faceUp ? 'up' : `down-${border.toString(16)}`}-${dpr}`;
  if (scene.textures.exists(key)) return key;

  const { width, height, pad, radius } = metrics;
  const g = new Phaser.GameObjects.Graphics(scene);
  g.scale = dpr;
  for (const layer of SHADOW_LAYERS) {
    const grow = layer.grow * (width / BASE_CARD_WIDTH);
    g.fillStyle(SHADOW, layer.alpha);
    g.fillRoundedRect(
      pad - grow,
      pad - grow + SHADOW_DROP * (width / BASE_CARD_WIDTH),
      width + 2 * grow,
      height + 2 * grow,
      radius + grow,
    );
  }
  g.fillStyle(faceUp ? CARD_FACE : border, 1);
  g.fillRoundedRect(pad, pad, width, height, radius);
  // A hairline edge on a face-up card, because one white card fanned over
  // another leaves no seam otherwise and the pile reads as a single tall card
  // with a column of indexes printed down it. A face-down card gets its
  // owner's colour in a heavier line, since a flat fill is all it shows.
  g.lineStyle(faceUp ? 1 : 2, faceUp ? CARD_EDGE : border, 1);
  g.strokeRoundedRect(pad, pad, width, height, radius);

  g.generateTexture(
    key, Math.ceil((width + 2 * pad) * dpr), Math.ceil((height + 2 * pad) * dpr),
  );
  g.destroy();
  return key;
}

export interface CardStyle {
  /** How wide to draw it. Everything else follows from this. */
  width?: number;
  theme?: DeckTheme;
  /** What the back's ink is printed over. */
  backColor?: number;
  /** The ink a suit is drawn in. Defaults to red, black, or gold. */
  ink?: (suit: string) => number;
  suitArt?: Readonly<Record<string, string>>;
  /**
   * Draw the courts from the SVG sources in this palette rather than from the
   * theme's baked WebP.
   *
   * The portraits have to have been rendered already - see `renderCourts`,
   * which is async because rasterising twelve of them is. A sprite built
   * before its portrait exists falls back to the centre pip.
   */
  courtPalette?: CourtPalette;
  /** The raster width the courts were rendered at. Defaults to 480. */
  courtWidth?: number;
  /**
   * How many texture pixels to a card unit.
   *
   * Defaults to whatever `createBoard` scaled this game by, which is the
   * right answer whenever the card is going into a board root - the card is
   * then rasterised at the density it will actually be shown at.
   */
  pixelRatio?: number;
}

export class CardSprite<S extends string = Suit> extends Phaser.GameObjects.Container {
  readonly metrics: CardFaceMetrics;
  // `plate` rather than `body`, which is a Container member already - Phaser
  // keeps a physics body there. The two games this came from have each
  // learned this lesson on `game` and on `events`; it is the same lesson.
  private readonly plate: Phaser.GameObjects.Image;
  private readonly back: Phaser.GameObjects.Image;
  private readonly faceParts: Phaser.GameObjects.GameObject[] = [];
  private readonly backColor: number;
  private readonly pixelRatio: number;

  // Generic in the suit, because a game that declares one with `defineSuits`
  // has to be able to draw it. Nothing in here needs to know which suits
  // exist - the art comes from `suitArt` and the ink from `ink` - so the
  // parameter only has to stop the type system refusing a perfectly good
  // card. Defaulting to Suit keeps every existing `new CardSprite(...)` as it
  // was.
  constructor(scene: Phaser.Scene, readonly card: Card<S>, style: CardStyle = {}) {
    super(scene, 0, 0);
    const width = style.width ?? BASE_CARD_WIDTH;
    const theme = style.theme ?? DEFAULT_DECK_THEME;
    const backColor = style.backColor ?? DEFAULT_BACK_COLOR;
    const ink = (style.ink ?? defaultInk)(card.suit);
    const dpr = style.pixelRatio ?? boardPixelRatio(scene);
    const metrics = cardFaceMetrics(width);
    this.metrics = metrics;
    this.backColor = backColor;
    this.pixelRatio = dpr;

    this.plate = scene.add.image(0, 0, cardBody(scene, metrics, true, backColor, dpr))
      .setDisplaySize(metrics.width + 2 * metrics.pad, metrics.height + 2 * metrics.pad);
    this.add(this.plate);

    // Over the body's fill and under everything on the face, so turning the
    // card over is only a question of which of the two is visible.
    this.back = scene.add.image(0, 0, backKey(theme))
      .setDisplaySize(metrics.width, metrics.height);
    this.add(this.back);

    // A court portrait, or one big suit. Both sit below the index, which is
    // added last so it draws over either.
    //
    // A theme is a palette, so a card that says nothing about colour still
    // knows which portrait it wants; `courtPalette` is for a deck that is not
    // one of the seven.
    const palette = style.courtPalette ?? COURT_PALETTES[theme];
    const court = isCourtRank(card.rank)
      ? courtTextureKey(palette, card.rank, card.suit, style.courtWidth ?? 480)
      : undefined;
    if (court !== undefined && scene.textures.exists(court)) {
      this.keep(this.portrait(scene, court));
    } else {
      this.keep(
        scene.add.image(0, metrics.pip.y, inkedSuit(scene, card.suit, ink))
          .setDisplaySize(metrics.pip.size, metrics.pip.size),
      );
      // The portrait may simply not have finished rendering. A card built in
      // the meantime shows its pip and takes the portrait when it lands,
      // which is what lets a game create its deck and start its render of the
      // courts in the same breath rather than having to order the two.
      if (court !== undefined) this.awaitCourt(scene, court);
    }

    const rank = scene.add.text(metrics.index.x, metrics.index.y, card.rank, {
      fontFamily: CARD_INDEX_FONT,
      fontSize: `${metrics.index.fontSize}px`,
      fontStyle: 'bold',
      color: Phaser.Display.Color.IntegerToColor(ink).rgba,
      resolution: dpr * TEXT_OVERSAMPLE,
    }).setOrigin(0, 0.5);
    this.keep(rank);
    // Against the rank's measured width rather than a guess, because "10" is
    // half as wide again as "4" and the suit has to sit beside whichever it is.
    this.keep(
      scene.add.image(
        rank.x + rank.width + metrics.index.gap, metrics.index.y,
        inkedSuit(scene, card.suit, ink),
      ).setDisplaySize(metrics.index.suitSize, metrics.index.suitSize).setOrigin(0, 0.5),
    );

    this.setSize(metrics.width, metrics.height);
    this.setFaceUp(card.faceUp);
    scene.add.existing(this);
  }

  private keep(item: Phaser.GameObjects.GameObject): void {
    this.faceParts.push(item);
    this.add(item);
  }

  /** The portrait, sized off the texture's own proportions. */
  private portrait(scene: Phaser.Scene, key: string): Phaser.GameObjects.Image {
    const art = scene.textures.get(key).getSourceImage();
    const rect = courtArtRect(this.metrics, { width: art.width, height: art.height });
    return scene.add.image(rect.x, rect.y, key).setDisplaySize(rect.width, rect.height);
  }

  /**
   * Swap the pip for the portrait if that texture turns up later.
   *
   * Phaser has no per-key texture event, so this listens to all of them and
   * checks - cheap, since the only textures added after a scene starts are
   * these. The handler is taken off on the first match and on destroy, or a
   * deck's worth of sprites would each keep a listener alive for a texture
   * that may never come.
   */
  private awaitCourt(scene: Phaser.Scene, key: string): void {
    const onAdd = (added: string) => {
      if (added !== key) return;
      scene.textures.off(Phaser.Textures.Events.ADD, onAdd);
      const pip = this.faceParts.shift();
      pip?.destroy();
      const art = this.portrait(scene, key);
      this.faceParts.unshift(art);
      this.addAt(art, this.getIndex(this.back) + 1);
      art.setVisible(this.card.faceUp);
    };
    scene.textures.on(Phaser.Textures.Events.ADD, onAdd);
    this.once(Phaser.GameObjects.Events.DESTROY, () => {
      scene.textures.off(Phaser.Textures.Events.ADD, onAdd);
    });
  }

  /** Shows the face or the back. The card's own flag follows. */
  setFaceUp(faceUp: boolean): this {
    this.card.faceUp = faceUp;
    this.back.setVisible(!faceUp);
    for (const part of this.faceParts) {
      (part as Phaser.GameObjects.Image).setVisible(faceUp);
    }
    this.plate.setTexture(
      cardBody(this.scene, this.metrics, faceUp, this.backColor, this.pixelRatio),
    );
    return this;
  }
}
