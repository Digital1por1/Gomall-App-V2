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

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 3005;
  const ai = new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY || process.env.API_KEY || ""
  });

  app.use(express.json({ limit: "50mb" }));

  app.post("/api/generate", async (req, res) => {
    try {
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

USER INSTRUCTIONS: ${String(prompt)}`
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

USER REQUEST: ${String(prompt)}`
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
1. Proponé exactamente ${String(brief.pieceCount || 4)} piezas de contenido coherentes entre sí y alineadas al objetivo y al rubro "${String(brand.industry || "")}".
2. Tipos de pieza permitidos según las plataformas elegidas: si incluye "Feed / Stories" usá "imagen" (un post sirve para feed y story) y "copy"; si incluye "Reels" podés usar "reel". NUNCA propongas piezas tipo "reel" si "Reels" NO está entre las plataformas seleccionadas.
3. Para cada pieza:
   - "type": uno de exactamente "imagen", "reel" o "copy".
   - "title": nombre corto y descriptivo de la pieza.
   - "format": formato sugerido, ej "Feed 4:5", "Story 9:16" o "Reel 9:16".
   - "imagePrompt": un prompt DETALLADO en ESPAÑOL para generar SOLO el visual (describí escena, estilo fotográfico, iluminación, composición). PROHIBIDO incluir texto, palabras, letras, números, precios, porcentajes, titulares, logos o tipografía dentro del imagePrompt: el texto se agrega después como capas editables en el editor. La imagen debe quedar limpia y con espacio negativo libre para colocar el texto encima. Si la pieza es "copy" puro, dejá igualmente un prompt visual de portada sin texto.
   - "copy": el texto/caption en español, persuasivo y acorde al tono de marca, sin incitar a "hacer click".
   - "rationale": una frase breve en español explicando por qué esta pieza ayuda a cumplir el objetivo.
4. El campo "name" es un nombre creativo y corto para la campaña completa.
5. No incluyas nombres de tiendas dentro de los copies si no aportan valor; enfocate en beneficios.`;

        const response = await ai.models.generateContent({
          model: "gemini-2.5-flash",
          contents: [{ role: "user", parts: [{ text: campaignPrompt }] }],
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
