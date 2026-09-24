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
check(tiles.length === 9, `the home screen lists nine demos (${tiles.length})`);
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

// And the messy toggle on this page, which turns every pile on it at once.
// Reversible both ways: the angles are worked out from each card's place in
// its pile, so turning it off and on again has to give the same pile back.
const squareAngles = await evaluate(`(() => { const s = ${scene};
  return s.piles.flatMap(p => p.cards.map(c => Math.round(c.angle * 100))).join(); })()`);
const dial = (value) => evaluate(`(() => { const i = document.getElementById('messy');
  i.value = '${value}'; i.dispatchEvent(new Event('input')); return true; })()`);
await dial(1);
await sleep(500);
const messAngles = JSON.parse(await evaluate(`(() => { const s = ${scene};
  const all = s.piles.flatMap(p => p.cards.map(c => c.angle));
  return JSON.stringify({
    cards: all.length,
    widest: Math.max(...all.map(Math.abs)),
    turned: all.filter(a => Math.abs(a) > 0.2).length,
  }); })()`));
check(squareAngles === new Array(messAngles.cards).fill(0).join(),
  'every pile starts square');
check(messAngles.turned > messAngles.cards * 0.9,
  `and messy turns the lot (${messAngles.turned} of ${messAngles.cards})`);
// Twelve degrees is MESSY_TURN, which the dial reaches at 1 and never
// passes however far somebody turns it.
check(messAngles.widest <= 12,
  `none of them past the dial's limit (${messAngles.widest.toFixed(1)} of 12)`);

await dial(0);
await sleep(400);
await dial(1);
await sleep(500);
const messAgain = await evaluate(`(() => { const s = ${scene};
  return s.piles.flatMap(p => p.cards.map(c => Math.round(c.angle * 100))).join(); })()`);
const stillMessy = await evaluate(`(() => { const s = ${scene};
  return s.piles.flatMap(p => p.cards.map(c => c.angle)).some(a => Math.abs(a) > 0.2); })()`);
check(stillMessy === true && messAgain.length > 0, 'turning it off and on again brings the mess back');

// Halfway up the dial is half the angle. A game picking numbers needs them
// to mean something next to each other.
await dial(0.5);
await sleep(500);
const halfWay = await evaluate(`(() => { const s = ${scene};
  return Math.max(...s.piles.flatMap(p => p.cards.map(c => Math.abs(c.angle)))); })()`);
check(Math.abs(halfWay - messAngles.widest / 2) < 0.01,
  `and half the dial is half the angle (${halfWay.toFixed(1)} of ${messAngles.widest.toFixed(1)})`);
await dial(0);

// A messy pile: one that was thrown at rather than dealt onto. The angles
// have to vary, stay inside what the stack allowed, and be the same every
// time it is drawn - a pile that rolled fresh angles on each redraw would
// shimmer, and a board redraws a pile on every move.
console.log('\nand a pile thrown at');
await send('Page.navigate', { url: `${root}/throws.html` });
if (!await until('!!window.__game && Object.values(window.__game.scene.keys)[0]?.piles?.length', 30000)) {
  console.log('  FAIL the throwing page never appeared');
  done(1);
}
await sleep(1000);
const throwing = 'Object.values(window.__game.scene.keys)[0]';
for (const pile of ['messy', 'squared']) {
  for (let i = 0; i < 8; i++) {
    await evaluate(`${throwing}.throwAtPile(${throwing}.piles.find(p => p.stack.id === '${pile}'))`);
    await sleep(320);
  }
}
await sleep(800);
const tilted = JSON.parse(await evaluate(`(() => {
  const s = ${throwing};
  const at = (id) => {
    const pile = s.piles.find(p => p.stack.id === id);
    const angles = pile.cards.map(c => c.angle);
    return {
      allowed: pile.stack.messy,
      widest: Math.max(...angles.map(Math.abs)),
      turned: angles.filter(a => Math.abs(a) > 0.2).length,
      cards: angles.length,
    };
  };
  return JSON.stringify({ messy: at('messy'), squared: at('squared') });
})()`));
check(tilted.squared.widest === 0,
  `a pile that was dealt onto stays square (${tilted.squared.widest} degrees)`);
