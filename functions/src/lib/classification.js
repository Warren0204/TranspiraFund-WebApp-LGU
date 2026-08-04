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

// ─── Server-side admission gate (post-LLM) ─────────────────────────────────
// Returns a human-readable rejection string, or null when the classifier's
// safety/quality/coherence/scope/jurisdiction/plausibility fields are all
// clean. Runs BEFORE the isInfrastructure check so a clearly unsafe name is
// rejected for the right reason instead of the catch-all "not infrastructure".
//
// Under the v1 classifier contract this gate NEVER reads confidence and NEVER
// treats bundlesMultipleProjects as a rejection signal. Composite projects
// are legitimate (see SME corpus idx 1, 9, 14) and carried through via
// components[] + isComposite. bundlesMultipleProjects stays on verdict for
// observability continuity with pre-composite audit rows.

const checkSafetyRejection = ({
    inputSafety, nameQuality, semanticCoherence,
    scopeFit, jurisdictionFit, physicalPlausibility,
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
    if (scopeFit && scopeFit !== "barangay" && scopeFit !== "unclear") {
        return `Project appears to be ${scopeFit}-scale, outside the Construction Services Division's barangay-level remit.`;
    }
    if (jurisdictionFit === "out_of_lgu") return "Project location is outside this LGU's jurisdiction.";
    if (physicalPlausibility === "implausible") return "Project scale appears unrealistic for a barangay-level work.";
    return null;
};

// Maps the 22-term component vocabulary onto the 9 non-"unknown"
// PROJECT_TYPE_ENUM values. Used ONLY by coerceAdmittedType when the model
// admitted a project but returned projectType "unknown" — the v1 contract's
// "never emit unknown for an admitted project" invariant.
//
// Intentional edges:
//   - covered_walk        -> multi_purpose_building
//        (a covered walkway is a circulation structure, not a court)
//   - perimeter_fence     -> multi_purpose_building
//        (fencing is a building-adjacent enclosure, not a category of its own)
//   - bridge, footbridge  -> footbridge
//        (PROJECT_TYPE_ENUM has no vehicular-bridge value; footbridge is the
//        only bridge type in the enum. Once the contract is live and
//        components[] flows to the mobile scorer, retrieval keys on
//        components rather than projectType, so this reduction is acceptable.)

const COMPONENT_TO_TYPE_MAP = {
    road_concreting:        "road_concreting",
    pavement:               "road_concreting",
    pathway:                "road_concreting",
    drainage:               "drainage_construction",
    culvert:                "drainage_construction",
    waterworks:             "waterworks",
    water_tank:             "waterworks",
    pipe_laying:            "waterworks",
    building_construction:  "multi_purpose_building",
    building_renovation:    "multi_purpose_building",
    vertical_extension:     "multi_purpose_building",
    evacuation_center:      "multi_purpose_building",
    day_care:               "day_care_center",
    covered_court:          "covered_court",
    covered_walk:           "multi_purpose_building",
    perimeter_fence:        "multi_purpose_building",
    bridge:                 "footbridge",
    footbridge:             "footbridge",
    slope_protection:       "slope_protection",
    riprap:                 "slope_protection",
    electrical_works:       "electrification",
    streetlighting:         "electrification",
};

// The 22-term controlled component vocabulary, derived from the keys of
// COMPONENT_TO_TYPE_MAP so the two never drift apart. Consumed by:
//   - index.js createProjectSchema (Zod z.enum for the persisted map)
//   - classifier-prompt.js tool schema (imported, single source of truth)
//   - TYPE_TO_DEFAULT_COMPONENT below (reverse map used by the empty-array
//     synthesis safeguard in decideClassification)
// Add or remove terms here only — both downstream consumers pick up the
// change automatically.
const COMPONENT_VOCABULARY = Object.keys(COMPONENT_TO_TYPE_MAP);

// Reverse map from PROJECT_TYPE_ENUM (9 non-"unknown" values) to a single
// default component. Used by the safeguard in decideClassification: when the
// model returns an admitted project with an empty components[] array, we
// synthesize a single component from projectType so downstream consumers
// (mobile retrieval scorer, verifier prompt) always see a non-empty array.
// Every synthesized value is stamped with `componentsSynthesized: true` so
// Phase 4 calibration can exclude these rows.
const TYPE_TO_DEFAULT_COMPONENT = {
    road_concreting:        "road_concreting",
    drainage_construction:  "drainage",
    multi_purpose_building: "building_construction",
    covered_court:          "covered_court",
    day_care_center:        "day_care",
    footbridge:             "footbridge",
    slope_protection:       "slope_protection",
    waterworks:             "waterworks",
    electrification:        "electrical_works",
};

// Picks a non-"unknown" PROJECT_TYPE_ENUM value for an admitted project whose
// classifier returned "unknown". Ordering:
//   1. components[0] via COMPONENT_TO_TYPE_MAP
//   2. duration-band fit: enum value whose TYPICAL_DURATION_DAYS midpoint is
//      closest to the submitted duration
//   3. terminal fallback: "multi_purpose_building" (the most catholic of the
//      9 types per the classifier prompt's own guidance)
// Returns { type, basis }. A spike in "terminal_fallback" basis signals the
// classifier is drifting away from the type-assignment discipline.

const coerceAdmittedType = (classifierOutput, durationDays) => {
    const components = Array.isArray(classifierOutput?.components) ? classifierOutput.components : [];
    if (components.length > 0) {
        const mapped = COMPONENT_TO_TYPE_MAP[components[0]];
        if (mapped) return { type: mapped, basis: "component_derived" };
    }
    if (typeof durationDays === "number" && !Number.isNaN(durationDays)) {
        let bestType = null;
        let bestDistance = Infinity;
        for (const [type, band] of Object.entries(TYPICAL_DURATION_DAYS)) {
            const midpoint = (band.min + band.max) / 2;
            const distance = Math.abs(durationDays - midpoint);
            if (distance < bestDistance) {
                bestDistance = distance;
                bestType = type;
            }
        }
        if (bestType) return { type: bestType, basis: "duration_band_fit" };
    }
    return { type: "multi_purpose_building", basis: "terminal_fallback" };
};

// Splits admission from recognition per the v1 classifier contract:
//   - Admission is server-derived from checkSafetyRejection + isInfrastructure.
//     It NEVER reads confidence. Composite projects are admitted.
//   - Recognition (projectType, confidence, durationFlag, isComposite,
//     components) is surfaced but does not gate admission.
//   - When admitted, projectType is coerced to a non-"unknown" enum value via
//     coerceAdmittedType if the model violated the "never emit unknown for an
//     admitted project" invariant. opts.onCoercion (if provided) is invoked
//     synchronously so the callable can log the coercion with basis.
//   - When admitted with an empty components[] array, a single component is
//     synthesized from projectType via TYPE_TO_DEFAULT_COMPONENT so downstream
//     consumers never see an empty array. `componentsSynthesized: true` marks
//     the record. opts.onSynthesis (if provided) is invoked synchronously so
//     the callable can log the safeguard fire.
//   - `verdict.bundlesMultipleProjects` is a server-DERIVED mirror of
//     `!!isComposite`, retained on the persisted verdict for audit continuity
//     with pre-composite rows. The model no longer supplies this field (see
//     tool-schema NOTE in classifier-prompt.js); never re-add it there.

const decideClassification = (classifierOutput, durationDays, opts = {}) => {
    const {
        isInfrastructure,
        projectType: rawProjectType,
        confidence,
        typicalDurationDays: modelBand,
        reason,
        inputSafety,
        nameQuality,
        semanticCoherence,
        scopeFit,
        jurisdictionFit,
        physicalPlausibility,
        isComposite,
        components: rawComponents,
    } = classifierOutput || {};

    // Admission gate. bundlesMultipleProjects deliberately excluded.
    const admissionRejection = checkSafetyRejection({
        inputSafety, nameQuality, semanticCoherence,
        scopeFit, jurisdictionFit, physicalPlausibility,
    });
    if (admissionRejection) {
        return {
            accepted: false,
            admitted: false,
            reason: admissionRejection,
            projectType: "unknown",
            confidence: confidence ?? 0,
        };
    }
    if (!isInfrastructure) {
        return {
            accepted: false,
            admitted: false,
            reason,
            projectType: "unknown",
            confidence: confidence ?? 0,
        };
    }

    // Admitted. Enforce "never emit unknown for an admitted project": coerce
    // if the model violated the invariant.
    let projectType = rawProjectType;
    if (projectType === "unknown") {
        const { type, basis } = coerceAdmittedType(
            { components: rawComponents },
            durationDays,
        );
        if (typeof opts.onCoercion === "function") {
            opts.onCoercion({
                originalType: "unknown",
                coercedType: type,
                basis,
                confidence,
                reason,
            });
        }
        projectType = type;
    }

    // Empty-components safeguard. The tool schema declares `components` as
    // required with minItems: 1, but Anthropic's tool-use validation is
    // best-effort — models can and do return []. When that happens on an
    // ADMITTED project we synthesize a single component from projectType so
    // the mobile retrieval scorer and the verifier prompt never see an empty
    // array. `componentsSynthesized: true` on the resulting record marks it
    // as safeguard-synthesized so Phase 4 calibration can exclude these rows
    // from model-accuracy measurements.
    //
    // Intentional scope: this safeguard fires only on GENUINE model failures
    // on complete responses. Truncated responses (stop_reason: "max_tokens")
    // are rejected by the caller in validateProjectClassification BEFORE
    // decideClassification runs, so a truncation can never reach this
    // branch. See the truncation guard at functions/src/index.js.
    let components = Array.isArray(rawComponents) ? [...rawComponents] : [];
    let componentsSynthesized = false;
    if (components.length === 0) {
        const fallback = TYPE_TO_DEFAULT_COMPONENT[projectType];
        if (fallback) {
            components = [fallback];
            componentsSynthesized = true;
            if (typeof opts.onSynthesis === "function") {
                opts.onSynthesis({
                    synthesizedComponent: fallback,
                    basis: "projectType_reverse_map",
                    projectType,
                });
            }
        }
    }

    const canonicalBand = TYPICAL_DURATION_DAYS[projectType] || null;
    const band = canonicalBand || modelBand || null;
    const durationFlag = computeDurationFlag(projectType, durationDays, band);

    return {
        accepted: true,
        admitted: true,
        projectType,
        confidence,
        durationFlag,
        typicalDurationDays: band,
        reason,
        isComposite: !!isComposite,
        components,
        componentsSynthesized,
        contractVersion: "1",
        // Persisted on the project doc for mobile-side and audit-trail use.
        // `bundlesMultipleProjects` is a server-DERIVED mirror of `isComposite`
        // (see the module header). It is NOT independent model output and must
        // never again be added to the tool schema — doing so gave the model
        // two independent knobs to contradict itself with, which is exactly
        // the defect this mirror was introduced to fix on 2026-08-04.
        verdict: {
            inputSafety: inputSafety || null,
            nameQuality: nameQuality || null,
            semanticCoherence: semanticCoherence || null,
            scopeFit: scopeFit || null,
            jurisdictionFit: jurisdictionFit || null,
            bundlesMultipleProjects: !!isComposite,
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
    COMPONENT_VOCABULARY,
    TYPE_TO_DEFAULT_COMPONENT,
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
