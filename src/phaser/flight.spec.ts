import { describe, expect, it, vi } from 'vitest';
import { defineStack } from '../stack.js';
import { dealCards, flightDuration, landingsFor, spinTarget, throwCard, throwLanding } from './flight.js';

// A scene that records the tweens it is asked for and runs their onComplete,
// which is all this library uses a scene for. The whole file is Phaser-free at
// runtime so that this is possible.
function stubScene() {
  const tweens: Record<string, any>[] = [];
  const scene = {
    tweens: {
      add(config: Record<string, any>) {
        tweens.push(config);
        // Land immediately, so a throw's promise resolves in a test.
        config['onComplete']?.();
        return config;
      },
    },
  };
  return { scene: scene as unknown as Phaser.Scene, tweens };
}

function stubCard(x = 0, y = 0) {
  return {
    x, y, angle: 0, scaleX: 1, scaleY: 1,
    setAngle: vi.fn(), setScale: vi.fn(),
  } as unknown as Phaser.GameObjects.Container;
}

describe('where a throw lands', () => {
  it('lands on a bare point', () => {
    expect(throwLanding({ x: 120, y: 40 })).toEqual({ x: 120, y: 40 });
  });

  it('lands on an empty stack-s anchor', () => {
    const stack = defineStack({ id: 's', x: 100, y: 50, fan: 'down', step: 20 });
    expect(throwLanding(stack)).toEqual({ x: 100, y: 50 });
  });

  // Throwing at a pile of six means landing on top of the six, not under them.
  it('lands where a stack-s next card goes', () => {
    const stack = defineStack({ id: 's', x: 100, y: 50, fan: 'down', step: 20 });
    expect(throwLanding({ stack, count: 3 })).toEqual({ x: 100, y: 110 });
  });

  it('respects a squeezed pile-s own gaps', () => {
    const stack = defineStack({ id: 's', x: 0, y: 0, fan: 'down', step: 20, maxSpread: 30 });
    expect(throwLanding({ stack, count: 3 }).y).toBeCloseTo(30);
  });
});

describe('how long it takes', () => {
  it('takes longer the further it goes', () => {
    expect(flightDuration(300)).toBeGreaterThan(flightDuration(100));
  });

  it('is never instant and never a journey', () => {
    expect(flightDuration(0)).toBe(220);
    expect(flightDuration(100000)).toBe(700);
  });
});

describe('the spin', () => {
  // The detail that stops a card snapping when the pile redraws it.
  it('always ends exactly on the angle it has to rest at', () => {
    for (const from of [0, 17, -200, 359, 720]) {
      for (const settle of [0, 15, -30]) {
        const target = spinTarget(from, settle, 1);
        expect(((target - settle) % 360 + 360) % 360).toBeCloseTo(0);
      }
    }
  });

  it('turns about once on the way', () => {
    for (let i = 0; i < 50; i++) {
      const turn = Math.abs(spinTarget(0, 0, 1));
      expect(turn).toBeGreaterThan(300);
      expect(turn).toBeLessThan(420);
    }
  });

  it('can be thrown flat', () => {
    expect(spinTarget(0, 0, 0)).toBe(0);
    expect(spinTarget(90, 0, 0)).toBe(0);
  });

  // Variety comes from the direction, not from fuzzing the angle - fuzzing
  // it would land the card off square and the settle would snap it back.
  it('spins both ways over a run of throws', () => {
    const turns = new Set(Array.from({ length: 40 }, () => spinTarget(0, 0, 1)));
    expect([...turns].sort()).toEqual([-360, 360]);
  });

  it('still ends on the resting angle after several turns', () => {
    for (const spins of [0, 1, 2, 3]) {
      const target = spinTarget(33, -12, spins);
      expect(((target + 12) % 360 + 360) % 360).toBeCloseTo(0);
    }
  });
});

describe('throwing a card', () => {
  it('tweens it to the landing place and settles it upright', async () => {
    const { scene, tweens } = stubScene();
    const card = stubCard(0, 0);
    await throwCard(scene, card, { x: 200, y: 100 });

    expect(tweens).toHaveLength(2);           // the flight, then the landing pop
    expect(tweens[0]['x']).toBe(200);
    expect(tweens[0]['y']).toBe(100);
    expect(card.setAngle).toHaveBeenCalledWith(0);
  });

  it('tells the game when it has landed', async () => {
    const { scene } = stubScene();
    const onLand = vi.fn();
    await throwCard(scene, stubCard(), { x: 10, y: 10 }, { onLand });
    expect(onLand).toHaveBeenCalledOnce();
  });

  it('can be thrown without the landing bounce', async () => {
    const { scene, tweens } = stubScene();
    await throwCard(scene, stubCard(), { x: 10, y: 10 }, { pop: false });
    expect(tweens).toHaveLength(1);
  });
});

describe('dealing several', () => {
  const stack = defineStack({ id: 's', x: 0, y: 0, fan: 'down', step: 20 });

  it('gives every card its own place in the pile', () => {
    expect(landingsFor({ stack, count: 0 }, 3).map((p) => p.y)).toEqual([0, 20, 40]);
  });

  it('deals onto the end of what is already there', () => {
    expect(landingsFor({ stack, count: 2 }, 2).map((p) => p.y)).toEqual([40, 60]);
  });

  it('sends them all to the same spot when the target is a point', () => {
    expect(landingsFor({ x: 5, y: 5 }, 3)).toEqual([
      { x: 5, y: 5 }, { x: 5, y: 5 }, { x: 5, y: 5 },
    ]);
  });

  it('leaves a gap between one card and the next', async () => {
    const { scene, tweens } = stubScene();
    const cards = [stubCard(), stubCard(), stubCard()];
    await dealCards(scene, cards, { stack, count: 0 }, { stagger: 50, pop: false });
    expect(tweens.map((t) => t['delay'])).toEqual([0, 50, 100]);
    expect(tweens.map((t) => t['y'])).toEqual([0, 20, 40]);
  });
});
