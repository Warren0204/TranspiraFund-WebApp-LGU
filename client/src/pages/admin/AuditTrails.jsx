import { useState, useEffect, useCallback } from 'react';
import { collection, query, orderBy, limit, getDocs, startAfter } from 'firebase/firestore';
import { db } from '../../config/firebase';
import AdminSidebar from '../../components/layout/AdminSidebar';

const PAGE_SIZE = 30;

const ACTION_CONFIG = {
    USER_LOGIN:         { label: 'User Login',       tw: 'bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300',       dot: 'bg-green-500'   },
    ACCOUNT_CREATED:    { label: 'Account Created',  tw: 'bg-teal-100 dark:bg-teal-900/40 text-teal-700 dark:text-teal-300',           dot: 'bg-teal-500'    },
    ACCOUNT_DELETED:    { label: 'Account Revoked',  tw: 'bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300',               dot: 'bg-red-500'     },
    OTP_VERIFIED:       { label: 'OTP Verified',     tw: 'bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300',   dot: 'bg-indigo-500'  },
    PASSWORD_CHANGED:   { label: 'Password Changed', tw: 'bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300',       dot: 'bg-amber-500'   },
    PASSWORD_RESET:     { label: 'Password Reset',   tw: 'bg-orange-100 dark:bg-orange-900/40 text-orange-700 dark:text-orange-300',   dot: 'bg-orange-500'  },
    STATS_RECALCULATED: { label: 'Stats Synced',     tw: 'bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300',   dot: 'bg-purple-500'  },
    PROFILE_UPDATED:      { label: 'Profile Updated',    tw: 'bg-sky-100 dark:bg-sky-900/40 text-sky-700 dark:text-sky-300',           dot: 'bg-sky-500'     },
    PROFILE_PHOTO_UPDATED:{ label: 'Photo Updated',      tw: 'bg-cyan-100 dark:bg-cyan-900/40 text-cyan-700 dark:text-cyan-300',       dot: 'bg-cyan-500'    },
};

const FILTERS = [
    { key: 'ALL',     label: 'All',           actions: null },
    { key: 'ACCOUNT', label: 'Account Events', actions: ['ACCOUNT_CREATED', 'ACCOUNT_DELETED'] },
    { key: 'AUTH',    label: 'Auth Events',    actions: ['USER_LOGIN', 'OTP_VERIFIED', 'PASSWORD_CHANGED', 'PASSWORD_RESET', 'PROFILE_UPDATED', 'PROFILE_PHOTO_UPDATED'] },
];

const fmt = (ts) => {
    if (!ts?.toDate) return '—';
    return ts.toDate().toLocaleString('en-PH', {
        month: 'short', day: 'numeric', year: 'numeric',
        hour: '2-digit', minute: '2-digit', hour12: true,
    });
};

const getDetails = (log) => {
    const t = log.target || {};
    switch (log.action) {
        case 'USER_LOGIN':
            return [
                `Authenticated login via OTP`,
                t.role  ? `Role: ${t.role}`  : null,
                t.name  ? `Name: ${t.name}`  : null,
            ].filter(Boolean);
        case 'ACCOUNT_CREATED':
            return [
                `Provisioned new ${t.role ?? ''} account`,
                t.email       ? `Email: ${t.email}`           : null,
                t.department  ? `Dept: ${t.department}`        : null,
            ].filter(Boolean);
        case 'ACCOUNT_DELETED':
            return [
                `Revoked access for ${t.role ?? ''} account`,
                t.email ? `Email: ${t.email}` : null,
            ].filter(Boolean);
        case 'OTP_VERIFIED':
            return ['Identity verified via OTP', 'Session authenticated'];
        case 'PASSWORD_CHANGED':
            return ['Password updated successfully', 'Forced change completed'];
        case 'PASSWORD_RESET':
            return ['Password reset via email link', 'Reset link consumed and invalidated'];
        case 'STATS_RECALCULATED': {
            const lines = ['Public stats document synced'];
            if (t.projectCount  !== undefined) lines.push(`Projects: ${t.projectCount}`);
            if (t.engineerCount !== undefined) lines.push(`Engineers: ${t.engineerCount}`);
            return lines;
        }
        case 'PROFILE_UPDATED':
            return [
                'Profile name updated',
                t.oldName ? `From: ${t.oldName}` : null,
                t.newName ? `To: ${t.newName}`   : null,
            ].filter(Boolean);
        case 'PROFILE_PHOTO_UPDATED':
            return ['Profile photo changed'];
        default:
            return ['—'];
    }
};

