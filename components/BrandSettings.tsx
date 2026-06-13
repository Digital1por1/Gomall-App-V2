import React, { useState, useRef } from 'react';
import firebase from 'firebase/compat/app';
import 'firebase/compat/auth';
import 'firebase/compat/firestore';
import 'firebase/compat/storage';
import { UserProfile, CustomFont, BrandKit } from '../types';
import { RUBROS } from './BrandOnboarding';

interface BrandSettingsProps {
  profile: UserProfile | null;
  userId: string;
  onClose: () => void;
  compressBase64Image: (base64Str: string, maxWidth?: number, quality?: number, preserveAlpha?: boolean) => Promise<string>;
}

const TONE_OPTIONS = ['Moderno', 'Elegante', 'Divertido', 'Minimalista', 'Cercano', 'Premium', 'Juvenil', 'Profesional', 'Audaz', 'Confiable'];

const BrandSettings: React.FC<BrandSettingsProps> = ({ profile, userId, onClose, compressBase64Image }) => {
  const [business, setBusiness] = useState(profile?.business || '');
  const [companyStory, setCompanyStory] = useState(profile?.companyStory || '');
  const [industry, setIndustry] = useState(profile?.industry && RUBROS.includes(profile.industry) ? profile.industry : (profile?.industry ? 'Otro' : ''));
  const [customIndustry, setCustomIndustry] = useState(profile?.industry && !RUBROS.includes(profile.industry) ? profile.industry : '');
  const [tones, setTones] = useState<string[]>(profile?.brandTone ? profile.brandTone.split(',').map(t => t.trim()).filter(Boolean) : []);

  const [logos, setLogos] = useState<string[]>(profile?.logoLibrary || []);
  const [resources, setResources] = useState<string[]>(profile?.resourceLibrary || []);
  const [fonts, setFonts] = useState<CustomFont[]>(profile?.customFonts || []);
  const [colors, setColors] = useState<string[]>(profile?.brandKits?.[0]?.brandColors || []);
  const [uploadingFont, setUploadingFont] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const logoInputRef = useRef<HTMLInputElement>(null);
  const resourceInputRef = useRef<HTMLInputElement>(null);
  const fontInputRef = useRef<HTMLInputElement>(null);

  const resolvedIndustry = industry === 'Otro' ? customIndustry.trim() : industry;

  const handleImageUpload = (file: File, target: 'logo' | 'resource') => {
    const reader = new FileReader();
    reader.onload = async (ev) => {
      const raw = ev.target?.result as string;
      const compressed = await compressBase64Image(raw, target === 'logo' ? 400 : 800, 0.6, true);
      if (target === 'logo') setLogos(prev => [...prev, compressed]);
      else setResources(prev => [...prev, compressed]);
      setSaved(false);
    };
    reader.readAsDataURL(file);
  };

  const handleFontUpload = async (file: File) => {
    setUploadingFont(true);
    try {
      const baseName = file.name.replace(/\.[^.]+$/, '');
      const family = `custom_${baseName.replace(/\s+/g, '_')}_${Date.now()}`;
      const storageRef = firebase.storage().ref(`fonts/${userId}/${Date.now()}_${file.name}`);
      const snapshot = await storageRef.put(file);
      const url = await snapshot.ref.getDownloadURL();
      const newFont: CustomFont = { name: baseName, family, url };
      const style = document.createElement('style');
      style.id = `custom-font-${family}`;
      style.textContent = `@font-face { font-family: '${family}'; src: url('${url}'); }`;
      document.head.appendChild(style);
      setFonts(prev => [...prev, newFont]);
      setSaved(false);
    } catch {
      alert('No se pudo subir la tipografía.');
    } finally {
      setUploadingFont(false);
    }
  };

  const toggleTone = (t: string) => { setSaved(false); setTones(prev => prev.includes(t) ? prev.filter(x => x !== t) : [...prev, t]); };

  const handleSave = async () => {
    setSaving(true);
    try {
      const existingKit = profile?.brandKits?.[0];
      const kitFont = fonts[0]?.family || existingKit?.headlineFont || 'Inter';
      const updatedKit: BrandKit = {
        id: existingKit?.id || `kit_${Date.now()}`,
        name: existingKit?.name || 'Kit Principal',
        logoUrls: logos,
        resourceUrls: resources,
        headlineFont: existingKit?.headlineFont || kitFont,
        descriptionFont: existingKit?.descriptionFont || kitFont,
        additionalFont: existingKit?.additionalFont || kitFont,
        ctaFont: existingKit?.ctaFont || kitFont,
        headlineColor: existingKit?.headlineColor || colors[0] || '#000000',
        descriptionColor: existingKit?.descriptionColor || '#000000',
        additionalColor: existingKit?.additionalColor || '#000000',
        ctaColor: existingKit?.ctaColor || '#FFFFFF',
        ctaBgColor: existingKit?.ctaBgColor || colors[1] || colors[0] || '#EA5B25',
        brandColors: colors,
        overlayColor: existingKit?.overlayColor || '#000000',
      };
      const otherKits = (profile?.brandKits || []).slice(1);

      await firebase.firestore().collection('profiles').doc(userId).update({
        business: business.trim() || profile?.business || '',
        companyStory: companyStory.trim(),
        industry: resolvedIndustry,
        brandTone: tones.join(', '),
        logoLibrary: logos,
        resourceLibrary: resources,
        customFonts: fonts,
        brandKits: [updatedKit, ...otherKits],
      });
      setSaved(true);
    } catch {
      alert('No se pudo guardar tu marca. Intentá de nuevo.');
    } finally {
      setSaving(false);
    }
  };

  const labelClass = "text-[10px] font-black text-slate-400 uppercase tracking-[0.15em]";
  const inputClass = "w-full bg-slate-50/80 border border-slate-200/70 rounded-2xl px-4 py-3.5 text-sm font-bold outline-none focus:ring-2 focus:ring-orange-200 focus:border-orange-200 focus:bg-white transition-all";

  return (
    <div className="fixed inset-0 z-[90] bg-gradient-to-b from-[#FBFBFD] to-[#F4F5F8] flex flex-col animate-in fade-in duration-300">
      <header className="h-20 bg-white/80 backdrop-blur-xl border-b border-slate-100 flex items-center justify-between px-5 sm:px-8 shrink-0 sticky top-0 z-10">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 bg-gradient-to-br from-[#EA5B25] to-[#f0814f] text-white rounded-2xl flex items-center justify-center shadow-lg shadow-orange-200/50"><i className="fa-solid fa-gem text-lg"></i></div>
          <div>
            <h2 className="text-lg font-black text-slate-900 tracking-tight leading-none">Mi Marca</h2>
            <span className="text-[9px] font-black text-slate-400 uppercase tracking-[0.2em]">Identidad · logos · tipografías</span>
          </div>
        </div>
        <button onClick={onClose} className="h-11 px-4 flex items-center gap-2 bg-slate-100 text-slate-500 rounded-2xl hover:bg-slate-200 transition-all active:scale-95 text-[10px] font-black uppercase tracking-widest">
          <i className="fa-solid fa-arrow-left"></i> Volver
        </button>
      </header>

      <div className="flex-1 overflow-y-auto p-5 sm:p-8">
        <div className="max-w-2xl mx-auto space-y-5">

          {/* Datos */}
          <section className="bg-white rounded-[28px] border border-slate-100 p-6 sm:p-7 shadow-sm shadow-slate-200/40 space-y-5">
            <h3 className="text-[11px] font-black text-slate-900 uppercase tracking-[0.2em] flex items-center gap-2"><i className="fa-solid fa-store text-[#EA5B25]"></i> Negocio</h3>
            <div className="space-y-2">
              <label className={labelClass}>Nombre del negocio o marca</label>
              <input type="text" className={inputClass} value={business} onChange={(e) => { setBusiness(e.target.value); setSaved(false); }} />
            </div>
            <div className="space-y-2">
              <label className={labelClass}>Rubro</label>
              <div className="flex flex-wrap gap-2">
                {RUBROS.map(r => (
                  <button key={r} onClick={() => { setIndustry(r); setSaved(false); }} className={`px-3 py-2 rounded-xl text-[10px] font-black uppercase tracking-wider transition-all ${industry === r ? 'bg-[#EA5B25] text-white shadow-md shadow-orange-200/60' : 'bg-slate-50 text-slate-400 border border-slate-100 hover:border-slate-200'}`}>{r}</button>
                ))}
              </div>
              {industry === 'Otro' && (
                <input type="text" placeholder="Especificá tu rubro" className={inputClass} value={customIndustry} onChange={(e) => { setCustomIndustry(e.target.value); setSaved(false); }} />
              )}
            </div>
            <div className="space-y-2">
              <label className={labelClass}>Historia de la empresa</label>
              <textarea rows={4} className={`${inputClass} resize-none font-medium`} value={companyStory} onChange={(e) => { setCompanyStory(e.target.value); setSaved(false); }} placeholder="Contanos qué hace tu marca y a quién le habla..." />
            </div>
            <div className="space-y-2">
              <label className={labelClass}>Tono de marca</label>
              <div className="flex flex-wrap gap-2">
                {TONE_OPTIONS.map(t => (
                  <button key={t} onClick={() => toggleTone(t)} className={`px-3 py-2 rounded-xl text-[10px] font-black uppercase tracking-wider transition-all ${tones.includes(t) ? 'bg-slate-900 text-white shadow-md' : 'bg-slate-50 text-slate-400 border border-slate-100 hover:border-slate-200'}`}>{t}</button>
                ))}
              </div>
            </div>
          </section>

          {/* Logos */}
          <section className="bg-white rounded-[28px] border border-slate-100 p-6 sm:p-7 shadow-sm shadow-slate-200/40 space-y-4">
            <h3 className="text-[11px] font-black text-slate-900 uppercase tracking-[0.2em] flex items-center gap-2"><i className="fa-solid fa-shapes text-[#EA5B25]"></i> Logos</h3>
            <div className="grid grid-cols-4 sm:grid-cols-5 gap-3">
              {logos.map((url, idx) => (
                <div key={idx} className="relative aspect-square bg-slate-50 rounded-2xl border border-slate-100 flex items-center justify-center overflow-hidden group">
                  <img src={url} className="max-w-full max-h-full object-contain p-2" />
                  <button onClick={() => { setLogos(prev => prev.filter((_, i) => i !== idx)); setSaved(false); }} className="absolute top-1 right-1 w-5 h-5 bg-white/90 text-red-500 rounded-full flex items-center justify-center text-[10px] opacity-0 group-hover:opacity-100 transition-opacity shadow"><i className="fa-solid fa-xmark"></i></button>
                </div>
              ))}
              <button onClick={() => logoInputRef.current?.click()} className="aspect-square bg-orange-50 text-[#EA5B25] rounded-2xl border border-dashed border-orange-200 flex items-center justify-center hover:bg-orange-100 transition-all"><i className="fa-solid fa-plus"></i></button>
            </div>
            <input ref={logoInputRef} type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleImageUpload(f, 'logo'); e.target.value = ''; }} />
          </section>

          {/* Recursos */}
          <section className="bg-white rounded-[28px] border border-slate-100 p-6 sm:p-7 shadow-sm shadow-slate-200/40 space-y-4">
            <h3 className="text-[11px] font-black text-slate-900 uppercase tracking-[0.2em] flex items-center gap-2"><i className="fa-solid fa-icons text-[#EA5B25]"></i> Recursos</h3>
            <div className="grid grid-cols-4 sm:grid-cols-5 gap-3">
              {resources.map((url, idx) => (
                <div key={idx} className="relative aspect-square bg-slate-50 rounded-2xl border border-slate-100 flex items-center justify-center overflow-hidden group">
                  <img src={url} className="max-w-full max-h-full object-contain p-2" />
                  <button onClick={() => { setResources(prev => prev.filter((_, i) => i !== idx)); setSaved(false); }} className="absolute top-1 right-1 w-5 h-5 bg-white/90 text-red-500 rounded-full flex items-center justify-center text-[10px] opacity-0 group-hover:opacity-100 transition-opacity shadow"><i className="fa-solid fa-xmark"></i></button>
                </div>
              ))}
              <button onClick={() => resourceInputRef.current?.click()} className="aspect-square bg-orange-50 text-[#EA5B25] rounded-2xl border border-dashed border-orange-200 flex items-center justify-center hover:bg-orange-100 transition-all"><i className="fa-solid fa-plus"></i></button>
            </div>
            <input ref={resourceInputRef} type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleImageUpload(f, 'resource'); e.target.value = ''; }} />
          </section>

          {/* Tipografías */}
          <section className="bg-white rounded-[28px] border border-slate-100 p-6 sm:p-7 shadow-sm shadow-slate-200/40 space-y-3">
            <h3 className="text-[11px] font-black text-slate-900 uppercase tracking-[0.2em] flex items-center gap-2"><i className="fa-solid fa-font text-[#EA5B25]"></i> Tipografías</h3>
            {fonts.map((font, idx) => (
              <div key={idx} className="flex items-center justify-between bg-slate-50 rounded-2xl border border-slate-100 px-4 py-3">
                <span className="text-sm font-bold text-slate-700" style={{ fontFamily: font.family }}>{font.name}</span>
                <button onClick={() => { setFonts(prev => prev.filter((_, i) => i !== idx)); setSaved(false); }} className="text-red-400 hover:text-red-600 text-xs"><i className="fa-solid fa-xmark"></i></button>
              </div>
            ))}
            <button onClick={() => fontInputRef.current?.click()} disabled={uploadingFont} className="w-full py-3 text-[#EA5B25] text-[9px] font-black uppercase tracking-widest hover:bg-orange-50 rounded-2xl transition-all border border-orange-100 border-dashed disabled:opacity-50">{uploadingFont ? 'Subiendo...' : '+ Subir tipografía (.ttf, .otf, .woff)'}</button>
            <input ref={fontInputRef} type="file" accept=".ttf,.otf,.woff,.woff2" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFontUpload(f); e.target.value = ''; }} />
          </section>

          {/* Colores */}
          <section className="bg-white rounded-[28px] border border-slate-100 p-6 sm:p-7 shadow-sm shadow-slate-200/40 space-y-4">
            <h3 className="text-[11px] font-black text-slate-900 uppercase tracking-[0.2em] flex items-center gap-2"><i className="fa-solid fa-palette text-[#EA5B25]"></i> Colores de marca</h3>
            <div className="flex flex-wrap items-center gap-2.5">
              {colors.map((color, idx) => (
                <div key={idx} className="relative group">
                  <input type="color" value={color} onChange={(e) => { setColors(prev => prev.map((c, i) => i === idx ? e.target.value : c)); setSaved(false); }} className="w-12 h-12 rounded-2xl border border-slate-200 cursor-pointer" />
                  <button onClick={() => { setColors(prev => prev.filter((_, i) => i !== idx)); setSaved(false); }} className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-white text-red-500 rounded-full flex items-center justify-center text-[9px] opacity-0 group-hover:opacity-100 transition-opacity shadow border border-slate-100"><i className="fa-solid fa-xmark"></i></button>
                </div>
              ))}
              {colors.length < 8 && (
                <button onClick={() => { setColors(prev => [...prev, '#EA5B25']); setSaved(false); }} className="w-12 h-12 bg-orange-50 text-[#EA5B25] rounded-2xl border border-dashed border-orange-200 flex items-center justify-center hover:bg-orange-100 transition-all"><i className="fa-solid fa-plus"></i></button>
              )}
            </div>
          </section>

          {/* Guardar */}
          <div className="sticky bottom-0 pt-2 pb-1">
            {saved ? (
              <div className="w-full h-14 bg-green-50 text-green-600 rounded-2xl text-[10px] font-black uppercase tracking-[0.2em] flex items-center justify-center gap-2 border border-green-100"><i className="fa-solid fa-check"></i> Cambios guardados</div>
            ) : (
              <button onClick={handleSave} disabled={saving} className="w-full h-14 bg-gradient-to-r from-[#EA5B25] to-[#f0814f] text-white rounded-2xl text-[10px] font-black uppercase tracking-[0.2em] shadow-xl shadow-orange-200/50 active:scale-[0.98] disabled:opacity-50 transition-all">{saving ? 'Guardando...' : 'Guardar cambios'}</button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default BrandSettings;
