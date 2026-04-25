import { useState, useRef, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Sun, Moon, Settings2, KeyRound, Eye, EyeOff, CheckCircle2, AlertCircle, ChevronRight, Mail, Building2, Camera, Shield, Lock, Clock, HelpCircle, X, LogOut, Sparkles } from 'lucide-react';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { getAuth, reauthenticateWithCredential, EmailAuthProvider, signOut } from 'firebase/auth';
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
    const percent = Math.round((passed / PW_RULES.length) * 100);
    if (passed <= 2)  return { label: 'Weak',        percent, color: 'bg-red-500',      text: 'text-red-600 dark:text-red-400' };
    if (passed === 3) return { label: 'Fair',        percent, color: 'bg-amber-500',    text: 'text-amber-600 dark:text-amber-400' };
    if (passed === 4) return { label: 'Strong',      percent, color: 'bg-teal-500',     text: 'text-teal-600 dark:text-teal-400' };
    return             { label: 'Very Strong',  percent, color: 'bg-emerald-500',  text: 'text-emerald-600 dark:text-emerald-400' };
};

const toDate = (ts) => {
    if (!ts) return null;
    if (typeof ts?.toDate === 'function') return ts.toDate();
    if (typeof ts?.seconds === 'number') return new Date(ts.seconds * 1000);
    if (ts instanceof Date) return ts;
    const d = new Date(ts);
    return isNaN(d.getTime()) ? null : d;
};

const formatRelativeTime = (ts) => {
    const d = toDate(ts);
    if (!d) return null;
    const diffMs = Date.now() - d.getTime();
    const sec = Math.floor(diffMs / 1000);
    if (sec < 60) return 'just now';
    const min = Math.floor(sec / 60);
    if (min < 60) return `${min} minute${min === 1 ? '' : 's'} ago`;
    const hr = Math.floor(min / 60);
    if (hr < 24) return `${hr} hour${hr === 1 ? '' : 's'} ago`;
    const day = Math.floor(hr / 24);
    if (day < 30) return `${day} day${day === 1 ? '' : 's'} ago`;
    const mon = Math.floor(day / 30);
    if (mon < 12) return `${mon} month${mon === 1 ? '' : 's'} ago`;
    const yr = Math.floor(day / 365);
    return `${yr} year${yr === 1 ? '' : 's'} ago`;
};

const formatAbsoluteDate = (ts) => {
    const d = toDate(ts);
    if (!d) return '';
    return d.toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
};

const isWithinHours = (ts, hours) => {
    const d = toDate(ts);
    if (!d) return false;
    return Date.now() - d.getTime() < hours * 60 * 60 * 1000;
};

const FRESHNESS_WINDOW_MS = 4 * 60 * 1000; // 4 minutes — buffer under Firebase's ~5-min reauth window

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

