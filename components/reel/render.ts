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
  ctx.font = `${s.italic ? 'italic ' : ''}${s.weight} ${fontPx}px "${s.font}", Inter, sans-serif`;
  ctx.textBaseline = 'middle';
  if (s.glow) { ctx.shadowColor = s.accent || s.color; ctx.shadowBlur = fontPx * 0.5; }
  const txt = s.upper ? (el.text || '').toUpperCase() : (el.text || '');
  const maxW = W * 0.88;
  const lines = wrapText(ctx, txt, maxW);
  const lineH = fontPx * 1.18;
  const cx = (el.transform.x / 100) * W;
  const cy = (el.transform.y / 100) * H;
  const rot = el.transform.rotation || 0;
  if (rot) { ctx.translate(cx, cy); ctx.rotate((rot * Math.PI) / 180); ctx.translate(-cx, -cy); }
  const totalH = lines.length * lineH;
  let y = cy - totalH / 2 + lineH / 2;

  // Animación palabra por palabra. En vez de repartir el tiempo parejo entre las palabras, se pondera por
  // el largo de cada palabra (las largas duran más) para seguir mejor el ritmo del habla, con un pequeño
  // adelanto (LEAD) para que el destaque no se sienta atrasado respecto al audio.
  const mode: 'none' | 'karaoke' | 'reveal' | 'highlight' | 'pop' | 'wordbox' = s.anim || (s.karaoke ? 'karaoke' : 'none');
  const allWordsTimed = txt.split(/\s+/).filter(Boolean);
  const totalWords = allWordsTimed.length;
  const LEAD = 0.06; // s de anticipación del destaque
  const durTimed = el.duration > 0 ? el.duration : 0.001;
  const localTimed = Math.max(0, (t - el.start) + LEAD);
  let activeWords = 0;
  if (totalWords > 0) {
    const weights = allWordsTimed.map(w => Math.max(2, w.length));
    const totalW = weights.reduce((a, b) => a + b, 0) || 1;
    let acc = 0;
    for (let k = 0; k < totalWords; k++) {
      acc += (weights[k] / totalW) * durTimed;
      if (localTimed >= acc) activeWords = k + 1; else break;
    }
  }
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
          const wpx = ctx.measureText(w).width;
          const bump = (mode === 'highlight' || mode === 'pop') && isActive;
          if (bump) { const sc = mode === 'pop' ? 1.18 : 1.12; const cxw = x + wpx / 2; ctx.translate(cxw, y); ctx.scale(sc, sc); ctx.translate(-cxw, -y); }
          if (mode === 'wordbox' && isActive) {
            // Caja resaltando la palabra activa (look Submagic/Hormozi).
            const px = fontPx * 0.18, py = fontPx * 0.6;
            ctx.fillStyle = accent;
            roundRect(ctx, x - px, y - py, wpx + px * 2, py * 2, fontPx * 0.16);
            ctx.fill();
          } else {
            drawStroke(w, x, y, 'left');
          }
          let fill = s.color;
          if (mode === 'karaoke' || mode === 'pop') fill = (isPast || isActive) ? accent : s.color;
          else if (mode === 'highlight' && isActive) fill = accent;
          else if (mode === 'wordbox' && isActive) fill = '#111111';
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

