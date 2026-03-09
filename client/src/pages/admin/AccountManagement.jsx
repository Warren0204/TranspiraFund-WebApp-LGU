import { memo, useState, useMemo, useEffect } from 'react';
import {
    Trash2, Plus, X, Shield, Mail, UserPlus,
    FileText, HardHat, Map, CheckCircle2, AlertTriangle, User,
    ArrowLeft, Send, AlertCircle
} from 'lucide-react';
import AdminSidebar from '../../components/layout/AdminSidebar';
import AccountProvisioningService from '../../services/AccountProvisioningService';
import SuccessModal from '../../components/shared/SuccessModal';
import { ROLE_METADATA } from '../../config/roles';
import { collection, query, onSnapshot, orderBy } from 'firebase/firestore';
import { db } from '../../config/firebase';
import { accountProvisionSchema } from '../../config/validationSchemas';

const MIS_PROVISIONABLE_ROLES = ['MAYOR', 'DEPW', 'CPDO'];
const DEPARTMENT_HEAD_ROLES   = ['MIS', 'MAYOR', 'DEPW', 'CPDO'];

const ROLE_ICONS = { MAYOR: FileText, DEPW: HardHat, CPDO: Map };

const ROLE_SHORT_NAMES = { MAYOR: 'City Mayor', DEPW: 'DEPW Head', CPDO: 'CPDO Head' };

const ROLE_DESCRIPTIONS = {
    MAYOR: 'Final approver for infrastructure projects and fund disbursements.',
    DEPW:  'Manages engineering projects, field engineers, and public works.',
    CPDO:  'Oversees city planning, zoning, and development permits.',
};

const ROLE_PERMISSIONS = {
    MAYOR: ['Approve or reject infrastructure projects', 'Fund disbursement authorization', 'View all project reports'],
    DEPW:  ['Create and manage projects', 'Provision field engineers', 'Submit milestone reports'],
    CPDO:  ['City planning oversight', 'Zoning and permit review', 'Development plan approval'],
};

const ROLE_GRADIENTS = {
    MAYOR: { gradient: 'from-violet-600 to-purple-500', glow: 'shadow-violet-500/30', ambient: 'bg-violet-500/10' },
    DEPW:  { gradient: 'from-teal-600 to-emerald-500',  glow: 'shadow-teal-500/30',   ambient: 'bg-teal-500/10'   },
    CPDO:  { gradient: 'from-blue-600 to-cyan-500',     glow: 'shadow-blue-500/30',   ambient: 'bg-blue-500/10'   },
};

