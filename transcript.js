// Playtest transcript recorder (host only). Records each player's raw voice stream (before any proximity-voice gain),
// keeps the chunks in IndexedDB, and on demand sends them to a speech-to-text provider and merges the result into a
// timestamped .txt. index.html calls window.TRANSCRIPT.* from a few places; everything else lives here.
// Guests never load any of it: if this isn't the host the script does nothing and TRANSCRIPT stays undefined.
(() => {
  'use strict';
  if (typeof NET === 'undefined' || NET.role !== 'host' || !window.MediaRecorder || !window.indexedDB) return;

  const MIME = ['audio/webm;codecs=opus', 'audio/mp4'].find(m => MediaRecorder.isTypeSupported(m));
  if (!MIME) return;
  const CT = MIME.split(';')[0];
  const EXT = CT === 'audio/mp4' ? 'm4a' : 'webm';
  console.info('transcript: recording as', MIME);

  const LS_KEY = 'ffa-transcript-key', LS_PROV = 'ffa-transcript-provider';
  const GAP_MERGE_MS = 2000, CONCURRENCY = 3, OPENAI_LIMIT = 24e6, OPENAI_PART = 20e6;
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const pad = n => String(n).padStart(2, '0');
  const clock = ms => { const s = Math.max(0, Math.floor(ms / 1000)); return `${pad(Math.floor(s / 3600))}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}`; };
  const lsGet = k => { try { return localStorage.getItem(k) || ''; } catch (e) { return ''; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} };

  // ----- Storage: IndexedDB, with the chunks kept in memory only if the database can't be opened -----
  let db = null, writeQ = Promise.resolve();
  const mem = { recs: new Map(), chunks: new Map(), meta: new Map() };
  const meta = { sessionStart: 0, events: [], level: '' };
  const recs = new Map(); // rid -> { rid, name, key, startOffsetMs, endOffsetMs, mime, chunks }
  const live = new Map(); // key (peer id or 'host') -> { rec, mr, streamId }

  const req = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  const dbReady = new Promise(resolve => {
    try {
      const o = indexedDB.open('ffa-transcript', 1);
      o.onupgradeneeded = () => {
        o.result.createObjectStore('recs', { keyPath: 'rid' });
        o.result.createObjectStore('chunks', { keyPath: ['rid', 'seq'] });
        o.result.createObjectStore('meta', { keyPath: 'k' });
      };
      o.onsuccess = () => { db = o.result; resolve(); };
      o.onerror = o.onblocked = () => resolve();
    } catch (e) { resolve(); }
  });
  // Writes run one after another so a download can wait for everything pending
  function enqueue(fn) { writeQ = writeQ.then(fn).catch(() => {}); return writeQ; }
  const put = (store, val) => enqueue(async () => { await dbReady; if (!db) return; await req(db.transaction(store, 'readwrite').objectStore(store).put(val)); });
  const saveMeta = () => put('meta', { k: 'session', v: meta });
  const saveRec = rec => { mem.recs.set(rec.rid, rec); return put('recs', rec); };
  const saveChunk = (rid, seq, blob) => { if (!db) { if (!mem.chunks.has(rid)) mem.chunks.set(rid, []); mem.chunks.get(rid)[seq] = blob; } return put('chunks', { rid, seq, blob }); };
  async function loadChunks(rid) {
    await writeQ; await dbReady;
    if (!db) return (mem.chunks.get(rid) || []).filter(Boolean);
    const all = await req(db.transaction('chunks').objectStore('chunks').getAll(IDBKeyRange.bound([rid, 0], [rid, Infinity])));
    return all.sort((a, b) => a.seq - b.seq).map(c => c.blob);
  }
  async function clearAll() {
    for (const l of live.values()) stopRec(l);
    await writeQ; await dbReady;
    if (db) { const tx = db.transaction(['recs', 'chunks', 'meta'], 'readwrite'); ['recs', 'chunks', 'meta'].forEach(s => tx.objectStore(s).clear()); await new Promise(r => { tx.oncomplete = tx.onerror = tx.onabort = r; }); }
    recs.clear(); mem.chunks.clear(); mem.recs.clear(); Object.assign(meta, { sessionStart: 0, events: [], level: '' });
    refresh();
  }
  const loaded = (async () => {
    await dbReady; if (!db) return;
    try {
      const m = await req(db.transaction('meta').objectStore('meta').get('session'));
      if (m) Object.assign(meta, m.v);
      for (const r of await req(db.transaction('recs').objectStore('recs').getAll())) recs.set(r.rid, r);
    } catch (e) {}
  })();

  // ----- Recording -----
  let ridN = 0;
  const levelLabel = () => { try { return typeof curLevel !== 'undefined' && curLevel ? curLevel + (typeof MODE !== 'undefined' && MODE ? ` (${MODE})` : '') : ''; } catch (e) { return ''; } };
  function ensureSession() {
    if (!meta.sessionStart) { meta.sessionStart = Date.now(); saveMeta(); }
    const lv = levelLabel(); if (lv && lv !== meta.level) { meta.level = lv; saveMeta(); }
    return meta.sessionStart;
  }
  // Same name as another live player (a different peer): "Eli (2)", "Eli (3)"…
  function uniqueName(base, key) {
    const taken = new Set([...live.entries()].filter(([k]) => k !== key).map(([, l]) => l.rec.name));
    let name = base, n = 1; while (taken.has(name)) name = `${base} (${++n})`;
    return name;
  }
  function startRec(key, base, stream) {
    const sess = ensureSession();
    const off = Date.now() - sess;
    const rec = { rid: `r${Date.now().toString(36)}${++ridN}`, name: uniqueName(base, key), key, startOffsetMs: off, endOffsetMs: off, mime: MIME, chunks: 0 };
    let mr;
    try { mr = new MediaRecorder(new MediaStream(stream.getAudioTracks()), { mimeType: MIME, audioBitsPerSecond: 24000 }); } catch (e) { return; }
    const entry = { rec, mr, streamId: stream.id };
    mr.ondataavailable = e => {
      if (!e.data || !e.data.size) return;
      rec.endOffsetMs = Date.now() - meta.sessionStart;
      saveChunk(rec.rid, rec.chunks++, e.data); saveRec(rec);
    };
    mr.onstop = () => { if (live.get(key) === entry) live.delete(key); rec.endOffsetMs = Date.now() - meta.sessionStart; saveRec(rec); refresh(); };
    mr.onerror = () => stopRec(entry);
    recs.set(rec.rid, rec); live.set(key, entry); saveRec(rec);
    try { mr.start(5000); } catch (e) { live.delete(key); recs.delete(rec.rid); return; }
    refresh();
    return entry;
  }
  function stopRec(entry) { try { if (entry.mr.state !== 'inactive') entry.mr.stop(); } catch (e) {} }
  // Start (or restart) recording a stream; waits for an audio track if the stream has none yet
  function begin(key, nameOf, stream) {
    const cur = live.get(key);
    if (cur && cur.streamId === stream.id) return true; // PeerJS fires 'stream' once per track
    if (!stream.getAudioTracks().length) return false;
    if (cur) stopRec(cur);
    const entry = startRec(key, nameOf(), stream);
    if (entry) stream.getAudioTracks().forEach(t => t.addEventListener('ended', () => stopRec(entry)));
    return true;
  }
  function attach(key, nameOf, stream) {
    if (begin(key, nameOf, stream)) return;
    const h = () => { if (begin(key, nameOf, stream)) stream.removeEventListener('addtrack', h); };
    stream.addEventListener('addtrack', h);
  }
  const remoteName = peer => { try { const r = remotes.find(x => x.conn && x.conn.peer === peer); return (r && r.name) || 'Guest'; } catch (e) { return 'Guest'; } };
  const hostName = () => { try { return P.name || 'Host'; } catch (e) { return 'Host'; } };

  // Round events as "-- Round 2 started --" lines (hooked in resetMatch / endMatch)
  function event(kind) {
    if (!meta.sessionStart) return;
    const n = meta.events.filter(e => e.kind === 'start').length + (kind === 'start' ? 1 : 0);
    meta.events.push({ t: Date.now() - meta.sessionStart, kind, text: `Round ${n} ${kind === 'start' ? 'started' : 'ended'}` });
    ensureSession(); saveMeta();
  }

  window.TRANSCRIPT = {
    onRemoteStream(peer, stream) { attach(peer, () => remoteName(peer), stream); },
    onClose(peer) { const l = live.get(peer); if (l) stopRec(l); },
    onLocalMic(stream) { attach('host', hostName, stream); },
    event,
  };
  try { if (VOICE.stream) window.TRANSCRIPT.onLocalMic(VOICE.stream); } catch (e) {}

  // ----- Audio files -----
  const safe = s => s.replace(/[^\w.\- ()]+/g, '_').trim() || 'player';
  const sorted = () => [...recs.values()].filter(r => r.chunks > 0).sort((a, b) => a.startOffsetMs - b.startOffsetMs);
  const stamp = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  function save(blob, filename) {
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = filename;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 30000);
  }
  async function flush() { // push whatever the live recorders are holding into the store
    for (const l of live.values()) { try { if (l.mr.state === 'recording') l.mr.requestData(); } catch (e) {} }
    await sleep(250); await writeQ;
  }
  async function downloadAudio() {
    await flush();
    for (const rec of sorted()) {
      const blob = new Blob(await loadChunks(rec.rid), { type: rec.mime.split(';')[0] });
      save(blob, `${safe(rec.name)}_${Math.round(rec.startOffsetMs / 1000)}.${rec.mime.startsWith('audio/mp4') ? 'm4a' : 'webm'}`);
      await sleep(400); // browsers drop downloads fired in the same instant
    }
  }

  // ----- Transcription -----
  async function http(url, opts) {
    const res = await fetch(url, opts);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }
  async function deepgram(blob, key) {
    const j = await http('https://api.deepgram.com/v1/listen?model=nova-3&utterances=true&punctuate=true&smart_format=true', { method: 'POST', headers: { Authorization: `Token ${key}`, 'Content-Type': CT }, body: blob });
    const u = (j.results && j.results.utterances) || [];
    return u.map(x => ({ start: x.start, end: x.end, text: x.transcript }));
  }
  async function whisper(blob, key, ext) {
    const fd = new FormData(); fd.append('file', blob, `audio.${ext}`); fd.append('model', 'whisper-1'); fd.append('response_format', 'verbose_json');
    const j = await http('https://api.openai.com/v1/audio/transcriptions', { method: 'POST', headers: { Authorization: `Bearer ${key}` }, body: fd });
    return (j.segments || []).map(x => ({ start: x.start, end: x.end, text: x.text }));
  }
  // Whisper takes 25 MB per file. WebM pieces after the first have no header, so each one gets the first chunk's header
  // (everything before its first Cluster) and starts at its own first Cluster, whose timecode gives the piece's offset.
  const CLUSTER = [0x1F, 0x43, 0xB6, 0x75];
  const findCluster = u8 => { for (let i = 0; i + 4 < u8.length; i++) if (u8[i] === CLUSTER[0] && u8[i + 1] === CLUSTER[1] && u8[i + 2] === CLUSTER[2] && u8[i + 3] === CLUSTER[3]) return i; return -1; };
  function clusterTimeSec(u8, i) {
    let p = i + 4; p += Math.clz32(u8[p]) - 23; // size vint: 1 + leading zero bits in the byte
    if (u8[p] !== 0xE7) return null;
    const n = u8[++p] & 0x7F; let v = 0; for (let k = 1; k <= n; k++) v = v * 256 + u8[p + k];
    return v / 1000;
  }
  async function whisperParts(blobs) {
    const total = blobs.reduce((s, b) => s + b.size, 0);
    if (total <= OPENAI_LIMIT || EXT !== 'webm') return [{ blob: new Blob(blobs, { type: CT }), offset: 0 }];
    const head = new Uint8Array(await blobs[0].arrayBuffer()), hc = findCluster(head);
    if (hc < 0) return [{ blob: new Blob(blobs, { type: CT }), offset: 0 }];
    const header = head.slice(0, hc), parts = [{ blob: new Blob(blobs.slice(0, 1), { type: CT }), offset: 0, groups: [blobs[0]] }];
    let cur = parts[0], size = blobs[0].size;
    for (const b of blobs.slice(1)) {
      if (size + b.size > OPENAI_PART) { cur = { groups: [], offset: null }; parts.push(cur); size = 0; }
      cur.groups.push(b); size += b.size;
    }
    const out = [];
    for (const [i, p] of parts.entries()) {
      if (i === 0) { out.push({ blob: new Blob(p.groups, { type: CT }), offset: 0 }); continue; }
      const u8 = new Uint8Array(await p.groups[0].arrayBuffer()), at = findCluster(u8);
      if (at < 0) continue; // a piece that starts mid-cluster loses a few seconds rather than failing the file
      out.push({ blob: new Blob([header, u8.slice(at), ...p.groups.slice(1)], { type: CT }), offset: clusterTimeSec(u8, at) || 0 });
    }
    return out;
  }
  async function transcribeRec(rec, key, provider) {
    const blobs = await loadChunks(rec.rid);
    let utts = [];
    if (provider === 'openai') {
      for (const p of await whisperParts(blobs)) utts.push(...(await whisper(p.blob, key, EXT)).map(u => ({ ...u, start: u.start + p.offset, end: u.end + p.offset })));
    } else utts = await deepgram(new Blob(blobs, { type: CT }), key);
    return utts.filter(u => u.text && u.text.trim()).map(u => ({ name: rec.name, start: rec.startOffsetMs + u.start * 1000, end: rec.startOffsetMs + u.end * 1000, text: u.text.trim() }));
  }
  async function pool(items, n, fn) {
    let i = 0;
    await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) await fn(items[i++]); }));
  }

  // ----- Merge and format -----
  function formatTranscript(utts, failed) {
    utts.sort((a, b) => a.start - b.start);
    const merged = [];
    for (const u of utts) {
      const last = merged[merged.length - 1];
      if (last && last.name === u.name && u.start - last.end < GAP_MERGE_MS) { last.text += ' ' + u.text; last.end = Math.max(last.end, u.end); } else merged.push({ ...u });
    }
    const lines = [...merged.map(u => ({ t: u.start, s: `[${clock(u.start)}] ${u.name}: ${u.text}` })), ...meta.events.map(e => ({ t: e.t, s: `[${clock(e.t)}] -- ${e.text} --` }))].sort((a, b) => a.t - b.t);
    const players = [...new Set(sorted().map(r => r.name))];
    const dur = Math.max(0, ...[...recs.values()].map(r => (live.has(r.key) && live.get(r.key).rec === r ? Date.now() - meta.sessionStart : r.endOffsetMs)));
    const head = [`Playtest transcript, ${stamp(new Date(meta.sessionStart))}`];
    const lv = levelLabel() || meta.level;
    head.push(`${lv ? `Level: ${lv}   ` : ''}Players: ${players.join(', ')}`, `Duration: ${clock(dur)}`);
    if (failed.length) head.push(`Transcription failed for: ${failed.map(f => `${f.rec.name} at ${clock(f.rec.startOffsetMs)} (${f.err})`).join(', ')}. Their audio is available via Download audio files.`);
    return head.join('\n') + '\n\n' + (lines.length ? lines.map(l => l.s).join('\n') : '(no speech detected)') + '\n';
  }
  async function downloadTranscript(btn) {
    const key = ui.key.value.trim(), provider = ui.prov.value;
    if (!key) { ui.msg.textContent = 'Enter an API key first. "Download audio files" works without one.'; return; }
    ui.msg.textContent = ''; btn.disabled = true;
    try {
      await flush();
      const list = sorted(), utts = [], failed = []; let done = 0;
      btn.textContent = `Transcribing 0/${list.length}`;
      await pool(list, CONCURRENCY, async rec => {
        try { utts.push(...await transcribeRec(rec, key, provider)); }
        catch (e) { failed.push({ rec, err: /^HTTP \d+$/.test(e.message) ? e.message : 'network error' }); }
        btn.textContent = `Transcribing ${++done}/${list.length}`;
      });
      const d = new Date();
      save(new Blob([formatTranscript(utts, failed)], { type: 'text/plain' }), `playtest-${stamp(d)}-${pad(d.getHours())}${pad(d.getMinutes())}.txt`);
      ui.msg.textContent = failed.length ? `${failed.length} of ${list.length} recordings failed (listed in the file). Download audio files to keep them.` : '';
    } finally { btn.disabled = false; btn.textContent = 'Download transcript'; }
  }

  // ----- Panel in the Settings screen of the pause menu (a host-only row) -----
  const ui = {};
  function build(host) {
    const css = document.createElement('style');
    css.textContent = '#trpanel input,#trpanel select{width:100%;box-sizing:border-box;margin:0 0 8px;padding:8px;font:inherit}#trpanel button{margin:0 0 8px}';
    document.head.appendChild(css);
    host.innerHTML = '<span>Playtest transcript</span><small id="trstat"></small>';
    ui.stat = host.querySelector('#trstat'); ui.stat.style.display = 'block'; ui.stat.style.marginBottom = '8px';
    const mk = (tag, props) => Object.assign(document.createElement(tag), props);
    ui.dl = mk('button', { type: 'button', className: 'tog', textContent: 'Download transcript' });
    ui.audio = mk('button', { type: 'button', className: 'tog', textContent: 'Download audio files' });
    ui.prov = mk('select', { innerHTML: '<option value="deepgram">Deepgram (nova-3)</option><option value="openai">OpenAI (whisper-1)</option>', value: lsGet(LS_PROV) || 'deepgram' });
    ui.key = mk('input', { type: 'password', placeholder: 'Speech-to-text API key', autocomplete: 'off', spellcheck: false, value: lsGet(LS_KEY) });
    ui.clear = mk('button', { type: 'button', className: 'tog', textContent: 'Clear recording…' });
    ui.msg = mk('small', {}); ui.msg.style.display = 'block';
    ui.prov.onchange = () => lsSet(LS_PROV, ui.prov.value);
    ui.key.oninput = () => lsSet(LS_KEY, ui.key.value.trim());
    ui.dl.onclick = () => downloadTranscript(ui.dl);
    ui.audio.onclick = () => downloadAudio();
    ui.clear.onclick = () => { if (confirm('Delete all recorded audio from this session? This cannot be undone.')) clearAll(); };
    host.append(ui.dl, ui.audio, ui.prov, ui.key, ui.clear, ui.msg);
  }
  function refresh() {
    if (!ui.stat) return;
    const names = new Set([...live.values()].map(l => l.rec.name));
    const elapsed = meta.sessionStart ? Date.now() - meta.sessionStart : 0, s = Math.floor(elapsed / 1000);
    const t = s >= 3600 ? clock(elapsed) : `${pad(Math.floor(s / 60))}:${pad(s % 60)}`;
    const earlier = !live.size && recs.size ? ` Earlier recording kept (${sorted().length} segments).` : '';
    ui.stat.textContent = `Recording: ${names.size} player${names.size === 1 ? '' : 's'}, ${t}.${earlier}`;
  }
  const row = document.getElementById('trpanel');
  if (row) { build(row); loaded.then(refresh); setInterval(() => { if (row.offsetParent) refresh(); }, 1000); }
})();
