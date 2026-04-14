import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { ShieldCheck, Lock, Eye, EyeOff, AlertCircle, CheckCircle2, XCircle, Landmark } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import app from '../../config/firebase';
import logo from '../../assets/logo.png';

const PW_RULES = [
    { id: 'length',  label: 'At least 12 characters',                 test: (p) => p.length >= 12 },
    { id: 'upper',   label: 'At least one uppercase letter (A–Z)',     test: (p) => /[A-Z]/.test(p) },
    { id: 'lower',   label: 'At least one lowercase letter (a–z)',     test: (p) => /[a-z]/.test(p) },
    { id: 'number',  label: 'At least one number (0–9)',               test: (p) => /[0-9]/.test(p) },
    { id: 'special', label: 'At least one special character (!@#$…)',  test: (p) => /[^A-Za-z0-9]/.test(p) },
];

const STRENGTH_LEVELS = [
    { label: 'Too Weak',    barColor: 'bg-red-500',     textColor: 'text-red-500'     },
    { label: 'Weak',        barColor: 'bg-red-400',     textColor: 'text-red-400'     },
    { label: 'Fair',        barColor: 'bg-amber-500',   textColor: 'text-amber-500'   },
    { label: 'Good',        barColor: 'bg-yellow-500',  textColor: 'text-yellow-600'  },
    { label: 'Strong',      barColor: 'bg-teal-500',    textColor: 'text-teal-600'    },
    { label: 'Very Strong', barColor: 'bg-emerald-500', textColor: 'text-emerald-600' },
];

const LEFT_TIPS = [
    'Minimum 12 characters',
    'Mix of uppercase and lowercase letters',
    'Include numbers and special characters',
    'Never reuse a previous password',
];

const getRouteByRole = (role) => {
    switch (role?.toUpperCase()) {
        case 'MIS':   return '/admin/dashboard';
        case 'MAYOR': return '/mayor/dashboard';
        case 'HCSD':  return '/hcsd/dashboard';
        case 'DEPW':  return '/hcsd/dashboard'; // migration fallback — remove after all users migrated
        case 'CPDO':  return '/cpdo/dashboard';
        default:      return '/unauthorized';
    }
};

