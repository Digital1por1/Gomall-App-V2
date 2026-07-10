import React from 'react';
import { UserProfile } from '../types';
import { planForProfile } from './plans';

interface HomeProps {
  profile: UserProfile | null;
  isAdmin: boolean;
  designsCount: number;
  onNewDesign: () => void;
  onNewCampaign: () => void;
  onOpenReels: () => void;
  onOpenProductAd: () => void;
  onEditBrand: () => void;
  onOpenDesigns: () => void;
  onOpenCampaigns: () => void;
  onOpenCalendar: () => void;
  onOpenAdmin?: () => void;
  onLogout: () => void;
}

const Home: React.FC<HomeProps> = ({
  profile, isAdmin, designsCount,
  onNewDesign, onNewCampaign, onOpenReels, onOpenProductAd,
  onEditBrand, onOpenDesigns, onOpenCampaigns, onOpenCalendar, onOpenAdmin, onLogout,
}) => {
  const kit = profile?.brandKits?.[0];
  const colors = kit?.brandColors || [];
  const logo = kit?.logoUrls?.[0];
  const campaignsCount = profile?.campaigns?.length || 0;
  const plannedCount = profile?.plannedPosts?.length || 0;
  const businessName = isAdmin ? 'Administrador' : (profile?.business || 'Tu negocio');

  return (
    <div className="h-screen w-full overflow-y-auto bg-gradient-to-b from-[#FBFBFD] to-[#F1F2F6]">
      {/* Header */}
      <header className="sticky top-0 z-10 h-20 bg-white/85 backdrop-blur-xl border-b border-slate-100 flex items-center justify-between px-5 sm:px-8">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-[#EA5B25] to-[#f0814f] text-white flex items-center justify-center shadow-lg shadow-orange-200/40 shrink-0">
            <i className="fa-solid fa-wand-magic-sparkles text-base"></i>
          </div>
          <div className="min-w-0">
            <h1 className="font-display text-lg sm:text-xl text-[#0F172A] leading-none truncate">{businessName}</h1>
            <span className="text-[9px] font-black uppercase tracking-[0.2em] text-slate-400">Gomall Studio</span>
          </div>
        </div>
        <button onClick={onLogout} title="Cerrar sesión" className="h-10 w-10 flex items-center justify-center bg-slate-50 text-slate-400 rounded-xl border border-transparent hover:text-slate-600 transition-all active:scale-95"><i className="fa-solid fa-right-from-bracket text-lg"></i></button>
      </header>

      <div className="max-w-4xl mx-auto px-5 sm:px-8 py-8 sm:py-12 space-y-10">

        {/* Saludo */}
        <div className="space-y-2">
          <h2 className="font-display text-2xl sm:text-[32px] text-slate-900 leading-tight">Hola{profile?.name ? `, ${profile.name.split(' ')[0]}` : ''} 👋</h2>
          <p className="text-slate-400 text-sm font-medium">¿Qué querés crear hoy?</p>
          {(() => {
            const plan = planForProfile(profile?.plan, profile?.tokenLimit);
            const limit = profile?.tokenLimit || 1000000;
            const used = profile?.usage?.tokensUsed || 0;
            const pct = Math.min(100, Math.round((used / limit) * 100));
            const imagesLeft = Math.max(0, Math.floor((limit - used) / 15000));
            return (
              <div className="inline-flex items-center gap-3 bg-white border border-slate-100 rounded-2xl px-4 py-2 shadow-sm shadow-slate-200/40 mt-1">
                <span className="text-[10px] font-black uppercase tracking-widest text-[#EA5B25]"><i className="fa-solid fa-bolt mr-1"></i>Plan {plan?.name || 'Personalizado'}</span>
                <span className="text-slate-200">·</span>
                <span className="text-[10px] font-bold text-slate-500">{pct}% usado</span>
                <span className="text-slate-200">·</span>
                <span className="text-[10px] font-bold text-slate-500">~{imagesLeft} imágenes restantes</span>
              </div>
            );
          })()}
        </div>

        {/* Acceso admin: ver todas las cuentas */}
        {isAdmin && onOpenAdmin && (
          <button onClick={onOpenAdmin} className="w-full bg-slate-900 text-white rounded-[28px] p-5 sm:p-6 shadow-lg shadow-slate-300/40 flex items-center gap-4 hover:bg-slate-800 transition-all text-left group">
            <div className="w-12 h-12 rounded-2xl bg-white/10 flex items-center justify-center shrink-0"><i className="fa-solid fa-shield-halved text-lg"></i></div>
            <div className="flex-1 min-w-0">
              <p className="font-black text-base">Panel de administración</p>
              <p className="text-white/60 text-sm font-medium">Ver todas las cuentas, su consumo y sus planes</p>
            </div>
            <span className="text-[10px] font-black uppercase tracking-widest text-white/50 group-hover:text-white transition-colors shrink-0">Abrir <i className="fa-solid fa-chevron-right text-[8px] ml-1"></i></span>
          </button>
        )}

        {/* 1 · Tu marca */}
        <section className="space-y-3">
          <div className="flex items-center gap-2">
            <span className="w-6 h-6 rounded-lg bg-orange-50 text-[#EA5B25] flex items-center justify-center text-[10px] font-black">1</span>
            <h3 className="text-[11px] font-black text-slate-400 uppercase tracking-[0.2em]">Tu identidad de marca</h3>
          </div>
          <button onClick={onEditBrand} className="w-full bg-white rounded-[28px] border border-slate-100 p-5 sm:p-6 shadow-sm shadow-slate-200/40 flex items-center gap-4 hover:border-orange-200 hover:shadow-md transition-all text-left group">
            <div className="w-14 h-14 rounded-2xl bg-slate-50 border border-slate-100 flex items-center justify-center overflow-hidden shrink-0">
              {logo ? <img src={logo} className="max-w-full max-h-full object-contain p-1.5" /> : <i className="fa-solid fa-gem text-slate-300 text-xl"></i>}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <p className="font-black text-slate-800 truncate">{businessName}</p>
                <span className="text-[8px] font-black uppercase tracking-wider text-green-600 bg-green-50 px-2 py-0.5 rounded-full shrink-0"><i className="fa-solid fa-check mr-1"></i>Lista</span>
              </div>
              <div className="flex items-center gap-2 mt-1.5">
                {colors.slice(0, 5).map((c, i) => <span key={i} className="w-4 h-4 rounded-md border border-white shadow-sm" style={{ backgroundColor: c }} />)}
                {profile?.industry && <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider ml-1">{profile.industry}</span>}
              </div>
            </div>
            <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest group-hover:text-[#EA5B25] transition-colors shrink-0">Editar <i className="fa-solid fa-chevron-right text-[8px] ml-1"></i></span>
          </button>
        </section>

        {/* 2 · Crear */}
        <section className="space-y-3">
          <div className="flex items-center gap-2">
            <span className="w-6 h-6 rounded-lg bg-orange-50 text-[#EA5B25] flex items-center justify-center text-[10px] font-black">2</span>
            <h3 className="text-[11px] font-black text-slate-400 uppercase tracking-[0.2em]">Crear</h3>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Diseño individual */}
            <button onClick={onNewDesign} className="relative overflow-hidden bg-white rounded-[28px] border border-slate-100 p-6 shadow-sm shadow-slate-200/40 hover:border-orange-200 hover:shadow-lg transition-all text-left active:scale-[0.99] group">
              <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-[#EA5B25] to-[#f0814f] text-white flex items-center justify-center shadow-lg shadow-orange-200/50 mb-4"><i className="fa-solid fa-pen-ruler text-lg"></i></div>
              <h4 className="font-display text-xl text-slate-900 leading-tight">Diseño individual</h4>
              <p className="text-slate-400 text-xs font-medium mt-1 leading-relaxed">Creá un post suelto desde cero en el editor.</p>
            </button>
            {/* Campaña con IA */}
            <button onClick={onNewCampaign} className="relative overflow-hidden bg-gradient-to-br from-[#EA5B25] to-[#f0814f] rounded-[28px] p-6 shadow-xl shadow-orange-200/50 hover:shadow-2xl transition-all text-left active:scale-[0.99] group">
              <div className="w-12 h-12 rounded-2xl bg-white/20 backdrop-blur text-white flex items-center justify-center mb-4"><i className="fa-solid fa-wand-magic-sparkles text-lg"></i></div>
              <h4 className="font-display text-xl text-white leading-tight">Campaña con IA</h4>
              <p className="text-white/80 text-xs font-medium mt-1 leading-relaxed">Completá un brief y la IA arma toda la campaña: posts, reels y copys.</p>
            </button>
          </div>
          {/* Formatos / atajos */}
          <div className="grid grid-cols-2 gap-3">
            <button onClick={onOpenReels} className="bg-white rounded-2xl border border-slate-100 p-4 shadow-sm shadow-slate-200/40 hover:border-purple-200 transition-all flex items-center gap-3 text-left active:scale-[0.99]">
              <div className="w-10 h-10 rounded-xl bg-purple-50 text-purple-600 flex items-center justify-center shrink-0"><i className="fa-solid fa-film"></i></div>
              <div className="min-w-0"><p className="font-black text-slate-800 text-sm">Reel</p><p className="text-[10px] text-slate-400 font-bold truncate">Editar video</p></div>
            </button>
            <button onClick={onOpenProductAd} className="bg-white rounded-2xl border border-slate-100 p-4 shadow-sm shadow-slate-200/40 hover:border-emerald-200 transition-all flex items-center gap-3 text-left active:scale-[0.99]">
              <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center shrink-0"><i className="fa-solid fa-box-open"></i></div>
              <div className="min-w-0"><p className="font-black text-slate-800 text-sm">Producto → Aviso</p><p className="text-[10px] text-slate-400 font-bold truncate">Foto a publicidad</p></div>
            </button>
          </div>
        </section>

        {/* 3 · Tu contenido */}
        <section className="space-y-3">
          <div className="flex items-center gap-2">
            <span className="w-6 h-6 rounded-lg bg-orange-50 text-[#EA5B25] flex items-center justify-center text-[10px] font-black">3</span>
            <h3 className="text-[11px] font-black text-slate-400 uppercase tracking-[0.2em]">Tu contenido</h3>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <button onClick={onOpenDesigns} className="bg-white rounded-2xl border border-slate-100 p-5 shadow-sm shadow-slate-200/40 hover:border-slate-300 transition-all text-left active:scale-[0.99]">
              <div className="flex items-center justify-between"><i className="fa-solid fa-folder-open text-slate-300 text-lg"></i><span className="font-display text-2xl text-slate-900">{designsCount}</span></div>
              <p className="font-black text-slate-700 text-sm mt-2">Mis diseños</p>
            </button>
            <button onClick={onOpenCampaigns} className="bg-white rounded-2xl border border-slate-100 p-5 shadow-sm shadow-slate-200/40 hover:border-slate-300 transition-all text-left active:scale-[0.99]">
              <div className="flex items-center justify-between"><i className="fa-solid fa-bullhorn text-slate-300 text-lg"></i><span className="font-display text-2xl text-slate-900">{campaignsCount}</span></div>
              <p className="font-black text-slate-700 text-sm mt-2">Mis campañas</p>
            </button>
            <button onClick={onOpenCalendar} className="bg-white rounded-2xl border border-slate-100 p-5 shadow-sm shadow-slate-200/40 hover:border-slate-300 transition-all text-left active:scale-[0.99]">
              <div className="flex items-center justify-between"><i className="fa-solid fa-calendar-days text-slate-300 text-lg"></i><span className="font-display text-2xl text-slate-900">{plannedCount}</span></div>
              <p className="font-black text-slate-700 text-sm mt-2">Calendario</p>
            </button>
          </div>
        </section>

        {/* Consumo de IA (solo admin) */}
        {isAdmin && (() => {
          const stats = profile?.usageStats || {};
          const ACTIONS: { key: string; label: string; isImage: boolean }[] = [
            { key: 'imagen', label: 'Imágenes', isImage: true },
            { key: 'mejorar', label: 'Mejorar imagen', isImage: true },
            { key: 'producto', label: 'Producto → Aviso', isImage: true },
            { key: 'campana', label: 'Campañas', isImage: false },
            { key: 'copy', label: 'Copys', isImage: false },
            { key: 'analisis_web', label: 'Análisis de web', isImage: false },
          ];
          const rows = ACTIONS.map(a => {
            const s = (stats as any)[a.key] || {};
            return { ...a, calls: s.calls || 0, tokens: s.tokens || 0 };
          }).filter(r => r.calls > 0);
          const totalTokens = (stats as any).totalTokens || 0;
          // Estimación de costo: las imágenes son el costo real dominante (~US$0.04 c/u). Texto ≈ despreciable.
          const imageCalls = rows.filter(r => r.isImage).reduce((a, r) => a + r.calls, 0);
          const estCost = imageCalls * 0.04;
          return (
            <section className="space-y-3">
              <div className="flex items-center gap-2">
                <span className="w-6 h-6 rounded-lg bg-slate-100 text-slate-500 flex items-center justify-center text-[10px] font-black"><i className="fa-solid fa-gauge-high"></i></span>
                <h3 className="text-[11px] font-black text-slate-400 uppercase tracking-[0.2em]">Consumo de IA (tokens reales) · admin</h3>
              </div>
              <div className="bg-white rounded-[28px] border border-slate-100 p-6 shadow-sm shadow-slate-200/40 space-y-4">
                {rows.length === 0 ? (
                  <p className="text-sm text-slate-400 font-medium">Todavía no hay consumo registrado. Generá algo para ver los números reales.</p>
                ) : (
                  <>
                    <div className="space-y-2">
                      {rows.map(r => (
                        <div key={r.key} className="flex items-center justify-between text-sm">
                          <span className="font-bold text-slate-600"><i className={`fa-solid ${r.isImage ? 'fa-image text-[#EA5B25]' : 'fa-font text-slate-300'} mr-2 text-xs`}></i>{r.label}</span>
                          <span className="font-black text-slate-800 tabular-nums">{r.calls} <span className="text-slate-300 font-bold">·</span> {r.tokens.toLocaleString()} tk</span>
                        </div>
                      ))}
                    </div>
                    <div className="border-t border-slate-100 pt-3 flex items-center justify-between">
                      <span className="text-[11px] font-black text-slate-400 uppercase tracking-widest">Total</span>
                      <span className="font-display text-lg text-slate-900">{totalTokens.toLocaleString()} tokens</span>
                    </div>
                    <div className="bg-orange-50 rounded-2xl px-4 py-3 text-center">
                      <p className="text-[10px] font-black text-[#EA5B25] uppercase tracking-widest">Costo estimado (imágenes)</p>
                      <p className="font-display text-2xl text-slate-900">≈ US$ {estCost.toFixed(2)}</p>
                      <p className="text-[9px] text-slate-400 font-bold mt-1">{imageCalls} imágenes · estimado a ~US$0,04 c/u. Confirmá precios en ai.google.dev/pricing</p>
                    </div>
                  </>
                )}
              </div>
            </section>
          );
        })()}

      </div>
    </div>
  );
};

export default Home;
