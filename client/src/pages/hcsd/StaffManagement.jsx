import { memo, useState, useMemo, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    Plus, Users, X, AlertCircle, Search, HardHat, Mail, Trash2, AlertTriangle, User,
    FolderKanban, MapPin, Clock, ArrowRight, Wallet, MoreVertical, Wrench, CheckCircle2, Loader2
} from 'lucide-react';
import HcsdSidebar from '../../components/layout/HcsdSidebar';
import AccountProvisioningService from '../../services/AccountProvisioningService';
import ConfirmAssignmentModal from '../../components/shared/ConfirmAssignmentModal';
import SuccessModal from '../../components/shared/SuccessModal';
import { ROLES, ROLE_METADATA } from '../../config/roles';
import { collection, query, where, onSnapshot, orderBy } from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import app, { db } from '../../config/firebase';
import { staffProvisionSchema } from '../../config/validationSchemas';
import { useDebounce } from '../../hooks/useDebounce';
import { useAuth } from '../../context/AuthContext';

const useStaffLogic = () => {
    const navigate = useNavigate();
    const { tenantId } = useAuth();
    const ENGINEER_ROLE = ROLES.PROJECT_ENGINEER;

    const [staff, setStaff] = useState([]);
    const [projectsByEngineer, setProjectsByEngineer] = useState({});
    const [searchTerm, setSearchTerm] = useState('');

    useEffect(() => {
        if (!tenantId) return;
        const q = query(
            collection(db, "users"),
            where("tenantId", "==", tenantId),
            orderBy("createdAt", "desc"),
        );
        const unsubscribe = onSnapshot(q,
            (snapshot) => {
                const fetchedStaff = snapshot.docs
                    .map(doc => {
                        const data = doc.data();
                        return {
                            id: doc.id,
                            name: `Engr. ${data.firstName} ${data.lastName}`,
                            email: data.email,
                            department: data.department || 'Unassigned Department',
                            roleLabel: 'Project Engineer',
                            status: data.status || 'Active',
                            initial: ((data.firstName || '').charAt(0) + (data.lastName || '').charAt(0)).toUpperCase() || 'E',
                            photoURL: data.photoURL || null,
                            _rawRole: data.role
                        };
                    })
                    .filter(s =>
                        s._rawRole === ENGINEER_ROLE ||
                        s._rawRole === 'Project Engineer' ||
                        s._rawRole === 'PROJ_ENG'
                    );
                setStaff(fetchedStaff);
            },
            () => {}
        );
        return () => unsubscribe();
    }, [ENGINEER_ROLE, tenantId]);

    // Real-time project workload, keyed by engineer UID.
    useEffect(() => {
        if (!tenantId) return;
        const q = query(
            collection(db, 'projects'),
            where('tenantId', '==', tenantId),
            orderBy('createdAt', 'desc'),
        );
        const unsub = onSnapshot(q, (snap) => {
            const map = {};
            snap.docs.forEach(d => {
                const data = d.data();
                const eng = data.projectEngineer;
                if (!eng) return;
                if (!map[eng]) map[eng] = [];
                map[eng].push({
                    id: d.id,
                    name: data.projectName || 'Untitled Project',
                    status: data.status || 'Ongoing',
                    barangay: data.barangay || null,
                    contractAmount: data.contractAmount || null,
                    originalDateCompletion: data.originalDateCompletion || null,
                    actualPercent: data.actualPercent ?? data.progress ?? 0,
                });
            });
            setProjectsByEngineer(map);
        }, () => {});
        return () => unsub();
    }, [tenantId]);

    const debouncedSearchTerm = useDebounce(searchTerm, 300);
    const filteredStaff = useMemo(() => {
        const base = !debouncedSearchTerm.trim()
            ? staff
            : (() => {
                const lowerTerm = debouncedSearchTerm.toLowerCase();
                return staff.filter(s =>
                    s.name.toLowerCase().includes(lowerTerm) ||
                    s.email.toLowerCase().includes(lowerTerm)
                );
            })();
        return base.map(s => ({ ...s, projects: projectsByEngineer[s.id] || [] }));
    }, [staff, debouncedSearchTerm, projectsByEngineer]);

    const [provisionForm, setProvisionForm] = useState({ firstName: '', lastName: '', email: '' });
    const [formErrors, setFormErrors] = useState({});
    const [deleteCandidateId, setDeleteCandidateId] = useState(null);
    const [isRevoking, setIsRevoking] = useState(false);
    const [isProvisionModalOpen, setIsProvisionModalOpen] = useState(false);
    const [confirmingAccount, setConfirmingAccount] = useState(null);
    const [isSending, setIsSending] = useState(false);
    const [provisionError, setProvisionError] = useState(null);
    const [credentialsSent, setCredentialsSent] = useState(false);
    const [successEmail, setSuccessEmail] = useState('');

    // Legacy data detection: if any key in projectsByEngineer is NOT a known engineer UID,
    // it's a stale name-keyed entry from the pre-UID era and needs backfilling.
    const legacyKeyCount = useMemo(() => {
        if (staff.length === 0) return 0;
        const uidSet = new Set(staff.map(s => s.id));
        return Object.keys(projectsByEngineer).filter(k => !uidSet.has(k)).length;
    }, [staff, projectsByEngineer]);

    const [isBackfilling, setIsBackfilling] = useState(false);
    const [backfillResult, setBackfillResult] = useState(null);
    const [backfillError, setBackfillError] = useState('');

    const runBackfill = async () => {
        if (isBackfilling) return;
        setIsBackfilling(true);
        setBackfillError('');
        try {
            const fn = httpsCallable(getFunctions(app, 'asia-southeast1'), 'backfillProjectEngineerUids');
            const res = await fn();
            setBackfillResult(res.data);
        } catch (err) {
            setBackfillError(err.message || 'Backfill failed. Please try again.');
        } finally {
            setIsBackfilling(false);
        }
    };
    const dismissBackfillResult = () => { setBackfillResult(null); setBackfillError(''); };

    const handleDelete = (id) => setDeleteCandidateId(id);
    const confirmRevoke = async () => {
        if (!deleteCandidateId || isRevoking) return;
        setIsRevoking(true);
        setProvisionError(null);
        try {
            await AccountProvisioningService.deleteAccount(deleteCandidateId);
            setIsRevoking(false);
            setDeleteCandidateId(null);
        } catch (error) {
            setIsRevoking(false);
            setProvisionError(error.message || "Failed to revoke access.");
        }
    };
    const cancelRevoke = () => { if (!isRevoking) setDeleteCandidateId(null); };

    const openProvisionModal = () => {
        setProvisionForm({ firstName: '', lastName: '', email: '' });
        setFormErrors({});
        setIsProvisionModalOpen(true);
    };
    const closeProvisionModal = () => setIsProvisionModalOpen(false);

    const toProperCase = (str) => str.replace(/\w\S*/g, (txt) => txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase());

    const handleStageProvision = (e) => {
        e.preventDefault();
        setFormErrors({});
        const validationResult = staffProvisionSchema.safeParse(provisionForm);
        if (!validationResult.success) {
            const errors = {};
            validationResult.error.errors.forEach(err => { errors[err.path[0]] = err.message; });
            setFormErrors(errors);
            return;
        }
        const roleMeta = ROLE_METADATA.find(r => r.type === ENGINEER_ROLE);
        const properFirst = toProperCase(provisionForm.firstName);
        const properLast = toProperCase(provisionForm.lastName);
        setConfirmingAccount({
            name: `Engr. ${properFirst} ${properLast}`,
            rawFirstName: properFirst, rawLastName: properLast,
            department: roleMeta.dept, roleType: ENGINEER_ROLE,
            initial: (properFirst.charAt(0) + properLast.charAt(0)).toUpperCase(),
            email: provisionForm.email, roleLabel: 'Project Engineer'
        });
        setIsProvisionModalOpen(false);
    };

    const handleGenerateCredentials = async () => {
        if (!confirmingAccount || isSending) return;
        setIsSending(true);
        setProvisionError(null);
        try {
            await AccountProvisioningService.provisionAccount({
                email: confirmingAccount.email,
                firstName: confirmingAccount.rawFirstName,
                lastName: confirmingAccount.rawLastName,
                roleType: confirmingAccount.roleType,
                department: confirmingAccount.department,
                roleLabel: confirmingAccount.roleLabel
            });
            setIsSending(false);
            setSuccessEmail(confirmingAccount.email);
            setCredentialsSent(true);
            setConfirmingAccount(null);
        } catch (error) {
            setIsSending(false);
            setProvisionError(error.message || "Failed to provision engineer.");
        }
    };

    const handleCloseSuccess = () => setCredentialsSent(false);
    const cancelProvision = () => { setConfirmingAccount(null); setProvisionError(null); };
    const handleFormChange = (e) => setProvisionForm({ ...provisionForm, [e.target.name]: e.target.value });

    return {
        filteredStaff, searchTerm, setSearchTerm, navigate,
        provisionForm, handleFormChange, formErrors,
        handleDelete, openProvisionModal, closeProvisionModal, isProvisionModalOpen, handleStageProvision,
        deleteCandidateId, confirmRevoke, cancelRevoke, isRevoking,
        confirmingAccount, isSending, credentialsSent, handleGenerateCredentials, handleCloseSuccess, cancelProvision,
        provisionError, successEmail,
        legacyKeyCount, isBackfilling, backfillResult, backfillError, runBackfill, dismissBackfillResult
    };
};

