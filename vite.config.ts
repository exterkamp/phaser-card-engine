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
  server: { host: '0.0.0.0', port: 4390 },
  build: { outDir: resolve(__dirname, 'demo-dist'), emptyOutDir: true },
});
