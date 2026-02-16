import React, { memo } from 'react';
import { Send } from 'lucide-react';

/**
 * Reusable Success Modal
 * Shows a success confirmation after credentials are sent.
 *
 * @param {boolean}  isOpen
 * @param {function} onClose
 * @param {string}   email  - The email credentials were sent to
 */
const SuccessModal = memo(({ isOpen, onClose, email }) => {
    if (!isOpen) return null;
    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="bg-white p-10 rounded-[32px] shadow-2xl w-full max-w-sm transform transition-all animate-in zoom-in-95 duration-200 flex flex-col items-center text-center">
                <div className="w-16 h-16 rounded-full bg-green-50 text-green-500 flex items-center justify-center mb-6 ring-8 ring-green-50/50"><Send size={32} /></div>
                <h3 className="text-2xl font-bold text-slate-900 mb-2">Sent!</h3>
                <p className="text-slate-500 font-medium text-sm mb-8">Credentials emailed to <span className="text-slate-700 font-semibold block mt-1">{email}</span></p>
                <button onClick={onClose} className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-3.5 rounded-xl shadow-lg transition-all">Done</button>
            </div>
        </div>
    );
});

export default SuccessModal;
