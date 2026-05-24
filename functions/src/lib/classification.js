// Pure helpers for project-name classification + milestone coherence checks.
// Kept dependency-free (no firebase-admin, no Anthropic SDK) so unit tests
// can import this module directly without mocking.

const PROJECT_TYPE_ENUM = [
    "road_concreting",
    "drainage_construction",
    "multi_purpose_building",
    "covered_court",
    "day_care_center",
    "footbridge",
    "slope_protection",
    "waterworks",
    "electrification",
    "unknown",
];

const TYPICAL_DURATION_DAYS = {
    road_concreting:        { min: 60,  max: 180 },
    drainage_construction:  { min: 45,  max: 120 },
    multi_purpose_building: { min: 90,  max: 365 },
    covered_court:          { min: 60,  max: 180 },
    day_care_center:        { min: 75,  max: 240 },
    footbridge:             { min: 45,  max: 120 },
    slope_protection:       { min: 45,  max: 150 },
    waterworks:             { min: 45,  max: 180 },
    electrification:        { min: 30,  max: 120 },
};

const VOCAB_TERMS = [
    "Mobilization", "Demobilization", "Site Clearing", "Site Preparation",
    "Excavation", "Subgrade", "Compaction", "Backfilling", "Formworks",
    "Rebar", "Reinforcement", "Concrete", "Concreting", "Pouring", "Curing",
    "Masonry", "Plastering", "Roofing", "Flooring", "Tiling", "Plumbing",
    "Electrical", "Painting", "Finishing", "Inspection", "Turnover", "Riprap",
    "Slope", "Drainage", "Canal", "Culvert", "Pipe Laying", "Foundation",
    "Footing", "Column", "Beam", "Slab", "Wall", "Door", "Window", "Hardware",
    "Fixture", "Landscaping", "Punch List", "Final Inspection",
];

const escapeRegex = (s) => s.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");
const VOCAB_REGEX = new RegExp(
    `\\b(?:${VOCAB_TERMS.map(escapeRegex).join("|")})\\b`,
    "i"
);

const computeDurationFlag = (projectType, durationDays, band) => {
    if (projectType === "unknown" || !band) return "unknown_type";
    if (durationDays < band.min) return "below_typical";
    if (durationDays > band.max) return "above_typical";
    return "within_range";
};

// ─── Pre-LLM project-name prescreen ────────────────────────────────────────
// Deterministic, sub-millisecond gate that runs BEFORE the Anthropic call.
// Catches obvious abuse (prompt-injection literals, mixed-script, control
// chars, base64 blobs) so we don't burn LLM tokens on garbage and so the
// classifier never receives an adversarial prompt fragment inside its user
// message. PromptArmor-style preprocessor — see OWASP LLM01 mitigations.

const ZERO_WIDTH_RE = /[\u200B-\u200D\uFEFF\u00AD]/g;
const NON_PRINTABLE_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;
// Non-Latin scripts we don't expect in Cebu City project names. Filipino
// (Tagalog/Cebuano) uses Latin + Latin-1 Supplement diacritics — those are
// not blocked here.
const FOREIGN_SCRIPT_RE = /[\u0400-\u04FF\u0500-\u052F\u0370-\u03FF\u0590-\u05FF\u0600-\u06FF\u3040-\u30FF\u4E00-\u9FFF]/;
const PROMPT_INJECTION_RE = /(ignore\s+(?:all\s+)?(?:previous|prior|above)\s+(?:instructions?|rules?|prompts?)|disregard\s+(?:all\s+)?(?:previous|prior|above)|forget\s+(?:everything|your\s+instructions|the\s+system\s+prompt)|system\s*:\s|assistant\s*:\s|<\|im_start\|>|<\|im_end\|>|<\/?tool[_\s]?(?:use|result)?>|\bnew\s+instructions?\b|\boverride\b[^.]{0,40}\binstructions?\b)/i;
const BASE64_BLOB_RE = /[A-Za-z0-9+/]{30,}={0,2}/;
const REPEATED_CHAR_RE = /(.)\1{5,}/;

