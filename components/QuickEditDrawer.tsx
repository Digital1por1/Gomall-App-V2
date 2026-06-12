
import React, { useState, useRef, useEffect } from 'react';
import { ProjectState, BackgroundConfig, TextLayer } from '../types';

interface QuickEditDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  selectedField: string | null;
  state: ProjectState;
  activeLayout: 'feed' | 'story';
  updateState: (updates: Partial<ProjectState>) => void;
  extractedColors: string[];
  extractedBackgroundColors: string[];
  onUpdateBackground: (upd: Partial<BackgroundConfig>) => void;
}

const ALL_FONTS = [
  'Inter', 'Montserrat', 'Playfair Display', 'Bebas Neue', 'Oswald', 
  'Cinzel', 'Permanent Marker', 'JetBrains Mono', 'Lora', 'Anton', 
  'Dancing Script', 'Pacifico', 'Ubuntu', 'Roboto', 'Open Sans'
];

type TabType = 'FONT' | 'COLOR' | 'STYLE' | 'SHADOW' | 'BUTTON' | 'TRANSFORM' | 'SIZE';

const QuickEditDrawer: React.FC<QuickEditDrawerProps> = ({
  isOpen, onClose, selectedField, state, activeLayout, updateState,
  extractedColors, extractedBackgroundColors, onUpdateBackground
}) => {
  const [activeTab, setActiveTab] = useState<TabType>('FONT');
  const [isInteracting, setIsInteracting] = useState(false);

  // Helper function to set background focus (offset) to fix missing reference errors
  const setBackgroundFocus = (x: number, y: number) => {
    const configKey = activeLayout === 'feed' ? 'feedBackgroundConfig' : 'storyBackgroundConfig';
    updateState({ [configKey]: { ...state[configKey as keyof ProjectState] as any, offset: { x, y } } });
  };

  useEffect(() => {
    if (selectedField === 'logo') setActiveTab('SIZE');
    else if (selectedField === 'background' || selectedField === 'image') setActiveTab('TRANSFORM');
    else if (selectedField === 'cta') setActiveTab('BUTTON');
    else setActiveTab('FONT');
  }, [selectedField]);

  if (!isOpen) return null;

  const updateTextLayer = (key: keyof typeof state.textLayers, updates: Partial<TextLayer>) => {
    const newLayers = { ...state.textLayers };
    newLayers[key] = { ...newLayers[key], ...updates };
    updateState({ textLayers: newLayers });
  };

  const isText = selectedField && ['headline', 'description', 'additional', 'cta'].includes(selectedField);
  const layer = isText ? state.textLayers[selectedField as keyof typeof state.textLayers] : null;
  const currentBgConfig = activeLayout === 'feed' ? state.feedBackgroundConfig : state.storyBackgroundConfig;

  const TabButton = ({ id, icon, label, hide = false }: { id: TabType, icon: string, label: string, hide?: boolean }) => {
    if (hide) return null;
    return (
      <button 
        onClick={() => setActiveTab(id)}
        className={`flex flex-col items-center gap-1 px-4 py-2 transition-all rounded-xl ${activeTab === id ? 'text-[#EA5B25] bg-orange-50/50' : 'text-slate-400'}`}
      >
        <i className={`fa-solid ${icon} text-sm`}></i>
        <span className="text-[7px] font-black uppercase tracking-widest">{label}</span>
      </button>
    );
  };

  return (
    <div className={`fixed inset-x-0 bottom-20 z-[100] px-4 pb-4 transition-all duration-300 pointer-events-none ${isInteracting ? 'opacity-25' : 'opacity-100'}`}>
      <div className="absolute inset-0 bg-transparent pointer-events-auto" onClick={onClose} />
      
      <div className={`relative w-full border border-white/20 shadow-[0_-10px_40px_rgba(0,0,0,0.15)] rounded-[32px] overflow-hidden pointer-events-auto transition-all duration-500 transform animate-in slide-in-from-bottom-10 ${activeTab === 'TRANSFORM' ? 'bg-white/40 backdrop-blur-3xl' : 'bg-white'}`}>
        
        <div className={`flex items-center justify-between px-4 h-12 border-b border-white/10 ${activeTab === 'TRANSFORM' ? 'bg-white/20' : 'bg-slate-50/30'}`}>
          <div className="flex items-center gap-1 overflow-x-auto no-scrollbar py-1">
            {isText && (
              <>
                <TabButton id="FONT" icon="fa-font" label="Fuente" />
                <TabButton id="STYLE" icon="fa-italic" label="Estilo" />
                <TabButton id="COLOR" icon="fa-palette" label="Color" />
                <TabButton id="SHADOW" icon="fa-moon" label="Sombra" />
                <TabButton id="BUTTON" icon="fa-square" label="Botón" hide={selectedField !== 'cta'} />
              </>
            )}
            {selectedField === 'logo' && <TabButton id="SIZE" icon="fa-maximize" label="Tamaño" />}
            {(selectedField === 'background' || selectedField === 'image') && <TabButton id="TRANSFORM" icon="fa-arrows-up-down-left-right" label="Ajustes" />}
          </div>
          <button onClick={onClose} className="shrink-0 w-8 h-8 flex items-center justify-center bg-slate-900 text-white rounded-full shadow-lg active:scale-90 ml-2">
            <i className="fa-solid fa-check text-[10px]"></i>
          </button>
        </div>

        <div className="p-4 pt-3 pb-8 max-h-[45vh] overflow-y-auto no-scrollbar">
          
          {activeTab === 'FONT' && isText && (
            <div className="flex gap-2 overflow-x-auto pb-4 no-scrollbar animate-in fade-in duration-300">
              {ALL_FONTS.map(f => (
                <button 
                  key={f} 
                  onClick={() => updateTextLayer(selectedField as any, { font: f })}
                  className={`shrink-0 px-6 py-3 rounded-2xl text-[10px] font-bold border transition-all ${layer?.font === f ? 'bg-slate-900 text-white border-slate-900 shadow-md scale-105' : 'bg-slate-50 text-slate-400 border-slate-100'}`}
                  style={{ fontFamily: f }}
                >
                  {f}
                </button>
              ))}
            </div>
          )}

          {activeTab === 'COLOR' && isText && (
            <div className="space-y-8 animate-in fade-in duration-300">
              {/* SECCIÓN COLOR TEXTO REFACTORIZADA */}
              <div className="space-y-4">
                <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest px-1">Color del Texto</span>
                <div className="flex items-center gap-4 bg-slate-50 p-4 rounded-3xl border border-slate-100 shadow-inner">
                   <div className="relative shrink-0">
                      <input 
                        type="color" 
                        value={layer?.color || '#000000'} 
                        onChange={(e) => updateTextLayer(selectedField as any, { color: e.target.value })} 
                        className="w-16 h-16 rounded-2xl cursor-pointer border-2 border-white shadow-lg active:scale-95 transition-transform"
                      />
                   </div>
                   <div className="flex-1">
                      <span className="text-[9px] font-bold text-slate-400 block mb-1 uppercase tracking-widest">Hexadecimal</span>
                      <code className="text-sm font-black text-slate-800 bg-white px-4 py-2 rounded-xl border border-slate-100 block w-fit">
                        {layer?.color.toUpperCase()}
                      </code>
                   </div>
                </div>
              </div>

              {/* SECCIÓN RESALTADO REFACTORIZADA */}
              {selectedField !== 'cta' && (
                <div className="space-y-4 pt-6 border-t border-slate-100">
                  <div className="flex items-center justify-between px-1">
                    <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Resaltado (Fondo)</span>
                    <button 
                      onClick={() => updateTextLayer(selectedField as any, { backgroundColor: 'transparent' })}
                      className={`text-[8px] font-black uppercase px-4 py-1.5 rounded-full border transition-all ${layer?.backgroundColor === 'transparent' ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-400 border-slate-100 active:bg-slate-50'}`}
                    >
                      SIN FONDO
                    </button>
                  </div>
                  <div className="flex items-center gap-4 bg-slate-50 p-4 rounded-3xl border border-slate-100 shadow-inner">
                    <div className="relative shrink-0">
                       <input 
                        type="color" 
                        value={layer?.backgroundColor === 'transparent' ? '#ffffff' : layer?.backgroundColor} 
                        onChange={(e) => updateTextLayer(selectedField as any, { backgroundColor: e.target.value })} 
                        className="w-16 h-16 rounded-2xl cursor-pointer border-2 border-white shadow-lg active:scale-95 transition-transform"
                       />
                    </div>
                    <div className="flex-1">
                      <span className="text-[9px] font-bold text-slate-400 block mb-1 uppercase tracking-widest">Color de Fondo</span>
                      <code className="text-sm font-black text-slate-800 bg-white px-4 py-2 rounded-xl border border-slate-100 block w-fit">
                        {layer?.backgroundColor === 'transparent' ? 'TRANSPARENTE' : layer?.backgroundColor.toUpperCase()}
                      </code>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {activeTab === 'STYLE' && isText && (
            <div className="space-y-6">
              <div className="flex gap-1.5 p-1 bg-slate-50/50 rounded-xl">
                <button onClick={() => updateTextLayer(selectedField as any, { bold: !layer?.bold })} className={`flex-1 h-12 rounded-lg flex items-center justify-center transition-all ${layer?.bold ? 'bg-slate-900 text-white shadow-md' : 'text-slate-400'}`}><i className="fa-solid fa-bold text-sm"></i></button>
                <button onClick={() => updateTextLayer(selectedField as any, { italic: !layer?.italic })} className={`flex-1 h-12 rounded-lg flex items-center justify-center transition-all ${layer?.italic ? 'bg-slate-900 text-white shadow-md' : 'text-slate-400'}`}><i className="fa-solid fa-italic text-sm"></i></button>
                <button onClick={() => updateTextLayer(selectedField as any, { underline: !layer?.underline })} className={`flex-1 h-12 rounded-lg flex items-center justify-center transition-all ${layer?.underline ? 'bg-slate-900 text-white shadow-md' : 'text-slate-400'}`}><i className="fa-solid fa-underline text-sm"></i></button>
                <div className="w-px h-6 bg-slate-200 self-center mx-1" />
                <button onClick={() => updateTextLayer(selectedField as any, { align: 'left' })} className={`flex-1 h-12 rounded-lg flex items-center justify-center transition-all ${layer?.align === 'left' ? 'bg-[#EA5B25] text-white shadow-md' : 'text-slate-400'}`}><i className="fa-solid fa-align-left text-sm"></i></button>
                <button onClick={() => updateTextLayer(selectedField as any, { align: 'center' })} className={`flex-1 h-12 rounded-lg flex items-center justify-center transition-all ${layer?.align === 'center' ? 'bg-[#EA5B25] text-white shadow-md' : 'text-slate-400'}`}><i className="fa-solid fa-align-center text-sm"></i></button>
                <button onClick={() => updateTextLayer(selectedField as any, { align: 'right' })} className={`flex-1 h-12 rounded-lg flex items-center justify-center transition-all ${layer?.align === 'right' ? 'bg-[#EA5B25] text-white shadow-md' : 'text-slate-400'}`}><i className="fa-solid fa-align-right text-sm"></i></button>
              </div>
              <div className="space-y-2">
                 <div className="flex justify-between items-center px-1"><span className="text-[9px] font-black text-slate-400 uppercase shrink-0">Tamaño General</span><span className="text-[10px] font-black text-[#EA5B25]">{layer?.size}px</span></div>
                 <input type="range" min="8" max="100" value={layer?.size} onChange={(e) => updateTextLayer(selectedField as any, { size: Number(e.target.value) })} className="w-full h-2 accent-[#EA5B25] bg-slate-100 rounded-full appearance-none cursor-pointer" />
              </div>
            </div>
          )}

          {activeTab === 'SHADOW' && isText && (
            <div className="space-y-6">
              <div className="flex items-center justify-between p-3 bg-slate-50/50 rounded-2xl">
                 <span className="text-[10px] font-black text-slate-900 uppercase tracking-widest">Activar Sombra</span>
                 <button 
                  onClick={() => updateTextLayer(selectedField as any, { shadow: !layer?.shadow })} 
                  className={`w-12 h-7 rounded-full transition-all border relative ${layer?.shadow ? 'bg-[#EA5B25] border-[#EA5B25]' : 'bg-slate-400 border-slate-300'}`}
                 >
                  <div className={`absolute top-1 w-5 h-5 bg-white rounded-full shadow-sm transition-transform ${layer?.shadow ? 'translate-x-6' : 'translate-x-1'}`} />
                 </button>
              </div>
              {layer?.shadow && (
                <div className="grid grid-cols-2 gap-6 animate-in fade-in duration-300">
                  <div className="space-y-2">
                    <span className="text-[7px] font-black text-slate-400 uppercase">Difuminado</span>
                    <input type="range" min="0" max="20" value={layer?.shadowBlur} onChange={(e) => updateTextLayer(selectedField as any, { shadowBlur: Number(e.target.value) })} className="w-full h-1.5 accent-slate-900 bg-slate-100 rounded-full appearance-none" />
                  </div>
                  <div className="space-y-2">
                    <span className="text-[7px] font-black text-slate-400 uppercase">Color Sombra</span>
                    <input type="color" value={layer?.shadowColor} onChange={(e) => updateTextLayer(selectedField as any, { shadowColor: e.target.value })} className="w-full h-8 p-1 bg-white border border-slate-100 rounded-lg cursor-pointer" />
                  </div>
                </div>
              )}
            </div>
          )}

          {activeTab === 'SIZE' && selectedField === 'logo' && (
             <div className="space-y-4 px-1">
                <div className="flex justify-between items-center"><span className="text-[9px] font-black text-slate-400 uppercase">Escala Logo</span><span className="text-[10px] font-black text-[#EA5B25]">{state.logo.size}%</span></div>
                <input type="range" min="5" max="80" value={state.logo.size} onChange={(e) => updateState({ logo: { ...state.logo, size: Number(e.target.value) } })} className="w-full h-2 accent-[#EA5B25] bg-slate-100 rounded-full appearance-none cursor-pointer" />
             </div>
          )}

          {activeTab === 'BUTTON' && selectedField === 'cta' && (
            <div className="space-y-6">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <div className="flex justify-between items-center"><span className="text-[7px] font-black text-slate-400 uppercase">Tamaño Letra</span><span className="text-[9px] font-bold text-[#EA5B25]">{layer?.size}px</span></div>
                  <input type="range" min="8" max="60" value={layer?.size} onChange={(e) => updateTextLayer('cta', { size: Number(e.target.value) })} className="w-full h-1.5 accent-[#EA5B25] bg-slate-100 rounded-full appearance-none" />
                </div>
                <div className="space-y-2">
                  <div className="flex justify-between items-center"><span className="text-[7px] font-black text-slate-400 uppercase">Visualización</span></div>
                  <button onClick={() => updateState({ showCtaBg: !state.showCtaBg })} className={`w-full h-9 rounded-xl text-[8px] font-black uppercase transition-all shadow-sm ${state.showCtaBg ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-400'}`}>
                    {state.showCtaBg ? 'BOTÓN RELLENO' : 'BOTÓN TRANSPARENTE'}
                  </button>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'TRANSFORM' && (selectedField === 'background' || selectedField === 'image') && (
            <div className="space-y-6">
               <div className="space-y-4 pt-2">
                  <div className="flex justify-between items-center px-1">
                    <span className="text-[9px] font-black text-slate-600 uppercase">Zoom de Imagen</span>
                    <span className="text-[10px] font-black text-[#EA5B25]">{currentBgConfig.scale.toFixed(1)}x</span>
                  </div>
                  <input 
                    type="range" min="1" max="5" step="0.1" value={currentBgConfig.scale} 
                    onPointerDown={() => setIsInteracting(true)}
                    onPointerUp={() => setIsInteracting(false)}
                    onChange={(e) => onUpdateBackground({ scale: Number(e.target.value) })} 
                    className="w-full h-3 accent-[#EA5B25] bg-black/10 rounded-full appearance-none cursor-pointer" 
                  />
               </div>

               <div className="space-y-4 pt-4 border-t border-white/20">
                  <div className="flex justify-between items-center px-1">
                    <span className="text-[9px] font-black text-slate-600 uppercase">Filtro de Color</span>
                    <span className="text-[10px] font-black text-[#EA5B25]">{state.feedOverlayOpacity}%</span>
                  </div>
                  
                  <div className="flex items-center gap-4 bg-slate-50/10 p-2 rounded-2xl border border-white/5">
                    <div className="relative shrink-0">
                      <input 
                        type="color" 
                        value={state.backgroundOverlayColor} 
                        onChange={(e) => updateState({ backgroundOverlayColor: e.target.value })} 
                        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                      />
                      <div 
                        className="w-12 h-12 rounded-xl border-2 border-white shadow-lg flex items-center justify-center transition-transform active:scale-95"
                        style={{ backgroundColor: state.backgroundOverlayColor }}
                      >
                         <i className={`fa-solid fa-eye-dropper text-sm ${state.backgroundOverlayColor.toLowerCase() === '#ffffff' ? 'text-slate-900' : 'text-white'}`}></i>
                      </div>
                    </div>

                    <div className="flex-1 flex flex-col gap-1">
                       <span className="text-[7px] font-black text-slate-400 uppercase tracking-widest px-1">Intensidad</span>
                       <input 
                        type="range" min="0" max="85" value={state.feedOverlayOpacity} 
                        onChange={(e) => updateState({ feedOverlayOpacity: Number(e.target.value), storyOverlayOpacity: Number(e.target.value) })} 
                        className="w-full h-2 accent-slate-800 bg-black/10 rounded-full appearance-none cursor-pointer" 
                      />
                    </div>
                  </div>
               </div>

               <div className="space-y-5 pt-2 border-t border-white/20">
                  <div className="flex justify-between items-center px-1">
                    <span className="text-[9px] font-black text-slate-600 uppercase">Posición</span>
                    <button onClick={() => setBackgroundFocus(50, 50)} className="text-[8px] font-black text-[#EA5B25] uppercase bg-white/80 px-3 py-1.5 rounded-lg active:scale-95 transition-all shadow-sm">Centrar</button>
                  </div>
                  
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1">
                        <span className="text-[7px] font-black text-slate-500 uppercase block">H</span>
                        <input type="range" min="0" max="100" value={currentBgConfig.offset.x} onChange={(e) => setBackgroundFocus(Number(e.target.value), currentBgConfig.offset.y)} className="w-full h-1.5 accent-slate-800 bg-black/10 rounded-full appearance-none" />
                    </div>
                    <div className="space-y-1">
                        <span className="text-[7px] font-black text-slate-500 uppercase block">V</span>
                        <input type="range" min="0" max="100" value={currentBgConfig.offset.y} onChange={(e) => setBackgroundFocus(currentBgConfig.offset.x, Number(e.target.value))} className="w-full h-1.5 accent-slate-800 bg-black/10 rounded-full appearance-none" />
                    </div>
                  </div>
               </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default QuickEditDrawer;