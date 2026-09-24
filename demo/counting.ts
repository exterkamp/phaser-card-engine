import Phaser from 'phaser';
import './serve';
import {
  CARD_HEIGHT,
  CARD_WIDTH,
  Card,
  COURT_PALETTES,
  DEFAULT_DECK_THEME,
  DISPLAY_FONT,
  Rank,
  buildDeck,
  shuffle,
} from 'phaser-card-engine';
import {
  CardSprite, boardRoot, createBoard, preloadCardArt, renderCourts, throwCard,
} from 'phaser-card-engine/phaser';

// Card counting practice, Hi-Lo system.
//
// The count is the whole game: 2-6 count +1, 7-9 count 0, 10-A count -1.
// Cards come out of the shoe one at a time and the player keeps the running
// count in their head, then checks themselves whenever they like. Nothing
// here is engine logic - the engine does not know what counting is - so the
// values live in this demo, next to the felt they are practiced on.
const WIDTH = 480;
const HEIGHT = 640;

const SPEEDS = {
  manual: 0,
  slow: 1600,
  medium: 900,
  fast: 450,
} as const;
type Speed = keyof typeof SPEEDS;

function hiLo(rank: Rank): number {
  switch (rank) {
    case '2':
    case '3':
    case '4':
    case '5':
    case '6':
      return 1;
    case '7':
    case '8':
    case '9':
      return 0;
    default:
      return -1;
  }
}

class CountingDemo extends Phaser.Scene {
  private root!: Phaser.GameObjects.Container;
  private shoe: Card[] = [];
  private shoeBacks: CardSprite[] = [];
  private current: CardSprite | undefined;
  private history: CardSprite[] = [];
  private count = 0;
  private dealt = 0;
  private correct = 0;
  private checks = 0;
  private streak = 0;
  private best = 0;
  private speed: Speed = 'manual';
  private timer: Phaser.Time.TimerEvent | undefined;
  private dealing = false;
  private decks = 6;

  private shoeLabel!: Phaser.GameObjects.Text;
  private dealtLabel!: Phaser.GameObjects.Text;
  private note!: Phaser.GameObjects.Text;

  preload(): void {
    preloadCardArt(this, { themes: [DEFAULT_DECK_THEME] });
  }

  create(): void {
    this.cameras.main.setBackgroundColor('#13463a');
    void renderCourts(this, COURT_PALETTES[DEFAULT_DECK_THEME]);
    this.root = boardRoot(this);

    this.printFelt();
    this.bindControls();
    this.newShoe();
  }

  // --- the table -----------------------------------------------------------

  private printFelt(): void {
    const label = (x: number, y: number, text: string) => {
      const t = this.add.text(x, y, text, {
        fontFamily: DISPLAY_FONT, fontSize: '11px', color: '#7fae86',
      }).setOrigin(0.5, 0.5);
      this.root.add(t);
      return t;
    };
    label(72, 34, 'SHOE');
    label(WIDTH - 72, 34, 'DEALT');
    label(WIDTH / 2, 148, 'CURRENT CARD');
    label(WIDTH / 2, 468, 'LAST TEN');

    this.shoeLabel = this.add.text(72, 150, '', {
      fontFamily: DISPLAY_FONT, fontSize: '13px', color: '#fdfdfd',
    }).setOrigin(0.5, 0.5);
    this.root.add(this.shoeLabel);

    this.dealtLabel = this.add.text(WIDTH - 72, 150, '', {
      fontFamily: DISPLAY_FONT, fontSize: '13px', color: '#fdfdfd',
    }).setOrigin(0.5, 0.5);
    this.root.add(this.dealtLabel);

    this.note = this.add.text(WIDTH / 2, 610, '', {
      fontFamily: DISPLAY_FONT, fontSize: '11px', color: '#ffd166',
    }).setOrigin(0.5, 0.5);
    this.root.add(this.note);

    // Outlines where the shoe and the discard tray live.
    for (const x of [72, WIDTH - 72]) {
      const g = this.add.graphics();
      g.lineStyle(1.5, 0xcfead0, 0.25);
      g.strokeRoundedRect(x - CARD_WIDTH / 2, 90 - CARD_HEIGHT / 2, CARD_WIDTH, CARD_HEIGHT, 5);
      this.root.add(g);
    }
  }

