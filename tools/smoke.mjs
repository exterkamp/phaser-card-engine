// What the unit tests cannot see: a real browser, a real canvas, and whether
// the thing on screen is the thing the geometry asked for.
//
// It exists because of one bug. Stack order shipped working; then everything
// moved into a root container to fix the pixel ratio, and every first-on-top
// pile silently went back to last-on-top - because a Phaser Container paints
// its children in list order and setDepth sorts the *Scene's* list, not the
// container's. Every depth was correct and every card was painted in the
// wrong order, which no test of the numbers could have caught.
//
//   npm run demo            # in one terminal
//   npm run smoke           # in another
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const host = process.argv.find((a) => a.startsWith('--host='))?.slice(7)
  ?? 'http://localhost:4390';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const port = 9000 + Math.floor(Math.random() * 900);
const profile = mkdtempSync(join(tmpdir(), 'pce-smoke-'));
const chrome = spawn('google-chrome', [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
  '--window-size=412,915', `--remote-debugging-port=${port}`,
  `--user-data-dir=${profile}`, 'about:blank',
], { stdio: 'ignore', detached: true });

/** How light a `#rrggbb` is, 0-255. */
const cssLuma = (css) => {
  const [r, g, b] = [1, 3, 5].map((i) => Number.parseInt(css.slice(i, i + 2), 16));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

let failures = 0;
const check = (ok, what) => {
  console.log(`${ok ? '  ok  ' : '  FAIL'} ${what}`);
  if (!ok) failures++;
};
const done = (code) => {
  try { process.kill(-chrome.pid, 'SIGKILL'); } catch {}
  try { rmSync(profile, { recursive: true, force: true }); } catch {}
  process.exit(code);
};
process.on('uncaughtException', (error) => { console.error(error.message); done(1); });

let page;
for (let i = 0; i < 40 && !page; i++) {
  try {
    const list = await (await fetch(`http://localhost:${port}/json/list`)).json();
    page = list.find((t) => t.type === 'page');
  } catch { await sleep(400); }
}
const socket = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => socket.addEventListener('open', r));
let id = 1;
const pending = new Map();
const errors = [];
socket.addEventListener('message', (e) => {
  const message = JSON.parse(e.data);
  if (pending.has(message.id)) { pending.get(message.id)(message); pending.delete(message.id); return; }
  if (message.method === 'Runtime.exceptionThrown') {
    errors.push((message.params.exceptionDetails.exception?.description ?? '').split('\n')[0]);
  }
});
const send = (method, params = {}) => new Promise((r) => {
  pending.set(id, r);
  socket.send(JSON.stringify({ id: id++, method, params }));
});
const evaluate = async (expression) =>
  (await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }))
    .result?.result?.value;
const until = async (expression, ms = 30000) => {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (await evaluate(expression)) return true;
    await sleep(300);
  }
  return false;
};

await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', {
  width: 412, height: 915, deviceScaleFactor: 2, mobile: true,
});

const root = host.replace(/\/$/, '');

// The index of demos, and the way back from each of them. A page renamed
// without its tile, or a demo added without one, breaks nothing that throws -
// it just quietly becomes unreachable.
console.log(`smoking ${host}`);
await send('Page.navigate', { url: `${root}/` });
await sleep(700);
// Resolved rather than concatenated, and that is the point of it: the links
// are relative so the same build works at the root of a dev server and under
// a project path on GitHub Pages. Reading `href` gives the browser's own
// answer for where each one actually goes.
const tiles = JSON.parse(await evaluate(
  `JSON.stringify([...document.querySelectorAll('a.demo')].map(a => a.href))`));
check(tiles.length === 6, `the home screen lists six demos (${tiles.length})`);
let reachable = 0;
let wayBack = 0;
for (const href of tiles) {
  await send('Page.navigate', { url: href });
  await sleep(900);
  if (await evaluate(`!!document.querySelector('h1')`)) reachable++;
  // The way back has to land on the index this page was reached from, which
  // is the directory the page is in - not the root of the host.
  if (await evaluate(`(() => { const a = document.querySelector('a.home');
    return !!a && a.href === location.href.replace(/[^/]*$/, ''); })()`)) wayBack++;
}
check(reachable === tiles.length, `every tile opens a page (${reachable}/${tiles.length})`);
check(wayBack === tiles.length, `every page has a way back (${wayBack}/${tiles.length})`);