const ProvisionModal = memo(({ isOpen, onClose, form, onChange, onSubmit, errors }) => {
    if (!isOpen) return null;

    const toProper = (str) => str.replace(/\w\S*/g, txt => txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase());
    const properFirst = form.firstName ? toProper(form.firstName) : '';
    const properLast = form.lastName ? toProper(form.lastName) : '';
    const displayName = [properFirst, properLast].filter(Boolean).join(' ');
    const initial = properFirst?.charAt(0).toUpperCase() || null;
    const hasAllFields = form.firstName && form.lastName && form.email;

    const inputBase = 'w-full pl-10 pr-4 py-3.5 bg-white dark:bg-slate-800 border rounded-xl text-sm font-medium text-slate-800 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:ring-2 outline-none transition-all';
    const inputNormal = 'border-slate-300 dark:border-slate-600 focus:border-teal-500 dark:focus:border-teal-400 focus:ring-teal-500/20 dark:focus:ring-teal-400/20';
    const inputError = 'border-red-400 dark:border-red-500/60 ring-2 ring-red-100 dark:ring-red-900/30';

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/70 backdrop-blur-md animate-in fade-in duration-200 p-4">
            <div className="relative bg-white dark:bg-slate-900 rounded-[28px] shadow-2xl w-full max-w-xl animate-in zoom-in-95 duration-200 overflow-hidden border border-slate-200/80 dark:border-white/5">

                <button onClick={onClose}
                    className="absolute top-4 right-4 z-30 w-11 h-11 rounded-full bg-white/20 hover:bg-white/35 active:bg-white/50 flex items-center justify-center text-white transition-all cursor-pointer"
                    aria-label="Close">
                    <X size={20} strokeWidth={2.5} />
                </button>

                <div className="relative bg-gradient-to-br from-teal-600 via-teal-500 to-emerald-500 px-7 pt-7 pb-12 overflow-hidden">
                    <div className="absolute -top-6 -right-6 w-36 h-36 rounded-full bg-white/10 pointer-events-none" />
                    <div className="absolute bottom-0 left-4 w-20 h-20 rounded-full bg-emerald-400/20 pointer-events-none" />

                    <div className="relative flex items-center gap-4 pr-12">
                        <div className="w-12 h-12 rounded-2xl bg-white/20 backdrop-blur-sm flex items-center justify-center shadow-lg shrink-0">
                            <HardHat size={22} className="text-white" />
                        </div>
                        <div>
                            <h3 className="text-xl font-extrabold text-white tracking-tight">Add Project Engineer</h3>
                            <p className="text-white/80 text-sm font-medium mt-0.5">Provision a new field engineer account</p>
                        </div>
                    </div>
                </div>

                <div className="px-6 -mt-6 relative z-10 mb-5">
                    <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl p-4 shadow-xl flex items-center gap-3.5">
                        <div className={`w-11 h-11 rounded-xl flex items-center justify-center font-extrabold text-white text-lg shadow-md shrink-0 transition-all duration-300 ${initial ? 'bg-gradient-to-br from-teal-500 to-emerald-400' : 'bg-slate-100 dark:bg-slate-700'}`}>
                            {initial ?? <User size={18} className="text-slate-400 dark:text-slate-500" />}
                        </div>
                        <div className="min-w-0 flex-1">
                            <p className={`font-extrabold text-sm truncate transition-colors duration-200 ${displayName ? 'text-slate-800 dark:text-slate-100' : 'text-slate-300 dark:text-slate-600'}`}>
                                {displayName ? `Engr. ${displayName}` : 'Name Preview'}
                            </p>
                            <p className={`text-xs mt-0.5 truncate transition-colors duration-200 ${form.email ? 'text-slate-400 dark:text-slate-500' : 'text-slate-300 dark:text-slate-600'}`}>
                                {form.email || 'email@lgu.gov.ph'}
                            </p>
                        </div>
                        <span className="shrink-0 inline-flex px-2.5 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wide bg-teal-100 dark:bg-teal-900/40 text-teal-700 dark:text-teal-300 border border-teal-200 dark:border-teal-500/30">
                            Proj. Eng.
                        </span>
                    </div>
                    <p className="text-xs font-medium text-slate-500 dark:text-slate-400 text-center mt-2">
                        Live preview — updates as you type
                    </p>
                </div>

                <div className="px-6 pb-6 space-y-4">

                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="text-sm font-semibold text-slate-700 dark:text-slate-200 mb-2 block">First Name</label>
                            <div className="relative">
                                <User className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500 pointer-events-none" size={15} />
                                <input type="text" name="firstName" placeholder="e.g. Juan" value={form.firstName} onChange={onChange}
                                    className={`${inputBase} ${errors.firstName ? inputError : inputNormal}`} />
                            </div>
                            {errors.firstName && <p className="text-xs text-red-500 font-semibold mt-1.5">{errors.firstName}</p>}
                        </div>
                        <div>
                            <label className="text-sm font-semibold text-slate-700 dark:text-slate-200 mb-2 block">Last Name</label>
                            <div className="relative">
                                <User className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500 pointer-events-none" size={15} />
                                <input type="text" name="lastName" placeholder="e.g. Dela Cruz" value={form.lastName} onChange={onChange}
                                    className={`${inputBase} ${errors.lastName ? inputError : inputNormal}`} />
                            </div>
                            {errors.lastName && <p className="text-xs text-red-500 font-semibold mt-1.5">{errors.lastName}</p>}
                        </div>
                    </div>

                    <div>
                        <label className="text-sm font-semibold text-slate-700 dark:text-slate-200 mb-2 block">Official Email Address</label>
                        <div className="relative">
                            <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500 pointer-events-none" size={15} />
                            <input type="email" name="email" placeholder="e.g. official@eng.lgu.gov.ph" value={form.email} onChange={onChange}
                                className={`${inputBase} ${errors.email ? inputError : inputNormal}`} />
                        </div>
                        {errors.email && <p className="text-xs text-red-500 font-semibold mt-1.5">{errors.email}</p>}
                    </div>

                    <div className="flex items-center justify-between px-4 py-4 bg-teal-50 dark:bg-teal-900/20 border border-teal-200 dark:border-teal-500/30 rounded-xl">
                        <div className="flex items-center gap-3">
                            <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-teal-500 to-emerald-400 flex items-center justify-center shrink-0">
                                <HardHat size={16} className="text-white" />
                            </div>
                            <div>
                                <p className="text-xs font-bold text-teal-600 dark:text-teal-400 uppercase tracking-wide mb-0.5">Assigned Role</p>
                                <p className="text-sm font-bold text-teal-900 dark:text-teal-100">Project Engineer</p>
                            </div>
                        </div>
                        <span className="text-xs font-bold px-3 py-1.5 bg-white dark:bg-teal-900/60 text-teal-600 dark:text-teal-300 rounded-full border border-teal-200 dark:border-teal-500/50">
                            Locked
                        </span>
                    </div>

                    <button onClick={onSubmit} disabled={!hasAllFields}
                        className="w-full py-3.5 bg-gradient-to-r from-teal-600 to-emerald-500 hover:from-teal-700 hover:to-emerald-600 text-white font-bold rounded-xl shadow-lg shadow-teal-500/25 hover:shadow-teal-500/40 transition-all flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed text-sm">
                        <Plus size={17} strokeWidth={2.5} />
                        Review & Provision
                    </button>
                </div>
            </div>
        </div>
    );
});

