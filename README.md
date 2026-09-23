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
npm install github:exterkamp/phaser-card-engine#v0.1.0
```

```ts
import { standardDeck, shuffle, seeded, deckThemePath, rankValue } from 'phaser-card-engine';

const deck = shuffle(standardDeck(), seeded(42));   // repeatable, for tests
const art = deckThemePath('royal', 'king-spades.webp');   // /cards/art/royal/...
```

## What is in it

| | |
| --- | --- |
| `cards.ts` | `SUITS`, `RANKS`, `Suit`, `Rank`, `CardSuit`, `rankValue`, `isRed`, `sameColour`, `CardFace`, `standardDeck`, `cardName`, and the 5:7 card proportion |
| `shuffle.ts` | `shuffle` against a supplied random, the `seeded` mulberry32 generator, and `pickWeighted` |
| `deck-theme.ts` | the seven themes, their labels, the art path, the back/seat colours and the guards that keep a bad value out of storage |
| `fonts.ts` | the four families named for a canvas, and `fontsReady()` |
| `assets/cards` | 4.8MB of card art: seven themes × twelve courts and a back, plus the suit glyphs |
| `assets/fonts` | the four woff2 files and their licences |

## What is deliberately not in it

**A `Card` type.** Nertz cards carry a seat, a deck-list entry and a set of
marks, and mint ids from a counter because one deck there can hold two of the
same card. Solitaire cards carry a face-up flag and take their id from the suit
and rank, because a deck holds exactly one of each. Neither model is wrong and
neither fits the other, so this package offers `CardFace` — the part they agree
on — and each game builds its own card around it:

```ts
const cards = standardDeck().map((face) => ({ ...face, id: `${face.suit}-${face.rank}`, faceUp: false }));
```

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

## Why a GitHub dependency

Both consumers can install from a public GitHub repo with no registry, no
token and no login: `npm ci` fetches a tarball over https, and the `prepare`
script builds the TypeScript on install. That matters because the two apps
build differently — solitaire builds on the host and its image copies `dist/`,
while nertz runs `npm ci` and `ng build` *inside* its Docker image, where a
`file:../phaser-card-engine` path does not exist.

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
