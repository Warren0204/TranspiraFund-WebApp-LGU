import { Loader2 } from 'lucide-react';

const PageLoader = () => (
    <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <Loader2 className="animate-spin text-blue-600" size={40} />
    </div>
);

export default PageLoader;
