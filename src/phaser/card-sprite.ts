import Phaser from 'phaser';
import { boardPixelRatio } from './board.js';
import { courtTextureKey } from './court-art.js';
import {
  BASE_CARD_WIDTH,
  Card,
  Rank,
  CardFaceMetrics,
  COURT_PALETTES,
  DECK_STOCK,
  Suit,
  CourtPalette,
  DeckTheme,
  DEFAULT_BACK_COLOR,
  DEFAULT_DECK_THEME,
  CARD_INDEX_FONT,
  TEXT_OVERSAMPLE,
  DEFAULT_FACE_STYLE,
  FaceStyle,
  cardFaceMetrics,
  courtArtRect,
  pipPlaces,
  SuitInk,
  cardAssetBase,
  cssColor,
  deckThemePath,
  inkOf,
  isCourtRank,
  themeInk,
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

// The hairline edge, as a fraction of the paper rather than a color of its
// own. At the default near-white it lands on #d6d6d6, which is what it was
// when it was written down; at any other stock it stays a shade of that stock
// instead of a grey rule nobody asked for.
const EDGE_OF_PAPER = 0.846;
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
 * The suits are SVG and are loaded large, because they are recolored into
 * their own textures and then drawn down to whatever size a card is - a pip
 * loaded at pip size is a pip that blurs the moment somebody asks for a big
 * card.
 */
export function preloadCardArt(scene: Phaser.Scene, options: CardArtOptions = {}): void {
  const themes = options.themes ?? [DEFAULT_DECK_THEME];
  const suitArt = options.suitArt ?? STANDARD_SUIT_ART;

  for (const [suit, file] of Object.entries(suitArt)) {
    if (!scene.textures.exists(suitKey(suit))) {
      scene.load.svg(suitKey(suit), `${cardAssetBase()}/suits/${file}.svg`,
        { width: 200, height: 200 });
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
/**
 * The texture `preloadCardArt` loaded a theme's back into.
 *
 * Exported because a card is not the only thing a deck's back is printed on:
 * the box it comes in carries the same pattern - see phaser/tuck-box-art.ts -
 * and reloading the same image under a second name would be a second copy of
 * it in the texture manager.
 */
export const backTextureKey = (theme: DeckTheme) => `pce-back-${theme}`;
const backKey = backTextureKey;

/** One color scaled toward black, channel by channel. */
function shade(color: number, factor: number): number {
  const part = (shift: number) =>
    Math.round(((color >> shift) & 0xff) * factor) << shift;
  return part(16) | part(8) | part(0);
}


/**
 * A suit pip in any color, as a texture key.
 *
 * For a pip that is not on a card: the faint one printed in an empty
 * foundation to say what belongs there, which is the felt's own marking
 * rather than a card and so is neither red nor black. Draw it with
 * `scene.add.image(x, y, suitTexture(scene, suit, 0xffffff))` and set the
 * alpha to taste.
 *
 * The art has to be loaded already - `preloadCardArt` does it - or this
 * hands back a key with nothing behind it.
 */
export function suitTexture(scene: Phaser.Scene, suit: string, color: number): string {
  return inkedSuit(scene, suit, color);
}

/**
 * A suit pip in the color it is drawn in, baked into its own texture.
 *
 * The SVGs are white on transparency so one file can serve red, black and
 * whatever a game's own suit needs. `setTint` did this until it turned out to
 * need WebGL - a canvas fallback drew every pip white - so the color is
 * composited in here instead, once per suit and color.
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

/** The card body and its shadow, baked once per size and color. */
function cardBody(
  scene: Phaser.Scene, metrics: CardFaceMetrics, faceUp: boolean, border: number,
  dpr: number, paper: number, edge: number,
): string {
  const face = faceUp
    ? `up-${paper.toString(16)}-${edge.toString(16)}`
    : `down-${border.toString(16)}`;
  const key = `pce-body-${Math.round(metrics.width)}-${face}-${dpr}`;
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
  g.fillStyle(faceUp ? paper : border, 1);
  g.fillRoundedRect(pad, pad, width, height, radius);
  // A hairline edge on a face-up card, because one white card fanned over
  // another leaves no seam otherwise and the pile reads as a single tall card
  // with a column of indexes printed down it. A face-down card gets its
  // owner's color in a heavier line, since a flat fill is all it shows.
  g.lineStyle(faceUp ? 1 : 2, faceUp ? edge : border, 1);
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
  /**
   * Which of the three layouts the face is printed in.
   *
   * `mobile` by default - one big index, one big suit, one corner - which is
   * the card to use when several are fanned on a phone. `standard` is the
   * card as it is actually printed, with two corners and a true count of
   * pips; `jumbo` is that with the indices at about twice the size. See
   * card-face.ts.
   */
  face?: FaceStyle;
  theme?: DeckTheme;
  /** What the back's ink is printed over. */
  backColor?: number;
  /**
   * The card stock the face is printed on.
   *
   * Moves the court's paper with it, so the portrait stays on the same stock
   * as the card under it - see `CourtPalette.paper`. The hairline edge
   * follows too.
   */
  paper?: number;
  /**
   * The hairline drawn round a face-up card.
   *
   * Defaults to the paper darkened a little, which is what stops one white
   * card fanned over another from reading as a single tall card. A game with
   * its own idea of that edge says so here.
   */
  edge?: number;
  /**
   * The ink each suit is drawn in. Defaults to red, black, or gold.
   *
   * A map, or a function. Nothing here has to line up with `colorOf`: a deck
   * may print its hearts in green and they are still red to every rule that
   * asks.
   */
  ink?: SuitInk;
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
  private readonly paper: number;
  private readonly edge: number;
  private displayFace: boolean | undefined;

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
    // The deck's own inks unless the game named others. A matrix card whose
    // spades came out in the package's near-black would be a black pip on
    // near-black stock, which is not a card at all.
    const ink = inkOf(style.ink ?? themeInk(theme), card.suit);
    const dpr = style.pixelRatio ?? boardPixelRatio(scene);
    const metrics = cardFaceMetrics(width, style.face ?? DEFAULT_FACE_STYLE);

    // A theme is a palette, so a card that says nothing about color still
    // knows which portrait it wants; `courtPalette` is for a deck that is not
    // one of the seven.
    const palette = style.courtPalette ?? COURT_PALETTES[theme];
    // The stock, from whichever of the two said so. The palette is allowed to
    // carry it because the court has to be printed on the same paper as the
    // card beneath it, and a game that states it once in the palette it
    // already hands to `renderCourts` cannot get the two out of step.
    const paper = style.paper ?? (palette.paper !== undefined
      ? cssColor(palette.paper) : DECK_STOCK[theme].paper);

    const edge = style.edge ?? shade(paper, EDGE_OF_PAPER);

    this.metrics = metrics;
    this.backColor = backColor;
    this.pixelRatio = dpr;
    this.paper = paper;
    this.edge = edge;

    this.plate = scene.add.image(0, 0,
      cardBody(scene, metrics, true, backColor, dpr, paper, edge))
      .setDisplaySize(metrics.width + 2 * metrics.pad, metrics.height + 2 * metrics.pad);
    this.add(this.plate);

    // Over the body's fill and under everything on the face, so turning the
    // card over is only a question of which of the two is visible.
    this.back = scene.add.image(0, 0, backKey(theme))
      .setDisplaySize(metrics.width, metrics.height);
    this.add(this.back);

    // A court portrait, or the suits. Both sit below the index, which is
    // added last so it draws over either.
    const court = isCourtRank(card.rank)
      ? courtTextureKey(palette, card.rank, card.suit, style.courtWidth ?? 480)
      : undefined;
    if (court !== undefined && scene.textures.exists(court)) {
      this.keep(this.portrait(scene, court));
    } else {
      this.suits(scene, card, ink);
      // The portrait may simply not have finished rendering. A card built in
      // the meantime shows its pips and takes the portrait when it lands,
      // which is what lets a game create its deck and start its render of the
      // courts in the same breath rather than having to order the two.
      if (court !== undefined) this.awaitCourt(scene, court);
    }

    this.corner(scene, card, ink, dpr, false);
    // The second corner, upside down, on the faces that print one. It is what
    // makes a card the same picked up either way round.
    if (metrics.corners === 2) this.corner(scene, card, ink, dpr, true);

    this.setSize(metrics.width, metrics.height);
    this.setFaceUp(card.faceUp);
    scene.add.existing(this);
  }

  private keep(item: Phaser.GameObjects.GameObject): void {
    this.faceParts.push(item);
    this.add(item);
  }

  /**
   * One corner: the rank, and its suit beside it or under it.
   *
   * `turned` puts the same thing in the opposite corner rotated half a turn,
   * which is a reflection through the card's centre rather than a second
   * layout - so the two corners cannot drift apart.
   */
  private corner(
    scene: Phaser.Scene, card: Card<S>, ink: number, dpr: number, turned: boolean,
  ): void {
    const { index } = this.metrics;
    const flip = turned ? -1 : 1;

    const rank = scene.add.text(index.x * flip, index.y * flip, card.rank, {
      fontFamily: CARD_INDEX_FONT,
      fontSize: `${index.fontSize}px`,
      fontStyle: 'bold',
      color: Phaser.Display.Color.IntegerToColor(ink).rgba,
      resolution: dpr * TEXT_OVERSAMPLE,
    // Origin at the left-middle on both, not the right-middle on the turned
    // one. Phaser rotates about the origin, so a half-turn about the left
    // edge is what sends the glyphs back across the card - anchoring the
    // turned corner at its right edge instead put it off the card entirely.
    }).setOrigin(0, 0.5).setAngle(turned ? 180 : 0);
    this.keep(rank);

    const suit = scene.add.image(0, 0, inkedSuit(scene, card.suit, ink))
      .setDisplaySize(index.suitSize, index.suitSize)
      .setAngle(turned ? 180 : 0);
    if (index.stacked) {
      // Under the rank, centred on it. A printed corner is a narrow column,
      // and a column is what still shows when a hand is fanned.
      const gap = index.fontSize * 0.34;
      suit.setPosition(
        (index.x + rank.width / 2) * flip,
        (index.y + index.fontSize * 0.42 + gap) * flip,
      );
    } else {
      // Beside it, against the rank's measured width rather than a guess:
      // "10" is half as wide again as "4" and the suit has to sit beside
      // whichever it is.
      suit.setOrigin(0, 0.5)
        .setPosition((index.x + rank.width + index.gap) * flip, index.y * flip);
    }
    this.keep(suit);
  }

  /**
   * What a number card carries: one big suit, or a count of them.
   *
   * The mobile face draws one, because five rows of small glyphs at phone
   * size is a blurry cluster rather than a card. The other two count them
   * out in the arrangement a printed deck uses - see `pipLayout`, which is
   * where the fact that a seven is a six plus one lives.
   */
  private suits(scene: Phaser.Scene, card: Card<S>, ink: number): void {
    const places = pipPlaces(this.metrics, card.rank as Rank);
    if (!places.length) {
      this.keep(
        scene.add.image(0, this.metrics.pip.y, inkedSuit(scene, card.suit, ink))
          .setDisplaySize(this.metrics.pip.size, this.metrics.pip.size),
      );
      return;
    }
    for (const place of places) {
      this.keep(
        scene.add.image(place.x, place.y, inkedSuit(scene, card.suit, ink))
          .setDisplaySize(place.size, place.size)
          .setAngle(place.flip ? 180 : 0),
      );
    }
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
      art.setVisible(this.shownFace);
    };
    scene.textures.on(Phaser.Textures.Events.ADD, onAdd);
    this.once(Phaser.GameObjects.Events.DESTROY, () => {
      scene.textures.off(Phaser.Textures.Events.ADD, onAdd);
    });
  }

  /** Shows the face or the back. The card's own flag follows. */
  setFaceUp(faceUp: boolean): this {
    this.card.faceUp = faceUp;
    return this.redraw();
  }

  /**
   * Draw the side asked for without touching the card's own `faceUp`.
   *
   * A card turning over in mid-air has to show whichever side is pointing at
   * the camera, and it has not been flipped while it is doing so - it still
   * belongs to its pile the way it did, and the rules still see the side it
   * really is. Pass `undefined` to go back to following the card.
   */
  setDisplayFace(faceUp: boolean | undefined): this {
    if (this.displayFace === faceUp) return this;
    this.displayFace = faceUp;
    return this.redraw();
  }

  /** The side being shown, which is the card's own unless overridden. */
  get shownFace(): boolean {
    return this.displayFace ?? this.card.faceUp;
  }

  private redraw(): this {
    const faceUp = this.shownFace;
    this.back.setVisible(!faceUp);
    for (const part of this.faceParts) {
      (part as Phaser.GameObjects.Image).setVisible(faceUp);
    }
    this.plate.setTexture(
      cardBody(this.scene, this.metrics, faceUp, this.backColor, this.pixelRatio,
        this.paper, this.edge),
    );
    return this;
  }
}
