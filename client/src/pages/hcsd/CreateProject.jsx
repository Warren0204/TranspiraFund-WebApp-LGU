import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    ArrowLeft, Building2, MapPin, Calendar,
    HardHat, LayoutDashboard, AlertCircle,
    CheckCircle, X, FileText, DollarSign,
    Clock, TrendingDown, Users, ClipboardList, Banknote,
    Upload, Info
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
    projectDescription: z.string()
        .max(1000, "Project description must be at most 1000 characters")
        .optional(),
    barangay: z.string().min(1, "Barangay is required"),
    sitioStreet: z.string().min(1, "Sitio / Street is required").max(200),
    accountCode: z.string().min(1, "Account Code is required").max(100),
    fundingSource: z.string().max(100).optional(),
    contractAmount: z.number({ invalid_type_error: "Contract amount must be a number" })
        .min(10000, "Minimum contract amount is ₱10,000")
        .max(1_000_000_000, "Maximum contract amount exceeded"),
    contractor: z.string().min(1, "Contractor is required").max(200),
    projectEngineer: z.string().min(1, "Project Engineer is required").max(200),
    ntpReceivedDate: z.string().min(1, "NTP received date is required"),
    officialDateStarted: z.string().min(1, "Official start date is required"),
    originalDateCompletion: z.string().min(1, "Original completion date is required"),
    projectType: z.string().optional(),
    classificationConfidence: z.number().min(0).max(1).optional(),
}).refine((data) => {
    if (data.officialDateStarted && data.originalDateCompletion) {
        return new Date(data.originalDateCompletion) > new Date(data.officialDateStarted);
    }
    return true;
}, { message: "Completion date must be after the official start date", path: ["originalDateCompletion"] });

const formatProjectTypeLabel = (t) => {
    if (!t) return "Project";
    return t.split("_").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
};

