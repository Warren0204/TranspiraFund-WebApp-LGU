import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    Plus, FolderKanban, Search, Filter, MapPin, Clock, TrendingUp
} from 'lucide-react';
import HcsdSidebar from '../../components/layout/HcsdSidebar';
import { collection, query, where, orderBy, onSnapshot } from 'firebase/firestore';
import { db } from '../../config/firebase';
import { useDebounce } from '../../hooks/useDebounce';
import { useAuth } from '../../context/AuthContext';

const useProjectRegistry = () => {
    const navigate = useNavigate();
    const { tenantId } = useAuth();
    const [projects, setProjects] = useState([]);
    const [loading, setLoading] = useState(true);
    const [statusFilter, setStatusFilter] = useState('All Status');
    const [searchTerm, setSearchTerm] = useState('');
    const [isFilterOpen, setIsFilterOpen] = useState(false);

    useEffect(() => {
        if (!tenantId) return;
        const q = query(
            collection(db, "projects"),
            where("tenantId", "==", tenantId),
            orderBy("createdAt", "desc"),
        );
        const unsubscribe = onSnapshot(q, (snapshot) => {
            const fetchedProjects = snapshot.docs.map(doc => {
                const data = doc.data();
                return {
                    id: doc.id,
                    name: data.projectName,
                    barangay: data.barangay,
                    status: normalizeStatus(data.status),
                    statusColor: getStatusMeta(data.status),
                    contractAmount: data.contractAmount,
                    progress: data.actualPercent || data.progress || 0,
                    contractor: data.contractor || null,
                    originalDateCompletion: data.originalDateCompletion || null,
                };
            });
            setProjects(fetchedProjects);
            setLoading(false);
        }, (error) => {
            console.error('[ProjectRegistry/projects] snapshot listener error:', error);
            setLoading(false);
        });
        return () => unsubscribe();
    }, [tenantId]);

    const formatCurrencyShort = (amount) => {
        if (!amount && amount !== 0) return '—';
        if (amount >= 1_000_000) return `₱${(amount / 1_000_000).toFixed(2)}M`;
        if (amount >= 1_000) return `₱${(amount / 1_000).toFixed(0)}K`;
        return `₱${amount.toLocaleString('en-PH')}`;
    };

    const normalizeStatus = (status) => {
        const s = (status || '').toLowerCase();
        if (s === 'completed') return 'Completed';
        if (s === 'ongoing') return 'Ongoing';
        if (s === 'delayed') return 'Delayed';
        if (s === 'draft') return 'Ongoing'; // legacy → Ongoing
        return 'Delayed';
    };

    const getStatusMeta = (status) => {
        switch (normalizeStatus(status).toLowerCase()) {
            case 'completed': return { pill: 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-500/30', bar: 'from-emerald-500 to-teal-400' };
            case 'ongoing':   return { pill: 'bg-teal-100 dark:bg-teal-900/40 text-teal-700 dark:text-teal-300 border-teal-200 dark:border-teal-500/30', bar: 'from-teal-500 to-emerald-400' };
            case 'delayed':   return { pill: 'bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-500/30', bar: 'from-amber-400 to-yellow-300' };
            default:          return { pill: 'bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-500/30', bar: 'from-amber-400 to-yellow-300' };
        }
    };

    const debouncedSearchTerm = useDebounce(searchTerm, 300);
    const filteredProjects = useMemo(() => {
        return projects.filter(project => {
            const matchesSearch =
                project.name?.toLowerCase().includes(debouncedSearchTerm.toLowerCase()) ||
                project.barangay?.toLowerCase().includes(debouncedSearchTerm.toLowerCase()) ||
                project.contractor?.toLowerCase().includes(debouncedSearchTerm.toLowerCase());
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
    <svg className="animate-spin h-8 w-8 text-teal-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
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

    const STATUS_OPTIONS = ['All Status', 'Delayed', 'Ongoing', 'Completed'];

    return (
        <div className="min-h-screen hcsd-bg font-sans text-slate-900 dark:text-slate-100">
            <HcsdSidebar />

            <main className="ml-0 md:ml-72 p-4 md:p-6 lg:p-10 pt-20 md:pt-10">

                <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4 mb-8"
                    style={{ animation: 'fadeIn 0.4s ease-out both' }}>
                    <div>
                        <div className="inline-flex items-center gap-2 bg-teal-500/10 dark:bg-teal-500/20 border border-teal-500/20 dark:border-teal-400/30 rounded-full px-3 py-1 mb-3">
                            <div className="w-1.5 h-1.5 rounded-full bg-teal-500 dark:bg-teal-400 shrink-0" />
                            <span className="text-xs font-bold text-teal-700 dark:text-teal-300 uppercase tracking-widest whitespace-nowrap">Infrastructure Mandates</span>
                        </div>
                        <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 dark:text-white tracking-tight">
                            Project Registry
                        </h1>
                        <p className="text-slate-500 dark:text-slate-400 font-medium mt-1 text-sm">
                            Manage infrastructure mandates and track approval status.
                        </p>
                    </div>
                    <div className="shrink-0">
                        <button onClick={() => navigate('/hcsd/create-project')}
                            className="w-full md:w-auto bg-gradient-to-r from-teal-600 to-emerald-500 hover:from-teal-700 hover:to-emerald-600 text-white font-bold py-3.5 px-7 rounded-xl shadow-lg shadow-teal-500/25 hover:shadow-teal-500/35 transition-all flex items-center justify-center gap-2 text-sm">
                            <Plus size={18} strokeWidth={2.5} />
                            Initialize New Project
                        </button>
                    </div>
                </div>

                <div className="bg-white/70 dark:bg-slate-900/50 backdrop-blur-xl border border-white/80 dark:border-white/5 rounded-[24px] shadow-xl overflow-hidden"
                    style={{ animation: 'slideUp 0.5s ease-out 0.1s both' }}>

                    <div className="p-4 sm:p-5 border-b border-slate-200/60 dark:border-slate-700/40 flex flex-col gap-3 bg-white/40 dark:bg-slate-800/20">
                        {/* Row 1: title */}
                        <div className="flex items-center gap-2.5 font-bold text-slate-700 dark:text-slate-200">
                            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-teal-500 to-emerald-400 flex items-center justify-center shrink-0">
                                <FolderKanban size={15} className="text-white" />
                            </div>
                            Active Projects
                        </div>

                        {/* Row 2: filter + search — always full-width row */}
                        <div className="flex gap-2 w-full">
                            <div className="relative shrink-0">
                                <button onClick={() => setIsFilterOpen(!isFilterOpen)}
                                    className="flex items-center gap-2 px-3 py-2.5 bg-white/80 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-xl text-sm font-semibold text-slate-600 dark:text-slate-300 hover:bg-white dark:hover:bg-slate-800 transition-all whitespace-nowrap">
                                    <Filter size={15} />
                                    <span>{statusFilter}</span>
                                </button>
                                {isFilterOpen && (
                                    <>
                                        <div className="fixed inset-0 z-10" onClick={() => setIsFilterOpen(false)} />
                                        <div className="absolute top-11 left-0 z-20 w-48 bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-700 rounded-2xl shadow-2xl py-2 animate-in fade-in zoom-in-95 duration-200">
                                            {STATUS_OPTIONS.map(status => (
                                                <button key={status}
                                                    onClick={() => { setStatusFilter(status); setIsFilterOpen(false); }}
                                                    className={`w-full text-left px-4 py-2.5 text-sm font-semibold transition-colors ${statusFilter === status ? 'text-teal-600 dark:text-teal-400 bg-teal-50 dark:bg-teal-900/20' : 'text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'}`}>
                                                    {status}
                                                </button>
                                            ))}
                                        </div>
                                    </>
                                )}
                            </div>

                            <div className="relative group flex-1 min-w-0">
                                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500 group-focus-within:text-teal-500 dark:group-focus-within:text-teal-400 transition-colors" size={15} />
                                <input type="text" placeholder="Search projects or location..." value={searchTerm}
                                    onChange={(e) => setSearchTerm(e.target.value)}
                                    className="w-full pl-9 pr-3 py-2.5 bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-xl text-sm font-medium text-slate-700 dark:text-slate-300 placeholder:text-slate-400 dark:placeholder:text-slate-600 focus:ring-2 focus:ring-teal-500 dark:focus:ring-teal-400 outline-none transition-all" />
                            </div>
                        </div>
                    </div>

                    <div className="hidden md:grid grid-cols-12 px-7 py-3 bg-slate-50/70 dark:bg-slate-800/30 border-b border-slate-100 dark:border-slate-700/40 text-[11px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-[0.1em]">
                        <div className="col-span-7 lg:col-span-5">Project Identity</div>
                        <div className="col-span-5 lg:col-span-3">Status</div>
                        <div className="hidden lg:block lg:col-span-2">Contract Amt</div>
                        <div className="hidden lg:block lg:col-span-2 text-right">Progress</div>
                    </div>

                    <div className="p-4 space-y-2">
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
                                <button key={project.id}
                                    onClick={() => navigate(`/hcsd/projects/${project.id}`)}
                                    className="grid grid-cols-12 items-center px-4 sm:px-6 py-4 sm:py-5 bg-white/60 dark:bg-slate-800/30 border border-white/80 dark:border-slate-700/40 hover:bg-white/90 dark:hover:bg-slate-800/60 hover:border-teal-200 dark:hover:border-teal-500/30 hover:shadow-md rounded-2xl transition-all text-left w-full group"
                                    style={{ animation: `slideUp 0.4s ease-out ${i * 0.06}s both` }}>

                                    <div className="col-span-8 md:col-span-7 lg:col-span-5 pr-3 min-w-0">
                                        <h4 className="font-bold text-slate-800 dark:text-slate-100 group-hover:text-teal-700 dark:group-hover:text-teal-300 text-sm mb-1 line-clamp-1 transition-colors">{project.name}</h4>
                                        <div className="flex items-center gap-1.5 text-slate-400 dark:text-slate-500 text-xs">
                                            <MapPin size={11} className="shrink-0 text-teal-400" />
                                            <span className="truncate">Barangay {project.barangay}</span>
                                        </div>
                                    </div>

                                    <div className="col-span-4 md:col-span-5 lg:col-span-3 min-w-0">
                                        <span className={`inline-flex px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wide border ${project.statusColor.pill}`}>
                                            {project.status}
                                        </span>
                                        {project.originalDateCompletion && (
                                            <div className="hidden sm:flex items-center gap-1 text-[10px] text-slate-400 dark:text-slate-500 font-medium mt-1.5">
                                                <Clock size={10} />
                                                Due {new Date(project.originalDateCompletion).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' })}
                                            </div>
                                        )}
                                    </div>

                                    <div className="hidden lg:block lg:col-span-2 font-bold text-slate-700 dark:text-slate-200 text-sm">
                                        {formatCurrencyShort(project.contractAmount)}
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
                                </button>
                            ))
                        )}
                    </div>
                </div>
            </main>
        </div>
    );
};

export default ProjectRegistry;