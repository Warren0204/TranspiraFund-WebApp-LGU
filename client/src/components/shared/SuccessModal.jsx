import { memo } from 'react';
import { CheckCircle2, Mail, KeyRound, ShieldCheck } from 'lucide-react';

const SuccessModal = memo(({ isOpen, onClose, email }) => {
    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/70 backdrop-blur-md animate-in fade-in duration-200 p-4">
            <div className="relative bg-white dark:bg-slate-900 rounded-[28px] shadow-2xl w-full max-w-sm animate-in zoom-in-95 duration-200 overflow-hidden border border-slate-200/80 dark:border-white/5">

                <div className="relative bg-gradient-to-br from-emerald-500 to-teal-500 px-7 pt-8 pb-14 overflow-hidden text-center">
                    <div className="absolute -top-6 -right-6 w-36 h-36 rounded-full bg-white/10 pointer-events-none" />
                    <div className="absolute -bottom-4 -left-6 w-28 h-28 rounded-full bg-white/10 pointer-events-none" />

                    <div className="relative inline-flex items-center justify-center mb-5">
                        <span className="absolute w-20 h-20 rounded-full bg-white/20 animate-ping" style={{ animationDuration: '2.2s' }} />
                        <span className="absolute w-16 h-16 rounded-full bg-white/15" />
                        <div className="relative w-[68px] h-[68px] rounded-full bg-white/25 backdrop-blur-sm flex items-center justify-center shadow-2xl">
                            <CheckCircle2 size={36} className="text-white" strokeWidth={2} />
                        </div>
                    </div>

                    <h3 className="text-2xl font-extrabold text-white tracking-tight">Account Provisioned</h3>
                    <p className="text-white/70 text-sm font-medium mt-1.5">Credentials sent to the registered email.</p>
                </div>

                <div className="px-7 -mt-7 relative z-10 mb-5">
                    <div className="bg-white dark:bg-slate-800 border border-slate-100 dark:border-slate-700/50 rounded-2xl p-4 shadow-xl flex items-center gap-3.5">
                        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-400 flex items-center justify-center shrink-0 shadow-md shadow-emerald-500/25">
                            <Mail size={17} className="text-white" />
                        </div>
                        <div className="min-w-0">
                            <p className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-0.5">Sent to</p>
                            <p className="text-sm font-bold text-teal-600 dark:text-teal-400 truncate">{email}</p>
                        </div>
                    </div>
                </div>

                <div className="px-7 mb-6 space-y-2.5">
                    <div className="flex items-center gap-2.5 text-xs text-slate-500 dark:text-slate-400">
                        <KeyRound size={13} className="shrink-0" />
                        Password change required on first login.
                    </div>
                    <div className="flex items-center gap-2.5 text-xs text-slate-500 dark:text-slate-400">
                        <ShieldCheck size={13} className="shrink-0" />
                        Account is active and logged in audit trails.
                    </div>
                </div>

                <div className="px-7 pb-7">
                    <button
                        onClick={onClose}
                        className="w-full bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-600 hover:to-teal-600 text-white font-bold py-3.5 rounded-xl shadow-lg shadow-emerald-500/25 transition-all duration-200 text-sm tracking-wide"
                    >
                        Done
                    </button>
                </div>

            </div>
        </div>
    );
});

export default SuccessModal;
