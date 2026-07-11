// === SFX sintetizados (Web Audio) — efectos de sonido cortos generados por código ===
// Cero archivos y cero costo: cada efecto se sintetiza una vez en un OfflineAudioContext,
// se codifica a WAV (PCM16 mono) y se cachea como data-URL. El data-URL viaja dentro del
// proyecto guardado y lo decodifica el mismo pipeline (fetch + decodeAudioData) que
// cualquier otro audio, así suena igual en el preview y en la exportación.

export type SfxId = 'whoosh' | 'pop' | 'ding' | 'riser' | 'click' | 'boom';

export const SFX_LIST: { id: SfxId; label: string; icon: string; desc: string }[] = [
  { id: 'whoosh', label: 'Whoosh', icon: 'fa-wind', desc: 'Barrido de aire — ideal en los cortes' },
  { id: 'pop', label: 'Pop', icon: 'fa-circle-dot', desc: 'Blip corto — para palabras clave y stickers' },
  { id: 'ding', label: 'Ding', icon: 'fa-bell', desc: 'Campanita — para el remate o el CTA' },
  { id: 'riser', label: 'Riser', icon: 'fa-arrow-trend-up', desc: 'Tensión ascendente — antes de revelar algo' },
  { id: 'click', label: 'Click', icon: 'fa-computer-mouse', desc: 'Tick seco — para listas y bullets' },
  { id: 'boom', label: 'Impacto', icon: 'fa-burst', desc: 'Golpe grave — para el hook de apertura' },
];

const SR = 44100;
const cache = new Map<SfxId, { url: string; duration: number }>();

function offline(dur: number): OfflineAudioContext {
  const Ctor = (window as any).OfflineAudioContext || (window as any).webkitOfflineAudioContext;
  return new Ctor(1, Math.ceil(dur * SR), SR);
}

// Ruido blanco determinístico (xorshift): el mismo SFX suena idéntico en cada sesión.
function noiseBuffer(ctx: OfflineAudioContext, dur: number): AudioBuffer {
  const buf = ctx.createBuffer(1, Math.ceil(dur * SR), SR);
  const d = buf.getChannelData(0);
  let s = 0x9e3779b9;
  for (let i = 0; i < d.length; i++) {
    s ^= s << 13; s ^= s >>> 17; s ^= s << 5;
    d[i] = ((s >>> 0) / 0xffffffff) * 2 - 1;
  }
  return buf;
}

function synthWhoosh(): Promise<AudioBuffer> {
  const dur = 0.55; const ctx = offline(dur);
  const src = ctx.createBufferSource(); src.buffer = noiseBuffer(ctx, dur);
  const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 0.9;
  bp.frequency.setValueAtTime(300, 0);
  bp.frequency.exponentialRampToValueAtTime(3200, dur * 0.45);
  bp.frequency.exponentialRampToValueAtTime(500, dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, 0);
  g.gain.exponentialRampToValueAtTime(0.9, dur * 0.4);
  g.gain.exponentialRampToValueAtTime(0.0001, dur);
  src.connect(bp).connect(g).connect(ctx.destination);
  src.start(0);
  return ctx.startRendering();
}

function synthPop(): Promise<AudioBuffer> {
  const dur = 0.16; const ctx = offline(dur);
  const osc = ctx.createOscillator(); osc.type = 'sine';
  osc.frequency.setValueAtTime(880, 0);
  osc.frequency.exponentialRampToValueAtTime(220, 0.12);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.9, 0);
  g.gain.exponentialRampToValueAtTime(0.0001, 0.14);
  osc.connect(g).connect(ctx.destination);
  osc.start(0); osc.stop(dur);
  // Chasquido de ataque: un toque de ruido agudo en los primeros ms.
  const n = ctx.createBufferSource(); n.buffer = noiseBuffer(ctx, 0.02);
  const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 2500;
  const ng = ctx.createGain();
  ng.gain.setValueAtTime(0.5, 0);
  ng.gain.exponentialRampToValueAtTime(0.0001, 0.02);
  n.connect(hp).connect(ng).connect(ctx.destination);
  n.start(0);
  return ctx.startRendering();
}

function synthDing(): Promise<AudioBuffer> {
  const dur = 0.9; const ctx = offline(dur);
  const mk = (freq: number, gain: number) => {
    const osc = ctx.createOscillator(); osc.type = 'sine'; osc.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, 0);
    g.gain.exponentialRampToValueAtTime(0.0001, dur);
    osc.connect(g).connect(ctx.destination);
    osc.start(0); osc.stop(dur);
  };
  mk(1318.5, 0.7);  // E6
  mk(2637, 0.18);   // armónico brillante
  return ctx.startRendering();
}

