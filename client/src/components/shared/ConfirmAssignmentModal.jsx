import React, { memo } from 'react';
import { X, AlertCircle } from 'lucide-react';

/**
 * Reusable Confirm Assignment Modal
 * Shows account details and a "Generate & Send Credentials" button.
 *
 * @param {boolean} isOpen
 * @param {object}  data          - { name, email, roleLabel }
 * @param {function} onConfirm
 * @param {function} onCancel
 * @param {boolean} isProcessing
 * @param {string}  error
 * @param {string}  title         - Modal header (default: "Confirm Assignment")
 * @param {string}  confirmLabel  - Button text (default: "Generate & Send Credentials")
 */
const ConfirmAssignmentModal = memo(({ isOpen, data, onConfirm, onCancel, isProcessing, error, title = 'Confirm Assignment', confirmLabel = 'Generate & Send Credentials' }) => {
    if (!isOpen || !data) return null;
    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="bg-white rounded-[24px] shadow-2xl w-full max-w-lg transform transition-all animate-in zoom-in-95 duration-200 overflow-hidden">
                <div className="px-8 py-6 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
                    <h3 className="font-bold text-slate-900 text-lg">{title}</h3>
                    <button onClick={onCancel} disabled={isProcessing}><X size={20} className="text-slate-400 hover:text-slate-600" /></button>
                </div>
                <div className="p-8">
                    <div className="bg-slate-50 border border-slate-100 rounded-2xl p-6 space-y-3 mb-8">
                        <div className="flex gap-2 text-sm"><span className="font-bold text-slate-900 w-24">Role:</span><span className="text-slate-600 font-medium">{data.roleLabel}</span></div>
                        <div className="flex gap-2 text-sm"><span className="font-bold text-slate-900 w-24">Name:</span><span className="text-slate-600 font-medium">{data.name}</span></div>
                        <div className="flex gap-2 text-sm"><span className="font-bold text-slate-900 w-24">Email:</span><span className="text-blue-600 font-medium">{data.email}</span></div>
                    </div>
                    {error && (
                        <div className="mb-6 bg-red-50 border border-red-100 rounded-xl p-4 flex gap-3"><AlertCircle className="text-red-500 shrink-0" size={20} /><p className="text-red-600 text-sm">{error}</p></div>
                    )}
                    <button onClick={onConfirm} disabled={isProcessing} className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-4 rounded-xl shadow-lg transition-all flex justify-center gap-2">
                        {isProcessing ? 'Processing...' : confirmLabel}
                    </button>
                </div>
            </div>
        </div>
    );
});

export default ConfirmAssignmentModal;
