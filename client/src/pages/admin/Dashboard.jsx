import {
  ShieldCheck, LayoutDashboard, Users,
  FileText, HardHat, Map, AlertTriangle, CheckCircle2, Activity
} from 'lucide-react';
import React, { memo, useEffect, useState, useMemo } from 'react';
import { collection, query, onSnapshot } from 'firebase/firestore';
import { db } from '../../config/firebase';
import AdminSidebar from '../../components/layout/AdminSidebar';

// --- LOGIC LAYER (Unchanged) ---
const useDashboardData = () => {
  const [departments, setDepartments] = useState([]);
  const [systemHealth, setSystemHealth] = useState({
    status: "Loading...",
    message: "Analyzing system configuration...",
    isError: false
  });

  useEffect(() => {
    const q = query(collection(db, "users"));

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const users = snapshot.docs.map(doc => doc.data());

      const findUser = (role) => users.find(u => u.role === role);

      const mayorUser = findUser('MAYOR');
      const depwUser = findUser('DEPW');
      const cpdoUser = findUser('CPDO');

      const engineerCount = users.filter(u => u.role === 'PROJ_ENG').length;

      const newDepartments = [
        {
          id: 'mayor',
          title: "Mayor's Office",
          role: "APPROVER",
          status: mayorUser ? "Active" : "Required",
          isMissing: !mayorUser,
          details: [{
            label: "Designated User",
            value: mayorUser ? `${mayorUser.firstName} ${mayorUser.lastName}` : "Not Provisioned",
            isError: !mayorUser
          }]
        },
        {
          id: 'depw',
          title: "Engineering",
          role: "DEPW",
          status: depwUser ? "Active" : "Required",
          isMissing: !depwUser,
          details: [
            {
              label: "Department Head",
              value: depwUser ? `${depwUser.firstName} ${depwUser.lastName}` : "Not Assigned",
              isError: !depwUser
            },
            { label: "Field Engineers", value: `${engineerCount} Active`, isHighlight: true }
          ]
        },
        {
          id: 'cpdo',
          title: "City Planning",
          role: "CPDO",
          status: cpdoUser ? "Active" : "Required",
          isMissing: !cpdoUser,
          details: [{
            label: "Department Head",
            value: cpdoUser ? `${cpdoUser.firstName} ${cpdoUser.lastName}` : "Not Assigned",
            isError: !cpdoUser
          }]
        }
      ];

      setDepartments(newDepartments);

      const missingCount = newDepartments.filter(d => d.isMissing).length;
      if (missingCount > 0) {
        setSystemHealth({
          status: "Configuration Incomplete",
          message: `${missingCount} key account(s) are missing. Please go to Account Management to provision them.`,
          isError: true
        });
      } else {
        setSystemHealth({
          status: "System Fully Operational",
          message: "All departmental accounts are provisioned and active.",
          isError: false
        });
      }
    });

    return () => unsubscribe();
  }, []);

  return { departments, systemHealth };
};

// --- SUB-COMPONENTS ---

const GridPattern = memo(() => (
  <svg className="absolute inset-0 w-full h-full opacity-[0.03]" aria-hidden="true">
    <defs>
      <pattern id="dashboard-grid" width="60" height="60" patternUnits="userSpaceOnUse">
        <path d="M 60 0 L 0 0 0 60" fill="none" stroke="#0F766E" strokeWidth="0.5" />
      </pattern>
    </defs>
    <rect width="100%" height="100%" fill="url(#dashboard-grid)" />
  </svg>
));

const DEPT_ICONS = {
  mayor: FileText,
  depw: HardHat,
  cpdo: Map
};

const DepartmentCard = memo(({ data }) => {
  const Icon = DEPT_ICONS[data.id] || FileText;

  return (
    <div className={`relative overflow-hidden rounded-2xl border transition-all duration-300 hover:-translate-y-0.5 hover:shadow-lg group ${data.isMissing
      ? 'bg-amber-50/50 border-amber-200/60 hover:shadow-amber-100/50'
      : 'bg-white border-slate-200/80 hover:shadow-teal-100/50 hover:border-teal-300/60'
      }`}>
      {/* Top accent bar */}
      <div className={`h-1 w-full ${data.isMissing ? 'bg-amber-400' : 'bg-teal-600'}`} />

      <div className="p-5">
        {/* Header — icon + title + badge */}
        <div className="flex items-start gap-3 mb-4">
          <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 transition-colors duration-300 ${data.isMissing
            ? 'bg-amber-100 text-amber-600'
            : 'bg-teal-50 text-teal-700 group-hover:bg-teal-700 group-hover:text-white'
            }`}>
            <Icon size={18} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-[15px] font-bold text-slate-800 tracking-tight truncate">{data.title}</h3>
              <div className={`shrink-0 px-2 py-0.5 rounded-md text-[9px] font-bold flex items-center gap-1 uppercase tracking-wider ${data.isMissing
                ? 'bg-amber-100 text-amber-700 border border-amber-200'
                : 'bg-teal-50 text-teal-700 border border-teal-200/60'
                }`}>
                {data.isMissing ? <AlertTriangle size={9} /> : <CheckCircle2 size={9} />} {data.status}
              </div>
            </div>
            <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest mt-0.5">{data.role}</p>
          </div>
        </div>

        {/* Detail rows */}
        <div className="space-y-2.5">
          {data.details.map((detail, idx) => (
            <div key={idx} className="flex items-baseline justify-between gap-2 text-sm border-b border-slate-100 last:border-0 pb-2.5 last:pb-0">
              <span className="text-slate-400 font-medium text-xs shrink-0">{detail.label}</span>
              <span className={`font-semibold text-right truncate ${detail.isError
                ? 'text-amber-600 italic text-xs'
                : detail.isHighlight
                  ? 'bg-slate-50 text-slate-700 px-2 py-0.5 rounded-md text-xs border border-slate-200 font-bold'
                  : 'text-slate-800 text-sm'
                }`}>
                {detail.value}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
});

const StatCard = memo(({ icon: Icon, label, value, accent = false }) => (
  <div className={`flex items-center gap-3 px-4 py-3.5 rounded-xl border transition-all duration-300 ${accent
    ? 'bg-teal-50 border-teal-200/60'
    : 'bg-white border-slate-200/80'
    }`}>
    <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${accent ? 'bg-teal-700 text-white' : 'bg-slate-100 text-slate-500'
      }`}>
      <Icon size={16} />
    </div>
    <div className="min-w-0">
      <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider truncate">{label}</p>
      <p className="text-xl font-black text-slate-800 tracking-tight">{value}</p>
    </div>
  </div>
));