function synthRiser(): Promise<AudioBuffer> {
  const dur = 1.1; const ctx = offline(dur);
  const osc = ctx.createOscillator(); osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(180, 0);
  osc.frequency.exponentialRampToValueAtTime(720, dur);
  const og = ctx.createGain();
  og.gain.setValueAtTime(0.05, 0);
  og.gain.linearRampToValueAtTime(0.45, dur - 0.03);
  og.gain.exponentialRampToValueAtTime(0.0001, dur);
  osc.connect(og).connect(ctx.destination);
  osc.start(0); osc.stop(dur);
  const n = ctx.createBufferSource(); n.buffer = noiseBuffer(ctx, dur);
  const hp = ctx.createBiquadFilter(); hp.type = 'highpass';
  hp.frequency.setValueAtTime(800, 0);
  hp.frequency.exponentialRampToValueAtTime(4000, dur);
  const ng = ctx.createGain();
  ng.gain.setValueAtTime(0.02, 0);
  ng.gain.linearRampToValueAtTime(0.4, dur - 0.03);
  ng.gain.exponentialRampToValueAtTime(0.0001, dur);
  n.connect(hp).connect(ng).connect(ctx.destination);
  n.start(0);
  return ctx.startRendering();
}

function synthClick(): Promise<AudioBuffer> {
  const dur = 0.07; const ctx = offline(dur);
  const n = ctx.createBufferSource(); n.buffer = noiseBuffer(ctx, dur);
  const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 2200;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.9, 0);
  g.gain.exponentialRampToValueAtTime(0.0001, dur);
  n.connect(hp).connect(g).connect(ctx.destination);
  n.start(0);
  return ctx.startRendering();
}

function synthBoom(): Promise<AudioBuffer> {
  const dur = 0.7; const ctx = offline(dur);
  const osc = ctx.createOscillator(); osc.type = 'sine';
  osc.frequency.setValueAtTime(130, 0);
  osc.frequency.exponentialRampToValueAtTime(40, 0.35);
  const g = ctx.createGain();
  g.gain.setValueAtTime(1, 0);
  g.gain.exponentialRampToValueAtTime(0.0001, dur);
  osc.connect(g).connect(ctx.destination);
  osc.start(0); osc.stop(dur);
  const n = ctx.createBufferSource(); n.buffer = noiseBuffer(ctx, 0.08);
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 500;
  const ng = ctx.createGain();
  ng.gain.setValueAtTime(0.6, 0);
  ng.gain.exponentialRampToValueAtTime(0.0001, 0.08);
  n.connect(lp).connect(ng).connect(ctx.destination);
  n.start(0);
  return ctx.startRendering();
}

const SYNTHS: Record<SfxId, () => Promise<AudioBuffer>> = {
  whoosh: synthWhoosh, pop: synthPop, ding: synthDing, riser: synthRiser, click: synthClick, boom: synthBoom,
};

// AudioBuffer (mono) → WAV PCM16 con el pico normalizado, para que todos suenen parejos.
function encodeWav(buf: AudioBuffer): Uint8Array {
  const data = buf.getChannelData(0);
  let peak = 0;
  for (let i = 0; i < data.length; i++) peak = Math.max(peak, Math.abs(data[i]));
  const norm = peak > 0 ? 0.89 / peak : 1;
  const bytes = new Uint8Array(44 + data.length * 2);
  const dv = new DataView(bytes.buffer);
  const wstr = (off: number, s: string) => { for (let i = 0; i < s.length; i++) dv.setUint8(off + i, s.charCodeAt(i)); };
  wstr(0, 'RIFF'); dv.setUint32(4, 36 + data.length * 2, true); wstr(8, 'WAVE');
  wstr(12, 'fmt '); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true);
  dv.setUint32(24, buf.sampleRate, true); dv.setUint32(28, buf.sampleRate * 2, true);
  dv.setUint16(32, 2, true); dv.setUint16(34, 16, true);
  wstr(36, 'data'); dv.setUint32(40, data.length * 2, true);
  for (let i = 0; i < data.length; i++) {
    const v = Math.max(-1, Math.min(1, data[i] * norm));
    dv.setInt16(44 + i * 2, v < 0 ? v * 0x8000 : v * 0x7fff, true);
  }
  return bytes;
}

function toDataUrl(bytes: Uint8Array): string {
  let bin = '';
  const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) bin += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + CH)));
  return 'data:audio/wav;base64,' + btoa(bin);
}

// Devuelve el data-URL (y duración) del efecto; sintetiza y cachea la primera vez.
export async function getSfx(id: SfxId): Promise<{ url: string; duration: number }> {
  const hit = cache.get(id);
  if (hit) return hit;
  const buf = await SYNTHS[id]();
  const out = { url: toDataUrl(encodeWav(buf)), duration: buf.duration };
  cache.set(id, out);
  return out;
}

// Reproduce el efecto suelto (para escucharlo al pasar el mouse por el botón).
export async function previewSfx(id: SfxId): Promise<void> {
  const { url } = await getSfx(id);
  const a = new Audio(url);
  a.volume = 0.7;
  try { await a.play(); } catch { /* autoplay bloqueado: se escuchará al insertarlo */ }
}
