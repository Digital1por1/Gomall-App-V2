import express from "express";
import path from "path";
import { GoogleGenAI, Type } from "@google/genai";

// Extrae el consumo real de tokens que devuelve Gemini en cada respuesta
function extractUsage(response) {
  const u = (response && response.usageMetadata) || {};
  return {
    prompt: u.promptTokenCount || 0,
    output: u.candidatesTokenCount || 0,
    total: u.totalTokenCount || ((u.promptTokenCount || 0) + (u.candidatesTokenCount || 0)),
  };
}

// Envuelve PCM 16-bit crudo (lo que devuelve Gemini TTS) en un contenedor WAV reproducible/decodable.
function pcm16ToWav(pcm, sampleRate = 24000, channels = 1) {
  const blockAlign = channels * 2;
  const byteRate = sampleRate * blockAlign;
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 3005;
  const ai = new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY || process.env.API_KEY || ""
  });

  app.use(express.json({ limit: "50mb" }));

  // === Enforcement server-side (opcional): se activa SOLO si cargás FIREBASE_SERVICE_ACCOUNT ===
  // Sin service account queda en fail-open (se comporta como hasta ahora, sin verificar ni cobrar).
  let adminDb = null;
  try {
    const saRaw = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (saRaw) {
      const admin = (await import('firebase-admin')).default;
      const saJson = saRaw.trim().startsWith('{') ? saRaw : Buffer.from(saRaw, 'base64').toString('utf8');
      if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert(JSON.parse(saJson)) });
      adminDb = { admin, db: admin.firestore() };
      console.log('[auth] enforcement server-side ACTIVO');
    } else {
      console.warn('[auth] FIREBASE_SERVICE_ACCOUNT ausente -> enforcement DESACTIVADO (fail-open)');
    }
  } catch (e) {
    console.error('[auth] Admin SDK no disponible, fail-open:', (e && e.message) || e);
    adminDb = null;
  }
  const MONTH_MS = 30 * 24 * 3600 * 1000;
  const IMAGE_COST = 15000; // créditos por imagen — MISMA unidad que los planes (tokenLimit = imágenes × 15000)
  const ADMIN_EMAILS = ['digital@1por1.com.ar'];
  const STORAGE_BUCKET = process.env.FIREBASE_STORAGE_BUCKET || 'gomall-studio-v2.firebasestorage.app';
  const isImageGen = (req) => {
    const gt = req.body && req.body.genType;
    return gt === 'image' || gt === 'improve' || gt === 'simple_image';
  };
  async function guard(req, res) {
    if (!adminDb) return { ok: true, uid: null };
    const m = String(req.headers.authorization || '').match(/^Bearer (.+)$/);
    if (!m) { res.status(401).json({ error: 'No autenticado.' }); return { ok: false }; }
    let decoded;
    try { decoded = await adminDb.admin.auth().verifyIdToken(m[1]); }
    catch { res.status(401).json({ error: 'Sesion invalida.' }); return { ok: false }; }
    try {
      const ref = adminDb.db.collection('profiles').doc(decoded.uid);
      const snap = await ref.get();
      const d = snap.exists ? snap.data() : {};
      const limit = d.tokenLimit || 300000;
      const lastReset = (d.usage && d.usage.lastReset) || 0;
      let used = (d.usage && d.usage.tokensUsed) || 0;
      if (lastReset && Date.now() - lastReset > MONTH_MS) used = 0;
      // El límite corta SOLO las imágenes (copys, campañas, voz y subtítulos son ilimitados).
      if (isImageGen(req) && used >= limit) { res.status(402).json({ error: 'Alcanzaste el límite de imágenes de tu plan. Actualizá tu plan para generar más.' }); return { ok: false }; }
      return { ok: true, uid: decoded.uid, ref, lastReset };
    } catch (e) {
      console.error('[auth] no se pudo leer el perfil, fail-open:', (e && e.message) || e);
      return { ok: true, uid: decoded.uid };
    }
  }
  async function charge(ctx, tokens) {
    if (!adminDb || !ctx || !ctx.ref) return;
    try {
      const now = Date.now();
      const inc = adminDb.admin.firestore.FieldValue.increment(tokens || 0);
      const newCycle = ctx.lastReset && now - ctx.lastReset > MONTH_MS;
      const usage = newCycle
        ? { tokensUsed: tokens || 0, lastUsed: now, lastReset: now }
        : { tokensUsed: inc, lastUsed: now, ...(ctx.lastReset ? {} : { lastReset: now }) };
      await ctx.ref.set({ usage }, { merge: true });
    } catch (e) { console.error('[auth] no se pudo cobrar el consumo:', (e && e.message) || e); }
  }
  // Cobra 15.000 créditos SOLO cuando la respuesta trae una imagen generada (mismas unidades que los planes).
  function meter(g, res) {
    const _json = res.json.bind(res);
    res.json = (b) => { try { if (adminDb && b && b.imageUrl) charge(g, IMAGE_COST); } catch (e) { /* noop */ } return _json(b); };
  }

  app.post("/api/generate", async (req, res) => {
    try {
      const g = await guard(req, res); if (!g.ok) return; meter(g, res);
      const { prompt, genType, tempImproveImage, activeLayout, textParts, campaignBrief, brandContext } = req.body;

      const isStory = activeLayout === "story";
      const ratioBlock = isStory
        ? "ASPECT RATIO: vertical 9:16 (portrait, taller than wide)."
        : "ASPECT RATIO: portrait 4:5 (slightly taller than wide).";

      const textWidthCap = isStory ? "40%" : "70%";
      const sideMargin = isStory ? "25%" : "8%";

      const storyExtra = isStory
        ? `\n6. STORY-SPECIFIC: this is a 9:16 vertical canvas. The vertical space is abundant, the horizontal space is NARROW. Treat every headline as a vertical stack of short lines (one short word per line is ideal). NEVER render a long word horizontally across the full width. Example: a 7-letter word like "HOTSALE" must be drawn either (a) split as "HOT" on one line and "SALE" on the line below, or (b) at a smaller size where it occupies less than 40% of the frame width. A single horizontal "HOTSALE" spanning more than half the width is FORBIDDEN.\n7. STORY-SPECIFIC: the safe drawing column is only the central 50% of the frame width (from 25% to 75% horizontally). Anything outside that column will be cropped by the platform UI and is unacceptable.`
        : "";

      const safeZoneBlock = `HARD LAYOUT CONSTRAINTS — DO NOT VIOLATE:
1. Any rendered word, letter or headline MUST have at least ${sideMargin} of empty padding on the LEFT side and ${sideMargin} of empty padding on the RIGHT side of the frame. The text bounding box is forbidden from touching those margins.
2. The total horizontal width of any text element MUST be at most ${textWidthCap} of the frame width. If the headline does not fit at that size, you MUST break it into 2 or 3 stacked shorter lines — never let a single line span the full canvas.
3. The top ${isStory ? "15%" : "8%"} and bottom ${isStory ? "16%" : "8%"} of the frame are reserved UI bands. Do not place text or critical product details there.
4. Before finalizing the image, mentally check: "is every letter fully visible and surrounded by background on all sides?" If a letter is cut, cropped, or kissing an edge — the image is WRONG, re-compose with smaller text.
5. The product / main subject should be clearly framed inside the central safe area, not floating off-canvas.${storyExtra}

VERIFICATION: imagine the frame divided into a 10x10 grid. Text is only allowed in the inner ${isStory ? "4x6" : "8x8"} cells. Outside cells must remain background or empty.`;

      const creativeBlock = `CREATIVE DIRECTION:
- DEFAULT STYLE: photorealistic commercial photography. Real camera, real lens, real lighting, real materials, real textures. The image must look like a photo taken with a high-end DSLR or mirrorless camera, NOT like a digital illustration, 3D render, painting, or AI-generic art.
- Only deviate from photorealism (surreal, illustrated, 3D, painterly, etc.) if the USER REQUEST below explicitly asks for it.
- Within photorealism, still aim for high production value: tasteful art direction, cinematic color grading, well-controlled shadows, realistic depth of field, atmosphere. Avoid sterile flat backgrounds and plastic studio softbox looks unless the user asks for catalog/packshot.
- Composition: thoughtful framing, rule of thirds, generous negative space, asymmetry when it serves the subject.
- Never produce obvious AI tell-tales: overly smooth skin, plasticky reflections, melted hands, perfect symmetry, repeating patterns.`;

      const finalNoText = `====================
RECORDATORIO FINAL — REGLA ABSOLUTA SOBRE TEXTO:
Salvo que el USER REQUEST/INSTRUCTIONS de arriba pida texto de forma EXPLÍCITA y literal, la imagen debe salir SIN NINGÚN texto: cero palabras, letras, números, títulos, subtítulos, captions, precios, porcentajes, sellos, watermarks, firmas, ESLOGANES, TAGLINES ni frases de marca.
Si el pedido menciona una marca (por ejemplo Adidas, Nike, Coca-Cola), representá el PRODUCTO y su estética SIN escribir el nombre de la marca ni su eslogan sobre la imagen (no escribas "Impossible is Nothing", "Just Do It", etc.). El logo/etiqueta que ya viene físicamente en el producto SÍ se conserva; lo prohibido es agregar tipografía nueva.
Una imagen que incluya texto no pedido se considera FALLIDA y debe rehacerse limpia.
====================`;

      if (genType === "image" || genType === "improve") {
        const parts = [];

        if (genType === "improve" && tempImproveImage) {
          const imgString = String(tempImproveImage);
          const base64Data = imgString.includes(",") ? imgString.split(",")[1] : imgString;
          const mimeMatch = imgString.match(/^data:([^;]+);base64,/);
          const mimeType = mimeMatch ? mimeMatch[1] : "image/jpeg";

          parts.push({ inlineData: { data: String(base64Data), mimeType } });
          parts.push({
            text: `You are a senior advertising creative director re-imagining the attached product photo into a bold campaign visual.

PRODUCT FIDELITY (NON-NEGOTIABLE):
- Keep the product 100% IDENTICAL: same exact shape, label artwork, colors, proportions, logo, materials, textures. Never redesign, restyle, recolor or replace it.
- The product should remain the unambiguous hero of the image.
- The product's own existing label/logo IS allowed and must be preserved exactly. Do NOT add new logos.

${ratioBlock}

${creativeBlock}

${safeZoneBlock}

TEXT & LOGO POLICY (STRICT):
- DO NOT render any text, letters, words, numbers, headlines, captions, watermarks, signatures, slogans, prices, percentages, or typographic elements unless the USER INSTRUCTIONS below explicitly request specific text.
- DO NOT invent or add brand logos, badges, stickers, seals, or graphic marks that are not already part of the original product itself.
- If the user does not mention text or logos, the image must be completely free of any added typography or branding.
- If the user does ask for text, every letter must obey the HARD LAYOUT CONSTRAINTS above — break long words into stacked lines rather than letting them bleed off the canvas.

USER INSTRUCTIONS: ${String(prompt)}

${finalNoText}`
          });
        } else {
          parts.push({
            text: `You are a senior art director creating a high-end advertising image for social media.

${ratioBlock}

${creativeBlock}

${safeZoneBlock}

TEXT & LOGO POLICY (STRICT):
- DO NOT render any text, letters, words, numbers, headlines, captions, watermarks, signatures, slogans, prices, percentages, or typographic elements unless the USER REQUEST below explicitly asks for specific text.
- DO NOT invent or add brand logos, badges, stickers, seals, or graphic marks unless the user explicitly asks for them.
- By default the image must be completely free of any typography or branding.
- If the user does ask for text, then: pick a font weight and size such that the text occupies at most ${textWidthCap} of the frame width; split long headlines into 2 or 3 stacked lines so each line stays within the safe area; center horizontally; confirm the first and last letters have clear margin from the frame edges.

USER REQUEST: ${String(prompt)}

${finalNoText}`
          });
        }

        const response = await ai.models.generateContent({
          model: "gemini-2.5-flash-image",
          contents: [{ role: "user", parts }],
          config: {
            imageConfig: {
              aspectRatio: isStory ? "9:16" : "4:5"
            }
          }
        });

        let foundImageUrl = "";
        const candidateParts = response?.candidates?.[0]?.content?.parts || [];
        for (const part of candidateParts) {
          if (part && part.inlineData) {
            foundImageUrl = `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`;
            break;
          }
        }
        if (!foundImageUrl) {
          console.error("No image in response:", JSON.stringify(response).slice(0, 500));
        }
        res.json({ imageUrl: foundImageUrl, usage: extractUsage(response) });
      } else if (genType === "copy") {
        const response = await ai.models.generateContent({
          model: "gemini-2.5-flash",
          contents: [{ role: "user", parts: textParts }]
        });
        let text = "";
        if (typeof response?.text === "string") {
          text = response.text;
        } else {
          const parts = response?.candidates?.[0]?.content?.parts || [];
          text = parts.map(p => p?.text || "").join("").trim();
        }
        res.json({ text, usage: extractUsage(response) });
      } else if (genType === "simple_image") {
        const response = await ai.models.generateContent({
          model: "gemini-2.5-flash-image",
          contents: [{
            role: "user",
            parts: [{ text: String(prompt) }]
          }],
          config: {
            imageConfig: { aspectRatio: "1:1" }
          }
        });

        let foundImageUrl = "";
        const candidateParts = response?.candidates?.[0]?.content?.parts || [];
        for (const part of candidateParts) {
          if (part && part.inlineData) {
            foundImageUrl = `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`;
            break;
          }
        }
        res.json({ imageUrl: foundImageUrl, usage: extractUsage(response) });
      } else if (genType === "campaign") {
        const brief = campaignBrief || {};
        const brand = brandContext || {};

        // Cantidad por tipo: Feed/Stories -> "imagen", Reels -> "reel". Cae al comportamiento viejo si no vienen.
        const plats = Array.isArray(brief.platforms) ? brief.platforms : [];
        const imgN = Number.isFinite(brief.imageCount) ? Math.max(0, Math.floor(brief.imageCount)) : (plats.includes('Feed / Stories') ? (brief.pieceCount || 4) : 0);
        const reelN = Number.isFinite(brief.reelCount) ? Math.max(0, Math.floor(brief.reelCount)) : (plats.includes('Reels') ? (brief.pieceCount || 0) : 0);
        const totalN = Math.max(1, imgN + reelN);

        const campaignPrompt = `Sos un estratega de marketing y director creativo senior. Tu trabajo es diseñar una campaña de contenido para redes sociales (Instagram) completa y accionable.

CONTEXTO DE LA MARCA:
- Negocio: ${String(brand.business || "Sin especificar")}
- Rubro: ${String(brand.industry || "Sin especificar")}
- Tono de marca: ${String(brand.brandTone || "Sin especificar")}
- Sitio web / Instagram: ${String(brand.website || "Sin especificar")}
- Historia / descripción: ${String(brand.companyStory || "Sin especificar")}

BRIEF DE LA CAMPAÑA:
- Objetivo: ${String(brief.objective || "Sin especificar")}
- Producto o servicio destacado: ${String(brief.product || "Sin especificar")}
- Público objetivo: ${String(brief.audience || "Sin especificar")}
- Fechas / temporada: ${String(brief.dates || "Sin especificar")}
- Plataformas: ${Array.isArray(brief.platforms) ? brief.platforms.join(", ") : "Instagram"}
- Mensaje clave / oferta: ${String(brief.keyMessage || "Sin especificar")}
- Cantidad de piezas deseadas: ${String(brief.pieceCount || 4)}

INSTRUCCIONES:
1. Proponé EXACTAMENTE ${imgN} pieza(s) tipo "imagen" y EXACTAMENTE ${reelN} pieza(s) tipo "reel". El total DEBE ser ${totalN} piezas, ni más ni menos. No cambies estas cantidades.
2. Solo se permiten los tipos "imagen" y "reel" (NO uses "copy" como tipo; el texto va dentro del campo "copy" de cada pieza). "imagen" = post para Feed/Stories (formato "Feed 4:5" o "Story 9:16"); "reel" = video vertical (formato "Reel 9:16"). Todas las piezas deben ser coherentes entre sí y alineadas al objetivo y al rubro "${String(brand.industry || "")}".
3. Para cada pieza:
   - "type": uno de exactamente "imagen" o "reel" (respetando las cantidades del punto 1).
   - "title": nombre corto y descriptivo de la pieza.
   - "format": formato sugerido, ej "Feed 4:5", "Story 9:16" o "Reel 9:16".
   - "imagePrompt": un prompt DETALLADO en ESPAÑOL para generar SOLO el visual (describí escena, estilo fotográfico, iluminación, composición). PROHIBIDO incluir texto, palabras, letras, números, precios, porcentajes, titulares, logos o tipografía dentro del imagePrompt: el texto se agrega después como capas editables en el editor. La imagen debe quedar limpia y con espacio negativo libre para colocar el texto encima. Si la pieza es "copy" puro, dejá igualmente un prompt visual de portada sin texto.
   - "copy": el texto/caption en español, persuasivo y acorde al tono de marca, sin incitar a "hacer click".
   - "rationale": una frase breve en español explicando por qué esta pieza ayuda a cumplir el objetivo.
4. El campo "name" es un nombre creativo y corto para la campaña completa.
5. No incluyas nombres de tiendas dentro de los copies si no aportan valor; enfocate en beneficios.
${Array.isArray(brief.images) && brief.images.length ? '6. IMÁGENES ADJUNTAS: tenés fotos del producto/referencia de la marca. Los "imagePrompt" deben describir escenas publicitarias que muestren ESE producto tal cual (mismo producto, no inventes otro), ubicándolo en el contexto del objetivo.' : ''}`;

        const imgParts = (Array.isArray(brief.images) ? brief.images : [])
          .filter(im => im && im.data)
          .map(im => ({ inlineData: { data: im.data, mimeType: im.mime || 'image/jpeg' } }));
        const response = await ai.models.generateContent({
          model: "gemini-2.5-flash",
          contents: [{ role: "user", parts: [...imgParts, { text: campaignPrompt }] }],
          config: {
            responseMimeType: "application/json",
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                name: { type: Type.STRING },
                pieces: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      type: { type: Type.STRING },
                      title: { type: Type.STRING },
                      format: { type: Type.STRING },
                      imagePrompt: { type: Type.STRING },
                      copy: { type: Type.STRING },
                      rationale: { type: Type.STRING }
                    },
                    required: ["type", "title", "format", "imagePrompt", "copy", "rationale"]
                  }
                }
              },
              required: ["name", "pieces"]
            }
          }
        });

        let text = "";
        if (typeof response?.text === "string") {
          text = response.text;
        } else {
          const parts = response?.candidates?.[0]?.content?.parts || [];
          text = parts.map(p => p?.text || "").join("").trim();
        }
        res.json({ text, usage: extractUsage(response) });
      } else {
        res.status(400).json({ error: "Invalid genType" });
      }
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: error.message || "Error generating content" });
    }
  });

  // Lee el sitio web del negocio y lo resume con IA para usarlo como contexto de marca
  app.post("/api/analyze-site", async (req, res) => {
    try {
      const g = await guard(req, res); if (!g.ok) return; meter(g, res);
      let { url } = req.body;
      if (!url || typeof url !== "string") return res.status(400).json({ error: "Falta la URL." });
      url = url.trim().replace(/^@/, "");
      if (!url.includes(".")) {
        return res.status(400).json({ error: "Ingresá la dirección de tu sitio web (ej: www.tunegocio.com). Un usuario de Instagram no se puede leer automáticamente." });
      }
      if (!/^https?:\/\//i.test(url)) url = "https://" + url;

      let html = "";
      try {
        const r = await fetch(url, {
          headers: { "User-Agent": "Mozilla/5.0 (compatible; GomallBot/1.0; +https://gomallstudio.com)" },
          redirect: "follow",
          signal: AbortSignal.timeout(12000),
        });
        html = await r.text();
      } catch (e) {
        return res.status(502).json({ error: "No pudimos acceder a la web. Verificá que la dirección sea correcta y esté online." });
      }

      const titleMatch = html.match(/<title[^>]*>([^<]*)<\/title>/i);
      const descMatch = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i);
      const text = html
        .replace(/<script[\s\S]*?<\/script>/gi, " ")
        .replace(/<style[\s\S]*?<\/style>/gi, " ")
        .replace(/<!--[\s\S]*?-->/g, " ")
        .replace(/<[^>]+>/g, " ")
        .replace(/&nbsp;/gi, " ")
        .replace(/&amp;/gi, "&")
        .replace(/&[a-z]+;/gi, " ")
        .replace(/\s+/g, " ")
        .trim();
      const head = `${titleMatch ? "TÍTULO: " + titleMatch[1] + "\n" : ""}${descMatch ? "DESCRIPCIÓN: " + descMatch[1] + "\n" : ""}`;
      const content = (head + text).slice(0, 7000);

      if (content.replace(/\s/g, "").length < 40) {
        return res.status(422).json({ error: "La web no devolvió contenido legible (puede requerir login o estar vacía). Podés escribir la historia a mano." });
      }

      const prompt = `A partir del contenido de este sitio web de un negocio, escribí un resumen claro en español (4 a 6 oraciones) que sirva como contexto de marca para un asistente de marketing. Incluí: qué hace o vende el negocio, sus productos o servicios principales, a quién le habla y su estilo/tono si se percibe. No inventes datos que no estén. No incluyas URLs ni el menú de navegación.\n\nCONTENIDO DEL SITIO:\n${content}`;
      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: [{ role: "user", parts: [{ text: prompt }] }],
      });
      let summary = "";
      if (typeof response?.text === "string") summary = response.text;
      else summary = (response?.candidates?.[0]?.content?.parts || []).map(p => p?.text || "").join("").trim();
      res.json({ summary: summary.trim(), usage: extractUsage(response) });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: error.message || "Error analizando la web" });
    }
  });

  // Transcribe el audio de un reel en segmentos de subtítulo cronometrados
  app.post("/api/transcribe", async (req, res) => {
    try {
      const g = await guard(req, res); if (!g.ok) return; meter(g, res);
      const { audio, mime } = req.body;
      if (!audio) return res.status(400).json({ error: "Falta el audio." });
      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: [{
          role: "user",
          parts: [
            { inlineData: { data: audio, mimeType: mime || "audio/wav" } },
            { text: "Transcribí este audio en su idioma original (probablemente español) en segmentos cortos de subtítulo, de máximo 7 palabras cada uno. Para cada segmento dame el tiempo de inicio y de fin en SEGUNDOS (números, ej 3.2) y el texto. No inventes texto si hay silencio. Devolvé solo JSON." }
          ]
        }],
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              segments: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    start: { type: Type.NUMBER },
                    end: { type: Type.NUMBER },
                    text: { type: Type.STRING }
                  },
                  required: ["start", "end", "text"]
                }
              }
            },
            required: ["segments"]
          }
        }
      });
      let text = "";
      if (typeof response?.text === "string") text = response.text;
      else text = (response?.candidates?.[0]?.content?.parts || []).map(p => p?.text || "").join("").trim();
      res.json({ text, usage: extractUsage(response) });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: error.message || "Error al transcribir el audio" });
    }
  });

  // Narración con IA (texto → voz) usando Gemini TTS. Misma API key, sin proveedor nuevo.
  app.post("/api/tts", async (req, res) => {
    try {
      const g = await guard(req, res); if (!g.ok) return; meter(g, res);
      const { text, voice, accent } = req.body;
      const script = String(text || "").trim();
      if (!script) return res.status(400).json({ error: "Falta el texto de la narración." });
      const styleAccent = typeof accent === "string" ? accent.trim() : "";

      const synth = (input) => ai.models.generateContent({
        model: "gemini-2.5-flash-preview-tts",
        contents: [{ role: "user", parts: [{ text: input.slice(0, 5000) }] }],
        config: {
          responseModalities: ["AUDIO"],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice || "Kore" } } },
        },
      });
      const audioOf = (r) => ((r && r.candidates && r.candidates[0] && r.candidates[0].content && r.candidates[0].content.parts) || []).find((p) => p && p.inlineData && p.inlineData.data);

      // 1) Intento con acento (si lo eligió). 2) Si no hay audio, reintento SIN acento (el prefijo de estilo
      //    a veces traba al modelo con finishReason OTHER); así la narración nunca se rompe.
      let response = await synth(styleAccent ? `${styleAccent}: ${script}` : script);
      let inlinePart = audioOf(response);
      if ((!inlinePart || !inlinePart.inlineData.data) && styleAccent) {
        console.warn("[tts] sin audio con acento, reintento sin acento");
        response = await synth(script);
        inlinePart = audioOf(response);
      }
      const inline = inlinePart && inlinePart.inlineData;
      if (!inline || !inline.data) {
        const cand = response && response.candidates && response.candidates[0];
        const reason = (cand && cand.finishReason) || (response && response.promptFeedback && response.promptFeedback.blockReason) || "sin audio";
        const textOut = (((response && response.candidates && response.candidates[0] && response.candidates[0].content && response.candidates[0].content.parts) || []).find((p) => p && p.text) || {}).text || "";
        console.error("[tts] sin audio · motivo:", reason, "· resp:", JSON.stringify(response).slice(0, 800));
        return res.status(502).json({ error: `Gemini no devolvió audio (motivo: ${reason}).${textOut ? " Dijo: " + textOut.slice(0, 200) : " Puede que el modelo TTS no esté habilitado para tu clave/región."}` });
      }
      const rateM = /rate=(\d+)/.exec(inline.mimeType || "");
      const rate = rateM ? Number(rateM[1]) : 24000;
      const wav = pcm16ToWav(Buffer.from(inline.data, "base64"), rate, 1);
      res.json({ audioBase64: wav.toString("base64"), mime: "audio/wav", usage: extractUsage(response) });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: error.message || "Error al generar la narración" });
    }
  });

  // Captions con IA: por cada línea de subtítulo devuelve un emoji relevante y la palabra clave a resaltar.
  app.post("/api/enrich-captions", async (req, res) => {
    try {
      const g = await guard(req, res); if (!g.ok) return;
      const lines = Array.isArray(req.body && req.body.lines) ? req.body.lines.map((l) => String(l || '')) : [];
      if (!lines.length) return res.status(400).json({ error: "Faltan las líneas de subtítulo." });
      const numbered = lines.map((l, i) => `${i + 1}. ${l}`).join('\n');
      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: [{ role: "user", parts: [{ text:
`Sos editor de captions para reels tipo Submagic. Para CADA línea de subtítulo, devolvé:
- "emoji": UN (1) emoji que refuerce la idea de esa línea, o "" si ninguno encaja bien. No fuerces: usá emoji solo cuando suma (más o menos en 1 de cada 2 líneas).
- "keyword": la palabra MÁS importante de esa línea para resaltar (una sola palabra, tal cual aparece en la línea), o "" si ninguna se destaca.
Devolvé "items" con EXACTAMENTE ${lines.length} objetos, en el MISMO orden que las líneas. Solo JSON.

Líneas:
${numbered}` }] }],
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              items: {
                type: Type.ARRAY,
                items: { type: Type.OBJECT, properties: { emoji: { type: Type.STRING }, keyword: { type: Type.STRING } }, required: ["emoji", "keyword"] },
              },
            },
            required: ["items"],
          },
        },
      });
      let text = "";
      if (typeof response?.text === "string") text = response.text;
      else text = (response?.candidates?.[0]?.content?.parts || []).map((p) => p?.text || "").join("").trim();
      let items = [];
      try { items = (JSON.parse(text) && JSON.parse(text).items) || []; } catch (e) { items = []; }
      res.json({ items, usage: extractUsage(response) });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: error.message || "Error al enriquecer los subtítulos" });
    }
  });

  // Eliminar una cuenta POR COMPLETO (solo admin). Borra Auth + perfil + subcolecciones + Storage.
  app.post("/api/admin/delete-user", async (req, res) => {
    try {
      if (!adminDb) return res.status(503).json({ error: "El enforcement del servidor no está activo (falta FIREBASE_SERVICE_ACCOUNT)." });
      const m = String(req.headers.authorization || '').match(/^Bearer (.+)$/);
      if (!m) return res.status(401).json({ error: "No autenticado." });
      let decoded;
      try { decoded = await adminDb.admin.auth().verifyIdToken(m[1]); }
      catch { return res.status(401).json({ error: "Sesión inválida." }); }
      if (!ADMIN_EMAILS.includes(String(decoded.email || '').toLowerCase())) {
        return res.status(403).json({ error: "Solo un administrador puede eliminar cuentas." });
      }
      const uid = String((req.body && req.body.uid) || '').trim();
      if (!uid) return res.status(400).json({ error: "Falta el uid del usuario." });
      if (ADMIN_EMAILS.includes(String((req.body && req.body.email) || '').toLowerCase())) {
        return res.status(400).json({ error: "No se puede eliminar una cuenta de administrador." });
      }

      const deleted = { auth: false, profile: false, disenos: false, storage: false };
      try { await adminDb.admin.auth().deleteUser(uid); deleted.auth = true; }
      catch (e) { if (e && e.code === 'auth/user-not-found') deleted.auth = true; else console.error('[del] auth:', e && e.message); }
      try { await adminDb.db.recursiveDelete(adminDb.db.collection('profiles').doc(uid)); deleted.profile = true; }
      catch (e) { console.error('[del] profile:', e && e.message); }
      try { await adminDb.db.recursiveDelete(adminDb.db.collection('usuarios').doc(uid)); deleted.disenos = true; }
      catch (e) { console.error('[del] disenos:', e && e.message); }
      try { await adminDb.admin.storage().bucket(STORAGE_BUCKET).deleteFiles({ prefix: `assets/${uid}/` }); deleted.storage = true; }
      catch (e) { console.error('[del] storage:', e && e.message); }

      res.json({ ok: true, deleted });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: error.message || "Error al eliminar la cuenta" });
    }
  });

  const distPath = path.join(process.cwd(), "dist");
  app.use(express.static(distPath));
  app.get(/.*/, (req, res) => {
    res.sendFile(path.join(distPath, "index.html"));
  });

  app.use((err, req, res, next) => {
    console.error("Express Error:", err);
    res.status(err.status || 500).json({
      error: err.message || "Internal Server Error"
    });
  });

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on port ${PORT}`);
  });
}

startServer();
