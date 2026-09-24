import Phaser from 'phaser';
import { Stack, riffleSplit, stackPositions } from '../index.js';
import { orderStack } from './board.js';
import { bendPlane, cardPlane, cardSnapshot, lookOf } from './card-mesh.js';

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
//
// The cards bend while it happens, and that needs them to stop being sprites
// for a moment. A Container is flat by construction - it can be moved, turned
// and scaled, and it is still a rectangle facing the camera - so for the
// length of the shuffle each card is swapped for a mesh carrying the same
// pixels, and the mesh is what gets bowed, tipped and turned. See
// card-mesh.ts. They are swapped back at the end, and nothing outside this
// file ever sees one.

export interface RiffleOptions {
  /** How many times. Default one. */
  rounds?: number;
  /** How far the two packets part, either side of the stack. Default 54. */
  spread?: number;
  /** Milliseconds for the cut, and for the bow. Default 170. */
  duration?: number;
  /** Milliseconds between one card springing free and the next. Default 9. */
  stagger?: number;
  /** How far a card lifts on its way over. Default 14. */
  lift?: number;
  /**
   * How deep the top of each packet bows, as a fraction of a card's length.
   * Positive is concave - the middle dips away and the ends come up. Default
   * 0.3. Much past that the curve overshoots the camera and folds.
   */
  bow?: number;
  /** How far the cards are tipped away from the camera. Default 0.62 rad. */
  tilt?: number;
  /** How far each packet leans. Default 0.34 rad. */
  turn?: number;
  /** Where the randomness comes from. Default Math.random. */
  random?: () => number;
}

/** A card, while it is being bent: the sprite it stands in for, and its mesh. */
interface Bent {
  sprite: Phaser.GameObjects.Container;
  mesh: Phaser.GameObjects.Mesh;
  bow: number;
  turn: number;
  tilt: number;
  /**
   * How near the top of its packet this card is, 0 at the bottom and 1 at the
   * top. The cards under the thumb take most of the bend and the ones at the
   * bottom of the packet barely flex, so the card you can actually see - the
   * one on top - is the one that shows the curve.
   */
  reach: number;
}

/**
 * Riffles a pile, and resolves when it is squared up again.
 *
 * Cosmetic from end to end: the sprites are in the order the game put them
 * in, and they are in that same order when this resolves. What happens in
 * between is the pack cutting in two, both halves bowing under the thumbs,
 * and the cards springing off one at a time into a single pile.
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
  const spread = options.spread ?? 54;
  const duration = options.duration ?? 170;
  const stagger = options.stagger ?? 9;
  const lift = options.lift ?? 14;
  const bow = options.bow ?? 0.3;
  const tilt = options.tilt ?? 0.62;
  const turn = options.turn ?? 0.34;
  const random = options.random ?? Math.random;
  if (sprites.length < 2) return;

  // A mesh is a WebGL object and draws nothing under Phaser's canvas
  // fallback. Since the first thing this does is hide the sprites, going
  // ahead there would empty the table for the length of the shuffle - so on
  // canvas there is no shuffle, and the cards stay where they are.
  if (scene.game.renderer.type !== Phaser.WEBGL) return;

  const home = stackPositions(stack, sprites.length);
  const scale = meshScale(scene, container);
  const bent = lift$(scene, sprites, scale);
  try {
    for (let round = 0; round < rounds; round++) {
      const split = riffleSplit(sprites.length, random);
      await cut(scene, bent, split, stack, scale, { spread, duration, tilt, turn });
      await bowPackets(scene, bent, duration, bow, tilt);
      await spring(scene, bent, home, scale, { duration, stagger, lift });
    }
  } finally {
    drop$(bent);
  }
  orderStack(container, sprites, stack);
}

// --- the swap -------------------------------------------------------------

/**
 * How many renderer pixels to a board unit, and where the board's origin is.
 *
 * Meshes draw their texture at renderer pixels and take no notice of the
 * container a card lives in, so everything here works in the renderer's own
 * coordinates and converts on the way in.
 */
