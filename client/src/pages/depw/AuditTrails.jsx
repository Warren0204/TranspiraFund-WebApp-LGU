import React, { useState } from 'react';
import {
    FileText, Search, Activity, Box, UserPlus, FileBarChart, Monitor
} from 'lucide-react';
import DepwSidebar from '../../components/layout/DepwSidebar';

const AuditTrails = () => {

    // Mock Data based on screenshot
    const [logs] = useState([
        {
            id: 1,
            event: 'Login Success',
            type: 'login', // for styling
            subject: 'Web Portal Gateway',
            subjectIcon: FileText,
            actor: 'Engr. Sarah Connor',
            role: 'DEPW',
            time: 'Jan 24, 2026',
            subTime: '06:30 PM'
        },
        {
            id: 2,
            event: 'Project Created',
            type: 'project',
            subject: 'Bus Rapid Transit Station - Fuente',
            subjectIcon: Box,
            actor: 'Engr. Sarah Connor',
            role: 'DEPW',
            time: 'Jan 23, 2026',
            subTime: '06:35 PM'
        },
        {
            id: 3,
            event: 'Staff Onboarded',
            type: 'staff',
            subject: 'Engr. Maria Santos',
            subjectIcon: FileText,
            actor: 'Engr. Sarah Connor',
            role: 'DEPW',
            time: 'Jan 23, 2026',
            subTime: '05:35 PM'
        },
        {
            id: 4,
            event: 'Milestone Adjustment',
            type: 'project',
            subject: 'Colon Street Revitalization',
            subjectIcon: Box,
            actor: 'Engr. Sarah Connor',
            role: 'DEPW',
            time: 'Jan 22, 2026',
            subTime: '06:35 PM'
        },
        {
            id: 5,
            event: 'Project Created',
            type: 'project',
            subject: 'Colon Street Revitalization Phase 1',
            subjectIcon: Box,
            actor: 'Engr. Sarah Connor',
            role: 'DEPW',
            time: 'Jan 22, 2026',
            subTime: '05:35 PM'
        },
        {
            id: 6,
            event: 'Staff Onboarded',
            type: 'staff',
            subject: 'Engr. Juan Dela Cruz',
            subjectIcon: FileText,
            actor: 'Engr. Sarah Connor',
            role: 'DEPW',
            time: 'Jan 22, 2026',
            subTime: '04:35 PM'
        }
    ]);

    const [searchTerm, setSearchTerm] = useState('');

    const getBadgeStyle = (type) => {
        switch (type) {
            case 'login': return 'bg-slate-100 text-slate-600';
            case 'project': return 'bg-blue-100 text-blue-600';
            case 'staff': return 'bg-purple-100 text-purple-600';
            default: return 'bg-slate-100 text-slate-600';
        }
    };

    const getIcon = (type) => {
        switch (type) {
            case 'login': return Activity;
            case 'project': return Activity;
            case 'staff': return Activity;
            default: return Activity;
        }
    };

    return (
        <div className="min-h-screen bg-slate-50 font-sans text-slate-900">
            <DepwSidebar />

            <main className="ml-0 md:ml-72 p-4 md:p-10 max-w-[1200px] mx-auto">

                {/* PAGE HEADER */}
                <div className="flex justify-between items-center mb-8">
                    <div>
                        <h1 className="text-3xl font-extrabold text-slate-900 tracking-tight flex items-center gap-3">
                            <FileText className="text-blue-600" size={32} />
                            Security Audit
                        </h1>
                        <p className="text-slate-500 font-medium mt-1 ml-11">
                            Immutable log of system events.
                        </p>
                    </div>
                    <div className="w-80 relative">
                        <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-300 pointer-events-none" size={18} />
                        <input
                            type="text"
                            placeholder="Search..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="w-full pl-11 pr-4 py-3 bg-white border border-slate-200 rounded-xl text-sm font-semibold focus:ring-2 focus:ring-blue-500 outline-none transition-all placeholder:text-slate-300 shadow-sm"
                        />
                    </div>
                </div>

                {/* MAIN CONTENT CARD */}
                <div className="bg-white rounded-[24px] border border-slate-200 shadow-sm overflow-hidden min-h-[600px] flex flex-col">

                    {/* TABLE HEADER */}
                    <div className="grid grid-cols-12 px-8 py-5 bg-white border-b border-slate-100 text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                        <div className="col-span-2">Event</div>
                        <div className="col-span-5">Subject / Entity</div>
                        <div className="col-span-3">Actor</div>
                        <div className="col-span-2 text-right">Timestamp</div>
                    </div>

                    {/* LIST */}
                    <div className="flex-1 overflow-auto">
                        {logs.map(log => (
                            <div key={log.id} className="grid grid-cols-12 items-center px-8 py-5 hover:bg-slate-50 transition-colors border-b border-slate-50 last:border-b-0 group">

                                {/* EVENT */}
                                <div className="col-span-2">
                                    <span className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold ${getBadgeStyle(log.type)}`}>
                                        <Activity size={12} className="shrink-0" />
                                        {log.event}
                                    </span>
                                </div>

                                {/* SUBJECT */}
                                <div className="col-span-5 flex items-center gap-3">
                                    <div className="w-8 h-8 rounded-lg bg-slate-50 border border-slate-100 flex items-center justify-center text-slate-400 shrink-0">
                                        <log.subjectIcon size={16} />
                                    </div>
                                    <span className="font-bold text-slate-700 text-sm truncate pr-4">{log.subject}</span>
                                </div>

                                {/* ACTOR */}
                                <div className="col-span-3 flex items-center gap-3">
                                    <div className="w-8 h-8 rounded-full bg-slate-100 border border-slate-200 flex items-center justify-center text-slate-400 shrink-0">
                                        <span className="text-xs font-bold">ES</span>
                                    </div>
                                    <div>
                                        <h5 className="text-xs font-bold text-slate-900">{log.actor}</h5>
                                        <p className="text-[10px] font-bold text-slate-400 uppercase">{log.role}</p>
                                    </div>
                                </div>

                                {/* TIMESTAMP */}
                                <div className="col-span-2 text-right">
                                    <h5 className="text-xs font-bold text-slate-600">{log.time}</h5>
                                    <p className="text-[10px] font-medium text-slate-400 mt-0.5 flex items-center justify-end gap-1">
                                        <Monitor size={10} />
                                        {log.subTime}
                                    </p>
                                </div>

                            </div>
                        ))}
                    </div>
                </div>

            </main>
        </div>
    );
};

export default AuditTrails;
