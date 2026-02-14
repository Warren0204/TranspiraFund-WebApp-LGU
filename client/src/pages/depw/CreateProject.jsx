import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    ArrowLeft, Building2, MapPin, Briefcase, Calendar,
    HardHat, BrainCircuit, LayoutDashboard, Lock, AlertCircle,
    Plus, Trash2, CheckCircle, X
} from 'lucide-react';
import { z } from 'zod';
import DepwSidebar from '../../components/layout/DepwSidebar';
import { ROLES } from '../../config/roles';
import { collection, query, where, getDocs, addDoc, writeBatch, serverTimestamp, doc } from 'firebase/firestore';
import { db } from '../../config/firebase';

// --- CONSTANTS ---

// Complete list of 80 Cebu City Barangays (alphabetical order)
const CEBU_CITY_BARANGAYS = [
    "Adlaon", "Agsungot", "Apas", "Babag", "Bacayan", "Banilad",
    "Basak Pardo", "Basak San Nicolas", "Binaliw", "Bonbon",
    "Budla-an", "Buhisan", "Bulacao", "Buot-Taup Pardo", "Busay",
    "Calamba", "Cambinocot", "Camputhaw", "Capitol Site", "Carreta",
    "Cogon Pardo", "Cogon Ramos", "Day-as", "Duljo Fatima", "Ermita",
    "Guadalupe", "Guba", "Hippodromo", "Inayawan", "Kalubihan",
    "Kalunasan", "Kamagayan", "Kasambagan", "Kinasang-an Pardo", "Labangon",
    "Lahug", "Lorega San Miguel", "Lusaran", "Luz", "Mabini",
    "Mabolo", "Malubog", "Mambaling", "Pahina Central", "Pahina San Nicolas",
    "Pamutan", "Pardo", "Pari-an", "Paril", "Pasil",
    "Pit-os", "Pulangbato", "Pung-ol-Sibugay", "Punta Princesa", "Quiot Pardo",
    "Sambag I", "Sambag II", "San Antonio", "San Jose", "San Nicolas Proper",
    "San Roque", "Santa Cruz", "Santo Niño", "Sapangdaku", "Sawang Calero",
    "Sinsin", "Sirao", "Suba", "Sudlon I", "Sudlon II",
    "T. Padilla", "Tabunan", "Tagba-o", "Talamban", "Taptap",
    "Tejero", "Tinago", "Tisa", "Toong", "Zapatera"
];

// Character limits
const CHAR_LIMITS = {
    projectTitle: 100,
    description: 500,
    contractor: 100
};

// --- LOGIC LAYER (Custom Hook) ---

// 1. Validation Schema
const projectSchema = z.object({
    projectTitle: z.string()
        .min(10, "Title must be at least 10 characters")
        .max(CHAR_LIMITS.projectTitle, `Title cannot exceed ${CHAR_LIMITS.projectTitle} characters`)
        .regex(/^[a-zA-Z0-9\s\-_.,()]+$/, "Title contains invalid characters"),

    location: z.string().min(1, "Location is required"),

    budget: z.number({ invalid_type_error: "Budget must be a number" })
        .min(10000, "Minimum budget is 10,000")
        .max(1000000000, "Maximum budget exceeded"),

    description: z.string()
        .min(20, "Description must be at least 20 characters")
        .max(CHAR_LIMITS.description, `Description cannot exceed ${CHAR_LIMITS.description} characters`),

    contractor: z.string().max(CHAR_LIMITS.contractor, `Contractor name cannot exceed ${CHAR_LIMITS.contractor} characters`).optional(),
    engineer: z.string().optional(),

    startDate: z.string().refine((date) => new Date(date) > new Date(), {
        message: "Start date must be in the future"
    }),

    completionDate: z.string()
});

// Format number with commas
const formatWithCommas = (value) => {
    if (!value) return '';
    const numericValue = value.toString().replace(/[^0-9]/g, '');
    if (!numericValue) return '';
    return Number(numericValue).toLocaleString('en-US');
};

// Parse formatted number to raw value
const parseFormattedNumber = (value) => {
    if (!value) return '';
    return value.toString().replace(/,/g, '');
};

// Get minimum completion date (day after start date)
const getMinCompletionDate = (startDate) => {
    if (!startDate) return '';
    const date = new Date(startDate);
    date.setDate(date.getDate() + 1);
    return date.toISOString().split('T')[0];
};

