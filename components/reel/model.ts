// === Modelo de datos multi-track del Editor de Reels (Fase 2) ===
// Reemplaza el modelo de "una sola pista secuencial de clips" por un timeline con múltiples pistas
// y elementos con posición temporal libre (start), lo que habilita overlays, texto libre y PiP.
// Tiempo en segundos (float). Todo inmutable: los helpers devuelven un proyecto nuevo.

export type AspectId = '9:16' | '1:1' | '16:9' | '4:5';
export const ASPECTS: Record<AspectId, { w: number; h: number; label: string }> = {
  '9:16': { w: 1080, h: 1920, label: 'Reel / Story (9:16)' },
  '1:1': { w: 1080, h: 1080, label: 'Feed cuadrado (1:1)' },
  '4:5': { w: 1080, h: 1350, label: 'Feed vertical (4:5)' },
  '16:9': { w: 1920, h: 1080, label: 'Horizontal (16:9)' },
};

export type TrackKind = 'video' | 'overlay' | 'audio';
export type ElementType = 'video' | 'image' | 'text' | 'audio';
export type TransitionKind = 'none' | 'fade' | 'white' | 'zoom' | 'slide';

// Posición/transformación de un elemento visual. x,y en % del canvas (centro del elemento); scale en %.
export interface Transform { x: number; y: number; scale: number; rotation: number; opacity: number }
export const DEFAULT_TRANSFORM: Transform = { x: 50, y: 50, scale: 100, rotation: 0, opacity: 100 };

export interface TextStyle {
  font: string;
  color: string;
  size: number;            // % de la altura del canvas
  weight: number;
  bg: string | null;       // color de caja (o null)
  stroke: boolean;
  align: 'center' | 'left' | 'right';
  karaoke?: boolean;       // (compat) equivale a anim: 'karaoke'
  anim?: 'none' | 'karaoke' | 'reveal' | 'highlight'; // animación palabra por palabra
  accent?: string;         // color del resaltado
}
export const DEFAULT_TEXT_STYLE: TextStyle = {
  font: 'Inter', color: '#FFFFFF', size: 7, weight: 900, bg: null, stroke: true, align: 'center', karaoke: false, accent: '#FFE600',
};

interface BaseElement {
  id: string;
  name: string;
  start: number;        // inicio en la timeline (s)
  duration: number;     // duración visible en la timeline (s)
  trimStart: number;    // recorte de la fuente (s) — para media
  trimEnd: number;      // fin del recorte de la fuente (s)
  sourceDuration?: number;
  fadeIn?: number;      // transición de aparición (s)
  fadeOut?: number;     // transición de salida (s)
  transition?: TransitionKind;  // transición de entrada del clip (fade/white/zoom/slide)
  transitionDur?: number;       // duración de la transición (s)
}
export interface VideoElement extends BaseElement { type: 'video'; mediaId?: string; url: string; transform: Transform; volume: number; muted: boolean; fit?: 'cover' | 'contain' }
export interface ImageElement extends BaseElement { type: 'image'; mediaId?: string; url: string; transform: Transform; fit?: 'cover' | 'contain' }
export interface TextElement extends BaseElement { type: 'text'; text: string; transform: Transform; style: TextStyle }
export interface AudioElement extends BaseElement { type: 'audio'; mediaId?: string; url: string; volume: number; loop: boolean }
export type ReelElement = VideoElement | ImageElement | TextElement | AudioElement;

export interface Track {
  id: string;
  kind: TrackKind;
  name: string;
  elements: ReelElement[];
  muted: boolean;
  hidden: boolean;
  locked: boolean;
}

export interface ReelProject {
  id: string;
  name: string;
  aspect: AspectId;
  fps: number;
  tracks: Track[];       // orden de composición: índice 0 = pista de más abajo (fondo)
}

// ---------- ids ----------
let idc = 0;
export function genId(prefix = 'id'): string {
  idc += 1;
  return `${prefix}_${Date.now().toString(36)}_${idc}`;
}

// ---------- creación ----------
export function createProject(aspect: AspectId = '9:16'): ReelProject {
  return {
    id: genId('proj'),
    name: 'Reel sin título',
    aspect,
    fps: 30,
    tracks: [
      { id: genId('trk'), kind: 'video', name: 'Video', elements: [], muted: false, hidden: false, locked: false },
      { id: genId('trk'), kind: 'overlay', name: 'Overlay', elements: [], muted: false, hidden: false, locked: false },
      { id: genId('trk'), kind: 'audio', name: 'Audio', elements: [], muted: false, hidden: false, locked: false },
    ],
  };
}

export function canvasSize(p: ReelProject): { w: number; h: number } {
  return ASPECTS[p.aspect];
}

// ---------- consultas ----------
export function projectDuration(p: ReelProject): number {
  let end = 0;
  for (const t of p.tracks) for (const e of t.elements) end = Math.max(end, e.start + e.duration);
  return end;
}