const RevokeModal = memo(({ isOpen, onClose, onConfirm, isProcessing, error }) => {
    if (!isOpen) return null;
    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/70 backdrop-blur-md animate-in fade-in duration-200 p-4">
            <div className="bg-white/95 dark:bg-slate-900/95 backdrop-blur-xl border border-white/80 dark:border-white/10 rounded-[28px] shadow-2xl w-full max-w-sm animate-in zoom-in-95 duration-200 flex flex-col items-center text-center p-8">

                <div className="relative mb-5">
                    <div className="w-[72px] h-[72px] rounded-full bg-gradient-to-br from-red-500 to-rose-600 flex items-center justify-center shadow-xl shadow-red-500/30">
                        <AlertTriangle size={32} className="text-white" strokeWidth={2.5} />
                    </div>
                    <div className="absolute inset-0 rounded-full bg-red-400/30 blur-2xl scale-150 -z-10" />
                </div>

                <h3 className="text-xl font-extrabold text-slate-900 dark:text-white tracking-tight mb-2">
                    Revoke Engineer Access?
                </h3>
                <p className="text-slate-500 dark:text-slate-400 text-sm font-medium mb-6 leading-relaxed max-w-[260px]">
                    This will <span className="text-red-500 font-bold">permanently delete</span> the account and remove all system access. This cannot be undone.
                </p>

                {error && (
                    <div className="w-full mb-5 bg-red-50 dark:bg-red-900/20 border border-red-100 dark:border-red-500/20 rounded-xl p-4 flex gap-3 text-left">
                        <AlertCircle className="text-red-500 shrink-0 mt-0.5" size={16} />
                        <p className="text-red-600 dark:text-red-400 text-xs font-bold">{error}</p>
                    </div>
                )}

                <div className="flex gap-3 w-full">
                    <button onClick={onClose} disabled={isProcessing}
                        className="flex-1 py-3.5 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 font-bold rounded-xl transition-all disabled:opacity-50">
                        Cancel
                    </button>
                    <button onClick={onConfirm} disabled={isProcessing}
                        className="flex-1 py-3.5 bg-gradient-to-r from-red-600 to-rose-500 hover:from-red-700 hover:to-rose-600 text-white font-bold rounded-xl shadow-lg shadow-red-500/25 transition-all flex items-center justify-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed">
                        {isProcessing ? (
                            <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                        ) : (
                            <>
                                <Trash2 size={16} />
                                Yes, Revoke
                            </>
                        )}
                    </button>
                </div>
            </div>
        </div>
    );
});

