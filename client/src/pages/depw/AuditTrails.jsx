import { useState, useEffect, useCallback, useRef } from 'react';
import { collection, query, orderBy, limit, getDocs, startAfter, doc, getDoc } from 'firebase/firestore';
import { db } from '../../config/firebase';
import {
    Shield, Clock, Activity,
    FolderKanban, UserPlus, UserX, Image, MessageSquare,
} from 'lucide-react';
import DepwSidebar from '../../components/layout/DepwSidebar';

const PAGE_SIZE = 30;

// ── Event type registry ───────────────────────────────────────────────────────
const EVENT_META = {
    PROJECT_CREATED: {
        label: 'Project Created',
        pill: 'bg-teal-100 dark:bg-teal-900/40 text-teal-700 dark:text-teal-300 border-teal-200 dark:border-teal-500/30',
        Icon: FolderKanban,
        iconBg: 'from-teal-500 to-emerald-400',
        role: 'DEPW',
    },
    ACCOUNT_CREATED: {
        label: 'Staff Onboarded',
        pill: 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-500/30',
        Icon: UserPlus,
        iconBg: 'from-emerald-500 to-teal-400',
        role: 'DEPW',
    },
    ACCOUNT_DELETED: {
        label: 'Staff Removed',
        pill: 'bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300 border-red-200 dark:border-red-500/30',
        Icon: UserX,
        iconBg: 'from-red-500 to-rose-400',
        role: 'DEPW',
    },
    PHOTO_UPLOADED: {
        label: 'Photo Uploaded',
        pill: 'bg-sky-100 dark:bg-sky-900/40 text-sky-700 dark:text-sky-300 border-sky-200 dark:border-sky-500/30',
        Icon: Image,
        iconBg: 'from-sky-500 to-cyan-400',
        role: 'PROJ_ENG',
    },
    PROJECT_UPDATE: {
        label: 'Project Updated',
        pill: 'bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-500/30',
        Icon: MessageSquare,
        iconBg: 'from-amber-500 to-orange-400',
        role: 'PROJ_ENG',
    },
};

const DEFAULT_META = {
    label: 'System Event',
    pill: 'bg-slate-100 dark:bg-slate-700/60 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-600',
    Icon: Activity,
    iconBg: 'from-slate-400 to-slate-500',
    role: 'DEPW',
};

const FILTERS = [
    { key: 'ALL', label: 'All', actions: null },
    { key: 'PROJECT', label: 'Project Events', actions: ['PROJECT_CREATED', 'PROJECT_UPDATE', 'PHOTO_UPLOADED'] },
    { key: 'STAFF', label: 'Staff Events', actions: ['ACCOUNT_CREATED', 'ACCOUNT_DELETED'] },
];

// ── Derive the "subject / entity" for a log entry ────────────────────────────
const getSubject = (log) => {
    const d = log.details || {};
    switch (log.action) {
        case 'PROJECT_CREATED': return d.projectTitle || log.targetId || 'Untitled Project';
        case 'ACCOUNT_CREATED': return d.email || log.targetId || 'Unknown Engineer';
        case 'ACCOUNT_DELETED': return d.deletedEmail || log.targetId || 'Unknown Engineer';
        case 'PHOTO_UPLOADED': return d.projectTitle || log.targetId || 'Project Photo';
        case 'PROJECT_UPDATE': return d.projectTitle || log.targetId || 'Project';
        default: return log.targetId || '—';
    }
};

// ── Timestamp formatter ───────────────────────────────────────────────────────
const fmtDate = (ts) => {
    if (!ts?.toDate) return { date: '—', time: '' };
    const d = ts.toDate();
    return {
        date: d.toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' }),
        time: d.toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit', hour12: true }),
    };
};

// ── Actor initials from email ─────────────────────────────────────────────────
const emailInitials = (email = '') => {
    const local = email.split('@')[0] || '';
    const parts = local.split(/[._\-]/).filter(Boolean);
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
    return (local.slice(0, 2) || 'DE').toUpperCase();
};

// ── Actor avatar: real photo if available, else initials fallback ─────────────
// Uses inline styles for size so Tailwind purging never strips the dimensions.
function ActorAvatar({ photoURL, initials, sizePx = 32 }) {
    const style = {
        width: sizePx,
        height: sizePx,
        minWidth: sizePx,
        minHeight: sizePx,
        fontSize: Math.max(8, Math.round(sizePx * 0.36)) + 'px',
    };
    if (photoURL) {
        return (
            <img
                src={photoURL}
                alt={initials}
                style={style}
                className="rounded-full object-cover shrink-0 shadow-md ring-1 ring-white/60 dark:ring-slate-700/60"
            />
        );
    }
    return (
        <div style={style}
            className="rounded-full bg-gradient-to-br from-teal-500 to-cyan-400 flex items-center justify-center text-white font-extrabold shrink-0 shadow-md">
            {initials}
        </div>
    );
}

