import React, { useState, useRef } from 'react';
import firebase from 'firebase/compat/app';
import 'firebase/compat/auth';
import 'firebase/compat/firestore';
import 'firebase/compat/storage';
import { CustomFont, BrandKit } from '../types';

interface BrandOnboardingProps {
  user: firebase.User;
  compressBase64Image: (base64Str: string, maxWidth?: number, quality?: number, preserveAlpha?: boolean) => Promise<string>;
  onLogout: () => void;
}

const TONE_OPTIONS = ['Moderno', 'Elegante', 'Divertido', 'Minimalista', 'Cercano', 'Premium', 'Juvenil', 'Profesional', 'Audaz', 'Confiable'];

export const RUBROS = [
  'Gastronomía', 'Moda y Vestimenta', 'Belleza y Estética', 'Salud y Bienestar',
  'Tecnología', 'Hogar y Decoración', 'Deportes y Fitness', 'Educación',
  'Servicios Profesionales', 'Inmobiliaria', 'Automotriz', 'Entretenimiento',
  'Turismo y Viajes', 'Mascotas', 'Joyería y Accesorios', 'Supermercado y Alimentos',
  'Centro Comercial', 'Otro'
];

const BrandOnboarding: React.FC<BrandOnboardingProps> = ({ user, compressBase64Image, onLogout }) => {
  const [step, setStep] = useState(1);
  const [saving, setSaving] = useState(false);

  // Paso 1 — Perfil
  const [name, setName] = useState('');
  const [business, setBusiness] = useState('');

  // Paso 2 — Historia de marca
  const [companyStory, setCompanyStory] = useState('');
  const [industry, setIndustry] = useState('');
  const [customIndustry, setCustomIndustry] = useState('');
  const [tones, setTones] = useState<string[]>([]);

  const resolvedIndustry = industry === 'Otro' ? customIndustry.trim() : industry;

  // Paso 3 — Identidad visual
  const [logos, setLogos] = useState<string[]>([]);
  const [resources, setResources] = useState<string[]>([]);
  const [fonts, setFonts] = useState<CustomFont[]>([]);
  const [colors, setColors] = useState<string[]>([]);
  const [uploadingFont, setUploadingFont] = useState(false);

  const logoInputRef = useRef<HTMLInputElement>(null);
  const resourceInputRef = useRef<HTMLInputElement>(null);
  const fontInputRef = useRef<HTMLInputElement>(null);

  const handleImageUpload = async (file: File, target: 'logo' | 'resource') => {
    const reader = new FileReader();
    reader.onload = async (ev) => {
      const raw = ev.target?.result as string;
      const compressed = await compressBase64Image(raw, target === 'logo' ? 400 : 800, 0.6, true);
      if (target === 'logo') setLogos(prev => [...prev, compressed]);
      else setResources(prev => [...prev, compressed]);
    };
    reader.readAsDataURL(file);
  };

  const handleFontUpload = async (file: File) => {
    setUploadingFont(true);
    try {
      const baseName = file.name.replace(/\.[^.]+$/, '');
      const family = `custom_${baseName.replace(/\s+/g, '_')}_${Date.now()}`;
      const storageRef = firebase.storage().ref(`fonts/${user.uid}/${Date.now()}_${file.name}`);
      const snapshot = await storageRef.put(file);
      const url = await snapshot.ref.getDownloadURL();
      const newFont: CustomFont = { name: baseName, family, url };
      const style = document.createElement('style');
      style.id = `custom-font-${family}`;
      style.textContent = `@font-face { font-family: '${family}'; src: url('${url}'); }`;
      document.head.appendChild(style);
      setFonts(prev => [...prev, newFont]);
    } catch (e) {
      alert('No se pudo subir la tipografía. Intenta de nuevo.');
    } finally {
      setUploadingFont(false);
    }
  };

  const toggleTone = (tone: string) => {
    setTones(prev => prev.includes(tone) ? prev.filter(t => t !== tone) : [...prev, tone]);
  };

  const step1Valid = Boolean(name.trim() && business.trim());
  const step2Valid = companyStory.trim().length >= 20 && resolvedIndustry.length > 0;
  const step3Valid = logos.length > 0;

  const handleFinish = async () => {
    if (!step3Valid) return;
    setSaving(true);
    try {
      const initialUsage = { tokensUsed: 0, lastReset: Date.now() };
      const tokenLimit = 1000000;
      const kitFont = fonts.length > 0 ? fonts[0].family : 'Inter';

      const defaultKit: BrandKit = {
        id: `kit_${Date.now()}`,
        name: 'Kit Principal',
        logoUrls: logos,
        resourceUrls: resources,
        headlineFont: kitFont,
        descriptionFont: kitFont,
        additionalFont: kitFont,
        ctaFont: kitFont,
        headlineColor: colors[0] || '#000000',
        descriptionColor: '#000000',
        additionalColor: '#000000',
        ctaColor: '#FFFFFF',
        ctaBgColor: colors[1] || colors[0] || '#EA5B25',
        brandColors: colors,
        overlayColor: '#000000',
      };

      await firebase.firestore().collection('profiles').doc(user.uid).set({
        name: name.trim(),
        business: business.trim(),
        mall: '',
        email: user.email,
        usage: initialUsage,
        tokenLimit,
        companyStory: companyStory.trim(),
        industry: resolvedIndustry,
        brandTone: tones.join(', '),
        onboardingCompleted: true,
        logoLibrary: logos,
        resourceLibrary: resources,
        backgroundLibrary: [],
        customFonts: fonts,
        brandKits: [defaultKit],
        updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      });
      // El onSnapshot del perfil en App.tsx detecta onboardingCompleted y muestra el editor.
    } catch (e) {
      alert('Hubo un problema al guardar tu identidad de marca. Intenta de nuevo.');
      setSaving(false);
    }
  };

  const inputClass = "w-full h-14 bg-slate-50 border border-slate-100 rounded-2xl px-4 text-sm font-bold outline-none focus:ring-2 focus:ring-orange-100 transition-all";
  const labelClass = "text-[10px] font-black text-slate-400 uppercase tracking-widest px-1";

  return (
    <div className="h-screen w-full flex flex-col items-center justify-center bg-[#F8F9FA] p-4 sm:p-6">
      <div className="max-w-lg w-full bg-white rounded-[40px] p-8 sm:p-10 shadow-xl border border-slate-50 space-y-7 animate-in slide-in-from-bottom-10 duration-500 overflow-y-auto max-h-[92vh]">
        {/* Encabezado + progreso */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="w-10 h-10 bg-orange-50 text-[#EA5B25] rounded-2xl flex items-center justify-center"><i className="fa-solid fa-fingerprint text-lg"></i></div>
            <button onClick={onLogout} className="text-[9px] font-black text-slate-300 uppercase tracking-[0.2em] hover:text-[#EA5B25] transition-colors">Salir</button>
          </div>
          <div className="space-y-1">
            <h2 className="text-2xl font-black text-slate-900 tracking-tight">
              {step === 1 && 'Tu perfil'}
              {step === 2 && 'Tu historia de marca'}
              {step === 3 && 'Tu identidad visual'}
            </h2>
            <p className="text-slate-400 text-sm">
              {step === 1 && 'Empecemos con lo básico de tu negocio.'}
              {step === 2 && 'Contanos quién sos para que la IA hable como tu marca.'}
              {step === 3 && 'Sumá tus logos, recursos, tipografías y colores.'}
            </p>
          </div>
          <div className="flex gap-2">
            {[1, 2, 3].map(s => (
              <div key={s} className={`h-1.5 flex-1 rounded-full transition-all ${s <= step ? 'bg-[#EA5B25]' : 'bg-slate-100'}`}></div>
            ))}
          </div>
        </div>

        {/* Paso 1 */}
        {step === 1 && (
          <div className="space-y-5 animate-in fade-in slide-in-from-right-4 duration-300">
            <div className="space-y-2">
              <label className={labelClass}>Tu Nombre</label>
              <input type="text" placeholder="Ej: Juan Pérez" className={inputClass} value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="space-y-2">
              <label className={labelClass}>Nombre de tu negocio o marca</label>
              <input type="text" placeholder="Ej: Boutique Elegance" className={inputClass} value={business} onChange={(e) => setBusiness(e.target.value)} />
            </div>
          </div>
        )}

        {/* Paso 2 */}
        {step === 2 && (
          <div className="space-y-5 animate-in fade-in slide-in-from-right-4 duration-300">
            <div className="space-y-2">
              <label className={labelClass}>Rubro <span className="text-[#EA5B25]">*</span></label>
              <p className="text-[9px] text-slate-300 font-bold px-1">La IA usará tu rubro para recomendar campañas a medida.</p>
              <div className="flex flex-wrap gap-2">
                {RUBROS.map(r => (
                  <button key={r} onClick={() => setIndustry(r)} className={`px-3 py-2 rounded-xl text-[10px] font-black uppercase tracking-wider transition-all ${industry === r ? 'bg-[#EA5B25] text-white shadow-sm' : 'bg-slate-50 text-slate-400 border border-slate-100'}`}>{r}</button>
                ))}
              </div>
              {industry === 'Otro' && (
                <input type="text" placeholder="Especificá tu rubro" className={inputClass} value={customIndustry} onChange={(e) => setCustomIndustry(e.target.value)} />
              )}
            </div>
            <div className="space-y-2">
              <label className={labelClass}>Historia de la empresa</label>
              <textarea placeholder="Contanos qué hace tu marca, qué la hace especial, a quién le habla..." rows={5} className="w-full bg-slate-50 border border-slate-100 rounded-2xl px-4 py-3 text-sm font-medium outline-none focus:ring-2 focus:ring-orange-100 transition-all resize-none" value={companyStory} onChange={(e) => setCompanyStory(e.target.value)} />
              <p className="text-[9px] text-slate-300 font-bold px-1">{companyStory.trim().length < 20 ? `Escribe al menos 20 caracteres (${companyStory.trim().length}/20)` : 'Perfecto ✓'}</p>
            </div>
            <div className="space-y-2">
              <label className={labelClass}>Tono de marca</label>
              <div className="flex flex-wrap gap-2">
                {TONE_OPTIONS.map(tone => (
                  <button key={tone} onClick={() => toggleTone(tone)} className={`px-3 py-2 rounded-xl text-[10px] font-black uppercase tracking-wider transition-all ${tones.includes(tone) ? 'bg-[#EA5B25] text-white shadow-sm' : 'bg-slate-50 text-slate-400 border border-slate-100'}`}>{tone}</button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Paso 3 */}
        {step === 3 && (
          <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-300">
            {/* Logos */}
            <div className="space-y-2">
              <label className={labelClass}>Logos <span className="text-[#EA5B25]">*</span></label>
              <div className="grid grid-cols-4 gap-2">
                {logos.map((url, idx) => (
                  <div key={idx} className="relative aspect-square bg-slate-50 rounded-2xl border border-slate-100 flex items-center justify-center overflow-hidden group">
                    <img src={url} alt="logo" className="max-w-full max-h-full object-contain p-2" />
                    <button onClick={() => setLogos(prev => prev.filter((_, i) => i !== idx))} className="absolute top-1 right-1 w-5 h-5 bg-white/90 text-red-500 rounded-full flex items-center justify-center text-[10px] opacity-0 group-hover:opacity-100 transition-opacity shadow"><i className="fa-solid fa-xmark"></i></button>
                  </div>
                ))}
                <button onClick={() => logoInputRef.current?.click()} className="aspect-square bg-orange-50 text-[#EA5B25] rounded-2xl border border-dashed border-orange-200 flex items-center justify-center hover:bg-orange-100 transition-all"><i className="fa-solid fa-plus"></i></button>
              </div>
              <input ref={logoInputRef} type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleImageUpload(f, 'logo'); e.target.value = ''; }} />
            </div>

            {/* Recursos */}
            <div className="space-y-2">
              <label className={labelClass}>Recursos (sellos, patrones, íconos)</label>
              <div className="grid grid-cols-4 gap-2">
                {resources.map((url, idx) => (
                  <div key={idx} className="relative aspect-square bg-slate-50 rounded-2xl border border-slate-100 flex items-center justify-center overflow-hidden group">
                    <img src={url} alt="recurso" className="max-w-full max-h-full object-contain p-2" />
                    <button onClick={() => setResources(prev => prev.filter((_, i) => i !== idx))} className="absolute top-1 right-1 w-5 h-5 bg-white/90 text-red-500 rounded-full flex items-center justify-center text-[10px] opacity-0 group-hover:opacity-100 transition-opacity shadow"><i className="fa-solid fa-xmark"></i></button>
                  </div>
                ))}
                <button onClick={() => resourceInputRef.current?.click()} className="aspect-square bg-orange-50 text-[#EA5B25] rounded-2xl border border-dashed border-orange-200 flex items-center justify-center hover:bg-orange-100 transition-all"><i className="fa-solid fa-plus"></i></button>
              </div>
              <input ref={resourceInputRef} type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleImageUpload(f, 'resource'); e.target.value = ''; }} />
            </div>

            {/* Tipografías */}
            <div className="space-y-2">
              <label className={labelClass}>Tipografías personalizadas</label>
              <div className="space-y-2">
                {fonts.map((font, idx) => (
                  <div key={idx} className="flex items-center justify-between bg-slate-50 rounded-2xl border border-slate-100 px-4 py-3">
                    <span className="text-sm font-bold text-slate-700" style={{ fontFamily: font.family }}>{font.name}</span>
                    <button onClick={() => setFonts(prev => prev.filter((_, i) => i !== idx))} className="text-red-400 hover:text-red-600 text-xs"><i className="fa-solid fa-xmark"></i></button>
                  </div>
                ))}
              </div>
              <button onClick={() => fontInputRef.current?.click()} disabled={uploadingFont} className="w-full py-2.5 text-[#EA5B25] text-[9px] font-black uppercase tracking-widest hover:bg-orange-50 rounded-xl transition-all border border-orange-100 border-dashed disabled:opacity-50">{uploadingFont ? 'Subiendo...' : '+ Subir tipografía (.ttf, .otf, .woff)'}</button>
              <input ref={fontInputRef} type="file" accept=".ttf,.otf,.woff,.woff2" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFontUpload(f); e.target.value = ''; }} />
            </div>

            {/* Colores */}
            <div className="space-y-2">
              <label className={labelClass}>Colores de marca</label>
              <div className="flex flex-wrap items-center gap-2">
                {colors.map((color, idx) => (
                  <div key={idx} className="relative group">
                    <input type="color" value={color} onChange={(e) => setColors(prev => prev.map((c, i) => i === idx ? e.target.value : c))} className="w-11 h-11 rounded-xl border border-slate-200 cursor-pointer" />
                    <button onClick={() => setColors(prev => prev.filter((_, i) => i !== idx))} className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-white text-red-500 rounded-full flex items-center justify-center text-[9px] opacity-0 group-hover:opacity-100 transition-opacity shadow border border-slate-100"><i className="fa-solid fa-xmark"></i></button>
                  </div>
                ))}
                {colors.length < 8 && (
                  <button onClick={() => setColors(prev => [...prev, '#EA5B25'])} className="w-11 h-11 bg-orange-50 text-[#EA5B25] rounded-xl border border-dashed border-orange-200 flex items-center justify-center hover:bg-orange-100 transition-all"><i className="fa-solid fa-plus"></i></button>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Navegación */}
        <div className="flex gap-3 pt-2">
          {step > 1 && (
            <button onClick={() => setStep(step - 1)} className="px-6 h-14 bg-slate-100 text-slate-500 rounded-2xl text-[10px] font-black uppercase tracking-widest active:scale-95 transition-all">Atrás</button>
          )}
          {step < 3 && (
            <button
              onClick={() => setStep(step + 1)}
              disabled={(step === 1 && !step1Valid) || (step === 2 && !step2Valid)}
              className="flex-1 h-14 bg-[#EA5B25] text-white rounded-2xl text-[10px] font-black uppercase tracking-[0.2em] shadow-xl active:scale-95 disabled:opacity-40 transition-all"
            >Continuar</button>
          )}
          {step === 3 && (
            <button
              onClick={handleFinish}
              disabled={!step3Valid || saving}
              className="flex-1 h-14 bg-[#EA5B25] text-white rounded-2xl text-[10px] font-black uppercase tracking-[0.2em] shadow-xl active:scale-95 disabled:opacity-40 transition-all"
            >{saving ? 'Guardando...' : 'Empezar a crear'}</button>
          )}
        </div>
        {step === 3 && !step3Valid && (
          <p className="text-[9px] text-slate-300 font-bold text-center">Subí al menos un logo para continuar.</p>
        )}
      </div>
    </div>
  );
};

export default BrandOnboarding;