check(tilted.messy.turned === tilted.messy.cards,
  `every card on a messy pile is turned (${tilted.messy.turned}/${tilted.messy.cards})`);
const ceiling = tilted.messy.allowed * 12;
check(tilted.messy.widest <= ceiling,
  `and none past the dial's ${ceiling.toFixed(1)}° (${tilted.messy.widest.toFixed(1)})`);

// And it settles rather than rolls: laying the pile out again must not move
// anything.
const settled = await evaluate(`(() => {
  const s = ${throwing};
  const pile = s.piles.find(p => p.stack.id === 'messy');
  const before = pile.cards.map(c => c.angle).join();
  s.layOut(pile);
  return pile.cards.map(c => c.angle).join() === before;
})()`);
check(settled === true, 'and drawing it again gives the same angles');

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

// The riffle. Watched from inside the page rather than sampled from here: a
// round trip over the wire is tens of milliseconds and the whole shuffle is
// under three seconds, so polling from out here reliably misses it - which it
// did, and read as an animation that never ran.
const riffle = JSON.parse(await evaluate(`(() => {
  const s = ${table};
  const before = s.deck.map(c => c.card.id).join();
  const was = s.deck.length;
  // The meshes are what move. The sprites stay where they are, hidden, and
  // come back at the end - so measuring them would measure nothing, which is
  // what this check used to do.
  let widest = 0;
  const watch = setInterval(() => {
    const planes = s.children.list.filter(o => o.type === 'Mesh' || o.type === 'Plane');
    if (!planes.length) return;
    const xs = planes.map(m => m.x);
    widest = Math.max(widest, Math.max(...xs) - Math.min(...xs));
  }, 25);
  return window.__riffle(s, { rounds: 1, duration: 260, stagger: 6 }).then(() => {
    clearInterval(watch);
    const xs = s.deck.map(c => c.x);
    return JSON.stringify({
      widest: Math.round(widest),
      squared: Math.round(Math.max(...xs) - Math.min(...xs)),
      kept: s.deck.map(c => c.card.id).join() === before,
      count: s.deck.length,
      was,
    });
  });
})()`));
check(riffle.widest > 120,
  `the deck parts into two packets (${riffle.widest}px apart)`);
check(riffle.squared === 0, `and squares up again (${riffle.squared} units of spread)`);
// The one that matters. The shuffle already happened in the data; this is an
// animation of it, and an animation that reordered the deck would leave the
// card on top not being the card that gets dealt first.
check(riffle.kept === true, 'and leaves the deck in the order it was already in');
// Whatever is left of the deck by this point in the deal - the riffle does
// not care how many, and must not lose any.
check(riffle.count === riffle.was,
  `with every card still in it (${riffle.count} of ${riffle.was})`);

// And the cards bend while it happens. For the length of a shuffle each card
// is a mesh rather than a sprite - a Container cannot be bowed - so the thing
// to check is that the meshes turn up, part, and are gone again afterwards.
console.log('\nand the riffle, close up');
await send('Page.navigate', { url: `${root}/shuffle.html` });
if (!await until('!!window.__game && Object.values(window.__game.scene.keys)[0]?.cards?.length', 30000)) {
  console.log('  FAIL the riffle page never appeared');
  done(1);
}
await sleep(1200);
const bench = 'Object.values(window.__game.scene.keys)[0]';
await evaluate(`${bench}.go(1, 2)`);
if (!await until(`${bench}.busy === false`, 60000)) {
  console.log('  FAIL the riffle never finished');
  done(1);
}
const bent = JSON.parse(await evaluate(`JSON.stringify(${bench}.seen)`));
check(bent.meshes === 52, `every card is bent, not just some (${bent.meshes})`);
check(bent.spread > 120, `the two packets part (${bent.spread}px)`);
// Bracketed, because too much bend is as wrong as none. Past about half a
// card's length the curve overshoots the camera and the card renders folded
// in half rather than bowed - which looked like a crease down every card.
check(bent.bow > 0.12 && bent.bow < 0.45,
  `and they bow without folding over (${bent.bow})`);
// The pile must stay behind the packets it is being dropped into. It grows
// past fifty cards and a packet is only twenty-six deep, so if the two share
// a depth range the pile climbs in front about halfway through the drop -
// which it did, and which nothing else here would notice.
check(bent.over === 0,
  `the pile never draws over a card still in hand (${bent.over} frames)`);

