// Dependency-free regression checks for sharing, startup failures and multiplayer recovery.
// Run: node --test tools/check_browser_compat.cjs
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
function section(start, end) {
  const a = html.indexOf(start), b = html.indexOf(end, a);
  assert.ok(a >= 0 && b > a, `Missing source section: ${start}`);
  return html.slice(a, b);
}
function fixture(search = '') {
  const elements = new Map(), prompts = [], notes = [], timers = new Map();
  const $ = id => {
    if (!elements.has(id)) elements.set(id, { hidden: true, value: '', textContent: '', disabled: false });
    return elements.get(id);
  };
  let timerID = 0;
  class Peer extends EventEmitter {
    static instances = [];
    constructor() { super(); Peer.instances.push(this); }
    connect(id, options) {
      this.host = id; this.options = options;
      this.conn = new EventEmitter();
      this.conn.open = false; this.conn.sent = [];
      this.conn.send = m => this.conn.sent.push(m);
      return this.conn;
    }
    destroy() {
      this.destroyed = true;
      if (this.conn) { this.conn.open = false; this.conn.emit('close'); }
    }
    reconnect() { this.reconnected = true; }
  }
  const context = vm.createContext({
    $, URL, params: new URLSearchParams(search), navigator: {},
    location: { pathname: '/game/', origin: 'https://game.example' },
    prompt: (...args) => prompts.push(args), note: (...args) => notes.push(args),
    NET: { role: 'guest', hostId: 'ffa-host' }, Peer, ICE: {}, P: { alive: true },
    VOICE: { calls: {} }, closeVoice() {}, locked: false, away: false,
    document: {}, syncGo() {}, answerCall() {}, onHostMsg() {}, performance: { now: () => 0 },
    lobbySend() { context.lobbySent = true; }, playerModelIdx: 0, myTeam: 'pirates',
    setPlaying(on) { context.playing = on; }, console,
    setTimeout: fn => { const id = ++timerID; timers.set(id, fn); return id; },
    clearTimeout: id => timers.delete(id),
    setInterval: fn => { const id = ++timerID; timers.set(id, fn); return id; },
    clearInterval: id => timers.delete(id),
  });
  vm.runInContext(section('function inviteURL(', '// ---------- Loop ----------'), context);
  vm.runInContext(section('function startGuest()', 'function guestSpawn('), context);
  return { context, $, prompts, notes, timers, Peer };
}
test('all shipped game scripts parse', () => {
  for (const [, body] of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)) new vm.Script(body);
  for (const file of ['vehicles.js', 'range.js', 'art.js', 'headlights.js']) new vm.Script(fs.readFileSync(path.join(root, file), 'utf8'));
});
test('invites retain the deployment path and encode host IDs', () => {
  const { context } = fixture();
  const url = new URL(context.inviteURL('ffa-host+1'));
  assert.equal(url.origin, 'https://game.example'); assert.equal(url.pathname, '/game/');
  assert.equal(url.searchParams.get('join'), 'ffa-host+1');
});
test('invites preserve Vercel access and test mode but discard stale joins and pose fixtures', () => {
  const { context } = fixture('?join=old&test&posefixture&posecheck&_vercel_share=a%2Bb&x-vercel-protection-bypass=automation-secret');
  const url = new URL(context.inviteURL('ffa-new'));
  assert.equal(url.searchParams.get('join'), 'ffa-new');
  assert.equal(url.searchParams.get('_vercel_share'), 'a+b');
  assert.ok(!url.searchParams.has('x-vercel-protection-bypass'));
  assert.ok(url.searchParams.has('test'));
  assert.ok(!url.searchParams.has('posefixture')); assert.ok(!url.searchParams.has('posecheck'));
});
test('copy works with clipboard access', async () => {
  const { context, prompts, notes } = fixture(); let copied;
  context.navigator.clipboard = { writeText: async text => { copied = text; } };
  await context.copyText('https://game.example/?join=h', 'Invite link');
  assert.equal(copied, 'https://game.example/?join=h'); assert.equal(prompts.length, 0); assert.equal(notes.length, 1);
});
for (const failure of ['missing', 'rejected', 'throws']) test(`copy provides selectable text when clipboard ${failure}`, async () => {
  const { context, prompts } = fixture();
  if (failure !== 'missing') context.navigator.clipboard = { writeText: () => {
    if (failure === 'throws') throw Error('Denied');
    return Promise.reject(Error('Denied'));
  } };
  await context.copyText('invite', 'Invite link');
  assert.equal(prompts[0][1], 'invite');
});
test('native share receives the complete invite URL', async () => {
  const { context, $ } = fixture(); let shared;
  $('invlink').value = 'https://game.example/?join=h';
  context.navigator.share = async value => { shared = value; };
  await $('hshare').onclick(); assert.equal(shared.url, $('invlink').value);
});
test('cancelling native share does not open a copy prompt', async () => {
  const { context, $, prompts } = fixture(); $('invlink').value = 'https://game.example/?join=h';
  context.navigator.share = async () => { throw Object.assign(Error(), { name: 'AbortError' }); };
  await $('hshare').onclick(); assert.equal(prompts.length, 0);
});
test('failed or unsupported native share falls back to copying', async () => {
  for (const supported of [false, true]) {
    const { context, $, prompts } = fixture(); $('invlink').value = 'https://game.example/?join=h';
    if (supported) context.navigator.share = async () => { throw Error('Unavailable'); };
    await $('hshare').onclick(); assert.equal(prompts[0][1], $('invlink').value);
  }
});
test('unready invites show a status instead of sharing invalid text', async () => {
  const { $, prompts } = fixture(); $('invlink').value = 'Starting multiplayer…';
  await $('copyinv').onclick(); await $('hshare').onclick();
  assert.equal(prompts.length, 0); assert.equal($('invitestatus').textContent, 'Starting multiplayer…');
});
test('guest connection opens the lobby and clears its deadline', () => {
  const { context, $, timers } = fixture(); context.startGuest();
  const peer = context.NET.peer; peer.emit('open'); peer.conn.open = true; peer.conn.emit('open');
  assert.ok(context.lobbySent); assert.equal(peer.host, 'ffa-host');
  assert.ok(!timers.has(context.NET.connectTimer)); assert.ok($('netretry').hidden);
  assert.ok(timers.has(context.NET.beat));
});
test('connection timeout cleans up and allows retry', () => {
  const { context, $, timers } = fixture(); context.startGuest(); const peer = context.NET.peer;
  timers.get(context.NET.connectTimer)();
  assert.ok(peer.destroyed); assert.equal(context.NET.peer, null); assert.equal(context.NET.conn, null);
  assert.ok(!$('netretry').hidden); assert.match($('netstat').textContent, /Could not reach/);
  $('netretry').onclick(); assert.ok(context.NET.peer); assert.ok($('netretry').hidden);
});
test('missing host, data errors and closed connections all offer retry', () => {
  for (const failure of ['host', 'error', 'close']) {
    const { context, $, timers } = fixture(); context.startGuest(); const peer = context.NET.peer;
    peer.emit('open');
    if (failure === 'host') peer.emit('error', { type: 'peer-unavailable' });
    else peer.conn.emit(failure, Error('Network failed'));
    assert.equal(context.NET.peer, null); assert.ok(!$('netretry').hidden); assert.equal(timers.size, 0);
    if (failure === 'host') assert.match($('netstat').textContent, /fresh invite/);
  }
});
test('callbacks from a replaced connection cannot invalidate a new attempt', () => {
  const { context, $ } = fixture(); context.startGuest(); const old = context.NET.peer; old.emit('open');
  context.startGuest(); const current = context.NET.peer;
  old.conn.emit('close'); old.emit('error', { type: 'peer-unavailable' }); old.emit('open');
  assert.equal(context.NET.peer, current); assert.ok($('netretry').hidden);
  assert.equal($('netstat').textContent, 'Connecting to host…');
});
test('signaling reconnects without dropping a working game channel', () => {
  const { context } = fixture(); context.startGuest(); const peer = context.NET.peer;
  peer.emit('open'); peer.conn.open = true; peer.conn.emit('open'); peer.emit('disconnected');
  assert.ok(peer.reconnected); assert.equal(context.NET.peer, peer);
});
test('silent host loss stops gameplay and offers retry even without a channel close event', () => {
  const { context, $, timers } = fixture(); context.startGuest(); const peer = context.NET.peer;
  peer.emit('open'); peer.conn.open = true; peer.conn.emit('open');
  context.NET.joined = true; context.locked = true;
  context.performance.now = () => 31000;
  timers.get(context.NET.beat)();
  assert.equal(context.playing, false); assert.equal(context.NET.joined, false);
  assert.ok(!$('netretry').hidden); assert.match($('netstat').textContent, /stopped responding/);
});
test('host replies keep the connection alive', () => {
  const { context, timers } = fixture(); context.startGuest(); const peer = context.NET.peer;
  peer.emit('open'); peer.conn.open = true; peer.conn.emit('open');
  context.performance.now = () => 29000; peer.conn.emit('data', { t: 'pong' });
  context.performance.now = () => 31000; timers.get(context.NET.beat)();
  assert.equal(context.NET.peer, peer); assert.equal(peer.conn.sent.at(-1).t, 'ping');
});
test('missing PeerJS offers recovery without throwing', () => {
  const { context, $ } = fixture(); context.Peer = undefined; context.startGuest();
  assert.match($('netstat').textContent, /could not download/); assert.ok(!$('netretry').hidden);
});
test('joining gameplay requires a live connection', () => {
  const { context, $ } = fixture();
  Object.assign(context, { READY: true, PICKED: true }); $('pname').value = 'Guest';
  vm.runInContext(section('const canGo =', 'function syncGo()') + '\nthis.canGo = canGo;', context);
  assert.equal(context.canGo(), false);
  context.NET.conn = { open: true }; assert.equal(context.canGo(), true);
  context.NET.conn.open = false; assert.equal(context.canGo(), false);
});
test('startup failures stay visible and reload preserves the current invite', () => {
  const { context, $ } = fixture(); const events = {}; let reloaded = false;
  context.HTMLScriptElement = class {};
  context.document = { getElementById: $ };
  context.location.reload = () => { reloaded = true; };
  context.addEventListener = (type, fn) => { events[type] = fn; };
  vm.runInContext(section('const GAME_STARTUP =', '</script>') + '\nthis.startup = GAME_STARTUP;', context);
  events.error({ target: new context.HTMLScriptElement() });
  assert.ok(!$('startup-error').hidden); assert.match($('startup-message').textContent, /could not download/);
  events.error({}); assert.match($('startup-message').textContent, /could not download/);
  $('startup-retry').onclick(); assert.ok(reloaded);
});
test('startup catches initialization errors but ignores unrelated later errors', () => {
  for (const ready of [true, false]) {
    const { context, $ } = fixture(); let onError;
    context.HTMLScriptElement = class {};
    context.document = { getElementById: $ };
    context.addEventListener = (type, fn) => { onError = fn; };
    vm.runInContext(section('const GAME_STARTUP =', '</script>') + '\nthis.startup = GAME_STARTUP;', context);
    if (ready) context.startup.ready();
    onError({}); assert.equal($('startup-error').hidden, ready);
  }
});
test('returning from the browser back/forward cache reloads destroyed peers', () => {
  const { context } = fixture(); let handler, reloads = 0;
  context.addEventListener = (type, fn) => { handler = fn; };
  context.location.reload = () => reloads++;
  vm.runInContext(section("addEventListener('pageshow'", 'function inviteURL('), context);
  handler({ persisted: false }); assert.equal(reloads, 0);
  handler({ persisted: true }); assert.equal(reloads, 1);
});
