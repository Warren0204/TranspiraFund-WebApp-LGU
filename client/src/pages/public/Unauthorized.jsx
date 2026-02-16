import React from 'react';
import { ShieldOff } from 'lucide-react';

const Unauthorized = () => (
    <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="text-center">
            <ShieldOff size={48} className="text-red-400 mx-auto mb-4" />
            <h1 className="text-2xl font-bold text-red-600 mb-2">403 — Access Denied</h1>
            <p className="text-slate-500 text-sm">You do not have permission to view this page.</p>
        </div>
    </div>
);

export default Unauthorized;
