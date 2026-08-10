const {
    DONE_STATUSES,
    CLEAR_DATE,
    computeActualPercent,
    decideStatusUpdate,
} = require("../src/lib/milestone-rollup");

// Shorthand milestone factory. Any field not passed is left off so the
// eligibility filter sees "missing" rather than a coerced zero.
const m = (overrides = {}) => ({ confirmed: true, ...overrides });

describe("computeActualPercent", () => {
    test("empty confirmed set returns 0 via count-fallback", () => {
        expect(computeActualPercent([])).toEqual({
            actualPercent: 0,
            method: "count-fallback",
            skipped: 0,
        });
    });

    test("all done with weights [10,20,30,40] returns 100", () => {
        const ms = [
            m({ status: "done", weightPercentage: 10 }),
            m({ status: "done", weightPercentage: 20 }),
            m({ status: "done", weightPercentage: 30 }),
            m({ status: "done", weightPercentage: 40 }),
        ];
        const r = computeActualPercent(ms);
        expect(r.actualPercent).toBe(100);
        expect(r.method).toBe("weight");
        expect(r.skipped).toBe(0);
    });

    test("weighted partial: [{20,done},{80,todo}] returns 20 not 50", () => {
        const ms = [
            m({ status: "done", weightPercentage: 20 }),
            m({ status: "pending", weightPercentage: 80 }),
        ];
        const r = computeActualPercent(ms);
        expect(r.actualPercent).toBe(20);
        expect(r.method).toBe("weight");
    });

    test("zero total weight (every milestone unweighted) falls back to count-based", () => {
        const ms = [
            m({ status: "done" }),
            m({ status: "done" }),
            m({ status: "pending" }),
            m({ status: "pending" }),
        ];
        const r = computeActualPercent(ms);
        expect(r.actualPercent).toBe(50);
        expect(r.method).toBe("count-fallback");
        expect(r.skipped).toBe(4);
    });

    test("mixed weighted/unweighted: 3 weighted + 2 unweighted computes over 3, skipped is 2", () => {
        const ms = [
            m({ status: "done", weightPercentage: 30 }),
            m({ status: "done", weightPercentage: 30 }),
            m({ status: "pending", weightPercentage: 40 }),
            m({ status: "done" }),
            m({ status: "pending" }),
        ];
        const r = computeActualPercent(ms);
        expect(r.actualPercent).toBe(60);
        expect(r.method).toBe("weight");
        expect(r.skipped).toBe(2);
    });

    test("missing/null/zero-weight milestones are excluded without dragging the sum", () => {
        const ms = [
            m({ status: "done", weightPercentage: 40 }),
            m({ status: "done", weightPercentage: 60 }),
            m({ status: "done", weightPercentage: null }),
            m({ status: "done", weightPercentage: 0 }),
            m({ status: "pending" }),
        ];
        const r = computeActualPercent(ms);
        expect(r.actualPercent).toBe(100);
        expect(r.skipped).toBe(3);
    });

    test("case-insensitive done: Done, COMPLETED, complete all count", () => {
        const ms = [
            m({ status: "Done", weightPercentage: 25 }),
            m({ status: "COMPLETED", weightPercentage: 25 }),
            m({ status: "complete", weightPercentage: 25 }),
            m({ status: "pending", weightPercentage: 25 }),
        ];
        expect(computeActualPercent(ms).actualPercent).toBe(75);
    });

    test("regression fixture: 4jTZftmuWgX5l8S3qGP4 shape yields 92", () => {
        const ms = [
            m({ status: "done", weightPercentage: 8 }),
            m({ status: "done", weightPercentage: 10 }),
            m({ status: "done", weightPercentage: 12 }),
            m({ status: "done", weightPercentage: 10 }),
            m({ status: "done", weightPercentage: 12 }),
            m({ status: "done", weightPercentage: 12 }),
            m({ status: "done", weightPercentage: 14 }),
            m({ status: "done", weightPercentage: 14 }),
            m({ status: "pending", weightPercentage: 8 }),
        ];
        expect(computeActualPercent(ms).actualPercent).toBe(92);
    });

    test("unconfirmed drafts are excluded", () => {
        const ms = [
            m({ status: "done", weightPercentage: 50 }),
            m({ status: "done", weightPercentage: 50 }),
            m({ status: "done", weightPercentage: 999, confirmed: false }),
        ];
        expect(computeActualPercent(ms).actualPercent).toBe(100);
    });

    test("DONE_STATUSES export matches the trigger's list", () => {
        expect(DONE_STATUSES).toEqual(["done", "complete", "completed"]);
    });
});

describe("decideStatusUpdate", () => {
    const today = "2026-08-10";

    test("100 with status not-completed and no date returns Completed plus today's stamp", () => {
        const r = decideStatusUpdate({
            actualPercent: 100,
            currentStatus: "Ongoing",
            currentActualDateCompleted: null,
            today,
        });
        expect(r).toEqual({ status: "Completed", actualDateCompleted: today });
    });

    test("100 with status already completed returns null", () => {
        const r = decideStatusUpdate({
            actualPercent: 100,
            currentStatus: "Completed",
            currentActualDateCompleted: null,
            today,
        });
        expect(r).toBeNull();
    });

    test("100 with status Ongoing and existing date returns Completed with NO actualDateCompleted key present", () => {
        const r = decideStatusUpdate({
            actualPercent: 100,
            currentStatus: "Ongoing",
            currentActualDateCompleted: "2026-07-01",
            today,
        });
        expect(r).toEqual({ status: "Completed" });
        // Assert the key is absent, not merely equal to the old value.
        // An update payload that carries the key would rewrite the
        // Firestore field on merge even if the value matched.
        expect("actualDateCompleted" in r).toBe(false);
    });

    test("below 100 with status Completed returns Ongoing plus CLEAR_DATE sentinel", () => {
        const r = decideStatusUpdate({
            actualPercent: 92,
            currentStatus: "Completed",
            currentActualDateCompleted: "2026-05-15",
            today,
        });
        expect(r).toEqual({
            status: "Ongoing",
            actualDateCompleted: CLEAR_DATE,
        });
    });

    test("below 100 with status Ongoing returns null (no touch)", () => {
        const r = decideStatusUpdate({
            actualPercent: 45,
            currentStatus: "Ongoing",
            currentActualDateCompleted: null,
            today,
        });
        expect(r).toBeNull();
    });

    test("below 100 with status Delayed returns null (never dragged to Ongoing)", () => {
        const r = decideStatusUpdate({
            actualPercent: 30,
            currentStatus: "Delayed",
            currentActualDateCompleted: null,
            today,
        });
        expect(r).toBeNull();
    });

    test("case-insensitive status matching for completed branch", () => {
        expect(decideStatusUpdate({
            actualPercent: 100,
            currentStatus: "completed",
            currentActualDateCompleted: null,
            today,
        })).toBeNull();

        expect(decideStatusUpdate({
            actualPercent: 92,
            currentStatus: "COMPLETED",
            currentActualDateCompleted: "2026-01-01",
            today,
        })).toEqual({ status: "Ongoing", actualDateCompleted: CLEAR_DATE });
    });
});
