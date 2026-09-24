# phaser-card-engine

The shared half of two card games: the card art, the vocabulary of suits and
ranks, the deck themes, the shuffling, and the typefaces.

Everything in here was written twice before it was written once.
[web-nert](https://github.com/exterkamp/web-nert) and
[web-solitaire](https://github.com/exterkamp/web-solitaire) each grew their own
copy of these files, and each carried its own copy of the same card art —
byte for byte the same, differing only by one `star.svg` and a README.

That is the rule for what belongs in here, and it is narrower than "could this
be shared": **was it already the same in both?**

```bash
npm install github:exterkamp/phaser-card-engine#v0.10.1
```

The build image needs `git` — see [Installing it](#installing-it), which has
the one line nertz's Dockerfile wants.

```ts
import { standardDeck, shuffle, seeded, deckThemePath, rankValue } from 'phaser-card-engine';

const deck = shuffle(standardDeck(), seeded(42));   // repeatable, for tests
const art = deckThemePath('royal', 'king-spades.webp');   // /cards/art/royal/...
```

## What is in it

| | |
| --- | --- |
| `card-face.ts` | `cardFaceMetrics` — where the index, its suit and the big pip go, at any card width |
| `phaser/` | `createBoard`, `boardRoot`, `orderStack`, `toBoard`, `CardSprite`, `preloadCardArt`, `throwCard` and `dealCards`, behind `phaser-card-engine/phaser` |
| `hand.ts` | `Hand` and `defineHand`, `handPositions`, `nextHandPlace`, `handBounds` — cards held in a fan rather than stacked |
| `stack.ts` | `Stack` and `defineStack`, `stackPositions`, `nextPosition`, `stackBounds`, `stackUnder`, `stackDepths`, `topCardIndex`, `readableOrder`, `cardRect`, `overlap` — where a pile of cards lives, where each card in it sits, and which of them is drawn in front |
| `cards.ts` | `Card` and `CardFace`, `buildDeck`, `topOf`, `cloneCards`, `defineSuits`, `colorOf`, `isRed`, `isBlack`, `sameColor`, `SUITS`, `RANKS`, `Suit`, `Rank`, `SuitColor`, `rankValue`, `isStandardSuit`, `cardName`, and the 5:7 card proportion |
| `shuffle.ts` | `shuffle` against a supplied random, the `seeded` mulberry32 generator, and `pickWeighted` |
| `deck-theme.ts` | the seven themes, their labels, the art path, the back/seat colors and the guards that keep a bad value out of storage |
| `ink.ts` | `defaultInk`, `inkOf`, `SuitInk`, `colorCss`, `cssColor` — what a suit is *printed* in, which is not what it counts as |
| `court.ts` | `COURT_PALETTES`, `recolorCourt`, `prepareCourt`, `courtArtHeight`, `courtCropRect`, `courtWipeRects` — the twelve court sources, and the measured window taken out of each |
| `fonts.ts` | the four families named for a canvas, and `fontsReady()` |
| `assets/cards` | the twelve court sources as SVG (2MB, 489kB gzipped), the seven card backs, and the suit glyphs |
| `assets/fonts` | the four woff2 files and their licences |

## The card, and extending it

`Card` is a base to extend, not a shape everything has to fit:

```ts
interface Card<S extends string = Suit> extends CardFace<S> {
  id: string;
  faceUp: boolean;
}
```

Those four fields are not a guess at a common denominator — they are exactly
what the two games already had, field for field. Solitaire's card *is* this.
Nertz's is this plus what it needs, over a suit set of its own:

```ts
interface SolitaireCard extends Card {}                 // the four suits

const NERTZ_SUITS = defineSuits({ star: { color: 'black' } });   // gold on the card
type NertzSuit = SuitOf<typeof NERTZ_SUITS>;            // Suit | 'star'

interface NertzCard extends Card<NertzSuit> {
  seat: number;             // whose deck it came from
  entry: number;            // which line of that deck list
  marks?: CardMark[];       // what the shop did to it
}
```

### Suits a game invents are the game's

There is no list of non-standard suits in this package. An earlier version had
one — a `SPECIAL_SUITS` array with `star` in it — which made every consumer
carry a suit only one of them has ever heard of, and made that consumer ask
permission to add its own. Now the four standard suits are here and anything
else is declared where it is used, **with the color its rules should treat it
as**:

```ts
const SUITS_IN_PLAY = defineSuits({ star: { color: 'black' }, rose: { color: 'red' } });

SUITS_IN_PLAY.colorOf('star');     // 'black'
SUITS_IN_PLAY.isStandard('star');   // false — this is what "special" meant
SUITS_IN_PLAY.all;                  // the four, then yours
```

### Color is a value, not a boolean

`isRed` alone is a trap once suits are open-ended, because **"not red" stops
meaning "black"**. A gold star is neither, and a package that answered `false`
to `isRed` and let you infer black would be putting one game's rule into
everybody's cards. So:

| | |
| --- | --- |
| `colorOf(suit)` | `'red'`, `'black'`, or **undefined** for a suit this package does not know |
| `isRed` / `isBlack` | both, and both `false` for an unknown suit — which is why there are two rather than one and a negation |
| `sameColor(a, b)` | `false` if either suit is unknown, because the honest answer about an unknown color is not "yes" |

A vocabulary always has an answer, because every suit in it was declared:
`SUITS_IN_PLAY.colorOf('star')` is `'black'`, and `sameColor('star', 'clubs')`
is `true`.

The distinction that makes this worth the trouble: **the color a rule asks
about is not always the color the card is printed in.** Nertz's star is drawn
in gold and counts as black on its tableau, which builds in alternating
colors. It declares `{ color: 'black' }` and paints gold itself. A game
wanting a suit that genuinely belongs to neither color says
`{ color: 'gold' }` and gets `false` from both questions.

### The helpers keep your type

```ts
const deck = buildDeck<NertzCard>((face, index) => ({
  ...face, id: `s${seat}-${face.suit}-${face.rank}-${minted++}`,
  faceUp: false, seat, entry: index,
}));                                   // NertzCard[]

topOf(deck);                           // NertzCard | undefined, not Card
cloneCards(deck);                      // NertzCard[]
```

`buildDeck()` with no argument gives fifty-two of the base, face down, with
`spades-K` for an id — safe because a standard deck holds one of each, and
worth it for what it does to a failing test.

`src/extending.spec.ts` declares both games' real models and asserts all of
this at the type level, including that a plain `Card` *rejects* `star`. `npm
test` typechecks the specs before running them, so a change that stops fitting
either game fails the test run rather than the next migration.

An interface rather than a class, because both games hold cards in pure state
copied with a spread on every move; a class would survive `{ ...card }` as a
plain object with its methods missing. A class of your own may of course
`implements Card`.

## Stacks: where a pile of cards lives

The primitive every card game on a table needs and none of them share. A named
place with a position, which cards land on and build up from — a foundation is
one, and so is a stock, a waste, a free cell, a tableau column, a peak
position, a reserve, and the hole in the middle of Black Hole. Across the two
games there are eleven kinds of pile and they are all this:

```ts
const foundation = defineStack({ id: 'foundation-0', x: 60, y: 70 });
const column = defineStack({
  id: 'column-0', x: 60, y: 210,
  fan: 'down', step: 26,     // how far each card sits from the one before
  maxSpread: 190,            // and how much room the fan may take in total
});

stackPositions(column, 13);  // where all thirteen cards go
nextPosition(column, 13);    // where a fourteenth would land
stackUnder(cardRect(pointer), piles);   // which stack a dragged card is over
```

### Which end is on top

Every stack also has an `order`, and it is not geometry — the cards sit in
exactly the same places either way. It decides which card is drawn *over* the
others, and therefore **which edge of each card the one beside it covers**. A
card carries its index in its top-left corner, so that is the whole question:

| fan | `last-on-top` shows | `first-on-top` shows |
| --- | --- | --- |
| down | each card's top edge — **the index** | each card's bottom edge |
| up | each card's bottom edge | each card's top edge — **the index** |
| right | each card's left edge — **the index** | each card's right edge |
| left | each card's right edge | each card's left edge — **the index** |
| none | the newest card | the oldest card |

So a tableau fanning down wants `last-on-top` and the same tableau fanning up
wants `first-on-top`; get it backwards and you have a column of blank slivers
with one readable card at the end. `readableOrder(fan)` answers it, and is
offered rather than applied — a stock showing the card it will deal next wants
the other one on purpose.

```ts
stackDepths(stack, count);     // how far above the felt each card is drawn
topCardIndex(stack, count);    // which card is in front — the one a finger lands on
```

`topCardIndex` is worth having on its own: on a `first-on-top` stack the card
drawn in front is the *oldest*, so a game picking cards up by touch must not
assume the last one. What may legally be played is still the game's business.

Three more things are worth more than they look:

**The fan squeezes rather than overflowing.** A column that would outgrow its
`maxSpread` shrinks *every* gap by the same factor, so it stays even instead of
cramming the last few cards. A tableau that reaches the bottom of the screen
has to do something, and this is the one thing that keeps every card's index on
screen.

**The gap before each card can differ.** `stackPositions` takes an optional
`gapBefore(index)`, because the room a card needs depends on what is under it:
one lying on a face-down card only has to clear its edge, one lying on a
face-up card has to clear its index. That looks like overkill until you have
six face-down cards with a king-to-ace run on top, which Klondike deals on its
seventh column.

**`stackUnder` measures overlap, not the pointer.** The most-overlapped stack
wins, which is what a hand on a real table does — with a finger on a phone the
pointer is under the card and often over the wrong pile entirely.

It is geometry and nothing else: no Phaser, no sprites, no scene. That is
deliberate. Where the sixth card of a squeezed fan sits is arithmetic, and
arithmetic that needs a browser to be tested is arithmetic that does not get
tested. Phaser's job is to draw a card at the point this hands it.

## The demo

```bash
npm install
npm run demo        # http://localhost:4390, and the LAN address it prints
```

`/` is an index of the six pages, and every page has a **← Demos** button in
its top-left corner to get back to it:

- **stacks** at `/stacks.html` — one of every fan direction, in both draw orders
- **card sizes** at `/sizes.html` — the same card at seven widths from 24 to 168
- **throwing** at `/throws.html` — tap the felt to throw a card at that spot,
  or tap a pile to throw one onto it
- **hold'em** at `/holdem.html` — four seats dealt automatically, the way a
  dealer deals it, each seat holding its cards turned towards itself
- **hands** at `/hands.html` — a fanned hand you can throw cards into, one
  face up in front of you and one turned round across the table
- **deck editor** at `/deck.html` — every color a deck has, over a deck you
  can step through a rank at a time

It binds every interface, because a card game is tested with a thumb: `npm run
demo` prints a **Network** address alongside the local one, and that is the one
to open on a phone. `npm run demo:serve` does the same for the built demo on
4391.

A Phaser board that is a specimen sheet of the primitive: one of every
direction a stack can run, labelled on the felt.

| | |
| --- | --- |
| **Squared** | every card lands exactly on the last |
| **Fan right** and **fan left** | the same fan run both ways along the x axis; the leftward one grows back towards its own edge, which is how a pile sits in a corner and stays there |
| **Fan down** | a tableau column |
| **Fan up** | anchored at its *bottom* card, growing towards the top of the screen |

**Each of those appears twice, side by side — once `last-on-top` and once
`first-on-top`** — because that pair is the thing worth seeing. The two piles
are otherwise identical: same anchor, same step, same cards, same positions to
the pixel. Only the draw order differs, and the fanning-down pair reads as six
indexes against one, while the fanning-up pair reads the other way round.

There are no rules — any card may be dropped on any stack — because rules are
the game's and this is showing the placement. Drag a card and the stack it is
being offered to lights up where the card would land. **Toggle squeeze**
switches `maxSpread` between its cap and unlimited, and every direction
squeezes the same way.

Dragging takes the card drawn *in front*, which on a `first-on-top` pile is the
oldest one — anything else would mean pulling a card out from under the cards
covering it.

On a touchscreen the canvas captures its own gestures — without that a drag is
also a page scroll, and the card sits still while the whole demo slides up the
screen. Checked with emulated touch at 412×915 rather than assumed, because a
mouse never finds it.

The demo draws its own crude card — a rounded rectangle, the index in the
engine's own index face, and the engine's suit glyph, with the real painted art
for the courts. That is because the package does not ship a sprite yet, which
is the next thing to take and the subject of the section below.

Vite serves the package's own `assets/` as the site root, so `/cards/art/...`
in the browser is exactly what `deckThemePath` returns — the demo is a
consumer, and that contract is tested by being used.

## Hands: cards held, not stacked

A stack is cards on a table — every card parallel, each offset along a line. A
hand is cards in a fist, and it is a different shape: they pivot around the
point where they are gripped, so each is turned a little further than the last
and the fan bulges upward in the middle. Riffling a hand open is a rotation,
not a slide.

```ts
const mine = defineHand({
  id: 'mine', x: 240, y: 540,
  step: 9,            // degrees between one card and the next
  maxSpread: 70,      // the most the fan may open to
  radius: 260,        // how far below the cards it is gripped
});
const theirs = defineHand({ ...mine, y: 110, facing: 180 });   // across the table

handPositions(mine, 7);     // { x, y, angle } for each card
nextHandPlace(mine, 7);     // where an eighth would sit
```

`step` and `maxSpread` mean exactly what they mean for a stack — degrees
instead of units — and a hand of thirteen holds the same width as a hand of
five and simply packs tighter, which is the same squeeze a tableau column does.

**`radius` is the size of the fan, not its curviness.** Every card sits at
`radius · sin(angle)` across and `radius · (1 − cos(angle))` down, so doubling
it doubles both the spacing and the sag and the arc keeps identical
proportions. What decides how curved a hand *looks* is how far it is opened. I
had that backwards in the first draft of this file and only caught it by
driving the demo and reading the numbers back.

**A hand re-fans around its middle every time a card arrives**, so every other
card moves too — which is why `nextHandPlace(hand, n)` is the place in the hand
*as it will be*, and why `dealCards` into a hand aims every card at the
finished fan rather than at where it would sit on its own.

`throwCard` knows about hands: throw one at `{ hand, count }` and it lands at
the position **and the angle** that hand holds it at. Settling square and
letting the hand redraw it at 10° would produce exactly the snap the exact
landing exists to prevent.

### Re-fanning: use `layHand`

```ts
layHand(this, this.root, cards, hand, { base: 1000, except: [inFlight] });
```

Two traps live here and `layHand` is the answer to both.

**Turn the short way.** Phaser wraps `angle` to ±180 and the geometry does
not, so a hand facing across the table holds a card at 189° while the sprite
showing it reports −171°. Tweening one to the other is a tween through 360
degrees — the card does a full spin to reach a place five degrees away. That
shipped in 0.10.0, and what it looked like was *two cards in an untouched hand
spinning whenever a third was dealt to it*, which is strange enough to see that
it took measuring to believe. `shortestTurn` is the arithmetic; `layHand`
applies it.

**Leave cards in flight alone.** A card being thrown into the hand is already
being moved by the throw. Count it in the fan so the others make room, but do
not tween it — pass it in `except`, or the throw and the re-fan fight over the
same sprite and the card stutters as it arrives.

`npm run smoke` now watches every re-fan tween on that page and fails if any
card turns more than 90° to reach a place one step away.

## Drawing a card

```ts
import { CardSprite, preloadCardArt } from 'phaser-card-engine/phaser';

preloadCardArt(this, { themes: ['press'] });          // in a scene's preload
new CardSprite(this, card, { width: 60, theme: 'press' });
```

The face is Nertz's, which is the one of the two games that had thought hardest
about it: **a large index with its suit beside it on one line in the top-left,
and one big suit — or a court portrait, full bleed — filling the bottom.** No
mirrored bottom-right corner; once a card is legible at a glance the second
index is redundant, and dropping it is what paid for everything else being
bigger. A number card gets one big pip rather than a true pip count, because
five rows of small glyphs at card size reads as a blurry cluster.

**It draws at the width you ask for rather than drawing once and scaling**, so
the index is rasterised for the size it is shown at — a 24-unit card and a
168-unit card are both sharp, and a 24-unit card scaled up to 168 is not. Every
measurement is a ratio of the width, in `cardFaceMetrics`, which is plain
arithmetic in the core with tests rather than something you need a browser to
check.

One number from it is worth knowing by name: **`peek`**, how much of a card has
to show for its index to be read — 29.4 units on a 60-unit card. That is the
number a fanned stack's `step` should be chosen against, and the stacks demo
squeezes past it on purpose so you can see what it costs.

### Make the board first, or nothing will be sharp

```ts
const game = createBoard({ parent: 'board', width: 480, height: 640, scene: MyScene });

// in the scene's create:
this.root = boardRoot(this);        // everything goes in here
this.root.add(new CardSprite(this, card));
toBoard(this, pointer);             // a pointer, in board units
```

Phaser has no HiDPI support of its own — the old `resolution` config was
removed years ago — so a game created at 480×640 gets a canvas with a 480×640
backing store, and `Scale.FIT` stretches that over however many device pixels
the element covers. On a phone at `devicePixelRatio` 2 that is 480 real pixels
smeared across 824, and **every card on it is an upscaled card**.

Measured on this demo before `createBoard` existed: **0.62 backing pixels per
device pixel.** Small cards were visibly worse than the same cards in the game
this art came from, which runs at 1.17. It was never antialiasing — the canvas
was simply under-resolved, and the smaller the card the less it could afford
that.

`createBoard` makes the canvas `size × pixelRatio` and `boardRoot` gives you a
container scaled by the same factor, so every coordinate you write stays in
logical units and only the density goes up.

**Depth does not sort itself inside that container.** A Phaser Container paints
its children in the order of its own list, and `setDepth` queues a sort of the
*Scene's* display list rather than the container's — so a card given a lower
depth than the one before it still paints on top. Use `orderStack`, which sets
the depths and sorts:

```ts
orderStack(this.root, pile.cards, pile.stack, pileIndex * 100);
```

The `base` gives each pile a band of its own so two overlapping piles keep
their relative order. This one cost a release: stack order shipped working,
everything moved into a root container for the pixel ratio, and every
`first-on-top` pile silently went back to `last-on-top`. `toBoard` converts a pointer back,
because Phaser reports those in canvas pixels — forget it and a drag follows
the finger at twice the distance. `CardSprite` takes the board's ratio for its
own text and textures unless you override it.

`phaser` is an optional peer dependency and all of this lives behind
`phaser-card-engine/phaser`, so a game that only wants the cards, the shuffling
and the stack geometry never installs it.

### The stock, and what a suit is printed in

```ts
new CardSprite(this, card, {
  paper: 0xf4ecd8,                                   // the card stock
  ink: { hearts: 0x2e8b57, diamonds: 0x2e8b57 },     // green hearts
});
```

`paper` is the fill behind the face. It moves the court's paper with it — a
portrait printed on last week's white while the card under it is cream reads
as a sticker — and the hairline edge follows too, as a shade of the stock
rather than a grey rule that only suited near-white.

`ink` is what each suit is drawn in: a map, or a `(suit) => number`. A map may
name only the suits it changes.

**None of it has to agree with `colorOf`.** A deck may print its hearts in
green and they go on counting as `'red'` to every rule that asks, because what
a card is printed in and what a rule calls it were never the same question —
see `/deck.html`, which lets you set both and watch them disagree.

## Courts: a deck is a palette

The twelve court cards are Dmitry Fomin's CC0 English pattern deck, and the
seven themes are not seven sets of art — they are seven palettes over the same
twelve drawings. Which means a court can be colored while the game is
running, rather than only while it is being built:

```ts
import { COURT_PALETTES, renderCourts, CardSprite } from 'phaser-card-engine/phaser';

const palette = { ink: '#4a4892', gold: '#e8b422', red: '#cf2436' };
await renderCourts(this, palette);                    // rasterises all twelve
new CardSprite(this, card, { width: 60, courtPalette: palette });
```

`renderCourts` is async, but it does not have to be awaited. A card built
before its portrait has rendered shows its big centre pip and swaps the
portrait in when it lands, so a game can start its render and build its deck
in the same breath:

```ts
void renderCourts(this, palette);      // no await
this.dealEverything();                 // pips now, portraits shortly
```

Every demo but `/deck.html` does exactly that. Await it only if you need the
first painted frame to already have portraits in it.

**Four of the five source inks move**, and a fifth role is added. The source deck is drawn in five colors and
nothing else. Gold and red are the garment fields; ink is every line on every
face, hand and lock of hair — 12% of the art but the whole of its drawing, and
moving it changes a deck's character more than either field does.

Paper is the fourth, and the rule about it cuts the other way now. It is 42%
of the art and has to stay in step with the card fill drawn underneath it or
the art reads as a sticker stuck on a white card — which used to mean "never
move it" and now means "move it with the card". Set `paper` on the palette and
on the `CardSprite` together, or state it once in the palette and let the card
take it from there.

### `highlight`, and why a dark deck needs one

The fifth is `highlight`: the white *inside* the drawing — faces, hands,
linen, the blade of a sword. It has to be separate from `paper`, and the
reason is not obvious from the art:

**The source has no white skin to recolor.** A face is a *hole* in the
drawing. Every one of the twelve opens by painting a full-card rounded
rectangle, and what shows through the gaps in the figure is that rectangle. So
one color for the card and for the figure's whites means a dark stock takes
the King's face down with it and leaves line work floating on nothing.

Nothing in the file tells the two apart, so `partBackground` does it on the
canvas — and the two obvious rules both fail:

- **A flood from the border leaks.** A Queen's cloak is white and runs unbroken
  into the white margin beside her, and the white between the strands of her
  hair runs into her face. The flood arrives inside the figure and takes both.
- **Walking each column down from the top barely fills.** It cannot leak, but a
  Jack's hat touches the top of the frame, so every column through it stops at
  once and the whole background behind his head stays pale.

What works is flooding **at a coarser grain than the leaks**. A cell of the
grid counts as drawn if any pixel in it is, so the few-pixel gaps the flood
escaped through are sealed while the background stays open. The result is then
grown back a bounded handful of pixels at full resolution to take the rim the
grid left — bounded, because a growth that cannot run more than `GROW` pixels
cannot cross a figure to reach a face however the drawing is shaped.

**Two places are written down.** On the jack of clubs and the king of hearts
there is background walled in by the figure on every side — the band right of
his head, the sliver between his hair and his sword. No rule finds them, and
the reason is that no rule can: a face is a hole in the drawing and so is one
of these, identical to anything looking at shape or connection. A flood
reaching these also eats the queen of hearts' face, which was measured, not
guessed. So `COURT_BACKGROUND_SEEDS` names them, in the same spirit as the
crop window above — these twelve files are public-domain art that has not
changed since 2012 and will not.

It runs on the **cropped** art rather than the whole page, and starts from the
top edge plus the upper part of the sides. Some background is walled off from
the card's margin by the figure itself — the wedge under the Queen of clubs'
headdress is closed at the page and open at the edge of the cut — so the crop
is what lets an edge reach it. The bottom is never a seed: the art is a bust
bleeding off the card there, so the edge is the figure's own body and starting
from it floods a sleeve.

Edges are blended rather than switched, so the figure keeps its antialiasing
instead of gaining a pale fringe against a dark stock.

`highlight` defaults to `COURT_PAPER` rather than to `paper`, so a deck that
only asks for a dark card still gets a face. The flood is skipped entirely
when the two match, which is every deck that has not asked for them to
differ.

Black stays put. It is the mass the line work sits on rather than a color
anything is printed in, and a deck that moves it is a deck whose faces
dissolve into their own garments.

There are 24 distinct hex values across the twelve files rather than five,
because Inkscape left rounding strays a unit or two off. Everything read out
of the art is snapped to the nearest of the five, and `src/court.spec.ts`
checks the assumption against the files rather than trusting it.

### What this replaced

The courts used to be baked: 84 WebP files, twelve per theme, 4.1 MB of the
package. They are gone. The seven themes survive as the seven entries in
`COURT_PALETTES`, which is all they ever were — three hex values each over one
set of drawings.

| | now | before |
| --- | --- | --- |
| Weight | 489 kB gzipped, every palette | 4.1 MB, seven palettes |
| Start-up | ~0.8 s for twelve, ~2.3 s throttled 4× | free |
| Palettes | any | the seven somebody thought of |

That start-up column is the whole of what it cost, and it is paid once per
palette — the textures stay in the manager, so going back to a deck already
seen is free. The rasterising is the expensive part, not the recoloring: the
substitution is 12 ms for all twelve and the rest is Chrome drawing ~300 paths
a card. One palette at two sizes therefore costs twice, and textures are keyed
by palette *and* size so two decks can be on a table at once.

One thing the bake had that this does not: `render-face-art.py` adds a press —
a sub-pixel blur and a third of a pixel of channel misregistration, so the ink
reads as laid on stock rather than as clean vector. It is invisible at 60×84
and obvious if you zoom, and it is not reproduced here.

**The backs are still baked**, and stay that way: `back.webp` is generated line
work with no SVG stage to render from, so there is nothing for a palette to
recolor. What it has instead is transparency — it is ink on nothing, and the
color behind it is `BACK_COLORS`.

## Throwing cards

```ts
throwCard(this, sprite, { x: 240, y: 300 });                    // at a spot
throwCard(this, sprite, { stack: pile, count: pile.length });   // onto a pile
dealCards(this, five, { stack: pile, count: 0 }, { stagger: 110 });
```

A card pitched across a table spins — one turn, in whichever direction the
wrist gave it — and arrives flat. Both targets work: a bare point lands on
itself, and a stack lands where that stack's **next** card goes, so throwing at
a pile of six puts the card on top of the six rather than under them. Each
resolves when the card lands.

**It lands on an exact angle, and that is the point of the whole design.** A
card thrown at a pile is usually replaced the instant it arrives by the pile's
own redraw; if the throw finished at 7° while the pile draws at 0°, the card
visibly snaps as one sprite takes over from the other. So the spin is computed
backwards from the angle it has to rest at, and the variety comes from the
*direction* being random rather than the angle being fuzzed.

A first version did fuzz it, by ±20°, and every card landed off square and got
snapped straight by its own `onComplete`. The arithmetic test caught it;
watching it would not have, at seven degrees. If you want a pile to look thrown
rather than filed, pass a different `settleAngle` per card — that is a decision
about how a pile looks, and it belongs to the game.

Duration comes from distance unless you give one: a card flicked to the next
column and a card thrown the length of the board are not the same gesture, and
one duration for both makes the short one look slow and the long one
teleported.

The whole file is Phaser-free at runtime — it only ever adds a tween through
the scene you hand it — so it is tested against a stub scene rather than a
browser.

## A worked example

`demo/holdem.ts` is the smallest thing that looks like a real game: four seats,
a board, a burn pile and a deck, dealt automatically. There are no rules in it
— nothing is ranked, nobody bets — because what it is showing is that the
dealing falls out of the primitives. What lies on the table is a `Stack`; what a
player holds is a `Hand`; every card gets to either by being thrown at it.

Which is the distinction the two primitives exist to make. The board is a fan
running right with a step *wider* than a card, so the five sit in a row without
touching; the burn pile and the deck are squared. Those are cards on a table.
The seats' hole cards are not: each seat is a `Hand`, and its `facing` says
which way that player is sitting — so the player across the table has their
cards upside down from here and the two at the sides have theirs turned
sideways, all from one number per seat. Try it with the seats as stacks and the
table reads as four piles belonging to nobody.

There is a smaller lesson in the labels. They are placed off `handBounds`
rather than off a card's height, because a fanned card is turned and a turned
card reaches past its own corner — and the two side seats get theirs above the
hand rather than beside it, since a hand turned a quarter round is as wide as a
card is tall and there is no felt left to the side of it.

And the deal is a function that reads like the back of a rulebook:

```ts
for (let round = 0; round < 2; round++) {
  for (const seat of SEATS) await this.deliver(seat.id);
}
await this.deliver('burn');
for (let i = 0; i < 3; i++) await this.deliver('board');   // the flop
await this.deliver('burn'); await this.deliver('board');   // the turn
await this.deliver('burn'); await this.deliver('board');   // the river
```

`deliver` takes the top card off the deck, throws it at that pile, turns it
over on arrival if the pile is a face-up one, and hands it to the pile. It
knows nothing about hold'em. Note the outer loop: **one card at a time, twice
round the table** — not two cards to each seat in turn, which is the thing
everybody gets wrong and which looks wrong even when you cannot say why.

`npm run smoke` checks that order, along with the counts, that no card is dealt
twice, that the right piles are face up, and that every card comes to rest
where its pile holds it after spinning — square on the table, and at the fan's
own angle in a hand, which is the claim that catches a throw finishing a few
degrees off and being snapped straight.

## What is deliberately not in it

**The rest of the table.** The felt, the rail, the printed lettering, the
card-flight animations and the win cascade are all still in the two games. The
card and the stack are the pieces both games agreed on; the table is where they
diverge hardest.

## Consuming the assets

The code assumes the art is served from `/cards`, which is what
`deckThemePath` and `courtSourcePath` both return. In an Angular app, add the package's asset directory
to `angular.json` rather than copying the files in:

```json
{
  "glob": "**/*",
  "input": "node_modules/phaser-card-engine/assets/cards",
  "output": "cards"
}
```

That one glob covers `court/` (the twelve SVG sources), `art/` (the seven
backs) and `suits/`. All three are needed; there is no longer a subset worth
narrowing to.

The fonts are the same idea, with `output: "fonts"` — but the app still has to
declare its own `@font-face` rules over them. This package names the families
for the canvas; it does not style your DOM.

## Installing it

No registry, no token, no login: the repo is public and npm fetches it over
https. `dist/` is not committed, so the `prepare` script builds the TypeScript
at install time — which is what decides the one requirement below.

| How you ask for it | needs `git` | runs `prepare` | works |
| --- | --- | --- | --- |
| `github:exterkamp/phaser-card-engine#v0.10.1` | **yes** | yes | ✅ |
| `https://github.com/.../archive/refs/tags/v0.10.1.tar.gz` | no | no | ❌ no `dist/` |

**`git` has to be in the image.** npm shells out to it to resolve a GitHub
dependency at all, and `prepare` only runs for git dependencies — so the plain
tarball, which is the obvious workaround, installs happily and then cannot be
imported. Both facts were checked inside `node:24-alpine` rather than reasoned
about; an earlier version of this section claimed no git was needed and was
wrong on both counts.

Solitaire builds on the host, where git is already there. Nertz runs `npm ci`
and `ng build` *inside* `node:24-alpine`, which ships without it, so its build
stage wants one line:

```dockerfile
RUN apk add --no-cache git
COPY package.json package-lock.json ./
RUN npm ci
```

That is also why this is a GitHub dependency and not a `file:../` path: the
sibling directory does not exist inside that image.

Pin a tag per app. An engine change then cannot break a deploy until that app
chooses to bump, which is the whole reason this is a package and not a shared
directory.

## Working on it

```bash
npm install
npm test        # vitest and a typecheck, no browser
npm run build   # tsc to dist/, which `prepare` also does on install
npm run demo    # the demo, on localhost and the LAN address it prints
npm run smoke   # drives the running demo in a real browser
```

`npm run smoke` is the half the unit tests cannot reach: it checks that the
canvas is at screen density, that every stack paints the end it asked for in
front, and that a dropped card joins the pile. It exists because of the
`orderStack` bug above — every depth was correct and every card was painted in
the wrong order, which no test of the numbers could have caught.

The emitted ESM uses explicit `.js` specifiers because real ESM requires them:
extensionless relative imports resolve fine inside a bundler and throw in plain
Node, and a package that only works inside a bundler is a package with a trap
in it.

## Licence

[CC0 1.0](LICENSE) — public domain, as far as the law allows. Same as both
games, and for the same reason: the deck that made this possible arrived that
way. Dmitry Fomin put the English pattern court cards in the public domain and
every theme here is downstream of that.

The **fonts in `assets/fonts` are not covered by it** — three are SIL OFL 1.1
and one is Apache 2.0, all fine to redistribute, none of them mine to dedicate.
See [ATTRIBUTION.md](ATTRIBUTION.md), which travels with the art for the same
reason this paragraph does.