const useRosterLogic = () => {
    const REQUIRED_ROLES = useMemo(() => ROLE_METADATA, []);
    const [accounts, setAccounts] = useState([]);

    useEffect(() => {
        const q = query(collection(db, 'users'), orderBy('createdAt', 'desc'));
        const unsubscribe = onSnapshot(q, (snapshot) => {
            const fetchedAccounts = snapshot.docs
                .map(doc => {
                    const data = doc.data();
                    const roleMeta = REQUIRED_ROLES.find(r => r.type === data.role);
                    const prefix = roleMeta?.titlePrefix ? roleMeta.titlePrefix + ' ' : '';
                    return {
                        id: doc.id,
                        name: `${prefix}${data.firstName} ${data.lastName}`,
                        email: data.email,
                        department: data.department || roleMeta?.dept || 'Unassigned',
                        roleType: data.role,
                        roleLabel: roleMeta?.label || data.role,
                        initial: (data.firstName || 'U').charAt(0).toUpperCase()
                    };
                })
                .filter(acc => DEPARTMENT_HEAD_ROLES.includes(acc.roleType));
            setAccounts(fetchedAccounts);
        });
        return () => unsubscribe();
    }, [REQUIRED_ROLES]);

    const roster = useMemo(() => MIS_PROVISIONABLE_ROLES.map(roleType => {
        const roleMeta = REQUIRED_ROLES.find(r => r.type === roleType);
        const account  = accounts.find(a => a.roleType === roleType);
        return {
            roleType,
            shortName:   ROLE_SHORT_NAMES[roleType] || roleType,
            label:       roleMeta?.label || roleType,
            dept:        roleMeta?.dept || '',
            titlePrefix: roleMeta?.titlePrefix || '',
            description: ROLE_DESCRIPTIONS[roleType] || '',
            icon:        ROLE_ICONS[roleType] || FileText,
            isFilled:    !!account,
            account:     account || null,
        };
    }), [accounts, REQUIRED_ROLES]);

    const filledCount = roster.filter(r =>  r.isFilled).length;
    const vacantCount = roster.filter(r => !r.isFilled).length;

    const [provisionForm, setProvisionForm]       = useState({ firstName: '', lastName: '', email: '', roleType: '' });
    const [validationErrors, setValidationErrors] = useState({});
    const [deleteCandidateId, setDeleteCandidateId] = useState(null);
    const [isRevoking, setIsRevoking]             = useState(false);
    const [isProvisionModalOpen, setIsProvisionModalOpen] = useState(false);
    const [confirmingAccount, setConfirmingAccount] = useState(null);
    const [isSending, setIsSending]               = useState(false);
    const [provisionError, setProvisionError]     = useState(null);
    const [credentialsSent, setCredentialsSent]   = useState(false);
    const [successEmail, setSuccessEmail]         = useState('');

    const handleDelete  = (id) => setDeleteCandidateId(id);
    const cancelRevoke  = () => { if (!isRevoking) setDeleteCandidateId(null); };
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
            setProvisionError(error.message || 'Failed to delete account.');
        }
    };

    const openProvisionForRole = (roleType) => {
        setProvisionForm({ firstName: '', lastName: '', email: '', roleType });
        setValidationErrors({});
        setIsProvisionModalOpen(true);
    };
    const closeProvisionModal = () => setIsProvisionModalOpen(false);

    const toProperCase = (str) => str.replace(/\w\S*/g, txt => txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase());

    const handleStageProvision = (e) => {
        e.preventDefault();
        setValidationErrors({});

        const validationResult = accountProvisionSchema.safeParse(provisionForm);
        if (!validationResult.success) {
            const errors = {};
            validationResult.error.errors.forEach(err => { errors[err.path[0]] = err.message; });
            setValidationErrors(errors);
            return;
        }

        const isDuplicate = accounts.some(
            a => a.email.toLowerCase() === provisionForm.email.trim().toLowerCase()
        );
        if (isDuplicate) {
            setValidationErrors({ email: 'An account with this email already exists.' });
            return;
        }

        const roleMeta = REQUIRED_ROLES.find(r => r.type === provisionForm.roleType);
        if (!roleMeta) return;
        const properFirst = toProperCase(provisionForm.firstName);
        const properLast  = toProperCase(provisionForm.lastName);
        const fullName    = `${roleMeta.titlePrefix ? roleMeta.titlePrefix + ' ' : ''}${properFirst} ${properLast}`;
        setConfirmingAccount({
            name: fullName, rawFirstName: properFirst, rawLastName: properLast,
            department: roleMeta.dept, roleType: roleMeta.type,
            initial: properFirst.charAt(0).toUpperCase(),
            email: provisionForm.email.trim(), roleLabel: roleMeta.label
        });
        setIsProvisionModalOpen(false);
    };

    const handleBackToProvision = () => {
        setConfirmingAccount(null);
        setProvisionError(null);
        setIsProvisionModalOpen(true);
    };

    const handleGenerateCredentials = async () => {
        if (!confirmingAccount || isSending) return;
        setIsSending(true);
        setProvisionError(null);
        try {
            await AccountProvisioningService.provisionAccount({
                email:      confirmingAccount.email,
                firstName:  confirmingAccount.rawFirstName,
                lastName:   confirmingAccount.rawLastName,
                roleType:   confirmingAccount.roleType,
                department: confirmingAccount.department,
                roleLabel:  confirmingAccount.roleLabel
            });
            setIsSending(false);
            setSuccessEmail(confirmingAccount.email);
            setCredentialsSent(true);
            setConfirmingAccount(null);
        } catch (error) {
            setIsSending(false);
            setProvisionError(error.message || 'Failed to provision account.');
        }
    };

    const handleCloseSuccess = () => setCredentialsSent(false);
    const handleFormChange   = (e) => setProvisionForm({ ...provisionForm, [e.target.name]: e.target.value });

    return {
        roster, filledCount, vacantCount,
        provisionForm, handleFormChange, validationErrors,
        handleDelete, openProvisionForRole, closeProvisionModal, isProvisionModalOpen, handleStageProvision,
        deleteCandidateId, confirmRevoke, cancelRevoke, isRevoking,
        confirmingAccount, isSending, credentialsSent, handleGenerateCredentials, handleCloseSuccess,
        handleBackToProvision,
        provisionError, successEmail
    };
};

