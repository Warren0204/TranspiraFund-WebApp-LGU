import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    ArrowLeft, Building2, MapPin, Calendar,
    HardHat, LayoutDashboard, AlertCircle,
    CheckCircle, X, FileText, DollarSign,
    Clock, TrendingDown, Users, ClipboardList, Banknote,
    Upload
} from 'lucide-react';
import { z } from 'zod';
import HcsdSidebar from '../../components/layout/HcsdSidebar';
import { ROLES } from '../../config/roles';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { db, storage } from '../../config/firebase';
import { useAuth } from '../../context/AuthContext';
import { ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage';
import { getFunctions, httpsCallable } from 'firebase/functions';
import app from '../../config/firebase';

const NTP_ACCEPTED_TYPES = ['application/pdf', 'image/jpeg', 'image/png'];
const NTP_MAX_BYTES = 10 * 1024 * 1024;

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

const FUNDING_SOURCES = ["City-Funded", "National Government", "LGU-Barangay", "ODA/Foreign-Assisted", "PPP", "Other"];

const formatWithCommas = (value) => {
    if (!value) return '';
    const numericValue = value.toString().replace(/[^0-9]/g, '');
    if (!numericValue) return '';
    return Number(numericValue).toLocaleString('en-US');
};

const parseFormattedNumber = (value) => {
    if (!value) return '';
    return value.toString().replace(/,/g, '');
};

const projectSchema = z.object({
    projectName: z.string().min(10, "Project name must be at least 10 characters").max(200),
    barangay: z.string().min(1, "Barangay is required"),
    fundingSource: z.string().min(1, "Funding source is required"),
    contractAmount: z.number({ invalid_type_error: "Contract amount must be a number" })
        .min(10000, "Minimum contract amount is ₱10,000")
        .max(1_000_000_000, "Maximum contract amount exceeded"),
    ntpReceivedDate: z.string().min(1, "NTP received date is required"),
    officialDateStarted: z.string().min(1, "Official start date is required"),
    originalDateCompletion: z.string().min(1, "Original completion date is required"),
}).refine((data) => {
    if (data.officialDateStarted && data.originalDateCompletion) {
        return new Date(data.originalDateCompletion) > new Date(data.officialDateStarted);
    }
    return true;
}, { message: "Completion date must be after the official start date", path: ["originalDateCompletion"] });

const useCreateProject = () => {
    const navigate = useNavigate();
    const { tenantId } = useAuth();

    const [ntpFile, setNtpFile] = useState(null);
    const [ntpFileError, setNtpFileError] = useState('');

    const [formData, setFormData] = useState({
        projectName: '',
        sitioStreet: '',
        barangay: '',
        accountCode: '',
        fundingSource: 'City-Funded',
        contractAmount: '',
        contractAmountDisplay: '',
        contractor: '',
        projectEngineer: '',
        projectInspector: '',
        materialInspector: '',
        electricalInspector: '',
        ntpReceivedDate: '',
        officialDateStarted: '',
        originalDateCompletion: '',
        revisedDate1: '',
        revisedDate2: '',
        actualDateCompleted: '',
        actualPercent: '',
        resumeOrderNumber: '',
        resumeOrderDate: '',
        timeExtensionOnOrder: '',
        validationOrderNumber: '',
        validationOrderDate: '',
        suspensionOrderNumber: '',
        suspensionOrderDate: '',
        incurredAmount: '',
        incurredAmountDisplay: '',
        remarks: '',
        actionTaken: '',
    });

    const [errors, setErrors] = useState({});
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [isReviewOpen, setIsReviewOpen] = useState(false);

    const [engineers, setEngineers] = useState([]);
    const [loadingEngineers, setLoadingEngineers] = useState(true);

    useEffect(() => {
        if (!tenantId) return;
        const fetchEngineers = async () => {
            try {
                const snapshot = await getDocs(query(
                    collection(db, "users"),
                    where("tenantId", "==", tenantId),
                ));
                const fetched = snapshot.docs
                    .map(doc => ({ id: doc.id, name: `Engr. ${doc.data().firstName} ${doc.data().lastName}`, ...doc.data() }))
                    .filter(u => u.role === ROLES.PROJECT_ENGINEER || u.role === 'Project Engineer' || u.role === 'PROJ_ENG');
                setEngineers(fetched);
            } catch {
            } finally {
                setLoadingEngineers(false);
            }
        };
        fetchEngineers();
    }, [tenantId]);

    const contractDurationDays = useMemo(() => {
        if (!formData.officialDateStarted || !formData.originalDateCompletion) return null;
        const diff = new Date(formData.originalDateCompletion) - new Date(formData.officialDateStarted);
        return Math.max(0, Math.ceil(diff / 86400000));
    }, [formData.officialDateStarted, formData.originalDateCompletion]);

    const timeElapsedPercent = useMemo(() => {
        if (!formData.officialDateStarted || !formData.originalDateCompletion) return 0;
        const start = new Date(formData.officialDateStarted).getTime();
        const end = new Date(formData.originalDateCompletion).getTime();
        const today = Date.now();
        if (today <= start) return 0;
        if (today >= end) return 100;
        return Math.round(((today - start) / (end - start)) * 100);
    }, [formData.officialDateStarted, formData.originalDateCompletion]);

    const slippagePercent = useMemo(() => {
        const actual = Number(formData.actualPercent) || 0;
        return timeElapsedPercent - actual;
    }, [timeElapsedPercent, formData.actualPercent]);

    const numberOfDaysDelay = useMemo(() => {
        if (slippagePercent <= 0 || !contractDurationDays) return 0;
        return Math.round((slippagePercent / 100) * contractDurationDays);
    }, [slippagePercent, contractDurationDays]);

    const handleChange = (field, value) => {
        setFormData(prev => ({ ...prev, [field]: value }));
        if (errors[field]) setErrors(prev => { const e = { ...prev }; delete e[field]; return e; });
    };

    const handleContractAmountChange = (e) => {
        const raw = parseFormattedNumber(e.target.value);
        const display = formatWithCommas(raw);
        setFormData(prev => ({ ...prev, contractAmount: raw, contractAmountDisplay: display }));
        if (errors.contractAmount) setErrors(prev => { const e = { ...prev }; delete e.contractAmount; return e; });
    };

    const handleIncurredAmountChange = (e) => {
        const raw = parseFormattedNumber(e.target.value);
        const display = formatWithCommas(raw);
        setFormData(prev => ({ ...prev, incurredAmount: raw, incurredAmountDisplay: display }));
    };

    const handleOfficialDateStartedChange = (e) => {
        const newDate = e.target.value;
        setFormData(prev => {
            const updates = { ...prev, officialDateStarted: newDate };
            if (prev.originalDateCompletion && new Date(prev.originalDateCompletion) <= new Date(newDate)) {
                updates.originalDateCompletion = '';
            }
            return updates;
        });
        if (errors.officialDateStarted) setErrors(prev => { const e = { ...prev }; delete e.officialDateStarted; return e; });
    };

    const handleNtpFileChange = (e) => {
        const file = e.target.files?.[0];
        if (!file) { setNtpFile(null); setNtpFileError(''); return; }
        if (!NTP_ACCEPTED_TYPES.includes(file.type)) {
            setNtpFile(null);
            setNtpFileError('Unsupported file type. Upload a PDF, JPEG, or PNG.');
            return;
        }
        if (file.size > NTP_MAX_BYTES) {
            setNtpFile(null);
            setNtpFileError('File too large. Maximum size is 10 MB.');
            return;
        }
        setNtpFile(file);
        setNtpFileError('');
    };

    const handleClearNtpFile = () => { setNtpFile(null); setNtpFileError(''); };

    const isFormComplete = Boolean(
        formData.projectName &&
        formData.barangay &&
        formData.fundingSource &&
        formData.contractAmount &&
        formData.ntpReceivedDate &&
        formData.officialDateStarted &&
        formData.originalDateCompletion
    );

    const minCompletionDate = useMemo(() => {
        if (!formData.officialDateStarted) return '';
        const d = new Date(formData.officialDateStarted);
        d.setDate(d.getDate() + 1);
        return d.toISOString().split('T')[0];
    }, [formData.officialDateStarted]);

    const handleReviewRequest = (e) => {
        e.preventDefault();
        try {
            projectSchema.parse({
                projectName: formData.projectName,
                barangay: formData.barangay,
                fundingSource: formData.fundingSource,
                contractAmount: Number(formData.contractAmount),
                ntpReceivedDate: formData.ntpReceivedDate,
                officialDateStarted: formData.officialDateStarted,
                originalDateCompletion: formData.originalDateCompletion,
            });
            setErrors({});
            setIsReviewOpen(true);
        } catch (err) {
            if (err instanceof z.ZodError) {
                const fieldErrors = {};
                err.errors.forEach(e => { if (e.path[0]) fieldErrors[e.path[0]] = e.message; });
                setErrors(fieldErrors);
            } else {
                setErrors(prev => ({ ...prev, global: "Validation failed. Please check your inputs." }));
            }
        }
    };

    const handleConfirmSubmission = async () => {
        if (isSubmitting) return;
        setIsSubmitting(true);
        try {
            const functions = getFunctions(app, 'asia-southeast1');
            const createProjectFn = httpsCallable(functions, 'createProject');

            const result = await createProjectFn({
                projectName: formData.projectName,
                sitioStreet: formData.sitioStreet || undefined,
                barangay: formData.barangay,
                accountCode: formData.accountCode || undefined,
                fundingSource: formData.fundingSource,
                contractAmount: Number(formData.contractAmount),
                contractor: formData.contractor || undefined,
                projectEngineer: formData.projectEngineer || undefined,
                projectInspector: formData.projectInspector || undefined,
                materialInspector: formData.materialInspector || undefined,
                electricalInspector: formData.electricalInspector || undefined,
                ntpReceivedDate: formData.ntpReceivedDate,
                officialDateStarted: formData.officialDateStarted,
                originalDateCompletion: formData.originalDateCompletion,
                revisedDate1: formData.revisedDate1 || undefined,
                revisedDate2: formData.revisedDate2 || undefined,
                actualDateCompleted: formData.actualDateCompleted || undefined,
                actualPercent: formData.actualPercent !== '' ? Number(formData.actualPercent) : undefined,
                resumeOrderNumber: formData.resumeOrderNumber || undefined,
                resumeOrderDate: formData.resumeOrderDate || undefined,
                timeExtensionOnOrder: formData.timeExtensionOnOrder || undefined,
                validationOrderNumber: formData.validationOrderNumber || undefined,
                validationOrderDate: formData.validationOrderDate || undefined,
                suspensionOrderNumber: formData.suspensionOrderNumber || undefined,
                suspensionOrderDate: formData.suspensionOrderDate || undefined,
                incurredAmount: formData.incurredAmount ? Number(formData.incurredAmount) : undefined,
                remarks: formData.remarks || undefined,
                actionTaken: formData.actionTaken || undefined,
            });

            const projectId = result?.data?.projectId;

            if (ntpFile && projectId) {
                try {
                    const safeName = ntpFile.name.replace(/[^a-zA-Z0-9._-]/g, '_');
                    const objectRef = storageRef(storage, `projects/${projectId}/ntp/${safeName}`);
                    await uploadBytes(objectRef, ntpFile, { contentType: ntpFile.type });
                    const fileUrl = await getDownloadURL(objectRef);

                    const attachNtpFn = httpsCallable(functions, 'attachNtp');
                    await attachNtpFn({
                        projectId,
                        fileName: safeName,
                        fileUrl,
                        sizeBytes: ntpFile.size,
                        contentType: ntpFile.type,
                    });
                } catch (uploadErr) {
                    setErrors(prev => ({ ...prev, global: `Project created, but NTP upload failed: ${uploadErr.message || 'Unknown error'}. You can attach it later from the project page.` }));
                    setIsSubmitting(false);
                    return;
                }
            }

            navigate('/hcsd/projects');
        } catch (err) {
            setErrors(prev => ({ ...prev, global: err.message || "Failed to submit project. Please try again." }));
            setIsSubmitting(false);
        }
    };

    return {
        formData, errors, isSubmitting,
        engineers, loadingEngineers,
        ntpFile, ntpFileError, handleNtpFileChange, handleClearNtpFile,
        handleChange, handleContractAmountChange, handleIncurredAmountChange,
        handleOfficialDateStartedChange, navigate,
        isReviewOpen, setIsReviewOpen, handleReviewRequest, handleConfirmSubmission,
        isFormComplete, minCompletionDate,
        contractDurationDays, timeElapsedPercent, slippagePercent, numberOfDaysDelay,
        CEBU_CITY_BARANGAYS
    };
};

const inputCls = (error) =>
    `w-full p-4 bg-slate-50 border ${error ? 'border-red-300 focus:ring-red-100' : 'border-slate-200 focus:ring-teal-100'} rounded-xl font-semibold text-slate-700 focus:border-teal-500 focus:ring-4 outline-none transition-all`;

const labelCls = "text-xs font-bold text-slate-400 uppercase tracking-wide";

const SectionCard = ({ icon: Icon, iconColor = "text-teal-600", title, children }) => (
    <div className="bg-white rounded-[24px] border border-slate-200 shadow-sm overflow-hidden">
        <div className="p-6 border-b border-slate-100 bg-slate-50/50 flex items-center gap-3">
            <Icon className={iconColor} size={24} />
            <h2 className="text-lg font-bold text-slate-800">{title}</h2>
        </div>
        <div className="p-4 sm:p-8 space-y-6 sm:space-y-8">
            {children}
        </div>
    </div>
);

const FieldError = ({ msg }) => msg
    ? <p className="text-xs text-red-500 font-bold flex items-center gap-1"><AlertCircle size={12} />{msg}</p>
    : null;

const ReadOnlyField = ({ label, value, highlight }) => (
    <div className="space-y-1">
        <span className={labelCls}>{label}</span>
        <div className={`p-3 rounded-lg border text-sm font-bold ${highlight ? 'bg-red-50 border-red-200 text-red-700' : 'bg-slate-50 border-slate-200 text-slate-700'}`}>
            {value ?? '—'}
        </div>
    </div>
);

const LoaderSpinner = () => (
    <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="animate-spin">
        <line x1="12" y1="2" x2="12" y2="6" /><line x1="12" y1="18" x2="12" y2="22" />
        <line x1="4.93" y1="4.93" x2="7.76" y2="7.76" /><line x1="16.24" y1="16.24" x2="19.07" y2="19.07" />
        <line x1="2" y1="12" x2="6" y2="12" /><line x1="18" y1="12" x2="22" y2="12" />
    </svg>
);

const CreateProject = () => {
    const {
        formData, errors, isSubmitting,
        engineers, loadingEngineers,
        ntpFile, ntpFileError, handleNtpFileChange, handleClearNtpFile,
        handleChange, handleContractAmountChange, handleIncurredAmountChange,
        handleOfficialDateStartedChange, navigate,
        isReviewOpen, setIsReviewOpen, handleReviewRequest, handleConfirmSubmission,
        isFormComplete, minCompletionDate,
        contractDurationDays, timeElapsedPercent, slippagePercent, numberOfDaysDelay,
        CEBU_CITY_BARANGAYS
    } = useCreateProject();

    return (
        <div className="min-h-screen hcsd-bg font-sans text-slate-900">
            <HcsdSidebar />

            <main className="ml-0 md:ml-72 p-4 md:p-6 lg:p-10 pt-20 md:pt-10 pb-20 md:pb-32">

                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6 sm:mb-8">
                    <div className="flex flex-col gap-2">
                        <button onClick={() => navigate('/hcsd/projects')}
                            className="flex items-center gap-2 text-sm font-bold text-slate-400 hover:text-slate-700 transition-colors w-fit">
                            <ArrowLeft size={16} />
                            Back to Project Registry
                        </button>
                        <div>
                            <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight">Create Project</h1>
                            <p className="text-slate-500 font-bold text-xs uppercase tracking-wider mt-1">NEW INFRASTRUCTURE PROJECT</p>
                        </div>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                        <span className="flex items-center gap-1.5 px-3 py-1.5 bg-green-100 text-green-700 rounded-full text-xs font-bold uppercase tracking-wide">
                            <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
                            Drafting Mode
                        </span>
                    </div>
                </div>

                <form onSubmit={handleReviewRequest} noValidate>
                    <div className="space-y-8">

                        <SectionCard icon={LayoutDashboard} title="Project Details">
                            <div className="space-y-2">
                                <label className={labelCls}>Project Name <span className="text-red-400">*</span></label>
                                <input
                                    type="text"
                                    value={formData.projectName}
                                    onChange={(e) => handleChange('projectName', e.target.value)}
                                    placeholder="e.g. Construction of Multi-Purpose Building Phase 1"
                                    maxLength={200}
                                    className={inputCls(errors.projectName)}
                                />
                                <FieldError msg={errors.projectName} />
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 sm:gap-8">
                                <div className="space-y-2">
                                    <label className={labelCls}>Barangay <span className="text-red-400">*</span></label>
                                    <div className="relative">
                                        <MapPin className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                                        <select
                                            value={formData.barangay}
                                            onChange={(e) => handleChange('barangay', e.target.value)}
                                            className={`w-full pl-12 pr-4 py-4 bg-slate-50 border ${errors.barangay ? 'border-red-300' : 'border-slate-200'} rounded-xl font-semibold text-slate-700 outline-none focus:border-teal-500 focus:ring-4 focus:ring-teal-100 transition-all appearance-none cursor-pointer`}
                                        >
                                            <option value="">Select Barangay...</option>
                                            {CEBU_CITY_BARANGAYS.map(b => <option key={b} value={b}>{b}</option>)}
                                        </select>
                                    </div>
                                    <FieldError msg={errors.barangay} />
                                </div>

                                <div className="space-y-2">
                                    <label className={labelCls}>Sitio / Street</label>
                                    <input
                                        type="text"
                                        value={formData.sitioStreet}
                                        onChange={(e) => handleChange('sitioStreet', e.target.value)}
                                        placeholder="e.g. Sitio Bagong Pag-asa, P. Burgos St."
                                        maxLength={200}
                                        className={inputCls(false)}
                                    />
                                </div>
                            </div>

                            {contractDurationDays !== null && (
                                <div className="p-4 bg-teal-50 border border-teal-100 rounded-xl flex items-center gap-3">
                                    <Clock className="text-teal-600 shrink-0" size={18} />
                                    <span className="text-sm font-bold text-teal-700">
                                        Contract Duration: <span className="text-teal-900">{contractDurationDays} calendar day{contractDurationDays !== 1 ? 's' : ''}</span>
                                    </span>
                                </div>
                            )}
                        </SectionCard>

                        <SectionCard icon={FileText} iconColor="text-violet-600" title="Account Code & Funding">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 sm:gap-8">
                                <div className="space-y-2">
                                    <label className={labelCls}>Account Code</label>
                                    <input
                                        type="text"
                                        value={formData.accountCode}
                                        onChange={(e) => handleChange('accountCode', e.target.value)}
                                        placeholder="e.g. 5-02-99-990"
                                        maxLength={100}
                                        className={inputCls(false)}
                                    />
                                </div>

                                <div className="space-y-2">
                                    <label className={labelCls}>Funding Source <span className="text-red-400">*</span></label>
                                    <select
                                        value={formData.fundingSource}
                                        onChange={(e) => handleChange('fundingSource', e.target.value)}
                                        className={`w-full p-4 bg-slate-50 border ${errors.fundingSource ? 'border-red-300' : 'border-slate-200'} rounded-xl font-semibold text-slate-700 outline-none focus:border-teal-500 focus:ring-4 focus:ring-teal-100 transition-all appearance-none cursor-pointer`}
                                    >
                                        {FUNDING_SOURCES.map(s => <option key={s} value={s}>{s}</option>)}
                                    </select>
                                    <FieldError msg={errors.fundingSource} />
                                </div>
                            </div>
                        </SectionCard>

                        <SectionCard icon={Banknote} iconColor="text-emerald-600" title="Contract Amount">
                            <div className="space-y-2">
                                <label className={labelCls}>Contract Amount (Php) <span className="text-red-400">*</span></label>
                                <div className="relative">
                                    <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 font-bold text-lg">₱</span>
                                    <input
                                        type="text"
                                        value={formData.contractAmountDisplay}
                                        onChange={handleContractAmountChange}
                                        placeholder="0"
                                        className={`w-full pl-10 pr-4 py-4 bg-slate-50 border ${errors.contractAmount ? 'border-red-300 focus:ring-red-100' : 'border-slate-200 focus:ring-teal-100'} rounded-xl font-semibold text-slate-700 focus:border-teal-500 focus:ring-4 outline-none transition-all`}
                                    />
                                </div>
                                <FieldError msg={errors.contractAmount} />
                            </div>
                        </SectionCard>

                        <SectionCard icon={Users} iconColor="text-green-600" title="Contractor & Assigned Personnel">
                            <div className="space-y-2">
                                <label className={labelCls}>Contractor</label>
                                <div className="relative">
                                    <Building2 className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                                    <input
                                        type="text"
                                        value={formData.contractor}
                                        onChange={(e) => handleChange('contractor', e.target.value)}
                                        placeholder="Company / Contractor Name"
                                        maxLength={200}
                                        className="w-full pl-12 pr-4 py-4 bg-slate-50 border border-slate-200 rounded-xl font-semibold text-slate-700 outline-none focus:border-green-500 focus:ring-4 focus:ring-green-100 transition-all"
                                    />
                                </div>
                            </div>

                            <div className="space-y-3">
                                <label className={labelCls}>Assigned Personnel</label>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <div className="space-y-1">
                                        <span className="text-xs font-semibold text-slate-500">a. Project Engineer</span>
                                        {loadingEngineers ? (
                                            <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl text-slate-400 text-sm animate-pulse">Loading Engineers...</div>
                                        ) : engineers.length === 0 ? (
                                            <div className="p-4 bg-red-50 border border-red-100 rounded-xl flex items-center gap-2 text-red-600 text-sm font-medium">
                                                <AlertCircle size={16} className="shrink-0" />
                                                <span>No engineers found. <button type="button" onClick={() => navigate('/hcsd/staff')} className="underline font-bold">Manage Staff</button></span>
                                            </div>
                                        ) : (
                                            <div className="relative">
                                                <HardHat className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                                                <select
                                                    value={formData.projectEngineer}
                                                    onChange={(e) => handleChange('projectEngineer', e.target.value)}
                                                    className="w-full pl-12 pr-4 py-4 bg-slate-50 border border-slate-200 rounded-xl font-semibold text-slate-700 outline-none focus:border-green-500 focus:ring-4 focus:ring-green-100 transition-all appearance-none cursor-pointer"
                                                >
                                                    <option value="">Select Engineer...</option>
                                                    {engineers.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
                                                </select>
                                            </div>
                                        )}
                                    </div>

                                    <div className="space-y-1">
                                        <span className="text-xs font-semibold text-slate-500">b. Project Inspector</span>
                                        <input
                                            type="text"
                                            value={formData.projectInspector}
                                            onChange={(e) => handleChange('projectInspector', e.target.value)}
                                            placeholder="Inspector name"
                                            maxLength={100}
                                            className={inputCls(false)}
                                        />
                                    </div>

                                    <div className="space-y-1">
                                        <span className="text-xs font-semibold text-slate-500">c. Material Inspector</span>
                                        <input
                                            type="text"
                                            value={formData.materialInspector}
                                            onChange={(e) => handleChange('materialInspector', e.target.value)}
                                            placeholder="Inspector name"
                                            maxLength={100}
                                            className={inputCls(false)}
                                        />
                                    </div>

                                    <div className="space-y-1">
                                        <span className="text-xs font-semibold text-slate-500">d. Electrical Inspector</span>
                                        <input
                                            type="text"
                                            value={formData.electricalInspector}
                                            onChange={(e) => handleChange('electricalInspector', e.target.value)}
                                            placeholder="Inspector name"
                                            maxLength={100}
                                            className={inputCls(false)}
                                        />
                                    </div>
                                </div>
                            </div>
                        </SectionCard>

                        <SectionCard icon={Calendar} iconColor="text-blue-600" title="Project Timeliness">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                <div className="space-y-1">
                                    <label className={labelCls}>Date of NTP Received <span className="text-red-400">*</span></label>
                                    <input type="date" value={formData.ntpReceivedDate}
                                        onChange={(e) => handleChange('ntpReceivedDate', e.target.value)}
                                        className={`w-full p-3 bg-slate-50 border ${errors.ntpReceivedDate ? 'border-red-300' : 'border-slate-200'} rounded-xl font-medium text-slate-700 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 transition-all`}
                                    />
                                    <FieldError msg={errors.ntpReceivedDate} />
                                </div>

                                <div className="space-y-1">
                                    <label className={labelCls}>Official Date Started <span className="text-red-400">*</span></label>
                                    <input type="date" value={formData.officialDateStarted}
                                        onChange={handleOfficialDateStartedChange}
                                        className={`w-full p-3 bg-slate-50 border ${errors.officialDateStarted ? 'border-red-300' : 'border-slate-200'} rounded-xl font-medium text-slate-700 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 transition-all`}
                                    />
                                    <FieldError msg={errors.officialDateStarted} />
                                </div>

                                <div className="space-y-1 md:col-span-2">
                                    <label className={labelCls}>NTP Document <span className="text-slate-400 normal-case font-semibold tracking-normal">(optional — PDF, JPEG, PNG · max 10 MB)</span></label>
                                    {!ntpFile ? (
                                        <label className="flex items-center gap-3 p-4 bg-slate-50 border border-dashed border-slate-300 rounded-xl cursor-pointer hover:bg-slate-100 hover:border-blue-300 transition-all">
                                            <Upload className="text-slate-400" size={18} />
                                            <span className="text-sm font-semibold text-slate-500">Choose a file to upload…</span>
                                            <input
                                                type="file"
                                                accept="application/pdf,image/jpeg,image/png"
                                                onChange={handleNtpFileChange}
                                                className="hidden"
                                            />
                                        </label>
                                    ) : (
                                        <div className="flex items-center gap-3 p-4 bg-blue-50 border border-blue-200 rounded-xl">
                                            <FileText className="text-blue-600 shrink-0" size={18} />
                                            <div className="flex-1 min-w-0">
                                                <p className="text-sm font-bold text-slate-800 truncate">{ntpFile.name}</p>
                                                <p className="text-xs text-slate-500">{(ntpFile.size / 1024 / 1024).toFixed(2)} MB</p>
                                            </div>
                                            <button type="button" onClick={handleClearNtpFile} className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-white transition-colors">
                                                <X size={16} />
                                            </button>
                                        </div>
                                    )}
                                    {ntpFileError && <FieldError msg={ntpFileError} />}
                                </div>
                            </div>

                            <div className="p-4 bg-slate-50 rounded-xl border border-slate-100">
                                <p className="text-xs font-bold text-slate-400 uppercase tracking-wide mb-4">Date of Completion</p>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <div className="space-y-1">
                                        <span className="text-xs font-semibold text-slate-500">a. Original Date Completion <span className="text-red-400">*</span></span>
                                        <input type="date" value={formData.originalDateCompletion}
                                            onChange={(e) => handleChange('originalDateCompletion', e.target.value)}
                                            disabled={!formData.officialDateStarted}
                                            min={minCompletionDate}
                                            className={`w-full p-3 border ${errors.originalDateCompletion ? 'border-red-300' : 'border-slate-200'} rounded-xl font-medium outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 transition-all ${!formData.officialDateStarted ? 'bg-slate-100 text-slate-400 cursor-not-allowed' : 'bg-white text-slate-700'}`}
                                        />
                                        <FieldError msg={errors.originalDateCompletion} />
                                    </div>
                                    <div className="space-y-1">
                                        <span className="text-xs font-semibold text-slate-500">b. Revised #1</span>
                                        <input type="date" value={formData.revisedDate1}
                                            onChange={(e) => handleChange('revisedDate1', e.target.value)}
                                            className="w-full p-3 bg-white border border-slate-200 rounded-xl font-medium text-slate-700 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 transition-all"
                                        />
                                    </div>
                                    <div className="space-y-1">
                                        <span className="text-xs font-semibold text-slate-500">c. Revised #2</span>
                                        <input type="date" value={formData.revisedDate2}
                                            onChange={(e) => handleChange('revisedDate2', e.target.value)}
                                            className="w-full p-3 bg-white border border-slate-200 rounded-xl font-medium text-slate-700 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 transition-all"
                                        />
                                    </div>
                                    <div className="space-y-1">
                                        <span className="text-xs font-semibold text-slate-500">d. Actual Date Completed</span>
                                        <input type="date" value={formData.actualDateCompleted}
                                            onChange={(e) => handleChange('actualDateCompleted', e.target.value)}
                                            className="w-full p-3 bg-white border border-slate-200 rounded-xl font-medium text-slate-700 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 transition-all"
                                        />
                                    </div>
                                </div>
                            </div>
                        </SectionCard>

                        <SectionCard icon={TrendingDown} iconColor="text-amber-600" title="Project Accomplishment (%)">
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                                <ReadOnlyField label="Time Elapsed (%)" value={`${timeElapsedPercent}%`} />

                                <div className="space-y-1">
                                    <span className={labelCls}>Actual (%)</span>
                                    <input
                                        type="number"
                                        min={0} max={100}
                                        value={formData.actualPercent}
                                        onChange={(e) => handleChange('actualPercent', e.target.value)}
                                        placeholder="0"
                                        className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl font-semibold text-slate-700 outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-100 transition-all"
                                    />
                                </div>

                                <ReadOnlyField
                                    label="Slippage (%)"
                                    value={`${slippagePercent > 0 ? '+' : ''}${slippagePercent}%`}
                                    highlight={slippagePercent > 0}
                                />

                                <ReadOnlyField
                                    label="No. of Days Delay"
                                    value={numberOfDaysDelay > 0 ? `${numberOfDaysDelay} day${numberOfDaysDelay !== 1 ? 's' : ''}` : '—'}
                                    highlight={numberOfDaysDelay > 0}
                                />
                            </div>
                        </SectionCard>

                        <SectionCard icon={ClipboardList} iconColor="text-orange-600" title="Project Order">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                <div className="space-y-2 p-4 bg-slate-50 rounded-xl border border-slate-100">
                                    <p className="text-xs font-bold text-slate-500 uppercase tracking-wide">Resume Order</p>
                                    <div className="space-y-2">
                                        <div className="space-y-1">
                                            <span className="text-xs font-semibold text-slate-400">Order Number</span>
                                            <input type="text" value={formData.resumeOrderNumber}
                                                onChange={(e) => handleChange('resumeOrderNumber', e.target.value)}
                                                placeholder="e.g. RO-2024-001"
                                                maxLength={100}
                                                className="w-full p-3 bg-white border border-slate-200 rounded-lg font-medium text-slate-700 outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-100 transition-all text-sm"
                                            />
                                        </div>
                                        <div className="space-y-1">
                                            <span className="text-xs font-semibold text-slate-400">Date</span>
                                            <input type="date" value={formData.resumeOrderDate}
                                                onChange={(e) => handleChange('resumeOrderDate', e.target.value)}
                                                className="w-full p-3 bg-white border border-slate-200 rounded-lg font-medium text-slate-700 outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-100 transition-all text-sm"
                                            />
                                        </div>
                                    </div>
                                </div>

                                <div className="space-y-2 p-4 bg-slate-50 rounded-xl border border-slate-100">
                                    <p className="text-xs font-bold text-slate-500 uppercase tracking-wide">Time Extension on Order</p>
                                    <input type="text" value={formData.timeExtensionOnOrder}
                                        onChange={(e) => handleChange('timeExtensionOnOrder', e.target.value)}
                                        placeholder="e.g. 30 days"
                                        maxLength={100}
                                        className="w-full p-3 bg-white border border-slate-200 rounded-lg font-medium text-slate-700 outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-100 transition-all text-sm"
                                    />
                                </div>

                                <div className="space-y-2 p-4 bg-slate-50 rounded-xl border border-slate-100">
                                    <p className="text-xs font-bold text-slate-500 uppercase tracking-wide">Validation Order</p>
                                    <div className="space-y-2">
                                        <div className="space-y-1">
                                            <span className="text-xs font-semibold text-slate-400">Order Number</span>
                                            <input type="text" value={formData.validationOrderNumber}
                                                onChange={(e) => handleChange('validationOrderNumber', e.target.value)}
                                                placeholder="e.g. VO-2024-001"
                                                maxLength={100}
                                                className="w-full p-3 bg-white border border-slate-200 rounded-lg font-medium text-slate-700 outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-100 transition-all text-sm"
                                            />
                                        </div>
                                        <div className="space-y-1">
                                            <span className="text-xs font-semibold text-slate-400">Date</span>
                                            <input type="date" value={formData.validationOrderDate}
                                                onChange={(e) => handleChange('validationOrderDate', e.target.value)}
                                                className="w-full p-3 bg-white border border-slate-200 rounded-lg font-medium text-slate-700 outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-100 transition-all text-sm"
                                            />
                                        </div>
                                    </div>
                                </div>

                                <div className="space-y-2 p-4 bg-slate-50 rounded-xl border border-slate-100">
                                    <p className="text-xs font-bold text-slate-500 uppercase tracking-wide">Suspension Order</p>
                                    <div className="space-y-2">
                                        <div className="space-y-1">
                                            <span className="text-xs font-semibold text-slate-400">Order Number</span>
                                            <input type="text" value={formData.suspensionOrderNumber}
                                                onChange={(e) => handleChange('suspensionOrderNumber', e.target.value)}
                                                placeholder="e.g. SO-2024-001"
                                                maxLength={100}
                                                className="w-full p-3 bg-white border border-slate-200 rounded-lg font-medium text-slate-700 outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-100 transition-all text-sm"
                                            />
                                        </div>
                                        <div className="space-y-1">
                                            <span className="text-xs font-semibold text-slate-400">Date</span>
                                            <input type="date" value={formData.suspensionOrderDate}
                                                onChange={(e) => handleChange('suspensionOrderDate', e.target.value)}
                                                className="w-full p-3 bg-white border border-slate-200 rounded-lg font-medium text-slate-700 outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-100 transition-all text-sm"
                                            />
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </SectionCard>

                        <SectionCard icon={DollarSign} iconColor="text-indigo-600" title="Fund Utilization & Notes">
                            <div className="space-y-2">
                                <label className={labelCls}>Incurred (Fund Utilization)</label>
                                <div className="relative">
                                    <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 font-bold text-lg">₱</span>
                                    <input
                                        type="text"
                                        value={formData.incurredAmountDisplay}
                                        onChange={handleIncurredAmountChange}
                                        placeholder="0"
                                        className="w-full pl-10 pr-4 py-4 bg-slate-50 border border-slate-200 rounded-xl font-semibold text-slate-700 outline-none focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100 transition-all"
                                    />
                                </div>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                <div className="space-y-2">
                                    <label className={labelCls}>Remarks</label>
                                    <textarea
                                        value={formData.remarks}
                                        onChange={(e) => handleChange('remarks', e.target.value)}
                                        placeholder="Project observations, site conditions, or other relevant notes..."
                                        maxLength={1000}
                                        className="w-full p-4 bg-slate-50 border border-slate-200 rounded-xl font-medium text-slate-700 focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100 outline-none transition-all h-32 resize-none"
                                    />
                                    <p className="text-xs text-right text-slate-300 font-bold">{formData.remarks.length} / 1000</p>
                                </div>

                                <div className="space-y-2">
                                    <label className={labelCls}>Action Taken</label>
                                    <textarea
                                        value={formData.actionTaken}
                                        onChange={(e) => handleChange('actionTaken', e.target.value)}
                                        placeholder="Corrective actions, follow-ups, or resolutions applied..."
                                        maxLength={1000}
                                        className="w-full p-4 bg-slate-50 border border-slate-200 rounded-xl font-medium text-slate-700 focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100 outline-none transition-all h-32 resize-none"
                                    />
                                    <p className="text-xs text-right text-slate-300 font-bold">{formData.actionTaken.length} / 1000</p>
                                </div>
                            </div>
                        </SectionCard>

                        {errors.global && (
                            <div className="flex items-center gap-2 p-4 bg-red-50 border border-red-200 rounded-xl text-red-700 text-sm font-bold">
                                <AlertCircle size={18} className="shrink-0" />
                                {errors.global}
                            </div>
                        )}

                        <div className="flex flex-col sm:flex-row gap-3 pt-4">
                            <button type="button"
                                onClick={() => navigate('/hcsd/projects')}
                                className="flex-1 sm:flex-none px-8 py-4 bg-slate-100 text-slate-600 font-bold rounded-xl hover:bg-slate-200 transition-colors"
                            >
                                Cancel
                            </button>
                            <button
                                type="submit"
                                disabled={!isFormComplete}
                                className={`flex-1 py-4 rounded-xl font-extrabold text-sm uppercase tracking-widest transition-all flex items-center justify-center gap-2 ${isFormComplete ? 'bg-gradient-to-r from-teal-600 to-emerald-500 hover:from-teal-700 hover:to-emerald-600 text-white shadow-lg shadow-teal-500/25' : 'bg-slate-200 text-slate-400 cursor-not-allowed'}`}
                            >
                                <CheckCircle size={18} />
                                Review & Submit Project
                            </button>
                        </div>

                    </div>
                </form>
            </main>

            {isReviewOpen && (
                <div className="fixed inset-0 bg-black/60 flex items-start justify-center z-50 p-4 pt-16 overflow-y-auto">
                    <div className="bg-white rounded-[24px] max-w-2xl w-full shadow-2xl mb-8">
                        <div className="p-6 border-b border-slate-100 flex items-center justify-between">
                            <h2 className="text-xl font-extrabold text-slate-900">Review Project Submission</h2>
                            <button type="button" onClick={() => setIsReviewOpen(false)} className="p-2 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors">
                                <X size={20} />
                            </button>
                        </div>

                        <div className="p-6 space-y-6 max-h-[60vh] overflow-y-auto">
                            <div>
                                <p className="text-xs font-extrabold text-slate-400 uppercase tracking-widest mb-3">Project Details</p>
                                <div className="space-y-2 text-sm">
                                    <div className="flex gap-2"><span className="font-bold text-slate-500 w-36 shrink-0">Project Name</span><span className="text-slate-800 font-semibold">{formData.projectName}</span></div>
                                    <div className="flex gap-2"><span className="font-bold text-slate-500 w-36 shrink-0">Barangay</span><span className="text-slate-800 font-semibold">{formData.barangay}</span></div>
                                    {formData.sitioStreet && <div className="flex gap-2"><span className="font-bold text-slate-500 w-36 shrink-0">Sitio / Street</span><span className="text-slate-800 font-semibold">{formData.sitioStreet}</span></div>}
                                    {contractDurationDays !== null && <div className="flex gap-2"><span className="font-bold text-slate-500 w-36 shrink-0">Contract Duration</span><span className="text-slate-800 font-semibold">{contractDurationDays} days</span></div>}
                                </div>
                            </div>

                            <hr className="border-slate-100" />

                            <div>
                                <p className="text-xs font-extrabold text-slate-400 uppercase tracking-widest mb-3">Financials</p>
                                <div className="space-y-2 text-sm">
                                    {formData.accountCode && <div className="flex gap-2"><span className="font-bold text-slate-500 w-36 shrink-0">Account Code</span><span className="text-slate-800 font-semibold">{formData.accountCode}</span></div>}
                                    <div className="flex gap-2"><span className="font-bold text-slate-500 w-36 shrink-0">Funding Source</span><span className="text-slate-800 font-semibold">{formData.fundingSource}</span></div>
                                    <div className="flex gap-2"><span className="font-bold text-slate-500 w-36 shrink-0">Contract Amount</span><span className="text-slate-800 font-semibold">₱{Number(formData.contractAmount).toLocaleString('en-US')}</span></div>
                                </div>
                            </div>

                            <hr className="border-slate-100" />

                            <div>
                                <p className="text-xs font-extrabold text-slate-400 uppercase tracking-widest mb-3">Personnel</p>
                                <div className="space-y-2 text-sm">
                                    {formData.contractor && <div className="flex gap-2"><span className="font-bold text-slate-500 w-36 shrink-0">Contractor</span><span className="text-slate-800 font-semibold">{formData.contractor}</span></div>}
                                    {formData.projectEngineer && <div className="flex gap-2"><span className="font-bold text-slate-500 w-36 shrink-0">Proj. Engineer</span><span className="text-slate-800 font-semibold">{engineers.find(e => e.id === formData.projectEngineer)?.name || formData.projectEngineer}</span></div>}
                                    {formData.projectInspector && <div className="flex gap-2"><span className="font-bold text-slate-500 w-36 shrink-0">Proj. Inspector</span><span className="text-slate-800 font-semibold">{formData.projectInspector}</span></div>}
                                    {formData.materialInspector && <div className="flex gap-2"><span className="font-bold text-slate-500 w-36 shrink-0">Material Inspector</span><span className="text-slate-800 font-semibold">{formData.materialInspector}</span></div>}
                                    {formData.electricalInspector && <div className="flex gap-2"><span className="font-bold text-slate-500 w-36 shrink-0">Electrical Inspector</span><span className="text-slate-800 font-semibold">{formData.electricalInspector}</span></div>}
                                </div>
                            </div>

                            <hr className="border-slate-100" />

                            <div>
                                <p className="text-xs font-extrabold text-slate-400 uppercase tracking-widest mb-3">Timeliness</p>
                                <div className="space-y-2 text-sm">
                                    <div className="flex gap-2"><span className="font-bold text-slate-500 w-36 shrink-0">NTP Received</span><span className="text-slate-800 font-semibold">{formData.ntpReceivedDate}</span></div>
                                    <div className="flex gap-2"><span className="font-bold text-slate-500 w-36 shrink-0">NTP Document</span><span className="text-slate-800 font-semibold">{ntpFile ? ntpFile.name : <em className="text-slate-400 font-medium">None attached</em>}</span></div>
                                    <div className="flex gap-2"><span className="font-bold text-slate-500 w-36 shrink-0">Date Started</span><span className="text-slate-800 font-semibold">{formData.officialDateStarted}</span></div>
                                    <div className="flex gap-2"><span className="font-bold text-slate-500 w-36 shrink-0">Date Completion</span><span className="text-slate-800 font-semibold">{formData.originalDateCompletion}</span></div>
                                </div>
                            </div>

                        </div>

                        {errors.global && (
                            <div className="mx-6 mb-2 flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-xl text-red-700 text-sm font-bold">
                                <AlertCircle size={16} className="shrink-0 mt-0.5" />
                                <span>{errors.global}</span>
                            </div>
                        )}

                        <div className="p-6 border-t border-slate-100 flex gap-3">
                            <button type="button" onClick={() => setIsReviewOpen(false)} className="flex-1 py-3 bg-slate-100 text-slate-600 font-bold rounded-xl hover:bg-slate-200 transition-colors">
                                Edit
                            </button>
                            <button
                                type="button"
                                onClick={handleConfirmSubmission}
                                disabled={isSubmitting}
                                className="flex-1 py-3 bg-gradient-to-r from-teal-600 to-emerald-500 hover:from-teal-700 hover:to-emerald-600 text-white font-extrabold rounded-xl shadow-lg shadow-teal-500/25 transition-all flex items-center justify-center gap-2 disabled:opacity-70"
                            >
                                {isSubmitting ? <><LoaderSpinner /> Submitting...</> : <><CheckCircle size={18} /> Confirm & Submit</>}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default CreateProject;