const ChangePassword = () => {
    const navigate = useNavigate();
    const { userRole, refreshUserData } = useAuth();

    const [formData, setFormData]     = useState({ newPassword: '', confirmPassword: '' });
    const [showNew, setShowNew]       = useState(false);
    const [showConfirm, setShowConfirm] = useState(false);
    const [isLoading, setIsLoading]   = useState(false);
    const [error, setError]           = useState('');

    const passedCount  = PW_RULES.filter(r => r.test(formData.newPassword)).length;
    const allPassed    = passedCount === PW_RULES.length;
    const passwordsMatch = formData.confirmPassword === formData.newPassword && formData.confirmPassword.length > 0;
    const canSubmit    = allPassed && passwordsMatch;
    const strengthLevel = STRENGTH_LEVELS[passedCount];

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (isLoading) return;
        if (!allPassed) {
            setError('Password does not meet all security requirements.');
            return;
        }
        if (!passwordsMatch) {
            setError('Passwords do not match.');
            return;
        }
        setIsLoading(true);
        setError('');
        try {
            const functions = getFunctions(app, 'asia-southeast1');
            const changePasswordFn = httpsCallable(functions, 'changePassword');
            await changePasswordFn({ newPassword: formData.newPassword });
            await refreshUserData();
            navigate(getRouteByRole(userRole), { replace: true });
        } catch (err) {
            setError(err.message || 'Unable to change password. Please try again.');
            setIsLoading(false);
        }
    };

    const confirmBorder = formData.confirmPassword.length === 0
        ? 'border-slate-200'
        : passwordsMatch
            ? 'border-teal-400'
            : 'border-red-300';

    return (
        <div className="min-h-screen flex font-sans text-slate-800 bg-[#F8FAFC]">

            <div className="hidden lg:flex w-1/2 bg-teal-700 relative flex-col items-center justify-center text-white p-12 overflow-hidden">
                <div className="absolute inset-0 opacity-[0.06]" aria-hidden="true">
                    <svg className="w-full h-full">
                        <defs>
                            <pattern id="cp-grid" width="40" height="40" patternUnits="userSpaceOnUse">
                                <path d="M 40 0 L 0 0 0 40" fill="none" stroke="white" strokeWidth="0.5" />
                            </pattern>
                        </defs>
                        <rect width="100%" height="100%" fill="url(#cp-grid)" />
                    </svg>
                </div>
                <div className="absolute top-0 right-0 w-80 h-80 bg-white/5 rounded-full blur-[100px]" aria-hidden="true" />
                <div className="absolute bottom-0 left-0 w-60 h-60 bg-teal-400/10 rounded-full blur-[80px]" aria-hidden="true" />

                <div className="relative z-10 flex flex-col items-center text-center max-w-md">
                    <div className="w-24 h-24 rounded-full overflow-hidden mb-8">
                        <img src={logo} alt="TranspiraFund seal" className="w-full h-full object-cover scale-[1.55]" />
                    </div>
                    <h1 className="text-4xl font-black mb-4 tracking-tight leading-tight">Set Your<br />Password</h1>
                    <p className="text-teal-100 text-[15px] leading-relaxed">
                        For security, you must set a strong, unique password before accessing the portal.
                    </p>

                    <div className="mt-8 space-y-3 text-left w-full max-w-xs">
                        {LEFT_TIPS.map(tip => (
                            <div key={tip} className="flex items-center gap-2.5 text-teal-100 text-sm">
                                <CheckCircle2 size={14} className="text-teal-300 shrink-0" />
                                {tip}
                            </div>
                        ))}
                    </div>

                    <div className="mt-10 flex items-center gap-2 bg-white/10 border border-white/15 rounded-full px-4 py-2">
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
                        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-amber-50 border border-amber-200/60 text-amber-700 text-xs font-semibold tracking-widest uppercase mb-4">
                            <Landmark size={12} />
                            Action Required
                        </div>
                        <h2 className="text-2xl sm:text-3xl font-extrabold text-slate-800 mb-2 tracking-tight">Change Your Password</h2>
                        <p className="text-slate-500 text-[15px]">Your account requires a secure password before proceeding.</p>
                    </div>

                    {error && (
                        <div className="mb-6 p-4 bg-red-50 border border-red-200/80 rounded-xl flex items-center gap-3 text-red-700" role="alert">
                            <AlertCircle size={18} className="shrink-0" />
                            <span className="text-sm font-semibold">{error}</span>
                        </div>
                    )}

                    <form onSubmit={handleSubmit} className="space-y-5" noValidate>

                        <div className="space-y-1.5">
                            <label htmlFor="new-password" className="text-xs font-bold text-slate-500 uppercase tracking-wide ml-1">
                                New Password
                            </label>
                            <div className="relative group">
                                <div className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-teal-700 transition-colors">
                                    <Lock size={18} />
                                </div>
                                <input
                                    id="new-password"
                                    type={showNew ? 'text' : 'password'}
                                    value={formData.newPassword}
                                    onChange={(e) => setFormData({ ...formData, newPassword: e.target.value })}
                                    className="w-full pl-12 pr-12 py-3.5 bg-[#F8FAFC] border border-slate-200 rounded-xl focus:border-teal-600 focus:ring-4 focus:ring-teal-500/10 outline-none transition-all font-medium text-slate-800 text-[15px] placeholder:text-slate-400"
                                    placeholder="Min. 12 characters"
                                    autoComplete="new-password"
                                    disabled={isLoading}
                                />
                                <button
                                    type="button"
                                    onClick={() => setShowNew(!showNew)}
                                    className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors p-1"
                                    aria-label={showNew ? 'Hide password' : 'Show password'}
                                >
                                    {showNew ? <EyeOff size={18} /> : <Eye size={18} />}
                                </button>
                            </div>

                            {formData.newPassword.length > 0 && (
                                <div className="mt-3 space-y-3">

                                    <div>
                                        <div className="flex justify-between items-center mb-1.5">
                                            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                                                Password Strength
                                            </span>
                                            <span className={`text-[10px] font-extrabold uppercase tracking-wider ${strengthLevel.textColor}`}>
                                                {strengthLevel.label}
                                            </span>
                                        </div>
                                        <div className="flex gap-1">
                                            {PW_RULES.map((_, i) => (
                                                <div
                                                    key={i}
                                                    className={`h-1.5 flex-1 rounded-full transition-all duration-300 ${i < passedCount ? strengthLevel.barColor : 'bg-slate-200'}`}
                                                />
                                            ))}
                                        </div>
                                    </div>

                                    <div className="bg-slate-50 border border-slate-100 rounded-xl p-3.5 space-y-2">
                                        {PW_RULES.map((rule) => {
                                            const passed = rule.test(formData.newPassword);
                                            return (
                                                <div
                                                    key={rule.id}
                                                    className={`flex items-center gap-2.5 text-xs font-semibold transition-colors duration-200 ${passed ? 'text-teal-600' : 'text-slate-400'}`}
                                                >
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
                            <label htmlFor="confirm-password" className="text-xs font-bold text-slate-500 uppercase tracking-wide ml-1">
                                Confirm Password
                            </label>
                            <div className="relative group">
                                <div className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-teal-700 transition-colors">
                                    <Lock size={18} />
                                </div>
                                <input
                                    id="confirm-password"
                                    type={showConfirm ? 'text' : 'password'}
                                    value={formData.confirmPassword}
                                    onChange={(e) => setFormData({ ...formData, confirmPassword: e.target.value })}
                                    className={`w-full pl-12 pr-12 py-3.5 bg-[#F8FAFC] border rounded-xl focus:border-teal-600 focus:ring-4 focus:ring-teal-500/10 outline-none transition-all font-medium text-slate-800 text-[15px] placeholder:text-slate-400 ${confirmBorder}`}
                                    placeholder="Repeat your new password"
                                    autoComplete="new-password"
                                    disabled={isLoading}
                                />
                                <button
                                    type="button"
                                    onClick={() => setShowConfirm(!showConfirm)}
                                    className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors p-1"
                                    aria-label={showConfirm ? 'Hide password' : 'Show password'}
                                >
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
                                        ? 'bg-teal-700 hover:bg-teal-800 hover:-translate-y-0.5 active:translate-y-0 shadow-teal-700/20 hover:shadow-lg hover:shadow-teal-700/20 cursor-pointer'
                                        : 'bg-teal-300 cursor-not-allowed shadow-none'
                                }`}
                        >
                            {isLoading
                                ? <><span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Saving...</>
                                : 'Set New Password'
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

export default ChangePassword;