import React from 'react';

interface LandingProps {
  onLogin: () => void;
}

const GoogleBtn: React.FC<{ onLogin: () => void; label: string; variant?: 'primary' | 'light' }> = ({ onLogin, label, variant = 'primary' }) => (
  <button
    onClick={onLogin}
    className={`h-14 px-7 rounded-2xl flex items-center justify-center gap-3 font-black text-[12px] uppercase tracking-[0.15em] transition-all active:scale-95 ${
      variant === 'primary'
        ? 'bg-gradient-to-r from-[#EA5B25] to-[#f0814f] text-white shadow-xl shadow-orange-300/40 hover:shadow-2xl hover:shadow-orange-300/50'
        : 'bg-white text-slate-700 border border-slate-200 shadow-sm hover:border-orange-200'
    }`}
  >
    {label}
  </button>
);

const FEATURES = [
  { icon: 'fa-gem', color: 'text-[#EA5B25] bg-orange-50', title: 'Identidad de marca', desc: 'Cargás tu logo, colores y tipografías una vez. Todo lo que crees sale coherente y profesional.' },
  { icon: 'fa-wand-magic-sparkles', color: 'text-[#EA5B25] bg-orange-50', title: 'Campañas con IA', desc: 'Completás un brief y la IA arma la campaña completa: qué publicar, los textos y los prompts de cada pieza.' },
  { icon: 'fa-pen-ruler', color: 'text-blue-600 bg-blue-50', title: 'Editor de diseños', desc: 'Generás y editás posts para feed y stories con plantillas profesionales en un clic.' },
  { icon: 'fa-film', color: 'text-purple-600 bg-purple-50', title: 'Editor de reels', desc: 'Subís un video, le sumás música y subtítulos, y lo exportás listo para subir.' },
  { icon: 'fa-box-open', color: 'text-emerald-600 bg-emerald-50', title: 'Producto → Aviso', desc: 'Sacale una foto a tu producto y la IA la convierte en una publicidad profesional.' },
  { icon: 'fa-calendar-days', color: 'text-sky-600 bg-sky-50', title: 'Calendario', desc: 'Te dice qué publicar y cuándo, con las fechas comerciales clave de tu rubro.' },
];

const STEPS = [
  { n: '1', icon: 'fa-gem', title: 'Configurá tu marca', desc: 'Logo, colores, tipografías e historia. La base para que todo salga con tu identidad.' },
  { n: '2', icon: 'fa-wand-magic-sparkles', title: 'Pedí una campaña', desc: 'Contás tu objetivo en un brief y la IA te propone toda la campaña al instante.' },
  { n: '3', icon: 'fa-share-nodes', title: 'Editá y publicá', desc: 'Ajustás lo que quieras en el editor, descargás y subís a tus redes.' },
];

// Mockup CSS de un post generado (sin imágenes externas)
const PostMockup: React.FC = () => (
  <div className="w-full max-w-[300px] mx-auto bg-white rounded-[28px] shadow-2xl shadow-slate-300/50 border border-slate-100 p-3 rotate-[1.5deg]">
    <div className="rounded-[20px] overflow-hidden aspect-[4/5] bg-gradient-to-br from-[#EA5B25] via-[#f0814f] to-amber-400 relative flex flex-col justify-end p-5">
      <div className="absolute top-4 left-4 bg-white/90 backdrop-blur rounded-xl px-3 py-1.5 text-[9px] font-black text-[#EA5B25] uppercase tracking-widest">Tu Marca</div>
      <div className="absolute inset-0 bg-black/15" />
      <div className="relative space-y-2">
        <h3 className="font-display text-white text-2xl leading-tight drop-shadow">Nueva colección de invierno</h3>
        <p className="text-white/90 text-[11px] font-semibold">Hasta 30% off · Solo esta semana</p>
        <div className="inline-block bg-white text-[#EA5B25] text-[10px] font-black uppercase tracking-widest px-4 py-2 rounded-full mt-1">Ver más</div>
      </div>
    </div>
    <div className="flex items-center gap-3 px-1 pt-3 pb-1 text-slate-300">
      <i className="fa-regular fa-heart"></i><i className="fa-regular fa-comment"></i><i className="fa-regular fa-paper-plane"></i>
      <i className="fa-regular fa-bookmark ml-auto"></i>
    </div>
  </div>
);

