import { describe, expect, it } from 'vitest';
import { BASE_CARD_WIDTH, cardFaceMetrics, courtArtRect } from './card-face.js';
import { CARD_HEIGHT, CARD_WIDTH } from './cards.js';

describe('the card face', () => {
  const base = cardFaceMetrics();

  it('is the card the rest of the package measures in', () => {
    expect(base.width).toBe(CARD_WIDTH);
    expect(base.height).toBeCloseTo(CARD_HEIGHT);
    expect(BASE_CARD_WIDTH).toBe(CARD_WIDTH);
  });

  it('puts the index in the top-left, with its suit beside it on one line', () => {
    expect(base.index.x).toBeLessThan(0);
    expect(base.index.y).toBeLessThan(0);
    // Same line: the suit is placed against the rank's right edge, so they
    // share a y and only the sprite knows the measured text width.
    expect(base.index.suitSize).toBeGreaterThan(0);
    expect(base.index.gap).toBeGreaterThanOrEqual(0);
  });

  it('puts the big suit below the middle, where the index is not', () => {
    expect(base.pip.y).toBeGreaterThan(0);
    expect(base.pip.size).toBeGreaterThan(base.index.suitSize);
  });

  // The number a fanned pile's step is chosen against. If this drifts, every
  // fan in every game built on this package quietly starts hiding indexes.
  it('says how much of a card has to show for its index to be read', () => {
    expect(base.peek).toBeCloseTo(29.4);
    expect(base.peek).toBeLessThan(base.height / 2);
  });
});

describe('at other sizes', () => {
  it('scales every measurement with the width', () => {
    const big = cardFaceMetrics(120);
    const base = cardFaceMetrics(60);
    expect(big.height).toBeCloseTo(base.height * 2);
    expect(big.peek).toBeCloseTo(base.peek * 2);
    expect(big.index.fontSize).toBeCloseTo(base.index.fontSize * 2);
    expect(big.pip.size).toBeCloseTo(base.pip.size * 2);
    expect(big.radius).toBeCloseTo(base.radius * 2);
  });

  it('keeps poker proportions at every size', () => {
    for (const width of [24, 36, 60, 90, 160, 240]) {
      const m = cardFaceMetrics(width);
      expect(m.width / m.height).toBeCloseTo(5 / 7);
    }
  });

  it('keeps the index inside the card at every size', () => {
    for (const width of [24, 60, 240]) {
      const m = cardFaceMetrics(width);
      expect(m.index.x).toBeGreaterThan(-m.width / 2);
      expect(m.index.y - m.index.fontSize / 2).toBeGreaterThan(-m.height / 2);
    }
  });
});

describe('a court portrait', () => {
  it('runs the full width of the card, flush with the bottom', () => {
    const m = cardFaceMetrics(60);
    const rect = courtArtRect(m, { width: 480, height: 403 });
    expect(rect.width).toBe(60);
    expect(rect.height).toBeCloseTo(60 * 403 / 480);
    // Bottom edge of the art on the bottom edge of the card.
    expect(rect.y + rect.height / 2).toBeCloseTo(m.height / 2);
  });

  it('takes its shape from the art rather than naming one', () => {
    const m = cardFaceMetrics(60);
    const tall = courtArtRect(m, { width: 100, height: 200 });
    expect(tall.height).toBeCloseTo(120);
  });
});
