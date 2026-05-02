import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { X, FileText, Download, AlertCircle } from 'lucide-react';

const detectKind = (fileName) => {
    const ext = (fileName || '').split('.').pop()?.toLowerCase();
    if (['jpg', 'jpeg', 'png'].includes(ext)) return 'image';
    if (ext === 'pdf') return 'pdf';
    return 'other';
};

const NtpViewerModal = memo(({ isOpen, fileUrl, fileName, onClose }) => {
    const kind = useMemo(() => detectKind(fileName), [fileName]);
    const [downloading, setDownloading] = useState(false);

    useEffect(() => {
        if (!isOpen) return;
        const onKey = (e) => { if (e.key === 'Escape') onClose(); };
        window.addEventListener('keydown', onKey);
        const prevOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        return () => {
            window.removeEventListener('keydown', onKey);
            document.body.style.overflow = prevOverflow;
        };
    }, [isOpen, onClose]);

    const handleDownload = useCallback(async () => {
        if (!fileUrl || downloading) return;
        setDownloading(true);
        let objUrl = null;
        try {
            const res = await fetch(fileUrl);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const blob = await res.blob();
            objUrl = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = objUrl;
            a.download = fileName || 'ntp-document';
            document.body.appendChild(a);
            a.click();
            a.remove();
        } catch (err) {
            console.error('[NtpViewerModal] download failed, opening in new tab as fallback:', err);
            window.open(fileUrl, '_blank', 'noopener,noreferrer');
        } finally {
            if (objUrl) URL.revokeObjectURL(objUrl);
            setDownloading(false);
        }
    }, [fileUrl, fileName, downloading]);

    if (!isOpen || !fileUrl) return null;

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/70 backdrop-blur-md animate-in fade-in duration-200 p-4"
            onClick={onClose}
            role="dialog"
            aria-modal="true"
            aria-label="NTP Document Viewer"
        >
            <div
                onClick={(e) => e.stopPropagation()}
                className="relative bg-white dark:bg-slate-900 rounded-[28px] shadow-2xl w-full max-w-5xl max-h-[92vh] flex flex-col animate-in zoom-in-95 duration-200 overflow-hidden border border-slate-200/80 dark:border-white/5"
            >
                <div className="flex items-center gap-3 px-6 py-4 border-b border-slate-100 dark:border-slate-700/50 bg-white/40 dark:bg-slate-800/20">
                    <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-blue-500 to-cyan-400 flex items-center justify-center shrink-0">
                        <FileText size={16} className="text-white" />
                    </div>
                    <div className="min-w-0 flex-1">
                        <p className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest">NTP Document</p>
                        <p className="text-sm font-bold text-slate-800 dark:text-slate-100 truncate" title={fileName}>
                            {fileName || 'NTP Document'}
                        </p>
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        aria-label="Close NTP viewer"
                        className="w-9 h-9 rounded-full bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 flex items-center justify-center transition-colors shrink-0"
                    >
                        <X size={18} strokeWidth={2.5} />
                    </button>
                </div>

                <div className="flex-1 min-h-0 bg-slate-50 dark:bg-slate-950/40 flex items-center justify-center overflow-auto">
                    {kind === 'image' && (
                        <img
                            src={fileUrl}
                            alt={fileName || 'NTP Document'}
                            className="max-w-full max-h-[80vh] object-contain"
                        />
                    )}
                    {kind === 'pdf' && (
                        <iframe
                            src={fileUrl}
                            title={fileName || 'NTP Document'}
                            className="w-full h-full min-h-[70vh] border-0 bg-white"
                        />
                    )}
                    {kind === 'other' && (
                        <div className="flex flex-col items-center justify-center gap-4 px-6 py-12 text-center">
                            <div className="w-14 h-14 rounded-2xl bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center">
                                <AlertCircle size={26} className="text-amber-500" />
                            </div>
                            <div>
                                <p className="text-base font-bold text-slate-700 dark:text-slate-200">Unsupported file type</p>
                                <p className="text-sm text-slate-500 dark:text-slate-400 mt-1 max-w-sm">
                                    This file format can't be previewed inline. Download the file to view it locally.
                                </p>
                            </div>
                            <button
                                type="button"
                                onClick={handleDownload}
                                disabled={downloading}
                                className="inline-flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-teal-600 to-emerald-500 hover:from-teal-700 hover:to-emerald-600 text-white font-bold rounded-xl shadow-lg shadow-teal-500/25 transition-all text-sm disabled:opacity-60 disabled:cursor-not-allowed"
                            >
                                {downloading ? (
                                    <>
                                        <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                                        Downloading…
                                    </>
                                ) : (
                                    <>
                                        <Download size={15} />
                                        Download File
                                    </>
                                )}
                            </button>
                        </div>
                    )}
                </div>

                <div className="flex items-center justify-end gap-2 px-6 py-3 border-t border-slate-100 dark:border-slate-700/50 bg-white/40 dark:bg-slate-800/20">
                    <button
                        type="button"
                        onClick={handleDownload}
                        disabled={downloading}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold text-white bg-gradient-to-r from-teal-600 to-emerald-500 hover:from-teal-700 hover:to-emerald-600 transition-all disabled:opacity-60 disabled:cursor-not-allowed"
                    >
                        {downloading ? (
                            <>
                                <span className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                                Downloading…
                            </>
                        ) : (
                            <>
                                <Download size={13} />
                                Download
                            </>
                        )}
                    </button>
                </div>
            </div>
        </div>
    );
});

NtpViewerModal.displayName = 'NtpViewerModal';

export default NtpViewerModal;
