import { useState } from 'react';
import {
    Bell, Check, CircleX, CircleCheck, Info, CheckCheck
} from 'lucide-react';
import HcsdSidebar from '../../components/layout/HcsdSidebar';

const Notifications = () => {
    const [alerts, setAlerts] = useState([
        {
            id: 1, type: 'critical',
            title: 'Critical Slippage Alert',
            message: 'Project "Colon Street Revitalization" has exceeded the -15% threshold. Immediate intervention required.',
            time: '1/24/2026, 6:05 PM', read: false
        },
        {
            id: 2, type: 'success',
            title: 'Validation Complete',
            message: 'CPDO has approved the baseline for "Bus Rapid Transit Station". Execution may commence.',
            time: '1/24/2026, 1:35 PM', read: false
        },
        {
            id: 3, type: 'info',
            title: 'System Maintenance',
            message: 'Scheduled downtime for upgrades on Sunday at 2:00 AM. Please save all work beforehand.',
            time: '1/23/2026, 6:35 PM', read: true
        }
    ]);

    const markAllRead = () => setAlerts(prev => prev.map(a => ({ ...a, read: true })));
    const markRead = (id) => setAlerts(prev => prev.map(a => a.id === id ? { ...a, read: true } : a));

    const unreadCount = alerts.filter(a => !a.read).length;

    const getAlertMeta = (type) => {
        switch (type) {
            case 'critical':
                return {
                    wrapper: 'border-red-200 dark:border-red-500/30 bg-red-50/80 dark:bg-red-900/10',
                    leftBar: 'bg-gradient-to-b from-red-500 to-rose-600',
                    icon: <CircleX className="text-red-500 dark:text-red-400" size={26} />,
                    iconBg: 'bg-red-100 dark:bg-red-900/40',
                    titleColor: 'text-red-800 dark:text-red-200',
                    textColor: 'text-red-700 dark:text-red-300',
                    timeColor: 'text-red-400 dark:text-red-400',
                };
            case 'success':
                return {
                    wrapper: 'border-emerald-200 dark:border-emerald-500/30 bg-emerald-50/60 dark:bg-emerald-900/10',
                    leftBar: 'bg-gradient-to-b from-emerald-500 to-teal-400',
                    icon: <CircleCheck className="text-emerald-500 dark:text-emerald-400" size={26} />,
                    iconBg: 'bg-emerald-100 dark:bg-emerald-900/40',
                    titleColor: 'text-emerald-800 dark:text-emerald-200',
                    textColor: 'text-emerald-700 dark:text-emerald-300',
                    timeColor: 'text-emerald-400 dark:text-emerald-500',
                };
            case 'info':
            default:
                return {
                    wrapper: 'border-slate-200 dark:border-slate-700/60 bg-white/60 dark:bg-slate-800/30',
                    leftBar: 'bg-gradient-to-b from-teal-500 to-emerald-400',
                    icon: <Info className="text-teal-500 dark:text-teal-400" size={26} />,
                    iconBg: 'bg-teal-50 dark:bg-teal-900/30',
                    titleColor: 'text-slate-800 dark:text-slate-100',
                    textColor: 'text-slate-600 dark:text-slate-400',
                    timeColor: 'text-slate-400 dark:text-slate-500',
                };
        }
    };

    return (
        <div className="min-h-screen hcsd-bg font-sans text-slate-900 dark:text-slate-100">
            <HcsdSidebar />

            <main className="ml-0 md:ml-72 p-4 md:p-6 lg:p-10 pt-20 md:pt-10">

                {/* PAGE HEADER */}
                <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-3 mb-8"
                    style={{ animation: 'fadeIn 0.4s ease-out both' }}>
                    <div>
                        <div className="inline-flex items-center gap-2 bg-amber-500/10 dark:bg-amber-400/10 border border-amber-400/20 dark:border-amber-400/20 rounded-full px-3 py-1 mb-3">
                            <div className="w-1.5 h-1.5 rounded-full bg-amber-500 dark:bg-amber-400" />
                            <span className="text-xs font-bold text-amber-700 dark:text-amber-300 uppercase tracking-widest">System Alerts</span>
                        </div>
                        <div className="flex items-center gap-3">
                            <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 dark:text-white tracking-tight">
                                Intelligent Monitoring
                            </h1>
                            {unreadCount > 0 && (
                                <span className="bg-red-500 text-white text-xs font-bold w-6 h-6 rounded-full flex items-center justify-center shadow-lg shadow-red-500/30">
                                    {unreadCount}
                                </span>
                            )}
                        </div>
                        <p className="text-slate-500 dark:text-slate-400 font-medium mt-1 text-sm">
                            Real-time alerts on slippage, validations, and system events.
                        </p>
                    </div>

                    {unreadCount > 0 && (
                        <button onClick={markAllRead}
                            className="shrink-0 flex items-center gap-2 text-sm font-bold text-slate-500 dark:text-slate-400 hover:text-teal-600 dark:hover:text-teal-400 bg-white/70 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 px-4 py-2.5 rounded-xl transition-all hover:shadow-sm">
                            <CheckCheck size={16} />
                            Mark All Read
                        </button>
                    )}
                </div>

                {/* ALERTS LIST */}
                <div className="space-y-4">
                    {alerts.map((alert, i) => {
                        const meta = getAlertMeta(alert.type);
                        return (
                            <div key={alert.id}
                                className={`relative rounded-[20px] border overflow-hidden transition-all ${meta.wrapper} ${alert.read ? 'opacity-70' : 'shadow-lg'}`}
                                style={{ animation: `slideUp 0.4s ease-out ${i * 0.1}s both` }}>

                                {/* Left accent bar */}
                                <div className={`absolute left-0 top-0 bottom-0 w-1 ${meta.leftBar}`} />

                                <div className="pl-5 pr-5 sm:pr-8 py-5 sm:py-7 flex items-start gap-4 sm:gap-5 ml-1">

                                    {/* Icon */}
                                    <div className={`w-11 h-11 rounded-2xl ${meta.iconBg} flex items-center justify-center shrink-0`}>
                                        {meta.icon}
                                    </div>

                                    {/* Content */}
                                    <div className="flex-1 min-w-0">
                                        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-1 mb-2">
                                            <h3 className={`text-base font-extrabold tracking-tight ${meta.titleColor}`}>
                                                {alert.title}
                                            </h3>
                                            <span className={`text-xs font-semibold shrink-0 ${meta.timeColor}`}>
                                                {alert.time}
                                            </span>
                                        </div>
                                        <p className={`text-sm font-medium leading-relaxed ${meta.textColor}`}>
                                            {alert.message}
                                        </p>

                                        {!alert.read && (
                                            <button onClick={() => markRead(alert.id)}
                                                className={`mt-3 text-xs font-bold flex items-center gap-1.5 transition-colors opacity-70 hover:opacity-100 ${meta.titleColor}`}>
                                                <Check size={13} strokeWidth={3} />
                                                Mark as Read
                                            </button>
                                        )}
                                    </div>

                                    {/* Unread dot */}
                                    {!alert.read && (
                                        <div className="w-2.5 h-2.5 rounded-full bg-red-500 shrink-0 mt-1 shadow-sm shadow-red-500/50" />
                                    )}
                                </div>
                            </div>
                        );
                    })}

                    {alerts.length === 0 && (
                        <div className="flex flex-col items-center justify-center py-24 bg-white/60 dark:bg-slate-900/40 backdrop-blur-xl border border-white/80 dark:border-white/5 rounded-[24px]">
                            <div className="w-16 h-16 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center mb-4">
                                <Bell size={28} className="text-slate-300 dark:text-slate-600" />
                            </div>
                            <p className="text-slate-500 dark:text-slate-400 font-semibold text-base">All clear!</p>
                            <p className="text-sm text-slate-400 dark:text-slate-500 mt-1">No active alerts at this time.</p>
                        </div>
                    )}
                </div>
            </main>
        </div>
    );
};

export default Notifications;
