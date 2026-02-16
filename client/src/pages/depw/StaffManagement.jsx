import React, { memo, useState, useMemo, useEffect } from 'react';
import {
    Plus, Users, X, AlertCircle, Search, RefreshCw, HardHat, Mail, Trash2, AlertTriangle
} from 'lucide-react';
import DepwSidebar from '../../components/layout/DepwSidebar';
import AccountProvisioningService from '../../services/AccountProvisioningService';
import ConfirmAssignmentModal from '../../components/shared/ConfirmAssignmentModal';
import SuccessModal from '../../components/shared/SuccessModal';
import { ROLES, ROLE_METADATA } from '../../config/roles';
import { collection, query, onSnapshot, orderBy } from 'firebase/firestore';
import { db } from '../../config/firebase';
import { staffProvisionSchema } from '../../config/validationSchemas';
import { useDebounce } from '../../hooks/useDebounce';

// --- LOGIC LAYER ---
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
            (error) => {
                // Firestore index errors are non-blocking
            }
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

    // Form State
    const [provisionForm, setProvisionForm] = useState({ firstName: '', lastName: '', email: '' });
    const [formErrors, setFormErrors] = useState({});

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

// --- UI COMPONENTS ---

const ProvisionModal = memo(({ isOpen, onClose, form, onChange, onSubmit, errors }) => {
    if (!isOpen) return null;
    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="bg-white p-8 rounded-[24px] shadow-2xl w-full max-w-md transform transition-all animate-in zoom-in-95 duration-200">
                <div className="flex justify-between items-center mb-6">
                    <h3 className="text-xl font-bold text-slate-900">Add Project Engineer</h3>
                    <button onClick={onClose} aria-label="Close modal" className="p-2 hover:bg-slate-100 rounded-full transition-colors"><X size={20} className="text-slate-400" /></button>
                </div>
                <div className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5 block">First Name</label>
                            <input type="text" name="firstName" placeholder="e.g. Juan" required value={form.firstName} onChange={onChange}
                                className={`w-full p-3.5 bg-slate-50 border ${errors.firstName ? 'border-red-300 ring-2 ring-red-100' : 'border-slate-200'} rounded-xl text-sm font-medium focus:ring-2 focus:ring-blue-500 outline-none`} />
                            {errors.firstName && <p className="text-[10px] text-red-500 font-bold mt-1">{errors.firstName}</p>}
                        </div>
                        <div>
                            <label className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5 block">Last Name</label>
                            <input type="text" name="lastName" placeholder="Dela Cruz" required value={form.lastName} onChange={onChange}
                                className={`w-full p-3.5 bg-slate-50 border ${errors.lastName ? 'border-red-300 ring-2 ring-red-100' : 'border-slate-200'} rounded-xl text-sm font-medium focus:ring-2 focus:ring-blue-500 outline-none`} />
                            {errors.lastName && <p className="text-[10px] text-red-500 font-bold mt-1">{errors.lastName}</p>}
                        </div>
                    </div>
                    <div>
                        <label className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5 block">Professional Email</label>
                        <input type="email" name="email" placeholder="official@eng.lgu.gov.ph" required value={form.email} onChange={onChange}
                            className={`w-full p-3.5 bg-slate-50 border ${errors.email ? 'border-red-300 ring-2 ring-red-100' : 'border-slate-200'} rounded-xl text-sm font-medium focus:ring-2 focus:ring-blue-500 outline-none`} />
                        {errors.email && <p className="text-[10px] text-red-500 font-bold mt-1">{errors.email}</p>}
                    </div>
                    <div className="bg-blue-50 p-4 rounded-xl flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center shrink-0">
                            <HardHat size={16} />
                        </div>
                        <p className="text-xs text-blue-800 font-medium">Role will be locked to <span className="font-bold">Project Engineer</span></p>
                    </div>
                    <button onClick={onSubmit} disabled={!form.firstName || !form.lastName || !form.email}
                        className="w-full mt-2 py-4 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl shadow-lg shadow-blue-600/20 transition-all flex items-center justify-center gap-2 disabled:bg-slate-300 disabled:shadow-none disabled:cursor-not-allowed">
                        Provision Credentials
                    </button>
                </div>
            </div>
        </div>
    );
});

const StaffListHeader = () => (
    <div className="grid grid-cols-12 px-6 py-3 bg-slate-50/50 border-b border-slate-100 text-[11px] font-bold text-slate-400 uppercase tracking-wider">
        <div className="col-span-5 pl-2">Engineer Identity</div>
        <div className="col-span-5">Role & Access</div>
        <div className="col-span-2 text-right pr-2">Actions</div>
    </div>
);