export const isVisual = (e: ReelElement): e is VideoElement | ImageElement | TextElement =>
  e.type === 'video' || e.type === 'image' || e.type === 'text';
export const hasAudio = (e: ReelElement): e is VideoElement | AudioElement =>
  e.type === 'video' || e.type === 'audio';

export function elementAt(track: Track, t: number): ReelElement | null {
  for (const e of track.elements) if (t >= e.start && t < e.start + e.duration) return e;
  return null;
}

// Elementos visuales activos en el tiempo t, en orden de composición (fondo → frente).
export function visualsAt(p: ReelProject, t: number): { el: VideoElement | ImageElement | TextElement; track: Track }[] {
  const out: { el: VideoElement | ImageElement | TextElement; track: Track }[] = [];
  for (const track of p.tracks) {
    if (track.hidden || track.kind === 'audio') continue;
    for (const e of track.elements) {
      if (isVisual(e) && t >= e.start && t < e.start + e.duration) out.push({ el: e, track });
    }
  }
  return out;
}

export function findElement(p: ReelProject, id: string): { el: ReelElement; track: Track } | null {
  for (const track of p.tracks) for (const el of track.elements) if (el.id === id) return { el, track };
  return null;
}

// ---------- mutaciones inmutables ----------
export function mapTracks(p: ReelProject, fn: (t: Track) => Track): ReelProject {
  return { ...p, tracks: p.tracks.map(fn) };
}

export function addElement(p: ReelProject, trackId: string, el: ReelElement): ReelProject {
  return mapTracks(p, t => t.id === trackId ? { ...t, elements: [...t.elements, el].sort((a, b) => a.start - b.start) } : t);
}

export function updateElement(p: ReelProject, id: string, patch: Partial<ReelElement>): ReelProject {
  return mapTracks(p, t => {
    if (!t.elements.some(e => e.id === id)) return t;
    return { ...t, elements: t.elements.map(e => e.id === id ? ({ ...e, ...patch } as ReelElement) : e) };
  });
}

export function removeElement(p: ReelProject, id: string): ReelProject {
  return mapTracks(p, t => ({ ...t, elements: t.elements.filter(e => e.id !== id) }));
}

// Mueve un elemento a otro instante (y opcionalmente a otra pista compatible).
export function moveElement(p: ReelProject, id: string, newStart: number, newTrackId?: string): ReelProject {
  const found = findElement(p, id);
  if (!found) return p;
  const start = Math.max(0, newStart);
  if (!newTrackId || newTrackId === found.track.id) {
    return updateElement(p, id, { start });
  }
  // Cambio de pista: sacar de la actual, poner en la nueva.
  const moved = { ...found.el, start } as ReelElement;
  return mapTracks(p, t => {
    if (t.id === found.track.id) return { ...t, elements: t.elements.filter(e => e.id !== id) };
    if (t.id === newTrackId) return { ...t, elements: [...t.elements, moved].sort((a, b) => a.start - b.start) };
    return t;
  });
}

export function setTrackFlag(p: ReelProject, trackId: string, flag: 'muted' | 'hidden' | 'locked', value: boolean): ReelProject {
  return mapTracks(p, t => t.id === trackId ? { ...t, [flag]: value } : t);
}

// Corta un elemento en dos en el instante atTime (de la timeline). Respeta el recorte de la fuente.
export function splitElement(p: ReelProject, id: string, atTime: number): ReelProject {
  const found = findElement(p, id);
  if (!found) return p;
  const el = found.el;
  if (atTime <= el.start + 0.05 || atTime >= el.start + el.duration - 0.05) return p;
  const leftDur = atTime - el.start;
  const rightDur = el.duration - leftDur;
  const anyEl = el as any;
  const hasTrim = anyEl.trimStart != null && anyEl.trimEnd != null;
  const cut = hasTrim ? anyEl.trimStart + leftDur : 0;
  const left = { ...el, duration: leftDur, ...(hasTrim ? { trimEnd: cut } : {}) } as ReelElement;
  const right = { ...el, id: genId('el'), start: atTime, duration: rightDur, ...(hasTrim ? { trimStart: cut } : {}) } as ReelElement;
  return mapTracks(p, t => t.id === found.track.id
    ? { ...t, elements: t.elements.flatMap(e => e.id === id ? [left, right] : [e]).sort((a, b) => a.start - b.start) }
    : t);
}

