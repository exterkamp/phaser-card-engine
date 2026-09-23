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

console.log(`smoking ${host}`);
await send('Page.navigate', { url: host });
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
  square: [...${table}.piles.values()].every(p => p.cards.every(c => c.angle === 0)),
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
check(hand.square === true, 'every card comes to rest square, after spinning');
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

check(errors.length === 0, `no errors on the page${errors.length ? `: ${errors[0]}` : ''}`);
console.log(failures ? `\n${failures} failed` : '\nall good');
done(failures ? 1 : 0);
