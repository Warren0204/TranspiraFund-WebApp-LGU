import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    Plus, FolderKanban, Search, Filter, MapPin, Clock, TrendingUp
} from 'lucide-react';
import DepwSidebar from '../../components/layout/DepwSidebar';
import { collection, query, orderBy, onSnapshot } from 'firebase/firestore';
import { db } from '../../config/firebase';
import { useDebounce } from '../../hooks/useDebounce';

const useProjectRegistry = () => {
    const navigate = useNavigate();
    const [projects, setProjects] = useState([]);
    const [loading, setLoading] = useState(true);
    const [statusFilter, setStatusFilter] = useState('All Status');
    const [searchTerm, setSearchTerm] = useState('');
    const [isFilterOpen, setIsFilterOpen] = useState(false);

    useEffect(() => {
        const q = query(collection(db, "projects"), orderBy("createdAt", "desc"));
        const unsubscribe = onSnapshot(q, (snapshot) => {
            const fetchedProjects = snapshot.docs.map(doc => {
                const data = doc.data();
                return {
                    id: doc.id,
                    name: data.projectTitle,
                    location: data.location,
                    status: data.status,
                    statusColor: getStatusMeta(data.status),
                    budget: data.budget,
                    progress: data.progress || 0,
                    meta: data.targetDate ? `Due ${new Date(data.targetDate).toLocaleDateString()}` : null
                };
            });
            setProjects(fetchedProjects);
            setLoading(false);
        }, () => { setLoading(false); });
        return () => unsubscribe();
    }, []);

    const formatCurrencyShort = (amount) => {
        if (!amount && amount !== 0) return '—';
        if (amount >= 1_000_000) return `₱${(amount / 1_000_000).toFixed(2)}M`;
        if (amount >= 1_000) return `₱${(amount / 1_000).toFixed(0)}K`;
        return `₱${amount.toLocaleString('en-PH')}`;
    };

    const getStatusMeta = (status) => {
        switch (status?.toLowerCase()) {
            case 'completed': return { pill: 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-500/30', bar: 'from-emerald-500 to-teal-400' };
            case 'ongoing': return { pill: 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-500/30', bar: 'from-blue-500 to-cyan-400' };
            case 'for mayor': return { pill: 'bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-500/30', bar: 'from-amber-400 to-yellow-400' };
            case 'returned': return { pill: 'bg-rose-100 dark:bg-rose-900/40 text-rose-700 dark:text-rose-300 border-rose-200 dark:border-rose-500/30', bar: 'from-rose-500 to-red-400' };
            case 'draft': return { pill: 'bg-slate-100 dark:bg-slate-700/60 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-600', bar: 'from-slate-400 to-slate-300' };
            default: return { pill: 'bg-slate-100 dark:bg-slate-700/60 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-600', bar: 'from-slate-400 to-slate-300' };
        }
    };

    const debouncedSearchTerm = useDebounce(searchTerm, 300);
    const filteredProjects = useMemo(() => {
        return projects.filter(project => {
            const matchesSearch =
                project.name?.toLowerCase().includes(debouncedSearchTerm.toLowerCase()) ||
                project.location?.toLowerCase().includes(debouncedSearchTerm.toLowerCase());
            const matchesStatus = statusFilter === 'All Status' || project.status === statusFilter;
            return matchesSearch && matchesStatus;
        });
    }, [projects, debouncedSearchTerm, statusFilter]);

    return {
        projects: filteredProjects, loading, searchTerm, setSearchTerm,
        statusFilter, setStatusFilter, isFilterOpen, setIsFilterOpen,
        formatCurrencyShort, navigate
    };
};

const LoaderSpinner = () => (
    <svg className="animate-spin h-8 w-8 text-blue-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
    </svg>
);

const ProjectRegistry = () => {
    const {
        projects, loading, searchTerm, setSearchTerm,
        statusFilter, setStatusFilter, isFilterOpen, setIsFilterOpen,
        formatCurrencyShort, navigate
    } = useProjectRegistry();

    const STATUS_OPTIONS = ['All Status', 'Draft', 'For Mayor', 'Ongoing', 'Returned', 'Completed'];

    return (
        <div className="min-h-screen depw-bg font-sans text-slate-900 dark:text-slate-100">
            <DepwSidebar />

            <main className="ml-0 md:ml-72 p-4 md:p-6 lg:p-10 pt-20 md:pt-10">

                <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-4 mb-8"
                    style={{ animation: 'fadeIn 0.4s ease-out both' }}>
                    <div>
                        <div className="inline-flex items-center gap-2 bg-blue-500/10 dark:bg-blue-500/20 border border-blue-500/20 dark:border-blue-400/30 rounded-full px-3 py-1 mb-3">
                            <div className="w-1.5 h-1.5 rounded-full bg-blue-500 dark:bg-blue-400" />
                            <span className="text-xs font-bold text-blue-700 dark:text-blue-300 uppercase tracking-widest">Infrastructure Mandates</span>
                        </div>
                        <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 dark:text-white tracking-tight">
                            Project Registry
                        </h1>
                        <p className="text-slate-500 dark:text-slate-400 font-medium mt-1 text-sm">
                            Manage infrastructure mandates and track approval status.
                        </p>
                    </div>
                    <div className="shrink-0">
                        <button onClick={() => navigate('/depw/create-project')}
                            className="w-full lg:w-auto bg-gradient-to-r from-blue-600 to-cyan-500 hover:from-blue-700 hover:to-cyan-600 text-white font-bold py-3.5 px-7 rounded-xl shadow-lg shadow-blue-500/25 hover:shadow-blue-500/35 transition-all flex items-center justify-center gap-2 text-sm">
                            <Plus size={18} strokeWidth={2.5} />
                            Initialize New Project
                        </button>
                    </div>
                </div>

                <div className="bg-white/70 dark:bg-slate-900/50 backdrop-blur-xl border border-white/80 dark:border-white/5 rounded-[24px] shadow-xl overflow-hidden min-h-[600px] flex flex-col"
                    style={{ animation: 'slideUp 0.5s ease-out 0.1s both' }}>

                    <div className="p-5 sm:p-6 border-b border-slate-200/60 dark:border-slate-700/40 flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3 bg-white/40 dark:bg-slate-800/20">
                        <div className="flex items-center gap-2.5 font-bold text-slate-700 dark:text-slate-200 shrink-0">
                            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500 to-cyan-500 flex items-center justify-center">
                                <FolderKanban size={15} className="text-white" />
                            </div>
                            Active Projects
                        </div>

                        <div className="flex gap-3 w-full sm:w-auto">
                            <div className="relative shrink-0">
                                <button onClick={() => setIsFilterOpen(!isFilterOpen)}
                                    className="flex items-center gap-2 px-4 py-3 bg-white/80 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-xl text-sm font-semibold text-slate-600 dark:text-slate-300 hover:bg-white dark:hover:bg-slate-800 transition-all">
                                    <Filter size={15} />
                                    <span className="hidden sm:inline">{statusFilter}</span>
                                </button>
                                {isFilterOpen && (
                                    <>
                                        <div className="fixed inset-0 z-10" onClick={() => setIsFilterOpen(false)} />
                                        <div className="absolute top-12 left-0 z-20 w-52 bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-700 rounded-2xl shadow-2xl py-2 animate-in fade-in zoom-in-95 duration-200">
                                            {STATUS_OPTIONS.map(status => (
                                                <button key={status}
                                                    onClick={() => { setStatusFilter(status); setIsFilterOpen(false); }}
                                                    className={`w-full text-left px-5 py-2.5 text-sm font-semibold transition-colors ${statusFilter === status ? 'text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20' : 'text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'}`}>
                                                    {status}
                                                </button>
                                            ))}
                                        </div>
                                    </>
                                )}
                            </div>

                            <div className="relative group flex-1 sm:w-72 sm:flex-none">
                                <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500 group-focus-within:text-blue-500 dark:group-focus-within:text-blue-400 transition-colors" size={17} />
                                <input type="text" placeholder="Search projects or location..." value={searchTerm}
                                    onChange={(e) => setSearchTerm(e.target.value)}
                                    className="w-full pl-11 pr-4 py-3 bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-xl text-sm font-medium text-slate-700 dark:text-slate-300 placeholder:text-slate-400 dark:placeholder:text-slate-600 focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400 outline-none transition-all" />
                            </div>
                        </div>
                    </div>

                    <div className="hidden md:grid grid-cols-12 px-7 py-3 bg-slate-50/70 dark:bg-slate-800/30 border-b border-slate-100 dark:border-slate-700/40 text-[11px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-[0.1em]">
                        <div className="col-span-7 lg:col-span-5">Project Identity</div>
                        <div className="col-span-5 lg:col-span-3">Status</div>
                        <div className="hidden lg:block lg:col-span-2">Budget</div>
                        <div className="hidden lg:block lg:col-span-2 text-right">Progress</div>
                    </div>

                    <div className="flex-1 overflow-auto p-4 space-y-2">
                        {loading ? (
                            <div className="flex flex-col items-center justify-center py-24 text-slate-400">
                                <LoaderSpinner />
                                <p className="mt-4 text-sm font-semibold animate-pulse dark:text-slate-500">Syncing Project Registry...</p>
                            </div>
                        ) : projects.length === 0 ? (
                            <div className="flex flex-col items-center justify-center py-24">
                                <div className="w-16 h-16 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center mb-4">
                                    <FolderKanban size={28} className="text-slate-300 dark:text-slate-600" />
                                </div>
                                <h3 className="text-base font-bold text-slate-500 dark:text-slate-400">No Projects Found</h3>
                                <p className="text-sm text-slate-400 dark:text-slate-500 mt-1">Initialize a new project to get started.</p>
                            </div>
                        ) : (
                            projects.map((project, i) => (
                                <div key={project.id}
                                    className="grid grid-cols-12 items-center px-4 sm:px-6 py-4 sm:py-5 bg-white/60 dark:bg-slate-800/30 border border-white/80 dark:border-slate-700/40 hover:bg-white/90 dark:hover:bg-slate-800/60 hover:border-blue-200 dark:hover:border-blue-500/30 hover:shadow-md rounded-2xl transition-all"
                                    style={{ animation: `slideUp 0.4s ease-out ${i * 0.06}s both` }}>

                                    <div className="col-span-8 md:col-span-7 lg:col-span-5 pr-3 min-w-0">
                                        <h4 className="font-bold text-slate-800 dark:text-slate-100 text-sm mb-1 line-clamp-1">{project.name}</h4>
                                        <div className="flex items-center gap-1.5 text-slate-400 dark:text-slate-500 text-xs">
                                            <MapPin size={11} className="shrink-0 text-blue-400" />
                                            <span className="truncate">Barangay {project.location}</span>
                                        </div>
                                    </div>

                                    <div className="col-span-4 md:col-span-5 lg:col-span-3 min-w-0">
                                        <span className={`inline-flex px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wide border ${project.statusColor.pill}`}>
                                            {project.status}
                                        </span>
                                        {project.meta && (
                                            <div className="hidden sm:flex items-center gap-1 text-[10px] text-slate-400 dark:text-slate-500 font-medium mt-1.5">
                                                <Clock size={10} />
                                                {project.meta}
                                            </div>
                                        )}
                                    </div>

                                    <div className="hidden lg:block lg:col-span-2 font-bold text-slate-700 dark:text-slate-200 text-sm">
                                        {formatCurrencyShort(project.budget)}
                                    </div>

                                    <div className="hidden lg:block lg:col-span-2">
                                        <div className="flex justify-between text-[10px] font-bold text-slate-400 dark:text-slate-500 mb-1.5">
                                            <div className="flex items-center gap-1">
                                                <TrendingUp size={10} />
                                                <span>Actual</span>
                                            </div>
                                            <span>{project.progress}%</span>
                                        </div>
                                        <div className="w-full bg-slate-100 dark:bg-slate-700/60 rounded-full h-2 overflow-hidden">
                                            <div className={`h-full rounded-full bg-gradient-to-r ${project.statusColor.bar} transition-all duration-700`}
                                                style={{ width: `${project.progress}%` }} />
                                        </div>
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                </div>
            </main>
        </div>
    );
};

export default ProjectRegistry;