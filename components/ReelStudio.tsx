import React, { useState, useRef, useEffect, useCallback } from 'react';
import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile } from '@ffmpeg/util';
import { Muxer, ArrayBufferTarget } from 'mp4-muxer';
import { UserProfile } from '../types';
import { recordUsage } from './usageTracker';

// Estilos de subtítulo predeterminados (incluye look CapCut)
interface SubStyle { label: string; y: number; size: number; weight: number; box: boolean; outline: number; outlineColor: string; shadow: boolean; upper: boolean; def: string; }
const SUB_STYLES: Record<string, SubStyle> = {
  capcut:  { label: 'CapCut',  y: 0.74, size: 74, weight: 900, box: false, outline: 14, outlineColor: '#000000', shadow: false, upper: true,  def: '#FFFFFF' },
  caja:    { label: 'Caja',    y: 0.82, size: 56, weight: 800, box: true,  outline: 0,  outlineColor: '#000000', shadow: false, upper: false, def: '#FFFFFF' },
  clasico: { label: 'Clásico', y: 0.82, size: 60, weight: 700, box: false, outline: 0,  outlineColor: '#000000', shadow: true,  upper: false, def: '#FFFFFF' },
  neon:    { label: 'Neón',    y: 0.78, size: 70, weight: 900, box: false, outline: 12, outlineColor: '#000000', shadow: false, upper: true,  def: '#FFE600' },
  minimal: { label: 'Minimal', y: 0.88, size: 46, weight: 600, box: false, outline: 0,  outlineColor: '#000000', shadow: true,  upper: false, def: '#FFFFFF' },
};

// Tipografías disponibles para subtítulos (todas cargadas en index.html)
const SUB_FONTS: { label: string; value: string }[] = [
  { label: 'Inter', value: 'Inter' },
  { label: 'Montserrat', value: 'Montserrat' },
  { label: 'Anton', value: 'Anton' },
  { label: 'Bebas Neue', value: 'Bebas Neue' },
  { label: 'Oswald', value: 'Oswald' },
  { label: 'Playfair', value: 'Playfair Display' },
  { label: 'Marker', value: 'Permanent Marker' },
  { label: 'Pacifico', value: 'Pacifico' },
];

function bytesToBase64(bytes: Uint8Array): string {
  let bin = ''; const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) bin += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk)));
  return btoa(bin);
}

// Convierte un WAV PCM 16-bit mono (de ffmpeg) en una serie de picos normalizados (0-1) para dibujar la onda.
function wavToPeaks(bytes: Uint8Array, buckets: number): number[] {
  const HEADER = 44;
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const total = Math.floor((bytes.byteLength - HEADER) / 2);
  if (total <= 0) return [];
  const per = Math.max(1, Math.floor(total / buckets));
  const peaks: number[] = [];
  let max = 1;
  for (let b = 0; b < buckets; b++) {
    let peak = 0;
    const base = HEADER + b * per * 2;
    for (let i = 0; i < per; i++) {
      const idx = base + i * 2;
      if (idx + 1 >= bytes.byteLength) break;
      const s = Math.abs(dv.getInt16(idx, true));
      if (s > peak) peak = s;
    }
    peaks.push(peak);
    if (peak > max) max = peak;
  }
  return peaks.map(p => Math.pow(p / max, 0.7)); // realza picos chicos para que la onda se vea
}

// AudioBuffer (mezcla offline) → bytes WAV PCM 16-bit, para que ffmpeg lo muxee como AAC.
function audioBufferToWav(buffer: AudioBuffer): Uint8Array {
  const numCh = buffer.numberOfChannels, sr = buffer.sampleRate, len = buffer.length;
  const blockAlign = numCh * 2;
  const dataSize = len * blockAlign;
  const ab = new ArrayBuffer(44 + dataSize);
  const view = new DataView(ab);
  const ws = (o: number, s: string) => { for (let i = 0; i < s.length; i++) view.setUint8(o + i, s.charCodeAt(i)); };
  ws(0, 'RIFF'); view.setUint32(4, 36 + dataSize, true); ws(8, 'WAVE');
  ws(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true);
  view.setUint16(22, numCh, true); view.setUint32(24, sr, true);
  view.setUint32(28, sr * blockAlign, true); view.setUint16(32, blockAlign, true); view.setUint16(34, 16, true);
  ws(36, 'data'); view.setUint32(40, dataSize, true);
  const chans: Float32Array[] = [];
  for (let c = 0; c < numCh; c++) chans.push(buffer.getChannelData(c));
  let off = 44;
  for (let i = 0; i < len; i++) {
    for (let c = 0; c < numCh; c++) {
      const s = Math.max(-1, Math.min(1, chans[c][i]));
      view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
      off += 2;
    }
  }
  return new Uint8Array(ab);
}


// Sección plegable para el panel de edición
const Accordion: React.FC<{ title: string; icon: string; open: boolean; onToggle: () => void; badge?: string; children: React.ReactNode }> = ({ title, icon, open, onToggle, badge, children }) => (
  <div className="bg-white rounded-2xl border border-slate-100 overflow-hidden">
    <button type="button" onClick={onToggle} className="w-full flex items-center justify-between px-4 py-3.5 hover:bg-slate-50/60 transition-colors">
      <span className="flex items-center gap-2.5 text-[10px] font-black text-slate-600 uppercase tracking-widest"><i className={`fa-solid ${icon} text-purple-500 w-4 text-center`}></i>{title}{badge && <span className="text-[8px] bg-purple-100 text-purple-600 px-1.5 py-0.5 rounded-full">{badge}</span>}</span>
      <i className={`fa-solid fa-chevron-down text-slate-300 text-xs transition-transform ${open ? 'rotate-180' : ''}`}></i>
    </button>
    {open && <div className="px-4 pb-4 pt-1 space-y-3 border-t border-slate-50">{children}</div>}
  </div>
);

interface ReelStudioProps {
  profile: UserProfile | null;
  onClose: () => void;
  initialPrompt?: string | null;
  initialCopy?: string | null;
}

interface Subtitle {
  id: string;
  text: string;
  start: number;
  end: number;
}

interface Clip {
  id: string;
  url: string;
  duration: number;
  trimStart: number;
  trimEnd: number;
}

const CANVAS_W = 1080;
const CANVAS_H = 1920;
const FPS = 30;
// El worker de @ffmpeg/ffmpeg es type:"module": no puede usar importScripts, así que
// importa el core dinámicamente con import(). Por eso el core debe ser ESM y por URL
// directa (no blob), para que el import() dinámico resuelva correctamente.
const CORE_VERSION = '0.12.6';
const CORE_BASE = `https://unpkg.com/@ffmpeg/core@${CORE_VERSION}/dist/esm`;

