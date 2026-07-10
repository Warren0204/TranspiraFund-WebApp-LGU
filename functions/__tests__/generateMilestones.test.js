// Unit tests for the generateMilestones coherence checks. Anthropic SDK is
// not invoked here; pure helpers from lib/classification are exercised with
// realistic milestone payloads that simulate good/bad LLM output.

const {
    checkVocabulary,
    checkDurationSum,
    classificationGatePasses,
    VOCAB_REGEX,
} = require("../src/lib/classification");

const buildMilestone = (overrides = {}) => ({
    sequence: 1,
    title: "Mobilization and Site Clearing",
    description: "Move equipment, clear site, set up.",
    weight_percentage: 10,
    suggested_duration_days: 7,
    ...overrides,
});

const goodMilestones = [
    buildMilestone({ sequence: 1, title: "Mobilization, site clearing, and layout staking", suggested_duration_days: 7 }),
    buildMilestone({ sequence: 2, title: "Excavation and subgrade preparation", suggested_duration_days: 10 }),
    buildMilestone({ sequence: 3, title: "Concrete pouring, first half", suggested_duration_days: 14 }),
    buildMilestone({ sequence: 4, title: "Concrete pouring and curing, second half", suggested_duration_days: 14 }),
    buildMilestone({ sequence: 5, title: "Pavement markings and final inspection", suggested_duration_days: 5 }),
];
const goodMilestonesTotal = 7 + 10 + 14 + 14 + 5; // 50

describe("generateMilestones — classification gate", () => {
    test("unknown projectType blocks generation", () => {
        expect(classificationGatePasses({
            projectType: "unknown",
            classificationConfidence: 0.95,
        })).toBe(false);
    });

    test("missing projectType blocks generation", () => {
        expect(classificationGatePasses({ classificationConfidence: 0.9 })).toBe(false);
    });

    test("low confidence blocks generation", () => {
        expect(classificationGatePasses({
            projectType: "road_concreting",
            classificationConfidence: 0.4,
        })).toBe(false);
    });

    test("missing confidence blocks generation", () => {
        expect(classificationGatePasses({ projectType: "road_concreting" })).toBe(false);
    });

    test("valid classification passes the gate", () => {
        expect(classificationGatePasses({
            projectType: "road_concreting",
            classificationConfidence: 0.9,
        })).toBe(true);
    });

    test("confidence at 0.8 boundary passes", () => {
        expect(classificationGatePasses({
            projectType: "drainage_construction",
            classificationConfidence: 0.8,
        })).toBe(true);
    });

    test("confidence just below 0.8 boundary blocks generation", () => {
        expect(classificationGatePasses({
            projectType: "drainage_construction",
            classificationConfidence: 0.79,
        })).toBe(false);
    });
});

describe("generateMilestones — vocabulary check", () => {
    test("passes when every title contains a vocabulary term", () => {
        expect(checkVocabulary(goodMilestones)).toBe(true);
    });

    test("fails when any title is generic ('Construction Phase 1')", () => {
        const bad = [...goodMilestones, buildMilestone({ sequence: 6, title: "Construction Phase 1" })];
        expect(checkVocabulary(bad)).toBe(false);
    });

    test("fails when any title is empty", () => {
        const bad = [...goodMilestones, buildMilestone({ sequence: 6, title: "" })];
        expect(checkVocabulary(bad)).toBe(false);
    });

    test("is case-insensitive (whole-word)", () => {
        const ms = [buildMilestone({ title: "MASONRY of perimeter walls" })];
        expect(checkVocabulary(ms)).toBe(true);
    });

    test("multi-word terms work ('Site Clearing')", () => {
        expect(VOCAB_REGEX.test("Site Clearing operations begin Monday")).toBe(true);
    });

    test("multi-word terms require both words ('Site' alone does NOT pass via 'Site Clearing')", () => {
        // 'Site' standalone is not in the vocab; it would only match if 'Site Preparation' or 'Site Clearing' appears.
        // But 'Site Preparation' and 'Site Clearing' are vocab terms — bare 'Site' should not match either.
        // The token 'Site' on its own is intentionally NOT a vocab term.
        const bareSite = [buildMilestone({ title: "Site staging only" })];
        expect(checkVocabulary(bareSite)).toBe(false);
    });

    test("'Final Inspection' as a whole phrase matches", () => {
        expect(VOCAB_REGEX.test("Final Inspection of the building")).toBe(true);
    });

    test("returns false for empty milestone array", () => {
        expect(checkVocabulary([])).toBe(false);
    });

    test("simulates retry-success: first batch fails, second batch passes", () => {
        const badBatch = [...goodMilestones.slice(0, 4), buildMilestone({ title: "Construction Phase 1" })];
        const goodBatch = goodMilestones;
        expect(checkVocabulary(badBatch)).toBe(false);
        expect(checkVocabulary(goodBatch)).toBe(true);
    });

    test("simulates retry-failure: both batches fail", () => {
        const badBatch1 = [buildMilestone({ title: "Phase 1" })];
        const badBatch2 = [buildMilestone({ title: "Work Progress 50%" })];
        expect(checkVocabulary(badBatch1)).toBe(false);
        expect(checkVocabulary(badBatch2)).toBe(false);
    });
});

describe("generateMilestones — duration-sum check", () => {
    test("passes when sum equals target", () => {
        expect(checkDurationSum(goodMilestones, goodMilestonesTotal)).toBe(true);
    });

    test("passes when sum is within ±2 days of target", () => {
        expect(checkDurationSum(goodMilestones, goodMilestonesTotal + 2)).toBe(true);
        expect(checkDurationSum(goodMilestones, goodMilestonesTotal - 2)).toBe(true);
    });

    test("fails when sum is off by 3 days", () => {
        expect(checkDurationSum(goodMilestones, goodMilestonesTotal + 3)).toBe(false);
        expect(checkDurationSum(goodMilestones, goodMilestonesTotal - 3)).toBe(false);
    });

    test("fails when sum is off by 10 days (retry trigger)", () => {
        expect(checkDurationSum(goodMilestones, goodMilestonesTotal + 10)).toBe(false);
    });

    test("simulates duration retry-success", () => {
        const skewed = [
            buildMilestone({ suggested_duration_days: 5 }),
            buildMilestone({ suggested_duration_days: 5 }),
        ];
        const corrected = [
            buildMilestone({ suggested_duration_days: 45 }),
            buildMilestone({ suggested_duration_days: 45 }),
        ];
        expect(checkDurationSum(skewed, 90)).toBe(false);  // first attempt fails
        expect(checkDurationSum(corrected, 90)).toBe(true); // retry passes
    });

    test("returns true when targetDays is null (duration unknown)", () => {
        expect(checkDurationSum(goodMilestones, null)).toBe(true);
    });

    test("returns false for empty milestone array", () => {
        expect(checkDurationSum([], 90)).toBe(false);
    });
});
