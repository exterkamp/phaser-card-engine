import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DECK_THEMES } from './deck-theme.js';
import {
  COURT_PALETTES,
  COURT_RANKS,
  COURT_SOURCE,
  COURT_SOURCE_INKS,
  courtArtHeight,
  courtCropRect,
  courtSourcePath,
  courtSourceSize,
  courtWipeRects,
  isCourtRank,
  prepareCourt,
  recolorCourt,
  snapCourtInk,
  withCourtViewBox,
} from './court.js';

const ART = join(import.meta.dirname, '..', 'assets', 'cards', 'court');
const press = COURT_PALETTES.press;

describe('the five inks', () => {
  it('snaps each source color to itself', () => {
    for (const [role, hex] of Object.entries(COURT_SOURCE_INKS)) {
      expect(snapCourtInk(hex)).toBe(role);
    }
  });

  // The 19 strays are the whole reason snapping exists rather than a lookup.
  it('folds the Inkscape rounding strays in', () => {
    expect(snapCourtInk('#5456aa')).toBe('ink');
    expect(snapCourtInk('#000100')).toBe('black');
    expect(snapCourtInk('#ffff58')).toBe('gold');
    expect(snapCourtInk('#ff5655')).toBe('red');
    expect(snapCourtInk('#fffdff')).toBe('paper');
  });

  it('reads three-digit hex', () => {
    expect(snapCourtInk('#000')).toBe('black');
    expect(snapCourtInk('#fff')).toBe('paper');
  });
});

describe('recoloring', () => {
  const svg = '<path fill="#5555aa" stroke="#ff5555"/><path style="fill:#ffff55"/>';

  it('moves the three roles a theme owns', () => {
    const out = recolorCourt(svg, press);
    expect(out).toContain(press.ink);
    expect(out).toContain(press.red);
    expect(out).toContain(press.gold);
  });

  it('leaves black and paper where they are', () => {
    const out = recolorCourt('<path fill="#000000"/><path fill="#ffffff"/>', press);
    expect(out).toBe('<path fill="#000000"/><path fill="#ffffff"/>');
  });

  // A color named anywhere but a fill or a stroke is not part of the drawing.
  it('touches nothing outside a fill or a stroke', () => {
    const meta = '<dc:title>#5555aa</dc:title><path fill="#5555aa"/>';
    const out = recolorCourt(meta, press);
    expect(out).toContain('<dc:title>#5555aa</dc:title>');
    expect(out).toContain(`fill="${press.ink}"`);
  });

  it('carries the strays across with the color they belong to', () => {
    expect(recolorCourt('<path fill="#5456aa"/>', press)).toBe(`<path fill="${press.ink}"/>`);
  });
});

describe('the viewBox the source is missing', () => {
  it('adds one sized to the source', () => {
    expect(withCourtViewBox('<svg width="360" height="540">'))
      .toContain(`viewBox="0 0 ${COURT_SOURCE.width} ${COURT_SOURCE.height}"`);
  });

  it('leaves a file that already has one alone', () => {
    const had = '<svg viewBox="0 0 1 1">';
    expect(withCourtViewBox(had)).toBe(had);
  });
});

describe('the window taken out of the source', () => {
  // The number that ties this port to the art it replaces: the baked WebP
  // courts are 480x403, and they were cut with these same fractions. A change
  // here that moves this has moved the crop.
  it('matches the baked art exactly at 480 wide', () => {
    expect(courtArtHeight(480)).toBe(403);
  });

  // Not exactly double: the ratio is 0.8406, so 480 rounds 403.5 down and
  // 960 rounds 806.9 up. Worth pinning, because a height that is out by one
  // is a row of paper along the bottom edge of a card meant to bleed.
  it('scales', () => {
    expect(courtArtHeight(240)).toBe(202);
    expect(courtArtHeight(960)).toBe(807);
  });

  it('renders the source big enough that the crop lands at full size', () => {
    const source = courtSourceSize(480);
    const crop = courtCropRect(source);
    expect(crop.width).toBe(480);
  });

  it('stops at the seam, because the bottom half is the same figure upside down', () => {
    const source = courtSourceSize(480);
    const crop = courtCropRect(source);
    expect(crop.y + crop.height).toBeLessThanOrEqual(Math.round(source.height / 2) + 1);
  });

  // The crop starts above the border rule so the crowns survive, which only
  // works if the wipe that removes the rule reaches further down than the
  // crop starts.
  it('wipes the border rule the crop reaches above', () => {
    const source = courtSourceSize(480);
    const [rule] = courtWipeRects(source);
    const crop = courtCropRect(source);
    expect(crop.y).toBeLessThan(rule.height);
  });

  it('wipes the source index inside the cropped window', () => {
    const source = courtSourceSize(480);
    const [, index] = courtWipeRects(source);
    const crop = courtCropRect(source);
    expect(index.x).toBeGreaterThanOrEqual(0);
    expect(index.y + index.height).toBeLessThan(crop.y + crop.height);
  });
});

