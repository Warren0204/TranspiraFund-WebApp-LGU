import React, { memo, useState, useMemo, useEffect } from 'react';
import {
    Trash2, Plus, X, Shield, Mail, UserPlus,
    FileText, HardHat, Map, CheckCircle2, AlertTriangle
} from 'lucide-react';
import AdminSidebar from '../../components/layout/AdminSidebar';
import AccountProvisioningService from '../../services/AccountProvisioningService';
import ConfirmAssignmentModal from '../../components/shared/ConfirmAssignmentModal';
import SuccessModal from '../../components/shared/SuccessModal';
import { ROLE_METADATA } from '../../config/roles';
import { collection, query, onSnapshot, orderBy } from 'firebase/firestore';
import { db } from '../../config/firebase';
import { accountProvisionSchema } from '../../config/validationSchemas';

// --- CONSTANTS ---
const MIS_PROVISIONABLE_ROLES = ['MAYOR', 'DEPW', 'CPDO'];
const DEPARTMENT_HEAD_ROLES = ['MIS', 'MAYOR', 'DEPW', 'CPDO'];

const ROLE_ICONS = {
    MAYOR: FileText,
    DEPW: HardHat,
    CPDO: Map,
};

const ROLE_SHORT_NAMES = {
    MAYOR: "City Mayor",
    DEPW: "DEPW Head",
    CPDO: "CPDO Head",
};

const ROLE_DESCRIPTIONS = {
    MAYOR: "Final approver for infrastructure projects and fund disbursements.",
    DEPW: "Manages engineering projects, field engineers, and public works.",
    CPDO: "Oversees city planning, zoning, and development permits.",
};

// --- LOGIC LAYER ---
const useRosterLogic = () => {
    const REQUIRED_ROLES = useMemo(() => ROLE_METADATA, []);
    const [accounts, setAccounts] = useState([]);

    useEffect(() => {
        const q = query(collection(db, "users"), orderBy("createdAt", "desc"));
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

    // Build the roster: each provisionable role → filled or vacant
    const roster = useMemo(() => {
        return MIS_PROVISIONABLE_ROLES.map(roleType => {
            const roleMeta = REQUIRED_ROLES.find(r => r.type === roleType);
            const account = accounts.find(a => a.roleType === roleType);
            return {
                roleType,
                shortName: ROLE_SHORT_NAMES[roleType] || roleType,
                label: roleMeta?.label || roleType,
                dept: roleMeta?.dept || '',
                titlePrefix: roleMeta?.titlePrefix || '',
                description: ROLE_DESCRIPTIONS[roleType] || '',
                icon: ROLE_ICONS[roleType] || FileText,
                isFilled: !!account,
                account: account || null,
            };
        });
    }, [accounts, REQUIRED_ROLES]);

    const filledCount = roster.filter(r => r.isFilled).length;
    const vacantCount = roster.filter(r => !r.isFilled).length;

    // Form State
    const [provisionForm, setProvisionForm] = useState({ firstName: '', lastName: '', email: '', roleType: '' });
    const [validationErrors, setValidationErrors] = useState({});

    // Modal State
    const [deleteCandidateId, setDeleteCandidateId] = useState(null);
    const [isRevoking, setIsRevoking] = useState(false);
    const [isProvisionModalOpen, setIsProvisionModalOpen] = useState(false);

    // Provisioning Flow
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
            setProvisionError(error.message || "Failed to delete account.");
        }
    };
    const cancelRevoke = () => { if (!isRevoking) setDeleteCandidateId(null); };

    // Open provision modal pre-filled with the role
    const openProvisionForRole = (roleType) => {
        setProvisionForm({ firstName: '', lastName: '', email: '', roleType });
        setValidationErrors({});
        setIsProvisionModalOpen(true);
    };
    const closeProvisionModal = () => setIsProvisionModalOpen(false);

    const toProperCase = (str) => str.replace(/\w\S*/g, (txt) => txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase());

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
        const roleMeta = REQUIRED_ROLES.find(r => r.type === provisionForm.roleType);
        if (!roleMeta) return;
        const properFirst = toProperCase(provisionForm.firstName);
        const properLast = toProperCase(provisionForm.lastName);
        const fullName = `${roleMeta.titlePrefix ? roleMeta.titlePrefix + ' ' : ''}${properFirst} ${properLast}`;
        setConfirmingAccount({
            name: fullName, rawFirstName: properFirst, rawLastName: properLast,
            department: roleMeta.dept, roleType: roleMeta.type,
            initial: properFirst.charAt(0).toUpperCase(),
            email: provisionForm.email, roleLabel: roleMeta.label
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
            setProvisionError(error.message || "Failed to provision account.");
        }
    };

    const handleCloseSuccess = () => setCredentialsSent(false);
    const cancelProvision = () => { setConfirmingAccount(null); setProvisionError(null); };
    const handleFormChange = (e) => setProvisionForm({ ...provisionForm, [e.target.name]: e.target.value });

    return {
        roster, filledCount, vacantCount,
        provisionForm, handleFormChange, validationErrors,
        handleDelete, openProvisionForRole, closeProvisionModal, isProvisionModalOpen, handleStageProvision,
        deleteCandidateId, confirmRevoke, cancelRevoke, isRevoking,
        confirmingAccount, isSending, credentialsSent, handleGenerateCredentials, handleCloseSuccess, cancelProvision,
        provisionError, successEmail
    };
};

