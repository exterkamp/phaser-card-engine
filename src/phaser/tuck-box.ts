import Phaser from 'phaser';
import {
  Quad, TuckBoxAtlas, TuckBoxSize, boxQuads, deckBlockSize, deckRise, flapQuads,
  quadVertices, tuckBoxAtlas, tuckBoxSize,
} from '../index.js';
import { boardPixelRatio } from './board.js';
import { TuckBoxArt, renderTuckBox } from './tuck-box-art.js';

// The box a deck comes in, as a thing on the screen.
//
// Everything else this package draws is flat - a card is a Container of
// images, and a Container is a rectangle facing the camera however you turn
// it. A box is the one object here that has a back and two sides you are
// meant to see, so it is a Mesh: real vertices, a real projection, and a
// model rotation that turns it rather than skewing a picture of it.
//
// It is two meshes, in fact, and worth saying why. The box is one, and the
// deck inside it is another: a closed block the size of fifty-two cards, with
// its own cut edges. That block is a stand-in - it is not the cards, which
// are CardSprites and flat - and the swap from one to the other happens at
// the moment the box has turned to face the camera, where a block of cards
// seen head-on and a stack of cards seen head-on are the same picture.
//
// **WebGL only.** Meshes are not drawn at all by the canvas renderer, so
// everything here is a no-op on a fallback context - see `supportsTuckBox`.

/** The lid's resting angle when the box is shut. */
const SHUT = 0;

export interface TuckBoxOptions {
  /** The card the box is cut to fit. Board units, as everything else is. */
  cardWidth?: number;
  cards?: number;
  /** Which deck's artwork is on it, and what that is printed over. */
  art: TuckBoxArt;
  /**
   * How wide the lens is, in degrees.
   *
   * A box is a small object seen close to, which is a short lens: at 45 the
   * near corner runs away from the far one and it reads as a room rather than
   * as something you could pick up. 26 is about what a phone camera does to a
   * thing on a table.
   */
  fov?: number;
}

const DEFAULT_FOV = 26;

/** Which of the three meshes a set of quads is for. */
type Part = 'body' | 'flap' | 'block';

function partQuads(part: Part, size: TuckBoxSize, open: number): Quad[] {
  if (part === 'body') return boxQuads(size);
  if (part === 'flap') return flapQuads(size, open);
  // The deck inside: a closed block with its own cut edge on every side but
  // the one showing the top card's back.
  return boxQuads(size, 'leaves', 'face', 'leaves');
}

/** Whether this renderer can draw one at all. */
export function supportsTuckBox(scene: Phaser.Scene): boolean {
  return scene.game.renderer.type === Phaser.WEBGL;
}

export class TuckBox {
  readonly size: TuckBoxSize;
  readonly block: TuckBoxSize;
  private readonly lidMesh?: Phaser.GameObjects.Mesh;
  private readonly deckMesh?: Phaser.GameObjects.Mesh;
  private readonly boxMesh?: Phaser.GameObjects.Mesh;
  private readonly unit: number;
  private boxAtlas!: TuckBoxAtlas;
  private deckAtlas!: TuckBoxAtlas;
  private readonly home: { x: number; y: number };
  private openAmount = SHUT;

  /** Radians about the vertical, and how fast it is turning. */
  turn = 0;
  tilt = 0;
  spin = 0;

  constructor(
    private readonly scene: Phaser.Scene,
    x: number, y: number,
    options: TuckBoxOptions,
  ) {
    const cardWidth = options.cardWidth ?? 60;
    const cards = options.cards ?? 52;
    this.size = tuckBoxSize(cardWidth, cards);
    this.block = deckBlockSize(cardWidth, cards);

    // A mesh draws in renderer pixels and pays no attention to the container
    // it is in, so everything here is scaled by hand to the same density the
    // board's own root container is scaled by. Without this a box on a 2x
    // screen is half the size of the cards beside it.
    this.unit = boardPixelRatio(scene);
    this.home = { x: x * this.unit, y: y * this.unit };

    if (!supportsTuckBox(scene)) return;

    const fov = options.fov ?? DEFAULT_FOV;
    // Three meshes, back to front, and the order is the whole of what makes
    // this read as one object. Phaser depth-sorts the faces *within* a mesh
    // and not between meshes, so anything that has to pass in front of
    // something else has to be its own mesh added after it.
    //
    //   the lid    swings back behind the box and stays behind the deck
    //   the deck   rises out, in front of the lid and behind the front panel
    //   the body   the front panel, which is what keeps the deck inside
    //
    // As one mesh the lid was drawn over the deck it had just released.
    this.lidMesh = this.build(this.size, { ...options.art, kind: 'box' }, fov, 'flap');
    this.deckMesh = this.build(this.block, { ...options.art, kind: 'deck' }, fov, 'block');
    this.boxMesh = this.build(this.size, { ...options.art, kind: 'box' }, fov, 'body');
    this.update();
  }

  /** The two meshes, for a scene that needs to depth-sort them with the cards. */
  get objects(): Phaser.GameObjects.Mesh[] {
    return [this.lidMesh, this.deckMesh, this.boxMesh]
      .filter(Boolean) as Phaser.GameObjects.Mesh[];
  }

