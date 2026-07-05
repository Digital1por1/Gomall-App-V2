// === Motor de render multi-track (Fase 2) ===
// Compone un frame del timeline (todas las pistas visuales) sobre un canvas 2D, en el tiempo t.
// Se usa tanto para el preview en vivo como para el export (frame por frame).

import {
  ReelProject, ReelElement, VideoElement, ImageElement, TextElement,
  visualsAt, canvasSize,
} from './model';

// Pool de elementos <video>/<img> por URL, reutilizados entre frames (crearlos por frame sería carísimo).
export class MediaPool {
  private videos = new Map<string, HTMLVideoElement>();
  private images = new Map<string, HTMLImageElement>();

  getVideo(url: string): HTMLVideoElement {
    let v = this.videos.get(url);
    if (!v) {
      v = document.createElement('video');
      v.src = url; v.crossOrigin = 'anonymous'; v.muted = true; v.playsInline = true; v.preload = 'auto';
      v.style.cssText = 'position:fixed;left:-10000px;top:0;width:2px;height:2px;opacity:0;pointer-events:none;';
      document.body.appendChild(v);
      this.videos.set(url, v);
    }
    return v;
  }
  getImage(url: string): HTMLImageElement {
    let img = this.images.get(url);
    if (!img) {
      img = new Image(); img.crossOrigin = 'anonymous'; img.src = url;
      this.images.set(url, img);
    }
    return img;
  }
  hasReady(url: string): boolean {
    const v = this.videos.get(url);
    if (v) return v.readyState >= 2;
    const img = this.images.get(url);
    if (img) return img.complete && img.naturalWidth > 0;
    return false;
  }
  dispose() {
    this.videos.forEach(v => { try { v.pause(); v.removeAttribute('src'); v.load(); v.remove(); } catch { /* noop */ } });
    this.videos.clear(); this.images.clear();
  }
}

// ---------- helpers de encuadre ----------
function drawCover(ctx: CanvasRenderingContext2D, src: CanvasImageSource, sw: number, sh: number, W: number, H: number, opacity: number, scale: number) {
  if (!sw || !sh) return;
  const base = Math.max(W / sw, H / sh) * (scale / 100);
  const dw = sw * base, dh = sh * base;
  ctx.save();
  ctx.globalAlpha = Math.max(0, Math.min(1, opacity / 100));
  ctx.drawImage(src, (W - dw) / 2, (H - dh) / 2, dw, dh);
  ctx.restore();
}

// "Ajustar": el video/imagen entra completo dentro del canvas (con bandas si hace falta), sin recortar.
function drawContain(ctx: CanvasRenderingContext2D, src: CanvasImageSource, sw: number, sh: number, W: number, H: number, opacity: number, scale: number) {
  if (!sw || !sh) return;
  const base = Math.min(W / sw, H / sh) * (scale / 100);
  const dw = sw * base, dh = sh * base;
  ctx.save();
  ctx.globalAlpha = Math.max(0, Math.min(1, opacity / 100));
  ctx.drawImage(src, (W - dw) / 2, (H - dh) / 2, dw, dh);
  ctx.restore();
}

// Elemento de overlay (PiP): se dibuja como una caja de ancho = scale% del canvas, centrada en (x,y)%, manteniendo aspecto.
function drawOverlayMedia(ctx: CanvasRenderingContext2D, src: CanvasImageSource, sw: number, sh: number, W: number, H: number, t: { x: number; y: number; scale: number; rotation: number; opacity: number }) {
  if (!sw || !sh) return;
  const boxW = (t.scale / 100) * W;
  const boxH = boxW * (sh / sw);
  const cx = (t.x / 100) * W, cy = (t.y / 100) * H;
  ctx.save();
  ctx.globalAlpha = Math.max(0, Math.min(1, t.opacity / 100));
  ctx.translate(cx, cy);
  if (t.rotation) ctx.rotate((t.rotation * Math.PI) / 180);
  ctx.drawImage(src, -boxW / 2, -boxH / 2, boxW, boxH);
  ctx.restore();
}

// ---------- texto ----------
function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = '';
  for (const w of words) {
    const test = line ? line + ' ' + w : w;
    if (ctx.measureText(test).width > maxWidth && line) { lines.push(line); line = w; }
    else line = test;
  }
  if (line) lines.push(line);
  return lines;
}

