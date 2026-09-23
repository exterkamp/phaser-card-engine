// The shared half of two card games.
//
// Everything in here was written twice before it was written once: web-nert
// and web-solitaire each grew their own suits, ranks, shuffle, deck themes and
// typefaces, and each carried its own 4.8MB copy of the same card art. This
// is that overlap, and nothing else - the rule for what belongs here is not
// "could this be shared" but "was it already the same in both".
//
// There is no Phaser in here, and stack.ts is the reason to say so twice:
// where the sixth card of a squeezed fan sits is arithmetic, and arithmetic
// that needs a browser to be tested is arithmetic that does not get tested.
// Phaser draws a card at the point this hands it - see demo/, which does
// exactly that and nothing more.
export * from './cards.js';
export * from './stack.js';
export * from './shuffle.js';
export * from './deck-theme.js';
export * from './fonts.js';
