import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { verifyPasswordResetCode } from 'firebase/auth';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { auth } from '../../config/firebase';
import app from '../../config/firebase';
import { ShieldCheck, Lock, Eye, EyeOff, AlertCircle, CheckCircle2, XCircle, Landmark } from 'lucide-react';
import logo from '../../assets/logo.png';

const PW_RULES = [
    { id: 'length', label: 'At least 12 characters', test: (p) => p.length >= 12 },
    { id: 'upper', label: 'At least one uppercase letter (A–Z)', test: (p) => /[A-Z]/.test(p) },
    { id: 'lower', label: 'At least one lowercase letter (a–z)', test: (p) => /[a-z]/.test(p) },
    { id: 'number', label: 'At least one number (0–9)', test: (p) => /[0-9]/.test(p) },
    { id: 'special', label: 'At least one special character (!@#$…)', test: (p) => /[^A-Za-z0-9]/.test(p) },
];

const STRENGTH_LEVELS = [
    { label: 'Too Weak', barColor: 'bg-red-500', textColor: 'text-red-500' },
    { label: 'Weak', barColor: 'bg-red-400', textColor: 'text-red-400' },
    { label: 'Fair', barColor: 'bg-amber-500', textColor: 'text-amber-500' },
    { label: 'Good', barColor: 'bg-yellow-500', textColor: 'text-yellow-600' },
    { label: 'Strong', barColor: 'bg-teal-500', textColor: 'text-teal-600' },
    { label: 'Very Strong', barColor: 'bg-emerald-500', textColor: 'text-emerald-600' },
];

