import { useEffect, useMemo, useState } from 'react';
import {
    Bell, Check, CheckCheck, Radio, Settings as SettingsIcon
} from 'lucide-react';
import HcsdSidebar from '../../components/layout/HcsdSidebar';
import {
    collection, query, where, orderBy, limit, onSnapshot,
    doc, updateDoc, writeBatch
} from 'firebase/firestore';
import { db } from '../../config/firebase';
import { useAuth } from '../../context/AuthContext';

const fmtTime = (ts) => {
    if (!ts) return '';
    try {
        const d = ts.toDate ? ts.toDate() : new Date(ts);
        return d.toLocaleString('en-PH', {
            month: 'short', day: 'numeric', year: 'numeric',
            hour: 'numeric', minute: '2-digit', hour12: true
        });
    } catch { return ''; }
};

const getAlertMeta = (isRead) => (
    isRead
        ? {
            wrapper:    'border-slate-200/60 dark:border-slate-700/40 bg-white/50 dark:bg-slate-900/40',
            leftBar:    null,
            iconBg:     'bg-slate-100 dark:bg-slate-800',
            iconColor:  'text-slate-400 dark:text-slate-500',
            titleColor: 'text-slate-500 dark:text-slate-400',
            textColor:  'text-slate-500 dark:text-slate-500',
            timeColor:  'text-slate-400 dark:text-slate-500',
        }
        : {
            wrapper:    'border-teal-200/60 dark:border-cyan-500/20 bg-white dark:bg-slate-900/60 shadow-lg',
            leftBar:    'bg-gradient-to-b from-teal-500 to-cyan-400',
            iconBg:     'bg-teal-50 dark:bg-cyan-500/10',
            iconColor:  'text-teal-600 dark:text-cyan-400',
            titleColor: 'text-slate-900 dark:text-white',
            textColor:  'text-slate-600 dark:text-slate-300',
            timeColor:  'text-slate-400 dark:text-slate-500',
        }
);

const TAB_FILTERS = [
    { key: 'ALL',    label: 'All',            match: () => true },
    { key: 'SYSTEM', label: 'System',         match: (a) => (a.category ?? 'system') === 'system' },
    { key: 'FIELD',  label: 'Field Activity', match: (a) => a.category === 'field' },
];

const TAB_ICON = {
    ALL: Bell,
    SYSTEM: SettingsIcon,
    FIELD: Radio,
};

