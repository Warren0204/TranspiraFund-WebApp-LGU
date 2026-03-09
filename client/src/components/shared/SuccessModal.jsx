import { memo } from 'react';
import { CheckCircle2, Mail, KeyRound, ShieldCheck } from 'lucide-react';

const NEXT_STEPS = [
    {
        icon: Mail,
        label: 'Credentials dispatched',
        desc: "A temporary password was sent to the official's registered inbox.",
    },
    {
        icon: KeyRound,
        label: 'Password change required',
        desc: 'The official must set a new password on their very first login.',
    },
    {
        icon: ShieldCheck,
        label: 'Account is now live',
        desc: 'Access is active and the event is logged in the system audit trail.',
    },
];

const SuccessModal = memo(({ isOpen, onClose, email }) => {
    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/70 backdrop-blur-md animate-in fade-in duration-200 p-4">
            <div className="relative bg-white dark:bg-slate-900 rounded-[28px] shadow-2xl w-full max-w-md animate-in zoom-in-95 duration-200 overflow-hidden border border-slate-200/80 dark:border-white/5">

                {/* ── Gradient Header ── */}
                <div className="relative bg-gradient-to-br from-emerald-500 to-teal-500 px-7 pt-8 pb-14 overflow-hidden text-center">
                    <div className="absolute -top-6 -right-6 w-36 h-36 rounded-full bg-white/10 pointer-events-none" />
                    <div className="absolute -bottom-4 -left-6 w-28 h-28 rounded-full bg-white/10 pointer-events-none" />

                    {/* Pulsing success badge */}
                    <div className="relative inline-flex items-center justify-center mb-5">
                        <span className="absolute w-20 h-20 rounded-full bg-white/20 animate-ping" style={{ animationDuration: '2.2s' }} />
                        <span className="absolute w-16 h-16 rounded-full bg-white/15" />
                        <div className="relative w-[68px] h-[68px] rounded-full bg-white/25 backdrop-blur-sm flex items-center justify-center shadow-2xl">
                            <CheckCircle2 size={36} className="text-white" strokeWidth={2} />
                        </div>
                    </div>

                    <h3 className="text-2xl font-extrabold text-white tracking-tight leading-tight">
                        Account Provisioned
                    </h3>
                    <p className="text-white/70 text-sm font-medium mt-1.5 max-w-[220px] mx-auto leading-relaxed">
                        Official access has been granted and credentials are on their way.
                    </p>
                </div>

                {/* ── Email pill (overlapping header) ── */}
                <div className="px-7 -mt-7 relative z-10 mb-5">
                    <div className="bg-white dark:bg-slate-800 border border-slate-100 dark:border-slate-700/50 rounded-2xl p-4 shadow-xl flex items-center gap-3.5">
                        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-400 flex items-center justify-center shrink-0 shadow-md shadow-emerald-500/25">
                            <Mail size={17} className="text-white" />
                        </div>
                        <div className="min-w-0">
                            <p className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-0.5">
                                Sent to
                            </p>
                            <p className="text-sm font-bold text-teal-600 dark:text-teal-400 truncate">{email}</p>
                        </div>
                    </div>
                </div>

                {/* ── What Happens Next ── */}
                <div className="px-7 mb-6">
                    <p className="text-[10px] font-extrabold uppercase tracking-[0.18em] text-slate-400 dark:text-slate-500 mb-3">
                        What Happens Next
                    </p>
                    <div className="space-y-2.5">
                        {NEXT_STEPS.map(({ icon: Icon, label, desc }) => (
                            <div
                                key={label}
                                className="flex items-start gap-3.5 bg-slate-50 dark:bg-slate-800/60 border border-slate-100 dark:border-slate-700/50 rounded-xl px-4 py-3.5"
                            >
                                <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-emerald-500 to-teal-400 flex items-center justify-center shrink-0 mt-0.5 shadow-sm shadow-emerald-500/20">
                                    <Icon size={13} className="text-white" />
                                </div>
                                <div>
                                    <p className="text-xs font-bold text-slate-700 dark:text-slate-200">{label}</p>
                                    <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed mt-0.5">{desc}</p>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>

                {/* ── CTA ── */}
                <div className="px-7 pb-7">
                    <button
                        onClick={onClose}
                        className="w-full bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-600 hover:to-teal-600 text-white font-bold py-3.5 rounded-xl shadow-lg shadow-emerald-500/25 transition-all duration-200 text-sm tracking-wide"
                    >
                        All Done
                    </button>
                </div>

            </div>
        </div>
    );
});

export default SuccessModal;
