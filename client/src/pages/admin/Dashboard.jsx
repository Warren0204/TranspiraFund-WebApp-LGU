import {
    ShieldCheck, Users, FileText, HardHat, Map, AlertTriangle
} from 'lucide-react';
import { memo, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { collection, query, onSnapshot } from 'firebase/firestore';
import { db } from '../../config/firebase';
import AdminSidebar from '../../components/layout/AdminSidebar';
import { useAuth } from '../../context/AuthContext';

const useDashboardData = () => {
    const [departments, setDepartments] = useState([]);
    const [systemHealth, setSystemHealth] = useState({
        status: 'Loading...', message: 'Analyzing system configuration...', isError: false
    });

    useEffect(() => {
        const unsubscribe = onSnapshot(query(collection(db, 'users')), (snapshot) => {
            const users    = snapshot.docs.map(doc => doc.data());
            const find     = (role) => users.find(u => u.role === role);
            const mayorUser = find('MAYOR');
            const depwUser  = find('DEPW');
            const cpdoUser  = find('CPDO');
            const engCount  = users.filter(u => u.role === 'PROJ_ENG').length;

            const depts = [
                {
                    id: 'mayor', title: "Mayor's Office", role: 'APPROVER',
                    status: mayorUser ? 'Active' : 'Required', isMissing: !mayorUser,
                    person: { label: 'Designated User', name: mayorUser ? `${mayorUser.firstName} ${mayorUser.lastName}` : null },
                    extra: null,
                },
                {
                    id: 'depw', title: 'Engineering Department', role: 'DEPW',
                    status: depwUser ? 'Active' : 'Required', isMissing: !depwUser,
                    person: { label: 'Department Head', name: depwUser ? `${depwUser.firstName} ${depwUser.lastName}` : null },
                    extra: { label: 'Field Engineers', value: `${engCount}` },
                },
                {
                    id: 'cpdo', title: 'City Planning', role: 'CPDO',
                    status: cpdoUser ? 'Active' : 'Required', isMissing: !cpdoUser,
                    person: { label: 'Department Head', name: cpdoUser ? `${cpdoUser.firstName} ${cpdoUser.lastName}` : null },
                    extra: null,
                },
            ];

            setDepartments(depts);
            const missing = depts.filter(d => d.isMissing).length;
            setSystemHealth(missing > 0
                ? { status: 'Configuration Incomplete', message: `${missing} key account(s) are not yet provisioned. Go to Account Management to resolve this.`, isError: true }
                : { status: 'System Fully Operational', message: 'All departmental accounts are provisioned and active.', isError: false }
            );
        });
        return () => unsubscribe();
    }, []);

    return { departments, systemHealth };
};

const getGreeting = () => {
    const h = new Date().getHours();
    if (h < 12) return 'Good morning';
    if (h < 17) return 'Good afternoon';
    return 'Good evening';
};

const DEPT_ICONS = { mayor: FileText, depw: HardHat, cpdo: Map };

const DepartmentCard = memo(({ data, index }) => {
    const Icon    = DEPT_ICONS[data.id] || FileText;
    const initial = data.person.name?.charAt(0).toUpperCase() || null;

    return (
        <div
            className={`relative overflow-hidden rounded-2xl border transition-all duration-300 hover:-translate-y-1
                ${data.isMissing
                    ? 'bg-white dark:bg-slate-900/60 border-amber-200 dark:border-amber-500/20 shadow-md shadow-amber-100/50 dark:shadow-black/20 hover:shadow-xl hover:shadow-amber-100/60'
                    : 'bg-white dark:bg-slate-900/60 border-slate-200 dark:border-white/[0.07] shadow-md shadow-slate-200/50 dark:shadow-black/20 hover:shadow-xl hover:shadow-slate-200/70'
                }`}
            style={{ animation: `slideUp 0.5s ease-out ${0.2 + index * 0.09}s both` }}
        >
            <div className={`absolute left-0 top-0 bottom-0 w-1
                ${data.isMissing
                    ? 'bg-gradient-to-b from-amber-400 to-orange-400'
                    : 'bg-gradient-to-b from-teal-500 to-emerald-400'
                }`}
            />

            <div className="absolute -right-5 -bottom-5 opacity-[0.04] dark:opacity-[0.06] pointer-events-none select-none">
                <Icon size={110} strokeWidth={1.2} />
            </div>

            <div className="relative p-6 pl-7">
                <div className="flex items-start justify-between gap-3 mb-5">
                    <div className={`w-12 h-12 rounded-xl flex items-center justify-center shrink-0 shadow-md
                        ${data.isMissing
                            ? 'bg-gradient-to-br from-amber-400 to-orange-400 shadow-amber-400/25'
                            : 'bg-gradient-to-br from-teal-500 to-emerald-400 shadow-teal-500/25'
                        }`}>
                        <Icon size={22} className="text-white" />
                    </div>
                    <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full border text-xs font-bold uppercase tracking-wide shrink-0
                        ${data.isMissing
                            ? 'bg-amber-50 dark:bg-amber-900/25 border-amber-200 dark:border-amber-500/20 text-amber-700 dark:text-amber-400'
                            : 'bg-teal-50 dark:bg-teal-900/20 border-teal-200 dark:border-teal-500/20 text-teal-700 dark:text-teal-400'
                        }`}>
                        <span className={`w-2 h-2 rounded-full shrink-0
                            ${data.isMissing ? 'bg-amber-400' : 'bg-teal-500 animate-pulse'}`}
                        />
                        {data.status}
                    </div>
                </div>

                <h3 className="text-lg font-extrabold text-slate-800 dark:text-slate-100 tracking-tight leading-tight mb-1">
                    {data.title}
                </h3>
                <p className="text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-5">
                    {data.role}
                </p>

                <div className="h-px bg-slate-100 dark:bg-slate-700/50 mb-5" />

                <div className="flex items-center gap-3">
                    <div className={`w-11 h-11 rounded-xl flex items-center justify-center text-sm font-extrabold shrink-0
                        ${initial
                            ? 'bg-gradient-to-br from-teal-500 to-emerald-400 text-white shadow-sm shadow-teal-500/20'
                            : 'bg-slate-100 dark:bg-slate-700/60 text-slate-400 dark:text-slate-500 border-2 border-dashed border-slate-300 dark:border-slate-600'
                        }`}>
                        {initial ?? '—'}
                    </div>
                    <div className="flex-1 min-w-0">
                        <p className={`text-[15px] font-bold truncate leading-tight
                            ${!data.person.name
                                ? 'text-amber-500 dark:text-amber-400 italic'
                                : 'text-slate-700 dark:text-slate-200'
                            }`}>
                            {data.person.name ?? 'Not Provisioned'}
                        </p>
                        <p className="text-xs font-semibold text-slate-400 dark:text-slate-500 mt-0.5">
                            {data.person.label}
                        </p>
                    </div>
                </div>
                {data.extra && (
                    <div className="mt-4 pt-4 border-t border-slate-100 dark:border-slate-700/50 flex items-center justify-between">
                        <p className="text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wide">
                            {data.extra.label}
                        </p>
                        <p className="text-2xl font-black text-teal-600 dark:text-teal-400 leading-none">
                            {data.extra.value}
                        </p>
                    </div>
                )}
            </div>
        </div>
    );
});

const SystemHealthBanner = memo(({ health }) => {
    const Icon = health.isError ? AlertTriangle : ShieldCheck;
    return (
        <div
            className={`relative overflow-hidden rounded-2xl border flex items-start gap-5 p-5
                ${health.isError
                    ? 'bg-amber-50/80 dark:bg-amber-900/15 border-amber-200 dark:border-amber-500/20 shadow-md shadow-amber-100/40 dark:shadow-black/20'
                    : 'bg-teal-50/60 dark:bg-teal-900/10 border-teal-200/70 dark:border-teal-500/15 shadow-md shadow-teal-100/30 dark:shadow-black/20'
                }`}
            style={{ animation: 'slideUp 0.5s ease-out 0.4s both' }}
        >
            <div className={`absolute left-0 top-0 bottom-0 w-1
                ${health.isError ? 'bg-gradient-to-b from-amber-400 to-orange-400' : 'bg-gradient-to-b from-teal-500 to-emerald-400'}`}
            />
            <div className={`absolute -bottom-6 -right-6 w-36 h-36 rounded-full blur-3xl pointer-events-none
                ${health.isError ? 'bg-amber-400/10' : 'bg-teal-400/10'}`}
            />
            <div className={`relative w-12 h-12 rounded-xl flex items-center justify-center shrink-0 shadow-md
                ${health.isError
                    ? 'bg-gradient-to-br from-amber-400 to-orange-400 shadow-amber-400/25'
                    : 'bg-gradient-to-br from-teal-500 to-emerald-400 shadow-teal-500/25'
                }`}>
                <Icon size={22} className="text-white" />
            </div>
            <div className="relative min-w-0 flex-1">
                <div className="flex items-center gap-2.5 mb-1.5">
                    <h4 className={`font-extrabold text-base tracking-tight
                        ${health.isError ? 'text-amber-900 dark:text-amber-200' : 'text-teal-900 dark:text-teal-100'}`}>
                        {health.status}
                    </h4>
                    {!health.isError && (
                        <span className="w-2 h-2 bg-teal-500 rounded-full animate-pulse shrink-0" />
                    )}
                </div>
                <p className={`text-sm font-medium leading-relaxed
                    ${health.isError ? 'text-amber-800 dark:text-amber-300' : 'text-teal-700 dark:text-teal-300'}`}>
                    {health.message}
                </p>
            </div>
        </div>
    );
});

const Dashboard = () => {
    const navigate    = useNavigate();
    const { currentUser } = useAuth();
    const { departments, systemHealth } = useDashboardData();

    const firstName   = currentUser?.firstName || 'Administrator';
    const greeting    = getGreeting();
    const activeCount = departments.filter(d => !d.isMissing).length;
    const currentDate = new Date().toLocaleDateString('en-US', {
        weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
    });

    return (
        <div className="min-h-screen depw-bg font-sans text-slate-900 dark:text-slate-100 transition-colors duration-300">
            <AdminSidebar />

            <main className="ml-0 md:ml-72 p-4 md:p-6 lg:p-10 pt-20 md:pt-10">

                <div
                    className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-5 mb-8"
                    style={{ animation: 'fadeIn 0.5s ease-out both' }}
                >
                    <div>
                        <div className="flex items-center gap-2 mb-3">
                            <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-teal-600 to-emerald-500 flex items-center justify-center shadow-md shadow-teal-500/30">
                                <ShieldCheck size={14} className="text-white" strokeWidth={2.5} />
                            </div>
                            <span className="text-xs font-extrabold uppercase tracking-[0.18em] text-teal-600 dark:text-emerald-400">
                                System Control
                            </span>
                        </div>
                        <h1 className="text-3xl sm:text-4xl font-black tracking-tight text-slate-900 dark:text-white leading-tight">
                            {greeting},&nbsp;
                            <span className="text-teal-600 dark:text-teal-400">{firstName}.</span>
                        </h1>
                        <p className="text-sm font-medium text-slate-500 dark:text-slate-400 mt-2">{currentDate}</p>
                    </div>

                    <button
                        onClick={() => navigate('/admin/accounts')}
                        className="w-full sm:w-auto flex items-center justify-center gap-2 bg-gradient-to-r from-teal-600 to-emerald-500 hover:from-teal-700 hover:to-emerald-600 text-white font-bold py-3 px-6 rounded-xl shadow-lg shadow-teal-500/25 transition-all duration-200 text-sm"
                    >
                        <Users size={17} />
                        Manage Accounts
                    </button>
                </div>

                <div className="mb-8">
                    <div className="flex items-center gap-3 mb-4" style={{ animation: 'slideUp 0.5s ease-out 0.1s both' }}>
                        <h2 className="text-xs font-extrabold text-slate-500 dark:text-slate-400 uppercase tracking-[0.18em] whitespace-nowrap">
                            Infrastructure Health
                        </h2>
                        <div className="h-px flex-1 bg-slate-200/80 dark:bg-slate-700/60" />
                    </div>
                    <SystemHealthBanner health={systemHealth} />
                </div>

                <div style={{ animation: 'slideUp 0.5s ease-out 0.25s both' }}>
                    <div className="flex items-center gap-3 mb-5">
                        <h2 className="text-xs font-extrabold text-slate-500 dark:text-slate-400 uppercase tracking-[0.18em] whitespace-nowrap">
                            Organizational Structure
                        </h2>
                        <div className="h-px flex-1 bg-slate-200/80 dark:bg-slate-700/60" />
                        <span className="text-xs font-bold text-slate-400 dark:text-slate-500 shrink-0">
                            {activeCount} / {departments.length} active
                        </span>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
                        {departments.map((dept, i) => (
                            <DepartmentCard key={dept.id} data={dept} index={i} />
                        ))}
                    </div>
                </div>

            </main>
        </div>
    );
};

export default Dashboard;