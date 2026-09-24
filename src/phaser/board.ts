import Phaser from 'phaser';
import { Hand, Stack, handPositions, stackDepths } from '../index.js';
import { shortestTurn } from './flight.js';

// A board that is actually as sharp as the screen it is on.
//
// Phaser has no HiDPI support of its own - the old `resolution` config was
// removed years ago - so a game created at 480x720 gets a canvas with a
// 480x720 backing store, and Scale.FIT then stretches that across however
// many device pixels the element covers. On a phone at devicePixelRatio 2
// that is 480 real pixels smeared over 824, and every card on it is an
// upscaled card. Measured on the demo before this existed: 0.62 backing
// pixels per device pixel, against solitaire's 1.17, and the difference is
// visible on anything below about 60 units wide - small cards went soft
// exactly where they could least afford to.
//
// The fix is the one both games arrived at: make the canvas
// `size x pixelRatio` and scale the scene's root container by the same
// factor, so every coordinate in the game stays in logical units and only
// the pixel density goes up.

const PIXEL_RATIO_KEY = 'pce-pixel-ratio';

export interface BoardOptions {
  parent: string | HTMLElement;
  /** The board's size in logical units - the numbers your game thinks in. */
  width: number;
  height: number;
  /**
   * The scene, or scenes. Optional: a game whose scene needs data to start -
   * which deck, which deal, how many cards a draw turns - registers it with
   * `game.scene.add(key, Scene, true, init)` afterwards instead, because a
   * scene listed here is started by Phaser with nothing to go on.
   */
  scene?: Phaser.Types.Scenes.SceneType | Phaser.Types.Scenes.SceneType[];
  backgroundColor?: string;
  /** Defaults to the device's own ratio, which is what you want. */
  pixelRatio?: number;
  /** Anything else, merged last. */
  config?: Partial<Phaser.Types.Core.GameConfig>;
}

export function createBoard(options: BoardOptions): Phaser.Game {
  const pixelRatio = options.pixelRatio ?? window.devicePixelRatio ?? 1;
  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: options.parent as string,
    width: options.width * pixelRatio,
    height: options.height * pixelRatio,
    backgroundColor: options.backgroundColor,
    scale: {
      mode: Phaser.Scale.FIT,
      // Centred by the page rather than by Phaser: autoCenter adds a margin
      // of half the leftover room, which in a parent that is already
      // centring its child puts the board off to one side.
      autoCenter: Phaser.Scale.NO_CENTER,
    },
    // Let Phaser preventDefault the touches it handles, so a drag is not also
    // a page scroll.
    input: { touch: { capture: true } },
    ...options.config,
    scene: options.scene,
  });
  game.registry.set(PIXEL_RATIO_KEY, pixelRatio);
  return game;
}

/** What `createBoard` multiplied this game's canvas by. */
export function boardPixelRatio(scene: Phaser.Scene): number {
  return (scene.registry?.get(PIXEL_RATIO_KEY) as number | undefined)
    ?? window.devicePixelRatio ?? 1;
}

/**
 * A container to put everything in, scaled so that its contents are in
 * logical units.
 *
 * Call it at the top of a scene's `create` and add every card, every slot and
 * every label to what it returns. Anything added to the scene directly is in
 * canvas pixels instead, which on a 2x screen is half the size and in the
 * wrong place.
 *
 * **Depth does not sort itself in here.** A Container paints its children in
 * the order of its own list, and `setDepth` queues a sort of the *Scene's*
 * display list rather than the container's - so a card given a lower depth
 * than the one before it still paints on top. Use `orderStack` below, which
 * is the thing that sorts. This cost a release: the stack order option
 * shipped working, everything moved into a root container for the pixel
 * ratio, and every first-on-top pile silently went back to last-on-top.
 */
export function boardRoot(scene: Phaser.Scene): Phaser.GameObjects.Container {
  const root = scene.add.container(0, 0);
  root.setScale(boardPixelRatio(scene));
  return root;
}

/**
 * Puts one stack's sprites in the order its `order` asks for.
 *
 * Sets each sprite's depth from `stackDepths` and then sorts the container,
 * because a Container will not do the second part on its own - see the note
 * on `boardRoot`.
 *
 * `base` separates one pile from another: give each stack a band of its own
 * (its index times a hundred, say) and piles keep their relative order
 * instead of interleaving wherever two of them overlap. A card in hand wants
 * a base above all of them.
 */
export function orderStack(
  container: Phaser.GameObjects.Container,
  sprites: readonly Phaser.GameObjects.GameObject[],
  stack: Stack,
  base = 0,
): void {
  const depths = stackDepths(stack, sprites.length);
  sprites.forEach((sprite, i) => {
    (sprite as Phaser.GameObjects.Container).setDepth(base + depths[i]);
  });
  container.sort('depth');
}

export interface LayHandOptions {
  /** Depth band for this hand, keeping it clear of other piles. */
  base?: number;
  /** How long the re-fan takes. Zero puts the cards there at once. */
  duration?: number;
  ease?: string;
  /**
   * Cards something else is already moving - a card in flight, on its way
   * into this hand.
   *
   * They are counted in the fan, so the rest make room for them, and they are
   * given their depth, but they are not tweened. Without this the throw and
   * the re-fan both animate the same sprite and fight over it, which looks
   * like the card stuttering as it arrives.
   */
  except?: readonly Phaser.GameObjects.GameObject[];
}

/**
 * Re-fans a hand: every card to its place, turned the short way, in order.
 *
 * A hand opens around its middle, so a card arriving moves every card already
 * in it - this is the function that moves them. Two things it does that are
 * easy to leave out:
 *
 * It turns each card the short way. Phaser wraps `angle` to ±180 and the
 * geometry does not, so a hand facing across the table asks a card reporting
 * -171 to go to 189, and a plain tween takes the long way round - a full spin
 * on a card that only needed five degrees. See `shortestTurn`.
 *
 * And it sorts the container afterwards, because depth inside a Container is
 * a list order rather than a number. See `orderStack`, which is the same
 * point.
 */
export function layHand(
  scene: Phaser.Scene,
  container: Phaser.GameObjects.Container,
  sprites: readonly Phaser.GameObjects.Container[],
  hand: Hand,
  options: LayHandOptions = {},
): void {
  const places = handPositions(hand, sprites.length);
  const depths = stackDepths(hand, sprites.length);
  const duration = options.duration ?? 160;

  sprites.forEach((sprite, i) => {
    const place = places[i];
    sprite.setDepth((options.base ?? 0) + depths[i]);
    if (options.except?.includes(sprite)) return;
    if (duration <= 0) {
      sprite.setPosition(place.x, place.y);
      sprite.setAngle(place.angle);
      return;
    }
    scene.tweens.add({
      targets: sprite,
      x: place.x,
      y: place.y,
      angle: shortestTurn(sprite.angle, place.angle),
      duration,
      ease: options.ease ?? 'Cubic.easeOut',
    });
  });
  container.sort('depth');
}

/**
 * Where a pointer is, in logical units.
 *
 * Phaser reports pointers in canvas pixels, which are `pixelRatio` times the
 * units everything else in the scene is measured in. Forgetting this is a
 * drag that follows the finger at twice the distance.
 */
export function toBoard(scene: Phaser.Scene, pointer: Phaser.Input.Pointer): { x: number; y: number } {
  const ratio = boardPixelRatio(scene);
  return { x: pointer.worldX / ratio, y: pointer.worldY / ratio };
}