  // --- the shoe ------------------------------------------------------------

  private newShoe(): void {
    this.stopAuto();
    for (const sprite of [...this.shoeBacks, ...this.history]) sprite.destroy();
    this.current?.destroy();
    this.shoeBacks = [];
    this.history = [];
    this.current = undefined;

    const cards: Card[] = [];
    for (let d = 0; d < this.decks; d++) cards.push(...buildDeck());
    this.shoe = shuffle(cards, Math.random);
    this.count = 0;
    this.dealt = 0;

    // The shoe reads as a shoe: a short stack of backs, offset by a pixel.
    const shown = Math.min(6, this.shoe.length);
    for (let i = 0; i < shown; i++) {
      const back = new CardSprite(this, {
        id: `shoe-${i}`, suit: 'spades', rank: 'A', faceUp: false,
      });
      back.setPosition(72 + i, 90 + i);
      this.root.add(back);
      this.shoeBacks.push(back);
    }
    this.refreshLabels();
    this.setNote(`${this.decks} deck${this.decks > 1 ? 's' : ''} shuffled. Keep the count, then check yourself.`);
    this.hideQuiz();
  }

  private take(): Card | undefined {
    const card = this.shoe.pop();
    const back = this.shoeBacks.pop();
    back?.destroy();
    // Keep the shoe looking full until it is nearly out.
    if (this.shoeBacks.length === 0 && this.shoe.length > 0) {
      const top = new CardSprite(this, {
        id: 'shoe-top', suit: 'spades', rank: 'A', faceUp: false,
      });
      top.setPosition(72, 90);
      this.root.add(top);
      this.shoeBacks.push(top);
    }
    return card;
  }

  // --- dealing -------------------------------------------------------------

  private async deal(): Promise<void> {
    if (this.dealing) return;
    const card = this.take();
    if (!card) {
      this.setNote('The shoe is empty - start a new shoe.');
      this.stopAuto();
      return;
    }
    this.dealing = true;

    // The old current card joins the history strip, small; the strip is
    // reflowed every deal so the oldest card leaving never strands the rest
    // off the right edge of the board.
    if (this.current) {
      this.history.push(this.current);
      if (this.history.length > 10) this.history.shift()?.destroy();
      this.history.forEach((sprite, slot) => {
        this.tweens.add({
          targets: sprite,
          x: 34 + slot * 44,
          y: 528,
          scale: 0.42,
          duration: 220,
          ease: 'Quad.easeOut',
        });
      });
    }

    const sprite = new CardSprite(this, { ...card, faceUp: true });
    sprite.setPosition(72, 90);
    sprite.setScale(1.7);
    this.root.add(sprite);
    await throwCard(this, sprite, { x: WIDTH / 2, y: 300 }, {
      spins: 1, settleScale: 1.7, duration: 320,
    });
    this.current = sprite;

    this.count += hiLo(card.rank);
    this.dealt++;
    this.refreshLabels();
    this.dealing = false;
  }

  private setSpeed(speed: Speed): void {
    this.speed = speed;
    this.stopAuto();
    document.querySelectorAll<HTMLButtonElement>('[data-speed]').forEach((b) => {
      b.classList.toggle('on', b.dataset['speed'] === speed);
    });
    const dealButton = document.getElementById('deal');
    if (dealButton) dealButton.textContent = speed === 'manual' ? 'Deal (space)' : 'Pause';
    if (speed !== 'manual' && this.shoe.length > 0) {
      this.timer = this.time.addEvent({
        delay: SPEEDS[speed], loop: true, callback: () => void this.deal(),
      });
      void this.deal();
    }
  }

  private stopAuto(): void {
    this.timer?.remove(false);
    this.timer = undefined;
  }

  // --- the quiz ------------------------------------------------------------

  private check(): void {
    if (this.dealt === 0) {
      this.setNote('Deal some cards first - there is nothing to count yet.');
      return;
    }
    const wasAuto = this.speed !== 'manual';
    this.stopAuto();
    const panel = document.getElementById('quiz');
    if (panel) panel.style.display = 'block';
    const guess = document.getElementById('guess');
    if (guess) guess.textContent = '0';
    const result = document.getElementById('result');
    if (result) result.textContent = '';
    const reveal = document.getElementById('reveal');
    if (reveal) reveal.style.display = '';
    if (wasAuto) panel?.setAttribute('data-resume', this.speed);
  }

