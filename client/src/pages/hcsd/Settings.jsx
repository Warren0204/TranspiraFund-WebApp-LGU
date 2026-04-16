import { useState, useRef } from 'react';
import { Sun, Moon, Settings2, KeyRound, Eye, EyeOff, CheckCircle2, AlertCircle, ChevronRight, Mail, Building2, Camera, Shield, Lock } from 'lucide-react';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { getAuth, reauthenticateWithCredential, EmailAuthProvider } from 'firebase/auth';
import { getStorage, ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage';
import HcsdSidebar from '../../components/layout/HcsdSidebar';
import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../context/ThemeContext';
import app from '../../config/firebase';

const HCSD_PRIVILEGES = [
    'Project Registry',
    'Staff Management',
    'Audit Trails',
    'Mandate Creation',
];

const PW_RULES = [
    { id: 'length',  label: 'At least 12 characters',        test: (p) => p.length >= 12 },
    { id: 'upper',   label: 'At least one uppercase letter',  test: (p) => /[A-Z]/.test(p) },
    { id: 'lower',   label: 'At least one lowercase letter',  test: (p) => /[a-z]/.test(p) },
    { id: 'number',  label: 'At least one number',            test: (p) => /[0-9]/.test(p) },
    { id: 'special', label: 'At least one special character', test: (p) => /[^A-Za-z0-9]/.test(p) },
];

const getStrength = (passed) => {
    if (passed === 0) return null;
    if (passed <= 2)  return { label: 'Weak',      color: 'bg-red-500',    width: 'w-1/4',  text: 'text-red-600 dark:text-red-400' };
    if (passed === 3) return { label: 'Fair',      color: 'bg-amber-500',  width: 'w-2/4',  text: 'text-amber-600 dark:text-amber-400' };
    if (passed === 4) return { label: 'Strong',    color: 'bg-teal-500',   width: 'w-3/4',  text: 'text-teal-600 dark:text-teal-400' };
    return             { label: 'Very Strong', color: 'bg-emerald-500', width: 'w-full', text: 'text-emerald-600 dark:text-emerald-400' };
};

const SpinnerSVG = ({ size = 14 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="animate-spin">
        <line x1="12" y1="2" x2="12" y2="6"/><line x1="12" y1="18" x2="12" y2="22"/>
        <line x1="4.93" y1="4.93" x2="7.76" y2="7.76"/><line x1="16.24" y1="16.24" x2="19.07" y2="19.07"/>
        <line x1="2" y1="12" x2="6" y2="12"/><line x1="18" y1="12" x2="22" y2="12"/>
    </svg>
);

/* ── Reusable card shell ──────────────────────────────── */
const Card = ({ children, className = '' }) => (
    <div className={`bg-white/80 dark:bg-slate-900/60 backdrop-blur-xl border border-slate-200/60 dark:border-white/5 rounded-2xl shadow-lg ${className}`}>
        {children}
    </div>
);

const SectionLabel = ({ icon: Icon, children }) => (
    <div className="flex items-center gap-2.5 px-6 py-4 border-b border-slate-100 dark:border-slate-700/50">
        <Icon size={15} className="text-teal-500 dark:text-teal-400" strokeWidth={2.5} />
        <span className="text-xs font-extrabold uppercase tracking-[0.15em] text-slate-500 dark:text-slate-400">{children}</span>
    </div>
);

const PwInput = ({ label, value, onChange, show, onToggle, placeholder, autoComplete, disabled }) => (
    <div className="space-y-2">
        <label className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">{label}</label>
        <div className="relative">
            <input type={show ? 'text' : 'password'} value={value} onChange={onChange}
                placeholder={placeholder} autoComplete={autoComplete} disabled={disabled}
                className="w-full pr-11 pl-4 py-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/40 text-sm font-medium text-slate-800 dark:text-slate-200 placeholder:text-slate-400 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/15 outline-none transition-all disabled:opacity-60" />
            <button type="button" onClick={onToggle} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 p-1">
                {show ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
        </div>
    </div>
);

const Settings = () => {
    const { currentUser, refreshUserData } = useAuth();
    const { isDark, toggle } = useTheme();

    const userName    = currentUser ? `Engr. ${currentUser.firstName} ${currentUser.lastName}` : 'Loading...';
    const userRole    = currentUser?.role || 'HCSD';
    const userDept    = currentUser?.department || 'Construction Services Division, DEPW';
    const ROLE_FULL_LABELS = {
        HCSD:     'Head of Construction Services Division',
        MIS:      'Management Information Systems',
        MAYOR:    'Mayor',
        CPDO:     'City Planning and Development Office',
        PROJ_ENG: 'Project Engineer',
    };
    const userRoleFull = ROLE_FULL_LABELS[userRole] || userRole;
    const userEmail   = currentUser?.email || '—';
    const userInitial = currentUser?.firstName?.charAt(0).toUpperCase() || 'D';

    /* ── PHOTO UPLOAD ─────────────────────────────────────────────── */
    const photoInputRef = useRef(null);
    const [photoLoading, setPhotoLoading] = useState(false);
    const [photoError, setPhotoError]     = useState('');
    const [photoSuccess, setPhotoSuccess] = useState(false);
    const [previewBlob, setPreviewBlob]   = useState(null);
    const [previewURL, setPreviewURL]     = useState('');

    const handlePhotoSelect = async (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        e.target.value = '';
        if (!file.type.startsWith('image/')) { setPhotoError('Please select an image file.'); return; }
        if (file.size > 5 * 1024 * 1024)    { setPhotoError('Image must be smaller than 5 MB.'); return; }
        setPhotoError(''); setPhotoSuccess(false);
        try {
            const { dataURL, blob } = await new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = (ev) => {
                    const img = new Image();
                    img.onload = () => {
                        const SIZE = 200, canvas = document.createElement('canvas');
                        canvas.width = SIZE; canvas.height = SIZE;
                        const ctx = canvas.getContext('2d'), min = Math.min(img.width, img.height);
                        ctx.drawImage(img, (img.width - min) / 2, (img.height - min) / 2, min, min, 0, 0, SIZE, SIZE);
                        const dataURL = canvas.toDataURL('image/jpeg', 0.82);
                        canvas.toBlob((b) => b ? resolve({ dataURL, blob: b }) : reject(new Error('Failed to process image.')), 'image/jpeg', 0.82);
                    };
                    img.onerror = reject; img.src = ev.target.result;
                };
                reader.onerror = reject; reader.readAsDataURL(file);
            });
            setPreviewBlob(blob); setPreviewURL(dataURL);
        } catch (err) { setPhotoError(err.message || 'Unable to process image.'); }
    };

    const handleConfirmUpload = async () => {
        if (!previewBlob || photoLoading) return;
        const blobToUpload = previewBlob;
        setPreviewBlob(null); setPreviewURL(''); setPhotoLoading(true); setPhotoError('');
        try {
            const storage = getStorage(app);
            const photoRef = storageRef(storage, `profile-photos/${currentUser.uid}`);
            await uploadBytes(photoRef, blobToUpload, { contentType: 'image/jpeg' });
            const downloadURL = await getDownloadURL(photoRef);
            await httpsCallable(getFunctions(app, 'asia-southeast1'), 'updateProfilePhoto')({ photoURL: downloadURL });
            await refreshUserData();
            setPhotoSuccess(true); setTimeout(() => setPhotoSuccess(false), 2500);
        } catch (err) { setPhotoError(err.message || 'Unable to update photo.'); }
        finally { setPhotoLoading(false); }
    };

    const handleCancelPreview = () => { setPreviewBlob(null); setPreviewURL(''); setPhotoError(''); };

    /* ── CHANGE PASSWORD ──────────────────────────────────────────── */
    const [showPwForm, setShowPwForm]       = useState(false);
    const [currentPwStep, setCurrentPwStep] = useState(false);
    const [stepLoading, setStepLoading]     = useState(false);
    const [pwForm, setPwForm]               = useState({ currentPassword: '', newPassword: '', confirmPassword: '' });
    const [showCurrent, setShowCurrent]     = useState(false);
    const [showNew, setShowNew]             = useState(false);
    const [showConfirm, setShowConfirm]     = useState(false);
    const [pwLoading, setPwLoading]         = useState(false);
    const [pwError, setPwError]             = useState('');
    const [pwSuccess, setPwSuccess]         = useState(false);

    const verifyCurrentPassword = async () => {
        if (!pwForm.currentPassword || stepLoading) return;
        setStepLoading(true); setPwError('');
        try {
            const auth = getAuth(app);
            await reauthenticateWithCredential(auth.currentUser, EmailAuthProvider.credential(auth.currentUser.email, pwForm.currentPassword));
            setCurrentPwStep(true);
        } catch (err) {
            setPwError(err.code === 'auth/invalid-credential' || err.code === 'auth/wrong-password' ? 'Current password is incorrect.' : err.message || 'Unable to verify.');
        } finally { setStepLoading(false); }
    };

    const handleChangePassword = async (e) => {
        e.preventDefault();
        if (pwLoading) return;
        setPwError(''); setPwSuccess(false);
        const { currentPassword, newPassword, confirmPassword } = pwForm;
        if (!currentPassword) { setPwError('Enter your current password.'); return; }
        if (PW_RULES.some(r => !r.test(newPassword))) { setPwError('Password must meet all requirements.'); return; }
        if (newPassword !== confirmPassword) { setPwError('Passwords do not match.'); return; }
        setPwLoading(true);
        try {
            await httpsCallable(getFunctions(app, 'asia-southeast1'), 'changePassword')({ newPassword });
            await refreshUserData();
            setPwSuccess(true);
            setPwForm({ currentPassword: '', newPassword: '', confirmPassword: '' });
            setCurrentPwStep(false); setShowCurrent(false); setShowNew(false); setShowConfirm(false);
            setTimeout(() => { setShowPwForm(false); setPwSuccess(false); }, 1800);
        } catch (err) {
            setPwError(err.code === 'auth/invalid-credential' || err.code === 'auth/wrong-password' ? 'Current password is incorrect.' : err.message || 'Unable to update.');
        } finally { setPwLoading(false); }
    };

    const cancelPasswordChange = () => {
        setShowPwForm(false); setCurrentPwStep(false); setStepLoading(false);
        setPwForm({ currentPassword: '', newPassword: '', confirmPassword: '' });
        setPwError(''); setPwSuccess(false); setShowCurrent(false); setShowNew(false); setShowConfirm(false);
    };

    return (
        <div className="min-h-screen hcsd-bg font-sans text-slate-900 dark:text-slate-100">
            <HcsdSidebar />

            <main className="ml-0 md:ml-72 p-4 md:p-6 lg:p-8 pt-20 md:pt-8">

                {/* ── PAGE HEADER ───────────────────────────────── */}
                <div className="mb-8" style={{ animation: 'fadeIn 0.4s ease-out both' }}>
                    <div className="inline-flex items-center gap-2 bg-teal-500/10 dark:bg-teal-500/20 border border-teal-500/20 dark:border-teal-400/30 rounded-full px-3 py-1 mb-3">
                        <Settings2 size={12} className="text-teal-600 dark:text-teal-400" strokeWidth={2.5} />
                        <span className="text-[10px] font-extrabold uppercase tracking-[0.18em] text-teal-700 dark:text-teal-300">Preferences</span>
                    </div>
                    <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-slate-900 dark:text-white">Settings</h1>
                    <p className="text-sm text-slate-500 dark:text-slate-400 mt-1 font-medium">Manage your profile, appearance, and security.</p>
                </div>

                <div className="space-y-5" style={{ animation: 'slideUp 0.4s ease-out 0.05s both' }}>

                    {/* ═══════════════════════════════════════════════
                        1. PROFILE
                    ═══════════════════════════════════════════════ */}
                    <Card>
                        <SectionLabel icon={Settings2}>Profile</SectionLabel>
                        <div className="p-6">
                            {/* Top row: avatar + name/role + info fields */}
                            <div className="flex flex-col lg:flex-row gap-6">

                                {/* Left: Avatar + Identity */}
                                <div className="flex flex-col sm:flex-row items-center sm:items-start gap-5 lg:w-1/3 shrink-0">
                                    {/* Avatar */}
                                    <div className="relative shrink-0">
                                        <button type="button" disabled={photoLoading || !!previewURL}
                                            onClick={() => photoInputRef.current?.click()}
                                            title={previewURL ? 'Confirm or cancel' : 'Change photo'}
                                            className="relative w-20 h-20 rounded-2xl bg-gradient-to-br from-teal-600 to-emerald-500 flex items-center justify-center text-white text-3xl font-extrabold shadow-lg shadow-teal-500/25 overflow-hidden group cursor-pointer disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-teal-500 focus:ring-offset-2">
                                            {previewURL ? <img src={previewURL} alt="Preview" className="w-full h-full object-cover" />
                                            : currentUser?.photoURL ? <img src={currentUser.photoURL} alt="Profile" className="w-full h-full object-cover" />
                                            : userInitial}
                                            {!previewURL && (
                                                <div className="absolute inset-0 bg-black/50 flex flex-col items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                                                    {photoLoading ? <SpinnerSVG size={20} /> : <Camera size={20} className="text-white" />}
                                                </div>
                                            )}
                                        </button>
                                        <input ref={photoInputRef} type="file" accept="image/*" className="hidden" onChange={handlePhotoSelect} />
                                    </div>
                                    <div className="text-center sm:text-left min-w-0">
                                        <h2 className="text-xl font-extrabold text-slate-900 dark:text-white tracking-tight">{userName}</h2>
                                        <span className="inline-block mt-1.5 px-2.5 py-0.5 rounded-md bg-teal-100 dark:bg-teal-900/40 text-teal-700 dark:text-teal-300 text-[10px] font-extrabold uppercase tracking-widest border border-teal-200 dark:border-teal-500/30">
                                            {userRoleFull}
                                        </span>
                                    </div>
                                </div>

                                {/* Right: Info fields filling remaining space */}
                                <div className="flex-1 min-w-0 grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
                                    <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800/40 border border-slate-100 dark:border-slate-700/50">
                                        <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 dark:text-slate-500 mb-1.5">Email Address</p>
                                        <div className="flex items-center gap-2">
                                            <Mail size={15} className="text-teal-500 shrink-0" />
                                            <p className="text-sm font-semibold text-slate-700 dark:text-slate-200 truncate">{userEmail}</p>
                                        </div>
                                    </div>
                                    <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800/40 border border-slate-100 dark:border-slate-700/50">
                                        <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 dark:text-slate-500 mb-1.5">Department</p>
                                        <div className="flex items-center gap-2">
                                            <Building2 size={15} className="text-teal-500 shrink-0" />
                                            <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">{userDept}</p>
                                        </div>
                                    </div>
                                    <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800/40 border border-slate-100 dark:border-slate-700/50">
                                        <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 dark:text-slate-500 mb-1.5">Account Status</p>
                                        <div className="flex items-center gap-2">
                                            <div className="w-2 h-2 rounded-full bg-emerald-500 shrink-0" />
                                            <p className="text-sm font-semibold text-emerald-600 dark:text-emerald-400">Active</p>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {/* Photo preview / feedback */}
                            {previewURL && (
                                <div className="mt-5 flex flex-col sm:flex-row sm:items-center gap-3 p-4 bg-slate-50 dark:bg-slate-800/40 rounded-xl border border-slate-200 dark:border-slate-700">
                                    <p className="text-sm font-semibold text-slate-600 dark:text-slate-300 sm:flex-1">Set this as your profile photo?</p>
                                    <div className="flex gap-2">
                                        <button type="button" onClick={handleCancelPreview} disabled={photoLoading}
                                            className="px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 text-sm font-bold text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition-all disabled:opacity-50">Cancel</button>
                                        <button type="button" onClick={handleConfirmUpload} disabled={photoLoading}
                                            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-teal-600 hover:bg-teal-700 text-white text-sm font-bold transition-all disabled:opacity-50">
                                            {photoLoading ? <><SpinnerSVG size={14} /> Uploading…</> : <><CheckCircle2 size={14} /> Apply</>}
                                        </button>
                                    </div>
                                </div>
                            )}
                            {photoError && (
                                <div className="mt-4 flex items-center gap-2 px-4 py-3 rounded-xl bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-500/20">
                                    <AlertCircle size={15} className="text-red-500 shrink-0" />
                                    <span className="text-sm font-semibold text-red-700 dark:text-red-400">{photoError}</span>
                                </div>
                            )}
                            {photoSuccess && (
                                <div className="mt-4 flex items-center gap-2 px-4 py-3 rounded-xl bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-500/20">
                                    <CheckCircle2 size={15} className="text-emerald-500 shrink-0" />
                                    <span className="text-sm font-semibold text-emerald-700 dark:text-emerald-400">Photo updated successfully.</span>
                                </div>
                            )}

                            {/* Admin notice */}
                            <div className="mt-5 flex items-center gap-2 text-slate-400 dark:text-slate-500">
                                <Lock size={13} className="shrink-0" />
                                <p className="text-xs font-medium">Identity is managed by <span className="font-bold text-slate-500 dark:text-slate-400">system admin</span>. Contact MIS to update your name or role.</p>
                            </div>
                        </div>
                    </Card>

                    {/* ═══════════════════════════════════════════════
                        2. APPEARANCE  +  3. ACCESS LEVEL — side by side
                    ═══════════════════════════════════════════════ */}
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">

                        {/* Appearance */}
                        <Card>
                            <SectionLabel icon={Sun}>Appearance</SectionLabel>
                            <div className="p-6">
                                <p className="text-sm font-medium text-slate-500 dark:text-slate-400 mb-4">Choose how the interface looks to you.</p>
                                <div className="grid grid-cols-2 gap-3">
                                    <button onClick={() => isDark && toggle()}
                                        className={`flex flex-col items-center gap-3 p-5 rounded-xl border-2 transition-all ${
                                            !isDark ? 'border-teal-500 bg-teal-50/80 dark:bg-teal-900/30 shadow-sm' : 'border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600'
                                        }`}>
                                        <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${!isDark ? 'bg-amber-400 shadow-lg shadow-amber-400/30' : 'bg-slate-100 dark:bg-slate-800'}`}>
                                            <Sun size={22} className={!isDark ? 'text-white' : 'text-slate-400'} />
                                        </div>
                                        <span className={`text-sm font-bold ${!isDark ? 'text-teal-700 dark:text-teal-300' : 'text-slate-500 dark:text-slate-400'}`}>Light</span>
                                        {!isDark && <CheckCircle2 size={16} className="text-teal-500" />}
                                    </button>
                                    <button onClick={() => !isDark && toggle()}
                                        className={`flex flex-col items-center gap-3 p-5 rounded-xl border-2 transition-all ${
                                            isDark ? 'border-teal-500 bg-teal-900/30 shadow-sm' : 'border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600'
                                        }`}>
                                        <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${isDark ? 'bg-slate-700 shadow-lg shadow-slate-900/30' : 'bg-slate-100 dark:bg-slate-800'}`}>
                                            <Moon size={22} className={isDark ? 'text-teal-300' : 'text-slate-400'} />
                                        </div>
                                        <span className={`text-sm font-bold ${isDark ? 'text-teal-300' : 'text-slate-500'}`}>Dark</span>
                                        {isDark && <CheckCircle2 size={16} className="text-teal-400" />}
                                    </button>
                                </div>
                            </div>
                        </Card>

                        {/* Access Level */}
                        <Card>
                            <SectionLabel icon={Shield}>Access Level</SectionLabel>
                            <div className="p-6">
                                <p className="text-sm font-medium text-slate-500 dark:text-slate-400 mb-4">Permissions granted to your role.</p>
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                    {HCSD_PRIVILEGES.map((p) => (
                                        <div key={p} className="flex items-center gap-3 px-4 py-3.5 rounded-xl bg-teal-50 dark:bg-teal-900/25 border border-teal-100 dark:border-teal-500/20">
                                            <CheckCircle2 size={16} className="text-teal-500 dark:text-teal-400 shrink-0" />
                                            <span className="text-sm font-semibold text-teal-700 dark:text-teal-300">{p}</span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </Card>
                    </div>

                    {/* ═══════════════════════════════════════════════
                        4. SECURITY — password
                    ═══════════════════════════════════════════════ */}
                    <Card>
                        <SectionLabel icon={KeyRound}>Security</SectionLabel>

                        <button type="button"
                            onClick={() => { setShowPwForm(v => !v); if (showPwForm) cancelPasswordChange(); }}
                            className="w-full flex items-center gap-4 px-6 py-5 hover:bg-slate-50/80 dark:hover:bg-slate-800/30 transition-colors text-left">
                            <div className="flex-1 min-w-0">
                                <p className="text-sm font-bold text-slate-800 dark:text-slate-200">Password</p>
                                <p className="text-xs font-medium text-slate-400 dark:text-slate-500 mt-0.5">Last changed on account creation</p>
                            </div>
                            <span className="flex items-center gap-1.5 text-sm font-semibold text-teal-600 dark:text-teal-400">
                                {showPwForm ? 'Close' : 'Change'}
                                <ChevronRight size={16} className={`transition-transform ${showPwForm ? 'rotate-90' : ''}`} />
                            </span>
                        </button>

                        {showPwForm && (
                            <form onSubmit={handleChangePassword} className="px-6 pb-6 border-t border-slate-100 dark:border-slate-700/50 pt-5">
                                {(() => {
                                    const passed   = PW_RULES.filter(r => r.test(pwForm.newPassword)).length;
                                    const strength = pwForm.newPassword ? getStrength(passed) : null;
                                    return (
                                        <div className="space-y-5 max-w-lg">

                                            <PwInput label="Current Password" value={pwForm.currentPassword} show={showCurrent} disabled={pwLoading}
                                                onToggle={() => setShowCurrent(v => !v)} placeholder="Enter current password" autoComplete="current-password"
                                                onChange={(e) => { setPwForm(f => ({ ...f, currentPassword: e.target.value })); setPwError(''); }} />

                                            {!currentPwStep && pwForm.currentPassword && (
                                                <button type="button" onClick={verifyCurrentPassword} disabled={stepLoading}
                                                    className="w-full py-3 rounded-xl bg-teal-600 hover:bg-teal-700 disabled:opacity-60 text-white text-sm font-bold transition-colors flex items-center justify-center gap-2">
                                                    {stepLoading ? <><SpinnerSVG /> Verifying…</> : 'Continue'}
                                                </button>
                                            )}

                                            {currentPwStep && (<>
                                                <PwInput label="New Password" value={pwForm.newPassword} show={showNew} disabled={pwLoading}
                                                    onToggle={() => setShowNew(v => !v)} placeholder="Create a strong password" autoComplete="new-password"
                                                    onChange={(e) => { setPwForm(f => ({ ...f, newPassword: e.target.value })); setPwError(''); setPwSuccess(false); }} />

                                                {strength && (
                                                    <div className="space-y-1.5">
                                                        <div className="flex items-center justify-between">
                                                            <span className="text-xs font-bold uppercase tracking-wide text-slate-400">Strength</span>
                                                            <span className={`text-xs font-extrabold uppercase tracking-wide ${strength.text}`}>{strength.label}</span>
                                                        </div>
                                                        <div className="h-2 w-full bg-slate-100 dark:bg-slate-700 rounded-full overflow-hidden">
                                                            <div className={`h-full rounded-full transition-all duration-300 ${strength.color} ${strength.width}`} />
                                                        </div>
                                                    </div>
                                                )}

                                                {pwForm.newPassword && (
                                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                                                        {PW_RULES.map(rule => {
                                                            const ok = rule.test(pwForm.newPassword);
                                                            return (
                                                                <div key={rule.id} className="flex items-center gap-2">
                                                                    {ok ? <CheckCircle2 size={14} className="text-emerald-500 shrink-0" /> : <span className="w-3.5 h-3.5 rounded-full border-2 border-slate-300 dark:border-slate-600 shrink-0" />}
                                                                    <span className={`text-xs font-medium ${ok ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-500 dark:text-slate-400'}`}>{rule.label}</span>
                                                                </div>
                                                            );
                                                        })}
                                                    </div>
                                                )}

                                                <PwInput label="Confirm Password" value={pwForm.confirmPassword} show={showConfirm} disabled={pwLoading}
                                                    onToggle={() => setShowConfirm(v => !v)} placeholder="Repeat new password" autoComplete="new-password"
                                                    onChange={(e) => { setPwForm(f => ({ ...f, confirmPassword: e.target.value })); setPwError(''); setPwSuccess(false); }} />
                                            </>)}
                                        </div>
                                    );
                                })()}

                                {pwError && (
                                    <div className="mt-4 flex items-center gap-2 px-4 py-3 rounded-xl bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-500/20 max-w-lg">
                                        <AlertCircle size={15} className="text-red-500 shrink-0" />
                                        <span className="text-sm font-semibold text-red-700 dark:text-red-400">{pwError}</span>
                                    </div>
                                )}
                                {pwSuccess && (
                                    <div className="mt-4 flex items-center gap-2 px-4 py-3 rounded-xl bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-500/20 max-w-lg">
                                        <CheckCircle2 size={15} className="text-emerald-500 shrink-0" />
                                        <span className="text-sm font-semibold text-emerald-700 dark:text-emerald-400">Password updated successfully.</span>
                                    </div>
                                )}

                                {currentPwStep && (
                                    <div className="mt-5 flex items-center gap-3 max-w-lg">
                                        <button type="button" onClick={cancelPasswordChange}
                                            className="px-5 py-2.5 text-sm font-bold text-slate-600 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 transition-colors">
                                            Cancel
                                        </button>
                                        <button type="submit"
                                            disabled={pwLoading || PW_RULES.some(r => !r.test(pwForm.newPassword)) || !pwForm.confirmPassword}
                                            className="flex items-center gap-2 px-6 py-2.5 bg-gradient-to-r from-teal-600 to-emerald-500 hover:from-teal-700 hover:to-emerald-600 text-white text-sm font-bold rounded-xl shadow-md shadow-teal-500/20 transition-all disabled:opacity-50 disabled:cursor-not-allowed">
                                            {pwLoading ? <><SpinnerSVG /> Updating…</> : 'Update Password'}
                                        </button>
                                    </div>
                                )}
                            </form>
                        )}
                    </Card>

                </div>
            </main>
        </div>
    );
};

export default Settings;
