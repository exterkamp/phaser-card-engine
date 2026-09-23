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

check(errors.length === 0, `no errors on the page${errors.length ? `: ${errors[0]}` : ''}`);
console.log(failures ? `\n${failures} failed` : '\nall good');
done(failures ? 1 : 0);