const useCreateProject = () => {
    const navigate = useNavigate();

    const [formData, setFormData] = useState({
        projectTitle: '',
        location: '',
        budget: '',
        budgetDisplay: '', // Formatted display value with commas
        description: '',
        contractor: '',
        engineer: '',
        startDate: '',
        completionDate: '',
        milestones: []
    });

    const [errors, setErrors] = useState({});
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [isAiGenerating, setIsAiGenerating] = useState(false);
    const [deleteConfirmIndex, setDeleteConfirmIndex] = useState(null); // For delete confirmation modal
    const [isReviewOpen, setIsReviewOpen] = useState(false); // Review Overlay State

    // Engineer Data State
    const [engineers, setEngineers] = useState([]);
    const [loadingEngineers, setLoadingEngineers] = useState(true);

    // Fetch Project Engineers
    useEffect(() => {
        const fetchEngineers = async () => {
            try {
                // Fetch ALL users then filter client-side to catch legacy "Project Engineer" strings
                const q = query(collection(db, "users"));
                const snapshot = await getDocs(q);
                const fetched = snapshot.docs
                    .map(doc => ({
                        id: doc.id,
                        name: `Engr. ${doc.data().firstName} ${doc.data().lastName}`,
                        ...doc.data()
                    }))
                    .filter(u =>
                        u.role === ROLES.PROJECT_ENGINEER ||
                        u.role === 'Project Engineer' ||
                        u.role === 'PROJ_ENG'
                    );
                setEngineers(fetched);
            } catch {
                // Silent fail - engineers will show empty state
            } finally {
                setLoadingEngineers(false);
            }
        };
        fetchEngineers();
    }, []);

    // Generic change handler with character limit enforcement
    const handleChange = (field, value) => {
        // Enforce character limits
        if (CHAR_LIMITS[field] && value.length > CHAR_LIMITS[field]) {
            return; // Prevent input beyond limit
        }

        setFormData(prev => ({ ...prev, [field]: value }));
        if (errors[field]) {
            setErrors(prev => {
                const newErrors = { ...prev };
                delete newErrors[field];
                return newErrors;
            });
        }
    };

    // Budget change handler with comma formatting
    const handleBudgetChange = (e) => {
        const rawValue = parseFormattedNumber(e.target.value);
        const displayValue = formatWithCommas(rawValue);

        setFormData(prev => ({
            ...prev,
            budget: rawValue,
            budgetDisplay: displayValue
        }));

        if (errors.budget) {
            setErrors(prev => {
                const newErrors = { ...prev };
                delete newErrors.budget;
                return newErrors;
            });
        }
    };

    // Start date change handler with completion date dependency
    const handleStartDateChange = (e) => {
        const newStartDate = e.target.value;

        setFormData(prev => {
            const updates = { ...prev, startDate: newStartDate };

            // Clear completion date if it's now invalid (before or equal to new start date)
            if (prev.completionDate && new Date(prev.completionDate) <= new Date(newStartDate)) {
                updates.completionDate = '';
            }

            return updates;
        });

        if (errors.startDate) {
            setErrors(prev => {
                const newErrors = { ...prev };
                delete newErrors.startDate;
                return newErrors;
            });
        }
    };

    // --- MILESTONE MANAGEMENT ---

    // Helper: Distribute weights evenly among milestones
    const distributeWeights = (milestones) => {
        const count = milestones.length;
        if (count === 0) return [];

        const baseWeight = Math.floor(100 / count);
        const remainder = 100 - (baseWeight * count);

        return milestones.map((m, index) => ({
            ...m,
            // Add remainder to the last milestone
            weight: index === count - 1 ? baseWeight + remainder : baseWeight
        }));
    };

    // Helper: Distribute dates evenly between start and completion
    const distributeDates = (milestones, startStr, endStr) => {
        if (!startStr || !endStr || milestones.length === 0) return milestones;

        const start = new Date(startStr).getTime();
        const end = new Date(endStr).getTime();

        // Prevent division by zero or negative time
        if (end <= start) return milestones;

        const totalDuration = end - start;
        const durationPerMilestone = totalDuration / milestones.length;

        return milestones.map((m, index) => {
            const targetMs = start + (durationPerMilestone * (index + 1));
            return {
                ...m,
                targetDate: new Date(targetMs).toISOString().split('T')[0]
            };
        });
    };

    // Handler: Update individual milestone field
    const handleMilestoneChange = (index, field, value) => {
        setFormData(prev => {
            const updatedMilestones = [...prev.milestones];
            updatedMilestones[index] = {
                ...updatedMilestones[index],
                [field]: value // Weight is now handled automatically, but keeping safety if needed
            };
            return { ...prev, milestones: updatedMilestones };
        });
    };

    // Handler: Add new phase
    const addPhase = () => {
        setFormData(prev => {
            const newPhase = {
                title: '',
                targetDate: '',
                weight: 0
            };
            const tempMilestones = [...prev.milestones, newPhase];

            // First distribute weights
            let balancedMilestones = distributeWeights(tempMilestones);

            // Then distribute dates if start/end dates exist
            if (prev.startDate && prev.completionDate) {
                balancedMilestones = distributeDates(balancedMilestones, prev.startDate, prev.completionDate);
            }

            return {
                ...prev,
                milestones: balancedMilestones
            };
        });
    };

    // Handler: Delete milestone (after confirmation)
    const confirmDeleteMilestone = (index) => {
        setDeleteConfirmIndex(index);
    };

    const cancelDelete = () => {
        setDeleteConfirmIndex(null);
    };

    const executeDelete = () => {
        if (deleteConfirmIndex !== null) {
            setFormData(prev => {
                const filteredMilestones = prev.milestones.filter((_, i) => i !== deleteConfirmIndex);

                // First distribute weights
                let balancedMilestones = distributeWeights(filteredMilestones);

                // Then distribute dates
                if (prev.startDate && prev.completionDate) {
                    balancedMilestones = distributeDates(balancedMilestones, prev.startDate, prev.completionDate);
                }

                return {
                    ...prev,
                    milestones: balancedMilestones
                };
            });
            setDeleteConfirmIndex(null);
        }
    };

    // --- COMPUTED VALUES ---

    // Computed: Check if core fields are complete (for AI generation)
    const isCoreFieldsComplete = Boolean(
        formData.projectTitle &&
        formData.location &&
        formData.budget &&
        formData.description &&
        formData.startDate &&
        formData.completionDate
    );

    // Computed: Total weight of all milestones
    const totalWeight = useMemo(() => {
        return formData.milestones.reduce((sum, m) => sum + (Number(m.weight) || 0), 0);
    }, [formData.milestones]);

    // Computed: Check if all milestones are valid
    const areMilestonesValid = useMemo(() => {
        if (formData.milestones.length === 0) return false;

        return formData.milestones.every(m =>
            m.title?.trim() &&
            m.targetDate &&
            m.weight > 0
        );
    }, [formData.milestones]);

    // Computed: Check if form is complete for submission
    const isFormComplete = isCoreFieldsComplete && areMilestonesValid && totalWeight === 100;

    // Computed: Minimum completion date
    const minCompletionDate = getMinCompletionDate(formData.startDate);

    const handleReviewRequest = (e) => {
        e.preventDefault();

        // 1. Validate Form Data using Zod
        try {
            const cleanData = {
                ...formData,
                budget: Number(formData.budget)
            };

            const validatedData = projectSchema.parse(cleanData);

            // Additional Custom Validations
            if (new Date(validatedData.completionDate) <= new Date(validatedData.startDate)) {
                setErrors(prev => ({ ...prev, completionDate: "Completion must be after start date" }));
                return;
            }

            if (formData.milestones.length === 0) {
                setErrors(prev => ({ ...prev, ai: "Please generate the project plan first." }));
                return;
            }

            // Milestone specific field validation
            if (!areMilestonesValid) {
                setErrors(prev => ({ ...prev, global: "Please fill in all milestone titles and dates." }));
                return;
            }

            if (totalWeight !== 100) {
                setErrors(prev => ({ ...prev, global: "Total milestone weight must be 100%." }));
                return;
            }

            // If all valid, open the review modal
            setErrors({});
            setIsReviewOpen(true);

        } catch (err) {
            if (err instanceof z.ZodError) {
                const fieldErrors = {};
                err.errors.forEach(e => {
                    if (e.path[0]) fieldErrors[e.path[0]] = e.message;
                });
                setErrors(fieldErrors);
            } else {
                setErrors(prev => ({ ...prev, global: "Validation failed. Please check your inputs." }));
            }
        }
    };

    const handleConfirmSubmission = async () => {
        // Idempotency Check
        if (isSubmitting) return;

        setIsSubmitting(true);

        try {
            // Data is already validated by handleReviewRequest, but we parse again for safety/clean types
            const cleanData = {
                ...formData,
                budget: Number(formData.budget)
            };
            const validatedData = projectSchema.parse(cleanData);

            // --- FIRESTORE TRANSACTION ---

            // 1. Create Project Document
            const projectData = {
                ...validatedData,
                status: 'For Mayor', // Initial Status
                createdAt: serverTimestamp(),
                progress: 0
            };

            const docRef = await addDoc(collection(db, "projects"), projectData);
            const projectId = docRef.id;

            // 2. Batch Write Milestones
            const batch = writeBatch(db);

            formData.milestones.forEach((milestone, index) => {
                const milestoneRef = doc(collection(db, "milestones")); // Auto-ID for milestone
                batch.set(milestoneRef, {
                    projectId: projectId,
                    title: milestone.title,
                    description: milestone.title, // Sync Title as Description
                    status: 'PENDING',
                    sequence: index + 1,
                    createdAt: serverTimestamp()
                });
            });

            await batch.commit();

            // Navigate back to registry after success
            navigate('/depw/projects');

        } catch (err) {

            setErrors(prev => ({ ...prev, global: "Failed to submit project. Please try again." }));
            setIsSubmitting(false); // Only reset if failed. If success, we navigate away.
        }
    };

    const generateAiPlan = async () => {
        if (!isCoreFieldsComplete) {
            setErrors(prev => ({ ...prev, ai: "Complete all required fields above to generate AI plan" }));
            return;
        }

        setIsAiGenerating(true);
        // Simulate AI Latency
        await new Promise(resolve => setTimeout(resolve, 1500));

        // Base milestones (Title acts as description)
        const baseMilestones = [
            { title: "Site Preparation: Clearing, mobilization, and foundation works" },
            { title: "Structural Framework: Columns, beams, and slabs erection" },
            { title: "Enclosure & Exterior: Roofing, wall enclosure, and finishing" },
            { title: "MEP Systems: Mechanical, Electrical, and Plumbing installation" },
            { title: "Interior Works: Plastering, painting, tiling, and fixtures" },
            { title: "Project Closeout: Final inspection, punch listing, and turnover" }
        ];

        // 1. Distribute Weights
        let optimizedMilestones = distributeWeights(baseMilestones);

        // 2. Distribute Dates
        optimizedMilestones = distributeDates(optimizedMilestones, formData.startDate, formData.completionDate);

        setFormData(prev => ({
            ...prev,
            milestones: optimizedMilestones
        }));
        setErrors(prev => {
            const newErrors = { ...prev };
            delete newErrors.ai;
            return newErrors;
        });
        setIsAiGenerating(false);
    };

    return {
        formData, errors, isSubmitting, isAiGenerating,
        engineers, loadingEngineers,
        handleChange, handleBudgetChange, handleStartDateChange, generateAiPlan,
        navigate,
        // Milestone management
        handleMilestoneChange, addPhase, confirmDeleteMilestone, cancelDelete, executeDelete,
        deleteConfirmIndex,
        // Review Modal
        isReviewOpen, setIsReviewOpen, handleReviewRequest, handleConfirmSubmission,
        // Computed values
        isCoreFieldsComplete, isFormComplete, minCompletionDate, totalWeight, areMilestonesValid,
        CEBU_CITY_BARANGAYS, CHAR_LIMITS
    };
};