await send('Page.navigate', { url: `${root}/stacks.html` });
if (!await until('!!window.__game && Object.values(window.__game.scene.keys)[0].piles?.length')) {
  console.log('  FAIL the board never appeared');
  done(1);
}
await sleep(2500);
const scene = 'Object.values(window.__game.scene.keys)[0]';

// The canvas has to have at least as many pixels as the screen shows it in,
// or every card on it is an upscaled card.
const density = await evaluate(`(() => {
  const c = document.querySelector('canvas'); const b = c.getBoundingClientRect();
  return c.width / (b.width * window.devicePixelRatio);
})()`);
check(density >= 1, `canvas at screen density or better (${density.toFixed(2)} backing px per device px)`);

// And each stack has to be painted in the order it asked for.
const painted = await evaluate(`(() => {
  const s = ${scene};
  const out = {};
  for (const pile of s.piles) {
    if (pile.cards.length < 2) continue;
    const positions = pile.cards.map(c => s.root.list.indexOf(c));
    out[pile.stack.id] = { front: positions.indexOf(Math.max(...positions)), cards: pile.cards.length };
  }
  return JSON.stringify(out);
})()`);
for (const [pile, { front, cards }] of Object.entries(JSON.parse(painted))) {
  const wantsOldest = pile.endsWith('first-on-top');
  check(front === (wantsOldest ? 0 : cards - 1),
    `${pile.padEnd(20)} paints ${wantsOldest ? 'the oldest' : 'the newest'} card in front`);
}

// And a card dropped on another stack joins it.
const moved = await evaluate(`(() => {
  const s = ${scene};
  const from = s.piles.find(p => p.cards.length > 1);
  const to = s.piles.find(p => p !== from && p.cards.length);
  const card = from.stack.order === 'first-on-top'
    ? from.cards[0] : from.cards[from.cards.length - 1];
  s.pickUp(card);
  card.setPosition(to.stack.x, to.stack.y);
  s.drop();
  return to.cards.includes(card);
})()`);
check(moved === true, 'a card dropped on another stack joins it');

// And the courts arrive on a page that never waits for them. Every demo but
// /courts.html starts its render and builds its deck in the same breath, so
// the portraits land on cards that were already drawn as pips - which is the
// only thing making that legal, and it fails silently if it stops working.
const upgraded = await evaluate(`(() => {
  const all = [];
  const walk = (o) => { for (const c of (o.list || [])) { all.push(c); walk(c); } };
  ${scene}.children.list.forEach(walk);
  return all.filter(o => o.type === 'Image'
    && o.texture.key.startsWith('pce-court-svg')).length;
})()`);
check(upgraded === 12,
  `the twelve portraits reach cards that were built before them (${upgraded})`);

// And the hold'em table, which is every primitive at once: stacks, throws,
// draw order and turning cards over.
console.log('\nand the hold\'em table');
await send('Page.navigate', { url: `${host.replace(/\/$/, '')}/holdem.html` });
if (!await until('!!window.__game && Object.values(window.__game.scene.keys)[0].deck?.length')) {
  console.log('  FAIL the table never appeared');
  done(1);
}
await sleep(1500);
const table = 'Object.values(window.__game.scene.keys)[0]';

// Deal a hand at speed, recording which pile each card went to.
await evaluate(`(() => {
  const s = ${table};
  window.__order = [];
  const deliver = s.deliver.bind(s);
  s.deliver = async (to) => { window.__order.push(to); return deliver(to); };
  s.speed = 0.2;
  s.deal();
  return true;
})()`);
if (!await until(`${table}.dealing === false`, 60000)) {
  console.log('  FAIL the deal never finished');
  done(1);
}
await sleep(300);

const order = JSON.parse(await evaluate('JSON.stringify(window.__order)'));
// One card at a time, twice round the table - not two cards to each seat.
check(
  JSON.stringify(order.slice(0, 8)) ===
    JSON.stringify(['you', 'west', 'north', 'east', 'you', 'west', 'north', 'east']),
  'hole cards go one at a time, twice round the table',
);
check(
  JSON.stringify(order.slice(8)) ===
    JSON.stringify(['burn', 'board', 'board', 'board', 'burn', 'board', 'burn', 'board']),
  'a card is burned before the flop, the turn and the river',
);

