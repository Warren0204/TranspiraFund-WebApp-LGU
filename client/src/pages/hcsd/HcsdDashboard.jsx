import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    Wallet, Users, FolderKanban, ArrowRight,
    AlertTriangle, HardHat, Activity,
} from 'lucide-react';
import HcsdSidebar from '../../components/layout/HcsdSidebar';
import { useTheme } from '../../context/ThemeContext';
import { collection, query, orderBy, onSnapshot } from 'firebase/firestore';
import { db } from '../../config/firebase';
import { ROLES } from '../../config/roles';

/* ── Status distribution donut ──────────────────────────────────────────── */
const SEGMENTS = [
    { label: 'Delayed',   color: '#f59e0b', dark: '#fbbf24' },
    { label: 'Ongoing',   color: '#14b8a6', dark: '#2dd4bf' },
    { label: 'Completed', color: '#10b981', dark: '#34d399' },
];

const DonutChart = ({ statusDist, total, isDark }) => {
    const [drawn, setDrawn] = useState(false);
    useEffect(() => { const t = setTimeout(() => setDrawn(true), 120); return () => clearTimeout(t); }, []);

    const R = 44, SW = 9;
    const size = (R + SW) * 2;
    const C = 2 * Math.PI * R;
    const safe = total || 1;
    const values = [statusDist.delayed, statusDist.ongoing, statusDist.done];
    let cum = 0;

    return (
        <div className="flex flex-col gap-4">
            <div className="flex items-center justify-center gap-6">
                <div className="relative shrink-0">
                    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
                        <circle cx={size / 2} cy={size / 2} r={R} fill="none" strokeWidth={SW}
                            className="stroke-slate-100 dark:stroke-slate-700" />
                        {SEGMENTS.map((seg, i) => {
                            const pct = values[i] / safe;
                            const dash = drawn ? pct * C : 0;
                            const startAngle = cum * 360 - 90;
                            cum += pct;
                            if (!values[i]) return null;
                            return (
                                <circle key={i}
                                    cx={size / 2} cy={size / 2} r={R}
                                    fill="none"
                                    stroke={isDark ? seg.dark : seg.color}
                                    strokeWidth={SW}
                                    strokeDasharray={`${dash} ${C}`}
                                    strokeLinecap="butt"
                                    transform={`rotate(${startAngle} ${size / 2} ${size / 2})`}
                                    style={{ transition: `stroke-dasharray 0.9s ease-out ${i * 0.22}s` }}
                                />
                            );
                        })}
                    </svg>
                    <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                        <span className="text-xl font-bold text-slate-900 dark:text-white leading-none">{total}</span>
                        <span className="text-[9px] font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-widest mt-0.5">Total</span>
                    </div>
                </div>
            </div>
            <div className="grid grid-cols-3 gap-2">
                {SEGMENTS.map((seg, i) => {
                    const count = values[i] || 0;
                    const pct = total > 0 ? Math.round((count / total) * 100) : 0;
                    return (
                        <div key={i} className="flex flex-col items-center gap-1 p-2 rounded-xl bg-slate-50 dark:bg-slate-800/40">
                            <span className="w-2 h-2 rounded-full shrink-0"
                                style={{ background: isDark ? seg.dark : seg.color }} />
                            <span className="text-[10px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide text-center leading-tight">
                                {seg.label}
                            </span>
                            <span className="text-sm font-black text-slate-700 dark:text-slate-200 tabular-nums">
                                {count}
                                <span className="text-[10px] font-semibold text-slate-400 ml-0.5">({pct}%)</span>
                            </span>
                        </div>
                    );
                })}
            </div>
        </div>
    );
};

/* ── Normalize legacy/retired statuses ───────────────────────────────────── */
const normalizeStatus = (status) => {
    const s = (status || '').toLowerCase();
    if (s === 'completed') return 'Completed';
    if (s === 'returned') return 'Returned';
    if (s === 'ongoing') return 'Ongoing';
    if (s === 'delayed') return 'Delayed';
    if (s === 'for mayor' || s === 'draft') return 'Ongoing'; // legacy → Ongoing
    return 'Delayed';
};