/* ── Shared helpers ──────────────────────────────────────────────────────── */
const projectStatusStyle = (status) => {
    const s = (status || '').toLowerCase();
    if (s === 'completed') return { pill: 'bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-500/30', bar: 'bg-emerald-400', accent: 'bg-emerald-400' };
    if (s === 'delayed')   return { pill: 'bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-500/30',   bar: 'bg-amber-400',   accent: 'bg-amber-400' };
    if (s === 'returned')  return { pill: 'bg-rose-50 dark:bg-rose-900/30 text-rose-700 dark:text-rose-300 border-rose-200 dark:border-rose-500/30',         bar: 'bg-rose-400',    accent: 'bg-rose-400' };
    return { pill: 'bg-teal-50 dark:bg-teal-900/30 text-teal-700 dark:text-teal-300 border-teal-200 dark:border-teal-500/30', bar: 'bg-teal-400', accent: 'bg-teal-400' };
};

const fmtAmt = (amt) => {
    if (!amt) return null;
    if (amt >= 1_000_000) return `₱${(amt / 1_000_000).toFixed(2)}M`;
    if (amt >= 1_000)     return `₱${(amt / 1_000).toFixed(0)}K`;
    return `₱${Number(amt).toLocaleString('en-PH')}`;
};

/* ── Engineer Detail Modal ───────────────────────────────────────────────── */
const EngineerModal = ({ engineer, onClose, onRevoke, navigate }) => {
    const [showActions, setShowActions] = useState(false);
    if (!engineer) return null;
    return (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-6 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-200"
            onClick={onClose}>
            <div className="relative bg-white dark:bg-slate-900 rounded-t-[32px] sm:rounded-[32px] shadow-2xl border border-slate-200/80 dark:border-white/5 w-full sm:max-w-2xl max-h-[92vh] flex flex-col animate-in slide-in-from-bottom-4 sm:zoom-in-95 duration-300 overflow-hidden"
                onClick={e => e.stopPropagation()}>

                {/* ── X close button — lifted to modal level so overflow-hidden on header never clips it ── */}
                <button onClick={onClose}
                    className="absolute top-4 right-4 z-30 w-11 h-11 rounded-full bg-white/20 hover:bg-white/35 active:bg-white/50 flex items-center justify-center text-white transition-all"
                    aria-label="Close">
                    <X size={20} strokeWidth={2.5} />
                </button>

                {/* ── More actions button (⋯) — opens menu containing Revoke ── */}
                <div className="absolute top-4 right-[60px] z-30">
                    <button
                        onClick={(e) => { e.stopPropagation(); setShowActions(v => !v); }}
                        className="w-11 h-11 rounded-full bg-white/20 hover:bg-white/35 active:bg-white/50 flex items-center justify-center text-white transition-all"
                        aria-label="More actions">
                        <MoreVertical size={18} strokeWidth={2.5} />
                    </button>
                    {showActions && (
                        <>
                            <div className="fixed inset-0 z-10" onClick={() => setShowActions(false)} />
                            <div className="absolute top-[52px] right-0 z-20 w-56 bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-700 rounded-2xl shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150">
                                <div className="px-4 pt-3 pb-2 border-b border-slate-100 dark:border-slate-700/60">
                                    <p className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest">Account Actions</p>
                                </div>
                                <button
                                    onClick={() => { setShowActions(false); onRevoke(engineer.id); onClose(); }}
                                    className="w-full flex items-center gap-3 px-4 py-3.5 text-sm font-semibold text-red-500 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors">
                                    <Trash2 size={15} className="shrink-0" />
                                    Revoke Engineer Access
                                </button>
                            </div>
                        </>
                    )}
                </div>

                {/* ── Header ── */}
                <div className="relative bg-gradient-to-br from-teal-600 via-teal-500 to-emerald-500 px-7 pt-7 pb-10 shrink-0 overflow-hidden">
                    <div className="absolute -top-10 -right-10 w-48 h-48 rounded-full bg-white/10 pointer-events-none" />
                    <div className="absolute -bottom-6 left-10 w-32 h-32 rounded-full bg-emerald-400/20 pointer-events-none" />

                    {/* pr-28 reserves space so engineer name doesn't slide under the two header buttons */}
                    <div className="relative flex items-center gap-5 pr-28">
                        {engineer.photoURL ? (
                            <img src={engineer.photoURL} alt={engineer.name}
                                className="w-20 h-20 rounded-full object-cover shadow-xl shrink-0 border-2 border-white/30" />
                        ) : (
                            <div className="w-20 h-20 rounded-full bg-white/25 backdrop-blur-sm flex items-center justify-center font-black text-white text-3xl shadow-xl shrink-0 border border-white/20">
                                {engineer.initial}
                            </div>
                        )}
                        <div className="min-w-0">
                            <h2 className="text-2xl font-extrabold text-white tracking-tight leading-tight">{engineer.name}</h2>
                            <div className="flex items-center gap-2 mt-1.5">
                                <Mail size={14} className="text-white/60 shrink-0" />
                                <p className="text-white/80 text-sm font-medium truncate">{engineer.email}</p>
                            </div>
                            <p className="text-white/60 text-sm mt-0.5">{engineer.department}</p>
                        </div>
                    </div>

                    <div className="relative flex items-center gap-2.5 mt-5">
                        <span className="inline-flex px-3.5 py-1.5 rounded-xl text-xs font-bold uppercase tracking-wide bg-white/20 text-white border border-white/25">
                            {engineer.roleLabel}
                        </span>
                        <span className={`inline-flex px-3.5 py-1.5 rounded-xl text-xs font-bold uppercase tracking-wide border ${engineer.status === 'Active' ? 'bg-emerald-400/25 text-white border-emerald-300/30' : 'bg-white/10 text-white/70 border-white/20'}`}>
                            ● {engineer.status}
                        </span>
                    </div>
                </div>

                {/* ── Projects header ── */}
                <div className="shrink-0 px-6 py-4 flex items-center justify-between bg-slate-50 dark:bg-slate-800/40 border-b border-slate-200 dark:border-slate-700/60">
                    <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-teal-500 to-emerald-400 flex items-center justify-center shrink-0">
                            <FolderKanban size={16} className="text-white" />
                        </div>
                        <div>
                            <p className="text-sm font-extrabold text-slate-700 dark:text-slate-200 uppercase tracking-wider">Assigned Projects</p>
                            <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">
                                {engineer.projects.length === 0
                                    ? 'No projects currently assigned'
                                    : `${engineer.projects.length} project${engineer.projects.length !== 1 ? 's' : ''} under this engineer`}
                            </p>
                        </div>
                    </div>
                    <span className={`text-sm font-black w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${engineer.projects.length > 0 ? 'bg-teal-100 dark:bg-teal-900/50 text-teal-700 dark:text-teal-300' : 'bg-slate-100 dark:bg-slate-800 text-slate-400'}`}>
                        {engineer.projects.length}
                    </span>
                </div>

                {/* ── Project list ── */}
                <div className="flex-1 overflow-y-auto p-5 space-y-3">
                    {engineer.projects.length === 0 ? (
                        <div className="flex flex-col items-center justify-center py-14 gap-4">
                            <div className="w-20 h-20 rounded-2xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center">
                                <FolderKanban size={32} className="text-slate-300 dark:text-slate-600" />
                            </div>
                            <div className="text-center">
                                <p className="text-base font-bold text-slate-500 dark:text-slate-400">No Projects Assigned</p>
                                <p className="text-sm text-slate-400 dark:text-slate-500 mt-1">When projects are assigned to this engineer, they will appear here.</p>
                            </div>
                        </div>
                    ) : engineer.projects.map((p) => {
                        const st = projectStatusStyle(p.status);
                        const due = p.originalDateCompletion
                            ? new Date(p.originalDateCompletion).toLocaleDateString('en-PH', { month: 'long', day: 'numeric', year: 'numeric' })
                            : null;
                        return (
                            <button key={p.id}
                                onClick={() => { navigate(`/hcsd/projects/${p.id}`); onClose(); }}
                                className="w-full text-left bg-white dark:bg-slate-800/60 hover:bg-slate-50 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-700/60 hover:border-teal-300 dark:hover:border-teal-500/40 hover:shadow-md rounded-2xl overflow-hidden transition-all duration-200 group/card">

                                <div className={`h-1.5 w-full ${st.bar}`} />

                                <div className="p-5">
                                    <div className="flex items-start justify-between gap-3 mb-3">
                                        <p className="text-base font-bold text-slate-800 dark:text-slate-100 leading-snug group-hover/card:text-teal-700 dark:group-hover/card:text-teal-300 transition-colors">
                                            {p.name}
                                        </p>
                                        <span className={`inline-flex items-center px-3 py-1 rounded-lg text-xs font-bold uppercase tracking-wide border shrink-0 ${st.pill}`}>
                                            {p.status}
                                        </span>
                                    </div>

                                    <div className="flex flex-wrap gap-x-5 gap-y-2 mb-4">
                                        {p.barangay && (
                                            <span className="inline-flex items-center gap-1.5 text-sm text-slate-500 dark:text-slate-400">
                                                <MapPin size={13} className="text-teal-500 shrink-0" />
                                                Barangay {p.barangay}
                                            </span>
                                        )}
                                        {fmtAmt(p.contractAmount) && (
                                            <span className="inline-flex items-center gap-1.5 text-sm text-slate-500 dark:text-slate-400">
                                                <Wallet size={13} className="text-teal-500 shrink-0" />
                                                {fmtAmt(p.contractAmount)}
                                            </span>
                                        )}
                                        {due && (
                                            <span className="inline-flex items-center gap-1.5 text-sm text-slate-500 dark:text-slate-400">
                                                <Clock size={13} className="text-teal-500 shrink-0" />
                                                Due {due}
                                            </span>
                                        )}
                                    </div>

                                    <div>
                                        <div className="flex items-center justify-between mb-1.5">
                                            <span className="text-xs font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wide">Completion</span>
                                            <span className="text-sm font-black text-slate-600 dark:text-slate-300 tabular-nums">{p.actualPercent}%</span>
                                        </div>
                                        <div className="w-full h-2.5 bg-slate-100 dark:bg-slate-700 rounded-full overflow-hidden">
                                            <div className={`h-full rounded-full transition-all duration-700 ${st.bar}`} style={{ width: `${p.actualPercent}%` }} />
                                        </div>
                                    </div>
                                </div>
                            </button>
                        );
                    })}
                </div>

                {/* ── Footer — just Close; Revoke is in the ⋯ menu above ── */}
                <div className="shrink-0 px-6 py-5 border-t border-slate-200 dark:border-slate-700/60 bg-white dark:bg-slate-900">
                    <button onClick={onClose}
                        className="w-full py-4 rounded-2xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 font-bold text-base transition-all">
                        Close
                    </button>
                </div>
            </div>
        </div>
    );
};

