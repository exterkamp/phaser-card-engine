import Phaser from 'phaser';

// A card as a sheet of paper rather than a rectangle.
//
// Everything else in this package draws a card as a Container of images and
// text, which is flat by construction: you can move it, turn it and scale it,
// and it stays a rectangle facing the camera. A riffle is the one thing that
// needs more than that. Cards in a riffle are bent - held in a bow under the
// thumb and let go one at a time - and a bend is not a transform.
//
// So for that one gesture a card becomes a Mesh: the same pixels, mapped onto
// a grid whose vertices can be pushed out of the plane. Phaser meshes carry a
// real perspective projection and a model rotation, so the bow is a curve in
// z and the packet's lean is a rotation about y.
//
// The pixels come from a snapshot. Drawing a Container into a RenderTexture
// once and handing the result to every mesh is what keeps this affordable: a
// deck being shuffled is face down, so all fifty-two look the same and there
// is one texture between them.

/**
 * What a card looks like, as a string.
 *
 * A snapshot is a cache, and a cache is only as good as its key. The riffle
 * takes one picture and hands it to all fifty-two, so the key has to cover
 * everything that changes what a card looks like - and the only thing that
 * knows what that is, is the card.
 *
 * Keyed on the size alone, it was wrong the moment a game had two decks: the
 * first pack shuffled at a given width kept its back for every pack after it,
 * so changing deck and shuffling dealt one deck and riffled another.
 */
export interface CardLook {
  readonly look: string;
}

/** A card's own answer, or its size if it has none to give. */
export function lookOf(sprite: Phaser.GameObjects.Container): string {
  return (sprite as Partial<CardLook>).look ?? `${Math.round(sprite.width)}`;
}

/**
 * A card's pixels, as a texture.
 *
 * Keyed by the caller, because what makes two cards look alike is the
 * caller's business - for a shuffle it is that they are all face down, and
 * one snapshot serves the deck. `lookOf` is what to build that key from.
 *
 * Rasterised at the board's pixel ratio, like everything else here, or the
 * mesh would be drawn from a texture at a third of the density of the card
 * beside it.
 */
export function cardSnapshot(
  scene: Phaser.Scene, sprite: Phaser.GameObjects.Container, key: string,
  scale = 1,
): string {
  if (scene.textures.exists(key)) return key;
  const dpr = scale;
  const width = Math.ceil(sprite.width * dpr);
  const height = Math.ceil(sprite.height * dpr);

  // Taken with the card square and upright whatever it is doing on the table,
  // then put back. A snapshot of a card mid-throw would bake its tilt in.
  const was = { angle: sprite.angle, scaleX: sprite.scaleX, scaleY: sprite.scaleY };
  sprite.setAngle(0).setScale(dpr);

  const texture = scene.make.renderTexture({ width, height }, false);
  texture.draw(sprite, width / 2, height / 2);
  texture.saveTexture(key);

  sprite.setAngle(was.angle).setScale(was.scaleX, was.scaleY);
  return key;
}

/** How far a card is bent, and how it is held. */
export interface CardBend {
  /**
   * How deep the bow is, as a fraction of the card's length. 0 is flat.
   *
   * Positive is concave - the middle dips away from the camera and the two
   * short edges come towards it, which is the shape a packet takes when a
   * thumb presses down on the middle of it. Negative domes the other way.
   */
  bow: number;
  /** Radians about the vertical - the packet's lean, left or right. */
  turn?: number;
  /**
   * Radians about the horizontal - how far the card is tipped away from the
   * camera.
   *
   * A board is seen from overhead, and a card bowed towards an overhead
   * camera mostly just gets shorter: the bow is there and there is no angle
   * to read it from. Tipping the card is what turns the curve into something
   * you can see.
   */
  tilt?: number;
}

/**
 * A card-shaped mesh, bowed.
 *
 * The grid runs along the card's length because that is the way a riffled
 * card bends - held at one end and bowed towards the other, not domed. Eight
 * segments is enough for the curve to read as a curve; more is more vertices
 * to move sixty times a second for a shape nobody is measuring.
 */
export function cardPlane(scene: Phaser.Scene, key: string): Phaser.GameObjects.Mesh {
  // No projection set here. A Plane arrives with one that draws its texture
  // at pixel size, and that is what is wanted: the snapshot is taken at the
  // card's own size, so the mesh comes out the size of the card it replaces.
  // Setting a perspective of our own was how this first came out ten times
  // too big.
  // One cell across and many down: a riffled card is held at its short edges
  // and bowed along its length, so that is the axis that needs the vertices.
  // Fourteen of them, because the curve has to read as a curve down the whole
  // card rather than as three flat panels.
  const plane = scene.add.plane(0, 0, key, undefined, 1, SEGMENTS, false);
  plane.hideCCW = false;
  return plane;
}

const SEGMENTS = 14;

/**
 * Bows a plane, by pushing its vertices out of their own plane.
 *
 * A parabola rather than an arc: a card held at both short edges and flexed
 * bends most in the middle and least where it is gripped, which is what
 * `4 * t * (1 - t)` describes. The sign follows the bow, so a packet can be
 * bent towards the table or away from it.
 */
export function bendPlane(plane: Phaser.GameObjects.Mesh, bend: CardBend): void {
  const vertices = plane.vertices;
  if (!vertices.length) return;
  // The span the grid actually occupies, measured rather than assumed: a
  // Plane's own `width` is its size in cells, not in anything you can draw.
  let low = Infinity;
  let high = -Infinity;
  for (const vertex of vertices) {
    low = Math.min(low, vertex.y);
    high = Math.max(high, vertex.y);
  }
  const span = high - low || 1;
  // Negative z towards the camera, so a positive bow dips the middle away
  // and lifts the ends - the dish a packet makes under the thumb, rather
  // than a dome bulging out of the table.
  const depth = -bend.bow * span;
  for (const vertex of vertices) {
    const along = (vertex.y - low) / span;
    vertex.z = depth * 4 * along * (1 - along);
  }
  plane.modelRotation.y = bend.turn ?? 0;
  plane.modelRotation.x = bend.tilt ?? 0;
}