const ResetPassword = () => {
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const oobCode = searchParams.get('oobCode');

    const [status, setStatus] = useState('verifying'); // verifying | form | success | invalid
    const [accountEmail, setAccountEmail] = useState('');
    const [formData, setFormData] = useState({ newPassword: '', confirmPassword: '' });
    const [showNew, setShowNew] = useState(false);
    const [showConfirm, setShowConfirm] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState('');


    useEffect(() => {
        if (!oobCode) { setStatus('invalid'); return; }
        verifyPasswordResetCode(auth, oobCode)
            .then((email) => { setAccountEmail(email); setStatus('form'); })
            .catch(() => setStatus('invalid'));
    }, [oobCode]);

    const passedCount = PW_RULES.filter(r => r.test(formData.newPassword)).length;
    const allPassed = passedCount === PW_RULES.length;
    const passwordsMatch = formData.confirmPassword === formData.newPassword && formData.confirmPassword.length > 0;
    const canSubmit = allPassed && passwordsMatch;
    const strengthLevel = STRENGTH_LEVELS[passedCount];
    const confirmBorder = formData.confirmPassword.length === 0
        ? 'border-slate-200'
        : passwordsMatch ? 'border-teal-400' : 'border-red-300';

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (isLoading || !canSubmit) return;
        setIsLoading(true);
        setError('');
        try {
            const fn = httpsCallable(getFunctions(app, 'asia-southeast1'), 'resetPassword');
            await fn({ oobCode, newPassword: formData.newPassword });
            setStatus('success');
        } catch (err) {
            const msg = err?.message || '';
            if (msg.includes('expired')) {
                setError('This reset link has expired. Please request a new one.');
            } else if (msg.includes('invalid') || msg.includes('already been used')) {
                setError('This reset link is invalid or has already been used.');
            } else {
                setError('Failed to reset password. Please try again.');
            }
        } finally {
            setIsLoading(false);
        }
    };

    if (status === 'verifying') {
        return (
            <div className="min-h-screen bg-[#F8FAFC] flex items-center justify-center">
                <div className="text-center">
                    <span className="w-10 h-10 border-4 border-teal-500/30 border-t-teal-600 rounded-full animate-spin inline-block mb-4" />
                    <p className="text-slate-500 font-semibold text-sm">Verifying reset link…</p>
                </div>
            </div>
        );
    }

    if (status === 'invalid') {
        return (
            <div className="min-h-screen bg-[#F8FAFC] flex items-center justify-center p-4 font-sans">
                <div className="bg-white border border-slate-200/80 rounded-[28px] shadow-xl max-w-md w-full p-10 text-center">
                    <div className="w-16 h-16 rounded-full bg-red-50 border border-red-100 flex items-center justify-center mx-auto mb-6">
                        <AlertCircle size={30} className="text-red-400" />
                    </div>
                    <h2 className="text-xl font-extrabold text-slate-800 mb-3 tracking-tight">Invalid or Expired Link</h2>
                    <p className="text-slate-500 text-sm leading-relaxed mb-8">
                        This password reset link is no longer valid. Links expire after 24 hours and can only be used once.
                    </p>
                    <button
                        onClick={() => navigate('/forgot-password')}
                        className="w-full font-bold py-3.5 rounded-xl bg-teal-700 hover:bg-teal-800 text-white shadow-md transition-all text-sm mb-3"
                    >
                        Request a New Link
                    </button>
                    <button
                        onClick={() => navigate('/login')}
                        className="w-full font-bold py-3 rounded-xl text-slate-400 hover:text-teal-700 transition-colors text-sm"
                    >
                        Back to Login
                    </button>
                </div>
            </div>
        );
    }

    if (status === 'success') {
        return (
            <div className="min-h-screen bg-[#F8FAFC] flex items-center justify-center p-4 font-sans">
                <div className="bg-white border border-slate-200/80 rounded-[28px] shadow-xl max-w-md w-full overflow-hidden">
                    <div className="relative bg-gradient-to-br from-emerald-500 to-teal-500 px-8 pt-8 pb-12 text-center overflow-hidden">
                        <div className="absolute -top-6 -right-6 w-32 h-32 rounded-full bg-white/10 pointer-events-none" />
                        <div className="absolute -bottom-4 -left-4 w-24 h-24 rounded-full bg-white/10 pointer-events-none" />
                        <div className="relative inline-flex items-center justify-center mb-4">
                            <span className="absolute w-16 h-16 rounded-full bg-white/20 animate-ping" style={{ animationDuration: '2.2s' }} />
                            <div className="relative w-14 h-14 rounded-full bg-white/25 flex items-center justify-center shadow-xl">
                                <CheckCircle2 size={30} className="text-white" strokeWidth={2} />
                            </div>
                        </div>
                        <h2 className="text-2xl font-extrabold text-white tracking-tight">Password Reset!</h2>
                        <p className="text-white/70 text-sm mt-1.5">Your new password has been set successfully.</p>
                    </div>
                    <div className="px-8 py-7 text-center">
                        <p className="text-slate-500 text-sm leading-relaxed mb-7">
                            You can now sign in to the portal with your new secure password.
                        </p>
                        <button
                            onClick={() => navigate('/login')}
                            className="w-full font-bold py-4 rounded-xl bg-teal-700 hover:bg-teal-800 text-white shadow-md shadow-teal-700/20 transition-all text-[15px]"
                        >
                            Back to Login
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen flex font-sans text-slate-800 bg-[#F8FAFC]">


            <div className="hidden lg:flex w-1/2 bg-teal-700 relative flex-col items-center justify-center text-white p-12 overflow-hidden">
                <div className="absolute inset-0 opacity-[0.06]" aria-hidden="true">
                    <svg className="w-full h-full">
                        <defs>
                            <pattern id="rp-grid" width="40" height="40" patternUnits="userSpaceOnUse">
                                <path d="M 40 0 L 0 0 0 40" fill="none" stroke="white" strokeWidth="0.5" />
                            </pattern>
                        </defs>
                        <rect width="100%" height="100%" fill="url(#rp-grid)" />
                    </svg>
                </div>
                <div className="absolute top-0 right-0 w-80 h-80 bg-white/5 rounded-full blur-[100px]" aria-hidden="true" />
                <div className="absolute bottom-0 left-0 w-60 h-60 bg-teal-400/10 rounded-full blur-[80px]" aria-hidden="true" />
                <div className="relative z-10 flex flex-col items-center text-center max-w-md">
                    <div className="w-24 h-24 rounded-full overflow-hidden mb-8">
                        <img src={logo} alt="TranspiraFund seal" className="w-full h-full object-cover scale-[1.55]" />
                    </div>
                    <h1 className="text-4xl font-black mb-4 tracking-tight leading-tight">Reset Your<br />Password</h1>
                    <p className="text-teal-100 text-[15px] leading-relaxed">
                        Choose a strong, unique password that meets all cybersecurity requirements.
                    </p>
                    <div className="mt-8 flex items-center gap-2 bg-white/10 border border-white/15 rounded-full px-4 py-2">
                        <ShieldCheck size={14} className="text-teal-300" />
                        <span className="text-teal-200 text-xs font-semibold tracking-wide">Cybersecurity-Standard Requirements</span>
                    </div>
                </div>
            </div>


            <div className="w-full lg:w-1/2 bg-white flex flex-col justify-center px-6 sm:px-12 md:px-24 overflow-y-auto py-12">


                <div className="flex lg:hidden items-center justify-center gap-2.5 mb-8">
                    <div className="w-8 h-8 rounded-full overflow-hidden">
                        <img src={logo} alt="TranspiraFund" className="w-full h-full object-cover scale-[1.55]" />
                    </div>
                    <span className="font-bold text-slate-800 text-base tracking-tight">TranspiraFund</span>
                </div>

                <div className="max-w-md w-full mx-auto">

                    <div className="mb-8 text-center">
                        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-teal-50 border border-teal-200/60 text-teal-700 text-xs font-semibold tracking-widest uppercase mb-4">
                            <Landmark size={12} />
                            Password Reset
                        </div>
                        <h2 className="text-2xl sm:text-3xl font-extrabold text-slate-800 mb-2 tracking-tight">Set New Password</h2>
                        {accountEmail && (
                            <p className="text-slate-400 text-sm">
                                Resetting for <span className="font-semibold text-slate-600">{accountEmail}</span>
                            </p>
                        )}
                    </div>

                    {error && (
                        <div className="mb-6 p-4 bg-red-50 border border-red-200/80 rounded-xl flex items-start gap-3 text-red-700" role="alert">
                            <AlertCircle size={18} className="shrink-0 mt-0.5" />
                            <span className="text-sm font-semibold">{error}</span>
                        </div>
                    )}

                    <form onSubmit={handleSubmit} className="space-y-5" noValidate>


                        <div className="space-y-1.5">
                            <label htmlFor="rp-new" className="text-xs font-bold text-slate-500 uppercase tracking-wide ml-1">
                                New Password
                            </label>
                            <div className="relative group">
                                <div className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-teal-700 transition-colors">
                                    <Lock size={18} />
                                </div>
                                <input
                                    id="rp-new"
                                    type={showNew ? 'text' : 'password'}
                                    value={formData.newPassword}
                                    onChange={(e) => setFormData({ ...formData, newPassword: e.target.value })}
                                    className="w-full pl-12 pr-12 py-3.5 bg-[#F8FAFC] border border-slate-200 rounded-xl focus:border-teal-600 focus:ring-4 focus:ring-teal-500/10 outline-none transition-all font-medium text-slate-800 text-[15px] placeholder:text-slate-400"
                                    placeholder="Min. 12 characters"
                                    autoComplete="new-password"
                                    disabled={isLoading}
                                />
                                <button type="button" onClick={() => setShowNew(!showNew)}
                                    className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors p-1"
                                    aria-label={showNew ? 'Hide' : 'Show'}>
                                    {showNew ? <EyeOff size={18} /> : <Eye size={18} />}
                                </button>
                            </div>


                            {formData.newPassword.length > 0 && (
                                <div className="mt-3 space-y-3">
                                    <div>
                                        <div className="flex justify-between items-center mb-1.5">
                                            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Password Strength</span>
                                            <span className={`text-[10px] font-extrabold uppercase tracking-wider ${strengthLevel.textColor}`}>
                                                {strengthLevel.label}
                                            </span>
                                        </div>
                                        <div className="flex gap-1">
                                            {PW_RULES.map((_, i) => (
                                                <div key={i} className={`h-1.5 flex-1 rounded-full transition-all duration-300 ${i < passedCount ? strengthLevel.barColor : 'bg-slate-200'}`} />
                                            ))}
                                        </div>
                                    </div>
                                    <div className="bg-slate-50 border border-slate-100 rounded-xl p-3.5 space-y-2">
                                        {PW_RULES.map((rule) => {
                                            const passed = rule.test(formData.newPassword);
                                            return (
                                                <div key={rule.id} className={`flex items-center gap-2.5 text-xs font-semibold transition-colors duration-200 ${passed ? 'text-teal-600' : 'text-slate-400'}`}>
                                                    {passed
                                                        ? <CheckCircle2 size={13} className="shrink-0 text-teal-500" />
                                                        : <XCircle size={13} className="shrink-0 text-slate-300" />
                                                    }
                                                    {rule.label}
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>
                            )}
                        </div>


                        <div className="space-y-1.5">
                            <label htmlFor="rp-confirm" className="text-xs font-bold text-slate-500 uppercase tracking-wide ml-1">
                                Confirm Password
                            </label>
                            <div className="relative group">
                                <div className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-teal-700 transition-colors">
                                    <Lock size={18} />
                                </div>
                                <input
                                    id="rp-confirm"
                                    type={showConfirm ? 'text' : 'password'}
                                    value={formData.confirmPassword}
                                    onChange={(e) => setFormData({ ...formData, confirmPassword: e.target.value })}
                                    className={`w-full pl-12 pr-12 py-3.5 bg-[#F8FAFC] border rounded-xl focus:border-teal-600 focus:ring-4 focus:ring-teal-500/10 outline-none transition-all font-medium text-slate-800 text-[15px] placeholder:text-slate-400 ${confirmBorder}`}
                                    placeholder="Repeat your new password"
                                    autoComplete="new-password"
                                    disabled={isLoading}
                                />
                                <button type="button" onClick={() => setShowConfirm(!showConfirm)}
                                    className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors p-1"
                                    aria-label={showConfirm ? 'Hide' : 'Show'}>
                                    {showConfirm ? <EyeOff size={18} /> : <Eye size={18} />}
                                </button>
                            </div>
                            {formData.confirmPassword.length > 0 && (
                                <p className={`text-xs font-semibold ml-1 mt-1 ${passwordsMatch ? 'text-teal-600' : 'text-red-500'}`}>
                                    {passwordsMatch ? '✓ Passwords match' : 'Passwords do not match'}
                                </p>
                            )}
                        </div>

                        <button
                            type="submit"
                            disabled={isLoading || !canSubmit}
                            className={`w-full font-bold py-4 rounded-xl shadow-md transition-all flex items-center justify-center gap-2 mt-2 text-[15px] text-white
                                ${isLoading
                                    ? 'bg-teal-500 cursor-wait'
                                    : canSubmit
                                        ? 'bg-teal-700 hover:bg-teal-800 hover:-translate-y-0.5 active:translate-y-0 shadow-teal-700/20 hover:shadow-lg cursor-pointer'
                                        : 'bg-teal-300 cursor-not-allowed shadow-none'
                                }`}
                        >
                            {isLoading
                                ? <><span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Resetting...</>
                                : 'Reset Password'
                            }
                        </button>
                    </form>

                    <div className="mt-10 text-center">
                        <p className="text-xs text-slate-400 font-semibold tracking-wide uppercase flex items-center justify-center gap-2">
                            <ShieldCheck size={13} className="text-teal-700" />
                            Secured by TranspiraFund
                        </p>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default ResetPassword;
