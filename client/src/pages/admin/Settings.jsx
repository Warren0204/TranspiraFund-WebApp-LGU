import { useState, useRef } from 'react';
import { Sun, Moon, Settings2, KeyRound, Eye, EyeOff, CheckCircle2, AlertCircle, ChevronDown, Mail, Building2, Pencil, X, Camera } from 'lucide-react';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { getAuth, reauthenticateWithCredential, EmailAuthProvider } from 'firebase/auth';
import { getStorage, ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage';
import AdminSidebar from '../../components/layout/AdminSidebar';
import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../context/ThemeContext';
import app from '../../config/firebase';

const ACCESS_PRIVILEGES = [
    'Account Provisioning',
    'System Health',
    'Audit Trails',
    'User Management',
];

const PW_RULES = [
    { id: 'length',    label: 'At least 12 characters',         test: (p) => p.length >= 12 },
    { id: 'upper',     label: 'At least one uppercase letter',   test: (p) => /[A-Z]/.test(p) },
    { id: 'lower',     label: 'At least one lowercase letter',   test: (p) => /[a-z]/.test(p) },
    { id: 'number',    label: 'At least one number',             test: (p) => /[0-9]/.test(p) },
    { id: 'special',   label: 'At least one special character',  test: (p) => /[^A-Za-z0-9]/.test(p) },
];

const getStrength = (passed) => {
    if (passed === 0) return null;
    if (passed <= 2)  return { label: 'Weak',      color: 'bg-red-500',    width: 'w-1/4',  text: 'text-red-600 dark:text-red-400' };
    if (passed === 3) return { label: 'Fair',      color: 'bg-amber-500',  width: 'w-2/4',  text: 'text-amber-600 dark:text-amber-400' };
    if (passed === 4) return { label: 'Strong',    color: 'bg-teal-500',   width: 'w-3/4',  text: 'text-teal-600 dark:text-teal-400' };
    return             { label: 'Very Strong', color: 'bg-emerald-500', width: 'w-full', text: 'text-emerald-600 dark:text-emerald-400' };
};

const Settings = () => {
    const { currentUser, refreshUserData } = useAuth();
    const { isDark, toggle } = useTheme();

    const userName    = currentUser ? `${currentUser.firstName} ${currentUser.lastName}` : 'Loading...';
    const userRole    = currentUser?.role || 'MIS';
    const userDept    = currentUser?.department || 'Information Technology Division';
    const userEmail   = currentUser?.email || '—';
    const userInitial = currentUser?.firstName?.charAt(0).toUpperCase() || 'M';

    const photoInputRef = useRef(null);
    const [photoLoading, setPhotoLoading]   = useState(false);
    const [photoError, setPhotoError]       = useState('');
    const [photoSuccess, setPhotoSuccess]   = useState(false);
    const [previewBlob, setPreviewBlob]     = useState(null);
    const [previewURL, setPreviewURL]       = useState('');

    // Phase 1: process image and show preview — no upload yet
    const handlePhotoSelect = async (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        e.target.value = '';

        if (!file.type.startsWith('image/')) { setPhotoError('Please select an image file.'); return; }
        if (file.size > 5 * 1024 * 1024)    { setPhotoError('Image must be smaller than 5 MB.'); return; }

        setPhotoError('');
        setPhotoSuccess(false);

        try {
            // Center-crop and resize to 200×200 JPEG via canvas
            const { dataURL, blob } = await new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = (ev) => {
                    const img = new Image();
                    img.onload = () => {
                        const SIZE = 200;
                        const canvas = document.createElement('canvas');
                        canvas.width = SIZE;
                        canvas.height = SIZE;
                        const ctx = canvas.getContext('2d');
                        const min = Math.min(img.width, img.height);
                        const sx = (img.width  - min) / 2;
                        const sy = (img.height - min) / 2;
                        ctx.drawImage(img, sx, sy, min, min, 0, 0, SIZE, SIZE);
                        // Use data URL for preview (blob: URLs are blocked by CSP img-src)
                        const dataURL = canvas.toDataURL('image/jpeg', 0.82);
                        canvas.toBlob((b) => {
                            if (b === null) reject(new Error('Failed to process image. Please try a different file.'));
                            else resolve({ dataURL, blob: b });
                        }, 'image/jpeg', 0.82);
                    };
                    img.onerror = reject;
                    img.src = ev.target.result;
                };
                reader.onerror = reject;
                reader.readAsDataURL(file);
            });

            setPreviewBlob(blob);
            setPreviewURL(dataURL);
        } catch (err) {
            setPhotoError(err.message || 'Unable to process image. Please try again.');
        }
    };

    // Phase 2: user confirmed the preview — now upload
    const handleConfirmUpload = async () => {
        if (!previewBlob || photoLoading) return;

        // Capture and clear preview immediately so the UI doesn't linger
        const blobToUpload = previewBlob;
        setPreviewBlob(null);
        setPreviewURL('');
        setPhotoLoading(true);
        setPhotoError('');

        try {
            const storage = getStorage(app);
            const photoRef = storageRef(storage, `profile-photos/${currentUser.uid}`);
            await uploadBytes(photoRef, blobToUpload, { contentType: 'image/jpeg' });
            const downloadURL = await getDownloadURL(photoRef);
            await httpsCallable(getFunctions(app, 'asia-southeast1'), 'updateProfilePhoto')({ photoURL: downloadURL });
            await refreshUserData();
            setPhotoSuccess(true);
            setTimeout(() => setPhotoSuccess(false), 2500);
        } catch (err) {
            setPhotoError(err.message || 'Unable to update photo. Please try again.');
        } finally {
            setPhotoLoading(false);
        }
    };

    // User cancelled the preview
    const handleCancelPreview = () => {
        setPreviewBlob(null);
        setPreviewURL('');
        setPhotoError('');
    };

    const [editingName, setEditingName]     = useState(false);
    const [nameForm, setNameForm]           = useState({ firstName: '', lastName: '' });
    const [nameLoading, setNameLoading]     = useState(false);
    const [nameError, setNameError]         = useState('');
    const [nameSuccess, setNameSuccess]     = useState(false);

    const openEditName = () => {
        setNameForm({
            firstName: currentUser?.firstName || '',
            lastName:  currentUser?.lastName  || '',
        });
        setNameError('');
        setNameSuccess(false);
        setEditingName(true);
    };

    const cancelEditName = () => {
        setEditingName(false);
        setNameError('');
        setNameSuccess(false);
    };

    const handleSaveName = async () => {
        if (nameLoading) return;
        const first = nameForm.firstName.trim();
        const last  = nameForm.lastName.trim();
        if (!first || !last) { setNameError('Both first and last name are required.'); return; }
        if (first.length < 2 || last.length < 2) { setNameError('Each name must be at least 2 characters.'); return; }
        setNameLoading(true);
        setNameError('');
        try {
            await httpsCallable(getFunctions(app, 'asia-southeast1'), 'updateProfile')({
                firstName: first,
                lastName:  last,
            });
            await refreshUserData();
            setNameSuccess(true);
            setTimeout(() => { setEditingName(false); setNameSuccess(false); }, 1500);
        } catch (err) {
            setNameError(err.message || 'Unable to update name. Please try again.');
        } finally {
            setNameLoading(false);
        }
    };

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
        setStepLoading(true);
        setPwError('');
        try {
            const auth = getAuth(app);
            const credential = EmailAuthProvider.credential(auth.currentUser.email, pwForm.currentPassword);
            await reauthenticateWithCredential(auth.currentUser, credential);
            setCurrentPwStep(true);
        } catch (err) {
            const msg = err.code === 'auth/invalid-credential' || err.code === 'auth/wrong-password'
                ? 'Current password is incorrect.'
                : err.message || 'Unable to verify password. Please try again.';
            setPwError(msg);
        } finally {
            setStepLoading(false);
        }
    };

    const handleChangePassword = async (e) => {
        e.preventDefault();
        if (pwLoading) return;
        setPwError('');
        setPwSuccess(false);

        const { currentPassword, newPassword, confirmPassword } = pwForm;
        if (!currentPassword) { setPwError('Please enter your current password.'); return; }
        const failed = PW_RULES.filter(r => !r.test(newPassword));
        if (failed.length > 0) { setPwError('Password must meet all requirements.'); return; }
        if (newPassword !== confirmPassword) { setPwError('Passwords do not match.'); return; }

        setPwLoading(true);
        try {
            await httpsCallable(getFunctions(app, 'asia-southeast1'), 'changePassword')({ newPassword });
            await refreshUserData();
            setPwSuccess(true);
            setPwForm({ currentPassword: '', newPassword: '', confirmPassword: '' });
            setCurrentPwStep(false);
            setShowCurrent(false);
            setShowNew(false);
            setShowConfirm(false);
            setTimeout(() => { setShowPwForm(false); setPwSuccess(false); }, 1800);
        } catch (err) {
            const msg = err.code === 'auth/invalid-credential' || err.code === 'auth/wrong-password'
                ? 'Current password is incorrect.'
                : err.message || 'Unable to update password. Please try again.';
            setPwError(msg);
        } finally {
            setPwLoading(false);
        }
    };

    const cancelPasswordChange = () => {
        setShowPwForm(false);
        setCurrentPwStep(false);
        setStepLoading(false);
        setPwForm({ currentPassword: '', newPassword: '', confirmPassword: '' });
        setPwError('');
        setPwSuccess(false);
        setShowCurrent(false);
        setShowNew(false);
        setShowConfirm(false);
    };

    return (
        <div className="min-h-screen hcsd-bg font-sans text-slate-900 dark:text-slate-100 transition-colors duration-300">
            <AdminSidebar />

            <main className="ml-0 md:ml-72 p-4 md:p-6 lg:p-10 pt-20 md:pt-10">

                <div className="mb-8" style={{ animation: 'fadeIn 0.4s ease-out both' }}>
                    <div className="flex items-center gap-2.5 mb-2">
                        <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-teal-600 to-emerald-500 flex items-center justify-center shadow-md shadow-teal-500/30">
                            <Settings2 size={14} className="text-white" strokeWidth={2.5} />
                        </div>
                        <span className="text-[11px] font-extrabold uppercase tracking-[0.18em] text-teal-600 dark:text-emerald-400">
                            Preferences
                        </span>
                    </div>
                    <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-slate-900 dark:text-white">
                        Settings
                    </h1>
                </div>

                <div className="space-y-5">

                    <div
                        className="relative bg-white dark:bg-slate-900/60 backdrop-blur-xl border border-slate-200 dark:border-white/5 rounded-[20px] shadow-lg overflow-hidden"
                        style={{ animation: 'slideUp 0.4s ease-out 0.05s both' }}
                    >
                        <div className="relative h-24 bg-gradient-to-r from-teal-600 via-teal-500 to-emerald-400 overflow-hidden">
                            <div className="absolute inset-0 opacity-[0.07]" aria-hidden="true">
                                <svg className="w-full h-full"><defs><pattern id="prof-grid" width="32" height="32" patternUnits="userSpaceOnUse"><path d="M 32 0 L 0 0 0 32" fill="none" stroke="white" strokeWidth="0.6"/></pattern></defs><rect width="100%" height="100%" fill="url(#prof-grid)"/></svg>
                            </div>
                            <div className="absolute -top-6 -right-6 w-36 h-36 bg-white/10 rounded-full blur-2xl" />
                            <div className="absolute -bottom-4 left-1/3 w-24 h-24 bg-emerald-300/20 rounded-full blur-xl" />
                        </div>

                        <div className="flex flex-col items-center -mt-10 pb-6 px-6">
                            <div className="relative">
                                <div className="absolute inset-0 rounded-full bg-teal-500/20 blur-xl scale-125 pointer-events-none" />
                                <button
                                    type="button"
                                    disabled={photoLoading || !!previewURL}
                                    onClick={() => photoInputRef.current?.click()}
                                    title={previewURL ? 'Confirm or cancel the preview below' : 'Change profile photo'}
                                    className="relative w-20 h-20 rounded-full bg-gradient-to-br from-teal-600 to-emerald-500 flex items-center justify-center text-white text-3xl font-extrabold shadow-xl shadow-teal-500/30 border-4 border-white dark:border-slate-900 overflow-hidden group cursor-pointer disabled:cursor-not-allowed focus:outline-none"
                                >
                                    {previewURL ? (
                                        <img src={previewURL} alt="Preview" className="w-full h-full object-cover" />
                                    ) : currentUser?.photoURL ? (
                                        <img src={currentUser.photoURL} alt="Profile" className="w-full h-full object-cover" />
                                    ) : userInitial}
                                    {!previewURL && (
                                        <div className="absolute inset-0 bg-black/50 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-200">
                                            {photoLoading
                                                ? <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="animate-spin"><line x1="12" y1="2" x2="12" y2="6"/><line x1="12" y1="18" x2="12" y2="22"/><line x1="4.93" y1="4.93" x2="7.76" y2="7.76"/><line x1="16.24" y1="16.24" x2="19.07" y2="19.07"/><line x1="2" y1="12" x2="6" y2="12"/><line x1="18" y1="12" x2="22" y2="12"/></svg>
                                                : <Camera size={18} className="text-white" />
                                            }
                                        </div>
                                    )}
                                </button>
                                <input
                                    ref={photoInputRef}
                                    type="file"
                                    accept="image/*"
                                    className="hidden"
                                    onChange={handlePhotoSelect}
                                />
                            </div>

                            {previewURL && (
                                <div className="mt-3 flex flex-col items-center gap-2 w-full max-w-xs">
                                    <p className="text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wide">
                                        Preview — does this look right?
                                    </p>
                                    <div className="flex gap-2 w-full">
                                        <button
                                            type="button"
                                            onClick={handleCancelPreview}
                                            disabled={photoLoading}
                                            className="flex-1 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 text-xs font-bold hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-all disabled:opacity-50"
                                        >
                                            Choose Different
                                        </button>
                                        <button
                                            type="button"
                                            onClick={handleConfirmUpload}
                                            disabled={photoLoading}
                                            className="flex-1 py-2 rounded-xl bg-gradient-to-r from-teal-600 to-emerald-500 hover:from-teal-700 hover:to-emerald-600 text-white text-xs font-bold shadow-md shadow-teal-500/20 transition-all disabled:opacity-50 flex items-center justify-center gap-1.5"
                                        >
                                            {photoLoading ? (
                                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="animate-spin"><line x1="12" y1="2" x2="12" y2="6"/><line x1="12" y1="18" x2="12" y2="22"/><line x1="4.93" y1="4.93" x2="7.76" y2="7.76"/><line x1="16.24" y1="16.24" x2="19.07" y2="19.07"/><line x1="2" y1="12" x2="6" y2="12"/><line x1="18" y1="12" x2="22" y2="12"/></svg>
                                            ) : <CheckCircle2 size={12} />}
                                            {photoLoading ? 'Uploading…' : 'Use This Photo'}
                                        </button>
                                    </div>
                                </div>
                            )}

                            {photoError && (
                                <div className="mt-2 flex items-center gap-2 px-3 py-2 rounded-xl bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-500/20 text-red-700 dark:text-red-400 max-w-xs">
                                    <AlertCircle size={13} className="shrink-0" />
                                    <span className="text-xs font-semibold">{photoError}</span>
                                </div>
                            )}
                            {photoSuccess && (
                                <div className="mt-2 flex items-center gap-2 px-3 py-2 rounded-xl bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-500/20 text-emerald-700 dark:text-emerald-400 max-w-xs">
                                    <CheckCircle2 size={13} className="shrink-0" />
                                    <span className="text-xs font-semibold">Photo updated successfully.</span>
                                </div>
                            )}

                            <div className="mt-3 text-center w-full">
                                {!editingName ? (
                                    <>
                                        <h2 className="text-xl font-extrabold text-slate-900 dark:text-white tracking-tight">{userName}</h2>
                                        <span className="inline-block mt-1.5 px-3 py-0.5 rounded-full bg-gradient-to-r from-teal-600 to-emerald-500 text-white text-[10px] font-extrabold uppercase tracking-wider shadow-sm shadow-teal-500/30">
                                            {userRole}
                                        </span>
                                        <button
                                            onClick={openEditName}
                                            className="mt-3 flex items-center gap-1.5 text-xs font-bold text-teal-600 dark:text-teal-400 hover:text-teal-700 dark:hover:text-teal-300 transition-colors mx-auto px-3 py-1.5 rounded-lg hover:bg-teal-50 dark:hover:bg-teal-900/20"
                                        >
                                            <Pencil size={13} />
                                            Edit Name
                                        </button>
                                    </>
                                ) : (
                                    <div className="w-full max-w-sm mx-auto mt-1">
                                        <p className="text-[11px] font-extrabold uppercase tracking-[0.15em] text-slate-400 dark:text-slate-500 mb-3">Update Your Name</p>
                                        <div className="grid grid-cols-2 gap-2.5 mb-3">
                                            <div className="text-left">
                                                <label className="block text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-1.5">First Name</label>
                                                <input
                                                    type="text"
                                                    value={nameForm.firstName}
                                                    onChange={(e) => { setNameForm(f => ({ ...f, firstName: e.target.value })); setNameError(''); }}
                                                    disabled={nameLoading}
                                                    className="w-full px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/40 text-sm font-medium text-slate-800 dark:text-slate-200 placeholder:text-slate-400 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/15 outline-none transition-all disabled:opacity-60"
                                                    placeholder="First name"
                                                />
                                            </div>
                                            <div className="text-left">
                                                <label className="block text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-1.5">Last Name</label>
                                                <input
                                                    type="text"
                                                    value={nameForm.lastName}
                                                    onChange={(e) => { setNameForm(f => ({ ...f, lastName: e.target.value })); setNameError(''); }}
                                                    disabled={nameLoading}
                                                    className="w-full px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/40 text-sm font-medium text-slate-800 dark:text-slate-200 placeholder:text-slate-400 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/15 outline-none transition-all disabled:opacity-60"
                                                    placeholder="Last name"
                                                />
                                            </div>
                                        </div>

                                        {nameError && (
                                            <div className="flex items-center gap-2 mb-3 px-3 py-2.5 rounded-xl bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-500/20 text-red-700 dark:text-red-400 text-left">
                                                <AlertCircle size={14} className="shrink-0" />
                                                <span className="text-xs font-semibold">{nameError}</span>
                                            </div>
                                        )}
                                        {nameSuccess && (
                                            <div className="flex items-center gap-2 mb-3 px-3 py-2.5 rounded-xl bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-500/20 text-emerald-700 dark:text-emerald-400 text-left">
                                                <CheckCircle2 size={14} className="shrink-0" />
                                                <span className="text-xs font-semibold">Name updated successfully.</span>
                                            </div>
                                        )}

                                        <div className="flex gap-2.5">
                                            <button
                                                onClick={cancelEditName}
                                                disabled={nameLoading}
                                                className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 text-sm font-bold hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-all disabled:opacity-50"
                                            >
                                                <X size={14} />
                                                Cancel
                                            </button>
                                            <button
                                                onClick={handleSaveName}
                                                disabled={nameLoading || !nameForm.firstName.trim() || !nameForm.lastName.trim()}
                                                className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl bg-gradient-to-r from-teal-600 to-emerald-500 hover:from-teal-700 hover:to-emerald-600 text-white text-sm font-bold shadow-md shadow-teal-500/20 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                                            >
                                                {nameLoading ? (
                                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="animate-spin">
                                                        <line x1="12" y1="2" x2="12" y2="6"/><line x1="12" y1="18" x2="12" y2="22"/><line x1="4.93" y1="4.93" x2="7.76" y2="7.76"/><line x1="16.24" y1="16.24" x2="19.07" y2="19.07"/><line x1="2" y1="12" x2="6" y2="12"/><line x1="18" y1="12" x2="22" y2="12"/>
                                                    </svg>
                                                ) : <CheckCircle2 size={14} />}
                                                {nameLoading ? 'Saving…' : 'Save Name'}
                                            </button>
                                        </div>
                                    </div>
                                )}
                            </div>

                            <div className="mt-4 flex flex-wrap items-center justify-center gap-2.5">
                                <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700/60">
                                    <Mail size={12} className="text-teal-600 dark:text-teal-400 shrink-0" />
                                    <span className="text-xs font-semibold text-slate-600 dark:text-slate-300 max-w-[220px] truncate">{userEmail}</span>
                                </div>
                                <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700/60">
                                    <Building2 size={12} className="text-teal-600 dark:text-teal-400 shrink-0" />
                                    <span className="text-xs font-semibold text-slate-600 dark:text-slate-300 max-w-[220px] truncate">{userDept}</span>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div
                        className="grid grid-cols-1 md:grid-cols-2 gap-5"
                        style={{ animation: 'slideUp 0.4s ease-out 0.1s both' }}
                    >
                        <div className="bg-white dark:bg-slate-900/60 backdrop-blur-xl border border-slate-200 dark:border-white/5 rounded-[20px] shadow-lg overflow-hidden">
                            <div className="px-6 pt-5 pb-3 border-b border-slate-100 dark:border-slate-700/50">
                                <span className="text-[10px] font-extrabold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">Appearance</span>
                            </div>
                            <div className="p-5 grid grid-cols-2 gap-3">
                                <button
                                    onClick={() => isDark && toggle()}
                                    className={`flex flex-col items-center gap-2.5 p-4 rounded-xl border-2 transition-all duration-200 ${
                                        !isDark
                                            ? 'border-teal-500 bg-teal-50'
                                            : 'border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/40 hover:border-slate-300 dark:hover:border-slate-600'
                                    }`}
                                >
                                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center transition-all ${
                                        !isDark ? 'bg-amber-400 text-white shadow-md shadow-amber-400/30' : 'bg-slate-200 dark:bg-slate-700 text-slate-400 dark:text-slate-500'
                                    }`}>
                                        <Sun size={19} />
                                    </div>
                                    <span className={`text-xs font-bold ${!isDark ? 'text-teal-700' : 'text-slate-500 dark:text-slate-500'}`}>Light</span>
                                </button>

                                <button
                                    onClick={() => !isDark && toggle()}
                                    className={`flex flex-col items-center gap-2.5 p-4 rounded-xl border-2 transition-all duration-200 ${
                                        isDark
                                            ? 'border-teal-500 dark:bg-teal-900/20'
                                            : 'border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/40 hover:border-slate-300 dark:hover:border-slate-600'
                                    }`}
                                >
                                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center transition-all ${
                                        isDark ? 'bg-slate-700 text-teal-300 shadow-md shadow-teal-500/15' : 'bg-slate-200 dark:bg-slate-700 text-slate-400'
                                    }`}>
                                        <Moon size={19} />
                                    </div>
                                    <span className={`text-xs font-bold ${isDark ? 'text-teal-300' : 'text-slate-500'}`}>Dark</span>
                                </button>
                            </div>
                        </div>

                        <div className="bg-white dark:bg-slate-900/60 backdrop-blur-xl border border-slate-200 dark:border-white/5 rounded-[20px] shadow-lg overflow-hidden">
                            <div className="px-6 pt-5 pb-3 border-b border-slate-100 dark:border-slate-700/50">
                                <span className="text-[10px] font-extrabold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">Access Level</span>
                            </div>
                            <div className="p-5 grid grid-cols-2 gap-2.5">
                                {ACCESS_PRIVILEGES.map((p) => (
                                    <div
                                        key={p}
                                        className="flex items-center justify-center px-3 py-2.5 rounded-xl bg-teal-50 dark:bg-teal-900/25 border border-teal-200 dark:border-teal-500/25 text-xs font-bold text-teal-700 dark:text-teal-300 text-center"
                                    >
                                        {p}
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>

                    <div
                        className="bg-white dark:bg-slate-900/60 backdrop-blur-xl border border-slate-200 dark:border-white/5 rounded-[20px] shadow-lg overflow-hidden"
                        style={{ animation: 'slideUp 0.4s ease-out 0.15s both' }}
                    >
                        <button
                            type="button"
                            onClick={() => { setShowPwForm(v => !v); if (showPwForm) cancelPasswordChange(); }}
                            className="w-full flex items-center gap-4 px-6 py-5 hover:bg-slate-50 dark:hover:bg-slate-800/30 transition-colors text-left"
                        >
                            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-teal-600 to-emerald-500 flex items-center justify-center shrink-0 shadow-md shadow-teal-500/20">
                                <KeyRound size={16} className="text-white" />
                            </div>
                            <div className="flex-1 min-w-0">
                                <p className="text-sm font-bold text-slate-800 dark:text-slate-200">Change Password</p>
                                <p className="text-xs font-medium text-slate-500 dark:text-slate-400 mt-0.5">Update your account credentials</p>
                            </div>
                            <ChevronDown
                                size={18}
                                className={`text-slate-400 dark:text-slate-500 transition-transform duration-200 shrink-0 ${showPwForm ? 'rotate-180' : ''}`}
                            />
                        </button>

                        {showPwForm && (
                            <form
                                onSubmit={handleChangePassword}
                                className="px-6 pb-6 border-t border-slate-100 dark:border-slate-700/50 pt-5"
                            >
                                {(() => {
                                    const passed   = PW_RULES.filter(r => r.test(pwForm.newPassword)).length;
                                    const strength = pwForm.newPassword ? getStrength(passed) : null;
                                    return (
                                        <div className="space-y-4 mb-4">
                                            <div className="space-y-1.5">
                                                <label className="text-[11px] font-extrabold uppercase tracking-[0.15em] text-slate-500 dark:text-slate-400">
                                                    Current Password
                                                </label>
                                                <div className="relative">
                                                    <input
                                                        type={showCurrent ? 'text' : 'password'}
                                                        value={pwForm.currentPassword}
                                                        onChange={(e) => { setPwForm(f => ({ ...f, currentPassword: e.target.value })); setPwError(''); }}
                                                        onKeyDown={(e) => { if (e.key === 'Enter' && !currentPwStep && pwForm.currentPassword) { e.preventDefault(); verifyCurrentPassword(); } }}
                                                        placeholder="Enter your current password"
                                                        autoComplete="current-password"
                                                        disabled={pwLoading}
                                                        className="w-full pr-10 pl-4 py-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/40 text-sm font-medium text-slate-800 dark:text-slate-200 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/15 outline-none transition-all disabled:opacity-60"
                                                    />
                                                    <button type="button" onClick={() => setShowCurrent(v => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors p-0.5">
                                                        {showCurrent ? <EyeOff size={16} /> : <Eye size={16} />}
                                                    </button>
                                                </div>
                                            </div>

                                            {!currentPwStep && pwForm.currentPassword && (
                                                <button
                                                    type="button"
                                                    onClick={verifyCurrentPassword}
                                                    disabled={stepLoading}
                                                    className="w-full py-2.5 rounded-xl bg-teal-600 hover:bg-teal-700 disabled:opacity-60 text-white text-sm font-bold transition-colors flex items-center justify-center gap-2"
                                                >
                                                    {stepLoading ? (
                                                        <>
                                                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="animate-spin">
                                                                <line x1="12" y1="2" x2="12" y2="6"/><line x1="12" y1="18" x2="12" y2="22"/><line x1="4.93" y1="4.93" x2="7.76" y2="7.76"/><line x1="16.24" y1="16.24" x2="19.07" y2="19.07"/><line x1="2" y1="12" x2="6" y2="12"/><line x1="18" y1="12" x2="22" y2="12"/>
                                                            </svg>
                                                            Verifying…
                                                        </>
                                                    ) : 'Continue'}
                                                </button>
                                            )}

                                            {currentPwStep && (<>
                                            <div className="space-y-1.5">
                                                <label className="text-[11px] font-extrabold uppercase tracking-[0.15em] text-slate-500 dark:text-slate-400">
                                                    New Password
                                                </label>
                                                <div className="relative">
                                                    <input
                                                        type={showNew ? 'text' : 'password'}
                                                        value={pwForm.newPassword}
                                                        onChange={(e) => { setPwForm(f => ({ ...f, newPassword: e.target.value })); setPwError(''); setPwSuccess(false); }}
                                                        placeholder="Create a strong password"
                                                        autoComplete="new-password"
                                                        disabled={pwLoading}
                                                        className="w-full pr-10 pl-4 py-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/40 text-sm font-medium text-slate-800 dark:text-slate-200 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/15 outline-none transition-all disabled:opacity-60"
                                                    />
                                                    <button type="button" onClick={() => setShowNew(v => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors p-0.5">
                                                        {showNew ? <EyeOff size={16} /> : <Eye size={16} />}
                                                    </button>
                                                </div>

                                                {strength && (
                                                    <div className="space-y-1">
                                                        <div className="flex items-center justify-between">
                                                            <span className="text-[10px] font-bold uppercase tracking-wide text-slate-400 dark:text-slate-500">Strength</span>
                                                            <span className={`text-[10px] font-extrabold uppercase tracking-wide ${strength.text}`}>{strength.label}</span>
                                                        </div>
                                                        <div className="h-1.5 w-full bg-slate-100 dark:bg-slate-700 rounded-full overflow-hidden">
                                                            <div className={`h-full rounded-full transition-all duration-300 ${strength.color} ${strength.width}`} />
                                                        </div>
                                                    </div>
                                                )}

                                                {pwForm.newPassword && (
                                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-1 pt-1">
                                                        {PW_RULES.map(rule => {
                                                            const ok = rule.test(pwForm.newPassword);
                                                            return (
                                                                <div key={rule.id} className="flex items-center gap-1.5">
                                                                    {ok
                                                                        ? <CheckCircle2 size={12} className="text-emerald-500 shrink-0" />
                                                                        : <span className="w-3 h-3 rounded-full border-2 border-slate-300 dark:border-slate-600 shrink-0" />
                                                                    }
                                                                    <span className={`text-[11px] font-medium ${ok ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-500 dark:text-slate-400'}`}>
                                                                        {rule.label}
                                                                    </span>
                                                                </div>
                                                            );
                                                        })}
                                                    </div>
                                                )}
                                            </div>

                                            <div className="space-y-1.5">
                                                <label className="text-[11px] font-extrabold uppercase tracking-[0.15em] text-slate-500 dark:text-slate-400">
                                                    Confirm Password
                                                </label>
                                                <div className="relative">
                                                    <input
                                                        type={showConfirm ? 'text' : 'password'}
                                                        value={pwForm.confirmPassword}
                                                        onChange={(e) => { setPwForm(f => ({ ...f, confirmPassword: e.target.value })); setPwError(''); setPwSuccess(false); }}
                                                        placeholder="Repeat your password"
                                                        autoComplete="new-password"
                                                        disabled={pwLoading}
                                                        className="w-full pr-10 pl-4 py-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/40 text-sm font-medium text-slate-800 dark:text-slate-200 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/15 outline-none transition-all disabled:opacity-60"
                                                    />
                                                    <button type="button" onClick={() => setShowConfirm(v => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors p-0.5">
                                                        {showConfirm ? <EyeOff size={16} /> : <Eye size={16} />}
                                                    </button>
                                                </div>
                                            </div>
                                            </>)}
                                        </div>
                                    );
                                })()}

                                {pwError && (
                                    <div className="flex items-center gap-2.5 mb-4 px-4 py-3 rounded-xl bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-500/20 text-red-700 dark:text-red-400">
                                        <AlertCircle size={15} className="shrink-0" />
                                        <span className="text-xs font-semibold">{pwError}</span>
                                    </div>
                                )}
                                {pwSuccess && (
                                    <div className="flex items-center gap-2.5 mb-4 px-4 py-3 rounded-xl bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-500/20 text-emerald-700 dark:text-emerald-400">
                                        <CheckCircle2 size={15} className="shrink-0" />
                                        <span className="text-xs font-semibold">Password updated successfully.</span>
                                    </div>
                                )}

                                {currentPwStep && <div className="flex items-center justify-end gap-3">
                                    <button
                                        type="button"
                                        onClick={cancelPasswordChange}
                                        className="px-5 py-2.5 text-sm font-bold text-slate-600 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 transition-colors"
                                    >
                                        Cancel
                                    </button>
                                    <button
                                        type="submit"
                                        disabled={pwLoading || PW_RULES.some(r => !r.test(pwForm.newPassword)) || !pwForm.confirmPassword}
                                        className="flex items-center gap-2 px-6 py-2.5 bg-gradient-to-r from-teal-600 to-emerald-500 hover:from-teal-700 hover:to-emerald-600 text-white text-sm font-bold rounded-xl shadow-md shadow-teal-500/20 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                                    >
                                        {pwLoading ? (
                                            <>
                                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="animate-spin">
                                                    <line x1="12" y1="2" x2="12" y2="6"/><line x1="12" y1="18" x2="12" y2="22"/><line x1="4.93" y1="4.93" x2="7.76" y2="7.76"/><line x1="16.24" y1="16.24" x2="19.07" y2="19.07"/><line x1="2" y1="12" x2="6" y2="12"/><line x1="18" y1="12" x2="22" y2="12"/>
                                                </svg>
                                                Updating…
                                            </>
                                        ) : 'Update Password'}
                                    </button>
                                </div>}
                            </form>
                        )}
                    </div>

                </div>
            </main>
        </div>
    );
};

export default Settings;