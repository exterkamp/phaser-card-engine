import { defineConfig } from 'vite';
import { resolve } from 'node:path';

// The demo, served straight from the package it demonstrates.
//
// publicDir points at the package's own assets, so `/cards/art/...` in the
// browser is exactly the path deckThemePath returns - which is the contract
// this package asks of a consumer, tested here by being a consumer.
export default defineConfig({
  root: 'demo',
  publicDir: resolve(__dirname, 'assets'),
  resolve: {
    alias: { 'phaser-card-engine': resolve(__dirname, 'src/index.ts') },
  },
  // Bound to every interface on purpose: the point of this demo is a card
  // game, and a card game is tested with a thumb. `npm run demo` prints the
  // LAN address alongside localhost - open that one on a phone.
  //
  // allowedHosts covers reaching the machine by name rather than by number;
  // Vite blocks unknown Host headers by default (DNS rebinding protection)
  // and raw IPs are allowed already, so this is only for `http://box.local`
  // style addresses.
  server: {
    host: '0.0.0.0',
    port: 4390,
    allowedHosts: ['.local', '.lan', '.home', '.internal'],
  },
  preview: { host: '0.0.0.0', port: 4391 },
  build: { outDir: resolve(__dirname, 'demo-dist'), emptyOutDir: true },
});