// And put away again: a mesh left behind is a card drawn twice.
const after = await evaluate(`${bench}.children.list
  .filter(o => o.type === 'Mesh' || o.type === 'Plane').length`);
check(after === 0, `with no mesh left on the table afterwards (${after})`);
check(await evaluate(`${bench}.cards.every(c => c.visible)`) === true,
  'and every card visible again');

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

// --- the box ---------------------------------------------------------------
//
// A tuck box is the one object in this package with no flat fallback: it is a
// Mesh, meshes are WebGL-only, and a mesh built from the wrong vertex order
// does not throw - it draws a bow-tie. So what is checked here is the shape
// itself, off the transformed vertices.
await send('Page.navigate', { url: `${root}/box.html` });
// Boolean, not the box itself. `Runtime.evaluate` with `returnByValue` has to
// serialise what the expression returns, and a TuckBox holds Phaser meshes
// that hold the scene that holds the box - so handing one back comes out as
// nothing at all, and the wait times out on a page that is working perfectly.
if (!await until('!!(window.__game && Object.values(window.__game.scene.keys)[0].box)')) {
  console.log('  FAIL the box never appeared');
  done(1);
}
await sleep(2500);
const boxScene = 'Object.values(window.__game.scene.keys)[0]';

const built = JSON.parse(await evaluate(`(() => {
  const s = ${boxScene};
  const meshes = s.children.list.filter(o => o.type === 'Mesh');
  return JSON.stringify({
    meshes: meshes.length,
    verts: meshes.map(m => m.vertices.length),
    // Six vertices a quad, and every quad's two triangles share an edge - so
    // a mesh whose vertices got shuffled shows up as quads with no area.
    //
    // The full 3D cross product, not a projection of it. Measuring the area
    // in one plane calls every horizontal panel degenerate - the base and the
    // shut lid are both flat in y - and reports twelve failures on a box that
    // is perfectly built.
    degenerate: meshes.reduce((n, m) => {
      for (let i = 0; i < m.vertices.length; i += 3) {
        const [a, b, c] = [m.vertices[i], m.vertices[i+1], m.vertices[i+2]];
        const u = { x: b.x-a.x, y: b.y-a.y, z: b.z-a.z };
        const v = { x: c.x-a.x, y: c.y-a.y, z: c.z-a.z };
        const area = Math.hypot(
          u.y*v.z - u.z*v.y, u.z*v.x - u.x*v.z, u.x*v.y - u.y*v.x);
        if (area < 1e-6) n++;
      }
      return n;
    }, 0),
  });
})()`));
check(built.meshes === 3, `a box is three meshes - lid, deck, body (${built.meshes})`);
check(built.verts.every(v => v % 6 === 0) && built.verts[0] === 24,
  `built from whole quads (${built.verts.join('/')} vertices)`);
check(built.degenerate === 0, `and no triangle collapsed (${built.degenerate})`);

// Opening it has to move the lid and nothing else, and the deck has to stay
// put until the lid is out of its way.
const lid = JSON.parse(await evaluate(`(() => {
  const s = ${boxScene};
  const at = (open) => {
    s.box.open = open;
    const lidMesh = s.children.list.filter(o => o.type === 'Mesh')[0];
    const deck = s.children.list.filter(o => o.type === 'Mesh')[1];
    return {
      tip: Math.min(...lidMesh.vertices.map(v => v.y)),
      rise: +deck.modelPosition.y.toFixed(2),
    };
  };
  const shut = at(0); const half = at(0.5); const wide = at(1);
  s.box.open = 0;
  return JSON.stringify({ shut, half, wide });
})()`));
check(lid.wide.tip > lid.shut.tip,
  `the lid swings up as it opens (${lid.shut.tip.toFixed(0)} -> ${lid.wide.tip.toFixed(0)})`);
check(Math.abs(lid.half.rise - lid.shut.rise) < 0.01,
  'and the deck does not move while the lid is still over it');
check(lid.wide.rise > lid.shut.rise + 10,
  `then the deck lifts out (${(lid.wide.rise - lid.shut.rise).toFixed(0)} units)`);

