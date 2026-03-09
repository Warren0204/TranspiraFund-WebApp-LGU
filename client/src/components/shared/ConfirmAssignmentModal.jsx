import { memo } from 'react';
import { X, AlertCircle, Send, User, Mail, Briefcase } from 'lucide-react';

const ConfirmAssignmentModal = memo(({
    isOpen, data, onConfirm, onCancel, isProcessing, error,
    title = 'Confirm Assignment',
    confirmLabel = 'Generate & Send Credentials'
}) => {
    if (!isOpen || !data) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/70 backdrop-blur-md animate-in fade-in duration-200 p-4">
            <div className="bg-white/95 dark:bg-slate-900/95 backdrop-blur-xl border border-white/80 dark:border-white/10 rounded-[28px] shadow-2xl w-full max-w-lg animate-in zoom-in-95 duration-200 overflow-hidden">

                {/* Header */}
                <div className="px-7 py-5 border-b border-slate-100 dark:border-slate-800 flex justify-between items-center bg-slate-50/50 dark:bg-slate-800/30">
                    <h3 className="font-extrabold text-slate-900 dark:text-white text-lg tracking-tight">{title}</h3>
                    <button
                        onClick={onCancel}
                        disabled={isProcessing}
                        className="p-2 rounded-xl text-slate-400 dark:text-slate-500 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-all duration-200 disabled:opacity-50"
                    >
                        <X size={18} />
                    </button>
                </div>

                {/* Body */}
                <div className="p-7">
                    {/* Account preview */}
                    <div className="bg-slate-50/80 dark:bg-slate-800/50 border border-slate-100 dark:border-slate-700/60 rounded-2xl p-5 mb-6 space-y-4">
                        <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500 to-cyan-500 flex items-center justify-center shrink-0">
                                <Briefcase size={15} className="text-white" />
                            </div>
                            <div>
                                <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400 dark:text-slate-500">Role</p>
                                <p className="text-sm font-bold text-slate-800 dark:text-slate-200">{data.roleLabel}</p>
                            </div>
                        </div>
                        <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-500 to-purple-500 flex items-center justify-center shrink-0">
                                <User size={15} className="text-white" />
                            </div>
                            <div>
                                <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400 dark:text-slate-500">Full Name</p>
                                <p className="text-sm font-bold text-slate-800 dark:text-slate-200">{data.name}</p>
                            </div>
                        </div>
                        <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-emerald-500 to-teal-500 flex items-center justify-center shrink-0">
                                <Mail size={15} className="text-white" />
                            </div>
                            <div>
                                <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400 dark:text-slate-500">Email</p>
                                <p className="text-sm font-bold text-blue-600 dark:text-cyan-400">{data.email}</p>
                            </div>
                        </div>
                    </div>

                    {/* Error */}
                    {error && (
                        <div className="mb-5 bg-red-50 dark:bg-red-900/20 border border-red-100 dark:border-red-500/20 rounded-xl p-4 flex gap-3">
                            <AlertCircle className="text-red-500 shrink-0 mt-0.5" size={18} />
                            <p className="text-red-600 dark:text-red-400 text-sm font-medium">{error}</p>
                        </div>
                    )}

                    {/* Confirm button */}
                    <button
                        onClick={onConfirm}
                        disabled={isProcessing}
                        className="w-full bg-gradient-to-r from-blue-600 to-cyan-500 hover:from-blue-700 hover:to-cyan-600 text-white font-bold py-4 rounded-xl shadow-lg shadow-blue-500/25 transition-all duration-200 flex items-center justify-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed text-sm"
                    >
                        {isProcessing ? (
                            <>
                                <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                                Processing...
                            </>
                        ) : (
                            <>
                                <Send size={16} />
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