const hand = JSON.parse(await evaluate(`JSON.stringify({
  counts: Object.fromEntries([...${table}.piles].map(([k, v]) => [k, v.cards.length])),
  deck: ${table}.deck.length,
  // Cards on the table rest square; cards in a hand rest at the angle that
  // hand holds them at, which is not the same claim and is the one that
  // catches a throw finishing a few degrees off and being snapped straight.
  settled: [...${table}.piles.values()].every((p) => {
    if (p.kind === 'stack') return p.cards.every(c => c.angle === 0);
    const places = window.__pce.handPositions(p.hand, p.cards.length);
    return p.cards.every((c, i) => Math.abs(
      ((c.angle - places[i].angle + 540) % 360) - 180) < 0.5);
  }),
  faceUp: Object.fromEntries([...${table}.piles].map(([k, v]) => [k, v.cards.every(c => c.card.faceUp)])),
  unique: (() => {
    const all = [...[...${table}.piles.values()].flatMap(p => p.cards), ...${table}.deck];
    return new Set(all.map(c => c.card.id)).size;
  })(),
})`));
check(JSON.stringify(hand.counts) === JSON.stringify({
  you: 2, west: 2, north: 2, east: 2, board: 5, burn: 3,
}), 'every pile ends with the right number of cards');
check(hand.deck === 36, `thirty-six left in the deck (${hand.deck})`);
check(hand.unique === 52, `no card dealt twice (${hand.unique} distinct)`);
check(hand.settled === true,
  'every card comes to rest where its pile holds it, after spinning');
check(hand.faceUp.you && hand.faceUp.board && !hand.faceUp.west && !hand.faceUp.burn,
  'your cards and the board face up, everyone else-s face down');

// And the hands, where a fan facing across the table straddles the wrap at
// 180 degrees. Cards already in a hand must take the short way to their new
// places when another arrives - the naive tween spins them a full turn to
// move five degrees, which is what it looked like when this shipped.
console.log('\nand the hands');
await send('Page.navigate', { url: `${host.replace(/\/$/, '')}/hands.html` });
if (!await until('!!window.__game && Object.values(window.__game.scene.keys)[0].deck?.length')) {
  console.log('  FAIL the hands never appeared');
  done(1);
}
await sleep(1500);
const hands = 'Object.values(window.__game.scene.keys)[0]';

await evaluate(`(() => {
  const s = ${hands};
  window.__turns = [];
  const add = s.tweens.add.bind(s.tweens);
  s.tweens.add = (config) => {
    const card = config.targets;
    if (card && typeof config.angle === 'number' && typeof card.angle === 'number') {
      // A throw is meant to spin; a re-fan is not. layHand's tweens are the
      // short ones.
      window.__turns.push({ turn: Math.abs(config.angle - card.angle), refan: config.duration === 160 });
    }
    return add(config);
  };
  return true;
})()`);
for (let i = 0; i < 10; i++) {
  await evaluate(`${hands}.throwOne()`);
  await sleep(240);
}
await sleep(800);

const turning = JSON.parse(await evaluate(`(() => {
  const all = window.__turns.filter(t => t.turn > 0.5);
  const refans = all.filter(t => t.refan);
  return JSON.stringify({
    refans: refans.length,
    worst: Math.round(Math.max(0, ...refans.map(t => t.turn))),
    spun: refans.filter(t => t.turn > 180).length,
  });
})()`));
check(turning.refans > 0, `the hands re-fan as cards arrive (${turning.refans} tweens)`);
check(turning.spun === 0 && turning.worst <= 90,
  `no card spins to get to its new place (worst turn ${turning.worst} degrees)`);
check(
  await evaluate(`${hands}.held.length + ${hands}.opposite.length === 10`),
  'ten cards reach the two hands',
);

