import React, { useState, useRef } from 'react';
import { UserProfile } from '../types';

interface ProductAdStudioProps {
  profile: UserProfile | null;
  onClose: () => void;
  updateUsage: (tokens: number) => Promise<void>;
  onUseImage: (imageUrl: string, prompt: string) => void;
  compressBase64Image: (base64Str: string, maxWidth?: number, quality?: number, preserveAlpha?: boolean) => Promise<string>;
}

const STYLES = [
  { id: 'estudio', label: 'Estudio limpio', prompt: 'fondo de estudio limpio y prolijo, iluminación suave de softbox, superficie elegante, estilo packshot publicitario premium' },
  { id: 'lifestyle', label: 'Lifestyle', prompt: 'escena lifestyle real, ambiente cotidiano y aspiracional, luz natural cálida, contexto de uso del producto' },
  { id: 'lujo', label: 'Lujo / premium', prompt: 'estética de lujo, materiales nobles (mármol, madera, vidrio), iluminación dramática y cinematográfica, sensación premium' },
  { id: 'exterior', label: 'Exterior natural', prompt: 'exterior con luz natural, entorno orgánico, profundidad de campo, atmósfera fresca' },
  { id: 'minimal', label: 'Minimalista', prompt: 'composición minimalista, fondo de color sólido suave, mucho espacio negativo, sombras limpias' },
  { id: 'festivo', label: 'Festivo', prompt: 'ambientación festiva y celebratoria, props de temporada sutiles, iluminación cálida y alegre' },
];

