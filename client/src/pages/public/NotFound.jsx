import { FileQuestion } from 'lucide-react';

const NotFound = () => (
    <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="text-center">
            <FileQuestion size={48} className="text-slate-300 mx-auto mb-4" />
            <h1 className="text-2xl font-bold text-slate-400 mb-2">404 — Page Not Found</h1>
            <p className="text-slate-400 text-sm">The page you are looking for does not exist.</p>
        </div>
    </div>
);

export default NotFound;
