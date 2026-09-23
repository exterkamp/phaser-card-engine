import Phaser from 'phaser';

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
  scene: Phaser.Types.Scenes.SceneType | Phaser.Types.Scenes.SceneType[];
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
 */
export function boardRoot(scene: Phaser.Scene): Phaser.GameObjects.Container {
  const root = scene.add.container(0, 0);
  root.setScale(boardPixelRatio(scene));
  return root;
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
