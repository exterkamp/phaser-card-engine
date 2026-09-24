import type Phaser from 'phaser';
import { Stack, riffleSplit, stackPositions } from '../index.js';
import { orderStack } from './board.js';

// Shuffling, as a thing you can watch.
//
// The deck is already shuffled before any of this runs - `shuffle` did it,
// against whatever random the game handed it, and that is the only thing that
// decides what order the cards are in. This animates a riffle that *arrives*
// at the order they are already in: `riffleSplit` works backwards from the
// finished deck to a pair of packets and a drop order that would produce it,
// and the cards then go where that says.
//
// Which sounds like a lot of care for something nobody checks. It is the
// difference between an animation and a lie, though, and the lie is the kind
// that shows: a shuffle that dealt the cards somewhere other than where they
// ended up would leave the top card of the pile not being the card that gets
// dealt first.

export interface RiffleOptions {
  /** How many times. Default one. */
  rounds?: number;
  /** How far the two packets part, either side of the stack. Default 46. */
  spread?: number;
  /** Milliseconds for the packets to part, and to come back. Default 170. */
  duration?: number;
  /** Milliseconds between one card dropping and the next. Default 9. */
  stagger?: number;
  /** How far a card lifts on its way over. Default 14. */
  lift?: number;
  /** Where the randomness comes from. Default Math.random. */
  random?: () => number;
}

/**
 * Riffles a pile, and resolves when it is squared up again.
 *
 * Cosmetic from end to end: the sprites are in the order the game put them
 * in, and they are in that same order when this resolves. What happens in
 * between is the two packets parting, the cards dropping back together in
 * runs, and the pile squaring.
 *
 * The stagger is what carries it. Fifty-two cards at 9ms each is under half a
 * second for the drop, which is about as long as a riffle takes - and a card
 * game that makes you wait longer than the thing it is imitating has stopped
 * being a convenience.
 */
export async function riffleShuffle(
  scene: Phaser.Scene,
  container: Phaser.GameObjects.Container,
  sprites: readonly Phaser.GameObjects.Container[],
  stack: Stack,
  options: RiffleOptions = {},
): Promise<void> {
  const rounds = options.rounds ?? 1;
  const spread = options.spread ?? 46;
  const duration = options.duration ?? 170;
  const stagger = options.stagger ?? 9;
  const lift = options.lift ?? 14;
  const random = options.random ?? Math.random;
  if (sprites.length < 2) return;

  const home = stackPositions(stack, sprites.length);
  for (let round = 0; round < rounds; round++) {
    const split = riffleSplit(sprites.length, random);
    await part(scene, sprites, split, stack, spread, duration);
    await drop(scene, container, sprites, split, home, duration, stagger, lift);
  }
  orderStack(container, sprites, stack);
}

/** The cut: two packets, one either side, each a shallow pile of its own. */
function part(
  scene: Phaser.Scene,
  sprites: readonly Phaser.GameObjects.Container[],
  split: { left: number[]; right: number[] },
  stack: Stack,
  spread: number,
  duration: number,
): Promise<void> {
  const moves: Promise<void>[] = [];
  const packet = (indices: number[], side: number) => {
    indices.forEach((at, depth) => {
      moves.push(tween(scene, sprites[at], {
        // A shallow lean rather than a squared block, so a packet reads as
        // cards in a hand rather than as half a deck sliding sideways.
        x: stack.x + side * spread,
        y: stack.y + depth * 0.35,
        angle: side * 4,
        duration,
        ease: 'Cubic.easeOut',
      }));
    });
  };
  packet(split.left, -1);
  packet(split.right, 1);
  return Promise.all(moves).then(() => undefined);
}

/** The drop: back together, in the order the split says they fell. */
function drop(
  scene: Phaser.Scene,
  container: Phaser.GameObjects.Container,
  sprites: readonly Phaser.GameObjects.Container[],
  split: { from: ('left' | 'right')[] },
  home: readonly { x: number; y: number }[],
  duration: number,
  stagger: number,
  lift: number,
): Promise<void> {
  const moves = sprites.map((sprite, at) => {
    const place = home[at];
    return tween(scene, sprite, {
      x: place.x,
      y: place.y,
      angle: 0,
      delay: at * stagger,
      duration,
      ease: 'Quad.easeIn',
      onStart: () => {
        // Up and over the pile it is joining. Without this a card slides
        // under the one before it and the whole thing reads as a fan closing.
        sprite.y -= lift;
      },
      // Each card lands on top of the one before it, which is what a pile
      // being assembled looks like. The final order is set once at the end
      // by orderStack - this is only what happens on the way.
      onComplete: () => container.bringToTop(sprite),
    });
  });
  return Promise.all(moves).then(() => undefined);
}

/** One tween, as a promise. */
function tween(
  scene: Phaser.Scene,
  target: Phaser.GameObjects.Container,
  config: Record<string, unknown>,
): Promise<void> {
  return new Promise((resolve) => {
    const done = config['onComplete'] as (() => void) | undefined;
    scene.tweens.add({
      ...config,
      targets: target,
      onComplete: () => {
        done?.();
        resolve();
      },
    } as Phaser.Types.Tweens.TweenBuilderConfig);
  });
}
