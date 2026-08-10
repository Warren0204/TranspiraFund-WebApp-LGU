import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
    ArrowLeft, MapPin, Calendar, Users, TrendingUp, FileText,
    ClipboardList, AlertTriangle, CheckCircle2, Clock,
    Hash, Banknote, Flag, ExternalLink, ChevronDown, ChevronUp,
    ChevronLeft, ChevronRight,
    ImageIcon, X as XIcon, XCircle, HelpCircle, Check,
    CloudOff, RefreshCw,
} from 'lucide-react';
import HcsdSidebar from '../../components/layout/HcsdSidebar';
import NtpViewerModal from '../../components/shared/NtpViewerModal';
import { doc, collection, query, where, onSnapshot } from 'firebase/firestore';
import { getStorage, ref as storageRef, listAll, getDownloadURL } from 'firebase/storage';
import { getFunctions, httpsCallable } from 'firebase/functions';
import exifr from 'exifr';
import app, { db } from '../../config/firebase';
import { useAuth } from '../../context/AuthContext';
import { useUsers } from '../../hooks/useUsers';
import { computeSlippage, deriveStatus } from '../../utils/slippage';

// Mirrors the server-side proofKey cascade in functions/src/index.js so a
// client-side lookup by identity uses the same priority order the server used
// when writing verificationHistory[].proofKeys and perPhotoAssessments[].proofId.
const proofKey = (p) => p?.id || p?.fileName || p?.name || p?.storagePath || p?.url || null;

// Single formatter shared by every timestamp shown on the HCSD dashboard.
// Asia/Manila is enforced explicitly rather than reading browser locale — this
// is a single-jurisdiction accountability record. Output shape (e.g.
// "04 Aug 2026, 3:15 PM (PHT)") matches the server-side CAPTURE_TIME_FORMATTER
// used in the verifier prompt and the mobile burn-in banner.
const PHT_FORMATTER = new Intl.DateTimeFormat('en-PH', {
    timeZone: 'Asia/Manila',
    day: '2-digit', month: 'short', year: 'numeric',
    hour: 'numeric', minute: '2-digit', hour12: true,
});
const formatPHT = (raw) => {
    if (raw == null) return null;
    const d = raw?.toDate ? raw.toDate()
            : raw instanceof Date ? raw
            : typeof raw === 'number' ? new Date(raw)
            : typeof raw === 'string' ? new Date(raw)
            : null;
    if (!d || isNaN(d.getTime())) return null;
    return `${PHT_FORMATTER.format(d)} (PHT)`;
};

// Strip a leading "Photo N of M" (case-insensitive on "photo", optional trailing
// comma) from a per-photo reasoning string. The model authors this label per-
// batch, so the number always references the SCAN's position (see
// functions/src/index.js:2555) and misleads readers who see the row's milestone-
// scoped header ("Photo 3 of 5") directly above. Display-only; pa.reasoning
// stays untouched in Firestore. Returns the original text on non-matches, on
// non-string input, or when the strip would leave an empty or whitespace-only
// remainder.
const stripLeadingPhotoLabel = (text) => {
    if (typeof text !== 'string') return text;
    const stripped = text.replace(/^\s*photo\s+\d+\s+of\s+\d+\s*,?\s+/i, '');
    if (!stripped.trim()) return text;
    if (stripped === text) return text;
    return stripped[0].toUpperCase() + stripped.slice(1);
};

// Reasoning text for a per-photo assessment is 1-2 sentences per the tool
// schema, but 4 photos means 4 paragraphs in the row block. Truncate to the
// first sentence boundary, or 160 chars, whichever comes first. Callers pair
// the returned { display, needsExpand } with a Set-backed expand toggle so a
// reviewer can pop open a single row without scrolling four full paragraphs.
const truncateReasoning = (text) => {
    if (!text || typeof text !== 'string' || text.length <= 160) {
        return { display: text ?? '', needsExpand: false };
    }
    const sentenceMatch = text.match(/^[^.!?]+[.!?](?=\s|$)/);
    const cutIdx = sentenceMatch ? Math.min(sentenceMatch[0].length, 160) : 160;
    let clean = text.slice(0, cutIdx);
    if (cutIdx === 160) {
        const lastSpace = clean.lastIndexOf(' ');
        if (lastSpace > 100) clean = clean.slice(0, lastSpace);
    }
    return { display: clean.trimEnd() + '…', needsExpand: true };
};

const normalizeProof = (p) => {
    if (!p || typeof p !== 'object') return null;
    const lat = p.gps?.lat ?? p.latitude;
    const lng = p.gps?.lng ?? p.longitude;
    // Legacy note (per Phase 0 recon): the pre-convergence mobile client
    // wrote `timestamp: Date.now()` at UPLOAD time, not capture time. When a
    // proof has only `timestamp` and no `capturedAt`/`uploadedAt`, the render
    // layer surfaces it under the neutral label "Recorded" — do not "fix"
    // that to "Captured" without confirming what the field actually means.
    const rawCaptured = p.capturedAt ?? p.timestamp;
    return {
        id: p.id ?? null,
        name: p.fileName ?? p.name ?? null,
        url: p.url ?? null,
        storagePath: p.storagePath ?? null,
        capturedAt: rawCaptured ?? null,
        uploadedAt: p.uploadedAt ?? null,
        gps: (lat != null && lng != null) ? { lat: Number(lat), lng: Number(lng) } : null,
        accuracy: typeof p.accuracy === 'number' ? p.accuracy : null,
        location: typeof p.location === 'string' ? p.location : null,
        uploadedBy: typeof p.uploadedBy === 'string' ? p.uploadedBy : null,
    };
};

// Two-tier match cascade from a per-photo assessment to the actual proof.
// Returns { proof, match } where match is:
//   'exact'                — Tier 1 (pa.proofId), or Tier 2 on a v2+ record
//                            (any promptVersion whose slug starts "v2" or
//                            "v3", i.e. from the 2026-08-04 recalibration
//                            onward).
//   'approximate-tier2'    — Tier 2 on a pre-v2 record. Pre-v2 proofKeys may
//                            be misaligned by mid-batch fetch skips (fixed in
//                            functions/src/index.js on 2026-08-04), so this
//                            match is best-effort.
//   'none'                 — no matching key found via either tier.
//
// Tier 2 is BOUNDED BY proofKeys.length (the send-order array), NOT
// proofs.length — proofKeys may be shorter than the full proof set. Bounding
// against the wrong array is how a stale index resolves to a plausible-looking
// wrong photo.
//
// Tier 3 (positional fallback into proofs[idx]) was REMOVED because
// pa.photo_index is scoped to the batch onProofUploaded sent for that run,
// not to the milestone's full proofs array. onProofUploaded only assesses
// newly-appended proofs, so a second upload's assessment carries
// photo_index: 0 — the same index the first upload's assessment carried.
// The two index spaces coincide only when the batch equalled the whole array
// (true only on the very first run), and no cheap runtime signal can prove
// that condition. A confidently wrong verdict is worse than "Not yet
// assessed" on an accountability system, so records that fall through both
// tiers now render as unmatched.
//
// The 'approximate-tier3' label is retained in isApproximateMatch and
// approximateMatchTooltip below for backward compatibility with any
// pre-existing UI code paths — those helpers are pure and harmless when the
// label is unreachable.
//
// Second-arg name is `record` (not `latestRecord`) because per-proof history
// walks resolve against many entries, not just the newest one.
const isTrustedRecordVersion = (pv) =>
    typeof pv === 'string' && (pv.startsWith('v2') || pv.startsWith('v3'));
const resolveProofForAssessment = (pa, record, proofs) => {
    if (!pa || !Array.isArray(proofs) || proofs.length === 0) return { proof: null, match: 'none' };
    const idx = pa.photo_index;
    if (pa.proofId != null) {
        const found = proofs.find((p) => proofKey(p) === pa.proofId);
        if (found) return { proof: found, match: 'exact' };
    }
    const keys = record?.proofKeys;
    if (Array.isArray(keys) && Number.isInteger(idx) && idx >= 0 && idx < keys.length) {
        const key = keys[idx];
        if (key != null) {
            const found = proofs.find((p) => proofKey(p) === key);
            if (found) {
                return { proof: found, match: isTrustedRecordVersion(record?.promptVersion) ? 'exact' : 'approximate-tier2' };
            }
        }
    }
    return { proof: null, match: 'none' };
};

const isApproximateMatch = (match) => match === 'approximate-tier2' || match === 'approximate-tier3';
const approximateMatchTooltip = (match) =>
    match === 'approximate-tier2'
        ? 'Photo match from pre-recalibration record — may be off by one.'
        : 'No per-photo identifier stored — matched by position.';

const fmt = (val) =>(val === null || val === undefined || val === '') ? '—' : val;

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

