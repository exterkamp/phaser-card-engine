# phaser-card-engine

The shared half of two card games: the card art, the vocabulary of suits and
ranks, the deck themes, the shuffling, and the typefaces.

Everything in here was written twice before it was written once.
[web-nert](https://github.com/exterkamp/web-nert) and
[web-solitaire](https://github.com/exterkamp/web-solitaire) each grew their own
copy of these files, and each carried its own 4.8MB copy of the same card art —
byte for byte the same, differing only by one `star.svg` and a README.

That is the rule for what belongs in here, and it is narrower than "could this
be shared": **was it already the same in both?**

```bash
npm install github:exterkamp/phaser-card-engine#v0.5.0
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
| `stack.ts` | `Stack` and `defineStack`, `stackPositions`, `nextPosition`, `stackBounds`, `stackUnder`, `stackDepths`, `topCardIndex`, `readableOrder`, `cardRect`, `overlap` — where a pile of cards lives, where each card in it sits, and which of them is drawn in front |
| `cards.ts` | `Card` and `CardFace`, `buildDeck`, `topOf`, `cloneCards`, `defineSuits`, `colourOf`, `isRed`, `isBlack`, `sameColour`, `SUITS`, `RANKS`, `Suit`, `Rank`, `SuitColour`, `rankValue`, `isStandardSuit`, `cardName`, and the 5:7 card proportion |
| `shuffle.ts` | `shuffle` against a supplied random, the `seeded` mulberry32 generator, and `pickWeighted` |
| `deck-theme.ts` | the seven themes, their labels, the art path, the back/seat colours and the guards that keep a bad value out of storage |
| `fonts.ts` | the four families named for a canvas, and `fontsReady()` |
| `assets/cards` | 4.8MB of card art: seven themes × twelve courts and a back, plus the suit glyphs |
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

const NERTZ_SUITS = defineSuits({ star: { colour: 'black' } });   // gold on the card
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
else is declared where it is used, **with the colour its rules should treat it
as**:

```ts
const SUITS_IN_PLAY = defineSuits({ star: { colour: 'black' }, rose: { colour: 'red' } });

SUITS_IN_PLAY.colourOf('star');     // 'black'
SUITS_IN_PLAY.isStandard('star');   // false — this is what "special" meant
SUITS_IN_PLAY.all;                  // the four, then yours
```

### Colour is a value, not a boolean

`isRed` alone is a trap once suits are open-ended, because **"not red" stops
meaning "black"**. A gold star is neither, and a package that answered `false`
to `isRed` and let you infer black would be putting one game's rule into
everybody's cards. So:

| | |
| --- | --- |
| `colourOf(suit)` | `'red'`, `'black'`, or **undefined** for a suit this package does not know |
| `isRed` / `isBlack` | both, and both `false` for an unknown suit — which is why there are two rather than one and a negation |
| `sameColour(a, b)` | `false` if either suit is unknown, because the honest answer about an unknown colour is not "yes" |

A vocabulary always has an answer, because every suit in it was declared:
`SUITS_IN_PLAY.colourOf('star')` is `'black'`, and `sameColour('star', 'clubs')`
is `true`.

The distinction that makes this worth the trouble: **the colour a rule asks
about is not always the colour the card is printed in.** Nertz's star is drawn
in gold and counts as black on its tableau, which builds in alternating
colours. It declares `{ colour: 'black' }` and paints gold itself. A game
wanting a suit that genuinely belongs to neither colour says
`{ colour: 'gold' }` and gets `false` from both questions.

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

## What is deliberately not in it

**A card sprite.** The `CardSprite`, the felt and rail drawing, and the
card-flight animations are the two games' *most* divergent files:
`card-sprite.ts` differs by 184 lines between the repos and `table.ts` by 154,
because one draws four seats' themed decks with marks on them and the other
draws one deck with ghost suits under it. Merging those means both games' look
is in play in the same change, so they wait. The stack geometry came first
precisely because it has no such problem.

## Consuming the assets

The code assumes the art is served from `/cards`, which is what
`deckThemePath` returns. In an Angular app, add the package's asset directory
to `angular.json` rather than copying the files in:

```json
{
  "glob": "**/*",
  "input": "node_modules/phaser-card-engine/assets/cards",
  "output": "cards"
}
```

The fonts are the same idea, with `output: "fonts"` — but the app still has to
declare its own `@font-face` rules over them. This package names the families
for the canvas; it does not style your DOM.

## Installing it

No registry, no token, no login: the repo is public and npm fetches it over
https. `dist/` is not committed, so the `prepare` script builds the TypeScript
at install time — which is what decides the one requirement below.

| How you ask for it | needs `git` | runs `prepare` | works |
| --- | --- | --- | --- |
| `github:exterkamp/phaser-card-engine#v0.5.0` | **yes** | yes | ✅ |
| `https://github.com/.../archive/refs/tags/v0.5.0.tar.gz` | no | no | ❌ no `dist/` |

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
npm test        # vitest, 28 tests, no browser
npm run build   # tsc to dist/, which `prepare` also does on install
```

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
