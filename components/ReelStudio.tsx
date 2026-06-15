import React, { useState, useRef, useEffect, useCallback } from 'react';
import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';
import { UserProfile } from '../types';

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

const CANVAS_W = 1080;
const CANVAS_H = 1920;
const FPS = 30;
const CORE_VERSION = '0.12.10';
const CORE_BASE = `https://unpkg.com/@ffmpeg/core@${CORE_VERSION}/dist/umd`;

const fmt = (s: number) => {
  if (!isFinite(s) || s < 0) s = 0;
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, '0')}`;
};

const ReelStudio: React.FC<ReelStudioProps> = ({ profile, onClose, initialCopy }) => {
  const kit = profile?.brandKits?.[0];

  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [duration, setDuration] = useState(0);
  const [trimStart, setTrimStart] = useState(0);
  const [trimEnd, setTrimEnd] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [playing, setPlaying] = useState(false);

  const [musicUrl, setMusicUrl] = useState<string | null>(null);
  const [musicName, setMusicName] = useState('');
  const [musicVolume, setMusicVolume] = useState(0.8);

  const [subtitles, setSubtitles] = useState<Subtitle[]>([]);
  const [subColor, setSubColor] = useState(kit?.headlineColor || '#FFFFFF');
  const subFont = kit?.headlineFont || 'Inter';

  const [logoEnabled, setLogoEnabled] = useState(false);

  // Segmentos a conservar (para cortes / quitar tiempos muertos). null = video completo recortado.
  const [segments, setSegments] = useState<{ start: number; end: number }[] | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [cutMsg, setCutMsg] = useState('');

  const [exporting, setExporting] = useState(false);
  const [exportMsg, setExportMsg] = useState('');
  const [exportedUrl, setExportedUrl] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const logoImgRef = useRef<HTMLImageElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const ffmpegRef = useRef<FFmpeg | null>(null);
  const musicElRef = useRef<HTMLAudioElement | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const musicSourceRef = useRef<MediaElementAudioSourceNode | null>(null);

  // Carga del logo de marca para el overlay
  useEffect(() => {
    const url = kit?.logoUrls?.[0];
    if (!url) { logoImgRef.current = null; return; }
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => { logoImgRef.current = img; };
    img.src = url;
  }, [kit?.logoUrls]);

  const handleVideoFile = (file: File) => {
    const url = URL.createObjectURL(file);
    setVideoUrl(url);
    setExportedUrl(null);
  };

  const handleMusicFile = (file: File) => {
    const url = URL.createObjectURL(file);
    setMusicUrl(url);
    setMusicName(file.name);
  };

  const onLoadedMetadata = () => {
    const v = videoRef.current;
    if (!v) return;
    setDuration(v.duration);
    setTrimStart(0);
    setTrimEnd(v.duration);
  };

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

    // Subtítulo activo
    const active = subtitles.find(s => t >= s.start && t <= s.end);
    if (active && active.text.trim()) {
      const fontSize = 64;
      ctx.font = `700 ${fontSize}px ${subFont}, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      const maxWidth = CANVAS_W * 0.86;
      const words = active.text.split(/\s+/);
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
      const baseY = CANVAS_H * 0.82 - blockH / 2;

      lines.forEach((ln, i) => {
        const y = baseY + i * lineH + lineH / 2;
        const w = ctx.measureText(ln).width;
        ctx.fillStyle = 'rgba(0,0,0,0.55)';
        ctx.fillRect((CANVAS_W - w) / 2 - 24, y - lineH / 2, w + 48, lineH);
      });
      ctx.fillStyle = subColor;
      lines.forEach((ln, i) => {
        const y = baseY + i * lineH + lineH / 2;
        ctx.fillText(ln, CANVAS_W / 2, y);
      });
    }
  }, [logoEnabled, subtitles, subColor, subFont]);

  // Loop de previsualización
  const tick = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    setCurrentTime(v.currentTime);
    drawFrame(v.currentTime);
    if (v.currentTime >= trimEnd) {
      v.pause();
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

  const togglePlay = () => {
    const v = videoRef.current;
    if (!v) return;
    if (playing) { v.pause(); setPlaying(false); }
    else {
      if (v.currentTime < trimStart || v.currentTime >= trimEnd) v.currentTime = trimStart;
      v.play();
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

  // Analiza el audio del video y arma los segmentos a conservar quitando los silencios (tiempos muertos)
  const detectDeadTimes = async () => {
    if (!videoUrl) return;
    setAnalyzing(true);
    setCutMsg('');
    try {
      const buf = await (await fetch(videoUrl)).arrayBuffer();
      const actx = new AudioContext();
      const audio = await actx.decodeAudioData(buf.slice(0));
      const data = audio.getChannelData(0);
      const sr = audio.sampleRate;
      const win = Math.floor(sr * 0.05); // ventanas de 50ms
      const SILENCE = 0.015;             // umbral RMS de silencio
      const MIN_GAP = 0.45;              // pausa mínima a eliminar (s)
      const PAD = 0.08;                  // pequeño margen para no cortar abrupto

      // RMS por ventana → marca sonido/silencio
      const loud: boolean[] = [];
      for (let i = 0; i < data.length; i += win) {
        let sum = 0;
        for (let j = i; j < i + win && j < data.length; j++) sum += data[j] * data[j];
        loud.push(Math.sqrt(sum / win) > SILENCE);
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
      actx.close();

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

  const loadFFmpeg = async () => {
    if (ffmpegRef.current) return ffmpegRef.current;
    const ffmpeg = new FFmpeg();
    ffmpeg.on('progress', ({ progress }) => {
      setExportMsg(`Convirtiendo a MP4… ${Math.min(100, Math.round(progress * 100))}%`);
    });
    await ffmpeg.load({
      coreURL: await toBlobURL(`${CORE_BASE}/ffmpeg-core.js`, 'text/javascript'),
      wasmURL: await toBlobURL(`${CORE_BASE}/ffmpeg-core.wasm`, 'application/wasm'),
    });
    ffmpegRef.current = ffmpeg;
    return ffmpeg;
  };

  const exportReel = async () => {
    const v = videoRef.current;
    const canvas = canvasRef.current;
    if (!v || !canvas) return;
    setExporting(true);
    setExportedUrl(null);
    setExportMsg('Preparando grabación…');

    try {
      const canvasStream = (canvas as any).captureStream(FPS) as MediaStream;
      const tracks: MediaStreamTrack[] = [canvasStream.getVideoTracks()[0]];

      // Audio: música (vía WebAudio) o audio propio del video
      if (musicUrl) {
        if (!audioCtxRef.current) audioCtxRef.current = new AudioContext();
        const actx = audioCtxRef.current;
        if (actx.state === 'suspended') await actx.resume();
        if (!musicElRef.current) {
          musicElRef.current = new Audio(musicUrl);
          musicElRef.current.crossOrigin = 'anonymous';
        }
        const musicEl = musicElRef.current;
        musicEl.currentTime = 0;
        if (!musicSourceRef.current) {
          musicSourceRef.current = actx.createMediaElementSource(musicEl);
        }
        const gain = actx.createGain();
        gain.gain.value = musicVolume;
        const dest = actx.createMediaStreamDestination();
        musicSourceRef.current.connect(gain);
        gain.connect(dest);
        tracks.push(dest.stream.getAudioTracks()[0]);
      } else {
        const vStream = (v as any).captureStream?.() as MediaStream | undefined;
        const aT = vStream?.getAudioTracks?.()[0];
        if (aT) tracks.push(aT);
      }

      const combined = new MediaStream(tracks);
      const mime = MediaRecorder.isTypeSupported('video/webm;codecs=vp9,opus')
        ? 'video/webm;codecs=vp9,opus'
        : 'video/webm';
      const recorder = new MediaRecorder(combined, { mimeType: mime });
      const chunks: Blob[] = [];
      recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };

      const stopped = new Promise<Blob>((resolve) => {
        recorder.onstop = () => resolve(new Blob(chunks, { type: 'video/webm' }));
      });

      // Segmentos a grabar: los detectados (sin pausas) o el recorte completo
      const segs = (segments && segments.length) ? segments : [{ start: trimStart, end: trimEnd }];

      setExportMsg('Grabando el reel…');
      recorder.start(100);
      if (musicUrl && musicElRef.current) musicElRef.current.play().catch(() => {});

      // Reproduce cada segmento en orden; la grabación es continua → quedan unidos sin las pausas
      for (const seg of segs) {
        v.currentTime = seg.start;
        await new Promise<void>((res) => { v.onseeked = () => res(); });
        await v.play().catch(() => {});
        await new Promise<void>((resolve) => {
          const step = () => {
            drawFrame(v.currentTime);
            if (v.currentTime >= seg.end || v.ended) { v.pause(); resolve(); return; }
            requestAnimationFrame(step);
          };
          requestAnimationFrame(step);
        });
      }
      if (musicElRef.current) musicElRef.current.pause();

      recorder.stop();
      const webmBlob = await stopped;

      setExportMsg('Cargando conversor de video…');
      const ffmpeg = await loadFFmpeg();
      await ffmpeg.writeFile('in.webm', await fetchFile(webmBlob));
      setExportMsg('Convirtiendo a MP4…');
      await ffmpeg.exec(['-i', 'in.webm', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-movflags', '+faststart', 'out.mp4']);
      const data = await ffmpeg.readFile('out.mp4');
      const mp4Blob = new Blob([data as unknown as BlobPart], { type: 'video/mp4' });
      const url = URL.createObjectURL(mp4Blob);
      setExportedUrl(url);
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
        {!videoUrl ? (
          <div className="h-full flex flex-col items-center justify-center p-8 text-center gap-5">
            <div className="w-20 h-20 bg-purple-50 text-purple-300 rounded-[32px] flex items-center justify-center"><i className="fa-solid fa-film text-3xl"></i></div>
            <div className="space-y-1">
              <h3 className="font-display text-2xl text-slate-900">Subí un video para empezar</h3>
              <p className="text-slate-400 text-sm">Lo recortamos a formato Reel (9:16) y le sumás música y subtítulos.</p>
            </div>
            <label className="px-6 h-14 bg-purple-600 text-white rounded-2xl text-[11px] font-black uppercase tracking-[0.2em] shadow-xl active:scale-95 transition-all flex items-center gap-3 cursor-pointer">
              <i className="fa-solid fa-arrow-up-from-bracket"></i> Subir video
              <input type="file" accept="video/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleVideoFile(f); }} />
            </label>
          </div>
        ) : (
          <div className="max-w-5xl mx-auto p-5 sm:p-8 grid grid-cols-1 lg:grid-cols-2 gap-8">
            {/* Preview */}
            <div className="space-y-4">
              <div className="relative bg-black rounded-3xl overflow-hidden mx-auto" style={{ aspectRatio: '9/16', maxHeight: '60vh' }}>
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
            </div>

            {/* Controls */}
            <div className="space-y-7">
              {/* Recorte */}
              <div className="space-y-3">
                <span className={labelClass}>Recorte</span>
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-[10px] font-bold text-slate-400"><span>Inicio: {fmt(trimStart)}</span></div>
                  <input type="range" min={0} max={duration || 0} step={0.1} value={trimStart} onChange={(e) => { const val = Math.min(Number(e.target.value), trimEnd - 0.5); setTrimStart(val); seek(val); }} className="w-full h-1.5 accent-purple-600 bg-slate-100 rounded-full appearance-none cursor-pointer" />
                  <div className="flex items-center justify-between text-[10px] font-bold text-slate-400"><span>Fin: {fmt(trimEnd)}</span></div>
                  <input type="range" min={0} max={duration || 0} step={0.1} value={trimEnd} onChange={(e) => setTrimEnd(Math.max(Number(e.target.value), trimStart + 0.5))} className="w-full h-1.5 accent-purple-600 bg-slate-100 rounded-full appearance-none cursor-pointer" />
                </div>
              </div>

              {/* Tiempos muertos */}
              <div className="space-y-2">
                <span className={labelClass}>Quitar tiempos muertos</span>
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
              </div>

              {/* Música */}
              <div className="space-y-3">
                <span className={labelClass}>Música</span>
                {musicUrl ? (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between bg-slate-50 rounded-xl px-3 py-2 border border-slate-100">
                      <span className="text-xs font-bold text-slate-600 truncate"><i className="fa-solid fa-music text-purple-500 mr-2"></i>{musicName}</span>
                      <button onClick={() => { setMusicUrl(null); setMusicName(''); musicElRef.current = null; musicSourceRef.current = null; }} className="text-red-400 hover:text-red-600 text-xs"><i className="fa-solid fa-xmark"></i></button>
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
              </div>

              {/* Logo */}
              {kit?.logoUrls?.[0] && (
                <div className="flex items-center justify-between">
                  <span className={labelClass}>Logo de marca</span>
                  <button onClick={() => setLogoEnabled(!logoEnabled)} className={`w-11 h-6 rounded-full transition-all relative ${logoEnabled ? 'bg-purple-600' : 'bg-slate-300'}`}>
                    <div className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${logoEnabled ? 'translate-x-5' : 'translate-x-0.5'}`} />
                  </button>
                </div>
              )}

              {/* Subtítulos */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className={labelClass}>Subtítulos</span>
                  <div className="flex items-center gap-2">
                    <input type="color" value={subColor} onChange={(e) => setSubColor(e.target.value)} className="w-7 h-7 rounded-lg border border-slate-200 cursor-pointer" title="Color del texto" />
                    <button onClick={addSubtitle} className="px-3 py-1.5 bg-purple-50 text-purple-600 rounded-lg text-[9px] font-black uppercase tracking-widest hover:bg-purple-100 transition-all">+ En {fmt(currentTime)}</button>
                  </div>
                </div>
                <div className="space-y-2">
                  {subtitles.length === 0 && <p className="text-[10px] text-slate-300 font-bold">Movete por el video y agregá subtítulos en el momento que quieras.</p>}
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
              </div>

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