// And the whole sequence, which is the demo: turn to face, open, hand over
// fifty-two real cards, riffle them.
await evaluate("document.getElementById('open').click()");
const dealt = await until(`${boxScene}.cards.length === 52`, 30000);
check(dealt === true, 'opening the box hands over fifty-two cards');
check(await until(`/Shuffled/.test(document.getElementById('note').textContent)`, 20000),
  'and they come out shuffled');

// The riffle draws every card from one snapshot, which is a cache - and a
// cache keyed on the card's size alone meant the first pack shuffled kept its
// back for every pack after it. A game with two decks dealt one and riffled
// the other, and nothing but changing deck and shuffling again would show it.
const first = await evaluate(
  `[...${boxScene}.textures.getTextureKeys()].filter(k => k.startsWith('pce-riffle')).length`);
const was = await evaluate(`${boxScene}.theme`);
await evaluate("document.getElementById('deck').click()");
await sleep(1500);
const now = await evaluate(`${boxScene}.theme`);
await evaluate("document.getElementById('open').click()");
await until(`/Shuffled/.test(document.getElementById('note').textContent)`, 30000);
const snaps = JSON.parse(await evaluate(`JSON.stringify(
  [...${boxScene}.textures.getTextureKeys()].filter(k => k.startsWith('pce-riffle')))`));
check(was !== now, `a second deck to shuffle (${was} then ${now})`);
check(snaps.length === first + 1,
  `and it riffles its own back rather than the last deck's (${snaps.length} snapshots)`);
check(snaps.some((k) => k.includes(now)) && snaps.some((k) => k.includes(was)),
  `each deck keeping its own (${snaps.map((k) => k.split('-')[2]).join(', ')})`);

// --- the three faces -------------------------------------------------------
//
// The thing a unit test cannot reach: whether a corner and the pips beside it
// actually stay off each other, which depends on how wide the rendered text
// turns out to be.
await send('Page.navigate', { url: `${root}/faces.html` });
if (!await until('!!(window.__game && Object.values(window.__game.scene.keys)[0].cards?.length)')) {
  console.log('  FAIL the faces never appeared');
  done(1);
}
await sleep(2500);
const faces = 'Object.values(window.__game.scene.keys)[0]';

const drawn = JSON.parse(await evaluate(`(() => {
  const s = ${faces};
  const of = (face, rank) => s.cards.find(c => c.card.id === face + '-' + rank);
  // The suits a card actually counts out, told from the two in its corners
  // and from the body and back underneath. Everything in a CardSprite's list
  // is an Image, so size alone is not enough: on the jumbo face the corner
  // suit and the pips happen to be drawn at the same size, and counting by
  // size alone made a seven into a nine. Inside the field as well.
  const suits = (card) => {
    const field = card.metrics.pips;
    const want = field ? field.size : card.metrics.pip.size;
    return card.list.filter(o => o.type === 'Image'
      && Math.abs(o.displayWidth - want) < 0.5
      && (!field || Math.abs(o.x) <= field.right + want / 2 + 0.1));
  };
  return JSON.stringify({
    indices: ['mobile', 'standard', 'jumbo'].map(f =>
      of(f, '7').list.filter(o => o.type === 'Text').length),
    pips: ['mobile', 'standard', 'jumbo'].map(f => suits(of(f, '7')).length),
    // Half the pips on a ten are upside down, which is what makes the card
    // the same either way up. Phaser wraps a half turn to -180, not 180.
    turned: suits(of('standard', '10')).filter(o => Math.abs(o.angle) === 180).length,
  });
})()`));
check(JSON.stringify(drawn.indices) === '[1,2,2]',
  `one corner on mobile, two on the printed faces (${drawn.indices.join('/')})`);
check(drawn.pips[0] === 1 && drawn.pips[1] === 7 && drawn.pips[2] === 7,
  `and a true count of pips rather than one big suit (${drawn.pips.join('/')})`);
check(drawn.turned === 5,
  `and half of a ten's pips are printed upside down (${drawn.turned})`);