// Definition-list row for the lightbox metadata block. Renders "—" when the
// value is null/undefined/empty so every row always occupies its slot; a
// missing field is visible-by-absence, not layout-shifting.
const MetaRow = ({ label, value, mono = false }) => (
    <div className="flex items-baseline gap-2 min-w-0">
        <dt className="text-[10px] font-bold uppercase tracking-wider text-white/50 shrink-0 w-20">{label}</dt>
        <dd className={`text-[11px] text-white/90 font-medium truncate min-w-0 ${mono ? 'font-mono' : ''}`} title={value ?? ''}>
            {value == null || value === '' ? '—' : value}
        </dd>
    </div>
);

const statusMeta = (s) => {
    switch ((s || '').toLowerCase()) {
        case 'completed': return { pill: 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-500/30', bar: 'from-emerald-500 to-green-400', dot: 'bg-emerald-500' };
        case 'ongoing':   return { pill: 'bg-sky-100 dark:bg-sky-900/40 text-sky-700 dark:text-sky-300 border-sky-200 dark:border-sky-500/30',                bar: 'from-sky-500 to-cyan-400',      dot: 'bg-sky-500' };
        case 'delayed':   return { pill: 'bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-500/30', bar: 'from-amber-400 to-yellow-300',  dot: 'bg-amber-400' };
        default:          return { pill: 'bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-500/30', bar: 'from-amber-400 to-yellow-300',  dot: 'bg-amber-400' };
    }
};

const getVerdictStyle = (verdict) => {
    switch (verdict) {
        case 'aligned':
            return {
                label: 'Aligned',
                icon: CheckCircle2,
                pill: 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-500/30',
                panel: 'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-500/30',
                text: 'text-emerald-700 dark:text-emerald-300',
                iconColor: 'text-emerald-500',
            };
        case 'partially_aligned':
            return {
                label: 'Partially Aligned',
                icon: AlertTriangle,
                pill: 'bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-500/30',
                panel: 'bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-500/30',
                text: 'text-amber-700 dark:text-amber-300',
                iconColor: 'text-amber-500',
            };
        case 'not_aligned':
            return {
                label: 'Not Aligned',
                icon: XCircle,
                pill: 'bg-rose-100 dark:bg-rose-900/40 text-rose-700 dark:text-rose-300 border-rose-200 dark:border-rose-500/30',
                panel: 'bg-rose-50 dark:bg-rose-900/20 border-rose-200 dark:border-rose-500/30',
                text: 'text-rose-700 dark:text-rose-300',
                iconColor: 'text-rose-500',
            };
        case 'insufficient_evidence':
        default:
            return {
                label: 'Insufficient Evidence',
                icon: HelpCircle,
                pill: 'bg-slate-100 dark:bg-slate-800/60 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-slate-700',
                panel: 'bg-slate-50 dark:bg-slate-800/40 border-slate-200 dark:border-slate-700/60',
                text: 'text-slate-600 dark:text-slate-400',
                iconColor: 'text-slate-500',
            };
    }
};

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

const ProjectDetail = () => {
    const { id } = useParams();
    const navigate = useNavigate();

    const [project, setProject] = useState(null);
    const [milestones, setMilestones] = useState([]);
    const [draftCount, setDraftCount] = useState(0);
    const [loading, setLoading] = useState(true);
    const [notFound, setNotFound] = useState(false);
    const [loadError, setLoadError] = useState(false);
    const [retryTick, setRetryTick] = useState(0);
    const [milestonesError, setMilestonesError] = useState(false);
    const [milestonesRetryTick, setMilestonesRetryTick] = useState(0);
    const [usingCache, setUsingCache] = useState(false);
    // Latch that flips to true after the first server-sourced snapshot arrives.
    // We suppress the "cached" badge until then so a healthy online load never
    // flashes it during the normal cache-then-server initial-fire sequence.
    // navigator.onLine is a fallback so a page loaded entirely offline (no
    // server snapshot ever) still shows the badge.
    const seenServerRef = useRef(false);
    const [ntpViewerOpen, setNtpViewerOpen] = useState(false);

    const { tenantId } = useAuth();
    const { users, usersMap, loading: usersLoading, displayName: resolveDisplayName } = useUsers();

    const [reassignTargetUid, setReassignTargetUid] = useState('');
    const [isReassigning, setIsReassigning] = useState(false);
    const [reassignError, setReassignError] = useState('');

    const availableEngineers = useMemo(() => {
        return users
            .filter((u) => u.role === 'PROJ_ENG' && u.id !== project?.projectEngineer)
            .map((u) => ({
                id: u.id,
                name: `Engr. ${u.firstName || ''} ${u.lastName || ''}`.trim() || u.email || u.id,
            }))
            .sort((a, b) => a.name.localeCompare(b.name));
    }, [users, project?.projectEngineer]);

    const [pickerOpen, setPickerOpen] = useState(false);
    const pickerRef = useRef(null);
    useEffect(() => {
        if (!pickerOpen) return;
        const onDocClick = (e) => {
            if (pickerRef.current && !pickerRef.current.contains(e.target)) setPickerOpen(false);
        };
        const onKey = (e) => { if (e.key === 'Escape') setPickerOpen(false); };
        document.addEventListener('mousedown', onDocClick);
        document.addEventListener('keydown', onKey);
        return () => {
            document.removeEventListener('mousedown', onDocClick);
            document.removeEventListener('keydown', onKey);
        };
    }, [pickerOpen]);

    const selectedEngineer = useMemo(
        () => availableEngineers.find((e) => e.id === reassignTargetUid) || null,
        [availableEngineers, reassignTargetUid],
    );

    const handleReassign = useCallback(async () => {
        if (!reassignTargetUid || !id || isReassigning) return;
        setIsReassigning(true);
        setReassignError('');
        try {
            const functions = getFunctions(app, 'asia-southeast1');
            const reassignFn = httpsCallable(functions, 'reassignProjectEngineer');
            await reassignFn({ projectId: id, newEngineerUid: reassignTargetUid });
            setReassignTargetUid('');
        } catch (err) {
            setReassignError(err?.message || 'Failed to reassign engineer.');
        } finally {
            setIsReassigning(false);
        }
    }, [reassignTargetUid, id, isReassigning]);

    useEffect(() => {
        if (!id) return;
        const unsub = onSnapshot(doc(db, 'projects', id), (snap) => {
            if (!snap.exists()) { setNotFound(true); setLoading(false); return; }
            setProject({ id: snap.id, ...snap.data() });
            setLoading(false);
            setLoadError(false);
            // fromCache latch: only surface the cached badge once we've seen
            // at least one server snapshot (or if navigator says we're
            // offline entirely). Prevents the flash on healthy loads while
            // still catching the "loaded totally offline" case.
            const isFromCache = snap.metadata.fromCache;
            if (!isFromCache) {
                seenServerRef.current = true;
                setUsingCache(false);
            } else if (seenServerRef.current || !navigator.onLine) {
                setUsingCache(true);
            }
        }, (error) => {
            console.error('[ProjectDetail/project] snapshot listener error:', error);
            // Do NOT set notFound here — a network/transport failure is not
            // the same as a missing document. loadError renders the retry
            // screen instead of the dead-end "Project Not Found" page.
            setLoadError(true);
            setLoading(false);
        });
        return () => unsub();
    }, [id, retryTick]);

    useEffect(() => {
        if (!id || !tenantId) return;
        const unsub = onSnapshot(query(
            collection(db, 'projects', id, 'milestones'),
            where('tenantId', '==', tenantId)
        ), (snap) => {
            const all = snap.docs.map(d => ({ id: d.id, ...d.data() }));
            all.sort((a, b) => {
                if (a.sequence != null && b.sequence != null) return a.sequence - b.sequence;
                if (a.targetDate && b.targetDate) return new Date(a.targetDate) - new Date(b.targetDate);
                return 0;
            });
            setMilestones(all.filter(m => m.confirmed !== false));
            setDraftCount(all.filter(m => m.confirmed === false).length);
            setMilestonesError(false);
        }, (error) => {
            console.error('[ProjectDetail/milestones] snapshot listener error:', error);
            // Inline advisory rather than a page-level failure — the last
            // known milestones stay on screen; the user is told they may
            // be out of date.
            setMilestonesError(true);
        });
        return () => unsub();
    }, [id, tenantId, milestonesRetryTick]);

    useEffect(() => {
        if (loading || milestones.length === 0) return;
        const hash = window.location.hash;
        if (!hash || !hash.startsWith('#milestone-')) return;
        const raf = requestAnimationFrame(() => {
            const el = document.getElementById(hash.slice(1));
            if (!el) return;
            el.scrollIntoView({ behavior: 'smooth', block: 'center' });
            el.classList.add('hash-target-pulse');
            const t = setTimeout(() => el.classList.remove('hash-target-pulse'), 2400);
            return () => clearTimeout(t);
        });
        return () => cancelAnimationFrame(raf);
    }, [loading, milestones.length]);

    const [expandedProofs, setExpandedProofs] = useState(() => new Set());
    const [proofCache, setProofCache] = useState({});
    const [proofLoading, setProofLoading] = useState({});
    // { proofs: normalizedProof[], index: number, perProofMap: Map } | null
    // proofs is snapshotted from cachedProofs at open time so upstream
    // re-renders of the milestone list cannot shrink the array behind us;
    // index is kept in-bounds by modular arithmetic in the nav handlers.
    const [lightbox, setLightbox] = useState(null);
    // Set-backed expand state for per-photo reasoning rows (Part 2E). Keyed by
    // the same proofKey the per-photo rows use, so a photo assessed in an
    // older run keeps its expand state across a re-render triggered by a new
    // upload elsewhere in the milestone.
    const [expandedReasoning, setExpandedReasoning] = useState(() => new Set());
    const toggleReasoning = useCallback((k) => {
        if (!k) return;
        setExpandedReasoning((prev) => {
            const next = new Set(prev);
            if (next.has(k)) next.delete(k); else next.add(k);
            return next;
        });
    }, []);

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
                    } catch {}
                    if (!capturedAt) {
                        const asNum = Number(fallbackCapture);
                        capturedAt = Number.isFinite(asNum) && asNum > 0
                            ? new Date(asNum)
                            : fallbackCapture;
                    }
                    return {
                        id: null,
                        name: r.name,
                        url,
                        storagePath: null,
                        capturedAt,
                        uploadedAt: null,
                        gps,
                        accuracy: null,
                        location: null,
                        uploadedBy: null,
                    };
                }));
            } catch {}

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

    useEffect(() => {
        if (!lightbox) return;
        // Escape closes; Arrow keys wrap through lightbox.proofs. Wrap math is
        // modular so it cannot exceed proofs.length - 1; the render still gates
        // nav controls on proofs.length > 1 for the single-proof case.
        const onKey = (e) => {
            if (e.key === 'Escape') { setLightbox(null); return; }
            const len = lightbox?.proofs?.length ?? 0;
            if (len <= 1) return;
            if (e.key === 'ArrowRight') {
                setLightbox((lb) => lb ? { ...lb, index: (lb.index + 1) % lb.proofs.length } : lb);
            } else if (e.key === 'ArrowLeft') {
                setLightbox((lb) => lb ? { ...lb, index: (lb.index - 1 + lb.proofs.length) % lb.proofs.length } : lb);
            }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [lightbox]);

    // Orphan detection: a project can carry a `projectEngineer` UID whose
    // user doc no longer exists — pre-existing data from before the
    // auto-unassign side-effect shipped in `deleteOfficialAccount`. In that
    // case the lookup returns nothing and we must NOT render the raw UID
    // (terrible UX) — we treat it as "no engineer" so the reassignment
    // dropdown surfaces, exactly as if `projectEngineer` were empty. We
    // gate this on `usersLoading` to avoid flickering the dropdown during
    // the initial users-snapshot fetch.
    const engineer = useMemo(() => {
        const pe = project?.projectEngineer;
        if (!pe) return null;
        const u = usersMap[pe];
        if (u) return {
            name: `Engr. ${u.firstName || ''} ${u.lastName || ''}`.trim(),
            photoURL: u.photoURL || null,
            email: u.email || null,
        };
        if (usersLoading) return { name: '…', photoURL: null, email: null, _resolving: true };
        return null;
    }, [project?.projectEngineer, usersMap, usersLoading]);

    const milestoneProgress = useMemo(() => {
        const total = milestones.length;
        const completed = milestones.filter((m) => {
            const s = (m.status || '').toLowerCase();
            return s === 'done' || s === 'completed';
        }).length;
        const percent = total > 0 ? Math.round((completed / total) * 100) : 0;
        return { total, completed, percent };
    }, [milestones]);

    const computed = useMemo(() => computeSlippage(project), [project, milestoneProgress]);

    // Header pill, status dot, and accomplishment progress bar all key off
    // the *derived* status — same rule the dashboard donut and the registry
    // status column use. Keeps the surfaces in sync immediately while the
    // daily detectProjectSlippage cron catches up the persisted field.
    const displayStatus = deriveStatus(project);
    const st = statusMeta(displayStatus);

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

    if (loadError && !project) return (
        <div className="min-h-screen hcsd-bg font-sans">
            <HcsdSidebar />
            <main className="ml-0 md:ml-72 p-4 md:p-6 lg:p-10 pt-20 md:pt-10 flex items-center justify-center min-h-screen">
                <div className="text-center max-w-md">
                    <div className="w-16 h-16 rounded-full bg-amber-50 dark:bg-amber-900/30 flex items-center justify-center mx-auto mb-4">
                        <CloudOff size={28} className="text-amber-500 dark:text-amber-400" />
                    </div>
                    <h2 className="text-lg font-bold text-slate-700 dark:text-slate-200">Can't load this project</h2>
                    <p className="text-slate-500 dark:text-slate-400 text-sm mt-1 mb-5">
                        We couldn't reach the server. This may be a temporary connection problem.
                    </p>
                    <div className="flex items-center justify-center gap-3">
                        <button
                            type="button"
                            onClick={() => { setLoadError(false); setLoading(true); setRetryTick((n) => n + 1); }}
                            className="inline-flex items-center gap-2 px-5 py-2.5 bg-teal-600 hover:bg-teal-700 text-white font-bold rounded-xl text-sm transition-all"
                        >
                            <RefreshCw size={15} />
                            Try again
                        </button>
                        <button
                            type="button"
                            onClick={() => navigate('/hcsd/projects')}
                            className="inline-flex items-center gap-2 px-5 py-2.5 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 font-bold rounded-xl text-sm transition-all"
                        >
                            <ArrowLeft size={15} />
                            Back to Registry
                        </button>
                    </div>
                </div>
            </main>
        </div>
    );

    const p = project;

    return (
        <div className="min-h-screen hcsd-bg font-sans text-slate-900 dark:text-slate-100">
            <HcsdSidebar />

            <main className="ml-0 md:ml-72 p-4 md:p-6 lg:p-10 pt-20 md:pt-10">

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
                                {displayStatus}
                            </span>
                            {usingCache && (
                                <span
                                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wide border bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-500/30"
                                    title="Showing cached data. We'll refresh when the connection returns."
                                >
                                    <CloudOff size={11} />
                                    Cached
                                </span>
                            )}
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

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">

                    <SectionCard icon={Hash} title="Account & Funding">
                        <FieldGrid cols={2}>
                            <Field label="Account Code" value={fmt(p.accountCode)} mono />
                            <Field label="Funding Source" value={fmt(p.fundingSource)} highlight />
                        </FieldGrid>
                    </SectionCard>

                    <SectionCard icon={Banknote} title="Contract Details">
                        <FieldGrid cols={2}>
                            <Field label="Contract Amount" value={fmtCurrency(p.contractAmount)} highlight />
                            <Field label="Contractor" value={fmt(p.contractor)} />
                            {p.incurredAmount != null && (
                                <Field label="Incurred Amount" value={fmtCurrency(p.incurredAmount)} />
                            )}
                        </FieldGrid>
                    </SectionCard>

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
                                    <div className="rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-500/30 p-3 space-y-2.5">
                                        <div className="flex items-center gap-2">
                                            <AlertTriangle size={13} className="text-amber-600 dark:text-amber-400 shrink-0" />
                                            <p className="text-xs font-semibold text-amber-700 dark:text-amber-300 leading-snug">
                                                No engineer assigned — pick a replacement
                                            </p>
                                        </div>
                                        {availableEngineers.length === 0 ? (
                                            <p className="text-[11px] font-medium text-amber-700/80 dark:text-amber-300/80">
                                                No Project Engineers available in this tenant. Create one in Staff Management first.
                                            </p>
                                        ) : (
                                            <div className="flex flex-col sm:flex-row gap-2">
                                                <div ref={pickerRef} className="relative flex-1 min-w-0">
                                                    <button
                                                        type="button"
                                                        onClick={() => !isReassigning && setPickerOpen((o) => !o)}
                                                        disabled={isReassigning}
                                                        aria-haspopup="listbox"
                                                        aria-expanded={pickerOpen}
                                                        className="w-full inline-flex items-center justify-between gap-2 rounded-lg border border-amber-300 dark:border-amber-500/40 bg-white dark:bg-slate-800 px-3 py-2 text-left hover:border-amber-400 dark:hover:border-amber-400/60 focus:outline-none focus:ring-2 focus:ring-teal-500/40 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
                                                    >
                                                        {selectedEngineer ? (
                                                            <span className="text-xs font-semibold text-slate-700 dark:text-slate-200 truncate">
                                                                {selectedEngineer.name}
                                                            </span>
                                                        ) : (
                                                            <span className="text-xs font-medium text-slate-400 dark:text-slate-500">
                                                                Select engineer…
                                                            </span>
                                                        )}
                                                        <ChevronDown size={14} className={`shrink-0 text-slate-400 dark:text-slate-500 transition-transform duration-150 ${pickerOpen ? 'rotate-180' : ''}`} />
                                                    </button>
                                                    {pickerOpen && (
                                                        <ul role="listbox"
                                                            className="absolute z-30 left-0 right-0 mt-1.5 max-h-56 overflow-y-auto rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 shadow-lg shadow-slate-900/10 dark:shadow-black/40 py-1"
                                                        >
                                                            {availableEngineers.map((eng) => {
                                                                const isSelected = eng.id === reassignTargetUid;
                                                                return (
                                                                    <li key={eng.id} role="option" aria-selected={isSelected}>
                                                                        <button
                                                                            type="button"
                                                                            onClick={() => {
                                                                                setReassignTargetUid(eng.id);
                                                                                setReassignError('');
                                                                                setPickerOpen(false);
                                                                            }}
                                                                            className={`w-full flex items-center justify-between gap-2 px-3 py-2 text-left transition-colors ${
                                                                                isSelected
                                                                                    ? 'bg-teal-50 dark:bg-teal-900/30'
                                                                                    : 'hover:bg-slate-50 dark:hover:bg-slate-700/50'
                                                                            }`}
                                                                        >
                                                                            <span className={`text-xs font-semibold ${isSelected ? 'text-teal-700 dark:text-teal-300' : 'text-slate-700 dark:text-slate-200'}`}>
                                                                                {eng.name}
                                                                            </span>
                                                                            {isSelected && (
                                                                                <Check size={13} className="text-teal-600 dark:text-teal-400 shrink-0" />
                                                                            )}
                                                                        </button>
                                                                    </li>
                                                                );
                                                            })}
                                                        </ul>
                                                    )}
                                                </div>
                                                <button
                                                    type="button"
                                                    onClick={handleReassign}
                                                    disabled={!reassignTargetUid || isReassigning}
                                                    className="shrink-0 inline-flex items-center justify-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-teal-600 hover:bg-teal-700 disabled:bg-slate-300 dark:disabled:bg-slate-700 disabled:text-slate-400 disabled:cursor-not-allowed text-white text-xs font-bold transition-colors"
                                                >
                                                    {isReassigning ? 'Reassigning…' : 'Reassign'}
                                                </button>
                                            </div>
                                        )}
                                        {reassignError && (
                                            <p className="text-[11px] font-semibold text-rose-700 dark:text-rose-300">
                                                {reassignError}
                                            </p>
                                        )}
                                    </div>
                                )}
                            </div>
                            <Field label="Project Inspector" value={fmt(p.projectInspector)} />
                            <Field label="Material Inspector" value={fmt(p.materialInspector)} />
                            <Field label="Electrical Inspector" value={fmt(p.electricalInspector)} />
                        </FieldGrid>
                    </SectionCard>

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
                                <button
                                    type="button"
                                    onClick={() => setNtpViewerOpen(true)}
                                    className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-500/30 text-blue-700 dark:text-blue-300 text-sm font-semibold hover:bg-blue-100 dark:hover:bg-blue-900/50 transition-colors"
                                    aria-label="Open NTP document viewer"
                                >
                                    <FileText size={14} />
                                    <span className="truncate max-w-[220px]">{p.ntpFileName || 'View NTP'}</span>
                                </button>
                            ) : (
                                <p className="text-sm font-medium text-slate-400 dark:text-slate-600">No NTP on file</p>
                            )}
                        </div>
                    </SectionCard>

                    <SectionCard icon={TrendingUp} title="Project Accomplishment" accent={computed.slippage > 0 ? 'amber' : 'teal'} className="lg:col-span-2">
                        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-7">
                            <StatTile
                                label="Time Elapsed"
                                value={computed.timeElapsed ?? 0}
                                sub="% of contract period used"
                            />
                            <StatTile
                                label="Actual Progress"
                                value={Number(project?.actualPercent) || 0}
                                good={(Number(project?.actualPercent) || 0) >= (computed.timeElapsed ?? 0)}
                                sub={milestoneProgress.total > 0
                                    ? `${milestoneProgress.completed} of ${milestoneProgress.total} milestones done`
                                    : '% of work completed'}
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
                                    <span className="text-sm font-black text-slate-600 dark:text-slate-300 tabular-nums">{Number(project?.actualPercent) || 0}%</span>
                                </div>
                                <div className="w-full h-4 bg-slate-100 dark:bg-slate-700/60 rounded-full overflow-hidden">
                                    <div className={`h-full rounded-full bg-gradient-to-r ${st.bar} transition-all duration-700`}
                                        style={{ width: `${Number(project?.actualPercent) || 0}%` }} />
                                </div>
                            </div>

                            {milestoneProgress.total > 0 && (
                                <div>
                                    <div className="flex items-center justify-between mb-2">
                                        <span className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wide">Milestone Progress</span>
                                        <span className="text-xs font-semibold text-slate-500 dark:text-slate-400 tabular-nums">
                                            {milestoneProgress.completed} / {milestoneProgress.total}
                                        </span>
                                    </div>
                                    <div className="flex gap-1">
                                        {milestones.map((m) => {
                                            const s = (m.status || '').toLowerCase();
                                            const done = s === 'done' || s === 'completed';
                                            const tip = `${m.sequence != null ? `${m.sequence}. ` : ''}${m.title || 'Milestone'} — ${done ? 'Done' : (m.status || 'Pending')}`;
                                            return (
                                                <div
                                                    key={m.id}
                                                    title={tip}
                                                    className={`flex-1 h-3 rounded-sm transition-colors ${done ? 'bg-emerald-500 dark:bg-emerald-400' : 'bg-slate-200 dark:bg-slate-700'}`}
                                                />
                                            );
                                        })}
                                    </div>
                                </div>
                            )}

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

                    <SectionCard icon={ClipboardList} title="Project Orders">
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                            <div className="space-y-3">
                                <p className="text-[9px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest border-b border-slate-100 dark:border-slate-700/50 pb-1.5">Resume Order</p>
                                <Field label="Order Number" value={fmt(p.resumeOrderNumber)} mono />
                                <Field label="Order Date" value={fmtDate(p.resumeOrderDate)} />
                                <Field label="Time Extension" value={fmt(p.timeExtensionOnOrder)} />
                            </div>
                            <div className="space-y-3">
                                <p className="text-[9px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest border-b border-slate-100 dark:border-slate-700/50 pb-1.5">Validation Order</p>
                                <Field label="Order Number" value={fmt(p.validationOrderNumber)} mono />
                                <Field label="Order Date" value={fmtDate(p.validationOrderDate)} />
                            </div>
                            <div className="space-y-3 sm:col-span-2">
                                <p className="text-[9px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest border-b border-slate-100 dark:border-slate-700/50 pb-1.5">Suspension Order</p>
                                <div className="grid grid-cols-2 gap-x-8 gap-y-3">
                                    <Field label="Order Number" value={fmt(p.suspensionOrderNumber)} mono />
                                    <Field label="Order Date" value={fmtDate(p.suspensionOrderDate)} />
                                </div>
                            </div>
                        </div>
                    </SectionCard>

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

                    {milestonesError && (
                        <div className="px-6 py-3 bg-amber-50 dark:bg-amber-900/20 border-b border-amber-200 dark:border-amber-500/30 flex items-center gap-3">
                            <div className="w-7 h-7 rounded-lg bg-amber-500/15 flex items-center justify-center shrink-0">
                                <CloudOff size={13} className="text-amber-600 dark:text-amber-400" />
                            </div>
                            <p className="flex-1 text-xs font-semibold text-amber-700 dark:text-amber-300 leading-snug">
                                Milestones may be out of date. We couldn't refresh from the server.
                            </p>
                            <button
                                type="button"
                                onClick={() => setMilestonesRetryTick((n) => n + 1)}
                                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-bold uppercase tracking-wide bg-amber-500 hover:bg-amber-600 text-white transition-colors shrink-0"
                            >
                                <RefreshCw size={11} />
                                Retry
                            </button>
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
                                    const rawStatus = (m.status || 'Pending').toString();
                                    const statusLower = rawStatus.toLowerCase();
                                    const isComplete = ['done', 'complete', 'completed'].includes(statusLower)
                                        || (m.actualPercent != null && weight != null && m.actualPercent >= weight);
                                    const isLate = !isComplete && m.targetDate && new Date(m.targetDate) < new Date();
                                    const pillLabel = isLate ? 'Late' : (isComplete ? 'Done' : rawStatus);
                                    return (
                                        <div key={m.id}
                                            id={`milestone-${m.id}`}
                                            className={`flex items-start gap-4 p-4 rounded-2xl border transition-all scroll-mt-24 ${isComplete ? 'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-500/30' : isLate ? 'bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-500/30' : 'bg-slate-50 dark:bg-slate-800/40 border-slate-200 dark:border-slate-700/50'}`}
                                            style={{ animation: `slideUp 0.35s ease-out ${i * 0.05}s both` }}>
                                            <div className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 mt-0.5 ${isComplete ? 'bg-emerald-500' : isLate ? 'bg-amber-400' : 'bg-slate-300 dark:bg-slate-600'}`}>
                                                <span className="text-[11px] font-black text-white">{m.sequence ?? i + 1}</span>
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
                                                    const cachedProofs = Array.isArray(cached) ? cached : [];
                                                    // Photo numbering is APPEND order (oldest = 1, newest = N), NOT
                                                    // display order. Rationale: the verifier's photo_index is append
                                                    // order, so its "Photo N of M" reasoning references append-order
                                                    // labels; if the dashboard called the same proof "3 of 3" instead
                                                    // of "1 of 3" the reasoning and UI would contradict. Ground truth
                                                    // is m.proofs[] itself — mobile writes via arrayUnion(newEntry),
                                                    // so array position IS append position. No capturedAt sort needed
                                                    // for Firestore-tracked proofs. Legacy Storage-only proofs (found
                                                    // via listAll but absent from m.proofs) get numbered AFTER, in
                                                    // capturedAt-ASC order as a best-effort fallback — legacy proofs
                                                    // never had a canonical "append time" recorded. Display order is
                                                    // still capturedAt-DESC (see loadProofs sort); the two orderings
                                                    // are decoupled.
                                                    const appendOrderMap = new Map();
                                                    let appendCursor = 0;
                                                    const cachedKeys = new Set();
                                                    for (const p of cachedProofs) {
                                                        const k = proofKey(p);
                                                        if (k) cachedKeys.add(k);
                                                    }
                                                    if (Array.isArray(m.proofs)) {
                                                        for (const raw of m.proofs) {
                                                            const k = raw?.id || raw?.fileName || raw?.name || raw?.storagePath || raw?.url;
                                                            if (k && cachedKeys.has(k) && !appendOrderMap.has(k)) {
                                                                appendOrderMap.set(k, appendCursor++);
                                                            }
                                                        }
                                                    }
                                                    const legacyPending = cachedProofs
                                                        .filter((p) => {
                                                            const k = proofKey(p);
                                                            return k && !appendOrderMap.has(k);
                                                        })
                                                        .slice()
                                                        .sort((a, b) => {
                                                            const ta = a.capturedAt instanceof Date ? a.capturedAt.getTime() : Date.parse(a.capturedAt) || 0;
                                                            const tb = b.capturedAt instanceof Date ? b.capturedAt.getTime() : Date.parse(b.capturedAt) || 0;
                                                            return ta - tb;
                                                        });
                                                    for (const p of legacyPending) {
                                                        const k = proofKey(p);
                                                        if (k) appendOrderMap.set(k, appendCursor++);
                                                    }
                                                    const appendTotal = appendCursor;
                                                    // Small helper: append-order number (1-based) for a proof; null if
                                                    // the proof somehow has no resolvable key (proofKey cascade fell
                                                    // through — should not happen for cachedProofs entries).
                                                    const appendNumberFor = (p) => {
                                                        const k = proofKey(p);
                                                        if (!k) return null;
                                                        const idx = appendOrderMap.get(k);
                                                        return idx == null ? null : idx + 1;
                                                    };
                                                    // History is append-only per batch: onProofUploaded assesses only
                                                    // newly-added proofs (see functions/src/index.js beforeKeys diff),
                                                    // so a milestone with N uploads over K sessions has K entries.
                                                    // We walk them newest-first for two independent purposes:
                                                    //   (1) `latestHistoryEntry` — drives the milestone-level panel
                                                    //       (overall verdict + reasoning). Latest-only is deliberate;
                                                    //       we do NOT synthesize a milestone-wide overall verdict
                                                    //       client-side because the model wasn't asked to weigh cross-
                                                    //       run evidence.
                                                    //   (2) `perProofMap` — drives the per-photo strip. First-writer-
                                                    //       wins over a newest-first walk yields the newest assessment
                                                    //       per proof. This is why a photo assessed 3 runs ago still
                                                    //       carries its verdict even after 2 subsequent uploads of
                                                    //       other proofs; and why a re-assessed proof (same key seen
                                                    //       across multiple entries) shows the most recent verdict.
                                                    // Secondary sort key `b.idx - a.idx` is EXPLICIT so behavior on
                                                    // identical runAt does not depend on Array.prototype.sort's
                                                    // implementation-stability. Since verificationHistory is
                                                    // arrayUnion-append-only, a higher original array index means
                                                    // later-inserted; combined with first-writer-wins, the later-
                                                    // inserted entry wins the tie. Mobile uses the same expression
                                                    // so both surfaces agree by construction.
                                                    const historyEntries = Array.isArray(m.verificationHistory) && m.verificationHistory.length > 0
                                                        ? m.verificationHistory
                                                            .map((entry, idx) => ({ entry, idx }))
                                                            .sort((a, b) => {
                                                                const ta = a.entry?.runAt?.toMillis?.() ?? Date.parse(a.entry?.runAt) ?? 0;
                                                                const tb = b.entry?.runAt?.toMillis?.() ?? Date.parse(b.entry?.runAt) ?? 0;
                                                                if (tb !== ta) return tb - ta;
                                                                return b.idx - a.idx;
                                                            })
                                                            .map(({ entry }) => entry)
                                                        : [];
                                                    const latestHistoryEntry = historyEntries[0] ?? null;
                                                    const hasMultipleRuns = historyEntries.length > 1;

                                                    // proofKey → { pa, entry, match } for the newest assessment of
                                                    // each resolvable proof, across every run.
                                                    const perProofMap = new Map();
                                                    for (const entry of historyEntries) {
                                                        const paList = Array.isArray(entry.perPhotoAssessments)
                                                            ? entry.perPhotoAssessments
                                                            : (Array.isArray(entry.per_photo_assessments) ? entry.per_photo_assessments : []);
                                                        for (const pa of paList) {
                                                            const { proof: matched, match } = resolveProofForAssessment(pa, entry, cachedProofs);
                                                            if (!matched) continue;
                                                            const k = proofKey(matched);
                                                            if (!k || perProofMap.has(k)) continue;
                                                            perProofMap.set(k, { pa, entry, match, proof: matched });
                                                        }
                                                    }
                                                    // Render order follows cachedProofs (the physical proof order in
                                                    // the milestone), not history order — so the strip reads left-to-
                                                    // right through the proofs the HCSD user sees below.
                                                    const perProofRows = cachedProofs
                                                        .map((p) => {
                                                            const k = proofKey(p);
                                                            if (!k) return null;
                                                            const entry = perProofMap.get(k);
                                                            return entry ? entry : null;
                                                        })
                                                        .filter(Boolean);
                                                    const assessedKeys = new Set(perProofMap.keys());
                                                    const anyHistory = historyEntries.length > 0;
                                                    return (
                                                        <>
                                                            {latestHistoryEntry && (() => {
                                                                const result = latestHistoryEntry;
                                                                const style = getVerdictStyle(result.overallVerdict);
                                                                const VerdictIcon = style.icon;
                                                                const runAtStr = formatPHT(result.runAt);
                                                                const provenanceBits = [];
                                                                if (runAtStr) provenanceBits.push(`Assessed ${runAtStr}`);
                                                                if (result.promptVersion) provenanceBits.push(result.promptVersion);
                                                                const provenanceLine = provenanceBits.length > 0 ? provenanceBits.join(' · ') : null;
                                                                // Multi-run: derive a milestone-wide count from perProofMap so
                                                                // the summary reflects every proof's newest verdict across all
                                                                // runs. Single-run: no count line is needed because the per-
                                                                // photo strip below already itemizes the sole scan.
                                                                let derivedCountSentence = null;
                                                                if (hasMultipleRuns) {
                                                                    const counts = { aligned: 0, partially_aligned: 0, not_aligned: 0, insufficient_evidence: 0 };
                                                                    for (const rowEntry of perProofMap.values()) {
                                                                        const v = rowEntry?.pa?.verdict;
                                                                        if (v && counts[v] != null) counts[v] += 1;
                                                                    }
                                                                    const totalAssessed = counts.aligned + counts.partially_aligned + counts.not_aligned + counts.insufficient_evidence;
                                                                    const parts = [];
                                                                    if (counts.aligned)               parts.push(`${counts.aligned} aligned`);
                                                                    if (counts.partially_aligned)     parts.push(`${counts.partially_aligned} partially aligned`);
                                                                    if (counts.not_aligned)           parts.push(`${counts.not_aligned} not aligned`);
                                                                    if (counts.insufficient_evidence) parts.push(`${counts.insufficient_evidence} insufficient evidence`);
                                                                    derivedCountSentence = totalAssessed > 0
                                                                        ? `${totalAssessed} photo${totalAssessed !== 1 ? 's' : ''} assessed: ${parts.join(', ')}`
                                                                        : null;
                                                                }
                                                                const captionText = hasMultipleRuns
                                                                    ? `Latest scan · ${result.photosVerified} photo${result.photosVerified !== 1 ? 's' : ''}`
                                                                    : `AI assessment · ${result.photosVerified} photo${result.photosVerified !== 1 ? 's' : ''} scanned`;
                                                                return (
                                                                    <div className={`mb-2 rounded-xl border p-3 ${style.panel}`}>
                                                                        <div className="flex items-start gap-2">
                                                                            <VerdictIcon size={18} className={`${style.iconColor} shrink-0 mt-0.5`} />
                                                                            <div className="flex-1 min-w-0">
                                                                                <div className="flex items-center gap-2 flex-wrap mb-1">
                                                                                    <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-md border ${style.pill}`}>
                                                                                        {style.label}
                                                                                    </span>
                                                                                    <span className="text-[10px] font-semibold text-slate-400 dark:text-slate-500">
                                                                                        {captionText}
                                                                                    </span>
                                                                                </div>
                                                                                {provenanceLine && (
                                                                                    <p className="text-[10px] font-medium text-slate-400 dark:text-slate-500 mb-1">{provenanceLine}</p>
                                                                                )}
                                                                                {hasMultipleRuns && derivedCountSentence && (
                                                                                    <>
                                                                                        <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                                                                                            Across all scans · newest verdict per photo
                                                                                        </p>
                                                                                        <p className={`text-xs font-medium leading-relaxed ${style.text}`}>
                                                                                            {derivedCountSentence}
                                                                                        </p>
                                                                                    </>
                                                                                )}
                                                                            </div>
                                                                        </div>

                                                                        {perProofRows.length > 0 && (
                                                                            <div className="mt-3 pt-3 border-t border-slate-200/70 dark:border-slate-700/60 space-y-3">
                                                                                {hasMultipleRuns && (
                                                                                    <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                                                                                        Per-photo assessments · newest across all runs
                                                                                    </p>
                                                                                )}
                                                                                {perProofRows.map(({ pa, entry, match, proof: matchedProof }) => {
                                                                                    const ps = getVerdictStyle(pa.verdict);
                                                                                    const PIcon = ps.icon;
                                                                                    const approx = isApproximateMatch(match);
                                                                                    // Milestone-wide ordinal for a stable label. Each perProofRows
                                                                                    // row corresponds to one proof in cachedProofs, so this index
                                                                                    // lookup is O(N) but N is tiny (per-milestone proof count).
                                                                                    // proofOrdinal is DISPLAY position (used for lightbox index);
                                                                                    // photoLabel uses APPEND-order numbering so it agrees with
                                                                                    // mobile and with the verifier's "Photo N of M" reasoning.
                                                                                    const proofOrdinal = cachedProofs.findIndex((p) => proofKey(p) === proofKey(matchedProof));
                                                                                    const appendNumber = appendNumberFor(matchedProof);
                                                                                    const photoLabel = appendNumber != null
                                                                                        ? `Photo ${appendNumber} of ${appendTotal}`
                                                                                        : `Photo of ${appendTotal}`;
                                                                                    const confidencePct = (typeof pa.confidence === 'number' && pa.confidence >= 0 && pa.confidence <= 1)
                                                                                        ? Math.round(pa.confidence * 100)
                                                                                        : null;
                                                                                    const matchLabel = approx
                                                                                        ? (match === 'approximate-tier2'
                                                                                            ? 'photo match approximate (legacy record)'
                                                                                            : 'photo match approximate (by position)')
                                                                                        : null;
                                                                                    const runAtStr = formatPHT(entry?.runAt);
                                                                                    const thumbAria = `Open ${photoLabel} in lightbox — ${approx ? 'approximate match' : 'exact match'}`;
                                                                                    const rowKey = proofKey(matchedProof) ?? `pa-${proofOrdinal}`;
                                                                                    return (
                                                                                        <div key={rowKey} className="flex items-start gap-2">
                                                                                            <button
                                                                                                type="button"
                                                                                                onClick={() => setLightbox({ proofs: cachedProofs, index: proofOrdinal, perProofMap, appendOrderMap, appendTotal })}
                                                                                                aria-label={thumbAria}
                                                                                                className="relative shrink-0 w-12 h-12 rounded-md overflow-hidden bg-slate-200 dark:bg-slate-700 border border-slate-200 dark:border-slate-700/60 hover:ring-2 hover:ring-teal-400 transition-all"
                                                                                            >
                                                                                                <img src={matchedProof.url} alt="" loading="lazy" className="w-full h-full object-cover" />
                                                                                                {approx && (
                                                                                                    <span
                                                                                                        className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-amber-500 text-white text-[9px] font-black flex items-center justify-center shadow-sm"
                                                                                                        title={approximateMatchTooltip(match)}
                                                                                                        aria-hidden="true"
                                                                                                    >
                                                                                                        ≈
                                                                                                    </span>
                                                                                                )}
                                                                                            </button>
                                                                                            <div className="flex-1 min-w-0">
                                                                                                <div className="flex items-center gap-2 flex-wrap">
                                                                                                    <PIcon size={14} className={`${ps.iconColor} shrink-0`} />
                                                                                                    <span className="text-[10px] font-bold text-slate-500 dark:text-slate-400">
                                                                                                        {photoLabel}
                                                                                                    </span>
                                                                                                    <span className={`text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded border ${ps.pill}`}>
                                                                                                        {ps.label}
                                                                                                    </span>
                                                                                                    {confidencePct != null && (
                                                                                                        <span className="text-[10px] font-semibold text-slate-500 dark:text-slate-400">
                                                                                                            Confidence: {confidencePct}%
                                                                                                        </span>
                                                                                                    )}
                                                                                                    {hasMultipleRuns && runAtStr && (
                                                                                                        <span className="text-[10px] font-medium text-slate-400 dark:text-slate-500">
                                                                                                            Assessed {runAtStr}
                                                                                                        </span>
                                                                                                    )}
                                                                                                    {matchLabel && (
                                                                                                        <span
                                                                                                            className="text-[10px] font-medium text-amber-600 dark:text-amber-400"
                                                                                                            title={approximateMatchTooltip(match)}
                                                                                                        >
                                                                                                            {matchLabel}
                                                                                                        </span>
                                                                                                    )}
                                                                                                </div>
                                                                                                {(() => {
                                                                                                    const isExpanded = expandedReasoning.has(rowKey);
                                                                                                    const displayReasoning = stripLeadingPhotoLabel(pa.reasoning);
                                                                                                    const { display, needsExpand } = truncateReasoning(displayReasoning);
                                                                                                    return (
                                                                                                        <p className={`text-[11px] font-medium leading-snug mt-0.5 ${ps.text}`}>
                                                                                                            {isExpanded ? displayReasoning : display}
                                                                                                            {needsExpand && (
                                                                                                                <button
                                                                                                                    type="button"
                                                                                                                    onClick={() => toggleReasoning(rowKey)}
                                                                                                                    className={`ml-1 text-[10px] font-bold underline underline-offset-2 hover:opacity-70 ${ps.text}`}
                                                                                                                    aria-expanded={isExpanded}
                                                                                                                >
                                                                                                                    {isExpanded ? 'Show less' : 'Show more'}
                                                                                                                </button>
                                                                                                            )}
                                                                                                        </p>
                                                                                                    );
                                                                                                })()}
                                                                                                {Array.isArray(pa.visible_elements) && pa.visible_elements.length > 0 && (
                                                                                                    <div className="mt-1 flex flex-wrap gap-1">
                                                                                                        {pa.visible_elements.map((el, idx) => (
                                                                                                            <span key={idx} className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-white/70 dark:bg-slate-800/60 text-slate-500 dark:text-slate-400 border border-slate-200 dark:border-slate-700">
                                                                                                                {el}
                                                                                                            </span>
                                                                                                        ))}
                                                                                                    </div>
                                                                                                )}
                                                                                            </div>
                                                                                        </div>
                                                                                    );
                                                                                })}
                                                                            </div>
                                                                        )}
                                                                    </div>
                                                                );
                                                            })()}
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
                                                                                {cached.map((p, i) => {
                                                                                    const key = proofKey(p) ?? `idx-${i}`;
                                                                                    const capturedStr = formatPHT(p.capturedAt);
                                                                                    const uploadedStr = formatPHT(p.uploadedAt);
                                                                                    // Thumbnail caption shows only ONE timestamp (Captured
                                                                                    // when both are present, since Captured and Uploaded
                                                                                    // are typically <1 min apart). The lightbox retains
                                                                                    // both. RECORDED remains the neutral fallback when
                                                                                    // only the legacy `timestamp` field is present —
                                                                                    // pre-convergence mobile wrote it at UPLOAD time, so
                                                                                    // we cannot claim capture. Do not "fix" the RECORDED
                                                                                    // label to Captured without confirming what the
                                                                                    // legacy field actually means (see normalizeProof).
                                                                                    let primaryLabel = null, primaryValue = null;
                                                                                    if (capturedStr) {
                                                                                        primaryLabel = uploadedStr ? 'Captured' : 'Recorded';
                                                                                        primaryValue = capturedStr;
                                                                                    } else if (uploadedStr) {
                                                                                        primaryLabel = 'Uploaded'; primaryValue = uploadedStr;
                                                                                    }
                                                                                    const pKey = proofKey(p);
                                                                                    // assessedKeys covers every proof with a persistent
                                                                                    // verdict across all runs, so a photo assessed in an
                                                                                    // older run correctly renders WITHOUT the "Not yet
                                                                                    // assessed" badge even if a later run only scanned
                                                                                    // different proofs.
                                                                                    const isUnassessed = anyHistory && !(pKey && assessedKeys.has(pKey));
                                                                                    const thumbAssessment = pKey ? perProofMap.get(pKey) : null;
                                                                                    const thumbVerdict = thumbAssessment?.pa?.verdict ?? null;
                                                                                    // Verdict badge and "Not yet assessed" pill share the
                                                                                    // bottom-left corner — they cannot co-occur (a proof
                                                                                    // is either assessed or not), so reserving two
                                                                                    // corners on a small thumbnail would waste space.
                                                                                    const verdictBadgeBg = thumbVerdict === 'aligned' ? 'bg-emerald-500'
                                                                                        : thumbVerdict === 'partially_aligned' ? 'bg-amber-500'
                                                                                        : thumbVerdict === 'not_aligned' ? 'bg-rose-500'
                                                                                        : 'bg-slate-500';
                                                                                    const verdictBadgeLabel = thumbVerdict === 'aligned' ? 'Aligned'
                                                                                        : thumbVerdict === 'partially_aligned' ? 'Partial'
                                                                                        : thumbVerdict === 'not_aligned' ? 'Not aligned'
                                                                                        : thumbVerdict === 'insufficient_evidence' ? 'Insuff.'
                                                                                        : null;
                                                                                    // i is the DISPLAY position (newest-first sort). The
                                                                                    // visible number is APPEND order so it matches mobile
                                                                                    // and the verifier's photo_index. Display order and
                                                                                    // numbering are intentionally decoupled.
                                                                                    const thumbAppendNumber = appendNumberFor(p);
                                                                                    // Verdict badge / "Not yet assessed" live in the caption row
                                                                                    // BELOW the thumbnail, not as bottom-left overlays. The mobile
                                                                                    // burn-in banner is a five-line strip aligned to the JPEG's
                                                                                    // bottom edge (see functions/src/index.js:2573), so any bottom
                                                                                    // corner overlays sat on top of it. Top corners are already
                                                                                    // occupied by "N of M" and the GPS pin; a caption chip is the
                                                                                    // only slot that never conflicts with the burnt banner.
                                                                                    //
                                                                                    // object-cover crops non-1:1 sources to fill the square tile.
                                                                                    // Do not "fix" this to object-contain: at 2.17:1 (Casona
                                                                                    // ultrawide) contain leaves large empty bands, and picker-grid
                                                                                    // legibility loss is worse than the crop.
                                                                                    const captionChip = isUnassessed
                                                                                        ? { label: 'Not yet assessed', bg: 'bg-slate-500' }
                                                                                        : (verdictBadgeLabel ? { label: verdictBadgeLabel, bg: verdictBadgeBg } : null);
                                                                                    return (
                                                                                        <div key={key} className="flex flex-col gap-1">
                                                                                            <button
                                                                                                type="button"
                                                                                                onClick={() => setLightbox({ proofs: cachedProofs, index: i, perProofMap, appendOrderMap, appendTotal })}
                                                                                                aria-label={`Open proof photo ${thumbAppendNumber ?? '?'} of ${appendTotal}${p.name ? ` — ${p.name}` : ''} in lightbox${isUnassessed ? ' — not yet assessed' : (verdictBadgeLabel ? ` — ${verdictBadgeLabel}` : '')}`}
                                                                                                className="group relative aspect-square rounded-lg overflow-hidden bg-slate-200 dark:bg-slate-700 border border-slate-200 dark:border-slate-700/60 hover:ring-2 hover:ring-teal-400 transition-all"
                                                                                            >
                                                                                                <img src={p.url} alt={p.name ?? ''} loading="lazy" className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" />
                                                                                                <span className="absolute top-1.5 left-1.5 text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-slate-900/70 text-white shadow-sm tabular-nums">
                                                                                                    {thumbAppendNumber ?? '?'} of {appendTotal}
                                                                                                </span>
                                                                                                {p.gps && (
                                                                                                    <span
                                                                                                        className="absolute top-1.5 right-1.5 w-6 h-6 rounded-full bg-teal-600/90 text-white flex items-center justify-center shadow-sm"
                                                                                                        title={p.location ?? `${p.gps.lat.toFixed(6)}, ${p.gps.lng.toFixed(6)}`}
                                                                                                    >
                                                                                                        <MapPin size={12} strokeWidth={2.5} />
                                                                                                    </span>
                                                                                                )}
                                                                                            </button>
                                                                                            {(primaryValue || captionChip) && (
                                                                                                <div className="text-[10px] leading-tight px-0.5 flex items-center justify-between gap-1">
                                                                                                    {primaryValue ? (
                                                                                                        <p className="text-slate-600 dark:text-slate-300 font-semibold truncate min-w-0" title={primaryValue}>
                                                                                                            <span className="text-slate-400 dark:text-slate-500 font-medium">{primaryLabel}:</span> {primaryValue}
                                                                                                        </p>
                                                                                                    ) : <span className="min-w-0" />}
                                                                                                    {captionChip && (
                                                                                                        <span className={`shrink-0 text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded text-white shadow-sm ${captionChip.bg}`}>
                                                                                                            {captionChip.label}
                                                                                                        </span>
                                                                                                    )}
                                                                                                </div>
                                                                                            )}
                                                                                        </div>
                                                                                    );
                                                                                })}
                                                                            </div>
                                                                        ) : (
                                                                            <p className="text-[11px] text-slate-500 dark:text-slate-400 font-medium text-center py-3">No proof photos uploaded yet.</p>
                                                                        )}
                                                                    </div>
                                                                )}
                                                            </div>
                                                        </>
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

            <NtpViewerModal
                isOpen={ntpViewerOpen}
                fileUrl={p.ntpFileUrl}
                fileName={p.ntpFileName}
                onClose={() => setNtpViewerOpen(false)}
            />

            {lightbox && (() => {
                // Lightbox shape: { proofs: normalizedProof[], index: number,
                // perProofMap: Map<proofKey, {pa, entry, match, proof}> }.
                // proofs is snapshotted at open time so upstream shrinkage of
                // cachedProofs cannot make index out-of-bounds. Nav wraps at
                // both ends via modular arithmetic; controls are gated on
                // total > 1 so a single-proof open is unchanged UX-wise.
                const proofs = lightbox.proofs ?? [];
                const idx = lightbox.index ?? 0;
                const currentProof = proofs[idx];
                if (!currentProof) return null;
                const total = proofs.length;
                const canNav = total > 1;
                const goPrev = (e) => { e?.stopPropagation?.(); setLightbox((lb) => lb ? { ...lb, index: (lb.index - 1 + lb.proofs.length) % lb.proofs.length } : lb); };
                const goNext = (e) => { e?.stopPropagation?.(); setLightbox((lb) => lb ? { ...lb, index: (lb.index + 1) % lb.proofs.length } : lb); };
                const cpKey = proofKey(currentProof);
                const currentAssessment = (cpKey && lightbox.perProofMap) ? lightbox.perProofMap.get(cpKey) : null;
                const currentPa = currentAssessment?.pa ?? null;
                const currentVerdictStyle = currentPa ? getVerdictStyle(currentPa.verdict) : null;
                const CurrentVerdictIcon = currentVerdictStyle?.icon ?? null;
                const currentConfidencePct = (typeof currentPa?.confidence === 'number' && currentPa.confidence >= 0 && currentPa.confidence <= 1)
                    ? Math.round(currentPa.confidence * 100)
                    : null;
                // Numbering is APPEND order (matches thumbnail pill and per-photo
                // list). Prev/next still walk DISPLAY order (cachedProofs, newest
                // first), so "next" can move from Photo 4 → Photo 3 — the
                // position indicator makes that explicit as the user pages.
                const lookupAppend = (p) => {
                    if (!p || !lightbox.appendOrderMap) return null;
                    const k = proofKey(p);
                    if (!k) return null;
                    const i = lightbox.appendOrderMap.get(k);
                    return i == null ? null : i + 1;
                };
                const appendTotalLB = lightbox.appendTotal ?? total;
                const currentAppendNum = lookupAppend(currentProof);
                const prevIdxLB = (idx - 1 + total) % total;
                const nextIdxLB = (idx + 1) % total;
                const prevAppendNum = lookupAppend(proofs[prevIdxLB]);
                const nextAppendNum = lookupAppend(proofs[nextIdxLB]);
                // Metadata rows are computed once per render for the right pane.
                // Every field is sourced from normalizeProof (see lines 66-88),
                // NOT from the burned pixel banner. Legacy shape tolerance in
                // normalizeProof (flat latitude/longitude, ms-epoch `timestamp`)
                // is preserved unchanged; capturedAt / uploadedAt / gps below are
                // whatever normalizeProof produced.
                const capturedStr = formatPHT(currentProof.capturedAt);
                const uploadedStr = formatPHT(currentProof.uploadedAt);
                const coordStr = currentProof.gps
                    ? `${currentProof.gps.lat.toFixed(6)}, ${currentProof.gps.lng.toFixed(6)}`
                    : null;
                const accuracyStr = (typeof currentProof.accuracy === 'number' && isFinite(currentProof.accuracy))
                    ? `${Math.round(currentProof.accuracy)} m`
                    : null;
                // uploadedBy on the proof is a UID (per canonical mobile shape
                // in CLAUDE.md). Resolve to a display name via the tenant-scoped
                // useUsers snapshot listener already running on this page
                // (see line 279). The listener's query constrains by tenantId,
                // which satisfies firestore.rules users/{uid} read for HCSD
                // callers; a where(documentId(), 'in', uids) list query would
                // NOT — it does not constrain by tenantId statically. Fall back
                // to the UID string if the user doc is not (yet) in the map
                // (unresolved, deleted user, or listener still loading).
                const uploaderName = currentProof.uploadedBy
                    ? (resolveDisplayName(currentProof.uploadedBy) ?? currentProof.uploadedBy)
                    : null;
                // Label rule preserved from the old vertical stack: Captured +
                // Uploaded when both, "Recorded" when only capturedAt/legacy
                // `timestamp` is present (pre-convergence mobile wrote the
                // legacy field at upload time; do not relabel it to Captured
                // without confirming what the field actually means).
                const timeRows = [];
                if (capturedStr && uploadedStr) {
                    timeRows.push({ label: 'Captured', value: capturedStr });
                    timeRows.push({ label: 'Uploaded', value: uploadedStr });
                } else if (capturedStr) {
                    timeRows.push({ label: 'Recorded', value: capturedStr });
                } else if (uploadedStr) {
                    timeRows.push({ label: 'Uploaded', value: uploadedStr });
                }

                return (
                    <div
                        className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm overflow-y-auto"
                        onClick={() => setLightbox(null)}
                        role="dialog"
                        aria-modal="true"
                    >
                        {/* Inner wrapper enables backdrop scroll (overflow-y-auto
                            on the outer fixed element) while keeping vertical
                            centering when the dialog fits. Standard modal
                            pattern; directly addresses the pre-redesign
                            unscrollable-overflow blocker. */}
                        <div className="min-h-full flex items-center justify-center p-4">
                            <div
                                className="relative w-full max-w-[95vw] my-auto flex flex-col md:flex-row md:h-[90vh] md:max-h-[90vh] bg-slate-900/95 rounded-lg overflow-hidden shadow-2xl"
                                onClick={(e) => e.stopPropagation()}
                            >
                                <button
                                    type="button"
                                    onClick={() => setLightbox(null)}
                                    className="absolute top-3 right-3 z-20 w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center transition-colors"
                                    aria-label="Close"
                                >
                                    <XIcon size={22} />
                                </button>
                                {/* Image pane. min-h-0 min-w-0 lets object-contain
                                    compute against the flex-allocated size instead
                                    of the intrinsic image size — without them a
                                    2.17:1 (Casona ultrawide) source can collapse
                                    the pane in some browsers. Below md, the pane
                                    has no explicit height, so it sizes to the
                                    image's natural rendered height and leaves no
                                    vertical band on ultrawide sources at phone
                                    width (max-w-full caps by width first, height
                                    follows). max-h-[60vh] below md protects
                                    against very tall portrait sources on short
                                    landscape phones. At md+, md:flex-1 makes the
                                    pane fill the 90vh dialog; empty vertical
                                    bands on ultrawide are expected there as the
                                    accepted trade-off of object-contain in a
                                    fixed pane. */}
                                <div className="relative flex items-center justify-center bg-black/40 p-4 min-h-0 min-w-0 md:flex-1">
                                    <img
                                        src={currentProof.url}
                                        alt={currentProof.name ?? ''}
                                        className="max-w-full max-h-[60vh] md:max-h-full object-contain rounded shadow-lg"
                                    />
                                    {canNav && (
                                        <>
                                            <button
                                                type="button"
                                                onClick={goPrev}
                                                className="absolute left-3 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center transition-colors"
                                                aria-label={`Previous photo (${prevAppendNum ?? '?'} of ${appendTotalLB})`}
                                            >
                                                <ChevronLeft size={22} />
                                            </button>
                                            <button
                                                type="button"
                                                onClick={goNext}
                                                className="absolute right-3 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center transition-colors"
                                                aria-label={`Next photo (${nextAppendNum ?? '?'} of ${appendTotalLB})`}
                                            >
                                                <ChevronRight size={22} />
                                            </button>
                                        </>
                                    )}
                                </div>
                                {/* Detail pane. md:overflow-y-auto gives it its own
                                    scroll container so long AI reasoning scrolls
                                    inside the pane rather than pushing the dialog
                                    past the viewport. Below md the pane grows
                                    naturally and the whole dialog scrolls via
                                    the backdrop wrapper. */}
                                <aside className="w-full md:w-[360px] md:h-full flex flex-col md:overflow-y-auto p-4 gap-3 border-t md:border-t-0 md:border-l border-white/10 text-white">
                                    {canNav && (
                                        <p className="text-[11px] font-bold uppercase tracking-wider text-white/70 tabular-nums">
                                            Photo {currentAppendNum ?? '?'} of {appendTotalLB}
                                        </p>
                                    )}
                                    {/* Per-photo verdict + reasoning render IN FULL
                                        here. The right pane is a dedicated scroll
                                        container (md:overflow-y-auto), so length
                                        no longer pushes the dialog past the
                                        viewport as it did in the old vertical
                                        stack. Below md, the whole dialog scrolls
                                        via the backdrop wrapper. Do not
                                        re-introduce truncation. */}
                                    {currentPa && currentVerdictStyle && (
                                        <div className="text-xs bg-black/40 rounded-lg px-3 py-2 flex flex-col gap-1 items-start border border-white/10">
                                            <div className="flex items-center gap-2 flex-wrap">
                                                {CurrentVerdictIcon && <CurrentVerdictIcon size={14} className={currentVerdictStyle.iconColor} />}
                                                <span className={`text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded border ${currentVerdictStyle.pill}`}>
                                                    {currentVerdictStyle.label}
                                                </span>
                                                {currentConfidencePct != null && (
                                                    <span className="text-[10px] font-semibold text-white/70">
                                                        Confidence: {currentConfidencePct}%
                                                    </span>
                                                )}
                                            </div>
                                            {currentPa.reasoning && (
                                                <p className="text-[11px] leading-snug text-white/85">{stripLeadingPhotoLabel(currentPa.reasoning)}</p>
                                            )}
                                            {Array.isArray(currentPa.visible_elements) && currentPa.visible_elements.length > 0 && (
                                                <div className="mt-1 flex flex-wrap gap-1">
                                                    {currentPa.visible_elements.map((el, elIdx) => (
                                                        <span key={elIdx} className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-white/10 text-white/80 border border-white/10">
                                                            {el}
                                                        </span>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    )}
                                    {!currentPa && (
                                        <span className="self-start text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded bg-slate-800/80 text-white shadow-sm">
                                            Not yet assessed
                                        </span>
                                    )}
                                    {currentProof.gps && (
                                        <a
                                            href={`https://www.google.com/maps?q=${currentProof.gps.lat},${currentProof.gps.lng}`}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            title={coordStr}
                                            className={`self-start text-xs font-semibold text-white bg-teal-600/90 hover:bg-teal-500 px-3 py-1.5 rounded-full inline-flex items-center gap-1.5 transition-colors max-w-full ${currentProof.location ? '' : 'font-mono'}`}
                                        >
                                            <MapPin size={12} strokeWidth={2.5} />
                                            <span className="truncate">
                                                {currentProof.location ?? coordStr}
                                            </span>
                                            <ExternalLink size={11} strokeWidth={2.5} />
                                        </a>
                                    )}
                                    {/* Metadata block. Every burnt-banner field is
                                        surfaced here as HTML, sourced from
                                        normalizeProof — a redesign of the mobile
                                        banner (parked work, see MEMORY.md) can
                                        drop reader-only fields from the pixels
                                        without losing readability on the web,
                                        because the web already renders every
                                        field structurally. */}
                                    <dl className="text-xs bg-black/40 rounded-lg px-3 py-2 border border-white/10 flex flex-col gap-1">
                                        <MetaRow label="Location" value={currentProof.location} />
                                        <MetaRow label="Coordinates" value={coordStr} mono />
                                        <MetaRow label="Accuracy" value={accuracyStr} />
                                        {timeRows.map((r) => (
                                            <MetaRow key={r.label} label={r.label} value={r.value} />
                                        ))}
                                        <MetaRow label="Uploaded by" value={uploaderName} />
                                    </dl>
                                </aside>
                            </div>
                        </div>
                    </div>
                );
            })()}
        </div>
    );
};

export default ProjectDetail;