// Efecto continuo (énfasis) en t: multiplicador de escala, rotación (°) y desplazamiento vertical (px).
function emphasisAt(el: ReelElement, t: number, H: number): { scale: number; rot: number; dy: number } {
  const kind = (el as any).emphasis as string | undefined;
  if (!kind || kind === 'none') return { scale: 1, rot: 0, dy: 0 };
  const local = Math.max(0, t - el.start);
  const TAU = Math.PI * 2;
  if (kind === 'pulse') return { scale: 1 + 0.06 * Math.sin(local * TAU * 1.4), rot: 0, dy: 0 };
  if (kind === 'breathe') return { scale: 1 + 0.035 * Math.sin(local * TAU * 0.5), rot: 0, dy: 0 };
  if (kind === 'wiggle') return { scale: 1, rot: 3 * Math.sin(local * TAU * 1.8), dy: 0 };
  if (kind === 'float') return { scale: 1, rot: 0, dy: 0.02 * H * Math.sin(local * TAU * 0.6) };
  return { scale: 1, rot: 0, dy: 0 };
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
    let alpha = fa, extraScale = 1, slideX = 0, slideY = 0, whiteA = 0, blurPx = 0;
    if (tr) {
      if (tr.type === 'fade') alpha *= (1 - tr.p);
      else if (tr.type === 'zoom') extraScale = 1 + 0.25 * tr.p;
      else if (tr.type === 'slide') slideX = tr.p * W;
      else if (tr.type === 'slideup') slideY = tr.p * H;
      else if (tr.type === 'slidedown') slideY = -tr.p * H;
      else if (tr.type === 'blur') blurPx = tr.p * 24;
      else if (tr.type === 'white') whiteA = tr.p;
    }
    if (ex) {
      if (ex.type === 'fade') alpha *= (1 - ex.p);
      else if (ex.type === 'zoom') extraScale *= (1 + 0.25 * ex.p);
      else if (ex.type === 'slide') slideX -= ex.p * W;
      else if (ex.type === 'slideup') slideY -= ex.p * H;
      else if (ex.type === 'slidedown') slideY += ex.p * H;
      else if (ex.type === 'blur') blurPx = Math.max(blurPx, ex.p * 24);
      else if (ex.type === 'white') whiteA = Math.max(whiteA, ex.p);
    }
    const em = emphasisAt(el, t, H); // efecto continuo (pulso/vaivén/flotar…)
    if (el.type === 'text') {
      const te = el as TextElement;
      const cx = (te.transform.x / 100) * W, cy = (te.transform.y / 100) * H;
      const sc = extraScale * em.scale;
      ctx.save();
      if (slideX || slideY || em.dy) ctx.translate(slideX, slideY + em.dy);
      if (blurPx) ctx.filter = `blur(${blurPx}px)`;
      if (sc !== 1 || em.rot) { ctx.translate(cx, cy); if (em.rot) ctx.rotate((em.rot * Math.PI) / 180); if (sc !== 1) ctx.scale(sc, sc); ctx.translate(-cx, -cy); }
      drawTextEl(ctx, te, W, H, t, alpha);
      ctx.restore();
      continue;
    }
    const media = el as VideoElement | ImageElement;
    const src = media.type === 'video' ? pool.getVideo(media.url) : pool.getImage(media.url);
    const sw = media.type === 'video' ? (src as HTMLVideoElement).videoWidth : (src as HTMLImageElement).naturalWidth;
    const sh = media.type === 'video' ? (src as HTMLVideoElement).videoHeight : (src as HTMLImageElement).naturalHeight;
    if (!sw || !sh) continue;
    if (track.kind === 'video') {
      // Pista base: por defecto LLENA el formato (cover, sin bordes negros); "Completo" (contain) solo si se elige.
      // Movimiento "Ken Burns": zoom lento (1.0 → 1.12) a lo largo del clip para que la imagen no quede estática.
      let kb = 1;
      if ((media as any).kenBurns) {
        const localK = Math.max(0, Math.min(media.duration, t - media.start));
        kb = 1 + 0.12 * (media.duration > 0 ? localK / media.duration : 0);
      }
      ctx.save();
      if (slideX || slideY || em.dy) ctx.translate(slideX, slideY + em.dy);
      if (blurPx) ctx.filter = `blur(${blurPx}px)`;
      if ((media as any).fit === 'contain') drawContain(ctx, src, sw, sh, W, H, media.transform.opacity * alpha, media.transform.scale * extraScale * kb * em.scale);
      else drawCover(ctx, src, sw, sh, W, H, media.transform.opacity * alpha, media.transform.scale * extraScale * kb * em.scale);
      ctx.restore();
      if (whiteA > 0) { ctx.save(); ctx.globalAlpha = whiteA; ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H); ctx.restore(); }
    } else {
      // Overlay (logo/recurso/imagen): también responde a transiciones de entrada/salida y al énfasis.
      ctx.save();
      if (blurPx) ctx.filter = `blur(${blurPx}px)`;
      const ox = media.transform.x + (slideX / W) * 100;
      const oy = media.transform.y + ((slideY + em.dy) / H) * 100;
      drawOverlayMedia(ctx, src, sw, sh, W, H, { ...media.transform, x: ox, y: oy, rotation: media.transform.rotation + em.rot, opacity: media.transform.opacity * alpha, scale: media.transform.scale * extraScale * em.scale });
      ctx.restore();
    }
  }
}

// Prepara (seek) todos los videos activos en t y espera a que el frame esté REALMENTE presentado.
// Usa requestVideoFrameCallback (más confiable que 'seeked' para pintar el frame correcto en el canvas);
// si no está, cae a 'seeked'. Sin esto, el export captura el frame anterior → "imágenes fijas".
export function seekVideosAt(pool: MediaPool, project: ReelProject, t: number): Promise<void> {
  const active = visualsAt(project, t).filter(({ el }) => el.type === 'video') as { el: VideoElement }[];
  return Promise.all(active.map(({ el }) => {
    const v = pool.getVideo(el.url) as HTMLVideoElement & { requestVideoFrameCallback?: (cb: () => void) => number };
    const target = sourceTime(el, t);
    return new Promise<void>((res) => {
      let done = false;
      const fin = () => { if (done) return; done = true; v.onseeked = null; res(); };
      const hasRVFC = typeof v.requestVideoFrameCallback === 'function';
      const already = Math.abs(v.currentTime - target) < 0.001 && v.readyState >= 2;
      const ensure = () => {
        // Registrar el aviso de "frame listo" ANTES de disparar el seek.
        if (hasRVFC) v.requestVideoFrameCallback!(() => fin());
        else v.onseeked = fin;
        if (already) {
          // Ya está en el frame correcto: rVFC puede no dispararse (no hay frame nuevo) → resolver por timeout corto.
          setTimeout(fin, 40);
        } else {
          try { v.currentTime = target; } catch { fin(); }
        }
      };
      if (v.readyState >= 1) ensure();
      else { const h = () => { v.removeEventListener('loadedmetadata', h); ensure(); }; v.addEventListener('loadedmetadata', h); }
      setTimeout(fin, 800); // backstop: nunca colgar el export
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
