import React, { useState, useEffect } from 'react';
import firebase from 'firebase/compat/app';
import 'firebase/compat/firestore';
import { UserProfile, Campaign, CampaignPiece } from '../types';
import { recordUsage } from './usageTracker';
import { persistImage } from './storage';

const compressImage = (file: File): Promise<string> => new Promise((resolve) => {
  const reader = new FileReader();
  reader.onload = (ev) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      let w = img.width, h = img.height; const max = 1024;
      if (w > max) { h = Math.round((h * max) / w); w = max; }
      canvas.width = w; canvas.height = h;
      canvas.getContext('2d')?.drawImage(img, 0, 0, w, h);
      resolve(canvas.toDataURL('image/jpeg', 0.82));
    };
    img.src = ev.target?.result as string;
  };
  reader.readAsDataURL(file);
});

interface CampaignStudioProps {
  profile: UserProfile | null;
  userId: string;
  onClose: () => void;
  updateUsage: (tokens: number) => Promise<void>;
  onUsePiece: (piece: CampaignPiece, campaignId?: string, productImage?: string, campaign?: Campaign) => void;
  initialBrief?: { keyMessage?: string; dates?: string } | null;
  openCampaignId?: string | null;
  restoreCampaign?: Campaign | null; // borrador en memoria para reabrir al volver del editor (sin guardar)
}

const OBJECTIVES = ['Vender', 'Lanzar producto', 'Dar a conocer la marca', 'Promoción u oferta', 'Evento', 'Fidelizar clientes'];
const PLATFORMS = ['Feed / Stories', 'Reels'];

type View = 'list' | 'brief' | 'result';

