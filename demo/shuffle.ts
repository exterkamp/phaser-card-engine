import Phaser from 'phaser';
import './serve';
import {
  CARD_WIDTH, Card, DEFAULT_DECK_THEME, Stack, defineStack, shuffledDeck,
} from 'phaser-card-engine';
import {
  CardSprite, RIFFLE_HAND_DEPTH, boardPixelRatio, boardRoot, createBoard,
  orderStack, preloadCardArt, riffleShuffle,
} from 'phaser-card-engine/phaser';

// A riffle, on its own and slow enough to watch.
const WIDTH = 480;
const HEIGHT = 420;
const DECK: Stack = defineStack({ id: 'deck', x: 240, y: 210 });

class Bench extends Phaser.Scene {
  root!: Phaser.GameObjects.Container;
  cards: CardSprite[] = [];
  busy = false;
  seen = { meshes: 0, spread: 0, bow: 0, over: 0 };
  peak = '';
  late = '';

  preload(): void {
    preloadCardArt(this, { themes: [DEFAULT_DECK_THEME] });
  }

  create(): void {
    this.cameras.main.setBackgroundColor('#13463a');
    this.root = boardRoot(this);
    this.lay();

    document.getElementById('riffle')?.addEventListener('click', () => void this.go(1));
    document.getElementById('slow')?.addEventListener('click', () => void this.go(1, 3));
    document.getElementById('twice')?.addEventListener('click', () => void this.go(2));
    document.getElementById('reset')?.addEventListener('click', () => this.lay());
  }

  private lay(): void {
    for (const card of this.cards) card.destroy();
    this.cards = shuffledDeck().map((card: Card) => {
      const sprite = new CardSprite(this, { ...card, faceUp: false }, { width: CARD_WIDTH });
      sprite.setPosition(DECK.x, DECK.y);
      this.root.add(sprite);
      return sprite;
    });
    orderStack(this.root, this.cards, DECK);
    this.say(`${this.cards.length} cards, squared.`);
  }

  async go(rounds: number, slow = 1): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    const before = this.cards.map((c) => c.card.id).join();
    const started = performance.now();
    // Watched from in here, because what the animation does between frames is
    // not something a probe on the other end of a socket can see.
    let meshes = 0;
    let spread = 0;
    let bow = 0;
    let over = 0;
    const dpr = boardPixelRatio(this);
    const watch = setInterval(() => {
      const planes = this.children.list.filter(
        (o) => o.type === 'Mesh' || o.type === 'Plane',
      ) as Phaser.GameObjects.Mesh[];
      meshes = Math.max(meshes, planes.length);
      if (!planes.length) return;
      const xs = planes.map((m) => m.x);
      const apart = Math.max(...xs) - Math.min(...xs);
      const deep = Math.max(...planes.map(
        (m) => Math.max(...m.vertices.map((v) => Math.abs(v.z)))));
      spread = Math.max(spread, apart);
      bow = Math.max(bow, deep);

      // A card that has landed must never draw over one still in a hand. The
      // pile grows past fifty and a packet is only twenty-six deep, so if the
      // two share a depth range the pile climbs in front of the packets about
      // halfway through - which is exactly what it did.
      // A card still in flight is already over the pile while it is on its
      // way down, so position alone cannot tell it from one that has landed.
      // The depth band can: it keeps its in-hand depth until it arrives.
      const mid = DECK.x * dpr;
      const landed = planes.filter(
        (m) => Math.abs(m.x - mid) < 8 * dpr && m.depth < RIFFLE_HAND_DEPTH,
      );
      const inHand = planes.filter((m) => Math.abs(m.x - mid) > 30 * dpr);
      if (landed.length && inHand.length) {
        const highestLanded = Math.max(...landed.map((m) => m.depth));
        const lowestInHand = Math.min(...inHand.map((m) => m.depth));
        if (highestLanded > lowestInHand) over += 1;
        // A still from late in the drop, when the pile is deep and there are
        // still cards in hand - the moment the two can argue about which is
        // in front.
        if (!this.late && landed.length > planes.length * 0.55) {
          this.game.renderer.snapshot((image) => {
            this.late = (image as HTMLImageElement).src ?? '';
          });
        }
      }
      // A still of the widest, deepest moment, taken from in here. A
      // screenshot driven from outside lands wherever the round trip puts it,
      // which for a two-second animation is usually after it.
      if (apart >= spread && deep >= bow * 0.9) {
        this.game.renderer.snapshot((image) => {
          this.peak = (image as HTMLImageElement).src ?? '';
        });
      }
    }, 16);
    await riffleShuffle(this, this.root, this.cards, DECK, {
      rounds,
      duration: 240 * slow,
      stagger: 11 * slow,
    });
    clearInterval(watch);
    this.seen = {
      meshes, spread: Math.round(spread), bow: Number(bow.toFixed(2)), over,
    };
    const kept = this.cards.map((c) => c.card.id).join() === before;
    this.say(`${rounds} riffle${rounds > 1 ? 's' : ''} in `
      + `${Math.round(performance.now() - started)}ms — `
      + `${this.seen.meshes} cards bent, parted ${this.seen.spread}px, bow ${this.seen.bow}`
      + `${this.seen.over ? `, PILE OVER THE PACKETS ${this.seen.over}x` : ''}. `
      + `The deck is ${kept ? 'in the order it was already in' : 'REORDERED, which is a bug'}.`);
    this.busy = false;
  }

  private say(text: string): void {
    const note = document.getElementById('note');
    if (note) note.textContent = text;
  }
}

const game = createBoard({
  parent: 'board', width: WIDTH, height: HEIGHT,
  backgroundColor: '#13463a', scene: Bench,
});
(window as unknown as { __game: Phaser.Game }).__game = game;
