import React, { memo, useState, useMemo, useEffect } from 'react';
import {
    Trash2, Plus, Users, X, Search, RefreshCw, Shield, Mail
} from 'lucide-react';
import AdminSidebar from '../../components/layout/AdminSidebar';
import AccountProvisioningService from '../../services/AccountProvisioningService';
import ConfirmAssignmentModal from '../../components/shared/ConfirmAssignmentModal';
import SuccessModal from '../../components/shared/SuccessModal';
import { ROLE_METADATA } from '../../config/roles';
import { collection, query, onSnapshot, orderBy } from 'firebase/firestore';
import { db } from '../../config/firebase';
import { accountProvisionSchema } from '../../config/validationSchemas';
import { useDebounce } from '../../hooks/useDebounce';

// --- LOGIC LAYER ---
const useAccountLogic = () => {
    const REQUIRED_ROLES = useMemo(() => ROLE_METADATA, []);

    const [accounts, setAccounts] = useState([]);
    const [searchTerm, setSearchTerm] = useState('');

    useEffect(() => {
        const q = query(collection(db, "users"), orderBy("createdAt", "desc"));
        const unsubscribe = onSnapshot(q, (snapshot) => {
            const fetchedAccounts = snapshot.docs.map(doc => {
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
            });
            setAccounts(fetchedAccounts);
        });
        return () => unsubscribe();
    }, [REQUIRED_ROLES]);

    const debouncedSearchTerm = useDebounce(searchTerm, 300);
    const filteredAccounts = useMemo(() => {
        if (!debouncedSearchTerm.trim()) return accounts;
        const lowerTerm = debouncedSearchTerm.toLowerCase();
        return accounts.filter(acc =>
            acc.name.toLowerCase().includes(lowerTerm) ||
            acc.department.toLowerCase().includes(lowerTerm) ||
            acc.email.toLowerCase().includes(lowerTerm)
        );
    }, [accounts, debouncedSearchTerm]);

    // Form State
    const [provisionForm, setProvisionForm] = useState({ firstName: '', lastName: '', email: '', roleType: '' });
    const [validationErrors, setValidationErrors] = useState({});

    // Derived: Missing Roles
    const activeRoleTypes = accounts.map(a => a.roleType);
    const missingRoles = REQUIRED_ROLES.filter(role => !activeRoleTypes.includes(role.type));

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

    const openProvisionModal = () => {
        setProvisionForm({ firstName: '', lastName: '', email: '', roleType: '' });
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
        filteredAccounts, searchTerm, setSearchTerm, missingRoles,
        provisionForm, handleFormChange, validationErrors,
        handleDelete, openProvisionModal, closeProvisionModal, isProvisionModalOpen, handleStageProvision,
        deleteCandidateId, confirmRevoke, cancelRevoke, isRevoking,
        confirmingAccount, isSending, credentialsSent, handleGenerateCredentials, handleCloseSuccess, cancelProvision,
        provisionError, successEmail
    };
};

// --- UI COMPONENTS ---