  private hideQuiz(): void {
    const panel = document.getElementById('quiz');
    if (panel) panel.style.display = 'none';
  }

  private reveal(): void {
    const guessEl = document.getElementById('guess');
    const guess = Number(guessEl?.textContent ?? '0');
    const result = document.getElementById('result');
    this.checks++;
    if (guess === this.count) {
      this.correct++;
      this.streak++;
      this.best = Math.max(this.best, this.streak);
      if (result) result.textContent = `Right - the count is ${this.count}. Streak: ${this.streak}.`;
      if (result) result.className = 'good';
    } else {
      this.streak = 0;
      if (result) {
        result.textContent = `Not quite - you said ${guess}, the count is ${this.count}. ` +
          `Review the last cards and try again.`;
      }
      if (result) result.className = 'bad';
    }
    const reveal = document.getElementById('reveal');
    if (reveal) reveal.style.display = 'none';
    this.refreshLabels();
    // Pick the deal back up where it left off.
    const panel = document.getElementById('quiz');
    const resume = panel?.getAttribute('data-resume') as Speed | null;
    if (resume && resume !== 'manual') {
      this.time.delayedCall(1800, () => {
        this.hideQuiz();
        this.setSpeed(resume);
      });
    }
  }

  // --- controls ------------------------------------------------------------

  private bindControls(): void {
    document.querySelectorAll<HTMLButtonElement>('[data-speed]').forEach((b) => {
      b.addEventListener('click', () => this.setSpeed(b.dataset['speed'] as Speed));
    });
    document.querySelectorAll<HTMLButtonElement>('[data-decks]').forEach((b) => {
      b.addEventListener('click', () => {
        this.decks = Number(b.dataset['decks']);
        document.querySelectorAll<HTMLButtonElement>('[data-decks]').forEach((x) => {
          x.classList.toggle('on', x === b);
        });
        this.newShoe();
      });
    });
    document.getElementById('deal')?.addEventListener('click', () => {
      if (this.speed === 'manual') void this.deal();
      else {
        this.stopAuto();
        this.setSpeed('manual');
      }
    });
    document.getElementById('check')?.addEventListener('click', () => this.check());
    document.getElementById('newshoe')?.addEventListener('click', () => {
      this.newShoe();
      this.setSpeed(this.speed);
    });
    document.getElementById('minus')?.addEventListener('click', () => this.bumpGuess(-1));
    document.getElementById('plus')?.addEventListener('click', () => this.bumpGuess(1));
    document.getElementById('reveal')?.addEventListener('click', () => this.reveal());
    document.getElementById('closequiz')?.addEventListener('click', () => {
      this.hideQuiz();
      const panel = document.getElementById('quiz');
      const resume = panel?.getAttribute('data-resume') as Speed | null;
      if (resume && resume !== 'manual') this.setSpeed(resume);
    });
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Space' && this.speed === 'manual') {
        e.preventDefault();
        void this.deal();
      } else if (e.key === 'c' || e.key === 'C') {
        this.check();
      }
    });
  }

  private bumpGuess(delta: number): void {
    const el = document.getElementById('guess');
    if (el) el.textContent = String(Number(el.textContent ?? '0') + delta);
  }

  // --- labels --------------------------------------------------------------

  private refreshLabels(): void {
    this.shoeLabel.setText(`${this.shoe.length}`);
    this.dealtLabel.setText(`${this.dealt}`);
    const stats = document.getElementById('stats');
    if (stats) {
      const score = this.checks === 0 ? 'no checks yet' : `${this.correct}/${this.checks} correct`;
      stats.textContent = `Dealt ${this.dealt} - ${score} - streak ${this.streak} (best ${this.best})`;
    }
  }

  private setNote(text: string): void {
    this.note.setText(text);
  }
}

const game = createBoard({
  parent: 'board',
  width: WIDTH,
  height: HEIGHT,
  backgroundColor: '#13463a',
  scene: CountingDemo,
});

(window as unknown as { __game: Phaser.Game }).__game = game;