function drawTextEl(ctx: CanvasRenderingContext2D, el: TextElement, W: number, H: number, t: number, alphaMul = 1) {
  const s = el.style;
  const fontPx = Math.max(8, (s.size / 100) * H);
  ctx.save();
  ctx.globalAlpha = Math.max(0, Math.min(1, (el.transform.opacity / 100) * alphaMul));
  ctx.font = `${s.weight} ${fontPx}px "${s.font}", Inter, sans-serif`;
  ctx.textBaseline = 'middle';
  const maxW = W * 0.88;
  const lines = wrapText(ctx, el.text || '', maxW);
  const lineH = fontPx * 1.18;
  const cx = (el.transform.x / 100) * W;
  const cy = (el.transform.y / 100) * H;
  const totalH = lines.length * lineH;
  let y = cy - totalH / 2 + lineH / 2;

  // Animación palabra por palabra: cuántas palabras están "habladas" hasta t.
  const mode: 'none' | 'karaoke' | 'reveal' | 'highlight' = s.anim || (s.karaoke ? 'karaoke' : 'none');
  const totalWords = (el.text || '').split(/\s+/).filter(Boolean).length;
  const progress = el.duration > 0 ? Math.max(0, Math.min(1, (t - el.start) / el.duration)) : 1;
  const activeWords = Math.floor(progress * totalWords + 1e-6);
  const accent = s.accent || '#FFE600';
  let wordCounter = 0;

  const drawStroke = (text: string, x: number, yy: number, align: CanvasTextAlign) => {
    if (s.stroke && !s.bg) {
      ctx.lineWidth = Math.max(2, fontPx * 0.11);
      ctx.strokeStyle = 'rgba(0,0,0,0.75)';
      ctx.lineJoin = 'round';
      ctx.textAlign = align;
      ctx.strokeText(text, x, yy);
    }
  };

  for (const ln of lines) {
    const m = ctx.measureText(ln);
    // Caja de fondo (si corresponde).
    if (s.bg) {
      const padX = fontPx * 0.28, padY = fontPx * 0.16;
      const boxW = m.width + padX * 2;
      const bx = s.align === 'left' ? cx - maxW / 2 - padX : s.align === 'right' ? cx + maxW / 2 - boxW + padX : cx - boxW / 2;
      ctx.fillStyle = s.bg;
      roundRect(ctx, bx, y - lineH / 2 + padY * 0.5, boxW, lineH - padY, fontPx * 0.14);
      ctx.fill();
    }
    if (mode !== 'none' && totalWords > 0) {
      // Dibuja palabra por palabra desde el inicio de la línea (alineación calculada a mano).
      const words = ln.split(' ');
      const lineStart = s.align === 'left' ? cx - maxW / 2 : s.align === 'right' ? cx + maxW / 2 - m.width : cx - m.width / 2;
      ctx.textAlign = 'left';
      let x = lineStart;
      for (const w of words) {
        const wSpace = w + ' ';
        const isActive = wordCounter === activeWords;
        const isPast = wordCounter < activeWords;
        const show = mode === 'reveal' ? (isPast || isActive) : true; // "revelado": solo las ya dichas
        if (show) {
          ctx.save();
          if (mode === 'highlight' && isActive) { const cxw = x + ctx.measureText(w).width / 2; ctx.translate(cxw, y); ctx.scale(1.12, 1.12); ctx.translate(-cxw, -y); }
          drawStroke(w, x, y, 'left');
          let fill = s.color;
          if (mode === 'karaoke') fill = (isPast || isActive) ? accent : s.color;
          else if (mode === 'highlight' && isActive) fill = accent;
          ctx.fillStyle = fill;
          ctx.fillText(w, x, y);
          ctx.restore();
        }
        x += ctx.measureText(wSpace).width;
        wordCounter++;
      }
    } else {
      const anchorX = s.align === 'left' ? cx - maxW / 2 : s.align === 'right' ? cx + maxW / 2 : cx;
      drawStroke(ln, anchorX, y, s.align);
      ctx.textAlign = s.align;
      ctx.fillStyle = s.color;
      ctx.fillText(ln, anchorX, y);
    }
    y += lineH;
  }
  ctx.restore();
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

// Multiplicador de opacidad por transición fade in/out del elemento en el instante t.
export function fadeAlpha(el: ReelElement, t: number): number {
  const local = t - el.start;
  const inN = el.fadeIn || 0, outN = el.fadeOut || 0;
  let a = 1;
  if (inN > 0 && local < inN) a = Math.min(a, local / inN);
  if (outN > 0 && local > el.duration - outN) a = Math.min(a, Math.max(0, (el.duration - local) / outN));
  return Math.max(0, Math.min(1, a));
}

// Estado de la transición de ENTRADA del elemento en t: progreso p (1 al inicio → 0 al terminar).
function transitionState(el: ReelElement, t: number): { type: string; p: number } | null {
  const type = (el as any).transition as string | undefined;
  const dur = (el as any).transitionDur as number | undefined;
  if (!type || type === 'none' || !dur || dur <= 0) return null;
  const local = t - el.start;
  if (local < 0 || local > dur) return null;
  return { type, p: 1 - local / dur };
}

// Estado de la transición de SALIDA en t: progreso p (0 al empezar la salida → 1 al final del clip).
function exitTransitionState(el: ReelElement, t: number): { type: string; p: number } | null {
  const type = (el as any).transitionOut as string | undefined;
  const dur = (el as any).transitionOutDur as number | undefined;
  if (!type || type === 'none' || !dur || dur <= 0) return null;
  const remaining = (el.start + el.duration) - t;
  if (remaining < 0 || remaining > dur) return null;
  return { type, p: 1 - remaining / dur };
}

// Tiempo de la fuente para un elemento de media en el instante t de la timeline.
export function sourceTime(el: VideoElement | ImageElement, t: number): number {
  const local = t - el.start;
  if (el.type === 'image') return 0;
  return Math.min(el.trimStart + local, Math.max(el.trimStart, el.trimEnd - 0.001));
}

// Dibuja el frame en el tiempo t. Síncrono: usa el frame ACTUAL de cada <video> del pool.
// (En preview los videos se reproducen en sync; en export se hace seek antes de llamar acá.)
export function drawReelFrame(ctx: CanvasRenderingContext2D, project: ReelProject, t: number, pool: MediaPool) {
  const { w: W, h: H } = canvasSize(project);
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, W, H);

  const visuals = visualsAt(project, t);
  for (const { el, track } of visuals) {
    const fa = fadeAlpha(el, t);
    const tr = transitionState(el, t);
    const ex = exitTransitionState(el, t);
    // Efectos de las transiciones de entrada y salida.
    let alpha = fa, extraScale = 1, slideX = 0, whiteA = 0;
    if (tr) {
      if (tr.type === 'fade') alpha *= (1 - tr.p);
      else if (tr.type === 'zoom') extraScale = 1 + 0.25 * tr.p;
      else if (tr.type === 'slide') slideX = tr.p * W;
      else if (tr.type === 'white') whiteA = tr.p;
    }
    if (ex) {
      if (ex.type === 'fade') alpha *= (1 - ex.p);
      else if (ex.type === 'zoom') extraScale *= (1 + 0.25 * ex.p);
      else if (ex.type === 'slide') slideX -= ex.p * W;
      else if (ex.type === 'white') whiteA = Math.max(whiteA, ex.p);
    }
    if (el.type === 'text') { drawTextEl(ctx, el as TextElement, W, H, t, alpha); continue; }
    const media = el as VideoElement | ImageElement;
    const src = media.type === 'video' ? pool.getVideo(media.url) : pool.getImage(media.url);
    const sw = media.type === 'video' ? (src as HTMLVideoElement).videoWidth : (src as HTMLImageElement).naturalWidth;
    const sh = media.type === 'video' ? (src as HTMLVideoElement).videoHeight : (src as HTMLImageElement).naturalHeight;
    if (!sw || !sh) continue;
    if (track.kind === 'video') {
      // Pista base: por defecto "Ver completo" (contain); "Rellenar" (cover) solo si se elige explícito.
      ctx.save();
      if (slideX) ctx.translate(slideX, 0);
      if ((media as any).fit === 'cover') drawCover(ctx, src, sw, sh, W, H, media.transform.opacity * alpha, media.transform.scale * extraScale);
      else drawContain(ctx, src, sw, sh, W, H, media.transform.opacity * alpha, media.transform.scale * extraScale);
      ctx.restore();
      if (whiteA > 0) { ctx.save(); ctx.globalAlpha = whiteA; ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H); ctx.restore(); }
    } else {
      // Overlay: caja PiP posicionada.
      drawOverlayMedia(ctx, src, sw, sh, W, H, { ...media.transform, opacity: media.transform.opacity * alpha, scale: media.transform.scale * extraScale });
    }
  }
}

