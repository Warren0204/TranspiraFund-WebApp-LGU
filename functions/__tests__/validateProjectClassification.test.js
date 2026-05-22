// Unit tests for the validateProjectClassification logic. Anthropic SDK is
// mocked at the boundary; pure helpers from lib/classification are exercised
// directly to cover all branches of accept/reject and durationFlag.

const {
    decideClassification,
    computeDurationFlag,
    parseAndValidateDuration,
    TYPICAL_DURATION_DAYS,
    PROJECT_TYPE_ENUM,
} = require("../src/lib/classification");

describe("validateProjectClassification — decideClassification", () => {
    test("good infra name in band → accepted with within_range flag", () => {
        const result = decideClassification(
            {
                isInfrastructure: true,
                projectType: "road_concreting",
                confidence: 0.92,
                typicalDurationDays: { min: 60, max: 180 },
                reason: "Concreting of a barangay access road.",
            },
            90
        );
        expect(result.accepted).toBe(true);
        expect(result.projectType).toBe("road_concreting");
        expect(result.durationFlag).toBe("within_range");
        expect(result.typicalDurationDays).toEqual({ min: 60, max: 180 });
    });

    test("non-infrastructure name → rejected", () => {
        const result = decideClassification(
            {
                isInfrastructure: false,
                projectType: "unknown",
                confidence: 0.95,
                typicalDurationDays: null,
                reason: "Project name describes procurement of office equipment, not physical infrastructure.",
            },
            90
        );
        expect(result.accepted).toBe(false);
        expect(result.reason).toMatch(/procurement/i);
        expect(result.projectType).toBe("unknown");
    });

    test("duration below typical → below_typical flag", () => {
        const result = decideClassification(
            {
                isInfrastructure: true,
                projectType: "road_concreting",
                confidence: 0.9,
                typicalDurationDays: { min: 60, max: 180 },
                reason: "Concreting of barangay access road.",
            },
            20
        );
        expect(result.accepted).toBe(true);
        expect(result.durationFlag).toBe("below_typical");
    });

    test("duration above typical → above_typical flag", () => {
        const result = decideClassification(
            {
                isInfrastructure: true,
                projectType: "road_concreting",
                confidence: 0.9,
                typicalDurationDays: { min: 60, max: 180 },
                reason: "Concreting of barangay access road.",
            },
            300
        );
        expect(result.accepted).toBe(true);
        expect(result.durationFlag).toBe("above_typical");
    });

    test("unknown projectType with low confidence → rejected", () => {
        const result = decideClassification(
            {
                isInfrastructure: true,
                projectType: "unknown",
                confidence: 0.4,
                typicalDurationDays: null,
                reason: "Could not classify.",
            },
            90
        );
        expect(result.accepted).toBe(false);
    });

    test("unknown projectType with high confidence + isInfra=true → accepted with unknown_type flag", () => {
        const result = decideClassification(
            {
                isInfrastructure: true,
                projectType: "unknown",
                confidence: 0.85,
                typicalDurationDays: null,
                reason: "Looks like infrastructure but does not match a known category.",
            },
            90
        );
        expect(result.accepted).toBe(true);
        expect(result.durationFlag).toBe("unknown_type");
    });

    test("canonical band overrides classifier-supplied band", () => {
        // Classifier returns a wrong band; helper should use TYPICAL_DURATION_DAYS instead.
        const result = decideClassification(
            {
                isInfrastructure: true,
                projectType: "drainage_construction",
                confidence: 0.9,
                typicalDurationDays: { min: 999, max: 9999 },
                reason: "Drainage canal construction.",
            },
            60
        );
        expect(result.typicalDurationDays).toEqual(TYPICAL_DURATION_DAYS.drainage_construction);
        expect(result.durationFlag).toBe("within_range"); // 60 is within 45-120
    });
});

describe("validateProjectClassification — parseAndValidateDuration", () => {
    test("valid range returns durationDays", () => {
        const days = parseAndValidateDuration("2026-06-01", "2026-08-30");
        expect(days).toBe(90);
    });

    test("duration below hard minimum (14) throws invalid-argument", () => {
        expect(() => parseAndValidateDuration("2026-06-01", "2026-06-08")).toThrow(/between 14 and 730/);
    });

    test("duration above hard maximum (730) throws invalid-argument", () => {
        expect(() => parseAndValidateDuration("2026-01-01", "2028-06-01")).toThrow(/between 14 and 730/);
    });

    test("invalid date string throws invalid-argument", () => {
        expect(() => parseAndValidateDuration("not-a-date", "2026-08-30")).toThrow(/Invalid start or end date/);
    });
});

describe("computeDurationFlag", () => {
    test("returns unknown_type when projectType is unknown", () => {
        expect(computeDurationFlag("unknown", 100, null)).toBe("unknown_type");
    });

    test("returns unknown_type when band is null", () => {
        expect(computeDurationFlag("road_concreting", 100, null)).toBe("unknown_type");
    });

    test("returns within_range at min boundary", () => {
        expect(computeDurationFlag("road_concreting", 60, { min: 60, max: 180 })).toBe("within_range");
    });

    test("returns within_range at max boundary", () => {
        expect(computeDurationFlag("road_concreting", 180, { min: 60, max: 180 })).toBe("within_range");
    });
});

describe("PROJECT_TYPE_ENUM", () => {
    test("contains all 9 classified types plus unknown", () => {
        expect(PROJECT_TYPE_ENUM).toEqual([
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
        ]);
    });

    test("every non-unknown type has a duration band", () => {
        for (const t of PROJECT_TYPE_ENUM) {
            if (t === "unknown") continue;
            expect(TYPICAL_DURATION_DAYS[t]).toBeDefined();
            expect(TYPICAL_DURATION_DAYS[t].min).toBeLessThan(TYPICAL_DURATION_DAYS[t].max);
        }
    });
});