// And the deck editor, which is every color decision in one place. Four
// systems that have to stay independent: the stock, the suit inks, the back,
// and the court palette. The failure worth catching is one bleeding into
// another - most of all a suit ink reaching the rules, which would be an
// editor that lets you recolor a deck into changing how it plays.
console.log('\nand the deck editor');
await send('Page.navigate', { url: `${root}/deck.html` });
if (!await until('!!window.__deck', 30000)) {
  console.log('  FAIL the deck editor never loaded');
  done(1);
}
await sleep(1200);
const editor = 'Object.values(window.__game.scene.keys)[0]';
const shown = `(() => {
  const s = ${editor};
  const keys = s.cards.map(c => c.list.filter(o => o.type === 'Image').map(o => o.texture.key)).flat();
  const court = keys.filter(k => k.startsWith('pce-court-svg'));
  return JSON.stringify({
    rank: s.rank,
    cards: s.cards.length,
    courts: court.length,
    palettes: new Set(court).size,
    deck: s.deck,
  });
})()`;

const ace = JSON.parse(await evaluate(shown));
check(ace.cards === 15, `five piles of three on the felt (${ace.cards})`);
check(ace.courts === 0, 'an ace is a pip, so no portrait is rendered for it');

// Step to the King. The whole point of the stepper is reaching the twelve
// cards that are paintings rather than pips.
for (let i = 0; i < 12; i++) {
  await evaluate("document.getElementById('next').click()");
  await sleep(320);
}
await sleep(1800);
const king = JSON.parse(await evaluate(shown));
check(king.rank === 12, `the stepper reaches the King (rank ${king.rank})`);
check(king.courts === 4,
  `and all four suits arrive as portraits rather than pips (${king.courts})`);

// Now move every color at once and check each landed where it was sent.
const wanted = {
  paper: '#f4ecd8', redink: '#2e8b57', blackink: '#7a3ba8', backcolor: '#7a2e35',
  'court-ink': '#3b2f6b', 'court-gold': '#d8b471', 'court-red': '#962d30',
};
for (const [id, value] of Object.entries(wanted)) {
  await evaluate(`(() => { const i = document.getElementById('${id}');
    i.value = '${value}'; i.dispatchEvent(new Event('change')); return true; })()`);
  await sleep(700);
}
await sleep(1800);
const edited = JSON.parse(await evaluate(shown));
const hex = (n) => '#' + Number(n).toString(16).padStart(6, '0');
check(hex(edited.deck.paper) === wanted.paper, `the stock moves (${hex(edited.deck.paper)})`);
check(hex(edited.deck.redInk) === wanted.redink
  && hex(edited.deck.blackInk) === wanted.blackink,
  'both suit inks move');
check(hex(edited.deck.backColor) === wanted.backcolor,
  `the deck color moves (${hex(edited.deck.backColor)})`);
check(edited.deck.court.ink === wanted['court-ink']
  && edited.deck.court.gold === wanted['court-gold']
  && edited.deck.court.red === wanted['court-red'],
  'and the court palette moves');
check(edited.courts === 4, 'the portraits survive being recolored');

// The court is printed on the card's own stock, or it reads as a sticker.
const stock = JSON.parse(await evaluate(`(() => {
  const s = ${editor};
  const key = s.cards.flatMap(c => c.list.filter(o => o.type === 'Image'
    && o.texture.key.startsWith('pce-court-svg')))[0].texture.key;
  const src = s.textures.get(key).getSourceImage();
  const c = document.createElement('canvas');
  c.width = src.width; c.height = src.height;
  const x = c.getContext('2d');
  x.drawImage(src, 0, 0);
  const d = x.getImageData(6, 6, 1, 1).data;
  return JSON.stringify({
    court: '#' + [d[0], d[1], d[2]].map(v => v.toString(16).padStart(2, '0')).join(''),
  });
})()`));
check(stock.court === wanted.paper,
  `the courts print on the card's own stock (${stock.court})`);

// A dark deck keeps its faces. The figure's whites are holes in the drawing
// with the card's background showing through, so one color for the card and
// the figure means a dark stock takes the King's face with it - which is what
// it did until the background was parted from the highlight on the canvas.
await evaluate(`(() => { const i = document.getElementById('paper');
  i.value = '#0b0b0f'; i.dispatchEvent(new Event('change')); return true; })()`);
