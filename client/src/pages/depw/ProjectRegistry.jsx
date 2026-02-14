import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    Plus, FolderKanban, Search, Filter, MapPin, Clock
} from 'lucide-react';
import DepwSidebar from '../../components/layout/DepwSidebar';
import { collection, query, orderBy, onSnapshot } from 'firebase/firestore';
import { db } from '../../config/firebase';
import { useDebounce } from '../../hooks/useDebounce';

// --- LOGIC LAYER (Custom Hook) ---
const useProjectRegistry = () => {
    const navigate = useNavigate();
    const [projects, setProjects] = useState([]);
    const [loading, setLoading] = useState(true);
    const [statusFilter, setStatusFilter] = useState('All Status');
    const [searchTerm, setSearchTerm] = useState('');
    const [isFilterOpen, setIsFilterOpen] = useState(false);

    useEffect(() => {
        // Subscribe to Real-time Updates
        const q = query(
            collection(db, "projects"),
            orderBy("createdAt", "desc")
        );

        const unsubscribe = onSnapshot(q, (snapshot) => {
            const fetchedProjects = snapshot.docs.map(doc => {
                const data = doc.data();
                return {
                    id: doc.id,
                    name: data.projectTitle,
                    location: data.location,
                    status: data.status,
                    statusColor: getStatusColor(data.status),
                    statusLabel: data.status, // Can be mapped if different
                    budget: data.budget,
                    progress: data.progress || 0,
                    meta: data.targetDate ? `Due ${new Date(data.targetDate).toLocaleDateString()}` : null
                };
            });
            setProjects(fetchedProjects);
            setLoading(false);
        }, (error) => {

            setLoading(false);
        });

        // Cleanup subscription on unmount
        return () => unsubscribe();
    }, []);

    const formatCurrency = (amount) => {
        return new Intl.NumberFormat('en-PH', {
            style: 'currency',
            currency: 'PHP'
        }).format(amount);
    };

    const getStatusColor = (status) => {
        switch (status?.toLowerCase()) {
            case 'completed': return 'bg-emerald-100 text-emerald-700 border border-emerald-200';
            case 'ongoing': return 'bg-blue-100 text-blue-700 border border-blue-200';
            case 'for mayor': return 'bg-amber-100 text-amber-700 border border-amber-200'; // Specific for Mayor's Approval
            case 'returned': return 'bg-rose-100 text-rose-700 border border-rose-200';
            case 'draft': return 'bg-slate-100 text-slate-600 border border-slate-200';
            default: return 'bg-slate-100 text-slate-600 border border-slate-200';
        }
    };

    // Debounced Search (Performance: 300ms delay)
    const debouncedSearchTerm = useDebounce(searchTerm, 300);

    const filteredProjects = useMemo(() => {
        return projects.filter(project => {
            const matchesSearch = project.name?.toLowerCase().includes(debouncedSearchTerm.toLowerCase()) ||
                project.location?.toLowerCase().includes(debouncedSearchTerm.toLowerCase());

            const matchesStatus = statusFilter === 'All Status' || project.status === statusFilter;

            return matchesSearch && matchesStatus;
        });
    }, [projects, debouncedSearchTerm, statusFilter]);

    return {
        projects: filteredProjects,
        loading,
        searchTerm,
        setSearchTerm,
        statusFilter,
        setStatusFilter,
        isFilterOpen,
        setIsFilterOpen,
        formatCurrency,
        navigate
    };
};

