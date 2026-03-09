import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    Wallet, Users, FolderKanban, ArrowRight,
    AlertTriangle, HardHat, Activity,
} from 'lucide-react';
import DepwSidebar from '../../components/layout/DepwSidebar';
import { useTheme } from '../../context/ThemeContext';
import { collection, query, orderBy, onSnapshot } from 'firebase/firestore';
import { db } from '../../config/firebase';
import { ROLES } from '../../config/roles';

const SEGMENTS = [
    { label: 'Active',    color: '#06b6d4', dark: '#22d3ee' },
    { label: 'For Mayor', color: '#f59e0b', dark: '#fbbf24' },
    { label: 'Done',      color: '#10b981', dark: '#34d399' },
];

const DonutChart = ({ statusDist, total, isDark }) => {
    const [drawn, setDrawn] = useState(false);
    useEffect(() => { const t = setTimeout(() => setDrawn(true), 120); return () => clearTimeout(t); }, []);

    const R = 52, SW = 11;
    const size = (R + SW) * 2;
    const C = 2 * Math.PI * R;
    const safe = total || 1;

    const values = [statusDist.active, statusDist.mayor, statusDist.done];
    let cum = 0;

    return (
        <div className="flex flex-col sm:flex-row items-center gap-6">
            <div className="relative shrink-0">
                <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
                    <circle
                        cx={size / 2} cy={size / 2} r={R}
                        fill="none" strokeWidth={SW}
                        className="stroke-slate-100 dark:stroke-slate-800"
                    />
                    {SEGMENTS.map((seg, i) => {
                        const pct  = values[i] / safe;
                        const dash = drawn ? pct * C : 0;
                        const startAngle = cum * 360 - 90;
                        cum += pct;
                        if (!values[i]) return null;
                        return (
                            <circle
                                key={i}
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
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                    <span className="text-xl font-extrabold text-slate-900 dark:text-white leading-none">{total}</span>
                    <span className="text-[9px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest mt-0.5">Total</span>
                </div>
            </div>

            <div className="flex-1 w-full space-y-3">
                {SEGMENTS.map((seg, i) => {
                    const pct = total > 0 ? Math.round((values[i] / total) * 100) : 0;
                    return (
                        <div key={i} className="space-y-1.5">
                            <div className="flex justify-between items-center">
                                <div className="flex items-center gap-2">
                                    <span className="w-2 h-2 rounded-full shrink-0" style={{ background: isDark ? seg.dark : seg.color }} />
                                    <span className="text-[11px] font-bold uppercase tracking-widest text-slate-400 dark:text-slate-500">{seg.label}</span>
                                </div>
                                <span className="text-xs font-extrabold text-slate-700 dark:text-slate-300">{pct}%</span>
                            </div>
                            <div className="w-full h-1.5 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                                <div
                                    className="h-full rounded-full transition-all duration-1000"
                                    style={{ width: `${pct}%`, background: isDark ? seg.dark : seg.color }}
                                />
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
};

const statusStyle = (status) => {
    const s = (status || '').toUpperCase();
    if (s === 'COMPLETED' || s.includes('DONE'))
        return 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20';
    if (s.includes('MAYOR'))
        return 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20';
    return 'bg-cyan-500/10 text-cyan-600 dark:text-cyan-400 border border-cyan-500/20';
};

const DepwDashboard = () => {
    const { isDark } = useTheme();
    const navigate = useNavigate();

    const [stats, setStats]           = useState({ budget: 0, engineers: 0, projects: 0 });
    const [recentProjects, setRecent] = useState([]);
    const [statusDist, setDist]       = useState({ active: 0, mayor: 0, done: 0 });

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
                const budget = data.reduce((a, c) => a + (Number(c.budget) || 0), 0);
                const dist = { active: 0, mayor: 0, done: 0 };
                data.forEach(p => {
                    const s = (p.status || '').toUpperCase();
                    if (s === 'COMPLETED') dist.done++;
                    else if (s.includes('MAYOR')) dist.mayor++;
                    else dist.active++;
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
        {
            label:    'Total Budget',
            value:    fmtBudget(stats.budget),
            icon:     Wallet,
            gradient: 'from-blue-600 to-cyan-500',
            glow:     'shadow-blue-500/40',
            ambient:  'from-blue-500/20 to-cyan-500/10',
        },
        {
            label:    'Active Engineers',
            value:    stats.engineers.toString(),
            icon:     HardHat,
            gradient: 'from-indigo-500 to-purple-500',
            glow:     'shadow-indigo-500/40',
            ambient:  'from-indigo-500/20 to-purple-500/10',
        },
        {
            label:    'Total Projects',
            value:    stats.projects.toString(),
            icon:     FolderKanban,
            gradient: 'from-emerald-500 to-teal-400',
            glow:     'shadow-emerald-500/40',
            ambient:  'from-emerald-500/20 to-teal-400/10',
        },
    ];

    return (
        <div className="min-h-screen depw-bg font-sans text-slate-900 dark:text-slate-100 transition-colors duration-300">
            <DepwSidebar />

            <main className="ml-0 md:ml-72 p-4 md:p-6 lg:p-10 pt-20 md:pt-10">

                <div
                    className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-5 mb-10"
                    style={{ animation: 'fadeIn 0.5s ease-out both' }}
                >
                    <div>
                        <div className="flex items-center gap-2.5 mb-2">
                            <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-blue-600 to-cyan-500 flex items-center justify-center shadow-md shadow-blue-500/30">
                                <Activity size={14} className="text-white" strokeWidth={2.5} />
                            </div>
                            <span className="text-[11px] font-extrabold uppercase tracking-[0.18em] text-blue-600 dark:text-cyan-400">
                                Engineering Command
                            </span>
                        </div>
                        <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-slate-900 dark:text-white">
                            DEPW Dashboard
                        </h1>
                        <p className="text-sm text-slate-500 dark:text-slate-400 font-medium mt-1">
                            Real-time infrastructure monitoring and resource allocation.
                        </p>
                    </div>

                    <div className="flex items-center gap-3 w-full lg:w-auto">
                        <button onClick={() => navigate('/depw/staff')} className="flex-1 lg:flex-none bg-slate-800 dark:bg-slate-700 hover:bg-slate-900 dark:hover:bg-slate-600 text-white font-bold py-2.5 px-5 rounded-xl shadow-lg transition-all duration-200 flex items-center justify-center gap-2 text-sm">
                            <Users size={17} />
                            Staff Management
                        </button>

                        <button onClick={() => navigate('/depw/projects')} className="flex-1 lg:flex-none bg-gradient-to-r from-blue-600 to-cyan-500 hover:from-blue-700 hover:to-cyan-600 text-white font-bold py-2.5 px-5 rounded-xl shadow-lg shadow-blue-500/25 transition-all duration-200 flex items-center justify-center gap-2 text-sm">
                            <FolderKanban size={17} />
                            Manage Projects
                        </button>
                    </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 lg:gap-6 mb-8">
                    {STAT_CARDS.map((card, i) => (
                        <div
                            key={i}
                            className="relative overflow-hidden rounded-[24px] p-6 bg-white/70 dark:bg-slate-900/50 backdrop-blur-xl border border-white/80 dark:border-white/5 shadow-xl shadow-slate-200/50 dark:shadow-black/20 flex items-center gap-5"
                            style={{ animation: `slideUp 0.5s ease-out ${i * 0.1}s both` }}
                        >
                            <div className={`absolute -top-8 -right-8 w-36 h-36 rounded-full bg-gradient-to-br ${card.ambient} blur-2xl pointer-events-none`} />

                            <div className="relative shrink-0">
                                <div className={`absolute inset-0 rounded-2xl bg-gradient-to-br ${card.gradient} opacity-60 blur-md scale-110 animate-pulse-glow pointer-events-none`} />
                                <div className={`relative w-14 h-14 rounded-2xl bg-gradient-to-br ${card.gradient} flex items-center justify-center shadow-xl ${card.glow}`}>
                                    <card.icon size={24} className="text-white" strokeWidth={2.5} />
                                </div>
                            </div>

                            <div className="min-w-0 relative">
                                <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400 dark:text-slate-500 mb-1">
                                    {card.label}
                                </p>
                                <h3 className="text-2xl font-extrabold tracking-tight text-slate-900 dark:text-white truncate">
                                    {card.value}
                                </h3>
                            </div>
                        </div>
                    ))}
                </div>

                <div className="flex flex-col lg:flex-row gap-6 lg:gap-8">

                    <div
                        className="lg:w-8/12 bg-white/70 dark:bg-slate-900/50 backdrop-blur-xl rounded-[24px] border border-white/80 dark:border-white/5 shadow-xl shadow-slate-200/50 dark:shadow-black/20 overflow-hidden"
                        style={{ animation: 'slideUp 0.5s ease-out 0.25s both' }}
                    >
                        <div className="px-6 py-5 border-b border-slate-100 dark:border-slate-800 flex justify-between items-center">
                            <h3 className="flex items-center gap-2.5 font-extrabold text-slate-900 dark:text-white text-[15px] tracking-tight">
                                <FolderKanban size={17} className="text-slate-400 dark:text-slate-500" />
                                Active Registry
                            </h3>
                            <button onClick={() => navigate('/depw/projects')} className="text-xs font-bold text-blue-600 dark:text-cyan-400 hover:bg-blue-50 dark:hover:bg-cyan-500/10 px-3 py-1.5 rounded-lg transition-all duration-200 flex items-center gap-1">
                                View All <ArrowRight size={13} />
                            </button>
                        </div>

                        <div className="grid grid-cols-12 text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400 dark:text-slate-600 px-6 py-3 bg-slate-50/60 dark:bg-slate-950/40">
                            <div className="col-span-6 sm:col-span-5">Project Name</div>
                            <div className="hidden sm:block sm:col-span-3">Location</div>
                            <div className="col-span-4 sm:col-span-2">Status</div>
                            <div className="hidden sm:block sm:col-span-2 text-right">Progress</div>
                        </div>

                        <div className="divide-y divide-slate-50 dark:divide-slate-800/50">
                            {recentProjects.length === 0 ? (
                                <div className="text-center py-16 text-sm text-slate-400 dark:text-slate-600 italic font-medium">
                                    No active projects found.
                                </div>
                            ) : (
                                recentProjects.map((project, i) => (
                                    <div
                                        key={i}
                                        className="grid grid-cols-12 items-center px-6 py-4 hover:bg-cyan-500/5 dark:hover:bg-cyan-500/5 border-l-2 border-transparent hover:border-cyan-500 transition-all duration-200 cursor-pointer group"
                                        style={{ animation: `slideUp 0.4s ease-out ${(i + 4) * 0.07}s both` }}
                                    >
                                        <div className="col-span-6 sm:col-span-5 font-bold text-sm text-slate-800 dark:text-slate-200 truncate pr-2 group-hover:text-cyan-600 dark:group-hover:text-cyan-400 transition-colors duration-200">
                                            {project.projectTitle || project.name || 'Untitled Project'}
                                        </div>
                                        <div className="hidden sm:block sm:col-span-3 text-sm text-slate-400 dark:text-slate-500 font-medium truncate pr-2">
                                            {project.location || 'Unknown'}
                                        </div>
                                        <div className="col-span-4 sm:col-span-2">
                                            <span className={`inline-block px-2 py-1 rounded-md text-[10px] font-bold uppercase tracking-wide ${statusStyle(project.status)}`}>
                                                {project.status || 'DRAFT'}
                                            </span>
                                        </div>
                                        <div className="hidden sm:flex sm:col-span-2 items-center justify-end gap-3">
                                            <div className="w-16 h-1.5 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                                                <div
                                                    className="h-full rounded-full relative overflow-hidden"
                                                    style={{
                                                        width: `${project.progress || 0}%`,
                                                        background: project.progress > 0
                                                            ? 'linear-gradient(to right, #3b82f6, #06b6d4)'
                                                            : 'rgb(226 232 240)',
                                                    }}
                                                >
                                                    {project.progress > 0 && (
                                                        <div className="shimmer-bar absolute inset-0" />
                                                    )}
                                                </div>
                                            </div>
                                            <span className="text-xs font-extrabold text-slate-600 dark:text-slate-400 w-8 text-right">
                                                {project.progress || 0}%
                                            </span>
                                        </div>
                                    </div>
                                ))
                            )}
                        </div>
                    </div>

                    <div className="lg:w-4/12 space-y-6">

                        <div
                            className="relative overflow-hidden bg-white/70 dark:bg-slate-900/50 backdrop-blur-xl rounded-[24px] border border-white/80 dark:border-white/5 shadow-xl shadow-slate-200/50 dark:shadow-black/20 p-6"
                            style={{ animation: 'slideUp 0.5s ease-out 0.35s both' }}
                        >
                            <div className="absolute -bottom-10 -right-10 w-48 h-48 rounded-full bg-red-500/10 blur-3xl pointer-events-none" />

                            <div className="relative flex justify-between items-center mb-5">
                                <h3 className="font-extrabold text-[15px] tracking-tight text-slate-900 dark:text-white flex items-center gap-2">
                                    <AlertTriangle size={16} className="text-red-500" />
                                    Slippage Alerts
                                </h3>
                                <span className="bg-red-500/10 text-red-600 dark:text-red-400 border border-red-500/20 text-[10px] font-bold px-2.5 py-1 rounded-full tracking-wide">
                                    0 Critical
                                </span>
                            </div>
                            <div className="relative text-center py-6 text-xs text-slate-400 dark:text-slate-600 font-medium">
                                No critical alerts detected.
                            </div>
                        </div>

                        <div
                            className="bg-white/70 dark:bg-slate-900/50 backdrop-blur-xl rounded-[24px] border border-white/80 dark:border-white/5 shadow-xl shadow-slate-200/50 dark:shadow-black/20 p-6"
                            style={{ animation: 'slideUp 0.5s ease-out 0.45s both' }}
                        >
                            <h3 className="font-extrabold text-[15px] tracking-tight text-slate-900 dark:text-white mb-6 flex items-center gap-2">
                                <Activity size={16} className="text-blue-500 dark:text-cyan-400" />
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

export default DepwDashboard;