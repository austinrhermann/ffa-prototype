// Runs Whisper in the browser for transcript.js (module worker, so the game's main thread is never blocked).
// Protocol: {type:'load'} -> 'progress' (model download) then 'ready'; {type:'run', id, audio} (16 kHz mono Float32Array)
// -> 'prog' while it works, then 'done' with utterances [{start, end, text}] in seconds from the start of the audio.
import { pipeline, env } from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.0.2';
env.allowLocalModels = false;

const SR = 16000, FRAME = SR / 10; // 0.1 s frames
const VOICED_RMS = 0.01, JOIN_GAP = 1.5, PAD = 0.5, MIN_LEN = 0.3; // seconds, except the RMS level
let asr = null;

async function load() {
  const gpu = !!(self.navigator && navigator.gpu);
  let adapter = null; try { adapter = gpu && await navigator.gpu.requestAdapter(); } catch (e) {}
  const useGpu = !!adapter; // base on a GPU, tiny on the CPU (single-threaded wasm: no cross-origin isolation here)
  const model = useGpu ? 'onnx-community/whisper-base.en' : 'onnx-community/whisper-tiny.en';
  const files = {};
  asr = await pipeline('automatic-speech-recognition', model, {
    device: useGpu ? 'webgpu' : 'wasm',
    dtype: useGpu ? { encoder_model: 'fp32', decoder_model_merged: 'q4' } : 'q8',
    progress_callback: p => {
      if (p.status === 'progress' && p.file) { files[p.file] = [p.loaded, p.total]; const v = Object.values(files); const t = v.reduce((s, x) => s + x[1], 0); postMessage({ type: 'progress', pct: t ? v.reduce((s, x) => s + x[0], 0) / t : 0 }); }
    },
  });
  postMessage({ type: 'ready', model: model.split('/')[1], device: useGpu ? 'webgpu' : 'wasm' });
}

// Stretches of speech: 0.1 s frames above the level, gaps under JOIN_GAP bridged, padded. Silence is never sent to Whisper
// (it invents text, like "Thank you.", for silence), which also makes muted players free.
function voicedRegions(a) {
  const n = Math.floor(a.length / FRAME), loud = new Array(n);
  for (let f = 0; f < n; f++) { let s = 0; for (let i = f * FRAME, e = i + FRAME; i < e; i++) s += a[i] * a[i]; loud[f] = Math.sqrt(s / FRAME) > VOICED_RMS; }
  const out = []; let start = -1, last = -1;
  for (let f = 0; f <= n; f++) {
    if (f < n && loud[f]) { if (start < 0) start = f; last = f; }
    else if (start >= 0 && (f === n || (f - last) / 10 > JOIN_GAP)) { out.push([Math.max(0, start / 10 - PAD), Math.min(a.length / SR, (last + 1) / 10 + PAD)]); start = -1; }
  }
  return out.filter(r => r[1] - r[0] >= MIN_LEN);
}

async function run(id, audio) {
  const regions = voicedRegions(audio), total = regions.reduce((s, r) => s + r[1] - r[0], 0), utts = [];
  let done = 0;
  for (const [s, e] of regions) {
    const out = await asr(audio.subarray(Math.floor(s * SR), Math.ceil(e * SR)), { return_timestamps: true, chunk_length_s: 30, stride_length_s: 5 });
    for (const c of out.chunks || []) {
      const text = (c.text || '').trim(); if (!text) continue;
      utts.push({ start: s + (c.timestamp[0] || 0), end: s + (c.timestamp[1] == null ? e - s : c.timestamp[1]), text });
    }
    done += e - s; postMessage({ type: 'prog', id, pct: total ? done / total : 1 });
  }
  postMessage({ type: 'done', id, utts });
}

onmessage = async ({ data }) => {
  try {
    if (data.type === 'load') await load();
    else if (data.type === 'run') await run(data.id, data.audio);
  } catch (e) { postMessage({ type: 'error', id: data.id, message: String((e && e.message) || e).slice(0, 120) }); }
};
