import { useState, useEffect, useMemo, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
    ArrowLeft, MapPin, Calendar, Users, TrendingUp, FileText,
    ClipboardList, AlertTriangle, CheckCircle2, Clock,
    Hash, Banknote, Flag, ExternalLink, ChevronDown, ChevronUp,
    ImageIcon, X as XIcon
} from 'lucide-react';
import HcsdSidebar from '../../components/layout/HcsdSidebar';
import { doc, collection, query, onSnapshot } from 'firebase/firestore';
import { getStorage, ref as storageRef, listAll, getDownloadURL } from 'firebase/storage';
import exifr from 'exifr';
import { db } from '../../config/firebase';
import { useUsers } from '../../hooks/useUsers';

// Canonical mobile proof contract: { id, fileName, url, storagePath,
// uploadedBy, uploadedAt, gps: {lat,lng}, accuracy, location, capturedAt }.
// Legacy docs still carry flat latitude/longitude + ms-epoch `timestamp`;
// tolerated here during the mobile migration window.
const normalizeProof = (p) => {
    if (!p || typeof p !== 'object') return null;
    const lat = p.gps?.lat ?? p.latitude;
    const lng = p.gps?.lng ?? p.longitude;
    const raw = p.capturedAt ?? p.timestamp;
    const capturedAt =
        raw?.toDate ? raw.toDate()
        : typeof raw === 'number' ? new Date(raw)
        : raw instanceof Date ? raw
        : typeof raw === 'string' ? raw
        : null;
    return {
        name: p.fileName ?? p.name,
        url: p.url,
        capturedAt,
        gps: (lat != null && lng != null) ? { lat: Number(lat), lng: Number(lng) } : null,
        accuracy: typeof p.accuracy === 'number' ? p.accuracy : null,
        location: typeof p.location === 'string' ? p.location : null,
    };
};

/* ── helpers ──────────────────────────────────────────────────────────────── */
const fmt = (val) => (val === null || val === undefined || val === '') ? '—' : val;

const fmtDate = (str) => {
    if (!str) return '—';
    try {
        return new Date(str).toLocaleDateString('en-PH', { month: 'long', day: 'numeric', year: 'numeric' });
    } catch { return str; }
};

const fmtCurrency = (amt) => {
    if (!amt && amt !== 0) return '—';
    return `₱${Number(amt).toLocaleString('en-PH', { minimumFractionDigits: 2 })}`;
};

const diffDays = (a, b) => {
    if (!a || !b) return null;
    const ms = new Date(b) - new Date(a);
    return isNaN(ms) ? null : Math.round(ms / 86400000);
};

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

