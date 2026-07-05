// === Transcripción con Whisper on-device (transformers.js) — compartida por el editor V2 ===
// Corre 100% en el navegador (WebGPU si está, si no WASM). Se carga bajo demanda. Costo por uso: $0.

import { decodeAudioUniversal } from './exporter';

export interface SubSegment { text: string; start: number; end: number }

let whisperPipePromise: Promise<any> | null = null;
export function loadWhisper(onProgress?: (pct: number) => void): Promise<any> {
  if (!whisperPipePromise) {
    whisperPipePromise = (async () => {
      const { pipeline } = await import('@huggingface/transformers');
      const useGpu = typeof navigator !== 'undefined' && !!(navigator as any).gpu;
      const files: Record<string, number> = {};
      return await pipeline('automatic-speech-recognition', 'onnx-community/whisper-base', {
        device: useGpu ? 'webgpu' : 'wasm',
        dtype: useGpu ? 'fp32' : 'q8',
        progress_callback: (info: any) => {
          if (!onProgress || info?.status !== 'progress' || !info.file) return;
          files[info.file] = typeof info.progress === 'number' ? info.progress : 0;
          const vals = Object.values(files);
          onProgress(Math.round(vals.reduce((a, b) => a + b, 0) / Math.max(1, vals.length)));
        },
      });
    })().catch((e) => { whisperPipePromise = null; throw e; });
  }
  return whisperPipePromise;
}

// Decodifica el audio de una fuente a Float32 mono 16 kHz (lo que espera Whisper).
async function decodeToMono16k(url: string): Promise<Float32Array> {
  const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
  let buf: AudioBuffer | null = null;
  try { buf = await decodeAudioUniversal(url, ctx); } finally { try { await ctx.close(); } catch { /* noop */ } }
  if (!buf) throw new Error('Sin pista de audio.');
  const off = new OfflineAudioContext(1, Math.max(1, Math.ceil(buf.duration * 16000)), 16000);
  const src = off.createBufferSource(); src.buffer = buf; src.connect(off.destination); src.start();
  const rendered = await off.startRendering();
  return rendered.getChannelData(0).slice();
}

// Parte un segmento largo en líneas cortas (por cantidad de palabras, largo y puntuación),
// repartiendo el tiempo proporcionalmente. Cada línea es un subtítulo editable aparte.
function splitIntoLines(text: string, start: number, end: number, maxWords = 5, maxChars = 30): SubSegment[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const lines: string[] = [];
  let cur: string[] = [];
  for (const w of words) {
    cur.push(w);
    const endsPhrase = /[.!?,;:]$/.test(w);
    const tooLong = cur.length >= maxWords || cur.join(' ').length >= maxChars;
    if (endsPhrase || tooLong) { lines.push(cur.join(' ')); cur = []; }
  }
  if (cur.length) lines.push(cur.join(' '));

  const totalWords = words.length;
  const dur = Math.max(0.2, end - start);
  const segs: SubSegment[] = [];
  let counted = 0;
  for (const line of lines) {
    const lw = line.split(/\s+/).filter(Boolean).length;
    const s = start + (counted / totalWords) * dur;
    counted += lw;
    const e = start + (counted / totalWords) * dur;
    segs.push({ text: line, start: s, end: Math.max(s + 0.3, e) });
  }
  return segs;
}

export async function transcribe(url: string, onStatus?: (msg: string) => void): Promise<SubSegment[]> {
  onStatus?.('Preparando audio…');
  const audio = await decodeToMono16k(url);
  onStatus?.('Cargando modelo…');
  const pipe = await loadWhisper((pct) => onStatus?.(`Descargando modelo… ${pct}%`));
  onStatus?.('Transcribiendo…');
  const total = audio.length / 16000;

  // Timestamps POR PALABRA → sincronía real con la voz (no estimada). Agrupamos en líneas cortas.
  try {
    const out: any = await pipe(audio, { return_timestamps: 'word', chunk_length_s: 30, stride_length_s: 5, language: 'spanish', task: 'transcribe' });
    const words: any[] = out?.chunks || [];
    if (words.length && Array.isArray(words[0]?.timestamp)) {
      const segs: SubSegment[] = [];
      let cur: { text: string; start: number; end: number }[] = [];
      const flush = () => {
        if (!cur.length) return;
        const text = cur.map(w => w.text).join('').trim();
        const start = cur[0].start;
        const end = Math.max(start + 0.25, cur[cur.length - 1].end);
        if (text) segs.push({ text, start, end });
        cur = [];
      };
      for (const w of words) {
        const text = String(w?.text || '');
        const s = Number(w?.timestamp?.[0]);
        const e = Number(w?.timestamp?.[1]);
        const prevEnd = cur.length ? cur[cur.length - 1].end : (segs.length ? segs[segs.length - 1].end : 0);
        cur.push({ text, start: isFinite(s) ? s : prevEnd, end: isFinite(e) ? e : (isFinite(s) ? s + 0.3 : prevEnd + 0.3) });
        const clean = text.trim();
        const lineLen = cur.map(x => x.text).join('').trim().length;
        if (cur.length >= 5 || lineLen >= 30 || /[.!?,;:]$/.test(clean)) flush();
      }
      flush();
      if (segs.length) return segs;
    }
  } catch (e) { console.warn('[whisper] word timestamps no disponibles, uso segmentos:', e); }

  // Fallback: timestamps por segmento (estimando el reparto por palabra).
  const out: any = await pipe(audio, { return_timestamps: true, chunk_length_s: 30, stride_length_s: 5, language: 'spanish', task: 'transcribe' });
  const chunks: any[] = out?.chunks || [];
  const segs: SubSegment[] = [];
  for (const c of chunks) {
    const text = String(c?.text || '').trim();
    if (!text) continue;
    const start = Math.max(0, Number(c?.timestamp?.[0]) || 0);
    let end = Number(c?.timestamp?.[1]);
    if (!isFinite(end)) end = Math.min(total, start + Math.max(1.2, text.length * 0.06));
    end = Math.max(start + 0.3, end);
    segs.push(...splitIntoLines(text, start, end));
  }
  return segs;
}
