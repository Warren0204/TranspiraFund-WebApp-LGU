import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { Mail, ShieldCheck, ArrowLeft, AlertCircle, Key } from 'lucide-react';
import app from '../../config/firebase';
import logo from '../../assets/logo.png';

const ForgotPassword = () => {
    const navigate = useNavigate();
    const [email, setEmail] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [isSent, setIsSent] = useState(false);
    const [error, setError] = useState('');

    const isValidEmail = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim());

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (isLoading || !isValidEmail) return;
        setIsLoading(true);
        setError('');
        try {
            const fn = httpsCallable(getFunctions(app, 'asia-southeast1'), 'sendPasswordReset');
            await fn({ email: email.trim() });
            setIsSent(true);
        } catch (err) {
            const msg = err?.message || '';
            setError(msg.toLowerCase().includes('wait') ? msg : 'Unable to send reset link. Please try again.');
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="min-h-screen flex font-sans text-slate-800 bg-[#F8FAFC]">


            <div className="hidden lg:flex w-1/2 bg-teal-700 relative flex-col items-center justify-center text-white p-12 overflow-hidden">
                <div className="absolute inset-0 opacity-[0.06]" aria-hidden="true">
                    <svg className="w-full h-full">
                        <defs>
                            <pattern id="fp-grid" width="40" height="40" patternUnits="userSpaceOnUse">
                                <path d="M 40 0 L 0 0 0 40" fill="none" stroke="white" strokeWidth="0.5" />
                            </pattern>
                        </defs>
                        <rect width="100%" height="100%" fill="url(#fp-grid)" />
                    </svg>
                </div>
                <div className="absolute top-0 right-0 w-80 h-80 bg-white/5 rounded-full blur-[100px]" aria-hidden="true" />
                <div className="absolute bottom-0 left-0 w-60 h-60 bg-teal-400/10 rounded-full blur-[80px]" aria-hidden="true" />

                <div className="relative z-10 flex flex-col items-center text-center max-w-md">
                    <div className="w-24 h-24 rounded-full overflow-hidden mb-8">
                        <img src={logo} alt="TranspiraFund seal" className="w-full h-full object-cover scale-[1.55]" />
                    </div>
                    <h1 className="text-4xl font-black mb-4 tracking-tight leading-tight">Account<br />Recovery</h1>
                    <p className="text-teal-100 text-[15px] leading-relaxed">
                        Enter your registered official email and we'll send you a secure, one-time password reset link.
                    </p>
                    <div className="mt-8 flex items-center gap-3 flex-wrap justify-center">
                        {['Secure Link', 'One-Time Use', '24hr Expiry'].map(tag => (
                            <span key={tag} className="px-3 py-1 bg-white/10 border border-white/10 rounded-lg text-xs font-semibold tracking-wide uppercase">
                                {tag}
                            </span>
                        ))}
                    </div>
                </div>
            </div>


            <div className="w-full lg:w-1/2 bg-white flex flex-col justify-center px-6 sm:px-12 md:px-24 relative">

                <button
                    onClick={() => navigate('/login')}
                    className="absolute top-6 left-6 sm:top-8 sm:left-8 flex items-center gap-2 text-slate-400 hover:text-teal-700 transition-colors font-semibold text-sm group"
                    aria-label="Back to login"
                >
                    <ArrowLeft size={18} className="group-hover:-translate-x-1 transition-transform" />
                    Back to Login
                </button>


                <div className="flex lg:hidden items-center justify-center gap-2.5 mb-8">
                    <div className="w-8 h-8 rounded-full overflow-hidden">
                        <img src={logo} alt="TranspiraFund" className="w-full h-full object-cover scale-[1.55]" />
                    </div>
                    <span className="font-bold text-slate-800 text-base tracking-tight">TranspiraFund</span>
                </div>

                <div className="max-w-md w-full mx-auto">

                    {!isSent ? (

                        <>
                            <div className="mb-8 text-center">
                                <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-teal-50 border border-teal-200/60 text-teal-700 text-xs font-semibold tracking-widest uppercase mb-4">
                                    <Key size={12} />
                                    Password Recovery
                                </div>
                                <h2 className="text-2xl sm:text-3xl font-extrabold text-slate-800 mb-2 tracking-tight">Forgot Password?</h2>
                                <p className="text-slate-500 text-[15px]">Enter your official email to receive a secure reset link.</p>
                            </div>

                            {error && (
                                <div className="mb-6 p-4 bg-red-50 border border-red-200/80 rounded-xl flex items-center gap-3 text-red-700" role="alert">
                                    <AlertCircle size={18} className="shrink-0" />
                                    <span className="text-sm font-semibold">{error}</span>
                                </div>
                            )}

                            <form onSubmit={handleSubmit} className="space-y-5" noValidate>
                                <div className="space-y-1.5">
                                    <label htmlFor="fp-email" className="text-xs font-bold text-slate-500 uppercase tracking-wide ml-1">
                                        Official Email
                                    </label>
                                    <div className="relative group">
                                        <div className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-teal-700 transition-colors">
                                            <Mail size={18} />
                                        </div>
                                        <input
                                            id="fp-email"
                                            type="email"
                                            value={email}
                                            onChange={(e) => setEmail(e.target.value)}
                                            className="w-full pl-12 pr-4 py-3.5 bg-[#F8FAFC] border border-slate-200 rounded-xl focus:border-teal-600 focus:ring-4 focus:ring-teal-500/10 outline-none transition-all font-medium text-slate-800 text-[15px] placeholder:text-slate-400"
                                            placeholder="name@lgu.gov.ph"
                                            autoComplete="email"
                                            disabled={isLoading}
                                        />
                                    </div>
                                </div>

                                <button
                                    type="submit"
                                    disabled={isLoading || !isValidEmail}
                                    className={`w-full font-bold py-4 rounded-xl shadow-md transition-all flex items-center justify-center gap-2 mt-2 text-[15px] text-white
                                        ${isLoading
                                            ? 'bg-teal-500 cursor-wait'
                                            : isValidEmail
                                                ? 'bg-teal-700 hover:bg-teal-800 hover:-translate-y-0.5 active:translate-y-0 shadow-teal-700/20 hover:shadow-lg hover:shadow-teal-700/20 cursor-pointer'
                                                : 'bg-teal-300 cursor-not-allowed shadow-none'
                                        }`}
                                >
                                    {isLoading
                                        ? <><span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Sending...</>
                                        : 'Send Reset Link'
                                    }
                                </button>
                            </form>
                        </>
                    ) : (

                        <div className="text-center">
                            <div className="relative inline-flex items-center justify-center mb-7">
                                <span className="absolute w-24 h-24 rounded-full bg-teal-500/10 animate-ping" style={{ animationDuration: '2.5s' }} />
                                <div className="relative w-20 h-20 rounded-full bg-gradient-to-br from-teal-500 to-emerald-400 flex items-center justify-center shadow-xl shadow-teal-500/25">
                                    <Mail size={36} className="text-white" strokeWidth={1.5} />
                                </div>
                            </div>

                            <h2 className="text-2xl sm:text-3xl font-extrabold text-slate-800 mb-3 tracking-tight">Check Your Inbox</h2>
                            <p className="text-slate-500 text-[15px] leading-relaxed mb-1">
                                If <span className="font-bold text-slate-700">{email}</span> is registered,
                            </p>
                            <p className="text-slate-400 text-sm mb-8">a reset link has been sent. The link expires in 24 hours.</p>

                            <div className="bg-slate-50 border border-slate-100 rounded-2xl p-5 mb-8 text-left space-y-3.5">
                                {[
                                    { step: '1', text: 'Open the email from TranspiraFund LGU Portal' },
                                    { step: '2', text: 'Click "Reset My Password" in the email' },
                                    { step: '3', text: 'Set your new secure password on the next page' },
                                ].map(({ step, text }) => (
                                    <div key={step} className="flex items-start gap-3">
                                        <span className="w-6 h-6 rounded-full bg-gradient-to-br from-teal-500 to-emerald-400 flex items-center justify-center text-white text-[11px] font-extrabold shrink-0 mt-0.5 shadow-sm">
                                            {step}
                                        </span>
                                        <p className="text-sm text-slate-600 font-medium leading-relaxed">{text}</p>
                                    </div>
                                ))}
                            </div>

                            <button
                                onClick={() => navigate('/login')}
                                className="w-full font-bold py-4 rounded-xl bg-teal-700 hover:bg-teal-800 text-white shadow-md shadow-teal-700/20 transition-all text-[15px]"
                            >
                                Back to Login
                            </button>
                        </div>
                    )}

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

export default ForgotPassword;