const StaffItem = memo(({ data, onDelete }) => (
    <div className="grid grid-cols-12 items-center px-6 py-4 hover:bg-slate-50 transition-colors border-b border-slate-50 last:border-b-0 group">
        <div className="col-span-5 flex items-center gap-4">
            <div className="w-12 h-12 rounded-full bg-blue-50 text-blue-600 flex items-center justify-center font-bold text-lg border border-blue-100 shrink-0">
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
            <div className="flex flex-col items-start gap-1">
                <div className="flex items-center gap-2">
                    <span className="inline-flex px-2.5 py-1 rounded-md text-[10px] font-bold uppercase tracking-wide bg-blue-100 text-blue-700">
                        {data.roleLabel}
                    </span>
                    <span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide border ${data.status === 'Active' ? 'bg-emerald-50 text-emerald-600 border-emerald-200' : 'bg-slate-50 text-slate-500 border-slate-200'}`}>
                        {data.status}
                    </span>
                </div>
                <p className="text-[10px] font-bold text-slate-400 pl-0.5">{data.department}</p>
            </div>
        </div>
        <div className="col-span-2 flex justify-end">
            <button onClick={() => onDelete(data.id)}
                className="text-xs font-bold text-red-500 hover:text-white px-3 py-2 rounded-lg border border-red-200 hover:bg-red-600 transition-all ml-auto flex items-center gap-1 shadow-sm">
                Revoke Access
            </button>
        </div>
    </div>
));

const RevokeModal = memo(({ isOpen, onClose, onConfirm, isProcessing, error }) => {
    if (!isOpen) return null;
    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="bg-white p-8 rounded-[24px] shadow-2xl w-full max-w-md transform transition-all animate-in zoom-in-95 duration-200 border border-red-100">
                <div className="flex flex-col items-center text-center mb-6">
                    <div className="w-16 h-16 rounded-full bg-red-50 text-red-500 flex items-center justify-center mb-4 ring-8 ring-red-50/50">
                        <AlertTriangle size={32} strokeWidth={2.5} />
                    </div>
                    <h3 className="text-xl font-extrabold text-slate-900">Revoke Engineer Access?</h3>
                    <p className="text-slate-500 font-medium text-sm mt-2 max-w-[85%]">
                        This will <span className="text-red-600 font-bold">permanently delete</span> the account and remove all system access. This action cannot be undone.
                    </p>
                </div>
                {error && (
                    <div className="mb-6 bg-red-50 border border-red-100 rounded-xl p-4 flex gap-3 text-left">
                        <AlertCircle className="text-red-500 shrink-0" size={20} />
                        <p className="text-red-600 text-xs font-bold">{error}</p>
                    </div>
                )}
                <div className="grid grid-cols-2 gap-3">
                    <button onClick={onClose} disabled={isProcessing}
                        className="py-3.5 bg-slate-100 hover:bg-slate-200 text-slate-600 font-bold rounded-xl transition-all disabled:opacity-50">
                        Cancel
                    </button>
                    <button onClick={onConfirm} disabled={isProcessing}
                        className="py-3.5 bg-red-600 hover:bg-red-700 text-white font-bold rounded-xl shadow-lg shadow-red-600/20 transition-all flex items-center justify-center gap-2 disabled:bg-slate-300 disabled:shadow-none disabled:cursor-not-allowed">
                        {isProcessing ? (
                            <>
                                <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></span>
                                Revoking...
                            </>
                        ) : (
                            <>
                                <Trash2 size={18} />
                                Yes, Revoke
                            </>
                        )}
                    </button>
                </div>
            </div>
        </div>
    );
});

// --- MAIN PAGE ---
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
        <div className="min-h-screen bg-slate-50 font-sans text-slate-900">
            <DepwSidebar />

            <main className="ml-0 md:ml-72 p-4 md:p-10 max-w-[1400px] mx-auto">
                {/* PAGE HEADER */}
                <div className="flex justify-between items-end mb-8">
                    <div>
                        <h1 className="text-3xl font-extrabold text-slate-900 tracking-tight flex items-center gap-3">
                            <HardHat className="text-blue-600" size={32} />
                            Field Staff Management
                        </h1>
                        <p className="text-slate-500 font-medium mt-1 ml-11">
                            Manage roster, credentials, and access for Project Engineers.
                        </p>
                    </div>
                    <div>
                        <button onClick={openProvisionModal}
                            className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 px-6 rounded-xl shadow-lg shadow-blue-600/20 hover:shadow-blue-600/30 transition-all flex items-center gap-2">
                            <Plus size={20} strokeWidth={3} />
                            Add Engineer
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
                                {filteredStaff.length} Total Staff
                            </div>
                            <button className="text-blue-600 font-bold text-sm flex items-center gap-1 hover:bg-blue-50 px-3 py-2 rounded-lg transition-colors">
                                <RefreshCw size={14} /> Refresh List
                            </button>
                        </div>
                        <div className="relative group w-80">
                            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-blue-600 transition-colors" size={18} />
                            <input type="text" placeholder="Search by name or email..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)}
                                className="w-full pl-11 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-semibold focus:ring-2 focus:ring-blue-500 outline-none transition-all placeholder:text-slate-400" />
                        </div>
                    </div>

                    {/* TABLE */}
                    <div className="flex-1 overflow-auto">
                        <StaffListHeader />
                        <div>
                            {filteredStaff.length === 0 ? (
                                <div className="text-center py-20">
                                    <div className="w-16 h-16 bg-slate-50 rounded-full flex items-center justify-center mx-auto mb-4 text-slate-300">
                                        <Search size={32} />
                                    </div>
                                    <p className="text-slate-400 font-medium">No engineers found matching your search.</p>
                                </div>
                            ) : (
                                filteredStaff.map(s => (
                                    <StaffItem key={s.id} data={s} onDelete={handleDelete} />
                                ))
                            )}
                        </div>
                    </div>
                </div>
            </main>

            {/* MODALS */}
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
