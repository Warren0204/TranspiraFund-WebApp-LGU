import { useState, useMemo } from 'react';
import {
    FileText, Search, Activity, Box, LogIn, UserPlus, Clock, Shield
} from 'lucide-react';
import DepwSidebar from '../../components/layout/DepwSidebar';

const AuditTrails = () => {
    const [logs] = useState([
        {
            id: 1, event: 'Login Success', type: 'login',
            subject: 'Web Portal Gateway', actor: 'Engr. Sarah Connor',
            role: 'DEPW', time: 'Jan 24, 2026', subTime: '06:30 PM'
        },
        {
            id: 2, event: 'Project Created', type: 'project',
            subject: 'Bus Rapid Transit Station - Fuente', actor: 'Engr. Sarah Connor',
            role: 'DEPW', time: 'Jan 23, 2026', subTime: '06:35 PM'
        },
        {
            id: 3, event: 'Staff Onboarded', type: 'staff',
            subject: 'Engr. Maria Santos', actor: 'Engr. Sarah Connor',
            role: 'DEPW', time: 'Jan 23, 2026', subTime: '05:35 PM'
        },
        {
            id: 4, event: 'Milestone Adjustment', type: 'project',
            subject: 'Colon Street Revitalization', actor: 'Engr. Sarah Connor',
            role: 'DEPW', time: 'Jan 22, 2026', subTime: '06:35 PM'
        },
        {
            id: 5, event: 'Project Created', type: 'project',
            subject: 'Colon Street Revitalization Phase 1', actor: 'Engr. Sarah Connor',
            role: 'DEPW', time: 'Jan 22, 2026', subTime: '05:35 PM'
        },
        {
            id: 6, event: 'Staff Onboarded', type: 'staff',
            subject: 'Engr. Juan Dela Cruz', actor: 'Engr. Sarah Connor',
            role: 'DEPW', time: 'Jan 22, 2026', subTime: '04:35 PM'
        }
    ]);

    const [searchTerm, setSearchTerm] = useState('');

    const filteredLogs = useMemo(() => {
        if (!searchTerm.trim()) return logs;
        const lower = searchTerm.toLowerCase();
        return logs.filter(l =>
            l.event.toLowerCase().includes(lower) ||
            l.subject.toLowerCase().includes(lower) ||
            l.actor.toLowerCase().includes(lower)
        );
    }, [logs, searchTerm]);

    const getEventMeta = (type) => {
        switch (type) {
            case 'login':
                return {
                    pill: 'bg-slate-100 dark:bg-slate-700/60 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-600',
                    icon: LogIn,
                    iconBg: 'from-slate-500 to-slate-600'
                };
            case 'project':
                return {
                    pill: 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-500/30',
                    icon: Box,
                    iconBg: 'from-blue-500 to-cyan-500'
                };
            case 'staff':
                return {
                    pill: 'bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300 border-purple-200 dark:border-purple-500/30',
                    icon: UserPlus,
                    iconBg: 'from-indigo-500 to-purple-500'
                };
            default:
                return {
                    pill: 'bg-slate-100 dark:bg-slate-700/60 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-600',
                    icon: Activity,
                    iconBg: 'from-slate-400 to-slate-500'
                };
        }
    };

    return (
        <div className="min-h-screen depw-bg font-sans text-slate-900 dark:text-slate-100">
            <DepwSidebar />

            <main className="ml-0 md:ml-72 p-4 md:p-6 lg:p-10 pt-20 md:pt-10">

                {/* PAGE HEADER */}
                <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-4 mb-8"
                    style={{ animation: 'fadeIn 0.4s ease-out both' }}>
                    <div>
                        <div className="inline-flex items-center gap-2 bg-slate-500/10 dark:bg-slate-400/10 border border-slate-400/20 dark:border-slate-400/20 rounded-full px-3 py-1 mb-3">
                            <div className="w-1.5 h-1.5 rounded-full bg-slate-500 dark:bg-slate-400" />
                            <span className="text-xs font-bold text-slate-600 dark:text-slate-300 uppercase tracking-widest">Immutable Log</span>
                        </div>
                        <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 dark:text-white tracking-tight">
                            Security Audit Trail
                        </h1>
                        <p className="text-slate-500 dark:text-slate-400 font-medium mt-1 text-sm">
                            Tamper-proof record of all system events and actions.
                        </p>
                    </div>

                    <div className="relative w-full lg:w-80 lg:shrink-0">
                        <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500 pointer-events-none" size={17} />
                        <input type="text" placeholder="Search events, subjects, actors..." value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="w-full pl-11 pr-4 py-3 bg-white/80 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-xl text-sm font-medium text-slate-700 dark:text-slate-300 placeholder:text-slate-400 dark:placeholder:text-slate-600 focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400 outline-none transition-all shadow-sm" />
                    </div>
                </div>

                {/* MAIN CARD */}
                <div className="bg-white/70 dark:bg-slate-900/50 backdrop-blur-xl border border-white/80 dark:border-white/5 rounded-[24px] shadow-xl overflow-hidden min-h-[600px] flex flex-col"
                    style={{ animation: 'slideUp 0.5s ease-out 0.1s both' }}>

                    {/* TABLE HEADER — md+ only */}
                    <div className="hidden md:grid grid-cols-12 px-7 py-3.5 bg-slate-50/70 dark:bg-slate-800/30 border-b border-slate-100 dark:border-slate-700/40 text-[11px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-[0.1em]">
                        <div className="col-span-3">Event</div>
                        <div className="col-span-6 lg:col-span-4">Subject / Entity</div>
                        <div className="hidden lg:block lg:col-span-3">Actor</div>
                        <div className="col-span-3 lg:col-span-2 text-right">Timestamp</div>
                    </div>

                    {/* LOG LIST */}
                    <div className="flex-1 overflow-auto divide-y divide-slate-100/70 dark:divide-slate-700/30">
                        {filteredLogs.length === 0 ? (
                            <div className="flex flex-col items-center justify-center py-24">
                                <div className="w-16 h-16 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center mb-4">
                                    <FileText size={28} className="text-slate-300 dark:text-slate-600" />
                                </div>
                                <p className="text-slate-500 dark:text-slate-400 font-semibold">No events found</p>
                            </div>
                        ) : filteredLogs.map((log, i) => {
                            const meta = getEventMeta(log.type);
                            const EventIcon = meta.icon;
                            return (
                                <div key={log.id} style={{ animation: `slideUp 0.4s ease-out ${i * 0.06}s both` }}>

                                    {/* MOBILE CARD */}
                                    <div className="md:hidden px-5 py-4 hover:bg-slate-50/80 dark:hover:bg-slate-800/30 transition-colors">
                                        <div className="flex items-center justify-between mb-2.5">
                                            <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold border ${meta.pill}`}>
                                                <EventIcon size={11} className="shrink-0" />
                                                {log.event}
                                            </span>
                                            <span className="text-[11px] font-bold text-slate-400 dark:text-slate-500">{log.time}</span>
                                        </div>
                                        <div className="flex items-center gap-2.5 mb-1.5">
                                            <div className={`w-7 h-7 rounded-lg bg-gradient-to-br ${meta.iconBg} flex items-center justify-center shrink-0 shadow-sm`}>
                                                <EventIcon size={13} className="text-white" />
                                            </div>
                                            <span className="font-bold text-slate-700 dark:text-slate-200 text-sm truncate">{log.subject}</span>
                                        </div>
                                        <p className="text-xs text-slate-400 dark:text-slate-500 font-semibold pl-9.5">
                                            {log.actor} · <span className="uppercase">{log.role}</span> · {log.subTime}
                                        </p>
                                    </div>

                                    {/* DESKTOP ROW */}
                                    <div className="hidden md:grid grid-cols-12 items-center px-7 py-4 hover:bg-slate-50/80 dark:hover:bg-slate-800/20 transition-colors group">

                                        {/* Event badge */}
                                        <div className="col-span-3">
                                            <span className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold border ${meta.pill}`}>
                                                <EventIcon size={12} className="shrink-0" />
                                                {log.event}
                                            </span>
                                        </div>

                                        {/* Subject — wider at md, normal at lg */}
                                        <div className="col-span-6 lg:col-span-4 flex items-center gap-3 pr-4 min-w-0">
                                            <div className={`w-8 h-8 rounded-xl bg-gradient-to-br ${meta.iconBg} flex items-center justify-center shrink-0 shadow-md`}>
                                                <EventIcon size={15} className="text-white" />
                                            </div>
                                            <span className="font-bold text-slate-700 dark:text-slate-200 text-sm truncate">{log.subject}</span>
                                        </div>

                                        {/* Actor — hidden at md, visible at lg */}
                                        <div className="hidden lg:flex lg:col-span-3 items-center gap-3 min-w-0">
                                            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-teal-500 to-cyan-400 flex items-center justify-center text-white font-bold text-xs shrink-0 shadow-md">
                                                {log.actor.split(' ').map(n => n[0]).filter(c => c === c.toUpperCase() && c.match(/[A-Z]/)).slice(0, 2).join('')}
                                            </div>
                                            <div className="min-w-0">
                                                <h5 className="text-sm font-bold text-slate-800 dark:text-slate-100 truncate">{log.actor}</h5>
                                                <p className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wide">{log.role}</p>
                                            </div>
                                        </div>

                                        {/* Timestamp — wider at md */}
                                        <div className="col-span-3 lg:col-span-2 text-right">
                                            <h5 className="text-sm font-bold text-slate-700 dark:text-slate-200">{log.time}</h5>
                                            <p className="text-xs font-medium text-slate-400 dark:text-slate-500 mt-0.5 flex items-center justify-end gap-1">
                                                <Clock size={10} />
                                                {log.subTime}
                                            </p>
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>

                    {/* FOOTER */}
                    <div className="px-7 py-4 border-t border-slate-100 dark:border-slate-700/40 bg-slate-50/50 dark:bg-slate-800/20 flex items-center gap-2">
                        <Shield size={14} className="text-slate-400 dark:text-slate-500 shrink-0" />
                        <p className="text-xs font-semibold text-slate-400 dark:text-slate-500">
                            All entries are write-protected. Only the system can append to this log.
                        </p>
                    </div>
                </div>
            </main>
        </div>
    );
};

export default AuditTrails;