// Prepara (seek) todos los videos activos en t y espera a que estén en ese frame. Para export determinístico.
export function seekVideosAt(pool: MediaPool, project: ReelProject, t: number): Promise<void> {
  const active = visualsAt(project, t).filter(({ el }) => el.type === 'video') as { el: VideoElement }[];
  return Promise.all(active.map(({ el }) => {
    const v = pool.getVideo(el.url);
    const target = sourceTime(el, t);
    return new Promise<void>((res) => {
      if (Math.abs(v.currentTime - target) < 0.001 && v.readyState >= 2) { res(); return; }
      let done = false;
      const fin = () => { if (done) return; done = true; v.onseeked = null; res(); };
      v.onseeked = fin;
      const ensure = () => { try { v.currentTime = target; } catch { fin(); } };
      if (v.readyState >= 1) ensure();
      else { const h = () => { v.removeEventListener('loadedmetadata', h); ensure(); }; v.addEventListener('loadedmetadata', h); }
      setTimeout(fin, 600);
    });
  })).then(() => undefined);
}

export function activeElements(project: ReelProject, t: number): ReelElement[] {
  const out: ReelElement[] = [];
  for (const track of project.tracks) {
    if (track.muted && track.kind === 'audio') continue;
    for (const e of track.elements) if (t >= e.start && t < e.start + e.duration) out.push(e);
  }
  return out;
}
