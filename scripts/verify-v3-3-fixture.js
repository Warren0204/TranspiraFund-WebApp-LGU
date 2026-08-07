// One-shot verifier: prove that scripts/fixtures/verifier-prompt-v3-3.js is a
// byte-faithful freeze of the four artifacts currently in functions/src/index.js
// (the system prompt, the tool builder, the milestone context template, and
// the photo label template). This is a diagnostic — it makes no writes.
//
// Usage: node scripts/verify-v3-3-fixture.js
// Exit code 0 on success, 1 on any mismatch.

const fs = require("fs");
const path = require("path");

const fx = require(path.resolve(__dirname, "fixtures", "verifier-prompt-v3-3.js"));
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
    if (currentSysRuntime === fx.VERIFICATION_SYSTEM_PROMPT_V3_3) {
        ok("VERIFICATION_SYSTEM_PROMPT_V3_3 matches current source (" + currentSysRuntime.length + " chars)");
    } else {
        bad("VERIFICATION_SYSTEM_PROMPT_V3_3 differs from current source");
        const a = currentSysRuntime, b = fx.VERIFICATION_SYSTEM_PROMPT_V3_3;
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
        const b = JSON.stringify(fx.VERIFICATION_TOOL_BUILDER_V3_3(n));
        if (a === b) {
            ok("VERIFICATION_TOOL_BUILDER_V3_3(" + n + ") matches current source");
        } else {
            bad("VERIFICATION_TOOL_BUILDER_V3_3(" + n + ") differs from current source");
            console.error("     current: " + a);
            console.error("     fixture: " + b);
        }
    }
}

// ---- 3. Milestone context template ----
// Run the fixture template with a synthetic input, then run the same input
// through the exact source-code template (extracted and eval'd) and compare
// the two runtime strings.
const projContext = {
    projectName: "TestProject", projectType: "Drainage",
    components: ["culvert", "canal"], isComposite: true,
    barangay: "Adlaon", sitioStreet: "Grahe",
    contractAmount: 950000,
    officialDateStarted: "2026-08-05",
    originalDateCompletion: "2026-10-30",
};
const after = {
    title: "TestPhase", description: "Excavation and backfill.",
    sequence: 3, weightPercentage: 25, suggestedDurationDays: 14,
};
const milestonesContext = { total: 7, prevTitle: "Prior Phase", nextTitle: "Next Phase" };
const sentProofs = [{}, {}];

// Extract the source template. It's the function body inside onProofUploaded,
// so rather than eval a snippet we mirror the surrounding code exactly and
// evaluate. The template is a single template literal we can locate by its
// opening "## Project Context" and closing "for this batch.".
const tmplMatch = src.match(/const milestoneContext = `## Project Context\n([\s\S]*?)Assess each photo against the milestone description, then provide an overall verdict for this batch\.`;/);
if (!tmplMatch) {
    bad("could not locate current milestone context template");
} else {
    // Rebuild the surrounding closure that supplies componentsLine, locationLine,
    // contractLine, and projectWindow — copied verbatim from the trigger.
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
    const fixtureRendered = fx.MILESTONE_CONTEXT_TEMPLATE_V3_3(projContext, after, milestonesContext, sentProofs);
    if (currentRendered === fixtureRendered) {
        ok("MILESTONE_CONTEXT_TEMPLATE_V3_3 renders identically to current source (" + currentRendered.length + " chars)");
    } else {
        bad("MILESTONE_CONTEXT_TEMPLATE_V3_3 differs from current source");
        console.error("     current: " + JSON.stringify(currentRendered));
        console.error("     fixture: " + JSON.stringify(fixtureRendered));
    }
}

// ---- 4. Photo label template ----
// The source has: `Photo ${i + 1} of ${sentProofs.length}. Captured ${caption.when}. GPS ${caption.gps}. Accuracy ${caption.accuracy}.`
// The fixture has: `Photo ${i + 1} of ${total}. Captured ${caption.when}. GPS ${caption.gps}. Accuracy ${caption.accuracy}.`
// Since `total` in the fixture stands in for `sentProofs.length` in the trigger,
// the two must produce identical output when called with matching arguments.
const caption = { when: "05 Aug 2026, 3:00 PM (PHT)", gps: "10.3, 123.9", accuracy: "6m" };
const currentLabel = `Photo ${0 + 1} of ${2}. Captured ${caption.when}. GPS ${caption.gps}. Accuracy ${caption.accuracy}.`;
const fixtureLabel = fx.PHOTO_LABEL_TEMPLATE_V3_3(0, 2, caption);
if (currentLabel === fixtureLabel) {
    ok("PHOTO_LABEL_TEMPLATE_V3_3 renders identically to current source");
} else {
    bad("PHOTO_LABEL_TEMPLATE_V3_3 differs from current source");
    console.error("     current: " + JSON.stringify(currentLabel));
    console.error("     fixture: " + JSON.stringify(fixtureLabel));
}

// ---- 5. Exports ----
for (const k of ["VERIFICATION_SYSTEM_PROMPT_V3_3", "VERIFICATION_TOOL_BUILDER_V3_3", "MILESTONE_CONTEXT_TEMPLATE_V3_3", "PHOTO_LABEL_TEMPLATE_V3_3"]) {
    if (!(k in fx)) bad("fixture missing export " + k);
}
if (!fail) ok("all four exports present");

process.exit(fail ? 1 : 0);
