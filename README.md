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
npm install github:exterkamp/phaser-card-engine#v0.3.1
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

## What is deliberately not in it

**Phaser.** Despite the name, version 0.1.0 has no Phaser dependency and no
rendering in it. The `CardSprite`, the felt and rail drawing, the card-flight
animations and the tableau fan maths are the obvious next things to take — and
they are also the two games' *most* divergent files: `card-sprite.ts` differs
by 184 lines between the repos and `table.ts` by 154, because one draws four
seats' themed decks with marks on them and the other draws one deck with ghost
suits under it. Merging those means both games' look is in play in the same
change, so it waits until this seam has survived a deploy.

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
| `github:exterkamp/phaser-card-engine#v0.3.1` | **yes** | yes | ✅ |
| `https://github.com/.../archive/refs/tags/v0.3.1.tar.gz` | no | no | ❌ no `dist/` |

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
