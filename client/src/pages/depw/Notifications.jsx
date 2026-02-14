import React, { useState } from 'react';
import {
    Bell, Check, CircleX, CircleCheck, Info, CheckCheck
} from 'lucide-react';
import DepwSidebar from '../../components/layout/DepwSidebar';

const Notifications = () => {

    // Mock Data based on screenshot
    const [alerts, setAlerts] = useState([
        {
            id: 1,
            type: 'critical',
            title: 'Critical Slippage Alert',
            message: 'Project "Colon Street Revitalization" has exceeded the -15% threshold. Immediate intervention required.',
            time: '1/24/2026, 6:05:01 PM',
            read: false
        },
        {
            id: 2,
            type: 'success',
            title: 'Validation Complete',
            message: 'CPDO has approved the baseline for "Bus Rapid Transit Station". Execution may commence.',
            time: '1/24/2026, 1:35:01 PM',
            read: false
        },
        {
            id: 3,
            type: 'info',
            title: 'System Maintenance',
            message: 'Scheduled downtime for upgrades on Sunday at 2:00 AM.',
            time: '1/23/2026, 6:35:01 PM',
            read: true
        }
    ]);

    const getAlertStyle = (type) => {
        switch (type) {
            case 'critical': return 'bg-red-50 border-red-100';
            case 'success': return 'bg-white border-white hover:bg-slate-50'; // Minimalist for success
            case 'info': return 'bg-white border-white hover:bg-slate-50';
            default: return 'bg-white border-slate-100';
        }
    };

    const getIcon = (type) => {
        switch (type) {
            case 'critical': return <CircleX className="text-red-500" size={24} />;
            case 'success': return <CircleCheck className="text-emerald-500" size={24} />;
            case 'info': return <Info className="text-blue-500" size={24} />;
            default: return <Bell size={24} />;
        }
    };

    return (
        <div className="min-h-screen bg-slate-50 font-sans text-slate-900">
            <DepwSidebar />

            <main className="ml-0 md:ml-72 p-4 md:p-10 max-w-[1200px] mx-auto">

                {/* PAGE HEADER */}
                <div className="flex justify-between items-end mb-8">
                    <div>
                        <h1 className="text-3xl font-extrabold text-slate-900 tracking-tight flex items-center gap-3">
                            <Bell className="text-blue-600" size={32} />
                            Intelligent Monitoring
                        </h1>
                        <p className="text-slate-500 font-medium mt-1 ml-11">
                            Real-time alerts on slippage, validations, and system events.
                        </p>
                    </div>
                    <div>
                        <button className="text-slate-400 hover:text-blue-600 font-bold text-sm flex items-center gap-2 transition-colors" aria-label="Mark all notifications as read">
                            <CheckCheck size={16} /> Mark All Read
                        </button>
                    </div>
                </div>

                {/* ALERTS LIST */}
                <div className="space-y-4">
                    {alerts.map(alert => (
                        <div key={alert.id} className={`p-8 rounded-[24px] border transition-all ${getAlertStyle(alert.type)} ${alert.type === 'critical' ? 'shadow-sm' : 'shadow-none'}`}>
                            <div className="flex items-start gap-6">
                                <div className="mt-1 shrink-0">
                                    {getIcon(alert.type)}
                                </div>
                                <div className="flex-1">
                                    <div className="flex justify-between items-start mb-1">
                                        <h3 className={`text-lg font-bold ${alert.type === 'critical' ? 'text-slate-900' : 'text-slate-700'}`}>
                                            {alert.title}
                                        </h3>
                                        <span className="text-xs font-bold text-slate-400">{alert.time}</span>
                                    </div>
                                    <p className={`${alert.type === 'critical' ? 'text-slate-800' : 'text-slate-500'} font-medium`}>
                                        {alert.message}
                                    </p>

                                    {alert.type === 'critical' && !alert.read && (
                                        <button className="mt-4 text-xs font-bold text-blue-600 hover:text-blue-700 flex items-center gap-1.5 transition-colors" aria-label="Mark notification as read">
                                            <Check size={14} strokeWidth={3} /> Mark as Read
                                        </button>
                                    )}
                                </div>
                            </div>
                        </div>
                    ))}
                </div>

            </main>
        </div>
    );
};

export default Notifications;