// Compaginado automático: re-tima los clips de la pista de video en orden, opcionalmente recortando
// silencios (bounds precalculados) y ajustándolos a una duración objetivo, con beat-sync opcional.
export function autoCompaginate(
  p: ReelProject,
  opts: { target: 'auto' | 15 | 30 | 60; beatSync: boolean; boundsByEl: Record<string, [number, number]>; beats: number[] },
): ReelProject {
  const { target, beatSync, boundsByEl, beats } = opts;
  const track = p.tracks.find(t => t.kind === 'video');
  if (!track) return p;
  const clips = [...track.elements].filter(e => e.type === 'video' || e.type === 'image').sort((a, b) => a.start - b.start);
  const N = clips.length;
  if (!N) return p;
  const srcDur = (c: ReelElement) => (c as any).sourceDuration || c.duration;
  const bounds = clips.map(c => boundsByEl[c.id] || [0, srcDur(c)] as [number, number]);
  const avail = bounds.map(([s, e]) => Math.max(0.3, e - s));
  const totalAvail = avail.reduce((a, b) => a + b, 0);
  const T = target === 'auto' ? totalAvail : (target as number);
  const durs: number[] = [];

  if (beatSync && beats.length) {
    const share = T / N;
    let cur = 0;
    for (let i = 0; i < N; i++) {
      let dur: number;
      if (i === N - 1) dur = Math.max(0.5, Math.min(avail[i], T - cur));
      else {
        const ideal = cur + share;
        const cand = beats.filter(b => b > cur + 0.4 && b <= cur + avail[i] + 0.01);
        const snap = cand.length ? cand.reduce((bst, b) => Math.abs(b - ideal) < Math.abs(bst - ideal) ? b : bst, cand[0]) : ideal;
        dur = Math.max(0.5, Math.min(avail[i], snap - cur));
      }
      durs.push(dur); cur += dur;
    }
  } else if (target === 'auto') {
    avail.forEach(a => durs.push(a));
  } else {
    const share = T / N;
    const targets = avail.map(a => Math.min(a, share));
    for (let iter = 0; iter < 4; iter++) {
      const used = targets.reduce((a, b) => a + b, 0);
      const leftover = T - used;
      if (leftover < 0.05) break;
      const expandable = avail.map((a, i) => (a - targets[i] > 0.02 ? i : -1)).filter(i => i >= 0);
      if (!expandable.length) break;
      const add = leftover / expandable.length;
      expandable.forEach(i => { targets[i] += Math.min(add, avail[i] - targets[i]); });
    }
    for (let i = 0; i < N; i++) durs.push(Math.max(0.5, Math.min(avail[i], targets[i])));
  }

  let cursor = 0;
  const patch: Record<string, Partial<ReelElement>> = {};
  clips.forEach((c, i) => {
    const ts = bounds[i][0];
    patch[c.id] = { start: cursor, duration: durs[i], trimStart: ts, trimEnd: ts + durs[i] } as Partial<ReelElement>;
    cursor += durs[i];
  });
  return mapTracks(p, tk => tk.id !== track.id ? tk : {
    ...tk,
    elements: tk.elements.map(e => patch[e.id] ? ({ ...e, ...patch[e.id] } as ReelElement) : e).sort((a, b) => a.start - b.start),
  });
}

// ---------- constructores de elementos ----------
export function makeVideoElement(url: string, sourceDuration: number, opts: Partial<VideoElement> = {}): VideoElement {
  return {
    id: genId('el'), type: 'video', name: opts.name || 'Video', url, mediaId: opts.mediaId,
    start: opts.start ?? 0, duration: opts.duration ?? sourceDuration, trimStart: opts.trimStart ?? 0,
    trimEnd: opts.trimEnd ?? sourceDuration, sourceDuration,
    transform: opts.transform ?? { ...DEFAULT_TRANSFORM }, volume: opts.volume ?? 1, muted: opts.muted ?? false,
    fit: opts.fit ?? 'contain',
  };
}
export function makeImageElement(url: string, opts: Partial<ImageElement> = {}): ImageElement {
  return {
    id: genId('el'), type: 'image', name: opts.name || 'Imagen', url, mediaId: opts.mediaId,
    start: opts.start ?? 0, duration: opts.duration ?? 4, trimStart: 0, trimEnd: 0,
    transform: opts.transform ?? { ...DEFAULT_TRANSFORM }, fit: opts.fit ?? 'contain',
  };
}
export function makeTextElement(text: string, opts: Partial<TextElement> = {}): TextElement {
  return {
    id: genId('el'), type: 'text', name: opts.name || 'Texto', text,
    start: opts.start ?? 0, duration: opts.duration ?? 3, trimStart: 0, trimEnd: 0,
    transform: opts.transform ?? { ...DEFAULT_TRANSFORM, y: 82 }, style: opts.style ?? { ...DEFAULT_TEXT_STYLE },
  };
}
export function makeAudioElement(url: string, sourceDuration: number, opts: Partial<AudioElement> = {}): AudioElement {
  return {
    id: genId('el'), type: 'audio', name: opts.name || 'Audio', url, mediaId: opts.mediaId,
    start: opts.start ?? 0, duration: opts.duration ?? sourceDuration, trimStart: opts.trimStart ?? 0,
    trimEnd: opts.trimEnd ?? sourceDuration, sourceDuration, volume: opts.volume ?? 1, loop: opts.loop ?? false,
  };
}