// The clearance the layout was measured against, checked against the text the
// browser actually laid out rather than against an assumed width. "10" is the
// widest rank and the only one this is ever tight for.
//
// A box overlap and not a horizontal one, because the two faces clear their
// pips in different directions: standard has room to put the columns beside
// the index, and jumbo - whose index is twice as wide - has none, so its pip
// field drops below the corner instead. Measuring only in x passes one and
// fails the other for no reason either of them is wrong.
const clear = JSON.parse(await evaluate(`(() => {
  const s = ${faces};
  const out = {};
  for (const face of ['standard', 'jumbo']) {
    const card = s.cards.find(c => c.card.id === face + '-10');
    const index = card.list.find(o => o.type === 'Text');
    const corner = { x0: index.x, x1: index.x + index.width,
      y0: index.y - index.height / 2, y1: index.y + index.height / 2 };
    const size = card.metrics.pips.size;
    const pips = card.list.filter(o => o.type === 'Image'
      && Math.abs(o.displayWidth - size) < 0.5
      && Math.abs(o.x) <= card.metrics.pips.right + size / 2 + 0.1);
    out[face] = pips.filter(p => {
      const box = { x0: p.x - size / 2, x1: p.x + size / 2,
        y0: p.y - size / 2, y1: p.y + size / 2 };
      return box.x0 < corner.x1 && corner.x0 < box.x1
        && box.y0 < corner.y1 && corner.y0 < box.y1;
    }).length;
  }
  return JSON.stringify(out);
})()`));
check(clear.standard === 0 && clear.jumbo === 0,
  `a ten's index is printed on none of its pips `
  + `(standard ${clear.standard}, jumbo ${clear.jumbo})`);

// A real court is double-ended - one figure and the same figure upside down -
// in a ruled panel with the corners beside it. The mobile face is the one
// that is not, by choice: one figure, full bleed, twice the size.
const courts = JSON.parse(await evaluate(`(() => {
  const s = ${faces};
  const out = {};
  for (const face of ['mobile', 'standard', 'jumbo']) {
    const card = s.cards.find(c => c.card.id === face + '-K');
    const art = card.list.find(o => o.type === 'Image' && o.texture.key.includes('court'));
    const frame = card.list.find(o => o.type === 'Rectangle');
    out[face] = {
      cut: card.metrics.court.cut,
      // Twice as tall as it is wide for two figures; about four-fifths for
      // one. The texture's own shape, not the card's.
      shape: art ? +(art.height / art.width).toFixed(2) : 0,
      wide: art ? +(art.displayWidth / card.metrics.width).toFixed(2) : 0,
      framed: !!frame,
    };
  }
  return JSON.stringify(out);
})()`));
check(courts.mobile.cut === 'half' && courts.standard.cut === 'full'
  && courts.jumbo.cut === 'full',
  `one figure on the mobile face and both on the printed ones `
  + `(${courts.mobile.cut}/${courts.standard.cut}/${courts.jumbo.cut})`);
// Not quite twice: the framed cut also drops the blank margin at each end,
// which the half one keeps.
check(courts.standard.shape > courts.mobile.shape * 1.8,
  `and the double-ended art is close to twice as tall `
  + `(${courts.mobile.shape} -> ${courts.standard.shape})`);
check(courts.mobile.wide === 1 && courts.standard.wide < 0.8,
  `full bleed on one and a framed panel on the other `
  + `(${courts.mobile.wide} / ${courts.standard.wide} of the card)`);
check(!courts.mobile.framed && courts.standard.framed && courts.jumbo.framed,
  'and only the framed ones are ruled');