export default function AuditTrails() {
    const [logs, setLogs]               = useState([]);
    const [loading, setLoading]         = useState(true);
    const [lastDoc, setLastDoc]         = useState(null);
    const [hasMore, setHasMore]         = useState(false);
    const [loadingMore, setLoadingMore] = useState(false);
    const [filter, setFilter]           = useState('ALL');

    const fetchLogs = useCallback(async (isLoadMore = false) => {
        isLoadMore ? setLoadingMore(true) : setLoading(true);
        try {
            let q = query(
                collection(db, 'auditTrails', 'mis', 'entries'),
                orderBy('createdAt', 'desc'),
                limit(PAGE_SIZE)
            );
            if (isLoadMore && lastDoc) {
                q = query(
                    collection(db, 'auditTrails', 'mis', 'entries'),
                    orderBy('createdAt', 'desc'),
                    startAfter(lastDoc),
                    limit(PAGE_SIZE)
                );
            }
            const snap = await getDocs(q);
            const entries = snap.docs.map(d => ({ id: d.id, ...d.data() }));
            setLogs(prev => isLoadMore ? [...prev, ...entries] : entries);
            setLastDoc(snap.docs[snap.docs.length - 1] ?? null);
            setHasMore(snap.docs.length === PAGE_SIZE);
        } catch (err) {
            console.error('Failed to fetch audit trails:', err);
        } finally {
            isLoadMore ? setLoadingMore(false) : setLoading(false);
        }
    }, [lastDoc]);

    useEffect(() => { fetchLogs(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

    const activeFilter = FILTERS.find(f => f.key === filter);
    const visible = activeFilter?.actions
        ? logs.filter(l => activeFilter.actions.includes(l.action))
        : logs;

    return (
        <div className="min-h-screen hcsd-bg font-sans text-slate-900 dark:text-slate-100 transition-colors duration-300">
            <AdminSidebar />

            <main className="ml-0 md:ml-72 p-4 md:p-6 lg:p-10 pt-20 md:pt-10">

                {/* ── HEADER ── */}
                <div className="mb-8" style={{ animation: 'fadeIn 0.4s ease-out both' }}>
                    <div className="flex items-center gap-2.5 mb-2">
                        <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-teal-600 to-emerald-500 flex items-center justify-center shadow-md shadow-teal-500/30">
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14,2 14,8 20,8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10,9 9,9 8,9"/>
                            </svg>
                        </div>
                        <span className="text-[11px] font-extrabold uppercase tracking-[0.18em] text-teal-600 dark:text-emerald-400">
                            System Logs
                        </span>
                    </div>
                    <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-slate-900 dark:text-white">
                        Audit Trails
                    </h1>
                    <p className="text-sm text-slate-500 dark:text-slate-400 font-medium mt-1">
                        Immutable record of all system-level security events.
                    </p>
                </div>

                {/* ── FILTER TABS + REFRESH ── */}
                <div
                    className="flex items-center justify-between mb-4 gap-4 flex-wrap"
                    style={{ animation: 'slideUp 0.4s ease-out 0.05s both' }}
                >
                    <div className="flex items-center gap-1 p-1 bg-white/70 dark:bg-slate-900/50 backdrop-blur border border-white/80 dark:border-white/5 rounded-xl shadow-sm">
                        {FILTERS.map(f => (
                            <button
                                key={f.key}
                                onClick={() => setFilter(f.key)}
                                className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all duration-150 ${
                                    filter === f.key
                                        ? 'bg-teal-600 text-white shadow-sm shadow-teal-500/30'
                                        : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
                                }`}
                            >
                                {f.label}
                            </button>
                        ))}
                    </div>
                    <button
                        onClick={() => { setLastDoc(null); fetchLogs(); }}
                        disabled={loading}
                        className="flex items-center gap-2 px-4 py-2 text-xs font-bold text-slate-500 dark:text-slate-400 bg-white/70 dark:bg-slate-900/50 backdrop-blur border border-white/80 dark:border-white/5 rounded-xl shadow-sm hover:text-teal-600 dark:hover:text-teal-400 transition-colors disabled:opacity-50"
                    >
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={loading ? 'animate-spin' : ''}>
                            <polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
                        </svg>
                        Refresh
                    </button>
                </div>

                {/* ── LOG TABLE ── */}
                <div
                    className="bg-white/70 dark:bg-slate-900/50 backdrop-blur-xl border border-white/80 dark:border-white/5 rounded-[20px] shadow-xl overflow-hidden"
                    style={{ animation: 'slideUp 0.5s ease-out 0.1s both' }}
                >
                    {/* Table header — desktop only */}
                    <div className="hidden lg:grid grid-cols-[1.4fr_1.8fr_2.4fr_1.4fr] gap-4 px-6 py-3 border-b border-slate-100 dark:border-slate-700/40 bg-slate-50/60 dark:bg-slate-800/20">
                        <span className="text-[10px] font-extrabold uppercase tracking-[0.15em] text-slate-400 dark:text-slate-500">Event</span>
                        <span className="text-[10px] font-extrabold uppercase tracking-[0.15em] text-slate-400 dark:text-slate-500">Actor</span>
                        <span className="text-[10px] font-extrabold uppercase tracking-[0.15em] text-slate-400 dark:text-slate-500">Details</span>
                        <span className="text-[10px] font-extrabold uppercase tracking-[0.15em] text-slate-400 dark:text-slate-500 text-right">Timestamp</span>
                    </div>

                    {loading ? (
                        <div className="flex items-center justify-center py-20 gap-3 text-slate-400 dark:text-slate-500">
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="animate-spin">
                                <line x1="12" y1="2" x2="12" y2="6"/><line x1="12" y1="18" x2="12" y2="22"/><line x1="4.93" y1="4.93" x2="7.76" y2="7.76"/><line x1="16.24" y1="16.24" x2="19.07" y2="19.07"/><line x1="2" y1="12" x2="6" y2="12"/><line x1="18" y1="12" x2="22" y2="12"/><line x1="4.93" y1="19.07" x2="7.76" y2="16.24"/><line x1="16.24" y1="7.76" x2="19.07" y2="4.93"/>
                            </svg>
                            <span className="text-sm font-semibold">Loading logs…</span>
                        </div>
                    ) : visible.length === 0 ? (
                        <div className="flex flex-col items-center justify-center py-20 gap-3 text-slate-400 dark:text-slate-500">
                            <div className="w-12 h-12 rounded-xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center">
                                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14,2 14,8 20,8"/>
                                </svg>
                            </div>
                            <p className="text-sm font-semibold">No log entries found</p>
                            <p className="text-xs">System actions will appear here once they occur.</p>
                        </div>
                    ) : (
                        <div className="divide-y divide-slate-100 dark:divide-slate-700/30">
                            {visible.map((log, i) => {
                                const cfg = ACTION_CONFIG[log.action] ?? {
                                    label: log.action,
                                    tw:  'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300',
                                    dot: 'bg-slate-400',
                                };
                                const details = getDetails(log);
                                return (
                                    <div
                                        key={log.id}
                                        className="px-4 sm:px-6 py-4 hover:bg-slate-50/60 dark:hover:bg-slate-800/20 transition-colors"
                                        style={{ animation: `slideUp 0.3s ease-out ${i * 0.03}s both` }}
                                    >
                                        {/* ── MOBILE CARD ── */}
                                        <div className="lg:hidden space-y-3">
                                            <div className="flex items-center justify-between gap-2">
                                                <div className="flex items-center gap-2 min-w-0">
                                                    <div className={`w-2 h-2 rounded-full shrink-0 ${cfg.dot}`} />
                                                    <span className={`px-2.5 py-1 rounded-lg text-[11px] font-extrabold uppercase tracking-wide ${cfg.tw}`}>
                                                        {cfg.label}
                                                    </span>
                                                </div>
                                                <span className="text-[11px] text-slate-400 dark:text-slate-500 font-medium whitespace-nowrap shrink-0">
                                                    {fmt(log.createdAt)}
                                                </span>
                                            </div>

                                            <div className="pl-3 border-l-2 border-slate-200 dark:border-slate-700">
                                                {log.actor?.name && (
                                                    <p className="text-sm font-semibold text-slate-700 dark:text-slate-200 leading-snug">
                                                        {log.actor.name}
                                                    </p>
                                                )}
                                                <p className="text-xs font-mono text-slate-400 dark:text-slate-500 truncate mt-0.5">
                                                    {log.actor?.email || log.actorEmail || '—'}
                                                </p>
                                            </div>

                                            <div className={`pl-3 border-l-2 ${cfg.dot.replace('bg-', 'border-')}/40 space-y-0.5`}>
                                                {details.map((line, idx) => (
                                                    <p
                                                        key={idx}
                                                        className={`text-xs leading-relaxed ${
                                                            idx === 0
                                                                ? 'text-slate-700 dark:text-slate-200 font-semibold'
                                                                : 'text-slate-400 dark:text-slate-500'
                                                        }`}
                                                    >
                                                        {line}
                                                    </p>
                                                ))}
                                            </div>
                                        </div>

                                        {/* ── DESKTOP ROW ── */}
                                        <div className="hidden lg:grid grid-cols-[1.4fr_1.8fr_2.4fr_1.4fr] gap-4">
                                            <div className="flex items-start gap-2.5 min-w-0">
                                                <div className={`mt-1 w-1.5 h-1.5 rounded-full shrink-0 ${cfg.dot}`} />
                                                <span className={`inline-block px-2.5 py-0.5 rounded-md text-[10px] font-extrabold uppercase tracking-wide ${cfg.tw}`}>
                                                    {cfg.label}
                                                </span>
                                            </div>
                                            <div className="flex flex-col justify-center min-w-0">
                                                {log.actor?.name && (
                                                    <p className="text-xs font-semibold text-slate-700 dark:text-slate-200 truncate">
                                                        {log.actor.name}
                                                    </p>
                                                )}
                                                <p className="text-[11px] font-mono text-slate-400 dark:text-slate-500 truncate">
                                                    {log.actor?.email || log.actorEmail || '—'}
                                                </p>
                                            </div>
                                            <div className="flex flex-col justify-center gap-0.5 min-w-0">
                                                {details.map((line, idx) => (
                                                    <p
                                                        key={idx}
                                                        className={`text-[11px] font-mono truncate ${
                                                            idx === 0
                                                                ? 'text-slate-600 dark:text-slate-300 font-semibold'
                                                                : 'text-slate-400 dark:text-slate-500'
                                                        }`}
                                                    >
                                                        {line}
                                                    </p>
                                                ))}
                                            </div>
                                            <div className="flex justify-end items-center">
                                                <p className="text-[11px] text-slate-400 dark:text-slate-500 font-medium whitespace-nowrap">
                                                    {fmt(log.createdAt)}
                                                </p>
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}

                    {/* Load More */}
                    {hasMore && !loading && (
                        <div className="px-6 py-4 border-t border-slate-100 dark:border-slate-700/40">
                            <button
                                onClick={() => fetchLogs(true)}
                                disabled={loadingMore}
                                className="w-full py-2.5 text-xs font-bold text-slate-500 dark:text-slate-400 hover:text-teal-600 dark:hover:text-teal-400 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                            >
                                {loadingMore ? (
                                    <>
                                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="animate-spin">
                                            <line x1="12" y1="2" x2="12" y2="6"/><line x1="12" y1="18" x2="12" y2="22"/><line x1="4.93" y1="4.93" x2="7.76" y2="7.76"/><line x1="16.24" y1="16.24" x2="19.07" y2="19.07"/><line x1="2" y1="12" x2="6" y2="12"/><line x1="18" y1="12" x2="22" y2="12"/>
                                        </svg>
                                        Loading…
                                    </>
                                ) : 'Load more entries'}
                            </button>
                        </div>
                    )}
                </div>

            </main>
        </div>
    );
}