// --- UI LAYER ---

const CreateProject = () => {
    const {
        formData, errors, isSubmitting, isAiGenerating,
        engineers, loadingEngineers,
        handleChange, handleBudgetChange, handleStartDateChange, generateAiPlan,
        navigate,
        // Milestone management
        handleMilestoneChange, addPhase, confirmDeleteMilestone, cancelDelete, executeDelete,
        deleteConfirmIndex,
        // Review Modal
        isReviewOpen, setIsReviewOpen, handleReviewRequest, handleConfirmSubmission,
        // Computed values
        isCoreFieldsComplete, isFormComplete, minCompletionDate, totalWeight, areMilestonesValid,
        CEBU_CITY_BARANGAYS, CHAR_LIMITS
    } = useCreateProject();

    return (
        <div className="min-h-screen bg-slate-50 font-sans text-slate-900">
            <DepwSidebar />

            <main className="ml-0 md:ml-72 p-4 md:p-10 max-w-[1200px] mx-auto pb-20 md:pb-32">
                {/* HEADER */}
                <div className="flex items-center justify-between mb-8">
                    <div className="flex flex-col gap-2">
                        <button onClick={() => navigate('/depw/projects')}
                            className="flex items-center gap-2 text-sm font-bold text-slate-400 hover:text-slate-700 transition-colors w-fit">
                            <ArrowLeft size={16} />
                            Back to Project Registry
                        </button>
                        <div>
                            <h1 className="text-3xl font-extrabold text-slate-900 tracking-tight">Create Mandate</h1>
                            <p className="text-slate-500 font-bold text-xs uppercase tracking-wider mt-1">NEW INFRASTRUCTURE PROJECT</p>
                        </div>
                    </div>

                    <div className="flex items-center gap-3">
                        <span className="flex items-center gap-1.5 px-3 py-1.5 bg-green-100 text-green-700 rounded-full text-xs font-bold uppercase tracking-wide">
                            <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
                            Drafting Mode
                        </span>
                    </div>
                </div>

                <div className="space-y-8">
                    {/* SECTION 1: IDENTITY */}
                    <div className="bg-white rounded-[24px] border border-slate-200 shadow-sm overflow-hidden">
                        <div className="p-6 border-b border-slate-100 bg-slate-50/50 flex items-center gap-3">
                            <LayoutDashboard className="text-blue-600" size={24} />
                            <h2 className="text-lg font-bold text-slate-800">Project Identity & Financials</h2>
                        </div>

                        <div className="p-8 space-y-8">
                            {/* Title */}
                            <div className="space-y-2">
                                <div className="flex justify-between">
                                    <label className="text-xs font-bold text-slate-400 uppercase tracking-wide">Official Project Title</label>
                                    <span className={`text-xs font-bold ${formData.projectTitle.length >= CHAR_LIMITS.projectTitle ? 'text-red-500' : 'text-slate-300'}`}>
                                        {formData.projectTitle.length} / {CHAR_LIMITS.projectTitle}
                                    </span>
                                </div>
                                <input
                                    type="text"
                                    value={formData.projectTitle}
                                    onChange={(e) => handleChange('projectTitle', e.target.value)}
                                    placeholder="e.g. Construction of Multi-Purpose Building Phase 1"
                                    maxLength={CHAR_LIMITS.projectTitle}
                                    aria-label="Official Project Title"
                                    className={`w-full p-4 bg-slate-50 border ${errors.projectTitle ? 'border-red-300 focus:ring-red-100' : 'border-slate-200 focus:ring-blue-100'} rounded-xl font-semibold text-slate-700 focus:border-blue-500 focus:ring-4 outline-none transition-all`}
                                />
                                {errors.projectTitle && <p className="text-xs text-red-500 font-bold flex items-center gap-1"><AlertCircle size={12} />{errors.projectTitle}</p>}
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                                {/* Location */}
                                <div className="space-y-2">
                                    <label className="text-xs font-bold text-slate-400 uppercase tracking-wide">Location (Barangay)</label>
                                    <div className="relative">
                                        <MapPin className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                                        <select
                                            value={formData.location}
                                            onChange={(e) => handleChange('location', e.target.value)}
                                            aria-label="Location Barangay"
                                            className="w-full pl-12 pr-4 py-4 bg-slate-50 border border-slate-200 rounded-xl font-semibold text-slate-700 outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-100 transition-all appearance-none cursor-pointer"
                                        >
                                            <option value="">Select Barangay...</option>
                                            {CEBU_CITY_BARANGAYS.map(barangay => (
                                                <option key={barangay} value={barangay}>{barangay}</option>
                                            ))}
                                        </select>
                                    </div>
                                    {errors.location && <p className="text-xs text-red-500 font-bold">{errors.location}</p>}
                                </div>

                                {/* Budget */}
                                <div className="space-y-2">
                                    <label className="text-xs font-bold text-slate-400 uppercase tracking-wide">Allocated Budget (PHP)</label>
                                    <div className="relative">
                                        <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 font-bold">₱</span>
                                        <input
                                            type="text"
                                            value={formData.budgetDisplay}
                                            onChange={handleBudgetChange}
                                            placeholder="0"
                                            aria-label="Allocated Budget"
                                            className="w-full pl-10 pr-4 py-4 bg-slate-50 border border-slate-200 rounded-xl font-semibold text-slate-700 outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-100 transition-all"
                                        />
                                    </div>
                                    {errors.budget && <p className="text-xs text-red-500 font-bold">{errors.budget}</p>}
                                </div>
                            </div>

                            {/* Description */}
                            <div className="space-y-2">
                                <div className="flex justify-between">
                                    <label className="text-xs font-bold text-slate-400 uppercase tracking-wide">Scope of Work</label>
                                    <span className={`text-xs font-bold ${formData.description.length >= CHAR_LIMITS.description ? 'text-red-500' : 'text-slate-300'}`}>
                                        {formData.description.length} / {CHAR_LIMITS.description}
                                    </span>
                                </div>
                                <textarea
                                    value={formData.description}
                                    onChange={(e) => handleChange('description', e.target.value)}
                                    placeholder="Describe the technical scope, objectives, and deliverables..."
                                    maxLength={CHAR_LIMITS.description}
                                    aria-label="Scope of Work Description"
                                    className="w-full p-4 bg-slate-50 border border-slate-200 rounded-xl font-medium text-slate-700 focus:border-blue-500 focus:ring-4 focus:ring-blue-100 outline-none transition-all h-32 resize-none"
                                />
                                {errors.description && <p className="text-xs text-red-500 font-bold">{errors.description}</p>}
                            </div>
                        </div>
                    </div>

                    {/* SECTION 2: EXECUTION */}
                    <div className="bg-white rounded-[24px] border border-slate-200 shadow-sm overflow-hidden">
                        <div className="p-6 border-b border-slate-100 bg-slate-50/50 flex items-center gap-3">
                            <Briefcase className="text-green-600" size={24} />
                            <h2 className="text-lg font-bold text-slate-800">Technical Execution</h2>
                        </div>

                        <div className="p-8 space-y-8">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                                <div className="space-y-2">
                                    <div className="flex justify-between">
                                        <label className="text-xs font-bold text-slate-400 uppercase tracking-wide">Contractor / Entity</label>
                                        <span className={`text-xs font-bold ${formData.contractor.length >= CHAR_LIMITS.contractor ? 'text-red-500' : 'text-slate-300'}`}>
                                            {formData.contractor.length} / {CHAR_LIMITS.contractor}
                                        </span>
                                    </div>
                                    <div className="relative">
                                        <Building2 className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                                        <input
                                            type="text"
                                            value={formData.contractor}
                                            onChange={(e) => handleChange('contractor', e.target.value)}
                                            placeholder="Company Name"
                                            maxLength={CHAR_LIMITS.contractor}
                                            aria-label="Contractor Entity Name"
                                            className="w-full pl-12 pr-4 py-4 bg-slate-50 border border-slate-200 rounded-xl font-semibold text-slate-700 outline-none focus:border-green-500 focus:ring-4 focus:ring-green-100 transition-all"
                                        />
                                    </div>
                                    {errors.contractor && <p className="text-xs text-red-500 font-bold">{errors.contractor}</p>}
                                </div>

                                <div className="space-y-2">
                                    <label className="text-xs font-bold text-slate-400 uppercase tracking-wide">Assign Project Engineer</label>
                                    {loadingEngineers ? (
                                        <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl flex items-center gap-2 text-slate-500 text-sm font-medium animate-pulse">
                                            <div className="w-4 h-4 bg-slate-200 rounded-full"></div>
                                            Loading Engineers...
                                        </div>
                                    ) : engineers.length === 0 ? (
                                        <div className="p-4 bg-red-50 border border-red-100 rounded-xl flex items-center gap-3 text-red-600 text-sm font-medium animate-in fade-in">
                                            <AlertCircle size={18} className="shrink-0" />
                                            <span>
                                                No Project Engineers found.
                                                <button onClick={() => navigate('/depw/staff')} className="underline hover:text-red-800 ml-1 font-bold">
                                                    Manage Staff
                                                </button>
                                            </span>
                                        </div>
                                    ) : (
                                        <div className="relative">
                                            <HardHat className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                                            <select
                                                value={formData.engineer}
                                                onChange={(e) => handleChange('engineer', e.target.value)}
                                                className="w-full pl-12 pr-4 py-4 bg-slate-50 border border-slate-200 rounded-xl font-semibold text-slate-700 outline-none focus:border-green-500 focus:ring-4 focus:ring-green-100 transition-all appearance-none cursor-pointer"
                                            >
                                                <option value="">Select an Engineer...</option>
                                                {engineers.map(e => (
                                                    <option key={e.id} value={e.name}>{e.name}</option>
                                                ))}
                                            </select>
                                        </div>
                                    )}
                                </div>
                            </div>

                            <div className="p-6 bg-slate-50 rounded-xl border border-slate-100">
                                <label className="text-xs font-bold text-slate-400 uppercase tracking-wide mb-4 block flex items-center gap-2">
                                    <Calendar size={14} /> Execution Timeline
                                </label>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                                    <div className="space-y-2">
                                        <span className="text-xs font-semibold text-slate-500">Target Start Date</span>
                                        <input
                                            type="date"
                                            value={formData.startDate}
                                            onChange={handleStartDateChange}
                                            aria-label="Target Start Date"
                                            className="w-full p-3 bg-white border border-slate-200 rounded-lg font-medium text-slate-700 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 transition-all"
                                        />
                                        {errors.startDate && <p className="text-xs text-red-500 font-bold">{errors.startDate}</p>}
                                    </div>
                                    <div className="space-y-2">
                                        <span className={`text-xs font-semibold ${!formData.startDate ? 'text-slate-300' : 'text-slate-500'}`}>
                                            Completion Date {!formData.startDate && '(Select start date first)'}
                                        </span>
                                        <input
                                            type="date"
                                            value={formData.completionDate}
                                            onChange={(e) => handleChange('completionDate', e.target.value)}
                                            disabled={!formData.startDate}
                                            min={minCompletionDate}
                                            aria-label="Completion Date"
                                            className={`w-full p-3 border border-slate-200 rounded-lg font-medium outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 transition-all ${!formData.startDate ? 'bg-slate-100 text-slate-400 cursor-not-allowed' : 'bg-white text-slate-700'}`}
                                        />
                                        {errors.completionDate && <p className="text-xs text-red-500 font-bold">{errors.completionDate}</p>}
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* SECTION 3: PLANNING */}
                    {/* SECTION 3: PLANNING */}
                    <div className="bg-white rounded-[24px] border border-slate-200 shadow-sm overflow-hidden opacity-90">
                        <div className="p-6 border-b border-slate-100 bg-slate-50/50 flex items-center justify-between">
                            <div className="flex items-center gap-3">
                                <BrainCircuit className="text-purple-600" size={24} />
                                <div className="flex flex-col">
                                    <h2 className="text-lg font-bold text-slate-800">Strategic Planning</h2>
                                    <span className="text-xs font-medium text-slate-400">Auto-balanced milestones ensure accountability.</span>
                                </div>
                            </div>

                            <div className="flex items-center gap-2">
                                <button
                                    onClick={addPhase}
                                    disabled={!isCoreFieldsComplete}
                                    className="px-4 py-2 bg-white border border-slate-200 text-slate-600 rounded-lg text-sm font-bold flex items-center gap-2 hover:bg-slate-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                    <Plus size={16} />
                                    Add Phase
                                </button>
                                <button
                                    onClick={generateAiPlan}
                                    disabled={!isCoreFieldsComplete || isAiGenerating}
                                    aria-label="Generate AI Plan"
                                    className={`px-4 py-2 rounded-lg text-sm font-bold flex items-center gap-2 transition-colors ${isCoreFieldsComplete ? 'bg-purple-100 text-purple-700 hover:bg-purple-200' : 'bg-slate-100 text-slate-400 cursor-not-allowed'} disabled:opacity-50`}
                                >
                                    {isAiGenerating ? <LoaderSpinner /> : <BrainCircuit size={16} />}
                                    Generate AI Plan
                                </button>
                            </div>
                        </div>
                        {errors.ai && <p className="px-6 pt-2 text-xs text-red-500 font-bold text-right">{errors.ai}</p>}

                        <div className="p-8">
                            {formData.milestones.length === 0 ? (
                                <div className="flex flex-col items-center justify-center text-center py-8">
                                    <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mb-6 text-slate-400">
                                        <Lock size={32} />
                                    </div>
                                    <h3 className="text-lg font-bold text-slate-700 mb-2">Planning Section Locked</h3>
                                    <p className="text-slate-400 max-w-sm">Complete all fields above to unlock AI generation.</p>
                                </div>
                            ) : (
                                <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
                                    <div className="flex items-center justify-between">
                                        <h3 className="text-sm font-bold text-slate-400 uppercase tracking-wide">Auto-Balanced Schedule</h3>
                                        <div className={`px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wide border ${totalWeight === 100 ? 'bg-green-50 text-green-700 border-green-200' : 'bg-red-50 text-red-700 border-red-200'}`}>
                                            Total Weight: {totalWeight}%
                                        </div>
                                    </div>

                                    <div className="space-y-3">
                                        {formData.milestones.map((milestone, idx) => (
                                            <div key={idx} className="p-4 bg-slate-50 border border-slate-200 rounded-xl flex items-center gap-4 hover:border-blue-300 transition-colors group">
                                                {/* Sequence */}
                                                <div className="w-8 h-8 bg-blue-100 text-blue-600 rounded-lg flex items-center justify-center font-bold text-sm shrink-0">
                                                    {idx + 1}
                                                </div>

                                                {/* Details (Title Only) */}
                                                <div className="flex-1">
                                                    <input
                                                        type="text"
                                                        value={milestone.title}
                                                        onChange={(e) => handleMilestoneChange(idx, 'title', e.target.value)}
                                                        placeholder="Milestone / Deliverable Description"
                                                        className={`w-full bg-transparent font-bold text-slate-800 text-sm focus:outline-none focus:bg-white focus:ring-2 focus:ring-blue-100 rounded px-3 py-2 transition-all placeholder:text-slate-400 border ${!milestone.title.trim() ? 'border-red-300 bg-red-50/50' : 'border-transparent focus:border-blue-200'}`}
                                                    />
                                                </div>

                                                {/* Actions */}
                                                <div className="flex items-center gap-3">
                                                    {/* Date Picker */}
                                                    <div className="relative">
                                                        <input
                                                            type="date"
                                                            value={milestone.targetDate}
                                                            min={formData.startDate}
                                                            max={formData.completionDate}
                                                            onChange={(e) => handleMilestoneChange(idx, 'targetDate', e.target.value)}
                                                            className={`w-36 px-3 py-2 bg-white border rounded-lg text-xs font-bold text-slate-700 outline-none focus:border-blue-500 transition-all text-center ${!milestone.targetDate ? 'border-red-300 bg-red-50/50' : 'border-slate-200'}`}
                                                        />
                                                    </div>

                                                    {/* Weight Input (Read Only) */}
                                                    <div className="relative w-20">
                                                        <div className="w-full px-3 py-2 bg-slate-100 border border-slate-200 rounded-lg text-xs font-bold text-slate-500 text-center flex items-center justify-center gap-1 cursor-lock">
                                                            <Lock size={10} className="text-slate-400" />
                                                            <span>{milestone.weight}%</span>
                                                        </div>
                                                    </div>

                                                    {/* Delete Button */}
                                                    <button
                                                        onClick={() => confirmDeleteMilestone(idx)}
                                                        className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                                                        title="Delete Phase"
                                                        aria-label="Delete milestone"
                                                    >
                                                        <Trash2 size={16} />
                                                    </button>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                </div>

                <div className="flex items-center justify-end gap-3 pt-6 border-t border-slate-200">
                    <button
                        type="button"
                        onClick={() => navigate('/depw/projects')}
                        className="px-6 py-3 text-slate-500 font-bold hover:bg-slate-50 rounded-xl transition-colors"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={handleReviewRequest}
                        disabled={!isFormComplete || isSubmitting}
                        className="px-8 py-3 bg-blue-600 text-white font-bold rounded-xl shadow-lg shadow-blue-200 hover:bg-blue-700 hover:shadow-blue-300 transition-all disabled:opacity-50 disabled:shadow-none flex items-center gap-2"
                    >
                        {isSubmitting ? <LoaderSpinner /> : <CheckCircle size={20} />}
                        Submit for Approval
                    </button>
                </div>
            </main>

            {errors.global && (
                <div className="fixed top-6 right-6 z-50 animate-in slide-in-from-top-2">
                    <div className="bg-red-50 text-red-600 border border-red-200 px-4 py-3 rounded-xl shadow-lg flex items-center gap-3">
                        <AlertCircle size={20} />
                        <span className="font-bold text-sm">{errors.global}</span>
                    </div>
                </div>
            )}

            {/* DELETE CONFIRMATION MODAL */}
            {deleteConfirmIndex !== null && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/20 backdrop-blur-sm animate-in fade-in duration-200">
                    <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6 transform transition-all scale-100 animate-in zoom-in-95 duration-200">
                        <div className="flex flex-col items-center text-center gap-4">
                            <div className="w-12 h-12 bg-red-100 text-red-600 rounded-full flex items-center justify-center">
                                <Trash2 size={24} />
                            </div>
                            <div>
                                <h3 className="text-lg font-bold text-slate-900">Delete Phase?</h3>
                                <p className="text-slate-500 text-sm mt-1">
                                    Are you sure you want to remove this project phase?
                                    <span className="block mt-1 text-xs text-blue-600 font-medium">Auto-balancing will adjust remaining dates & weights.</span>
                                </p>
                            </div>
                            <div className="flex gap-3 w-full mt-2">
                                <button
                                    onClick={cancelDelete}
                                    className="flex-1 py-2.5 bg-slate-100 text-slate-600 font-bold rounded-xl hover:bg-slate-200 transition-colors"
                                >
                                    Cancel
                                </button>
                                <button
                                    onClick={executeDelete}
                                    className="flex-1 py-2.5 bg-red-600 text-white font-bold rounded-xl hover:bg-red-700 shadow-md shadow-red-200 transition-colors"
                                >
                                    Delete
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* REVIEW MANDATE MODAL (FINAL VALIDATION) */}
            {isReviewOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-md animate-in fade-in duration-300">
                    <div className="bg-white w-full max-w-4xl h-[90vh] rounded-[32px] shadow-2xl overflow-hidden flex flex-col transform transition-all animate-in slide-in-from-bottom-8 duration-300">

                        {/* HEADER */}
                        <div className="px-8 py-6 border-b border-slate-100 flex items-center justify-between bg-white z-10">
                            <div className="flex items-center gap-3">
                                <div className="w-10 h-10 bg-blue-50 text-blue-600 rounded-xl flex items-center justify-center">
                                    <CheckCircle size={20} className="fill-blue-100" />
                                </div>
                                <div>
                                    <span className="text-xs font-bold text-blue-600 uppercase tracking-widest block mb-0.5">Final Validation</span>
                                    <h2 className="text-2xl font-extrabold text-slate-900 tracking-tight">Review Mandate</h2>
                                </div>
                            </div>
                            <button onClick={() => setIsReviewOpen(false)} className="text-slate-400 hover:text-slate-700 transition-colors" aria-label="Close review">
                                <X size={24} />
                            </button>
                        </div>

                        {/* SCROLLABLE CONTENT */}
                        <div className="flex-1 overflow-y-auto p-8 space-y-8 bg-slate-50/50">
                            <p className="text-slate-500 text-sm font-medium">Please verify all project details below before submission.</p>

                            {/* Project Title Card */}
                            <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm border-l-4 border-l-blue-500">
                                <label className="text-xs font-bold text-slate-400 uppercase tracking-wide mb-1 block">Official Project Title</label>
                                <h3 className="text-xl font-bold text-slate-900 leading-normal">{formData.projectTitle}</h3>
                            </div>

                            {/* Details Grid */}
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                {/* Location & Budget */}
                                <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm space-y-6">
                                    <div className="flex items-center gap-2 mb-2">
                                        <MapPin size={18} className="text-blue-500" />
                                        <h4 className="font-bold text-slate-800">Location & Budget</h4>
                                    </div>
                                    <div className="space-y-4">
                                        <div>
                                            <label className="text-xs font-bold text-slate-400 uppercase tracking-wide block">Site Location</label>
                                            <p className="font-bold text-slate-900 text-lg">Barangay {formData.location}</p>
                                        </div>
                                        <div>
                                            <label className="text-xs font-bold text-slate-400 uppercase tracking-wide block">Total Appropriation</label>
                                            <p className="font-bold text-blue-600 text-2xl tracking-tight">{formData.budgetDisplay} <span className="text-sm text-slate-400 font-bold ml-1">PHP</span></p>
                                        </div>
                                    </div>
                                </div>

                                {/* Execution Team */}
                                <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm space-y-6">
                                    <div className="flex items-center gap-2 mb-2">
                                        <Briefcase size={18} className="text-green-500" />
                                        <h4 className="font-bold text-slate-800">Execution Team</h4>
                                    </div>
                                    <div className="space-y-4">
                                        <div>
                                            <label className="text-xs font-bold text-slate-400 uppercase tracking-wide block">Contractor</label>
                                            <p className="font-bold text-slate-900 text-lg">{formData.contractor || "N/A"}</p>
                                        </div>
                                        <div>
                                            <label className="text-xs font-bold text-slate-400 uppercase tracking-wide block">Project Engineer</label>
                                            <div className="flex items-center gap-3 mt-1 bg-slate-50 p-2 rounded-lg border border-slate-100">
                                                <div className="w-8 h-8 rounded-full bg-blue-600 text-white flex items-center justify-center font-bold text-xs ring-2 ring-white shadow-sm">
                                                    {formData.engineer?.charAt(0) || "U"}
                                                </div>
                                                <div>
                                                    <p className="text-sm font-bold text-slate-900">{formData.engineer}</p>
                                                    <p className="text-[10px] font-bold text-slate-400 uppercase">Field Engineer</p>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {/* Scope of Work */}
                            <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm space-y-2">
                                <div className="flex items-center gap-2 mb-2">
                                    <LayoutDashboard size={18} className="text-indigo-500" />
                                    <h4 className="font-bold text-slate-800">Scope of Work</h4>
                                </div>
                                <div className="p-4 bg-slate-50 rounded-xl border border-slate-100 text-sm text-slate-600 leading-relaxed min-h-[80px]">
                                    {formData.description}
                                </div>
                            </div>

                            {/* Milestone Schedule */}
                            <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm space-y-4">
                                <div className="flex items-center gap-2 mb-2">
                                    <BrainCircuit size={18} className="text-purple-500" />
                                    <h4 className="font-bold text-slate-800">Milestone Schedule</h4>
                                </div>
                                <div className="space-y-2">
                                    {formData.milestones.map((m, idx) => (
                                        <div key={idx} className="flex items-center justify-between p-3 border border-slate-100 rounded-xl hover:bg-slate-50 transition-colors">
                                            <div className="flex items-center gap-4">
                                                <div className="w-8 h-8 bg-purple-50 text-purple-600 rounded-lg flex items-center justify-center font-bold text-xs">
                                                    {idx + 1}
                                                </div>
                                                <span className="text-sm font-bold text-slate-700">{m.title}</span>
                                            </div>
                                            <div className="flex items-center gap-4">
                                                <div className="flex items-center gap-1.5 text-xs font-medium text-slate-500">
                                                    <Calendar size={14} />
                                                    {m.targetDate}
                                                </div>
                                                <span className="w-12 py-1 bg-slate-100 text-slate-600 rounded text-[10px] font-bold text-center">
                                                    {m.weight}%
                                                </span>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>

                        {/* FOOTER */}
                        <div className="px-8 py-6 border-t border-slate-100 bg-white flex items-center justify-between z-10">
                            <div className="flex items-center gap-2 text-blue-500">
                                <AlertCircle size={16} />
                                <span className="text-xs font-medium">Action cannot be undone once submitted.</span>
                            </div>
                            <div className="flex gap-4">
                                <button
                                    onClick={() => setIsReviewOpen(false)}
                                    className="px-6 py-3 text-slate-500 font-bold hover:bg-slate-50 rounded-xl transition-colors"
                                >
                                    Back to Edit
                                </button>
                                <button
                                    onClick={handleConfirmSubmission}
                                    disabled={isSubmitting}
                                    className="px-8 py-3 bg-blue-600 text-white font-bold rounded-xl shadow-lg shadow-blue-200 hover:bg-blue-700 hover:shadow-blue-300 transition-all flex items-center gap-2 disabled:opacity-50"
                                >
                                    {isSubmitting ? <LoaderSpinner /> : <CheckCircle size={20} />}
                                    Confirm Submission
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* FOOTER REMOVED AS PER UI/UX CLEANUP */}

        </div>
    );
};

const LoaderSpinner = () => (
    <svg className="animate-spin h-4 w-4 text-purple-700" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
    </svg>
);

export default CreateProject;
