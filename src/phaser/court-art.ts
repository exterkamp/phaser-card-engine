import Phaser from 'phaser';
import {
  CourtPalette,
  courtPaper,
  CourtRank,
  COURT_RANKS,
  courtArtHeight,
  courtCropRect,
  courtSourcePath,
  courtSourceSize,
  courtWipeRects,
  prepareCourt,
} from '../index.js';

// Court portraits, rendered while the game is running.
//
// The alternative, and what this package shipped until v0.13, is to bake
// them: run the twelve sources through a renderer at build time, once per
// palette, and ship the WebP. That is faster to start, and it was 84 files
// and 4.1MB. What it cannot do is a palette nobody thought of - a game with
// its own colors has to go and rebuild the art - and that is the whole of
// why this replaced it.
//
// Measured, on the twelve at 480px, outside a scene: 280ms on a desktop and
// about a second on a mid-range phone. Inside a running scene it is roughly
// three times that, for the reason in renderCourts below. Either way it is
// once per palette - they are cached in the texture manager afterwards - and
// the recolor is only 12ms of it. The rasterising is the cost, so the same
// palette at two sizes costs twice.

/** Fetched once per file and kept, so changing palette never refetches. */
const sources = new Map<string, Promise<string>>();

function sourceSvg(rank: CourtRank, suit: string): Promise<string> {
  const path = courtSourcePath(rank, suit);
  let pending = sources.get(path);
  if (!pending) {
    pending = fetch(path).then((response) => {
      if (!response.ok) throw new Error(`court art ${path}: ${response.status}`);
      return response.text();
    });
    sources.set(path, pending);
  }
  return pending;
}

/**
 * The texture one court lands in.
 *
 * Keyed by the palette as well as the size, so two decks can be on screen at
 * once - which a four-handed game where everyone picked their own deck needs,
 * and which the baked themes used to get for free by being separate
 * directories.
 */
export function courtTextureKey(
  palette: CourtPalette, rank: string, suit: string, width: number,
): string {
  const ink = `${palette.ink}${palette.gold}${palette.red}${courtPaper(palette)}`
    .replace(/#/g, '');
  return `pce-court-svg-${ink}-${Math.round(width)}-${rank}-${suit}`;
}

/**
 * Renders one court into a texture and returns its key.
 *
 * Resolves immediately if that exact palette and size is already rendered.
 */
export async function renderCourt(
  scene: Phaser.Scene, rank: CourtRank, suit: string,
  palette: CourtPalette, width: number,
): Promise<string> {
  const key = courtTextureKey(palette, rank, suit, width);
  if (scene.textures.exists(key)) return key;

  const svg = prepareCourt(await sourceSvg(rank, suit), palette);
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  try {
    const image = new Image();
    image.src = url;
    await image.decode();

    // The whole page first, big enough that the window cut out of it lands at
    // the size asked for.
    const source = courtSourceSize(width);
    const page = document.createElement('canvas');
    page.width = source.width;
    page.height = source.height;
    const pen = page.getContext('2d');
    if (!pen) throw new Error('court art: no 2d context');
    pen.drawImage(image, 0, 0, source.width, source.height);

    // Then the source's own marks go, in the card's own paper - which has to
    // be the same paper the board fills the card with, or the wipe reads as a
    // patch of a slightly different white stuck over the art.
    pen.fillStyle = courtPaper(palette);
    for (const wipe of courtWipeRects(source)) {
      pen.fillRect(wipe.x, wipe.y, wipe.width, wipe.height);
    }

    const crop = courtCropRect(source);
    const out = document.createElement('canvas');
    out.width = Math.round(width);
    out.height = courtArtHeight(width);
    const cut = out.getContext('2d');
    if (!cut) throw new Error('court art: no 2d context');
    cut.drawImage(page, crop.x, crop.y, crop.width, crop.height, 0, 0, out.width, out.height);

    // addCanvas rather than addImage: the canvas is the texture's own source,
    // so nothing has to be kept alive on this side afterwards.
    if (!scene.textures.exists(key)) scene.textures.addCanvas(key, out);
    return key;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export interface RenderCourtsOptions {
  /** Which suits to draw courts for. Defaults to the standard four. */
  suits?: readonly string[];
  /** The raster width, in texture pixels. */
  width?: number;
}

const DEFAULT_SUITS = ['spades', 'hearts', 'diamonds', 'clubs'] as const;

/**
 * Renders a whole deck's worth of courts, and resolves when they are all in
 * the texture manager.
 *
 * Await this before creating any CardSprite that might be a court: a sprite
 * built while its portrait is still rendering falls back to the big centre
 * pip and does not go back and check. That is a deliberate fallback rather
 * than a bug - a court with no art is still a playable card - but it is not
 * what you want on purpose.
 *
 * All twelve at once, and this went in the other way round first. The
 * reasoning for doing them one at a time was that they contend for the same
 * main thread anyway and a burst of twelve decodes would stall a phone; the
 * reasoning was wrong, because the contention is not what dominates. Each
 * await hands a frame back to the game loop, and a loop redrawing a board
 * costs far more than the decode it is waiting on. Measured on the demo page:
 *
 *   sequential   3.5s, and 5.0s at 4x CPU throttle
 *   parallel     0.8s, and 2.3s
 *
 * Outside a running scene the whole job is about 280ms, which is what the
 * rasterising actually costs - the rest is the loop, and the way to not pay
 * it is to not go round the loop twelve times.
 */
export async function renderCourts(
  scene: Phaser.Scene, palette: CourtPalette, options: RenderCourtsOptions = {},
): Promise<void> {
  const suits = options.suits ?? DEFAULT_SUITS;
  const width = options.width ?? 480;
  const wanted = COURT_RANKS.flatMap((rank) => suits.map((suit) => ({ rank, suit })));
  await Promise.all(wanted.map(({ rank, suit }) =>
    renderCourt(scene, rank, suit, palette, width)));
}
