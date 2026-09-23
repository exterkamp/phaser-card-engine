import Phaser from 'phaser';
import {
  CARD_HEIGHT,
  CARD_INDEX_FONT,
  CARD_WIDTH,
  Card,
  colourOf,
  deckThemePath,
  isRed,
} from 'phaser-card-engine';

// A card, drawn crudely and on purpose.
//
// The engine ships the art and the vocabulary; it does not yet ship a sprite,
// because the two games' sprites are their most divergent file and merging
// them is a job of its own. So this demo draws its own: a rounded rectangle,
// the index in the corner in the engine's own index face, and the engine's
// suit glyph. Court cards get the real painted art, which is the part worth
// seeing.
const SUIT_FILE: Record<string, string> = {
  spades: 'spade', hearts: 'heart', diamonds: 'diamond', clubs: 'club',
};

const COURT: Record<string, string> = { J: 'jack', Q: 'queen', K: 'king' };

export function preload(scene: Phaser.Scene, theme: string): void {
  for (const [suit, file] of Object.entries(SUIT_FILE)) {
    scene.load.svg(`suit-${suit}`, `/cards/suits/${file}.svg`, { width: 96, height: 96 });
  }
  for (const suit of Object.keys(SUIT_FILE)) {
    for (const [rank, name] of Object.entries(COURT)) {
      scene.load.image(
        `court-${theme}-${rank}-${suit}`,
        deckThemePath(theme as never, `${name}-${suit}.webp`),
      );
    }
  }
}

export class CardView extends Phaser.GameObjects.Container {
  constructor(scene: Phaser.Scene, readonly card: Card) {
    super(scene, 0, 0);

    const ink = isRed(card.suit) ? 0xcf2436 : 0x1a1a1a;
    const face = scene.add.graphics();
    face.fillStyle(0xfdfdfd, 1).fillRoundedRect(
      -CARD_WIDTH / 2, -CARD_HEIGHT / 2, CARD_WIDTH, CARD_HEIGHT, 5,
    );
    face.lineStyle(1, 0x000000, 0.18).strokeRoundedRect(
      -CARD_WIDTH / 2, -CARD_HEIGHT / 2, CARD_WIDTH, CARD_HEIGHT, 5,
    );
    this.add(face);

    const index = scene.add.text(-CARD_WIDTH / 2 + 5, -CARD_HEIGHT / 2 + 4, card.rank, {
      fontFamily: CARD_INDEX_FONT,
      fontSize: '15px',
      fontStyle: '700',
      color: Phaser.Display.Color.IntegerToColor(ink).rgba,
    }).setOrigin(0, 0);
    this.add(index);

    const pipKey = `suit-${card.suit}`;
    const corner = scene.add.image(-CARD_WIDTH / 2 + 12, -CARD_HEIGHT / 2 + 26, pipKey)
      .setDisplaySize(11, 11).setTint(ink);
    this.add(corner);

    const courtKey = COURT[card.rank];
    if (courtKey && scene.textures.exists(`court-${(scene as never as { theme: string }).theme}-${card.rank}-${card.suit}`)) {
      const art = scene.add.image(0, 6, `court-${(scene as never as { theme: string }).theme}-${card.rank}-${card.suit}`);
      art.setDisplaySize(CARD_WIDTH - 10, (CARD_WIDTH - 10) * (art.height / art.width));
      this.add(art);
    } else {
      const big = scene.add.image(2, 8, pipKey).setDisplaySize(26, 26).setTint(ink);
      this.add(big);
    }

    this.setSize(CARD_WIDTH, CARD_HEIGHT);
    scene.add.existing(this);
  }

  /** Whatever the engine says this card's colour is, for the readout. */
  get colour(): string {
    return colourOf(this.card.suit) ?? 'unknown';
  }
}