const fmt = (s: number) => {
  if (!isFinite(s) || s < 0) s = 0;
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, '0')}`;
};

const ReelStudio: React.FC<ReelStudioProps> = ({ profile, onClose, initialCopy }) => {
  const kit = profile?.brandKits?.[0];

  const [clips, setClips] = useState<Clip[]>([]);
  const [activeIdx, setActiveIdx] = useState(0);
  const activeClip = clips[activeIdx];
  const videoUrl = activeClip?.url || null;
  const duration = activeClip?.duration || 0;
  const trimStart = activeClip?.trimStart || 0;
  const trimEnd = activeClip?.trimEnd || 0;
  const setActiveTrim = (patch: Partial<Clip>) => setClips(prev => prev.map((c, i) => i === activeIdx ? { ...c, ...patch } : c));
  const [currentTime, setCurrentTime] = useState(0);
  const [playing, setPlaying] = useState(false);

  const [videoVolume, setVideoVolume] = useState(1); // volumen del audio original del video

  const [musicUrl, setMusicUrl] = useState<string | null>(null);
  const [musicName, setMusicName] = useState('');
  const [musicVolume, setMusicVolume] = useState(0.8);

  // Voz en off (subida o grabada)
  const [voiceUrl, setVoiceUrl] = useState<string | null>(null);
  const [voiceName, setVoiceName] = useState('');
  const [voiceVolume, setVoiceVolume] = useState(1);
  const [recording, setRecording] = useState(false);
  const [previewing, setPreviewing] = useState<'music' | 'voice' | null>(null); // play de audio aislado
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);

  const [subtitles, setSubtitles] = useState<Subtitle[]>([]);
  const [subStyle, setSubStyle] = useState<string>('capcut');
  const [subColor, setSubColor] = useState('#FFFFFF');
  const [subScale, setSubScale] = useState(1); // multiplicador de tamaño de subtítulos
  const [subAnim, setSubAnim] = useState<'none' | 'reveal' | 'highlight'>('none'); // animación de subtítulos
  const [subAccent, setSubAccent] = useState('#FFE600'); // color de resalte de la palabra activa
  const [openSec, setOpenSec] = useState<Record<string, boolean>>({ subtitulos: true }); // secciones desplegables
  const toggleSec = (k: string) => setOpenSec(p => ({ ...p, [k]: !p[k] }));
  const [transcribing, setTranscribing] = useState(false);
  const [subFont, setSubFont] = useState<string>(kit?.headlineFont || 'Inter');

  const [logoEnabled, setLogoEnabled] = useState(false);
  const [logoPos, setLogoPos] = useState({ x: 50, y: 10 }); // % del canvas (centro del logo)
  const [logoSize, setLogoSize] = useState(28); // % del ancho del canvas
  const [tlZoom, setTlZoom] = useState(1); // zoom de la línea de tiempo
  const [transition, setTransition] = useState<'none' | 'fade' | 'white' | 'zoom' | 'slide'>('none'); // transición entre clips
  const [reelDur, setReelDur] = useState<'auto' | 15 | 30 | 60>('auto'); // duración objetivo del compaginado
  const [trimDead, setTrimDead] = useState(false); // quitar silencios (inicio/fin) al compaginar
  const [showAdvanced, setShowAdvanced] = useState(false); // mostrar la timeline manual (ajuste avanzado)
  const [transDur, setTransDur] = useState(0.5); // duración total de la transición (s)

  const [exporting, setExporting] = useState(false);
  const [exportMsg, setExportMsg] = useState('');
  const [exportPct, setExportPct] = useState(0); // 0-100, progreso real de exportación
  const [exportedUrl, setExportedUrl] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const logoImgRef = useRef<HTMLImageElement | null>(null);
  const logoRectRef = useRef<{ x: number; y: number; w: number; h: number } | null>(null); // bounds del logo en el canvas
  const logoDragRef = useRef<{ dx: number; dy: number } | null>(null);
  const [subPos, setSubPos] = useState<{ x: number; y: number } | null>(null); // posición manual de los subtítulos (% del canvas); null = la del estilo
  const subRectRef = useRef<{ x: number; y: number; w: number; h: number } | null>(null);
  const subDragRef = useRef<{ dx: number; dy: number } | null>(null);
  const rafRef = useRef<number | null>(null);
  const ffmpegRef = useRef<FFmpeg | null>(null);
  // Elementos de audio del PREVIEW (siempre nativos, nunca pasan por WebAudio).
  const musicElRef = useRef<HTMLAudioElement | null>(null);
  const voiceElRef = useRef<HTMLAudioElement | null>(null);
  const micRecorderRef = useRef<MediaRecorder | null>(null);
  const micChunksRef = useRef<Blob[]>([]);
  const trackRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef<{ clipId: string; edge: 'start' | 'end'; startX: number; origStart: number; origEnd: number } | null>(null);
  const [clipPeaks, setClipPeaks] = useState<Record<string, number[]>>({}); // onda de audio por clip
  const [clipThumbs, setClipThumbs] = useState<Record<string, string>>({}); // miniatura (dataURL) por clip
  const peaksBusyRef = useRef<Set<string>>(new Set());
  const scrubRef = useRef(false);              // true mientras se arrastra el cabezal
  const pendingSeekRef = useRef<number | null>(null); // seek a aplicar tras cambiar de clip

  // Carga del logo de marca para el overlay
  useEffect(() => {
    const url = kit?.logoUrls?.[0];
    if (!url) { logoImgRef.current = null; return; }
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => { logoImgRef.current = img; };
    img.src = url;
  }, [kit?.logoUrls]);

  const uid = () => `clip_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const addClips = (files: File[]) => {
    const fresh = files.filter(Boolean).map(f => ({ id: uid(), url: URL.createObjectURL(f), duration: 0, trimStart: 0, trimEnd: 0 }));
    if (!fresh.length) return;
    setClips(prev => [...prev, ...fresh]);
    // El cabezal arranca al inicio del reel (primer clip)
    setActiveIdx(0);
    setCurrentTime(0);
    setExportedUrl(null);
  };
  const addClip = (file: File) => addClips([file]);

  // Detecta el tramo "con contenido" de un clip (recorta el silencio del inicio y del fin) usando su onda de audio
  const contentBounds = (c: Clip): [number, number] => {
    const D = c.duration || 0;
    const peaks = clipPeaks[c.id];
    if (!trimDead || !peaks || !peaks.length || D <= 0) return [0, D];
    const thr = 0.07; // umbral de silencio (relativo)
    let first = peaks.findIndex(p => p >= thr);
    let last = -1;
    for (let i = peaks.length - 1; i >= 0; i--) { if (peaks[i] >= thr) { last = i; break; } }
    if (first < 0 || last < 0) return [0, D]; // todo en silencio → no tocar
    const pad = 0.15; // deja un respiro para no cortar la primera/última sílaba
    const s = Math.max(0, (first / peaks.length) * D - pad);
    const e = Math.min(D, ((last + 1) / peaks.length) * D + pad);
    return (e - s) > 0.4 ? [s, e] : [0, D];
  };

  // Compaginado automático: une los clips en orden, (opcional) quita silencios y los ajusta a la duración objetivo
  const autoCompaginate = () => {
    setClips(prev => {
      if (prev.some(c => (c.duration || 0) <= 0)) { alert('Esperá un segundo a que se midan los videos y volvé a intentar.'); return prev; }
      const bounds = prev.map(contentBounds);
      if (reelDur === 'auto') {
        return prev.map((c, i) => ({ ...c, trimStart: bounds[i][0], trimEnd: bounds[i][1] }));
      }
      const T = reelDur as number;
      const N = prev.length;
      const share = T / N;
      const avail = bounds.map(([s, e]) => e - s); // material disponible por clip (ya sin silencios)
      const targets = avail.map(a => Math.min(a, share));
      // Reparte el sobrante entre los clips que todavía tienen material
      for (let iter = 0; iter < 4; iter++) {
        const used = targets.reduce((a, b) => a + b, 0);
        let leftover = T - used;
        if (leftover < 0.05) break;
        const expandable = avail.map((a, i) => (a - targets[i] > 0.02 ? i : -1)).filter(i => i >= 0);
        if (!expandable.length) break;
        const add = leftover / expandable.length;
        expandable.forEach(i => { targets[i] += Math.min(add, avail[i] - targets[i]); });
      }
      return prev.map((c, i) => ({ ...c, trimStart: bounds[i][0], trimEnd: bounds[i][0] + Math.max(0.5, Math.min(avail[i], targets[i])) }));
    });
    setActiveIdx(0); setCurrentTime(0); setExportedUrl(null);
  };

  const removeClip = (id: string) => {
    setClips(prev => {
      const next = prev.filter(c => c.id !== id);
      setActiveIdx(a => Math.max(0, Math.min(a, next.length - 1)));
      return next;
    });
  };
  // --- Línea de tiempo (estilo CapCut): cada tramo se dibuja con su ANCHO RECORTADO real ---
  const TL_PX = Math.max(10, Math.round(60 * tlZoom)); // píxeles por segundo (escala con el zoom)
  // Reordenar clips (arrastrando los chips)
  const dragFromRef = useRef<number | null>(null);
  const moveClip = (from: number, to: number) => {
    setClips(prev => {
      if (from === to || from < 0 || to < 0 || from >= prev.length || to >= prev.length) return prev;
      const next = [...prev]; const [m] = next.splice(from, 1); next.splice(to, 0, m);
      return next;
    });
    setActiveIdx(to);
  };
  const [dragIdx, setDragIdx] = useState<number | null>(null); // clip que se está arrastrando (chips)
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null); // chip destino bajo el cursor
  const clipW = (c: Clip) => Math.max(12, ((c.trimEnd || 0) - (c.trimStart || 0)) * TL_PX);
  const clipLeftPx = (idx: number) => clips.slice(0, idx).reduce((a, c) => a + clipW(c), 0);
  const timelineW = () => Math.max(40, clips.reduce((a, c) => a + clipW(c), 0));
  // Ajusta el zoom para que TODOS los clips entren en el ancho visible de la timeline
  const fitTimelineZoom = useCallback(() => {
    const el = trackRef.current;
    if (!el) return;
    const total = clips.reduce((a, c) => a + Math.max(0, (c.trimEnd || 0) - (c.trimStart || 0)), 0);
    const avail = el.clientWidth - 24; // descuenta el padding (p-3)
    if (total <= 0 || avail <= 0) return;
    const z = Math.max(0.12, Math.min(2, (avail / total) / 60));
    setTlZoom(+z.toFixed(3));
  }, [clips]);
  const onTrackPointerMove = (e: React.PointerEvent) => {
    const d = draggingRef.current;
    if (!d) return;
    const clip = clips.find(c => c.id === d.clipId);
    if (!clip) return;
    const delta = (e.clientX - d.startX) / TL_PX; // segundos arrastrados desde que se empezó
    setClips(prev => prev.map(c => {
      if (c.id !== d.clipId) return c;
      if (d.edge === 'start') return { ...c, trimStart: Math.max(0, Math.min(d.origStart + delta, d.origEnd - 0.3)) };
      return { ...c, trimEnd: Math.min(c.duration || (d.origEnd + delta), Math.max(d.origEnd + delta, d.origStart + 0.3)) };
    }));
  };
  const scrubTargetRef = useRef<number | null>(null); // último tiempo a buscar (coalescido por rAF)
  const scrubRafRef = useRef<number | null>(null);
  const scrubLoop = () => {
    const v = videoRef.current; const t = scrubTargetRef.current;
    if (v && t != null && Math.abs(v.currentTime - t) > 0.015) v.currentTime = t; // un seek por frame, al último objetivo
    if (scrubRef.current) scrubRafRef.current = requestAnimationFrame(scrubLoop);
  };
  const endDrag = () => {
    draggingRef.current = null;
    if (scrubRef.current) {
      scrubRef.current = false;
      if (scrubRafRef.current) cancelAnimationFrame(scrubRafRef.current);
      const v = videoRef.current; const t = scrubTargetRef.current;
      if (v && t != null) { v.currentTime = t; v.onseeked = () => { v.onseeked = null; drawFrame(t); }; }
    }
  };

  // --- Scrubbing: mover el cabezal con click/arrastre sobre la timeline ---
  const locFromClientX = (clientX: number): { idx: number; local: number } | null => {
    const track = trackRef.current;
    if (!track || clips.length === 0) return null;
    const rect = track.getBoundingClientRect();
    const x = clientX - rect.left - 8 + track.scrollLeft; // -8 = padding p-2 del contenedor
    let acc = 0;
    for (let i = 0; i < clips.length; i++) {
      const c = clips[i];
      const w = clipW(c);
      if (x < acc + w || i === clips.length - 1) {
        // El ancho del bloque representa [trimStart, trimEnd] → mapeo a tiempo de fuente
        const local = c.trimStart + Math.max(0, Math.min(w, x - acc)) / TL_PX;
        return { idx: i, local: Math.max(c.trimStart, Math.min(c.trimEnd, local)) };
      }
      acc += w;
    }
    return null;
  };
  const scrubTo = (clientX: number) => {
    const loc = locFromClientX(clientX);
    if (!loc) return;
    if (loc.idx === activeIdx) {
      // El cabezal se mueve al instante (estado); el seek real lo aplica scrubLoop (coalescido) → fluido
      setCurrentTime(loc.local);
      scrubTargetRef.current = loc.local;
    } else {
      // Cruce de clip (recarga el otro video)
      scrubTargetRef.current = null;
      pendingSeekRef.current = loc.local;
      setActiveIdx(loc.idx);
    }
  };
  const onTimelinePointerDown = (e: React.PointerEvent) => {
    if (draggingRef.current) return; // se está arrastrando un borde (recorte)
    scrubRef.current = true;
    try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch {}
    // dibuja el frame apenas el video termina cada seek (mientras se arrastra)
    const v = videoRef.current; if (v) v.onseeked = () => { if (scrubRef.current) drawFrame(v.currentTime); };
    scrubTo(e.clientX);
    if (scrubRafRef.current) cancelAnimationFrame(scrubRafRef.current);
    scrubRafRef.current = requestAnimationFrame(scrubLoop);
  };
  const onTimelinePointerMove = (e: React.PointerEvent) => {
    if (draggingRef.current) { onTrackPointerMove(e); return; }
    if (scrubRef.current) scrubTo(e.clientX);
  };

  // Calcula la onda de audio de cada clip (lazy, con ffmpeg). No bloquea la edición; si no hay audio queda plano.
  const clipIdsKey = clips.map(c => c.id).join('|');
  useEffect(() => {
    let cancelled = false;
    (async () => {
      for (const c of clips) {
        if (clipPeaks[c.id] !== undefined || peaksBusyRef.current.has(c.id)) continue;
        peaksBusyRef.current.add(c.id);
        try {
          const bytes = await getAudioBytes(c.url);
          const peaks = wavToPeaks(bytes, 220);
          // Siempre guardamos (aunque sea []): así la pista deja de mostrar "cargando".
          if (!cancelled) setClipPeaks(prev => ({ ...prev, [c.id]: peaks }));
        } catch { if (!cancelled) setClipPeaks(prev => ({ ...prev, [c.id]: [] })); } // sin pista de audio → vacío
        finally { peaksBusyRef.current.delete(c.id); }
      }
    })();
    return () => { cancelled = true; };
  }, [clipIdsKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // Mide la duración de CADA clip (no solo el activo) para que la timeline muestre su largo real
  useEffect(() => {
    let cancelled = false;
    clips.forEach(c => {
      if (c.duration > 0) return;
      const el = document.createElement('video');
      el.preload = 'metadata'; el.src = c.url;
      el.onloadedmetadata = () => {
        if (cancelled) return;
        const d = el.duration;
        if (!isFinite(d) || d <= 0) return;
        setClips(prev => prev.map(x => (x.id === c.id && x.duration === 0) ? { ...x, duration: d, trimStart: 0, trimEnd: d } : x));
        el.removeAttribute('src'); try { el.load(); } catch {}
      };
    });
    return () => { cancelled = true; };
  }, [clipIdsKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // Genera una miniatura (frame representativo) de cada clip para la timeline
  useEffect(() => {
    let cancelled = false;
    clips.forEach(c => {
      if (clipThumbs[c.id] !== undefined) return;
      const el = document.createElement('video');
      el.preload = 'metadata'; el.muted = true; (el as any).playsInline = true; el.crossOrigin = 'anonymous'; el.src = c.url;
      const grab = () => {
        if (cancelled) return;
        try {
          const vw = el.videoWidth || 90, vh = el.videoHeight || 160;
          const cv = document.createElement('canvas');
          cv.width = 96; cv.height = Math.max(1, Math.round(96 * vh / vw));
          const ctx = cv.getContext('2d');
          if (ctx) { ctx.drawImage(el, 0, 0, cv.width, cv.height); setClipThumbs(prev => ({ ...prev, [c.id]: cv.toDataURL('image/jpeg', 0.6) })); }
        } catch { setClipThumbs(prev => ({ ...prev, [c.id]: '' })); } // CORS u otro → sin miniatura
        el.removeAttribute('src'); try { el.load(); } catch {}
      };
      el.onloadeddata = () => {
        const onSeeked = () => { el.removeEventListener('seeked', onSeeked); grab(); };
        el.addEventListener('seeked', onSeeked);
        const target = Math.max(0.05, Math.min((el.duration || 1) * 0.5, (el.duration || 1) - 0.1));
        try { el.currentTime = target; } catch { el.removeEventListener('seeked', onSeeked); grab(); }
      };
      el.onerror = () => { if (!cancelled) setClipThumbs(prev => ({ ...prev, [c.id]: '' })); };
    });
    return () => { cancelled = true; };
  }, [clipIdsKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const splitActive = () => {
    const clip = clips[activeIdx];
    if (!clip) return;
    const t = currentTime;
    // Solo no divide si el cabezal está pegado a un borde (no tendría sentido)
    if (t <= clip.trimStart + 0.08 || t >= clip.trimEnd - 0.08) return;
    const a = { ...clip, trimEnd: t };
    const b: Clip = { ...clip, id: `clip_${Date.now()}`, trimStart: t };
    // Queda seleccionado el tramo IZQUIERDO (a): así, al dividir de nuevo más adelante,
    // el tramo del medio queda seleccionado y se puede borrar con "Borrar tramo".
    setClips(prev => { const next = [...prev]; next.splice(activeIdx, 1, a, b); return next; });
  };

  const handleMusicFile = (file: File) => {
    const url = URL.createObjectURL(file);
    musicElRef.current?.pause();
    musicElRef.current = null; // se recrea con la pista nueva
    setMusicUrl(url);
    setMusicName(file.name);
  };

  const onLoadedMetadata = () => {
    const v = videoRef.current;
    if (!v) return;
    // Solo fija duración/recorte la primera vez que se mide este clip
    if (activeClip && !activeClip.duration) {
      setActiveTrim({ duration: v.duration, trimStart: 0, trimEnd: v.duration });
    }
    // Aplica un seek pendiente tras cambiar de clip por scrubbing (cuando NO se está reproduciendo)
    if (pendingSeekRef.current != null && !playing) {
      const t = Math.max(0, Math.min(v.duration || 0, pendingSeekRef.current));
      pendingSeekRef.current = null;
      v.currentTime = t;
      setCurrentTime(t);
      drawFrame(t);
    } else if (!playing) {
      // Primera carga del clip: posiciónate al inicio del tramo y pintá el frame (sino el visor queda en negro)
      const want = activeClip?.trimStart || 0;
      if (Math.abs((v.currentTime || 0) - want) > 0.05) v.currentTime = want; // dispara onSeeked → dibuja
      else drawFrame(want, undefined, 0, globalTime(), true);
    }
  };
  // Cuando el frame del clip ya está decodificado / tras un seek: pintarlo (evita el negro inicial)
  const onVideoReady = () => {
    const v = videoRef.current;
    if (!v || playing || pendingSeekRef.current != null) return;
    drawFrame(v.currentTime, undefined, 0, globalTime(), true);
  };

  // Volúmenes del preview (nativos). El export aplica el volumen aparte, en su propio grafo.
  useEffect(() => { const v = videoRef.current; if (v) { v.muted = videoVolume === 0; v.volume = videoVolume; } }, [videoVolume]);
  useEffect(() => { if (musicElRef.current) musicElRef.current.volume = musicVolume; }, [musicVolume]);
  useEffect(() => { if (voiceElRef.current) voiceElRef.current.volume = voiceVolume; }, [voiceVolume]);

  // Dibuja un frame (video + logo + subtítulo activo) en el canvas.
  // srcEl permite dibujar desde otro elemento de video (el del export aislado).
  const drawFrame = useCallback((t: number, srcEl?: HTMLVideoElement, fadeAlpha = 0, subTime?: number, editPreview = false) => {
    const canvas = canvasRef.current;
    const v = srcEl || videoRef.current;
    if (!canvas || !v) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    // Video en modo "cover" sobre 9:16
    const vw = v.videoWidth || 16;
    const vh = v.videoHeight || 9;
    const scale = Math.max(CANVAS_W / vw, CANVAS_H / vh);
    const dw = vw * scale;
    const dh = vh * scale;
    const dx = (CANVAS_W - dw) / 2;
    const dy = (CANVAS_H - dh) / 2;
    // Transiciones con movimiento (zoom / slide): transforman el frame según el progreso (signo = dirección)
    const tp = Math.abs(fadeAlpha);
    const outgoing = fadeAlpha > 0;
    const moveTrans = (transition === 'zoom' || transition === 'slide') && tp > 0.001;
    ctx.save();
    if (moveTrans) {
      if (transition === 'zoom') {
        const s = 1 + 0.25 * tp; // sale agrandándose y el siguiente entra desde grande hacia normal
        ctx.translate(CANVAS_W / 2, CANVAS_H / 2); ctx.scale(s, s); ctx.translate(-CANVAS_W / 2, -CANVAS_H / 2);
      } else {
        ctx.translate(outgoing ? -CANVAS_W * tp : CANVAS_W * tp, 0); // sale a la izquierda / entra desde la derecha
      }
    }
    try { ctx.drawImage(v, dx, dy, dw, dh); } catch { /* frame no listo */ }
    ctx.restore();

    // Logo de marca (posición y tamaño configurables, arrastrable)
    if (logoEnabled && logoImgRef.current) {
      const img = logoImgRef.current;
      const lw = CANVAS_W * (logoSize / 100);
      const lh = lw * (img.height / img.width);
      const x = CANVAS_W * (logoPos.x / 100) - lw / 2;
      const y = CANVAS_H * (logoPos.y / 100) - lh / 2;
      ctx.drawImage(img, x, y, lw, lh);
      logoRectRef.current = { x, y, w: lw, h: lh };
    } else {
      logoRectRef.current = null;
    }

    // Subtítulo activo — se compara con el tiempo GLOBAL del reel (subTime), no el del clip
    const stT = subTime != null ? subTime : t;
    let active = subtitles.find(s => stT >= s.start && stT <= s.end);
    // Editando (pausado): si no hay ninguno en ese instante, mostrar el más cercano para poder verlo/moverlo
    if (!active && editPreview && subtitles.length) {
      active = [...subtitles].sort((a, b) => Math.abs(stT - (a.start + a.end) / 2) - Math.abs(stT - (b.start + b.end) / 2))[0];
    }
    if (active && active.text.trim()) {
      const st = SUB_STYLES[subStyle] || SUB_STYLES.capcut;
      const fontSize = Math.round(st.size * subScale);
      ctx.font = `${st.weight} ${fontSize}px "${subFont}", sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      const maxWidth = CANVAS_W * 0.86;
      const raw = st.upper ? active.text.toUpperCase() : active.text;
      const allWords = raw.split(/\s+/).filter(Boolean);
      // Agrupa palabras en líneas guardando el índice global de cada palabra (para animar)
      const lineObjs: { w: string; gi: number }[][] = [];
      let curLine: { w: string; gi: number }[] = []; let curText = '';
      allWords.forEach((w, gi) => {
        const test = curText ? `${curText} ${w}` : w;
        if (ctx.measureText(test).width > maxWidth && curLine.length) { lineObjs.push(curLine); curLine = [{ w, gi }]; curText = w; }
        else { curLine.push({ w, gi }); curText = test; }
      });
      if (curLine.length) lineObjs.push(curLine);

      const lineH = fontSize * 1.25;
      const blockH = lineObjs.length * lineH;
      const cx = CANVAS_W * ((subPos?.x ?? 50) / 100);            // centro horizontal (arrastrable)
      const baseY = CANVAS_H * (subPos?.y ?? st.y) - blockH / 2;   // posición vertical (arrastrable o del estilo)
      let maxLineW = 0;

      // Animación: palabra "actual" según el avance dentro del subtítulo
      const N = allWords.length;
      const dur = Math.max(0.001, active.end - active.start);
      const prog = Math.max(0, Math.min(1, (stT - active.start) / dur));
      const curWord = Math.min(N - 1, Math.floor(prog * N));
      const spaceW = ctx.measureText(' ').width;

      lineObjs.forEach((lw, i) => {
        const y = baseY + i * lineH + lineH / 2;
        // Para "reveal", solo se dibujan las palabras ya mencionadas
        const visible = subAnim === 'reveal' ? lw.filter(x => x.gi <= curWord) : lw;
        if (!visible.length) return;
        const widths = visible.map(x => ctx.measureText(x.w).width);
        const totalW = widths.reduce((a, b) => a + b, 0) + spaceW * (visible.length - 1);
        if (totalW > maxLineW) maxLineW = totalW;
        // Caja de fondo
        if (st.box) {
          ctx.fillStyle = 'rgba(0,0,0,0.62)';
          ctx.fillRect(cx - totalW / 2 - 28, y - lineH / 2, totalW + 56, lineH);
        }
        // Dibuja palabra por palabra (alineado a la izquierda dentro de la línea centrada en cx)
        ctx.textAlign = 'left';
        let x = cx - totalW / 2;
        visible.forEach((word, k) => {
          const isCur = subAnim !== 'none' && word.gi === curWord;
          const ww = widths[k];
          ctx.save();
          if (isCur && subAnim === 'highlight') { ctx.translate(x + ww / 2, y); ctx.scale(1.12, 1.12); ctx.translate(-(x + ww / 2), -y); }
          if (st.shadow) { ctx.shadowColor = 'rgba(0,0,0,0.65)'; ctx.shadowBlur = 14; ctx.shadowOffsetY = 3; }
          if (st.outline > 0) { ctx.lineJoin = 'round'; ctx.lineWidth = st.outline; ctx.strokeStyle = st.outlineColor; ctx.strokeText(word.w, x, y); }
          ctx.fillStyle = isCur ? subAccent : subColor;
          ctx.fillText(word.w, x, y);
          ctx.restore();
          x += ww + spaceW;
        });
      });
      ctx.textAlign = 'center';
      ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
      // Bounds del bloque de subtítulos (para poder arrastrarlo)
      subRectRef.current = { x: cx - maxLineW / 2 - 28, y: baseY - lineH * 0.5, w: maxLineW + 56, h: blockH + lineH };
    } else {
      subRectRef.current = null;
    }

    // Transición entre clips por velo (negro o blanco) sobre todo el frame
    if ((transition === 'fade' || transition === 'white') && Math.abs(fadeAlpha) > 0) {
      const rgb = transition === 'white' ? '255,255,255' : '0,0,0';
      ctx.fillStyle = `rgba(${rgb},${Math.min(1, Math.abs(fadeAlpha))})`;
      ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
    }
  }, [logoEnabled, logoPos, logoSize, subPos, subtitles, subColor, subFont, subStyle, subScale, subAnim, subAccent, transition]);

  // Arrastrar logo o subtítulos sobre el preview
  const canvasPt = (e: React.PointerEvent) => {
    const c = canvasRef.current!; const r = c.getBoundingClientRect();
    return { x: (e.clientX - r.left) / r.width * CANVAS_W, y: (e.clientY - r.top) / r.height * CANVAS_H };
  };
  const inRect = (p: { x: number; y: number }, rc: { x: number; y: number; w: number; h: number } | null) => !!rc && p.x >= rc.x && p.x <= rc.x + rc.w && p.y >= rc.y && p.y <= rc.y + rc.h;
  const onCanvasPointerDown = (e: React.PointerEvent) => {
    const p = canvasPt(e);
    // Logo primero (suele estar arriba); luego subtítulos
    if (logoEnabled && inRect(p, logoRectRef.current)) {
      const lr = logoRectRef.current!;
      logoDragRef.current = { dx: p.x - (lr.x + lr.w / 2), dy: p.y - (lr.y + lr.h / 2) };
      try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch {}
      return;
    }
    if (inRect(p, subRectRef.current)) {
      const sr = subRectRef.current!;
      subDragRef.current = { dx: p.x - (sr.x + sr.w / 2), dy: p.y - (sr.y + sr.h / 2) };
      try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch {}
    }
  };
  const onCanvasPointerMove = (e: React.PointerEvent) => {
    const p = canvasPt(e);
    if (logoDragRef.current) {
      const cx = p.x - logoDragRef.current.dx, cy = p.y - logoDragRef.current.dy;
      setLogoPos({ x: Math.max(0, Math.min(100, cx / CANVAS_W * 100)), y: Math.max(0, Math.min(100, cy / CANVAS_H * 100)) });
    } else if (subDragRef.current) {
      const cx = p.x - subDragRef.current.dx, cy = p.y - subDragRef.current.dy;
      setSubPos({ x: Math.max(2, Math.min(98, cx / CANVAS_W * 100)), y: Math.max(4, Math.min(96, cy / CANVAS_H * 100)) });
    }
  };
  const onCanvasPointerUp = () => { logoDragRef.current = null; subDragRef.current = null; };

  // Ref espejo para que el loop lea los clips actuales sin recrearse
  const clipsRef = useRef(clips); clipsRef.current = clips;

  // Progreso de transición (0..1) según cercanía a un borde. Con SIGNO: +saliendo (cerca del final), -entrando (cerca del inicio).
  const fadeAt = (hasPrev: boolean, hasNext: boolean, fromStart: number, toEnd: number) => {
    if (transition === 'none' || transDur <= 0) return 0;
    const fl = transDur / 2;
    const out = (hasNext && toEnd < fl) ? 1 - toEnd / fl : 0;
    const inn = (hasPrev && fromStart < fl) ? 1 - fromStart / fl : 0;
    if (out >= inn) return Math.max(0, Math.min(1, out));   // saliendo
    return -Math.max(0, Math.min(1, inn));                  // entrando
  };

  // --- Reproducción en cadena SECUENCIAL (mismo enfoque robusto que el export) ---
  const stopRef = useRef(false);
  const waitForClip = (v: HTMLVideoElement, url: string) => new Promise<void>((res) => {
    if (v.currentSrc === url && v.readyState >= 2) { res(); return; }
    let done = false;
    const fin = () => { if (done) return; done = true; v.removeEventListener('loadeddata', fin); v.removeEventListener('canplay', fin); res(); };
    v.addEventListener('loadeddata', fin);
    v.addEventListener('canplay', fin);
    setTimeout(fin, 2500);
  });
  const seekVideo = (v: HTMLVideoElement, t: number) => new Promise<void>((res) => {
    let done = false;
    const fin = () => { if (done) return; done = true; v.removeEventListener('seeked', fin); res(); };
    v.addEventListener('seeked', fin);
    try { v.currentTime = t; } catch { fin(); }
    setTimeout(fin, 1000);
  });
  const playReel = async (startIdx: number) => {
    const v = videoRef.current;
    if (!v || !clipsRef.current.length) return;
    stopRef.current = false;
    setPlaying(true);
    v.muted = videoVolume === 0; v.volume = videoVolume;
    playBeds(0); // música/voz desde el inicio del reel
    let gOff = 0; // tiempo global acumulado de los clips ya reproducidos
    for (let i = 0; i < startIdx; i++) gOff += Math.max(0, clipsRef.current[i].trimEnd - clipsRef.current[i].trimStart);
    for (let i = startIdx; i < clipsRef.current.length; i++) {
      if (stopRef.current) break;
      const c = clipsRef.current[i];
      if (!c) break;
      setActiveIdx(i);                 // React actualiza el src del <video>
      await waitForClip(v, c.url);     // espera a que ese clip esté cargado y listo
      if (stopRef.current) break;
      await seekVideo(v, c.trimStart);  // posiciona al inicio del recorte
      if (stopRef.current) break;
      await v.play().catch(() => {});
      // reproduce hasta el fin del recorte de este clip, dibujando cada frame
      await new Promise<void>((resolve) => {
        const step = () => {
          if (stopRef.current || !videoRef.current) { try { v.pause(); } catch {} return resolve(); }
          setCurrentTime(v.currentTime);
          const fade = fadeAt(i > 0, i < clipsRef.current.length - 1, v.currentTime - c.trimStart, c.trimEnd - v.currentTime);
          drawFrame(v.currentTime, undefined, fade, gOff + Math.max(0, v.currentTime - c.trimStart)); // subTime = tiempo global del reel
          if (v.currentTime >= c.trimEnd - 0.02 || v.ended) { try { v.pause(); } catch {} return resolve(); }
          rafRef.current = requestAnimationFrame(step);
        };
        rafRef.current = requestAnimationFrame(step);
      });
      gOff += Math.max(0, c.trimEnd - c.trimStart);
    }
    pauseBeds();
    stopRef.current = false;
    setPlaying(false);
  };
  // Cancela el loop al desmontar
  useEffect(() => () => { stopRef.current = true; if (rafRef.current) cancelAnimationFrame(rafRef.current); }, []);

  // Auto-ajusta el zoom de la timeline para que entren todos los clips (al abrirla o cambiar los clips)
  useEffect(() => {
    if (!showAdvanced) return;
    const id = requestAnimationFrame(fitTimelineZoom);
    window.addEventListener('resize', fitTimelineZoom);
    return () => { cancelAnimationFrame(id); window.removeEventListener('resize', fitTimelineZoom); };
  }, [showAdvanced, fitTimelineZoom]);

  // Redibuja al cambiar overlays mientras está pausado
  useEffect(() => {
    if (playing || !videoUrl) return;
    const c = activeClip;
    const fade = c ? fadeAt(activeIdx > 0, activeIdx < clips.length - 1, currentTime - c.trimStart, c.trimEnd - currentTime) : 0;
    drawFrame(currentTime, undefined, fade, globalTime(), true); // pausado/editando: muestra el subtítulo más cercano
  }, [drawFrame, playing, videoUrl, currentTime, transition, transDur]); // eslint-disable-line react-hooks/exhaustive-deps

  // Carga la fuente elegida (sino el canvas la ignora) y redibuja al estar lista
  useEffect(() => {
    if (!(document as any).fonts?.load) return;
    Promise.all([
      (document as any).fonts.load(`900 74px "${subFont}"`),
      (document as any).fonts.load(`700 60px "${subFont}"`),
    ]).then(() => { if (!playing) drawFrame(currentTime); }).catch(() => {});
  }, [subFont]); // eslint-disable-line react-hooks/exhaustive-deps

  // Al cambiar estilo/fuente, si hay subtítulos pero ninguno visible en el cabezal,
  // saltá al primero para que el efecto se vea de inmediato.
  useEffect(() => {
    if (playing || !videoUrl || subtitles.length === 0) return;
    const active = subtitles.find(s => currentTime >= s.start && currentTime <= s.end && s.text.trim());
    if (active) return;
    const first = [...subtitles].filter(s => s.text.trim()).sort((a, b) => a.start - b.start)[0];
    if (first) seek((first.start + first.end) / 2);
  }, [subStyle, subFont]); // eslint-disable-line react-hooks/exhaustive-deps

  // Tiempo global (en el reel concatenado) en el que está parado el preview
  const globalOffsetActive = () => {
    let off = 0;
    for (let i = 0; i < activeIdx; i++) off += Math.max(0, (clips[i].trimEnd - clips[i].trimStart));
    return off;
  };
  // Duración total del reel (suma de los tramos recortados) y posición global del cabezal
  const reelTotal = () => clips.reduce((a, c) => a + Math.max(0, (c.trimEnd || 0) - (c.trimStart || 0)), 0);
  // Posiciones (en segundos del reel) donde hay un corte entre clips — para marcar la barra
  const clipBoundaries = () => {
    const out: number[] = []; let acc = 0;
    for (let i = 0; i < clips.length - 1; i++) { acc += Math.max(0, (clips[i].trimEnd || 0) - (clips[i].trimStart || 0)); out.push(acc); }
    return out;
  };
  const globalTime = () => globalOffsetActive() + Math.max(0, currentTime - (activeClip?.trimStart || 0));
  // Mover el cabezal por tiempo GLOBAL del reel (la barra del reproductor)
  const seekGlobal = (t: number) => {
    let acc = 0;
    for (let i = 0; i < clips.length; i++) {
      const d = Math.max(0, clips[i].trimEnd - clips[i].trimStart);
      if (t <= acc + d || i === clips.length - 1) {
        const local = clips[i].trimStart + Math.max(0, Math.min(d, t - acc));
        if (i === activeIdx) seek(local);
        else { pendingSeekRef.current = local; setActiveIdx(i); }
        return;
      }
      acc += d;
    }
  };
  // Crea (perezosamente) los elementos de audio para el preview nativo
  const ensureMusicEl = () => {
    if (musicUrl && !musicElRef.current) { musicElRef.current = new Audio(musicUrl); musicElRef.current.crossOrigin = 'anonymous'; musicElRef.current.loop = true; musicElRef.current.volume = musicVolume; }
    return musicElRef.current;
  };
  const ensureVoiceEl = () => {
    if (voiceUrl && !voiceElRef.current) { voiceElRef.current = new Audio(voiceUrl); voiceElRef.current.volume = voiceVolume; }
    return voiceElRef.current;
  };
  // Reproduce música/voz sincronizadas con el video (preview, audio nativo)
  const playBeds = (globalPos?: number) => {
    const pos = globalPos != null ? globalPos : (globalOffsetActive() + Math.max(0, (videoRef.current?.currentTime || 0) - trimStart));
    const m = ensureMusicEl();
    if (m && musicUrl) { m.volume = musicVolume; const d = m.duration || 0; m.currentTime = d ? pos % d : 0; m.play().catch(() => {}); }
    const vo = ensureVoiceEl();
    if (vo && voiceUrl) {
      vo.volume = voiceVolume;
      try { if (isFinite(pos) && pos >= 0) vo.currentTime = pos; } catch {}
      vo.play().catch((e) => console.warn('[voz] no se pudo reproducir en preview:', e));
    }
  };
  const pauseBeds = () => { musicElRef.current?.pause(); voiceElRef.current?.pause(); };

  // Escuchar música o voz por separado (botón play propio)
  const togglePreview = (kind: 'music' | 'voice', url: string | null) => {
    if (!url) return;
    // Si ya está sonando ese, pausar
    if (previewing === kind) { previewAudioRef.current?.pause(); setPreviewing(null); return; }
    // Frena cualquier otra reproducción
    try { previewAudioRef.current?.pause(); } catch {}
    if (playing) { videoRef.current?.pause(); pauseBeds(); setPlaying(false); }
    const a = new Audio(url);
    a.volume = kind === 'voice' ? voiceVolume : musicVolume;
    a.onended = () => setPreviewing(null);
    a.onpause = () => setPreviewing(p => (p === kind ? null : p));
    previewAudioRef.current = a;
    a.play().then(() => setPreviewing(kind)).catch((e) => { console.warn('[preview audio]', e); setPreviewing(null); alert('No se pudo reproducir el audio en este navegador.'); });
  };

  const togglePlay = () => {
    const v = videoRef.current;
    if (!v) return;
    if (playing) { stopRef.current = true; try { v.pause(); } catch {} pauseBeds(); setPlaying(false); return; }
    // Iniciar: reproduce TODO el reel desde el primer clip (en cadena, secuencial)
    try { previewAudioRef.current?.pause(); } catch {} setPreviewing(null);
    playReel(0);
  };

  const seek = (t: number) => {
    const v = videoRef.current;
    if (!v) return;
    v.currentTime = t;
    setCurrentTime(t);
    drawFrame(t);
  };

  const addSubtitle = () => {
    const start = Math.round(currentTime * 10) / 10;
    setSubtitles(prev => [...prev, { id: `sub_${Date.now()}`, text: '', start, end: Math.min(start + 3, trimEnd || start + 3) }]);
  };

  // Transcribe el audio (la voz en off si existe, si no el video) y crea los subtítulos cronometrados
  const generateSubtitles = async () => {
    // Subtitulamos la NARRACIÓN: si hay voz en off, esa; si no, el audio del video.
    const srcUrl = voiceUrl || videoUrl;
    if (!srcUrl) { alert('Subí un video o una voz en off para generar subtítulos.'); return; }
    setTranscribing(true);
    try {
      const base64 = await getWavBase64(srcUrl);
      const res = await fetch('/api/transcribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ audio: base64, mime: 'audio/wav' }),
      });
      let json;
      try { json = await res.json(); } catch { throw new Error('El servidor no respondió (puede faltar el deploy con /api/transcribe).'); }
      if (!res.ok) throw new Error(json?.error || 'No se pudo transcribir el audio.');
      recordUsage('subtitulos', json.usage);
      const clean = String(json.text || '').replace(/```json|```/g, '').trim();
      const parsed = JSON.parse(clean);
      const segs = (parsed.segments || []).filter((s: any) => s?.text && String(s.text).trim());
      if (!segs.length) { alert(voiceUrl ? 'No se detectó voz en la narración.' : 'Este video no tiene voz. Grabá o subí una voz en off y generá los subtítulos de ahí.'); return; }
      setSubtitles(segs.map((s: any, i: number) => {
        const start = Math.max(0, Number(s.start) || 0);
        return { id: `sub_${Date.now()}_${i}`, text: String(s.text).trim(), start, end: Math.max(start + 0.5, Number(s.end) || start + 1.5) };
      }));
    } catch (e: any) {
      console.error('Subtítulos:', e, ffmpegLogRef.current);
      const motivo = e?.message || (typeof e === 'string' ? e : '') || (e?.name ? e.name : '') || (e ? JSON.stringify(e) : '') || 'error desconocido';
      alert('No se pudieron generar los subtítulos.\n\nMotivo: ' + motivo);
    } finally {
      setTranscribing(false);
    }
  };


  // --- Voz en off ---
  const handleVoiceFile = (file: File) => {
    voiceElRef.current?.pause();
    setVoiceUrl(URL.createObjectURL(file));
    setVoiceName(file.name);
    voiceElRef.current = null;
  };
  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      // Elegí un mime de audio soportado; el blob se crea con el mime real del recorder.
      const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus']
        .find(m => { try { return MediaRecorder.isTypeSupported(m); } catch { return false; } }) || '';
      const rec = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
      micChunksRef.current = [];
      rec.ondataavailable = (e) => { if (e.data.size > 0) micChunksRef.current.push(e.data); };
      rec.onstop = () => {
        stream.getTracks().forEach(t => t.stop());
        const type = rec.mimeType || mime || 'audio/webm';
        const blob = new Blob(micChunksRef.current, { type });
        console.info('[voz] grabación:', (blob.size / 1024).toFixed(0) + 'KB', type);
        if (blob.size < 512) { alert('La grabación quedó vacía. Revisá el micrófono e intentá de nuevo.'); return; }
        voiceElRef.current = null;
        setVoiceUrl(URL.createObjectURL(blob));
        setVoiceName('Grabación de voz');
      };
      micRecorderRef.current = rec;
      rec.start(100); // timeslice: asegura que ondataavailable junte datos
      setRecording(true);
    } catch {
      alert('No se pudo acceder al micrófono. Revisá los permisos del navegador.');
    }
  };
  const stopRecording = () => { micRecorderRef.current?.stop(); setRecording(false); };
  const removeVoice = () => { voiceElRef.current?.pause(); setVoiceUrl(null); setVoiceName(''); voiceElRef.current = null; };

  const ffmpegLogRef = useRef<string>('');
  const loadFFmpeg = async () => {
    if (ffmpegRef.current) return ffmpegRef.current;
    const ffmpeg = new FFmpeg();
    ffmpeg.on('progress', ({ progress }) => {
      const p = Math.max(0, Math.min(1, progress));
      // La conversión a MP4 ocupa el tramo 70→100% de la barra de exportación
      const pct = Math.round(70 + p * 30);
      setExportPct(pct);
      setExportMsg(`Convirtiendo a MP4… ${pct}%`);
    });
    ffmpeg.on('log', ({ message }) => { ffmpegLogRef.current += message + '\n'; });
    try {
      await ffmpeg.load({
        coreURL: `${CORE_BASE}/ffmpeg-core.js`,
        wasmURL: `${CORE_BASE}/ffmpeg-core.wasm`,
      });
    } catch (e: any) {
      throw new Error('No se pudo cargar el motor de video (ffmpeg). Revisá tu conexión y reintentá. ' + (e?.message || String(e)));
    }
    ffmpegRef.current = ffmpeg;
    return ffmpeg;
  };

  // Extrae el audio del video con ffmpeg (WAV PCM mono 16kHz). Robusto para mp4/mov/webm.
  // Extrae el audio de cualquier fuente (video/audio) a WAV PCM con ffmpeg. Robusto para mp4/mov/webm.
  const extractWav = async (url: string, rate = 16000, mono = true): Promise<Uint8Array> => {
    const ffmpeg = await loadFFmpeg();
    const blob = await (await fetch(url)).blob();
    const t = (blob.type || '').toLowerCase();
    const ext = t.includes('quicktime') || t.includes('mov') ? 'mov' : t.includes('webm') ? 'webm' : t.includes('matroska') ? 'mkv' : t.includes('mp3') || t.includes('mpeg') ? 'mp3' : t.includes('wav') ? 'wav' : t.includes('aac') ? 'aac' : t.includes('ogg') ? 'ogg' : t.startsWith('audio') ? 'm4a' : 'mp4';
    const inName = `aud_src.${ext}`;
    await ffmpeg.writeFile(inName, await fetchFile(blob));
    ffmpegLogRef.current = '';
    const code = await ffmpeg.exec(['-i', inName, '-vn', '-ac', mono ? '1' : '2', '-ar', String(rate), '-f', 'wav', 'aud_out.wav']);
    if (typeof code === 'number' && code !== 0) {
      const log = ffmpegLogRef.current.toLowerCase();
      if (log.includes('does not contain any stream') || log.includes('output file does not contain') || log.includes('no audio')) {
        throw new Error('Sin pista de audio.');
      }
      throw new Error('ffmpeg no pudo procesar el audio (código ' + code + ').');
    }
    let data: any;
    try {
      data = await ffmpeg.readFile('aud_out.wav');
    } catch {
      throw new Error('Sin pista de audio.');
    }
    const bytes = (data instanceof Uint8Array) ? data : new Uint8Array(data as any);
    if (!bytes || bytes.byteLength < 200) throw new Error('Sin pista de audio (o silencio).');
    return bytes;
  };
  const getAudioBytes = (url: string) => extractWav(url, 16000, true); // 16k mono: onda / transcripción
  // Solo para transcripción: agrega el base64 (caro), por eso no se usa para la onda.
  const getAudioWav = async (url: string): Promise<{ base64: string; bytes: Uint8Array }> => {
    const bytes = await getAudioBytes(url);
    return { base64: bytesToBase64(bytes), bytes };
  };
  // WAV en base64 para transcribir. Decodifica con el navegador (mp3/m4a/wav/opus) y cae a ffmpeg si hace falta.
  const getWavBase64 = async (url: string): Promise<string> => {
    try {
      const ab = await (await fetch(url)).arrayBuffer();
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const buf = await ctx.decodeAudioData(ab.slice(0));
      try { await ctx.close(); } catch {}
      return bytesToBase64(audioBufferToWav(buf));
    } catch {
      const { base64 } = await getAudioWav(url);
      return base64;
    }
  };

  // === Mezcla de audio offline (modelo CapCut/Canva): video + música + voz → un AudioBuffer ===
  // Determinístico (OfflineAudioContext), sin capturar streams en vivo → el audio nunca se pierde.
  const buildMixedAudioBuffer = async (ranges: { url: string; start: number; end: number }[], totalDur: number): Promise<AudioBuffer | null> => {
    const SR = 48000;
    const decodeCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
    try {
      const cache: Record<string, AudioBuffer | null> = {};
      const decode = async (url: string): Promise<AudioBuffer | null> => {
        if (url in cache) return cache[url];
        // 1) Decodificación directa del navegador: sirve para audios (mp3, m4a, wav, webm/opus, ogg)
        //    y muchas veces para el audio de mp4. Evita depender de que ffmpeg.wasm traiga el codec (ej. opus).
        try {
          const ab = await (await fetch(url)).arrayBuffer();
          const buf = await decodeCtx.decodeAudioData(ab.slice(0));
          cache[url] = buf; return buf;
        } catch {}
        // 2) Fallback con ffmpeg (contenedores de video como .mov que decodeAudioData no abre)
        try {
          const wav = await extractWav(url, SR, false);
          const buf = await decodeCtx.decodeAudioData(wav.buffer.slice(wav.byteOffset, wav.byteOffset + wav.byteLength) as ArrayBuffer);
          cache[url] = buf; return buf;
        } catch { cache[url] = null; return null; }
      };

      const off = new OfflineAudioContext(2, Math.max(1, Math.ceil(totalDur * SR)), SR);
      let anyAudio = false;

      // Audio propio del video (cada rango, en orden, con su volumen)
      if (videoVolume > 0) {
        let cursor = 0;
        for (const r of ranges) {
          const buf = await decode(r.url);
          const dur = Math.max(0, r.end - r.start);
          if (buf) {
            const src = off.createBufferSource(); src.buffer = buf;
            const g = off.createGain(); g.gain.value = videoVolume;
            src.connect(g).connect(off.destination);
            src.start(cursor, r.start, dur);
            anyAudio = true;
          }
          cursor += dur;
        }
      }
      // Música (en loop para cubrir todo el reel)
      if (musicUrl) {
        const mbuf = await decode(musicUrl);
        if (mbuf) {
          const src = off.createBufferSource(); src.buffer = mbuf; src.loop = true;
          const g = off.createGain(); g.gain.value = musicVolume;
          src.connect(g).connect(off.destination); src.start(0);
          anyAudio = true;
        }
      }
      // Voz en off (desde el inicio)
      if (voiceUrl) {
        const vbuf = await decode(voiceUrl);
        console.info('[export] voz decodificada:', vbuf ? `${vbuf.duration.toFixed(2)}s` : 'NO se pudo decodificar');
        if (vbuf) {
          const src = off.createBufferSource(); src.buffer = vbuf;
          const g = off.createGain(); g.gain.value = voiceVolume;
          src.connect(g).connect(off.destination); src.start(0);
          anyAudio = true;
        }
      }
      if (!anyAudio) return null;
      return await off.startRendering();
    } finally {
      try { await decodeCtx.close(); } catch {}
    }
  };

  // === Render de VIDEO con WebCodecs (modelo Canva web) — SOLO video ===
  // Codifica frame por frame (timestamps exactos → duración/velocidad correctas). El audio NO se mete acá:
  // se muxea después con ffmpeg (que codifica AAC de forma 100% confiable). Así separamos lo que cada cosa
  // hace bien: WebCodecs = video perfecto, ffmpeg = audio AAC + mux.
  const renderVideoWebCodecs = async (
    ranges: { url: string; start: number; end: number }[],
    totalDur: number,
    exV: HTMLVideoElement,
    onProgress: (done: number, total: number) => void,
  ): Promise<Blob> => {
    const VE: any = (window as any).VideoEncoder;
    const VF: any = (window as any).VideoFrame;
    if (!VE || !VF) throw new Error('WebCodecs no disponible');

    const candidates = ['avc1.640028', 'avc1.4d0028', 'avc1.42e028', 'avc1.640020', 'avc1.42001f'];
    let vcodec = '';
    for (const c of candidates) {
      try { const s = await VE.isConfigSupported({ codec: c, width: CANVAS_W, height: CANVAS_H, bitrate: 8_000_000, framerate: FPS }); if (s?.supported) { vcodec = c; break; } } catch {}
    }
    if (!vcodec) throw new Error('WebCodecs sin soporte H.264');

    const canvas = canvasRef.current!;
    const muxer = new Muxer({
      target: new ArrayBufferTarget(),
      video: { codec: 'avc', width: CANVAS_W, height: CANVAS_H },
      fastStart: 'in-memory',
    } as any);

    let encErr: any = null;
    const venc = new VE({ output: (chunk: any, meta: any) => muxer.addVideoChunk(chunk, meta), error: (e: any) => { encErr = e; } });
    venc.configure({ codec: vcodec, width: CANVAS_W, height: CANVAS_H, bitrate: 8_000_000, framerate: FPS });

    const frameDurUs = 1e6 / FPS;
    let frameIndex = 0;
    let outBase = 0;
    const seekTo = (tt: number) => new Promise<void>((res) => {
      let done = false;
      const fin = () => { if (done) return; done = true; exV.onseeked = null; res(); };
      exV.onseeked = fin;
      try { exV.currentTime = tt; } catch { fin(); }
      setTimeout(fin, 600);
    });
    for (let ri = 0; ri < ranges.length; ri++) {
      const r = ranges[ri];
      if (exV.src !== r.url) {
        exV.src = r.url;
        await new Promise<void>((res) => { const h = () => { exV.removeEventListener('loadeddata', h); res(); }; exV.addEventListener('loadeddata', h); });
      }
      const rdur = Math.max(0, r.end - r.start);
      const nFrames = Math.max(1, Math.round(rdur * FPS));
      for (let f = 0; f < nFrames; f++) {
        if (encErr) throw encErr;
        const srcT = Math.min(r.start + f / FPS, Math.max(r.start, r.end - 0.001));
        await seekTo(srcT);
        const fade = fadeAt(ri > 0, ri < ranges.length - 1, srcT - r.start, r.end - srcT);
        drawFrame(exV.currentTime, exV, fade, outBase + (srcT - r.start)); // subTime global para subtítulos
        const vf = new VF(canvas, { timestamp: Math.round(frameIndex * frameDurUs), duration: Math.round(frameDurUs) });
        venc.encode(vf, { keyFrame: frameIndex % (FPS * 2) === 0 });
        vf.close();
        frameIndex++;
        if (frameIndex % 3 === 0) onProgress(outBase + f / FPS, totalDur);
        if (venc.encodeQueueSize > 8) await new Promise((r2) => setTimeout(r2, 0));
      }
      outBase += rdur;
    }
    await venc.flush();
    venc.close();
    if (encErr) throw encErr;

    muxer.finalize();
    const { buffer } = (muxer.target as any);
    return new Blob([buffer], { type: 'video/mp4' });
  };

  const exportReel = async () => {
    const v = videoRef.current;
    const canvas = canvasRef.current;
    if (!v || !canvas) return;
    setExporting(true);
    setExportedUrl(null);
    setExportPct(0);
    setExportMsg('Preparando exportación…');
    const t0 = performance.now();

    // Modelo CapCut/Canva: el audio se mezcla aparte (offline, determinístico) y se reproduce como
    // pista EN VIVO mientras se graba el video → video+audio quedan en un solo archivo, sin remux ffmpeg
    // (que rompía el video). El elemento de video del export es propio y se descarta al terminar.
    const exV = document.createElement('video');
    exV.crossOrigin = 'anonymous'; exV.playsInline = true; exV.muted = true; // su audio no se usa
    exV.style.cssText = 'position:fixed;left:-10000px;top:0;width:2px;height:2px;opacity:0;pointer-events:none;';
    document.body.appendChild(exV);
    let exActx: AudioContext | null = null;
    const cleanupExport = () => {
      try { exV.pause(); } catch {}
      try { exV.removeAttribute('src'); exV.load(); } catch {}
      try { exV.remove(); } catch {}
      try { exActx?.close(); } catch {}
    };

    try {
      // Pausa el preview mientras se exporta
      try { v.pause(); pauseBeds(); } catch {}
      setPlaying(false);

      // Asegura que la tipografía de los subtítulos esté cargada antes de grabar
      try { await (document as any).fonts?.load(`900 74px "${subFont}"`); } catch {}

      // Rangos a exportar: el recorte de cada clip (en orden, concatenados)
      const ranges: { url: string; start: number; end: number }[] = clips.map(c => ({ url: c.url, start: c.trimStart, end: c.trimEnd }));
      const totalDur = Math.max(0.1, ranges.reduce((acc, r) => acc + Math.max(0, r.end - r.start), 0));
      console.info('[export] inicio', { clips: clips.length, rangos: ranges.length, duracion: +totalDur.toFixed(2) + 's', formato: '9:16', tam: `${CANVAS_W}x${CANVAS_H}`, musica: !!musicUrl, voz: !!voiceUrl, volVideo: videoVolume });

      // --- 1) Mezcla offline del audio (video + música + voz) → AudioBuffer ---
      setExportMsg('Renderizando audio…');
      setExportPct(8);
      let mixBuf: AudioBuffer | null = null;
      try { mixBuf = await buildMixedAudioBuffer(ranges, totalDur); } catch (err) { console.error('[export] mezcla de audio falló:', err); mixBuf = null; }
      console.info('[export] audio mezclado:', mixBuf ? `${mixBuf.duration.toFixed(2)}s · ${mixBuf.numberOfChannels}ch @ ${mixBuf.sampleRate}Hz` : 'SIN audio');

      // --- 2) Render del video. Vía PRINCIPAL: WebCodecs (determinístico, robusto). ---
      let mp4Blob: Blob | null = null;
      let engine = '';
      const hasWebCodecs = 'VideoEncoder' in window && 'AudioEncoder' in window && 'VideoFrame' in window && 'AudioData' in window;
      console.info('[export] WebCodecs disponible:', hasWebCodecs);
      if (hasWebCodecs) {
        try {
          setExportMsg('Renderizando video (WebCodecs)…');
          setExportPct(12);
          // 1) WebCodecs hace el VIDEO (perfecto)
          const videoOnly = await renderVideoWebCodecs(ranges, totalDur, exV, (done, total) => {
            const pct = Math.min(88, 10 + Math.round((done / total) * 78));
            setExportPct(pct); setExportMsg(`Renderizando video… ${pct}%`);
          });
          console.info('[export] video WebCodecs:', (videoOnly.size / 1048576).toFixed(1) + 'MB');
          // 2) ffmpeg pone el AUDIO con -c:v copy (no re-codifica el video → no lo rompe; AAC siempre fiable)
          if (mixBuf) {
            setExportMsg('Uniendo audio…');
            setExportPct(92);
            const wav = audioBufferToWav(mixBuf);
            const ffmpeg = await loadFFmpeg();
            await ffmpeg.writeFile('wcv.mp4', await fetchFile(videoOnly));
            await ffmpeg.writeFile('wmix.wav', wav);
            await ffmpeg.exec(['-i', 'wcv.mp4', '-i', 'wmix.wav', '-map', '0:v:0', '-map', '1:a:0', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-shortest', '-movflags', '+faststart', 'wcout.mp4']);
            const data = await ffmpeg.readFile('wcout.mp4');
            mp4Blob = new Blob([data as unknown as BlobPart], { type: 'video/mp4' });
            console.info('[export] audio muxeado por ffmpeg');
          } else {
            mp4Blob = videoOnly;
          }
          engine = 'WebCodecs';
          console.info('[export] vía WebCodecs OK');
        } catch (err) {
          console.warn('[export] WebCodecs no se pudo usar, fallback a MediaRecorder:', err);
          mp4Blob = null;
        }
      } else {
        console.info('[export] WebCodecs no disponible, usando MediaRecorder.');
      }

      // --- Fallback: grabación en tiempo real con MediaRecorder (si WebCodecs no estaba/ falló) ---
      if (!mp4Blob) {
        engine = 'grabación';
        const canvasStream = (canvas as any).captureStream(FPS) as MediaStream;
        let srcNode: AudioBufferSourceNode | null = null;
        if (mixBuf) {
          exActx = new (window.AudioContext || (window as any).webkitAudioContext)();
          if (exActx.state === 'suspended') { try { await exActx.resume(); } catch {} }
          const dest = exActx.createMediaStreamDestination();
          srcNode = exActx.createBufferSource(); srcNode.buffer = mixBuf; srcNode.connect(dest);
          const at = dest.stream.getAudioTracks()[0]; if (at) canvasStream.addTrack(at);
        }
        const mp4Mime = ['video/mp4;codecs=h264,aac', 'video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4']
          .find(m => { try { return MediaRecorder.isTypeSupported(m); } catch { return false; } });
        const webmMime = MediaRecorder.isTypeSupported('video/webm;codecs=vp9,opus') ? 'video/webm;codecs=vp9,opus'
          : MediaRecorder.isTypeSupported('video/webm;codecs=vp8,opus') ? 'video/webm;codecs=vp8,opus'
          : MediaRecorder.isTypeSupported('video/webm') ? 'video/webm' : '';
        const isMp4 = !!mp4Mime;
        const recMime = mp4Mime || webmMime || '';
        const recorder = recMime ? new MediaRecorder(canvasStream, { mimeType: recMime }) : new MediaRecorder(canvasStream);
        const chunks: Blob[] = [];
        recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
        const stopped = new Promise<Blob>((resolve) => {
          recorder.onstop = () => resolve(new Blob(chunks, { type: isMp4 ? 'video/mp4' : 'video/webm' }));
        });
        let elapsedBefore = 0;
        let audioStarted = false;
        setExportMsg('Renderizando video… 0%');
        setExportPct(10);
        console.info('[export] grabando (MediaRecorder)…', recMime || '(default)', '· pistas de audio:', canvasStream.getAudioTracks().length);
        recorder.start(100);
        for (let ri = 0; ri < ranges.length; ri++) {
          const range = ranges[ri];
          if (audioStarted && exActx) { try { await exActx.suspend(); } catch {} }
          if (exV.src !== range.url) {
            exV.src = range.url;
            await new Promise<void>((res) => { const h = () => { exV.removeEventListener('loadeddata', h); res(); }; exV.addEventListener('loadeddata', h); });
          }
          exV.currentTime = range.start;
          await new Promise<void>((res) => { exV.onseeked = () => res(); });
          await exV.play().catch(() => {});
          if (exActx && srcNode) {
            if (!audioStarted) { try { srcNode.start(0); } catch {} audioStarted = true; }
            try { await exActx.resume(); } catch {}
          }
          await new Promise<void>((resolve) => {
            let lastUi = 0;
            const step = () => {
              drawFrame(exV.currentTime, exV, fadeAt(ri > 0, ri < ranges.length - 1, exV.currentTime - range.start, range.end - exV.currentTime), elapsedBefore + Math.max(0, exV.currentTime - range.start));
              const now = performance.now();
              if (now - lastUi > 250) {
                lastUi = now;
                const done = elapsedBefore + Math.max(0, exV.currentTime - range.start);
                const pct = Math.min(92, 10 + Math.round((done / totalDur) * 82));
                setExportPct(pct);
                setExportMsg(`Renderizando video… ${pct}%`);
              }
              if (exV.currentTime >= range.end || exV.ended) { exV.pause(); resolve(); return; }
              requestAnimationFrame(step);
            };
            requestAnimationFrame(step);
          });
          elapsedBefore += Math.max(0, range.end - range.start);
        }
        if (exActx) { try { await exActx.suspend(); } catch {} }
        recorder.stop();
        const recBlob = await stopped;
        setExportPct(94);
        if (recBlob.size < 1024) throw new Error('La grabación quedó vacía (el navegador no generó el video).');
        if (isMp4) {
          setExportMsg('Finalizando…');
          mp4Blob = recBlob;
        } else {
          setExportMsg('Convirtiendo a MP4… (puede tardar un poco)');
          const ffmpeg = await loadFFmpeg();
          await ffmpeg.writeFile('in.webm', await fetchFile(recBlob));
          await ffmpeg.exec(['-i', 'in.webm', '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '23', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', 'out.mp4']);
          const data = await ffmpeg.readFile('out.mp4');
          mp4Blob = new Blob([data as unknown as BlobPart], { type: 'video/mp4' });
        }
      }

      if (!mp4Blob) throw new Error('No se generó el archivo de video.');
      const url = URL.createObjectURL(mp4Blob);
      // Verificación: confirma que el MP4 es reproducible y loguea su duración real
      try {
        const probe = document.createElement('video'); probe.preload = 'metadata'; probe.src = url;
        const dur = await new Promise<number>((res) => { probe.onloadedmetadata = () => res(probe.duration); probe.onerror = () => res(NaN); setTimeout(() => res(NaN), 4000); });
        console.info('[export] MP4 listo:', (mp4Blob.size / 1048576).toFixed(1) + 'MB', '· duración:', isFinite(dur) ? dur.toFixed(2) + 's' : 'desconocida', '· esperado:', totalDur.toFixed(2) + 's', '· tiempo total:', ((performance.now() - t0) / 1000).toFixed(1) + 's');
      } catch {}
      setExportedUrl(url);
      setExportPct(100);
      setExportMsg(`✅ Exportación completa (motor: ${engine}${mixBuf ? '' : ' · sin audio'}). Descargá tu reel MP4.`);
    } catch (e: any) {
      console.error('[export] ERROR:', e);
      setExportMsg('');
      setExportPct(0);
      alert(`No se pudo exportar el reel.\n\nMotivo: ${e?.message || 'error desconocido'}\n\n(Abrí la consola para ver el detalle con prefijo [export].)`);
    } finally {
      cleanupExport();
      setExporting(false);
      setPlaying(false);
      // Restaura el frame del preview (el canvas mostró frames del export)
      drawFrame(currentTime);
    }
  };

  const inputClass = "w-full bg-slate-50 border border-slate-100 rounded-xl px-3 py-2 text-sm font-bold outline-none focus:ring-2 focus:ring-orange-100 transition-all";
  const labelClass = "text-[10px] font-black text-slate-400 uppercase tracking-widest";

  return (
    <div className="fixed inset-0 z-[90] bg-[#F8F9FA] flex flex-col animate-in fade-in duration-300">
      <header className="h-20 bg-white border-b border-slate-100 flex items-center justify-between px-5 sm:px-8 shrink-0 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-purple-50 text-purple-600 rounded-2xl flex items-center justify-center"><i className="fa-solid fa-film text-lg"></i></div>
          <div>
            <h2 className="font-display text-xl text-slate-900 tracking-tight leading-none">Editor de Reels</h2>
            <span className="text-[9px] font-black text-slate-300 uppercase tracking-widest">Video · Música · Subtítulos</span>
          </div>
        </div>
        <button onClick={onClose} className="h-11 px-4 flex items-center gap-2 bg-slate-100 text-slate-500 rounded-2xl hover:bg-slate-200 transition-all active:scale-95 text-[10px] font-black uppercase tracking-widest"><i className="fa-solid fa-arrow-left"></i> Volver</button>
      </header>

      <div className="flex-1 overflow-y-auto">
        {clips.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center p-8 text-center gap-5">
            <div className="w-20 h-20 bg-purple-50 text-purple-300 rounded-[32px] flex items-center justify-center"><i className="fa-solid fa-film text-3xl"></i></div>
            <div className="space-y-1">
              <h3 className="font-display text-2xl text-slate-900">Subí un video para empezar</h3>
              <p className="text-slate-400 text-sm">Podés sumar varios, recortar cada uno y se unen en formato Reel (9:16).</p>
            </div>
            <label className="px-6 h-14 bg-purple-600 text-white rounded-2xl text-[11px] font-black uppercase tracking-[0.2em] shadow-xl active:scale-95 transition-all flex items-center gap-3 cursor-pointer">
              <i className="fa-solid fa-arrow-up-from-bracket"></i> Subir video(s)
              <input type="file" accept="video/*" multiple className="hidden" onChange={(e) => { addClips(Array.from(e.target.files || [])); e.currentTarget.value = ''; }} />
            </label>
          </div>
        ) : (
          <div className="max-w-[1400px] mx-auto p-4 sm:p-6 flex flex-col lg:flex-row gap-5 lg:items-start">
            {/* Columna izquierda: player + timeline (juntos, sin huecos) */}
            <div className="flex-1 min-w-0 space-y-5">
            {/* Player */}
            <div className="space-y-4 min-w-0">
              <div className="relative bg-black rounded-3xl overflow-hidden mx-auto" style={{ aspectRatio: '9/16', maxHeight: '52vh' }}>
                <canvas ref={canvasRef} width={CANVAS_W} height={CANVAS_H} onPointerDown={onCanvasPointerDown} onPointerMove={onCanvasPointerMove} onPointerUp={onCanvasPointerUp} onPointerLeave={onCanvasPointerUp} className={`w-full h-full object-contain ${(logoEnabled || subtitles.length) ? 'cursor-move' : ''}`} />
                <video ref={videoRef} src={videoUrl} onLoadedMetadata={onLoadedMetadata} onLoadedData={onVideoReady} onSeeked={onVideoReady} className="hidden" playsInline crossOrigin="anonymous" />
              </div>
              <div className="flex items-center gap-3">
                <button onClick={togglePlay} className="w-12 h-12 bg-slate-900 text-white rounded-2xl flex items-center justify-center active:scale-95 transition-all shrink-0">
                  <i className={`fa-solid ${playing ? 'fa-pause' : 'fa-play'}`}></i>
                </button>
                <div className="relative flex-1">
                  <input type="range" min={0} max={reelTotal() || 0} step={0.05} value={globalTime()} onChange={(e) => seekGlobal(Number(e.target.value))} className="w-full h-1.5 accent-purple-600 bg-slate-100 rounded-full appearance-none cursor-pointer" />
                  {reelTotal() > 0 && clipBoundaries().map((b, i) => (
                    <div key={i} title={`Corte ${i + 1}`} className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-1 h-3.5 bg-white border border-purple-400 rounded-sm pointer-events-none shadow-sm" style={{ left: `${(b / reelTotal()) * 100}%` }} />
                  ))}
                </div>
                <span className="text-[10px] font-black text-slate-400 tabular-nums shrink-0">{fmt(globalTime())} / {fmt(reelTotal())}</span>
              </div>
            </div>

            {/* Línea de tiempo (debajo del video) */}
            <div className="space-y-2 min-w-0">
              {/* Clips */}
              <div className="space-y-2">
                <span className={labelClass}>Clips ({clips.length})</span>
                <div
                  className="flex gap-2 flex-wrap items-center"
                  onPointerMove={(e) => {
                    if (dragFromRef.current == null) return;
                    const el = (document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null)?.closest('[data-clip-idx]') as HTMLElement | null;
                    setDragOverIdx(el ? Number(el.dataset.clipIdx) : null);
                  }}
                  onPointerUp={(e) => {
                    const from = dragFromRef.current; dragFromRef.current = null;
                    setDragIdx(null); setDragOverIdx(null);
                    document.body.style.cursor = '';
                    if (from == null) return;
                    const el = (document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null)?.closest('[data-clip-idx]') as HTMLElement | null;
                    const to = el ? Number(el.dataset.clipIdx) : NaN;
                    if (!isNaN(to)) moveClip(from, to);
                  }}
                >
                  {clips.map((c, i) => (
                    <div
                      key={c.id}
                      data-clip-idx={i}
                      className={`flex items-center gap-2 rounded-xl border-2 px-3 py-2 text-[10px] font-black uppercase tracking-wider transition-all ${i === dragIdx ? 'opacity-50 scale-95 border-purple-400 ring-2 ring-purple-300' : dragIdx != null && i === dragOverIdx ? 'border-purple-500 bg-purple-100 text-purple-700 scale-105' : i === activeIdx ? 'border-purple-600 bg-purple-50 text-purple-700' : 'border-slate-100 bg-slate-50 text-slate-500'}`}
                    >
                      <i className="fa-solid fa-grip-vertical text-slate-400 cursor-grab active:cursor-grabbing touch-none" title="Arrastrá para reordenar" onPointerDown={(e) => { e.preventDefault(); dragFromRef.current = i; setDragIdx(i); document.body.style.cursor = 'grabbing'; }}></i>
                      <button onClick={() => setActiveIdx(i)}><i className="fa-solid fa-film mr-1"></i>Clip {i + 1}</button>
                      <button onClick={() => { if (clips.length === 1) { if (!confirm('¿Borrar el clip y empezar de nuevo?')) return; } removeClip(c.id); }} className="text-red-400 hover:text-red-600" title="Borrar clip"><i className="fa-solid fa-xmark"></i></button>
                    </div>
                  ))}
                  <label className="rounded-xl border-2 border-dashed border-purple-200 text-purple-600 px-3 py-2 text-[10px] font-black uppercase tracking-wider cursor-pointer hover:bg-purple-50 transition-all">
                    <i className="fa-solid fa-plus mr-1"></i>Video
                    <input type="file" accept="video/*" multiple className="hidden" onChange={(e) => { addClips(Array.from(e.target.files || [])); e.currentTarget.value = ''; }} />
                  </label>
                </div>
                {clips.length > 1 && <p className="text-[9px] text-slate-300 font-bold">Arrastrá un clip de su ⠿ y soltalo sobre otro para cambiar el orden. Se exportan en ese orden.</p>}
              </div>

              {/* Compaginado automático */}
              <div className="rounded-2xl border border-purple-100 bg-purple-50/40 p-3.5 space-y-3">
                <div className="flex items-center gap-2">
                  <i className="fa-solid fa-wand-magic-sparkles text-purple-500"></i>
                  <span className="text-[11px] font-black text-slate-700 uppercase tracking-widest">Compaginar automático</span>
                </div>
                <div className="space-y-1.5">
                  <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Duración del reel</span>
                  <div className="flex flex-wrap gap-1.5">
                    {([['auto', 'Auto'], [15, '15s'], [30, '30s'], [60, '60s']] as const).map(([v, l]) => (
                      <button key={String(v)} onClick={() => setReelDur(v as any)} className={`px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-wider transition-all ${reelDur === v ? 'bg-purple-600 text-white shadow-sm' : 'bg-white text-slate-400 border border-slate-100 hover:border-slate-200'}`}>{l}</button>
                    ))}
                  </div>
                </div>
                <div className="space-y-1.5">
                  <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Transición entre clips</span>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {([['none', 'Corte'], ['fade', 'Fundido negro'], ['white', 'Fundido blanco'], ['zoom', 'Zoom'], ['slide', 'Deslizar']] as const).map(([id, label]) => (
                      <button key={id} onClick={() => setTransition(id)} className={`px-2.5 py-1.5 rounded-lg text-[9px] font-black uppercase tracking-wider transition-all ${transition === id ? 'bg-purple-600 text-white shadow-sm' : 'bg-white text-slate-400 border border-slate-100 hover:border-slate-200'}`}>{label}</button>
                    ))}
                    {transition !== 'none' && (
                      <span className="flex items-center gap-1.5 text-[9px] font-black text-slate-400 ml-1">{transDur.toFixed(1)}s<input type="range" min={0.2} max={1.2} step={0.1} value={transDur} onChange={(e) => setTransDur(Number(e.target.value))} className="w-16 h-1.5 accent-purple-600 bg-slate-100 rounded-full appearance-none cursor-pointer" /></span>
                    )}
                  </div>
                </div>
                <button onClick={() => setTrimDead(v => !v)} className="flex items-center gap-2.5 w-full text-left group">
                  <span className={`relative w-9 h-5 rounded-full transition-all shrink-0 ${trimDead ? 'bg-purple-600' : 'bg-slate-200'}`}>
                    <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-all ${trimDead ? 'translate-x-4' : ''}`} />
                  </span>
                  <span className="flex flex-col">
                    <span className="text-[10px] font-black text-slate-600 uppercase tracking-wider">Quitar tiempos muertos</span>
                    <span className="text-[9px] text-slate-400 font-bold">Recorta el silencio del inicio y fin de cada clip</span>
                  </span>
                </button>
                <button onClick={autoCompaginate} className="w-full py-2.5 bg-purple-600 text-white rounded-xl text-[10px] font-black uppercase tracking-widest shadow-md shadow-purple-200/50 active:scale-95 transition-all"><i className="fa-solid fa-wand-magic-sparkles mr-1.5"></i>Compaginar automático</button>
                <p className="text-[9px] text-slate-400 font-bold leading-relaxed">Une tus clips en orden y los ajusta a la duración elegida. Después agregale música, voz y subtítulos.</p>
              </div>

              {/* Ajuste avanzado: timeline manual (colapsada) */}
              <button onClick={() => setShowAdvanced(a => !a)} className="flex items-center gap-2 text-[10px] font-black text-slate-400 uppercase tracking-widest hover:text-slate-600 transition-colors pt-1">
                <i className={`fa-solid fa-chevron-${showAdvanced ? 'down' : 'right'} text-[8px]`}></i> Ajuste avanzado (línea de tiempo)
              </button>

              {/* Línea de tiempo */}
              {showAdvanced && (
              <div className="space-y-2">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <span className={labelClass}>Línea de tiempo</span>
                  <div className="flex items-center gap-1.5">
                    {/* Zoom de la timeline */}
                    <div className="flex items-center bg-slate-100 rounded-lg">
                      <button onClick={() => setTlZoom(z => Math.max(0.25, +(z - 0.25).toFixed(2)))} className="w-7 h-7 flex items-center justify-center text-slate-500 hover:text-slate-800" title="Alejar"><i className="fa-solid fa-magnifying-glass-minus text-xs"></i></button>
                      <button onClick={fitTimelineZoom} className="px-1.5 text-[9px] font-black text-slate-500 tabular-nums hover:text-purple-600" title="Ajustar todos los clips a la pantalla">{Math.round(tlZoom * 100)}%</button>
                      <button onClick={() => setTlZoom(z => Math.min(4, +(z + 0.25).toFixed(2)))} className="w-7 h-7 flex items-center justify-center text-slate-500 hover:text-slate-800" title="Acercar"><i className="fa-solid fa-magnifying-glass-plus text-xs"></i></button>
                    </div>
                    <button onClick={splitActive} className="px-3 py-1.5 bg-purple-50 text-purple-600 rounded-lg text-[9px] font-black uppercase tracking-widest hover:bg-purple-100 transition-all"><i className="fa-solid fa-scissors mr-1.5"></i>Dividir acá</button>
                    <button onClick={() => { const c = clips[activeIdx]; if (!c) return; if (clips.length === 1) { if (!confirm('¿Borrar el clip y empezar de nuevo?')) return; } removeClip(c.id); }} className="px-3 py-1.5 bg-red-50 text-red-500 rounded-lg text-[9px] font-black uppercase tracking-widest hover:bg-red-100 transition-all" title="Borrar el tramo seleccionado"><i className="fa-solid fa-trash mr-1.5"></i>Borrar tramo</button>
                  </div>
                </div>
                <div ref={trackRef} onPointerDown={onTimelinePointerDown} onPointerMove={onTimelinePointerMove} onPointerUp={endDrag} onPointerLeave={endDrag} className="overflow-x-auto bg-slate-900 rounded-2xl p-3 select-none touch-none cursor-pointer">
                  <div className="relative" style={{ width: timelineW() }}>
                    {/* Pista de video — cada bloque = el tramo recortado real */}
                    <div className="relative h-20">
                      {clips.map((c, idx) => {
                        const left = clipLeftPx(idx);
                        const width = clipW(c);
                        return (
                          <div key={c.id} onClick={() => setActiveIdx(idx)} className={`absolute top-0 h-20 rounded-lg overflow-hidden border-2 transition-all ${idx === activeIdx ? 'border-yellow-300 ring-2 ring-yellow-300/60' : 'border-slate-700'}`} style={{ left: left + 2, width: Math.max(10, width - 4) }}>
                            {clipThumbs[c.id] ? (
                              <>
                                <img src={clipThumbs[c.id]} alt="" draggable={false} className="absolute inset-0 w-full h-full object-cover pointer-events-none" />
                                <div className="absolute inset-0 bg-gradient-to-b from-black/45 via-transparent to-black/20" />
                              </>
                            ) : (
                              <div className="absolute inset-0 bg-purple-600/55" />
                            )}
                            <span className="absolute left-2.5 top-1.5 text-[9px] text-white font-black uppercase truncate max-w-[70%] pointer-events-none drop-shadow">Clip {idx + 1}</span>
                            <div onPointerDown={(e) => { e.stopPropagation(); draggingRef.current = { clipId: c.id, edge: 'start', startX: e.clientX, origStart: c.trimStart, origEnd: c.trimEnd }; setActiveIdx(idx); }} className="absolute top-0 bottom-0 left-0 w-2.5 bg-white cursor-ew-resize flex items-center justify-center z-10"><div className="w-0.5 h-5 bg-purple-600" /></div>
                            <div onPointerDown={(e) => { e.stopPropagation(); draggingRef.current = { clipId: c.id, edge: 'end', startX: e.clientX, origStart: c.trimStart, origEnd: c.trimEnd }; setActiveIdx(idx); }} className="absolute top-0 bottom-0 right-0 w-2.5 bg-white cursor-ew-resize flex items-center justify-center z-10"><div className="w-0.5 h-5 bg-purple-600" /></div>
                            {idx === activeIdx && (
                              <button onPointerDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); if (clips.length === 1) { if (!confirm('¿Borrar el clip y empezar de nuevo?')) return; } removeClip(c.id); }} className="absolute top-1 right-3 z-20 w-5 h-5 rounded-full bg-black/70 text-white flex items-center justify-center text-[9px] hover:bg-red-500 transition-colors" title="Borrar este tramo"><i className="fa-solid fa-xmark"></i></button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                    {/* Pista de audio (onda recortada) */}
                    <div className="relative h-12 mt-2">
                      {clips.map((c, idx) => {
                        const left = clipLeftPx(idx);
                        const width = clipW(c);
                        const peaks = clipPeaks[c.id];
                        const dur = c.duration || 0;
                        const sub = (peaks && peaks.length && dur)
                          ? peaks.slice(Math.floor((c.trimStart / dur) * peaks.length), Math.max(Math.floor((c.trimStart / dur) * peaks.length) + 1, Math.ceil((c.trimEnd / dur) * peaks.length)))
                          : peaks;
                        return (
                          <div key={c.id} onClick={() => setActiveIdx(idx)} className={`absolute top-0 h-12 rounded-lg overflow-hidden border ${idx === activeIdx ? 'border-emerald-400/70' : 'border-slate-700'}`} style={{ left: left + 2, width: Math.max(10, width - 4) }}>
                            <div className="absolute inset-0 bg-emerald-950/40" />
                            {peaks === undefined ? (
                              <div className="absolute inset-0 flex items-center justify-center">
                                <span className="text-[8px] text-emerald-300/50 font-black uppercase tracking-widest"><i className="fa-solid fa-circle-notch fa-spin mr-1"></i>Audio</span>
                              </div>
                            ) : (sub && sub.length > 0) ? (
                              <div className="absolute inset-0 flex items-center gap-px px-px">
                                {sub.map((p, i) => <div key={i} className="flex-1 rounded-full" style={{ height: `${Math.max(6, p * 100)}%`, background: '#34d399' }} />)}
                              </div>
                            ) : (
                              <div className="absolute inset-0 flex items-center justify-center">
                                <div className="h-px w-[90%] bg-slate-600" />
                                <span className="absolute text-[8px] text-slate-400 font-black uppercase tracking-widest">Sin audio</span>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                    {/* Pista de MÚSICA (global, estilo CapCut) */}
                    {musicUrl && (
                      <div className="relative h-9 mt-2" style={{ width: timelineW() }}>
                        <div className="absolute inset-0 rounded-lg bg-purple-600/30 border border-purple-500/40 flex items-center gap-2 px-2 overflow-hidden">
                          <button onClick={(e) => { e.stopPropagation(); togglePreview('music', musicUrl); }} className="w-5 h-5 shrink-0 rounded-full bg-purple-600 text-white flex items-center justify-center"><i className={`fa-solid ${previewing === 'music' ? 'fa-pause' : 'fa-play'} text-[8px]`}></i></button>
                          <i className="fa-solid fa-music text-purple-300 text-[10px] shrink-0"></i>
                          <span className="text-[9px] text-purple-100 font-black truncate">{musicName || 'Música'}</span>
                        </div>
                      </div>
                    )}
                    {/* Pista de VOZ EN OFF (global) */}
                    {voiceUrl && (
                      <div className="relative h-9 mt-2" style={{ width: timelineW() }}>
                        <div className="absolute inset-0 rounded-lg bg-emerald-600/25 border border-emerald-500/40 flex items-center gap-2 px-2 overflow-hidden">
                          <button onClick={(e) => { e.stopPropagation(); togglePreview('voice', voiceUrl); }} className="w-5 h-5 shrink-0 rounded-full bg-emerald-500 text-white flex items-center justify-center"><i className={`fa-solid ${previewing === 'voice' ? 'fa-pause' : 'fa-play'} text-[8px]`}></i></button>
                          <i className="fa-solid fa-microphone-lines text-emerald-300 text-[10px] shrink-0"></i>
                          <span className="text-[9px] text-emerald-100 font-black truncate">{voiceName || 'Voz en off'}</span>
                        </div>
                      </div>
                    )}
                    {/* Cabezal (cruza todas las pistas) con perilla para agarrarlo */}
                    <div className="absolute top-0 bottom-0 w-0.5 bg-yellow-300 pointer-events-none z-20" style={{ left: clipLeftPx(activeIdx) + (currentTime - (activeClip?.trimStart || 0)) * TL_PX }}>
                      <div className="absolute -top-1 left-1/2 -translate-x-1/2 w-3.5 h-3.5 rounded-full bg-yellow-300 border-2 border-slate-900 shadow" />
                    </div>
                  </div>
                </div>
                <p className="text-[9px] text-slate-300 font-bold leading-relaxed">Arrastrá los bordes blancos para recortar las puntas. Tocá la timeline para mover el cabezal (línea amarilla).<br/><b>Cortar una parte del medio:</b> 1) cabezal al inicio de esa parte → <b>Dividir acá</b>. 2) movés el cabezal al final → <b>Dividir acá</b>. 3) el tramo del medio queda <b>seleccionado (borde amarillo)</b> → tocá <b>Borrar tramo</b>.</p>

                {/* Transiciones entre clips */}
                {clips.length > 1 && (
                  <div className="space-y-1.5 pt-1">
                    <span className={labelClass}>Transición entre clips</span>
                    <div className="flex flex-wrap items-center gap-1.5">
                      {([['none', 'Ninguna'], ['fade', 'Fundido negro'], ['white', 'Fundido blanco'], ['zoom', 'Zoom'], ['slide', 'Deslizar']] as const).map(([id, label]) => (
                        <button key={id} onClick={() => setTransition(id)} className={`px-2.5 py-1.5 rounded-lg text-[9px] font-black uppercase tracking-wider transition-all ${transition === id ? 'bg-purple-600 text-white shadow-sm' : 'bg-slate-50 text-slate-400 border border-slate-100 hover:border-slate-200'}`}>{label}</button>
                      ))}
                      {transition !== 'none' && (
                        <span className="flex items-center gap-1.5 text-[9px] font-black text-slate-400 ml-1">
                          {transDur.toFixed(1)}s
                          <input type="range" min={0.2} max={1.2} step={0.1} value={transDur} onChange={(e) => setTransDur(Number(e.target.value))} className="w-20 h-1.5 accent-purple-600 bg-slate-100 rounded-full appearance-none cursor-pointer" />
                        </span>
                      )}
                    </div>
                  </div>
                )}
              </div>
              )}
            </div>
            </div>

            {/* Opciones (a la derecha) — scrollean solas, no empujan la timeline */}
            <div className="space-y-3 lg:w-[360px] shrink-0 lg:max-h-[calc(100vh-7rem)] lg:overflow-y-auto lg:pr-1">
              {/* Audio del video */}
              <Accordion title="Audio del video" icon="fa-volume-high" open={!!openSec.audiovideo} onToggle={() => toggleSec('audiovideo')} badge={videoVolume === 0 ? 'Silenciado' : undefined}>
                <div className="flex items-center justify-end">
                  <button onClick={() => setVideoVolume(videoVolume === 0 ? 1 : 0)} className={`px-2.5 py-1 rounded-lg text-[9px] font-black uppercase tracking-widest transition-all ${videoVolume === 0 ? 'bg-red-50 text-red-500 border border-red-100' : 'bg-slate-50 text-slate-400 border border-slate-100'}`}>
                    <i className={`fa-solid ${videoVolume === 0 ? 'fa-volume-xmark' : 'fa-volume-high'} mr-1.5`}></i>{videoVolume === 0 ? 'Silenciado' : 'Activo'}
                  </button>
                </div>
                <div className="flex items-center gap-2">
                  <i className="fa-solid fa-volume-low text-slate-300 text-xs"></i>
                  <input type="range" min={0} max={1} step={0.05} value={videoVolume} onChange={(e) => setVideoVolume(Number(e.target.value))} className="flex-1 h-1.5 accent-purple-600 bg-slate-100 rounded-full appearance-none cursor-pointer" />
                  <span className="text-[9px] font-black text-slate-400 tabular-nums w-8 text-right">{Math.round(videoVolume * 100)}%</span>
                </div>
                <p className="text-[9px] text-slate-300 font-bold">Subí o bajá el sonido original del video. Silencialo si vas a usar música o voz en off.</p>
              </Accordion>

              {/* Música */}
              <Accordion title="Música" icon="fa-music" open={!!openSec.musica} onToggle={() => toggleSec('musica')} badge={musicUrl ? '1' : undefined}>
                {musicUrl ? (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 bg-slate-50 rounded-xl px-3 py-2 border border-slate-100">
                      <button onClick={() => togglePreview('music', musicUrl)} className="w-7 h-7 shrink-0 rounded-full bg-purple-600 text-white flex items-center justify-center active:scale-95 transition-all" title="Escuchar"><i className={`fa-solid ${previewing === 'music' ? 'fa-pause' : 'fa-play'} text-[10px]`}></i></button>
                      <span className="flex-1 text-xs font-bold text-slate-600 truncate"><i className="fa-solid fa-music text-purple-500 mr-2"></i>{musicName}</span>
                      <button onClick={() => { togglePreview('music', null); previewAudioRef.current?.pause(); musicElRef.current?.pause(); setMusicUrl(null); setMusicName(''); musicElRef.current = null; }} className="text-red-400 hover:text-red-600 text-xs shrink-0"><i className="fa-solid fa-xmark"></i></button>
                    </div>
                    <div className="flex items-center gap-2">
                      <i className="fa-solid fa-volume-low text-slate-300 text-xs"></i>
                      <input type="range" min={0} max={1} step={0.05} value={musicVolume} onChange={(e) => setMusicVolume(Number(e.target.value))} className="flex-1 h-1.5 accent-purple-600 bg-slate-100 rounded-full appearance-none cursor-pointer" />
                    </div>
                  </div>
                ) : (
                  <label className="block w-full py-2.5 text-purple-600 text-[9px] font-black uppercase tracking-widest text-center hover:bg-purple-50 rounded-xl transition-all border border-purple-100 border-dashed cursor-pointer">
                    + Subir música
                    <input type="file" accept="audio/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleMusicFile(f); }} />
                  </label>
                )}
              </Accordion>

              {/* Voz en off */}
              <Accordion title="Voz en off" icon="fa-microphone-lines" open={!!openSec.voz} onToggle={() => toggleSec('voz')} badge={voiceUrl ? '1' : undefined}>
                <p className="text-[10px] text-slate-400 font-bold leading-relaxed">¿Tu video no tiene voz? Grabá una narración o subí un audio.</p>
                {voiceUrl ? (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 bg-slate-50 rounded-xl px-3 py-2 border border-slate-100">
                      <button onClick={() => togglePreview('voice', voiceUrl)} className="w-7 h-7 shrink-0 rounded-full bg-emerald-500 text-white flex items-center justify-center active:scale-95 transition-all" title="Escuchar"><i className={`fa-solid ${previewing === 'voice' ? 'fa-pause' : 'fa-play'} text-[10px]`}></i></button>
                      <span className="flex-1 text-xs font-bold text-slate-600 truncate"><i className="fa-solid fa-microphone-lines text-emerald-500 mr-2"></i>{voiceName}</span>
                      <button onClick={() => { previewAudioRef.current?.pause(); removeVoice(); }} className="text-red-400 hover:text-red-600 text-xs shrink-0"><i className="fa-solid fa-xmark"></i></button>
                    </div>
                    <div className="flex items-center gap-2">
                      <i className="fa-solid fa-volume-low text-slate-300 text-xs"></i>
                      <input type="range" min={0} max={1} step={0.05} value={voiceVolume} onChange={(e) => setVoiceVolume(Number(e.target.value))} className="flex-1 h-1.5 accent-emerald-600 bg-slate-100 rounded-full appearance-none cursor-pointer" />
                    </div>
                  </div>
                ) : recording ? (
                  <button onClick={stopRecording} className="w-full py-2.5 bg-red-500 text-white rounded-xl text-[9px] font-black uppercase tracking-widest shadow-md active:scale-95 transition-all animate-pulse">
                    <i className="fa-solid fa-stop mr-1.5"></i>Detener grabación
                  </button>
                ) : (
                  <div className="grid grid-cols-2 gap-2">
                    <button onClick={startRecording} className="py-2.5 bg-emerald-50 text-emerald-600 rounded-xl text-[9px] font-black uppercase tracking-widest hover:bg-emerald-100 transition-all border border-emerald-100">
                      <i className="fa-solid fa-microphone mr-1.5"></i>Grabar
                    </button>
                    <label className="py-2.5 text-emerald-600 text-[9px] font-black uppercase tracking-widest text-center hover:bg-emerald-50 rounded-xl transition-all border border-emerald-100 border-dashed cursor-pointer">
                      <i className="fa-solid fa-arrow-up-from-bracket mr-1.5"></i>Subir
                      <input type="file" accept="audio/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleVoiceFile(f); }} />
                    </label>
                  </div>
                )}
              </Accordion>

              {/* Logo */}
              {kit?.logoUrls?.[0] && (
                <Accordion title="Logo de marca" icon="fa-star" open={!!openSec.logo} onToggle={() => toggleSec('logo')} badge={logoEnabled ? 'On' : undefined}>
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-bold text-slate-400">Mostrar logo en el reel</span>
                    <button onClick={() => setLogoEnabled(!logoEnabled)} className={`w-11 h-6 rounded-full transition-all relative ${logoEnabled ? 'bg-purple-600' : 'bg-slate-300'}`}>
                      <div className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${logoEnabled ? 'translate-x-5' : 'translate-x-0.5'}`} />
                    </button>
                  </div>
                  {logoEnabled && (
                    <>
                      <div className="flex items-center gap-2">
                        <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest w-14">Tamaño</span>
                        <input type="range" min={8} max={60} step={1} value={logoSize} onChange={(e) => setLogoSize(Number(e.target.value))} className="flex-1 h-1.5 accent-purple-600 bg-slate-100 rounded-full appearance-none cursor-pointer" />
                        <span className="text-[9px] font-black text-slate-400 tabular-nums w-8 text-right">{logoSize}%</span>
                      </div>
                      <p className="text-[9px] text-slate-300 font-bold">Arrastrá el logo en el preview para moverlo, o usá el tamaño acá.</p>
                    </>
                  )}
                </Accordion>
              )}

              {/* Subtítulos */}
              <Accordion title="Subtítulos" icon="fa-closed-captioning" open={!!openSec.subtitulos} onToggle={() => toggleSec('subtitulos')} badge={subtitles.length ? String(subtitles.length) : undefined}>
                <div className="flex items-center justify-end gap-2">
                  <input type="color" value={subColor} onChange={(e) => setSubColor(e.target.value)} className="w-7 h-7 rounded-lg border border-slate-200 cursor-pointer" title="Color del texto" />
                  <button onClick={addSubtitle} className="px-3 py-1.5 bg-purple-50 text-purple-600 rounded-lg text-[9px] font-black uppercase tracking-widest hover:bg-purple-100 transition-all">+ En {fmt(currentTime)}</button>
                  {subtitles.length > 0 && <button onClick={() => { if (confirm('¿Borrar todos los subtítulos?')) setSubtitles([]); }} className="px-3 py-1.5 bg-red-50 text-red-500 rounded-lg text-[9px] font-black uppercase tracking-widest hover:bg-red-100 transition-all" title="Borrar todos los subtítulos"><i className="fa-solid fa-trash mr-1"></i>Borrar</button>}
                </div>
                {subtitles.length > 0 && (
                  <p className="text-[9px] text-slate-300 font-bold">Arrastrá el subtítulo en el preview para reubicarlo.{subPos && <button onClick={() => setSubPos(null)} className="ml-1 text-purple-500 hover:underline">Volver a la posición del estilo</button>}</p>
                )}

                {/* Auto-subtítulos con IA */}
                <button onClick={generateSubtitles} disabled={transcribing} className="w-full py-2.5 bg-gradient-to-r from-purple-600 to-violet-500 text-white rounded-xl text-[9px] font-black uppercase tracking-widest shadow-md shadow-purple-200/50 active:scale-95 disabled:opacity-50 transition-all">
                  {transcribing ? <><i className="fa-solid fa-circle-notch fa-spin mr-1.5"></i>Transcribiendo…</> : <><i className="fa-solid fa-wand-magic-sparkles mr-1.5"></i>{voiceUrl ? 'Generar subtítulos de la voz en off' : 'Generar subtítulos del audio'}</>}
                </button>

                {/* Estilos predeterminados */}
                <div className="space-y-1.5">
                  <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Estilo</span>
                  <div className="flex flex-wrap gap-1.5">
                    {Object.entries(SUB_STYLES).map(([id, st]) => (
                      <button key={id} onClick={() => { setSubStyle(id); setSubColor(st.def); }} className={`px-2.5 py-1.5 rounded-lg text-[9px] font-black uppercase tracking-wider transition-all ${subStyle === id ? 'bg-purple-600 text-white shadow-sm' : 'bg-slate-50 text-slate-400 border border-slate-100 hover:border-slate-200'}`}>{st.label}</button>
                    ))}
                  </div>
                </div>

                {/* Tipografía */}
                <div className="space-y-1.5">
                  <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Tipografía</span>
                  <div className="flex flex-wrap gap-1.5">
                    {SUB_FONTS.map((f) => (
                      <button key={f.value} onClick={() => setSubFont(f.value)} style={{ fontFamily: `"${f.value}", sans-serif` }} className={`px-3 py-1.5 rounded-lg text-sm transition-all ${subFont === f.value ? 'bg-purple-600 text-white shadow-sm' : 'bg-slate-50 text-slate-500 border border-slate-100 hover:border-slate-200'}`}>{f.label}</button>
                    ))}
                  </div>
                </div>

                {/* Tamaño */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Tamaño</span>
                    <span className="text-[9px] font-black text-purple-600 tabular-nums">{Math.round(subScale * 100)}%</span>
                  </div>
                  <input type="range" min={0.6} max={1.6} step={0.05} value={subScale} onChange={(e) => setSubScale(Number(e.target.value))} className="w-full h-1.5 accent-purple-600 bg-slate-200 rounded-full appearance-none cursor-pointer" />
                </div>

                {/* Animación */}
                <div className="space-y-1.5">
                  <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Animación</span>
                  <div className="flex flex-wrap gap-1.5 items-center">
                    {([['none', 'Ninguna'], ['reveal', 'Aparecen'], ['highlight', 'Resaltar palabra']] as const).map(([id, label]) => (
                      <button key={id} onClick={() => setSubAnim(id)} className={`px-2.5 py-1.5 rounded-lg text-[9px] font-black uppercase tracking-wider transition-all ${subAnim === id ? 'bg-purple-600 text-white shadow-sm' : 'bg-slate-50 text-slate-400 border border-slate-100 hover:border-slate-200'}`}>{label}</button>
                    ))}
                    {subAnim !== 'none' && (
                      <label className="flex items-center gap-1 text-[9px] font-black text-slate-400 uppercase tracking-wider ml-1">
                        Resalte
                        <input type="color" value={subAccent} onChange={(e) => setSubAccent(e.target.value)} className="w-7 h-7 rounded-lg border border-slate-200 cursor-pointer" title="Color de la palabra activa" />
                      </label>
                    )}
                  </div>
                  <p className="text-[9px] text-slate-300 font-bold">"Aparecen": las palabras se muestran a medida que se dicen. "Resaltar": pinta la palabra que se está diciendo.</p>
                </div>

                <div className="space-y-2">
                  {subtitles.length === 0 && <p className="text-[10px] text-slate-300 font-bold">Generá los subtítulos del audio con IA, o agregalos a mano en el momento que quieras.</p>}
                  {subtitles.map((s) => (
                    <div key={s.id} className="bg-slate-50 rounded-xl border border-slate-100 p-2.5 space-y-2">
                      <div className="flex items-center gap-2">
                        <input type="text" placeholder="Texto del subtítulo" value={s.text} onChange={(e) => setSubtitles(prev => prev.map(x => x.id === s.id ? { ...x, text: e.target.value } : x))} className={inputClass} />
                        <button onClick={() => setSubtitles(prev => prev.filter(x => x.id !== s.id))} className="text-red-400 hover:text-red-600 text-xs shrink-0 px-1"><i className="fa-solid fa-trash"></i></button>
                      </div>
                      <div className="flex items-center gap-2 text-[9px] font-bold text-slate-400">
                        <span>{fmt(s.start)}</span>
                        <input type="range" min={0} max={duration || 0} step={0.1} value={s.start} onChange={(e) => setSubtitles(prev => prev.map(x => x.id === s.id ? { ...x, start: Math.min(Number(e.target.value), x.end - 0.2) } : x))} className="flex-1 h-1 accent-purple-600 bg-slate-200 rounded-full appearance-none cursor-pointer" />
                        <input type="range" min={0} max={duration || 0} step={0.1} value={s.end} onChange={(e) => setSubtitles(prev => prev.map(x => x.id === s.id ? { ...x, end: Math.max(Number(e.target.value), x.start + 0.2) } : x))} className="flex-1 h-1 accent-purple-600 bg-slate-200 rounded-full appearance-none cursor-pointer" />
                        <span>{fmt(s.end)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </Accordion>

              {/* Export */}
              <div className="space-y-3 pt-2">
                {exportedUrl ? (
                  <a href={exportedUrl} download="reel-gomall.mp4" className="w-full h-14 bg-green-500 text-white rounded-2xl text-[10px] font-black uppercase tracking-[0.2em] shadow-xl active:scale-95 transition-all flex items-center justify-center gap-2">
                    <i className="fa-solid fa-download"></i> Descargar reel MP4
                  </a>
                ) : (
                  <button onClick={exportReel} disabled={exporting} className="w-full h-14 bg-purple-600 text-white rounded-2xl text-[10px] font-black uppercase tracking-[0.2em] shadow-xl active:scale-95 disabled:opacity-50 transition-all flex items-center justify-center gap-2">
                    {exporting ? <><i className="fa-solid fa-circle-notch fa-spin"></i> Exportando…</> : <><i className="fa-solid fa-clapperboard"></i> Exportar reel</>}
                  </button>
                )}
                {exporting && (
                  <div className="h-2 w-full bg-slate-100 rounded-full overflow-hidden">
                    <div className="h-full bg-gradient-to-r from-purple-600 to-violet-500 transition-all duration-200 rounded-full" style={{ width: `${exportPct}%` }} />
                  </div>
                )}
                {exportMsg && <p className="text-[10px] text-slate-400 font-bold text-center">{exportMsg}</p>}
                {initialCopy && (
                  <div className="bg-slate-50 rounded-xl border border-slate-100 p-3 space-y-1">
                    <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Copy sugerido por la campaña</span>
                    <p className="text-xs text-slate-600 font-medium whitespace-pre-wrap">{initialCopy}</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default ReelStudio;
