import { useState, useEffect, useCallback } from 'react';
import { collection, query, orderBy, limit, getDocs, startAfter, onSnapshot } from 'firebase/firestore';
import { db } from '../../config/firebase';
import {
    Shield, Clock, Activity, LogIn,
    FolderKanban, UserPlus, UserX, Image, MessageSquare, UserCircle,
} from 'lucide-react';
import HcsdSidebar from '../../components/layout/HcsdSidebar';
import { useUsers } from '../../hooks/useUsers';

const PAGE_SIZE = 30;

// ── Event type registry ───────────────────────────────────────────────────────
const EVENT_META = {
    USER_LOGIN: {
        label: 'User Login',
        pill: 'bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300 border-green-200 dark:border-green-500/30',
        Icon: LogIn,
        iconBg: 'from-green-500 to-emerald-400',
        role: 'HCSD',
    },
    PROJECT_CREATED: {
        label: 'Project Created',
        pill: 'bg-teal-100 dark:bg-teal-900/40 text-teal-700 dark:text-teal-300 border-teal-200 dark:border-teal-500/30',
        Icon: FolderKanban,
        iconBg: 'from-teal-500 to-emerald-400',
        role: 'HCSD',
    },
    ACCOUNT_CREATED: {
        label: 'Staff Onboarded',
        pill: 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-500/30',
        Icon: UserPlus,
        iconBg: 'from-emerald-500 to-teal-400',
        role: 'HCSD',
    },
    ACCOUNT_DELETED: {
        label: 'Staff Removed',
        pill: 'bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300 border-red-200 dark:border-red-500/30',
        Icon: UserX,
        iconBg: 'from-red-500 to-rose-400',
        role: 'HCSD',
    },
    PHOTO_UPLOADED: {
        label: 'Photo Uploaded',
        pill: 'bg-sky-100 dark:bg-sky-900/40 text-sky-700 dark:text-sky-300 border-sky-200 dark:border-sky-500/30',
        Icon: Image,
        iconBg: 'from-sky-500 to-cyan-400',
        role: 'PROJ_ENG',
    },
    PHOTO_UPDATED: {
        label: 'Profile Photo Updated',
        pill: 'bg-violet-100 dark:bg-violet-900/40 text-violet-700 dark:text-violet-300 border-violet-200 dark:border-violet-500/30',
        Icon: UserCircle,
        iconBg: 'from-violet-500 to-purple-400',
        role: 'HCSD',
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
    role: 'HCSD',
};

const FILTERS = [
    { key: 'ALL', label: 'All', actions: null },
    { key: 'AUTH', label: 'Auth Events', actions: ['USER_LOGIN', 'PHOTO_UPDATED'] },
    { key: 'PROJECT', label: 'Project Events', actions: ['PROJECT_CREATED', 'PROJECT_UPDATE', 'PHOTO_UPLOADED'] },
    { key: 'STAFF', label: 'Staff Events', actions: ['ACCOUNT_CREATED', 'ACCOUNT_DELETED'] },
];

// ── Derive the "subject / entity" for a log entry ────────────────────────────
const getSubject = (log) => {
    const d = log.details || {};
    switch (log.action) {
        case 'USER_LOGIN':     return d.name || log.actorName || log.actorEmail?.split('@')[0] || 'HCSD User';
        case 'PHOTO_UPDATED':  return d.actorName || log.actorName || log.actorEmail?.split('@')[0] || 'HCSD User';
        case 'PROJECT_CREATED':return d.projectName || log.targetId || 'Untitled Project';
        case 'ACCOUNT_CREATED':return d.email || d.newUserEmail || log.targetId || 'Unknown Engineer';
        case 'ACCOUNT_DELETED':return d.deletedEmail || d.email || log.targetId || 'Unknown Engineer';
        case 'PHOTO_UPLOADED': return d.projectName || log.targetId || 'Project Photo';
        case 'PROJECT_UPDATE': return d.projectName || log.targetId || 'Project';
        default:               return log.targetId || log.action?.replace(/_/g, ' ') || '—';
    }
};

// ── Secondary descriptor line per event type ─────────────────────────────────
const getSubjectDetail = (log) => {
    const d = log.details || {};
    switch (log.action) {
        case 'USER_LOGIN':      return 'Authentication via OTP';
        case 'PHOTO_UPDATED':   return 'Profile photo changed';
        case 'PROJECT_CREATED': {
            const amt = d.contractAmount;
            if (amt) return `Contract: ₱${Number(amt).toLocaleString('en-PH')}`;
            return d.barangay ? `Barangay ${d.barangay}` : 'New project initialized';
        }
        case 'ACCOUNT_CREATED': return `${d.roleType || d.role || 'PROJ_ENG'} · ${d.department || 'CSDD, DEPW'}`;
        case 'ACCOUNT_DELETED': return 'Account and access permanently removed';
        case 'PHOTO_UPLOADED':  return 'Progress photo submitted via mobile';
        case 'PROJECT_UPDATE': {
            const pct = d.actualPercent ?? d.progress;
            return pct != null ? `Progress updated to ${pct}%` : 'Project details updated';
        }
        default: return null;
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
    const [mobileLogs, setMobileLogs] = useState([]);
    const [loading, setLoading] = useState(true);
    const [lastDoc, setLastDoc] = useState(null);
    const [hasMore, setHasMore] = useState(false);
    const [loadingMore, setLoadingMore] = useState(false);
    const [filter, setFilter] = useState('ALL');
    const [refreshKey, setRefreshKey] = useState(0);

    // Real-time directory — hydrates every actor's current name + photo.
    // Photo updates propagate instantly (no stale copies in audit entries).
    const { usersMap, displayName: userDisplayName } = useUsers();

    // ── Real-time listener: HCSD entries (project/account/auth events) ────────
    useEffect(() => {
        setLoading(true);
        setLogs([]);
        const q = query(
            collection(db, 'auditTrails', 'hcsd', 'entries'),
            orderBy('timestamp', 'desc'),
            limit(PAGE_SIZE)
        );
        const unsub = onSnapshot(q, (snap) => {
            const entries = snap.docs.map(d => ({ id: d.id, ...d.data() }));
            setLogs(entries);
            setLastDoc(snap.docs[snap.docs.length - 1] ?? null);
            setHasMore(snap.docs.length === PAGE_SIZE);
            setLoading(false);
        }, (err) => {
            console.error('Failed to sync HCSD audit trails:', err);
            setLoading(false);
        });
        return () => unsub();
    }, [refreshKey]);

    // ── Real-time listener: mobile entries (PHOTO_UPLOADED, PROJECT_UPDATE) ──
    // These are written by field engineers via the mobile app to a separate
    // subcollection. HCSD has read access per Firestore rules.
    useEffect(() => {
        setMobileLogs([]);
        const q = query(
            collection(db, 'auditTrails', 'mobile', 'entries'),
            orderBy('timestamp', 'desc'),
            limit(PAGE_SIZE)
        );
        const unsub = onSnapshot(q, (snap) => {
            const entries = snap.docs.map(d => ({ id: `mobile_${d.id}`, ...d.data() }));
            setMobileLogs(entries);
        }, () => {
            // Mobile collection may not exist yet — silently ignore
        });
        return () => unsub();
    }, [refreshKey]);

    // ── Load more (older entries, one-time fetch) ─────────────────────────────
    const fetchLogs = useCallback(async (isLoadMore = false) => {
        if (!isLoadMore || !lastDoc) return;
        setLoadingMore(true);
        try {
            const q = query(
                collection(db, 'auditTrails', 'hcsd', 'entries'),
                orderBy('timestamp', 'desc'),
                startAfter(lastDoc),
                limit(PAGE_SIZE)
            );
            const snap = await getDocs(q);
            const entries = snap.docs.map(d => ({ id: d.id, ...d.data() }));
            setLogs(prev => [...prev, ...entries]);
            setLastDoc(snap.docs[snap.docs.length - 1] ?? null);
            setHasMore(snap.docs.length === PAGE_SIZE);
        } catch (err) {
            console.error('Failed to load more audit trails:', err);
        } finally {
            setLoadingMore(false);
        }
    }, [lastDoc]);

    // Merge HCSD + mobile logs, sorted newest-first
    const allLogs = [...logs, ...mobileLogs].sort((a, b) => {
        const ta = a.timestamp?.toMillis?.() ?? 0;
        const tb = b.timestamp?.toMillis?.() ?? 0;
        return tb - ta;
    });

    // Apply filter
    const activeFilter = FILTERS.find(f => f.key === filter);
    const visible = activeFilter?.actions
        ? allLogs.filter(l => activeFilter.actions.includes(l.action))
        : allLogs;

    return (
        <div className="min-h-screen hcsd-bg font-sans text-slate-900 dark:text-slate-100">
            <HcsdSidebar />

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
                            Tamper-proof record of HCSD operations and staff activities.
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
                        onClick={() => setRefreshKey(k => k + 1)}
                        disabled={loading}
                        className="flex items-center gap-2 px-4 py-2 text-xs font-bold text-slate-500 dark:text-slate-400 bg-white/70 dark:bg-slate-900/50 backdrop-blur border border-white/80 dark:border-white/5 rounded-xl shadow-sm hover:text-teal-600 dark:hover:text-teal-400 transition-colors disabled:opacity-50 shrink-0"
                    >
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={loading ? 'animate-spin' : ''}>
                            <polyline points="23 4 23 10 17 10" /><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
                        </svg>
                        Refresh
                    </button>
                </div>

                {/* ══ MOBILE / TABLET — vertical cards (< lg) ══════════════════════ */}
                <div className="lg:hidden space-y-2" style={{ animation: 'slideUp 0.5s ease-out 0.1s both' }}>
                    {loading ? (
                        <div className="bg-white/70 dark:bg-slate-900/50 backdrop-blur-xl border border-white/80 dark:border-white/5 rounded-[24px] shadow-xl flex items-center justify-center py-24 gap-3 text-slate-400 dark:text-slate-500">
                            <SpinSVG />
                            <span className="text-sm font-semibold">Loading logs…</span>
                        </div>
                    ) : visible.length === 0 ? (
                        <div className="bg-white/70 dark:bg-slate-900/50 backdrop-blur-xl border border-white/80 dark:border-white/5 rounded-[24px] shadow-xl flex flex-col items-center justify-center py-24">
                            <div className="w-16 h-16 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center mb-4">
                                <Activity size={28} className="text-slate-300 dark:text-slate-600" />
                            </div>
                            <p className="text-slate-500 dark:text-slate-400 font-semibold">No events found</p>
                            <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">HCSD operations will appear here once they occur.</p>
                        </div>
                    ) : visible.map((log, i) => {
                        const meta = EVENT_META[log.action] ?? DEFAULT_META;
                        const { Icon } = meta;
                        const subject = getSubject(log);
                        const detail = getSubjectDetail(log);
                        const actorProfile = usersMap[log.actorUid];
                        const actor = userDisplayName(log.actorUid) || log.actorEmail || '—';
                        const initials = actorProfile
                            ? (`${actorProfile.firstName?.[0] ?? ''}${actorProfile.lastName?.[0] ?? ''}`.toUpperCase() || emailInitials(log.actorEmail))
                            : emailInitials(log.actorEmail);
                        const { date, time } = fmtDate(log.timestamp);
                        const photoURL = actorProfile?.photoURL ?? null;
                        return (
                            <div key={log.id}
                                className="group bg-white/60 dark:bg-slate-800/30 border border-white/80 dark:border-slate-700/40 hover:bg-white/90 dark:hover:bg-slate-800/60 hover:border-teal-200 dark:hover:border-teal-500/30 hover:shadow-lg rounded-2xl transition-all duration-200"
                                style={{ animation: `slideUp 0.4s ease-out ${i * 0.05}s both` }}>
                                <div className="flex items-center gap-3 px-4 py-4">
                                    <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${meta.iconBg} flex items-center justify-center shrink-0 shadow-md group-hover:scale-105 transition-transform duration-200`}>
                                        <Icon size={17} className="text-white" strokeWidth={2} />
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold border mb-1 ${meta.pill}`}>
                                            {meta.label}
                                        </span>
                                        <p className="font-bold text-slate-800 dark:text-slate-100 text-sm truncate group-hover:text-teal-700 dark:group-hover:text-teal-300 transition-colors">{subject}</p>
                                        {detail && <p className="text-[10px] text-slate-400 dark:text-slate-500 font-medium truncate mt-0.5">{detail}</p>}
                                        <div className="flex items-center gap-1.5 mt-1.5">
                                            <ActorAvatar photoURL={photoURL} initials={initials} sizePx={16} />
                                            <span className="text-[11px] text-slate-500 dark:text-slate-400 truncate">{actor}</span>
                                        </div>
                                    </div>
                                    <div className="text-right shrink-0">
                                        <p className="text-[11px] font-bold text-slate-600 dark:text-slate-300 whitespace-nowrap">{date}</p>
                                        <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-0.5">{time}</p>
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                    {hasMore && !loading && (
                        <button onClick={() => fetchLogs(true)} disabled={loadingMore}
                            className="w-full py-3 text-xs font-bold text-slate-500 dark:text-slate-400 hover:text-teal-600 dark:hover:text-teal-400 bg-white/60 dark:bg-slate-800/30 border border-white/80 dark:border-slate-700/40 rounded-2xl transition-all disabled:opacity-50 flex items-center justify-center gap-2">
                            {loadingMore ? <><SpinSVG size={13} /> Loading…</> : 'Load more entries'}
                        </button>
                    )}
                    {!loading && visible.length > 0 && (
                        <div className="flex items-center justify-center gap-2 py-3">
                            <Shield size={12} className="text-slate-300 dark:text-slate-600 shrink-0" />
                            <p className="text-[11px] font-semibold text-slate-300 dark:text-slate-600">All entries are write-protected. Only the system can append to this log.</p>
                        </div>
                    )}
                </div>

                {/* ══ DESKTOP — horizontal table inside glass card (lg+) ════════════ */}
                <div className="hidden lg:block bg-white/70 dark:bg-slate-900/50 backdrop-blur-xl border border-white/80 dark:border-white/5 rounded-[24px] shadow-xl overflow-hidden"
                    style={{ animation: 'slideUp 0.5s ease-out 0.1s both' }}>

                    {/* Column headers — Event(3) | Subject(4) | Actor(3) | Timestamp(2) */}
                    <div className="grid grid-cols-12 px-6 py-3.5 bg-slate-50/70 dark:bg-slate-800/30 border-b border-slate-100 dark:border-slate-700/40 text-[11px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-[0.1em]">
                        <div className="col-span-3">Event</div>
                        <div className="col-span-4">Subject / Entity</div>
                        <div className="col-span-3">Actor</div>
                        <div className="col-span-2 text-right">Timestamp</div>
                    </div>

                    {/* Rows */}
                    <div className="divide-y divide-slate-100/70 dark:divide-slate-700/30">
                        {loading ? (
                            <div className="flex items-center justify-center py-24 gap-3 text-slate-400 dark:text-slate-500">
                                <SpinSVG /><span className="text-sm font-semibold">Loading logs…</span>
                            </div>
                        ) : visible.length === 0 ? (
                            <div className="flex flex-col items-center justify-center py-24">
                                <div className="w-16 h-16 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center mb-4">
                                    <Activity size={28} className="text-slate-300 dark:text-slate-600" />
                                </div>
                                <p className="text-slate-500 dark:text-slate-400 font-semibold">No events found</p>
                                <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">HCSD operations will appear here once they occur.</p>
                            </div>
                        ) : visible.map((log, i) => {
                            const meta = EVENT_META[log.action] ?? DEFAULT_META;
                            const { Icon } = meta;
                            const subject = getSubject(log);
                            const detail = getSubjectDetail(log);
                            const actorProfile = usersMap[log.actorUid];
                            const actor = userDisplayName(log.actorUid) || log.actorEmail || '—';
                            const initials = actorProfile
                                ? (`${actorProfile.firstName?.[0] ?? ''}${actorProfile.lastName?.[0] ?? ''}`.toUpperCase() || emailInitials(log.actorEmail))
                                : emailInitials(log.actorEmail);
                            const { date, time } = fmtDate(log.timestamp);
                            const photoURL = actorProfile?.photoURL ?? null;
                            return (
                                <div key={log.id}
                                    className="group grid grid-cols-12 items-center px-6 py-4 hover:bg-teal-500/[0.04] dark:hover:bg-teal-500/[0.06] border-l-2 border-transparent hover:border-teal-500 transition-all duration-200"
                                    style={{ animation: `slideUp 0.4s ease-out ${i * 0.05}s both` }}>

                                    {/* Col 1 — Event type pill with icon embedded */}
                                    <div className="col-span-3 pr-3">
                                        <span className={`inline-flex items-center gap-2 pl-1.5 pr-3 py-1.5 rounded-xl text-[11px] font-bold border ${meta.pill}`}>
                                            <span className={`w-6 h-6 rounded-lg bg-gradient-to-br ${meta.iconBg} flex items-center justify-center shrink-0 shadow-sm group-hover:scale-110 transition-transform duration-200`}>
                                                <Icon size={12} className="text-white" strokeWidth={2.5} />
                                            </span>
                                            {meta.label}
                                        </span>
                                    </div>

                                    {/* Col 2 — Subject + descriptor */}
                                    <div className="col-span-4 pr-4 min-w-0">
                                        <p className="font-bold text-slate-700 dark:text-slate-200 text-sm truncate group-hover:text-teal-700 dark:group-hover:text-teal-300 transition-colors">
                                            {subject}
                                        </p>
                                        {detail && (
                                            <p className="text-[10px] text-slate-400 dark:text-slate-500 font-medium truncate mt-0.5">{detail}</p>
                                        )}
                                    </div>

                                    {/* Col 3 — Actor */}
                                    <div className="col-span-3 flex items-center gap-2.5 min-w-0 pr-3">
                                        <ActorAvatar photoURL={photoURL} initials={initials} sizePx={30} />
                                        <div className="min-w-0">
                                            <p className="text-xs font-semibold text-slate-600 dark:text-slate-300 truncate">{actor}</p>
                                            <p className="text-[10px] font-bold text-teal-600 dark:text-teal-400 uppercase tracking-wide mt-0.5">{meta.role}</p>
                                        </div>
                                    </div>

                                    {/* Col 4 — Timestamp */}
                                    <div className="col-span-2 text-right">
                                        <p className="text-xs font-bold text-slate-700 dark:text-slate-200 whitespace-nowrap">{date}</p>
                                        <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-0.5 flex items-center justify-end gap-1 whitespace-nowrap">
                                            <Clock size={10} />{time}
                                        </p>
                                    </div>
                                </div>
                            );
                        })}
                    </div>

                    {/* Load more */}
                    {hasMore && !loading && (
                        <div className="px-6 py-4 border-t border-slate-100 dark:border-slate-700/40">
                            <button onClick={() => fetchLogs(true)} disabled={loadingMore}
                                className="w-full py-2.5 text-xs font-bold text-slate-500 dark:text-slate-400 hover:text-teal-600 dark:hover:text-teal-400 transition-colors disabled:opacity-50 flex items-center justify-center gap-2">
                                {loadingMore ? <><SpinSVG size={13} /> Loading…</> : 'Load more entries'}
                            </button>
                        </div>
                    )}

                    {/* Footer */}
                    <div className="px-6 py-3.5 border-t border-slate-100 dark:border-slate-700/40 bg-slate-50/50 dark:bg-slate-800/20 flex items-center justify-center gap-2">
                        <Shield size={13} className="text-slate-400 dark:text-slate-500 shrink-0" />
                        <p className="text-xs font-semibold text-slate-400 dark:text-slate-500">
                            All entries are write-protected. Only the system can append to this log.
                        </p>
                    </div>
                </div>

            </main>
        </div>
    );
}
