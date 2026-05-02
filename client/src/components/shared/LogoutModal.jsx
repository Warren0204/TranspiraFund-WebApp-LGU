import React, { memo } from 'react';
import { LogOut, ShieldOff } from 'lucide-react';

const LogoutModal = memo(({ isOpen, onConfirm, onCancel, isProcessing }) => {
    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/70 backdrop-blur-md animate-in fade-in duration-200 p-4">
            <div className="bg-white/95 dark:bg-slate-900/95 backdrop-blur-xl border border-white/80 dark:border-white/10 rounded-[28px] shadow-2xl w-full max-w-sm animate-in zoom-in-95 duration-200 flex flex-col items-center text-center p-8">

                <div className="relative mb-5">
                    <div className="w-16 h-16 rounded-full bg-gradient-to-br from-slate-700 to-slate-900 dark:from-slate-700 dark:to-slate-800 flex items-center justify-center shadow-xl shadow-slate-900/30">
                        <ShieldOff size={28} className="text-white" />
                    </div>
                    <div className="absolute inset-0 rounded-full bg-slate-800/20 blur-xl scale-150 -z-10" />
                </div>

                <h3 className="text-xl font-extrabold text-slate-900 dark:text-white tracking-tight mb-2">
                    End Session?
                </h3>
                <p className="text-slate-500 dark:text-slate-400 text-sm font-medium mb-8 leading-relaxed max-w-[260px]">
                    You will be securely signed out of the&nbsp;
                    <span className="font-bold text-slate-700 dark:text-slate-300">Local Government</span> system.
                </p>

                <div className="flex gap-3 w-full">
                    <button
                        onClick={onCancel}
                        disabled={isProcessing}
                        className="flex-1 py-3 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 font-bold rounded-xl transition-all duration-200 disabled:opacity-50"
                    >
                        Stay
                    </button>
                    <button
                        onClick={onConfirm}
                        disabled={isProcessing}
                        className="flex-1 py-3 bg-gradient-to-r from-slate-800 to-slate-700 dark:from-slate-700 dark:to-slate-600 hover:from-slate-900 hover:to-slate-800 text-white font-bold rounded-xl shadow-lg transition-all duration-200 flex items-center justify-center gap-2 disabled:opacity-70 disabled:cursor-not-allowed"
                    >
                        {isProcessing ? (
                            <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                        ) : (
                            <>
                                <LogOut size={16} />
                                Sign Out
                            </>
                        )}
                    </button>
                </div>
            </div>
        </div>
    );
});

export default LogoutModal;