await sleep(3000);
const dark = JSON.parse(await evaluate(`(() => {
  const s = ${editor};
  const key = s.cards.flatMap(c => c.list.filter(o => o.type === 'Image'
    && o.texture.key.startsWith('pce-court-svg')))[0].texture.key;
  const src = s.textures.get(key).getSourceImage();
  const c = document.createElement('canvas');
  c.width = src.width; c.height = src.height;
  const x = c.getContext('2d');
  x.drawImage(src, 0, 0);
  // Two samples. The left one falls inside the box where the source's own
  // index was painted out, so it would read as stock even if nothing else
  // worked; the right one is open sky above the figure's shoulder and is the
  // one that says the repaint actually ran.
  const corner = x.getImageData(6, 6, 1, 1).data;
  const sky = x.getImageData(src.width - 8, 6, 1, 1).data;
  const all = x.getImageData(0, 0, src.width, src.height).data;
  let pale = 0;
  for (let i = 0; i < all.length; i += 4) {
    if (all[i] > 220 && all[i + 1] > 215 && all[i + 2] > 205) pale++;
  }
  return JSON.stringify({
    corner: '#' + [corner[0], corner[1], corner[2]]
      .map(v => v.toString(16).padStart(2, '0')).join(''),
    sky: '#' + [sky[0], sky[1], sky[2]]
      .map(v => v.toString(16).padStart(2, '0')).join(''),
    pale: pale / (src.width * src.height),
  });
})()`));
check(dark.corner === '#0b0b0f' && dark.sky === '#0b0b0f',
  `a dark stock reaches the court's background (${dark.corner}, ${dark.sky})`);
// Bracketed at both ends, because this has failed in both directions. Too
// little pale is a King whose face went down with the card. Too much is a
// background that never got repainted - the version that walked each column
// down from the top left 23.5% pale, with a white box behind the Jack's hat
// where it stopped at the first thing he draws.
check(dark.pale > 0.08 && dark.pale < 0.21,
  `and the figure keeps its face and linen while the ground goes dark `
  + `(${(dark.pale * 100).toFixed(1)}% pale)`);

// Stranded background. The bug this catches was a pale wedge under a Queen's
// headdress: background walled off from the card's margin by the figure, too
// small to move the share-of-art number and invisible on three cards out of
// four. What gives it away is where it sits - above the shoulder line the
// left and right edges of the art are sky, so pale pixels there are
// background that never got repainted.
const stranded = JSON.parse(await evaluate(`(() => {
  const s = ${editor};
  const out = [];
  for (const sprite of s.cards) {
    for (const o of sprite.list) {
      if (o.type !== 'Image' || !o.texture.key.startsWith('pce-court-svg')) continue;
      const src = s.textures.get(o.texture.key).getSourceImage();
      const c = document.createElement('canvas');
      c.width = src.width; c.height = src.height;
      const x = c.getContext('2d');
      x.drawImage(src, 0, 0);
      const top = Math.floor(src.height * 0.6);
      let pale = 0;
      for (const column of [0, 1, src.width - 2, src.width - 1]) {
        const d = x.getImageData(column, 0, 1, top).data;
        for (let i = 0; i < d.length; i += 4) {
          if (d[i] > 200 && d[i + 1] > 200 && d[i + 2] > 190) pale++;
        }
      }
      out.push(pale);
    }
  }
  return JSON.stringify(out);
})()`));
check(stranded.length === 4 && stranded.every((n) => n < 40),
  `no background stranded along the edges of the art (${stranded.join(', ')} px)`);

// The two hand-placed seeds. This is the check that they still land where
// they were put: the king of hearts has a sliver of background between his
// hair and his sword that nothing reaches on its own, and at the King rank he
// is on screen.
const seeded = await evaluate(`(() => {
  const s = ${editor};
  const sprite = s.cards.find(c => c.card.suit === 'hearts' && c.card.rank === 'K');
  const key = sprite.list.filter(o => o.type === 'Image'
    && o.texture.key.startsWith('pce-court-svg'))[0].texture.key;
  const src = s.textures.get(key).getSourceImage();
  const c = document.createElement('canvas');
  c.width = src.width; c.height = src.height;
  const x = c.getContext('2d');
  x.drawImage(src, 0, 0);
  const d = x.getImageData(Math.round(0.769 * src.width), Math.round(0.362 * src.height), 1, 1).data;
  return '#' + [d[0], d[1], d[2]].map(v => v.toString(16).padStart(2, '0')).join('');
})()`);
check(seeded === '#0b0b0f',
  `the hand-placed seed still reaches its patch of background (${seeded})`);