// The picture has to reach its frame. The source page has a blank margin
// above the figure and below it, and a crop that keeps that margin puts a
// white strip between the art and the rule at both ends - which is a gap you
// see long before you work out where it came from.
const filled = JSON.parse(await evaluate(`(async () => {
  const s = ${faces};
  const ph = window.__pce;
  await ph.renderCourts(s, ph.courtStart('press'), { cut: 'full', width: 480 });
  let worst = 0;
  let card = '';
  for (const rank of ['J', 'Q', 'K']) {
    for (const suit of ['spades', 'hearts', 'diamonds', 'clubs']) {
      const key = [...s.textures.getTextureKeys()].find((k) =>
        k.includes('court') && k.includes('full') && k.endsWith(rank + '-' + suit));
      const src = s.textures.get(key).getSourceImage();
      const c = document.createElement('canvas');
      c.width = src.width; c.height = src.height;
      const pen = c.getContext('2d');
      pen.drawImage(src, 0, 0);
      const px = pen.getImageData(0, 0, c.width, c.height).data;
      const inked = (y) => {
        for (let x = 0; x < c.width; x++) {
          const i = (y * c.width + x) * 4;
          if (0.3 * px[i] + 0.6 * px[i + 1] + 0.1 * px[i + 2] < 215) return true;
        }
        return false;
      };
      let top = 0; while (top < c.height && !inked(top)) top++;
      let bottom = c.height - 1; while (bottom > 0 && !inked(bottom)) bottom--;
      const blank = Math.max(top, c.height - 1 - bottom) / c.height;
      if (blank > worst) { worst = blank; card = rank + suit[0]; }
    }
  }
  return JSON.stringify({ blank: +worst.toFixed(4), card });
})()`));
check(filled.blank < 0.005,
  `every court reaches its frame - widest gap `
  + `${(filled.blank * 100).toFixed(2)}% on ${filled.card || 'none'}`);

// The corner has to be clear of the panel, and clear by something you can
// see. A real card's very nearly touch, which is what I sized this to first -
// but "very nearly" on a printed card is a hairline, and here it came out as
// a rank sitting on the rule.
//
// All three court ranks, not just the K. The widest is the Q, and a check
// that only ever looks at one rank is a check that passes on the rank it
// happens to have been written against.
const corner = JSON.parse(await evaluate(`(async () => {
  const s = ${faces};
  const ph = window.__pce;
  await ph.renderCourts(s, ph.courtStart('press'), { cut: 'full' });
  const out = {};
  for (const face of ['standard', 'jumbo']) {
    let tightest = 99;
    let worst = '';
    for (const rank of ['J', 'Q', 'K']) {
      const card = new ph.CardSprite(s,
        { id: 'gap' + face + rank, rank, suit: 'spades', faceUp: true },
        { width: 60, face, theme: 'press' });
      card.setPosition(-900, -900);
      const m = card.metrics;
      const index = card.list.find(o => o.type === 'Text');
      const suit = card.list.filter(o => o.type === 'Image')
        .find(o => Math.abs(o.displayWidth - m.index.suitSize) < 0.3);
      // The rank and the suit under it - whichever reaches furthest in.
      const reach = Math.max(index.x + index.width,
        suit ? suit.x + suit.displayWidth / 2 : -99);
      const gap = (-m.width * m.court.panel / 2) - reach;
      if (gap < tightest) { tightest = gap; worst = rank; }
      card.destroy();
    }
    out[face] = { gap: +tightest.toFixed(2), rank: worst };
  }
  return JSON.stringify(out);
})()`));
check(corner.standard.gap > 0.5 && corner.jumbo.gap > 0.5,
  `every court's corner is clear of its panel - tightest `
  + `${corner.standard.rank} ${corner.standard.gap} on standard, `
  + `${corner.jumbo.rank} ${corner.jumbo.gap} on jumbo (60-unit card)`);

// In pixels, because this is the one that slipped through by eye. Drawn
// behind the art, the only part of the rule that showed was whatever sliver
// fell outside the picture - a sub-pixel that survived on three edges and
// rounded away on the fourth, so every court had an open bottom.
//
// The four corners, and not the middles of the edges: a court's own drawing
// runs dark right up to the rule half way along a side, so a missing rule
// there is invisible to anything counting dark pixels. At the corners the art
// is white on all twelve, so ink there is the rule or it is nothing.
const ruleAt = `(async () => {
  const s = ${faces};
  const card = s.cards.find(c => c.card.id === 'standard-K');
  const frame = card.list.find(o => o.type === 'Rectangle');
  const b = frame.getBounds();
  const pad = 5;
  const shot = await new Promise((r) => s.game.renderer.snapshotArea(
    Math.round(b.x - pad), Math.round(b.y - pad),
    Math.round(b.width + pad * 2), Math.round(b.height + pad * 2), r));
  const c = document.createElement('canvas');
  c.width = shot.width; c.height = shot.height;
  const pen = c.getContext('2d');
  pen.drawImage(shot, 0, 0);
  const px = pen.getImageData(0, 0, c.width, c.height).data;
  // Darker than the stock rather than a match for the ink: a hairline is
  // half antialiasing, and a 50% blend of this rule on white paper is still
  // nowhere near white.
  const dark = (x, y) => {
    const i = (y * c.width + x) * 4;
    return 0.3 * px[i] + 0.6 * px[i + 1] + 0.1 * px[i + 2] < 215;
  };
  // A window over each corner of the boundary, reaching a couple of pixels
  // either side of it.
  const corners = [[pad, pad], [c.width - pad - 1, pad],
    [pad, c.height - pad - 1], [c.width - pad - 1, c.height - pad - 1]];
  return corners.filter(([cx, cy]) => {
    for (let dx = -2; dx <= 2; dx++) {
      for (let dy = -2; dy <= 2; dy++) if (dark(cx + dx, cy + dy)) return true;
    }
    return false;
  }).length;
})`;
const inked = await evaluate(`${ruleAt}()`);
check(inked === 4, `the panel is a closed rectangle - ink at all four corners (${inked}/4)`);

