// === Editor de Reels V2 (Fases 2 y 3) — multi-track + UI nueva estilo OpenCut con branding Gomall ===
// Componente NUEVO, independiente del editor actual (ReelStudio). Es un v1 para iterar con pruebas en
// navegador: cubre importar media, timeline multi-pista (mover/recortar/seleccionar), texto libre,
// preview, propiedades por elemento y export a MP4 (mediabunny, sin ffmpeg/GPL).
// Pendiente para próximas iteraciones: subtítulos karaoke, transiciones, stickers, persistencia, snapping.

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { UserProfile, CustomFont } from '../types';
import {
  ReelProject, ReelElement, TextElement, TextStyle, VideoElement, ImageElement, AudioElement, Track,
  AspectId, ASPECTS, createProject, canvasSize, projectDuration, findElement,
  addElement, addAudioElement, addOverlayElement, updateElement, removeElement, moveElement, moveTrack, setTrackFlag, splitElement, closeVideoGaps, autoCompaginate,
  makeVideoElement, makeImageElement, makeTextElement, makeAudioElement, genId, TransitionKind, EmphasisKind,
} from './reel/model';
import { MediaPool, drawReelFrame, seekVideosAt, sourceTime } from './reel/render';
import { exportProject, buildMixedAudio } from './reel/exporter';
import { transcribe } from './reel/whisper';
import { computePeaks, detectBeats, silenceBounds } from './reel/analyze';
import { putMedia, getMedia, putProjectAt, getProjectAt, clearProjectAt, newMediaId } from './reelStorage';


const BRAND = '#EA5B25';
const STICKERS = [
  '🔥', '⭐', '❤️', '👍', '🎉', '💯', '😍', '🛒', '✅', '⚡', '🎁', '📢', '👀', '💥', '🤑', '🏷️', '👇', '🚀',
  '😱', '🤩', '😎', '🥳', '😮', '🙌', '👏', '💪', '🤯', '😳', '👉', '👆', '👌', '🤝', '💰', '💸', '💎', '🏆',
  '📉', '📈', '⏰', '⏳', '🔔', '📌', '💡', '🎯', '🧠', '❌', '⚠️', '✨', '🌟', '💥', '🎬', '📱', '🛍️', '🎧',
];

// Tipografías disponibles (cargadas en index.html).
const FONTS = ['Inter', 'Montserrat', 'Bebas Neue', 'Oswald', 'Anton', 'Playfair Display', 'Roboto', 'Open Sans', 'Ubuntu', 'Lora', 'Cinzel', 'Permanent Marker', 'Pacifico', 'Dancing Script'];

// Margen (px) a la izquierda de la timeline: deja aire antes de 0s para agarrar el cabezal cómodo.
const TL_PAD = 16;

// Presets de subtítulos/texto, agrupados por tipo. group: viral (animados/llamativos) | sobrio (limpios) | marca.
const PRESET_GROUPS: { id: 'viral' | 'sobrio' | 'marca'; label: string }[] = [
  { id: 'viral', label: 'Virales' },
  { id: 'sobrio', label: 'Sobrios' },
  { id: 'marca', label: 'Marca' },
];
const SUB_PRESETS: { id: string; label: string; group: 'viral' | 'sobrio' | 'marca'; style: Partial<TextStyle> }[] = [
  // Virales
  { id: 'capcut', label: 'Viral', group: 'viral', style: { color: '#FFFFFF', bg: null, stroke: true, weight: 900, size: 7, accent: '#FFE600', glow: false, anim: 'karaoke', karaoke: true, upper: false } },
  { id: 'hormozi', label: 'Hormozi', group: 'viral', style: { color: '#FFFFFF', bg: null, stroke: true, weight: 900, size: 7.5, accent: '#22C55E', glow: false, anim: 'wordbox', karaoke: false, upper: true } },
  { id: 'amarillo', label: 'Amarillo', group: 'viral', style: { color: '#FFFFFF', bg: null, stroke: true, weight: 900, size: 7.5, accent: '#FFE600', glow: false, anim: 'karaoke', karaoke: true, upper: true } },
  { id: 'beast', label: 'Beast', group: 'viral', style: { color: '#FFFFFF', bg: null, stroke: true, weight: 900, size: 8, accent: '#FFE600', glow: false, anim: 'pop', karaoke: false, upper: true } },
  { id: 'pop', label: 'Pop', group: 'viral', style: { color: '#FFFFFF', bg: null, stroke: true, weight: 900, size: 7, accent: '#FF3B6B', glow: false, anim: 'pop', karaoke: false, upper: false } },
  { id: 'contorno', label: 'Contorno', group: 'viral', style: { color: '#FFFFFF', bg: null, stroke: true, weight: 900, size: 9, accent: '#FF3B6B', glow: false, anim: 'pop', karaoke: false, upper: true } },
  // Sobrios
  { id: 'tiktok', label: 'TikTok', group: 'sobrio', style: { color: '#FFFFFF', bg: '#000000', stroke: false, weight: 700, size: 5.5, glow: false, anim: 'none', karaoke: false, upper: false } },
  { id: 'caja', label: 'Caja', group: 'sobrio', style: { color: '#FFFFFF', bg: '#000000', stroke: false, weight: 800, size: 6, glow: false, anim: 'none', karaoke: false, upper: false } },
  { id: 'clasico', label: 'Clásico', group: 'sobrio', style: { color: '#FFFFFF', bg: null, stroke: true, weight: 700, size: 6, glow: false, anim: 'none', karaoke: false, upper: false } },
  { id: 'revelado', label: 'Revelado', group: 'sobrio', style: { color: '#FFFFFF', bg: null, stroke: true, weight: 800, size: 6.5, glow: false, anim: 'reveal', karaoke: false, upper: false } },
  { id: 'minimal', label: 'Minimal', group: 'sobrio', style: { color: '#FFFFFF', bg: null, stroke: true, weight: 600, size: 5, glow: false, anim: 'none', karaoke: false, upper: false } },
  // Marca
  { id: 'cian', label: 'Cian', group: 'marca', style: { color: '#FFFFFF', bg: null, stroke: true, weight: 900, size: 7, accent: '#5CC2DB', glow: false, anim: 'karaoke', karaoke: true, upper: false } },
  { id: 'neon', label: 'Neón', group: 'marca', style: { color: '#FFE600', bg: null, stroke: true, weight: 900, size: 6.5, accent: '#FFE600', glow: true, anim: 'karaoke', karaoke: true, upper: false } },
];


interface Props {
  profile: UserProfile | null;
  onClose: () => void;
  initialCopy?: string | null;
  initialProject?: ReelProject | null; // proyecto pre-armado (ej: "Animar" un diseño de campaña)
  onSaveCloud?: (a: { blob: Blob; thumbBlob: Blob | null; name: string; ext: string }) => Promise<{ url: string } | void>;
  campaignName?: string | null;
  userId?: string | null; // para que el reel guardado localmente sea POR usuario (no se mezcle entre cuentas)
}

// Mide la duración de un archivo de media.
function probeDuration(url: string, kind: 'video' | 'audio'): Promise<number> {
  return new Promise((res) => {
    const el = document.createElement(kind);
    el.preload = 'metadata'; el.src = url;
    el.onloadedmetadata = () => res(isFinite(el.duration) ? el.duration : 4);
    el.onerror = () => res(4);
    setTimeout(() => res(el.duration && isFinite(el.duration) ? el.duration : 4), 3000);
  });
}

