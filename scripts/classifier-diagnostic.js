#!/usr/bin/env node
// Runs the SME-validated + guardrail project-name test corpus through the LIVE
// classifier system prompt and tool schema imported from functions/src/lib/classifier-prompt
// and the LIVE decideClassification gate imported from functions/src/lib/classification.
// Cannot drift from the deployed Cloud Function because both share the same source.
//
// Usage:
//   ANTHROPIC_API_KEY=sk-ant-... node scripts/classifier-diagnostic.js               (bash / zsh, full run)
//   ANTHROPIC_API_KEY=sk-ant-... node scripts/classifier-diagnostic.js --debug        (single-call debug)
//   $env:ANTHROPIC_API_KEY="sk-ant-..."; node scripts/classifier-diagnostic.js         (PowerShell, full)
//   $env:ANTHROPIC_API_KEY="sk-ant-..."; node scripts/classifier-diagnostic.js --debug (PowerShell, debug)
//
// --debug: runs one classifier call against "Construction of 4-storey 20 classrooms school building",
//   dumps the raw Anthropic response as JSON, prints tool_use.input, prints decideClassification result,
//   and exits. No table, no totals. Fast path for diagnosing plumbing before burning 35 calls.
//
// Does not touch Firestore. Does not require Firebase auth. Errors are tracked
// as a THIRD bucket separate from rejections — a run with ANY errored row is a
// harness failure, not a calibration signal. Aborts early if >50% error rate.

const path = require("path");
const fs = require("fs");

const ANTHROPIC_SDK_PATH = path.join(
    __dirname,
    "..",
    "functions",
    "node_modules",
    "@anthropic-ai",
    "sdk",
);

let Anthropic;
let sdkVersion = "unknown";
try {
    Anthropic = require(ANTHROPIC_SDK_PATH).default;
    const pkg = JSON.parse(fs.readFileSync(path.join(ANTHROPIC_SDK_PATH, "package.json"), "utf8"));
    sdkVersion = pkg.version || "unknown";
} catch (err) {
    console.error(
        `Failed to load @anthropic-ai/sdk from ${ANTHROPIC_SDK_PATH}.\n` +
        "Run `npm install` inside the functions/ directory first.\n" +
        `Underlying error: ${err.message}`,
    );
    process.exit(1);
}

const {
    CLASSIFIER_SYSTEM_PROMPT,
    classifyInfrastructureTool,
} = require("../functions/src/lib/classifier-prompt");

const { decideClassification } = require("../functions/src/lib/classification");

const API_KEY = process.env.ANTHROPIC_API_KEY;
if (!API_KEY) {
    console.error("ERROR: ANTHROPIC_API_KEY environment variable is required.");
    process.exit(1);
}

const DEBUG_MODE = process.argv.includes("--debug");
const MODEL = "claude-haiku-4-5-20251001";
// Kept in lockstep with the deployed classifier at
// functions/src/index.js. If either side changes, change both — otherwise
// the diagnostic will see truncation patterns that don't happen in prod
// (or miss them).
const MAX_TOKENS = 2048;
const TEMPERATURE = 0;

// Startup sanity block — always print, so first line of output shows any environmental drift.
console.log("=== Classifier Diagnostic ===");
console.log(`  SDK version:    @anthropic-ai/sdk ${sdkVersion}`);
console.log(`  Model:          ${MODEL}`);
console.log(`  Prompt chars:   ${CLASSIFIER_SYSTEM_PROMPT.length}`);
console.log(`  Tool name:      ${classifyInfrastructureTool.name}`);
console.log(`  Tool required:  ${classifyInfrastructureTool.input_schema?.required?.length ?? "?"} fields`);
console.log(`  API key prefix: ${API_KEY.slice(0, 8)}... (${API_KEY.length} chars)`);
console.log(`  Node:           ${process.version}`);
console.log(`  Mode:           ${DEBUG_MODE ? "DEBUG (single name, raw response dump)" : "FULL (35 names)"}`);
console.log("");

const client = new Anthropic({ apiKey: API_KEY });

const SET_A = [
    "Construction of 4-storey 20 classrooms school building",
    "Road Concreting with Drainage system",
    "Installation of water tank Inclusive of Gal. Pipes",
    "Construction of Perimeter Fence",
    "Construction of Box Type Culvert",
    "Upgrading of Electrical Power System",
    "Renovation of Legislative Building (Improvement enhancement of electrical accent lighting fixtures - luminalies)",
    "Construction of Cebu City Police Office Building",
    "Concreting of Pathways",
    "Construction of water facilities (water system) and Construction of covered walk in.",
    "Construction of DVAIF Building with compound perimeter fence",
    "Construction of Bridge",
    "Proposed Reinforced Concrete Bridge",
    "Renovation of Evacuation Center",
    "Road Concreting with Drainage System",
    "Construction of Evacuation Center",
    "Riprapping of the side of Barangay Hall",
    "Slope Protection",
    "Construction of Portland Cement Pavement",
    "Additional second floor of the multi-purpose gym for conversion into an evacuation center",
];

