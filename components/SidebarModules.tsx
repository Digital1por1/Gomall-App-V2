
import React, { useState, useRef, useEffect } from 'react';
import { ProjectState, TextLayer, UserProfile, BackgroundConfig, SavedProject } from '../types';
import { recordUsage } from './usageTracker';
import { MONTHLY_TOKEN_LIMIT } from '../App';
import firebase from 'firebase/compat/app';
import 'firebase/compat/firestore';
import 'firebase/compat/storage';

interface SidebarProps {
  state: ProjectState;
  updateState: (updates: Partial<ProjectState>) => void;
  profile: UserProfile | null;
  updateUsage: (tokens: number) => Promise<void>;
  openSection: string | null;
  setOpenSection: (section: string | null) => void;
  selectedField: string | null;
  activeLayout?: 'feed' | 'story';
  onApplyTemplate?: (type: 'classic' | 'editorial' | 'bold' | 'minimal') => void;
  savedProjects?: SavedProject[];
  onLoadProject?: (projectState: ProjectState) => void;
  onDeleteProject?: (projectId: string) => void;
  githubToken?: string | null;
  onGithubConnect?: () => void;
  onGithubDisconnect?: () => void;
  compressBase64Image?: (base64Str: string, maxWidth: number, quality: number, preserveAlpha: boolean) => Promise<string>;
  pendingPrompt?: string | null;
  onPendingPromptConsumed?: () => void;
}

const SYSTEM_FONTS = [
  'Inter', 'Montserrat', 'Playfair Display', 'Bebas Neue', 'Oswald',
  'Cinzel', 'Permanent Marker', 'JetBrains Mono', 'Lora', 'Anton',
  'Dancing Script', 'Pacifico', 'Ubuntu', 'Roboto', 'Open Sans'
];

// Keep ALL_FONTS as alias for backward compat
const ALL_FONTS = SYSTEM_FONTS;

const Accordion: React.FC<{ 
  title: string; icon: string; children: React.ReactNode; isOpen?: boolean; onToggle?: () => void;
}> = ({ title, icon, children, isOpen, onToggle }) => {
  return (
    <div className="border-b border-slate-100 last:border-none">
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between p-6 hover:bg-slate-50/70 transition-all group"
      >
        <div className="flex items-center gap-4">
          <div className={`w-11 h-11 rounded-2xl flex items-center justify-center transition-all ${isOpen ? 'bg-gradient-to-br from-[#EA5B25] to-[#f0814f] text-white shadow-lg shadow-orange-200/50' : 'bg-slate-50 text-slate-400 group-hover:bg-slate-100 group-hover:text-slate-500'}`}>
            <i className={`fa-solid ${icon} text-[14px]`}></i>
          </div>
          <span className={`font-black text-[11px] uppercase tracking-[0.2em] transition-colors ${isOpen ? 'text-slate-900' : 'text-slate-400 group-hover:text-slate-600'}`}>
            {title}
          </span>
        </div>
        <i className={`fa-solid ${isOpen ? 'fa-chevron-up text-[#EA5B25]' : 'fa-chevron-down text-slate-300'} text-[10px] transition-transform`}></i>
      </button>
      {isOpen && (
        <div className="px-8 pb-10 space-y-8 animate-in fade-in slide-in-from-top-2 duration-300">
          {children}
        </div>
      )}
    </div>
  );
};