const statusMeta = (s) => {
    switch ((s || '').toLowerCase()) {
        case 'completed': return { pill: 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-500/30', bar: 'from-emerald-500 to-teal-400', dot: 'bg-emerald-500' };
        case 'ongoing':   return { pill: 'bg-teal-100 dark:bg-teal-900/40 text-teal-700 dark:text-teal-300 border-teal-200 dark:border-teal-500/30',    bar: 'from-teal-500 to-emerald-400',  dot: 'bg-teal-500' };
        case 'delayed':   return { pill: 'bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-500/30', bar: 'from-amber-400 to-yellow-300',  dot: 'bg-amber-400' };
        default:          return { pill: 'bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-500/30', bar: 'from-amber-400 to-yellow-300',  dot: 'bg-amber-400' };
    }
};

/* ── sub-components ───────────────────────────────────────────────────────── */
const SectionCard = ({ icon: Icon, title, children, accent = 'teal', className = '' }) => (
    <div className={`bg-white/70 dark:bg-slate-900/50 backdrop-blur-xl border border-white/80 dark:border-white/5 rounded-[20px] shadow-md overflow-hidden ${className}`}
        style={{ animation: 'slideUp 0.4s ease-out both' }}>
        <div className="flex items-center gap-3 px-6 py-4 border-b border-slate-100 dark:border-slate-700/50 bg-white/40 dark:bg-slate-800/20">
            <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 bg-gradient-to-br ${accent === 'amber' ? 'from-amber-500 to-yellow-400' : accent === 'rose' ? 'from-rose-500 to-red-400' : 'from-teal-500 to-emerald-400'}`}>
                <Icon size={15} className="text-white" />
            </div>
            <h3 className="text-sm font-extrabold text-slate-700 dark:text-slate-200 uppercase tracking-wider">{title}</h3>
        </div>
        <div className="p-6">{children}</div>
    </div>
);

const Field = ({ label, value, highlight, mono }) => (
    <div>
        <p className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-1">{label}</p>
        <p className={`text-sm font-semibold leading-snug ${highlight ? 'text-teal-600 dark:text-teal-400' : 'text-slate-800 dark:text-slate-100'} ${mono ? 'font-mono' : ''} ${value === '—' ? 'text-slate-400 dark:text-slate-600 font-medium' : ''}`}>
            {value}
        </p>
    </div>
);

const FieldGrid = ({ children, cols = 2 }) => (
    <div className={`grid grid-cols-1 sm:grid-cols-${cols} gap-x-8 gap-y-5`}>{children}</div>
);

const LoaderSpinner = () => (
    <svg className="animate-spin h-8 w-8 text-teal-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
    </svg>
);

/* ── stat tile for accomplishment ─────────────────────────────────────────── */
const StatTile = ({ label, value, unit = '%', sub, warn, good }) => (
    <div className={`rounded-2xl p-5 border flex flex-col gap-1
        ${warn ? 'bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-500/30'
               : good ? 'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-500/30'
               : 'bg-slate-50 dark:bg-slate-800/40 border-slate-200 dark:border-slate-700/50'}`}>
        <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 dark:text-slate-500">{label}</p>
        <p className={`text-3xl font-black tabular-nums leading-none mt-1
            ${warn ? 'text-amber-600 dark:text-amber-400'
                   : good ? 'text-emerald-600 dark:text-emerald-400'
                   : 'text-slate-800 dark:text-slate-100'}`}>
            {value}<span className="text-base font-bold ml-0.5">{unit}</span>
        </p>
        {sub && <p className={`text-xs font-medium mt-1 ${warn ? 'text-amber-500 dark:text-amber-400' : good ? 'text-emerald-500 dark:text-emerald-400' : 'text-slate-400 dark:text-slate-500'}`}>{sub}</p>}
    </div>
);

/* ── main page ────────────────────────────────────────────────────────────── */
const ProjectDetail = () => {
    const { id } = useParams();
    const navigate = useNavigate();

    const [project, setProject] = useState(null);
    const [milestones, setMilestones] = useState([]);
    const [draftCount, setDraftCount] = useState(0);
    const [loading, setLoading] = useState(true);
    const [notFound, setNotFound] = useState(false);

    const { usersMap } = useUsers();

    // Live project doc: the recomputeProjectActualPercent trigger updates
    // `actualPercent` on every milestone write, so we subscribe to pick up
    // progress changes without a page refresh.
    useEffect(() => {
        if (!id) return;
        const unsub = onSnapshot(doc(db, 'projects', id), (snap) => {
            if (!snap.exists()) { setNotFound(true); setLoading(false); return; }
            setProject({ id: snap.id, ...snap.data() });
            setLoading(false);
        }, () => { setNotFound(true); setLoading(false); });
        return () => unsub();
    }, [id]);

    // Fetch milestones subcollection (real-time — mobile engineers update them).
    // Split confirmed vs. AI-generated drafts. Mobile treats docs without a
    // `confirmed` field as already-confirmed (pre-AI-era milestones), so we
    // only exclude when `confirmed === false`.
    useEffect(() => {
        if (!id) return;
        const unsub = onSnapshot(query(collection(db, 'projects', id, 'milestones')), (snap) => {
            const all = snap.docs.map(d => ({ id: d.id, ...d.data() }));
            all.sort((a, b) => {
                if (a.sequence != null && b.sequence != null) return a.sequence - b.sequence;
                if (a.targetDate && b.targetDate) return new Date(a.targetDate) - new Date(b.targetDate);
                return 0;
            });
            setMilestones(all.filter(m => m.confirmed !== false));
            setDraftCount(all.filter(m => m.confirmed === false).length);
        }, () => {});
        return () => unsub();
    }, [id]);

    /* proof-of-work gallery — fetch geotagged photos from Storage on expand */
    const [expandedProofs, setExpandedProofs] = useState(() => new Set());
    const [proofCache, setProofCache] = useState({});
    const [proofLoading, setProofLoading] = useState({});
    const [lightbox, setLightbox] = useState(null);

    // Firestore-first: primary source is milestone.proofs[] (canonical shape
    // written by mobile's uploadProofPhoto). Storage listAll() + EXIF runs
    // only for pre-contract files that never made it into the Firestore
    // array — once mobile backfills, the fallback goes silent.
    const loadProofs = useCallback(async (milestone) => {
        if (!id || !milestone?.id) return;
        const milestoneId = milestone.id;
        setProofLoading((s) => ({ ...s, [milestoneId]: true }));
        try {
            const fsEntries = Array.isArray(milestone.proofs) ? milestone.proofs : [];
            const fsPhotos = fsEntries
                .map(normalizeProof)
                .filter((p) => p && p.url && p.name);
            const fsNames = new Set(fsPhotos.map((p) => p.name));

            let legacyPhotos = [];
            try {
                const dirRef = storageRef(getStorage(), `projects/${id}/milestones/${milestoneId}/proofs`);
                const { items } = await listAll(dirRef);
                const missing = items.filter((r) => !fsNames.has(r.name));
                legacyPhotos = await Promise.all(missing.map(async (r) => {
                    const url = await getDownloadURL(r);
                    const fallbackCapture = r.name.replace(/\.jpe?g$/i, '');
                    let gps = null;
                    let capturedAt = null;
                    try {
                        const exif = await exifr.parse(url, {
                            pick: ['latitude', 'longitude', 'DateTimeOriginal'],
                        });
                        if (exif?.latitude != null && exif?.longitude != null) {
                            gps = { lat: exif.latitude, lng: exif.longitude };
                        }
                        if (exif?.DateTimeOriginal) capturedAt = exif.DateTimeOriginal;
                    } catch { /* no EXIF → filename fallback below */ }
                    if (!capturedAt) {
                        const asNum = Number(fallbackCapture);
                        capturedAt = Number.isFinite(asNum) && asNum > 0
                            ? new Date(asNum)
                            : fallbackCapture;
                    }
                    return { name: r.name, url, capturedAt, gps, accuracy: null, location: null };
                }));
            } catch { /* storage listing errors → show Firestore entries only */ }

            const photos = [...fsPhotos, ...legacyPhotos];
            photos.sort((a, b) => {
                const ta = a.capturedAt instanceof Date ? a.capturedAt.getTime() : Date.parse(a.capturedAt) || 0;
                const tb = b.capturedAt instanceof Date ? b.capturedAt.getTime() : Date.parse(b.capturedAt) || 0;
                return tb - ta;
            });
            setProofCache((c) => ({ ...c, [milestoneId]: photos }));
        } catch {
            setProofCache((c) => ({ ...c, [milestoneId]: [] }));
        } finally {
            setProofLoading((s) => ({ ...s, [milestoneId]: false }));
        }
    }, [id]);

    const toggleProofs = useCallback((milestoneId) => {
        setExpandedProofs((prev) => {
            const next = new Set(prev);
            if (next.has(milestoneId)) {
                next.delete(milestoneId);
            } else {
                next.add(milestoneId);
                if (!proofCache[milestoneId]) {
                    const m = milestones.find((x) => x.id === milestoneId);
                    if (m) loadProofs(m);
                }
            }
            return next;
        });
    }, [proofCache, loadProofs, milestones]);

    // Esc closes lightbox
    useEffect(() => {
        if (!lightbox) return;
        const onKey = (e) => { if (e.key === 'Escape') setLightbox(null); };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [lightbox]);

    // Resolve projectEngineer UID → {name, photoURL} from the shared users hook
    const engineer = useMemo(() => {
        const pe = project?.projectEngineer;
        if (!pe) return null;
        const u = usersMap[pe];
        if (u) return {
            name: `Engr. ${u.firstName || ''} ${u.lastName || ''}`.trim(),
            photoURL: u.photoURL || null,
            email: u.email || null,
        };
        // Fallbacks: UID never resolved (deleted user) or legacy name-string
        return { name: pe, photoURL: null, email: null };
    }, [project?.projectEngineer, usersMap]);

    /* computed accomplishment values */
    const computed = useMemo(() => {
        if (!project) return {};
        const start = project.officialDateStarted;
        const end   = project.originalDateCompletion;
        const actual = project.actualPercent ?? 0;
        const durationDays = diffDays(start, end);

        let timeElapsed = 0;
        if (start && end) {
            const now = Date.now();
            const s = new Date(start).getTime();
            const e = new Date(end).getTime();
            timeElapsed = clamp(((now - s) / (e - s)) * 100, 0, 100);
        }
        const slippage = timeElapsed - actual;
        const daysDelay = slippage > 0 && durationDays
            ? Math.round((slippage / 100) * durationDays)
            : 0;

        return {
            durationDays,
            timeElapsed: Math.round(timeElapsed * 10) / 10,
            slippage:    Math.round(slippage    * 10) / 10,
            daysDelay,
        };
    }, [project]);

    const st = statusMeta(project?.status);

    /* ── render states ── */
    if (loading) return (
        <div className="min-h-screen hcsd-bg font-sans">
            <HcsdSidebar />
            <main className="ml-0 md:ml-72 p-4 md:p-6 lg:p-10 pt-20 md:pt-10 flex items-center justify-center min-h-screen">
                <div className="flex flex-col items-center gap-4 text-slate-400">
                    <LoaderSpinner />
                    <p className="text-sm font-semibold animate-pulse">Loading project data...</p>
                </div>
            </main>
        </div>
    );

    if (notFound) return (
        <div className="min-h-screen hcsd-bg font-sans">
            <HcsdSidebar />
            <main className="ml-0 md:ml-72 p-4 md:p-6 lg:p-10 pt-20 md:pt-10 flex items-center justify-center min-h-screen">
                <div className="text-center">
                    <div className="w-16 h-16 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center mx-auto mb-4">
                        <FileText size={28} className="text-slate-300 dark:text-slate-600" />
                    </div>
                    <h2 className="text-lg font-bold text-slate-600 dark:text-slate-300">Project Not Found</h2>
                    <p className="text-slate-400 text-sm mt-1 mb-5">This project may have been deleted or the link is invalid.</p>
                    <button onClick={() => navigate('/hcsd/projects')}
                        className="inline-flex items-center gap-2 px-5 py-2.5 bg-teal-600 hover:bg-teal-700 text-white font-bold rounded-xl text-sm transition-all">
                        <ArrowLeft size={15} />
                        Back to Registry
                    </button>
                </div>
            </main>
        </div>
    );

    const p = project;

    return (
        <div className="min-h-screen hcsd-bg font-sans text-slate-900 dark:text-slate-100">
            <HcsdSidebar />

            <main className="ml-0 md:ml-72 p-4 md:p-6 lg:p-10 pt-20 md:pt-10">

                {/* ── Page header ── */}
                <div className="flex flex-col gap-4 mb-8" style={{ animation: 'fadeIn 0.4s ease-out both' }}>
                    <button onClick={() => navigate('/hcsd/projects')}
                        className="inline-flex items-center gap-2 text-sm font-semibold text-slate-500 dark:text-slate-400 hover:text-teal-600 dark:hover:text-teal-400 transition-colors w-fit">
                        <ArrowLeft size={16} />
                        Back to Project Registry
                    </button>

                    <div className="min-w-0">
                        <div className="flex items-center gap-2.5 flex-wrap mb-2">
                            <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wide border ${st.pill}`}>
                                <span className={`w-1.5 h-1.5 rounded-full ${st.dot}`} />
                                {p.status}
                            </span>
                            {p.barangay && (
                                <span className="inline-flex items-center gap-1 text-xs font-medium text-slate-500 dark:text-slate-400">
                                    <MapPin size={11} className="text-teal-500" />
                                    Barangay {p.barangay}
                                </span>
                            )}
                            {computed.durationDays && (
                                <span className="inline-flex items-center gap-1 text-xs font-medium text-slate-400 dark:text-slate-500">
                                    <Clock size={11} />
                                    {computed.durationDays} calendar days
                                </span>
                            )}
                        </div>
                        <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 dark:text-white tracking-tight leading-tight">
                            {p.projectName}
                        </h1>
                        {p.sitioStreet && (
                            <p className="text-slate-500 dark:text-slate-400 text-sm mt-1">{p.sitioStreet}</p>
                        )}
                    </div>
                </div>

                {/* ── Content grid ── */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">

                    {/* 1 — Account & Funding */}
                    <SectionCard icon={Hash} title="Account & Funding">
                        <FieldGrid cols={2}>
                            <Field label="Account Code" value={fmt(p.accountCode)} mono />
                            <Field label="Funding Source" value={fmt(p.fundingSource)} highlight />
                        </FieldGrid>
                    </SectionCard>

                    {/* 2 — Contract */}
                    <SectionCard icon={Banknote} title="Contract Details">
                        <FieldGrid cols={2}>
                            <Field label="Contract Amount" value={fmtCurrency(p.contractAmount)} highlight />
                            <Field label="Contractor" value={fmt(p.contractor)} />
                            {p.incurredAmount != null && (
                                <Field label="Incurred Amount" value={fmtCurrency(p.incurredAmount)} />
                            )}
                        </FieldGrid>
                    </SectionCard>

                    {/* 3 — Personnel */}
                    <SectionCard icon={Users} title="Assigned Personnel">
                        <FieldGrid cols={2}>
                            <div>
                                <p className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-1">Project Engineer</p>
                                {engineer ? (
                                    <div className="flex items-center gap-2.5">
                                        {engineer.photoURL ? (
                                            <img src={engineer.photoURL} alt={engineer.name}
                                                className="w-8 h-8 rounded-full object-cover border border-slate-200 dark:border-slate-700 shrink-0" />
                                        ) : (
                                            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-teal-500 to-emerald-400 flex items-center justify-center text-white text-[11px] font-bold shrink-0">
                                                {engineer.name.replace(/^Engr\.\s*/i, '').split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase() || '—'}
                                            </div>
                                        )}
                                        <p className="text-sm font-semibold text-teal-600 dark:text-teal-400 leading-snug truncate">
                                            {engineer.name}
                                        </p>
                                    </div>
                                ) : (
                                    <p className="text-sm font-medium text-slate-400 dark:text-slate-600">—</p>
                                )}
                            </div>
                            <Field label="Project Inspector" value={fmt(p.projectInspector)} />
                            <Field label="Material Inspector" value={fmt(p.materialInspector)} />
                            <Field label="Electrical Inspector" value={fmt(p.electricalInspector)} />
                        </FieldGrid>
                    </SectionCard>

                    {/* 4 — Timeline */}
                    <SectionCard icon={Calendar} title="Project Timeline">
                        <FieldGrid cols={2}>
                            <Field label="NTP Received" value={fmtDate(p.ntpReceivedDate)} />
                            <Field label="Official Start" value={fmtDate(p.officialDateStarted)} highlight />
                            <Field label="Original Completion" value={fmtDate(p.originalDateCompletion)} highlight />
                            {p.revisedDate1 && <Field label="Revised Date 1" value={fmtDate(p.revisedDate1)} />}
                            {p.revisedDate2 && <Field label="Revised Date 2" value={fmtDate(p.revisedDate2)} />}
                            {p.actualDateCompleted && <Field label="Actual Completion" value={fmtDate(p.actualDateCompleted)} />}
                        </FieldGrid>

                        <div className="mt-5 pt-5 border-t border-slate-100 dark:border-slate-700/50">
                            <p className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-2">NTP Document</p>
                            {p.ntpFileUrl ? (
                                <a href={p.ntpFileUrl} target="_blank" rel="noopener noreferrer"
                                    className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-500/30 text-blue-700 dark:text-blue-300 text-sm font-semibold hover:bg-blue-100 dark:hover:bg-blue-900/50 transition-colors">
                                    <FileText size={14} />
                                    <span className="truncate max-w-[220px]">{p.ntpFileName || 'View NTP'}</span>
                                    <ExternalLink size={12} className="shrink-0" />
                                </a>
                            ) : (
                                <p className="text-sm font-medium text-slate-400 dark:text-slate-600">No NTP on file</p>
                            )}
                        </div>
                    </SectionCard>

                    {/* 5 — Accomplishment — full width */}
                    <SectionCard icon={TrendingUp} title="Project Accomplishment" accent={computed.slippage > 0 ? 'amber' : 'teal'} className="lg:col-span-2">
                        {/* 4 stat tiles */}
                        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-7">
                            <StatTile
                                label="Time Elapsed"
                                value={computed.timeElapsed ?? 0}
                                sub="% of contract period used"
                            />
                            <StatTile
                                label="Actual Progress"
                                value={p.actualPercent ?? 0}
                                good={(p.actualPercent ?? 0) >= (computed.timeElapsed ?? 0)}
                                sub="% of work completed"
                            />
                            <StatTile
                                label="Slippage"
                                value={computed.slippage > 0 ? `+${computed.slippage}` : computed.slippage ?? 0}
                                warn={computed.slippage > 0}
                                good={computed.slippage <= 0}
                                sub={computed.slippage > 0 ? 'behind schedule' : 'ahead of or on schedule'}
                            />
                            <StatTile
                                label="Days Delay"
                                value={computed.daysDelay ?? 0}
                                unit=" days"
                                warn={computed.daysDelay > 0}
                                good={computed.daysDelay === 0}
                                sub={computed.daysDelay > 0 ? 'estimated calendar days behind' : 'no delay recorded'}
                            />
                        </div>

                        {/* Progress comparison bars */}
                        <div className="space-y-4">
                            <div>
                                <div className="flex items-center justify-between mb-2">
                                    <div className="flex items-center gap-2">
                                        <span className="w-3 h-3 rounded-sm bg-slate-400 dark:bg-slate-500 shrink-0" />
                                        <span className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wide">Time Elapsed</span>
                                    </div>
                                    <span className="text-sm font-black text-slate-600 dark:text-slate-300 tabular-nums">{computed.timeElapsed ?? 0}%</span>
                                </div>
                                <div className="w-full h-4 bg-slate-100 dark:bg-slate-700/60 rounded-full overflow-hidden">
                                    <div className="h-full rounded-full bg-gradient-to-r from-slate-400 to-slate-500 transition-all duration-700"
                                        style={{ width: `${computed.timeElapsed ?? 0}%` }} />
                                </div>
                            </div>

                            <div>
                                <div className="flex items-center justify-between mb-2">
                                    <div className="flex items-center gap-2">
                                        <span className={`w-3 h-3 rounded-sm bg-gradient-to-r ${st.bar} shrink-0`} />
                                        <span className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wide">Actual Progress</span>
                                    </div>
                                    <span className="text-sm font-black text-slate-600 dark:text-slate-300 tabular-nums">{p.actualPercent ?? 0}%</span>
                                </div>
                                <div className="w-full h-4 bg-slate-100 dark:bg-slate-700/60 rounded-full overflow-hidden">
                                    <div className={`h-full rounded-full bg-gradient-to-r ${st.bar} transition-all duration-700`}
                                        style={{ width: `${p.actualPercent ?? 0}%` }} />
                                </div>
                            </div>

                            {/* Gap callout — only show if slipping */}
                            {computed.slippage > 0 && (
                                <div className="flex items-center gap-3 mt-1 px-4 py-3 rounded-xl bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-500/30">
                                    <AlertTriangle size={15} className="text-amber-500 shrink-0" />
                                    <p className="text-xs font-semibold text-amber-700 dark:text-amber-300">
                                        Work is <span className="font-black">{computed.slippage}%</span> behind the elapsed time — approximately <span className="font-black">{computed.daysDelay} day{computed.daysDelay !== 1 ? 's' : ''}</span> behind schedule.
                                    </p>
                                </div>
                            )}
                        </div>
                    </SectionCard>

                    {/* 6 — Project Orders */}
                    <SectionCard icon={ClipboardList} title="Project Orders">
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                            {/* Resume Order */}
                            <div className="space-y-3">
                                <p className="text-[9px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest border-b border-slate-100 dark:border-slate-700/50 pb-1.5">Resume Order</p>
                                <Field label="Order Number" value={fmt(p.resumeOrderNumber)} mono />
                                <Field label="Order Date" value={fmtDate(p.resumeOrderDate)} />
                                <Field label="Time Extension" value={fmt(p.timeExtensionOnOrder)} />
                            </div>
                            {/* Validation Order */}
                            <div className="space-y-3">
                                <p className="text-[9px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest border-b border-slate-100 dark:border-slate-700/50 pb-1.5">Validation Order</p>
                                <Field label="Order Number" value={fmt(p.validationOrderNumber)} mono />
                                <Field label="Order Date" value={fmtDate(p.validationOrderDate)} />
                            </div>
                            {/* Suspension Order */}
                            <div className="space-y-3 sm:col-span-2">
                                <p className="text-[9px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest border-b border-slate-100 dark:border-slate-700/50 pb-1.5">Suspension Order</p>
                                <div className="grid grid-cols-2 gap-x-8 gap-y-3">
                                    <Field label="Order Number" value={fmt(p.suspensionOrderNumber)} mono />
                                    <Field label="Order Date" value={fmtDate(p.suspensionOrderDate)} />
                                </div>
                            </div>
                        </div>
                    </SectionCard>

                    {/* 7 — Notes */}
                    {(p.remarks || p.actionTaken) && (
                        <SectionCard icon={FileText} title="Remarks & Action Taken">
                            <div className="space-y-5">
                                {p.remarks && (
                                    <div>
                                        <p className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-2">Remarks</p>
                                        <p className="text-sm text-slate-700 dark:text-slate-300 leading-relaxed whitespace-pre-wrap">{p.remarks}</p>
                                    </div>
                                )}
                                {p.actionTaken && (
                                    <div>
                                        <p className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-2">Action Taken</p>
                                        <p className="text-sm text-slate-700 dark:text-slate-300 leading-relaxed whitespace-pre-wrap">{p.actionTaken}</p>
                                    </div>
                                )}
                            </div>
                        </SectionCard>
                    )}
                </div>

                {/* ── Milestones ── */}
                <div className="mt-5 bg-white/70 dark:bg-slate-900/50 backdrop-blur-xl border border-white/80 dark:border-white/5 rounded-[20px] shadow-md overflow-hidden"
                    style={{ animation: 'slideUp 0.5s ease-out 0.2s both' }}>
                    <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 dark:border-slate-700/50 bg-white/40 dark:bg-slate-800/20">
                        <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-teal-500 to-emerald-400 flex items-center justify-center shrink-0">
                                <Flag size={15} className="text-white" />
                            </div>
                            <div>
                                <h3 className="text-sm font-extrabold text-slate-700 dark:text-slate-200 uppercase tracking-wider">Strategic Milestones</h3>
                                <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">
                                    {milestones.length === 0 ? 'No milestones set' : `${milestones.length} milestone${milestones.length !== 1 ? 's' : ''} · updated by field engineers`}
                                </p>
                            </div>
                        </div>
                        {milestones.length > 0 && (
                            <span className="text-sm font-black w-9 h-9 rounded-xl flex items-center justify-center bg-teal-100 dark:bg-teal-900/50 text-teal-700 dark:text-teal-300 shrink-0">
                                {milestones.length}
                            </span>
                        )}
                    </div>

                    {draftCount > 0 && (
                        <div className="px-6 py-3 bg-indigo-50 dark:bg-indigo-900/20 border-b border-indigo-100 dark:border-indigo-500/20 flex items-center gap-3">
                            <div className="w-7 h-7 rounded-lg bg-indigo-500/15 flex items-center justify-center shrink-0">
                                <Clock size={13} className="text-indigo-600 dark:text-indigo-400" />
                            </div>
                            <p className="text-xs font-semibold text-indigo-700 dark:text-indigo-300 leading-snug">
                                {draftCount} AI-generated draft{draftCount !== 1 ? 's' : ''} awaiting engineer review
                                <span className="font-normal text-indigo-600/80 dark:text-indigo-400/80"> · hidden until confirmed on mobile</span>
                            </p>
                        </div>
                    )}

                    <div className="p-5">
                        {milestones.length === 0 ? (
                            <div className="flex flex-col items-center justify-center py-12 gap-3">
                                <div className="w-14 h-14 rounded-2xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center">
                                    <Flag size={24} className="text-slate-300 dark:text-slate-600" />
                                </div>
                                <p className="text-sm font-semibold text-slate-500 dark:text-slate-400">No milestones set yet</p>
                                <p className="text-xs text-slate-400 dark:text-slate-500 text-center max-w-xs leading-relaxed">
                                    Milestones are added during project creation and updated in real-time by field engineers via the mobile app.
                                </p>
                            </div>
                        ) : (
                            <div className="space-y-3">
                                {milestones.map((m, i) => {
                                    const weight = m.weightPercentage ?? m.weight;
                                    // Source of truth: mobile writes `status` on each milestone.
                                    // Display the Firebase value verbatim; only override with "Late"
                                    // when a targetDate exists and is past due.
                                    const rawStatus = (m.status || 'Pending').toString();
                                    const statusLower = rawStatus.toLowerCase();
                                    const isComplete = ['done', 'complete', 'completed'].includes(statusLower)
                                        || (m.actualPercent != null && weight != null && m.actualPercent >= weight);
                                    const isLate = !isComplete && m.targetDate && new Date(m.targetDate) < new Date();
                                    const pillLabel = isLate ? 'Late' : (isComplete ? 'Done' : rawStatus);
                                    return (
                                        <div key={m.id}
                                            className={`flex items-start gap-4 p-4 rounded-2xl border transition-all ${isComplete ? 'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-500/30' : isLate ? 'bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-500/30' : 'bg-slate-50 dark:bg-slate-800/40 border-slate-200 dark:border-slate-700/50'}`}
                                            style={{ animation: `slideUp 0.35s ease-out ${i * 0.05}s both` }}>
                                            <div className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 mt-0.5 ${isComplete ? 'bg-emerald-500' : isLate ? 'bg-amber-400' : 'bg-slate-300 dark:bg-slate-600'}`}>
                                                {isComplete
                                                    ? <CheckCircle2 size={16} className="text-white" />
                                                    : isLate
                                                        ? <AlertTriangle size={14} className="text-white" />
                                                        : <span className="text-[11px] font-black text-white">{m.sequence ?? i + 1}</span>
                                                }
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <div className="flex items-start justify-between gap-2 mb-1">
                                                    <p className="text-sm font-bold text-slate-800 dark:text-slate-100 leading-snug">{m.title}</p>
                                                    <div className="flex items-center gap-2 shrink-0">
                                                        {weight != null && (
                                                            <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400">
                                                                {weight}%
                                                            </span>
                                                        )}
                                                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-md border ${isComplete ? 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-500/30' : isLate ? 'bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-500/30' : 'bg-slate-100 dark:bg-slate-700/60 text-slate-500 dark:text-slate-400 border-slate-200 dark:border-slate-600'}`}>
                                                            {pillLabel}
                                                        </span>
                                                    </div>
                                                </div>
                                                {m.description && (
                                                    <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed mb-2">{m.description}</p>
                                                )}
                                                {m.targetDate ? (
                                                    <div className="flex items-center gap-1.5 text-xs text-slate-400 dark:text-slate-500 mb-2">
                                                        <Clock size={11} />
                                                        Target: {fmtDate(m.targetDate)}
                                                    </div>
                                                ) : m.suggestedDurationDays != null ? (
                                                    <div className="flex items-center gap-1.5 text-xs text-slate-400 dark:text-slate-500 mb-2">
                                                        <Clock size={11} />
                                                        Suggested duration: {m.suggestedDurationDays} day{m.suggestedDurationDays !== 1 ? 's' : ''}
                                                    </div>
                                                ) : null}
                                                {(() => {
                                                    const isOpen = expandedProofs.has(m.id);
                                                    const cached = proofCache[m.id];
                                                    const loadingProofs = proofLoading[m.id];
                                                    const hasCount = Array.isArray(m.proofs) && m.proofs.length > 0;
                                                    const count = cached ? cached.length : (hasCount ? m.proofs.length : 0);
                                                    if (count === 0 && !isOpen && !hasCount) return null;
                                                    return (
                                                        <div className="mb-2">
                                                            <button
                                                                type="button"
                                                                onClick={() => toggleProofs(m.id)}
                                                                className="inline-flex items-center gap-1.5 text-[11px] font-bold text-teal-600 dark:text-teal-400 hover:text-teal-700 dark:hover:text-teal-300 transition-colors"
                                                            >
                                                                <ImageIcon size={12} />
                                                                {count} proof photo{count !== 1 ? 's' : ''}
                                                                {isOpen ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                                                            </button>
                                                            {isOpen && (
                                                                <div className="mt-2 rounded-xl bg-slate-50/80 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700/60 p-3">
                                                                    {loadingProofs ? (
                                                                        <p className="text-[11px] text-slate-500 dark:text-slate-400 font-medium text-center py-3">Loading photos…</p>
                                                                    ) : (cached && cached.length > 0) ? (
                                                                        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
                                                                            {cached.map((p) => (
                                                                                <button
                                                                                    key={p.name}
                                                                                    type="button"
                                                                                    onClick={() => setLightbox(p)}
                                                                                    className="group relative aspect-square rounded-lg overflow-hidden bg-slate-200 dark:bg-slate-700 border border-slate-200 dark:border-slate-700/60 hover:ring-2 hover:ring-teal-400 transition-all"
                                                                                >
                                                                                    <img src={p.url} alt={p.name} loading="lazy" className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" />
                                                                                    {p.gps && (
                                                                                        <span
                                                                                            className="absolute top-1.5 right-1.5 w-6 h-6 rounded-full bg-teal-600/90 text-white flex items-center justify-center shadow-sm"
                                                                                            title={p.location ?? `${p.gps.lat.toFixed(6)}, ${p.gps.lng.toFixed(6)}`}
                                                                                        >
                                                                                            <MapPin size={12} strokeWidth={2.5} />
                                                                                        </span>
                                                                                    )}
                                                                                </button>
                                                                            ))}
                                                                        </div>
                                                                    ) : (
                                                                        <p className="text-[11px] text-slate-500 dark:text-slate-400 font-medium text-center py-3">No proof photos uploaded yet.</p>
                                                                    )}
                                                                </div>
                                                            )}
                                                        </div>
                                                    );
                                                })()}
                                                {m.actualPercent != null && (
                                                    <div className="w-full h-1.5 bg-white dark:bg-slate-700 rounded-full overflow-hidden">
                                                        <div className={`h-full rounded-full transition-all duration-700 ${isComplete ? 'bg-emerald-500' : isLate ? 'bg-amber-400' : 'bg-teal-500'}`}
                                                            style={{ width: `${m.actualPercent}%` }} />
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                </div>
            </main>

            {lightbox && (
                <div
                    className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4"
                    onClick={() => setLightbox(null)}
                    role="dialog"
                    aria-modal="true"
                >
                    <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); setLightbox(null); }}
                        className="absolute top-4 right-4 w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center transition-colors"
                        aria-label="Close"
                    >
                        <XIcon size={22} />
                    </button>
                    <div className="max-w-[95vw] max-h-[95vh] flex flex-col items-center gap-3" onClick={(e) => e.stopPropagation()}>
                        <img src={lightbox.url} alt={lightbox.name} className="max-w-full max-h-[85vh] object-contain rounded-lg shadow-2xl" />
                        {/* Capture time + GPS + accuracy live in the burnt-in
                            banner on the JPEG itself; the only unique value
                            the web can add is an interactive Maps deep-link. */}
                        {lightbox.gps && (
                            <a
                                href={`https://www.google.com/maps?q=${lightbox.gps.lat},${lightbox.gps.lng}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                onClick={(e) => e.stopPropagation()}
                                title={`${lightbox.gps.lat.toFixed(6)}, ${lightbox.gps.lng.toFixed(6)}`}
                                className={`text-xs font-semibold text-white bg-teal-600/90 hover:bg-teal-500 px-3 py-1.5 rounded-full inline-flex items-center gap-1.5 transition-colors max-w-[80vw] ${lightbox.location ? '' : 'font-mono'}`}
                            >
                                <MapPin size={12} strokeWidth={2.5} />
                                <span className="truncate">
                                    {lightbox.location ?? `${lightbox.gps.lat.toFixed(6)}, ${lightbox.gps.lng.toFixed(6)}`}
                                </span>
                                <ExternalLink size={11} strokeWidth={2.5} />
                            </a>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
};

export default ProjectDetail;