const SET_B = [
    "Construction of Barangay Health Center",
    "Installation of Solar Street Lighting Along Barangay Road",
    "Improvement of Barangay Basketball Court",
    "Construction of Public Market Stalls",
    "Rehabilitation of Barangay Day Care Center",
    "Construction of Footbridge Across Creek",
    "Desilting and Declogging of Drainage Canal",
    "Construction of Materials Recovery Facility",
    "Repair of Barangay Hall Roofing",
    "Installation of Street Lighting Poles",
    // The MRF composite case that surfaced the empty-components defect on
    // 2026-08-04 (live project NLDiOGd6oCJfjWP9Kbbe). Expected extraction:
    // components: ["building_construction", "perimeter_fence"], isComposite:
    // true. If either is wrong the classifier-empty-components gate below
    // will fire.
    "Barangay Materials Recovery Facility with Composting Shed and Perimeter Fence",
];

const SET_C = [
    "Development of a mobile application for barangay records",
    "Purchase of medical supplies for the health center",
    "Construction of a spaceship landing pad",
    "Hiring of consultants for organizational restructuring",
    "Procurement of office laptops and printers",
];

const STRUCTURED = {
    barangay: "Sambag I",
    sitioStreet: "P. Burgos St.",
    contractor: "ABC Construction Corp.",
    contractAmount: 5_000_000,
    startDate: "2026-08-01",
    endDate: "2026-10-30",
};
const DURATION_DAYS = 90;

// ─── Error helpers ─────────────────────────────────────────────────────────

function summarizeError(err) {
    const name = err?.constructor?.name || err?.name || "Error";
    const status = err?.status ?? err?.statusCode ?? "?";
    return { name, status, message: err?.message || String(err) };
}

function stringifyErrorFull(err) {
    const parts = [];
    parts.push(`Class:    ${err?.constructor?.name || err?.name || "Error"}`);
    parts.push(`Status:   ${err?.status ?? err?.statusCode ?? "(no HTTP status attached to this error object)"}`);
    parts.push(`Code:     ${err?.code ?? "(no code)"}`);
    parts.push(`Message:  ${err?.message || "(no message)"}`);
    if (err?.error !== undefined) {
        let bodyRepr;
        try {
            bodyRepr = JSON.stringify(err.error, null, 2);
        } catch {
            bodyRepr = String(err.error);
        }
        parts.push(`API response body:\n${bodyRepr}`);
    }
    if (err?.headers) {
        const interesting = {};
        for (const key of ["x-request-id", "anthropic-organization-id", "retry-after", "anthropic-ratelimit-requests-remaining"]) {
            if (err.headers[key] != null) interesting[key] = err.headers[key];
        }
        if (Object.keys(interesting).length) {
            parts.push(`Selected headers: ${JSON.stringify(interesting)}`);
        }
    }
    if (err?.stack) parts.push(`Stack:\n${err.stack}`);
    return parts.join("\n");
}

// ─── Table helpers ─────────────────────────────────────────────────────────

function fmtConfidence(c) {
    return typeof c === "number" ? c.toFixed(2) : "?";
}

function padRight(s, n) {
    const str = String(s ?? "");
    return str.length >= n ? str : str + " ".repeat(n - str.length);
}

function verdictLabel(status) {
    if (status === "passed") return "PASS";
    if (status === "rejected") return "FAIL";
    return "ERROR";
}

function fmtComponents(cs) {
    if (!Array.isArray(cs) || cs.length === 0) return "(empty)";
    return cs.join(",");
}