const ProvisionModal = memo(({ isOpen, onClose, form, onChange, onSubmit, roles, errors = {} }) => {
    if (!isOpen) return null;
    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="bg-white p-8 rounded-[24px] shadow-2xl w-full max-w-md transform transition-all animate-in zoom-in-95 duration-200">
                <div className="flex justify-between items-center mb-6">
                    <h3 className="text-xl font-bold text-slate-900">Provision Official Account</h3>
                    <button onClick={onClose} aria-label="Close modal" className="p-2 hover:bg-slate-100 rounded-full transition-colors"><X size={20} className="text-slate-400" /></button>
                </div>
                <div className="space-y-4">
                    <div>
                        <label className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5 block">Role Assignment</label>
                        <select name="roleType" value={form.roleType} onChange={onChange} aria-label="Select role"
                            className={`w-full p-3.5 bg-slate-50 border rounded-xl text-slate-700 font-semibold focus:ring-2 focus:ring-blue-500 outline-none ${errors.roleType ? 'border-red-300 bg-red-50' : 'border-slate-200'}`}>
                            <option value="" disabled>Select Role...</option>
                            {roles.map(role => (<option key={role.type} value={role.type}>{role.label}</option>))}
                        </select>
                        {errors.roleType && <p className="text-[10px] text-red-500 font-bold mt-1">{errors.roleType}</p>}
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5 block">First Name</label>
                            <input type="text" name="firstName" placeholder="e.g. Sarah" required value={form.firstName} onChange={onChange} aria-label="First name"
                                className={`w-full p-3.5 bg-slate-50 border rounded-xl text-sm font-medium focus:ring-2 focus:ring-blue-500 outline-none ${errors.firstName ? 'border-red-300 bg-red-50' : 'border-slate-200'}`} />
                            {errors.firstName && <p className="text-[10px] text-red-500 font-bold mt-1">{errors.firstName}</p>}
                        </div>
                        <div>
                            <label className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5 block">Last Name</label>
                            <input type="text" name="lastName" placeholder="Connor" required value={form.lastName} onChange={onChange} aria-label="Last name"
                                className={`w-full p-3.5 bg-slate-50 border rounded-xl text-sm font-medium focus:ring-2 focus:ring-blue-500 outline-none ${errors.lastName ? 'border-red-300 bg-red-50' : 'border-slate-200'}`} />
                            {errors.lastName && <p className="text-[10px] text-red-500 font-bold mt-1">{errors.lastName}</p>}
                        </div>
                    </div>
                    <div>
                        <label className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5 block">Official Email</label>
                        <input type="email" name="email" placeholder="official@lgu.gov.ph" required value={form.email} onChange={onChange} aria-label="Email address"
                            className={`w-full p-3.5 bg-slate-50 border rounded-xl text-sm font-medium focus:ring-2 focus:ring-blue-500 outline-none ${errors.email ? 'border-red-300 bg-red-50' : 'border-slate-200'}`} />
                        {errors.email && <p className="text-[10px] text-red-500 font-bold mt-1">{errors.email}</p>}
                    </div>
                    <button onClick={onSubmit} disabled={!form.roleType || !form.firstName || !form.lastName || !form.email}
                        className="w-full mt-4 py-4 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl shadow-lg shadow-blue-600/20 transition-all flex items-center justify-center gap-2 disabled:bg-slate-300 disabled:shadow-none disabled:cursor-not-allowed">
                        Review & Provision
                    </button>
                </div>
            </div>
        </div>
    );
});

const AccountListHeader = () => (
    <div className="grid grid-cols-12 px-6 py-3 bg-slate-50/50 border-b border-slate-100 text-[11px] font-bold text-slate-400 uppercase tracking-wider">
        <div className="col-span-5 pl-2">Official Identity</div>
        <div className="col-span-5">Role & Department</div>
        <div className="col-span-2 text-right pr-2">Actions</div>
    </div>
);

const AccountItem = memo(({ data, onDelete }) => (
    <div className="grid grid-cols-12 items-center px-6 py-4 hover:bg-slate-50 transition-colors border-b border-slate-50 last:border-b-0 group">
        <div className="col-span-5 flex items-center gap-4">
            <div className={`w-12 h-12 rounded-full ${data.roleType === 'MAYOR' ? 'bg-blue-600 ring-4 ring-blue-100' : 'bg-slate-200'} text-white flex items-center justify-center font-bold text-lg shadow-sm shrink-0`}>
                {data.initial}
            </div>
            <div className="min-w-0">
                <h4 className="font-bold text-slate-900 text-sm truncate">{data.name}</h4>
                <div className="flex items-center gap-1.5 text-slate-500 text-xs mt-0.5">
                    <Mail size={12} />
                    <span className="truncate">{data.email}</span>
                </div>
            </div>
        </div>
        <div className="col-span-5">
            <span className={`inline-flex px-2.5 py-1 rounded-md text-[10px] font-bold uppercase tracking-wide mb-1 ${data.roleType === 'MAYOR'
                ? 'bg-amber-100 text-amber-700 border border-amber-200'
                : 'bg-blue-50 text-blue-600 border border-blue-100'
                }`}>
                {data.roleLabel}
            </span>
            <p className="text-sm text-slate-600 font-medium truncate">{data.department}</p>
        </div>
        <div className="col-span-2 flex justify-end">
            <button onClick={() => onDelete(data.id)}
                className="text-xs font-semibold text-slate-400 hover:text-red-600 px-3 py-2 rounded-lg hover:bg-red-50 transition-all ml-auto opacity-0 group-hover:opacity-100 flex items-center gap-1">
                Revoke Access
            </button>
        </div>
    </div>
));

const RevokeModal = memo(({ isOpen, onConfirm, onCancel, isProcessing }) => {
    if (!isOpen) return null;
    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="bg-white p-8 rounded-[24px] shadow-2xl w-full max-w-sm transform transition-all animate-in zoom-in-95 duration-200 flex flex-col items-center">
                <h3 className="text-lg font-bold text-slate-900 mb-8 mt-2">Revoke Access?</h3>
                <div className="flex gap-4 w-full justify-center">
                    <button onClick={onCancel} disabled={isProcessing} className="text-slate-500 hover:text-slate-800 font-semibold text-sm px-4 py-2">Cancel</button>
                    <button onClick={onConfirm} disabled={isProcessing} className="bg-red-500 hover:bg-red-600 text-white font-bold text-sm px-8 py-2.5 rounded-full shadow-lg transition-all">{isProcessing ? 'Processing' : 'Yes, Revoke'}</button>
                </div>
            </div>
        </div>
    );
});