const PwInput = ({ label, value, onChange, show, onToggle, placeholder, autoComplete, disabled, id, inputRef, invalid, describedBy }) => (
    <div className="space-y-2">
        <label htmlFor={id} className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">{label}</label>
        <div className="relative">
            <input
                ref={inputRef}
                id={id}
                aria-invalid={invalid || undefined}
                aria-describedby={describedBy}
                type={show ? 'text' : 'password'}
                value={value}
                onChange={onChange}
                placeholder={placeholder}
                autoComplete={autoComplete}
                disabled={disabled}
                className={`w-full pr-11 pl-4 py-3 rounded-xl border ${
                    invalid
                        ? 'border-red-400 dark:border-red-500 focus:border-red-500 focus:ring-2 focus:ring-red-500/15'
                        : 'border-slate-200 dark:border-slate-700 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/15'
                } bg-slate-50 dark:bg-slate-800/40 text-sm font-medium text-slate-800 dark:text-slate-200 placeholder:text-slate-400 outline-none transition-all disabled:opacity-60`}
            />
            <button type="button" onClick={onToggle} aria-label={show ? 'Hide password' : 'Show password'}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 p-1">
                {show ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
        </div>
    </div>
);

const Settings = () => {
    const { currentUser, refreshUserData } = useAuth();
    const { isDark, toggle } = useTheme();
    const navigate = useNavigate();

    const userName    = currentUser ? `Engr. ${currentUser.firstName} ${currentUser.lastName}` : 'Loading...';
    const userRole    = currentUser?.role || 'HCSD';
    const userDept    = currentUser?.department || 'Construction Services Division, DEPW';
    const ROLE_FULL_LABELS = {
        HCSD:     'Head of Construction Services Division',
        MIS:      'Management Information Systems',
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
    const [verifiedAt, setVerifiedAt]       = useState(0);
    const [stepLoading, setStepLoading]     = useState(false);
    const [pwForm, setPwForm]               = useState({ currentPassword: '', newPassword: '', confirmPassword: '' });
    const [showCurrent, setShowCurrent]     = useState(false);
    const [showNew, setShowNew]             = useState(false);
    const [showConfirm, setShowConfirm]     = useState(false);
    const [pwLoading, setPwLoading]         = useState(false);
    const [pwError, setPwError]             = useState('');
    const [pwSuccess, setPwSuccess]         = useState(false);
    const [fieldErrors, setFieldErrors]     = useState({});
    const [tooManyAttempts, setTooManyAttempts]     = useState(false);
    const [signOutOthersChecked, setSignOutOthersChecked] = useState(false);
    const [showForgotModal, setShowForgotModal]   = useState(false);
    const [staleReAuth, setStaleReAuth]     = useState(false);

    const currentPwRef = useRef(null);
    const newPwRef     = useRef(null);

    // Tier 1.1 — real "last changed" timestamp
    const pwChangedAt  = currentUser?.passwordChangedAt;
    const pwChangedRel = useMemo(() => formatRelativeTime(pwChangedAt), [pwChangedAt]);
    const pwChangedAbs = useMemo(() => formatAbsoluteDate(pwChangedAt), [pwChangedAt]);
    const recentChange = useMemo(() => isWithinHours(pwChangedAt, 24), [pwChangedAt]);

    // Tier 1.5 — autofocus per step
    useEffect(() => {
        if (showPwForm && !currentPwStep) {
            const t = setTimeout(() => currentPwRef.current?.focus(), 60);
            return () => clearTimeout(t);
        }
    }, [showPwForm, currentPwStep]);

    useEffect(() => {
        if (showPwForm && currentPwStep) {
            const t = setTimeout(() => newPwRef.current?.focus(), 60);
            return () => clearTimeout(t);
        }
    }, [showPwForm, currentPwStep]);

    const openPwForm = () => {
        setShowPwForm(true);
        setPwError(''); setPwSuccess(false);
        setFieldErrors({}); setTooManyAttempts(false); setStaleReAuth(false);
    };

    const verifyCurrentPassword = async () => {
        if (!pwForm.currentPassword || stepLoading) return;
        setStepLoading(true); setPwError(''); setFieldErrors(p => ({ ...p, current: '' }));
        try {
            const auth = getAuth(app);
            await reauthenticateWithCredential(auth.currentUser, EmailAuthProvider.credential(auth.currentUser.email, pwForm.currentPassword));
            setCurrentPwStep(true);
            setVerifiedAt(Date.now());
            setStaleReAuth(false);
            setTooManyAttempts(false);
        } catch (err) {
            if (err.code === 'auth/too-many-requests') {
                setTooManyAttempts(true);
            } else if (err.code === 'auth/invalid-credential' || err.code === 'auth/wrong-password') {
                setFieldErrors(p => ({ ...p, current: 'Current password is incorrect.' }));
            } else {
                setPwError(err.message || 'Unable to verify.');
            }
        } finally { setStepLoading(false); }
    };

    const handleChangePassword = async (e) => {
        e.preventDefault();
        if (pwLoading || stepLoading) return;

        // Step 1: route Enter key to verification
        if (!currentPwStep) {
            await verifyCurrentPassword();
            return;
        }

        setPwError(''); setPwSuccess(false); setFieldErrors({});

        // Tier 2.7 — freshness safeguard: bounce to step 1 if verification is stale
        if (Date.now() - verifiedAt > FRESHNESS_WINDOW_MS) {
            setCurrentPwStep(false);
            setStaleReAuth(true);
            setPwForm(f => ({ ...f, currentPassword: '' }));
            return;
        }

        const { newPassword, confirmPassword } = pwForm;
        const failing = {};
        if (PW_RULES.some(r => !r.test(newPassword))) failing.new = 'Password must meet all requirements.';
        if (newPassword !== confirmPassword)          failing.confirm = 'Passwords do not match.';
        if (Object.keys(failing).length) { setFieldErrors(failing); return; }

        setPwLoading(true);
        try {
            await httpsCallable(getFunctions(app, 'asia-southeast1'), 'changePassword')({ newPassword });

            // Tier 2.8 — optionally revoke all other sessions
            if (signOutOthersChecked) {
                try {
                    await httpsCallable(getFunctions(app, 'asia-southeast1'), 'revokeOtherSessions')();
                } catch { /* non-fatal — don't block success */ }
            }

            await refreshUserData();
            setPwSuccess(true);
            setPwForm({ currentPassword: '', newPassword: '', confirmPassword: '' });
            setCurrentPwStep(false);
            setShowCurrent(false); setShowNew(false); setShowConfirm(false);
            setTimeout(() => {
                setShowPwForm(false); setPwSuccess(false); setSignOutOthersChecked(false);
            }, 2200);
        } catch (err) {
            const msg = err?.message || '';
            if (err?.code === 'auth/too-many-requests' || msg.includes('too-many-requests')) {
                setTooManyAttempts(true);
            } else if (err?.code === 'auth/invalid-credential' || err?.code === 'auth/wrong-password') {
                setFieldErrors({ current: 'Current password is incorrect.' });
                setCurrentPwStep(false);
            } else {
                setPwError(msg || 'Unable to update.');
            }
        } finally { setPwLoading(false); }
    };

    const cancelPasswordChange = () => {
        setShowPwForm(false); setCurrentPwStep(false); setStepLoading(false);
        setPwForm({ currentPassword: '', newPassword: '', confirmPassword: '' });
        setPwError(''); setPwSuccess(false); setFieldErrors({});
        setShowCurrent(false); setShowNew(false); setShowConfirm(false);
        setSignOutOthersChecked(false); setTooManyAttempts(false); setStaleReAuth(false);
    };

    const handleForgotPassword = async () => {
        setShowForgotModal(false);
        try { await signOut(getAuth(app)); } catch { /* ignore */ }
        navigate('/forgot-password');
    };

    // Go back to Step 1 without discarding the new/confirm values already typed
    const reverifyIdentity = () => {
        setCurrentPwStep(false);
        setStaleReAuth(false);
        setPwForm(f => ({ ...f, currentPassword: '' }));
        setFieldErrors(p => ({ ...p, current: '' }));
        setPwError(''); setTooManyAttempts(false);
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
                        <div className="p-6 lg:p-8">
                            {/* Two-column layout: Identity left, Info tiles right */}
                            <div className="flex flex-col lg:flex-row lg:items-center gap-8 lg:gap-10">

                                {/* LEFT — Avatar + Identity */}
                                <div className="flex flex-col items-center text-center lg:w-80 shrink-0">
                                    <div className="relative">
                                        <div className="rounded-full p-1 bg-gradient-to-br from-teal-400 to-emerald-500 shadow-xl shadow-teal-500/30">
                                            <button type="button" disabled={photoLoading || !!previewURL}
                                                onClick={() => photoInputRef.current?.click()}
                                                title={previewURL ? 'Confirm or cancel' : 'Change photo'}
                                                className="relative w-28 h-28 rounded-full bg-gradient-to-br from-teal-600 to-emerald-500 flex items-center justify-center text-white text-4xl font-extrabold overflow-hidden group cursor-pointer disabled:cursor-not-allowed focus:outline-none ring-4 ring-white dark:ring-slate-900">
                                                {previewURL ? <img src={previewURL} alt="Preview" className="w-full h-full object-cover" />
                                                : currentUser?.photoURL ? <img src={currentUser.photoURL} alt="Profile" className="w-full h-full object-cover" />
                                                : userInitial}
                                                {!previewURL && (
                                                    <div className="absolute inset-0 bg-black/50 flex flex-col items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity rounded-full">
                                                        {photoLoading ? <SpinnerSVG size={22} /> : <Camera size={22} className="text-white" />}
                                                    </div>
                                                )}
                                            </button>
                                        </div>
                                        <input ref={photoInputRef} type="file" accept="image/*" className="hidden" onChange={handlePhotoSelect} />
                                    </div>
                                    <h2 className="mt-4 text-xl font-extrabold text-slate-900 dark:text-white tracking-tight">{userName}</h2>
                                    <span className="inline-block mt-2 px-3 py-1 rounded-md bg-teal-100 dark:bg-teal-900/40 text-teal-700 dark:text-teal-300 text-[10px] font-extrabold uppercase tracking-widest border border-teal-200 dark:border-teal-500/30">
                                        {userRoleFull}
                                    </span>
                                </div>

                                {/* Vertical divider (desktop only) */}
                                <div className="hidden lg:block w-px self-stretch bg-slate-200 dark:bg-slate-700/50" />

                                {/* RIGHT — Info tiles, distributed across full remaining width */}
                                <div className="flex-1 min-w-0 grid grid-cols-1 sm:grid-cols-3 gap-4">
                                    <div className="p-5 rounded-xl bg-slate-50 dark:bg-slate-800/40 border border-slate-100 dark:border-slate-700/50 hover:border-teal-200 dark:hover:border-teal-500/30 transition-colors">
                                        <div className="flex items-center gap-1.5 mb-2">
                                            <Mail size={12} className="text-teal-500 shrink-0" />
                                            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 dark:text-slate-500">Email Address</p>
                                        </div>
                                        <p className="text-sm font-semibold text-slate-700 dark:text-slate-200 truncate">{userEmail}</p>
                                    </div>
                                    <div className="p-5 rounded-xl bg-slate-50 dark:bg-slate-800/40 border border-slate-100 dark:border-slate-700/50 hover:border-teal-200 dark:hover:border-teal-500/30 transition-colors">
                                        <div className="flex items-center gap-1.5 mb-2">
                                            <Building2 size={12} className="text-teal-500 shrink-0" />
                                            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 dark:text-slate-500">Department</p>
                                        </div>
                                        <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">{userDept}</p>
                                    </div>
                                    <div className="p-5 rounded-xl bg-slate-50 dark:bg-slate-800/40 border border-slate-100 dark:border-slate-700/50 hover:border-teal-200 dark:hover:border-teal-500/30 transition-colors">
                                        <div className="flex items-center gap-1.5 mb-2">
                                            <Shield size={12} className="text-teal-500 shrink-0" />
                                            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 dark:text-slate-500">Account Status</p>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <div className="w-2 h-2 rounded-full bg-emerald-500 shrink-0 animate-pulse" />
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
                            aria-expanded={showPwForm}
                            aria-controls="pw-form"
                            onClick={() => (showPwForm ? cancelPasswordChange() : openPwForm())}
                            className="w-full flex items-center gap-4 px-6 py-5 hover:bg-slate-50/80 dark:hover:bg-slate-800/30 transition-colors text-left">
                            <div className="flex-1 min-w-0">
                                <p className="text-sm font-bold text-slate-800 dark:text-slate-200">Password</p>
                                <p className="text-xs font-medium text-slate-400 dark:text-slate-500 mt-0.5"
                                   title={pwChangedAbs || undefined}>
                                    {pwChangedRel ? `Last changed ${pwChangedRel}` : 'Last changed on account creation'}
                                </p>
                            </div>
                            <span className="flex items-center gap-1.5 text-sm font-semibold text-teal-600 dark:text-teal-400">
                                {showPwForm ? 'Close' : 'Change Password'}
                                <ChevronRight size={16} className={`transition-transform ${showPwForm ? 'rotate-90' : ''}`} />
                            </span>
                        </button>

                        {showPwForm && (
                            <form
                                id="pw-form"
                                onSubmit={handleChangePassword}
                                className="px-6 pb-6 border-t border-slate-100 dark:border-slate-700/50 pt-5"
                            >
                                {(() => {
                                    const passed       = PW_RULES.filter(r => r.test(pwForm.newPassword)).length;
                                    const strength     = pwForm.newPassword ? getStrength(passed) : null;
                                    const nextMissing  = PW_RULES.find(r => !r.test(pwForm.newPassword));
                                    const confirmMatch = pwForm.confirmPassword && pwForm.newPassword && pwForm.confirmPassword === pwForm.newPassword;

                                    return (
                                        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,300px)_1fr] gap-6 lg:gap-10">

                                            {/* ═══ LEFT — context / status panel ═══ */}
                                            <aside className="space-y-4">
                                                {/* Step + verified status inline at top */}
                                                <div className="flex items-center gap-2 flex-wrap">
                                                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-teal-50 dark:bg-teal-900/30 border border-teal-100 dark:border-teal-500/30 text-[10px] font-extrabold uppercase tracking-[0.12em] text-teal-700 dark:text-teal-300">
                                                        Step {currentPwStep ? '2' : '1'} of 2
                                                    </span>
                                                    {currentPwStep && (
                                                        <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-emerald-50 dark:bg-emerald-900/30 border border-emerald-200 dark:border-emerald-500/30 text-[10px] font-extrabold uppercase tracking-[0.1em] text-emerald-700 dark:text-emerald-300">
                                                            <CheckCircle2 size={11} strokeWidth={3} /> Verified
                                                        </span>
                                                    )}
                                                </div>

                                                <div>
                                                    <h3 className="text-lg font-extrabold text-slate-900 dark:text-white tracking-tight leading-tight">
                                                        {currentPwStep ? 'Set your new password' : 'Verify your identity'}
                                                    </h3>
                                                    <p className="mt-1.5 text-sm font-medium text-slate-500 dark:text-slate-400 leading-relaxed">
                                                        {currentPwStep
                                                            ? 'Choose a strong password you haven\'t used before. You\'ll stay signed in on this device.'
                                                            : 'Re-enter your current password so we can confirm it\'s really you making this change.'}
                                                    </p>
                                                </div>

                                                {/* Step 2 — re-verify ghost button */}
                                                {currentPwStep && (
                                                    <button
                                                        type="button"
                                                        onClick={reverifyIdentity}
                                                        disabled={pwLoading}
                                                        className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/40 hover:border-teal-300 dark:hover:border-teal-500/40 hover:text-teal-700 dark:hover:text-teal-300 text-xs font-bold text-slate-600 dark:text-slate-300 transition-colors disabled:opacity-60"
                                                    >
                                                        <KeyRound size={12} /> Re-enter current password
                                                    </button>
                                                )}

                                                {/* Banners */}
                                                {recentChange && !pwSuccess && (
                                                    <div className="flex items-start gap-2.5 px-3.5 py-3 rounded-xl bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-500/30">
                                                        <Clock size={14} className="text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                                                        <div className="text-[11px] font-medium text-amber-700 dark:text-amber-300 leading-relaxed">
                                                            <span className="font-bold">Heads up:</span> you changed this {pwChangedRel}.
                                                        </div>
                                                    </div>
                                                )}
                                                {staleReAuth && (
                                                    <div className="flex items-start gap-2.5 px-3.5 py-3 rounded-xl bg-sky-50 dark:bg-sky-900/20 border border-sky-200 dark:border-sky-500/30" role="status">
                                                        <HelpCircle size={14} className="text-sky-600 dark:text-sky-400 shrink-0 mt-0.5" />
                                                        <p className="text-[11px] font-medium text-sky-700 dark:text-sky-300 leading-relaxed">Please re-enter your current password for security.</p>
                                                    </div>
                                                )}

                                                {/* Password safety tips — fills the left column */}
                                                {!pwSuccess && (
                                                    <div className="pt-4 border-t border-slate-100 dark:border-slate-700/50 space-y-2">
                                                        <p className="text-[10px] font-extrabold uppercase tracking-[0.12em] text-slate-400 dark:text-slate-500">
                                                            Password tips
                                                        </p>
                                                        <ul className="space-y-1.5">
                                                            {[
                                                                'Use a passphrase you can actually remember.',
                                                                'Never reuse a password from another account.',
                                                                'Mix unrelated words — not birthdays or names.',
                                                            ].map((tip) => (
                                                                <li key={tip} className="flex items-start gap-2 text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
                                                                    <Shield size={11} className="text-slate-400 shrink-0 mt-0.5" />
                                                                    <span>{tip}</span>
                                                                </li>
                                                            ))}
                                                        </ul>
                                                    </div>
                                                )}
                                            </aside>

                                            {/* ═══ RIGHT — form inputs ═══ */}
                                            <div className="space-y-5 min-w-0">

                                                {!currentPwStep && (
                                                    <div>
                                                        <PwInput
                                                            id="pw-current"
                                                            label="Current Password"
                                                            value={pwForm.currentPassword}
                                                            show={showCurrent}
                                                            disabled={pwLoading}
                                                            invalid={!!fieldErrors.current}
                                                            describedBy={fieldErrors.current ? 'pw-current-error' : undefined}
                                                            inputRef={currentPwRef}
                                                            onToggle={() => setShowCurrent(v => !v)}
                                                            placeholder="Enter current password"
                                                            autoComplete="current-password"
                                                            onChange={(e) => {
                                                                setPwForm(f => ({ ...f, currentPassword: e.target.value }));
                                                                setPwError('');
                                                                setFieldErrors(p => ({ ...p, current: '' }));
                                                            }}
                                                        />
                                                        {fieldErrors.current && (
                                                            <p id="pw-current-error" role="alert" className="mt-2 flex items-center gap-1.5 text-xs font-semibold text-red-600 dark:text-red-400">
                                                                <AlertCircle size={12} /> {fieldErrors.current}
                                                            </p>
                                                        )}
                                                    </div>
                                                )}

                                                {currentPwStep && (<>
                                                    {/* New password + strength inline */}
                                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                                                        <div>
                                                            <PwInput
                                                                id="pw-new"
                                                                label="New Password"
                                                                value={pwForm.newPassword}
                                                                show={showNew}
                                                                disabled={pwLoading}
                                                                invalid={!!fieldErrors.new}
                                                                describedBy="pw-strength pw-rules"
                                                                inputRef={newPwRef}
                                                                onToggle={() => setShowNew(v => !v)}
                                                                placeholder="Create a strong password"
                                                                autoComplete="new-password"
                                                                onChange={(e) => {
                                                                    setPwForm(f => ({ ...f, newPassword: e.target.value }));
                                                                    setPwError(''); setPwSuccess(false);
                                                                    setFieldErrors(p => ({ ...p, new: '' }));
                                                                }}
                                                            />
                                                            {fieldErrors.new && (
                                                                <p role="alert" className="mt-2 flex items-center gap-1.5 text-xs font-semibold text-red-600 dark:text-red-400">
                                                                    <AlertCircle size={12} /> {fieldErrors.new}
                                                                </p>
                                                            )}
                                                        </div>

                                                        <div>
                                                            <PwInput
                                                                id="pw-confirm"
                                                                label="Confirm Password"
                                                                value={pwForm.confirmPassword}
                                                                show={showConfirm}
                                                                disabled={pwLoading}
                                                                invalid={!!fieldErrors.confirm}
                                                                describedBy={fieldErrors.confirm ? 'pw-confirm-error' : (confirmMatch ? 'pw-confirm-ok' : undefined)}
                                                                onToggle={() => setShowConfirm(v => !v)}
                                                                placeholder="Repeat new password"
                                                                autoComplete="new-password"
                                                                onChange={(e) => {
                                                                    setPwForm(f => ({ ...f, confirmPassword: e.target.value }));
                                                                    setPwError(''); setPwSuccess(false);
                                                                    setFieldErrors(p => ({ ...p, confirm: '' }));
                                                                }}
                                                            />
                                                            {fieldErrors.confirm && (
                                                                <p id="pw-confirm-error" role="alert" className="mt-2 flex items-center gap-1.5 text-xs font-semibold text-red-600 dark:text-red-400">
                                                                    <AlertCircle size={12} /> {fieldErrors.confirm}
                                                                </p>
                                                            )}
                                                            {!fieldErrors.confirm && confirmMatch && (
                                                                <p id="pw-confirm-ok" className="mt-2 flex items-center gap-1.5 text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                                                                    <CheckCircle2 size={12} /> Passwords match
                                                                </p>
                                                            )}
                                                        </div>
                                                    </div>

                                                    {/* Strength bar — full width under inputs */}
                                                    {strength && (
                                                        <div id="pw-strength" className="space-y-1.5">
                                                            <div className="flex items-center justify-between">
                                                                <span className="text-xs font-bold uppercase tracking-wide text-slate-400">Strength</span>
                                                                <span className={`text-xs font-extrabold uppercase tracking-wide ${strength.text}`}>{strength.label}</span>
                                                            </div>
                                                            <div
                                                                role="progressbar"
                                                                aria-valuenow={strength.percent}
                                                                aria-valuemin={0}
                                                                aria-valuemax={100}
                                                                aria-label={`Password strength: ${strength.label}`}
                                                                className="h-2 w-full bg-slate-100 dark:bg-slate-700 rounded-full overflow-hidden"
                                                            >
                                                                <div
                                                                    className={`h-full rounded-full ${strength.color} transition-[width] duration-300 ease-out`}
                                                                    style={{ width: `${strength.percent}%` }}
                                                                />
                                                            </div>
                                                        </div>
                                                    )}

                                                    {/* Next-missing hint */}
                                                    {pwForm.newPassword && nextMissing && (
                                                        <div className="flex items-start gap-2 px-3.5 py-2.5 rounded-lg bg-sky-50 dark:bg-sky-900/20 border border-sky-100 dark:border-sky-500/20">
                                                            <Sparkles size={13} className="text-sky-500 dark:text-sky-400 shrink-0 mt-0.5" />
                                                            <p className="text-xs font-medium text-sky-700 dark:text-sky-300">
                                                                <span className="font-bold">Almost there — </span>{nextMissing.label.replace(/^At least /, '')} needed.
                                                            </p>
                                                        </div>
                                                    )}

                                                    {/* Rules grid — 2 cols on md, fills space */}
                                                    {pwForm.newPassword && (
                                                        <div id="pw-rules" className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1.5">
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

                                                    {/* Sign out other devices — inline row, not a card */}
                                                    <label className="flex items-center gap-2.5 py-1 cursor-pointer group w-fit">
                                                        <input
                                                            type="checkbox"
                                                            checked={signOutOthersChecked}
                                                            onChange={(e) => setSignOutOthersChecked(e.target.checked)}
                                                            disabled={pwLoading}
                                                            className="w-4 h-4 rounded border-slate-300 text-teal-600 focus:ring-2 focus:ring-teal-500/20 cursor-pointer"
                                                        />
                                                        <LogOut size={13} className="text-slate-500 dark:text-slate-400" />
                                                        <span className="text-xs font-bold text-slate-700 dark:text-slate-200 group-hover:text-teal-700 dark:group-hover:text-teal-300 transition-colors">
                                                            Sign out of all other devices
                                                        </span>
                                                        <span className="text-[11px] font-medium text-slate-400 dark:text-slate-500">
                                                            — recommended if compromised
                                                        </span>
                                                    </label>
                                                </>)}
                                            </div>
                                        </div>
                                    );
                                })()}

                                {/* Live feedback region — full width */}
                                <div aria-live="polite">
                                    {tooManyAttempts && (
                                        <div className="mt-5 flex items-start gap-2 px-4 py-3 rounded-xl bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-500/20" role="alert">
                                            <AlertCircle size={15} className="text-red-500 shrink-0 mt-0.5" />
                                            <div className="text-sm font-semibold text-red-700 dark:text-red-400">
                                                Too many attempts. Try again in a few minutes, or{' '}
                                                <button type="button" onClick={() => setShowForgotModal(true)} className="underline font-bold hover:text-red-600">
                                                    reset via email
                                                </button>.
                                            </div>
                                        </div>
                                    )}
                                    {pwError && !tooManyAttempts && (
                                        <div className="mt-5 flex items-center gap-2 px-4 py-3 rounded-xl bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-500/20" role="alert">
                                            <AlertCircle size={15} className="text-red-500 shrink-0" />
                                            <span className="text-sm font-semibold text-red-700 dark:text-red-400">{pwError}</span>
                                        </div>
                                    )}
                                    {pwSuccess && (
                                        <div className="mt-5 flex items-center gap-2 px-4 py-3 rounded-xl bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-500/20" role="status">
                                            <CheckCircle2 size={15} className="text-emerald-500 shrink-0" />
                                            <span className="text-sm font-semibold text-emerald-700 dark:text-emerald-400">
                                                Password updated{signOutOthersChecked ? ' · other devices signed out' : ''}.
                                            </span>
                                        </div>
                                    )}
                                </div>

                                {/* Unified action row — full width, right-aligned, separated by subtle divider */}
                                <div className="mt-6 pt-5 border-t border-slate-100 dark:border-slate-700/50 flex items-center justify-end gap-3">
                                    <button type="button" onClick={cancelPasswordChange}
                                        className="px-5 py-2.5 text-sm font-bold text-slate-600 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 transition-colors">
                                        Cancel
                                    </button>
                                    {!currentPwStep ? (
                                        <button type="submit" disabled={stepLoading || tooManyAttempts || !pwForm.currentPassword}
                                            className="flex items-center gap-2 px-6 py-2.5 rounded-xl bg-teal-600 hover:bg-teal-700 text-white text-sm font-bold transition-colors disabled:opacity-60 disabled:cursor-not-allowed">
                                            {stepLoading ? <><SpinnerSVG /> Verifying…</> : <>Continue <ChevronRight size={14} /></>}
                                        </button>
                                    ) : (
                                        <button type="submit"
                                            disabled={pwLoading || PW_RULES.some(r => !r.test(pwForm.newPassword)) || !pwForm.confirmPassword}
                                            className="flex items-center gap-2 px-6 py-2.5 bg-gradient-to-r from-teal-600 to-emerald-500 hover:from-teal-700 hover:to-emerald-600 text-white text-sm font-bold rounded-xl shadow-md shadow-teal-500/20 transition-all disabled:opacity-50 disabled:cursor-not-allowed">
                                            {pwLoading ? <><SpinnerSVG /> Updating…</> : 'Change Password'}
                                        </button>
                                    )}
                                </div>
                            </form>
                        )}
                    </Card>

                </div>
            </main>

            {/* ─── Forgot Password confirmation modal ─── */}
            {showForgotModal && (
                <div
                    role="dialog"
                    aria-modal="true"
                    aria-labelledby="forgot-title"
                    className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm"
                    style={{ animation: 'fadeIn 0.15s ease-out both' }}
                    onClick={() => setShowForgotModal(false)}
                >
                    <div
                        className="w-full max-w-md bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-2xl p-6"
                        style={{ animation: 'slideUp 0.2s ease-out both' }}
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="flex items-start justify-between mb-4">
                            <div className="flex items-center gap-3">
                                <div className="w-11 h-11 rounded-xl bg-amber-100 dark:bg-amber-900/40 flex items-center justify-center shrink-0">
                                    <HelpCircle size={20} className="text-amber-600 dark:text-amber-400" />
                                </div>
                                <h3 id="forgot-title" className="text-lg font-extrabold text-slate-900 dark:text-white tracking-tight">
                                    Reset via email?
                                </h3>
                            </div>
                            <button type="button" onClick={() => setShowForgotModal(false)}
                                aria-label="Close dialog"
                                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 p-1">
                                <X size={18} />
                            </button>
                        </div>
                        <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed mb-6">
                            We'll sign you out and take you to the password reset page. You'll need access to <span className="font-semibold text-slate-800 dark:text-slate-200">{userEmail}</span> to receive the reset link.
                        </p>
                        <div className="flex items-center justify-end gap-3">
                            <button type="button" onClick={() => setShowForgotModal(false)}
                                className="px-5 py-2.5 text-sm font-bold text-slate-600 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 transition-colors">
                                Never mind
                            </button>
                            <button type="button" onClick={handleForgotPassword}
                                className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-teal-600 hover:bg-teal-700 text-white text-sm font-bold transition-colors">
                                <LogOut size={14} /> Sign out &amp; reset
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default Settings;