function printTable(label, rows) {
    console.log(`\n--- ${label} table ---`);
    console.log(
        `${padRight("Verdict", 8)}${padRight("Type", 24)}${padRight("Conf", 6)}${padRight("Comp?", 7)}${padRight("Synth", 7)}${padRight("Trunc", 7)}${padRight("OutTok", 8)}${padRight("Components", 40)}Name`,
    );
    console.log("-".repeat(180));
    for (const r of rows) {
        const compLabel = r.isComposite === true ? "yes" : r.isComposite === false ? "no" : "?";
        const synthLabel = r.componentsSynthesized === true ? "YES" : r.componentsSynthesized === false ? "no" : "?";
        const truncLabel = r.stopReason === "max_tokens" ? "YES" : r.stopReason ? "no" : "?";
        const outTokLabel = r.outputTokens != null ? String(r.outputTokens) : "?";
        console.log(
            `${padRight(verdictLabel(r.status), 8)}${padRight(r.projectType, 24)}${padRight(fmtConfidence(r.confidence), 6)}${padRight(compLabel, 7)}${padRight(synthLabel, 7)}${padRight(truncLabel, 7)}${padRight(outTokLabel, 8)}${padRight(fmtComponents(r.components), 40)}${r.name}`,
        );
        if (r.status !== "passed") {
            const reason = String(r.reason || "").replace(/\s+/g, " ").slice(0, 200);
            console.log(`${" ".repeat(67)}reason: ${reason}`);
        }
        if (r.stopReason === "max_tokens") {
            console.log(`${" ".repeat(67)}⚠ TRUNCATED at ${r.outputTokens}/${MAX_TOKENS} tokens — tool_use is partial`);
        }
    }
}

// ─── API call + row classification ─────────────────────────────────────────

async function callAnthropic(name) {
    const userMessage = [
        `Project name: ${name}`,
        "Project description: (HCSD did not provide a description — description is optional)",
        `Barangay (structured dropdown selection): ${STRUCTURED.barangay}`,
        `Sitio / Street (structured form input): ${STRUCTURED.sitioStreet}`,
        `Contractor (structured form input): ${STRUCTURED.contractor}`,
        `Contract amount (structured form input): PHP ${STRUCTURED.contractAmount.toLocaleString("en-PH")}`,
        `Start date: ${STRUCTURED.startDate}`,
        `End date: ${STRUCTURED.endDate}`,
        `Duration: ${DURATION_DAYS} days`,
    ].join("\n");

    return client.messages.create({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        temperature: TEMPERATURE,
        system: CLASSIFIER_SYSTEM_PROMPT,
        tools: [classifyInfrastructureTool],
        tool_choice: { type: "tool", name: "classify_infrastructure_project" },
        messages: [{ role: "user", content: userMessage }],
    });
}

async function classifyOne(name) {
    const response = await callAnthropic(name);
    const stopReason = response.stop_reason || null;
    const outputTokens = response.usage?.output_tokens ?? null;
    const toolUse = response.content.find((b) => b.type === "tool_use");
    if (!toolUse) {
        return {
            status: "rejected",
            reason: "classifier returned no tool_use block",
            projectType: "unknown",
            scopeFit: null,
            confidence: 0,
            rawComponents: null,
            components: null,
            isComposite: null,
            componentsSynthesized: null,
            stopReason,
            outputTokens,
        };
    }
    const raw = toolUse.input;
    const decision = decideClassification(raw, DURATION_DAYS);
    // Both the raw model output and the post-safeguard decision are captured
    // so calibration can distinguish model behavior from safeguard behavior:
    //   - rawComponents is the model's own extraction (may be empty).
    //   - components is what downstream consumers see (post-safeguard).
    //   - componentsSynthesized flags rows where the safeguard fired.
    //   - stopReason surfaces truncation (the round-2 2026-08-04 defect):
    //     "max_tokens" means the tool_use was cut off mid-emission and the
    //     row must fail the regression gate below regardless of whether the
    //     partial fields happened to look valid.
    return {
        status: decision.accepted ? "passed" : "rejected",
        reason: decision.reason || (decision.accepted ? "—" : "(no reason returned)"),
        projectType: raw.projectType || decision.projectType || "unknown",
        scopeFit: raw.scopeFit || null,
        confidence: typeof raw.confidence === "number" ? raw.confidence : 0,
        rawComponents: Array.isArray(raw.components) ? raw.components : [],
        components: Array.isArray(decision.components) ? decision.components : [],
        isComposite: typeof raw.isComposite === "boolean" ? raw.isComposite : null,
        componentsSynthesized: decision.componentsSynthesized === true,
        stopReason,
        outputTokens,
    };
}

// ─── DEBUG mode: one call, raw dump, exit ──────────────────────────────────

