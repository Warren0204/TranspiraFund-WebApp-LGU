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

const decideClassification = (classifierOutput, durationDays) => {
    const {
        isInfrastructure,
        projectType,
        confidence,
        typicalDurationDays: modelBand,
        reason,
    } = classifierOutput || {};
    const canonicalBand = TYPICAL_DURATION_DAYS[projectType] || null;
    const band = canonicalBand || modelBand || null;
    const durationFlag = computeDurationFlag(projectType, durationDays, band);
    if (!isInfrastructure || (projectType === "unknown" && confidence < 0.6)) {
        return { accepted: false, reason, projectType, confidence };
    }
    return {
        accepted: true,
        projectType,
        confidence,
        durationFlag,
        typicalDurationDays: band,
        reason,
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
    checkVocabulary,
    checkDurationSum,
    classificationGatePasses,
    parseAndValidateDuration,
};