/* ── Main page ───────────────────────────────────────────────────────────── */
const StaffManagement = () => {
    const {
        filteredStaff, searchTerm, setSearchTerm, navigate,
        provisionForm, handleFormChange, formErrors,
        handleDelete, openProvisionModal, closeProvisionModal, isProvisionModalOpen, handleStageProvision,
        deleteCandidateId, confirmRevoke, cancelRevoke, isRevoking,
        confirmingAccount, isSending, credentialsSent, handleGenerateCredentials, handleCloseSuccess, cancelProvision,
        provisionError, successEmail,
        legacyKeyCount, isBackfilling, backfillResult, backfillError, runBackfill, dismissBackfillResult
    } = useStaffLogic();

    const [selectedEngineer, setSelectedEngineer] = useState(null);

    // Keep drawer in sync when live data updates (e.g. new project assigned)
    useEffect(() => {
        if (selectedEngineer) {
            const updated = filteredStaff.find(s => s.id === selectedEngineer.id);
            if (updated) setSelectedEngineer(updated);
        }
    }, [filteredStaff]); // eslint-disable-line react-hooks/exhaustive-deps

    return (
        <div className="min-h-screen hcsd-bg font-sans text-slate-900 dark:text-slate-100">
            <HcsdSidebar />

            <main className="ml-0 md:ml-72 p-4 md:p-6 lg:p-10 pt-20 md:pt-10">

                {/* ── Page header ── */}
                <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4 mb-8"
                    style={{ animation: 'fadeIn 0.4s ease-out both' }}>
                    <div>
                        <div className="inline-flex items-center gap-2 bg-teal-500/10 dark:bg-teal-500/20 border border-teal-500/20 dark:border-teal-400/30 rounded-full px-3 py-1 mb-3">
                            <div className="w-1.5 h-1.5 rounded-full bg-teal-500 dark:bg-teal-400" />
                            <span className="text-xs font-bold text-teal-700 dark:text-teal-300 uppercase tracking-widest whitespace-nowrap">Field Personnel</span>
                        </div>
                        <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 dark:text-white tracking-tight">
                            Field Staff Management
                        </h1>
                        <p className="text-slate-500 dark:text-slate-400 font-medium mt-1 text-sm">
                            Manage roster, credentials, and access for Project Engineers.
                        </p>
                    </div>
                    <div className="shrink-0">
                        <button onClick={openProvisionModal}
                            className="w-full md:w-auto bg-gradient-to-r from-teal-600 to-emerald-500 hover:from-teal-700 hover:to-emerald-600 text-white font-bold py-3.5 px-7 rounded-xl shadow-lg shadow-teal-500/25 hover:shadow-teal-500/35 transition-all flex items-center justify-center gap-2 text-sm">
                            <Plus size={18} strokeWidth={2.5} />
                            Add Engineer
                        </button>
                    </div>
                </div>

                {/* ── Legacy-data maintenance banner ── */}
                {legacyKeyCount > 0 && !backfillResult && (
                    <div className="mb-6 rounded-2xl border border-amber-200 dark:border-amber-500/30 bg-amber-50/80 dark:bg-amber-900/20 p-4 sm:p-5 flex flex-col sm:flex-row items-start sm:items-center gap-4"
                        style={{ animation: 'fadeIn 0.4s ease-out both' }}>
                        <div className="w-10 h-10 rounded-xl bg-amber-500/15 dark:bg-amber-400/20 flex items-center justify-center shrink-0">
                            <Wrench size={18} className="text-amber-700 dark:text-amber-300" />
                        </div>
                        <div className="flex-1 min-w-0">
                            <p className="text-sm font-bold text-amber-900 dark:text-amber-100">
                                {legacyKeyCount} legacy project assignment{legacyKeyCount !== 1 ? 's' : ''} detected
                            </p>
                            <p className="text-xs font-medium text-amber-800/80 dark:text-amber-200/80 mt-0.5">
                                Older projects still reference engineers by display name instead of UID, so they don't appear on the assigned engineer's mobile app. Run this one-time fix to reconcile them.
                            </p>
                            {backfillError && (
                                <p className="text-xs font-semibold text-red-600 dark:text-red-400 mt-2 flex items-center gap-1.5">
                                    <AlertCircle size={13} /> {backfillError}
                                </p>
                            )}
                        </div>
                        <button onClick={runBackfill} disabled={isBackfilling}
                            className="shrink-0 bg-amber-600 hover:bg-amber-700 disabled:opacity-60 disabled:cursor-not-allowed text-white font-bold py-2.5 px-5 rounded-xl shadow-md transition-all flex items-center gap-2 text-sm">
                            {isBackfilling ? <><Loader2 size={15} className="animate-spin" /> Fixing…</> : <><Wrench size={15} strokeWidth={2.5} /> Fix Now</>}
                        </button>
                    </div>
                )}

                {/* ── Backfill result modal ── */}
                {backfillResult && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/70 backdrop-blur-md p-4"
                        role="dialog" aria-modal="true">
                        <div className="bg-white dark:bg-slate-900 rounded-[24px] shadow-2xl w-full max-w-md p-6 border border-slate-200 dark:border-white/5"
                            style={{ animation: 'zoomIn 0.2s ease-out both' }}>
                            <div className="flex items-start gap-3 mb-4">
                                <div className="w-11 h-11 rounded-xl bg-emerald-500/15 dark:bg-emerald-400/20 flex items-center justify-center shrink-0">
                                    <CheckCircle2 size={20} className="text-emerald-600 dark:text-emerald-400" />
                                </div>
                                <div className="min-w-0">
                                    <h3 className="text-lg font-extrabold text-slate-900 dark:text-white">Backfill complete</h3>
                                    <p className="text-xs font-medium text-slate-500 dark:text-slate-400 mt-0.5">
                                        Scanned {backfillResult.scanned} project{backfillResult.scanned !== 1 ? 's' : ''}.
                                    </p>
                                </div>
                            </div>
                            <div className="space-y-2 text-sm font-semibold">
                                <div className="flex justify-between px-3 py-2 rounded-lg bg-emerald-50 dark:bg-emerald-900/20 text-emerald-800 dark:text-emerald-200">
                                    <span>Updated to UID</span><span>{backfillResult.updated}</span>
                                </div>
                                <div className="flex justify-between px-3 py-2 rounded-lg bg-slate-50 dark:bg-slate-800/60 text-slate-700 dark:text-slate-300">
                                    <span>Already UID-keyed</span><span>{backfillResult.alreadyUid}</span>
                                </div>
                                {backfillResult.unresolved?.length > 0 && (
                                    <div className="px-3 py-2 rounded-lg bg-amber-50 dark:bg-amber-900/20 text-amber-800 dark:text-amber-200">
                                        <div className="flex justify-between"><span>Unresolved</span><span>{backfillResult.unresolved.length}</span></div>
                                        <p className="text-[11px] font-medium mt-1.5 opacity-80">
                                            Names didn't match any current engineer — likely deleted accounts. Manual review needed.
                                        </p>
                                    </div>
                                )}
                            </div>
                            <button onClick={dismissBackfillResult}
                                className="mt-5 w-full py-3 rounded-xl bg-slate-900 dark:bg-white text-white dark:text-slate-900 font-bold text-sm hover:opacity-90 transition-all">
                                Done
                            </button>
                        </div>
                    </div>
                )}

                {/* ── Engineer list ── */}
                <div className="bg-white/70 dark:bg-slate-900/50 backdrop-blur-xl border border-white/80 dark:border-white/5 rounded-[24px] shadow-xl overflow-hidden"
                    style={{ animation: 'slideUp 0.5s ease-out 0.1s both' }}>

                    {/* List toolbar */}
                    <div className="p-4 sm:p-5 border-b border-slate-200/60 dark:border-slate-700/40 flex flex-col gap-3 bg-white/40 dark:bg-slate-800/20">
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2.5">
                                <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-teal-500 to-emerald-400 flex items-center justify-center shrink-0">
                                    <Users size={15} className="text-white" />
                                </div>
                                <span className="font-bold text-slate-700 dark:text-slate-200 text-sm">
                                    {filteredStaff.length} Engineer{filteredStaff.length !== 1 ? 's' : ''} on Roster
                                </span>
                            </div>
                            <span className="text-xs text-slate-400 dark:text-slate-500 hidden sm:block">
                                Click an engineer to view their projects
                            </span>
                        </div>
                        <div className="relative group">
                            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500 group-focus-within:text-teal-500 dark:group-focus-within:text-teal-400 transition-colors" size={15} />
                            <input type="text" placeholder="Search by name or email..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)}
                                className="w-full pl-9 pr-4 py-2.5 bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-xl text-sm font-medium text-slate-700 dark:text-slate-300 placeholder:text-slate-400 dark:placeholder:text-slate-600 focus:ring-2 focus:ring-teal-500 dark:focus:ring-teal-400 outline-none transition-all" />
                        </div>
                    </div>

                    {/* Column headers */}
                    <div className="grid grid-cols-12 px-5 sm:px-6 py-2.5 bg-slate-50/70 dark:bg-slate-800/30 border-b border-slate-100 dark:border-slate-700/40 text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-[0.1em]">
                        <div className="col-span-8 sm:col-span-7">Engineer</div>
                        <div className="hidden sm:block sm:col-span-3">Department</div>
                        <div className="col-span-4 sm:col-span-2 text-right">Projects</div>
                    </div>

                    {/* Rows */}
                    <div className="divide-y divide-slate-100/70 dark:divide-slate-700/30">
                        {filteredStaff.length === 0 ? (
                            <div className="flex flex-col items-center justify-center py-24">
                                <div className="w-16 h-16 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center mb-4">
                                    <HardHat size={28} className="text-slate-300 dark:text-slate-600" />
                                </div>
                                <p className="text-slate-500 dark:text-slate-400 font-semibold">No engineers found</p>
                                <p className="text-slate-400 dark:text-slate-500 text-sm mt-1">Try adjusting your search term</p>
                            </div>
                        ) : (
                            filteredStaff.map((s, i) => (
                                <button key={s.id}
                                    onClick={() => setSelectedEngineer(s)}
                                    className="w-full grid grid-cols-12 items-center px-5 sm:px-6 py-4 hover:bg-teal-500/[0.04] dark:hover:bg-teal-400/[0.05] border-l-2 border-transparent hover:border-teal-500 dark:hover:border-teal-400 transition-all duration-150 text-left group"
                                    style={{ animation: `slideUp 0.4s ease-out ${i * 0.05}s both` }}>

                                    {/* Engineer identity */}
                                    <div className="col-span-8 sm:col-span-7 flex items-center gap-3 min-w-0">
                                        {s.photoURL ? (
                                            <img src={s.photoURL} alt={s.name}
                                                className="w-10 h-10 rounded-full object-cover shadow-md shadow-teal-500/20 shrink-0 group-hover:scale-105 transition-transform duration-150 border border-slate-200 dark:border-slate-700" />
                                        ) : (
                                            <div className="w-10 h-10 rounded-full bg-gradient-to-br from-teal-500 to-emerald-400 flex items-center justify-center font-bold text-white text-sm shadow-md shadow-teal-500/20 shrink-0 group-hover:scale-105 transition-transform duration-150">
                                                {s.initial}
                                            </div>
                                        )}
                                        <div className="min-w-0">
                                            <p className="font-bold text-slate-800 dark:text-slate-100 text-sm truncate group-hover:text-teal-700 dark:group-hover:text-teal-300 transition-colors">
                                                {s.name}
                                            </p>
                                            <div className="flex items-center gap-1.5 mt-0.5">
                                                <Mail size={10} className="text-slate-400 shrink-0" />
                                                <span className="text-[11px] text-slate-400 dark:text-slate-500 truncate">{s.email}</span>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Department */}
                                    <div className="hidden sm:block sm:col-span-3 min-w-0 pr-3">
                                        <div className="flex items-center gap-1.5 mb-1">
                                            <span className="inline-flex px-2 py-0.5 rounded-md text-[9px] font-bold uppercase tracking-wide bg-teal-100 dark:bg-teal-900/40 text-teal-700 dark:text-teal-300 border border-teal-200 dark:border-teal-500/30">
                                                {s.roleLabel}
                                            </span>
                                            <span className={`inline-flex px-1.5 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wide border ${s.status === 'Active' ? 'bg-emerald-50 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400 border-emerald-200 dark:border-emerald-500/30' : 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 border-slate-200 dark:border-slate-600'}`}>
                                                {s.status}
                                            </span>
                                        </div>
                                        <p className="text-[10px] text-slate-400 dark:text-slate-500 truncate">{s.department}</p>
                                    </div>

                                    {/* Project count badge */}
                                    <div className="col-span-4 sm:col-span-2 flex items-center justify-end gap-2">
                                        <div className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl font-bold text-xs transition-all ${s.projects.length > 0 ? 'bg-teal-100 dark:bg-teal-900/40 text-teal-700 dark:text-teal-300' : 'bg-slate-100 dark:bg-slate-800 text-slate-400 dark:text-slate-500'}`}>
                                            <FolderKanban size={11} />
                                            <span>{s.projects.length}</span>
                                        </div>
                                        <ArrowRight size={14} className="text-slate-300 dark:text-slate-600 group-hover:text-teal-500 dark:group-hover:text-teal-400 transition-colors shrink-0" />
                                    </div>
                                </button>
                            ))
                        )}
                    </div>
                </div>
            </main>

            {/* ── Engineer detail modal ── */}
            <EngineerModal
                engineer={selectedEngineer}
                onClose={() => setSelectedEngineer(null)}
                onRevoke={(id) => { handleDelete(id); setSelectedEngineer(null); }}
                navigate={navigate}
            />

            <ProvisionModal isOpen={isProvisionModalOpen} onClose={closeProvisionModal} form={provisionForm}
                onChange={handleFormChange} onSubmit={handleStageProvision} errors={formErrors} />
            <ConfirmAssignmentModal isOpen={!!confirmingAccount} data={confirmingAccount} onConfirm={handleGenerateCredentials}
                onCancel={cancelProvision} isProcessing={isSending} error={provisionError} title="Confirm Engineer" confirmLabel="Confirm & Send Credentials" />
            <RevokeModal isOpen={!!deleteCandidateId} onClose={cancelRevoke} onConfirm={confirmRevoke} isProcessing={isRevoking} error={provisionError} />
            <SuccessModal isOpen={credentialsSent} onClose={handleCloseSuccess} email={successEmail} />
        </div>
    );
};

export default StaffManagement;
