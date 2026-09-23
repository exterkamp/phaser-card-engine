// The Phaser half of the package.
//
// Its own entry point - `phaser-card-engine/phaser` - so that everything in
// the main one stays free of Phaser and testable without a browser. Phaser is
// an optional peer dependency: a game that only wants the cards, the shuffling
// and the stack geometry never installs it.
export * from './card-sprite.js';
