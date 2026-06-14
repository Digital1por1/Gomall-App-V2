import React, { useState } from 'react';
import firebase from 'firebase/compat/app';
import 'firebase/compat/firestore';
import { UserProfile, PlannedPost } from '../types';

interface CalendarStudioProps {
  profile: UserProfile | null;
  userId: string;
  onClose: () => void;
  onCreateCampaign: (prefill: { keyMessage: string; dates: string }) => void;
}

interface CommercialDate {
  label: string;
  emoji: string;
  rubros?: string[]; // si está vacío, es general
  resolve: (year: number) => Date;
}

const fixed = (m: number, d: number) => (year: number) => new Date(year, m - 1, d);
// n-ésimo día de semana (0=dom) de un mes (m: 1-12)
const nthWeekday = (m: number, weekday: number, n: number) => (year: number) => {
  const first = new Date(year, m - 1, 1);
  const offset = (weekday - first.getDay() + 7) % 7;
  return new Date(year, m - 1, 1 + offset + (n - 1) * 7);
};

const COMMERCIAL_DATES: CommercialDate[] = [
  { label: 'Año Nuevo', emoji: '🎉', resolve: fixed(1, 1) },
  { label: 'San Valentín', emoji: '💝', rubros: ['Gastronomía', 'Joyería y Accesorios', 'Moda y Vestimenta', 'Belleza y Estética'], resolve: fixed(2, 14) },
  { label: 'Día de la Mujer', emoji: '💜', resolve: fixed(3, 8) },
  { label: 'Día del Libro', emoji: '📚', rubros: ['Educación'], resolve: fixed(4, 23) },
  { label: 'Día del Trabajador', emoji: '🛠️', resolve: fixed(5, 1) },
  { label: 'Día de la Madre', emoji: '💐', rubros: ['Moda y Vestimenta', 'Belleza y Estética', 'Joyería y Accesorios', 'Gastronomía'], resolve: nthWeekday(10, 0, 3) },
  { label: 'Día del Padre', emoji: '👔', rubros: ['Moda y Vestimenta', 'Gastronomía', 'Tecnología'], resolve: nthWeekday(6, 0, 3) },
  { label: 'Día del Niño', emoji: '🧸', resolve: nthWeekday(8, 0, 3) },
  { label: 'Día del Amigo', emoji: '🤝', rubros: ['Gastronomía', 'Entretenimiento'], resolve: fixed(7, 20) },
  { label: 'Día del Estudiante / Primavera', emoji: '🌸', resolve: fixed(9, 21) },
  { label: 'Black Friday', emoji: '🛍️', resolve: nthWeekday(11, 5, 4) },
  { label: 'Navidad', emoji: '🎄', resolve: fixed(12, 25) },
  { label: 'Fin de Año', emoji: '🎆', resolve: fixed(12, 31) },
];