const SystemHealthBanner = memo(({ health }) => {
  const Icon = health.isError ? AlertTriangle : ShieldCheck;

  return (
    <div className={`flex items-start gap-4 p-5 rounded-xl border transition-all ${health.isError
      ? 'bg-amber-50/60 border-amber-200/60'
      : 'bg-teal-50/60 border-teal-200/60'
      }`}>
      <div className={`p-2.5 rounded-xl shrink-0 ${health.isError ? 'bg-amber-100 text-amber-600' : 'bg-teal-100 text-teal-700'
        }`}>
        <Icon size={20} />
      </div>
      <div className="min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <h4 className={`font-bold text-[15px] ${health.isError ? 'text-amber-900' : 'text-teal-900'}`}>
            {health.status}
          </h4>
          {!health.isError && (
            <span className="w-2 h-2 bg-teal-500 rounded-full animate-pulse" aria-hidden="true" />
          )}
        </div>
        <p className={`text-sm leading-relaxed ${health.isError ? 'text-amber-800' : 'text-teal-700'}`}>
          {health.message.split('Account Management').map((part, i, arr) => (
            <span key={i}>
              {part}
              {i < arr.length - 1 && (
                <span className={`font-bold ${health.isError ? 'text-amber-900' : 'text-teal-800'}`}>
                  Account Management
                </span>
              )}
            </span>
          ))}
        </p>
      </div>
    </div>
  );
});

// --- MAIN PAGE ---
const Dashboard = () => {
  const { departments, systemHealth } = useDashboardData();

  const summaryStats = useMemo(() => {
    const total = departments.length;
    const active = departments.filter(d => !d.isMissing).length;
    const pending = departments.filter(d => d.isMissing).length;
    return { total, active, pending };
  }, [departments]);

  const currentDate = useMemo(() => {
    return new Date().toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
  }, []);

  return (
    <div className="min-h-screen bg-[#F8FAFC] font-sans text-slate-800">
      <AdminSidebar />

      <main className="ml-0 md:ml-72 p-4 md:p-6 lg:p-10 max-w-[1600px] mx-auto pt-16 md:pt-6 lg:pt-10">

        {/* Header with grid texture */}
        <header className="relative mb-6 lg:mb-8 overflow-hidden rounded-2xl bg-white border border-slate-200/80 p-5 md:p-6 lg:p-8">
          <GridPattern />
          <div className="absolute top-0 right-0 w-40 md:w-60 h-40 md:h-60 bg-teal-100/20 rounded-full blur-[80px] pointer-events-none" aria-hidden="true" />

          <div className="relative z-10">
            <div className="flex items-center gap-2 mb-1">
              <Activity size={13} className="text-teal-700" />
              <span className="text-[11px] font-semibold text-teal-700 tracking-widest uppercase">System Overview</span>
            </div>
            <h1 className="text-2xl lg:text-3xl font-extrabold text-slate-800 tracking-tight mb-1">
              MIS Dashboard
            </h1>
            <p className="text-slate-400 text-sm font-medium">{currentDate}</p>
          </div>
        </header>

        {/* Summary stats row — 1 col mobile, 3 col from sm+ */}
        <section className="grid grid-cols-3 gap-2 sm:gap-3 mb-6" aria-label="Account statistics">
          <StatCard icon={Users} label="Total Departments" value={summaryStats.total} accent />
          <StatCard icon={CheckCircle2} label="Active" value={summaryStats.active} />
          <StatCard icon={AlertTriangle} label="Pending Setup" value={summaryStats.pending} />
        </section>

        {/* Department cards — 1 col mobile, 2 col tablet, 3 col desktop */}
        <section aria-label="Departmental status">
          <div className="flex items-center gap-2 mb-4">
            <h2 className="text-sm font-bold text-slate-800 tracking-tight whitespace-nowrap">Organizational Structure</h2>
            <div className="h-px flex-1 bg-slate-200/60" />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {departments.map((dept) => (
              <DepartmentCard key={dept.id} data={dept} />
            ))}
          </div>
        </section>

        {/* System health */}
        <section className="mt-6" aria-label="Infrastructure health">
          <div className="flex items-center gap-2 mb-4">
            <h2 className="text-sm font-bold text-slate-800 tracking-tight whitespace-nowrap">Infrastructure Health</h2>
            <div className="h-px flex-1 bg-slate-200/60" />
          </div>
          <SystemHealthBanner health={systemHealth} />
        </section>

      </main>
    </div>
  );
};

export default Dashboard;