
import React, { useState, useRef, useEffect } from 'react';
import { ProjectState, BackgroundConfig, Position } from '../types';

interface EditorCanvasProps {
  id?: string;
  isExporting?: boolean;
  state: ProjectState;
  selectedField: string | null;
  onUpdateText: (key: 'headline' | 'description' | 'additional' | 'cta', updates: any) => void;
  onUpdateLogo: (updates: any) => void;
  onUpdateResource: (updates: any) => void;
  onUpdateBackground: (updates: Partial<BackgroundConfig>) => void;
  onSelectVariant?: (index: number) => void;
  aspectRatio: '4:5' | '9:16';
  showSafeZones: boolean;
  onToggleGuides: () => void;
  onUpdateOpacity: (val: number) => void;
  onSelectLayer: (key: string) => void;
  onApplyStyle?: (style: 'bold' | 'elegant' | 'modern' | 'clean') => void;
}

const EditorCanvas: React.FC<EditorCanvasProps> = ({ 
  id, isExporting, state, selectedField, onUpdateText, onUpdateLogo, onUpdateResource, onUpdateBackground, aspectRatio,
  showSafeZones, onToggleGuides, onUpdateOpacity, onSelectLayer, onApplyStyle, onSelectVariant
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const opacityControlRef = useRef<HTMLDivElement>(null);
  const editInputRef = useRef<HTMLTextAreaElement>(null);
  const longPressTimer = useRef<number | null>(null);
  const activeLongPressLayer = useRef<string | null>(null);
  
  const [dragging, setDragging] = useState<{ type: 'text' | 'logo' | 'resource' | 'background'; id?: string; startX: number; startY: number; initialX?: number; initialY?: number; initialOffset?: Position } | null>(null);
  const [showOpacitySlider, setShowOpacitySlider] = useState(false);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [isLongPressing, setIsLongPressing] = useState<string | null>(null);
  const [isBackgroundUnlocked, setIsBackgroundUnlocked] = useState(false);
  
  const [snapGuides, setSnapGuides] = useState<{ x?: number, y?: number }>({});
  const [interSnapLines, setInterSnapLines] = useState<{ x?: number, y?: number }>({});

  const pointerStartPos = useRef<{ x: number, y: number } | null>(null);
  const lastTapTime = useRef<number>(0);

  const layout = aspectRatio === '9:16' ? 'story' : 'feed';
  const currentImage = state.imageVariants[state.selectedVariantIndex]?.url;
  const config = layout === 'feed' ? state.feedBackgroundConfig : state.storyBackgroundConfig;
  const opacity = layout === 'feed' ? state.feedOverlayOpacity : state.storyOverlayOpacity;

  // Lógica de Bloqueo Automático al cambiar selección
  useEffect(() => {
    if (selectedField !== 'background') {
      setIsBackgroundUnlocked(false);
    }
  }, [selectedField]);

  useEffect(() => {
    if (editingKey && editInputRef.current) {
      editInputRef.current.focus();
      const val = editInputRef.current.value;
      editInputRef.current.value = '';
      editInputRef.current.value = val;
    }
  }, [editingKey]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (opacityControlRef.current && !opacityControlRef.current.contains(event.target as Node)) {
        setShowOpacitySlider(false);
      }
    };
    if (showOpacitySlider) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showOpacitySlider]);

  const clearLongPress = () => {
    if (longPressTimer.current) {
      window.clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
    setIsLongPressing(null);
    activeLongPressLayer.current = null;
  };

  const handlePointerDown = (e: React.PointerEvent, type: 'text' | 'logo' | 'resource' | 'background', layerId?: string) => {
    if (containerRef.current) {
      containerRef.current.setPointerCapture(e.pointerId);
    }

    pointerStartPos.current = { x: e.clientX, y: e.clientY };
    const targetLayer = layerId || type;

    if (type !== 'background') {
      activeLongPressLayer.current = targetLayer;
      longPressTimer.current = window.setTimeout(() => {
        if (activeLongPressLayer.current === targetLayer) {
          setIsLongPressing(targetLayer);
          onSelectLayer(targetLayer);
          if (navigator.vibrate) navigator.vibrate(50);
        }
      }, 500);
    }

    if (type === 'background') {
      setDragging({ 
        type, 
        startX: e.clientX, 
        startY: e.clientY, 
        initialOffset: { ...config.offset } 
      });
      return;
    }
    
    e.stopPropagation();

    let initialX = 50;
    let initialY = 50;

    if (type === 'logo') {
      const lPos = layout === 'feed' ? state.logo.feedPosition : state.logo.storyPosition;
      initialX = lPos.x;
      initialY = lPos.y;
    } else if (type === 'resource') {
      const rPos = layout === 'feed' ? state.resource.feedPosition : state.resource.storyPosition;
      initialX = rPos.x;
      initialY = rPos.y;
    } else if (type === 'text' && layerId) {
      const t = state.textLayers[layerId as keyof typeof state.textLayers];
      const tPos = layout === 'feed' ? t.feedPosition : t.storyPosition;
      initialX = tPos.x;
      initialY = tPos.y;
    }

    setDragging({ type, id: layerId, startX: e.clientX, startY: e.clientY, initialX, initialY });
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!dragging || !containerRef.current || !pointerStartPos.current) return;
    
    const dist = Math.sqrt(Math.pow(e.clientX - dragging.startX, 2) + Math.pow(e.clientY - dragging.startY, 2));
    if (dist > 5) clearLongPress(); 

    if (dragging.type === 'background') {
      if (!isBackgroundUnlocked) return;

      const rect = containerRef.current.getBoundingClientRect();
      const deltaX = e.clientX - dragging.startX;
      const deltaY = e.clientY - dragging.startY;
      const deltaXPct = (deltaX / rect.width) * 100;
      const deltaYPct = (deltaY / rect.height) * 100;
      
      onUpdateBackground({ 
        offset: { 
          x: Math.max(0, Math.min(100, (dragging.initialOffset?.x || 50) + deltaXPct)),
          y: Math.max(0, Math.min(100, (dragging.initialOffset?.y || 50) + deltaYPct))
        } 
      });
      return;
    }

    const rect = containerRef.current.getBoundingClientRect();
    const deltaX = e.clientX - dragging.startX;
    const deltaY = e.clientY - dragging.startY;
    const deltaXPct = (deltaX / rect.width) * 100;
    const deltaYPct = (deltaY / rect.height) * 100;

    let x = Math.max(0, Math.min(100, (dragging.initialX || 0) + deltaXPct));
    let y = Math.max(0, Math.min(100, (dragging.initialY || 0) + deltaYPct));

    const threshold = 2.5; 
    const activeGuides: { x?: number, y?: number } = {};
    const interSnapLinesObj: { x?: number, y?: number } = {};

    if (Math.abs(x - 50) < threshold) { x = 50; activeGuides.x = 50; }
    if (Math.abs(y - 50) < threshold) { y = 50; activeGuides.y = 50; }

    const otherElements: { x: number, y: number, id: string }[] = [];
    (Object.entries(state.textLayers) as [string, any][]).forEach(([key, layer]) => {
      if (dragging.id !== key && layer.content.trim()) {
        const pos = layout === 'feed' ? layer.feedPosition : layer.storyPosition;
        otherElements.push({ x: pos.x, y: pos.y, id: key });
      }
    });

    if (dragging.type !== 'logo' && state.logo.url) {
      const lPos = layout === 'feed' ? state.logo.feedPosition : state.logo.storyPosition;
      otherElements.push({ x: lPos.x, y: lPos.y, id: 'logo' });
    }

    if (dragging.type !== 'resource' && state.resource.url) {
      const rPos = layout === 'feed' ? state.resource.feedPosition : state.resource.storyPosition;
      otherElements.push({ x: rPos.x, y: rPos.y, id: 'resource' });
    }

    otherElements.forEach(el => {
      if (Math.abs(x - el.x) < threshold) { x = el.x; interSnapLinesObj.x = el.x; }
      if (Math.abs(y - el.y) < threshold) { y = el.y; interSnapLinesObj.y = el.y; }
    });

    setSnapGuides(activeGuides);
    setInterSnapLines(interSnapLinesObj);

    if (dragging.type === 'text' && dragging.id) onUpdateText(dragging.id as any, { position: { x, y } });
    else if (dragging.type === 'logo') onUpdateLogo({ position: { x, y } });
    else if (dragging.type === 'resource') onUpdateResource({ position: { x, y } });
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    if (containerRef.current) {
      containerRef.current.releasePointerCapture(e.pointerId);
    }

    const wasDragging = dragging;
    const startPos = pointerStartPos.current;
    const currentTime = Date.now();
    const tapLength = currentTime - lastTapTime.current;

    clearLongPress();
    setDragging(null);
    setSnapGuides({});
    setInterSnapLines({});
    pointerStartPos.current = null;

    if (wasDragging && startPos) {
      const dist = Math.sqrt(Math.pow(e.clientX - startPos.x, 2) + Math.pow(e.clientY - startPos.y, 2));
      
      if (dist < 10) {
        if (wasDragging.type === 'background') {
          if (tapLength < 300 && tapLength > 0) {
            setIsBackgroundUnlocked(true);
            if (navigator.vibrate) navigator.vibrate(30);
            onSelectLayer('background');
          } else {
            if (selectedField && selectedField !== 'background') {
              onSelectLayer(''); 
            } else {
              onSelectLayer('background');
            }
          }
          lastTapTime.current = currentTime;
          return;
        }

        if (tapLength < 300 && tapLength > 0 && wasDragging.type === 'text') {
           setEditingKey(wasDragging.id || null);
        } else {
           onSelectLayer(wasDragging.id || wasDragging.type);
        }
      }
    }
    lastTapTime.current = currentTime;
  };

  const handlePointerCancel = (e: React.PointerEvent) => {
    if (containerRef.current) {
      containerRef.current.releasePointerCapture(e.pointerId);
    }
    clearLongPress();
    setDragging(null);
    setSnapGuides({});
    setInterSnapLines({});
    pointerStartPos.current = null;
  };

  return (
    <div className="relative flex flex-col items-center select-none w-full">
      <div className="relative w-full flex justify-center">
        
        {!isExporting && (
          <div className="absolute -left-14 top-0 flex flex-col gap-3 no-export z-[70] hidden sm:flex">
            <div className="relative" ref={opacityControlRef}>
              <button 
                onClick={() => setShowOpacitySlider(!showOpacitySlider)}
                className={`w-11 h-11 rounded-2xl flex items-center justify-center transition-all shadow-xl backdrop-blur-md border ${opacity > 0 ? 'bg-[#EA5B25] border-[#EA5B25] text-white' : 'bg-white/80 border-slate-200 text-slate-400'}`}
              >
                <i className="fa-solid fa-moon"></i>
              </button>
              {showOpacitySlider && (
                <div className="absolute left-14 top-0 bg-white rounded-2xl shadow-2xl p-4 border border-slate-100 flex flex-col items-center gap-3 animate-in fade-in slide-in-from-left-2">
                  <span className="text-[10px] font-black text-slate-400">{opacity}%</span>
                  <input 
                    type="range" min="0" max="85" value={opacity} 
                    onChange={(e) => onUpdateOpacity(Number(e.target.value))}
                    className="h-32 w-1.5 accent-[#EA5B25] bg-slate-100 rounded-full appearance-none cursor-pointer [writing-mode:bt-lr] [-webkit-appearance:slider-vertical]" 
                  />
                </div>
              )}
            </div>

            <button 
              onClick={onToggleGuides}
              className={`w-11 h-11 rounded-2xl flex items-center justify-center transition-all shadow-xl backdrop-blur-md border ${showSafeZones ? 'bg-[#EA5B25] border-[#EA5B25] text-white' : 'bg-white/80 border-slate-200 text-slate-400'}`}
            >
              <i className="fa-solid fa-border-none"></i>
            </button>
          </div>
        )}

        <div 
          id={id} 
          ref={containerRef} 
          onPointerMove={handlePointerMove} 
          onPointerUp={handlePointerUp} 
          onPointerCancel={handlePointerCancel}
          onPointerLeave={clearLongPress}
          className={`relative bg-white overflow-hidden ${aspectRatio === '9:16' ? 'aspect-[9/16]' : 'aspect-[4/5]'} w-full max-w-[280px] sm:max-w-[320px] shadow-2xl rounded-lg touch-none ${isExporting ? 'is-exporting-container' : ''}`}
        >
          {snapGuides.x !== undefined && !isExporting && <div className="absolute top-0 bottom-0 w-[1px] bg-green-500 z-[100]" style={{ left: `${snapGuides.x}%` }} />}
          {snapGuides.y !== undefined && !isExporting && <div className="absolute left-0 right-0 h-[1px] bg-green-500 z-[100]" style={{ top: `${snapGuides.y}%` }} />}
          {interSnapLines.x !== undefined && !isExporting && <div className="absolute top-0 bottom-0 w-[1px] bg-emerald-400 z-[100] border-r border-dashed border-emerald-200" style={{ left: `${interSnapLines.x}%` }} />}
          {interSnapLines.y !== undefined && !isExporting && <div className="absolute left-0 right-0 h-[1px] bg-emerald-400 z-[100] border-b border-dashed border-emerald-200" style={{ top: `${interSnapLines.y}%` }} />}

          <div 
            className="absolute inset-0 overflow-hidden touch-none" 
            onPointerDown={(e) => handlePointerDown(e, 'background')}
            style={{ 
              zIndex: state.layersOrder.indexOf('background'),
              cursor: isBackgroundUnlocked ? 'move' : 'default'
            }}
          >
            {currentImage ? (
              <img 
                src={currentImage} 
                crossOrigin={currentImage.startsWith('data:') ? undefined : "anonymous"}
                className="w-full h-full object-cover pointer-events-none" 
                style={{ transformOrigin: 'center center', transform: `scale(${config.scale}) translate(${(config.offset.x - 50)}%, ${(config.offset.y - 50)}%)`, transition: (isExporting || dragging?.type === 'background') ? 'none' : 'transform 0.4s cubic-bezier(0.2, 0, 0, 1)' }} 
              />
            ) : <div className="absolute inset-0 bg-slate-100 flex items-center justify-center"><i className="fa-solid fa-image text-slate-300 text-5xl"></i></div>}
            <div className="absolute inset-0 pointer-events-none" style={{ backgroundColor: state.backgroundOverlayColor || '#000000', opacity: opacity / 100 }} />
          </div>

          {!isExporting && state.imageVariants.length > 1 && (
            <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 flex items-center justify-between px-2 z-[90] pointer-events-none no-export">
              <button onClick={(e) => {e.stopPropagation(); onSelectVariant?.((state.selectedVariantIndex - 1 + state.imageVariants.length) % state.imageVariants.length);}} className="w-8 h-8 rounded-full bg-white/40 backdrop-blur-md border border-white/20 text-[#EA5B25] flex items-center justify-center shadow-lg active:scale-90 pointer-events-auto transition-all hover:bg-white/60">
                <i className="fa-solid fa-chevron-left text-[10px]"></i>
              </button>
              <button onClick={(e) => {e.stopPropagation(); onSelectVariant?.((state.selectedVariantIndex + 1) % state.imageVariants.length);}} className="w-8 h-8 rounded-full bg-white/40 backdrop-blur-md border border-white/20 text-[#EA5B25] flex items-center justify-center shadow-lg active:scale-90 pointer-events-auto transition-all hover:bg-white/60">
                <i className="fa-solid fa-chevron-right text-[10px]"></i>
              </button>
            </div>
          )}

          {showSafeZones && !isExporting && (
            <div className="absolute inset-0 pointer-events-none no-export" style={{ zIndex: state.layersOrder.indexOf('background') }}>
              {aspectRatio === '9:16' ? (
                <>
                  <div className="absolute top-0 inset-x-0 h-[14%] bg-green-400/10 border-b border-dashed border-green-500/30" />
                  <div className="absolute bottom-0 inset-x-0 h-[15%] bg-green-400/10 border-t border-dashed border-green-500/30" />
                  {/* Visualización de la nueva jaula de seguridad horizontal para Story */}
                  <div className="absolute inset-y-0 left-0 w-[15%] border-r border-dashed border-red-500/20 bg-red-400/5" />
                  <div className="absolute inset-y-0 right-0 w-[15%] border-l border-dashed border-red-500/20 bg-red-400/5" />
                </>
              ) : <div className="absolute inset-[5%] border border-dashed border-green-500/30 bg-green-400/5" />}
            </div>
          )}

          {state.resource.url && (() => {
            const rPos = layout === 'feed' ? state.resource.feedPosition : state.resource.storyPosition;
            const safeX = (typeof rPos?.x === 'number' && !isNaN(rPos.x)) ? rPos.x : 50;
            const safeY = (typeof rPos?.y === 'number' && !isNaN(rPos.y)) ? rPos.y : 50;
            const isSelected = selectedField === 'resource';
            
            return (
              <div 
                onPointerDown={(e) => handlePointerDown(e, 'resource')} 
                className={`absolute cursor-move touch-none transition-all duration-300 ${isLongPressing === 'resource' ? 'scale-110' : ''} ${isSelected ? 'ring-2 ring-blue-500 ring-offset-2 rounded-sm z-[110]' : ''}`}
                style={{
                  // El recurso queda DEBAJO de los textos (salvo cuando se está editando)
                  zIndex: isSelected ? 110 : (state.layersOrder.indexOf('resource') > -1 ? state.layersOrder.indexOf('resource') : 1),
                  left: `${safeX}%`, 
                  top: `${safeY}%`, 
                  width: `${state.resource.size}%`, 
                  opacity: state.resource.opacity / 100,
                  transform: `translate(-50%, -50%) ${isLongPressing === 'resource' ? 'scale(1.1)' : ''}`, 
                  transition: (isExporting || dragging?.type === 'resource') ? 'none' : 'left 0.2s, top 0.2s, transform 0.3s, z-index 0.3s' 
                }}
              >
                <img 
                  src={state.resource.url} 
                  crossOrigin={state.resource.url.startsWith('data:') ? undefined : "anonymous"}
                  draggable={false}
                  className="w-full block drop-shadow-md" 
                  style={{ pointerEvents: 'none', userSelect: 'none' }}
                />
              </div>
            );
          })()}

          {state.logo.url && (() => {
            const isSelected = selectedField === 'logo';
            return (
              <div 
                onPointerDown={(e) => handlePointerDown(e, 'logo')} 
                className={`absolute cursor-move touch-none transition-all duration-300 ${isLongPressing === 'logo' ? 'scale-110' : ''} ${isSelected ? 'ring-2 ring-blue-500 ring-offset-2 rounded-sm z-[110]' : ''}`} 
                style={{ 
                  zIndex: isSelected ? 110 : state.layersOrder.indexOf('logo'),
                  left: `${layout === 'feed' ? state.logo.feedPosition.x : state.logo.storyPosition.x}%`, 
                  top: `${layout === 'feed' ? state.logo.feedPosition.y : state.logo.storyPosition.y}%`, 
                  width: `${state.logo.size}%`, 
                  transform: `translate(-50%, -50%) ${isLongPressing === 'logo' ? 'scale(1.1)' : ''}`, 
                  transition: (isExporting || dragging?.type === 'logo') ? 'none' : 'left 0.2s, top 0.2s, transform 0.3s, z-index 0.3s' 
                }}
              >
                <img 
                  src={state.logo.url} 
                  crossOrigin={state.logo.url.startsWith('data:') ? undefined : "anonymous"}
                  className="w-full block pointer-events-none drop-shadow-md" 
                />
              </div>
            );
          })()}

          {(['headline', 'description', 'additional', 'cta'] as const).map((key) => {
            const t = state.textLayers[key];
            const isCta = key === 'cta';
            const isSelected = selectedField === key;
            
            const isCurrentlyEditing = editingKey === key;
            const contentTrimmed = t.content.trim();

            if (!contentTrimmed && !isCurrentlyEditing) return null;
            if (isCta && !state.showCta) return null;

            const pos = layout === 'feed' ? t.feedPosition : t.storyPosition;
            
            // El texto puede usar el ancho completo del feed/story (sin recorte a zonas de seguridad)
            const effectiveWidth = Math.min(t.width, 100);

            const hasBackground = t.backgroundColor && t.backgroundColor !== 'transparent';

            return (
              <div 
                key={key} 
                onPointerDown={(e) => handlePointerDown(e, 'text', key)} 
                className={`absolute cursor-move touch-none flex items-center justify-center p-1 transition-all duration-300 ${isLongPressing === key ? 'scale-110' : ''} ${isSelected ? 'ring-2 ring-blue-500 ring-offset-2 rounded-lg z-[110]' : ''}`}
                style={{ 
                  zIndex: isSelected ? 110 : state.layersOrder.indexOf(key),
                  left: `${pos.x}%`, 
                  top: `${pos.y}%`, 
                  width: `${effectiveWidth}%`, 
                  transform: `translate(-50%, -50%) ${isLongPressing === key ? 'scale(1.1)' : ''}`, 
                  transition: (isExporting || dragging?.id === key) ? 'none' : 'left 0.2s, top 0.2s, transform 0.3s, z-index 0.3s' 
                }}
              >
                {isCurrentlyEditing && !isExporting ? (
                  <textarea
                    ref={editInputRef}
                    value={t.content}
                    onChange={(e) => onUpdateText(key, { content: e.target.value })}
                    onBlur={() => setEditingKey(null)}
                    onPointerDown={(e) => e.stopPropagation()}
                    className="w-full bg-transparent border-none outline-none resize-none overflow-hidden p-0 m-0 block no-scrollbar"
                    style={{
                      color: t.color,
                      backgroundColor: t.backgroundColor,
                      padding: hasBackground ? '0.2em 0.4em' : '0',
                      borderRadius: '4px',
                      fontSize: `${Math.max(8, t.size * (aspectRatio === '9:16' ? 0.9 : 1))}px`,
                      fontFamily: t.font,
                      fontWeight: t.bold ? 'bold' : 'normal',
                      fontStyle: t.italic ? 'italic' : 'normal',
                      textAlign: t.align,
                      textShadow: t.shadow ? `${t.shadowOffset}px ${t.shadowOffset}px ${t.shadowBlur}px ${t.shadowColor}` : 'none',
                      lineHeight: t.lineHeight,
                    }}
                  />
                ) : (
                  <div className={`w-full pointer-events-none ${t.align === 'left' ? 'text-left' : t.align === 'right' ? 'text-right' : 'text-center'}`}>
                    {isCta ? (
                      <span style={{ 
                        color: t.color, 
                        fontSize: `${Math.max(8, t.size * (aspectRatio === '9:16' ? 0.9 : 1))}px`,
                        fontFamily: t.font,
                        fontWeight: t.bold ? 'bold' : 'normal',
                        backgroundColor: state.showCtaBg ? state.ctaBgColor : 'transparent', 
                        padding: state.showCtaBg ? `${state.ctaPaddingY}px ${state.ctaPaddingX}px` : '0', 
                        borderRadius: '999px', 
                        display: 'inline-block',
                        textShadow: t.shadow ? `${t.shadowOffset}px ${t.shadowOffset}px ${t.shadowBlur}px ${t.shadowColor}` : 'none',
                      }}>
                        {t.content}
                      </span>
                    ) : (
                      <div style={{
                        color: t.color,
                        backgroundColor: t.backgroundColor,
                        padding: hasBackground ? '0.2em 0.4em' : '0',
                        borderRadius: '4px',
                        fontSize: `${Math.max(8, t.size * (aspectRatio === '9:16' ? 0.9 : 1))}px`,
                        fontFamily: t.font,
                        fontWeight: t.bold ? 'bold' : 'normal',
                        fontStyle: t.italic ? 'italic' : 'normal',
                        textDecoration: t.underline ? 'underline' : 'none',
                        textShadow: t.shadow ? `${t.shadowOffset}px ${t.shadowOffset}px ${t.shadowBlur}px ${t.shadowColor}` : 'none',
                        lineHeight: t.lineHeight,
                        whiteSpace: 'pre-wrap',
                        display: 'inline-block'
                      }}>
                        {t.content}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default EditorCanvas;