const Notifications = () => {
    const { currentUser, tenantId } = useAuth();
    const [alerts, setAlerts] = useState([]);
    const [loading, setLoading] = useState(true);
    const [tab, setTab] = useState('ALL');

    useEffect(() => {
        if (!currentUser?.uid || !tenantId) return;
        const q = query(
            collection(db, 'notifications'),
            where('recipientUid', '==', currentUser.uid),
            where('tenantId', '==', tenantId),
            orderBy('createdAt', 'desc'),
            limit(50)
        );
        const unsub = onSnapshot(
            q,
            (snap) => {
                setAlerts(snap.docs.map(d => ({ id: d.id, ...d.data() })));
                setLoading(false);
            },
            (error) => {
                console.error('[Notifications/notifications] snapshot listener error:', error);
                setLoading(false);
            }
        );
        return unsub;
    }, [currentUser?.uid, tenantId]);

    const markRead = async (id) => {
        try {
            await updateDoc(doc(db, 'notifications', id), { isRead: true });
        } catch {
        }
    };

    const markAllRead = async () => {
        const unread = alerts.filter(a => !a.isRead);
        if (unread.length === 0) return;
        try {
            const batch = writeBatch(db);
            unread.forEach(a => batch.update(doc(db, 'notifications', a.id), { isRead: true }));
            await batch.commit();
        } catch {
        }
    };

    const activeFilter = TAB_FILTERS.find(t => t.key === tab) ?? TAB_FILTERS[0];
    const visibleAlerts = useMemo(
        () => alerts.filter(activeFilter.match),
        [alerts, activeFilter]
    );
    const tabCounts = useMemo(() => ({
        ALL:    alerts.length,
        SYSTEM: alerts.filter(TAB_FILTERS[1].match).length,
        FIELD:  alerts.filter(TAB_FILTERS[2].match).length,
    }), [alerts]);

    const unreadCount = alerts.filter(a => !a.isRead).length;

    return (
        <div className="min-h-screen hcsd-bg font-sans text-slate-900 dark:text-slate-100">
            <HcsdSidebar />

            <main className="ml-0 md:ml-72 p-4 md:p-6 lg:p-10 pt-20 md:pt-10">

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
                            Real-time alerts on admin events and mobile field activity.
                        </p>
                    </div>

                    {unreadCount > 0 && (
                        <button
                            type="button"
                            onClick={markAllRead}
                            className="inline-flex items-center gap-2 self-start md:self-auto px-4 py-2 rounded-full text-xs font-bold uppercase tracking-wider bg-gradient-to-r from-teal-500 to-emerald-400 text-white border border-transparent shadow-md shadow-teal-500/20 hover:shadow-lg hover:shadow-teal-500/30 transition-all"
                        >
                            <CheckCheck size={14} strokeWidth={2.5} />
                            Mark All as Read
                        </button>
                    )}
                </div>

                <div className="flex flex-wrap gap-2 mb-6" style={{ animation: 'fadeIn 0.4s ease-out both' }}>
                    {TAB_FILTERS.map((t) => {
                        const Icon = TAB_ICON[t.key] || Bell;
                        const active = tab === t.key;
                        const count = tabCounts[t.key] ?? 0;
                        return (
                            <button
                                key={t.key}
                                type="button"
                                onClick={() => setTab(t.key)}
                                className={[
                                    'inline-flex items-center gap-2 px-4 py-2 rounded-full text-xs font-bold uppercase tracking-wider transition-all border',
                                    active
                                        ? 'bg-gradient-to-r from-teal-500 to-emerald-400 text-white border-transparent shadow-md shadow-teal-500/20'
                                        : 'bg-white/70 dark:bg-slate-800/50 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:bg-white dark:hover:bg-slate-800',
                                ].join(' ')}
                            >
                                <Icon size={14} strokeWidth={2.5} />
                                {t.label}
                                <span className={[
                                    'text-[10px] font-extrabold rounded-full px-1.5 py-0.5 min-w-[20px] text-center',
                                    active
                                        ? 'bg-white/25 text-white'
                                        : 'bg-slate-200/70 dark:bg-slate-700/70 text-slate-600 dark:text-slate-300',
                                ].join(' ')}>
                                    {count}
                                </span>
                            </button>
                        );
                    })}
                </div>

                <div className="space-y-4">
                    {visibleAlerts.map((alert, i) => {
                        const meta = getAlertMeta(alert.isRead);
                        return (
                            <div key={alert.id}
                                className={`relative rounded-[20px] border overflow-hidden transition-all ${meta.wrapper}`}
                                style={{ animation: `slideUp 0.4s ease-out ${i * 0.05}s both` }}>

                                {meta.leftBar && (
                                    <div className={`absolute left-0 top-0 bottom-0 w-1 ${meta.leftBar}`} />
                                )}

                                <div className="pl-5 pr-5 sm:pr-8 py-5 sm:py-7 flex items-start gap-4 sm:gap-5 ml-1">

                                    <div className={`w-11 h-11 rounded-2xl ${meta.iconBg} flex items-center justify-center shrink-0`}>
                                        <Bell className={meta.iconColor} size={22} strokeWidth={2.2} />
                                    </div>

                                    <div className="flex-1 min-w-0">
                                        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-1 mb-2">
                                            <h3 className={`text-base font-extrabold tracking-tight ${meta.titleColor}`}>
                                                {alert.title}
                                            </h3>
                                            <span className={`text-xs font-semibold shrink-0 ${meta.timeColor}`}>
                                                {fmtTime(alert.createdAt)}
                                            </span>
                                        </div>
                                        <p className={`text-sm font-medium leading-relaxed ${meta.textColor}`}>
                                            {alert.body}
                                        </p>

                                        {!alert.isRead && (
                                            <button onClick={() => markRead(alert.id)}
                                                className="mt-3 text-xs font-bold flex items-center gap-1.5 transition-colors text-teal-700 dark:text-cyan-400 opacity-80 hover:opacity-100">
                                                <Check size={13} strokeWidth={3} />
                                                Mark as Read
                                            </button>
                                        )}
                                    </div>

                                    {!alert.isRead && (
                                        <div className="w-2.5 h-2.5 rounded-full bg-red-500 shrink-0 mt-1 shadow-sm shadow-red-500/50" />
                                    )}
                                </div>
                            </div>
                        );
                    })}

                    {!loading && visibleAlerts.length === 0 && (
                        <div className="flex flex-col items-center justify-center py-24 bg-white/60 dark:bg-slate-900/40 backdrop-blur-xl border border-white/80 dark:border-white/5 rounded-[24px]">
                            <div className="w-16 h-16 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center mb-4">
                                <Bell size={28} className="text-slate-300 dark:text-slate-600" />
                            </div>
                            <p className="text-slate-500 dark:text-slate-400 font-semibold text-base">
                                {tab === 'FIELD'
                                    ? 'No field activity yet'
                                    : tab === 'SYSTEM'
                                        ? 'No system alerts yet'
                                        : 'No notifications yet'}
                            </p>
                            <p className="text-sm text-slate-400 dark:text-slate-500 mt-1">
                                {tab === 'FIELD'
                                    ? 'Photo uploads, milestones, and completion submissions from the field will show up here.'
                                    : 'Assignments and system alerts will show up here.'}
                            </p>
                        </div>
                    )}
                </div>
            </main>
        </div>
    );
};

export default Notifications;
