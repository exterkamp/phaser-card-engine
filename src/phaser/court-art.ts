import Phaser from 'phaser';
import {
  CourtPalette,
  courtHighlight,
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
  const ink = `${palette.ink}${palette.gold}${palette.red}`
    + `${courtPaper(palette)}${courtHighlight(palette)}`;
  const key = ink.replace(/#/g, '');
  return `pce-court-svg-${key}-${Math.round(width)}-${rank}-${suit}`;
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

    // Then the source's own marks go. In the highlight rather than the stock,
    // because at this point the whole background is the highlight and the
    // wipe has to join it - a patch of stock here would be an island the
    // flood below never reaches, and would stay the wrong color if the two
    // ever differ.
    const highlight = courtHighlight(palette);
    const paper = courtPaper(palette);
    pen.fillStyle = highlight;
    for (const wipe of courtWipeRects(source)) {
      pen.fillRect(wipe.x, wipe.y, wipe.width, wipe.height);
    }

    // And the background goes back to the stock, where they differ. A deck
    // that has not asked for the two to differ pays nothing for this.
    if (paper.toLowerCase() !== highlight.toLowerCase()) {
      partBackground(pen, source.width, source.height, highlight, paper);
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


/**
 * Pull the card's background back to the stock, leaving the figure alone.
 *
 * The source deck has no white skin to recolor. Paint the background element
 * one color and everything else another, and what comes out is a figure whose
 * face, hands, hair and linen are all *background* - the full-card rectangle
 * showing through gaps in the drawing. So a dark stock takes the King's face
 * with it unless the two are told apart here.
 *
 * Nothing in the file separates them, and two simpler rules both failed:
 *
 *   A flood from the border leaks. A Queen's cloak is white and runs unbroken
 *   into the white margin beside her, and the white between the strands of
 *   her hair runs into her face - so the flood arrives inside the figure and
 *   takes both.
 *
 *   Walking each column down from the top stops at the first thing drawn,
 *   which cannot leak but barely fills: a Jack's hat touches the top of the
 *   frame, so every column through it stops at once and the whole background
 *   behind his head stays pale.
 *
 * What works is flooding at a coarser grain than the leaks. A cell of the
 * grid counts as drawn if any pixel in it is, so the gaps the flood escaped
 * through - a few pixels between two strands of hair - are sealed, while the
 * background stays open. Then the result is grown back a bounded few pixels
 * at full resolution to take the rim the coarse grid left behind. Bounded,
 * because a growth that cannot run more than GROW pixels cannot cross a
 * figure to reach a face however the drawing is shaped.
 *
 * Edges are blended rather than switched, so the figure keeps its
 * antialiasing instead of gaining a pale fringe against a dark stock.
 */
function partBackground(
  pen: CanvasRenderingContext2D, width: number, height: number,
  from: string, to: string,
): void {
  const source = cssRgb(from);
  const target = cssRgb(to);
  const image = pen.getImageData(0, 0, width, height);
  const data = image.data;

  // Generous enough to carry the antialiased ramp, tight enough that it
  // cannot cross into one of the other four inks - the source is drawn in
  // five colors and nothing else, so there is a lot of room in between.
  const REACH = 60;
  const REACH2 = REACH * REACH;
  // Wider than the gaps the flood escaped through, narrower than anything
  // that is really background.
  const CELL = 4;
  const GROW = 6;

  const distance2 = (at: number) => {
    const dr = data[at] - source[0];
    const dg = data[at + 1] - source[1];
    const db = data[at + 2] - source[2];
    return dr * dr + dg * dg + db * db;
  };

  // Every pixel that is still the highlight, and every cell holding anything
  // that is not.
  const pale = new Uint8Array(width * height);
  const columns = Math.ceil(width / CELL);
  const rows = Math.ceil(height / CELL);
  const blocked = new Uint8Array(columns * rows);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const index = y * width + x;
      const open = distance2(index * 4) <= REACH2;
      pale[index] = open ? 1 : 0;
      if (!open) blocked[Math.floor(y / CELL) * columns + Math.floor(x / CELL)] = 1;
    }
  }

  // Flood the open cells, in from every edge.
  const outside = new Uint8Array(columns * rows);
  const cells: number[] = [];
  const seed = (cx: number, cy: number) => {
    if (cx < 0 || cy < 0 || cx >= columns || cy >= rows) return;
    const cell = cy * columns + cx;
    if (outside[cell] || blocked[cell]) return;
    outside[cell] = 1;
    cells.push(cell);
  };
  for (let cx = 0; cx < columns; cx++) { seed(cx, 0); seed(cx, rows - 1); }
  for (let cy = 0; cy < rows; cy++) { seed(0, cy); seed(columns - 1, cy); }
  while (cells.length) {
    const cell = cells.pop() as number;
    const cx = cell % columns;
    const cy = (cell - cx) / columns;
    seed(cx - 1, cy); seed(cx + 1, cy); seed(cx, cy - 1); seed(cx, cy + 1);
  }

  // Back to pixels, and out by GROW to take the rim the grid left.
  const background = new Uint8Array(width * height);
  let front: number[] = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const index = y * width + x;
      if (!pale[index]) continue;
      if (!outside[Math.floor(y / CELL) * columns + Math.floor(x / CELL)]) continue;
      background[index] = 1;
      front.push(index);
    }
  }
  for (let step = 0; step < GROW && front.length; step++) {
    const next: number[] = [];
    for (const index of front) {
      const x = index % width;
      const y = (index - x) / width;
      const look = (nx: number, ny: number) => {
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) return;
        const at = ny * width + nx;
        if (background[at] || !pale[at]) return;
        background[at] = 1;
        next.push(at);
      };
      look(x - 1, y); look(x + 1, y); look(x, y - 1); look(x, y + 1);
    }
    front = next;
  }

  for (let index = 0; index < background.length; index++) {
    if (!background[index]) continue;
    const at = index * 4;
    // Full stock where it matched exactly, tapering out across the ramp.
    const mix = 1 - Math.sqrt(distance2(at)) / REACH;
    data[at] += (target[0] - data[at]) * mix;
    data[at + 1] += (target[1] - data[at + 1]) * mix;
    data[at + 2] += (target[2] - data[at + 2]) * mix;
  }
  pen.putImageData(image, 0, 0);
}

/** `'#rrggbb'` as three numbers. */
function cssRgb(css: string): [number, number, number] {
  const hex = css.replace('#', '');
  const full = hex.length === 3 ? hex.split('').map((c) => c + c).join('') : hex;
  return [
    Number.parseInt(full.slice(0, 2), 16),
    Number.parseInt(full.slice(2, 4), 16),
    Number.parseInt(full.slice(4, 6), 16),
  ];
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
