// Pure helpers for recomputeProjectActualPercent. Extracted so both the
// weighted rollup math and the bidirectional status decision can be
// unit-tested without booting the Cloud Functions runtime or the
// firebase-admin SDK.
//
// This module deliberately imports nothing. The caller substitutes an
// admin.firestore.FieldValue.delete() sentinel wherever CLEAR_DATE
// appears in a decideStatusUpdate return value.

const DONE_STATUSES = ["done", "complete", "completed"];

const CLEAR_DATE = Object.freeze({ __clearDate: true });

const isDone = (m) => DONE_STATUSES.includes((m?.status || "").toLowerCase());

const hasValidWeight = (m) => {
    const w = Number(m?.weightPercentage);
    return Number.isFinite(w) && w > 0;
};

const isConfirmed = (m) => m?.confirmed !== false;

// Compute a project's actualPercent from its milestone array.
//
// Returns { actualPercent, method, skipped }.
//   method  - "weight" when at least one eligible milestone had a valid
//             weightPercentage; "count-fallback" when the denominator
//             was empty and we fell back to counting done milestones.
//   skipped - number of confirmed milestones that were dropped from
//             the weighted calculation for having missing, null, zero,
//             or non-finite weightPercentage. The caller logs this at
//             warn level so an unweighted bleed-through becomes
//             visible in Cloud Functions logs.
const computeActualPercent = (milestones) => {
    const list = Array.isArray(milestones) ? milestones : [];
    const confirmed = list.filter(isConfirmed);
    const weighted = confirmed.filter(hasValidWeight);
    const skipped = confirmed.length - weighted.length;

    if (weighted.length === 0) {
        // Fallback: no milestone carries a usable weight. Count-based
        // is the only defined answer. Matches the pre-change behavior
        // exactly, so a project that ever ends up in this state keeps
        // working.
        if (confirmed.length === 0) {
            return { actualPercent: 0, method: "count-fallback", skipped };
        }
        const doneCount = confirmed.filter(isDone).length;
        return {
            actualPercent: Math.round((doneCount / confirmed.length) * 100),
            method: "count-fallback",
            skipped,
        };
    }

    let sumWeight = 0;
    let sumCompletedWeight = 0;
    for (const m of weighted) {
        const w = Number(m.weightPercentage);
        sumWeight += w;
        if (isDone(m)) sumCompletedWeight += w;
    }

    return {
        actualPercent: Math.round((sumCompletedWeight / sumWeight) * 100),
        method: "weight",
        skipped,
    };
};

// Bidirectional status rollup. Returns the update payload to merge onto
// the project doc, or null if no status change is needed.
//
// Rules (in order):
//   - 100 and not-completed: set Completed. Stamp actualDateCompleted
//     only if the current stamp is falsy; on re-completion the
//     existing date is preserved by omitting the key from the update.
//   - below 100 and Completed: revert to Ongoing and CLEAR_DATE. The
//     caller substitutes admin.firestore.FieldValue.delete() for the
//     sentinel.
//   - anything else (including Delayed below 100): return null. A
//     Delayed project is never dragged to Ongoing by this trigger;
//     detectProjectSlippage owns that decision.
const decideStatusUpdate = ({
    actualPercent,
    currentStatus,
    currentActualDateCompleted,
    today,
}) => {
    const statusLower = String(currentStatus || "").toLowerCase();

    if (actualPercent === 100 && statusLower !== "completed") {
        const update = { status: "Completed" };
        if (!currentActualDateCompleted) {
            update.actualDateCompleted = today;
        }
        return update;
    }

    if (actualPercent < 100 && statusLower === "completed") {
        return {
            status: "Ongoing",
            actualDateCompleted: CLEAR_DATE,
        };
    }

    return null;
};

module.exports = {
    DONE_STATUSES,
    CLEAR_DATE,
    computeActualPercent,
    decideStatusUpdate,
};