const PRESCREEN_REASONS = {
    nonPrintable: "Project name contains non-printable or control characters.",
    mixedScript: "Project name uses characters from a non-Latin script. Use Latin/Filipino letters only.",
    promptInjection: "Project name contains text patterns that look like AI prompt instructions. Use a plain descriptive name.",
    base64Blob: "Project name contains an encoded data blob. Use a plain descriptive name.",
    repeatedChar: "Project name contains too many repeated characters.",
    tooManyNonLetters: "Project name has too few letters to be a real project name.",
};

const prescreenProjectName = (rawName) => {
    if (typeof rawName !== "string") {
        return { cleaned: "", rejection: { kind: "invalid", reason: "Project name must be a string." } };
    }
    const cleaned = rawName.replace(ZERO_WIDTH_RE, "").trim();
    if (NON_PRINTABLE_RE.test(cleaned)) {
        return { cleaned, rejection: { kind: "nonPrintable", reason: PRESCREEN_REASONS.nonPrintable } };
    }
    if (FOREIGN_SCRIPT_RE.test(cleaned)) {
        return { cleaned, rejection: { kind: "mixedScript", reason: PRESCREEN_REASONS.mixedScript } };
    }
    if (PROMPT_INJECTION_RE.test(cleaned)) {
        return { cleaned, rejection: { kind: "promptInjection", reason: PRESCREEN_REASONS.promptInjection } };
    }
    if (BASE64_BLOB_RE.test(cleaned)) {
        return { cleaned, rejection: { kind: "base64Blob", reason: PRESCREEN_REASONS.base64Blob } };
    }
    if (REPEATED_CHAR_RE.test(cleaned)) {
        return { cleaned, rejection: { kind: "repeatedChar", reason: PRESCREEN_REASONS.repeatedChar } };
    }
    const letterCount = (cleaned.match(/[A-Za-z\u00C0-\u017F]/g) || []).length;
    const meaningfulCount = (cleaned.match(/[^\s.,\-/()&']/g) || []).length;
    if (meaningfulCount >= 8 && letterCount / meaningfulCount < 0.6) {
        return { cleaned, rejection: { kind: "tooManyNonLetters", reason: PRESCREEN_REASONS.tooManyNonLetters } };
    }
    return { cleaned };
};

// ─── Post-LLM safety/quality gates (consumes new tool fields) ──────────────
// Returns a human-readable rejection string, or null when the classifier's
// safety/quality fields are clean. Checked BEFORE the existing
// isInfrastructure/confidence gate so a clearly unsafe name is rejected for
// the right reason instead of the catch-all "not infrastructure".

const checkSafetyRejection = ({
    inputSafety, nameQuality, scopeFit, jurisdictionFit,
    bundlesMultipleProjects, physicalPlausibility, confidence,
}) => {
    if (inputSafety?.containsPromptInjectionPattern) return PRESCREEN_REASONS.promptInjection;
    if (inputSafety?.containsProfanity) return "Project name contains offensive language.";
    if (inputSafety?.containsPii) return "Project name contains personal information (phone, email, ID, or private address). Public works names should reference public infrastructure only.";
    if (inputSafety?.containsMixedScript) return PRESCREEN_REASONS.mixedScript;
    if (inputSafety?.containsNonPrintable) return PRESCREEN_REASONS.nonPrintable;
    if (nameQuality?.isGibberish) return "Project name appears to be gibberish or random text.";
    if (nameQuality?.isPlaceholder) return "Project name appears to be a placeholder (e.g. 'Test Project', 'Project 1'). Use the real project name.";
    if (nameQuality?.specificity === "generic" && (confidence ?? 0) < 0.8) {
        return "Project name is too generic. Add the specific scope or location (e.g. street name, sitio, dimensions).";
    }
    if (scopeFit && scopeFit !== "barangay" && scopeFit !== "unclear") {
        return `Project appears to be ${scopeFit}-scale, outside the Construction Services Division's barangay-level remit.`;
    }
    if (jurisdictionFit === "out_of_lgu") return "Project location is outside this LGU's jurisdiction.";
    if (bundlesMultipleProjects) return "Project name describes multiple works. Please submit each project separately.";
    if (physicalPlausibility === "implausible") return "Project scale appears unrealistic for a barangay-level work.";
    return null;
};

const decideClassification = (classifierOutput, durationDays) => {
    const {
        isInfrastructure,
        projectType,
        confidence,
        typicalDurationDays: modelBand,
        reason,
        inputSafety,
        nameQuality,
        scopeFit,
        jurisdictionFit,
        bundlesMultipleProjects,
        physicalPlausibility,
    } = classifierOutput || {};
    const canonicalBand = TYPICAL_DURATION_DAYS[projectType] || null;
    const band = canonicalBand || modelBand || null;
    const durationFlag = computeDurationFlag(projectType, durationDays, band);

    const safetyRejection = checkSafetyRejection({
        inputSafety, nameQuality, scopeFit, jurisdictionFit,
        bundlesMultipleProjects, physicalPlausibility, confidence,
    });
    if (safetyRejection) {
        return {
            accepted: false,
            reason: safetyRejection,
            projectType: "unknown",
            confidence: confidence ?? 0,
        };
    }

    if (!isInfrastructure || (projectType === "unknown" && (confidence ?? 0) < 0.6)) {
        return { accepted: false, reason, projectType, confidence };
    }
    return {
        accepted: true,
        projectType,
        confidence,
        durationFlag,
        typicalDurationDays: band,
        reason,
        // Persisted on the project doc; mobile-side generateMilestones reads
        // this to refuse running on unverified or unsafe names.
        verdict: {
            inputSafety: inputSafety || null,
            nameQuality: nameQuality || null,
            scopeFit: scopeFit || null,
            jurisdictionFit: jurisdictionFit || null,
            bundlesMultipleProjects: !!bundlesMultipleProjects,
            physicalPlausibility: physicalPlausibility || null,
        },
    };
};

const checkVocabulary = (milestones) =>
    Array.isArray(milestones) && milestones.length > 0 &&
    milestones.every((m) => VOCAB_REGEX.test(m.title || ""));

const checkDurationSum = (milestones, targetDays) => {
    if (!Array.isArray(milestones) || milestones.length === 0) return false;
    if (targetDays == null) return true;
    const sum = milestones.reduce((s, m) => s + (m.suggested_duration_days || 0), 0);
    return Math.abs(sum - targetDays) <= 2;
};

const classificationGatePasses = (project) => {
    const projectType = project?.projectType || "unknown";
    const confidence = typeof project?.classificationConfidence === "number"
        ? project.classificationConfidence : 0;
    return projectType !== "unknown" && confidence >= 0.6;
};

// Validates dates and returns durationDays. Throws Error with `code:"invalid-argument"`
// when start/end is unparseable or duration falls outside [minDays, maxDays].
const parseAndValidateDuration = (startDate, endDate, opts = {}) => {
    const minDays = opts.minDays ?? 14;
    const maxDays = opts.maxDays ?? 730;
    const startMs = new Date(startDate).getTime();
    const endMs = new Date(endDate).getTime();
    if (Number.isNaN(startMs) || Number.isNaN(endMs)) {
        const err = new Error("Invalid start or end date.");
        err.code = "invalid-argument";
        throw err;
    }
    const durationDays = Math.round((endMs - startMs) / 86_400_000);
    if (durationDays < minDays || durationDays > maxDays) {
        const err = new Error(`Project duration must be between ${minDays} and ${maxDays} days.`);
        err.code = "invalid-argument";
        throw err;
    }
    return durationDays;
};

module.exports = {
    PROJECT_TYPE_ENUM,
    TYPICAL_DURATION_DAYS,
    VOCAB_TERMS,
    VOCAB_REGEX,
    computeDurationFlag,
    decideClassification,
    checkSafetyRejection,
    checkVocabulary,
    checkDurationSum,
    classificationGatePasses,
    parseAndValidateDuration,
    prescreenProjectName,
    PRESCREEN_REASONS,
};