// --- UI COMPONENTS ---

/** Filled role card — shows the provisioned official */
const FilledRoleCard = memo(({ slot, onRevoke }) => {
    const Icon = slot.icon;
    return (
        <div className="relative overflow-hidden rounded-2xl border border-slate-200/80 bg-white transition-all duration-300 hover:shadow-lg hover:shadow-teal-100/50 hover:border-teal-300/60 group">
            <div className="h-1 w-full bg-teal-600" />
            <div className="p-5">
                {/* Header */}
                <div className="flex items-start gap-3 mb-4">
                    <div className="w-10 h-10 rounded-xl bg-teal-50 text-teal-700 flex items-center justify-center shrink-0 transition-colors group-hover:bg-teal-700 group-hover:text-white">
                        <Icon size={18} />
                    </div>
                    <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                            <h3 className="text-[15px] font-bold text-slate-800">{slot.shortName}</h3>
                            <div className="shrink-0 px-2 py-0.5 rounded-md text-[9px] font-bold flex items-center gap-1 uppercase tracking-wider bg-teal-50 text-teal-700 border border-teal-200/60">
                                <CheckCircle2 size={9} /> Active
                            </div>
                        </div>
                        <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest mt-0.5">{slot.dept}</p>
                    </div>
                </div>

                {/* Official info */}
                <div className="bg-slate-50/80 rounded-xl p-4 space-y-3">
                    <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-lg bg-teal-700 text-white flex items-center justify-center font-bold text-sm shrink-0">
                            {slot.account.initial}
                        </div>
                        <div className="min-w-0">
                            <p className="font-bold text-slate-800 text-sm truncate">{slot.account.name}</p>
                            <div className="flex items-center gap-1.5 text-slate-400 text-xs mt-0.5">
                                <Mail size={11} />
                                <span className="truncate">{slot.account.email}</span>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Revoke action */}
                <div className="mt-4 flex justify-end">
                    <button
                        onClick={() => onRevoke(slot.account.id)}
                        className="text-xs font-semibold text-slate-300 hover:text-red-500 px-3 py-1.5 rounded-lg hover:bg-red-50 transition-all flex items-center gap-1.5 opacity-0 group-hover:opacity-100"
                        aria-label={`Revoke access for ${slot.account.name}`}
                    >
                        <Trash2 size={12} /> Revoke Access
                    </button>
                </div>
            </div>
        </div>
    );
});

/** Vacant role card — shows an empty slot with provision CTA */
const VacantRoleCard = memo(({ slot, onProvision }) => {
    const Icon = slot.icon;
    return (
        <div className="relative overflow-hidden rounded-2xl border-2 border-dashed border-amber-200/80 bg-amber-50/30 transition-all duration-300 hover:border-amber-300 hover:bg-amber-50/50 group">
            <div className="p-5">
                {/* Header */}
                <div className="flex items-start gap-3 mb-3">
                    <div className="w-10 h-10 rounded-xl bg-amber-100 text-amber-600 flex items-center justify-center shrink-0">
                        <Icon size={18} />
                    </div>
                    <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                            <h3 className="text-[15px] font-bold text-slate-800">{slot.shortName}</h3>
                            <div className="shrink-0 px-2 py-0.5 rounded-md text-[9px] font-bold flex items-center gap-1 uppercase tracking-wider bg-amber-100 text-amber-700 border border-amber-200">
                                <AlertTriangle size={9} /> Vacant
                            </div>
                        </div>
                        <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest mt-0.5">{slot.dept}</p>
                    </div>
                </div>

                {/* Description */}
                <p className="text-xs text-slate-400 leading-relaxed mb-4">{slot.description}</p>

                {/* Provision CTA */}
                <button
                    onClick={() => onProvision(slot.roleType)}
                    className="w-full py-3 bg-teal-700 hover:bg-teal-800 text-white text-sm font-bold rounded-xl shadow-lg shadow-teal-700/20 transition-all flex items-center justify-center gap-2"
                >
                    <UserPlus size={16} />
                    Provision Account
                </button>
            </div>
        </div>
    );
});