describe('the palettes', () => {
  it('covers every theme', () => {
    for (const theme of DECK_THEMES) {
      expect(COURT_PALETTES[theme], theme).toBeDefined();
    }
  });

  // The two gaps the bake script prints for a human to judge. Not judged here
  // - what reads badly at 60px is a matter of taste - but a palette whose ink
  // has crossed black or paper is a typo rather than a taste, and that is
  // what this catches.
  const luma = (hex: string) => {
    const [r, g, b] = [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };

  it('keeps every ink between black and paper, with room either side', () => {
    for (const theme of DECK_THEMES) {
      const ink = luma(COURT_PALETTES[theme].ink);
      expect(ink, `${theme} ink vs black`).toBeGreaterThan(20);
      expect(ink, `${theme} ink vs paper`).toBeLessThan(200);
    }
  });
});

describe('the source files on disk', () => {
  const files = readdirSync(ART).filter((f: string) => f.endsWith('.svg'));

  it('has all twelve', () => {
    expect(files).toHaveLength(12);
    for (const rank of COURT_RANKS) {
      for (const suit of ['spades', 'hearts', 'diamonds', 'clubs']) {
        const path = courtSourcePath(rank, suit).replace('/cards/court/', '');
        expect(files, `${rank}${suit}`).toContain(path);
      }
    }
  });

  // The claim the whole palette rests on. If a file ever arrives drawn in a
  // sixth color, recoloring it silently does the wrong thing to part of the
  // drawing - so the assumption is checked against the art rather than
  // trusted.
  it('is drawn in five colors and nothing else', () => {
    const roles = new Set<string>();
    const distinct = new Set<string>();
    for (const file of files) {
      const svg = readFileSync(join(ART, file), 'utf8');
      for (const hex of svg.match(/#[0-9a-fA-F]{6}\b/g) ?? []) {
        distinct.add(hex.toLowerCase());
        roles.add(snapCourtInk(hex));
      }
    }
    expect([...roles].sort()).toEqual(['black', 'gold', 'ink', 'paper', 'red']);
    // Five core plus the rounding strays, and nowhere near a sixth color.
    expect(distinct.size).toBeLessThanOrEqual(32);
  });

  it('has no viewBox of its own, which is why one gets added', () => {
    const svg = readFileSync(join(ART, 'king-spades.svg'), 'utf8');
    expect(svg).not.toContain('viewBox');
    expect(withCourtViewBox(svg)).toContain('viewBox');
  });

  it('comes out recolored, scalable and still valid', () => {
    const svg = readFileSync(join(ART, 'queen-hearts.svg'), 'utf8');
    const out = prepareCourt(svg, COURT_PALETTES.felt);
    expect(out).toContain('viewBox');
    expect(out).toContain(COURT_PALETTES.felt.ink);
    expect(out).not.toMatch(/fill="#5555aa"/);
    expect(out.startsWith('<?xml')).toBe(true);
  });
});

describe('the baked art', () => {
  const ART_DIR = join(import.meta.dirname, '..', 'assets', 'cards', 'art');

  // The courts were 84 WebP files and 4.1MB of the package. They are rendered
  // now, and the only thing that would quietly bring them back is somebody
  // re-running the bake into this directory - at which point the package
  // ships both and nothing says which one a card is using.
  it('keeps backs only, because a back has no SVG to be rendered from', () => {
    for (const theme of DECK_THEMES) {
      const files = readdirSync(join(ART_DIR, theme));
      expect(files, theme).toEqual(['back.webp']);
    }
  });
});

describe('court ranks', () => {
  it('knows which ranks have a portrait', () => {
    expect(isCourtRank('K')).toBe(true);
    expect(isCourtRank('10')).toBe(false);
    expect(isCourtRank('A')).toBe(false);
  });
});