const SpinSVG = ({ size = 18 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
        strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="animate-spin">
        <line x1="12" y1="2" x2="12" y2="6" /><line x1="12" y1="18" x2="12" y2="22" />
        <line x1="4.93" y1="4.93" x2="7.76" y2="7.76" /><line x1="16.24" y1="16.24" x2="19.07" y2="19.07" />
        <line x1="2" y1="12" x2="6" y2="12" /><line x1="18" y1="12" x2="22" y2="12" />
        <line x1="4.93" y1="19.07" x2="7.76" y2="16.24" /><line x1="16.24" y1="7.76" x2="19.07" y2="4.93" />
    </svg>
);

export default function AuditTrails() {
    const [logs, setLogs] = useState([]);
    const [loading, setLoading] = useState(true);
    const [lastDoc, setLastDoc] = useState(null);
    const [hasMore, setHasMore] = useState(false);
    const [loadingMore, setLoadingMore] = useState(false);
    const [filter, setFilter] = useState('ALL');
    const [actorProfiles, setActorProfiles] = useState({});
    const loadedUids = useRef(new Set());

    // ── Batch-load profile photos for any new actor UIDs ─────────────────────
    const loadActorProfiles = useCallback(async (entries) => {
        const uids = [...new Set(entries.map(l => l.actorUid).filter(Boolean))];
        const missing = uids.filter(uid => !loadedUids.current.has(uid));
        if (missing.length === 0) return;

        missing.forEach(uid => loadedUids.current.add(uid));

        const results = await Promise.allSettled(
            missing.map(uid => getDoc(doc(db, 'users', uid)))
        );

        const updates = {};
        results.forEach((res, i) => {
            const uid = missing[i];
            updates[uid] = {
                photoURL: (res.status === 'fulfilled' && res.value.exists())
                    ? (res.value.data().photoURL || null)
                    : null,
            };
        });

        setActorProfiles(prev => ({ ...prev, ...updates }));
    }, []);

    // ── Fetch audit log entries ───────────────────────────────────────────────
    const fetchLogs = useCallback(async (isLoadMore = false) => {
        isLoadMore ? setLoadingMore(true) : setLoading(true);
        try {
            let q = query(
                collection(db, 'depwAuditTrails'),
                orderBy('timestamp', 'desc'),
                limit(PAGE_SIZE)
            );
            if (isLoadMore && lastDoc) {
                q = query(
                    collection(db, 'depwAuditTrails'),
                    orderBy('timestamp', 'desc'),
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
            console.error('Failed to fetch DEPW audit trails:', err);
        } finally {
            isLoadMore ? setLoadingMore(false) : setLoading(false);
        }
    }, [lastDoc]); // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => { fetchLogs(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

    // Load actor profiles whenever logs change
    useEffect(() => {
        if (logs.length > 0) loadActorProfiles(logs);
    }, [logs]); // eslint-disable-line react-hooks/exhaustive-deps

    // Apply filter
    const activeFilter = FILTERS.find(f => f.key === filter);
    const visible = activeFilter?.actions
        ? logs.filter(l => activeFilter.actions.includes(l.action))
        : logs;

    return (
        <div className="min-h-screen depw-bg font-sans text-slate-900 dark:text-slate-100">
            <DepwSidebar />

            <main className="ml-0 md:ml-72 p-4 md:p-6 lg:p-10 pt-20 md:pt-10">

                {/* ── PAGE HEADER ───────────────────────────────────── */}
                <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4 mb-8"
                    style={{ animation: 'fadeIn 0.4s ease-out both' }}>
                    <div>
                        <div className="inline-flex items-center gap-2 bg-slate-500/10 dark:bg-slate-400/10 border border-slate-400/20 rounded-full px-3 py-1 mb-3">
                            <div className="w-1.5 h-1.5 rounded-full bg-slate-500 dark:bg-slate-400" />
                            <span className="text-xs font-bold text-slate-600 dark:text-slate-300 uppercase tracking-widest">Immutable Log</span>
                        </div>
                        <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 dark:text-white tracking-tight">
                            Audit Trails
                        </h1>
                        <p className="text-slate-500 dark:text-slate-400 font-medium mt-1 text-sm">
                            Tamper-proof record of DEPW operations and staff activities.
                        </p>
                    </div>
                </div>

                {/* ── FILTER TABS + REFRESH ─────────────────────────── */}
                <div className="flex items-center justify-between mb-4 gap-4 flex-wrap"
                    style={{ animation: 'slideUp 0.4s ease-out 0.05s both' }}>
                    <div className="flex items-center gap-1 p-1 bg-white/70 dark:bg-slate-900/50 backdrop-blur border border-white/80 dark:border-white/5 rounded-xl shadow-sm overflow-x-auto">
                        {FILTERS.map(f => (
                            <button
                                key={f.key}
                                onClick={() => setFilter(f.key)}
                                className={`px-3 sm:px-4 py-1.5 rounded-lg text-xs font-bold transition-all duration-150 whitespace-nowrap ${filter === f.key
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
                        className="flex items-center gap-2 px-4 py-2 text-xs font-bold text-slate-500 dark:text-slate-400 bg-white/70 dark:bg-slate-900/50 backdrop-blur border border-white/80 dark:border-white/5 rounded-xl shadow-sm hover:text-teal-600 dark:hover:text-teal-400 transition-colors disabled:opacity-50 shrink-0"
                    >
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={loading ? 'animate-spin' : ''}>
                            <polyline points="23 4 23 10 17 10" /><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
                        </svg>
                        Refresh
                    </button>
                </div>

                {/* ── MAIN CARD ─────────────────────────────────────── */}
                <div className="bg-white/70 dark:bg-slate-900/50 backdrop-blur-xl border border-white/80 dark:border-white/5 rounded-[24px] shadow-xl overflow-hidden flex flex-col"
                    style={{ animation: 'slideUp 0.5s ease-out 0.1s both' }}>

                    {/* TABLE HEADER — lg+ only
                        Grid: Event(3) | Subject(4) | Actor(3) | Timestamp(2) = 12
                    */}
                    <div className="hidden lg:grid grid-cols-12 px-7 py-3.5 bg-slate-50/70 dark:bg-slate-800/30 border-b border-slate-100 dark:border-slate-700/40 text-[11px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-[0.1em]">
                        <div className="col-span-3">Event</div>
                        <div className="col-span-4">Subject / Entity</div>
                        <div className="col-span-3">Actor</div>
                        <div className="col-span-2 text-right">Timestamp</div>
                    </div>

                    {/* LOG LIST */}
                    <div className="flex-1 overflow-auto divide-y divide-slate-100/70 dark:divide-slate-700/30">

                        {loading ? (
                            <div className="flex items-center justify-center py-24 gap-3 text-slate-400 dark:text-slate-500">
                                <SpinSVG />
                                <span className="text-sm font-semibold">Loading logs…</span>
                            </div>

                        ) : visible.length === 0 ? (
                            <div className="flex flex-col items-center justify-center py-24">
                                <div className="w-16 h-16 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center mb-4">
                                    <Activity size={28} className="text-slate-300 dark:text-slate-600" />
                                </div>
                                <p className="text-slate-500 dark:text-slate-400 font-semibold">No events found</p>
                                <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">
                                    DEPW operations will appear here once they occur.
                                </p>
                            </div>

                        ) : visible.map((log, i) => {
                            const meta = EVENT_META[log.action] ?? DEFAULT_META;
                            const { Icon } = meta;
                            const subject = getSubject(log);
                            const actor = log.actorEmail || '—';
                            const initials = emailInitials(log.actorEmail);
                            const { date, time } = fmtDate(log.timestamp);
                            const photoURL = actorProfiles[log.actorUid]?.photoURL ?? null;

                            return (
                                <div key={log.id} style={{ animation: `slideUp 0.4s ease-out ${i * 0.05}s both` }}>

                                    {/* ── CARD — mobile + tablet (< lg) ───────── */}
                                    <div className="lg:hidden px-4 sm:px-6 py-4 hover:bg-teal-500/5 dark:hover:bg-teal-500/5 border-l-2 border-transparent hover:border-teal-400 transition-all">
                                        {/* Row 1: Event pill + Timestamp */}
                                        <div className="flex items-start justify-between gap-3 mb-3">
                                            <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold border shrink-0 ${meta.pill}`}>
                                                <Icon size={11} className="shrink-0" />
                                                {meta.label}
                                            </span>
                                            <div className="text-right shrink-0">
                                                <p className="text-xs font-bold text-slate-700 dark:text-slate-200 whitespace-nowrap">{date}</p>
                                                <p className="text-[10px] font-medium text-slate-400 dark:text-slate-500 flex items-center justify-end gap-0.5 mt-0.5">
                                                    <Clock size={9} />{time}
                                                </p>
                                            </div>
                                        </div>
                                        {/* Rows 2+3: Event icon → line → Actor avatar (shared left column) */}
                                        <div className="flex gap-3">
                                            {/* Left column: icon → line → avatar */}
                                            <div className="flex flex-col items-center shrink-0">
                                                <div className={`w-8 h-8 rounded-xl bg-gradient-to-br ${meta.iconBg} flex items-center justify-center shadow-sm`}>
                                                    <Icon size={14} className="text-white" />
                                                </div>
                                                <div className="w-0.5 flex-1 min-h-[12px] bg-gradient-to-b from-teal-300 to-teal-200 dark:from-teal-600 dark:to-teal-700 rounded-full" />
                                                <ActorAvatar photoURL={photoURL} initials={initials} sizePx={24} />
                                            </div>
                                            {/* Right column: subject text + actor info */}
                                            <div className="flex-1 min-w-0 flex flex-col justify-between">
                                                <p className="font-bold text-slate-800 dark:text-slate-100 text-sm leading-snug line-clamp-2 pt-1">{subject}</p>
                                                <div className="pb-0.5">
                                                    <p className="text-[11px] font-semibold text-slate-600 dark:text-slate-300 truncate font-mono leading-tight">{actor}</p>
                                                    <p className="text-[10px] font-bold text-teal-600 dark:text-teal-400 uppercase tracking-wide mt-0.5">{meta.role}</p>
                                                </div>
                                            </div>
                                        </div>
                                    </div>

                                    {/* ── TABLE ROW — desktop only (lg+) ───────── */}
                                    <div className="hidden lg:grid grid-cols-12 items-center px-7 py-4 hover:bg-teal-500/5 dark:hover:bg-teal-500/5 border-l-2 border-transparent hover:border-teal-500 transition-all duration-200 group">

                                        {/* Col 1 — Event */}
                                        <div className="col-span-3">
                                            <span className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold border ${meta.pill}`}>
                                                <Icon size={12} className="shrink-0" />
                                                {meta.label}
                                            </span>
                                        </div>

                                        {/* Col 2 — Subject / Entity */}
                                        <div className="col-span-4 flex items-center gap-3 pr-3 min-w-0">
                                            <div className={`w-8 h-8 rounded-xl bg-gradient-to-br ${meta.iconBg} flex items-center justify-center shrink-0 shadow-md`}>
                                                <Icon size={15} className="text-white" />
                                            </div>
                                            <span className="font-bold text-slate-700 dark:text-slate-200 text-sm truncate group-hover:text-teal-700 dark:group-hover:text-teal-300 transition-colors">
                                                {subject}
                                            </span>
                                        </div>

                                        {/* Col 3 — Actor */}
                                        <div className="col-span-3 flex items-center gap-3 min-w-0">
                                            <ActorAvatar photoURL={photoURL} initials={initials} sizePx={32} />
                                            <div className="min-w-0">
                                                <p className="text-xs font-semibold text-slate-600 dark:text-slate-300 truncate font-mono">{actor}</p>
                                                <p className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wide mt-0.5">{meta.role}</p>
                                            </div>
                                        </div>

                                        {/* Col 4 — Timestamp */}
                                        <div className="col-span-2 text-right">
                                            <p className="text-sm font-bold text-slate-700 dark:text-slate-200">{date}</p>
                                            <p className="text-xs font-medium text-slate-400 dark:text-slate-500 mt-0.5 flex items-center justify-end gap-1">
                                                <Clock size={10} />{time}
                                            </p>
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>

                    {/* Load more */}
                    {hasMore && !loading && (
                        <div className="px-7 py-4 border-t border-slate-100 dark:border-slate-700/40">
                            <button
                                onClick={() => fetchLogs(true)}
                                disabled={loadingMore}
                                className="w-full py-2.5 text-xs font-bold text-slate-500 dark:text-slate-400 hover:text-teal-600 dark:hover:text-teal-400 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                            >
                                {loadingMore ? <><SpinSVG size={13} /> Loading…</> : 'Load more entries'}
                            </button>
                        </div>
                    )}

                    {/* Footer */}
                    <div className="px-7 py-4 border-t border-slate-100 dark:border-slate-700/40 bg-slate-50/50 dark:bg-slate-800/20 flex items-center gap-2">
                        <Shield size={14} className="text-slate-400 dark:text-slate-500 shrink-0" />
                        <p className="text-xs font-semibold text-slate-400 dark:text-slate-500">
                            All entries are write-protected. Only the system can append to this log.
                        </p>
                    </div>
                </div>

            </main>
        </div>
    );
}