const ProjectRegistry = () => {
    const {
        projects,
        loading,
        searchTerm,
        setSearchTerm,
        statusFilter,
        setStatusFilter,
        isFilterOpen,
        setIsFilterOpen,
        formatCurrency,
        navigate
    } = useProjectRegistry();

    const STATUS_OPTIONS = ['All Status', 'Draft', 'For Mayor', 'Ongoing', 'Returned'];

    return (
        <div className="min-h-screen bg-slate-50 font-sans text-slate-900">
            <DepwSidebar />

            <main className="ml-0 md:ml-72 p-4 md:p-10 max-w-[1600px] mx-auto">

                {/* PAGE HEADER */}
                <div className="flex justify-between items-end mb-8">
                    <div>
                        <h1 className="text-3xl font-extrabold text-slate-900 tracking-tight flex items-center gap-3">
                            <FolderKanban className="text-blue-600" size={32} />
                            Project Registry
                        </h1>
                        <p className="text-slate-500 font-medium mt-1 ml-11">
                            Manage infrastructure mandates and track approval status.
                        </p>
                    </div>
                    <div>
                        <button onClick={() => navigate('/depw/create-project')} className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 px-6 rounded-xl shadow-lg shadow-blue-600/20 hover:shadow-blue-600/30 transition-all flex items-center gap-2">
                            <Plus size={20} strokeWidth={3} />
                            Initialize New Project
                        </button>
                    </div>
                </div>

                {/* MAIN CONTENT CARD */}
                <div className="bg-white rounded-[24px] border border-slate-200 shadow-sm overflow-hidden min-h-[600px] flex flex-col">

                    {/* TOOLBAR */}
                    <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-white">
                        <div className="flex items-center gap-4">
                            <div className="flex items-center gap-2 font-bold text-slate-900 text-lg">
                                <FolderKanban size={20} className="text-blue-600" />
                                Active Projects
                            </div>
                        </div>

                        <div className="flex gap-3">
                            <div className="relative">
                                <button
                                    onClick={() => setIsFilterOpen(!isFilterOpen)}
                                    className="flex items-center gap-2 px-4 py-3 bg-white border border-slate-200 rounded-xl text-sm font-semibold text-slate-600 hover:bg-slate-50 transition-colors"
                                >
                                    <Filter size={16} />
                                    {statusFilter}
                                </button>

                                {isFilterOpen && (
                                    <>
                                        <div
                                            className="fixed inset-0 z-10"
                                            onClick={() => setIsFilterOpen(false)}
                                        ></div>
                                        <div className="absolute top-12 left-0 z-20 w-48 bg-white rounded-xl shadow-xl border border-slate-100 py-2 animate-in fade-in zoom-in-95 duration-200">
                                            {STATUS_OPTIONS.map(status => (
                                                <button
                                                    key={status}
                                                    onClick={() => {
                                                        setStatusFilter(status);
                                                        setIsFilterOpen(false);
                                                    }}
                                                    className={`w-full text-left px-4 py-2 text-sm font-medium hover:bg-slate-50 transition-colors ${statusFilter === status ? 'text-blue-600 bg-blue-50/50' : 'text-slate-600'}`}
                                                >
                                                    {status}
                                                </button>
                                            ))}
                                        </div>
                                    </>
                                )}
                            </div>
                            <div className="relative group w-80">
                                <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-blue-600 transition-colors" size={18} />
                                <input
                                    type="text"
                                    placeholder="Search projects..."
                                    value={searchTerm}
                                    onChange={(e) => setSearchTerm(e.target.value)}
                                    className="w-full pl-11 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-semibold focus:ring-2 focus:ring-blue-500 outline-none transition-all placeholder:text-slate-400"
                                />
                            </div>
                        </div>
                    </div>

                    {/* TABLE HEADER - RESPONSIVE */}
                    <div className="grid grid-cols-12 px-8 py-4 bg-slate-50/50 border-b border-slate-100 text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                        <div className="col-span-8 md:col-span-4">Project Identity</div>
                        <div className="col-span-4 md:col-span-3">Status</div>
                        <div className="hidden md:block md:col-span-3">Budget</div>
                        <div className="hidden md:block md:col-span-2 text-right">Progress</div>
                    </div>

                    {/* LIST */}
                    <div className="flex-1 overflow-auto p-4 space-y-2">
                        {loading ? (
                            <div className="flex flex-col items-center justify-center h-full text-slate-400">
                                <LoaderSpinner />
                                <p className="mt-4 text-sm font-semibold animate-pulse">Syncing Project Registry...</p>
                            </div>
                        ) : projects.length === 0 ? (
                            <div className="flex flex-col items-center justify-center h-full text-slate-400">
                                <FolderKanban size={48} className="mb-4 text-slate-200" />
                                <h3 className="text-lg font-bold text-slate-500">No Projects Found</h3>
                                <p className="text-sm">Initialize a new project to get started.</p>
                            </div>
                        ) : (
                            projects.map(project => (
                                <div key={project.id} className="grid grid-cols-12 items-center px-6 py-6 bg-white border border-slate-1000 hover:bg-slate-50 transition-colors border-b border-slate-50 last:border-b-0 rounded-2xl">

                                    {/* IDENTITY (8 cols mobile, 4 cols desktop) */}
                                    <div className="col-span-8 md:col-span-4">
                                        <h4 className="font-bold text-slate-900 text-sm mb-1 line-clamp-1">{project.name}</h4>
                                        <div className="flex items-center gap-1.5 text-slate-500 text-xs">
                                            <MapPin size={12} className="shrink-0" />
                                            <span className="truncate">Barangay {project.location}</span>
                                        </div>
                                    </div>

                                    {/* STATUS (4 cols mobile, 3 cols desktop) */}
                                    <div className="col-span-4 md:col-span-3">
                                        <span className={`inline-flex px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wide mb-1.5 ${project.statusColor}`}>
                                            {project.statusLabel || project.status}
                                        </span>
                                        {project.meta && (
                                            <div className="flex items-center gap-1 text-[10px] text-slate-400 font-medium hidden sm:flex">
                                                <Clock size={10} />
                                                {project.meta}
                                            </div>
                                        )}
                                    </div>

                                    {/* BUDGET (Hidden on mobile) */}
                                    <div className="hidden md:block md:col-span-3 font-bold text-slate-700 text-sm">
                                        {formatCurrency(project.budget)}
                                    </div>

                                    {/* PROGRESS (Hidden on mobile) */}
                                    <div className="hidden md:block md:col-span-2">
                                        <div className="flex justify-between text-[10px] font-bold text-slate-400 mb-1">
                                            <span>Actual</span>
                                            <span>{project.progress}%</span>
                                        </div>
                                        <div className="w-full bg-slate-100 rounded-full h-1.5 overflow-hidden">
                                            <div
                                                className={`h-full rounded-full ${project.progress > 0 ? 'bg-blue-600' : 'bg-slate-300'}`}
                                                style={{ width: `${project.progress}%` }}
                                            />
                                        </div>
                                    </div>

                                </div>
                            )))}
                    </div>
                </div>

            </main>
        </div>
    );
};

const LoaderSpinner = () => (
    <svg className="animate-spin h-8 w-8 text-blue-600" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
    </svg>
);

export default ProjectRegistry;
