import { memo, useState, useMemo, useEffect } from 'react';
import {
    Plus, Users, X, AlertCircle, Search, HardHat, Mail, Trash2, AlertTriangle, User
} from 'lucide-react';
import HcsdSidebar from '../../components/layout/HcsdSidebar';
import AccountProvisioningService from '../../services/AccountProvisioningService';
import ConfirmAssignmentModal from '../../components/shared/ConfirmAssignmentModal';
import SuccessModal from '../../components/shared/SuccessModal';
import { ROLES, ROLE_METADATA } from '../../config/roles';
import { collection, query, onSnapshot, orderBy } from 'firebase/firestore';
import { db } from '../../config/firebase';
import { staffProvisionSchema } from '../../config/validationSchemas';
import { useDebounce } from '../../hooks/useDebounce';

const useStaffLogic = () => {
    const ENGINEER_ROLE = ROLES.PROJECT_ENGINEER;

    const [staff, setStaff] = useState([]);
    const [searchTerm, setSearchTerm] = useState('');

    useEffect(() => {
        const q = query(collection(db, "users"), orderBy("createdAt", "desc"));
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
                            initial: (data.firstName || 'E').charAt(0).toUpperCase(),
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
    }, [ENGINEER_ROLE]);

    const debouncedSearchTerm = useDebounce(searchTerm, 300);
    const filteredStaff = useMemo(() => {
        if (!debouncedSearchTerm.trim()) return staff;
        const lowerTerm = debouncedSearchTerm.toLowerCase();
        return staff.filter(s =>
            s.name.toLowerCase().includes(lowerTerm) ||
            s.email.toLowerCase().includes(lowerTerm)
        );
    }, [staff, debouncedSearchTerm]);

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
            initial: properFirst.charAt(0).toUpperCase(),
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
        filteredStaff, searchTerm, setSearchTerm,
        provisionForm, handleFormChange, formErrors,
        handleDelete, openProvisionModal, closeProvisionModal, isProvisionModalOpen, handleStageProvision,
        deleteCandidateId, confirmRevoke, cancelRevoke, isRevoking,
        confirmingAccount, isSending, credentialsSent, handleGenerateCredentials, handleCloseSuccess, cancelProvision,
        provisionError, successEmail
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

const StaffManagement = () => {
    const {
        filteredStaff, searchTerm, setSearchTerm,
        provisionForm, handleFormChange, formErrors,
        handleDelete, openProvisionModal, closeProvisionModal, isProvisionModalOpen, handleStageProvision,
        deleteCandidateId, confirmRevoke, cancelRevoke, isRevoking,
        confirmingAccount, isSending, credentialsSent, handleGenerateCredentials, handleCloseSuccess, cancelProvision,
        provisionError, successEmail
    } = useStaffLogic();

    return (
        <div className="min-h-screen hcsd-bg font-sans text-slate-900 dark:text-slate-100">
            <HcsdSidebar />

            <main className="ml-0 md:ml-72 p-4 md:p-6 lg:p-10 pt-20 md:pt-10">

                <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4 mb-8"
                    style={{ animation: 'fadeIn 0.4s ease-out both' }}>
                    <div>
                        <div className="inline-flex items-center gap-2 bg-teal-500/10 dark:bg-teal-500/20 border border-teal-500/20 dark:border-teal-400/30 rounded-full px-3 py-1 mb-3">
                            <div className="w-1.5 h-1.5 rounded-full bg-teal-500 dark:bg-teal-400" />
                            <span className="text-xs font-bold text-teal-700 dark:text-teal-300 uppercase tracking-widest">Field Personnel</span>
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

                <div className="bg-white/70 dark:bg-slate-900/50 backdrop-blur-xl border border-white/80 dark:border-white/5 rounded-[24px] shadow-xl overflow-hidden"
                    style={{ animation: 'slideUp 0.5s ease-out 0.1s both' }}>

                    <div className="p-5 sm:p-6 border-b border-slate-200/60 dark:border-slate-700/40 flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3 bg-white/40 dark:bg-slate-800/20">
                        <div className="flex items-center gap-2.5">
                            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-teal-500 to-emerald-400 flex items-center justify-center">
                                <Users size={15} className="text-white" />
                            </div>
                            <span className="font-bold text-slate-700 dark:text-slate-200 text-sm">
                                {filteredStaff.length} Engineer{filteredStaff.length !== 1 ? 's' : ''} on Roster
                            </span>
                        </div>
                        <div className="relative group w-full sm:w-80">
                            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500 group-focus-within:text-teal-500 dark:group-focus-within:text-teal-400 transition-colors" size={17} />
                            <input type="text" placeholder="Search by name or email..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)}
                                className="w-full pl-11 pr-4 py-3 bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-xl text-sm font-medium text-slate-700 dark:text-slate-300 placeholder:text-slate-400 dark:placeholder:text-slate-600 focus:ring-2 focus:ring-teal-500 dark:focus:ring-teal-400 outline-none transition-all" />
                        </div>
                    </div>

                    <div className="grid grid-cols-12 px-5 sm:px-7 py-3 bg-slate-50/70 dark:bg-slate-800/30 border-b border-slate-100 dark:border-slate-700/40 text-[11px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-[0.1em]">
                        <div className="col-span-7 sm:col-span-5 pl-2">Engineer Identity</div>
                        <div className="hidden sm:block sm:col-span-5">Role & Access</div>
                        <div className="col-span-5 sm:col-span-2 text-right pr-2">Actions</div>
                    </div>

                    <div>
                        {filteredStaff.length === 0 ? (
                            <div className="flex flex-col items-center justify-center py-24 text-slate-400 dark:text-slate-600">
                                <div className="w-16 h-16 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center mb-4">
                                    <HardHat size={28} className="text-slate-300 dark:text-slate-600" />
                                </div>
                                <p className="text-slate-500 dark:text-slate-400 font-semibold text-base">No engineers found</p>
                                <p className="text-slate-400 dark:text-slate-500 text-sm mt-1">Try adjusting your search term</p>
                            </div>
                        ) : (
                            filteredStaff.map((s, i) => (
                                <div key={s.id}
                                    className="grid grid-cols-12 items-center px-5 sm:px-7 py-4 sm:py-5 border-b border-slate-100/70 dark:border-slate-700/30 last:border-b-0 hover:bg-teal-500/5 dark:hover:bg-teal-400/5 border-l-2 border-l-transparent hover:border-l-teal-500 dark:hover:border-l-teal-400 transition-all group"
                                    style={{ animation: `slideUp 0.4s ease-out ${i * 0.06}s both` }}>

                                    <div className="col-span-7 sm:col-span-5 flex items-center gap-3 min-w-0">
                                        <div className="relative w-11 h-11 rounded-xl bg-gradient-to-br from-teal-500 to-emerald-400 flex items-center justify-center font-bold text-white text-base shadow-lg shadow-teal-500/20 shrink-0">
                                            {s.initial}
                                        </div>
                                        <div className="min-w-0">
                                            <h4 className="font-bold text-slate-800 dark:text-slate-100 text-sm truncate">{s.name}</h4>
                                            <div className="flex items-center gap-1.5 text-slate-400 dark:text-slate-500 text-xs mt-0.5">
                                                <Mail size={11} className="shrink-0" />
                                                <span className="truncate">{s.email}</span>
                                            </div>
                                        </div>
                                    </div>

                                    <div className="hidden sm:block sm:col-span-5">
                                        <div className="flex items-center gap-2 mb-1">
                                            <span className="inline-flex px-2.5 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wide bg-teal-100 dark:bg-teal-900/40 text-teal-700 dark:text-teal-300 border border-teal-200 dark:border-teal-500/30">
                                                {s.roleLabel}
                                            </span>
                                            <span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide border ${s.status === 'Active' ? 'bg-emerald-50 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400 border-emerald-200 dark:border-emerald-500/30' : 'bg-slate-50 dark:bg-slate-800 text-slate-500 dark:text-slate-400 border-slate-200 dark:border-slate-600'}`}>
                                                {s.status}
                                            </span>
                                        </div>
                                        <p className="text-[10px] font-semibold text-slate-400 dark:text-slate-500">{s.department}</p>
                                    </div>

                                    <div className="col-span-5 sm:col-span-2 flex justify-end">
                                        <button onClick={() => handleDelete(s.id)}
                                            className="text-xs font-bold text-red-500 dark:text-red-400 hover:text-white px-3 py-2 rounded-lg border border-red-200 dark:border-red-500/30 hover:bg-red-600 dark:hover:bg-red-600 transition-all flex items-center gap-1.5 lg:opacity-0 lg:group-hover:opacity-100">
                                            <Trash2 size={13} className="shrink-0" />
                                            <span className="hidden sm:inline">Revoke</span>
                                        </button>
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                </div>
            </main>

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