/* ── Status badge helper ─────────────────────────────────────────────────── */
const statusStyle = (status) => {
    const s = normalizeStatus(status).toUpperCase();
    if (s === 'COMPLETED')
        return 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-400 dark:ring-emerald-500/20';
    if (s === 'RETURNED')
        return 'bg-rose-50 text-rose-700 ring-1 ring-rose-200 dark:bg-rose-500/10 dark:text-rose-400 dark:ring-rose-500/20';
    if (s === 'DELAYED')
        return 'bg-amber-50 text-amber-700 ring-1 ring-amber-200 dark:bg-amber-500/10 dark:text-amber-400 dark:ring-amber-500/20';
    return 'bg-teal-50 text-teal-700 ring-1 ring-teal-200 dark:bg-teal-500/10 dark:text-teal-400 dark:ring-teal-500/20';
};

/* ── Component ───────────────────────────────────────────────────────────── */
const HcsdDashboard = () => {
    const { isDark } = useTheme();
    const navigate = useNavigate();

    const [stats, setStats]           = useState({ budget: 0, engineers: 0, projects: 0 });
    const [recentProjects, setRecent] = useState([]);
    const [statusDist, setDist]       = useState({ delayed: 0, ongoing: 0, returned: 0, done: 0 });

    useEffect(() => {
        const unsubEng = onSnapshot(
            query(collection(db, 'users'), orderBy('createdAt', 'desc')),
            (snap) => {
                const count = snap.docs.filter(d => {
                    const r = d.data().role;
                    return r === ROLES.PROJECT_ENGINEER || r === 'Project Engineer' || r === 'PROJ_ENG';
                }).length;
                setStats(p => ({ ...p, engineers: count }));
            }
        );

        const unsubProj = onSnapshot(
            query(collection(db, 'projects'), orderBy('createdAt', 'desc')),
            (snap) => {
                const data = snap.docs.map(d => ({ id: d.id, ...d.data() }));
                const budget = data.reduce((a, c) => a + (Number(c.contractAmount) || 0), 0);
                const dist = { delayed: 0, ongoing: 0, returned: 0, done: 0 };
                data.forEach(p => {
                    const s = normalizeStatus(p.status).toUpperCase();
                    if (s === 'COMPLETED') dist.done++;
                    else if (s === 'RETURNED') dist.returned++;
                    else if (s === 'DELAYED') dist.delayed++;
                    else dist.ongoing++;
                });
                setStats(p => ({ ...p, budget, projects: data.length }));
                setRecent(data.slice(0, 5));
                setDist(dist);
            }
        );

        return () => { unsubEng(); unsubProj(); };
    }, []);

    const fmtBudget = (val) => {
        if (val >= 1_000_000_000) return `₱${(val / 1_000_000_000).toFixed(2)}B`;
        if (val >= 1_000_000)     return `₱${(val / 1_000_000).toFixed(2)}M`;
        if (val >= 1_000)         return `₱${(val / 1_000).toFixed(1)}K`;
        return `₱${Number(val).toLocaleString('en-PH')}`;
    };

    const STAT_CARDS = [
        { label: 'Total Budget',     shortLabel: 'Budget',    value: fmtBudget(stats.budget),   icon: Wallet,       gradient: 'from-teal-600 to-emerald-500',  iconShadow: 'shadow-teal-600/25',    glow: '#0d9488' },
        { label: 'Active Engineers', shortLabel: 'Engineers', value: stats.engineers.toString(), icon: HardHat,      gradient: 'from-teal-500 to-cyan-400',    iconShadow: 'shadow-teal-500/25',    glow: '#14b8a6' },
        { label: 'Total Projects',   shortLabel: 'Projects',  value: stats.projects.toString(),  icon: FolderKanban, gradient: 'from-emerald-500 to-teal-400', iconShadow: 'shadow-emerald-500/25', glow: '#10b981' },
    ];

    return (
        <div className="min-h-screen hcsd-bg font-sans text-slate-900 dark:text-slate-100 transition-colors duration-300">
            <HcsdSidebar />

            <main className="ml-0 md:ml-72 p-4 md:p-6 lg:p-8 pt-20 md:pt-8">

                {/* ── PAGE HEADER ─────────────────────────────────────────── */}
                <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 mb-8" style={{ animation: 'fadeIn 0.5s ease-out both' }}>
                    <div>
                        <div className="flex items-center gap-2 mb-1.5">
                            <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-teal-600 to-emerald-500 flex items-center justify-center shadow-md shadow-teal-500/30 shrink-0">
                                <Activity size={14} className="text-white" strokeWidth={2.5} />
                            </div>
                            <span className="text-xs font-extrabold uppercase tracking-[0.18em] text-teal-600 dark:text-teal-400">
                                <span className="sm:hidden">Construction Services Div., DEPW</span>
                                <span className="hidden sm:inline">Construction Services Division, DEPW</span>
                            </span>
                        </div>
                        <h1 className="font-black tracking-tight text-slate-900 dark:text-white">
                            <span className="block text-2xl sm:hidden">HCSD Dashboard</span>
                            <span className="hidden sm:block lg:hidden text-2xl">Head of Construction Services Division</span>
                            <span className="hidden lg:block text-3xl">Head of Construction Services Division Dashboard</span>
                        </h1>
                        <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
                            Real-time infrastructure monitoring and resource allocation.
                        </p>
                    </div>

                    <div className="flex items-center gap-3 w-full lg:w-auto">
                        <button
                            onClick={() => navigate('/hcsd/staff')}
                            className="flex-1 lg:flex-none inline-flex items-center justify-center gap-2 bg-slate-800 hover:bg-slate-700 dark:bg-slate-700 dark:hover:bg-slate-600 text-white text-sm font-semibold py-2.5 px-4 lg:px-5 rounded-xl transition-colors duration-150 whitespace-nowrap"
                        >
                            <Users size={15} className="shrink-0" />
                            Staff Management
                        </button>
                        <button
                            onClick={() => navigate('/hcsd/projects')}
                            className="flex-1 lg:flex-none inline-flex items-center justify-center gap-2 bg-teal-600 hover:bg-teal-700 text-white text-sm font-semibold py-2.5 px-4 lg:px-5 rounded-xl transition-colors duration-150 whitespace-nowrap shadow-sm"
                        >
                            <FolderKanban size={15} className="shrink-0" />
                            Manage Projects
                        </button>
                    </div>
                </div>

                {/* ── STAT CARDS ──────────────────────────────────────────── */}
                <div className="grid grid-cols-3 gap-3 sm:gap-4 mb-6">
                    {STAT_CARDS.map((card, i) => {
                        const CardIcon = card.icon;
                        return (
                        <div
                            key={i}
                            className="relative bg-white dark:bg-slate-900/60 rounded-2xl border border-slate-200 dark:border-white/[0.07] shadow-md shadow-slate-200/50 dark:shadow-black/20 hover:shadow-xl hover:-translate-y-1 transition-all duration-300 overflow-hidden"
                            style={{ animation: `slideUp 0.5s ease-out ${i * 0.09}s both` }}
                        >
                            <div className={`absolute left-0 top-3 bottom-3 w-[3px] rounded-r-full bg-gradient-to-b ${card.gradient}`} />
                            <div className="absolute -right-6 -bottom-6 w-20 h-20 rounded-full pointer-events-none"
                                style={{ background: card.glow, opacity: 0.08 }} />

                            {/* Mobile: compact vertical stack */}
                            <div className="flex flex-col items-center gap-1.5 p-3 sm:hidden">
                                <div className={`w-9 h-9 rounded-xl bg-gradient-to-br ${card.gradient} flex items-center justify-center shadow-md ${card.iconShadow}`}>
                                    <CardIcon size={16} className="text-white" strokeWidth={2} />
                                </div>
                                <p className="text-[9px] font-bold uppercase tracking-wide text-slate-400 dark:text-slate-500 text-center leading-tight">
                                    {card.shortLabel}
                                </p>
                                <p className="text-base font-black text-slate-900 dark:text-white tabular-nums leading-none">
                                    {card.value}
                                </p>
                            </div>

                            {/* sm+: horizontal layout */}
                            <div className="hidden sm:flex items-center gap-4 p-5">
                                <div className={`relative w-12 h-12 rounded-2xl bg-gradient-to-br ${card.gradient} flex items-center justify-center shadow-md ${card.iconShadow} shrink-0`}>
                                    <CardIcon size={22} className="text-white" strokeWidth={2} />
                                </div>
                                <div className="relative min-w-0">
                                    <p className="text-xs font-semibold uppercase tracking-widest text-slate-400 dark:text-slate-500 mb-0.5 truncate">
                                        {card.label}
                                    </p>
                                    <p className="text-2xl font-bold text-slate-900 dark:text-white tabular-nums leading-none">
                                        {card.value}
                                    </p>
                                </div>
                            </div>
                        </div>
                        );
                    })}
                </div>

                {/* ── MAIN CONTENT ────────────────────────────────────────── */}
                {/*
                    · mobile/sm/md  → stacked full-width
                    · lg+           → Active Registry (8/12) + side panels (4/12)
                */}
                <div className="flex flex-col lg:flex-row gap-4">

                    {/* Active Registry ──────────────────────────────────── */}
                    <div className="w-full lg:w-8/12 bg-white dark:bg-slate-900/60 rounded-2xl border border-slate-200 dark:border-white/[0.07] shadow-md shadow-slate-200/50 dark:shadow-black/20 overflow-hidden">

                        {/* Card header */}
                        <div className="px-5 sm:px-6 py-4 border-b border-slate-100 dark:border-slate-700 flex items-center justify-between">
                            <h3 className="flex items-center gap-2 text-sm font-bold text-slate-800 dark:text-slate-200">
                                <FolderKanban size={16} className="text-teal-500 dark:text-teal-400 shrink-0" />
                                Active Registry
                            </h3>
                            <button
                                onClick={() => navigate('/hcsd/projects')}
                                className="inline-flex items-center gap-1 text-xs font-semibold text-teal-600 dark:text-teal-400 hover:text-teal-700 dark:hover:text-teal-300 transition-colors duration-150"
                            >
                                View All <ArrowRight size={12} />
                            </button>
                        </div>

                        {/* Table header */}
                        <div className="grid grid-cols-12 px-4 sm:px-6 py-2.5 bg-slate-50 dark:bg-slate-800/80 border-b border-slate-100 dark:border-slate-700 text-[10px] font-bold uppercase tracking-widest text-slate-400 dark:text-slate-500">
                            <div className="col-span-8 sm:col-span-5">Project Name</div>
                            <div className="hidden sm:block sm:col-span-3">Location</div>
                            <div className="col-span-4 sm:col-span-2">Status</div>
                            <div className="hidden sm:block sm:col-span-2 text-right">Progress</div>
                        </div>

                        {/* Rows */}
                        <div className="divide-y divide-slate-50 dark:divide-slate-700/50">
                            {recentProjects.length === 0 ? (
                                <div className="flex flex-col items-center justify-center py-14 gap-2.5 text-slate-300 dark:text-slate-600">
                                    <FolderKanban size={36} strokeWidth={1.2} />
                                    <p className="text-sm font-medium text-slate-400 dark:text-slate-500">No active projects found.</p>
                                </div>
                            ) : (
                                recentProjects.map((project, i) => (
                                    <div
                                        key={i}
                                        className="grid grid-cols-12 items-center px-4 sm:px-6 py-3.5 hover:bg-slate-50 dark:hover:bg-slate-700/40 cursor-pointer group transition-colors duration-150"
                                    >
                                        <div className="col-span-8 sm:col-span-5 text-sm font-semibold text-slate-800 dark:text-slate-200 truncate pr-2 group-hover:text-teal-600 dark:group-hover:text-teal-400 transition-colors duration-150">
                                            {project.projectName || 'Untitled Project'}
                                        </div>
                                        <div className="hidden sm:block sm:col-span-3 text-sm text-slate-400 dark:text-slate-500 truncate pr-3">
                                            {project.barangay ? `Brgy. ${project.barangay}` : '—'}
                                        </div>
                                        <div className="col-span-4 sm:col-span-2 flex items-center">
                                            <span className={`inline-flex items-center px-1.5 py-0.5 rounded-md text-[9px] sm:text-[10px] font-bold uppercase tracking-wide truncate ${statusStyle(project.status)}`}>
                                                {normalizeStatus(project.status)}
                                            </span>
                                        </div>
                                        <div className="hidden sm:flex sm:col-span-2 items-center justify-end gap-2">
                                            <div className="flex-1 h-1.5 bg-slate-100 dark:bg-slate-700 rounded-full overflow-hidden">
                                                <div
                                                    className="h-full rounded-full transition-all duration-700"
                                                    style={{
                                                        width: `${project.progress || 0}%`,
                                                        background: 'linear-gradient(to right, #0d9488, #10b981)',
                                                    }}
                                                />
                                            </div>
                                            <span className="text-xs font-bold text-slate-500 dark:text-slate-400 w-8 text-right tabular-nums shrink-0">
                                                {project.progress || 0}%
                                            </span>
                                        </div>
                                    </div>
                                ))
                            )}
                        </div>
                    </div>

                    {/* Side panels ──────────────────────────────────────── */}
                    <div className="w-full lg:w-4/12 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-1 gap-4">

                        {/* Slippage Alerts */}
                        <div className="bg-white dark:bg-slate-900/60 rounded-2xl border border-slate-200 dark:border-white/[0.07] shadow-md shadow-slate-200/50 dark:shadow-black/20 p-5">
                            <div className="flex items-center justify-between gap-2 flex-wrap mb-4">
                                <h3 className="flex items-center gap-2 text-sm font-bold text-slate-800 dark:text-slate-200 min-w-0">
                                    <AlertTriangle size={15} className="text-red-500 shrink-0" />
                                    <span className="truncate">Slippage Alerts</span>
                                </h3>
                                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide bg-red-50 text-red-600 ring-1 ring-red-200 dark:bg-red-500/10 dark:text-red-400 dark:ring-red-500/20 shrink-0 whitespace-nowrap">
                                    0 Critical
                                </span>
                            </div>
                            <div className="flex flex-col items-center justify-center py-8 gap-2.5 text-slate-300 dark:text-slate-600">
                                <AlertTriangle size={30} strokeWidth={1.2} />
                                <p className="text-xs font-medium text-slate-400 dark:text-slate-500 text-center">
                                    No critical alerts detected.
                                </p>
                            </div>
                        </div>

                        {/* Status Distribution */}
                        <div className="bg-white dark:bg-slate-900/60 rounded-2xl border border-slate-200 dark:border-white/[0.07] shadow-md shadow-slate-200/50 dark:shadow-black/20 p-5">
                            <h3 className="flex items-center gap-2 text-sm font-bold text-slate-800 dark:text-slate-200 mb-5">
                                <Activity size={15} className="text-teal-500 dark:text-teal-400 shrink-0" />
                                Status Distribution
                            </h3>
                            <DonutChart statusDist={statusDist} total={stats.projects} isDark={isDark} />
                        </div>

                    </div>
                </div>

            </main>
        </div>
    );
};

export default HcsdDashboard;