// That one says there is a rule; it does not say the rule is whole, because
// burying it under the art still leaves ink at the corners - measured, not
// assumed. What was actually wrong is the order, so the order is what is
// checked, and checked both ways: a court built before its portrait exists
// takes it later, and that second path had its own idea of where the rule
// went.
const stacked = JSON.parse(await evaluate(`(() => {
  const s = ${faces};
  const out = {};
  for (const face of ['standard', 'jumbo']) {
    const card = s.cards.find(c => c.card.id === face + '-K');
    const art = card.list.find(o => o.type === 'Image' && o.texture.key.includes('court'));
    const frame = card.list.find(o => o.type === 'Rectangle');
    out[face] = card.getIndex(frame) - card.getIndex(art);
  }
  return JSON.stringify(out);
})()`));
check(stacked.standard > 0 && stacked.jumbo > 0,
  `the rule is printed over the panel rather than under it `
  + `(${stacked.standard}, ${stacked.jumbo} places above the art)`);

// The other path. A game may create its deck and start rendering its courts
// in the same breath - that is the whole point of the portraits being able to
// arrive late - and a card built in the meantime shows a pip and swaps it for
// the picture when it lands. The rule has to arrive with it, in the right
// place, and that code is not the constructor's.
const late = JSON.parse(await evaluate(`(async () => {
  const s = ${faces};
  const ph = window.__pce;
  // A palette nothing has rendered, so the texture genuinely is not there
  // yet and the card has to wait for it.
  const palette = { ...ph.courtStart('press'), gold: '#e8b423' };
  const card = new ph.CardSprite(s, { id: 'late-K', rank: 'K', suit: 'spades', faceUp: true },
    { width: 100, face: 'standard', courtPalette: palette, courtWidth: 480 });
  card.setPosition(-500, -500);
  const before = {
    art: card.list.some(o => o.type === 'Image' && o.texture.key.includes('court')),
    frame: card.list.some(o => o.type === 'Rectangle'),
  };
  await ph.renderCourts(s, palette, { cut: 'full', width: 480, suits: ['spades'] });
  await new Promise((r) => setTimeout(r, 400));
  const art = card.list.find(o => o.type === 'Image' && o.texture.key.includes('court'));
  const frame = card.list.find(o => o.type === 'Rectangle');
  const out = {
    before,
    arrived: !!art,
    above: art && frame ? card.getIndex(frame) - card.getIndex(art) : 0,
    // And it has to be hidden with the rest of the face when the card turns.
    hides: (() => {
      card.setFaceUp(false);
      const hidden = frame ? frame.visible : true;
      card.setFaceUp(true);
      return !hidden && (frame ? frame.visible : false);
    })(),
  };
  card.destroy();
  return JSON.stringify(out);
})()`));
check(late.before.art === false && late.before.frame === false,
  'a court built before its portrait exists starts with neither picture nor rule');
check(late.arrived === true && late.above > 0,
  `and takes both when the portrait lands, the rule over the art (${late.above})`);
check(late.hides === true, 'and the rule turns over with the card');

check(errors.length === 0, `no errors on the page${errors.length ? `: ${errors[0]}` : ''}`);
console.log(failures ? `\n${failures} failed` : '\nall good');
done(failures ? 1 : 0);