const SidebarModules: React.FC<SidebarProps> = ({
  state, updateState, profile, updateUsage, openSection, setOpenSection,
  selectedField, activeLayout = 'feed', onApplyTemplate,
  savedProjects = [], onLoadProject, onDeleteProject,
  githubToken, onGithubConnect, onGithubDisconnect,
  compressBase64Image, pendingPrompt, onPendingPromptConsumed
}) => {
  const [promptIA, setPromptIA] = useState('');
  const [genStatus, setGenStatus] = useState<'idle' | 'generating' | 'ready'>('idle');
  const [tempImproveImage, setTempImproveImage] = useState<string | null>(null);

  // Referencias para inputs de archivos
  const logoInputRef = useRef<HTMLInputElement>(null);
  const resourceInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const improveInputRef = useRef<HTMLInputElement>(null);

  // REFERENCIAS PARA SINCRONIZACIÓN (DEEP LINKING) - APUNTANDO A CONTENEDORES
  const logoContainerRef = useRef<HTMLDivElement>(null);
  const headlineRef = useRef<HTMLDivElement>(null);
  const descriptionRef = useRef<HTMLDivElement>(null);
  const additionalRef = useRef<HTMLDivElement>(null);
  const ctaRef = useRef<HTMLDivElement>(null);

  const currentBgConfig = activeLayout === 'feed' ? state.feedBackgroundConfig : state.storyBackgroundConfig;

  // Recibe un prompt sugerido desde una campaña: lo precarga, abre la sección y genera la imagen automáticamente
  useEffect(() => {
    if (pendingPrompt && pendingPrompt.trim()) {
      const p = pendingPrompt;
      setPromptIA(p);
      setOpenSection('IMAGEN');
      onPendingPromptConsumed?.();
      generateAI('image', p);
    }
  }, [pendingPrompt]);

  // EFECTO "PASTOR" ACTUALIZADO: Sincroniza la selección del canvas con la barra lateral
  useEffect(() => {
    if (!selectedField) return;

    // 1. Determinar y abrir el acordeón correspondiente
    if (['headline', 'description', 'additional', 'cta'].includes(selectedField)) {
      if (openSection !== 'TEXTOS') setOpenSection('TEXTOS');
    } else if (selectedField === 'logo') {
      if (openSection !== 'MARCA') setOpenSection('MARCA');
    } else if (selectedField === 'resource') {
      if (openSection !== 'RECURSOS') setOpenSection('RECURSOS');
    } else if (selectedField === 'background' || selectedField === 'image') {
      if (openSection !== 'IMAGEN') setOpenSection('IMAGEN');
    }

    // 2. Scroll suave y Focus con delay para esperar la animación del acordeón
    const timer = setTimeout(() => {
      let targetRef: React.RefObject<HTMLElement | null> | null = null;
      
      switch (selectedField) {
        case 'logo': targetRef = logoContainerRef; break;
        case 'headline': targetRef = headlineRef; break;
        case 'description': targetRef = descriptionRef; break;
        case 'additional': targetRef = additionalRef; break;
        case 'cta': targetRef = ctaRef; break;
      }

      if (targetRef && targetRef.current) {
        // Scroll al contenedor para ver todas las opciones del elemento
        targetRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
        
        // Intentar enfocar el textarea dentro del contenedor
        const input = targetRef.current.querySelector('textarea') || targetRef.current.querySelector('input');
        if (input instanceof HTMLElement) {
          input.focus();
        }
      }
    }, 400);

    return () => clearTimeout(timer);
  }, [selectedField]);

  // Paleta de marca: colores definidos en el onboarding (no se extraen del logo)
  const brandPalette = Array.from(new Set((state.brandKits || []).flatMap(k => k.brandColors || [])));

  // Register @font-face for all custom fonts whenever the list changes
  useEffect(() => {
    (state.customFonts || []).forEach(font => {
      if (!font.url || !font.family) return;
      const styleId = `custom-font-${font.family}`;
      if (!document.getElementById(styleId)) {
        const style = document.createElement('style');
        style.id = styleId;
        style.textContent = `@font-face { font-family: '${font.family}'; src: url('${font.url}'); }`;
        document.head.appendChild(style);
      }
    });
  }, [state.customFonts]);

  const removeCustomFont = async (family: string) => {
    const user = firebase.auth().currentUser;
    if (!user) return;
    const updatedFonts = (state.customFonts || []).filter(f => f.family !== family);
    updateState({ customFonts: updatedFonts });
    await firebase.firestore().collection('profiles').doc(user.uid).update({ customFonts: updatedFonts });
    const styleEl = document.getElementById(`custom-font-${family}`);
    if (styleEl) styleEl.remove();
  };

  const updateTextLayer = (key: keyof typeof state.textLayers, updates: Partial<TextLayer>) => {
    const newLayers = { ...state.textLayers };
    newLayers[key] = { ...newLayers[key], ...updates };
    updateState({ textLayers: newLayers });
  };

  const navigateCopy = (dir: 'next' | 'prev') => {
    if (state.copies.length === 0) return;
    let newIndex = state.selectedCopyIndex ?? 0;
    if (dir === 'next') {
      newIndex = Math.min(state.copies.length - 1, newIndex + 1);
    } else {
      newIndex = Math.max(0, newIndex - 1);
    }
    updateState({ selectedCopyIndex: newIndex });
  };

  const generateAI = async (genType: 'image' | 'improve' | 'copy', overridePrompt?: string) => {
    const effectivePrompt = overridePrompt ?? promptIA;
    if (genType === 'image' && !effectivePrompt.trim()) {
      alert('Por favor, ingresa una idea para la imagen.');
      return;
    }
    if (genType === 'improve' && !effectivePrompt.trim() && !tempImproveImage) {
      alert('Por favor, selecciona una imagen a mejorar o describe los cambios.');
      return;
    }
    
    setGenStatus('generating');
    try {
      if (genType === 'image' || genType === 'improve') {
        const res = await fetch('/api/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            prompt: effectivePrompt,
            genType,
            tempImproveImage: tempImproveImage || null,
            activeLayout
          })
        });
        
        let data;
        try {
          data = await res.json();
        } catch (err) {
          throw new Error('No se pudo decodificar la respuesta del servidor. Intenta de nuevo.');
        }
        
        if (!res.ok) {
          throw new Error(data?.error || 'Server error generating image');
        }

        if (data.imageUrl) {
          await updateUsage(15000);
          recordUsage(genType === 'improve' ? 'mejorar' : 'imagen', data.usage);

          updateState({ 
            imageVariants: [{ id: String(Date.now()), url: String(data.imageUrl), prompt: String(effectivePrompt || 'AI Improved Post') }, ...state.imageVariants],
            selectedVariantIndex: 0
          });
          setTempImproveImage(null);
          setGenStatus('ready');
          setTimeout(() => setGenStatus('idle'), 5000);
        } else {
          setGenStatus('idle');
          alert('No se pudo generar la imagen. Intenta con otra idea.');
        }
      } else {
        const variantIdx = Number(state.selectedVariantIndex);
        const currentImageUrl = state.imageVariants[variantIdx]?.url;
        const textParts: any[] = [];
        
        if (currentImageUrl && String(currentImageUrl).startsWith('data:')) {
          textParts.push({
            inlineData: {
              data: String(currentImageUrl).split(',')[1],
              mimeType: 'image/png'
            }
          });
        }

        const promptText = `Eres un copywriter experto en redes sociales especializado en marketing directo e Instagram. 
        Tu misión es generar 1 opción de caption (copy) creativo y persuasivo basándote EXCLUSIVAMENTE en el diseño visual y los textos proporcionados.
        
        REGLAS CRÍTICAS:
        1. NO mencIONES el nombre del local o negocio ("${String(profile?.business || '')}"). Ignóralo por completo. No incluyas nombres de tiendas.
        2. NO menciones actividades o servicios que no estén en el texto del diseño (ej: no menciones "gym" si no está escrito).
        3. Céntrate en los beneficios de lo que se ve en la imagen y en los textos del diseño.
        4. EL BOTÓN DEL DISEÑO NO ES CLICKEABLE. Está terminantemente prohibido usar frases que inciten a la acción física de clickear o pulsar (ej: "haz clic aquí", "pulsa el botón", "link en bio"). El botón es solo una representation visual. Puedes mencionar su mensaje (ej: si dice "VER MÁS", puedes decir "Descubre todos los detalles"), pero nunca incites al usuario a clickear en él.
        
        DATOS DEL diseño:
        - Título del anuncio: "${String(state.textLayers.headline.content)}"
        - Descripción del anuncio: "${String(state.textLayers.description.content)}"
        - Botón CTA: "${String(state.textLayers.cta.content)}"
        
        Analiza también la imagen adjunta para que el tono sea coherente con la escena.
        
        Devuelve estrictamente un array JSON con 1 string. Sin explicaciones adicionales.
        Ejemplo: ["el texto del caption"]`;

        textParts.push({ text: String(promptText) });

        const res = await fetch('/api/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            prompt: promptText,
            genType: 'copy',
            textParts
          })
        });
        
        let data;
        try {
          data = await res.json();
        } catch (err) {
          throw new Error('No se pudo decodificar la respuesta. Intenta de nuevo.');
        }
        
        if (!res.ok) throw new Error(data?.error || 'Server error generating copy');

        try {
          const responseText = data.text || '';
          const cleanText = String(responseText).replace(/```json|```/g, '').trim();
          const copiesResult = JSON.parse(cleanText);
          if (Array.isArray(copiesResult) && copiesResult.length > 0) {
            await updateUsage(2000);
            recordUsage('copy', data.usage);
            const newCopies = [...state.copies, String(copiesResult[0])];
            updateState({ 
              copies: newCopies, 
              selectedCopyIndex: newCopies.length - 1 
            });
          }
        } catch (e) {
          console.error("Error al parsear copys:", e);
        }
        setGenStatus('idle');
      }
    } catch (e: any) {
      console.error("Error en generación IA:", e);
      alert(`Error en la generación AI: ${e?.message || 'Error desconocido'}`);
      setGenStatus('idle');
    }
  };

  const setBackgroundFocus = (x: number, y: number) => {
    const configKey = activeLayout === 'feed' ? 'feedBackgroundConfig' : 'storyBackgroundConfig';
    updateState({ [String(configKey)]: { ...state[configKey as keyof ProjectState] as any, offset: { x, y } } });
  };

  const BrandColorPalette: React.FC<{ onSelect: (color: string) => void }> = ({ onSelect }) => {
    if (brandPalette.length === 0) return null;
    return (
      <div className="space-y-3 mb-2 animate-in fade-in slide-in-from-top-1">
        <div className="flex flex-wrap gap-2 px-1">
          {brandPalette.map(color => (
            <button key={String(color)} onClick={() => onSelect(String(color))} className="w-5 h-5 rounded-md border border-white shadow-sm" style={{ backgroundColor: String(color) }} />
          ))}
        </div>
      </div>
    );
  };

  const renderTextEditor = (key: keyof typeof state.textLayers, label: string) => {
    const layer = state.textLayers[key];
    const PLACEHOLDERS: Record<string, string> = {
      headline: 'Título Impactante',
      description: 'Descripción de tu producto o servicio aquí.',
      additional: 'Información extra o promoción especial...',
      cta: 'LLAMADO A LA ACCIÓN'
    };

    // DETERMINAR LA REFERENCIA DEL CONTENEDOR PARA SCROLL
    let currentContainerRef: React.RefObject<HTMLDivElement | null> = headlineRef;
    if (key === 'description') currentContainerRef = descriptionRef;
    else if (key === 'additional') currentContainerRef = additionalRef;
    else if (key === 'cta') currentContainerRef = ctaRef;

    return (
      <div ref={currentContainerRef} id={`editor-${String(key)}`} className="space-y-4 pb-10 border-b border-slate-50 last:border-none scroll-mt-10">
        <div className="flex items-center justify-between px-1">
          <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{label}</span>
          {key === 'cta' && (
            <button 
              onClick={() => updateState({ showCta: !state.showCta })} 
              className={`w-10 h-5 rounded-full transition-all border relative ${state.showCta ? 'bg-[#EA5B25] border-[#EA5B25]' : 'bg-slate-400 border-slate-300'}`}
            >
              <div className={`absolute top-0.5 w-3.5 h-3.5 bg-white rounded-full shadow transition-transform ${state.showCta ? 'translate-x-5' : 'translate-x-0.5'}`} />
            </button>
          )}
        </div>
        <textarea 
          autoFocus={key === 'headline'}
          value={layer.content} 
          placeholder={String(PLACEHOLDERS[String(key)])}
          onChange={(e) => updateTextLayer(key, { content: e.target.value })} 
          className="w-full bg-slate-50 border border-slate-100 rounded-xl p-4 text-sm font-bold focus:ring-2 focus:ring-orange-100 outline-none resize-none shadow-sm" 
          rows={key === 'description' ? 3 : 1} 
        />
        
        <div className="space-y-4 pt-2">
          <div className="space-y-2">
            <span className="text-[9px] font-black text-slate-300 uppercase tracking-widest px-1">Tipografía</span>
            <select value={layer.font} onChange={(e) => updateTextLayer(key, { font: e.target.value })} className="w-full bg-slate-50 border border-slate-100 rounded-lg p-2.5 text-[11px] font-bold outline-none shadow-sm">
              <optgroup label="Sistema">{SYSTEM_FONTS.map(f => <option key={f} value={f}>{f}</option>)}</optgroup>
              {(state.customFonts || []).length > 0 && <optgroup label="Mis Tipografías">{(state.customFonts || []).map(f => <option key={f.family} value={f.family}>{f.name}</option>)}</optgroup>}
            </select>

            {(state.customFonts || []).length > 0 && (
              <div className="flex flex-wrap gap-1.5 pt-1">
                {(state.customFonts || []).map(font => (
                  <div
                    key={font.family}
                    onClick={() => updateTextLayer(key, { font: font.family })}
                    className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full border cursor-pointer transition-all text-[9px] font-bold ${layer.font === font.family ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-500 border-slate-100 hover:border-slate-300'}`}
                  >
                    <span style={{ fontFamily: font.family }}>{font.name}</span>
                    <button
                      onClick={(e) => { e.stopPropagation(); removeCustomFont(font.family); }}
                      className="text-[8px] opacity-60 hover:opacity-100 ml-0.5"
                      title="Eliminar"
                    >✕</button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="space-y-2">
            <div className="flex justify-between items-center px-1">
              <span className="text-[9px] font-black text-slate-300 uppercase tracking-widest">Tamaño Texto</span>
              <span className="text-[10px] font-black text-[#EA5B25]">{layer.size}px</span>
            </div>
            <input type="range" min="8" max="120" value={layer.size} onChange={(e) => updateTextLayer(key, { size: Number(e.target.value) })} className="w-full h-1.5 accent-[#EA5B25] bg-slate-100 rounded-full appearance-none cursor-pointer" />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <span className="text-[9px] font-black text-slate-300 uppercase tracking-widest px-1">Estilo</span>
              <div className="flex gap-1">
                <button onClick={() => updateTextLayer(key, { bold: !layer.bold })} className={`flex-1 h-9 rounded-lg flex items-center justify-center border transition-all ${layer.bold ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-400 border-slate-100'}`}><i className="fa-solid fa-bold text-[10px]"></i></button>
                <button onClick={() => updateTextLayer(key, { italic: !layer.italic })} className={`flex-1 h-9 rounded-lg flex items-center justify-center border transition-all ${layer.italic ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-400 border-slate-100'}`}><i className="fa-solid fa-italic text-[10px]"></i></button>
                <button onClick={() => updateTextLayer(key, { underline: !layer.underline })} className={`flex-1 h-9 rounded-lg flex items-center justify-center border transition-all ${layer.underline ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-400 border-slate-100'}`}><i className="fa-solid fa-underline text-[10px]"></i></button>
              </div>
            </div>
            <div className="space-y-2">
              <span className="text-[9px] font-black text-slate-300 uppercase tracking-widest px-1">Alineación</span>
              <div className="flex gap-1">
                <button onClick={() => updateTextLayer(key, { align: 'left' })} className={`flex-1 h-9 rounded-lg flex items-center justify-center border transition-all ${layer.align === 'left' ? 'bg-[#EA5B25] text-white border-[#EA5B25]' : 'bg-white text-slate-400 border-slate-100'}`}><i className="fa-solid fa-align-left text-[10px]"></i></button>
                <button onClick={() => updateTextLayer(key, { align: 'center' })} className={`flex-1 h-9 rounded-lg flex items-center justify-center transition-all ${layer.align === 'center' ? 'bg-[#EA5B25] text-white border-[#EA5B25]' : 'bg-white text-slate-400 border-slate-100'}`}><i className="fa-solid fa-align-center text-[10px]"></i></button>
                <button onClick={() => updateTextLayer(key, { align: 'right' })} className={`flex-1 h-9 rounded-lg flex items-center justify-center border transition-all ${layer.align === 'right' ? 'bg-[#EA5B25] text-white border-[#EA5B25]' : 'bg-white text-slate-400 border-slate-100'}`}><i className="fa-solid fa-align-right text-[10px]"></i></button>
              </div>
            </div>
          </div>
        </div>

        <div className="space-y-4">
          <div className="space-y-2">
            <span className="text-[9px] font-black text-slate-300 uppercase tracking-widest px-1">Color de la Tipografía</span>
            <BrandColorPalette onSelect={(color) => updateTextLayer(key, { color })} />
            <input type="color" value={layer.color} onChange={(e) => updateTextLayer(key, { color: e.target.value })} className="w-full h-10 p-1 bg-white border border-slate-100 rounded-lg cursor-pointer shadow-sm" />
          </div>

          {key !== 'cta' && (
            <div className="space-y-2 pt-2 animate-in fade-in slide-in-from-top-1">
              <div className="flex items-center justify-between px-1">
                <span className="text-[9px] font-black text-slate-300 uppercase tracking-widest">Resaltado (Fondo)</span>
                <button 
                  onClick={() => updateTextLayer(key, { backgroundColor: 'transparent' })} 
                  className={`text-[8px] font-black uppercase px-2 py-1 rounded-md border transition-all ${layer.backgroundColor === 'transparent' ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-400 border-slate-100'}`}
                >
                  Sin Fondo
                </button>
              </div>
              <BrandColorPalette onSelect={(backgroundColor) => updateTextLayer(key, { backgroundColor })} />
              <input 
                type="color" 
                value={layer.backgroundColor === 'transparent' ? '#ffffff' : layer.backgroundColor} 
                onChange={(e) => updateTextLayer(key, { backgroundColor: e.target.value })} 
                className="w-full h-10 p-1 bg-white border border-slate-100 rounded-lg cursor-pointer shadow-sm" 
              />
            </div>
          )}
        </div>

        <div className="space-y-4 pt-2 border-t border-slate-50">
          <div className="flex items-center justify-between px-1">
            <span className="text-[9px] font-black text-slate-300 uppercase tracking-widest">Sombra de Texto</span>
            <button 
              onClick={() => updateTextLayer(key, { shadow: !layer.shadow })} 
              className={`w-9 h-4.5 rounded-full transition-all border relative ${layer.shadow ? 'bg-[#EA5B25] border-[#EA5B25]' : 'bg-slate-400 border-slate-300'}`}
            >
              <div className={`absolute top-0.5 w-3 h-3 bg-white rounded-full shadow transition-transform ${layer.shadow ? 'translate-x-4.5' : 'translate-x-0.5'}`} />
            </button>
          </div>
          
          {layer.shadow && (
            <div className="space-y-4 animate-in fade-in slide-in-from-top-1">
              <div className="space-y-2">
                <div className="flex justify-between items-center px-1">
                  <span className="text-[8px] font-black text-slate-400 uppercase">Difuminado (Blur)</span>
                  <span className="text-[9px] font-bold text-slate-400">{layer.shadowBlur}px</span>
                </div>
                <input type="range" min="0" max="20" value={layer.shadowBlur} onChange={(e) => updateTextLayer(key, { shadowBlur: Number(e.target.value) })} className="w-full h-1 accent-[#EA5B25] bg-slate-200 rounded-full appearance-none" />
              </div>
              <div className="space-y-2">
                <div className="flex justify-between items-center px-1">
                  <span className="text-[8px] font-black text-slate-400 uppercase">Desplazamiento (Offset)</span>
                  <span className="text-[9px] font-bold text-slate-400">{layer.shadowOffset}px</span>
                </div>
                <input type="range" min="-10" max="10" value={layer.shadowOffset} onChange={(e) => updateTextLayer(key, { shadowOffset: Number(e.target.value) })} className="w-full h-1 accent-[#EA5B25] bg-slate-200 rounded-full appearance-none" />
              </div>
              <div className="space-y-2">
                <span className="text-[8px] font-black text-slate-400 uppercase px-1">Color de Sombra</span>
                <input type="color" value={layer.shadowColor} onChange={(e) => updateTextLayer(key, { shadowColor: e.target.value })} className="w-full h-8 p-0.5 bg-white border border-slate-100 rounded-lg cursor-pointer" />
              </div>
            </div>
          )}
        </div>

        {key === 'cta' && state.showCta && (
          <div className="space-y-4 p-4 bg-orange-50/20 rounded-2xl border border-orange-100/30">
            <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest block mb-2">Dimensiones del Botón</span>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <span className="text-[8px] font-black text-slate-400 uppercase">Largo (X)</span>
                <input type="range" min="10" max="120" value={state.ctaPaddingX} onChange={(e) => updateState({ ctaPaddingX: Number(e.target.value) })} className="w-full h-1 accent-[#EA5B25] bg-slate-200 rounded-full appearance-none" />
              </div>
              <div className="space-y-2">
                <span className="text-[8px] font-black text-slate-400 uppercase">Alto (Y)</span>
                <input type="range" min="4" max="80" value={state.ctaPaddingY} onChange={(e) => updateState({ ctaPaddingY: Number(e.target.value) })} className="w-full h-1 accent-[#EA5B25] bg-slate-200 rounded-full appearance-none" />
              </div>
            </div>
            
            <div className="space-y-2 pt-2">
              <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest px-1">Color de Fondo del Botón</span>
              <div className="flex flex-wrap gap-1.5 mb-2 px-1">
                {brandPalette.slice(0, 10).map(c => (
                  <button key={`cta-bg-${String(c)}`} onClick={() => updateState({ ctaBgColor: String(c) })} className="w-5 h-5 rounded-md border border-white shadow-sm" style={{ backgroundColor: String(c) }} />
                ))}
              </div>
              <input type="color" value={state.ctaBgColor} onChange={(e) => updateState({ ctaBgColor: e.target.value })} className="w-full h-10 p-1 bg-white border border-slate-100 rounded-lg cursor-pointer shadow-sm" />
            </div>
          </div>
        )}
      </div>
    );
  };

  const updateActiveLogoInDB = async (logoUrl: string) => {
    const user = firebase.auth().currentUser;
    if (user) {
      try {
        await firebase.firestore().collection('profiles').doc(user.uid).update({
          currentLogoUrl: logoUrl
        });
      } catch (e) {
        console.error("Error al actualizar logo activo:", e);
      }
    }
  };

  const updateActiveResourceInDB = async (resourceUrl: string) => {
    const user = firebase.auth().currentUser;
    if (user) {
      try {
        await firebase.firestore().collection('profiles').doc(user.uid).update({
          currentResourceUrl: resourceUrl || ''
        });
      } catch (e) {
        console.error("Error al actualizar recurso activo en Firestore:", e);
      }
    }
  };

  const saveLogoToLibrary = async (logoUrl: string) => {
    const user = firebase.auth().currentUser;
    if (user && logoUrl) {
      const currentLibrary = profile?.logoLibrary || [];
      if (!currentLibrary.includes(logoUrl)) {
        const updatedLibrary = [logoUrl, ...currentLibrary].slice(0, 12);
        try {
          await firebase.firestore().collection('profiles').doc(user.uid).update({
            logoLibrary: updatedLibrary
          });
        } catch (e) {
          console.error("Error al guardar logo en la herramienta:", e);
        }
      }
    }
  };

  const removeLogoFromLibrary = async (logoUrl: string) => {
    const user = firebase.auth().currentUser;
    if (user) {
      const currentLibrary = profile?.logoLibrary || [];
      const updatedLibrary = currentLibrary.filter(url => url !== logoUrl);
      try {
        await firebase.firestore().collection('profiles').doc(user.uid).update({
          logoLibrary: updatedLibrary
        });
      } catch (e) {
        console.error("Error al eliminar logo de la galería:", e);
      }
    }
  };

  const saveResourceToLibrary = async (resourceUrl: string) => {
    const user = firebase.auth().currentUser;
    if (user && resourceUrl) {
      const currentLibrary = profile?.resourceLibrary || [];
      if (!currentLibrary.includes(resourceUrl)) {
        const updatedLibrary = [resourceUrl, ...currentLibrary].slice(0, 12);
        try {
          await firebase.firestore().collection('profiles').doc(user.uid).update({
            resourceLibrary: updatedLibrary
          });
        } catch (e) {
          console.error("Error al guardar recurso en la galería:", e);
        }
      }
    }
  };

  const removeResourceFromLibrary = async (resourceUrl: string) => {
    const user = firebase.auth().currentUser;
    if (user) {
      const currentLibrary = profile?.resourceLibrary || [];
      const updatedLibrary = currentLibrary.filter(url => url !== resourceUrl);
      try {
        await firebase.firestore().collection('profiles').doc(user.uid).update({
          resourceLibrary: updatedLibrary
        });
      } catch (e) {
        console.error("Error al eliminar recurso de la galería:", e);
      }
    }
  };

  const saveBackgroundToLibrary = async (bgUrl: string) => {
    const user = firebase.auth().currentUser;
    if (user && bgUrl) {
      const currentLibrary = profile?.backgroundLibrary || [];
      if (!currentLibrary.includes(bgUrl)) {
        const updatedLibrary = [bgUrl, ...currentLibrary].slice(0, 20); // Keep up to 20 backgrounds
        try {
          await firebase.firestore().collection('profiles').doc(user.uid).update({
            backgroundLibrary: updatedLibrary
          });
        } catch (e) {
          console.error("Error al guardar fondo en la galería:", e);
        }
      }
    }
  };

  const removeBackgroundFromLibrary = async (bgUrl: string) => {
    const user = firebase.auth().currentUser;
    if (user) {
      const currentLibrary = profile?.backgroundLibrary || [];
      const updatedLibrary = currentLibrary.filter(url => url !== bgUrl);
      try {
        await firebase.firestore().collection('profiles').doc(user.uid).update({
          backgroundLibrary: updatedLibrary
        });
      } catch (e) {
        console.error("Error al eliminar fondo de la galería:", e);
      }
    }
  };

  const currentGeneratedImage = state.imageVariants[state.selectedVariantIndex]?.url;

  return (
    <div className="flex flex-col w-full bg-white divide-y divide-slate-50">
      <Accordion title="MIS DISEÑOS" icon="fa-folder-open" isOpen={openSection === 'PROJECTS'} onToggle={() => setOpenSection(openSection === 'PROJECTS' ? null : 'PROJECTS')}>
        <div className="space-y-4">
          {savedProjects.length > 0 ? (
            <div className="grid grid-cols-2 gap-3">
              {savedProjects.map((project) => (
                <div key={project.id} className="relative group">
                  <button 
                    onClick={() => {
                      if (onLoadProject) {
                        try {
                          let parsedState = project.state;
                          // Parsear hasta que sea un objeto (por si se guardó como string doble)
                          while (typeof parsedState === 'string') {
                            parsedState = JSON.parse(parsedState);
                          }
                          onLoadProject(parsedState);
                        } catch (e) {
                          console.error("Error parsing project state:", e);
                          alert("Hubo un error al cargar este proyecto.");
                        }
                      }
                    }}
                    className="w-full aspect-square bg-slate-50 border border-slate-100 rounded-2xl overflow-hidden hover:border-[#EA5B25] transition-all flex items-center justify-center"
                  >
                    {project.thumbnail ? (
                      <img src={project.thumbnail} className="w-full h-full object-cover" />
                    ) : (
                      <div className="text-slate-300 flex flex-col items-center gap-2">
                        <i className="fa-solid fa-image text-2xl"></i>
                        <span className="text-[8px] font-black uppercase tracking-widest">Sin vista previa</span>
                      </div>
                    )}
                  </button>
                  <button 
                    onClick={(e) => { e.stopPropagation(); onDeleteProject && onDeleteProject(project.id); }}
                    className="absolute top-2 right-2 w-6 h-6 bg-white text-red-500 rounded-full flex items-center justify-center shadow-md opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-50"
                    title="Eliminar diseño"
                  >
                    <i className="fa-solid fa-trash text-[10px]"></i>
                  </button>
                  <div className="absolute bottom-0 inset-x-0 bg-black/40 backdrop-blur-sm p-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                    <span className="text-[7px] text-white font-black uppercase tracking-widest block truncate">
                      {new Date(project.updatedAt?.toDate() || Date.now()).toLocaleDateString()}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="py-10 text-center space-y-3">
               <i className="fa-regular fa-folder-open text-slate-100 text-4xl"></i>
               <p className="text-[9px] font-black text-slate-300 uppercase tracking-widest leading-relaxed">Aún no tienes<br/>diseños guardados.</p>
            </div>
          )}
        </div>
      </Accordion>

      <Accordion title="HISTORIAL DE IA" icon="fa-clock-rotate-left" isOpen={openSection === 'GALLERY'} onToggle={() => setOpenSection(openSection === 'GALLERY' ? null : 'GALLERY')}>
        <div className="space-y-4">
          {state.imageVariants.length > 0 ? (
            <div className="grid grid-cols-2 gap-3">
              {state.imageVariants.map((variant, idx) => {
                return (
                <div key={variant.id} className="relative group">
                  <button 
                    onClick={() => updateState({ selectedVariantIndex: idx })}
                    className={`w-full relative aspect-square bg-slate-50 border rounded-2xl overflow-hidden transition-all active:scale-95 ${state.selectedVariantIndex === idx ? 'border-[#EA5B25] ring-2 ring-orange-100 shadow-lg' : 'border-slate-100 hover:border-slate-300'}`}
                  >
                    <img src={variant.url} className="w-full h-full object-cover" />
                    {state.selectedVariantIndex === idx && (
                      <div className="absolute inset-0 bg-[#EA5B25]/10 flex items-center justify-center">
                        <div className="w-8 h-8 bg-white text-[#EA5B25] rounded-full flex items-center justify-center shadow-md">
                          <i className="fa-solid fa-check text-xs"></i>
                        </div>
                      </div>
                    )}
                    <div className="absolute bottom-0 inset-x-0 bg-black/40 backdrop-blur-sm p-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                      <span className="text-[7px] text-white font-black uppercase tracking-widest block truncate">{String(variant.prompt)}</span>
                    </div>
                  </button>
                </div>
              )})}
            </div>
          ) : (
            <div className="py-10 text-center space-y-3">
               <i className="fa-solid fa-wand-magic-sparkles text-slate-100 text-4xl"></i>
               <p className="text-[9px] font-black text-slate-300 uppercase tracking-widest leading-relaxed">Genera imágenes para ver<br/>tu historial aquí.</p>
            </div>
          )}

          {profile?.backgroundLibrary && profile.backgroundLibrary.length > 0 && (
            <div className="space-y-4 pt-4 border-t border-slate-50">
               <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest px-1">Galería de Fondos Guardados</span>
               <div className="grid grid-cols-2 gap-3">
                 {profile.backgroundLibrary.map((url, idx) => (
                   <div key={`bg-${idx}`} className="relative group">
                     <button 
                        onClick={() => {
                          const existingIdx = state.imageVariants.findIndex(v => v.url === url);
                          if (existingIdx >= 0) {
                            updateState({ selectedVariantIndex: existingIdx });
                          } else {
                            updateState({ 
                              imageVariants: [{ id: `saved-${Date.now()}-${idx}`, url: String(url), prompt: 'Desde Galería' }, ...state.imageVariants],
                              selectedVariantIndex: 0
                            });
                          }
                        }} 
                        className="w-full aspect-square bg-slate-50 border border-slate-100 rounded-2xl overflow-hidden hover:border-[#EA5B25] transition-all flex items-center justify-center"
                     >
                       <img src={String(url)} className="w-full h-full object-cover" />
                     </button>
                     <button 
                       onClick={(e) => { e.stopPropagation(); removeBackgroundFromLibrary(String(url)); }}
                       className="absolute top-2 right-2 w-6 h-6 bg-white text-red-500 rounded-full flex items-center justify-center shadow-md opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-50"
                       title="Eliminar de galería"
                     >
                       <i className="fa-solid fa-trash text-[10px]"></i>
                     </button>
                   </div>
                 ))}
               </div>
            </div>
          )}
        </div>
      </Accordion>

      <Accordion title="IMAGEN DE FONDO" icon="fa-image" isOpen={openSection === 'IMAGEN'} onToggle={() => setOpenSection(openSection === 'IMAGEN' ? null : 'IMAGEN')}>
        <div className="space-y-8">
           {!tempImproveImage ? (
             <>
               <textarea 
                 placeholder="Describe tu idea para generar (Ej: Un café gourmet con iluminación cálida)..." 
                 className="w-full bg-slate-50 border border-slate-100 rounded-[22px] p-5 text-sm outline-none resize-none focus:ring-2 focus:ring-orange-100 transition-all placeholder:text-slate-300 shadow-sm" 
                 rows={3} 
                 value={promptIA} 
                 onChange={(e) => setPromptIA(e.target.value)} 
               />
               
               <div className="space-y-3">
                 <div className="grid grid-cols-2 gap-3">
                    <button 
                      disabled={genStatus === 'generating'} 
                      onClick={() => generateAI('image')} 
                      className={`py-4 rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all active:scale-95 flex items-center justify-center gap-2 ${genStatus === 'generating' ? 'bg-slate-400 text-white' : 'bg-[#EA5B25] text-white shadow-lg shadow-orange-100'}`}
                    >
                      {genStatus === 'generating' ? <i className="fa-solid fa-circle-notch animate-spin"></i> : <i className="fa-solid fa-wand-magic"></i>}
                      {genStatus === 'generating' ? 'CREANDO...' : 'CREAR NUEVA'}
                    </button>
                    <button 
                      disabled={genStatus === 'generating'} 
                      onClick={() => improveInputRef.current?.click()} 
                      className={`py-4 rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all active:scale-95 border flex items-center justify-center gap-2 ${genStatus === 'generating' ? 'bg-slate-100 text-slate-400' : 'bg-orange-50 text-[#EA5B25] border-orange-100'}`}
                    >
                      <i className="fa-solid fa-sparkles"></i>
                      MEJORAR FOTO
                    </button>
                 </div>

                 {currentGeneratedImage && (
                    <div className="md:hidden w-full mt-6 p-3 bg-slate-50 border border-slate-100 rounded-[24px] animate-in fade-in zoom-in-95 duration-500 shadow-inner">
                      <div className="flex justify-between items-center mb-3 px-1">
                        <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Resultado IA</span>
                        <span className="text-[9px] text-[#EA5B25] font-black bg-orange-50 px-2 py-0.5 rounded-md border border-orange-100/50">VISTA RÁPIDA</span>
                      </div>
                      <div className={`w-full overflow-hidden rounded-[18px] border border-slate-200 shadow-md ${activeLayout === 'story' ? 'aspect-[9/16]' : 'aspect-[4/5]'}`}>
                        <img 
                          src={currentGeneratedImage} 
                          alt="Preview" 
                          className="w-full h-full object-cover"
                        />
                      </div>
                    </div>
                 )}

                 {genStatus === 'ready' && (
                    <div className="flex items-center justify-center gap-2 py-1.5 bg-emerald-50 border border-emerald-100 rounded-xl animate-in fade-in zoom-in-95 duration-500">
                       <i className="fa-solid fa-circle-check text-emerald-500 text-[10px]"></i>
                       <span className="text-[10px] font-black text-emerald-600 uppercase tracking-widest">¡LISTO!</span>
                    </div>
                 )}
                 
                 <button 
                   onClick={() => imageInputRef.current?.click()} 
                   className="w-full py-3 bg-white border border-slate-100 text-slate-400 rounded-2xl text-[9px] font-black uppercase tracking-widest hover:bg-slate-50 transition-all"
                 >
                   <i className="fa-solid fa-upload mr-2"></i> SUBIR FOTO ORIGINAL
                 </button>
               </div>
             </>
           ) : (
             <div className="space-y-6 animate-in zoom-in-95 duration-300">
               <div className="relative aspect-square rounded-[32px] overflow-hidden border border-slate-200 shadow-xl bg-slate-50">
                 <img src={String(tempImproveImage)} className="w-full h-full object-cover" alt="Captured" />
                 <button onClick={() => setTempImproveImage(null)} className="absolute top-4 right-4 w-10 h-10 bg-black/50 text-white rounded-full flex items-center justify-center backdrop-blur-md transition-all active:scale-90"><i className="fa-solid fa-xmark"></i></button>
                 <div className="absolute inset-x-0 bottom-0 p-4 bg-gradient-to-t from-black/60 to-transparent">
                   <span className="text-[10px] font-bold text-white uppercase tracking-widest">Previsualización de captura</span>
                 </div>
               </div>

               <div className="space-y-4">
                 <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest px-1">Instrucciones para la IA</span>
                 <textarea 
                   placeholder="Ej: Ajusta la luz, haz los colores más vivos, mejora el fondo..." 
                   className="w-full bg-slate-50 border border-slate-100 rounded-[22px] p-5 text-sm font-bold outline-none resize-none focus:ring-2 focus:ring-orange-100 transition-all placeholder:text-slate-300 shadow-sm" 
                   rows={2} 
                   value={promptIA} 
                   onChange={(e) => {
                     setPromptIA(e.target.value);
                   }} 
                 />
                 
                 <div className="flex gap-3">
                   <button 
                     disabled={genStatus === 'generating'} 
                     onClick={() => generateAI('improve')} 
                     className="flex-1 py-4 bg-[#EA5B25] text-white rounded-2xl text-[11px] font-black uppercase tracking-widest shadow-xl shadow-orange-100 transition-all active:scale-95 flex items-center justify-center gap-3"
                   >
                     {genStatus === 'generating' ? <i className="fa-solid fa-circle-notch animate-spin"></i> : <i className="fa-solid fa-sparkles"></i>}
                     {genStatus === 'generating' ? 'MEJORANDO...' : 'MEJORAR AHORA'}
                   </button>
                 </div>

                 {genStatus === 'ready' && (
                    <div className="flex items-center justify-center gap-2 py-1.5 bg-emerald-50 border border-emerald-100 rounded-xl animate-in fade-in zoom-in-95 duration-500">
                       <i className="fa-solid fa-circle-check text-emerald-500 text-[10px]"></i>
                       <span className="text-[10px] font-black text-emerald-600 uppercase tracking-widest">¡LISTO!</span>
                    </div>
                 )}
               </div>
             </div>
           )}

           <input 
             type="file" 
             ref={improveInputRef} 
             className="hidden" 
             accept="image/*" 
             onChange={(e) => {
               const file = e.target.files?.[0];
               setGenStatus('idle'); 
               if (file) {
                 const reader = new FileReader();
                 reader.onload = (ev) => {
                   const result = ev.target?.result as string;
                   const img = new Image();
                   img.onload = () => {
                     const canvas = document.createElement('canvas');
                     let width = img.width;
                     let height = img.height;
                     if (width > 800) { height = Math.round((height * 800) / width); width = 800; }
                     canvas.width = width;
                     canvas.height = height;
                     const ctx = canvas.getContext('2d');
                     if (ctx) {
                       ctx.drawImage(img, 0, 0, width, height);
                       setTempImproveImage(canvas.toDataURL('image/jpeg', 0.8));
                     } else {
                       setTempImproveImage(result);
                     }
                   };
                   img.src = result;
                 };
                 reader.readAsDataURL(file);
               }
               e.target.value = ''; 
             }} 
           />
           
           <input 
             type="file" 
             ref={imageInputRef} 
             className="hidden" 
             accept="image/*" 
             onChange={(e) => {
               const file = e.target.files?.[0];
               setGenStatus('idle'); 
               if (file) {
                 const r = new FileReader();
                 r.onload = (ev) => {
                   const result = ev.target?.result as string;
                   const img = new Image();
                   img.onload = () => {
                     const canvas = document.createElement('canvas');
                     let width = img.width;
                     let height = img.height;
                     if (width > 800) { height = Math.round((height * 800) / width); width = 800; }
                     canvas.width = width;
                     canvas.height = height;
                     const ctx = canvas.getContext('2d');
                     if (ctx) {
                       ctx.drawImage(img, 0, 0, width, height);
                       updateState({ 
                         imageVariants: [{ id: String(Date.now()), url: canvas.toDataURL('image/jpeg', 0.8), prompt: 'Upload' }, ...state.imageVariants], 
                         selectedVariantIndex: 0 
                       });
                     } else {
                       updateState({ 
                         imageVariants: [{ id: String(Date.now()), url: result, prompt: 'Upload' }, ...state.imageVariants], 
                         selectedVariantIndex: 0 
                       });
                     }
                   };
                   img.src = result;
                 };
                 r.readAsDataURL(file);
               }
               e.target.value = ''; 
             }} 
           />

           {state.imageVariants.length > 0 && !tempImproveImage && (
             <div className="p-5 bg-slate-50 rounded-[24px] border border-slate-100 space-y-6">
                <div className="space-y-4">
                  <div className="space-y-2">
                    <div className="flex justify-between items-center px-1">
                      <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Zoom</span>
                      <span className="text-[11px] font-black text-[#EA5B25]">{currentBgConfig.scale.toFixed(1)}x</span>
                    </div>
                    <input type="range" min="1" max="5" step="0.01" value={currentBgConfig.scale} onChange={(e) => {
                      const ck = activeLayout === 'feed' ? 'feedBackgroundConfig' : 'storyBackgroundConfig';
                      updateState({ [String(ck)]: { ...state[ck as keyof ProjectState] as any, scale: Number(e.target.value) } });
                    }} className="w-full h-1.5 accent-[#EA5B25] bg-slate-200 rounded-full appearance-none cursor-pointer" />
                  </div>
                  
                  <div className="space-y-4 pt-2 border-t border-slate-100">
                    <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest px-1">Filtro de Fondo</span>
                    <div className="space-y-3">
                       <div className="space-y-2">
                          <span className="text-[8px] font-black text-slate-300 uppercase px-1">Color de Filtro</span>
                          <BrandColorPalette onSelect={(color) => updateState({ backgroundOverlayColor: color })} />
                          <input type="color" value={state.backgroundOverlayColor} onChange={(e) => updateState({ backgroundOverlayColor: e.target.value })} className="w-full h-10 p-1 bg-white border border-slate-100 rounded-lg cursor-pointer shadow-sm" />
                       </div>
                       <div className="space-y-2">
                          <div className="flex justify-between items-center px-1">
                             <span className="text-[8px] font-black text-slate-300 uppercase">Intensidad</span>
                             <span className="text-[10px] font-black text-[#EA5B25]">{state.feedOverlayOpacity}%</span>
                          </div>
                          <input type="range" min="0" max="85" value={state.feedOverlayOpacity} onChange={(e) => updateState({ feedOverlayOpacity: Number(e.target.value), storyOverlayOpacity: Number(e.target.value) })} className="w-full h-1.5 accent-[#EA5B25] bg-slate-200 rounded-full appearance-none cursor-pointer" />
                       </div>
                    </div>
                  </div>

                  <div className="space-y-6 pt-2 border-t border-slate-100">
                    <div className="flex justify-between items-center px-1">
                      <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest block">Enfoque de Imagen</span>
                      <button onClick={() => setBackgroundFocus(50, 50)} className="text-[8px] font-black text-[#EA5B25] uppercase tracking-widest bg-orange-50 px-2 py-1 rounded-md active:scale-95 transition-all">Centrar</button>
                    </div>
                    
                    <div className="space-y-4 pt-2">
                       <div className="space-y-2">
                          <div className="flex justify-between items-center px-1">
                            <span className="text-[7px] font-black text-slate-300 uppercase block">Posición Horizontal</span>
                            <span className="text-[10px] font-bold text-slate-400">{Math.round(currentBgConfig.offset.x)}%</span>
                          </div>
                          <input type="range" min="0" max="100" value={currentBgConfig.offset.x} onChange={(e) => setBackgroundFocus(Number(e.target.value), currentBgConfig.offset.y)} className="w-full h-1.5 accent-[#EA5B25] bg-slate-200 rounded-full appearance-none cursor-pointer" />
                       </div>
                       <div className="space-y-2">
                          <div className="flex justify-between items-center px-1">
                            <span className="text-[7px] font-black text-slate-300 uppercase block">Posición Vertical</span>
                            <span className="text-[10px] font-bold text-slate-400">{Math.round(currentBgConfig.offset.y)}%</span>
                          </div>
                          <input type="range" min="0" max="100" value={currentBgConfig.offset.y} onChange={(e) => setBackgroundFocus(currentBgConfig.offset.x, Number(e.target.value))} className="w-full h-1.5 accent-[#EA5B25] bg-slate-200 rounded-full appearance-none cursor-pointer" />
                       </div>
                    </div>
                  </div>
                </div>
             </div>
           )}
        </div>
      </Accordion>

      <Accordion title="LOGO" icon="fa-briefcase" isOpen={openSection === 'MARCA'} onToggle={() => setOpenSection(openSection === 'MARCA' ? null : 'MARCA')}>
        <div ref={logoContainerRef} className="space-y-8">
          <div className="w-full aspect-video bg-slate-50 border border-slate-100 rounded-[24px] flex items-center justify-center overflow-hidden relative shadow-sm">
             {state.logo.url ? <img src={String(state.logo.url)} className="max-w-[80%] max-h-[80%] object-contain" /> : <span className="text-[9px] font-black uppercase text-slate-300">Sin Logo</span>}
          </div>

          <div className="space-y-4 pt-2">
            <div className="flex justify-between items-center px-1">
              <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Tamaño del Logo</span>
              <span className="text-[10px] font-black text-[#EA5B25]">{state.logo.size}%</span>
            </div>
            <input 
              type="range" min="5" max="80" value={state.logo.size} 
              onChange={(e) => updateState({ logo: { ...state.logo, size: Number(e.target.value) } })} 
              className="w-full h-1.5 accent-[#EA5B25] bg-slate-100 rounded-full appearance-none cursor-pointer" 
            />
          </div>
          
          <div className="space-y-3">
            <button onClick={() => logoInputRef.current?.click()} className="w-full py-4 bg-slate-900 text-white rounded-2xl text-[10px] font-black uppercase tracking-widest active:scale-95 transition-all">
              {state.logo.url ? 'CAMBIAR LOGO' : 'CARGAR LOGO'}
            </button>
            {state.logo.url && (
              <button 
                onClick={() => {
                  updateState({ logo: { ...state.logo, url: null } });
                  updateActiveLogoInDB(''); 
                }} 
                className="w-full py-3 bg-white border border-red-100 text-red-500 rounded-2xl text-[10px] font-black uppercase tracking-widest active:scale-95 transition-all shadow-sm"
              >
                QUITAR DEL DISEÑO
              </button>
            )}
            {state.logo.url && (
              <button onClick={() => saveLogoToLibrary(String(state.logo.url))} className="w-full py-2 text-[#EA5B25] text-[9px] font-black uppercase tracking-widest hover:bg-orange-50 rounded-xl transition-all border border-orange-100 border-dashed">Guardar en Galería</button>
            )}
          </div>

          {state.logoLibrary && state.logoLibrary.length > 0 && (
            <div className="space-y-4 pt-4 border-t border-slate-50">
               <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest px-1">Galería de Logos</span>
               <div className="grid grid-cols-4 gap-2">
                 {state.logoLibrary.map((url, idx) => (
                   <div key={idx} className="relative group">
                     <button 
                        onClick={() => {
                          updateState({ logo: { ...state.logo, url: String(url) } });
                          updateActiveLogoInDB(String(url)); 
                        }} 
                        className="w-full aspect-square bg-slate-50 border border-slate-100 rounded-lg p-2 hover:border-[#EA5B25] transition-all flex items-center justify-center overflow-hidden"
                     >
                       <img src={String(url)} className="max-w-full max-h-full object-contain" />
                     </button>
                     <button 
                       onClick={(e) => { e.stopPropagation(); removeLogoFromLibrary(String(url)); }}
                       className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-slate-900 text-white text-[8px] rounded-full flex items-center justify-center border border-white shadow-md opacity-0 group-hover:opacity-100 transition-opacity"
                     >
                       <i className="fa-solid fa-xmark"></i>
                     </button>
                   </div>
                 ))}
               </div>
            </div>
          )}

          <input 
            type="file" 
            ref={logoInputRef} 
            className="hidden" 
            accept="image/*" 
            onChange={(e) => {
              const file = e.target.files?.[0];
              setGenStatus('idle');
              if (file) {
                const r = new FileReader();
                r.onload = async (ev) => {
                  const rawUrl = ev.target?.result as string;
                  updateState({ logo: { ...state.logo, url: rawUrl } });
                  const urlToSave = compressBase64Image
                    ? await compressBase64Image(rawUrl, 400, 0.6, true)
                    : rawUrl;
                  updateActiveLogoInDB(urlToSave);
                  await saveLogoToLibrary(urlToSave);
                };
                r.readAsDataURL(file);
              }
              e.target.value = '';
            }}
          />
        </div>
      </Accordion>

      <Accordion title="RECURSOS" icon="fa-shapes" isOpen={openSection === 'RECURSOS'} onToggle={() => setOpenSection(openSection === 'RECURSOS' ? null : 'RECURSOS')}>
        <div className="space-y-8">
          <div className="w-full aspect-video bg-slate-50 border border-slate-100 rounded-[24px] flex items-center justify-center overflow-hidden relative shadow-sm">
             {state.resource.url ? (
               <div className="relative group w-full h-full flex items-center justify-center">
                 <img src={String(state.resource.url)} className="max-w-[80%] max-h-[80%] object-contain" />
                 <div className="absolute inset-0 bg-black/5 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                    <span className="text-[8px] font-black text-white bg-black/40 px-3 py-1.5 rounded-full uppercase tracking-widest">Recurso Activo</span>
                 </div>
               </div>
             ) : (
               <div className="flex flex-col items-center gap-2">
                 <i className="fa-solid fa-shapes text-slate-200 text-3xl"></i>
                 <span className="text-[9px] font-black uppercase text-slate-300">Sin Recurso</span>
               </div>
             )}
          </div>

          <div className="space-y-4 pt-2">
            <div className="flex justify-between items-center px-1">
              <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Tamaño del Recurso</span>
              <span className="text-[10px] font-black text-[#EA5B25]">{state.resource.size}%</span>
            </div>
            <input 
              type="range" min="5" max="100" value={state.resource.size} 
              onChange={(e) => updateState({ resource: { ...state.resource, size: Number(e.target.value) } })} 
              className="w-full h-1.5 accent-[#EA5B25] bg-slate-100 rounded-full appearance-none cursor-pointer" 
            />
          </div>
          
          <div className="space-y-3">
            <button onClick={() => resourceInputRef.current?.click()} className="w-full py-4 bg-slate-900 text-white rounded-2xl text-[10px] font-black uppercase tracking-widest active:scale-95 transition-all">
              {state.resource.url ? 'CAMBIAR RECURSO' : 'CARGAR RECURSO'}
            </button>
            {state.resource.url && (
              <button
                onClick={() => {
                  updateState({ resource: { ...state.resource, url: null } });
                  updateActiveResourceInDB('');
                }}
                className="w-full py-3 bg-white border border-red-100 text-red-500 rounded-2xl text-[10px] font-black uppercase tracking-widest active:scale-95 transition-all shadow-sm"
              >
                QUITAR DEL DISEÑO
              </button>
            )}
            {state.resource.url && (
              <button onClick={() => saveResourceToLibrary(String(state.resource.url))} className="w-full py-2 text-[#EA5B25] text-[9px] font-black uppercase tracking-widest hover:bg-orange-50 rounded-xl transition-all border border-orange-100 border-dashed">Guardar en Galería</button>
            )}
          </div>

          {state.resourceLibrary && state.resourceLibrary.length > 0 && (
            <div className="space-y-4 pt-4 border-t border-slate-50">
               <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest px-1">Galería de Recursos</span>
               <div className="grid grid-cols-4 gap-2">
                 {state.resourceLibrary.map((url, idx) => (
                   <div key={`res-${idx}`} className="relative group">
                     <button 
                        onClick={() => {
                          updateState({ resource: { ...state.resource, url: String(url) } });
                          updateActiveResourceInDB(String(url)); 
                        }} 
                        className="w-full aspect-square bg-slate-50 border border-slate-100 rounded-lg p-2 hover:border-[#EA5B25] transition-all flex items-center justify-center overflow-hidden"
                     >
                       <img src={String(url)} className="max-w-full max-h-full object-contain" />
                     </button>
                     <button 
                       onClick={(e) => { e.stopPropagation(); removeResourceFromLibrary(String(url)); }}
                       className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-slate-900 text-white text-[8px] rounded-full flex items-center justify-center border border-white shadow-md opacity-0 group-hover:opacity-100 transition-opacity"
                     >
                       <i className="fa-solid fa-xmark"></i>
                     </button>
                   </div>
                 ))}
               </div>
            </div>
          )}

          <input 
            type="file" 
            ref={resourceInputRef} 
            className="hidden" 
            accept="image/*" 
            onChange={(e) => {
              const file = e.target.files?.[0];
              setGenStatus('idle');
              if (file) {
                const r = new FileReader();
                r.onload = async (ev) => {
                  const rawUrl = ev.target?.result as string;
                  updateState({ resource: { ...state.resource, url: rawUrl } });
                  const urlToSave = compressBase64Image
                    ? await compressBase64Image(rawUrl, 800, 0.6, true)
                    : rawUrl;
                  updateActiveResourceInDB(urlToSave);
                  await saveResourceToLibrary(urlToSave);
                };
                r.readAsDataURL(file);
              }
              e.target.value = '';
            }}
          />
        </div>
      </Accordion>

      {onApplyTemplate && (
        <Accordion title="PLANTILLAS" icon="fa-wand-magic-sparkles" isOpen={openSection === 'TEMPLATES'} onToggle={() => setOpenSection(openSection === 'TEMPLATES' ? null : 'TEMPLATES')}>
          <div className="space-y-3">
            <p className="text-[10px] text-slate-400 font-bold leading-relaxed">Acomoda tus textos en un diseño profesional con un clic. Usa las tipografías y colores de tu marca.</p>
            <div className="grid grid-cols-2 gap-2.5">
              {([
                { id: 'classic', label: 'Clásico', desc: 'Centrado y equilibrado', icon: 'fa-align-center' },
                { id: 'editorial', label: 'Editorial', desc: 'Alineado a la izquierda', icon: 'fa-align-left' },
                { id: 'bold', label: 'Bold', desc: 'Título grande, alto impacto', icon: 'fa-bolt' },
                { id: 'minimal', label: 'Minimal', desc: 'Texto abajo, mucho aire', icon: 'fa-feather' },
              ] as const).map(t => (
                <button key={t.id} onClick={() => onApplyTemplate(t.id)} className="text-left p-3.5 rounded-2xl border border-slate-100 bg-slate-50 hover:border-[#EA5B25] hover:bg-orange-50/50 transition-all active:scale-[0.98] group">
                  <div className="w-8 h-8 rounded-xl bg-white border border-slate-100 flex items-center justify-center text-slate-400 group-hover:text-[#EA5B25] mb-2 transition-colors"><i className={`fa-solid ${t.icon} text-xs`}></i></div>
                  <p className="text-[11px] font-black text-slate-800 uppercase tracking-wide">{t.label}</p>
                  <p className="text-[9px] text-slate-400 font-bold leading-tight mt-0.5">{t.desc}</p>
                </button>
              ))}
            </div>
          </div>
        </Accordion>
      )}

      <Accordion title="TEXTOS" icon="fa-font" isOpen={openSection === 'TEXTOS'} onToggle={() => setOpenSection(openSection === 'TEXTOS' ? null : 'TEXTOS')}>
        <div className="space-y-2">{renderTextEditor('headline', 'Título')}{renderTextEditor('description', 'Descripción')}{renderTextEditor('additional', 'Texto Adicional')}{renderTextEditor('cta', 'Botón')}</div>
      </Accordion>


      <Accordion title="REDACTOR IA" icon="fa-quote-right" isOpen={openSection === 'COPY'} onToggle={() => setOpenSection(openSection === 'COPY' ? null : 'COPY')}>
        <div className="space-y-6">
          <button 
            disabled={genStatus === 'generating'} 
            onClick={() => generateAI('copy')} 
            className="w-full py-4 bg-[#EA5B25] text-white rounded-2xl text-[10px] font-black uppercase tracking-widest shadow-lg shadow-orange-100 transition-all active:scale-95 flex items-center justify-center gap-2"
          >
            {genStatus === 'generating' ? <i className="fa-solid fa-circle-notch animate-spin"></i> : <i className="fa-solid fa-magic"></i>}
            {genStatus === 'generating' ? 'GENERANDO...' : state.copies.length > 0 ? 'GENERAR OTRA OPCIÓN' : 'GENERAR COPY'}
          </button>
          
          <div className="space-y-4">
            {state.copies.length > 0 && (
              <div className="flex items-center justify-between bg-slate-50 border border-slate-100 rounded-xl px-4 py-2 animate-in fade-in duration-300">
                <button 
                  onClick={() => navigateCopy('prev')} 
                  disabled={state.selectedCopyIndex === 0}
                  className="w-8 h-8 flex items-center justify-center text-slate-400 disabled:opacity-30 active:scale-90"
                >
                  <i className="fa-solid fa-chevron-left"></i>
                </button>
                <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
                  Opción { (state.selectedCopyIndex ?? 0) + 1 } / { state.copies.length }
                </span>
                <button 
                  onClick={() => navigateCopy('next')} 
                  disabled={state.selectedCopyIndex === state.copies.length - 1}
                  className="w-8 h-8 flex items-center justify-center text-slate-400 disabled:opacity-30 active:scale-90"
                >
                  <i className="fa-solid fa-chevron-right"></i>
                </button>
              </div>
            )}

            {state.copies.length > 0 && (
              <div className="p-4 bg-slate-50 border border-slate-100 rounded-[20px] space-y-3 animate-in slide-in-from-bottom-2 duration-300">
                <div className="flex items-center justify-between">
                  <span className="text-[8px] font-black text-[#EA5B25] uppercase tracking-widest">Opción { (state.selectedCopyIndex ?? 0) + 1 }</span>
                  <button 
                    onClick={() => {
                      const copyToClip = state.copies[state.selectedCopyIndex ?? 0];
                      navigator.clipboard.writeText(String(copyToClip));
                      alert('¡Copiado al portapapeles!');
                    }}
                    className="w-8 h-8 bg-white border border-slate-200 rounded-lg flex items-center justify-center text-slate-400 hover:text-[#EA5B25] hover:border-orange-100 transition-all active:scale-90"
                    title="Copiar texto"
                  >
                    <i className="fa-regular fa-copy text-xs"></i>
                  </button>
                </div>
                <p className="text-[12px] leading-relaxed text-slate-700 font-medium whitespace-pre-wrap">
                  {String(state.copies[state.selectedCopyIndex ?? 0])}
                </p>
              </div>
            )}
          </div>
        </div>
      </Accordion>
    </div>
  );
};

export default SidebarModules;