  /** 0 shut, 1 laid back on a broken crease. */
  get open(): number {
    return this.openAmount;
  }

  set open(value: number) {
    this.openAmount = Math.max(0, Math.min(1, value));
    this.update();
  }

  /** Turns the box on the spot, and re-lays it. Call from the scene's update. */
  step(deltaMs: number): void {
    if (this.spin) this.turn += this.spin * (deltaMs / 1000);
    this.update();
  }

  setVisible(visible: boolean): void {
    for (const mesh of this.objects) mesh.setVisible(visible);
  }

  destroy(): void {
    for (const mesh of this.objects) mesh.destroy();
  }

  /** Hides the block of cards, leaving the box - which is now an empty box. */
  showDeck(visible: boolean): void {
    this.deckMesh?.setVisible(visible);
  }

  /**
   * Where the block of cards is on the board, in board units.
   *
   * What a scene needs to know to put real cards exactly where the block had
   * got to. Taken from the mesh's own transformed vertices rather than worked
   * out again here: the projection is the thing that decides where a point
   * ends up, and a second opinion about it is a second opinion that will
   * disagree.
   *
   * The middle of the block rather than its top, because a CardSprite is
   * drawn about its own centre - answering with the top edge put the stack
   * half a card above where the deck actually was, which is a jump.
   */
  deckCentre(): { x: number; y: number } {
    const mesh = this.deckMesh;
    if (!mesh) return { x: this.home.x / this.unit, y: this.home.y / this.unit };
    let x = 0;
    let y = 0;
    for (const vertex of mesh.vertices) {
      x += vertex.vx;
      y += vertex.vy;
    }
    const n = Math.max(1, mesh.vertices.length);
    return { x: (mesh.x + x / n) / this.unit, y: (mesh.y + y / n) / this.unit };
  }

  // --- the mesh ------------------------------------------------------------

  private build(size: TuckBoxSize, art: TuckBoxArt, fov: number,
    part: Part): Phaser.GameObjects.Mesh {
    const key = renderTuckBox(this.scene, size, art);
    const mesh = this.scene.add.mesh(this.home.x, this.home.y, key);

    const quads = partQuads(part, size, SHUT);
    const atlas = tuckBoxAtlas(size, art.scale ?? 6);
    if (part === 'block') this.deckAtlas = atlas; else this.boxAtlas = atlas;

    const { positions, uvs } = quadVertices(quads, atlas, this.unit);
    // No index array. Phaser expands one anyway - a Vertex per index - and
    // handing it triangles directly is the only way the order the vertices
    // end up in is an order this file can write back into later.
    mesh.addVertices(positions, uvs, [], true);
    // A box is solid, so the far side of every panel is a side nobody can
    // see. Culling them is what makes it a box rather than a wireframe of
    // one - and it is why the interior gets panels of its own.
    mesh.hideCCW = true;
    // The vertices move under the mesh's feet every frame the lid is opening,
    // and Phaser's own dirty check cannot see that.
    mesh.ignoreDirtyCache = true;
    mesh.setPerspective(mesh.width, mesh.height, fov);
    // Far enough back that a point at z = 0 lands at exactly its own size in
    // pixels, so the box is as big as the numbers say it is. See the note on
    // `unit` above - everything here is in renderer pixels.
    mesh.panZ(mesh.height / Math.tan((fov * Math.PI) / 360));
    return mesh;
  }

  /** Re-lays both meshes at the current turn, tilt and lid position. */
  private update(): void {
    const { boxMesh, deckMesh, lidMesh } = this;
    if (!boxMesh || !deckMesh || !lidMesh) return;

    write(boxMesh, partQuads('body', this.size, this.openAmount), this.boxAtlas, this.unit);
    write(lidMesh, partQuads('flap', this.size, this.openAmount), this.boxAtlas, this.unit);
    write(deckMesh, partQuads('block', this.block, 0), this.deckAtlas, this.unit);

    for (const mesh of this.objects) {
      mesh.modelRotation.y = this.turn;
      mesh.modelRotation.x = this.tilt;
    }

    // The deck comes straight up out of the box, along the box's own axis
    // rather than up the screen - so it stays in the box while the box is
    // turning, which is the whole difference between a deck coming out and a
    // deck sliding through a wall.
    //
    // Measured from where it starts, which is lying on the bottom of the box
    // rather than centred in it, and stopping with a third of it still in -
    // a deck that clears the box entirely is a deck floating above a box.
    const seated = (this.size.height - this.block.height) / 2;
    const rise = deckRise(this.openAmount) * this.block.height * 0.68;
    deckMesh.modelPosition.y = (rise - seated) * this.unit;
  }
}

/**
 * Pushes a set of quads into a mesh's existing vertices.
 *
 * Positions only - the UVs were settled when the mesh was built and a panel
 * does not move about the texture as a lid opens.
 */
function write(mesh: Phaser.GameObjects.Mesh, quads: Quad[], atlas: TuckBoxAtlas,
  unit: number): void {
  const { positions } = quadVertices(quads, atlas, unit);
  const vertices = mesh.vertices;
  for (let i = 0; i < vertices.length; i++) {
    vertices[i].x = positions[i * 3];
    vertices[i].y = positions[i * 3 + 1];
    vertices[i].z = positions[i * 3 + 2];
  }
}