const fmtTime = (s: number) => {
  if (!isFinite(s) || s < 0) s = 0;
  const m = Math.floor(s / 60), sec = Math.floor(s % 60), cs = Math.floor((s % 1) * 100);
  return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}:${String(cs).padStart(2, '0')}`;
};

type DragState =
  | { mode: 'move'; id: string; startX: number; origStart: number }
  | { mode: 'trimL'; id: string; startX: number; origStart: number; origTrimStart: number; origDur: number }
  | { mode: 'trimR'; id: string; startX: number; origDur: number; origTrimEnd: number }
  | { mode: 'playhead'; }
  | null;

const ReelStudioV2: React.FC<Props> = ({ profile, onClose, initialCopy, initialProject, onSaveCloud, campaignName, userId }) => {
  const kit = profile?.brandKits?.[0];
  // Clave de guardado local POR usuario: evita que el reel de una cuenta aparezca en otra en el mismo navegador.
  const V2_KEY = userId ? `reel_v2_${userId}` : 'reel_v2';
  const [project, setProject] = useState<ReelProject>(() => initialProject || createProject('9:16'));
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [pxPerSec, setPxPerSec] = useState(60);
  const [snap, setSnap] = useState(true);
  const [tab, setTab] = useState<'media' | 'texto' | 'marca' | 'stickers' | 'audio' | 'animacion' | 'ajustes'>('media');
  const [recording, setRecording] = useState(false);
  const [ttsText, setTtsText] = useState('');
  const [ttsVoice, setTtsVoice] = useState('Kore');
  const [ttsBusy, setTtsBusy] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportPct, setExportPct] = useState(0);
  const [exportedUrl, setExportedUrl] = useState<string | null>(null);
  const [savingCloud, setSavingCloud] = useState(false);
  const [cloudMsg, setCloudMsg] = useState('');
  // Mobile: layout apilado + hojas deslizables (panel/propiedades).
  const [mobileSheet, setMobileSheet] = useState<'none' | 'panel' | 'props'>('none');
  const [isMobile, setIsMobile] = useState<boolean>(() => typeof window !== 'undefined' && window.matchMedia('(max-width: 767px)').matches);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 767px)');
    const on = () => { setIsMobile(mq.matches); if (!mq.matches) setMobileSheet('none'); };
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  const [transcribing, setTranscribing] = useState(false);
  const [subMsg, setSubMsg] = useState('');
  const [autoTarget, setAutoTarget] = useState<'auto' | 15 | 30 | 60>('auto');
  const [autoBeat, setAutoBeat] = useState(false);
  const [autoTrim, setAutoTrim] = useState(false);
  const [compaginating, setCompaginating] = useState(false);
  const [autoMsg, setAutoMsg] = useState('');
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [clipThumbs, setClipThumbs] = useState<Record<string, string>>({}); // url → miniatura (dataURL) para los bloques de la timeline

  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Persistencia V2: mapa url→mediaId (prefijo v2_ para no chocar con la media del editor V1); gate de hidratación.
  const mediaIdRef = useRef<Map<string, string>>(new Map());
  const hydratedRef = useRef(false);
  const saveTimerRef = useRef<number | null>(null);
  const poolRef = useRef<MediaPool>(new MediaPool());
  const rafRef = useRef<number | null>(null);
  const previewRafRef = useRef<number | null>(null);  // RAF de la vista previa de efectos (hover)
  const clockRef = useRef<{ base: number } | null>(null);
  // Audio del preview: se reproduce la mezcla completa (buildMixedAudio) sincronizada al reloj.
  const audioCtxRef = useRef<AudioContext | null>(null);
  const mixBufRef = useRef<AudioBuffer | null>(null);
  const mixSrcRef = useRef<AudioBufferSourceNode | null>(null);
  const mixDirtyRef = useRef(true);
  const playingRef = useRef(false);
  const dragRef = useRef<DragState>(null);
  const canvasDragRef = useRef<{ id: string; startX: number; startY: number; origX: number; origY: number } | null>(null);
  const timelineRef = useRef<HTMLDivElement>(null);
  const fileVideoRef = useRef<HTMLInputElement>(null);
  const fileImageRef = useRef<HTMLInputElement>(null);
  const fileAudioRef = useRef<HTMLInputElement>(null);
  const fileLogoRef = useRef<HTMLInputElement>(null);
  const micRef = useRef<MediaRecorder | null>(null);
  const micChunksRef = useRef<Blob[]>([]);

  // Historial simple (undo/redo) sobre el proyecto.
  const histRef = useRef<{ past: ReelProject[]; future: ReelProject[] }>({ past: [], future: [] });
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const commit = useCallback((next: ReelProject | ((p: ReelProject) => ReelProject)) => {
    setProject(prev => {
      const resolved = typeof next === 'function' ? (next as (p: ReelProject) => ReelProject)(prev) : next;
      histRef.current.past.push(prev);
      if (histRef.current.past.length > 60) histRef.current.past.shift();
      histRef.current.future = [];
      setCanUndo(true); setCanRedo(false);
      return resolved;
    });
  }, []);
  const undo = () => {
    const h = histRef.current;
    if (!h.past.length) return;
    setProject(prev => { h.future.unshift(prev); const p = h.past.pop() as ReelProject; setCanUndo(h.past.length > 0); setCanRedo(true); return p; });
  };
  const redo = () => {
    const h = histRef.current;
    if (!h.future.length) return;
    setProject(prev => { h.past.push(prev); const n = h.future.shift() as ReelProject; setCanRedo(h.future.length > 0); setCanUndo(true); return n; });
  };

  const { w: CW, h: CH } = canvasSize(project);
  const totalDur = projectDuration(project);
  const selected = selectedId ? findElement(project, selectedId)?.el || null : null;

  // Ajusta el canvas al tamaño del proyecto.
  useEffect(() => {
    const c = canvasRef.current; if (!c) return;
    c.width = CW; c.height = CH;
    renderStatic(currentTime);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [CW, CH]);

  // Redibuja cuando cambia el proyecto o el tiempo (estático, sin reproducir).
  useEffect(() => {
    if (!playing) renderStatic(currentTime);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project, currentTime, playing]);

  // Limpia el pool y el audio al desmontar.
  useEffect(() => () => {
    poolRef.current.dispose();
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    if (previewRafRef.current) cancelAnimationFrame(previewRafRef.current);
    if (mixSrcRef.current) { try { mixSrcRef.current.stop(); } catch { /* noop */ } }
    if (audioCtxRef.current) { try { audioCtxRef.current.close(); } catch { /* noop */ } }
  }, []);

  // Dibuja un frame estático: hace seek de los videos activos y compone.
  async function renderStatic(t: number) {
    const c = canvasRef.current; if (!c) return;
    const ctx = c.getContext('2d'); if (!ctx) return;
    try { await seekVideosAt(poolRef.current, project, t); } catch { /* noop */ }
    drawReelFrame(ctx, project, t, poolRef.current);
  }

  // Marca la mezcla de audio como desactualizada ante cualquier cambio del proyecto (se reconstruye al reproducir).
  useEffect(() => { mixDirtyRef.current = true; }, [project]);

  // Carga las fuentes propias del perfil con la API FontFace (confiable para el canvas) y re-dibuja al estar listas.
  useEffect(() => {
    const fd: any = (document as any).fonts;
    if (!fd || typeof (window as any).FontFace !== 'function') return;
    let cancelled = false;
    (profile?.customFonts || []).forEach((f: CustomFont) => {
      if (!f.url || !f.family) return;
      try {
        if ([...fd].some((ff: any) => ff.family === f.family)) return; // ya cargada
        const face = new (window as any).FontFace(f.family, `url(${f.url})`);
        face.load().then((loaded: any) => { if (cancelled) return; fd.add(loaded); if (!playingRef.current) renderStatic(currentTime); }).catch(() => { /* noop */ });
      } catch { /* noop */ }
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile]);

  // El canvas dibuja texto con la fuente ya cargada: precarga las fuentes usadas y re-dibuja cuando están listas.
  useEffect(() => {
    const fonts = new Set<string>();
    for (const t of project.tracks) for (const el of t.elements) if (el.type === 'text') fonts.add((el as TextElement).style.font);
    const fd = (document as any).fonts;
    if (!fonts.size || !fd?.load) return;
    Promise.all([...fonts].map(f => fd.load(`700 48px "${f}"`).catch(() => {})))
      .then(() => { if (!playingRef.current) renderStatic(currentTime); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project]);

  // Genera una miniatura (un frame representativo) por cada video, para pintarla en los bloques de la timeline.
  useEffect(() => {
    const urls = new Set<string>();
    for (const t of project.tracks) for (const el of t.elements) if (el.type === 'video') urls.add((el as VideoElement).url);
    urls.forEach(url => {
      if (clipThumbs[url]) return;
      const v = document.createElement('video');
      v.src = url; v.muted = true; v.crossOrigin = 'anonymous'; v.preload = 'metadata'; v.playsInline = true;
      let done = false;
      const cleanup = () => { try { v.removeAttribute('src'); v.load(); } catch { /* noop */ } };
      const grab = () => {
        if (done) return; done = true;
        try {
          const c = document.createElement('canvas');
          const ar = (v.videoWidth || 9) / (v.videoHeight || 16);
          c.width = 80; c.height = Math.max(24, Math.round(80 / (ar || 0.5625)));
          const ctx = c.getContext('2d');
          if (ctx) { ctx.drawImage(v, 0, 0, c.width, c.height); const data = c.toDataURL('image/jpeg', 0.5); setClipThumbs(prev => (prev[url] ? prev : { ...prev, [url]: data })); }
        } catch { /* noop */ }
        cleanup();
      };
      v.onloadeddata = () => { try { v.currentTime = Math.min(0.1, (v.duration || 1) / 2); } catch { grab(); } };
      v.onseeked = grab;
      v.onerror = () => { done = true; cleanup(); };
      setTimeout(() => { if (!done && v.readyState >= 2) grab(); }, 2500);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project]);

  const stopAudio = () => {
    if (mixSrcRef.current) { try { mixSrcRef.current.stop(); } catch { /* noop */ } mixSrcRef.current = null; }
  };
  const startAudio = async (at: number) => {
    try {
      if (!audioCtxRef.current) audioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
      const ctx = audioCtxRef.current;
      if (ctx.state === 'suspended') { try { await ctx.resume(); } catch { /* noop */ } }
      if (mixDirtyRef.current || !mixBufRef.current) { mixBufRef.current = await buildMixedAudio(project); mixDirtyRef.current = false; }
      stopAudio();
      const buf = mixBufRef.current;
      if (!buf || !playingRef.current) return; // se pausó mientras se construía la mezcla
      const src = ctx.createBufferSource(); src.buffer = buf; src.connect(ctx.destination);
      src.start(0, Math.max(0, Math.min(at, buf.duration)));
      mixSrcRef.current = src;
    } catch (e) { console.warn('[preview] audio no disponible:', e); }
  };

  // Reproducción: reloj por rAF; reproduce/pausa los videos activos y compone cada frame.
  const play = () => {
    if (playing) return;
    const startAt = currentTime >= totalDur ? 0 : currentTime;
    if (currentTime >= totalDur) setCurrentTime(0);
    setPlaying(true);
    playingRef.current = true;
    clockRef.current = { base: performance.now() - startAt * 1000 };
    startAudio(startAt);
    const loop = () => {
      const c = canvasRef.current; if (!c) { setPlaying(false); return; }
      const ctx = c.getContext('2d'); if (!ctx) { setPlaying(false); return; }
      const t = (performance.now() - clockRef.current!.base) / 1000;
      if (t >= totalDur) { pause(); setCurrentTime(totalDur); renderStatic(totalDur); return; }
      // Sincroniza videos activos.
      for (const track of project.tracks) {
        for (const el of track.elements) {
          if (el.type !== 'video') continue;
          const v = poolRef.current.getVideo((el as VideoElement).url);
          const active = t >= el.start && t < el.start + el.duration;
          if (active) {
            const target = sourceTime(el as VideoElement, t);
            if (v.paused) { try { v.currentTime = target; } catch { /* noop */ } v.play().catch(() => {}); }
            else if (Math.abs(v.currentTime - target) > 0.35) { try { v.currentTime = target; } catch { /* noop */ } }
          } else if (!v.paused) { v.pause(); }
        }
      }
      drawReelFrame(ctx, project, t, poolRef.current);
      setCurrentTime(t);
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
  };
  const pause = () => {
    setPlaying(false);
    playingRef.current = false;
    stopAudio();
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    for (const track of project.tracks) for (const el of track.elements) if (el.type === 'video') { try { poolRef.current.getVideo((el as VideoElement).url).pause(); } catch { /* noop */ } }
  };
  const togglePlay = () => (playing ? pause() : play());

  // ---------- importar media ----------
  const firstTrackOfKind = (kind: Track['kind']) => project.tracks.find(t => t.kind === kind) || project.tracks[0];

  const onPickVideo = async (files: FileList | null) => {
    if (!files) return;
    let p = project;
    let cursor = totalDur;
    for (const f of Array.from(files)) {
      const url = URL.createObjectURL(f);
      const dur = await probeDuration(url, 'video');
      const track = p.tracks.find(t => t.kind === 'video')!;
      const el = makeVideoElement(url, dur, { start: cursor, name: f.name.replace(/\.[^.]+$/, '') });
      p = addElement(p, track.id, el);
      cursor += dur;
    }
    commit(p);
  };
  const onPickImage = async (files: FileList | null) => {
    if (!files) return;
    let p = project;
    for (const f of Array.from(files)) {
      const url = URL.createObjectURL(f);
      const overlay = p.tracks.find(t => t.kind === 'overlay')!;
      const el = makeImageElement(url, { start: currentTime, name: f.name.replace(/\.[^.]+$/, ''), transform: { x: 50, y: 50, scale: 45, rotation: 0, opacity: 100 } });
      p = addElement(p, overlay.id, el);
    }
    commit(p);
  };
  const onPickAudio = async (files: FileList | null) => {
    if (!files) return;
    let p = project;
    for (const f of Array.from(files)) {
      const url = URL.createObjectURL(f);
      const dur = await probeDuration(url, 'audio');
      const el = makeAudioElement(url, dur, { start: 0, name: f.name.replace(/\.[^.]+$/, ''), volume: 0.8 });
      p = addAudioElement(p, el); // pista de audio libre o una nueva → no se pisan
    }
    commit(p);
  };
  const addText = () => {
    const overlay = project.tracks.find(t => t.kind === 'overlay')!;
    const el = makeTextElement(initialCopy?.split('\n')[0]?.slice(0, 40) || 'Tu texto acá', { start: currentTime, duration: 3 });
    commit(addElement(project, overlay.id, el));
    setSelectedId(el.id);
    setTab('texto');
  };
  const addSticker = (emoji: string) => {
    const el = makeTextElement(emoji, {
      start: currentTime, duration: 3, name: 'Sticker',
      transform: { x: 50, y: 40, scale: 100, rotation: 0, opacity: 100 },
      style: { font: 'Inter', color: '#FFFFFF', size: 16, weight: 400, bg: null, stroke: false, align: 'center', karaoke: false, accent: '#FFE600' },
    });
    commit(addOverlayElement(project, el)); // capa de overlay propia (separada de los subtítulos)
    setSelectedId(el.id);
  };

  // ---------- marca ----------
  // Aplica el brand kit: tipografías y colores de marca a los textos + agrega el logo (movible).
  const applyBrand = () => {
    const hFont = kit?.headlineFont || 'Inter';
    const hColor = kit?.headlineColor || '#FFFFFF';
    let p = project;
    for (const t of p.tracks) for (const el of t.elements) {
      if (el.type === 'text' && el.name !== 'Sticker') {
        p = updateElement(p, el.id, { style: { ...(el as TextElement).style, font: hFont, color: hColor } } as any);
      }
    }
    const logo = kit?.logoUrls?.[0];
    const hasLogo = p.tracks.some(t => t.elements.some(e => e.name === 'Logo'));
    if (logo && !hasLogo) {
      const overlay = p.tracks.find(t => t.kind === 'overlay')!;
      const el = makeImageElement(logo, { name: 'Logo', start: 0, duration: Math.max(4, totalDur || 4), transform: { x: 82, y: 12, scale: 18, rotation: 0, opacity: 100 } });
      p = addElement(p, overlay.id, el);
      commit(p);
      setSelectedId(el.id); // queda seleccionado → se puede mover arrastrándolo en el preview
      return;
    }
    commit(p);
  };

  // ---------- logo (subir cualquier logo) ----------
  const addLogoImage = (url: string) => {
    const overlay = project.tracks.find(t => t.kind === 'overlay')!;
    const el = makeImageElement(url, { name: 'Logo', start: 0, duration: Math.max(4, totalDur || 4), transform: { x: 82, y: 12, scale: 18, rotation: 0, opacity: 100 } });
    commit(addElement(project, overlay.id, el));
    setSelectedId(el.id);
  };
  const addLogo = () => fileLogoRef.current?.click(); // siempre deja subir un logo propio

  // ---------- grabar voz en off (micrófono) ----------
  const startRec = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'].find(m => { try { return MediaRecorder.isTypeSupported(m); } catch { return false; } }) || '';
      const rec = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
      micChunksRef.current = [];
      rec.ondataavailable = (e) => { if (e.data.size > 0) micChunksRef.current.push(e.data); };
      rec.onstop = async () => {
        stream.getTracks().forEach(t => t.stop());
        const type = rec.mimeType || mime || 'audio/webm';
        const blob = new Blob(micChunksRef.current, { type });
        if (blob.size < 512) { alert('La grabación quedó vacía. Revisá el micrófono.'); return; }
        const url = URL.createObjectURL(blob);
        const dur = await probeDuration(url, 'audio');
        commit(addAudioElement(project, makeAudioElement(url, dur, { name: 'Voz en off', start: 0, volume: 1 })));
      };
      micRef.current = rec; rec.start(); setRecording(true);
    } catch { alert('No se pudo acceder al micrófono. Revisá los permisos del navegador.'); }
  };
  const stopRec = () => { micRef.current?.stop(); setRecording(false); };

  // ---------- narración con IA (Gemini TTS, server) ----------
  const generateNarration = async () => {
    const script = ttsText.trim();
    if (!script) { alert('Escribí el texto de la narración.'); return; }
    setTtsBusy(true);
    try {
      const res = await fetch('/api/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: script, voice: ttsVoice }),
      });
      let json: any = null;
      try { json = await res.json(); } catch { throw new Error('El servidor no respondió (¿falta el deploy con /api/tts?).'); }
      if (!res.ok || !json?.audioBase64) throw new Error(json?.error || 'No se pudo generar la narración.');
      // base64 WAV → Blob → objectURL (mismo flujo que la grabación de micrófono).
      const bin = atob(json.audioBase64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const blob = new Blob([bytes], { type: json.mime || 'audio/wav' });
      const url = URL.createObjectURL(blob);
      const dur = await probeDuration(url, 'audio');
      commit(addAudioElement(project, makeAudioElement(url, dur, { name: 'Narración', start: currentTime, volume: 1 })));
    } catch (e: any) {
      alert(e?.message || 'Error al generar la narración.');
    } finally {
      setTtsBusy(false);
    }
  };

  // Aplica el estilo (tipografía/tamaño/color/animación) Y la posición del texto seleccionado a TODOS los textos.
  const syncTextStyle = () => {
    if (!selected || selected.type !== 'text') return;
    const src = selected as TextElement;
    const style = src.style;
    let p = project;
    for (const t of p.tracks) for (const el of t.elements) {
      if (el.type === 'text' && el.id !== selected.id) {
        p = updateElement(p, el.id, { style: { ...style }, transform: { ...(el as TextElement).transform, x: src.transform.x, y: src.transform.y } } as any);
      }
    }
    commit(p);
  };

  // Subtítulos automáticos con Whisper: transcribe la voz y crea un elemento de texto por segmento.
  const generateSubtitles = async () => {
    // Preferimos la VOZ en off para transcribir (no la música). Heurística: nombre "voz/voice/off",
    // si no, el último audio agregado (la voz suele ir después de la música); si no hay audio, el video.
    const audios: AudioElement[] = [];
    for (const t of project.tracks) for (const el of t.elements) if (el.type === 'audio') audios.push(el as AudioElement);
    const voice = audios.find(a => /voz|voice|off|narrac/i.test(a.name)) || audios[audios.length - 1] || audios[0];
    let srcUrl: string | undefined = voice?.url;
    if (!srcUrl) { for (const t of project.tracks) for (const el of t.elements) if (el.type === 'video') { srcUrl = (el as VideoElement).url; break; } }
    if (!srcUrl) { alert('Agregá una voz en off, un audio o un video con voz para generar subtítulos.'); return; }
    setTranscribing(true); setSubMsg('');
    try {
      const segs = await transcribe(srcUrl, setSubMsg);
      if (!segs.length) { alert('No se detectó voz en el audio.'); return; }
      const overlay = project.tracks.find(t => t.kind === 'overlay')!;
      let p = project;
      for (const s of segs) {
        const el = makeTextElement(s.text, {
          start: s.start, duration: Math.max(0.4, s.end - s.start),
          name: 'Subtítulo',
          transform: { x: 50, y: 86, scale: 100, rotation: 0, opacity: 100 },
          style: { font: kit?.headlineFont || 'Inter', color: '#FFFFFF', size: 6, weight: 900, bg: null, stroke: true, align: 'center', karaoke: true, accent: '#FFE600' },
        });
        p = addElement(p, overlay.id, el);
      }
      commit(p);
    } catch (e: any) {
      console.error('[subtitulos v2]', e);
      alert('No se pudieron generar los subtítulos: ' + (e?.message || 'error'));
    } finally { setTranscribing(false); setSubMsg(''); }
  };

  // Compaginado automático: opcional recorte de silencios + beat-sync + duración objetivo.
  const runAutoCompaginate = async () => {
    const vtrack = project.tracks.find(t => t.kind === 'video');
    const clips = vtrack ? vtrack.elements.filter(e => e.type === 'video' || e.type === 'image') : [];
    if (!clips.length) { alert('Agregá al menos un video en la pista principal.'); return; }
    setCompaginating(true); setAutoMsg('');
    try {
      const boundsByEl: Record<string, [number, number]> = {};
      if (autoTrim) {
        setAutoMsg('Analizando silencios…');
        for (const c of clips) {
          const sd = (c as any).sourceDuration || c.duration;
          if (c.type === 'video') {
            const peaks = await computePeaks((c as VideoElement).url);
            boundsByEl[c.id] = silenceBounds(peaks, sd);
          } else { boundsByEl[c.id] = [0, sd]; }
        }
      }
      let beats: number[] = [];
      if (autoBeat) {
        setAutoMsg('Detectando beats…');
        const music = project.tracks.flatMap(t => t.elements).find(e => e.type === 'audio') as AudioElement | undefined;
        if (music) beats = await detectBeats(music.url);
        if (!beats.length) console.info('[auto] sin beats (o sin música)');
      }
      pause();
      commit(autoCompaginate(project, { target: autoTarget, beatSync: autoBeat, boundsByEl, beats }));
      setCurrentTime(0);
    } catch (e) { console.error('[auto]', e); alert('No se pudo compaginar automáticamente.'); }
    finally { setCompaginating(false); setAutoMsg(''); }
  };

  // ---------- edición de elementos ----------
  const patchSel = (patch: Partial<ReelElement>) => { if (selectedId) commit(updateElement(project, selectedId, patch)); };
  const patchTransform = (t: Partial<VideoElement['transform']>) => {
    if (!selected || !('transform' in selected)) return;
    patchSel({ transform: { ...(selected as any).transform, ...t } } as any);
  };
  const patchTextStyle = (s: Partial<TextElement['style']>) => {
    if (!selected || selected.type !== 'text') return;
    patchSel({ style: { ...(selected as TextElement).style, ...s } } as any);
  };
  const deleteSel = () => {
    if (!selectedId) return;
    const f = findElement(project, selectedId);
    let p = removeElement(project, selectedId);
    if (f && f.track.kind === 'video') p = closeVideoGaps(p); // borrar un clip base cierra el hueco (sin negro)
    commit(p);
    setSelectedId(null);
  };
  const closeGaps = () => commit(closeVideoGaps(project));
  // Aplica un efecto de ENTRADA (transición) al elemento seleccionado.
  const applyAnim = (kind: TransitionKind) => {
    if (!selectedId) return;
    commit(updateElement(project, selectedId, { transition: kind, transitionDur: kind === 'none' ? 0 : 0.5 } as any));
  };
  // Copia la animación del elemento seleccionado (entrada + énfasis) a TODOS los textos.
  const applyAnimAllTexts = () => {
    if (!selectedId) return;
    const src = findElement(project, selectedId)?.el as any;
    if (!src) return;
    const patch = { transition: src.transition || 'none', transitionDur: src.transitionDur || 0, emphasis: src.emphasis || 'none' };
    let p = project;
    for (const t of p.tracks) for (const el of t.elements) if (el.type === 'text') p = updateElement(p, el.id, patch as any);
    commit(p);
  };
  // Aplica un efecto de ÉNFASIS (continuo) al elemento seleccionado.
  const applyEmphasis = (kind: EmphasisKind) => {
    if (!selectedId) return;
    commit(updateElement(project, selectedId, { emphasis: kind } as any));
  };

  // Vista previa al pasar el mouse: anima el elemento seleccionado con el efecto en cuestión
  // SIN modificar el proyecto (se dibuja una copia temporal en un loop propio).
  const stopEffectPreview = () => {
    if (previewRafRef.current) { cancelAnimationFrame(previewRafRef.current); previewRafRef.current = null; }
    if (!playingRef.current) renderStatic(currentTime);
  };
  const startEffectPreview = (mode: 'entrada' | 'enfasis', kind: string) => {
    if (!selectedId || playingRef.current || kind === 'none') return;
    const found = findElement(project, selectedId);
    if (!found) return;
    const patch = mode === 'entrada' ? { transition: kind, transitionDur: 0.6 } : { emphasis: kind };
    const temp = updateElement(project, selectedId, patch as any);
    const el0 = found.el.start;
    // Ventana de animación: para "entrada" mostramos ~1.4s desde el inicio del clip; para "énfasis", 2s de loop.
    const win = mode === 'entrada' ? 1.4 : 2.0;
    if (previewRafRef.current) cancelAnimationFrame(previewRafRef.current);
    const base = performance.now();
    const c = canvasRef.current; if (!c) return;
    const ctx = c.getContext('2d'); if (!ctx) return;
    const loop = () => {
      const local = ((performance.now() - base) / 1000) % win;
      drawReelFrame(ctx, temp, el0 + local, poolRef.current);
      previewRafRef.current = requestAnimationFrame(loop);
    };
    previewRafRef.current = requestAnimationFrame(loop);
  };
  // Sube/baja la pista del elemento seleccionado en la timeline (reordena las capas).
  const moveSelTrack = (dir: -1 | 1) => {
    if (!selectedId) return;
    const f = findElement(project, selectedId); if (!f) return;
    commit(moveTrack(project, f.track.id, dir));
  };
  // Corta el elemento seleccionado (o el que esté bajo el cabezal) en el instante actual.
  const splitAtPlayhead = () => {
    let id = selectedId;
    if (!id) {
      for (const t of project.tracks) for (const el of t.elements) { if (currentTime > el.start + 0.05 && currentTime < el.start + el.duration - 0.05) { id = el.id; break; } }
    }
    if (!id) return;
    commit(splitElement(project, id, currentTime));
  };

  // ---------- drag en la timeline ----------
  const onBlockPointerDown = (e: React.PointerEvent, id: string, mode: 'move' | 'trimL' | 'trimR') => {
    e.stopPropagation();
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    setSelectedId(id);
    const found = findElement(project, id); if (!found) return;
    const el = found.el;
    if (mode === 'move') dragRef.current = { mode, id, startX: e.clientX, origStart: el.start };
    else if (mode === 'trimL') dragRef.current = { mode, id, startX: e.clientX, origStart: el.start, origTrimStart: (el as any).trimStart || 0, origDur: el.duration };
    else dragRef.current = { mode, id, startX: e.clientX, origDur: el.duration, origTrimEnd: (el as any).trimEnd || el.duration };
  };
  // Imanta un valor (s) a los bordes de otros elementos, al playhead y al 0 si está cerca (umbral en px).
  const snapValue = (p: ReelProject, excludeId: string, raw: number, elDuration: number): number => {
    if (!snap) return Math.max(0, raw);
    const thr = 9 / pxPerSec;
    const points = [0, currentTime];
    for (const t of p.tracks) for (const el of t.elements) { if (el.id === excludeId) continue; points.push(el.start, el.start + el.duration); }
    let best = raw, bestD = thr;
    for (const pt of points) {
      if (Math.abs(raw - pt) < bestD) { bestD = Math.abs(raw - pt); best = pt; }
      const trail = raw + elDuration;
      if (Math.abs(trail - pt) < bestD) { bestD = Math.abs(trail - pt); best = pt - elDuration; }
    }
    return Math.max(0, best);
  };
  const onTimelinePointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current; if (!d) return;
    if (d.mode === 'playhead') { scrubTo(e); return; }
    const dx = (e.clientX - d.startX) / pxPerSec;
    if (d.mode === 'move') {
      setProject(p => {
        const f = findElement(p, d.id); if (!f) return p;
        const raw = Math.max(0, d.origStart + dx);
        return moveElement(p, d.id, snapValue(p, d.id, raw, f.el.duration));
      });
    } else if (d.mode === 'trimL') {
      setProject(p => {
        const f = findElement(p, d.id); if (!f) return p;
        const maxShift = d.origDur - 0.2;
        const shift = Math.max(-d.origStart, Math.min(maxShift, dx));
        return updateElement(p, d.id, { start: d.origStart + shift, trimStart: Math.max(0, d.origTrimStart + shift), duration: d.origDur - shift });
      });
    } else if (d.mode === 'trimR') {
      setProject(p => {
        const dur = Math.max(0.2, d.origDur + dx);
        return updateElement(p, d.id, { duration: dur, trimEnd: d.origTrimEnd + (dur - d.origDur) });
      });
    }
  };
  const onTimelinePointerUp = () => {
    const d = dragRef.current;
    if (d && d.mode !== 'playhead') {
      setProject(p => {
        // Si moviste un clip de la pista de video, se reacomodan en orden y se cierran los huecos (reordenar arrastrando).
        const f = findElement(p, d.id);
        const np = (d.mode === 'move' && f && f.track.kind === 'video') ? closeVideoGaps(p) : p;
        histRef.current.past.push(p); if (histRef.current.past.length > 60) histRef.current.past.shift(); histRef.current.future = []; setCanUndo(true); setCanRedo(false);
        return np;
      });
    }
    dragRef.current = null;
  };
  const scrubTo = (e: React.PointerEvent | React.MouseEvent) => {
    const el = timelineRef.current; if (!el) return;
    const rect = el.getBoundingClientRect();
    const x = (e as any).clientX - rect.left + el.scrollLeft;
    const t = Math.max(0, Math.min(totalDur || 0, (x - TL_PAD) / pxPerSec));
    setCurrentTime(t);
  };

  // ---------- arrastrar el elemento seleccionado directo en el canvas (posición) ----------
  // Solo aplica a elementos que usan transform x/y: overlays (PiP) y textos. La pista base usa "cover".
  const canDragOnCanvas = (): boolean => {
    if (!selectedId) return false;
    const f = findElement(project, selectedId); if (!f) return false;
    const el = f.el;
    const usesXY = el.type === 'text' || ((el.type === 'image' || el.type === 'video') && f.track.kind !== 'video');
    const active = currentTime >= el.start && currentTime < el.start + el.duration;
    return usesXY && active;
  };
  const onCanvasPointerDown = (e: React.PointerEvent) => {
    if (!selectedId || !canDragOnCanvas()) return;
    const f = findElement(project, selectedId); if (!f) return;
    const tr = (f.el as any).transform;
    canvasDragRef.current = { id: selectedId, startX: e.clientX, startY: e.clientY, origX: tr.x, origY: tr.y };
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
  };
  const onCanvasPointerMove = (e: React.PointerEvent) => {
    const d = canvasDragRef.current; if (!d) return;
    const c = canvasRef.current; if (!c) return;
    const rect = c.getBoundingClientRect();
    const dxPct = ((e.clientX - d.startX) / rect.width) * 100;
    const dyPct = ((e.clientY - d.startY) / rect.height) * 100;
    setProject(p => {
      const f = findElement(p, d.id); if (!f) return p;
      const tr = (f.el as any).transform;
      return updateElement(p, d.id, { transform: { ...tr, x: Math.max(0, Math.min(100, d.origX + dxPct)), y: Math.max(0, Math.min(100, d.origY + dyPct)) } } as any);
    });
  };
  const onCanvasPointerUp = () => {
    if (canvasDragRef.current) {
      setProject(p => { histRef.current.past.push(p); if (histRef.current.past.length > 60) histRef.current.past.shift(); histRef.current.future = []; setCanUndo(true); setCanRedo(false); return p; });
    }
    canvasDragRef.current = null;
  };

  // Atajos de teclado.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || (t as any).isContentEditable) return;
      if (e.key === 'Escape') { setSelectedId(null); return; }
      if (e.key.toLowerCase() === 's' && !e.ctrlKey && !e.metaKey) { e.preventDefault(); splitAtPlayhead(); return; }
      if (e.code === 'Space') { e.preventDefault(); togglePlay(); }
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
      else if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey))) { e.preventDefault(); redo(); }
      else if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId) { e.preventDefault(); deleteSel(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, playing, project, totalDur]);

  // ---------- export ----------
  const buildExportBlob = async (): Promise<{ blob: Blob; ext: string }> => {
    const off = document.createElement('canvas');
    return exportProject(project, off, poolRef.current, (pct) => setExportPct(pct));
  };
  // Genera un póster (primer frame) reducido para usar de miniatura del reel guardado.
  const makePosterBlob = async (): Promise<Blob | null> => {
    try {
      const full = document.createElement('canvas'); full.width = CW; full.height = CH;
      const fctx = full.getContext('2d'); if (!fctx) return null;
      await seekVideosAt(poolRef.current, project, 0);
      drawReelFrame(fctx, project, 0, poolRef.current);
      const scale = 360 / CW;
      const small = document.createElement('canvas'); small.width = 360; small.height = Math.round(CH * scale);
      const sctx = small.getContext('2d'); if (!sctx) return null;
      sctx.drawImage(full, 0, 0, small.width, small.height);
      return await new Promise<Blob | null>(res => small.toBlob(b => res(b), 'image/jpeg', 0.7));
    } catch { return null; }
  };
  const runExport = async () => {
    if (totalDur <= 0) { alert('Agregá al menos un video o imagen.'); return; }
    pause();
    setExporting(true); setExportPct(0); setExportedUrl(null);
    try {
      const { blob, ext } = await buildExportBlob();
      const url = URL.createObjectURL(blob);
      setExportedUrl(url);
      const safeName = (project.name || '').trim().replace(/[^\p{L}\p{N}\s-]/gu, '').replace(/\s+/g, '-') || 'reel-gomall';
      const a = document.createElement('a'); a.href = url; a.download = `${safeName}.${ext}`; a.click();
    } catch (e: any) {
      console.error('[export v2]', e);
      alert('No se pudo exportar: ' + (e?.message || 'error'));
    } finally {
      setExporting(false);
      renderStatic(currentTime);
    }
  };
  // Guardar en la nube: exporta, arma el póster y delega la subida (Storage + Firestore) al contenedor.
  const saveCloud = async () => {
    if (!onSaveCloud) return;
    if (totalDur <= 0) { alert('Agregá al menos un video o imagen.'); return; }
    pause();
    setSavingCloud(true); setExportPct(0); setCloudMsg('Exportando…');
    try {
      const { blob, ext } = await buildExportBlob();
      setCloudMsg('Subiendo…');
      const thumbBlob = await makePosterBlob();
      await onSaveCloud({ blob, thumbBlob, name: project.name || 'Reel', ext });
      setCloudMsg('¡Guardado!');
      setTimeout(() => setCloudMsg(''), 3000);
    } catch (e: any) {
      console.error('[reel cloud v2]', e);
      alert('No se pudo guardar en la nube: ' + (e?.message || 'error'));
      setCloudMsg('');
    } finally {
      setSavingCloud(false);
      renderStatic(currentTime);
    }
  };

  // ---------- persistencia local (IndexedDB) ----------
  const persistV2 = async () => {
    if (projectDuration(project) <= 0) { try { await clearProjectAt(V2_KEY); } catch { /* noop */ } setSaveState('idle'); return; }
    try {
      const tracks: any[] = [];
      for (const track of project.tracks) {
        const els: any[] = [];
        for (const el of track.elements) {
          const anyEl = el as any;
          const url: string | undefined = anyEl.url;
          let mediaId: string | undefined = anyEl.mediaId;
          if (url) {
            mediaId = mediaIdRef.current.get(url);
            if (!mediaId) {
              try { const blob = await (await fetch(url)).blob(); mediaId = 'v2_' + newMediaId(); await putMedia(mediaId, blob); mediaIdRef.current.set(url, mediaId); }
              catch { mediaId = undefined; }
            }
          }
          els.push({ ...el, mediaId, url: url ? '' : undefined });
        }
        tracks.push({ ...track, elements: els });
      }
      await putProjectAt(V2_KEY, { ...project, tracks });
      setSaveState('saved');
    } catch (e) { console.warn('[reel v2] autosave falló', e); setSaveState('idle'); }
  };

  useEffect(() => {
    if (!hydratedRef.current) return;
    setSaveState('saving');
    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(() => persistV2(), 900);
    return () => { if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project]);

  useEffect(() => {
    // Si vino un proyecto pre-armado (ej: "Animar" un diseño), no restaurar el reel guardado.
    if (initialProject) { hydratedRef.current = true; return; }
    (async () => {
      try {
        const saved: any = await getProjectAt(V2_KEY);
        if (saved && Array.isArray(saved.tracks)) {
          const tracks: any[] = [];
          for (const track of saved.tracks) {
            const els: any[] = [];
            for (const el of track.elements || []) {
              if (el.mediaId) {
                const blob = await getMedia(el.mediaId);
                if (!blob) continue; // media faltante → se omite el elemento
                const url = URL.createObjectURL(blob);
                mediaIdRef.current.set(url, el.mediaId);
                els.push({ ...el, url });
              } else {
                els.push({ ...el });
              }
            }
            tracks.push({ ...track, elements: els });
          }
          if (tracks.some((t: any) => t.elements.length)) { setProject({ ...saved, tracks, aspect: saved.aspect || '9:16' }); setSaveState('saved'); }
        }
      } catch (e) { console.warn('[reel v2] no se pudo restaurar', e); }
      finally { hydratedRef.current = true; }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const newProjectV2 = async () => {
    if (totalDur > 0 && !confirm('¿Empezar un reel nuevo? Se borrará el reel guardado.')) return;
    try { await clearProjectAt(V2_KEY); } catch { /* noop */ }
    mediaIdRef.current.clear();
    histRef.current = { past: [], future: [] }; setCanUndo(false); setCanRedo(false);
    pause();
    setProject(createProject(project.aspect));
    setSelectedId(null); setCurrentTime(0); setSaveState('idle');
  };

  // ---------- UI ----------
  const RAIL: { id: typeof tab; icon: string; label: string }[] = [
    { id: 'media', icon: 'fa-photo-film', label: 'Media' },
    { id: 'texto', icon: 'fa-font', label: 'Texto' },
    { id: 'marca', icon: 'fa-crown', label: 'Marca' },
    { id: 'stickers', icon: 'fa-face-smile', label: 'Stickers' },
    { id: 'audio', icon: 'fa-music', label: 'Audio' },
    { id: 'animacion', icon: 'fa-wand-magic-sparkles', label: 'Animación' },
    { id: 'ajustes', icon: 'fa-sliders', label: 'Ajustes' },
  ];

  return (
    <div className="fixed inset-0 z-[200] bg-[#313137] text-[#f3eeec] flex flex-col" style={{ fontFamily: 'Inter, sans-serif' }}>
      {/* Top bar */}
      <header className="flex items-center gap-2 sm:gap-3 px-2 sm:px-4 h-14 border-b border-white/10 bg-[#3b3b42]">
        <div className="w-8 h-8 rounded-lg grid place-items-center text-white font-black shrink-0" style={{ background: `linear-gradient(140deg,${BRAND},#f0814f)` }}>G</div>
        <input value={project.name} onChange={(e) => setProject(p => ({ ...p, name: e.target.value }))} placeholder="Reel sin título"
          className="ml-1 sm:ml-3 text-sm bg-transparent text-white/70 outline-none border-b border-transparent focus:border-white/30 focus:text-white w-20 sm:w-48 placeholder:text-white/30" />
        <div className="flex-1" />
        {saveState !== 'idle' && (
          <span className="hidden sm:flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-white/40 mr-1">
            {saveState === 'saving' ? <><i className="fa-solid fa-circle-notch fa-spin" /> Guardando</> : <><i className="fa-solid fa-cloud text-emerald-400" /> Guardado</>}
          </span>
        )}
        <button onClick={newProjectV2} title="Nuevo reel" className="h-9 px-3 rounded-lg bg-white/10 text-white/70 text-xs font-bold hover:bg-white/20"><i className="fa-solid fa-file-circle-plus" /></button>
        <div className="flex items-center rounded-xl overflow-hidden border border-white/10">
          <button onClick={undo} disabled={!canUndo} title="Deshacer (Ctrl+Z)" className="w-9 h-9 grid place-items-center text-white/60 hover:bg-white/10 disabled:opacity-30"><i className="fa-solid fa-rotate-left" /></button>
          <button onClick={redo} disabled={!canRedo} title="Rehacer" className="w-9 h-9 grid place-items-center text-white/60 hover:bg-white/10 disabled:opacity-30"><i className="fa-solid fa-rotate-right" /></button>
        </div>
        <button onClick={runExport} disabled={exporting || savingCloud} className="h-9 px-3 sm:px-4 rounded-lg text-white text-xs font-bold flex items-center gap-2 disabled:opacity-60 shrink-0" style={{ background: `linear-gradient(135deg,${BRAND},#f0814f)` }}>
          {exporting ? <><i className="fa-solid fa-circle-notch fa-spin" /> {exportPct}%</> : <><i className="fa-solid fa-clapperboard" /> <span className="hidden sm:inline">Exportar</span></>}
        </button>
        <button onClick={onClose} className="h-9 px-3 rounded-lg bg-white/10 text-white/70 text-xs font-bold hover:bg-white/20 shrink-0"><i className="fa-solid fa-arrow-left" /></button>
      </header>

      {/* Cuerpo: rail | panel | preview | propiedades (desktop) — apilado con hojas (mobile) */}
      <div className={isMobile ? 'flex-1 flex min-h-0 relative' : 'flex-1 grid min-h-0'} style={isMobile ? undefined : { gridTemplateColumns: '56px 280px 1fr 300px' }}>
        {/* rail (solo desktop; en mobile es la barra inferior) */}
        <nav className={`bg-[#3b3b42] border-r border-white/10 flex-col items-center gap-1 py-3 ${isMobile ? 'hidden' : 'flex'}`}>
          {RAIL.map(r => (
            <button key={r.id} onClick={() => setTab(r.id)} title={r.label}
              className="w-10 h-10 rounded-xl grid place-items-center text-white/60 hover:bg-white/10"
              style={tab === r.id ? { background: `linear-gradient(140deg,${BRAND},#f0814f)`, color: '#fff' } : undefined}>
              <i className={`fa-solid ${r.icon}`} />
            </button>
          ))}
        </nav>

        {/* panel izquierdo (según tab) — hoja inferior en mobile */}
        <section className={isMobile
          ? `fixed inset-x-0 bottom-0 z-50 h-[62%] rounded-t-2xl border-t border-white/10 bg-[#3b3b42] flex flex-col shadow-2xl transition-transform duration-200 ${mobileSheet === 'panel' ? 'translate-y-0' : 'translate-y-full pointer-events-none'}`
          : 'bg-[#3b3b42] border-r border-white/10 flex flex-col min-h-0'}>
          <div className="px-4 py-3 text-sm font-bold border-b border-white/5 flex items-center justify-between">
            {RAIL.find(r => r.id === tab)?.label}
            {isMobile && <button onClick={() => setMobileSheet('none')} className="text-white/50 hover:text-white"><i className="fa-solid fa-xmark" /></button>}
          </div>
          <div className="p-4 overflow-y-auto text-sm space-y-3 flex-1 min-h-0">
            {tab === 'media' && (<>
              <button onClick={() => fileVideoRef.current?.click()} className="w-full py-3 rounded-xl border border-dashed border-white/20 hover:border-[color:var(--b)] text-white/70 text-xs font-semibold" style={{ ['--b' as any]: BRAND }}><i className="fa-solid fa-video mr-2" />Subir video</button>
              <button onClick={() => fileImageRef.current?.click()} className="w-full py-3 rounded-xl border border-dashed border-white/20 hover:border-[color:var(--b)] text-white/70 text-xs font-semibold" style={{ ['--b' as any]: BRAND }}><i className="fa-solid fa-image mr-2" />Subir imagen</button>
              <button onClick={addLogo} className="w-full py-3 rounded-xl border border-white/15 text-white/80 text-xs font-semibold hover:bg-white/5"><i className="fa-solid fa-stamp mr-2" />Subir logo</button>
              <p className="text-[11px] text-white/40 leading-relaxed">Los videos van en fila en la pista principal; imágenes y logo como overlay que reposicionás arrastrando en el preview.</p>
            </>)}
            {tab === 'texto' && (<>
              <button onClick={addText} className="w-full py-3 rounded-xl text-white text-xs font-bold" style={{ background: `linear-gradient(135deg,${BRAND},#f0814f)` }}><i className="fa-solid fa-plus mr-2" />Agregar texto</button>
              <button onClick={generateSubtitles} disabled={transcribing} className="w-full py-3 rounded-xl border border-white/15 text-white/80 text-xs font-bold hover:bg-white/5 disabled:opacity-50">
                {transcribing ? <><i className="fa-solid fa-circle-notch fa-spin mr-2" />{subMsg || 'Transcribiendo…'}</> : <><i className="fa-solid fa-wand-magic-sparkles mr-2" />Subtítulos automáticos (IA)</>}
              </button>
              <p className="text-[11px] text-white/40 leading-relaxed">"Agregar texto" crea un texto en el cabezal. "Subtítulos automáticos" transcribe la voz del audio/video y crea un texto por frase (la 1ª vez baja el modelo).</p>
            </>)}
            {tab === 'marca' && (
              <div className="space-y-3">
                <button onClick={applyBrand} className="w-full py-3 rounded-xl text-white text-xs font-bold" style={{ background: `linear-gradient(135deg,${BRAND},#f0814f)` }}>
                  <i className="fa-solid fa-wand-magic-sparkles mr-2" />Aplicar mi marca
                </button>
                <p className="text-[11px] text-white/40 leading-relaxed">Aplica tus tipografías y colores de marca a los textos y agrega tu logo. El logo lo movés arrastrándolo en el preview (y lo escalás/rotás con las manijas).</p>

                <div className="pt-2 border-t border-white/5">
                  <div className="text-[10px] font-bold uppercase tracking-widest text-white/40 mb-1.5">Logos</div>
                  {kit?.logoUrls?.length ? (
                    <div className="grid grid-cols-3 gap-2">
                      {kit.logoUrls.map((u, i) => (
                        <button key={i} onClick={() => addLogoImage(u)} title="Agregar este logo" className="aspect-square rounded-lg bg-white/10 hover:bg-white/20 p-1.5 grid place-items-center">
                          <img src={u} alt="" className="max-w-full max-h-full object-contain" />
                        </button>
                      ))}
                    </div>
                  ) : <p className="text-[11px] text-white/40">Tu marca no tiene logos cargados.</p>}
                  <button onClick={addLogo} className="w-full mt-2 py-2.5 rounded-xl border border-white/15 text-white/80 text-xs font-semibold hover:bg-white/5"><i className="fa-solid fa-upload mr-2" />Subir otro logo</button>
                </div>

                {kit && (kit.headlineFont || kit.descriptionFont) && (
                  <div className="pt-2 border-t border-white/5">
                    <div className="text-[10px] font-bold uppercase tracking-widest text-white/40 mb-1.5">Tipografías</div>
                    <div className="text-[11px] text-white/60 space-y-0.5">
                      {kit.headlineFont && <div>Título: <b className="text-white" style={{ fontFamily: kit.headlineFont }}>{kit.headlineFont}</b></div>}
                      {kit.descriptionFont && <div>Texto: <b className="text-white" style={{ fontFamily: kit.descriptionFont }}>{kit.descriptionFont}</b></div>}
                    </div>
                  </div>
                )}

                {kit?.brandColors?.length ? (
                  <div className="pt-2 border-t border-white/5">
                    <div className="text-[10px] font-bold uppercase tracking-widest text-white/40 mb-1.5">Colores</div>
                    <div className="flex gap-1.5 flex-wrap">
                      {kit.brandColors.map((c, i) => <span key={i} className="w-6 h-6 rounded-md border border-white/15" style={{ background: c }} title={c} />)}
                    </div>
                  </div>
                ) : null}

                {!kit && <p className="text-[11px] text-amber-300/80 leading-relaxed"><i className="fa-solid fa-triangle-exclamation mr-1" />No tenés un brand kit configurado: cargá tu marca (logo, tipografías, colores) desde Ajustes de marca para aprovechar esta sección.</p>}
              </div>
            )}
            {tab === 'stickers' && (
              <div className="space-y-3">
                <div className="grid grid-cols-5 gap-2">
                  {STICKERS.map((s, i) => (
                    <button key={s + i} onClick={() => addSticker(s)} className="aspect-square rounded-lg bg-white/5 hover:bg-white/15 text-2xl grid place-items-center">{s}</button>
                  ))}
                </div>
                <p className="text-[11px] text-white/40 leading-relaxed">El sticker se agrega en el cabezal, en su propia capa. Seleccionalo en la timeline y arrastrá sus bordes para <b className="text-white/70">alargarlo o achicarlo</b>; movelo en el preview para reposicionarlo.</p>
              </div>
            )}
            {tab === 'audio' && (<>
              <button onClick={() => fileAudioRef.current?.click()} className="w-full py-3 rounded-xl border border-dashed border-white/20 hover:border-[color:var(--b)] text-white/70 text-xs font-semibold" style={{ ['--b' as any]: BRAND }}><i className="fa-solid fa-music mr-2" />Subir música / audio</button>
              <button onClick={recording ? stopRec : startRec} className="w-full py-3 rounded-xl text-white text-xs font-bold" style={{ background: recording ? '#dc2626' : `linear-gradient(135deg,${BRAND},#f0814f)` }}>
                {recording ? <><i className="fa-solid fa-stop mr-2" />Detener grabación</> : <><i className="fa-solid fa-microphone mr-2" />Grabar voz en off</>}
              </button>
              <p className="text-[11px] text-white/40 leading-relaxed">La música/voz se agrega en la pista de audio. La grabación pide permiso del micrófono.</p>

              {/* Narración con IA (Gemini TTS) */}
              <div className="pt-3 mt-1 border-t border-white/10 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="text-[10px] font-bold uppercase tracking-widest text-white/40"><i className="fa-solid fa-wand-magic-sparkles mr-1" />Narración con IA</div>
                  <button
                    onClick={() => {
                      const txt = project.tracks.flatMap(t => t.elements).filter(e => e.type === 'text').map(e => (e as TextElement).text).join('. ').trim();
                      if (txt) setTtsText(txt);
                    }}
                    className="text-[10px] text-white/50 hover:text-white underline underline-offset-2">Usar textos del reel</button>
                </div>
                <textarea value={ttsText} onChange={(e) => setTtsText(e.target.value)} rows={3} placeholder="Escribí el guion de la voz…"
                  className="w-full bg-white/5 border border-white/10 rounded-lg p-2 text-sm text-white outline-none focus:border-white/30 resize-none" />
                <select value={ttsVoice} onChange={(e) => setTtsVoice(e.target.value)} className="w-full bg-white/5 border border-white/10 rounded-lg p-2 text-sm text-white outline-none focus:border-white/30">
                  <option value="Kore">Kore — femenina, neutra</option>
                  <option value="Aoede">Aoede — femenina, cálida</option>
                  <option value="Leda">Leda — femenina, juvenil</option>
                  <option value="Puck">Puck — masculina, enérgica</option>
                  <option value="Charon">Charon — masculina, grave</option>
                  <option value="Fenrir">Fenrir — masculina, intensa</option>
                </select>
                <button onClick={generateNarration} disabled={ttsBusy} className="w-full py-3 rounded-xl text-white text-xs font-bold disabled:opacity-50" style={{ background: `linear-gradient(135deg,${BRAND},#f0814f)` }}>
                  {ttsBusy ? <><i className="fa-solid fa-spinner fa-spin mr-2" />Generando…</> : <><i className="fa-solid fa-microphone-lines mr-2" />Generar narración</>}
                </button>
                <p className="text-[11px] text-white/40 leading-relaxed">Se agrega como pista de audio en la posición del cursor. Usa tu misma clave de Gemini (consume tokens del plan).</p>
              </div>
            </>)}
            {tab === 'animacion' && (
              <div className="space-y-4">
                {!selected
                  ? <p className="text-[11px] text-amber-300/80"><i className="fa-solid fa-hand-pointer mr-1" />Tocá un elemento en la timeline para animarlo.</p>
                  : <p className="text-[11px] text-white/40 leading-relaxed">Aplicá efectos al elemento seleccionado.</p>}

                <div>
                  <div className="text-[10px] font-bold uppercase tracking-widest text-white/40 mb-1.5">Entrada</div>
                  <div className="grid grid-cols-2 gap-2">
                    {([
                      { id: 'fade', label: 'Aparecer', icon: 'fa-circle-half-stroke' },
                      { id: 'slideup', label: 'Subir', icon: 'fa-arrow-up' },
                      { id: 'slidedown', label: 'Bajar', icon: 'fa-arrow-down' },
                      { id: 'slide', label: 'Deslizar', icon: 'fa-arrow-left' },
                      { id: 'zoom', label: 'Zoom', icon: 'fa-magnifying-glass-plus' },
                      { id: 'blur', label: 'Desenfoque', icon: 'fa-droplet' },
                      { id: 'white', label: 'Flash', icon: 'fa-bolt' },
                      { id: 'pop', label: 'Estallido', icon: 'fa-burst' },
                      { id: 'flip', label: 'Voltear', icon: 'fa-clone' },
                      { id: 'spin', label: 'Girar', icon: 'fa-arrows-spin' },
                      { id: 'bounce', label: 'Rebote', icon: 'fa-angles-down' },
                      { id: 'none', label: 'Ninguna', icon: 'fa-ban' },
                    ] as { id: TransitionKind; label: string; icon: string }[]).map(a => {
                      const active = !!selected && ((selected as any).transition || 'none') === a.id;
                      return (
                        <button key={a.id} disabled={!selected} onClick={() => applyAnim(a.id)}
                          onMouseEnter={() => startEffectPreview('entrada', a.id)} onMouseLeave={stopEffectPreview}
                          className="py-2.5 rounded-xl border text-[11px] font-semibold flex flex-col items-center gap-1 disabled:opacity-40"
                          style={active ? { borderColor: BRAND, color: BRAND } : { borderColor: 'rgba(255,255,255,.12)', color: 'rgba(255,255,255,.7)' }}>
                          <i className={`fa-solid ${a.icon}`} /> {a.label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div>
                  <div className="text-[10px] font-bold uppercase tracking-widest text-white/40 mb-1.5">Énfasis (continuo)</div>
                  <div className="grid grid-cols-2 gap-2">
                    {([
                      { id: 'pulse', label: 'Pulso', icon: 'fa-heart' },
                      { id: 'breathe', label: 'Latido', icon: 'fa-expand' },
                      { id: 'wiggle', label: 'Vaivén', icon: 'fa-arrows-left-right' },
                      { id: 'float', label: 'Flotar', icon: 'fa-arrows-up-down' },
                      { id: 'shake', label: 'Sacudir', icon: 'fa-wave-square' },
                      { id: 'tada', label: 'Tada', icon: 'fa-star' },
                      { id: 'blink', label: 'Parpadeo', icon: 'fa-eye' },
                      { id: 'swing', label: 'Balanceo', icon: 'fa-life-ring' },
                      { id: 'jump', label: 'Saltar', icon: 'fa-angle-up' },
                      { id: 'none', label: 'Ninguno', icon: 'fa-ban' },
                    ] as { id: EmphasisKind; label: string; icon: string }[]).map(a => {
                      const active = !!selected && ((selected as any).emphasis || 'none') === a.id;
                      return (
                        <button key={a.id} disabled={!selected} onClick={() => applyEmphasis(a.id)}
                          onMouseEnter={() => startEffectPreview('enfasis', a.id)} onMouseLeave={stopEffectPreview}
                          className="py-2.5 rounded-xl border text-[11px] font-semibold flex flex-col items-center gap-1 disabled:opacity-40"
                          style={active ? { borderColor: BRAND, color: BRAND } : { borderColor: 'rgba(255,255,255,.12)', color: 'rgba(255,255,255,.7)' }}>
                          <i className={`fa-solid ${a.icon}`} /> {a.label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {selected && selected.type === 'image' && findElement(project, selected.id)?.track.kind === 'video' && (
                  <label className="flex items-center gap-2 text-xs text-white/70 pt-1"><input type="checkbox" checked={!!(selected as any).kenBurns} onChange={(e) => patchSel({ kenBurns: e.target.checked } as any)} /> Zoom lento en la imagen (Ken Burns)</label>
                )}
                {selected && selected.type === 'text' && (
                  <button onClick={applyAnimAllTexts} className="w-full py-2.5 rounded-xl text-white text-xs font-bold" style={{ background: `linear-gradient(135deg,${BRAND},#f0814f)` }}>
                    <i className="fa-solid fa-wand-sparkles mr-2" />Aplicar estos efectos a TODOS los textos
                  </button>
                )}
              </div>
            )}
            {tab === 'ajustes' && (<>
              <label className="text-[11px] text-white/50 font-semibold block mb-1.5"><i className="fa-solid fa-mobile-screen mr-1" /> Formato del reel</label>
              <div className="grid grid-cols-3 gap-2 mb-2">
                {([['9:16', 'Reel / Story'], ['4:5', 'Feed'], ['1:1', 'Cuadrado']] as [AspectId, string][]).map(([a, lbl]) => (
                  <button key={a} onClick={() => commit({ ...project, aspect: a })} className="py-2 rounded-lg text-xs font-semibold border flex flex-col items-center gap-0.5"
                    style={project.aspect === a ? { borderColor: BRAND, color: BRAND } : { borderColor: 'rgba(255,255,255,.12)', color: 'rgba(255,255,255,.6)' }}>
                    <span className="font-bold">{a}</span><span className="text-[9px] opacity-70">{lbl}</span>
                  </button>
                ))}
              </div>

              <div className="pt-4 mt-2 border-t border-white/5 space-y-3">
                <div className="text-[10px] font-bold uppercase tracking-widest text-white/40">Auto-compaginado</div>
                <label className="text-[11px] text-white/50 font-semibold block">Duración objetivo</label>
                <div className="grid grid-cols-4 gap-2">
                  {([['auto', 'Auto'], [15, '15s'], [30, '30s'], [60, '60s']] as [ 'auto' | 15 | 30 | 60, string ][]).map(([val, lbl]) => (
                    <button key={String(val)} onClick={() => setAutoTarget(val)} className="py-1.5 rounded-lg text-xs font-semibold border"
                      style={autoTarget === val ? { borderColor: BRAND, color: BRAND } : { borderColor: 'rgba(255,255,255,.12)', color: 'rgba(255,255,255,.6)' }}>{lbl}</button>
                  ))}
                </div>
                <label className="flex items-center gap-2 text-xs text-white/70"><input type="checkbox" checked={autoTrim} onChange={(e) => setAutoTrim(e.target.checked)} /> Recortar silencios (inicio/fin)</label>
                <label className="flex items-center gap-2 text-xs text-white/70"><input type="checkbox" checked={autoBeat} onChange={(e) => setAutoBeat(e.target.checked)} /> Cortar al ritmo de la música (beat-sync)</label>
                <button onClick={runAutoCompaginate} disabled={compaginating} className="w-full py-2.5 rounded-xl text-white text-xs font-bold disabled:opacity-50" style={{ background: `linear-gradient(135deg,${BRAND},#f0814f)` }}>
                  {compaginating ? <><i className="fa-solid fa-circle-notch fa-spin mr-2" />{autoMsg || 'Compaginando…'}</> : <><i className="fa-solid fa-wand-magic-sparkles mr-2" />Compaginar automático</>}
                </button>
                <p className="text-[11px] text-white/40 leading-relaxed">Re-corta los clips de la pista principal en orden para llegar a la duración elegida.</p>
              </div>
            </>)}
          </div>
        </section>

        {/* preview */}
        <section className="bg-[#2a2a30] flex flex-col min-h-0 flex-1">
          <div className="flex-1 flex items-center justify-center p-5 min-h-0 overflow-hidden">
            {/* Flexbox: el alto del canvas = alto disponible; el ancho sale del aspecto 9:16 → siempre vertical. */}
            <div className="relative" style={{ height: '100%', aspectRatio: `${CW} / ${CH}`, maxWidth: '100%' }}>
              <canvas ref={canvasRef}
                onPointerDown={onCanvasPointerDown} onPointerMove={onCanvasPointerMove} onPointerUp={onCanvasPointerUp} onPointerLeave={onCanvasPointerUp}
                className="rounded-xl shadow-2xl block w-full h-full"
                style={{ background: '#000', cursor: canDragOnCanvas() ? 'move' : 'default', touchAction: 'none' }} />
              {/* Handles para escalar/rotar el sticker seleccionado directo en el preview */}
              {selected && selected.type === 'text' && (selected as TextElement).name === 'Sticker' && currentTime >= selected.start && currentTime < selected.start + selected.duration && (
                <div className="absolute inset-0" style={{ pointerEvents: 'none' }}>
                  <StickerHandles el={selected as TextElement} onStyle={patchTextStyle} onTransform={patchTransform} />
                </div>
              )}
            </div>
          </div>
          <div className="flex items-center gap-3 px-5 py-3 border-t border-white/10">
            <span className="text-xs tabular-nums text-white/60"><b style={{ color: BRAND }}>{fmtTime(currentTime)}</b> / {fmtTime(totalDur)}</span>
            <div className="flex-1" />
            <button onClick={togglePlay} className="w-10 h-10 rounded-full grid place-items-center text-white" style={{ background: `linear-gradient(135deg,${BRAND},#f0814f)` }}>
              <i className={`fa-solid ${playing ? 'fa-pause' : 'fa-play'}`} />
            </button>
            <div className="flex-1" />
            {isMobile && selected && <button onClick={() => setMobileSheet('props')} className="h-8 px-3 rounded-lg bg-white/10 text-white/80 text-[11px] font-bold"><i className="fa-solid fa-sliders mr-1" />Editar</button>}
            <div className="flex items-center gap-1">
              {(['9:16', '4:5', '1:1'] as AspectId[]).map(a => (
                <button key={a} onClick={() => commit({ ...project, aspect: a })} title={`Formato ${a}`}
                  className="text-[11px] font-bold px-2 py-1 rounded border transition-colors"
                  style={project.aspect === a ? { color: '#fff', background: BRAND, borderColor: BRAND } : { color: 'rgba(255,255,255,.5)', borderColor: 'rgba(255,255,255,.15)' }}>{a}</button>
              ))}
            </div>
          </div>
        </section>

        {/* propiedades — hoja inferior en mobile */}
        <aside className={isMobile
          ? `fixed inset-x-0 bottom-0 z-50 h-[68%] rounded-t-2xl border-t border-white/10 bg-[#3b3b42] flex flex-col shadow-2xl transition-transform duration-200 ${mobileSheet === 'props' ? 'translate-y-0' : 'translate-y-full pointer-events-none'}`
          : 'bg-[#3b3b42] border-l border-white/10 flex flex-col min-h-0'}>
          <div className="px-4 py-3 text-sm font-bold border-b border-white/5 flex items-center justify-between">
            <span>Propiedades</span>
            <div className="flex items-center gap-3">
              {selected && <button onClick={deleteSel} className="text-red-400 hover:text-red-300 text-xs"><i className="fa-solid fa-trash" /></button>}
              {isMobile && <button onClick={() => setMobileSheet('none')} className="text-white/50 hover:text-white"><i className="fa-solid fa-xmark" /></button>}
            </div>
          </div>
          <div className="p-4 overflow-y-auto text-sm space-y-4 flex-1 min-h-0">
            {!selected && <p className="text-white/40 text-xs">Seleccioná un elemento en la timeline para editar sus propiedades.</p>}

            {selected && selected.type === 'text' && ((selected as TextElement).name === 'Sticker' ? (
              <StickerProps el={selected as TextElement} onStyle={patchTextStyle} onTransform={patchTransform} />
            ) : (
              <TextProps el={selected as TextElement} onText={(text) => patchSel({ text } as any)} onStyle={patchTextStyle} onTransform={patchTransform} onSyncAll={syncTextStyle} customFonts={profile?.customFonts} />
            ))}
            {selected && (selected.type === 'video' || selected.type === 'image') && (
              <VisualProps el={selected as VideoElement | ImageElement} isBase={findElement(project, selected.id)?.track.kind === 'video'} onTransform={patchTransform} onVolume={(v) => patchSel({ volume: v } as any)} onFit={(f) => patchSel({ fit: f } as any)} onAudioFade={(p) => patchSel(p as any)} onKenBurns={(v) => patchSel({ kenBurns: v } as any)} />
            )}
            {selected && selected.type === 'audio' && (
              <AudioProps el={selected as AudioElement} onVolume={(v) => patchSel({ volume: v } as any)} onLoop={(l) => patchSel({ loop: l } as any)} onAudioFade={(p) => patchSel(p as any)} />
            )}
            {selected && selected.type !== 'audio' && (
              <div className="space-y-3 pt-2 border-t border-white/5">
                <div className="text-[10px] font-bold uppercase tracking-widest text-white/40">Transición</div>
                <Row label="Transición de entrada">
                  <select value={(selected as any).transition || 'none'} onChange={(e) => patchSel({ transition: e.target.value as TransitionKind, transitionDur: (selected as any).transitionDur || 0.5 } as any)} className="w-full bg-white/5 border border-white/10 rounded-lg p-2 text-sm text-white outline-none focus:border-white/30">
                    <option value="none">Ninguna</option>
                    <option value="fade">Fundido (negro)</option>
                    <option value="white">Flash blanco</option>
                    <option value="zoom">Zoom</option>
                    <option value="slide">Deslizar ◀</option>
                    <option value="slideup">Deslizar ▲</option>
                    <option value="slidedown">Deslizar ▼</option>
                    <option value="blur">Desenfoque</option>
                    <option value="pop">Estallido</option>
                    <option value="flip">Voltear</option>
                    <option value="spin">Girar</option>
                    <option value="bounce">Rebote</option>
                  </select>
                </Row>
                {(selected as any).transition && (selected as any).transition !== 'none' && (
                  <Row label={`Duración entrada: ${((selected as any).transitionDur || 0.5).toFixed(1)}s`}><Slider min={0.1} max={2} step={0.1} value={(selected as any).transitionDur || 0.5} onChange={(v) => patchSel({ transitionDur: v } as any)} /></Row>
                )}
                <Row label="Transición de salida">
                  <select value={(selected as any).transitionOut || 'none'} onChange={(e) => patchSel({ transitionOut: e.target.value as TransitionKind, transitionOutDur: (selected as any).transitionOutDur || 0.5 } as any)} className="w-full bg-white/5 border border-white/10 rounded-lg p-2 text-sm text-white outline-none focus:border-white/30">
                    <option value="none">Ninguna</option>
                    <option value="fade">Fundido (negro)</option>
                    <option value="white">Flash blanco</option>
                    <option value="zoom">Zoom</option>
                    <option value="slide">Deslizar ◀</option>
                    <option value="slideup">Deslizar ▲</option>
                    <option value="slidedown">Deslizar ▼</option>
                    <option value="blur">Desenfoque</option>
                    <option value="pop">Estallido</option>
                    <option value="flip">Voltear</option>
                    <option value="spin">Girar</option>
                    <option value="bounce">Rebote</option>
                  </select>
                </Row>
                {(selected as any).transitionOut && (selected as any).transitionOut !== 'none' && (
                  <Row label={`Duración salida: ${((selected as any).transitionOutDur || 0.5).toFixed(1)}s`}><Slider min={0.1} max={2} step={0.1} value={(selected as any).transitionOutDur || 0.5} onChange={(v) => patchSel({ transitionOutDur: v } as any)} /></Row>
                )}
              </div>
            )}
          </div>
        </aside>
      </div>

      {/* Timeline */}
      <div className={`${isMobile ? 'h-[150px]' : 'h-[240px]'} bg-[#3b3b42] border-t border-white/10 flex flex-col min-h-0`}>
        <div className="flex items-center gap-2 px-4 py-2 border-b border-white/10">
          <button onClick={splitAtPlayhead} className="w-8 h-8 grid place-items-center rounded-lg text-white/60 hover:bg-white/10" title="Cortar en el cabezal (S)"><i className="fa-solid fa-scissors text-xs" /></button>
          <button onClick={deleteSel} disabled={!selected} className="w-8 h-8 grid place-items-center rounded-lg text-white/60 hover:bg-white/10 disabled:opacity-30" title="Eliminar"><i className="fa-solid fa-trash text-xs" /></button>
          <button onClick={closeGaps} title="Cerrar huecos de la pista de video (evita el negro)" className="w-8 h-8 grid place-items-center rounded-lg text-white/60 hover:bg-white/10"><i className="fa-solid fa-arrows-left-right-to-line text-xs" /></button>
          <button onClick={() => setSnap(s => !s)} title="Imán (snapping)" className="w-8 h-8 grid place-items-center rounded-lg text-xs"
            style={snap ? { background: `linear-gradient(135deg,${BRAND},#f0814f)`, color: '#fff' } : { color: 'rgba(255,255,255,.5)' }}><i className="fa-solid fa-magnet" /></button>
          <div className="w-px h-5 bg-white/10 mx-1" />
          <button onClick={() => moveSelTrack(-1)} disabled={!selected} className="w-8 h-8 grid place-items-center rounded-lg text-white/60 hover:bg-white/10 disabled:opacity-30" title="Subir la pista del elemento seleccionado"><i className="fa-solid fa-arrow-up text-xs" /></button>
          <button onClick={() => moveSelTrack(1)} disabled={!selected} className="w-8 h-8 grid place-items-center rounded-lg text-white/60 hover:bg-white/10 disabled:opacity-30" title="Bajar la pista del elemento seleccionado"><i className="fa-solid fa-arrow-down text-xs" /></button>
          <div className="flex-1" />
          <span className="text-xs text-white/40 hidden sm:inline">Zoom</span>
          <input type="range" min={20} max={160} value={pxPerSec} onChange={(e) => setPxPerSec(Number(e.target.value))} className="w-16 sm:w-28 accent-[color:var(--b)]" style={{ ['--b' as any]: BRAND }} />
        </div>
        <div ref={timelineRef} className="flex-1 overflow-auto relative"
          onPointerMove={onTimelinePointerMove} onPointerUp={onTimelinePointerUp} onPointerLeave={onTimelinePointerUp}>
          <div style={{ width: Math.max(600, (totalDur + 4) * pxPerSec + TL_PAD), minWidth: '100%' }} className="cursor-pointer"
            onPointerDown={(e) => { if (playing) pause(); dragRef.current = { mode: 'playhead' }; scrubTo(e); }}>
            {/* Regla (clic/arrastre en cualquier lado mueve el cabezal) */}
            <div className="h-8 relative border-b border-white/10">
              {Array.from({ length: Math.ceil((totalDur + 4)) + 1 }).map((_, s) => (
                <div key={s} className="absolute top-0 bottom-0 border-l border-white/10" style={{ left: s * pxPerSec + TL_PAD }}>
                  <span className="absolute top-1.5 left-1 text-[9px] text-white/40 tabular-nums">{s}s</span>
                </div>
              ))}
            </div>
            {/* Pistas (solo las que tienen algo — sin filas vacías) */}
            {project.tracks.filter(track => track.elements.length > 0).map(track => (
              <div key={track.id} className="h-14 relative border-b border-white/5">
                <div className="absolute left-0 top-0 bottom-0 w-0 z-10" />
                {track.elements.map(el => {
                  const left = el.start * pxPerSec + TL_PAD, width = Math.max(14, el.duration * pxPerSec);
                  const isSel = el.id === selectedId;
                  const bg = el.type === 'video' ? 'linear-gradient(160deg,#f6935a,#c8481f)'
                    : el.type === 'image' ? 'linear-gradient(160deg,#5c7cfa,#3b3b98)'
                    : el.type === 'text' ? 'rgba(234,91,37,.18)'
                    : 'linear-gradient(180deg,#2f6d4f,#1f4a37)';
                  return (
                    <div key={el.id} onPointerDown={(e) => onBlockPointerDown(e, el.id, 'move')}
                      className="absolute top-2 bottom-2 rounded-lg overflow-hidden cursor-grab select-none"
                      style={{ left, width, background: bg, outline: isSel ? `2px solid ${BRAND}` : '1px solid rgba(0,0,0,.3)', color: el.type === 'text' ? BRAND : '#fff' }}>
                      {el.type === 'video' && clipThumbs[(el as VideoElement).url] && (<>
                        <div className="absolute inset-0 pointer-events-none" style={{ backgroundImage: `url(${clipThumbs[(el as VideoElement).url]})`, backgroundSize: 'cover', backgroundRepeat: 'repeat-x', backgroundPosition: 'center', opacity: 0.85 }} />
                        <div className="absolute inset-x-0 top-0 h-5 bg-gradient-to-b from-black/60 to-transparent pointer-events-none" />
                      </>)}
                      <span className="absolute left-2 top-1 text-[10px] font-semibold truncate max-w-[85%] pointer-events-none">
                        <i className={`fa-solid ${el.type === 'video' ? 'fa-video' : el.type === 'image' ? 'fa-image' : el.type === 'text' ? 'fa-font' : 'fa-music'} mr-1`} />
                        {el.type === 'text' ? (el as TextElement).text || 'Texto' : el.name}
                      </span>
                      {(el.type === 'video' || el.type === 'audio' || el.type === 'image' || el.type === 'text') && (<>
                        <div onPointerDown={(e) => onBlockPointerDown(e, el.id, 'trimL')} className="absolute left-0 top-0 bottom-0 w-2 cursor-ew-resize bg-black/20 hover:bg-black/40" />
                        <div onPointerDown={(e) => onBlockPointerDown(e, el.id, 'trimR')} className="absolute right-0 top-0 bottom-0 w-2 cursor-ew-resize bg-black/20 hover:bg-black/40" />
                      </>)}
                    </div>
                  );
                })}
              </div>
            ))}
            {/* Cabezal (playhead) con manija */}
            <div className="absolute top-0 bottom-0 z-20 pointer-events-none" style={{ left: currentTime * pxPerSec + TL_PAD }}>
              <div className="absolute top-0 bottom-0" style={{ left: -1, width: 2, background: BRAND }} />
              <div className="absolute -top-0.5" style={{ left: -7, width: 0, height: 0, borderLeft: '7px solid transparent', borderRight: '7px solid transparent', borderTop: `9px solid ${BRAND}` }} />
            </div>
          </div>
        </div>
      </div>

      {/* barra inferior de tabs (solo mobile) */}
      {isMobile && (
        <nav className="flex items-stretch justify-around bg-[#3b3b42] border-t border-white/10 py-1.5 shrink-0">
          {RAIL.map(r => {
            const on = tab === r.id && mobileSheet === 'panel';
            return (
              <button key={r.id} onClick={() => { setTab(r.id); setMobileSheet(mobileSheet === 'panel' && tab === r.id ? 'none' : 'panel'); }}
                className="flex flex-col items-center gap-0.5 px-2 py-1 text-[9px] font-semibold" style={{ color: on ? BRAND : 'rgba(255,255,255,.55)' }}>
                <i className={`fa-solid ${r.icon} text-sm`} />
                {r.label}
              </button>
            );
          })}
        </nav>
      )}

      {/* inputs de archivo ocultos */}
      <input ref={fileVideoRef} type="file" accept="video/*" multiple hidden onChange={(e) => { onPickVideo(e.target.files); e.currentTarget.value = ''; }} />
      <input ref={fileImageRef} type="file" accept="image/*" multiple hidden onChange={(e) => { onPickImage(e.target.files); e.currentTarget.value = ''; }} />
      <input ref={fileAudioRef} type="file" accept="audio/*" multiple hidden onChange={(e) => { onPickAudio(e.target.files); e.currentTarget.value = ''; }} />
      <input ref={fileLogoRef} type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) addLogoImage(URL.createObjectURL(f)); e.currentTarget.value = ''; }} />
    </div>
  );
};

// ---------- sub-paneles de propiedades ----------
const Row: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div><label className="text-[11px] text-white/50 font-semibold block mb-1">{label}</label>{children}</div>
);
const Slider: React.FC<{ min: number; max: number; step?: number; value: number; onChange: (v: number) => void }> = ({ min, max, step = 1, value, onChange }) => (
  <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className="w-full accent-[color:var(--b)]" style={{ ['--b' as any]: BRAND }} />
);

const TextProps: React.FC<{ el: TextElement; onText: (t: string) => void; onStyle: (s: Partial<TextElement['style']>) => void; onTransform: (t: Partial<TextElement['transform']>) => void; onSyncAll: () => void; customFonts?: CustomFont[] }> = ({ el, onText, onStyle, onTransform, onSyncAll, customFonts }) => (
  <div className="space-y-4">
    <Row label="Texto"><textarea value={el.text} onChange={(e) => onText(e.target.value)} rows={2} className="w-full bg-white/5 border border-white/10 rounded-lg p-2 text-sm text-white resize-none outline-none focus:border-white/30" /></Row>
    <Row label="Estilo (preset)">
      <div className="space-y-2.5">
        {PRESET_GROUPS.map(g => (
          <div key={g.id}>
            <div className="text-[10px] font-bold uppercase tracking-widest text-white/35 mb-1">{g.label}</div>
            <div className="grid grid-cols-3 gap-2">
              {SUB_PRESETS.filter(p => p.group === g.id).map(p => (
                <button key={p.id} onClick={() => onStyle(p.style)} className="py-1.5 rounded-lg text-[11px] font-semibold border border-white/12 text-white/70 hover:border-[color:var(--b)] hover:bg-white/5" style={{ ['--b' as any]: BRAND }}>{p.label}</button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </Row>
    <Row label="Tipografía">
      <select value={el.style.font} onChange={(e) => onStyle({ font: e.target.value })} className="w-full bg-white/5 border border-white/10 rounded-lg p-2 text-sm text-white outline-none focus:border-white/30">
        <optgroup label="Sistema">{FONTS.map(f => <option key={f} value={f} style={{ fontFamily: f }}>{f}</option>)}</optgroup>
        {customFonts && customFonts.length > 0 && <optgroup label="Mis Tipografías">{customFonts.map(f => <option key={f.family} value={f.family} style={{ fontFamily: f.family }}>{f.name}</option>)}</optgroup>}
      </select>
    </Row>
    <Row label="Formato">
      <div className="flex gap-2">
        <button onClick={() => onStyle({ weight: el.style.weight >= 700 ? 400 : 800 })} className="flex-1 py-1.5 rounded-lg text-sm font-black border"
          style={el.style.weight >= 700 ? { borderColor: BRAND, color: BRAND } : { borderColor: 'rgba(255,255,255,.12)', color: 'rgba(255,255,255,.6)' }}>B</button>
        <button onClick={() => onStyle({ italic: !el.style.italic })} className="flex-1 py-1.5 rounded-lg text-sm font-semibold italic border"
          style={el.style.italic ? { borderColor: BRAND, color: BRAND } : { borderColor: 'rgba(255,255,255,.12)', color: 'rgba(255,255,255,.6)' }}>I</button>
        <button onClick={() => onStyle({ upper: !el.style.upper })} title="Mayúsculas" className="flex-1 py-1.5 rounded-lg text-sm font-bold border"
          style={el.style.upper ? { borderColor: BRAND, color: BRAND } : { borderColor: 'rgba(255,255,255,.12)', color: 'rgba(255,255,255,.6)' }}>Aa</button>
      </div>
    </Row>
    <button onClick={onSyncAll} className="w-full py-2 rounded-lg text-white text-[11px] font-bold" style={{ background: `linear-gradient(135deg,${BRAND},#f0814f)` }}>
      <i className="fa-solid fa-wand-sparkles mr-2" />Aplicar este estilo a TODOS los subtítulos
    </button>
    <Row label={`Tamaño: ${el.style.size}%`}><Slider min={3} max={20} value={el.style.size} onChange={(v) => onStyle({ size: v })} /></Row>
    <Row label="Color"><input type="color" value={el.style.color} onChange={(e) => onStyle({ color: e.target.value })} className="w-full h-8 rounded-lg bg-transparent cursor-pointer" /></Row>
    <Row label="Caja de fondo">
      <div className="flex gap-2">
        <button onClick={() => onStyle({ bg: null })} className="flex-1 py-1.5 rounded-lg text-xs font-semibold border" style={!el.style.bg ? { borderColor: BRAND, color: BRAND } : { borderColor: 'rgba(255,255,255,.12)', color: 'rgba(255,255,255,.6)' }}>Sin caja</button>
        <input type="color" value={el.style.bg || '#000000'} onChange={(e) => onStyle({ bg: e.target.value })} className="w-12 h-8 rounded-lg bg-transparent cursor-pointer" />
      </div>
    </Row>
    <Row label={`Posición Y: ${Math.round(el.transform.y)}%`}><Slider min={0} max={100} value={el.transform.y} onChange={(v) => onTransform({ y: v })} /></Row>
    <Row label={`Posición X: ${Math.round(el.transform.x)}%`}><Slider min={0} max={100} value={el.transform.x} onChange={(v) => onTransform({ x: v })} /></Row>
    {/* Karaoke/palabra por palabra: solo para subtítulos. Para el resto, animar desde la pestaña Animación. */}
    {el.name === 'Subtítulo' && (
      <div className="pt-2 border-t border-white/5 space-y-3">
        <Row label="Animación (palabra por palabra)">
          <select value={el.style.anim || (el.style.karaoke ? 'karaoke' : 'none')} onChange={(e) => onStyle({ anim: e.target.value as any, karaoke: e.target.value === 'karaoke' })} className="w-full bg-white/5 border border-white/10 rounded-lg p-2 text-sm text-white outline-none focus:border-white/30">
            <option value="none">Ninguna</option>
            <option value="karaoke">Karaoke</option>
            <option value="reveal">Revelado</option>
            <option value="highlight">Resaltado</option>
            <option value="pop">Pop (rebote)</option>
            <option value="wordbox">Caja por palabra</option>
          </select>
        </Row>
        {(el.style.anim && el.style.anim !== 'none') || el.style.karaoke ? (
          <Row label="Color de resalte"><input type="color" value={el.style.accent || '#FFE600'} onChange={(e) => onStyle({ accent: e.target.value })} className="w-full h-8 rounded-lg bg-transparent cursor-pointer" /></Row>
        ) : null}
      </div>
    )}
  </div>
);

// Manijas de escala/rotación sobre el preview para el sticker seleccionado (manipulación directa).
const StickerHandles: React.FC<{ el: TextElement; onStyle: (s: Partial<TextElement['style']>) => void; onTransform: (t: Partial<TextElement['transform']>) => void }> = ({ el, onStyle, onTransform }) => {
  const boxRef = useRef<HTMLDivElement>(null);
  const modeRef = useRef<{ kind: 'scale'; cx: number; cy: number; startDist: number; origSize: number } | { kind: 'rotate'; cx: number; cy: number } | null>(null);
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const m = modeRef.current; if (!m) return;
      if (m.kind === 'scale') {
        const d = Math.hypot(e.clientX - m.cx, e.clientY - m.cy);
        onStyle({ size: Math.round(Math.max(3, Math.min(60, m.origSize * (d / m.startDist))) * 10) / 10 });
      } else {
        let a = Math.atan2(e.clientY - m.cy, e.clientX - m.cx) * 180 / Math.PI + 90;
        a = ((a + 180) % 360 + 360) % 360 - 180;
        onTransform({ rotation: Math.round(a) });
      }
    };
    const onUp = () => { modeRef.current = null; };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => { window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp); };
  }, [onStyle, onTransform]);
  const start = (kind: 'scale' | 'rotate', e: React.PointerEvent) => {
    e.stopPropagation(); e.preventDefault();
    const r = boxRef.current?.parentElement?.getBoundingClientRect(); if (!r) return;
    const cx = r.left + (el.transform.x / 100) * r.width;
    const cy = r.top + (el.transform.y / 100) * r.height;
    modeRef.current = kind === 'scale'
      ? { kind, cx, cy, startDist: Math.max(1, Math.hypot(e.clientX - cx, e.clientY - cy)), origSize: el.style.size }
      : { kind, cx, cy };
  };
  return (
    <div ref={boxRef} className="absolute" style={{ left: `${el.transform.x}%`, top: `${el.transform.y}%`, height: `${Math.max(6, el.style.size * 1.25)}%`, aspectRatio: '1 / 1', transform: `translate(-50%,-50%) rotate(${el.transform.rotation || 0}deg)`, border: `1.5px dashed ${BRAND}`, borderRadius: 8, pointerEvents: 'none' }}>
      <div onPointerDown={(e) => start('rotate', e)} title="Rotar" className="absolute left-1/2 grid place-items-center rounded-full shadow" style={{ top: -26, width: 18, height: 18, transform: 'translateX(-50%)', background: BRAND, pointerEvents: 'auto', cursor: 'grab' }}><i className="fa-solid fa-rotate text-[9px] text-white" /></div>
      <div style={{ position: 'absolute', left: '50%', top: -26, width: 1, height: 18, background: BRAND, transform: 'translateX(-50%)', pointerEvents: 'none' }} />
      <div onPointerDown={(e) => start('scale', e)} title="Escalar" className="absolute rounded-full shadow" style={{ right: -8, bottom: -8, width: 16, height: 16, background: BRAND, pointerEvents: 'auto', cursor: 'nwse-resize' }} />
    </div>
  );
};

const StickerProps: React.FC<{ el: TextElement; onStyle: (s: Partial<TextElement['style']>) => void; onTransform: (t: Partial<TextElement['transform']>) => void }> = ({ el, onStyle, onTransform }) => (
  <div className="space-y-4">
    <div className="text-center text-5xl leading-none py-2 select-none">{el.text}</div>
    <Row label={`Tamaño: ${el.style.size}%`}><Slider min={5} max={40} value={el.style.size} onChange={(v) => onStyle({ size: v })} /></Row>
    <Row label={`Rotación: ${Math.round(el.transform.rotation)}°`}><Slider min={-180} max={180} value={el.transform.rotation} onChange={(v) => onTransform({ rotation: v })} /></Row>
    <Row label={`Opacidad: ${Math.round(el.transform.opacity)}%`}><Slider min={0} max={100} value={el.transform.opacity} onChange={(v) => onTransform({ opacity: v })} /></Row>
    <Row label={`Posición X: ${Math.round(el.transform.x)}%`}><Slider min={0} max={100} value={el.transform.x} onChange={(v) => onTransform({ x: v })} /></Row>
    <Row label={`Posición Y: ${Math.round(el.transform.y)}%`}><Slider min={0} max={100} value={el.transform.y} onChange={(v) => onTransform({ y: v })} /></Row>
    <p className="text-[11px] text-white/40 leading-relaxed">Arrastralo en el preview para moverlo; arrastrá los bordes en la timeline para cambiar su duración.</p>
  </div>
);

const VisualProps: React.FC<{ el: VideoElement | ImageElement; isBase: boolean; onTransform: (t: Partial<VideoElement['transform']>) => void; onVolume: (v: number) => void; onFit: (f: 'cover' | 'contain') => void; onAudioFade: (p: { audioFadeIn?: number; audioFadeOut?: number }) => void; onKenBurns: (v: boolean) => void }> = ({ el, isBase, onTransform, onVolume, onFit, onAudioFade, onKenBurns }) => (
  <div className="space-y-4">
    {isBase && (
      <Row label="Encuadre">
        <div className="flex gap-2">
          <button onClick={() => onFit('cover')} className="flex-1 py-1.5 rounded-lg text-xs font-semibold border" style={(el.fit || 'cover') === 'cover' ? { borderColor: BRAND, color: BRAND } : { borderColor: 'rgba(255,255,255,.12)', color: 'rgba(255,255,255,.6)' }}>Llenar formato</button>
          <button onClick={() => onFit('contain')} className="flex-1 py-1.5 rounded-lg text-xs font-semibold border" style={el.fit === 'contain' ? { borderColor: BRAND, color: BRAND } : { borderColor: 'rgba(255,255,255,.12)', color: 'rgba(255,255,255,.6)' }}>Completo (con bordes)</button>
        </div>
      </Row>
    )}
    {isBase && el.type === 'image' && (
      <Row label="Movimiento">
        <label className="flex items-center gap-2 text-xs text-white/70"><input type="checkbox" checked={!!(el as ImageElement).kenBurns} onChange={(e) => onKenBurns(e.target.checked)} /> Zoom lento (Ken Burns)</label>
      </Row>
    )}
    <Row label={`Tamaño: ${Math.round(el.transform.scale)}%`}><Slider min={10} max={200} value={el.transform.scale} onChange={(v) => onTransform({ scale: v })} /></Row>
    <Row label={`Posición X: ${Math.round(el.transform.x)}%`}><Slider min={0} max={100} value={el.transform.x} onChange={(v) => onTransform({ x: v })} /></Row>
    <Row label={`Posición Y: ${Math.round(el.transform.y)}%`}><Slider min={0} max={100} value={el.transform.y} onChange={(v) => onTransform({ y: v })} /></Row>
    <Row label={`Opacidad: ${Math.round(el.transform.opacity)}%`}><Slider min={0} max={100} value={el.transform.opacity} onChange={(v) => onTransform({ opacity: v })} /></Row>
    {el.type === 'video' && <>
      <Row label={`Volumen: ${Math.round((el as VideoElement).volume * 100)}%`}><Slider min={0} max={100} value={(el as VideoElement).volume * 100} onChange={(v) => onVolume(v / 100)} /></Row>
      <Row label={`Fade volumen in: ${(el.audioFadeIn || 0).toFixed(1)}s`}><Slider min={0} max={3} step={0.1} value={el.audioFadeIn || 0} onChange={(v) => onAudioFade({ audioFadeIn: v })} /></Row>
      <Row label={`Fade volumen out: ${(el.audioFadeOut || 0).toFixed(1)}s`}><Slider min={0} max={3} step={0.1} value={el.audioFadeOut || 0} onChange={(v) => onAudioFade({ audioFadeOut: v })} /></Row>
    </>}
  </div>
);

const AudioProps: React.FC<{ el: AudioElement; onVolume: (v: number) => void; onLoop: (l: boolean) => void; onAudioFade: (p: { audioFadeIn?: number; audioFadeOut?: number }) => void }> = ({ el, onVolume, onLoop, onAudioFade }) => (
  <div className="space-y-4">
    <Row label={`Volumen: ${Math.round(el.volume * 100)}%`}><Slider min={0} max={100} value={el.volume * 100} onChange={(v) => onVolume(v / 100)} /></Row>
    <Row label={`Fade in: ${(el.audioFadeIn || 0).toFixed(1)}s`}><Slider min={0} max={3} step={0.1} value={el.audioFadeIn || 0} onChange={(v) => onAudioFade({ audioFadeIn: v })} /></Row>
    <Row label={`Fade out: ${(el.audioFadeOut || 0).toFixed(1)}s`}><Slider min={0} max={3} step={0.1} value={el.audioFadeOut || 0} onChange={(v) => onAudioFade({ audioFadeOut: v })} /></Row>
    <label className="flex items-center gap-2 text-xs text-white/70"><input type="checkbox" checked={el.loop} onChange={(e) => onLoop(e.target.checked)} /> Repetir en bucle</label>
  </div>
);

export default ReelStudioV2;
