// === Análisis de audio para auto-compaginado (Fase 2) ===
// Detección de beats (para beat-sync) y picos de energía por clip (para recortar silencios).
// Portado del editor anterior, usando la decodificación universal (navegador + mediabunny).

import { decodeAudioUniversal } from './exporter';

async function decode(url: string): Promise<AudioBuffer | null> {
  const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
  try { return await decodeAudioUniversal(url, ctx); } finally { try { await ctx.close(); } catch { /* noop */ } }
}

// Detecta los tiempos (s) de los beats de una pista, por flujo de energía (onset detection).
export async function detectBeats(url: string): Promise<number[]> {
  try {
    const buf = await decode(url);
    if (!buf) return [];
    const data = buf.getChannelData(0);
    const sr = buf.sampleRate;
    const hop = 512;
    const nF = Math.floor(data.length / hop);
    const energy = new Float32Array(nF);
    for (let i = 0; i < nF; i++) { let s = 0; for (let j = 0; j < hop; j++) { const x = data[i * hop + j]; s += x * x; } energy[i] = Math.sqrt(s / hop); }
    const flux = new Float32Array(nF);
    for (let i = 1; i < nF; i++) flux[i] = Math.max(0, energy[i] - energy[i - 1]);
    const win = 20, minGap = 0.28;
    const out: number[] = []; let lastT = -Infinity;
    for (let i = 1; i < nF - 1; i++) {
      let sum = 0, cnt = 0;
      for (let k = Math.max(0, i - win); k <= Math.min(nF - 1, i + win); k++) { sum += flux[k]; cnt++; }
      const thr = (sum / cnt) * 1.5 + 1e-4;
      if (flux[i] > thr && flux[i] >= flux[i - 1] && flux[i] >= flux[i + 1]) {
        const t = (i * hop) / sr;
        if (t - lastT >= minGap) { out.push(t); lastT = t; }
      }
    }
    return out;
  } catch { return []; }
}

// Picos de energía normalizados (0-1) de una fuente, para detectar silencios de inicio/fin.
export async function computePeaks(url: string, buckets = 220): Promise<number[]> {
  try {
    const buf = await decode(url);
    if (!buf) return [];
    const data = buf.getChannelData(0);
    const total = data.length;
    if (total <= 0) return [];
    const per = Math.max(1, Math.floor(total / buckets));
    const peaks: number[] = [];
    let max = 1e-6;
    for (let b = 0; b < buckets; b++) {
      let peak = 0; const base = b * per;
      for (let i = 0; i < per; i++) { const idx = base + i; if (idx >= total) break; const s = Math.abs(data[idx]); if (s > peak) peak = s; }
      peaks.push(peak); if (peak > max) max = peak;
    }
    return peaks.map(p => p / max);
  } catch { return []; }
}

// Recorta silencios de inicio/fin sobre los picos: devuelve [inicio, fin] dentro de [0, D].
export function silenceBounds(peaks: number[], D: number): [number, number] {
  if (!peaks.length || D <= 0) return [0, D];
  const thr = 0.07;
  let first = peaks.findIndex(p => p >= thr);
  let last = -1;
  for (let i = peaks.length - 1; i >= 0; i--) { if (peaks[i] >= thr) { last = i; break; } }
  if (first < 0 || last < 0) return [0, D];
  const pad = 0.15;
  const s = Math.max(0, (first / peaks.length) * D - pad);
  const e = Math.min(D, ((last + 1) / peaks.length) * D + pad);
  return (e - s) > 0.4 ? [s, e] : [0, D];
}