/** Provision Form Overlay */
const ProvisionModal = memo(({ isOpen, onClose, form, onChange, onSubmit, roleMeta, errors = {} }) => {
    if (!isOpen || !roleMeta) return null;
    const Icon = ROLE_ICONS[form.roleType] || FileText;
    return (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-900/60 backdrop-blur-sm p-0 sm:p-4">
            <div className="bg-white w-full sm:max-w-lg sm:rounded-2xl rounded-t-3xl shadow-2xl max-h-[95vh] sm:max-h-[85vh] overflow-y-auto">
                {/* Header */}
                <div className="sticky top-0 bg-white z-10 px-6 pt-6 pb-4 border-b border-slate-100">
                    <div className="w-12 h-1.5 bg-slate-200 rounded-full mx-auto mb-4 sm:hidden" />
                    <div className="flex justify-between items-start">
                        <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-xl bg-teal-50 text-teal-700 flex items-center justify-center shrink-0">
                                <Icon size={18} />
                            </div>
                            <div>
                                <h3 className="text-lg font-extrabold text-slate-800 tracking-tight">Provision {roleMeta.label}</h3>
                                <p className="text-xs text-slate-400 font-medium mt-0.5">{roleMeta.dept}</p>
                            </div>
                        </div>
                        <button onClick={onClose} aria-label="Close modal"
                            className="p-2.5 hover:bg-slate-100 rounded-xl transition-colors shrink-0">
                            <X size={20} className="text-slate-400" />
                        </button>
                    </div>
                </div>

                {/* Form */}
                <div className="px-6 py-6 space-y-5">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div>
                            <label htmlFor="provision-fname" className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2 block">
                                First Name
                            </label>
                            <input id="provision-fname" type="text" name="firstName" placeholder="e.g. Sarah" required
                                value={form.firstName} onChange={onChange}
                                className={`w-full p-4 bg-[#F8FAFC] border rounded-xl text-[15px] font-medium focus:ring-2 focus:ring-teal-500/20 focus:border-teal-600 outline-none transition-all placeholder:text-slate-300 ${errors.firstName ? 'border-red-300 bg-red-50' : 'border-slate-200'}`} />
                            {errors.firstName && <p className="text-xs text-red-500 font-semibold mt-1.5">{errors.firstName}</p>}
                        </div>
                        <div>
                            <label htmlFor="provision-lname" className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2 block">
                                Last Name
                            </label>
                            <input id="provision-lname" type="text" name="lastName" placeholder="e.g. dela Cruz" required
                                value={form.lastName} onChange={onChange}
                                className={`w-full p-4 bg-[#F8FAFC] border rounded-xl text-[15px] font-medium focus:ring-2 focus:ring-teal-500/20 focus:border-teal-600 outline-none transition-all placeholder:text-slate-300 ${errors.lastName ? 'border-red-300 bg-red-50' : 'border-slate-200'}`} />
                            {errors.lastName && <p className="text-xs text-red-500 font-semibold mt-1.5">{errors.lastName}</p>}
                        </div>
                    </div>

                    <div>
                        <label htmlFor="provision-email" className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2 block">
                            Official Email Address
                        </label>
                        <div className="relative">
                            <Mail size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-300 pointer-events-none" />
                            <input id="provision-email" type="email" name="email" placeholder="official@lgu.gov.ph" required
                                value={form.email} onChange={onChange}
                                className={`w-full p-4 pl-11 bg-[#F8FAFC] border rounded-xl text-[15px] font-medium focus:ring-2 focus:ring-teal-500/20 focus:border-teal-600 outline-none transition-all placeholder:text-slate-300 ${errors.email ? 'border-red-300 bg-red-50' : 'border-slate-200'}`} />
                        </div>
                        {errors.email && <p className="text-xs text-red-500 font-semibold mt-1.5">{errors.email}</p>}
                    </div>
                </div>

                {/* Actions */}
                <div className="sticky bottom-0 bg-white border-t border-slate-100 px-6 py-5 flex flex-col sm:flex-row gap-3 sm:justify-end">
                    <button onClick={onClose} type="button"
                        className="w-full sm:w-auto px-6 py-3.5 text-sm font-bold text-slate-500 hover:text-slate-800 hover:bg-slate-50 rounded-xl transition-all order-2 sm:order-1">
                        Cancel
                    </button>
                    <button onClick={onSubmit}
                        disabled={!form.firstName || !form.lastName || !form.email}
                        className="w-full sm:w-auto px-8 py-3.5 bg-teal-700 hover:bg-teal-800 text-white text-sm font-bold rounded-xl shadow-lg shadow-teal-700/20 transition-all flex items-center justify-center gap-2 disabled:bg-slate-300 disabled:shadow-none disabled:cursor-not-allowed order-1 sm:order-2">
                        <Shield size={16} />
                        Review & Provision
                    </button>
                </div>
            </div>
        </div>
    );
});