const MONTHS = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
const DOW = ['D', 'L', 'M', 'M', 'J', 'V', 'S'];

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const CalendarStudio: React.FC<CalendarStudioProps> = ({ profile, userId, onClose, onCreateCampaign }) => {
  const today = new Date();
  const [viewYear, setViewYear] = useState(today.getFullYear());
  const [viewMonth, setViewMonth] = useState(today.getMonth()); // 0-11
  const [planning, setPlanning] = useState<string | null>(null); // fecha iso para la que se planifica
  const [planText, setPlanText] = useState('');

  const planned = profile?.plannedPosts || [];
  const rubro = profile?.industry || '';

  // Mapa de fechas comerciales del mes visible
  const monthCommercial: Record<string, CommercialDate> = {};
  COMMERCIAL_DATES.forEach(cd => {
    const d = cd.resolve(viewYear);
    if (d.getMonth() === viewMonth) monthCommercial[iso(d)] = cd;
  });

  // Próximas fechas comerciales relevantes (siguientes ~90 días)
  const upcoming = COMMERCIAL_DATES
    .map(cd => {
      let d = cd.resolve(today.getFullYear());
      if (d < new Date(today.getFullYear(), today.getMonth(), today.getDate())) d = cd.resolve(today.getFullYear() + 1);
      return { cd, d };
    })
    .filter(({ cd, d }) => {
      const days = (d.getTime() - today.getTime()) / 86400000;
      const relevant = !cd.rubros || cd.rubros.length === 0 || (rubro && cd.rubros.includes(rubro));
      return days <= 120 && relevant;
    })
    .sort((a, b) => a.d.getTime() - b.d.getTime())
    .slice(0, 6);

  const savePlanned = async (next: PlannedPost[]) => {
    try { await firebase.firestore().collection('profiles').doc(userId).update({ plannedPosts: next }); }
    catch { alert('No se pudo guardar la planificación.'); }
  };

  const addPlan = async (date: string) => {
    if (!planText.trim()) { setPlanning(null); return; }
    const post: PlannedPost = { id: `pp_${Date.now()}`, date, title: planText.trim() };
    await savePlanned([...planned, post]);
    setPlanText('');
    setPlanning(null);
  };
  const toggleDone = async (id: string) => savePlanned(planned.map(p => p.id === id ? { ...p, done: !p.done } : p));
  const removePlan = async (id: string) => savePlanned(planned.filter(p => p.id !== id));

  const prevMonth = () => { if (viewMonth === 0) { setViewMonth(11); setViewYear(viewYear - 1); } else setViewMonth(viewMonth - 1); };
  const nextMonth = () => { if (viewMonth === 11) { setViewMonth(0); setViewYear(viewYear + 1); } else setViewMonth(viewMonth + 1); };

  // Construcción de la grilla
  const firstDay = new Date(viewYear, viewMonth, 1).getDay();
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const cells: (number | null)[] = [...Array(firstDay).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => i + 1)];
  while (cells.length % 7 !== 0) cells.push(null);

  const fmtDate = (d: Date) => `${d.getDate()} de ${MONTHS[d.getMonth()]}`;

  return (
    <div className="fixed inset-0 z-[90] bg-gradient-to-b from-[#FBFBFD] to-[#F4F5F8] flex flex-col animate-in fade-in duration-300">
      <header className="h-20 bg-white/80 backdrop-blur-xl border-b border-slate-100 flex items-center justify-between px-5 sm:px-8 shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 bg-gradient-to-br from-sky-500 to-blue-500 text-white rounded-2xl flex items-center justify-center shadow-lg shadow-sky-200/50"><i className="fa-solid fa-calendar-days text-lg"></i></div>
          <div>
            <h2 className="font-display text-xl text-slate-900 tracking-tight leading-none">Calendario</h2>
            <span className="text-[9px] font-black text-slate-400 uppercase tracking-[0.2em]">Qué publicar y cuándo</span>
          </div>
        </div>
        <button onClick={onClose} className="h-11 px-4 flex items-center gap-2 bg-slate-100 text-slate-500 rounded-2xl hover:bg-slate-200 transition-all active:scale-95 text-[10px] font-black uppercase tracking-widest"><i className="fa-solid fa-arrow-left"></i> Volver</button>
      </header>

      <div className="flex-1 overflow-y-auto p-5 sm:p-8">
        <div className="max-w-3xl mx-auto space-y-6">

          {/* Próximas fechas */}
          <section className="bg-white rounded-[28px] border border-slate-100 p-6 shadow-sm shadow-slate-200/40 space-y-4">
            <h3 className="text-[11px] font-black text-slate-900 uppercase tracking-[0.2em] flex items-center gap-2"><i className="fa-solid fa-bolt text-amber-400"></i> Próximas oportunidades para tu rubro</h3>
            <div className="space-y-2">
              {upcoming.length === 0 && <p className="text-xs text-slate-400 font-medium">No hay fechas próximas destacadas.</p>}
              {upcoming.map(({ cd, d }) => (
                <div key={cd.label} className="flex items-center gap-3 bg-slate-50 rounded-2xl border border-slate-100 p-3">
                  <span className="text-2xl shrink-0">{cd.emoji}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-black text-slate-800 truncate">{cd.label}</p>
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">{fmtDate(d)}</p>
                  </div>
                  <button onClick={() => onCreateCampaign({ keyMessage: `Campaña por ${cd.label}`, dates: fmtDate(d) })} className="px-3 py-2 bg-[#EA5B25] text-white rounded-xl text-[9px] font-black uppercase tracking-widest shadow-md shadow-orange-200/50 active:scale-95 transition-all shrink-0"><i className="fa-solid fa-wand-magic-sparkles mr-1"></i>Crear campaña</button>
                </div>
              ))}
            </div>
          </section>

          {/* Grilla mensual */}
          <section className="bg-white rounded-[28px] border border-slate-100 p-6 shadow-sm shadow-slate-200/40 space-y-4">
            <div className="flex items-center justify-between">
              <button onClick={prevMonth} className="w-9 h-9 rounded-xl bg-slate-50 text-slate-400 hover:text-slate-700 transition-all flex items-center justify-center"><i className="fa-solid fa-chevron-left"></i></button>
              <h3 className="text-sm font-black text-slate-900 uppercase tracking-widest">{MONTHS[viewMonth]} {viewYear}</h3>
              <button onClick={nextMonth} className="w-9 h-9 rounded-xl bg-slate-50 text-slate-400 hover:text-slate-700 transition-all flex items-center justify-center"><i className="fa-solid fa-chevron-right"></i></button>
            </div>
            <div className="grid grid-cols-7 gap-1.5">
              {DOW.map((d, i) => <div key={i} className="text-center text-[9px] font-black text-slate-300 uppercase py-1">{d}</div>)}
              {cells.map((day, idx) => {
                if (day === null) return <div key={idx} />;
                const dateIso = `${viewYear}-${String(viewMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                const com = monthCommercial[dateIso];
                const dayPlans = planned.filter(p => p.date === dateIso);
                const isToday = dateIso === iso(today);
                return (
                  <button key={idx} onClick={() => { setPlanning(dateIso); setPlanText(''); }} className={`aspect-square rounded-xl border p-1 flex flex-col items-center justify-start gap-0.5 transition-all hover:border-[#EA5B25] ${isToday ? 'border-[#EA5B25] bg-orange-50' : 'border-slate-100 bg-slate-50/50'}`}>
                    <span className={`text-[11px] font-black ${isToday ? 'text-[#EA5B25]' : 'text-slate-600'}`}>{day}</span>
                    {com && <span className="text-sm leading-none" title={com.label}>{com.emoji}</span>}
                    {dayPlans.length > 0 && <span className="w-1.5 h-1.5 rounded-full bg-sky-500" />}
                  </button>
                );
              })}
            </div>
            <p className="text-[9px] text-slate-300 font-bold text-center">Tocá un día para planificar un post. Los emojis marcan fechas comerciales.</p>
          </section>

          {/* Planificador del día seleccionado */}
          {planning && (
            <section className="bg-white rounded-[28px] border border-[#EA5B25]/30 p-6 shadow-lg shadow-orange-100/40 space-y-3 animate-in fade-in slide-in-from-bottom-2">
              <div className="flex items-center justify-between">
                <h3 className="text-[11px] font-black text-slate-900 uppercase tracking-[0.2em]">Planificar — {planning.split('-').reverse().join('/')}</h3>
                <button onClick={() => setPlanning(null)} className="text-slate-300 hover:text-slate-600 text-sm"><i className="fa-solid fa-xmark"></i></button>
              </div>
              {monthCommercial[planning] && (
                <p className="text-xs text-slate-500 font-medium bg-amber-50 rounded-xl px-3 py-2 border border-amber-100">{monthCommercial[planning].emoji} {monthCommercial[planning].label} — buena fecha para una campaña.</p>
              )}
              <div className="flex gap-2">
                <input autoFocus value={planText} onChange={(e) => setPlanText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') addPlan(planning); }} placeholder="Ej: Promo 2x1, lanzamiento, sorteo..." className="flex-1 bg-slate-50 border border-slate-100 rounded-xl px-3 py-2.5 text-sm font-bold outline-none focus:ring-2 focus:ring-orange-100" />
                <button onClick={() => addPlan(planning)} className="px-4 bg-[#EA5B25] text-white rounded-xl text-[10px] font-black uppercase tracking-widest active:scale-95 transition-all">Agregar</button>
              </div>
            </section>
          )}

          {/* Lista de planificados */}
          {planned.length > 0 && (
            <section className="bg-white rounded-[28px] border border-slate-100 p-6 shadow-sm shadow-slate-200/40 space-y-3">
              <h3 className="text-[11px] font-black text-slate-900 uppercase tracking-[0.2em] flex items-center gap-2"><i className="fa-solid fa-list-check text-sky-500"></i> Tus posts planificados</h3>
              <div className="space-y-2">
                {[...planned].sort((a, b) => a.date.localeCompare(b.date)).map(p => (
                  <div key={p.id} className="flex items-center gap-3 bg-slate-50 rounded-2xl border border-slate-100 p-3">
                    <button onClick={() => toggleDone(p.id)} className={`w-6 h-6 rounded-lg border-2 flex items-center justify-center shrink-0 transition-all ${p.done ? 'bg-green-500 border-green-500 text-white' : 'border-slate-200 text-transparent'}`}><i className="fa-solid fa-check text-[10px]"></i></button>
                    <div className="flex-1 min-w-0">
                      <p className={`text-sm font-bold truncate ${p.done ? 'text-slate-300 line-through' : 'text-slate-700'}`}>{p.title}</p>
                      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">{p.date.split('-').reverse().join('/')}</p>
                    </div>
                    <button onClick={() => removePlan(p.id)} className="text-slate-300 hover:text-red-500 transition-colors shrink-0 px-1"><i className="fa-solid fa-trash text-xs"></i></button>
                  </div>
                ))}
              </div>
            </section>
          )}

        </div>
      </div>
    </div>
  );
};

export default CalendarStudio;