const useCreateProject = () => {
    const navigate = useNavigate();
    const { tenantId } = useAuth();

    const [ntpFile, setNtpFile] = useState(null);
    const [ntpFileError, setNtpFileError] = useState('');

    const [formData, setFormData] = useState({
        projectName: '',
        projectDescription: '',
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
    const [isValidating, setIsValidating] = useState(false);
    const [isReviewOpen, setIsReviewOpen] = useState(false);
    const [classification, setClassification] = useState(null);
    const [advisoryConfirmOpen, setAdvisoryConfirmOpen] = useState(false);
    const [completionClearedNotice, setCompletionClearedNotice] = useState(null);

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
        if (field === 'originalDateCompletion' && completionClearedNotice) {
            setCompletionClearedNotice(null);
        }
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
        const wouldClearCompletion = Boolean(
            formData.originalDateCompletion &&
            new Date(formData.originalDateCompletion) <= new Date(newDate)
        );
        setFormData(prev => {
            const updates = { ...prev, officialDateStarted: newDate };
            if (prev.originalDateCompletion && new Date(prev.originalDateCompletion) <= new Date(newDate)) {
                updates.originalDateCompletion = '';
            }
            return updates;
        });
        if (wouldClearCompletion) {
            setCompletionClearedNotice("Completion date cleared because it was before the new start date. Please select a new completion date.");
        }
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
        formData.sitioStreet &&
        formData.accountCode &&
        formData.contractAmount &&
        formData.contractor &&
        formData.projectEngineer &&
        formData.ntpReceivedDate &&
        formData.officialDateStarted &&
        formData.originalDateCompletion &&
        ntpFile
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
                projectDescription: formData.projectDescription,
                barangay: formData.barangay,
                sitioStreet: formData.sitioStreet,
                accountCode: formData.accountCode,
                fundingSource: formData.fundingSource,
                contractAmount: Number(formData.contractAmount),
                contractor: formData.contractor,
                projectEngineer: formData.projectEngineer,
                ntpReceivedDate: formData.ntpReceivedDate,
                officialDateStarted: formData.officialDateStarted,
                originalDateCompletion: formData.originalDateCompletion,
            });
            if (!ntpFile) {
                setNtpFileError('NTP document is required.');
                setErrors({});
                return;
            }
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

    // Inner step: actually create the project (and attach NTP). Called from
    // either the within_range happy path (handleConfirmSubmission) or after
    // the user accepts the duration-confirm modal.
    const runCreateProject = async (classifierResult) => {
        if (isSubmitting) return;
        setIsSubmitting(true);
        try {
            const functions = getFunctions(app, 'asia-southeast1');
            const createProjectFn = httpsCallable(functions, 'createProject');

            const result = await createProjectFn({
                projectName: formData.projectName,
                projectDescription: formData.projectDescription,
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
                projectType: classifierResult?.projectType || undefined,
                classificationConfidence: typeof classifierResult?.confidence === 'number'
                    ? classifierResult.confidence
                    : undefined,
                // Forward every field decideClassification returns. Omitting
                // `admitted` (and the other v1-contract fields below) causes the
                // server's stampedClassification builder at functions/src/index.js
                // to fall through `typeof clientClassification.admitted === "boolean"`
                // and re-derive admission from the legacy 0.8 confidence floor via
                // classificationGatePasses — inverting the v1 contract that made
                // confidence a recognition-only signal. See
                // functions/__tests__/validateProjectClassification.test.js:642-660.
                classification: classifierResult ? {
                    projectType: classifierResult.projectType,
                    confidence: classifierResult.confidence,
                    durationFlag: classifierResult.durationFlag,
                    typicalDurationDays: classifierResult.typicalDurationDays,
                    reason: classifierResult.reason,
                    classifierVersion: classifierResult.classifierVersion,
                    classifierPromptVersion: classifierResult.classifierPromptVersion,
                    classifiedAtISO: classifierResult.classifiedAtISO,
                    verdict: classifierResult.verdict,
                    admitted: classifierResult.admitted,
                    isComposite: classifierResult.isComposite,
                    components: classifierResult.components,
                    componentsSynthesized: classifierResult.componentsSynthesized,
                    contractVersion: classifierResult.contractVersion,
                } : undefined,
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
                    let cleanupNote = '';
                    try {
                        const rollbackFn = httpsCallable(functions, 'rollbackOrphanProject');
                        await rollbackFn({ projectId });
                        cleanupNote = ' The project draft has been removed — please correct the file and try again.';
                    } catch (rollbackErr) {
                        console.error('[CreateProject] rollbackOrphanProject failed:', rollbackErr);
                        cleanupNote = ' The project draft could not be removed automatically; please contact your administrator.';
                    }
                    setNtpFileError(`Could not attach NTP: ${uploadErr.message || 'Unknown error'}.${cleanupNote}`);
                    setIsReviewOpen(false);
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

    // Entry point from the Review modal "Confirm & Submit" button. Runs the
    // classifier first; on accept-within-range, proceeds straight to create;
    // on accept-out-of-band, opens the duration-confirm modal; on reject,
    // surfaces the reason on the projectName field and closes review.
    const handleConfirmSubmission = async () => {
        if (isSubmitting || isValidating) return;
        setIsValidating(true);
        setErrors(prev => ({ ...prev, global: undefined, projectName: undefined, projectDescription: undefined }));
        try {
            const functions = getFunctions(app, 'asia-southeast1');
            const classifyFn = httpsCallable(functions, 'validateProjectClassification');
            const { data: result } = await classifyFn({
                projectName: formData.projectName,
                projectDescription: formData.projectDescription,
                barangay: formData.barangay,
                sitioStreet: formData.sitioStreet,
                contractor: formData.contractor,
                contractAmount: Number(formData.contractAmount),
                startDate: formData.officialDateStarted,
                endDate: formData.originalDateCompletion,
            });

            // State (a): scope rejection. Prefer the explicit v1 `admitted`
            // field; fall back to `accepted` for pre-v1 classifier responses.
            const isRejection = result?.admitted === false
                || (result?.admitted === undefined && !result?.accepted);
            if (isRejection) {
                const reason = result?.reason || 'This project was not recognized as a barangay-level infrastructure project.';
                const targetField = result?.field === 'projectDescription' ? 'projectDescription' : 'projectName';
                const targetInputId = targetField === 'projectDescription' ? 'projectDescription-input' : 'projectName-input';
                setErrors(prev => ({
                    ...prev,
                    [targetField]: reason,
                    global: undefined,
                }));
                setIsValidating(false);
                setIsReviewOpen(false);
                requestAnimationFrame(() => {
                    const el = document.getElementById(targetInputId);
                    if (!el) return;
                    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    el.classList.add('hash-target-pulse');
                    setTimeout(() => el.classList.remove('hash-target-pulse'), 2400);
                });
                return;
            }

            setClassification(result);

            // States (b), (c), (d): admitted, but one or both advisories apply.
            //   (b) novel: admitted && confidence < 0.8
            //   (c) duration: durationFlag != "within_range"
            //   (d) both simultaneously
            // Each condition is computed independently; the modal renders
            // whichever paragraphs apply.
            const durationAdvisory = result.durationFlag && result.durationFlag !== 'within_range';
            const admittedFlag = typeof result.admitted === 'boolean' ? result.admitted : true;
            const novelAdvisory = admittedFlag
                && typeof result.confidence === 'number'
                && result.confidence < 0.8;

            if (durationAdvisory || novelAdvisory) {
                setAdvisoryConfirmOpen(true);
                setIsValidating(false);
                return;
            }

            // State (e): admitted, high confidence, in-band duration. Submit
            // directly with no HCSD acknowledgment step.
            setIsValidating(false);
            await runCreateProject(result);
        } catch (err) {
            const msg = err?.message || 'Classification failed. Please try again.';
            const isDateShaped = /\b(duration|days|start[ _-]?date|end[ _-]?date|completion)\b/i.test(msg);
            if (isDateShaped) {
                setErrors(prev => ({ ...prev, originalDateCompletion: msg, global: undefined }));
                setIsReviewOpen(false);
            } else {
                setErrors(prev => ({ ...prev, global: msg }));
            }
            setIsValidating(false);
        }
    };

    // Advisory modal "Yes, submit" handler. The modal is shown for the novel
    // path (state b), the out-of-band-duration path (state c), or both
    // simultaneously (state d).
    const handleProceedWithAdvisory = async () => {
        setAdvisoryConfirmOpen(false);
        if (classification) {
            await runCreateProject(classification);
        }
    };

    const handleCancelAdvisory = () => {
        setAdvisoryConfirmOpen(false);
        setClassification(null);
    };

    return {
        formData, errors, isSubmitting, isValidating,
        engineers, loadingEngineers,
        ntpFile, ntpFileError, handleNtpFileChange, handleClearNtpFile,
        handleChange, handleContractAmountChange, handleIncurredAmountChange,
        handleOfficialDateStartedChange, navigate,
        isReviewOpen, setIsReviewOpen, handleReviewRequest, handleConfirmSubmission,
        classification, advisoryConfirmOpen,
        handleProceedWithAdvisory, handleCancelAdvisory,
        isFormComplete, minCompletionDate,
        contractDurationDays, timeElapsedPercent, slippagePercent, numberOfDaysDelay,
        completionClearedNotice,
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
        formData, errors, isSubmitting, isValidating,
        engineers, loadingEngineers,
        ntpFile, ntpFileError, handleNtpFileChange, handleClearNtpFile,
        handleChange, handleContractAmountChange, handleIncurredAmountChange,
        handleOfficialDateStartedChange, navigate,
        isReviewOpen, setIsReviewOpen, handleReviewRequest, handleConfirmSubmission,
        classification, advisoryConfirmOpen,
        handleProceedWithAdvisory, handleCancelAdvisory,
        isFormComplete, minCompletionDate,
        contractDurationDays, timeElapsedPercent, slippagePercent, numberOfDaysDelay,
        completionClearedNotice,
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
                                    id="projectName-input"
                                    type="text"
                                    value={formData.projectName}
                                    onChange={(e) => handleChange('projectName', e.target.value)}
                                    placeholder="e.g. Construction of Multi-Purpose Building Phase 1"
                                    maxLength={200}
                                    className={`${inputCls(errors.projectName)} scroll-mt-24`}
                                />
                                <FieldError msg={errors.projectName} />
                            </div>

                            <div className="space-y-2">
                                <div className="flex items-center justify-between gap-2">
                                    <label className={labelCls}>Project Description <span className="text-slate-400 normal-case font-semibold tracking-normal">(optional)</span></label>
                                    <span className={`text-[11px] font-semibold ${
                                        formData.projectDescription.length > 950
                                            ? 'text-amber-600'
                                            : 'text-slate-500'
                                    }`}>
                                        {formData.projectDescription.length} / 1000
                                    </span>
                                </div>
                                <textarea
                                    id="projectDescription-input"
                                    value={formData.projectDescription}
                                    onChange={(e) => handleChange('projectDescription', e.target.value)}
                                    placeholder="Optional. If you add a description, focus on engineering specifics the structured fields cannot capture: materials, dimensions, quantities, scope of work, methodology, tie-ins. (Barangay, sitio, contractor, and contract amount are captured separately.)"
                                    rows={5}
                                    maxLength={1000}
                                    className={`${inputCls(errors.projectDescription)} scroll-mt-24 resize-y leading-relaxed`}
                                />
                                <FieldError msg={errors.projectDescription} />
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
                                    <label className={labelCls}>Sitio / Street <span className="text-red-400">*</span></label>
                                    <input
                                        type="text"
                                        value={formData.sitioStreet}
                                        onChange={(e) => handleChange('sitioStreet', e.target.value)}
                                        placeholder="e.g. Sitio Bagong Pag-asa, P. Burgos St."
                                        maxLength={200}
                                        className={inputCls(errors.sitioStreet)}
                                    />
                                    <FieldError msg={errors.sitioStreet} />
                                </div>
                            </div>

                        </SectionCard>

                        <SectionCard icon={FileText} iconColor="text-violet-600" title="Account Code & Funding">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 sm:gap-8">
                                <div className="space-y-2">
                                    <label className={labelCls}>Account Code <span className="text-red-400">*</span></label>
                                    <input
                                        type="text"
                                        value={formData.accountCode}
                                        onChange={(e) => handleChange('accountCode', e.target.value)}
                                        placeholder="e.g. 5-02-99-990"
                                        maxLength={100}
                                        className={inputCls(errors.accountCode)}
                                    />
                                    <FieldError msg={errors.accountCode} />
                                </div>

                                <div className="space-y-2">
                                    <label className={labelCls}>Funding Source</label>
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
                                <label className={labelCls}>Contractor <span className="text-red-400">*</span></label>
                                <div className="relative">
                                    <Building2 className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                                    <input
                                        type="text"
                                        value={formData.contractor}
                                        onChange={(e) => handleChange('contractor', e.target.value)}
                                        placeholder="Company / Contractor Name"
                                        maxLength={200}
                                        className={`w-full pl-12 pr-4 py-4 bg-slate-50 border ${errors.contractor ? 'border-red-300 focus:ring-red-100' : 'border-slate-200 focus:ring-green-100'} rounded-xl font-semibold text-slate-700 outline-none focus:border-green-500 focus:ring-4 transition-all`}
                                    />
                                </div>
                                <FieldError msg={errors.contractor} />
                            </div>

                            <div className="space-y-3">
                                <label className={labelCls}>Assigned Personnel</label>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <div className="space-y-1">
                                        <span className="text-xs font-semibold text-slate-500">a. Project Engineer <span className="text-red-400">*</span></span>
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
                                                    className={`w-full pl-12 pr-4 py-4 bg-slate-50 border ${errors.projectEngineer ? 'border-red-300 focus:ring-red-100' : 'border-slate-200 focus:ring-green-100'} rounded-xl font-semibold text-slate-700 outline-none focus:border-green-500 focus:ring-4 transition-all appearance-none cursor-pointer`}
                                                >
                                                    <option value="">Select Engineer...</option>
                                                    {engineers.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
                                                </select>
                                            </div>
                                        )}
                                        <FieldError msg={errors.projectEngineer} />
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
                                    <label className={labelCls}>NTP Document <span className="text-red-400">*</span> <span className="text-slate-400 normal-case font-semibold tracking-normal">(PDF, JPEG, PNG · max 10 MB)</span></label>
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
                                <p className="text-xs font-bold text-slate-400 uppercase tracking-wide mb-2">Date of Completion</p>
                                {contractDurationDays !== null && (
                                    <div className="mb-4 inline-flex items-center gap-1.5 text-xs font-semibold text-blue-700">
                                        <Clock size={12} />
                                        Project window: {contractDurationDays} calendar day{contractDurationDays !== 1 ? 's' : ''}
                                    </div>
                                )}
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <div className="space-y-1">
                                        <span className="text-xs font-semibold text-slate-500">a. Original Date Completion <span className="text-red-400">*</span></span>
                                        <input type="date" value={formData.originalDateCompletion}
                                            onChange={(e) => handleChange('originalDateCompletion', e.target.value)}
                                            disabled={!formData.officialDateStarted}
                                            min={minCompletionDate}
                                            className={`w-full p-3 border ${errors.originalDateCompletion ? 'border-red-300' : 'border-slate-200'} rounded-xl font-medium outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 transition-all ${!formData.officialDateStarted ? 'bg-slate-100 text-slate-400 cursor-not-allowed' : 'bg-white text-slate-700'}`}
                                        />
                                        {completionClearedNotice && (
                                            <div className="flex items-start gap-1.5 p-2 bg-amber-50 border border-amber-200 rounded-lg">
                                                <AlertCircle size={12} className="text-amber-600 mt-0.5 shrink-0" />
                                                <p className="text-[11px] font-medium text-amber-800 leading-snug">
                                                    {completionClearedNotice}
                                                </p>
                                            </div>
                                        )}
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
                                    {formData.projectDescription && (
                                        <div className="flex gap-2">
                                            <span className="font-bold text-slate-500 w-36 shrink-0">Description</span>
                                            <span className="text-slate-800 font-medium leading-relaxed whitespace-pre-wrap">{formData.projectDescription}</span>
                                        </div>
                                    )}
                                    <div className="flex gap-2"><span className="font-bold text-slate-500 w-36 shrink-0">Barangay</span><span className="text-slate-800 font-semibold">{formData.barangay}</span></div>
                                    {formData.sitioStreet && <div className="flex gap-2"><span className="font-bold text-slate-500 w-36 shrink-0">Sitio / Street</span><span className="text-slate-800 font-semibold">{formData.sitioStreet}</span></div>}
                                    {contractDurationDays !== null && <div className="flex gap-2"><span className="font-bold text-slate-500 w-36 shrink-0">Contract Duration</span><span className="text-slate-800 font-semibold">{contractDurationDays} calendar day{contractDurationDays !== 1 ? 's' : ''}</span></div>}
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
                            <button type="button" onClick={() => setIsReviewOpen(false)} disabled={isSubmitting || isValidating} className="flex-1 py-3 bg-slate-100 text-slate-600 font-bold rounded-xl hover:bg-slate-200 transition-colors disabled:opacity-50">
                                Edit
                            </button>
                            <button
                                type="button"
                                onClick={handleConfirmSubmission}
                                disabled={isSubmitting || isValidating}
                                className="flex-1 py-3 bg-gradient-to-r from-teal-600 to-emerald-500 hover:from-teal-700 hover:to-emerald-600 text-white font-extrabold rounded-xl shadow-lg shadow-teal-500/25 transition-all flex items-center justify-center gap-2 disabled:opacity-70"
                            >
                                {isValidating
                                    ? <><LoaderSpinner /> Verifying project classification...</>
                                    : isSubmitting
                                        ? <><LoaderSpinner /> Submitting...</>
                                        : <><CheckCircle size={18} /> Confirm & Submit</>}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {advisoryConfirmOpen && classification && (
                <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[60] p-4">
                    <div className="bg-white rounded-[24px] max-w-lg w-full shadow-2xl">
                        <div className="p-6 border-b border-slate-100 flex items-center gap-3">
                            {(classification.durationFlag && classification.durationFlag !== 'within_range' && classification.projectType && classification.projectType !== 'unknown')
                                ? <Clock className="text-amber-500" size={24} />
                                : <Info className="text-amber-500" size={24} />}
                            <h2 className="text-xl font-extrabold text-slate-900">Review before submitting</h2>
                        </div>
                        <div className="p-6 space-y-4 text-sm">
                            {/* Novel-project paragraph (state b): admitted with confidence below 0.8.
                                Copy does NOT mention corpus / reference-set membership. Nothing at
                                project creation reads the corpus — retrieval scoring happens at
                                milestone generation and lives in the mobile repo (see
                                functions/__tests__/validateProjectClassification.test.js:645
                                "the mobile side derives retrieval quality from its own corpus
                                scoring"). The pre-2026-08-09 copy asserted a corpus check that
                                never occurred at this step. */}
                            {typeof classification.confidence === 'number' && classification.confidence < 0.8 && (
                                <p className="text-slate-700 font-semibold leading-relaxed">
                                    The classifier could not assign a project type with high confidence — often because the name is general (missing scope details like length, the specific facility, or which structure is enclosed). The milestone plan will still be generated, and the assigned Project Engineer will review it before fieldwork begins. Treat the plan as a working draft that warrants closer engineering review than usual.
                                </p>
                            )}
                            {/* Duration paragraph (state c): out-of-band duration.
                                Defensive guard: omit when projectType is "unknown"
                                (unreachable for admitted projects under the v1
                                classifier contract, retained for safety). */}
                            {classification.durationFlag && classification.durationFlag !== 'within_range'
                                && classification.projectType && classification.projectType !== 'unknown' && (
                                <p className="text-slate-700 font-semibold leading-relaxed">
                                    {formatProjectTypeLabel(classification.projectType)} projects typically take{' '}
                                    <span className="text-amber-700 font-extrabold">
                                        {classification.typicalDurationDays?.min} to {classification.typicalDurationDays?.max} days
                                    </span>.
                                    You entered <span className="text-amber-700 font-extrabold">{contractDurationDays} calendar day{contractDurationDays !== 1 ? 's' : ''}</span>.
                                    Are you sure this duration is correct?
                                </p>
                            )}
                            {classification.reason && (
                                <p className="text-slate-400 font-medium italic leading-relaxed text-xs">
                                    Reason from classifier: {classification.reason}
                                </p>
                            )}
                        </div>
                        <div className="p-6 border-t border-slate-100 flex gap-3">
                            <button
                                type="button"
                                onClick={handleCancelAdvisory}
                                disabled={isSubmitting}
                                className="flex-1 py-3 bg-slate-100 text-slate-600 font-bold rounded-xl hover:bg-slate-200 transition-colors disabled:opacity-50"
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                onClick={handleProceedWithAdvisory}
                                disabled={isSubmitting}
                                className="flex-1 py-3 bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-white font-extrabold rounded-xl shadow-lg shadow-amber-500/25 transition-all flex items-center justify-center gap-2 disabled:opacity-70"
                            >
                                {isSubmitting ? <><LoaderSpinner /> Submitting...</> : <><CheckCircle size={18} /> Yes, submit</>}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default CreateProject;
