import Phaser from 'phaser';
import {
  CARD_HEIGHT,
  Card,
  DEFAULT_DECK_THEME,
  DISPLAY_FONT,
  Hand,
  buildDeck,
  defineHand,
  handPositions,
  shuffle,
  stackDepths,
} from 'phaser-card-engine';
import {
  CardSprite, boardRoot, createBoard, preloadCardArt, throwCard,
} from 'phaser-card-engine/phaser';

// Three hands of the same cards, held three ways.
//
// Mine at the bottom, face up and fanned wide. One across the table, face
// down and turned right over - same primitive, facing 180. And one held
// tight, to show what the grip radius does: the closer the pivot, the harder
// the fan curves.
const WIDTH = 480;
const HEIGHT = 640;

const DECK = { x: 60, y: 300 };

class HandsDemo extends Phaser.Scene {
  private root!: Phaser.GameObjects.Container;
  private deck: CardSprite[] = [];
  private mine!: Hand;
  private theirs!: Hand;
  private held: CardSprite[] = [];
  private opposite: CardSprite[] = [];
  private radius = 260;
  private spread = 70;

  preload(): void {
    preloadCardArt(this, { themes: [DEFAULT_DECK_THEME] });
  }

  create(): void {
    this.cameras.main.setBackgroundColor('#13463a');
    this.root = boardRoot(this);
    this.shape();
    this.newDeck();

    document.getElementById('throw')?.addEventListener('click', () => this.throwOne());
    document.getElementById('take')?.addEventListener('click', () => this.takeOne());
    document.getElementById('reset')?.addEventListener('click', () => this.newDeck());
    document.getElementById('curve')?.addEventListener('click', () => {
      this.radius = this.radius === 260 ? 140 : this.radius === 140 ? 900 : 260;
      this.shape();
      this.layOut();
    });
    document.getElementById('spread')?.addEventListener('click', () => {
      this.spread = this.spread === 70 ? 110 : this.spread === 110 ? 40 : 70;
      this.shape();
      this.layOut();
    });

    this.say(DECK.x, DECK.y - CARD_HEIGHT / 2 - 12, 'Deck');
    this.say(240, 470, 'Your hand');
    this.say(240, 150, 'Across the table');
  }

  /** The two hands, rebuilt whenever the curve or the spread changes. */
  private shape(): void {
    this.mine = defineHand({
      id: 'mine', x: 240, y: 540, step: 9, maxSpread: this.spread, radius: this.radius,
    });
    // The same hand, turned right round. Nothing else changes.
    this.theirs = defineHand({
      id: 'theirs', x: 240, y: 110, step: 9, maxSpread: this.spread, radius: this.radius,
      facing: 180,
    });
  }

  private say(x: number, y: number, text: string): void {
    const label = this.add.text(x, y, text, {
      fontFamily: DISPLAY_FONT, fontSize: '10px', color: '#7fae86',
    }).setOrigin(0.5, 0.5).setDepth(0);
    this.root.add(label);
  }

  private newDeck(): void {
    for (const card of [...this.deck, ...this.held, ...this.opposite]) card.destroy();
    this.held = [];
    this.opposite = [];
    this.deck = shuffle(buildDeck()).map((card: Card, i) => {
      const sprite = new CardSprite(this, { ...card, faceUp: false });
      sprite.setPosition(DECK.x, DECK.y);
      sprite.setDepth(i);
      this.root.add(sprite);
      return sprite;
    });
    this.root.sort('depth');
    this.report();
  }

  // --- the hands -----------------------------------------------------------

  /** Both hands re-fanned around their middles. */
  private layOut(): void {
    for (const [hand, cards, base] of [
      [this.mine, this.held, 2000] as const,
      [this.theirs, this.opposite, 1000] as const,
    ]) {
      const places = handPositions(hand, cards.length);
      const depths = stackDepths(hand, cards.length);
      cards.forEach((card, i) => {
        // Every card moves when one arrives: the fan opens around its middle.
        this.tweens.add({
          targets: card,
          x: places[i].x, y: places[i].y, angle: places[i].angle,
          duration: 160, ease: 'Cubic.easeOut',
        });
        card.setDepth(base + depths[i]);
      });
    }
    this.root.sort('depth');
    this.report();
  }

  private async throwOne(): Promise<void> {
    const card = this.deck.pop();
    if (!card) return this.report('The deck is out.');

    // Mine and theirs alternately, so both fans grow.
    const toMine = this.held.length <= this.opposite.length;
    const hand = toMine ? this.mine : this.theirs;
    const cards = toMine ? this.held : this.opposite;

    card.setDepth(5000);
    this.root.sort('depth');
    // The hand is about to hold one more, so every card in it moves - and the
    // thrown one aims at where it will sit in the hand that includes it.
    cards.push(card);
    this.layOut();
    await throwCard(this, card, { hand, count: cards.length - 1 }, { spins: 1 });
    if (toMine) card.setFaceUp(true);
    this.layOut();
  }

  private takeOne(): void {
    const from = this.held.length >= this.opposite.length ? this.held : this.opposite;
    const card = from.pop();
    if (!card) return;
    card.setFaceUp(false);
    this.tweens.add({
      targets: card, x: DECK.x, y: DECK.y, angle: 0, duration: 220, ease: 'Cubic.easeOut',
    });
    this.deck.push(card);
    this.layOut();
  }

  private report(what = ''): void {
    const note = document.getElementById('note');
    if (!note) return;
    const places = handPositions(this.mine, this.held.length);
    const turn = places.length > 1
      ? Math.round((places[1].angle - places[0].angle) * 10) / 10
      : 0;
    const width = places.length > 1
      ? Math.round(places[places.length - 1].angle - places[0].angle)
      : 0;
    note.textContent = `${what} ${this.held.length} in your hand, `
      + `${this.opposite.length} across the table. Grip ${this.radius} units below, `
      + `spread ${this.spread}° — open ${width}° at ${turn}° a card.`;
  }
}

const game = createBoard({
  parent: 'board',
  width: WIDTH,
  height: HEIGHT,
  backgroundColor: '#13463a',
  scene: HandsDemo,
});

(window as unknown as { __game: Phaser.Game }).__game = game;
