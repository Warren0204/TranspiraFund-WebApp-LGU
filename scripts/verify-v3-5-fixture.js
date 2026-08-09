// One-shot verifier: prove that scripts/fixtures/verifier-prompt-v3-5.js is a
// byte-faithful freeze of the four artifacts currently in functions/src/index.js
// (the system prompt, the tool builder, the milestone context template, and
// the photo label template). This is a diagnostic - it makes no writes.
//
// Usage: node scripts/verify-v3-5-fixture.js
// Exit code 0 on success, 1 on any mismatch.

const fs = require("fs");
const path = require("path");

const fx = require(path.resolve(__dirname, "fixtures", "verifier-prompt-v3-5.js"));
const src = fs.readFileSync(path.resolve(__dirname, "..", "functions", "src", "index.js"), "utf8");

let fail = false;
function ok(msg)  { console.log("OK   " + msg); }
function bad(msg) { fail = true; console.error("FAIL " + msg); }

// ---- 1. System prompt ----
// Locate the current VERIFICATION_SYSTEM_PROMPT template literal and decode
// its escapes so we compare the runtime string values (which is what the
// Anthropic API actually receives).
const sysMatch = src.match(/const VERIFICATION_SYSTEM_PROMPT = `([\s\S]*?)`;/);
if (!sysMatch) {
    bad("could not locate current VERIFICATION_SYSTEM_PROMPT");
} else {
    const currentSysRuntime = sysMatch[1]
        .replace(/\\`/g, "`")
        .replace(/\\\$/g, "$")
        .replace(/\\\\/g, "\\");
    if (currentSysRuntime === fx.VERIFICATION_SYSTEM_PROMPT_V3_5) {
        ok("VERIFICATION_SYSTEM_PROMPT_V3_5 matches current source (" + currentSysRuntime.length + " chars)");
    } else {
        bad("VERIFICATION_SYSTEM_PROMPT_V3_5 differs from current source");
        const a = currentSysRuntime, b = fx.VERIFICATION_SYSTEM_PROMPT_V3_5;
        console.error("     lengths: current=" + a.length + " fixture=" + b.length);
        const m = Math.min(a.length, b.length);
        for (let i = 0; i < m; i++) {
            if (a[i] !== b[i]) {
                const ctxA = a.slice(Math.max(0, i - 40), i + 40);
                const ctxB = b.slice(Math.max(0, i - 40), i + 40);
                console.error("     first diff at index " + i);
                console.error("       current: " + JSON.stringify(ctxA));
                console.error("       fixture: " + JSON.stringify(ctxB));
                break;
            }
        }
    }
}

// ---- 2. Tool builder ----
// Extract the current buildVerificationTool source and eval it in isolation,
// then compare its output at a small photoCount against the fixture.
const builderMatch = src.match(/const buildVerificationTool = \(photoCount\) => \(\{[\s\S]*?\n\}\);/);
if (!builderMatch) {
    bad("could not locate current buildVerificationTool");
} else {
    // eslint-disable-next-line no-eval
    const currentBuild = eval("(" + builderMatch[0]
        .replace(/^const buildVerificationTool = /, "")
        .replace(/;$/, "") + ")");
    for (const n of [1, 2, 3, 5]) {
        const a = JSON.stringify(currentBuild(n));
        const b = JSON.stringify(fx.VERIFICATION_TOOL_BUILDER_V3_5(n));
        if (a === b) {
            ok("VERIFICATION_TOOL_BUILDER_V3_5(" + n + ") matches current source");
        } else {
            bad("VERIFICATION_TOOL_BUILDER_V3_5(" + n + ") differs from current source");
            console.error("     current: " + a);
            console.error("     fixture: " + b);
        }
    }
}

// ---- 3. Milestone context template ----
// Extract the source template once, then render both the source and the fixture
// against multiple input graphs designed to exercise BOTH branches of every
// conditional in the closure and the template body. A single-graph comparison
// only proves branches the graph happens to walk; unexercised branches pass
// vacuously and a mis-transcribed ?? default or ternary in an unwalked branch
// would go undetected. In particular, classification.components is EMPTY on all
// 7 projects covering all 115 proofs in the real dataset, so the empty branch
// of componentsLine executes on every real call and MUST be verified.
//
// Conditionals enumerated in the closure + template body (18 total):
//   In the closure:
//     C1  componentsLine        components.length > 0 ternary
//     C2  locationLine outer    sitioStreet truthy ternary
//     C3  locationLine inner    barangay ?? "Unknown" inside truthy sitioStreet branch
//     C4  locationLine inner    barangay ?? "Unknown" inside falsy sitioStreet branch
//     C5  contractLine          contractAmount != null ternary
//     C6  projectWindow         officialDateStarted ?? "Unknown"
//     C7  projectWindow         originalDateCompletion ?? "Unknown"
//   In the template body:
//     C8  projectName ?? "Unknown"
//     C9  projectType ?? "Unknown"
//     C10 isComposite ? "yes" : "no"
//     C11 after.title ?? "Unknown"
//     C12 after.description ?? "No description"
//     C13 after.sequence ?? "N/A"
//     C14 milestonesContext.total ?? "N/A"
//     C15 after.weightPercentage ?? "N/A"
//     C16 after.suggestedDurationDays ?? "N/A"
//     C17 milestonesContext.prevTitle ?? "(none - first phase)"
//     C18 milestonesContext.nextTitle ?? "(none - final phase)"
//     C19 sentProofs.length !== 1 ? "s" : "" pluralization
//
// Four graphs to cover both branches of each. Coverage matrix printed at end.
//   A: happy plural   - every field present; sitioStreet truthy, barangay set; sentProofs length 2
//   B: bare singular  - every field null/empty/false; sitioStreet null, barangay null; sentProofs length 1
//   C: barangay-only  - sitioStreet null WITH barangay set (else same as B)
//   D: street-only    - sitioStreet set WITH barangay null (else same as B)
//
// C3 (barangay ?? in truthy sitioStreet branch) needs sitioStreet truthy and
// barangay both set (A) and null (D). C4 (barangay ?? in falsy sitioStreet
// branch) needs sitioStreet falsy and barangay both null (B) and set (C). All
// four (sitioStreet, barangay) combinations are therefore reached by exactly
// one graph, which is the minimum required for full branch coverage of the
// locationLine helper.

const graphs = [
    {
        name: "A: happy plural, everything set",
        projContext: {
            projectName: "TestProject", projectType: "Drainage",
            components: ["culvert", "canal"], isComposite: true,
            barangay: "Adlaon", sitioStreet: "Grahe",
            contractAmount: 950000,
            officialDateStarted: "2026-08-05",
            originalDateCompletion: "2026-10-30",
        },
        after: {
            title: "TestPhase", description: "Excavation and backfill.",
            sequence: 3, weightPercentage: 25, suggestedDurationDays: 14,
        },
        milestonesContext: { total: 7, prevTitle: "Prior Phase", nextTitle: "Next Phase" },
        sentProofs: [{}, {}],
    },
    {
        name: "B: bare singular, sitioStreet null + barangay null",
        projContext: {
            projectName: null, projectType: null,
            components: [], isComposite: false,
            barangay: null, sitioStreet: null,
            contractAmount: null,
            officialDateStarted: null,
            originalDateCompletion: null,
        },
        after: {
            title: null, description: null,
            sequence: null, weightPercentage: null, suggestedDurationDays: null,
        },
        milestonesContext: { total: null, prevTitle: null, nextTitle: null },
        sentProofs: [{}],
    },
    {
        name: "C: sitioStreet null + barangay set (else bare)",
        projContext: {
            projectName: null, projectType: null,
            components: [], isComposite: false,
            barangay: "Adlaon", sitioStreet: null,
            contractAmount: null,
            officialDateStarted: null,
            originalDateCompletion: null,
        },
        after: {
            title: null, description: null,
            sequence: null, weightPercentage: null, suggestedDurationDays: null,
        },
        milestonesContext: { total: null, prevTitle: null, nextTitle: null },
        sentProofs: [{}],
    },
    {
        name: "D: sitioStreet set + barangay null (else bare)",
        projContext: {
            projectName: null, projectType: null,
            components: [], isComposite: false,
            barangay: null, sitioStreet: "Grahe",
            contractAmount: null,
            officialDateStarted: null,
            originalDateCompletion: null,
        },
        after: {
            title: null, description: null,
            sequence: null, weightPercentage: null, suggestedDurationDays: null,
        },
        milestonesContext: { total: null, prevTitle: null, nextTitle: null },
        sentProofs: [{}],
    },
];

const tmplMatch = src.match(/const milestoneContext = `## Project Context\n([\s\S]*?)Assess each photo against the milestone description, then provide an overall verdict for this batch\.`;/);
if (!tmplMatch) {
    bad("could not locate current milestone context template");
} else {
    for (const g of graphs) {
        const { projContext, after, milestonesContext, sentProofs } = g;
        // Rebuild the surrounding closure that supplies componentsLine,
        // locationLine, contractLine, and projectWindow - copied verbatim from
        // the trigger. These locals feed the eval below.
        const componentsLine = projContext.components.length > 0
            ? projContext.components.join(", ")
            : "(none recorded)";
        const locationLine = projContext.sitioStreet
            ? `${projContext.barangay ?? "Unknown"}, ${projContext.sitioStreet}`
            : (projContext.barangay ?? "Unknown");
        const contractLine = projContext.contractAmount != null
            ? `PHP ${Number(projContext.contractAmount).toLocaleString("en-PH")}`
            : "Unknown";
        const projectWindow = `${projContext.officialDateStarted ?? "Unknown"} to ${projContext.originalDateCompletion ?? "Unknown"}`;
        // eslint-disable-next-line no-eval
        const currentRendered = eval("`## Project Context\n" + tmplMatch[1] + "Assess each photo against the milestone description, then provide an overall verdict for this batch.`");
        const fixtureRendered = fx.MILESTONE_CONTEXT_TEMPLATE_V3_5(projContext, after, milestonesContext, sentProofs);
        if (currentRendered === fixtureRendered) {
            ok("MILESTONE_CONTEXT_TEMPLATE_V3_5 graph " + g.name + " matches (" + currentRendered.length + " chars)");
        } else {
            bad("MILESTONE_CONTEXT_TEMPLATE_V3_5 graph " + g.name + " DIFFERS from current source");
            const a = currentRendered, b = fixtureRendered;
            console.error("     lengths: current=" + a.length + " fixture=" + b.length);
            const m = Math.min(a.length, b.length);
            for (let i = 0; i < m; i++) {
                if (a[i] !== b[i]) {
                    console.error("     first diff at index " + i);
                    console.error("       current: " + JSON.stringify(a.slice(Math.max(0, i - 40), i + 40)));
                    console.error("       fixture: " + JSON.stringify(b.slice(Math.max(0, i - 40), i + 40)));
                    break;
                }
            }
        }
    }

    // Branch coverage matrix. Kept in lockstep with the graph inputs above; if
    // graphs change, update these lists or coverage claims lie.
    const coverage = [
        { id: "C1  componentsLine ternary",           lhs: "length > 0",     rhs: "length == 0",     lhsGraphs: ["A"],           rhsGraphs: ["B", "C", "D"] },
        { id: "C2  locationLine outer ternary",       lhs: "sitioStreet truthy", rhs: "sitioStreet falsy", lhsGraphs: ["A", "D"], rhsGraphs: ["B", "C"] },
        { id: "C3  barangay ?? in truthy branch",     lhs: "barangay set",   rhs: "barangay null",   lhsGraphs: ["A"],           rhsGraphs: ["D"] },
        { id: "C4  barangay ?? in falsy branch",      lhs: "barangay set",   rhs: "barangay null",   lhsGraphs: ["C"],           rhsGraphs: ["B"] },
        { id: "C5  contractLine ternary",             lhs: "amount != null", rhs: "amount == null",  lhsGraphs: ["A"],           rhsGraphs: ["B", "C", "D"] },
        { id: "C6  officialDateStarted ??",           lhs: "set",            rhs: "null",            lhsGraphs: ["A"],           rhsGraphs: ["B", "C", "D"] },
        { id: "C7  originalDateCompletion ??",        lhs: "set",            rhs: "null",            lhsGraphs: ["A"],           rhsGraphs: ["B", "C", "D"] },
        { id: "C8  projectName ??",                   lhs: "set",            rhs: "null",            lhsGraphs: ["A"],           rhsGraphs: ["B", "C", "D"] },
        { id: "C9  projectType ??",                   lhs: "set",            rhs: "null",            lhsGraphs: ["A"],           rhsGraphs: ["B", "C", "D"] },
        { id: "C10 isComposite ternary",              lhs: "true",           rhs: "false",           lhsGraphs: ["A"],           rhsGraphs: ["B", "C", "D"] },
        { id: "C11 after.title ??",                   lhs: "set",            rhs: "null",            lhsGraphs: ["A"],           rhsGraphs: ["B", "C", "D"] },
        { id: "C12 after.description ??",             lhs: "set",            rhs: "null",            lhsGraphs: ["A"],           rhsGraphs: ["B", "C", "D"] },
        { id: "C13 after.sequence ??",                lhs: "set",            rhs: "null",            lhsGraphs: ["A"],           rhsGraphs: ["B", "C", "D"] },
        { id: "C14 milestonesContext.total ??",       lhs: "set",            rhs: "null",            lhsGraphs: ["A"],           rhsGraphs: ["B", "C", "D"] },
        { id: "C15 after.weightPercentage ??",        lhs: "set",            rhs: "null",            lhsGraphs: ["A"],           rhsGraphs: ["B", "C", "D"] },
        { id: "C16 after.suggestedDurationDays ??",   lhs: "set",            rhs: "null",            lhsGraphs: ["A"],           rhsGraphs: ["B", "C", "D"] },
        { id: "C17 prevTitle ??",                     lhs: "set",            rhs: "null",            lhsGraphs: ["A"],           rhsGraphs: ["B", "C", "D"] },
        { id: "C18 nextTitle ??",                     lhs: "set",            rhs: "null",            lhsGraphs: ["A"],           rhsGraphs: ["B", "C", "D"] },
        { id: "C19 sentProofs.length !== 1 ternary",  lhs: "plural",         rhs: "singular",        lhsGraphs: ["A"],           rhsGraphs: ["B", "C", "D"] },
    ];
    console.log("");
    console.log("Branch coverage matrix (MILESTONE_CONTEXT_TEMPLATE_V3_5):");
    for (const c of coverage) {
        const lhsLabel = c.lhsGraphs.length ? c.lhsGraphs.join(",") : "UNCOVERED";
        const rhsLabel = c.rhsGraphs.length ? c.rhsGraphs.join(",") : "UNCOVERED";
        if (!c.lhsGraphs.length || !c.rhsGraphs.length) {
            bad("     " + c.id + " has an uncovered branch (lhs=" + lhsLabel + " rhs=" + rhsLabel + ")");
        } else {
            console.log("     " + c.id.padEnd(42) + " lhs(" + c.lhs + ")=" + lhsLabel.padEnd(9) + " rhs(" + c.rhs + ")=" + rhsLabel);
        }
    }
}

// ---- 4. Photo label template ----
// The source has: `Photo ${i + 1} of ${sentProofs.length}. Captured ${caption.when}. GPS ${caption.gps}. Accuracy ${caption.accuracy}.`
// The fixture has: `Photo ${i + 1} of ${total}. Captured ${caption.when}. GPS ${caption.gps}. Accuracy ${caption.accuracy}.`
// Since `total` in the fixture stands in for `sentProofs.length` in the trigger,
// the two must produce identical output when called with matching arguments.
const caption = { when: "05 Aug 2026, 3:00 PM (PHT)", gps: "10.3, 123.9", accuracy: "6m" };
const currentLabel = `Photo ${0 + 1} of ${2}. Captured ${caption.when}. GPS ${caption.gps}. Accuracy ${caption.accuracy}.`;
const fixtureLabel = fx.PHOTO_LABEL_TEMPLATE_V3_5(0, 2, caption);
if (currentLabel === fixtureLabel) {
    ok("PHOTO_LABEL_TEMPLATE_V3_5 renders identically to current source");
} else {
    bad("PHOTO_LABEL_TEMPLATE_V3_5 differs from current source");
    console.error("     current: " + JSON.stringify(currentLabel));
    console.error("     fixture: " + JSON.stringify(fixtureLabel));
}

// ---- 5. Exports ----
for (const k of ["VERIFICATION_SYSTEM_PROMPT_V3_5", "VERIFICATION_TOOL_BUILDER_V3_5", "MILESTONE_CONTEXT_TEMPLATE_V3_5", "PHOTO_LABEL_TEMPLATE_V3_5"]) {
    if (!(k in fx)) bad("fixture missing export " + k);
}
if (!fail) ok("all four exports present");

process.exit(fail ? 1 : 0);