const CampaignStudio: React.FC<CampaignStudioProps> = ({ profile, userId, onClose, updateUsage, onUsePiece, initialBrief, openCampaignId, restoreCampaign }) => {
  const [view, setView] = useState<View>(initialBrief ? 'brief' : 'list');
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [activeCampaign, setActiveCampaign] = useState<Campaign | null>(null);
  const [isSaved, setIsSaved] = useState(false);

  // Brief
  const [objective, setObjective] = useState('');
  const [product, setProduct] = useState('');
  const [briefImages, setBriefImages] = useState<string[]>([]);
  const [audience, setAudience] = useState('');
  const [dates, setDates] = useState(initialBrief?.dates || '');
  const [platforms, setPlatforms] = useState<string[]>(['Feed / Stories']);
  const [keyMessage, setKeyMessage] = useState(initialBrief?.keyMessage || '');
  const [pieceCount, setPieceCount] = useState(4);

  const savedCampaigns = profile?.campaigns || [];

  // Al abrir/volver: si hay una campaña guardada por id, abrirla; si no, restaurar el borrador en memoria
  useEffect(() => {
    if (openCampaignId) {
      const c = savedCampaigns.find(x => x.id === openCampaignId);
      if (c) { setActiveCampaign(c); setIsSaved(true); setView('result'); return; }
    }
    if (restoreCampaign) {
      setActiveCampaign(restoreCampaign);
      setIsSaved(savedCampaigns.some(x => x.id === restoreCampaign.id));
      setView('result');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openCampaignId, restoreCampaign]);

  const resetBrief = () => {
    setObjective(''); setProduct(''); setBriefImages([]); setAudience(''); setDates('');
    setPlatforms(['Feed / Stories']); setKeyMessage(''); setPieceCount(4);
  };

  const togglePlatform = (p: string) => {
    setPlatforms(prev => prev.includes(p) ? prev.filter(x => x !== p) : [...prev, p]);
  };

  const briefValid = objective && product.trim() && platforms.length > 0;

  const handleGenerate = async () => {
    if (!briefValid) return;
    setGenerating(true);
    try {
      const res = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          genType: 'campaign',
          campaignBrief: {
            objective, product, audience, dates, platforms, keyMessage, pieceCount,
            images: briefImages.map(d => ({ data: d.split(',')[1], mime: (d.match(/^data:([^;]+)/) || [])[1] || 'image/jpeg' })),
          },
          brandContext: {
            business: profile?.business || '',
            industry: profile?.industry || '',
            brandTone: profile?.brandTone || '',
            companyStory: profile?.companyStory || '',
            website: profile?.website || '',
          },
        }),
      });

      let data;
      try { data = await res.json(); } catch { throw new Error('Respuesta inválida del servidor.'); }
      if (!res.ok) throw new Error(data?.error || 'Error generando la campaña');

      const clean = String(data.text || '').replace(/```json|```/g, '').trim();
      const parsed = JSON.parse(clean);
      const pieces: CampaignPiece[] = (parsed.pieces || []).map((p: any, i: number) => ({
        id: `piece_${Date.now()}_${i}`,
        type: ['imagen', 'reel', 'copy'].includes(p.type) ? p.type : 'imagen',
        title: String(p.title || `Pieza ${i + 1}`),
        format: String(p.format || ''),
        imagePrompt: String(p.imagePrompt || ''),
        copy: String(p.copy || ''),
        rationale: String(p.rationale || ''),
      }));

      const campaign: Campaign = {
        id: `camp_${Date.now()}`,
        name: String(parsed.name || 'Campaña sin nombre'),
        objective, audience, product, dates, platforms, keyMessage,
        pieces,
        createdAt: Date.now(),
        productImage: briefImages[0] || undefined,
      };

      await updateUsage(4000);
      recordUsage('campana', data.usage);
      setActiveCampaign(campaign);
      setIsSaved(false);
      setView('result');
    } catch (e: any) {
      alert(e?.message || 'No se pudo generar la campaña. Intenta de nuevo.');
    } finally {
      setGenerating(false);
    }
  };

  // Persiste una campaña (sube la foto del producto a Storage y hace upsert en Firestore)
  const persistCampaign = async (camp: Campaign): Promise<Campaign> => {
    let toSave = camp;
    if (camp.productImage && camp.productImage.startsWith('data:')) {
      const url = await persistImage(camp.productImage, 'campanas');
      toSave = { ...camp, productImage: url || undefined };
    }
    const updated = [toSave, ...savedCampaigns.filter(c => c.id !== toSave.id)];
    await firebase.firestore().collection('profiles').doc(userId).update({ campaigns: updated });
    return toSave;
  };

  const handleSaveCampaign = async () => {
    if (!activeCampaign) return;
    setSaving(true);
    try {
      const saved = await persistCampaign(activeCampaign);
      setActiveCampaign(saved);
      setIsSaved(true);
    } catch {
      alert('No se pudo guardar la campaña.');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteCampaign = async (id: string) => {
    if (!confirm('¿Eliminar esta campaña?')) return;
    try {
      const updated = savedCampaigns.filter(c => c.id !== id);
      await firebase.firestore().collection('profiles').doc(userId).update({ campaigns: updated });
    } catch {
      alert('No se pudo eliminar la campaña.');
    }
  };

  // Permite a la marca editar cualquier pieza generada (título, copy, prompt)
  const updatePiece = (id: string, patch: Partial<CampaignPiece>) => {
    setActiveCampaign(prev => prev ? { ...prev, pieces: prev.pieces.map(p => p.id === id ? { ...p, ...patch } : p) } : prev);
    setIsSaved(false);
  };

  const typeBadge = (type: string) => {
    if (type === 'reel') return { label: 'Reel', icon: 'fa-film', cls: 'bg-purple-50 text-purple-600' };
    if (type === 'copy') return { label: 'Copy', icon: 'fa-pen-nib', cls: 'bg-blue-50 text-blue-600' };
    return { label: 'Imagen', icon: 'fa-image', cls: 'bg-orange-50 text-[#EA5B25]' };
  };

  const inputClass = "w-full h-12 bg-slate-50 border border-slate-100 rounded-2xl px-4 text-sm font-bold outline-none focus:ring-2 focus:ring-orange-100 transition-all";
  const labelClass = "text-[10px] font-black text-slate-400 uppercase tracking-widest px-1";

  return (
    <div className="fixed inset-0 z-[100] bg-[#F8F9FA] flex flex-col animate-in fade-in duration-300">
      {/* Header */}
      <header className="h-20 bg-white border-b border-slate-100 flex items-center justify-between px-5 sm:px-8 shrink-0 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-orange-50 text-[#EA5B25] rounded-2xl flex items-center justify-center"><i className="fa-solid fa-bullhorn text-lg"></i></div>
          <div>
            <h2 className="font-display text-xl text-slate-900 tracking-tight leading-none">Campañas IA</h2>
            <span className="text-[9px] font-black text-slate-300 uppercase tracking-widest">Estrategia de contenido</span>
          </div>
        </div>
        <button onClick={onClose} className="h-11 px-4 flex items-center gap-2 bg-slate-100 text-slate-500 rounded-2xl hover:bg-slate-200 transition-all active:scale-95 text-[10px] font-black uppercase tracking-widest"><i className="fa-solid fa-arrow-left"></i> Volver</button>
      </header>

      <div className="flex-1 overflow-y-auto p-5 sm:p-8">
        <div className="max-w-3xl mx-auto">

          {/* LISTA */}
          {view === 'list' && (
            <div className="space-y-6 animate-in fade-in duration-300">
              <button onClick={() => { resetBrief(); setView('brief'); }} className="w-full h-16 bg-[#EA5B25] text-white rounded-2xl text-[11px] font-black uppercase tracking-[0.2em] shadow-xl active:scale-95 transition-all flex items-center justify-center gap-3">
                <i className="fa-solid fa-plus"></i> Nueva campaña
              </button>

              {savedCampaigns.length === 0 ? (
                <div className="text-center py-16 space-y-3">
                  <div className="w-16 h-16 bg-slate-100 text-slate-300 rounded-3xl flex items-center justify-center mx-auto"><i className="fa-solid fa-bullhorn text-2xl"></i></div>
                  <p className="text-slate-400 text-sm font-bold">Todavía no tenés campañas.</p>
                  <p className="text-slate-300 text-xs">Creá un brief y la IA te arma la estrategia completa.</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {savedCampaigns.map(c => (
                    <div key={c.id} className="bg-white rounded-3xl border border-slate-100 p-5 shadow-sm flex items-center justify-between gap-4">
                      <button onClick={() => { setActiveCampaign(c); setIsSaved(true); setView('result'); }} className="flex-1 text-left">
                        <h3 className="font-black text-slate-900 tracking-tight">{c.name}</h3>
                        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mt-1">{c.objective} · {c.pieces.length} piezas</p>
                      </button>
                      <button onClick={() => handleDeleteCampaign(c.id)} className="w-9 h-9 flex items-center justify-center bg-slate-50 text-slate-300 rounded-xl hover:text-red-500 transition-all"><i className="fa-solid fa-trash text-xs"></i></button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* BRIEF */}
          {view === 'brief' && (
            <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-300">
              <div className="space-y-1">
                <h3 className="font-display text-[22px] text-slate-900 tracking-tight">Brief de campaña</h3>
                <p className="text-slate-400 text-sm">La IA usará tu marca y rubro ({profile?.industry || 'sin rubro'}) para recomendar contenido.</p>
              </div>

              <div className="space-y-2">
                <label className={labelClass}>Objetivo <span className="text-[#EA5B25]">*</span></label>
                <div className="flex flex-wrap gap-2">
                  {OBJECTIVES.map(o => (
                    <button key={o} onClick={() => setObjective(o)} className={`px-3 py-2 rounded-xl text-[10px] font-black uppercase tracking-wider transition-all ${objective === o ? 'bg-[#EA5B25] text-white shadow-sm' : 'bg-slate-50 text-slate-400 border border-slate-100'}`}>{o}</button>
                  ))}
                </div>
              </div>

              <div className="space-y-2">
                <label className={labelClass}>Producto o servicio destacado <span className="text-[#EA5B25]">*</span></label>
                <input type="text" placeholder="Ej: Nueva colección de invierno" className={inputClass} value={product} onChange={(e) => setProduct(e.target.value)} />
              </div>

              <div className="space-y-2">
                <label className={labelClass}>Foto del producto y referencias <span className="text-slate-300 normal-case font-bold">(opcional)</span></label>
                <p className="text-[9px] text-slate-300 font-bold px-1">La IA usa estas fotos para que los prompts y las imágenes muestren tu producto real.</p>
                <div className="grid grid-cols-4 gap-2">
                  {briefImages.map((src, idx) => (
                    <div key={idx} className="relative aspect-square bg-slate-50 rounded-2xl border border-slate-100 overflow-hidden group">
                      <img src={src} className="w-full h-full object-cover" />
                      <button onClick={() => setBriefImages(prev => prev.filter((_, i) => i !== idx))} className="absolute top-1 right-1 w-5 h-5 bg-white/90 text-red-500 rounded-full flex items-center justify-center text-[10px] opacity-0 group-hover:opacity-100 transition-opacity shadow"><i className="fa-solid fa-xmark"></i></button>
                      {idx === 0 && <span className="absolute bottom-0 inset-x-0 bg-[#EA5B25] text-white text-[7px] font-black uppercase tracking-wider text-center py-0.5">Producto</span>}
                    </div>
                  ))}
                  {briefImages.length < 4 && (
                    <label className="aspect-square bg-orange-50 text-[#EA5B25] rounded-2xl border border-dashed border-orange-200 flex items-center justify-center hover:bg-orange-100 transition-all cursor-pointer">
                      <i className="fa-solid fa-plus"></i>
                      <input type="file" accept="image/*" className="hidden" onChange={async (e) => { const input = e.currentTarget; const f = input.files?.[0]; if (f) { const img = await compressImage(f); setBriefImages(prev => [...prev, img]); } input.value = ''; }} />
                    </label>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className={labelClass}>Público objetivo</label>
                  <input type="text" placeholder="Ej: Mujeres 25-40" className={inputClass} value={audience} onChange={(e) => setAudience(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <label className={labelClass}>Fechas / temporada</label>
                  <input type="text" placeholder="Ej: Junio, Día del Padre" className={inputClass} value={dates} onChange={(e) => setDates(e.target.value)} />
                </div>
              </div>

              <div className="space-y-2">
                <label className={labelClass}>Plataformas <span className="text-[#EA5B25]">*</span></label>
                <div className="flex flex-wrap gap-2">
                  {PLATFORMS.map(p => (
                    <button key={p} onClick={() => togglePlatform(p)} className={`px-3 py-2 rounded-xl text-[10px] font-black uppercase tracking-wider transition-all ${platforms.includes(p) ? 'bg-[#EA5B25] text-white shadow-sm' : 'bg-slate-50 text-slate-400 border border-slate-100'}`}>{p}</button>
                  ))}
                </div>
              </div>

              <div className="space-y-2">
                <label className={labelClass}>Mensaje clave / oferta</label>
                <textarea placeholder="Ej: 30% off toda la semana, envío gratis..." rows={3} className="w-full bg-slate-50 border border-slate-100 rounded-2xl px-4 py-3 text-sm font-medium outline-none focus:ring-2 focus:ring-orange-100 transition-all resize-none" value={keyMessage} onChange={(e) => setKeyMessage(e.target.value)} />
              </div>

              <div className="space-y-2">
                <label className={labelClass}>¿Cuántas publicaciones querés?</label>
                <p className="text-[9px] text-slate-300 font-bold px-1">Cada publicación es un contenido distinto (un post o un reel) con su imagen y su texto.</p>
                <div className="flex gap-2 flex-wrap">
                  {[1, 2, 3, 4, 5, 6].map(n => (
                    <button key={n} onClick={() => setPieceCount(n)} className={`w-12 h-12 rounded-xl text-sm font-black transition-all ${pieceCount === n ? 'bg-[#EA5B25] text-white shadow-sm' : 'bg-slate-50 text-slate-400 border border-slate-100'}`}>{n}</button>
                  ))}
                </div>
              </div>

              <div className="flex gap-3 pt-2">
                <button onClick={() => setView('list')} className="px-6 h-14 bg-slate-100 text-slate-500 rounded-2xl text-[10px] font-black uppercase tracking-widest active:scale-95 transition-all">Atrás</button>
                <button onClick={handleGenerate} disabled={!briefValid || generating} className="flex-1 h-14 bg-[#EA5B25] text-white rounded-2xl text-[10px] font-black uppercase tracking-[0.2em] shadow-xl active:scale-95 disabled:opacity-40 transition-all flex items-center justify-center gap-2">
                  {generating ? (<><i className="fa-solid fa-spinner fa-spin"></i> Generando campaña...</>) : (<><i className="fa-solid fa-wand-magic-sparkles"></i> Generar campaña</>)}
                </button>
              </div>
            </div>
          )}

          {/* RESULTADO */}
          {view === 'result' && activeCampaign && (
            <div className="space-y-6 animate-in fade-in duration-300">
              <div className="flex items-start justify-between gap-4">
                <div className="space-y-1">
                  <h3 className="font-display text-[22px] text-slate-900 tracking-tight">{activeCampaign.name}</h3>
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">{activeCampaign.objective} · {activeCampaign.pieces.length} piezas</p>
                </div>
                <button onClick={() => setView('list')} className="text-[9px] font-black text-slate-300 uppercase tracking-widest hover:text-[#EA5B25] transition-colors shrink-0 pt-2">← Volver</button>
              </div>

              <div className="space-y-4">
                {activeCampaign.pieces.map((piece, idx) => {
                  const badge = typeBadge(piece.type);
                  return (
                    <div key={piece.id} className="bg-white rounded-3xl border border-slate-100 p-5 shadow-sm space-y-4">
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-3 flex-1 min-w-0">
                          <span className={`px-3 py-1.5 rounded-lg text-[9px] font-black uppercase tracking-wider flex items-center gap-1.5 shrink-0 ${badge.cls}`}><i className={`fa-solid ${badge.icon}`}></i>{badge.label}</span>
                          <span className="text-[10px] font-black text-slate-300 shrink-0">{idx + 1}.</span>
                          <input value={piece.title} onChange={(e) => updatePiece(piece.id, { title: e.target.value })} className="flex-1 min-w-0 bg-transparent font-black text-slate-900 text-sm tracking-tight outline-none focus:bg-slate-50 rounded-lg px-1 py-0.5 transition-all" />
                        </div>
                        {piece.format && <span className="text-[9px] font-bold text-slate-300 uppercase tracking-wider shrink-0">{piece.format}</span>}
                      </div>

                      {piece.rationale && (
                        <p className="text-xs text-slate-500 font-medium bg-slate-50 rounded-xl px-3 py-2 border border-slate-100"><i className="fa-solid fa-lightbulb text-amber-400 mr-1.5"></i>{piece.rationale}</p>
                      )}

                      <div className="space-y-1">
                        <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Copy <span className="text-slate-300 normal-case">(editable)</span></label>
                        <textarea value={piece.copy} onChange={(e) => updatePiece(piece.id, { copy: e.target.value })} rows={4} className="w-full text-sm text-slate-700 font-medium leading-relaxed bg-slate-50 border border-slate-100 rounded-xl px-3 py-2.5 outline-none focus:ring-2 focus:ring-orange-100 focus:bg-white transition-all resize-none" />
                      </div>

                      <div className="space-y-1">
                        <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Prompt visual <span className="text-slate-300 normal-case">(editable)</span></label>
                        <textarea value={piece.imagePrompt} onChange={(e) => updatePiece(piece.id, { imagePrompt: e.target.value })} rows={3} placeholder="Describí el visual a generar (sin texto)…" className="w-full text-[11px] text-slate-500 font-mono bg-slate-50 border border-slate-100 rounded-xl px-3 py-2.5 leading-relaxed outline-none focus:ring-2 focus:ring-orange-100 focus:bg-white transition-all resize-none" />
                      </div>

                      <div className="flex gap-2 pt-1">
                        <button onClick={() => { navigator.clipboard?.writeText(piece.copy); }} className="flex-1 py-2.5 bg-slate-50 text-slate-500 rounded-xl text-[9px] font-black uppercase tracking-widest hover:bg-slate-100 transition-all border border-slate-100"><i className="fa-solid fa-copy mr-1.5"></i>Copiar texto</button>
                        {(piece.type === 'imagen' || piece.type === 'reel') && (
                          <button onClick={() => onUsePiece(piece, activeCampaign.id, activeCampaign.productImage, activeCampaign)} className="flex-1 py-2.5 bg-orange-50 text-[#EA5B25] rounded-xl text-[9px] font-black uppercase tracking-widest hover:bg-orange-100 transition-all border border-orange-100"><i className="fa-solid fa-arrow-right-to-bracket mr-1.5"></i>Crear en editor</button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              {!isSaved ? (
                <button onClick={handleSaveCampaign} disabled={saving} className="w-full h-14 bg-[#EA5B25] text-white rounded-2xl text-[10px] font-black uppercase tracking-[0.2em] shadow-xl active:scale-95 disabled:opacity-40 transition-all">{saving ? 'Guardando...' : 'Guardar campaña'}</button>
              ) : (
                <div className="w-full h-14 bg-green-50 text-green-600 rounded-2xl text-[10px] font-black uppercase tracking-[0.2em] flex items-center justify-center gap-2 border border-green-100"><i className="fa-solid fa-check"></i> Campaña guardada</div>
              )}
            </div>
          )}

        </div>
      </div>
    </div>
  );
};

export default CampaignStudio;