function meshScale(
  scene: Phaser.Scene, container: Phaser.GameObjects.Container,
): { k: number; x: number; y: number } {
  const matrix = container.getWorldTransformMatrix();
  return { k: matrix.scaleX || 1, x: matrix.tx, y: matrix.ty };
}

/** Each card, as a mesh, with the sprite hidden behind it. */
function lift$(
  scene: Phaser.Scene,
  sprites: readonly Phaser.GameObjects.Container[],
  scale: { k: number; x: number; y: number },
): Bent[] {
  return sprites.map((sprite, i) => {
    // One snapshot between them. A pack being shuffled is face down, so every
    // card in it looks the same and the texture is taken once.
    //
    // Keyed on what the card looks like and not on how big it is. On the size
    // alone, the first pack shuffled kept its back for every pack after it at
    // that width - so a game with more than one deck dealt one and riffled
    // another, and the only way to see it was to change deck and shuffle.
    const key = cardSnapshot(scene, sprite, `pce-riffle-${lookOf(sprite)}`, scale.k);
    const mesh = cardPlane(scene, key);
    mesh.setPosition(scale.x + sprite.x * scale.k, scale.y + sprite.y * scale.k);
    mesh.setDepth(RIFFLE_DEPTH + i);
    sprite.setVisible(false);
    return { sprite, mesh, bow: 0, turn: 0, tilt: 0, reach: 1 };
  });
}

/** Sprites back, meshes gone. */
function drop$(bent: readonly Bent[]): void {
  for (const card of bent) {
    card.sprite.setVisible(true);
    card.mesh.destroy();
  }
}

/**
 * Where a riffle draws: above the felt and the cards, for as long as it lasts.
 *
 * Exported because the two bands are the only thing keeping the pile behind
 * the packets, and a check that wants to know whether they still are has to
 * be able to tell one from the other.
 */
export const RIFFLE_DEPTH = 10_000;
/**
 * And above that again for a card still in a hand.
 *
 * A card that has landed takes its place in the pile by depth, and the pile
 * grows past fifty - so without a band of its own, a packet of twenty-six
 * ends up *underneath* the pile it is dropping onto, about halfway through.
 */
export const RIFFLE_HAND_DEPTH = RIFFLE_DEPTH + 1_000;

// --- the three movements --------------------------------------------------

/** The cut: two packets, parted and leaning away from each other. */
function cut(
  scene: Phaser.Scene,
  bent: readonly Bent[],
  split: { left: number[]; right: number[] },
  stack: Stack,
  scale: { k: number; x: number; y: number },
  how: { spread: number; duration: number; tilt: number; turn: number },
): Promise<void> {
  const moves: Promise<void>[] = [];
  const packet = (indices: number[], side: number) => {
    indices.forEach((at, depth) => {
      const card = bent[at];
      card.reach = indices.length > 1 ? depth / (indices.length - 1) : 1;
      // Drawn in packet order while they are apart, so the card on top of
      // each half is the one in front - which is the one bent hardest, and
      // the only one whose whole length you can see. In the in-hand band, so
      // the whole packet stays over the pile until its cards land.
      card.mesh.setDepth(RIFFLE_HAND_DEPTH + depth);
      moves.push(bendTo(scene, card, {
        x: scale.x + (stack.x + side * how.spread) * scale.k,
        // A shallow lean down the packet, so it reads as a stack of cards in
        // a hand rather than as one card sliding sideways.
        y: scale.y + (stack.y + depth * 0.5) * scale.k,
        tilt: how.tilt,
        turn: side * how.turn,
        bow: 0,
        duration: how.duration,
        ease: 'Cubic.easeOut',
      }));
    });
  };
  packet(split.left, -1);
  packet(split.right, 1);
  return Promise.all(moves).then(() => undefined);
}

