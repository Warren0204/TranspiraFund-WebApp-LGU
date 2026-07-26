// Pure helpers for project-name classification + milestone coherence checks.
// Kept dependency-free (no firebase-admin, no Anthropic SDK) so unit tests
// can import this module directly without mocking.

// NOTE: `footbridge` is a legacy misnomer retained for backward compatibility
// with the mobile app allowlist and Firestore project documents already in
// production. The classifier is instructed to map ANY bridge (pedestrian,
// vehicular, reinforced concrete) to this enum value. Renaming the enum
// would break cross-repo compatibility and orphan existing project docs.
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

// Advisory duration bands per project type. Consumed only by
// computeDurationFlag → durationFlag → the creation-UI Duration Confirm modal.
// Not a hard gate — no submission is rejected for falling outside a band.
//
// Provenance: for each type the band is the union of a hand-authored
// engineering estimate with the observed range from a 20-project SME-validated
// Cebu City DEPW Construction Services Division dataset — the wider of the
// two, so no SME-validated real project flags against its own band.
//
// SME sample counts (n), observed totals in calendar days, and the band
// change relative to the prior authored-only value:
//   road_concreting        n=4   observed: 60, 106, 120, 150                — SME fits within authored (60–180 unchanged)
//   drainage_construction  n=1   observed: 270                              — SME extended max: 120 → 270
//   multi_purpose_building n=7   observed: 165, 240, 240, 270, 300, 400, 480 — SME extended max: 365 → 480
//   covered_court          n=0   — AUTHORED ONLY, no SME coverage (60–180 unchanged)
//   day_care_center        n=0   — AUTHORED ONLY, no SME coverage (75–240 unchanged)
//   footbridge             n=2   observed: 120, 180                         — SME extended max: 120 → 180
//   slope_protection       n=2   observed: 60, 210                          — SME extended max: 150 → 210
//   waterworks             n=2   observed: 30, 90                           — SME extended min: 45 → 30
//   electrification        n=2   observed: 60, 90                           — SME fits within authored (30–120 unchanged)
//
// The prompt block in ./classifier-prompt.js reads these values via require
// and interpolates them into the LLM system prompt, so the model sees the
// same numbers this file exports. Do not hand-edit the prompt block; edit
// this constant only.
const TYPICAL_DURATION_DAYS = {
    road_concreting:        { min: 60,  max: 180 },
    drainage_construction:  { min: 45,  max: 270 },
    multi_purpose_building: { min: 90,  max: 480 },
    covered_court:          { min: 60,  max: 180 },
    day_care_center:        { min: 75,  max: 240 },
    footbridge:             { min: 45,  max: 180 },
    slope_protection:       { min: 45,  max: 210 },
    waterworks:             { min: 30,  max: 180 },
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

const buildPrescreenReasons = (fieldLabel) => ({
    invalid: `${fieldLabel} must be a string.`,
    nonPrintable: `${fieldLabel} contains non-printable or control characters.`,
    mixedScript: `${fieldLabel} uses characters from a non-Latin script. Use Latin/Filipino letters only.`,
    promptInjection: `${fieldLabel} contains text patterns that look like AI prompt instructions. Use plain descriptive wording.`,
    base64Blob: `${fieldLabel} contains an encoded data blob. Use plain descriptive wording.`,
    repeatedChar: `${fieldLabel} contains too many repeated characters.`,
    tooManyNonLetters: `${fieldLabel} has too few letters to be real ${fieldLabel.toLowerCase()} text.`,
});

const PRESCREEN_REASONS = buildPrescreenReasons("Project name");
const PRESCREEN_REASONS_DESCRIPTION = buildPrescreenReasons("Project description");

const prescreenText = (raw, fieldLabel) => {
    const reasons = buildPrescreenReasons(fieldLabel);
    if (typeof raw !== "string") {
        return { cleaned: "", rejection: { kind: "invalid", reason: reasons.invalid } };
    }
    const cleaned = raw.replace(ZERO_WIDTH_RE, "").trim();
    if (NON_PRINTABLE_RE.test(cleaned)) {
        return { cleaned, rejection: { kind: "nonPrintable", reason: reasons.nonPrintable } };
    }
    if (FOREIGN_SCRIPT_RE.test(cleaned)) {
        return { cleaned, rejection: { kind: "mixedScript", reason: reasons.mixedScript } };
    }
    if (PROMPT_INJECTION_RE.test(cleaned)) {
        return { cleaned, rejection: { kind: "promptInjection", reason: reasons.promptInjection } };
    }
    if (BASE64_BLOB_RE.test(cleaned)) {
        return { cleaned, rejection: { kind: "base64Blob", reason: reasons.base64Blob } };
    }
    if (REPEATED_CHAR_RE.test(cleaned)) {
        return { cleaned, rejection: { kind: "repeatedChar", reason: reasons.repeatedChar } };
    }
    const letterCount = (cleaned.match(/[A-Za-z\u00C0-\u017F]/g) || []).length;
    const meaningfulCount = (cleaned.match(/[^\s.,\-/()&']/g) || []).length;
    if (meaningfulCount >= 8 && letterCount / meaningfulCount < 0.6) {
        return { cleaned, rejection: { kind: "tooManyNonLetters", reason: reasons.tooManyNonLetters } };
    }
    return { cleaned };
};

const prescreenProjectName = (raw) => prescreenText(raw, "Project name");
const prescreenProjectDescription = (raw) => prescreenText(raw, "Project description");

// ─── Post-LLM safety/quality gates (consumes new tool fields) ──────────────
// Returns a human-readable rejection string, or null when the classifier's
// safety/quality fields are clean. Checked BEFORE the existing
// isInfrastructure/confidence gate so a clearly unsafe name is rejected for
// the right reason instead of the catch-all "not infrastructure".

const checkSafetyRejection = ({
    inputSafety, nameQuality, semanticCoherence,
    scopeFit, jurisdictionFit, bundlesMultipleProjects, physicalPlausibility, confidence,
}) => {
    if (inputSafety?.containsPromptInjectionPattern) return PRESCREEN_REASONS.promptInjection;
    if (inputSafety?.containsProfanity) return "Project name or description contains offensive language.";
    if (inputSafety?.containsPii) return "Project name or description contains personal information (phone, email, ID, or private address). Public works submissions should reference public infrastructure only.";
    if (inputSafety?.containsMixedScript) return PRESCREEN_REASONS.mixedScript;
    if (inputSafety?.containsNonPrintable) return PRESCREEN_REASONS.nonPrintable;
    if (nameQuality?.isGibberish) return "Project name appears to be gibberish or random text.";
    if (nameQuality?.isPlaceholder) return "Project name appears to be a placeholder (e.g. 'Test Project', 'Project 1'). Use the real project name.";
    if (semanticCoherence?.allWordsInfraRelated === false) {
        return "Project name or description contains words that do not belong to infrastructure or public works (e.g. fictional, medical, software, or unrelated terms).";
    }
    if (semanticCoherence?.combinationMakesSense === false) {
        return "Project name or description combines real construction words in a way that does not describe a real type of work.";
    }
    if (semanticCoherence?.overallNamePlausible === false) {
        return "Project does not describe a plausible barangay-level public works project.";
    }
    if (nameQuality?.specificity === "generic" && (confidence ?? 0) < 0.8) {
        return "Project name is too generic. Name the specific work type and a scope qualifier (e.g. dimensions, phase, quantity) — barangay and sitio are captured separately.";
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
        semanticCoherence,
        scopeFit,
        jurisdictionFit,
        bundlesMultipleProjects,
        physicalPlausibility,
    } = classifierOutput || {};
    const canonicalBand = TYPICAL_DURATION_DAYS[projectType] || null;
    const band = canonicalBand || modelBand || null;
    const durationFlag = computeDurationFlag(projectType, durationDays, band);

    const safetyRejection = checkSafetyRejection({
        inputSafety, nameQuality, semanticCoherence,
        scopeFit, jurisdictionFit, bundlesMultipleProjects, physicalPlausibility, confidence,
    });
    if (safetyRejection) {
        return {
            accepted: false,
            reason: safetyRejection,
            projectType: "unknown",
            confidence: confidence ?? 0,
        };
    }

    // Global confidence floor: the classifier must be at least 80% sure before
    // we accept anything as a DEPW city-funded barangay-level infrastructure
    // project. Below 0.8 we bounce the submission back so HCSD rewrites the
    // name/description rather than rolling the dice on a borderline classification.
    if (!isInfrastructure || (confidence ?? 0) < 0.8) {
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
            semanticCoherence: semanticCoherence || null,
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
    return projectType !== "unknown" && confidence >= 0.8;
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
    prescreenProjectDescription,
    PRESCREEN_REASONS,
    PRESCREEN_REASONS_DESCRIPTION,
};
