import React, { useState, useRef, useEffect, useCallback } from 'react';
import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile } from '@ffmpeg/util';
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
  const setTrimStart = (v: number) => setActiveTrim({ trimStart: v });
  const setTrimEnd = (v: number) => setActiveTrim({ trimEnd: v });
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

  const [subtitles, setSubtitles] = useState<Subtitle[]>([]);
  const [subStyle, setSubStyle] = useState<string>('capcut');
  const [subColor, setSubColor] = useState('#FFFFFF');
  const [subScale, setSubScale] = useState(1); // multiplicador de tamaño de subtítulos
  const [openSec, setOpenSec] = useState<Record<string, boolean>>({ subtitulos: true }); // secciones desplegables
  const toggleSec = (k: string) => setOpenSec(p => ({ ...p, [k]: !p[k] }));
  const [transcribing, setTranscribing] = useState(false);
  const [subFont, setSubFont] = useState<string>(kit?.headlineFont || 'Inter');

  const [logoEnabled, setLogoEnabled] = useState(false);

  // Segmentos a conservar (para cortes / quitar tiempos muertos). null = video completo recortado.
  const [segments, setSegments] = useState<{ start: number; end: number }[] | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [cutMsg, setCutMsg] = useState('');

  const [exporting, setExporting] = useState(false);
  const [exportMsg, setExportMsg] = useState('');
  const [exportPct, setExportPct] = useState(0); // 0-100, progreso real de exportación
  const [exportedUrl, setExportedUrl] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const logoImgRef = useRef<HTMLImageElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const ffmpegRef = useRef<FFmpeg | null>(null);
  const musicElRef = useRef<HTMLAudioElement | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const musicSourceRef = useRef<MediaElementAudioSourceNode | null>(null);
  const musicGainRef = useRef<GainNode | null>(null);
  const videoSourceRef = useRef<MediaElementAudioSourceNode | null>(null);
  const videoGainRef = useRef<GainNode | null>(null);
  const voiceElRef = useRef<HTMLAudioElement | null>(null);
  const voiceSourceRef = useRef<MediaElementAudioSourceNode | null>(null);
  const voiceGainRef = useRef<GainNode | null>(null);
  const micRecorderRef = useRef<MediaRecorder | null>(null);
  const micChunksRef = useRef<Blob[]>([]);
  const trackRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef<{ clipId: string; edge: 'start' | 'end' } | null>(null);
  const [clipPeaks, setClipPeaks] = useState<Record<string, number[]>>({}); // onda de audio por clip
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

  const addClip = (file: File) => {
    const url = URL.createObjectURL(file);
    setClips(prev => {
      const next = [...prev, { id: `clip_${Date.now()}`, url, duration: 0, trimStart: 0, trimEnd: 0 }];
      setActiveIdx(next.length - 1);
      return next;
    });
    setExportedUrl(null);
  };
  const removeClip = (id: string) => {
    setClips(prev => {
      const next = prev.filter(c => c.id !== id);
      setActiveIdx(a => Math.max(0, Math.min(a, next.length - 1)));
      return next;
    });
  };
  const handleVideoFile = (file: File) => addClip(file);

  // --- Línea de tiempo (estilo CapCut): recorte por bordes + dividir ---
  const TL_PX = 48; // píxeles por segundo en la línea de tiempo
  const clipLeftPx = (idx: number) => clips.slice(0, idx).reduce((a, c) => a + (c.duration || 0) * TL_PX, 0);
  const onTrackPointerMove = (e: React.PointerEvent) => {
    const d = draggingRef.current;
    if (!d) return;
    const idx = clips.findIndex(c => c.id === d.clipId);
    if (idx < 0) return;
    const clip = clips[idx];
    const track = trackRef.current;
    if (!track) return;
    const rect = track.getBoundingClientRect();
    const x = e.clientX - rect.left + track.scrollLeft - clipLeftPx(idx);
    const t = Math.max(0, Math.min(clip.duration || 0, x / TL_PX));
    setClips(prev => prev.map(c => c.id === d.clipId
      ? (d.edge === 'start' ? { ...c, trimStart: Math.min(t, c.trimEnd - 0.3) } : { ...c, trimEnd: Math.max(t, c.trimStart + 0.3) })
      : c));
  };
  const endDrag = () => { draggingRef.current = null; scrubRef.current = false; };

  // --- Scrubbing: mover el cabezal con click/arrastre sobre la timeline ---
  const locFromClientX = (clientX: number): { idx: number; local: number } | null => {
    const track = trackRef.current;
    if (!track || clips.length === 0) return null;
    const rect = track.getBoundingClientRect();
    const x = clientX - rect.left - 8 + track.scrollLeft; // -8 = padding p-2 del contenedor
    let acc = 0;
    for (let i = 0; i < clips.length; i++) {
      const w = (clips[i].duration || 0) * TL_PX;
      if (x < acc + w || i === clips.length - 1) {
        return { idx: i, local: Math.max(0, Math.min(clips[i].duration || 0, (x - acc) / TL_PX)) };
      }
      acc += w;
    }
    return null;
  };
  const scrubTo = (clientX: number) => {
    const loc = locFromClientX(clientX);
    if (!loc) return;
    if (loc.idx === activeIdx) seek(loc.local);
    else { pendingSeekRef.current = loc.local; setActiveIdx(loc.idx); }
  };
  const onTimelinePointerDown = (e: React.PointerEvent) => {
    if (draggingRef.current) return; // se está arrastrando un borde (recorte)
    scrubRef.current = true;
    try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch {}
    scrubTo(e.clientX);
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
        if (clipPeaks[c.id] || peaksBusyRef.current.has(c.id)) continue;
        peaksBusyRef.current.add(c.id);
        try {
          const bytes = await getAudioBytes(c.url);
          const peaks = wavToPeaks(bytes, 220);
          if (!cancelled && peaks.length) setClipPeaks(prev => ({ ...prev, [c.id]: peaks }));
        } catch { /* sin audio → onda plana */ }
        finally { peaksBusyRef.current.delete(c.id); }
      }
    })();
    return () => { cancelled = true; };
  }, [clipIdsKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const splitActive = () => {
    const clip = clips[activeIdx];
    if (!clip) return;
    const t = currentTime;
    if (t <= clip.trimStart + 0.3 || t >= clip.trimEnd - 0.3) { alert('Mové el cabezal a un punto dentro del clip para dividirlo.'); return; }
    const a = { ...clip, trimEnd: t };
    const b: Clip = { ...clip, id: `clip_${Date.now()}`, trimStart: t };
    setClips(prev => { const next = [...prev]; next.splice(activeIdx, 1, a, b); return next; });
  };

  const handleMusicFile = (file: File) => {
    const url = URL.createObjectURL(file);
    // Reconstruye el nodo de audio con la pista nueva
    musicElRef.current?.pause();
    try { musicSourceRef.current?.disconnect(); musicGainRef.current?.disconnect(); } catch {}
    musicElRef.current = null; musicSourceRef.current = null; musicGainRef.current = null;
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
    // Aplica un seek pendiente tras cambiar de clip (scrubbing entre clips)
    if (pendingSeekRef.current != null) {
      const t = Math.max(0, Math.min(v.duration || 0, pendingSeekRef.current));
      pendingSeekRef.current = null;
      v.currentTime = t;
      setCurrentTime(t);
      drawFrame(t);
    }
  };

  // Volúmenes en vivo (preview y export comparten el mismo gain)
  useEffect(() => {
    const v = videoRef.current;
    if (videoGainRef.current) { try { videoGainRef.current.gain.value = videoVolume; } catch {} }
    else if (v) { v.muted = videoVolume === 0; v.volume = videoVolume; } // antes de construir el grafo
  }, [videoVolume]);
  useEffect(() => { if (musicSourceRef.current && musicGainRef.current) { try { musicGainRef.current.gain.value = musicVolume; } catch {} } else if (musicElRef.current) musicElRef.current.volume = musicVolume; }, [musicVolume]);
  useEffect(() => { if (voiceSourceRef.current && voiceGainRef.current) { try { voiceGainRef.current.gain.value = voiceVolume; } catch {} } else if (voiceElRef.current) voiceElRef.current.volume = voiceVolume; }, [voiceVolume]);

  // Dibuja un frame (video + logo + subtítulo activo) en el canvas
  const drawFrame = useCallback((t: number) => {
    const canvas = canvasRef.current;
    const v = videoRef.current;
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
    try { ctx.drawImage(v, dx, dy, dw, dh); } catch { /* frame no listo */ }

    // Logo de marca arriba al centro
    if (logoEnabled && logoImgRef.current) {
      const img = logoImgRef.current;
      const targetW = CANVAS_W * 0.28;
      const ratio = img.height / img.width;
      const lw = targetW;
      const lh = targetW * ratio;
      ctx.drawImage(img, (CANVAS_W - lw) / 2, CANVAS_H * 0.06, lw, lh);
    }

    // Subtítulo activo (con estilo elegido)
    const active = subtitles.find(s => t >= s.start && t <= s.end);
    if (active && active.text.trim()) {
      const st = SUB_STYLES[subStyle] || SUB_STYLES.capcut;
      const fontSize = Math.round(st.size * subScale);
      ctx.font = `${st.weight} ${fontSize}px "${subFont}", sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      const maxWidth = CANVAS_W * 0.86;
      const raw = st.upper ? active.text.toUpperCase() : active.text;
      const words = raw.split(/\s+/);
      const lines: string[] = [];
      let line = '';
      for (const w of words) {
        const test = line ? `${line} ${w}` : w;
        if (ctx.measureText(test).width > maxWidth && line) { lines.push(line); line = w; }
        else line = test;
      }
      if (line) lines.push(line);

      const lineH = fontSize * 1.25;
      const blockH = lines.length * lineH;
      const baseY = CANVAS_H * st.y - blockH / 2;

      // Caja de fondo
      if (st.box) {
        lines.forEach((ln, i) => {
          const y = baseY + i * lineH + lineH / 2;
          const w = ctx.measureText(ln).width;
          ctx.fillStyle = 'rgba(0,0,0,0.62)';
          ctx.fillRect((CANVAS_W - w) / 2 - 28, y - lineH / 2, w + 56, lineH);
        });
      }
      // Sombra (estilo clásico/minimal)
      if (st.shadow) { ctx.shadowColor = 'rgba(0,0,0,0.65)'; ctx.shadowBlur = 14; ctx.shadowOffsetY = 3; }
      else { ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; ctx.shadowOffsetY = 0; }

      lines.forEach((ln, i) => {
        const y = baseY + i * lineH + lineH / 2;
        if (st.outline > 0) {
          ctx.lineJoin = 'round';
          ctx.lineWidth = st.outline;
          ctx.strokeStyle = st.outlineColor;
          ctx.strokeText(ln, CANVAS_W / 2, y);
        }
        ctx.fillStyle = subColor;
        ctx.fillText(ln, CANVAS_W / 2, y);
      });
      ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
    }
  }, [logoEnabled, subtitles, subColor, subFont, subStyle, subScale]);

  // Loop de previsualización
  const tick = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    setCurrentTime(v.currentTime);
    drawFrame(v.currentTime);
    if (v.currentTime >= trimEnd) {
      v.pause();
      musicElRef.current?.pause();
      voiceElRef.current?.pause();
      setPlaying(false);
      return;
    }
    rafRef.current = requestAnimationFrame(tick);
  }, [drawFrame, trimEnd]);

  useEffect(() => {
    if (playing) rafRef.current = requestAnimationFrame(tick);
    else if (rafRef.current) cancelAnimationFrame(rafRef.current);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [playing, tick]);

  // Redibuja al cambiar overlays mientras está pausado
  useEffect(() => { if (!playing && videoUrl) drawFrame(currentTime); }, [drawFrame, playing, videoUrl, currentTime]);

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

  // Construye (una sola vez) el grafo de audio: video + música + voz → gains → salida.
  // El mismo grafo sirve para escuchar en el preview y para exportar.
  const ensureAudioGraph = () => {
    const v = videoRef.current;
    if (!v) return null;
    if (!audioCtxRef.current) audioCtxRef.current = new AudioContext();
    const actx = audioCtxRef.current;
    try {
      if (!videoSourceRef.current) { videoSourceRef.current = actx.createMediaElementSource(v); v.muted = false; v.volume = 1; }
      if (!videoGainRef.current) { videoGainRef.current = actx.createGain(); videoSourceRef.current.connect(videoGainRef.current); videoGainRef.current.connect(actx.destination); }
      videoGainRef.current.gain.value = videoVolume;
    } catch {}
    if (musicUrl) {
      if (!musicElRef.current) { musicElRef.current = new Audio(musicUrl); musicElRef.current.crossOrigin = 'anonymous'; musicElRef.current.loop = true; }
      try {
        if (!musicSourceRef.current) musicSourceRef.current = actx.createMediaElementSource(musicElRef.current);
        if (!musicGainRef.current) { musicGainRef.current = actx.createGain(); musicSourceRef.current.connect(musicGainRef.current); musicGainRef.current.connect(actx.destination); }
        musicGainRef.current.gain.value = musicVolume;
      } catch {}
    }
    if (voiceUrl) {
      if (!voiceElRef.current) { voiceElRef.current = new Audio(voiceUrl); }
      try {
        if (!voiceSourceRef.current) voiceSourceRef.current = actx.createMediaElementSource(voiceElRef.current);
        if (!voiceGainRef.current) { voiceGainRef.current = actx.createGain(); voiceSourceRef.current.connect(voiceGainRef.current); voiceGainRef.current.connect(actx.destination); }
        voiceGainRef.current.gain.value = voiceVolume;
      } catch {}
    }
    return actx;
  };

  // Tiempo global (en el reel concatenado) en el que está parado el preview
  const globalOffsetActive = () => {
    let off = 0;
    for (let i = 0; i < activeIdx; i++) off += Math.max(0, (clips[i].trimEnd - clips[i].trimStart));
    return off;
  };
  // Crea (perezosamente) los elementos de audio para el preview nativo
  const ensureMusicEl = () => {
    if (musicUrl && !musicElRef.current) { musicElRef.current = new Audio(musicUrl); musicElRef.current.crossOrigin = 'anonymous'; musicElRef.current.loop = true; }
    return musicElRef.current;
  };
  const ensureVoiceEl = () => {
    if (voiceUrl && !voiceElRef.current) { voiceElRef.current = new Audio(voiceUrl); }
    return voiceElRef.current;
  };
  // Reproduce música/voz sincronizadas con el video (preview, audio nativo)
  const playBeds = () => {
    const pos = globalOffsetActive() + Math.max(0, (videoRef.current?.currentTime || 0) - trimStart);
    const m = ensureMusicEl();
    if (m && musicUrl) { if (!musicSourceRef.current) m.volume = musicVolume; const d = m.duration || 0; m.currentTime = d ? pos % d : 0; m.play().catch(() => {}); }
    const vo = ensureVoiceEl();
    if (vo && voiceUrl && pos <= (vo.duration || Infinity)) { if (!voiceSourceRef.current) vo.volume = voiceVolume; vo.currentTime = pos; vo.play().catch(() => {}); }
  };
  const pauseBeds = () => { musicElRef.current?.pause(); voiceElRef.current?.pause(); };

  const togglePlay = () => {
    const v = videoRef.current;
    if (!v) return;
    if (playing) { v.pause(); pauseBeds(); setPlaying(false); }
    else {
      // Preview con audio NATIVO (no WebAudio): evita cortes/distorsión por el dibujado del canvas.
      // El grafo WebAudio se arma solo al exportar.
      if (!videoSourceRef.current) { v.muted = videoVolume === 0; v.volume = videoVolume; }
      if (v.currentTime < trimStart || v.currentTime >= trimEnd) v.currentTime = trimStart;
      v.play();
      playBeds();
      setPlaying(true);
    }
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

  // Transcribe el audio del video con IA y crea los subtítulos cronometrados
  const generateSubtitles = async () => {
    if (!videoUrl) return;
    setTranscribing(true);
    try {
      const { base64 } = await getAudioWav(videoUrl);
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
      if (!segs.length) { alert('No se detectó voz para transcribir en este video.'); return; }
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

  // Analiza el audio del video y arma los segmentos a conservar quitando los silencios (tiempos muertos)
  const detectDeadTimes = async () => {
    if (!videoUrl) return;
    setAnalyzing(true);
    setCutMsg('');
    try {
      // Extrae el audio con ffmpeg (WAV PCM s16 mono 16kHz) — robusto para mp4/mov/webm
      const bytes = await getAudioBytes(videoUrl);
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      const sr = 16000;
      const header = 44;                 // WAV estándar
      const n = Math.max(0, Math.floor((bytes.byteLength - header) / 2));
      const win = Math.floor(sr * 0.05); // ventanas de 50ms
      const SILENCE = 0.015;             // umbral RMS de silencio
      const MIN_GAP = 0.45;              // pausa mínima a eliminar (s)
      const PAD = 0.08;                  // pequeño margen para no cortar abrupto

      // RMS por ventana → marca sonido/silencio
      const loud: boolean[] = [];
      for (let i = 0; i < n; i += win) {
        let sum = 0, c = 0;
        for (let j = i; j < i + win && j < n; j++) { const s = view.getInt16(header + j * 2, true) / 32768; sum += s * s; c++; }
        loud.push(Math.sqrt(sum / Math.max(1, c)) > SILENCE);
      }
      const winDur = win / sr;
      // Construye segmentos con sonido dentro del recorte [trimStart, trimEnd]
      const keep: { start: number; end: number }[] = [];
      let segStart: number | null = null;
      for (let k = 0; k < loud.length; k++) {
        const t = k * winDur;
        if (loud[k]) { if (segStart === null) segStart = t; }
        else if (segStart !== null) {
          if (t - segStart >= 0.2) keep.push({ start: Math.max(trimStart, segStart - PAD), end: Math.min(trimEnd, t + PAD) });
          segStart = null;
        }
      }
      if (segStart !== null) keep.push({ start: Math.max(trimStart, segStart - PAD), end: trimEnd });

      // Une segmentos muy cercanos (pausas menores al mínimo no se cortan)
      const merged: { start: number; end: number }[] = [];
      for (const s of keep) {
        if (s.end <= s.start) continue;
        const last = merged[merged.length - 1];
        if (last && s.start - last.end < MIN_GAP) last.end = s.end;
        else merged.push({ ...s });
      }

      const total = trimEnd - trimStart;
      const kept = merged.reduce((a, s) => a + (s.end - s.start), 0);
      const removed = Math.max(0, total - kept);
      if (merged.length === 0 || removed < 0.3) {
        setSegments(null);
        setCutMsg('No se detectaron pausas significativas para quitar.');
      } else {
        setSegments(merged);
        setCutMsg(`Detectamos ${merged.length} tramo(s) con contenido · se quitan ~${removed.toFixed(1)}s de pausas.`);
      }
    } catch (e) {
      setSegments(null);
      setCutMsg('No pudimos analizar el audio de este video (formato no compatible). Podés recortar manualmente.');
    } finally {
      setAnalyzing(false);
    }
  };

  // --- Voz en off ---
  const handleVoiceFile = (file: File) => {
    try { voiceSourceRef.current?.disconnect(); voiceGainRef.current?.disconnect(); } catch {}
    setVoiceUrl(URL.createObjectURL(file));
    setVoiceName(file.name);
    voiceElRef.current = null;
    voiceSourceRef.current = null;
    voiceGainRef.current = null;
  };
  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream);
      micChunksRef.current = [];
      rec.ondataavailable = (e) => { if (e.data.size > 0) micChunksRef.current.push(e.data); };
      rec.onstop = () => {
        stream.getTracks().forEach(t => t.stop());
        const blob = new Blob(micChunksRef.current, { type: 'audio/webm' });
        try { voiceSourceRef.current?.disconnect(); voiceGainRef.current?.disconnect(); } catch {}
        setVoiceUrl(URL.createObjectURL(blob));
        setVoiceName('Grabación de voz');
        voiceElRef.current = null;
        voiceSourceRef.current = null;
        voiceGainRef.current = null;
      };
      micRecorderRef.current = rec;
      rec.start();
      setRecording(true);
    } catch {
      alert('No se pudo acceder al micrófono. Revisá los permisos del navegador.');
    }
  };
  const stopRecording = () => { micRecorderRef.current?.stop(); setRecording(false); };
  const removeVoice = () => { voiceElRef.current?.pause(); try { voiceSourceRef.current?.disconnect(); voiceGainRef.current?.disconnect(); } catch {} setVoiceUrl(null); setVoiceName(''); voiceElRef.current = null; voiceSourceRef.current = null; voiceGainRef.current = null; };

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
  const getAudioBytes = async (url: string): Promise<Uint8Array> => {
    const ffmpeg = await loadFFmpeg();
    const blob = await (await fetch(url)).blob();
    const t = (blob.type || '').toLowerCase();
    const ext = t.includes('quicktime') || t.includes('mov') ? 'mov' : t.includes('webm') ? 'webm' : t.includes('matroska') ? 'mkv' : 'mp4';
    const inName = `aud_src.${ext}`;
    await ffmpeg.writeFile(inName, await fetchFile(blob));
    ffmpegLogRef.current = '';
    const code = await ffmpeg.exec(['-i', inName, '-vn', '-ac', '1', '-ar', '16000', '-f', 'wav', 'aud_out.wav']);
    if (typeof code === 'number' && code !== 0) {
      const log = ffmpegLogRef.current.toLowerCase();
      if (log.includes('does not contain any stream') || log.includes('output file does not contain') || log.includes('no audio')) {
        throw new Error('Este video no tiene pista de audio, así que no hay voz para transcribir.');
      }
      throw new Error('ffmpeg no pudo procesar el audio (código ' + code + ').');
    }
    let data: any;
    try {
      data = await ffmpeg.readFile('aud_out.wav');
    } catch {
      throw new Error('Este video no tiene pista de audio, así que no hay voz para transcribir.');
    }
    const bytes = (data instanceof Uint8Array) ? data : new Uint8Array(data as any);
    if (!bytes || bytes.byteLength < 200) throw new Error('Este video no tiene pista de audio (o está en silencio), así que no hay voz para transcribir.');
    return bytes;
  };
  // Solo para transcripción: agrega el base64 (caro), por eso no se usa para la onda.
  const getAudioWav = async (url: string): Promise<{ base64: string; bytes: Uint8Array }> => {
    const bytes = await getAudioBytes(url);
    return { base64: bytesToBase64(bytes), bytes };
  };

  const exportReel = async () => {
    const v = videoRef.current;
    const canvas = canvasRef.current;
    if (!v || !canvas) return;
    setExporting(true);
    setExportedUrl(null);
    setExportPct(0);
    setExportMsg('Preparando grabación…');

    try {
      // Asegura que la tipografía de los subtítulos esté cargada antes de grabar
      try { await (document as any).fonts?.load(`900 74px "${subFont}"`); } catch {}

      const canvasStream = (canvas as any).captureStream(FPS) as MediaStream;
      const tracks: MediaStreamTrack[] = [canvasStream.getVideoTracks()[0]];

      // Mezcla de audio: reutiliza el MISMO grafo que el preview (un solo camino → sin eco)
      const actx = ensureAudioGraph();
      if (!actx) throw new Error('No se pudo iniciar el audio.');
      if (actx.state === 'suspended') await actx.resume();
      const dest = actx.createMediaStreamDestination();
      let hasAudio = false;

      // Conecta cada gain también al destino de grabación (además del monitor del preview)
      if (videoGainRef.current) { videoGainRef.current.gain.value = videoVolume; videoGainRef.current.connect(dest); hasAudio = true; }
      if (musicUrl && musicElRef.current && musicGainRef.current) { musicElRef.current.currentTime = 0; musicGainRef.current.gain.value = musicVolume; musicGainRef.current.connect(dest); hasAudio = true; }
      if (voiceUrl && voiceElRef.current && voiceGainRef.current) { voiceElRef.current.currentTime = 0; voiceGainRef.current.gain.value = voiceVolume; voiceGainRef.current.connect(dest); hasAudio = true; }

      if (hasAudio) tracks.push(dest.stream.getAudioTracks()[0]);

      const combined = new MediaStream(tracks);
      // Si el navegador puede grabar MP4 nativo, lo usamos y nos salteamos la conversión con ffmpeg (mucho más rápido).
      const mp4Mime = ['video/mp4;codecs=h264,aac', 'video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4']
        .find(m => { try { return MediaRecorder.isTypeSupported(m); } catch { return false; } });
      const webmMime = MediaRecorder.isTypeSupported('video/webm;codecs=vp9,opus') ? 'video/webm;codecs=vp9,opus' : 'video/webm';
      const isMp4 = !!mp4Mime;
      const recMime = mp4Mime || webmMime;
      const recorder = new MediaRecorder(combined, { mimeType: recMime });
      const chunks: Blob[] = [];
      recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };

      const stopped = new Promise<Blob>((resolve) => {
        recorder.onstop = () => resolve(new Blob(chunks, { type: isMp4 ? 'video/mp4' : 'video/webm' }));
      });

      // Rangos a grabar: si hay 1 clip con pausas detectadas, sus segmentos; si no, el recorte de cada clip (concatenados)
      let ranges: { url: string; start: number; end: number }[];
      if (clips.length === 1 && segments && segments.length) {
        ranges = segments.map(s => ({ url: clips[0].url, start: s.start, end: s.end }));
      } else {
        ranges = clips.map(c => ({ url: c.url, start: c.trimStart, end: c.trimEnd }));
      }

      // Duración total a grabar (para el progreso 0→70%)
      const totalDur = Math.max(0.1, ranges.reduce((acc, r) => acc + Math.max(0, r.end - r.start), 0));
      let elapsedBefore = 0;

      setExportMsg('Grabando el reel… 0%');
      setExportPct(0);
      recorder.start(100);
      if (musicUrl && musicElRef.current) musicElRef.current.play().catch(() => {});
      if (voiceUrl && voiceElRef.current) voiceElRef.current.play().catch(() => {});

      // Reproduce cada rango en orden (cambiando de clip si hace falta); la grabación es continua → quedan unidos
      for (const range of ranges) {
        if (v.src !== range.url) {
          v.src = range.url;
          await new Promise<void>((res) => { const h = () => { v.removeEventListener('loadeddata', h); res(); }; v.addEventListener('loadeddata', h); });
        }
        v.currentTime = range.start;
        await new Promise<void>((res) => { v.onseeked = () => res(); });
        await v.play().catch(() => {});
        await new Promise<void>((resolve) => {
          let lastUi = 0;
          const step = () => {
            drawFrame(v.currentTime);
            // El estado se actualiza como mucho cada 250ms para no recargar React en cada frame (evita el tirón).
            const now = performance.now();
            if (now - lastUi > 250) {
              lastUi = now;
              const done = elapsedBefore + Math.max(0, v.currentTime - range.start);
              const pct = Math.min(69, Math.round((done / totalDur) * 70));
              setExportPct(pct);
              setExportMsg(`Grabando el reel… ${pct}%`);
            }
            if (v.currentTime >= range.end || v.ended) { v.pause(); resolve(); return; }
            requestAnimationFrame(step);
          };
          requestAnimationFrame(step);
        });
        elapsedBefore += Math.max(0, range.end - range.start);
      }
      setExportPct(70);
      // Restaura el clip activo en la previsualización
      if (activeClip && v.src !== activeClip.url) v.src = activeClip.url;
      if (musicElRef.current) musicElRef.current.pause();
      if (voiceElRef.current) voiceElRef.current.pause();

      recorder.stop();
      const recBlob = await stopped;

      // Desconecta los gains del destino de grabación (el monitor del preview queda intacto)
      try { videoGainRef.current?.disconnect(dest); } catch {}
      try { musicGainRef.current?.disconnect(dest); } catch {}
      try { voiceGainRef.current?.disconnect(dest); } catch {}

      let mp4Blob: Blob;
      if (isMp4) {
        // El navegador ya grabó MP4: no hace falta convertir.
        setExportPct(98);
        setExportMsg('Finalizando…');
        mp4Blob = recBlob;
      } else {
        setExportMsg('Cargando conversor de video…');
        const ffmpeg = await loadFFmpeg();
        await ffmpeg.writeFile('in.webm', await fetchFile(recBlob));
        setExportMsg('Convirtiendo a MP4…');
        // preset ultrafast: la conversión en WASM es mucho más rápida (el cuello de botella anterior).
        await ffmpeg.exec(['-i', 'in.webm', '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '23', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', 'out.mp4']);
        const data = await ffmpeg.readFile('out.mp4');
        mp4Blob = new Blob([data as unknown as BlobPart], { type: 'video/mp4' });
      }
      const url = URL.createObjectURL(mp4Blob);
      setExportedUrl(url);
      setExportPct(100);
      setExportMsg('¡Listo! Tu reel está disponible para descargar.');
    } catch (e: any) {
      console.error(e);
      setExportMsg('');
      alert(`No se pudo exportar el reel: ${e?.message || 'error desconocido'}`);
    } finally {
      setExporting(false);
      setPlaying(false);
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
              <i className="fa-solid fa-arrow-up-from-bracket"></i> Subir video
              <input type="file" accept="video/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleVideoFile(f); }} />
            </label>
          </div>
        ) : (
          <div className="max-w-6xl mx-auto p-5 sm:p-8 grid grid-cols-1 lg:grid-cols-2 gap-8">
            {/* Preview + línea de tiempo */}
            <div className="space-y-4 lg:sticky lg:top-4 lg:self-start">
              <div className="relative bg-black rounded-3xl overflow-hidden mx-auto" style={{ aspectRatio: '9/16', maxHeight: '54vh' }}>
                <canvas ref={canvasRef} width={CANVAS_W} height={CANVAS_H} className="w-full h-full object-contain" />
                <video ref={videoRef} src={videoUrl} onLoadedMetadata={onLoadedMetadata} className="hidden" playsInline crossOrigin="anonymous" />
              </div>
              <div className="flex items-center gap-3">
                <button onClick={togglePlay} className="w-12 h-12 bg-slate-900 text-white rounded-2xl flex items-center justify-center active:scale-95 transition-all shrink-0">
                  <i className={`fa-solid ${playing ? 'fa-pause' : 'fa-play'}`}></i>
                </button>
                <input type="range" min={0} max={duration || 0} step={0.05} value={currentTime} onChange={(e) => seek(Number(e.target.value))} className="flex-1 h-1.5 accent-purple-600 bg-slate-100 rounded-full appearance-none cursor-pointer" />
                <span className="text-[10px] font-black text-slate-400 tabular-nums shrink-0">{fmt(currentTime)} / {fmt(duration)}</span>
              </div>

              {/* Clips */}
              <div className="space-y-2">
                <span className={labelClass}>Clips ({clips.length})</span>
                <div className="flex gap-2 flex-wrap items-center">
                  {clips.map((c, i) => (
                    <div key={c.id} className={`flex items-center gap-2 rounded-xl border-2 px-3 py-2 text-[10px] font-black uppercase tracking-wider transition-all ${i === activeIdx ? 'border-purple-600 bg-purple-50 text-purple-700' : 'border-slate-100 bg-slate-50 text-slate-500'}`}>
                      <button onClick={() => setActiveIdx(i)}><i className="fa-solid fa-film mr-1"></i>Clip {i + 1}</button>
                      {clips.length > 1 && <button onClick={() => removeClip(c.id)} className="text-red-400 hover:text-red-600"><i className="fa-solid fa-xmark"></i></button>}
                    </div>
                  ))}
                  <label className="rounded-xl border-2 border-dashed border-purple-200 text-purple-600 px-3 py-2 text-[10px] font-black uppercase tracking-wider cursor-pointer hover:bg-purple-50 transition-all">
                    <i className="fa-solid fa-plus mr-1"></i>Video
                    <input type="file" accept="video/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) addClip(f); e.currentTarget.value = ''; }} />
                  </label>
                </div>
                {clips.length > 1 && <p className="text-[9px] text-slate-300 font-bold">Seleccioná un clip para recortarlo. Se exportan unidos, en orden.</p>}
              </div>

              {/* Línea de tiempo */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className={labelClass}>Línea de tiempo</span>
                  <button onClick={splitActive} className="px-3 py-1.5 bg-purple-50 text-purple-600 rounded-lg text-[9px] font-black uppercase tracking-widest hover:bg-purple-100 transition-all"><i className="fa-solid fa-scissors mr-1.5"></i>Dividir acá</button>
                </div>
                <div ref={trackRef} onPointerDown={onTimelinePointerDown} onPointerMove={onTimelinePointerMove} onPointerUp={endDrag} onPointerLeave={endDrag} className="overflow-x-auto bg-slate-900 rounded-2xl p-2 select-none touch-none cursor-pointer">
                  <div className="relative" style={{ width: Math.max(40, clips.reduce((a, c) => a + (c.duration || 0) * TL_PX, 0)) }}>
                    {/* Pista de video */}
                    <div className="relative h-14">
                      {clips.map((c, idx) => {
                        const left = clipLeftPx(idx);
                        const width = (c.duration || 0) * TL_PX;
                        return (
                          <div key={c.id} onClick={() => setActiveIdx(idx)} className={`absolute top-0 h-14 rounded-lg overflow-hidden border-2 ${idx === activeIdx ? 'border-purple-400' : 'border-slate-700'}`} style={{ left, width }}>
                            <div className="absolute inset-0 bg-purple-950/60" />
                            <div className="absolute top-0 bottom-0 bg-purple-600/60 flex items-center" style={{ left: c.trimStart * TL_PX, width: Math.max(0, (c.trimEnd - c.trimStart) * TL_PX) }}>
                              <span className="text-[8px] text-white font-black uppercase px-2 truncate">Clip {idx + 1}</span>
                            </div>
                            <div onPointerDown={(e) => { e.stopPropagation(); draggingRef.current = { clipId: c.id, edge: 'start' }; setActiveIdx(idx); }} className="absolute top-0 bottom-0 w-2.5 bg-white rounded cursor-ew-resize flex items-center justify-center z-10" style={{ left: c.trimStart * TL_PX - 5 }}><div className="w-0.5 h-5 bg-purple-600" /></div>
                            <div onPointerDown={(e) => { e.stopPropagation(); draggingRef.current = { clipId: c.id, edge: 'end' }; setActiveIdx(idx); }} className="absolute top-0 bottom-0 w-2.5 bg-white rounded cursor-ew-resize flex items-center justify-center z-10" style={{ left: c.trimEnd * TL_PX - 5 }}><div className="w-0.5 h-5 bg-purple-600" /></div>
                          </div>
                        );
                      })}
                    </div>
                    {/* Pista de audio (onda) */}
                    <div className="relative h-10 mt-1.5">
                      {clips.map((c, idx) => {
                        const left = clipLeftPx(idx);
                        const width = (c.duration || 0) * TL_PX;
                        const peaks = clipPeaks[c.id];
                        return (
                          <div key={c.id} onClick={() => setActiveIdx(idx)} className={`absolute top-0 h-10 rounded-lg overflow-hidden border ${idx === activeIdx ? 'border-emerald-400/70' : 'border-slate-700'}`} style={{ left, width }}>
                            <div className="absolute inset-0 bg-emerald-950/40" />
                            {peaks ? (
                              <div className="absolute inset-0 flex items-center gap-px px-px">
                                {peaks.map((p, i) => {
                                  const tt = (i / peaks.length) * (c.duration || 0);
                                  const inTrim = tt >= c.trimStart && tt <= c.trimEnd;
                                  return <div key={i} className="flex-1 rounded-full" style={{ height: `${Math.max(6, p * 100)}%`, background: inTrim ? '#34d399' : '#475569' }} />;
                                })}
                              </div>
                            ) : (
                              <div className="absolute inset-0 flex items-center justify-center">
                                <span className="text-[8px] text-emerald-300/50 font-black uppercase tracking-widest"><i className="fa-solid fa-circle-notch fa-spin mr-1"></i>Audio</span>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                    {/* Cabezal (cruza ambas pistas) */}
                    <div className="absolute top-0 bottom-0 w-0.5 bg-yellow-300 pointer-events-none z-20" style={{ left: clipLeftPx(activeIdx) + currentTime * TL_PX }} />
                  </div>
                </div>
                <p className="text-[9px] text-slate-300 font-bold">Arriba el video, abajo la onda de audio. Arrastrá los bordes blancos para recortar desde las puntas. Tocá la timeline para mover el cabezal. Para dividir, ubicá el cabezal y tocá "Dividir acá".</p>
              </div>
            </div>

            {/* Controles (desplegables) */}
            <div className="space-y-3">
              {/* Recorte */}
              <Accordion title="Recorte" icon="fa-crop-simple" open={!!openSec.recorte} onToggle={() => toggleSec('recorte')}>
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-[10px] font-bold text-slate-400"><span>Inicio: {fmt(trimStart)}</span>{clips.length > 1 && <span className="text-purple-500">Clip {activeIdx + 1}</span>}</div>
                  <input type="range" min={0} max={duration || 0} step={0.1} value={trimStart} onChange={(e) => { const val = Math.min(Number(e.target.value), trimEnd - 0.5); setTrimStart(val); seek(val); }} className="w-full h-1.5 accent-purple-600 bg-slate-100 rounded-full appearance-none cursor-pointer" />
                  <div className="flex items-center justify-between text-[10px] font-bold text-slate-400"><span>Fin: {fmt(trimEnd)}</span></div>
                  <input type="range" min={0} max={duration || 0} step={0.1} value={trimEnd} onChange={(e) => setTrimEnd(Math.max(Number(e.target.value), trimStart + 0.5))} className="w-full h-1.5 accent-purple-600 bg-slate-100 rounded-full appearance-none cursor-pointer" />
                </div>
              </Accordion>

              {/* Tiempos muertos */}
              <Accordion title="Quitar tiempos muertos" icon="fa-scissors" open={!!openSec.pausas} onToggle={() => toggleSec('pausas')} badge={segments ? `${segments.length} tramos` : undefined}>
                <p className="text-[10px] text-slate-400 font-bold leading-relaxed">Analizamos el audio y eliminamos las pausas/silencios para un reel más dinámico.</p>
                {segments ? (
                  <div className="flex items-center justify-between bg-purple-50 rounded-xl border border-purple-100 px-3 py-2.5">
                    <span className="text-[11px] font-black text-purple-700"><i className="fa-solid fa-scissors mr-1.5"></i>{segments.length} tramos · pausas quitadas</span>
                    <button onClick={() => { setSegments(null); setCutMsg(''); }} className="text-[9px] font-black uppercase tracking-widest text-slate-400 hover:text-red-500 transition-colors">Deshacer</button>
                  </div>
                ) : (
                  <button onClick={detectDeadTimes} disabled={analyzing} className="w-full py-2.5 text-purple-600 text-[9px] font-black uppercase tracking-widest hover:bg-purple-50 rounded-xl transition-all border border-purple-100 border-dashed disabled:opacity-50">
                    {analyzing ? <><i className="fa-solid fa-circle-notch fa-spin mr-1"></i>Analizando audio…</> : <><i className="fa-solid fa-scissors mr-1"></i>Detectar y quitar pausas</>}
                  </button>
                )}
                {cutMsg && <p className="text-[10px] text-slate-400 font-bold">{cutMsg}</p>}
              </Accordion>

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
                    <div className="flex items-center justify-between bg-slate-50 rounded-xl px-3 py-2 border border-slate-100">
                      <span className="text-xs font-bold text-slate-600 truncate"><i className="fa-solid fa-music text-purple-500 mr-2"></i>{musicName}</span>
                      <button onClick={() => { musicElRef.current?.pause(); try { musicSourceRef.current?.disconnect(); musicGainRef.current?.disconnect(); } catch {} setMusicUrl(null); setMusicName(''); musicElRef.current = null; musicSourceRef.current = null; musicGainRef.current = null; }} className="text-red-400 hover:text-red-600 text-xs"><i className="fa-solid fa-xmark"></i></button>
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
                    <div className="flex items-center justify-between bg-slate-50 rounded-xl px-3 py-2 border border-slate-100">
                      <span className="text-xs font-bold text-slate-600 truncate"><i className="fa-solid fa-microphone-lines text-emerald-500 mr-2"></i>{voiceName}</span>
                      <button onClick={removeVoice} className="text-red-400 hover:text-red-600 text-xs"><i className="fa-solid fa-xmark"></i></button>
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
                </Accordion>
              )}

              {/* Subtítulos */}
              <Accordion title="Subtítulos" icon="fa-closed-captioning" open={!!openSec.subtitulos} onToggle={() => toggleSec('subtitulos')} badge={subtitles.length ? String(subtitles.length) : undefined}>
                <div className="flex items-center justify-end gap-2">
                  <input type="color" value={subColor} onChange={(e) => setSubColor(e.target.value)} className="w-7 h-7 rounded-lg border border-slate-200 cursor-pointer" title="Color del texto" />
                  <button onClick={addSubtitle} className="px-3 py-1.5 bg-purple-50 text-purple-600 rounded-lg text-[9px] font-black uppercase tracking-widest hover:bg-purple-100 transition-all">+ En {fmt(currentTime)}</button>
                </div>

                {/* Auto-subtítulos con IA */}
                <button onClick={generateSubtitles} disabled={transcribing} className="w-full py-2.5 bg-gradient-to-r from-purple-600 to-violet-500 text-white rounded-xl text-[9px] font-black uppercase tracking-widest shadow-md shadow-purple-200/50 active:scale-95 disabled:opacity-50 transition-all">
                  {transcribing ? <><i className="fa-solid fa-circle-notch fa-spin mr-1.5"></i>Transcribiendo el audio…</> : <><i className="fa-solid fa-wand-magic-sparkles mr-1.5"></i>Generar subtítulos del audio</>}
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