/** The bow: both halves flexed under the thumbs, ready to go. */
function bowPackets(
  scene: Phaser.Scene, bent: readonly Bent[], duration: number, bow: number,
  tilt: number,
): Promise<void> {
  return Promise.all(bent.map((card) => bendTo(scene, card, {
    // Tipped further as they flex. A bow seen flat-on is a change of outline
    // and not much else; the angle is what turns it into a curve you can
    // follow down the card.
    tilt: tilt * 1.15,
    // Least at the bottom of the packet, most at the top. A packet held in
    // one hand is not bent evenly - the thumb is on the top of it - and the
    // top card is the only one anybody can see the whole of. Not flat at the
    // bottom either: a half-deck under a thumb is bent all the way through.
    bow: bow * (0.55 + 0.45 * card.reach),
    duration: duration * 0.8,
    ease: 'Quad.easeOut',
  }))).then(() => undefined);
}

/** The release: cards spring flat as they fall, in the order they fell. */
function spring(
  scene: Phaser.Scene,
  bent: readonly Bent[],
  home: readonly { x: number; y: number }[],
  scale: { k: number; x: number; y: number },
  how: { duration: number; stagger: number; lift: number },
): Promise<void> {
  return Promise.all(bent.map((card, at) => bendTo(scene, card, {
    x: scale.x + home[at].x * scale.k,
    y: scale.y + (home[at].y - how.lift) * scale.k,
    bow: 0,
    turn: 0,
    tilt: 0,
    delay: at * how.stagger,
    duration: how.duration,
    ease: 'Quad.easeIn',
    // The lift is taken back on arrival rather than tweened out, so the card
    // drops the last few units instead of easing into the pile.
    // Out of the hand and into the pile, in one step: the card leaves the
    // band that draws over everything and takes its place in the pile.
    onComplete: () => {
      card.mesh.y = scale.y + home[at].y * scale.k;
      card.mesh.setDepth(RIFFLE_DEPTH + at);
    },
  }))).then(() => undefined);
}

// --- one tween, over a mesh -----------------------------------------------

/**
 * Tweens a card's shape and place together.
 *
 * The bend is not a property Phaser can tween - it is a pile of vertices - so
 * the tween runs a number from 0 to 1 and the vertices are rebuilt from it on
 * every frame. Which is the whole reason this file has its own tween helper
 * rather than using flight.ts's.
 */
function bendTo(
  scene: Phaser.Scene,
  card: Bent,
  to: {
    x?: number; y?: number; bow?: number; turn?: number; tilt?: number;
    duration: number; delay?: number; ease?: string; onComplete?: () => void;
  },
): Promise<void> {
  const from = { bow: card.bow, turn: card.turn, tilt: card.tilt };
  const want = {
    bow: to.bow ?? card.bow,
    turn: to.turn ?? card.turn,
    tilt: to.tilt ?? card.tilt,
  };
  return new Promise((resolve) => {
    const config: Record<string, unknown> = {
      targets: { t: 0 },
      t: 1,
      duration: to.duration,
      delay: to.delay ?? 0,
      ease: to.ease ?? 'Linear',
      onUpdate: (_tween: unknown, target: { t: number }) => {
        const t = target.t;
        card.bow = from.bow + (want.bow - from.bow) * t;
        card.turn = from.turn + (want.turn - from.turn) * t;
        card.tilt = from.tilt + (want.tilt - from.tilt) * t;
        bendPlane(card.mesh, { bow: card.bow, turn: card.turn, tilt: card.tilt });
      },
      onComplete: () => {
        card.bow = want.bow;
        card.turn = want.turn;
        card.tilt = want.tilt;
        bendPlane(card.mesh, want);
        to.onComplete?.();
        resolve();
      },
    };
    scene.tweens.add(config as Phaser.Types.Tweens.TweenBuilderConfig);
    // The mesh's own position is a plain tween and can go in parallel.
    if (to.x !== undefined || to.y !== undefined) {
      scene.tweens.add({
        targets: card.mesh,
        ...(to.x !== undefined ? { x: to.x } : {}),
        ...(to.y !== undefined ? { y: to.y } : {}),
        duration: to.duration,
        delay: to.delay ?? 0,
        ease: to.ease ?? 'Linear',
      } as Phaser.Types.Tweens.TweenBuilderConfig);
    }
  });
}