const FilledRoleCard = memo(({ slot, onRevoke, index }) => {
    const Icon = slot.icon;
    const { gradient, glow, ambient } = ROLE_GRADIENTS[slot.roleType] || ROLE_GRADIENTS.DEPW;
    return (
        <div
            className="relative overflow-hidden rounded-[24px] p-6 bg-white/70 dark:bg-slate-900/50 backdrop-blur-xl border border-white/80 dark:border-white/5 shadow-xl shadow-slate-200/50 dark:shadow-black/20 group"
            style={{ animation: `slideUp 0.5s ease-out ${0.2 + index * 0.1}s both` }}
        >
            <div className={`absolute top-0 left-0 right-0 h-1 bg-gradient-to-r ${gradient}`} />
            <div className={`absolute -top-8 -right-8 w-32 h-32 rounded-full ${ambient} blur-2xl pointer-events-none`} />

            <div className="relative">
                <div className="flex items-start gap-3 mb-5">
                    <div className={`w-11 h-11 rounded-xl bg-gradient-to-br ${gradient} flex items-center justify-center shrink-0 shadow-lg ${glow}`}>
                        <Icon size={18} className="text-white" />
                    </div>
                    <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                            <h3 className="text-[15px] font-extrabold text-slate-800 dark:text-slate-100 tracking-tight">{slot.shortName}</h3>
                            <span className="shrink-0 px-2.5 py-1 rounded-full text-[10px] font-bold flex items-center gap-1 uppercase tracking-wider bg-teal-50 dark:bg-teal-900/30 text-teal-700 dark:text-teal-300 border border-teal-200 dark:border-teal-500/30">
                                <CheckCircle2 size={9} /> Active
                            </span>
                        </div>
                        <p className="text-[11px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest mt-0.5">{slot.dept}</p>
                    </div>
                </div>

                <div className="bg-slate-50/80 dark:bg-slate-800/40 border border-slate-100 dark:border-slate-700/50 rounded-2xl p-4 mb-4">
                    <div className="flex items-center gap-3">
                        <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${gradient} flex items-center justify-center font-bold text-white text-sm shrink-0 shadow-md ${glow}`}>
                            {slot.account.initial}
                        </div>
                        <div className="min-w-0">
                            <p className="font-bold text-slate-800 dark:text-slate-100 text-sm truncate">{slot.account.name}</p>
                            <div className="flex items-center gap-1.5 text-slate-400 dark:text-slate-500 text-xs mt-0.5">
                                <Mail size={11} className="shrink-0" />
                                <span className="truncate">{slot.account.email}</span>
                            </div>
                        </div>
                    </div>
                </div>

                <div className="flex justify-end">
                    <button
                        onClick={() => onRevoke(slot.account.id)}
                        className="text-xs font-bold text-red-500 dark:text-red-400 hover:text-white px-3 py-2 rounded-lg border border-red-200 dark:border-red-500/30 hover:bg-red-600 dark:hover:bg-red-600 transition-all flex items-center gap-1.5 lg:opacity-0 lg:group-hover:opacity-100"
                    >
                        <Trash2 size={13} /> Revoke Access
                    </button>
                </div>
            </div>
        </div>
    );
});

const VacantRoleCard = memo(({ slot, onProvision, index }) => {
    const Icon = slot.icon;
    return (
        <div
            className="relative overflow-hidden rounded-[24px] p-6 bg-amber-50/60 dark:bg-amber-900/10 backdrop-blur-xl border-2 border-dashed border-amber-300 dark:border-amber-500/30 shadow-lg shadow-amber-100/50 dark:shadow-black/20 group transition-all duration-300 hover:-translate-y-0.5"
            style={{ animation: `slideUp 0.5s ease-out ${0.2 + index * 0.1}s both` }}
        >
            <div className="absolute -top-6 -right-6 w-28 h-28 rounded-full bg-amber-400/10 blur-2xl pointer-events-none" />

            <div className="relative">
                <div className="flex items-start gap-3 mb-4">
                    <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-amber-400 to-orange-400 flex items-center justify-center shrink-0 shadow-md shadow-amber-400/25">
                        <Icon size={18} className="text-white" />
                    </div>
                    <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                            <h3 className="text-[15px] font-extrabold text-slate-800 dark:text-slate-100 tracking-tight">{slot.shortName}</h3>
                            <span className="shrink-0 px-2.5 py-1 rounded-full text-[10px] font-bold flex items-center gap-1 uppercase tracking-wider bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-500/30">
                                <AlertTriangle size={9} /> Vacant
                            </span>
                        </div>
                        <p className="text-[11px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest mt-0.5">{slot.dept}</p>
                    </div>
                </div>

                <p className="text-sm text-slate-500 dark:text-slate-400 leading-relaxed mb-5">{slot.description}</p>

                <button
                    onClick={() => onProvision(slot.roleType)}
                    className="w-full py-3.5 bg-gradient-to-r from-teal-600 to-emerald-500 hover:from-teal-700 hover:to-emerald-600 text-white font-bold rounded-xl shadow-lg shadow-teal-500/25 transition-all flex items-center justify-center gap-2 text-sm"
                >
                    <UserPlus size={16} />
                    Provision Account
                </button>
            </div>
        </div>
    );
});

const ProvisionModal = memo(({ isOpen, onClose, form, onChange, onSubmit, roleMeta, errors = {} }) => {
    if (!isOpen || !roleMeta) return null;

    const Icon = ROLE_ICONS[form.roleType] || FileText;
    const { gradient } = ROLE_GRADIENTS[form.roleType] || ROLE_GRADIENTS.DEPW;

    const toProper    = (str) => str.replace(/\w\S*/g, txt => txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase());
    const properFirst = form.firstName ? toProper(form.firstName) : '';
    const properLast  = form.lastName  ? toProper(form.lastName)  : '';
    const prefix      = roleMeta.titlePrefix ? `${roleMeta.titlePrefix} ` : '';
    const displayName = [properFirst, properLast].filter(Boolean).join(' ');
    const fullDisplay = displayName ? `${prefix}${displayName}` : null;
    const initial     = properFirst?.charAt(0).toUpperCase() || null;
    const hasAllFields = form.firstName.trim() && form.lastName.trim() && form.email.trim();
    const perms       = ROLE_PERMISSIONS[form.roleType] || [];

    const inputBase   = 'w-full pl-10 pr-4 py-3.5 bg-slate-50 dark:bg-slate-800/60 border rounded-xl text-sm font-medium text-slate-800 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:ring-2 outline-none transition-all focus:bg-white dark:focus:bg-slate-800';
    const inputNormal = 'border-slate-200 dark:border-slate-700 focus:border-teal-500 dark:focus:border-teal-400 focus:ring-teal-500/20 dark:focus:ring-teal-400/20';
    const inputError  = 'border-red-400 dark:border-red-500/60 ring-2 ring-red-100 dark:ring-red-900/30 bg-red-50/50 dark:bg-red-900/10';

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/70 backdrop-blur-md animate-in fade-in duration-200 p-4">
            <div className="relative bg-white dark:bg-slate-900 rounded-[28px] shadow-2xl w-full max-w-3xl animate-in zoom-in-95 duration-200 overflow-hidden border border-slate-200/80 dark:border-white/5 max-h-[92vh] flex flex-col">

                <div className={`relative bg-gradient-to-r ${gradient} px-7 pt-6 pb-6 overflow-hidden shrink-0`}>
                    <div className="absolute -top-8 -right-8 w-44 h-44 rounded-full bg-white/10 pointer-events-none" />
                    <div className="absolute -bottom-6 left-12 w-24 h-24 rounded-full bg-white/10 pointer-events-none" />
                    <div className="relative flex items-center justify-between gap-4 pr-12">
                        <div className="flex items-center gap-4">
                            <div className="w-12 h-12 rounded-2xl bg-white/20 backdrop-blur-sm flex items-center justify-center shadow-lg shrink-0">
                                <Icon size={22} className="text-white" />
                            </div>
                            <div>
                                <p className="text-white/65 text-[10px] font-extrabold uppercase tracking-[0.2em]">Account Provisioning</p>
                                <h3 className="text-xl font-extrabold text-white tracking-tight leading-tight">{roleMeta.label}</h3>
                                <p className="text-white/75 text-sm font-medium">{roleMeta.dept}</p>
                            </div>
                        </div>
                        <div className="hidden sm:flex items-center gap-1.5 bg-white/15 border border-white/20 rounded-full px-3 py-1.5 shrink-0">
                            <span className="w-1.5 h-1.5 rounded-full bg-white/70 animate-pulse" />
                            <span className="text-white/80 text-[10px] font-bold uppercase tracking-wide">Step 1 of 2</span>
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        className="absolute top-4 right-4 z-30 w-9 h-9 rounded-full bg-white/20 hover:bg-white/35 flex items-center justify-center text-white transition-all cursor-pointer"
                        aria-label="Close"
                    >
                        <X size={18} strokeWidth={2.5} />
                    </button>
                </div>

                <div className="flex flex-col md:flex-row flex-1 overflow-hidden">

                    <div className="flex-1 p-6 overflow-y-auto space-y-4">

                        <div className="grid grid-cols-2 gap-3">
                            <div>
                                <label className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-2 block">First Name</label>
                                <div className="relative">
                                    <User className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500 pointer-events-none" size={14} />
                                    <input type="text" name="firstName" placeholder="Maria" value={form.firstName} onChange={onChange}
                                        className={`${inputBase} ${errors.firstName ? inputError : inputNormal}`} />
                                </div>
                                {errors.firstName && <p className="text-xs text-red-500 font-semibold mt-1.5">{errors.firstName}</p>}
                            </div>
                            <div>
                                <label className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-2 block">Last Name</label>
                                <div className="relative">
                                    <User className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500 pointer-events-none" size={14} />
                                    <input type="text" name="lastName" placeholder="Santos" value={form.lastName} onChange={onChange}
                                        className={`${inputBase} ${errors.lastName ? inputError : inputNormal}`} />
                                </div>
                                {errors.lastName && <p className="text-xs text-red-500 font-semibold mt-1.5">{errors.lastName}</p>}
                            </div>
                        </div>

                        <div>
                            <label className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-2 block">Official Email Address</label>
                            <div className="relative">
                                <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500 pointer-events-none" size={14} />
                                <input type="email" name="email" placeholder="official@lgu.gov.ph" value={form.email} onChange={onChange}
                                    className={`${inputBase} ${errors.email ? inputError : inputNormal}`} />
                            </div>
                            {errors.email && <p className="text-xs text-red-500 font-semibold mt-1.5">{errors.email}</p>}
                        </div>

                        <div className="flex items-center gap-3 px-4 py-3.5 bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/60 rounded-xl">
                            <div className={`w-8 h-8 rounded-lg bg-gradient-to-br ${gradient} flex items-center justify-center shrink-0 shadow-sm`}>
                                <Icon size={14} className="text-white" />
                            </div>
                            <div className="flex-1 min-w-0">
                                <p className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wide">Provisioning For</p>
                                <p className="text-sm font-bold text-slate-800 dark:text-slate-100 truncate">{roleMeta.label}</p>
                            </div>
                            <Shield size={14} className="text-slate-300 dark:text-slate-600 shrink-0" />
                        </div>

                        <button
                            onClick={onSubmit}
                            disabled={!hasAllFields}
                            className={`w-full py-3.5 bg-gradient-to-r ${gradient} hover:brightness-110 text-white font-bold rounded-xl shadow-lg transition-all flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed text-sm`}
                        >
                            <Plus size={17} strokeWidth={2.5} />
                            Review & Provision
                        </button>
                    </div>

                    <div className="hidden md:block w-px bg-slate-100 dark:bg-slate-800 self-stretch shrink-0" />

                    <div className="hidden md:flex md:w-72 lg:w-80 flex-col bg-slate-50/50 dark:bg-slate-800/20 overflow-y-auto p-6 gap-4 shrink-0">
                        <p className="text-[10px] font-extrabold uppercase tracking-[0.18em] text-slate-400 dark:text-slate-500">Live Preview</p>

                        <div className="bg-white dark:bg-slate-900/80 border border-slate-100 dark:border-slate-700/50 rounded-2xl p-5 text-center">
                            <div className={`w-16 h-16 rounded-2xl mx-auto mb-3 flex items-center justify-center text-2xl font-black text-white shadow-lg transition-all duration-300 ${initial ? `bg-gradient-to-br ${gradient}` : 'bg-slate-100 dark:bg-slate-700'}`}>
                                {initial ?? <User size={24} className="text-slate-400 dark:text-slate-500" />}
                            </div>
                            <p className={`font-extrabold text-[15px] leading-tight mb-1 transition-colors duration-200 ${fullDisplay ? 'text-slate-800 dark:text-slate-100' : 'text-slate-300 dark:text-slate-600 italic text-sm'}`}>
                                {fullDisplay || 'Full name appears here'}
                            </p>
                            <p className={`text-xs truncate transition-colors duration-200 ${form.email ? 'text-teal-600 dark:text-teal-400 font-semibold' : 'text-slate-300 dark:text-slate-600 italic'}`}>
                                {form.email || 'email@lgu.gov.ph'}
                            </p>
                            <div className={`inline-flex items-center gap-1.5 mt-3 px-3 py-1.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-gradient-to-r ${gradient} text-white shadow-sm`}>
                                <Icon size={10} />
                                {roleMeta.titlePrefix}
                            </div>
                        </div>

                        <div className="bg-white dark:bg-slate-900/80 border border-slate-100 dark:border-slate-700/50 rounded-2xl p-4">
                            <p className="text-[10px] font-extrabold uppercase tracking-[0.15em] text-slate-400 dark:text-slate-500 mb-2">Role Scope</p>
                            <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">{ROLE_DESCRIPTIONS[form.roleType]}</p>
                        </div>

                        <div className="bg-white dark:bg-slate-900/80 border border-slate-100 dark:border-slate-700/50 rounded-2xl p-4">
                            <p className="text-[10px] font-extrabold uppercase tracking-[0.15em] text-slate-400 dark:text-slate-500 mb-3">Access Capabilities</p>
                            <ul className="space-y-2.5">
                                {perms.map((perm, i) => (
                                    <li key={i} className="flex items-start gap-2.5 text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                                        <span className={`w-4 h-4 rounded-full bg-gradient-to-br ${gradient} flex items-center justify-center shrink-0 mt-0.5`}>
                                            <CheckCircle2 size={9} className="text-white" />
                                        </span>
                                        {perm}
                                    </li>
                                ))}
                            </ul>
                        </div>
                    </div>

                </div>
            </div>
        </div>
    );
});

const ReviewProvisionModal = memo(({ data, onBack, onConfirm, isProcessing, error }) => {
    if (!data) return null;

    const Icon = ROLE_ICONS[data.roleType] || FileText;
    const { gradient, glow } = ROLE_GRADIENTS[data.roleType] || ROLE_GRADIENTS.DEPW;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/70 backdrop-blur-md animate-in fade-in duration-200 p-4">
            <div className="relative bg-white dark:bg-slate-900 rounded-[28px] shadow-2xl w-full max-w-lg animate-in zoom-in-95 duration-200 overflow-hidden border border-slate-200/80 dark:border-white/5">

                <div className={`relative bg-gradient-to-br ${gradient} px-7 pt-7 pb-12 overflow-hidden`}>
                    <div className="absolute -top-8 -right-8 w-44 h-44 rounded-full bg-white/10 pointer-events-none" />
                    <div className="absolute -bottom-4 left-8 w-20 h-20 rounded-full bg-white/10 pointer-events-none" />
                    <div className="relative">
                        <div className="flex items-center gap-2 mb-3">
                            <div className="flex items-center gap-1.5 bg-white/15 border border-white/20 rounded-full px-3 py-1.5">
                                <span className="w-1.5 h-1.5 rounded-full bg-emerald-300 animate-pulse" />
                                <span className="text-white/80 text-[10px] font-bold uppercase tracking-wide">Step 2 of 2</span>
                            </div>
                        </div>
                        <h3 className="text-2xl font-extrabold text-white tracking-tight">Review & Confirm</h3>
                        <p className="text-white/70 text-sm font-medium mt-1">Verify provisioning details before finalizing.</p>
                    </div>
                </div>

                <div className="px-7 -mt-7 relative z-10 mb-5">
                    <div className="bg-white dark:bg-slate-800 border border-slate-100 dark:border-slate-700/50 rounded-2xl p-5 shadow-xl">
                        <div className="flex items-center gap-4">
                            <div className={`w-14 h-14 rounded-2xl bg-gradient-to-br ${gradient} flex items-center justify-center font-extrabold text-white text-xl shrink-0 shadow-lg ${glow}`}>
                                {data.initial}
                            </div>
                            <div className="min-w-0 flex-1">
                                <p className="font-extrabold text-base text-slate-800 dark:text-slate-100 truncate">{data.name}</p>
                                <div className="flex items-center gap-1.5 mt-1">
                                    <Mail size={12} className="text-slate-400 shrink-0" />
                                    <p className="text-sm text-teal-600 dark:text-teal-400 font-semibold truncate">{data.email}</p>
                                </div>
                            </div>
                            <div className={`shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[10px] font-bold uppercase tracking-wider bg-gradient-to-br ${gradient} text-white shadow-sm`}>
                                <Icon size={11} />
                                {data.roleType}
                            </div>
                        </div>
                    </div>
                </div>

                <div className="px-7 mb-5 space-y-3">
                    <div className="grid grid-cols-2 gap-3">
                        {[
                            { label: 'Department',  value: data.department },
                            { label: 'Access Role', value: data.roleType   },
                        ].map(({ label, value }) => (
                            <div key={label} className="bg-slate-50 dark:bg-slate-800/60 border border-slate-100 dark:border-slate-700/50 rounded-xl px-4 py-3.5">
                                <p className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-1">{label}</p>
                                <p className="text-sm font-bold text-slate-700 dark:text-slate-200 truncate">{value}</p>
                            </div>
                        ))}
                    </div>

                    <div className="flex items-start gap-3 bg-teal-50/70 dark:bg-teal-900/15 border border-teal-200/70 dark:border-teal-500/20 rounded-xl px-4 py-3.5">
                        <Send size={15} className="text-teal-600 dark:text-teal-400 shrink-0 mt-0.5" />
                        <p className="text-xs text-teal-700 dark:text-teal-300 font-medium leading-relaxed">
                            A temporary password will be auto-generated and emailed to{' '}
                            <span className="font-bold">{data.email}</span>. The official must change it on first login.
                        </p>
                    </div>
                </div>

                {error && (
                    <div className="px-7 mb-5">
                        <div className="bg-red-50 dark:bg-red-900/20 border border-red-100 dark:border-red-500/20 rounded-xl p-4 flex gap-3">
                            <AlertCircle className="text-red-500 shrink-0 mt-0.5" size={16} />
                            <p className="text-red-600 dark:text-red-400 text-sm font-medium">{error}</p>
                        </div>
                    </div>
                )}

                <div className="px-7 pb-7 flex gap-3">
                    <button
                        onClick={onBack}
                        disabled={isProcessing}
                        className="flex-1 py-3.5 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 font-bold rounded-xl transition-all flex items-center justify-center gap-2 disabled:opacity-50 text-sm"
                    >
                        <ArrowLeft size={16} />
                        Back &amp; Edit
                    </button>
                    <button
                        onClick={onConfirm}
                        disabled={isProcessing}
                        className={`flex-1 py-3.5 bg-gradient-to-r ${gradient} hover:brightness-110 text-white font-bold rounded-xl shadow-lg transition-all flex items-center justify-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed text-sm`}
                    >
                        {isProcessing ? (
                            <><span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Processing...</>
                        ) : (
                            <><Send size={15} /> Provision Account</>
                        )}
                    </button>
                </div>

            </div>
        </div>
    );
});

const RevokeModal = memo(({ isOpen, onConfirm, onCancel, isProcessing }) => {
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
                <h3 className="text-xl font-extrabold text-slate-900 dark:text-white tracking-tight mb-2">Revoke Official Access?</h3>
                <p className="text-slate-500 dark:text-slate-400 text-sm font-medium mb-6 leading-relaxed max-w-[260px]">
                    This will <span className="text-red-500 font-bold">permanently remove</span> the official's system access and credentials. This cannot be undone.
                </p>
                <div className="flex gap-3 w-full">
                    <button onClick={onCancel} disabled={isProcessing}
                        className="flex-1 py-3.5 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 font-bold rounded-xl transition-all disabled:opacity-50">
                        Cancel
                    </button>
                    <button onClick={onConfirm} disabled={isProcessing}
                        className="flex-1 py-3.5 bg-gradient-to-r from-red-600 to-rose-500 hover:from-red-700 hover:to-rose-600 text-white font-bold rounded-xl shadow-lg shadow-red-500/25 transition-all flex items-center justify-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed">
                        {isProcessing
                            ? <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                            : <><Trash2 size={16} /> Yes, Revoke</>
                        }
                    </button>
                </div>
            </div>
        </div>
    );
});

const AccountManagement = () => {
    const {
        roster, filledCount, vacantCount,
        provisionForm, handleFormChange, validationErrors,
        handleDelete, openProvisionForRole, closeProvisionModal, isProvisionModalOpen, handleStageProvision,
        deleteCandidateId, confirmRevoke, cancelRevoke, isRevoking,
        confirmingAccount, isSending, credentialsSent, handleGenerateCredentials, handleCloseSuccess,
        handleBackToProvision,
        provisionError, successEmail
    } = useRosterLogic();

    const activeRoleMeta = useMemo(() => ROLE_METADATA.find(r => r.type === provisionForm.roleType) || null, [provisionForm.roleType]);

    return (
        <div className="min-h-screen depw-bg font-sans text-slate-900 dark:text-slate-100 transition-colors duration-300">
            <AdminSidebar />

            <main className="ml-0 md:ml-72 p-4 md:p-6 lg:p-10 pt-20 md:pt-10">

                <div
                    className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-5 mb-10"
                    style={{ animation: 'fadeIn 0.5s ease-out both' }}
                >
                    <div>
                        <div className="flex items-center gap-2.5 mb-2">
                            <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-teal-600 to-emerald-500 flex items-center justify-center shadow-md shadow-teal-500/30">
                                <Shield size={14} className="text-white" strokeWidth={2.5} />
                            </div>
                            <span className="text-[11px] font-extrabold uppercase tracking-[0.18em] text-teal-600 dark:text-emerald-400">
                                Organizational Access
                            </span>
                        </div>
                        <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-slate-900 dark:text-white">
                            Account Roster
                        </h1>
                        <p className="text-sm text-slate-500 dark:text-slate-400 font-medium mt-1">
                            Manage official system access for designated city officials.
                        </p>
                    </div>
                </div>

                <div className="flex items-center gap-3 mb-8 flex-wrap" style={{ animation: 'fadeIn 0.4s ease-out 0.1s both' }}>
                    <div className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-teal-50 dark:bg-teal-900/30 border border-teal-200 dark:border-teal-500/30 text-teal-700 dark:text-teal-300 text-sm font-bold">
                        <CheckCircle2 size={15} /> {filledCount} Active
                    </div>
                    {vacantCount > 0 && (
                        <div className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-500/30 text-amber-700 dark:text-amber-300 text-sm font-bold">
                            <AlertTriangle size={15} /> {vacantCount} Vacant
                        </div>
                    )}
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 lg:gap-6">
                    {roster.map((slot, i) =>
                        slot.isFilled
                            ? <FilledRoleCard key={slot.roleType} slot={slot} onRevoke={handleDelete} index={i} />
                            : <VacantRoleCard key={slot.roleType} slot={slot} onProvision={openProvisionForRole} index={i} />
                    )}
                </div>

            </main>

            <ProvisionModal
                isOpen={isProvisionModalOpen} onClose={closeProvisionModal}
                form={provisionForm} onChange={handleFormChange}
                onSubmit={handleStageProvision} roleMeta={activeRoleMeta} errors={validationErrors}
            />
            <RevokeModal isOpen={!!deleteCandidateId} onConfirm={confirmRevoke} onCancel={cancelRevoke} isProcessing={isRevoking} />
            <ReviewProvisionModal
                data={confirmingAccount}
                onBack={handleBackToProvision}
                onConfirm={handleGenerateCredentials}
                isProcessing={isSending}
                error={provisionError}
            />
            <SuccessModal isOpen={credentialsSent} onClose={handleCloseSuccess} email={successEmail} />
        </div>
    );
};

export default AccountManagement;