import {
  ShieldCheck, LayoutDashboard, Users,
  FileText, HardHat, Map, AlertTriangle
} from 'lucide-react';
import React, { memo, useEffect, useState } from 'react';
import { collection, query, where, onSnapshot } from 'firebase/firestore';
import { db } from '../../config/firebase';
import AdminSidebar from '../../components/layout/AdminSidebar';


const useDashboardData = () => {
  const [departments, setDepartments] = useState([]);
  const [systemHealth, setSystemHealth] = useState({
    status: "Loading...",
    message: "Analyzing system configuration...",
    isError: false
  });

  useEffect(() => {
    // Live Listener for Real-Time Updates
    const q = query(collection(db, "users"));

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const users = snapshot.docs.map(doc => doc.data());

      // Helper to find active user by role
      const findUser = (role) => users.find(u => u.role === role);

      const mayorUser = findUser('MAYOR');
      const depwUser = findUser('DEPW');
      const cpdoUser = findUser('CPDO');

      // Construct Department Data dynamically
      const newDepartments = [
        {
          id: 'mayor',
          title: "Mayor's Office",
          role: "APPROVER",
          icon: <FileText size={24} className={mayorUser ? "text-green-600" : "text-slate-400"} />,
          color: mayorUser ? "bg-green-100" : "bg-slate-200",
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
          icon: <HardHat size={24} className={depwUser ? "text-green-600" : "text-slate-400"} />,
          color: depwUser ? "bg-green-100" : "bg-slate-200",
          status: depwUser ? "Active" : "Required",
          isMissing: !depwUser,
          details: [
            {
              label: "Department Head",
              value: depwUser ? `${depwUser.firstName} ${depwUser.lastName}` : "Not Assigned",
              isError: !depwUser
            },
            { label: "Field Engineers", value: "0 Active", isHighlight: true } // Placeholder for future feature
          ]
        },
        {
          id: 'cpdo',
          title: "City Planning",
          role: "CPDO",
          icon: <Map size={24} className={cpdoUser ? "text-green-600" : "text-slate-400"} />,
          color: cpdoUser ? "bg-green-100" : "bg-slate-200",
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

      // System Health Logic
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

// --- 🧩 UI COMPONENTS ---

// --- 🧩 UI COMPONENTS ---

const DepartmentCard = memo(({ data }) => {
  const containerClass = data.isMissing
    ? "bg-red-50/50 p-6 rounded-[32px] border border-red-50 hover:border-red-100 shadow-sm transition-all"
    : "bg-white p-6 rounded-[32px] border border-slate-100 shadow-sm hover:shadow-md transition-shadow";

  const badgeClass = data.isMissing
    ? "bg-red-100 text-red-600 border border-red-200"
    : "bg-green-50 text-green-700 border border-green-100";

  return (
    <div className={containerClass}>
      <div className="flex justify-between items-start mb-6">
        <div className="flex items-center gap-4">
          <div className={`w-12 h-12 rounded-2xl flex items-center justify-center shadow-sm ${data.color}`}>
            {data.icon}
          </div>
          <div>
            <h3 className="text-lg font-bold text-slate-900">{data.title}</h3>
            <p className="text-xs font-bold text-slate-400 uppercase tracking-wide">{data.role}</p>
          </div>
        </div>
        <div className={`px-3 py-1 rounded-full text-[10px] font-bold flex items-center gap-1 uppercase tracking-wider ${badgeClass}`}>
          {data.isMissing ? <AlertTriangle size={10} /> : null} {data.status}
        </div>
      </div>
      <div className="space-y-4">
        {data.details.map((detail, idx) => (
          <div key={idx} className="flex justify-between items-center text-sm border-b border-black/5 last:border-0 pb-3 last:pb-0">
            <span className="text-slate-500 font-medium">{detail.label}</span>
            <span className={`font-semibold ${detail.isError ? 'text-slate-400 italic' : detail.isHighlight ? 'bg-white text-slate-900 px-2 py-0.5 rounded text-xs shadow-sm font-bold' : 'text-slate-900'}`}>
              {detail.value}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
});

const NetworkHealth = memo(({ health }) => {
  const containerClass = health.isError
    ? "bg-orange-50/50 border border-orange-100 p-6 flex items-start gap-4 rounded-2xl"
    : "bg-green-50 border border-green-100 p-6 flex items-start gap-4 rounded-2xl";

  const iconBg = health.isError ? "bg-orange-100 text-orange-500" : "bg-green-100 text-green-600";
  const titleClass = health.isError ? "text-orange-900" : "text-green-900";
  const descClass = health.isError ? "text-orange-800" : "text-green-700";
  const Icon = health.isError ? AlertTriangle : ShieldCheck;

  return (
    <div className="bg-white p-8 rounded-[32px] border border-slate-100 shadow-sm mt-8">
      <h3 className="flex items-center gap-2 text-slate-900 font-bold mb-6">
        <LayoutDashboard size={20} className="text-blue-600" />
        Infrastructure Network Health
      </h3>
      <div className={containerClass}>
        <div className={`p-2 rounded-full shrink-0 ${iconBg}`}>
          <Icon size={24} />
        </div>
        <div>
          <h4 className={`font-bold text-lg mb-1 ${titleClass}`}>{health.status}</h4>
          <p className={`text-sm ${descClass}`}>
            {health.message.split('Account Management').map((part, i, arr) => (
              <span key={i}>
                {part}
                {i < arr.length - 1 && <span className="font-bold text-orange-700">Account Management</span>}
              </span>
            ))}
          </p>
        </div>
      </div>
    </div>
  );
});

const Dashboard = () => {
  const { departments, systemHealth } = useDashboardData();

  return (
    <div className="min-h-screen bg-slate-50 font-sans text-slate-900">

      {/* ✅ Pass navigation props and current path to Sidebar */}
      <AdminSidebar />

      <main className="ml-0 md:ml-72 p-4 md:p-10 max-w-[1600px] mx-auto">
        <header className="mb-10">
          <div className="flex items-center gap-3 mb-2">
            <LayoutDashboard className="text-blue-600" size={28} />
            <h1 className="text-3xl font-extrabold text-slate-900 tracking-tight">Dashboard</h1>
          </div>
          <p className="text-slate-500 font-medium">
            Local Government • <span className="text-slate-400">Organizational Structure Status</span>
          </p>
        </header>

        <section className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          {departments.map((dept) => (
            <DepartmentCard key={dept.id} data={dept} />
          ))}
        </section>

        <section>
          <NetworkHealth health={systemHealth} />
        </section>
      </main>
    </div>
  );
};

export default Dashboard;