// And none of it reached the rules.
const rules = JSON.parse(await evaluate('JSON.stringify(window.__deck.rules)'));
check(rules.hearts === 'red' && rules.spades === 'black',
  'and no amount of recoloring changes what a suit counts as');

// The six ready-made decks. Two of them are dark, which is the case that
// needs every field pulling together - inks flipped pale so the index shows,
// and the court's highlight left light so the figures do not go down with the
// card. A preset that renders a black rectangle is a preset that forgot one.
const decks = JSON.parse(await evaluate(
  `JSON.stringify([...document.querySelectorAll('#presets button')].map(b => b.textContent))`));
check(decks.length === 6, `six whole decks to start from (${decks.length})`);

const applied = [];
for (const name of decks) {
  await evaluate(`[...document.querySelectorAll('#presets button')]
    .find(b => b.textContent === ${JSON.stringify(name)}).click()`);
  await sleep(2600);
  applied.push(JSON.parse(await evaluate(`(() => {
    const s = ${editor};
    const keys = s.cards.flatMap(c => c.list.filter(o => o.type === 'Image')
      .map(o => o.texture.key));
    const lit = document.querySelector('#presets button.on');
    return JSON.stringify({
      name: ${JSON.stringify(name)},
      courts: keys.filter(k => k.startsWith('pce-court-svg')).length,
      lit: lit ? lit.textContent : null,
      paper: s.deck.paper,
      highlight: s.deck.court.highlight,
    });
  })()`)));
}
check(applied.every((d) => d.courts === 4),
  `every deck renders its courts (${applied.map((d) => d.courts).join('')})`);
check(applied.every((d) => d.lit === d.name),
  'and the deck you picked is the one shown as picked');

// The dark ones, specifically: a stock that dark with a highlight to match
// would be a card with no faces on it.
const dim = applied.filter((d) => d.paper < 0x404040);
check(dim.length >= 2, `at least two of them are dark decks (${dim.length})`);
check(dim.every((d) => cssLuma(d.highlight) > 200),
  `and each keeps a light court highlight (${dim.map((d) => d.highlight).join(' ')})`);

// A card can show a side it is not on. A card turning over in mid-air has to
// draw whichever face points at the camera while still belonging to its pile
// the way it did - so this has to move the drawing and leave `card.faceUp`
// alone, and putting it back has to follow the card again.
const flip = JSON.parse(await evaluate(`(() => {
  const s = ${editor};
  const card = s.cards.find(c => !c.card.faceUp);
  const was = { faceUp: card.card.faceUp, shown: card.shownFace };
  card.setDisplayFace(true);
  const during = { faceUp: card.card.faceUp, shown: card.shownFace };
  card.setDisplayFace(undefined);
  const after = { faceUp: card.card.faceUp, shown: card.shownFace };
  return JSON.stringify({ was, during, after });
})()`));
check(flip.was.shown === false && flip.during.shown === true,
  'a card can be drawn face up while it is still face down');
check(flip.during.faceUp === false,
  'and showing the other side does not turn the card over');
check(flip.after.shown === false,
  'and letting go of it follows the card again');

// The pip on its own, for the mark printed in an empty place.
const ghost = await evaluate(`(() => {
  const s = ${editor};
  const key = window.__pce_suitTexture(s, 'spades', 0xffffff);
  return s.textures.exists(key) ? key : 'missing';
})()`);
check(ghost.startsWith('pce-suit-') && ghost !== 'missing',
  `a suit can be had as a pip on its own (${ghost})`);

// Reset has to actually restore, or the editor is a one-way trip.
await evaluate("document.getElementById('reset').click()");
await sleep(1600);
const back = JSON.parse(await evaluate(shown));
check(hex(back.deck.paper) === '#fdfdfd' && hex(back.deck.redInk) === '#cf2436',
  'reset puts the deck back');

check(errors.length === 0, `no errors on the page${errors.length ? `: ${errors[0]}` : ''}`);
console.log(failures ? `\n${failures} failed` : '\nall good');
done(failures ? 1 : 0);