const ProductAdStudio: React.FC<ProductAdStudioProps> = ({ profile, onClose, updateUsage, onUseImage, compressBase64Image }) => {
  const [productImg, setProductImg] = useState<string | null>(null);
  const [style, setStyle] = useState('estudio');
  const [extra, setExtra] = useState('');
  const [generating, setGenerating] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [lastPrompt, setLastPrompt] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const handleFile = async (file: File) => {
    const reader = new FileReader();
    reader.onload = async (ev) => {
      const raw = ev.target?.result as string;
      const compressed = await compressBase64Image(raw, 1024, 0.8, false);
      setProductImg(compressed);
      setResult(null);
    };
    reader.readAsDataURL(file);
  };

  const generate = async () => {
    if (!productImg) return;
    setGenerating(true);
    setResult(null);
    try {
      const styleObj = STYLES.find(s => s.id === style);
      const prompt = `Convertí esta foto de producto en una imagen publicitaria profesional. Mantené el producto EXACTAMENTE igual (forma, etiqueta, colores, proporciones). Estilo: ${styleObj?.prompt || ''}.${extra.trim() ? ` Indicaciones extra: ${extra.trim()}.` : ''}`;
      setLastPrompt(prompt);
      const res = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ genType: 'improve', prompt, tempImproveImage: productImg, activeLayout: 'feed' }),
      });
      let data;
      try { data = await res.json(); } catch { throw new Error('Respuesta inválida del servidor.'); }
      if (!res.ok) throw new Error(data?.error || 'Error generando la imagen');
      if (data.imageUrl) {
        await updateUsage(15000);
        setResult(String(data.imageUrl));
      } else {
        alert('No se pudo generar la imagen. Probá con otra foto o estilo.');
      }
    } catch (e: any) {
      alert(e?.message || 'No se pudo generar la publicidad.');
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[90] bg-gradient-to-b from-[#FBFBFD] to-[#F4F5F8] flex flex-col animate-in fade-in duration-300">
      <header className="h-20 bg-white/80 backdrop-blur-xl border-b border-slate-100 flex items-center justify-between px-5 sm:px-8 shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 bg-gradient-to-br from-emerald-500 to-teal-500 text-white rounded-2xl flex items-center justify-center shadow-lg shadow-emerald-200/50"><i className="fa-solid fa-box-open text-lg"></i></div>
          <div>
            <h2 className="text-lg font-black text-slate-900 tracking-tight leading-none">Producto → Publicidad</h2>
            <span className="text-[9px] font-black text-slate-400 uppercase tracking-[0.2em]">Subí tu producto, la IA lo convierte en un aviso</span>
          </div>
        </div>
        <button onClick={onClose} className="h-11 px-4 flex items-center gap-2 bg-slate-100 text-slate-500 rounded-2xl hover:bg-slate-200 transition-all active:scale-95 text-[10px] font-black uppercase tracking-widest"><i className="fa-solid fa-arrow-left"></i> Volver</button>
      </header>

      <div className="flex-1 overflow-y-auto p-5 sm:p-8">
        <div className="max-w-2xl mx-auto space-y-6">

          {/* Subir producto */}
          <section className="bg-white rounded-[28px] border border-slate-100 p-6 shadow-sm shadow-slate-200/40 space-y-4">
            <h3 className="text-[11px] font-black text-slate-900 uppercase tracking-[0.2em]">1 · Foto del producto</h3>
            {productImg ? (
              <div className="flex items-center gap-4">
                <div className="w-28 h-28 rounded-2xl bg-slate-50 border border-slate-100 overflow-hidden flex items-center justify-center shrink-0">
                  <img src={productImg} className="max-w-full max-h-full object-contain" />
                </div>
                <button onClick={() => fileRef.current?.click()} className="px-4 py-2.5 bg-slate-100 text-slate-600 rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-slate-200 transition-all">Cambiar foto</button>
              </div>
            ) : (
              <button onClick={() => fileRef.current?.click()} className="w-full py-10 rounded-2xl border-2 border-dashed border-slate-200 text-slate-400 hover:border-emerald-300 hover:text-emerald-500 transition-all flex flex-col items-center gap-2">
                <i className="fa-solid fa-arrow-up-from-bracket text-2xl"></i>
                <span className="text-[10px] font-black uppercase tracking-widest">Subir foto del producto</span>
              </button>
            )}
            <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ''; }} />
          </section>

          {/* Estilo */}
          <section className="bg-white rounded-[28px] border border-slate-100 p-6 shadow-sm shadow-slate-200/40 space-y-4">
            <h3 className="text-[11px] font-black text-slate-900 uppercase tracking-[0.2em]">2 · Estilo del aviso</h3>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
              {STYLES.map(s => (
                <button key={s.id} onClick={() => setStyle(s.id)} className={`p-3 rounded-2xl border text-[10px] font-black uppercase tracking-wider transition-all ${style === s.id ? 'bg-emerald-500 text-white border-emerald-500 shadow-md shadow-emerald-200/50' : 'bg-slate-50 text-slate-400 border-slate-100 hover:border-slate-200'}`}>{s.label}</button>
              ))}
            </div>
            <div className="space-y-2">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Indicaciones extra (opcional)</label>
              <input type="text" value={extra} onChange={(e) => setExtra(e.target.value)} placeholder="Ej: con flores, sobre fondo azul, época navideña..." className="w-full bg-slate-50 border border-slate-100 rounded-xl px-4 py-3 text-sm font-bold outline-none focus:ring-2 focus:ring-emerald-100 transition-all" />
            </div>
          </section>

          {/* Generar / resultado */}
          {result ? (
            <section className="bg-white rounded-[28px] border border-slate-100 p-6 shadow-sm shadow-slate-200/40 space-y-4">
              <h3 className="text-[11px] font-black text-slate-900 uppercase tracking-[0.2em]">3 · Resultado</h3>
              <div className="rounded-2xl overflow-hidden border border-slate-100 bg-slate-50 max-w-xs mx-auto">
                <img src={result} className="w-full" />
              </div>
              <div className="flex gap-3">
                <button onClick={generate} disabled={generating} className="px-5 h-13 py-3 bg-slate-100 text-slate-600 rounded-2xl text-[10px] font-black uppercase tracking-widest hover:bg-slate-200 transition-all disabled:opacity-50">Regenerar</button>
                <button onClick={() => onUseImage(result, lastPrompt)} className="flex-1 h-13 py-3 bg-gradient-to-r from-emerald-500 to-teal-500 text-white rounded-2xl text-[10px] font-black uppercase tracking-[0.2em] shadow-xl shadow-emerald-200/50 active:scale-[0.98] transition-all"><i className="fa-solid fa-arrow-right-to-bracket mr-1.5"></i>Usar en el editor</button>
              </div>
            </section>
          ) : (
            <button onClick={generate} disabled={!productImg || generating} className="w-full h-14 bg-gradient-to-r from-emerald-500 to-teal-500 text-white rounded-2xl text-[10px] font-black uppercase tracking-[0.2em] shadow-xl shadow-emerald-200/50 active:scale-[0.98] disabled:opacity-40 transition-all flex items-center justify-center gap-2">
              {generating ? <><i className="fa-solid fa-circle-notch fa-spin"></i> Generando publicidad…</> : <><i className="fa-solid fa-wand-magic-sparkles"></i> Generar publicidad</>}
            </button>
          )}

        </div>
      </div>
    </div>
  );
};

export default ProductAdStudio;
