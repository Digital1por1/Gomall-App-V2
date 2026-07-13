// === Mezcla de audio + export multi-track (Fase 2) ===
// Reutiliza el pipeline de mediabunny de la Fase 1: video (WebCodecs) + audio (AAC) → MP4, sin ffmpeg/GPL.

import {
  Output, Mp4OutputFormat, BufferTarget, CanvasSource, AudioBufferSource,
  Input, BlobSource, AudioBufferSink, ALL_FORMATS,
} from 'mediabunny';
import { ReelProject, projectDuration, canvasSize, VideoElement, AudioElement } from './model';
import { MediaPool, drawReelFrame, seekVideosAt } from './render';

const VIDEO_BITRATE = 8_000_000;
const AUDIO_BITRATE = 192_000;

// Decodifica audio de cualquier fuente a AudioBuffer (navegador primero, mediabunny de fallback).
export async function decodeAudioUniversal(url: string, ctx: BaseAudioContext): Promise<AudioBuffer | null> {
  let ab: ArrayBuffer;
  try { ab = await (await fetch(url)).arrayBuffer(); } catch { return null; }
  try { return await ctx.decodeAudioData(ab.slice(0)); } catch { /* fallback */ }
  try {
    const input = new Input({ source: new BlobSource(new Blob([ab])), formats: ALL_FORMATS });
    const track = await input.getPrimaryAudioTrack();
    if (!track) return null;
    const sink = new AudioBufferSink(track);
    const chunks: AudioBuffer[] = [];
    let total = 0;
    for await (const { buffer } of sink.buffers(0)) { chunks.push(buffer); total += buffer.length; }
    if (!chunks.length || total === 0) return null;
    if (chunks.length === 1) return chunks[0];
    const sr = chunks[0].sampleRate, numCh = chunks[0].numberOfChannels;
    const out = ctx.createBuffer(numCh, total, sr);
    let off = 0;
    for (const ch of chunks) {
      for (let c = 0; c < numCh; c++) out.getChannelData(c).set(ch.getChannelData(Math.min(c, ch.numberOfChannels - 1)), off);
      off += ch.length;
    }
    return out;
  } catch { return null; }
}

// Caché de audio decodificado, persistente durante la sesión: sin esto, CADA play tras una edición
// re-decodificaba todos los audios del proyecto (música completa incluida) y la app se sentía trabada.
const decodedCache = new Map<string, AudioBuffer | null>();
async function decodeCached(url: string, ctx: BaseAudioContext): Promise<AudioBuffer | null> {
  if (decodedCache.has(url)) return decodedCache.get(url) ?? null;
  const b = await decodeAudioUniversal(url, ctx);
  if (decodedCache.size > 40) { const k = decodedCache.keys().next().value; if (k !== undefined) decodedCache.delete(k); }
  decodedCache.set(url, b);
  return b;
}

// Mezcla offline (determinística) de todas las pistas de audio del proyecto → un AudioBuffer.
export async function buildMixedAudio(project: ReelProject): Promise<AudioBuffer | null> {
  const SR = 48000;
  const total = projectDuration(project);
  if (total <= 0) return null;
  const decodeCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
  try {
    const decode = (url: string) => decodeCached(url, decodeCtx);
    const off = new OfflineAudioContext(2, Math.max(1, Math.ceil(total * SR)), SR);
    let any = false;
    for (const track of project.tracks) {
      if (track.muted) continue;
      for (const el of track.elements) {
        const ae = el as VideoElement | AudioElement;
        if (el.type !== 'video' && el.type !== 'audio') continue;
        if (el.type === 'video' && (el as VideoElement).muted) continue;
        const vol = el.type === 'video' ? (el as VideoElement).volume : (el as AudioElement).volume;
        if (vol <= 0) continue;
        const buf = await decode(ae.url);
        if (!buf) continue;
        const src = off.createBufferSource(); src.buffer = buf;
        if (el.type === 'audio' && (el as AudioElement).loop) src.loop = true;
        const when = Math.max(0, el.start);
        const offset = Math.max(0, ae.trimStart || 0);
        const dur = Math.max(0, el.duration);
        // Volumen con fade de entrada/salida opcional (envolvente de ganancia).
        const g = off.createGain();
        const fi = Math.max(0, (el as any).audioFadeIn || 0);
        const fo = Math.max(0, (el as any).audioFadeOut || 0);
        if (fi > 0 || fo > 0) {
          const inDur = Math.min(fi, dur);
          g.gain.setValueAtTime(fi > 0 ? 0.0001 : vol, when);
          if (fi > 0) g.gain.linearRampToValueAtTime(vol, when + inDur);
          if (fo > 0) {
            const foStart = when + Math.max(inDur, dur - fo);
            g.gain.setValueAtTime(vol, foStart);
            g.gain.linearRampToValueAtTime(0.0001, when + dur);
          }
        } else {
          g.gain.value = vol;
        }
        src.connect(g).connect(off.destination);
        try { src.start(when, offset, dur); any = true; } catch { /* rango inválido */ }
      }
    }
    if (!any) return null;
    return await off.startRendering();
  } finally {
    try { await decodeCtx.close(); } catch { /* noop */ }
  }
}

export interface ExportResult { blob: Blob; ext: 'mp4' | 'webm' }

// Renderiza el proyecto a MP4 con mediabunny (WebCodecs). canvas debe estar dimensionado al tamaño del proyecto.
export async function exportProject(
  project: ReelProject,
  canvas: HTMLCanvasElement,
  pool: MediaPool,
  onProgress?: (pct: number) => void,
): Promise<ExportResult> {
  const { w: W, h: H } = canvasSize(project);
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  const fps = project.fps || 30;
  const total = projectDuration(project);
  if (total <= 0) throw new Error('El reel está vacío.');

  const mixBuf = await buildMixedAudio(project);

  const output = new Output({ format: new Mp4OutputFormat({ fastStart: 'in-memory' }), target: new BufferTarget() });
  const videoSource = new CanvasSource(canvas, { codec: 'avc', bitrate: VIDEO_BITRATE });
  output.addVideoTrack(videoSource, { frameRate: fps });
  let audioSource: AudioBufferSource | null = null;
  if (mixBuf) { audioSource = new AudioBufferSource({ codec: 'aac', bitrate: AUDIO_BITRATE }); output.addAudioTrack(audioSource); }

  await output.start();
  if (audioSource && mixBuf) { await audioSource.add(mixBuf); audioSource.close(); }

  const frameDur = 1 / fps;
  const frameCount = Math.max(1, Math.ceil(total * fps));
  for (let i = 0; i < frameCount; i++) {
    const t = i * frameDur;
    await seekVideosAt(pool, project, t);
    drawReelFrame(ctx, project, t, pool);
    await videoSource.add(i * frameDur, frameDur);
    if (i % 3 === 0 && onProgress) onProgress(Math.min(99, Math.round((i / frameCount) * 100)));
  }
  videoSource.close();
  await output.finalize();
  const buffer = output.target.buffer;
  if (!buffer) throw new Error('El motor de video no generó el archivo.');
  onProgress?.(100);
  return { blob: new Blob([buffer], { type: 'video/mp4' }), ext: 'mp4' };
}
