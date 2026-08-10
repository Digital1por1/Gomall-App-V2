import React, { useState, useEffect, useRef } from 'react';
import firebase from 'firebase/compat/app';
import 'firebase/compat/firestore';
import { UserProfile } from '../types';
import { MONTHLY_TOKEN_LIMIT } from '../App';
import { PLANS, planForProfile, IMAGE_COST, tokensToImages } from './plans';

interface AdminDashboardProps {
  onClose: () => void;
}

interface UserWithId extends UserProfile {
  id: string;
  designCount?: number;
}

// Modal de confirmación propio (reemplaza window.confirm). Si requireText está
// presente, el botón se habilita solo cuando el usuario tipea ese texto exacto.
interface ConfirmState {
  title: string;
  body: React.ReactNode;
  confirmLabel: string;
  danger?: boolean;
  requireText?: string;
  onConfirm: () => void;
}

const AdminDashboard: React.FC<AdminDashboardProps> = ({ onClose }) => {
  const [users, setUsers] = useState<UserWithId[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [mallFilter, setMallFilter] = useState<string>('todos');
  const [sortConfig, setSortConfig] = useState<{ key: 'name' | 'mall' | 'usage' | 'cost' | 'lastUsed' | 'designs' | 'expires', direction: 'asc' | 'desc' }>({ key: 'usage', direction: 'desc' });
  const [editingLimit, setEditingLimit] = useState<{ id: string; value: string } | null>(null);
  const editInputRef = useRef<HTMLInputElement>(null);
  // Menú de acciones por fila (dropdown de posición fija para que no lo corte el scroll de la tabla).
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const [confirmText, setConfirmText] = useState('');
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [toast, setToast] = useState<{ msg: string; kind: 'error' | 'ok' } | null>(null);
  const toastTimer = useRef<number | null>(null);

  const showToast = (msg: string, kind: 'error' | 'ok' = 'error') => {
    setToast({ msg, kind });
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 4200);
  };

  const [stats, setStats] = useState({
    totalUsers: 0,
    activeUsers: 0,
    totalTokens: 0,
    totalCost: 0,
  });

  interface MonthlyCost {
    label: string;
    year: number;
    month: number;
    costUsd: number;
    cycleCount: number;
  }
  const [monthlyCosts, setMonthlyCosts] = useState<MonthlyCost[]>([]);
  const [realUsage, setRealUsage] = useState<{ totalTokens: number; imageCalls: number; byAction: Record<string, { calls: number; tokens: number }> }>({ totalTokens: 0, imageCalls: 0, byAction: {} });

  useEffect(() => {
    const fetchUsers = async () => {
      try {
        const snapshot = await firebase.firestore().collection('profiles').get();
        const usersData: UserWithId[] = [];
        let totalTokens = 0;
        let activeUsers = 0;

        // Consumo REAL (usageStats) agregado de todos los clientes
        const IMG_ACTIONS = ['imagen', 'mejorar', 'producto', 'imagen_simple'];
        const META_KEYS = ['totalTokens', 'totalCalls', 'lastUpdated'];
        const realByAction: Record<string, { calls: number; tokens: number }> = {};
        let realTotal = 0;
        let imageCalls = 0;

        snapshot.forEach((doc) => {
          const data = doc.data() as UserProfile;
          usersData.push({ id: doc.id, ...data });
          const tokensUsed = data.usage?.tokensUsed || 0;
          totalTokens += tokensUsed;
          if (tokensUsed > 0) activeUsers++;

          const us = (data.usageStats || {}) as any;
          Object.keys(us).forEach((k) => {
            if (META_KEYS.includes(k)) return;
            const calls = us[k]?.calls || 0;
            const tokens = us[k]?.tokens || 0;
            if (!realByAction[k]) realByAction[k] = { calls: 0, tokens: 0 };
            realByAction[k].calls += calls;
            realByAction[k].tokens += tokens;
            realTotal += tokens;
            if (IMG_ACTIONS.includes(k)) imageCalls += calls;
          });
        });
        setRealUsage({ totalTokens: realTotal, imageCalls, byAction: realByAction });

        // Fetch design counts in parallel
        const designCounts = await Promise.all(
          usersData.map(u =>
            firebase.firestore().collection('usuarios').doc(u.id).collection('disenos').get()
              .then(s => s.size)
              .catch(() => 0)
          )
        );
        usersData.forEach((u, i) => { u.designCount = designCounts[i]; });

        usersData.sort((a, b) => (b.usage?.tokensUsed || 0) - (a.usage?.tokensUsed || 0));

        setUsers(usersData);
        setStats({
          totalUsers: usersData.length,
          activeUsers,
          totalTokens,
          totalCost: totalTokens * 0.000005,
        });

        // Fetch historial de todos los usuarios
        const allHistorial = await Promise.all(
          usersData.map(u =>
            firebase.firestore().collection('profiles').doc(u.id).collection('historial').get()
              .then(s => s.docs.map(d => d.data()))
              .catch(() => [])
          )
        );

        // Agrupar por año-mes
        const byMonth: Record<string, MonthlyCost> = {};
        allHistorial.flat().forEach((h: any) => {
          const key = `${h.year}-${String(h.month).padStart(2, '0')}`;
          if (!byMonth[key]) {
            const date = new Date(h.year, h.month - 1);
            byMonth[key] = {
              label: date.toLocaleDateString('es-AR', { month: 'long', year: 'numeric' }),
              year: h.year,
              month: h.month,
              costUsd: 0,
              cycleCount: 0,
            };
          }
          byMonth[key].costUsd += h.costUsd || 0;
          byMonth[key].cycleCount += 1;
        });

        const sorted = Object.values(byMonth).sort((a, b) =>
          b.year !== a.year ? b.year - a.year : b.month - a.month
        );
        setMonthlyCosts(sorted);
      } catch (error) {
        console.error("Error fetching users:", error);
      } finally {
        setLoading(false);
      }
    };

    fetchUsers();
  }, []);

  useEffect(() => {
    if (editingLimit && editInputRef.current) {
      editInputRef.current.focus();
      editInputRef.current.select();
    }
  }, [editingLimit]);

  // Cerrar modal con Escape
  useEffect(() => {
    if (!confirm) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { setConfirm(null); setConfirmText(''); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [confirm]);

  const handleSetPlan = async (userId: string, planId: string) => {
    const plan = PLANS.find(p => p.id === planId);
    if (!plan) return;
    try {
      await firebase.firestore().collection('profiles').doc(userId).update({ plan: plan.id, tokenLimit: plan.credits });
      setUsers(users.map(u => u.id === userId ? { ...u, plan: plan.id, tokenLimit: plan.credits } : u));
    } catch (error) {
      console.error("Error updating plan:", error);
      showToast("No se pudo cambiar el plan. Probá de nuevo.");
    }
  };

  const handleUpdateLimit = async (userId: string, newLimit: number) => {
    if (isNaN(newLimit) || newLimit <= 0) return;
    try {
      await firebase.firestore().collection('profiles').doc(userId).update({ tokenLimit: newLimit });
      setUsers(users.map(u => u.id === userId ? { ...u, tokenLimit: newLimit } : u));
      setEditingLimit(null);
      showToast("Límite actualizado.", 'ok');
    } catch (error) {
      console.error("Error updating limit:", error);
      showToast("No se pudo actualizar el límite.");
    }
  };

  const performResetTokens = async (userId: string) => {
    const user = users.find(u => u.id === userId);
    const cycleTokens = user?.usage?.tokensUsed || 0;
    const lastReset = user?.usage?.lastReset || Date.now();
    const now = Date.now();
    const cycleStart = new Date(lastReset);
    try {
      // Guardar snapshot antes de resetear
      if (cycleTokens > 0) {
        await firebase.firestore().collection('profiles').doc(userId).collection('historial').add({
          tokensUsed: cycleTokens,
          costUsd: cycleTokens * 0.000005,
          cycleStart: lastReset,
          cycleEnd: now,
          month: cycleStart.getMonth() + 1,
          year: cycleStart.getFullYear(),
        });
      }
      await firebase.firestore().collection('profiles').doc(userId).update({
        'usage.tokensUsed': 0,
        'usage.lastReset': now,
      });
      setUsers(users.map(u => u.id === userId ? { ...u, usage: { ...u.usage!, tokensUsed: 0, lastReset: now } } : u));
      setStats(prev => ({ ...prev, totalTokens: prev.totalTokens - cycleTokens, totalCost: (prev.totalTokens - cycleTokens) * 0.000005 }));
      showToast("Consumo reiniciado. El ciclo quedó guardado en el historial.", 'ok');
    } catch (error) {
      showToast("No se pudo reiniciar el consumo.");
    }
  };

  const handleResetTokens = (userId: string) => {
    const u = users.find(x => x.id === userId);
    setConfirm({
      title: 'Reiniciar consumo',
      body: <>El consumo actual de <strong className="text-slate-900">{u?.business || u?.name}</strong> se guarda en el historial y vuelve a 0. El ciclo se renueva desde hoy.</>,
      confirmLabel: 'Reiniciar consumo',
      onConfirm: () => performResetTokens(userId),
    });
  };

  const performToggleBlock = async (userId: string, isBlocked: boolean) => {
    try {
      await firebase.firestore().collection('profiles').doc(userId).update({ isBlocked: !isBlocked });
      setUsers(users.map(u => u.id === userId ? { ...u, isBlocked: !isBlocked } : u));
    } catch (error) {
      showToast("No se pudo cambiar el estado de bloqueo.");
    }
  };

  const handleToggleBlock = (userId: string, isBlocked: boolean) => {
    const u = users.find(x => x.id === userId);
    const name = u?.business || u?.name || 'este usuario';
    setConfirm({
      title: isBlocked ? 'Desbloquear cuenta' : 'Bloquear cuenta',
      body: isBlocked
        ? <><strong className="text-slate-900">{name}</strong> vuelve a tener acceso completo a la plataforma.</>
        : <><strong className="text-slate-900">{name}</strong> no va a poder generar contenido ni acceder a sus diseños hasta que lo desbloquees.</>,
      confirmLabel: isBlocked ? 'Desbloquear' : 'Bloquear cuenta',
      danger: !isBlocked,
      onConfirm: () => performToggleBlock(userId, isBlocked),
    });
  };

  const performDeleteUser = async (userId: string) => {
    const u = users.find(x => x.id === userId);
    try {
      const res = await fetch('/api/admin/delete-user', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uid: userId, email: u?.email }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) throw new Error(data?.error || 'No se pudo eliminar la cuenta.');
      setUsers(prev => prev.filter(x => x.id !== userId));
      setStats(prev => ({ ...prev, totalUsers: prev.totalUsers - 1 }));
      showToast("Cuenta eliminada.", 'ok');
    } catch (error: any) {
      showToast(error?.message || "No se pudo eliminar la cuenta.");
    }
  };

  const handleDeleteUser = (userId: string, name: string) => {
    setConfirm({
      title: 'Eliminar cuenta definitivamente',
      body: <>Se borra el acceso, el perfil, los diseños y los archivos de <strong className="text-slate-900">{name}</strong>. Esta acción no se puede deshacer.</>,
      confirmLabel: 'Eliminar cuenta',
      danger: true,
      requireText: name,
      onConfirm: () => performDeleteUser(userId),
    });
  };

  const handleExportCSV = () => {
    const getNextReset = (lastReset?: number) => {
      if (!lastReset) return null;
      const d = new Date(lastReset);
      d.setMonth(d.getMonth() + 1);
      return d;
    };
    const headers = ['Comercio', 'Nombre', 'Email', 'Mall', 'Tipo', 'Tokens Usados', 'Límite', '% Uso', 'Costo USD', 'Diseños', 'Último Uso', 'Vence', 'Estado'];
    const rows = users.map(u => {
      const limit = u.tokenLimit || MONTHLY_TOKEN_LIMIT;
      const used = u.usage?.tokensUsed || 0;
      const percent = Math.min(100, Math.round((used / limit) * 100));
      return [
        u.business || '',
        u.name || '',
        u.email || '',
        u.mall || '',
        u.type || '',
        used,
        limit,
        `${percent}%`,
        `$${(used * 0.000005).toFixed(4)}`,
        u.designCount || 0,
        u.usage?.lastUsed ? new Date(u.usage.lastUsed).toLocaleDateString('es-AR') : 'N/A',
        getNextReset(u.usage?.lastReset)?.toLocaleDateString('es-AR') || 'N/A',
        u.isBlocked ? 'Bloqueado' : 'Activo',
      ];
    });

    const csv = [headers, ...rows].map(r => r.map(v => `"${v}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `gomall-usuarios-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const uniqueMalls = ['todos', ...Array.from(new Set(users.map(u => u.mall).filter(Boolean)))];

  const handleSort = (key: typeof sortConfig.key) => {
    setSortConfig(prev => ({
      key,
      direction: prev.key === key && prev.direction === 'desc' ? 'asc' : 'desc'
    }));
  };

  const SortIcon = ({ col }: { col: typeof sortConfig.key }) => {
    if (sortConfig.key !== col) return <i className="fa-solid fa-angles-up-down text-slate-300 ml-1.5 text-[8px]"></i>;
    return sortConfig.direction === 'desc'
      ? <i className="fa-solid fa-angle-down text-[#EA5B25] ml-1.5 text-[9px]"></i>
      : <i className="fa-solid fa-angle-up text-[#EA5B25] ml-1.5 text-[9px]"></i>;
  };

  const filteredUsers = users
    .filter(u => {
      const matchesSearch =
        (u.name?.toLowerCase() || '').includes(searchTerm.toLowerCase()) ||
        (u.business?.toLowerCase() || '').includes(searchTerm.toLowerCase()) ||
        (u.email?.toLowerCase() || '').includes(searchTerm.toLowerCase());
      const matchesMall = mallFilter === 'todos' || u.mall === mallFilter;
      return matchesSearch && matchesMall;
    })
    .sort((a, b) => {
      const dir = sortConfig.direction === 'desc' ? -1 : 1;
      switch (sortConfig.key) {
        case 'name':    return dir * ((a.business || a.name || '').localeCompare(b.business || b.name || ''));
        case 'mall':    return dir * ((a.mall || '').localeCompare(b.mall || ''));
        case 'usage':
        case 'cost':    return dir * ((a.usage?.tokensUsed || 0) - (b.usage?.tokensUsed || 0));
        case 'lastUsed': return dir * ((a.usage?.lastUsed || 0) - (b.usage?.lastUsed || 0));
        case 'designs': return dir * ((a.designCount || 0) - (b.designCount || 0));
        case 'expires': {
          const getExp = (u: UserWithId) => u.usage?.lastReset ? new Date(u.usage.lastReset).setMonth(new Date(u.usage.lastReset).getMonth() + 1) : 0;
          return dir * (getExp(a) - getExp(b));
        }
        default:        return 0;
      }
    });

  // ————— Skeleton de carga (misma estructura que el panel real) —————
  if (loading) {
    return (
      <div className="flex-1 flex flex-col bg-[#F6F7F9] h-full absolute inset-0 z-[200] overflow-hidden">
        <header className="h-16 bg-white/90 border-b border-slate-200/70 flex items-center justify-between px-6 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-slate-200 rounded-lg animate-pulse"></div>
            <div className="h-4 w-44 bg-slate-200 rounded animate-pulse"></div>
          </div>
          <div className="h-9 w-32 bg-slate-100 rounded-lg animate-pulse"></div>
        </header>
        <main className="p-6 md:p-10 max-w-6xl mx-auto w-full space-y-6">
          <div className="bg-white rounded-2xl border border-slate-200/70 grid grid-cols-2 md:grid-cols-4 divide-x divide-slate-100">
            {[0, 1, 2, 3].map(i => (
              <div key={i} className="p-5 space-y-3">
                <div className="h-3 w-24 bg-slate-100 rounded animate-pulse"></div>
                <div className="h-7 w-16 bg-slate-200 rounded animate-pulse"></div>
              </div>
            ))}
          </div>
          <div className="bg-white rounded-2xl border border-slate-200/70 p-6 space-y-4">
            <div className="h-4 w-40 bg-slate-200 rounded animate-pulse"></div>
            {[0, 1, 2, 3, 4].map(i => (
              <div key={i} className="flex items-center gap-4">
                <div className="w-9 h-9 bg-slate-100 rounded-xl animate-pulse shrink-0"></div>
                <div className="flex-1 space-y-2">
                  <div className="h-3 bg-slate-100 rounded animate-pulse" style={{ width: `${72 - i * 9}%` }}></div>
                  <div className="h-2 bg-slate-50 rounded animate-pulse" style={{ width: `${50 - i * 6}%` }}></div>
                </div>
              </div>
            ))}
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col bg-[#F6F7F9] h-full absolute inset-0 z-[200] overflow-y-auto">
      <style>{`
        @keyframes adminPop { from { opacity: 0; transform: translateY(4px) scale(0.98); } to { opacity: 1; transform: translateY(0) scale(1); } }
        @keyframes adminToast { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes adminOverlay { from { opacity: 0; } to { opacity: 1; } }
      `}</style>

      {/* Barra superior */}
      <header className="h-16 bg-white/90 backdrop-blur-xl border-b border-slate-200/70 flex items-center justify-between px-6 shrink-0 sticky top-0 z-10">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-slate-900 text-white rounded-lg flex items-center justify-center">
            <i className="fa-solid fa-shield-halved text-sm"></i>
          </div>
          <div className="flex items-baseline gap-2.5">
            <h1 className="font-display text-lg text-slate-900 tracking-tight leading-none">Administración</h1>
            <span className="text-[11px] font-medium text-slate-400 hidden sm:inline">Gomall Studio</span>
          </div>
        </div>
        <button
          onClick={onClose}
          className="h-9 px-4 flex items-center gap-2 text-slate-600 border border-slate-200 bg-white rounded-lg hover:bg-slate-50 hover:border-slate-300 transition-all duration-200 active:scale-[0.98] text-xs font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-300"
        >
          <i className="fa-solid fa-arrow-left text-[10px]"></i> Volver al editor
        </button>
      </header>

      <main className="p-6 md:p-10 max-w-6xl mx-auto w-full space-y-6 pb-16">

        {/* Título de página */}
        <div className="flex items-end justify-between flex-wrap gap-3">
          <div>
            <h2 className="font-display text-[26px] text-slate-900 tracking-tight leading-tight" style={{ textWrap: 'balance' } as React.CSSProperties}>Resumen general</h2>
            <p className="text-[13px] text-slate-500 mt-0.5">Uso, clientes y costos de la plataforma en tiempo real.</p>
          </div>
          <span className="text-[11px] text-slate-400 font-medium tabular-nums">
            Actualizado {new Date().toLocaleDateString('es-AR', { day: '2-digit', month: 'short' })}, {new Date().toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })} hs
          </span>
        </div>

        {/* Banda de KPIs — una sola superficie dividida */}
        <div className="bg-white rounded-2xl border border-slate-200/70 shadow-[0_1px_2px_rgba(15,23,42,0.04)] grid grid-cols-2 md:grid-cols-4 divide-x divide-y md:divide-y-0 divide-slate-100 overflow-hidden">
          <div className="p-5">
            <p className="text-xs font-medium text-slate-500 mb-1.5">Clientes registrados</p>
            <p className="text-[28px] font-semibold text-slate-900 tracking-tight leading-none tabular-nums">{stats.totalUsers}</p>
            <p className="text-[11px] text-slate-400 mt-1.5 tabular-nums">{stats.activeUsers} con actividad este ciclo</p>
          </div>
          <div className="p-5">
            <p className="text-xs font-medium text-slate-500 mb-1.5">Imágenes generadas</p>
            <p className="text-[28px] font-semibold text-slate-900 tracking-tight leading-none tabular-nums">{realUsage.imageCalls.toLocaleString('es-AR')}</p>
            <p className="text-[11px] text-slate-400 mt-1.5">histórico, todos los clientes</p>
          </div>
          <div className="p-5">
            <p className="text-xs font-medium text-slate-500 mb-1.5">Tasa de activación</p>
            <p className="text-[28px] font-semibold text-slate-900 tracking-tight leading-none tabular-nums">
              {stats.totalUsers > 0 ? Math.round((stats.activeUsers / stats.totalUsers) * 100) : 0}<span className="text-lg text-slate-400 font-medium">%</span>
            </p>
            <p className="text-[11px] text-slate-400 mt-1.5">clientes que ya generaron contenido</p>
          </div>
          <div className="p-5">
            <p className="text-xs font-medium text-slate-500 mb-1.5">Costo de IA acumulado</p>
            <p className="text-[28px] font-semibold text-slate-900 tracking-tight leading-none tabular-nums">
              <span className="text-lg text-slate-400 font-medium align-baseline">US$ </span>{(realUsage.imageCalls * 0.04).toFixed(2)}
            </p>
            <p className="text-[11px] text-slate-400 mt-1.5">~US$ 0,04 por imagen generada</p>
          </div>
        </div>

        {/* Consumo real por tipo de acción */}
        <div className="bg-white rounded-2xl border border-slate-200/70 shadow-[0_1px_2px_rgba(15,23,42,0.04)] p-6">
          <div className="flex items-baseline justify-between flex-wrap gap-2 mb-5">
            <h3 className="text-[15px] font-semibold text-slate-900 tracking-tight">Consumo de IA por acción</h3>
            <span className="text-[11px] text-slate-400 font-medium">uso real registrado · todos los clientes</span>
          </div>
          {(() => {
            const LABELS: Record<string, { label: string; img: boolean }> = {
              imagen: { label: 'Imágenes', img: true },
              mejorar: { label: 'Mejorar imagen', img: true },
              producto: { label: 'Producto → Aviso', img: true },
              imagen_simple: { label: 'Imagen simple', img: true },
              campana: { label: 'Campañas', img: false },
              copy: { label: 'Copys', img: false },
              analisis_web: { label: 'Análisis de web', img: false },
            };
            const rows = Object.entries(realUsage.byAction)
              .map(([k, v]) => ({ key: k, label: LABELS[k]?.label || k, img: LABELS[k]?.img || false, calls: v.calls, tokens: v.tokens }))
              .filter(r => r.calls > 0)
              .sort((a, b) => b.calls - a.calls);
            const estCost = realUsage.imageCalls * 0.04;
            if (rows.length === 0) {
              return (
                <div className="py-8 text-center">
                  <div className="w-11 h-11 mx-auto mb-3 rounded-xl bg-slate-50 text-slate-300 flex items-center justify-center"><i className="fa-solid fa-chart-simple"></i></div>
                  <p className="text-sm text-slate-500 font-medium">Todavía no hay consumo registrado</p>
                  <p className="text-xs text-slate-400 mt-1">Los datos aparecen cuando los clientes empiezan a generar contenido.</p>
                </div>
              );
            }
            const maxCalls = Math.max(...rows.map(r => r.calls), 1);
            return (
              <div className="grid md:grid-cols-[1fr_260px] gap-8">
                <div className="space-y-3.5">
                  {rows.map(r => (
                    <div key={r.key}>
                      <div className="flex items-baseline justify-between mb-1">
                        <span className="text-[13px] font-medium text-slate-700">{r.label}</span>
                        <span className="text-[13px] font-semibold text-slate-900 tabular-nums">
                          {r.calls.toLocaleString('es-AR')} <span className="text-slate-400 font-normal text-[11px]">{r.calls === 1 ? 'uso' : 'usos'}</span>
                        </span>
                      </div>
                      <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all duration-500 ${r.img ? 'bg-[#EA5B25]' : 'bg-slate-300'}`}
                          style={{ width: `${Math.max(3, (r.calls / maxCalls) * 100)}%` }}
                        />
                      </div>
                    </div>
                  ))}
                  <div className="flex items-center gap-4 pt-1">
                    <span className="flex items-center gap-1.5 text-[11px] text-slate-400"><span className="w-2 h-2 rounded-full bg-[#EA5B25] inline-block"></span> genera imagen (con costo)</span>
                    <span className="flex items-center gap-1.5 text-[11px] text-slate-400"><span className="w-2 h-2 rounded-full bg-slate-300 inline-block"></span> solo texto (sin costo relevante)</span>
                  </div>
                </div>
                <div className="border-l border-slate-100 pl-8 md:flex flex-col justify-center hidden">
                  <p className="text-xs font-medium text-slate-500">Costo real estimado</p>
                  <p className="text-[32px] font-semibold text-slate-900 tracking-tight tabular-nums leading-tight mt-1">
                    <span className="text-base text-slate-400 font-medium">US$ </span>{estCost.toFixed(2)}
                  </p>
                  <p className="text-[11px] text-slate-400 mt-2 leading-relaxed">{realUsage.imageCalls.toLocaleString('es-AR')} imágenes a ~US$ 0,04 cada una. Las acciones de texto no tienen costo relevante.</p>
                </div>
              </div>
            );
          })()}
        </div>

        {/* Clientes */}
        <div className="bg-white rounded-2xl border border-slate-200/70 shadow-[0_1px_2px_rgba(15,23,42,0.04)] overflow-hidden">

          {/* Toolbar */}
          <div className="px-6 pt-5 pb-4 border-b border-slate-100">
            <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
              <div className="flex items-baseline gap-2">
                <h3 className="text-[15px] font-semibold text-slate-900 tracking-tight">Clientes</h3>
                <span className="text-[11px] font-semibold text-slate-400 bg-slate-100 rounded-md px-1.5 py-0.5 tabular-nums">{filteredUsers.length}</span>
              </div>
              <button
                onClick={handleExportCSV}
                className="h-9 px-3.5 flex items-center gap-2 text-slate-600 border border-slate-200 bg-white rounded-lg hover:bg-slate-50 hover:border-slate-300 transition-all duration-200 active:scale-[0.98] text-xs font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-300"
              >
                <i className="fa-solid fa-arrow-down-to-line text-[10px]"></i> Exportar CSV
              </button>
            </div>
            <div className="flex flex-col md:flex-row gap-2.5">
              <div className="relative flex-1 md:max-w-sm">
                <i className="fa-solid fa-magnifying-glass absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-300 text-xs"></i>
                <input
                  type="text"
                  placeholder="Buscar por comercio, nombre o email"
                  value={searchTerm}
                  onChange={e => setSearchTerm(e.target.value)}
                  className="w-full bg-slate-50/80 border border-slate-200/80 rounded-lg pl-9 pr-4 h-9 text-[13px] font-medium text-slate-700 placeholder:text-slate-400 outline-none transition-all duration-200 focus:bg-white focus:border-slate-300 focus:ring-4 focus:ring-slate-100"
                />
              </div>
              <select
                value={mallFilter}
                onChange={e => setMallFilter(e.target.value)}
                className="bg-slate-50/80 border border-slate-200/80 rounded-lg px-3 h-9 text-[13px] font-medium text-slate-700 outline-none cursor-pointer md:w-52 transition-all duration-200 focus:bg-white focus:border-slate-300 focus:ring-4 focus:ring-slate-100"
              >
                {uniqueMalls.map(m => (
                  <option key={m} value={m}>{m === 'todos' ? 'Todos los centros' : m}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Tabla */}
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-100">
                  <th className="px-6 py-2.5 text-[11px] font-semibold text-slate-400 cursor-pointer hover:text-slate-600 select-none transition-colors" onClick={() => handleSort('name')}>
                    Comercio <SortIcon col="name" />
                  </th>
                  <th className="px-4 py-2.5 text-[11px] font-semibold text-slate-400 cursor-pointer hover:text-slate-600 select-none transition-colors" onClick={() => handleSort('usage')}>
                    Consumo del ciclo <SortIcon col="usage" />
                  </th>
                  <th className="px-4 py-2.5 text-[11px] font-semibold text-slate-400 cursor-pointer hover:text-slate-600 select-none transition-colors" onClick={() => handleSort('lastUsed')}>
                    Actividad y plan <SortIcon col="lastUsed" />
                  </th>
                  <th className="px-6 py-2.5"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {filteredUsers.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-6 py-14 text-center">
                      <div className="w-11 h-11 mx-auto mb-3 rounded-xl bg-slate-50 text-slate-300 flex items-center justify-center"><i className="fa-solid fa-magnifying-glass"></i></div>
                      <p className="text-sm text-slate-500 font-medium">No hay resultados para esta búsqueda</p>
                      {(searchTerm || mallFilter !== 'todos') && (
                        <button
                          onClick={() => { setSearchTerm(''); setMallFilter('todos'); }}
                          className="mt-2 text-xs font-semibold text-[#EA5B25] hover:underline underline-offset-2"
                        >
                          Limpiar filtros
                        </button>
                      )}
                    </td>
                  </tr>
                ) : (
                  filteredUsers.map(u => {
                    const limit = u.tokenLimit || MONTHLY_TOKEN_LIMIT;
                    const used = u.usage?.tokensUsed || 0;
                    const percent = Math.min(100, Math.round((used / limit) * 100));
                    const isEditingThis = editingLimit?.id === u.id;

                    const expDate = u.usage?.lastReset ? (() => {
                      const d = new Date(u.usage!.lastReset);
                      d.setMonth(d.getMonth() + 1);
                      return d;
                    })() : null;
                    const daysLeft = expDate ? Math.ceil((expDate.getTime() - Date.now()) / 86400000) : null;
                    const isUrgent = daysLeft !== null && daysLeft <= 5;
                    const isSoon = daysLeft !== null && daysLeft <= 10;

                    return (
                      <tr key={u.id} className={`group transition-colors duration-150 hover:bg-slate-50/60 ${u.isBlocked ? 'opacity-45' : ''}`}>

                        {/* Comercio */}
                        <td className="px-6 py-3.5 align-top">
                          <div className="flex items-start gap-3">
                            <div className={`w-9 h-9 rounded-xl flex items-center justify-center text-white font-semibold text-sm shrink-0 mt-0.5 ${u.isBlocked ? 'bg-slate-300' : 'bg-slate-900'}`}>
                              {(u.business?.charAt(0) || u.name?.charAt(0) || '?').toUpperCase()}
                            </div>
                            <div className="min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="font-semibold text-[13px] text-slate-900 truncate">{u.business || 'Sin comercio'}</span>
                                {u.isBlocked && (
                                  <span className="flex items-center gap-1 text-[10px] font-semibold text-red-600 shrink-0">
                                    <span className="w-1.5 h-1.5 rounded-full bg-red-500 inline-block"></span> Bloqueado
                                  </span>
                                )}
                              </div>
                              <p className="text-[12px] text-slate-400 truncate mt-0.5">{u.name}{u.email ? ` · ${u.email}` : ''}</p>
                              <p className="text-[11px] text-slate-400 mt-1 flex items-center gap-2.5">
                                <span className="text-slate-500">{u.mall || 'Sin mall'}</span>
                                <span className="tabular-nums flex items-center gap-1"><i className="fa-solid fa-layer-group text-[9px] text-slate-300"></i>{u.designCount ?? 0} diseños</span>
                              </p>
                            </div>
                          </div>
                        </td>

                        {/* Consumo */}
                        <td className="px-4 py-3.5 align-top min-w-[190px]">
                          <div className="flex items-baseline justify-between mb-1.5">
                            <span className="text-[13px] font-semibold text-slate-800 tabular-nums">
                              {tokensToImages(used)} <span className="text-slate-400 font-normal text-[11px]">/ {Math.round(limit / IMAGE_COST)} img</span>
                            </span>
                            <span className={`text-[11px] font-semibold tabular-nums ${percent >= 100 ? 'text-red-600' : percent >= 80 ? 'text-amber-600' : 'text-slate-400'}`}>
                              {percent}%
                            </span>
                          </div>
                          <div className="w-full bg-slate-100 rounded-full h-1 overflow-hidden mb-2">
                            <div
                              className={`h-1 rounded-full transition-all duration-500 ${percent >= 100 ? 'bg-red-500' : percent >= 80 ? 'bg-amber-500' : 'bg-[#EA5B25]'}`}
                              style={{ width: `${percent}%` }}
                            />
                          </div>
                          <span className="text-[12px] font-medium text-slate-500 tabular-nums">
                            US$ {(tokensToImages(used) * 0.04).toFixed(2)} <span className="text-slate-300">este ciclo</span>
                          </span>
                        </td>

                        {/* Actividad y plan */}
                        <td className="px-4 py-3.5 align-top min-w-[170px]">
                          <p className="text-[12px] text-slate-500 tabular-nums">
                            <span className="text-slate-400">Último uso</span>{' '}
                            <span className="font-medium text-slate-600">
                              {u.usage?.lastUsed ? new Date(u.usage.lastUsed).toLocaleDateString('es-AR', { day: '2-digit', month: 'short' }) : '—'}
                            </span>
                          </p>
                          <p className="text-[12px] tabular-nums mt-1">
                            <span className="text-slate-400">Renueva</span>{' '}
                            {expDate ? (
                              <span className={`font-medium ${isUrgent ? 'text-red-600' : isSoon ? 'text-amber-600' : 'text-slate-600'}`}>
                                {expDate.toLocaleDateString('es-AR', { day: '2-digit', month: 'short' })} · {daysLeft! > 0 ? `${daysLeft} d` : 'vencido'}
                              </span>
                            ) : <span className="text-slate-300">—</span>}
                          </p>
                          <select
                            value={planForProfile(u.plan, u.tokenLimit)?.id || ''}
                            onChange={(e) => handleSetPlan(u.id, e.target.value)}
                            className="mt-2 text-[11px] font-semibold text-slate-600 bg-white border border-slate-200 rounded-md px-2 py-1 outline-none cursor-pointer transition-all duration-150 hover:border-slate-300 focus:ring-2 focus:ring-slate-200"
                          >
                            <option value="" disabled>Personalizado</option>
                            {PLANS.map(p => <option key={p.id} value={p.id}>{p.name} · {p.images} img</option>)}
                          </select>
                        </td>

                        {/* Acciones */}
                        <td className="px-6 py-3.5 align-top text-right">
                          {isEditingThis ? (
                            <div className="flex items-center justify-end gap-1.5">
                              <div className="relative">
                                <input
                                  ref={editInputRef}
                                  type="number"
                                  value={editingLimit.value}
                                  onChange={e => setEditingLimit({ id: u.id, value: e.target.value })}
                                  onKeyDown={e => {
                                    if (e.key === 'Enter') handleUpdateLimit(u.id, Number(editingLimit.value) * IMAGE_COST);
                                    if (e.key === 'Escape') setEditingLimit(null);
                                  }}
                                  className="w-24 bg-white border border-[#EA5B25]/50 rounded-lg pl-3 pr-8 py-1.5 text-xs font-semibold tabular-nums outline-none focus:ring-4 focus:ring-orange-100 text-right"
                                />
                                <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] font-medium text-slate-400 pointer-events-none">img</span>
                              </div>
                              <button
                                onClick={() => handleUpdateLimit(u.id, Number(editingLimit.value) * IMAGE_COST)}
                                className="w-7 h-7 rounded-lg bg-[#EA5B25] text-white flex items-center justify-center hover:bg-orange-600 transition-colors duration-150 active:scale-95"
                                title="Guardar"
                              >
                                <i className="fa-solid fa-check text-[10px]"></i>
                              </button>
                              <button
                                onClick={() => setEditingLimit(null)}
                                className="w-7 h-7 rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600 flex items-center justify-center transition-colors duration-150"
                                title="Cancelar"
                              >
                                <i className="fa-solid fa-xmark text-[10px]"></i>
                              </button>
                            </div>
                          ) : (
                            <button
                              onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); setMenu(menu?.id === u.id ? null : { id: u.id, x: r.right, y: r.bottom }); }}
                              className={`w-8 h-8 rounded-lg transition-all duration-150 flex items-center justify-center ml-auto focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-300 ${menu?.id === u.id ? 'bg-slate-900 text-white' : 'text-slate-300 group-hover:text-slate-500 hover:!bg-slate-100 hover:!text-slate-700'}`}
                              title="Acciones"
                            >
                              <i className="fa-solid fa-ellipsis text-sm"></i>
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Costo mensual histórico */}
        <div className="bg-white rounded-2xl border border-slate-200/70 shadow-[0_1px_2px_rgba(15,23,42,0.04)] p-6">
          <div className="flex items-baseline justify-between flex-wrap gap-2 mb-5">
            <h3 className="text-[15px] font-semibold text-slate-900 tracking-tight">Costo por mes</h3>
            <span className="text-[11px] text-slate-400 font-medium">historial de ciclos completados</span>
          </div>

          {monthlyCosts.length === 0 && stats.totalCost === 0 ? (
            <div className="py-8 text-center">
              <div className="w-11 h-11 mx-auto mb-3 rounded-xl bg-slate-50 text-slate-300 flex items-center justify-center"><i className="fa-solid fa-clock-rotate-left"></i></div>
              <p className="text-sm text-slate-500 font-medium">Sin historial todavía</p>
              <p className="text-xs text-slate-400 mt-1">Los datos aparecen cuando se renuevan los ciclos de los clientes.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {(() => {
                const now = new Date();
                const currentLabel = now.toLocaleDateString('es-AR', { month: 'long', year: 'numeric' });
                const maxCost = Math.max(stats.totalCost, ...monthlyCosts.map(m => m.costUsd), 0.01);
                return (
                  <>
                    <div className="flex items-center gap-4">
                      <div className="w-32 text-right shrink-0">
                        <span className="text-[12px] font-semibold text-slate-900 capitalize block leading-tight">{currentLabel}</span>
                        <span className="text-[10px] font-medium text-[#EA5B25]">ciclo en curso</span>
                      </div>
                      <div className="flex-1 bg-slate-100 rounded-full h-2 overflow-hidden">
                        <div
                          className="h-2 rounded-full bg-[#EA5B25] transition-all duration-500"
                          style={{ width: `${Math.min(100, (stats.totalCost / maxCost) * 100)}%` }}
                        />
                      </div>
                      <span className="text-[13px] font-semibold text-slate-900 w-24 text-right tabular-nums shrink-0">
                        US$ {stats.totalCost.toFixed(2)}
                      </span>
                    </div>
                    {monthlyCosts.map(m => (
                      <div key={`${m.year}-${m.month}`} className="flex items-center gap-4">
                        <div className="w-32 text-right shrink-0">
                          <span className="text-[12px] font-medium text-slate-600 capitalize block leading-tight">{m.label}</span>
                          <span className="text-[10px] text-slate-400 tabular-nums">{m.cycleCount} ciclo{m.cycleCount !== 1 ? 's' : ''}</span>
                        </div>
                        <div className="flex-1 bg-slate-100 rounded-full h-2 overflow-hidden">
                          <div
                            className="h-2 rounded-full bg-slate-300 transition-all duration-500"
                            style={{ width: `${Math.min(100, (m.costUsd / maxCost) * 100)}%` }}
                          />
                        </div>
                        <span className="text-[13px] font-medium text-slate-600 w-24 text-right tabular-nums shrink-0">
                          US$ {m.costUsd.toFixed(2)}
                        </span>
                      </div>
                    ))}
                  </>
                );
              })()}
            </div>
          )}
        </div>

      </main>

      {/* Menú de acciones de la fila (posición fija + overlay para cerrar) */}
      {menu && (() => {
        const mu = users.find(u => u.id === menu.id);
        if (!mu) return null;
        const mLimit = mu.tokenLimit || MONTHLY_TOKEN_LIMIT;
        const item = 'w-full flex items-center gap-2.5 px-3.5 py-2 text-[13px] font-medium text-left transition-colors duration-100 rounded-lg mx-auto';
        return (
          <>
            <div className="fixed inset-0 z-[290]" onClick={() => setMenu(null)} />
            <div
              className="fixed z-[300] w-56 bg-white rounded-xl ring-1 ring-slate-900/[0.07] shadow-[0_10px_38px_-10px_rgba(15,23,42,0.28)] p-1.5"
              style={{ top: menu.y + 6, left: Math.max(8, menu.x - 224), animation: 'adminPop 130ms cubic-bezier(0.16,1,0.3,1)' }}
            >
              <button onClick={() => { setEditingLimit({ id: mu.id, value: Math.round(mLimit / IMAGE_COST).toString() }); setMenu(null); }} className={`${item} text-slate-700 hover:bg-slate-50`}>
                <i className="fa-solid fa-pen-to-square text-slate-400 w-4 text-center text-xs"></i> Editar límite
              </button>
              <button onClick={() => { handleResetTokens(mu.id); setMenu(null); }} className={`${item} text-slate-700 hover:bg-slate-50`}>
                <i className="fa-solid fa-rotate-left text-slate-400 w-4 text-center text-xs"></i> Reiniciar consumo
              </button>
              <button onClick={() => { handleToggleBlock(mu.id, !!mu.isBlocked); setMenu(null); }} className={`${item} text-slate-700 hover:bg-slate-50`}>
                <i className={`fa-solid ${mu.isBlocked ? 'fa-unlock' : 'fa-lock'} text-slate-400 w-4 text-center text-xs`}></i> {mu.isBlocked ? 'Desbloquear' : 'Bloquear'}
              </button>
              <div className="h-px bg-slate-100 my-1 -mx-1.5"></div>
              <button onClick={() => { handleDeleteUser(mu.id, mu.business || mu.name); setMenu(null); }} className={`${item} text-red-600 hover:bg-red-50`}>
                <i className="fa-solid fa-trash-can text-red-400 w-4 text-center text-xs"></i> Eliminar cuenta
              </button>
            </div>
          </>
        );
      })()}

      {/* Modal de confirmación */}
      {confirm && (
        <div
          className="fixed inset-0 z-[400] flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-[2px]"
          style={{ animation: 'adminOverlay 150ms ease-out' }}
          onClick={() => { if (!confirmBusy) { setConfirm(null); setConfirmText(''); } }}
        >
          <div
            className="bg-white rounded-2xl shadow-[0_24px_70px_-20px_rgba(15,23,42,0.45)] w-full max-w-md p-6"
            style={{ animation: 'adminPop 180ms cubic-bezier(0.16,1,0.3,1)' }}
            onClick={e => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
          >
            <div className="flex items-start gap-3.5">
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${confirm.danger ? 'bg-red-50 text-red-500' : 'bg-slate-100 text-slate-500'}`}>
                <i className={`fa-solid ${confirm.danger ? 'fa-triangle-exclamation' : 'fa-circle-question'} text-sm`}></i>
              </div>
              <div className="min-w-0">
                <h4 className="text-[15px] font-semibold text-slate-900 tracking-tight">{confirm.title}</h4>
                <p className="text-[13px] text-slate-500 mt-1.5 leading-relaxed">{confirm.body}</p>
              </div>
            </div>

            {confirm.requireText && (
              <div className="mt-5">
                <label className="text-[11px] font-medium text-slate-500 block mb-1.5">
                  Para confirmar, escribí <span className="font-semibold text-slate-800 select-all">{confirm.requireText}</span>
                </label>
                <input
                  autoFocus
                  type="text"
                  value={confirmText}
                  onChange={e => setConfirmText(e.target.value)}
                  className="w-full bg-slate-50/80 border border-slate-200 rounded-lg px-3.5 h-10 text-[13px] font-medium text-slate-800 outline-none transition-all duration-200 focus:bg-white focus:border-red-300 focus:ring-4 focus:ring-red-50"
                />
              </div>
            )}

            <div className="flex items-center justify-end gap-2 mt-6">
              <button
                onClick={() => { setConfirm(null); setConfirmText(''); }}
                disabled={confirmBusy}
                className="h-9 px-4 text-[13px] font-semibold text-slate-600 rounded-lg hover:bg-slate-100 transition-colors duration-150 disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                onClick={async () => {
                  if (confirm.requireText && confirmText.trim() !== confirm.requireText) return;
                  setConfirmBusy(true);
                  try { await confirm.onConfirm(); } finally {
                    setConfirmBusy(false);
                    setConfirm(null);
                    setConfirmText('');
                  }
                }}
                disabled={confirmBusy || (!!confirm.requireText && confirmText.trim() !== confirm.requireText)}
                className={`h-9 px-4 text-[13px] font-semibold text-white rounded-lg transition-all duration-150 active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed disabled:active:scale-100 ${confirm.danger ? 'bg-red-600 hover:bg-red-700' : 'bg-slate-900 hover:bg-slate-700'}`}
              >
                {confirmBusy ? <i className="fa-solid fa-circle-notch animate-spin"></i> : confirm.confirmLabel}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div
          className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[500] flex items-center gap-2.5 bg-slate-900 text-white rounded-xl pl-3.5 pr-2 py-2.5 shadow-[0_12px_40px_-8px_rgba(15,23,42,0.5)]"
          style={{ animation: 'adminToast 200ms cubic-bezier(0.16,1,0.3,1)' }}
        >
          <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${toast.kind === 'ok' ? 'bg-emerald-400' : 'bg-red-400'}`}></span>
          <span className="text-[13px] font-medium">{toast.msg}</span>
          <button onClick={() => setToast(null)} className="w-6 h-6 rounded-md hover:bg-white/10 flex items-center justify-center transition-colors duration-100 ml-1">
            <i className="fa-solid fa-xmark text-[10px] text-slate-400"></i>
          </button>
        </div>
      )}
    </div>
  );
};

export default AdminDashboard;