if (DEBUG_MODE) {
    (async () => {
        const debugName = SET_A[0];
        console.log("--- DEBUG single-name run ---");
        console.log(`Name: ${debugName}`);
        console.log("");
        try {
            const response = await callAnthropic(debugName);
            console.log("=== RAW API RESPONSE ===");
            try {
                console.log(JSON.stringify(response, null, 2));
            } catch (jsonErr) {
                console.log("(response object not JSON-serializable; falling back to util.inspect)");
                console.log(require("util").inspect(response, { depth: null, colors: false }));
            }
            console.log("");

            const toolUse = response.content?.find((b) => b.type === "tool_use");
            if (!toolUse) {
                console.log("=== NO tool_use BLOCK in response.content ===");
                console.log("This means the model returned text instead of using the tool.");
                console.log("Likely causes: tool schema rejected server-side, model doesn't support tools, or prompt made the model refuse the tool.");
                process.exit(1);
            }

            console.log("=== tool_use.input ===");
            console.log(JSON.stringify(toolUse.input, null, 2));
            console.log("");

            const decision = decideClassification(toolUse.input, DURATION_DAYS);
            console.log("=== decideClassification result ===");
            console.log(JSON.stringify(decision, null, 2));
            console.log("");
            console.log(`Verdict: ${decision.accepted ? "PASS" : "FAIL"}`);
            process.exit(decision.accepted ? 0 : 0);  // exit 0 either way — debug is diagnostic, not a gate
        } catch (err) {
            console.log("=== API CALL THREW ===");
            console.log(stringifyErrorFull(err));
            process.exit(1);
        }
    })();
} else {
    // ─── FULL mode: 35 rows, three sets, totals ────────────────────────────
    (async () => {
        const start = Date.now();
        let firstErrorObject = null;
        let firstErrorName = null;

        function noteError(err, name) {
            if (!firstErrorObject) {
                firstErrorObject = err;
                firstErrorName = name;
            }
        }

        async function runSet(label, names) {
            console.log(`\n=== ${label} (${names.length} names) ===`);
            const rows = [];
            for (let i = 0; i < names.length; i++) {
                const name = names[i];
                const preview = name.length > 70 ? name.slice(0, 67) + "..." : name;
                console.log(`  [${i + 1}/${names.length}] ${preview}`);
                try {
                    const result = await classifyOne(name);
                    rows.push({ name, ...result });
                    console.log(
                        `        → ${verdictLabel(result.status)}  type=${result.projectType}  scope=${result.scopeFit || "?"}  conf=${fmtConfidence(result.confidence)}`,
                    );
                    if (result.status !== "passed") {
                        console.log(`        reason: ${result.reason.slice(0, 240)}`);
                    }
                } catch (err) {
                    const summary = summarizeError(err);
                    rows.push({
                        name,
                        status: "errored",
                        reason: `${summary.name} status=${summary.status}: ${summary.message}`,
                        projectType: "(error)",
                        scopeFit: null,
                        confidence: 0,
                    });
                    console.log(`        → ERROR [${summary.name} status=${summary.status}]: ${summary.message}`);
                    noteError(err, name);
                }

                // Early-abort: after row 3, if >50% have errored, bail with full first-error dump
                const totalSoFar = rows.length;
                const erroredSoFar = rows.filter((r) => r.status === "errored").length;
                if (totalSoFar >= 3 && erroredSoFar > totalSoFar / 2) {
                    console.log("");
                    console.log(`ABORTED early: ${erroredSoFar} of ${totalSoFar} calls errored — more than 50%. Not burning remaining calls.`);
                    console.log("");
                    console.log("=== First error, in full ===");
                    console.log(`Name: ${firstErrorName}`);
                    console.log(stringifyErrorFull(firstErrorObject));
                    process.exit(2);
                }
            }
            return rows;
        }

        const rowsA = await runSet("Set A — SME-validated (all 20 must PASS)", SET_A);
        const rowsB = await runSet("Set B — plausible non-SME (should PASS)", SET_B);
        const rowsC = await runSet("Set C — guardrail (all 5 must REJECT and 0 must ERROR)", SET_C);

        printTable("Set A", rowsA);
        printTable("Set B", rowsB);
        printTable("Set C", rowsC);

        const bucket = (rows) => ({
            passed: rows.filter((r) => r.status === "passed").length,
            rejected: rows.filter((r) => r.status === "rejected").length,
            errored: rows.filter((r) => r.status === "errored").length,
        });
        const bA = bucket(rowsA);
        const bB = bucket(rowsB);
        const bC = bucket(rowsC);

        const secs = ((Date.now() - start) / 1000).toFixed(1);
        console.log(`\n=== Totals (${secs}s) ===`);
        console.log(`  Set A: passed ${bA.passed}, rejected ${bA.rejected}, errored ${bA.errored}   (target: passed ${SET_A.length}, errored 0)`);
        console.log(`  Set B: passed ${bB.passed}, rejected ${bB.rejected}, errored ${bB.errored}   (target: passed ${SET_B.length}, errored 0)`);
        console.log(`  Set C: passed ${bC.passed}, rejected ${bC.rejected}, errored ${bC.errored}   (target: rejected ${SET_C.length}, errored 0)`);

        const totalErrored = bA.errored + bB.errored + bC.errored;
        if (totalErrored > 0) {
            console.log(`\nFAILED — ${totalErrored} row(s) errored. Run cannot be trusted as a calibration signal.`);
            if (firstErrorObject) {
                console.log("\n=== First error, in full ===");
                console.log(`Name: ${firstErrorName}`);
                console.log(stringifyErrorFull(firstErrorObject));
            }
            process.exit(1);
        }

        const regressionOK = bA.passed === SET_A.length && bC.rejected === SET_C.length;
        if (!regressionOK) {
            console.log("\nFAILED — either an SME-validated name was rejected, or a guardrail case was accepted. See failing rows above.");
            process.exit(1);
        }

        // Truncation gate. Independent from the empty-components gate:
        // a row with stop_reason === "max_tokens" fails regardless of
        // what fields happen to have made it in before the cutoff, in ANY
        // set (admitted, rejected, or otherwise). The deployed classifier
        // now throws on truncation; the harness must too, so a truncation
        // never passes silently as a "successful classification" again.
        const truncatedRows = [...rowsA, ...rowsB, ...rowsC].filter((r) => r.stopReason === "max_tokens");
        if (truncatedRows.length > 0) {
            console.log(`\nFAILED — ${truncatedRows.length} row(s) TRUNCATED at max_tokens. The tool_use was cut off mid-emission and any downstream inference is unreliable:`);
            for (const r of truncatedRows) {
                console.log(`  - "${r.name}"  (${r.outputTokens}/${MAX_TOKENS} output tokens)`);
            }
            process.exit(1);
        }

        // Empty-components gate. An admitted project with no model-extracted
        // components leaves both the mobile retrieval scorer and the verifier
        // prompt blind, which is precisely the defect the 2026-08-04 round 1
        // fix targets. Check the RAW model output (not the post-safeguard
        // decision) so the harness measures model behavior, not the
        // safeguard's ability to paper over it. Synthesized rows are still
        // reported below as a soft signal.
        const emptyComponentRows = [...rowsA, ...rowsB].filter(
            (r) => r.status === "passed" && Array.isArray(r.rawComponents) && r.rawComponents.length === 0,
        );
        if (emptyComponentRows.length > 0) {
            console.log(`\nFAILED — ${emptyComponentRows.length} admitted row(s) had EMPTY model-extracted components. The safeguard synthesized a fallback so downstream is fine, but this is a classifier regression that must be investigated:`);
            for (const r of emptyComponentRows) {
                console.log(`  - "${r.name}"  (synthesized → [${(r.components || []).join(",")}])`);
            }
            process.exit(1);
        }

        // Soft signal: synthesized-but-nonempty rows shouldn't happen (the
        // safeguard only fires on empty), but flag if we ever see one.
        const synthesizedRows = [...rowsA, ...rowsB].filter((r) => r.componentsSynthesized === true);
        if (synthesizedRows.length > 0) {
            console.log(`\nNOTE — ${synthesizedRows.length} row(s) triggered the components-synthesis safeguard. This should be zero once the empty-components gate is green.`);
        }

        if (bB.passed < SET_B.length) {
            console.log(`\nWARNING — ${SET_B.length - bB.passed} of Set B rejected. Not a hard failure, but the wider legitimate domain is not fully covered yet.`);
        }

        // Output-token headroom report. Shows how close typical inputs come
        // to the MAX_TOKENS ceiling and how many runs were at or near it.
        // If the max climbs toward MAX_TOKENS, the reason paragraphs are
        // growing and the ceiling may need to move again.
        const allRows = [...rowsA, ...rowsB, ...rowsC];
        const outTokValues = allRows.map((r) => r.outputTokens).filter((n) => typeof n === "number");
        if (outTokValues.length > 0) {
            const maxOut = Math.max(...outTokValues);
            const nearCeiling = outTokValues.filter((n) => n >= MAX_TOKENS - 128).length;
            const maxRow = allRows.find((r) => r.outputTokens === maxOut);
            console.log(`\n--- output_tokens headroom ---`);
            console.log(`  max output_tokens across run: ${maxOut} / ${MAX_TOKENS}   ("${maxRow?.name ?? "?"}")`);
            console.log(`  rows within 128 of ceiling:   ${nearCeiling}`);
        }

        console.log("\nAll regression gates passed.");
        process.exit(0);
    })().catch((err) => {
        console.error("Fatal:", err);
        console.error(stringifyErrorFull(err));
        process.exit(1);
    });
}
