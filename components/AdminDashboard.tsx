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

  const handleSetPlan = async (userId: string, planId: string) => {
    const plan = PLANS.find(p => p.id === planId);
    if (!plan) return;
    try {
      await firebase.firestore().collection('profiles').doc(userId).update({ plan: plan.id, tokenLimit: plan.credits });
      setUsers(users.map(u => u.id === userId ? { ...u, plan: plan.id, tokenLimit: plan.credits } : u));
    } catch (error) {
      console.error("Error updating plan:", error);
      alert("Error al cambiar el plan");
    }
  };

  const handleUpdateLimit = async (userId: string, newLimit: number) => {
    if (isNaN(newLimit) || newLimit <= 0) return;
    try {
      await firebase.firestore().collection('profiles').doc(userId).update({ tokenLimit: newLimit });
      setUsers(users.map(u => u.id === userId ? { ...u, tokenLimit: newLimit } : u));
      setEditingLimit(null);
    } catch (error) {
      console.error("Error updating limit:", error);
      alert("Error al actualizar límite");
    }
  };

  const handleResetTokens = async (userId: string) => {
    if (!window.confirm("¿Reiniciar el consumo de este usuario a 0?")) return;
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
    } catch (error) {
      alert("Error al reiniciar tokens");
    }
  };

  const handleToggleBlock = async (userId: string, isBlocked: boolean) => {
    if (!window.confirm(`¿${isBlocked ? 'DESBLOQUEAR' : 'BLOQUEAR'} a este usuario?`)) return;
    try {
      await firebase.firestore().collection('profiles').doc(userId).update({ isBlocked: !isBlocked });
      setUsers(users.map(u => u.id === userId ? { ...u, isBlocked: !isBlocked } : u));
    } catch (error) {
      alert("Error al cambiar estado de bloqueo");
    }
  };

  const handleDeleteUser = async (userId: string, name: string) => {
    if (!window.confirm(`⚠️ ¿Eliminar el perfil de "${name}"? Esto no borra su cuenta de Google.`)) return;
    try {
      await firebase.firestore().collection('profiles').doc(userId).delete();
      setUsers(users.filter(u => u.id !== userId));
      setStats(prev => ({ ...prev, totalUsers: prev.totalUsers - 1 }));
    } catch (error) {
      alert("Error al eliminar usuario");
    }
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
    if (sortConfig.key !== col) return <i className="fa-solid fa-sort text-slate-300 ml-1 text-[9px]"></i>;
    return sortConfig.direction === 'desc'
      ? <i className="fa-solid fa-sort-down text-[#EA5B25] ml-1 text-[9px]"></i>
      : <i className="fa-solid fa-sort-up text-[#EA5B25] ml-1 text-[9px]"></i>;
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

  if (loading) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center bg-[#F8F9FA] h-full absolute inset-0 z-[200]">
        <i className="fa-solid fa-circle-notch animate-spin text-4xl text-[#EA5B25] mb-4"></i>
        <p className="text-slate-400 font-bold uppercase tracking-widest text-xs">Cargando Panel de Control...</p>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col bg-[#F8F9FA] h-full absolute inset-0 z-[200] overflow-y-auto">
      {/* Header */}
      <header className="h-20 bg-white border-b border-slate-100 flex items-center justify-between px-6 shrink-0 sticky top-0 z-10 shadow-sm">
        <div className="flex items-center gap-4">
          <div className="w-10 h-10 bg-slate-900 text-white rounded-xl flex items-center justify-center shadow-lg">
            <i className="fa-solid fa-shield-halved text-lg"></i>
          </div>
          <div>
            <h1 className="text-lg font-[900] uppercase tracking-tight text-slate-900 leading-none">Panel de Control</h1>
            <span className="text-[10px] font-black uppercase tracking-[0.3em] text-[#EA5B25]">Administrador Global</span>
          </div>
        </div>
        <button onClick={onClose} className="h-10 px-6 flex items-center justify-center bg-slate-100 text-slate-600 rounded-xl transition-all hover:bg-slate-200 active:scale-95 text-xs font-bold uppercase tracking-widest gap-2">
          <i className="fa-solid fa-arrow-left"></i> Volver al Editor
        </button>
      </header>

      <main className="p-6 md:p-10 max-w-7xl mx-auto w-full space-y-8">

        {/* Stats Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-white p-5 rounded-[24px] border border-slate-100 shadow-sm">
            <div className="flex items-center gap-3 mb-1">
              <div className="w-9 h-9 bg-blue-50 text-blue-500 rounded-xl flex items-center justify-center shrink-0"><i className="fa-solid fa-users text-sm"></i></div>
              <span className="text-3xl font-black text-slate-900 leading-none">{stats.totalUsers}</span>
            </div>
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Usuarios Registrados</span>
          </div>

          <div className="bg-white p-5 rounded-[24px] border border-slate-100 shadow-sm">
            <div className="flex items-center gap-3 mb-1">
              <div className="w-9 h-9 bg-orange-50 text-[#EA5B25] rounded-xl flex items-center justify-center shrink-0"><i className="fa-solid fa-image text-sm"></i></div>
              <span className="text-3xl font-black text-slate-900 leading-none tabular-nums">{realUsage.imageCalls.toLocaleString()}</span>
            </div>
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Imágenes generadas</span>
          </div>

          <div className="bg-white p-5 rounded-[24px] border border-slate-100 shadow-sm">
            <div className="flex items-center gap-3 mb-1">
              <div className="w-9 h-9 bg-green-50 text-green-500 rounded-xl flex items-center justify-center shrink-0"><i className="fa-solid fa-bolt text-sm"></i></div>
              <span className="text-3xl font-black text-slate-900 leading-none">{stats.activeUsers}</span>
            </div>
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Usuarios Activos</span>
          </div>

          <div className="bg-white p-5 rounded-[24px] border border-slate-100 shadow-sm">
            <div className="flex items-center gap-3 mb-1">
              <div className="w-9 h-9 bg-emerald-50 text-emerald-500 rounded-xl flex items-center justify-center shrink-0"><i className="fa-solid fa-dollar-sign text-sm"></i></div>
              <span className="text-3xl font-black text-slate-900 leading-none tabular-nums">${(realUsage.imageCalls * 0.04).toFixed(2)}</span>
            </div>
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Costo Total USD</span>
          </div>
        </div>

        {/* Consumo REAL de IA (usageMetadata, todos los clientes) */}
        <div className="bg-white border border-slate-100 rounded-[32px] p-6 shadow-sm space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <h2 className="text-sm font-black uppercase tracking-widest text-slate-700"><i className="fa-solid fa-gauge-high text-[#EA5B25] mr-2"></i>Consumo real de IA</h2>
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Uso real · todos los clientes</span>
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
              .sort((a, b) => b.tokens - a.tokens);
            const estCost = realUsage.imageCalls * 0.04;
            if (rows.length === 0) return <p className="text-sm text-slate-400 font-medium">Todavía no hay consumo real registrado. Aparecerá cuando los usuarios generen contenido.</p>;
            return (
              <div className="grid md:grid-cols-2 gap-5">
                <div className="space-y-1">
                  {rows.map(r => (
                    <div key={r.key} className="flex items-center justify-between text-sm py-1.5 border-b border-slate-50 last:border-0">
                      <span className="font-bold text-slate-600"><i className={`fa-solid ${r.img ? 'fa-image text-[#EA5B25]' : 'fa-font text-slate-300'} mr-2 text-xs`}></i>{r.label}</span>
                      <span className="font-black text-slate-800 tabular-nums">{r.calls.toLocaleString()} <span className="text-slate-400 font-medium text-xs">{r.calls === 1 ? 'vez' : 'veces'}</span></span>
                    </div>
                  ))}
                </div>
                <div className="flex flex-col gap-3">
                  <div className="bg-slate-50 rounded-2xl p-4 flex items-center justify-between">
                    <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Imágenes generadas</span>
                    <span className="text-xl font-black text-slate-900 tabular-nums">{realUsage.imageCalls.toLocaleString()}</span>
                  </div>
                  <div className="bg-orange-50 rounded-2xl p-4 text-center">
                    <p className="text-[10px] font-black text-[#EA5B25] uppercase tracking-widest">Costo real estimado</p>
                    <p className="text-3xl font-black text-slate-900">≈ US$ {estCost.toFixed(2)}</p>
                    <p className="text-[9px] text-slate-400 font-bold mt-1">{realUsage.imageCalls} imágenes · ~US$0,04 c/u · el resto no tiene costo relevante</p>
                  </div>
                </div>
              </div>
            );
          })()}
        </div>

        {/* Filters & Table */}
        <div className="bg-white border border-slate-100 rounded-[32px] overflow-hidden shadow-sm">

          {/* Toolbar */}
          <div className="p-6 border-b border-slate-100 flex flex-col md:flex-row gap-4 items-center justify-between">
            <div className="relative w-full md:w-96">
              <i className="fa-solid fa-search absolute left-4 top-1/2 -translate-y-1/2 text-slate-400"></i>
              <input
                type="text"
                placeholder="Buscar por nombre, comercio o email..."
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
                className="w-full bg-slate-50 border border-slate-100 rounded-xl pl-11 pr-4 py-3 text-sm font-bold focus:ring-2 focus:ring-orange-100 outline-none"
              />
            </div>
            <div className="flex items-center gap-3 w-full md:w-auto">
              <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Mall:</span>
              <select
                value={mallFilter}
                onChange={e => setMallFilter(e.target.value)}
                className="bg-slate-50 border border-slate-100 rounded-xl px-4 py-3 text-xs font-bold outline-none flex-1 md:w-48 cursor-pointer"
              >
                {uniqueMalls.map(m => (
                  <option key={m} value={m}>{m === 'todos' ? 'Todos los Centros' : m}</option>
                ))}
              </select>
              <button
                onClick={handleExportCSV}
                className="h-11 px-5 flex items-center gap-2 bg-slate-900 text-white rounded-xl text-xs font-black uppercase tracking-widest transition-all hover:bg-slate-700 active:scale-95 whitespace-nowrap"
              >
                <i className="fa-solid fa-download"></i> CSV
              </button>
            </div>
          </div>

          {/* Table */}
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-100">
                  <th className="px-4 py-3 text-[10px] font-black uppercase tracking-widest text-slate-400 cursor-pointer hover:text-slate-600 select-none" onClick={() => handleSort('name')}>
                    Comercio / Usuario <SortIcon col="name" />
                  </th>
                  <th className="px-4 py-3 text-[10px] font-black uppercase tracking-widest text-slate-400 cursor-pointer hover:text-slate-600 select-none" onClick={() => handleSort('usage')}>
                    Consumo <SortIcon col="usage" />
                  </th>
                  <th className="px-4 py-3 text-[10px] font-black uppercase tracking-widest text-slate-400 cursor-pointer hover:text-slate-600 select-none" onClick={() => handleSort('lastUsed')}>
                    Actividad <SortIcon col="lastUsed" />
                  </th>
                  <th className="px-4 py-3 text-[10px] font-black uppercase tracking-widest text-slate-400 text-right">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {filteredUsers.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-4 py-12 text-center text-slate-400 text-sm font-bold">
                      No se encontraron usuarios
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
                      <tr key={u.id} className={`hover:bg-slate-50/50 transition-colors ${u.isBlocked ? 'opacity-50 grayscale' : ''}`}>

                        {/* Comercio / Usuario + Mall + Diseños */}
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-3">
                            <div className={`w-9 h-9 rounded-full flex items-center justify-center text-white font-bold text-base shrink-0 ${u.isBlocked ? 'bg-slate-300' : 'bg-slate-900'}`}>
                              {u.business?.charAt(0) || u.name?.charAt(0) || '?'}
                            </div>
                            <div className="min-w-0">
                              <div className="font-bold text-slate-900 flex items-center gap-1.5 flex-wrap">
                                <span className="truncate">{u.business || 'Sin Comercio'}</span>
                                {u.isBlocked && <span className="text-[8px] bg-red-100 text-red-600 px-1.5 py-0.5 rounded-full uppercase tracking-widest font-black shrink-0">Bloqueado</span>}
                              </div>
                              <div className="text-[11px] text-slate-400 truncate">{u.name} • {u.email || 'Sin email'}</div>
                              <div className="flex items-center gap-2 mt-1">
                                <span className="text-[10px] bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full font-medium">{u.mall || 'Sin mall'}</span>
                                <span className="text-[10px] text-slate-400 flex items-center gap-1">
                                  <i className="fa-solid fa-layer-group text-[9px]"></i> {u.designCount ?? 0}
                                </span>
                              </div>
                            </div>
                          </div>
                        </td>

                        {/* Consumo + Costo */}
                        <td className="px-4 py-3 min-w-[180px]">
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-xs font-bold text-slate-700">{tokensToImages(used)} / {Math.round(limit / IMAGE_COST)} <span className="text-slate-400 font-medium">img</span></span>
                            <span className={`text-[10px] font-black ${percent >= 100 ? 'text-red-500' : percent >= 80 ? 'text-orange-500' : 'text-slate-400'}`}>
                              {percent}%
                            </span>
                          </div>
                          <div className="w-full bg-slate-100 rounded-full h-1.5 overflow-hidden mb-1.5">
                            <div
                              className={`h-1.5 rounded-full ${percent >= 100 ? 'bg-red-500' : percent >= 80 ? 'bg-orange-500' : 'bg-[#EA5B25]'}`}
                              style={{ width: `${percent}%` }}
                            />
                          </div>
                          <span className="text-[11px] font-black text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-md inline-block">
                            ${(tokensToImages(used) * 0.04).toFixed(2)} USD
                          </span>
                        </td>

                        {/* Último uso + Vence */}
                        <td className="px-4 py-3 min-w-[130px]">
                          <div className="space-y-1.5">
                            <div>
                              <div className="text-[9px] font-black uppercase tracking-widest text-slate-300 mb-0.5">Último uso</div>
                              <span className="text-[11px] font-bold text-slate-500">
                                {u.usage?.lastUsed ? new Date(u.usage.lastUsed).toLocaleDateString('es-AR', { day: '2-digit', month: 'short', year: 'numeric' }) : 'N/A'}
                              </span>
                            </div>
                            <div>
                              <div className="text-[9px] font-black uppercase tracking-widest text-slate-300 mb-0.5">Vence</div>
                              {expDate ? (
                                <span className={`text-[11px] font-black px-1.5 py-0.5 rounded inline-block ${isUrgent ? 'bg-red-50 text-red-500' : isSoon ? 'bg-orange-50 text-orange-500' : 'text-slate-500'}`}>
                                  {expDate.toLocaleDateString('es-AR', { day: '2-digit', month: 'short' })} · {daysLeft! > 0 ? `${daysLeft}d` : 'vencido'}
                                </span>
                              ) : <span className="text-[11px] text-slate-300 font-bold">N/A</span>}
                            </div>
                          </div>
                          <div className="mt-2 flex items-center gap-2">
                            <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Plan</span>
                            <select
                              value={planForProfile(u.plan, u.tokenLimit)?.id || ''}
                              onChange={(e) => handleSetPlan(u.id, e.target.value)}
                              className="text-[11px] font-bold bg-slate-50 border border-slate-200 rounded-lg px-2 py-1 outline-none focus:ring-2 focus:ring-orange-100"
                            >
                              <option value="" disabled>Personalizado</option>
                              {PLANS.map(p => <option key={p.id} value={p.id}>{p.name} · {p.images} img</option>)}
                            </select>
                          </div>
                        </td>

                        {/* Acciones */}
                        <td className="px-6 py-4 text-right">
                          {isEditingThis ? (
                            <div className="flex items-center justify-end gap-2">
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
                                  className="w-28 bg-slate-50 border border-orange-300 rounded-lg pl-3 pr-9 py-1.5 text-xs font-bold outline-none focus:ring-2 focus:ring-orange-200 text-right"
                                />
                                <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] font-bold text-slate-400 pointer-events-none">img</span>
                              </div>
                              <button
                                onClick={() => handleUpdateLimit(u.id, Number(editingLimit.value) * IMAGE_COST)}
                                className="w-8 h-8 rounded-lg bg-[#EA5B25] text-white flex items-center justify-center hover:bg-orange-600 transition-colors"
                                title="Guardar"
                              >
                                <i className="fa-solid fa-check text-xs"></i>
                              </button>
                              <button
                                onClick={() => setEditingLimit(null)}
                                className="w-8 h-8 rounded-lg bg-slate-100 text-slate-500 flex items-center justify-center hover:bg-slate-200 transition-colors"
                                title="Cancelar"
                              >
                                <i className="fa-solid fa-xmark text-xs"></i>
                              </button>
                            </div>
                          ) : (
                            <button
                              onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); setMenu(menu?.id === u.id ? null : { id: u.id, x: r.right, y: r.bottom }); }}
                              className={`w-8 h-8 rounded-lg transition-colors flex items-center justify-center ml-auto ${menu?.id === u.id ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-500 hover:bg-slate-200 hover:text-slate-700'}`}
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
        <div className="bg-white border border-slate-100 rounded-[32px] overflow-hidden shadow-sm">
          <div className="p-6 border-b border-slate-100 flex items-center justify-between">
            <div>
              <h2 className="text-sm font-[900] uppercase tracking-widest text-slate-900">Costo por Mes</h2>
              <p className="text-[10px] text-slate-400 font-bold mt-0.5">Historial acumulado de ciclos completados</p>
            </div>
            <div className="w-9 h-9 bg-emerald-50 text-emerald-500 rounded-xl flex items-center justify-center">
              <i className="fa-solid fa-calendar-days text-sm"></i>
            </div>
          </div>

          {monthlyCosts.length === 0 ? (
            <div className="px-6 py-12 text-center">
              <i className="fa-solid fa-clock-rotate-left text-3xl text-slate-200 mb-3"></i>
              <p className="text-slate-400 text-sm font-bold">Sin historial todavía</p>
              <p className="text-slate-300 text-xs mt-1">Los datos aparecerán cuando los ciclos de los usuarios se renueven</p>
            </div>
          ) : (
            <div className="p-6 space-y-3">
              {/* Barra del mes actual (ciclo en curso) */}
              {(() => {
                const now = new Date();
                const currentLabel = now.toLocaleDateString('es-AR', { month: 'long', year: 'numeric' });
                const maxCost = Math.max(stats.totalCost, ...monthlyCosts.map(m => m.costUsd), 0.01);
                return (
                  <>
                    <div className="flex items-center gap-4">
                      <div className="w-28 text-right">
                        <span className="text-[11px] font-black text-[#EA5B25] uppercase">{currentLabel}</span>
                        <span className="block text-[9px] text-slate-300 uppercase tracking-widest">en curso</span>
                      </div>
                      <div className="flex-1 bg-slate-100 rounded-full h-3 overflow-hidden">
                        <div
                          className="h-3 rounded-full bg-[#EA5B25]/60"
                          style={{ width: `${Math.min(100, (stats.totalCost / maxCost) * 100)}%` }}
                        />
                      </div>
                      <span className="text-sm font-black text-slate-700 w-20 text-right">
                        ${stats.totalCost.toFixed(2)} USD
                      </span>
                    </div>
                    {monthlyCosts.map(m => (
                      <div key={`${m.year}-${m.month}`} className="flex items-center gap-4">
                        <div className="w-28 text-right">
                          <span className="text-[11px] font-bold text-slate-600 capitalize">{m.label}</span>
                          <span className="block text-[9px] text-slate-300 uppercase tracking-widest">{m.cycleCount} ciclo{m.cycleCount !== 1 ? 's' : ''}</span>
                        </div>
                        <div className="flex-1 bg-slate-100 rounded-full h-3 overflow-hidden">
                          <div
                            className="h-3 rounded-full bg-slate-400"
                            style={{ width: `${Math.min(100, (m.costUsd / maxCost) * 100)}%` }}
                          />
                        </div>
                        <span className="text-sm font-black text-slate-700 w-20 text-right">
                          ${m.costUsd.toFixed(2)} USD
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
        const item = 'w-full flex items-center gap-3 px-4 py-2.5 text-sm font-bold text-left transition-colors';
        return (
          <>
            <div className="fixed inset-0 z-[290]" onClick={() => setMenu(null)} />
            <div className="fixed z-[300] w-52 bg-white rounded-2xl border border-slate-100 shadow-2xl shadow-slate-400/25 overflow-hidden py-1.5" style={{ top: menu.y + 6, left: Math.max(8, menu.x - 208) }}>
              <button onClick={() => { setEditingLimit({ id: mu.id, value: Math.round(mLimit / IMAGE_COST).toString() }); setMenu(null); }} className={`${item} text-slate-700 hover:bg-slate-50`}>
                <i className="fa-solid fa-pen-to-square text-slate-400 w-4 text-center"></i> Editar límite
              </button>
              <button onClick={() => { handleResetTokens(mu.id); setMenu(null); }} className={`${item} text-slate-700 hover:bg-slate-50`}>
                <i className="fa-solid fa-rotate-left text-blue-400 w-4 text-center"></i> Reiniciar consumo
              </button>
              <button onClick={() => { handleToggleBlock(mu.id, !!mu.isBlocked); setMenu(null); }} className={`${item} text-slate-700 hover:bg-slate-50`}>
                <i className={`fa-solid ${mu.isBlocked ? 'fa-unlock text-green-500' : 'fa-lock text-orange-500'} w-4 text-center`}></i> {mu.isBlocked ? 'Desbloquear' : 'Bloquear'}
              </button>
              <div className="h-px bg-slate-100 my-1"></div>
              <button onClick={() => { handleDeleteUser(mu.id, mu.business || mu.name); setMenu(null); }} className={`${item} text-red-600 hover:bg-red-50`}>
                <i className="fa-solid fa-trash text-red-400 w-4 text-center"></i> Eliminar
              </button>
            </div>
          </>
        );
      })()}
    </div>
  );
};

export default AdminDashboard;