/** Revoke confirmation */
const RevokeModal = memo(({ isOpen, onConfirm, onCancel, isProcessing }) => {
    if (!isOpen) return null;
    return (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-900/60 backdrop-blur-sm p-0 sm:p-4">
            <div className="bg-white w-full sm:max-w-sm sm:rounded-2xl rounded-t-3xl shadow-2xl p-8 flex flex-col items-center">
                <div className="w-14 h-14 rounded-2xl bg-red-50 flex items-center justify-center mb-5">
                    <Trash2 size={24} className="text-red-500" />
                </div>
                <h3 className="text-lg font-extrabold text-slate-800 mb-2">Revoke Access?</h3>
                <p className="text-sm text-slate-400 text-center mb-8 max-w-[260px] leading-relaxed">
                    This will permanently remove the official's system access and credentials.
                </p>
                <div className="flex flex-col sm:flex-row gap-3 w-full">
                    <button onClick={onCancel} disabled={isProcessing}
                        className="flex-1 py-3 text-sm font-bold text-slate-500 hover:text-slate-800 hover:bg-slate-50 rounded-xl transition-all order-2 sm:order-1">
                        Cancel
                    </button>
                    <button onClick={onConfirm} disabled={isProcessing}
                        className="flex-1 py-3 bg-red-500 hover:bg-red-600 text-white font-bold text-sm rounded-xl shadow-lg shadow-red-500/20 transition-all order-1 sm:order-2 disabled:opacity-60">
                        {isProcessing ? 'Processing...' : 'Yes, Revoke Access'}
                    </button>
                </div>
            </div>
        </div>
    );
});

// --- MAIN PAGE ---
const AccountManagement = () => {
    const {
        roster, filledCount, vacantCount,
        provisionForm, handleFormChange, validationErrors,
        handleDelete, openProvisionForRole, closeProvisionModal, isProvisionModalOpen, handleStageProvision,
        deleteCandidateId, confirmRevoke, cancelRevoke, isRevoking,
        confirmingAccount, isSending, credentialsSent, handleGenerateCredentials, handleCloseSuccess, cancelProvision,
        provisionError, successEmail
    } = useRosterLogic();

    // Find the role metadata for the currently selected role in the form
    const activeRoleMeta = useMemo(() => {
        return ROLE_METADATA.find(r => r.type === provisionForm.roleType) || null;
    }, [provisionForm.roleType]);

    return (
        <div className="min-h-screen bg-[#F8FAFC] font-sans text-slate-800">
            <AdminSidebar />

            <main className="ml-0 md:ml-72 p-4 md:p-6 lg:p-10 max-w-[1600px] mx-auto pt-16 md:pt-6 lg:pt-10">
                {/* PAGE HEADER */}
                <div className="mb-6 lg:mb-8">
                    <h1 className="text-2xl lg:text-3xl font-extrabold text-slate-800 tracking-tight flex items-center gap-3">
                        <Shield className="text-teal-700 shrink-0" size={28} />
                        Organizational Roster
                    </h1>
                    <p className="text-slate-400 text-sm font-medium mt-1 ml-0 sm:ml-10">
                        Manage official system access for designated city officials.
                    </p>
                </div>

                {/* STATUS SUMMARY */}
                <div className="flex items-center gap-3 mb-6 flex-wrap">
                    <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-teal-50 border border-teal-200/60 text-teal-700 text-xs font-bold">
                        <CheckCircle2 size={13} /> {filledCount} Active
                    </div>
                    {vacantCount > 0 && (
                        <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-50 border border-amber-200/80 text-amber-700 text-xs font-bold">
                            <AlertTriangle size={13} /> {vacantCount} Vacant
                        </div>
                    )}
                </div>

                {/* ROLE ROSTER GRID */}
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                    {roster.map((slot) =>
                        slot.isFilled ? (
                            <FilledRoleCard key={slot.roleType} slot={slot} onRevoke={handleDelete} />
                        ) : (
                            <VacantRoleCard key={slot.roleType} slot={slot} onProvision={openProvisionForRole} />
                        )
                    )}
                </div>
            </main>

            {/* MODALS */}
            <ProvisionModal isOpen={isProvisionModalOpen} onClose={closeProvisionModal} form={provisionForm}
                onChange={handleFormChange} onSubmit={handleStageProvision} roleMeta={activeRoleMeta} errors={validationErrors} />
            <RevokeModal isOpen={!!deleteCandidateId} onConfirm={confirmRevoke} onCancel={cancelRevoke} isProcessing={isRevoking} />
            <ConfirmAssignmentModal isOpen={!!confirmingAccount} data={confirmingAccount} onConfirm={handleGenerateCredentials}
                onCancel={cancelProvision} isProcessing={isSending} error={provisionError} />
            <SuccessModal isOpen={credentialsSent} onClose={handleCloseSuccess} email={successEmail} />
        </div>
    );
};

export default AccountManagement;