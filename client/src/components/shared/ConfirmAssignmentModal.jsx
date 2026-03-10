import { memo } from 'react';
import { X, AlertCircle, Send, Mail, ArrowLeft } from 'lucide-react';

const ConfirmAssignmentModal = memo(({
    isOpen, data, onConfirm, onCancel, isProcessing, error,
    title = 'Confirm Assignment',
    confirmLabel = 'Provision Account'
}) => {
    if (!isOpen || !data) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/70 backdrop-blur-md animate-in fade-in duration-200 p-4">
            <div className="relative bg-white dark:bg-slate-900 rounded-[28px] shadow-2xl w-full max-w-lg animate-in zoom-in-95 duration-200 overflow-hidden border border-slate-200/80 dark:border-white/5">

                {/* Gradient header */}
                <div className="relative bg-gradient-to-br from-teal-600 via-teal-500 to-emerald-500 px-7 pt-7 pb-12 overflow-hidden">
                    <div className="absolute -top-8 -right-8 w-44 h-44 rounded-full bg-white/10 pointer-events-none" />
                    <div className="absolute -bottom-4 left-8 w-20 h-20 rounded-full bg-white/10 pointer-events-none" />

                    <button
                        onClick={onCancel}
                        disabled={isProcessing}
                        className="absolute top-4 right-4 z-30 w-9 h-9 rounded-full bg-white/20 hover:bg-white/35 active:bg-white/50 flex items-center justify-center text-white transition-all disabled:opacity-50"
                        aria-label="Close"
                    >
                        <X size={18} strokeWidth={2.5} />
                    </button>

                    <div className="relative pr-10">
                        <div className="flex items-center gap-1.5 bg-white/15 border border-white/20 rounded-full px-3 py-1.5 mb-3 w-fit">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-300 animate-pulse" />
                            <span className="text-white/80 text-[10px] font-bold uppercase tracking-wide">Review & Confirm</span>
                        </div>
                        <h3 className="text-2xl font-extrabold text-white tracking-tight">{title}</h3>
                        <p className="text-white/70 text-sm font-medium mt-1">Verify the details before provisioning this account.</p>
                    </div>
                </div>

                {/* Account preview card — overlaps the header */}
                <div className="px-7 -mt-7 relative z-10 mb-5">
                    <div className="bg-white dark:bg-slate-800 border border-slate-100 dark:border-slate-700/50 rounded-2xl p-4 shadow-xl flex items-center gap-4">
                        <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-teal-500 to-emerald-400 flex items-center justify-center font-extrabold text-white text-xl shrink-0 shadow-lg shadow-teal-500/25">
                            {data.initial}
                        </div>
                        <div className="min-w-0 flex-1">
                            <p className="font-extrabold text-base text-slate-800 dark:text-slate-100 truncate">{data.name}</p>
                            <div className="flex items-center gap-1.5 mt-0.5">
                                <Mail size={11} className="text-slate-400 shrink-0" />
                                <p className="text-sm text-teal-600 dark:text-teal-400 font-semibold truncate">{data.email}</p>
                            </div>
                        </div>
                        <div className="shrink-0 px-2.5 py-1 rounded-xl bg-gradient-to-br from-teal-500 to-emerald-400 text-white text-[10px] font-bold uppercase tracking-wide shadow-sm">
                            {data.roleType}
                        </div>
                    </div>
                </div>

                {/* Info grid */}
                <div className="px-7 mb-5 space-y-3">
                    <div className="grid grid-cols-2 gap-3">
                        <div className="bg-slate-50 dark:bg-slate-800/60 border border-slate-100 dark:border-slate-700/50 rounded-xl px-4 py-3.5">
                            <p className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-1">Department</p>
                            <p className="text-sm font-bold text-slate-700 dark:text-slate-200 truncate">{data.department}</p>
                        </div>
                        <div className="bg-slate-50 dark:bg-slate-800/60 border border-slate-100 dark:border-slate-700/50 rounded-xl px-4 py-3.5">
                            <p className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-1">Assigned Role</p>
                            <p className="text-sm font-bold text-slate-700 dark:text-slate-200 truncate">{data.roleLabel}</p>
                        </div>
                    </div>

                    <div className="flex items-start gap-3 bg-teal-50/70 dark:bg-teal-900/15 border border-teal-200/70 dark:border-teal-500/20 rounded-xl px-4 py-3.5">
                        <Send size={14} className="text-teal-600 dark:text-teal-400 shrink-0 mt-0.5" />
                        <p className="text-xs text-teal-700 dark:text-teal-300 font-medium leading-relaxed">
                            A temporary password will be auto-generated and emailed to{' '}
                            <span className="font-bold">{data.email}</span>. The official must change it on first login.
                        </p>
                    </div>
                </div>

                {/* Error */}
                {error && (
                    <div className="px-7 mb-4">
                        <div className="bg-red-50 dark:bg-red-900/20 border border-red-100 dark:border-red-500/20 rounded-xl p-4 flex gap-3">
                            <AlertCircle className="text-red-500 shrink-0 mt-0.5" size={16} />
                            <p className="text-red-600 dark:text-red-400 text-sm font-medium">{error}</p>
                        </div>
                    </div>
                )}

                {/* Buttons */}
                <div className="px-7 pb-7 flex gap-3">
                    <button
                        onClick={onCancel}
                        disabled={isProcessing}
                        className="flex-1 py-3.5 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 font-bold rounded-xl transition-all flex items-center justify-center gap-2 disabled:opacity-50 text-sm"
                    >
                        <ArrowLeft size={15} />
                        Back & Edit
                    </button>
                    <button
                        onClick={onConfirm}
                        disabled={isProcessing}
                        className="flex-1 py-3.5 bg-gradient-to-r from-teal-600 to-emerald-500 hover:from-teal-700 hover:to-emerald-600 text-white font-bold rounded-xl shadow-lg shadow-teal-500/25 transition-all flex items-center justify-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed text-sm"
                    >
                        {isProcessing ? (
                            <>
                                <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                                Processing...
                            </>
                        ) : (
                            <>
                                <Send size={15} />
                                {confirmLabel}
                            </>
                        )}
                    </button>
                </div>

            </div>
        </div>
    );
});

export default ConfirmAssignmentModal;