const Landing: React.FC<LandingProps> = ({ onLogin }) => {
  return (
    <div className="h-screen w-full overflow-y-auto bg-gradient-to-b from-[#FBFBFD] to-[#F1F2F6] text-slate-900">
      {/* Nav */}
      <nav className="sticky top-0 z-20 h-18 bg-white/80 backdrop-blur-xl border-b border-slate-100 flex items-center justify-between px-5 sm:px-8 py-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-[#EA5B25] to-[#f0814f] text-white flex items-center justify-center shadow-lg shadow-orange-200/40">
            <i className="fa-solid fa-wand-magic-sparkles"></i>
          </div>
          <span className="font-display text-lg text-slate-900">Gomall Studio</span>
        </div>
        <button onClick={onLogin} className="text-[11px] font-black uppercase tracking-widest text-slate-500 hover:text-[#EA5B25] transition-colors">Iniciar sesión</button>
      </nav>

      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="absolute top-[-20%] right-[-10%] w-[50%] aspect-square bg-orange-200/30 rounded-full blur-[120px]" />
        <div className="absolute bottom-[-20%] left-[-10%] w-[45%] aspect-square bg-amber-100/40 rounded-full blur-[120px]" />
        <div className="relative max-w-5xl mx-auto px-5 sm:px-8 pt-14 pb-16 grid lg:grid-cols-2 gap-10 items-center">
          <div className="space-y-6 text-center lg:text-left">
            <span className="inline-flex items-center gap-2 bg-orange-50 text-[#EA5B25] text-[10px] font-black uppercase tracking-[0.2em] px-4 py-2 rounded-full border border-orange-100">
              <i className="fa-solid fa-bolt"></i> Marketing con Inteligencia Artificial
            </span>
            <h1 className="font-display text-[34px] sm:text-5xl text-slate-900 leading-[1.05]">
              Tu equipo de marketing,<br /><span className="text-[#EA5B25]">sin contratar una agencia.</span>
            </h1>
            <p className="text-slate-500 text-base sm:text-lg leading-relaxed font-medium max-w-lg mx-auto lg:mx-0">
              Creá campañas, posts y reels profesionales para tu negocio en minutos. La IA hace el trabajo pesado; vos solo aprobás y publicás.
            </p>
            <div className="flex flex-col sm:flex-row gap-3 justify-center lg:justify-start pt-2">
              <GoogleBtn onLogin={onLogin} label="Empezar gratis" />
              <GoogleBtn onLogin={onLogin} label="Ya tengo cuenta" variant="light" />
            </div>
            <p className="text-[11px] text-slate-400 font-bold">Sin tarjeta · Empezás en segundos</p>
          </div>
          <div className="relative flex justify-center">
            <PostMockup />
            <div className="hidden sm:block absolute -left-2 top-6 bg-white rounded-2xl shadow-xl shadow-slate-300/40 border border-slate-100 px-4 py-3 -rotate-6 animate-in fade-in slide-in-from-left-4 duration-700">
              <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Campaña</p>
              <p className="text-xs font-black text-slate-800"><i className="fa-solid fa-check text-green-500 mr-1"></i>6 piezas listas</p>
            </div>
            <div className="hidden sm:block absolute -right-2 bottom-10 bg-white rounded-2xl shadow-xl shadow-slate-300/40 border border-slate-100 px-4 py-3 rotate-6 animate-in fade-in slide-in-from-right-4 duration-700">
              <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Reel</p>
              <p className="text-xs font-black text-purple-600"><i className="fa-solid fa-film mr-1"></i>Exportado</p>
            </div>
          </div>
        </div>
      </section>

      {/* Beneficio / Problema */}
      <section className="max-w-4xl mx-auto px-5 sm:px-8 py-12 text-center space-y-3">
        <h2 className="font-display text-2xl sm:text-3xl text-slate-900">Dejá de elegir entre tiempo, plata o calidad</h2>
        <p className="text-slate-500 text-sm sm:text-base font-medium max-w-2xl mx-auto leading-relaxed">
          Contratar una agencia es caro. Hacerlo vos lleva horas y no siempre queda bien. Gomall Studio te da contenido de nivel agencia, en minutos y manteniendo tu identidad de marca.
        </p>
      </section>

      {/* Cómo funciona */}
      <section className="max-w-5xl mx-auto px-5 sm:px-8 py-12">
        <div className="text-center mb-10 space-y-2">
          <span className="text-[11px] font-black text-[#EA5B25] uppercase tracking-[0.2em]">Cómo funciona</span>
          <h2 className="font-display text-2xl sm:text-3xl text-slate-900">En 3 pasos</h2>
        </div>
        <div className="grid sm:grid-cols-3 gap-5">
          {STEPS.map((s) => (
            <div key={s.n} className="bg-white rounded-[28px] border border-slate-100 p-6 shadow-sm shadow-slate-200/40 text-center space-y-3">
              <div className="w-14 h-14 mx-auto rounded-2xl bg-gradient-to-br from-[#EA5B25] to-[#f0814f] text-white flex items-center justify-center shadow-lg shadow-orange-200/50 relative">
                <i className={`fa-solid ${s.icon} text-lg`}></i>
                <span className="absolute -top-2 -right-2 w-6 h-6 rounded-full bg-white border border-orange-100 text-[#EA5B25] text-[11px] font-black flex items-center justify-center shadow-sm">{s.n}</span>
              </div>
              <h3 className="font-display text-lg text-slate-900">{s.title}</h3>
              <p className="text-slate-500 text-sm font-medium leading-relaxed">{s.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Features */}
      <section className="max-w-5xl mx-auto px-5 sm:px-8 py-12">
        <div className="text-center mb-10 space-y-2">
          <span className="text-[11px] font-black text-[#EA5B25] uppercase tracking-[0.2em]">Todo en un solo lugar</span>
          <h2 className="font-display text-2xl sm:text-3xl text-slate-900">Lo que podés hacer</h2>
        </div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {FEATURES.map((f) => (
            <div key={f.title} className="bg-white rounded-[24px] border border-slate-100 p-6 shadow-sm shadow-slate-200/40 hover:shadow-md hover:-translate-y-0.5 transition-all">
              <div className={`w-12 h-12 rounded-2xl flex items-center justify-center ${f.color} mb-4`}><i className={`fa-solid ${f.icon} text-lg`}></i></div>
              <h3 className="font-black text-slate-900 text-base">{f.title}</h3>
              <p className="text-slate-500 text-sm font-medium leading-relaxed mt-1.5">{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* CTA final */}
      <section className="max-w-4xl mx-auto px-5 sm:px-8 py-12">
        <div className="relative overflow-hidden bg-gradient-to-br from-[#EA5B25] to-[#f0814f] rounded-[36px] p-10 sm:p-14 text-center shadow-2xl shadow-orange-300/40">
          <div className="absolute top-[-30%] right-[-10%] w-[40%] aspect-square bg-white/10 rounded-full blur-3xl" />
          <div className="relative space-y-5">
            <h2 className="font-display text-2xl sm:text-4xl text-white leading-tight">Empezá a crear contenido<br />profesional hoy</h2>
            <p className="text-white/85 text-sm sm:text-base font-medium max-w-md mx-auto">Configurás tu marca una vez y la IA hace el resto. Gratis para empezar.</p>
            <div className="flex justify-center pt-2">
              <button onClick={onLogin} className="h-14 px-8 rounded-2xl bg-white text-[#EA5B25] flex items-center gap-3 font-black text-[12px] uppercase tracking-[0.15em] shadow-xl active:scale-95 hover:shadow-2xl transition-all">
                <i className="fa-solid fa-arrow-right-to-bracket"></i>
                Empezar gratis
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-slate-100 py-8 text-center">
        <div className="flex items-center justify-center gap-2 mb-2">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-[#EA5B25] to-[#f0814f] text-white flex items-center justify-center text-xs"><i className="fa-solid fa-wand-magic-sparkles"></i></div>
          <span className="font-display text-sm text-slate-700">Gomall Studio</span>
        </div>
        <p className="text-[11px] text-slate-400 font-medium">Creá el marketing de tu negocio con IA.</p>
      </footer>
    </div>
  );
};

export default Landing;