// --- MAIN PAGE ---
const AccountManagement = () => {
    const {
        filteredAccounts, searchTerm, setSearchTerm, missingRoles,
        provisionForm, handleFormChange, validationErrors,
        handleDelete, openProvisionModal, closeProvisionModal, isProvisionModalOpen, handleStageProvision,
        deleteCandidateId, confirmRevoke, cancelRevoke, isRevoking,
        confirmingAccount, isSending, credentialsSent, handleGenerateCredentials, handleCloseSuccess, cancelProvision,
        provisionError, successEmail
    } = useAccountLogic();

    return (
        <div className="min-h-screen bg-slate-50 font-sans text-slate-900">
            <AdminSidebar />

            <main className="ml-0 md:ml-72 p-4 md:p-10 max-w-[1600px] mx-auto">
                {/* PAGE HEADER */}
                <div className="flex justify-between items-end mb-8">
                    <div>
                        <h1 className="text-3xl font-extrabold text-slate-900 tracking-tight flex items-center gap-3">
                            <Shield className="text-blue-600" size={32} />
                            Account Management
                        </h1>
                        <p className="text-slate-500 font-medium mt-1 ml-11">
                            Provision official access for Department Heads and Mayor.
                        </p>
                    </div>
                    <div>
                        <button onClick={openProvisionModal}
                            className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 px-6 rounded-xl shadow-lg shadow-blue-600/20 hover:shadow-blue-600/30 transition-all flex items-center gap-2">
                            <Plus size={20} strokeWidth={3} />
                            Provision Account
                        </button>
                    </div>
                </div>

                {/* MAIN CONTENT CARD */}
                <div className="bg-white rounded-[24px] border border-slate-200 shadow-sm overflow-hidden min-h-[600px] flex flex-col">
                    {/* TOOLBAR */}
                    <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-white">
                        <div className="flex items-center gap-4">
                            <div className="bg-slate-100 px-4 py-2 rounded-lg text-sm font-bold text-slate-600 flex items-center gap-2">
                                <Users size={16} />
                                {filteredAccounts.length} Official Accounts
                            </div>
                            <button className="text-blue-600 font-bold text-sm flex items-center gap-1 hover:bg-blue-50 px-3 py-2 rounded-lg transition-colors">
                                <RefreshCw size={14} /> Refresh Registry
                            </button>
                        </div>
                        <div className="relative group w-80">
                            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-blue-600 transition-colors" size={18} />
                            <input type="text" placeholder="Search name or department..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)}
                                className="w-full pl-11 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-semibold focus:ring-2 focus:ring-blue-500 outline-none transition-all placeholder:text-slate-400" />
                        </div>
                    </div>

                    {/* TABLE */}
                    <div className="flex-1 overflow-auto">
                        <AccountListHeader />
                        <div>
                            {filteredAccounts.length === 0 ? (
                                <div className="text-center py-20">
                                    <div className="w-16 h-16 bg-slate-50 rounded-full flex items-center justify-center mx-auto mb-4 text-slate-300">
                                        <Search size={32} />
                                    </div>
                                    <p className="text-slate-400 font-medium">No accounts found matching your search.</p>
                                </div>
                            ) : (
                                filteredAccounts.map(acc => (
                                    <AccountItem key={acc.id} data={acc} onDelete={handleDelete} />
                                ))
                            )}
                        </div>
                    </div>
                </div>
            </main>

            {/* MODALS */}
            <ProvisionModal isOpen={isProvisionModalOpen} onClose={closeProvisionModal} form={provisionForm}
                onChange={handleFormChange} onSubmit={handleStageProvision} roles={missingRoles} errors={validationErrors} />
            <RevokeModal isOpen={!!deleteCandidateId} onConfirm={confirmRevoke} onCancel={cancelRevoke} isProcessing={isRevoking} />
            <ConfirmAssignmentModal isOpen={!!confirmingAccount} data={confirmingAccount} onConfirm={handleGenerateCredentials}
                onCancel={cancelProvision} isProcessing={isSending} error={provisionError} />
            <SuccessModal isOpen={credentialsSent} onClose={handleCloseSuccess} email={successEmail} />
        </div>
    );
};

export default AccountManagement;