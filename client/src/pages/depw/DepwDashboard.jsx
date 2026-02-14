import React from 'react';
import {
    Wallet, Users, FolderKanban, ArrowRight, AlertTriangle, AlertCircle, HardHat
} from 'lucide-react';
import DepwSidebar from '../../components/layout/DepwSidebar';

import { useState, useEffect } from 'react';
import { collection, query, where, onSnapshot, orderBy, limit } from 'firebase/firestore';
import { db } from '../../config/firebase';
import { ROLES } from '../../config/roles';

const DepwDashboard = () => {
    // --- REAL-TIME DATA LOGIC ---
    const [stats, setStats] = useState({
        budget: 0,
        engineers: 0,
        projects: 0
    });
    const [recentProjects, setRecentProjects] = useState([]);
    const [statusDist, setStatusDist] = useState({ active: 0, mayor: 0, done: 0 });
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        // 1. Fetch Active Engineers (Matches StaffManagement Logic)
        const unsubEngineers = onSnapshot(
            query(collection(db, "users"), orderBy("createdAt", "desc")),
            (snapshot) => {
                // Client-side filter for robust matching (PROJ_ENG / Project Engineer)
                const count = snapshot.docs.filter(doc => {
                    const r = doc.data().role;
                    return r === ROLES.PROJECT_ENGINEER || r === 'Project Engineer' || r === 'PROJ_ENG';
                }).length;

                setStats(prev => ({ ...prev, engineers: count }));
            }
        );

        // 2. Fetch Projects (Budget & Counts)
        const unsubProjects = onSnapshot(
            query(collection(db, "projects"), orderBy("createdAt", "desc")),
            (snapshot) => {
                const projectsData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

                // Calculate Stats
                const totalBudget = projectsData.reduce((acc, curr) => acc + (Number(curr.budget) || 0), 0);
                const totalCount = projectsData.length;

                // Calculate Distribution
                const dist = { active: 0, mayor: 0, done: 0 };
                projectsData.forEach(p => {
                    const s = (p.status || '').toUpperCase();
                    if (s === 'COMPLETED') dist.done++;
                    else if (s.includes('MAYOR')) dist.mayor++;
                    else dist.active++;
                });

                // Update State
                setStats(prev => ({
                    ...prev,
                    budget: totalBudget,
                    projects: totalCount
                }));
                setRecentProjects(projectsData.slice(0, 5)); // Top 5 recent
                setStatusDist(dist);
                setLoading(false);
            }
        );

        return () => {
            unsubEngineers();
            unsubProjects();
        };
    }, []);

    // Helper for formatting currency
    const formatPHP = (val) => new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format(val);

    // Dynamic Stats Array
    const statCards = [
        { label: 'Total Budget', value: formatPHP(stats.budget), icon: Wallet, color: 'bg-blue-600' },
        { label: 'Active Engineers', value: stats.engineers.toString(), icon: HardHat, color: 'bg-indigo-500' },
        { label: 'Total Projects', value: stats.projects.toString(), icon: FolderKanban, color: 'bg-emerald-500' },
    ];

    return (
        <div className="min-h-screen bg-slate-50 font-sans text-slate-900">
            <DepwSidebar />

            <main className="ml-0 md:ml-72 p-4 md:p-10 max-w-[1600px] mx-auto">

                {/* HEADLINE & ACTIONS */}
                <div className="flex justify-between items-end mb-8">
                    <div>
                        <h1 className="text-3xl font-extrabold text-slate-900 tracking-tight flex items-center gap-3">
                            <FolderKanban className="text-blue-600" size={32} />
                            Engineering Command
                        </h1>
                        <p className="text-slate-500 font-medium mt-1">
                            Real-time infrastructure monitoring and resource allocation.
                        </p>
                    </div>
                    <div className="flex gap-3">
                        <button className="bg-slate-800 hover:bg-slate-900 text-white font-bold py-2.5 px-5 rounded-xl shadow-lg transition-all flex items-center gap-2 text-sm">
                            <Users size={18} />
                            Field Staff
                        </button>
                        <button className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-2.5 px-5 rounded-xl shadow-lg shadow-blue-600/20 transition-all flex items-center gap-2 text-sm">
                            <FolderKanban size={18} />
                            Projects
                        </button>
                    </div>
                </div>

                {/* STATS ROW */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
                    {statCards.map((stat, i) => (
                        <div key={i} className="bg-white p-6 rounded-[24px] border border-slate-100 shadow-sm flex items-center gap-5 hover:shadow-md transition-shadow">
                            <div className={`w-14 h-14 rounded-2xl ${stat.color} text-white flex items-center justify-center shadow-lg shadow-blue-600/10`}>
                                <stat.icon size={26} strokeWidth={2.5} />
                            </div>
                            <div>
                                <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">{stat.label}</p>
                                <h3 className="text-2xl font-extrabold text-slate-900">{stat.value}</h3>
                            </div>
                        </div>
                    ))}
                </div>

                <div className="flex flex-col lg:flex-row gap-8">

                    {/* LEFT: ACTIVE REGISTRY (Table) */}
                    <div className="lg:w-8/12 bg-white rounded-[24px] border border-slate-100 shadow-sm p-8 min-h-[500px]">
                        <div className="flex justify-between items-center mb-8">
                            <h3 className="flex items-center gap-2 font-bold text-slate-900 text-lg">
                                <FolderKanban size={20} className="text-slate-400" />
                                Active Registry
                            </h3>
                            <button className="text-sm font-bold text-blue-600 hover:bg-blue-50 px-3 py-1.5 rounded-lg transition-colors flex items-center gap-1">
                                View All <ArrowRight size={14} />
                            </button>
                        </div>

                        {/* TABLE HEADER */}
                        <div className="grid grid-cols-12 text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-4 px-4">
                            <div className="col-span-5">Project Name</div>
                            <div className="col-span-3">Location</div>
                            <div className="col-span-2">Status</div>
                            <div className="col-span-2 text-right">Progress</div>
                        </div>

                        {/* LIST */}
                        <div className="space-y-2">
                            {recentProjects.length === 0 ? (
                                <div className="text-center py-20 text-slate-400 italic">
                                    No active projects found.
                                </div>
                            ) : (
                                recentProjects.map((project, i) => (
                                    <div key={i} className="grid grid-cols-12 items-center px-4 py-4 rounded-xl border border-slate-100 hover:border-blue-200 hover:shadow-sm transition-all group">
                                        <div className="col-span-5 font-bold text-slate-800 text-sm truncate pr-2">
                                            {project.projectTitle || project.name || 'Untitled Project'}
                                        </div>
                                        <div className="col-span-3 text-sm text-slate-500 font-medium truncate pr-2">
                                            {project.location || 'Unknown'}
                                        </div>
                                        <div className="col-span-2">
                                            <span className={`inline-block px-2.5 py-1 rounded-md text-[10px] font-bold uppercase tracking-wide ${(project.status || '').includes('ONGOING')
                                                ? 'bg-blue-100 text-blue-700'
                                                : 'bg-amber-100 text-amber-700'
                                                }`}>
                                                {project.status || 'DRAFT'}
                                            </span>
                                        </div>
                                        <div className="col-span-2 flex items-center justify-end gap-3">
                                            <div className="w-16 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                                                <div
                                                    className={`h-full rounded-full ${project.progress > 0 ? 'bg-blue-600' : 'bg-slate-300'}`}
                                                    style={{ width: `${project.progress || 0}%` }}
                                                />
                                            </div>
                                            <span className="text-xs font-bold text-slate-600 w-8 text-right">{project.progress || 0}%</span>
                                        </div>
                                    </div>
                                ))
                            )}
                        </div>
                    </div>

                    {/* RIGHT: ALERTS & CHARTS */}
                    <div className="lg:w-4/12 space-y-6">

                        {/* ALERTS */}
                        <div className="bg-white rounded-[24px] border border-slate-100 shadow-sm p-6 relative overflow-hidden">
                            <div className="absolute top-0 right-0 w-32 h-32 bg-red-50 rounded-full -mr-16 -mt-16 blur-2xl opacity-50"></div>

                            <div className="flex justify-between items-center mb-6 relative">
                                <h3 className="font-bold text-slate-900 flex items-center gap-2">
                                    <AlertTriangle size={18} className="text-red-500" />
                                    Slippage Alerts
                                </h3>
                                <span className="bg-red-100 text-red-600 text-[10px] font-bold px-2 py-0.5 rounded-full">0 Critical</span>
                            </div>

                            <div className="text-center py-8 text-xs text-slate-400 font-medium">
                                No critical alerts detected.
                            </div>
                        </div>

                        {/* CHART (Visual Only) */}
                        <div className="bg-white rounded-[24px] border border-slate-100 shadow-sm p-6 h-64 flex flex-col">
                            <h3 className="font-bold text-slate-900 mb-6 flex items-center gap-2">
                                <AlertCircle size={18} className="text-blue-500" />
                                Status Distribution
                            </h3>

                            <div className="flex-1 flex flex-col justify-center gap-4 px-2">
                                {/* Bar 1: Active */}
                                <div className="space-y-1">
                                    <div className="flex justify-between text-[10px] font-bold text-slate-400 uppercase">
                                        <span>Active</span>
                                        <span>{stats.projects > 0 ? Math.round((statusDist.active / stats.projects) * 100) : 0}%</span>
                                    </div>
                                    <div className="w-full bg-slate-100 rounded-full h-2 overflow-hidden">
                                        <div
                                            className="bg-cyan-500 h-full rounded-full transition-all duration-1000"
                                            style={{ width: `${stats.projects > 0 ? (statusDist.active / stats.projects) * 100 : 0}%` }}
                                        />
                                    </div>
                                </div>

                                {/* Bar 2: For Mayor */}
                                <div className="space-y-1">
                                    <div className="flex justify-between text-[10px] font-bold text-slate-400 uppercase">
                                        <span>For Mayor</span>
                                        <span>{stats.projects > 0 ? Math.round((statusDist.mayor / stats.projects) * 100) : 0}%</span>
                                    </div>
                                    <div className="w-full bg-slate-100 rounded-full h-2 overflow-hidden">
                                        <div
                                            className="bg-amber-500 h-full rounded-full transition-all duration-1000"
                                            style={{ width: `${stats.projects > 0 ? (statusDist.mayor / stats.projects) * 100 : 0}%` }}
                                        />
                                    </div>
                                </div>

                                {/* Bar 3: Done */}
                                <div className="space-y-1">
                                    <div className="flex justify-between text-[10px] font-bold text-slate-400 uppercase">
                                        <span>Done</span>
                                        <span>{stats.projects > 0 ? Math.round((statusDist.done / stats.projects) * 100) : 0}%</span>
                                    </div>
                                    <div className="w-full bg-slate-100 rounded-full h-2 overflow-hidden">
                                        <div
                                            className="bg-emerald-500 h-full rounded-full transition-all duration-1000"
                                            style={{ width: `${stats.projects > 0 ? (statusDist.done / stats.projects) * 100 : 0}%` }}
                                        />
                                    </div>
                                </div>
                            </div>
                        </div>

                    </div>
                </div>

            </main>
        </div>
    );
};

export default DepwDashboard;
