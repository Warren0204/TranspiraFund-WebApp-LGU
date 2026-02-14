import React, { memo } from 'react';
import { LogOut } from 'lucide-react';

const LogoutModal = memo(({ isOpen, onConfirm, onCancel, isProcessing }) => {
    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="bg-white p-8 rounded-[24px] shadow-2xl w-full max-w-sm transform transition-all scale-100 animate-in zoom-in-95 duration-200 flex flex-col items-center text-center">
                <div className="w-12 h-12 rounded-full bg-slate-100 text-slate-500 flex items-center justify-center mb-4">
                    <LogOut size={24} className="ml-1" />
                </div>
                <h3 className="text-lg font-bold text-slate-900 mb-2">End Session?</h3>
                <p className="text-slate-500 text-sm mb-8 leading-relaxed">
                    You are about to securely sign out of the <span className="font-semibold text-slate-700">Local Government</span> system.
                </p>

                <div className="flex items-center gap-3 w-full justify-center">
                    <button
                        onClick={onCancel}
                        disabled={isProcessing}
                        className="text-slate-500 hover:text-slate-800 font-semibold text-sm px-4 py-2 transition-colors disabled:opacity-50"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={onConfirm}
                        disabled={isProcessing}
                        className="bg-blue-600 hover:bg-blue-700 text-white font-bold text-sm px-6 py-2.5 rounded-xl shadow-lg shadow-blue-600/20 transition-all flex items-center justify-center min-w-[100px] disabled:opacity-70 disabled:cursor-not-allowed"
                    >
                        {isProcessing ? (
                            <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></span>
                        ) : 'Sign Out'}
                    </button>
                </div>
            </div>
        </div>
    );
});

export default LogoutModal;
