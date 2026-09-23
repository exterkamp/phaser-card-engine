// The shared half of two card games.
//
// Everything in here was written twice before it was written once: web-nert
// and web-solitaire each grew their own suits, ranks, shuffle, deck themes and
// typefaces, and each carried its own 4.8MB copy of the same card art. This
// is that overlap, and nothing else - the rule for what belongs here is not
// "could this be shared" but "was it already the same in both".
//
// There is no Phaser in this version, despite the name. The sprite, the felt
// and the flight animations are the obvious next things to take, and they are
// also the two games' most divergent files - so they wait until this seam has
// survived a deploy. See README.md.
export * from './cards.js';
export * from './shuffle.js';
export * from './deck-theme.js';
export * from './fonts.js';
