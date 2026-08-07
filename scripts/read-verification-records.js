// Read-only diagnostic: dumps every milestone verificationHistory[] entry
// across all projects, grouped by promptVersion, then answers ONE question:
//
//   Are v3-2026-08 verdicts still citing out-of-scope signals
//   (location correctness, capture date vs. project window)?
//
// This script MAKES NO WRITES. Verify with:
//   grep -E "\.(set|update|add|delete|save)\(" scripts/read-verification-records.js
// Expected: only Map.set / Set.add matches, no Firestore doc/collection calls.
//
// Usage (from repo root):
//   node scripts/read-verification-records.js          # full dump + v3 out-of-scope audit
//   node scripts/read-verification-records.js --diag   # focused diagnostic for off-by-one
//                                                      # photo_index investigation:
//                                                      #   (a) prints the "Doors, Windows,
//                                                      #       and Joinery" 2026-08-05
//                                                      #       11:47 AM PHT record in full,
//                                                      #       with the milestone's proofs[]
//                                                      #   (b) counts records where any
//                                                      #       photo_index is outside
//                                                      #       [0, photosVerified-1], grouped
//                                                      #       by promptVersion
//                                                      #   (c) audits milestone descriptions
//                                                      #       for mechanical-function
//                                                      #       phrasing that no photograph
//                                                      #       can verify
//
// Requires ./serviceAccountKey.json (same file the existing scripts use).
// No Anthropic key, no Cloud Function invocations, no Storage reads —
// Firestore reads only.
//
// -----------------------------------------------------------------------------
// firebase-admin resolution fix
// -----------------------------------------------------------------------------
// The existing scripts in this directory do `require("firebase-admin")` which
// fails with "Cannot find module 'firebase-admin'" because Node's resolver
// walks up from scripts/ and never finds a node_modules that carries it —
// the root package.json declares the dep but has no installed node_modules,
// and firebase-admin actually lives at functions/node_modules/firebase-admin.
//
// Fix: resolve the absolute path to the dep under functions/node_modules and
// require that. This same one-line change should be applied to
// scripts/count-empty-components-projects.js (and any other script in this
// directory that hits the same failure).

const path = require("path");
const admin = require(path.resolve(__dirname, "..", "functions", "node_modules", "firebase-admin"));
const serviceAccount = require("../serviceAccountKey.json");

admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

const MANILA = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hour12: false,
});

function fmtManila(ts) {
    if (!ts) return "(no runAt)";
    const d = typeof ts.toDate === "function" ? ts.toDate() : new Date(ts);
    if (Number.isNaN(d.getTime())) return "(invalid runAt)";
    return `${MANILA.format(d)} Asia/Manila`;
}

// Tokens that indicate the verdict is citing an out-of-scope signal
// (location correctness or capture date vs. project window). Matched
// case-insensitively as whole-ish substrings — no word boundary because
// "coordinates," "coordinate," "coord" all count.
const OUT_OF_SCOPE_TOKENS = [
    "location",
    "barangay",
    "coordinates",
    "coordinate",
    "gps",
    "mandaue",
    "umapad",
    "adlaon",
    "capture date",
    "project window",
    "before the project",
];

function findOutOfScopeHits(text) {
    if (typeof text !== "string" || text.length === 0) return [];
    const lower = text.toLowerCase();
    const hits = [];
    for (const tok of OUT_OF_SCOPE_TOKENS) {
        let searchFrom = 0;
        while (true) {
            const idx = lower.indexOf(tok, searchFrom);
            if (idx === -1) break;
            // Extract the surrounding sentence: walk back to prior . ! ? or
            // start; walk forward to next . ! ? or end.
            const sentenceStart = (() => {
                let i = idx;
                while (i > 0 && !".!?".includes(text[i - 1])) i--;
                return i;
            })();
            const sentenceEnd = (() => {
                let i = idx + tok.length;
                while (i < text.length && !".!?".includes(text[i])) i++;
                return Math.min(text.length, i + 1);
            })();
            hits.push({
                token: tok,
                sentence: text.slice(sentenceStart, sentenceEnd).trim(),
            });
            searchFrom = idx + tok.length;
        }
    }
    return hits;
}

function pctStr(num, denom) {
    if (!denom) return "0.0%";
    return `${((num / denom) * 100).toFixed(1)}%`;
}

const DIAG = process.argv.includes("--diag");

(async () => {
    console.log(`=== Verification records report (read-only${DIAG ? " · --diag mode" : ""}) ===\n`);

    const projSnap = await db.collection("projects").get();
    console.log(`Scanned ${projSnap.size} projects.\n`);

    // Every record with its context, held in memory so we can group + summarize.
    // For a small LGU tenant this is fine; if this ever balloons, switch to
    // streaming and drop the record list.
    const records = [];
    // For --diag we also need the full milestone document (proofs[] + description)
    // per record; keyed by `${projectId}/${milestoneId}` and populated once per
    // milestone read.
    const milestoneCache = new Map();
    // For --diag description audit: every non-null milestone description we
    // encounter, keyed by (projectId, milestoneId), captured once.
    const allMilestoneDescriptions = [];

    for (const projDoc of projSnap.docs) {
        const project = projDoc.data();
        const projectId = projDoc.id;

        const msSnap = await projDoc.ref.collection("milestones").get();
        for (const msDoc of msSnap.docs) {
            const ms = msDoc.data();
            const msKey = `${projectId}/${msDoc.id}`;
            milestoneCache.set(msKey, ms);

            if (typeof ms.description === "string" && ms.description.length > 0) {
                allMilestoneDescriptions.push({
                    projectId,
                    projectName: project.projectName || "(unnamed)",
                    milestoneId: msDoc.id,
                    milestoneTitle: ms.title || "(untitled)",
                    milestoneSequence: ms.sequence ?? null,
                    description: ms.description,
                });
            }

            const history = Array.isArray(ms.verificationHistory) ? ms.verificationHistory : [];
            if (history.length === 0) continue;

            for (const entry of history) {
                records.push({
                    projectId,
                    projectName: project.projectName || "(unnamed)",
                    milestoneId: msDoc.id,
                    milestoneTitle: ms.title || "(untitled)",
                    milestoneSequence: ms.sequence ?? null,
                    entry,
                });
            }
        }
    }

    console.log(`Found ${records.length} verificationHistory entries total.\n`);

    if (records.length === 0) {
        console.log("No records to inspect. Exiting.");
        process.exit(0);
    }

    // ============================================================================
    // --diag mode: focused diagnostic for the off-by-one photo_index defect
    // ============================================================================
    if (DIAG) {
        // ----- (a) The specific "Doors, Windows, and Joinery" record -----
        console.log("\n" + "=".repeat(78));
        console.log('DIAG (a) — "Doors, Windows, and Joinery" record on 2026-08-05');
        console.log("=".repeat(78));

        const dwjMatches = records.filter((r) => {
            if (!/doors.*windows.*joinery/i.test(r.milestoneTitle || "")) return false;
            const d = r.entry?.runAt?.toDate?.();
            if (!d) return false;
            // Loose date filter: 2026-08-05 in Asia/Manila. Compare the formatted
            // date part only so the local vs UTC boundary doesn't matter.
            const dateStr = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
            return dateStr === "2026-08-05";
        });

        if (dwjMatches.length === 0) {
            console.log("No matching record found for milestoneTitle ~ /doors.*windows.*joinery/i on 2026-08-05.");
        } else {
            for (const r of dwjMatches) {
                const e = r.entry;
                const ms = milestoneCache.get(`${r.projectId}/${r.milestoneId}`) || {};
                const proofs = Array.isArray(ms.proofs) ? ms.proofs : [];
                console.log("");
                console.log(`--- project ${r.projectId} · milestone ${r.milestoneId} ---`);
                console.log(`    projectName:      "${r.projectName}"`);
                console.log(`    milestoneTitle:   "${r.milestoneTitle}"`);
                console.log(`    milestoneSequence: ${r.milestoneSequence}`);
                console.log(`    milestone.description:`);
                for (const line of (ms.description || "(none)").split(/\r?\n/)) console.log(`      ${line}`);
                console.log(`    runAt:            ${fmtManila(e.runAt)}`);
                console.log(`    promptVersion:    ${e.promptVersion ?? "(none)"}`);
                console.log(`    contextComplete:  ${e.contextComplete}`);
                console.log(`    truncated:        ${Object.prototype.hasOwnProperty.call(e, "truncated") ? e.truncated : "(not set)"}`);
                console.log(`    photosVerified:   ${e.photosVerified}`);
                console.log(`    overallVerdict:   ${e.overallVerdict}`);
                console.log(`    overallReasoning:`);
                for (const line of (e.overallReasoning || "").split(/\r?\n/)) console.log(`      ${line}`);
                console.log(`    proofKeys:        ${JSON.stringify(e.proofKeys)}`);
                console.log(`    perPhotoAssessments (${Array.isArray(e.perPhotoAssessments) ? e.perPhotoAssessments.length : 0}):`);
                const pa = Array.isArray(e.perPhotoAssessments) ? e.perPhotoAssessments : [];
                for (const p of pa) {
                    const conf = typeof p.confidence === "number" ? p.confidence.toFixed(2) : "n/a";
                    console.log(`      · photo_index=${p.photo_index}  verdict=${p.verdict}  confidence=${conf}  proofId=${p.proofId === undefined ? "(field absent)" : JSON.stringify(p.proofId)}`);
                    console.log(`          reasoning: ${p.reasoning}`);
                    if (Array.isArray(p.visible_elements)) {
                        console.log(`          visible_elements: ${JSON.stringify(p.visible_elements)}`);
                    }
                }
                console.log(`    milestone.proofs.length: ${proofs.length}`);
                for (let i = 0; i < proofs.length; i++) {
                    const pr = proofs[i];
                    const capturedAt = pr?.capturedAt?.toDate?.().toISOString?.() || pr?.timestamp || null;
                    console.log(`      · proofs[${i}]  id=${JSON.stringify(pr?.id)}  fileName=${JSON.stringify(pr?.fileName)}  capturedAt=${capturedAt}  url=${pr?.url ? "(present)" : "(missing)"}`);
                }
            }
        }

        // ----- (b) Systemic vs one-off audit -----
        console.log("\n" + "=".repeat(78));
        console.log("DIAG (b) — records with any photo_index outside [0, photosVerified-1]");
        console.log("=".repeat(78));

        const byVersion = new Map(); // promptVersion -> { total, bad, badExamples[] }
        for (const r of records) {
            const e = r.entry;
            const key = e.promptVersion || "(none)";
            if (!byVersion.has(key)) byVersion.set(key, { total: 0, bad: 0, badExamples: [] });
            const bucket = byVersion.get(key);
            bucket.total++;

            const photosVerified = typeof e.photosVerified === "number" ? e.photosVerified : null;
            const pa = Array.isArray(e.perPhotoAssessments) ? e.perPhotoAssessments : [];
            const badIndices = [];
            for (const p of pa) {
                if (!Number.isInteger(p.photo_index)) continue;
                if (photosVerified == null) continue;
                if (p.photo_index < 0 || p.photo_index >= photosVerified) {
                    badIndices.push(p.photo_index);
                }
            }
            if (badIndices.length > 0) {
                bucket.bad++;
                bucket.badExamples.push({
                    projectId: r.projectId,
                    milestoneId: r.milestoneId,
                    milestoneTitle: r.milestoneTitle,
                    photosVerified,
                    badIndices,
                    runAt: fmtManila(e.runAt),
                });
            }
        }

        const versionOrder = Array.from(byVersion.keys()).sort();
        for (const v of versionOrder) {
            const b = byVersion.get(v);
            console.log(`\n${v}   ${b.bad} of ${b.total} records have out-of-range photo_index  (${pctStr(b.bad, b.total)})`);
            for (const ex of b.badExamples) {
                console.log(`  - ${ex.projectId}/${ex.milestoneId}  "${ex.milestoneTitle}"  photosVerified=${ex.photosVerified}  bad photo_index=${JSON.stringify(ex.badIndices)}  runAt=${ex.runAt}`);
            }
        }

        // ----- (c) Milestone description mechanical-function pattern audit -----
        console.log("\n" + "=".repeat(78));
        console.log("DIAG (c) — milestone descriptions asking the verifier to assess");
        console.log("mechanical function (which no still photograph can prove)");
        console.log("=".repeat(78));

        const MECH_TOKENS = [
            "swing freely",
            "swings freely",
            "operate smoothly",
            "operates smoothly",
            "operating smoothly",
            "works properly",
            "work properly",
            "functions properly",
            "functional",
            "seals properly",
            "seals tightly",
            "seal",         // catches "doors ... seal"
            "watertight",
            "water-tight",
            "leak-free",
            "leak free",
            "no leaks",
            "energized",
            "powers on",
            "turns on",
            "activates",
            "flushes",
            "flow rate",
            "pressure test",
        ];

        const matched = [];
        for (const m of allMilestoneDescriptions) {
            const lower = m.description.toLowerCase();
            const hits = MECH_TOKENS.filter((t) => lower.includes(t));
            if (hits.length > 0) {
                matched.push({ ...m, hits });
            }
        }

        console.log(`\nMilestones scanned:                ${allMilestoneDescriptions.length}`);
        console.log(`With mechanical-function phrasing: ${matched.length}   (${pctStr(matched.length, allMilestoneDescriptions.length)})`);

        if (matched.length > 0) {
            console.log("\n--- Matches ---");
            for (const m of matched) {
                console.log(`\nproject ${m.projectId} · milestone ${m.milestoneId} · Phase ${m.milestoneSequence ?? "?"} — "${m.milestoneTitle}"`);
                console.log(`  tokens: ${JSON.stringify(m.hits)}`);
                console.log(`  description:`);
                for (const line of m.description.split(/\r?\n/)) console.log(`    ${line}`);
            }
        }

        console.log("\nNo writes performed.");
        process.exit(0);
    }
    // ============================================================================
    // Fall-through: default full-dump mode (unchanged from prior versions)
    // ============================================================================

    // ----- Group by promptVersion -----
    const groups = new Map(); // promptVersion -> records[]
    for (const r of records) {
        const key = r.entry.promptVersion || "(none)";
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(r);
    }

    // Stable order: (none), v1*, v2*, v3*, then anything else alphabetical.
    const groupOrder = Array.from(groups.keys()).sort((a, b) => {
        const rank = (k) => k === "(none)" ? 0 : (k.startsWith("v1") ? 1 : (k.startsWith("v2") ? 2 : (k.startsWith("v3") ? 3 : 4)));
        const ra = rank(a);
        const rb = rank(b);
        if (ra !== rb) return ra - rb;
        return a.localeCompare(b);
    });

    // ----- Full dump, grouped -----
    for (const gk of groupOrder) {
        const bucket = groups.get(gk);
        console.log("\n" + "=".repeat(78));
        console.log(`promptVersion: ${gk}   (${bucket.length} entries)`);
        console.log("=".repeat(78));

        for (const r of bucket) {
            const e = r.entry;
            console.log("");
            console.log(`--- project ${r.projectId} · milestone ${r.milestoneId}${r.milestoneSequence != null ? ` (Phase ${r.milestoneSequence})` : ""} ---`);
            console.log(`    project:   "${r.projectName}"`);
            console.log(`    milestone: "${r.milestoneTitle}"`);
            console.log(`    runAt:     ${fmtManila(e.runAt)}`);
            if (Object.prototype.hasOwnProperty.call(e, "contextComplete")) {
                console.log(`    contextComplete: ${e.contextComplete}`);
            }
            if (Object.prototype.hasOwnProperty.call(e, "truncated")) {
                console.log(`    truncated: ${e.truncated}`);
            }
            console.log(`    overallVerdict:  ${e.overallVerdict ?? "(missing)"}`);
            console.log(`    overallReasoning:`);
            const reasoning = typeof e.overallReasoning === "string" ? e.overallReasoning : "(missing)";
            for (const line of reasoning.split(/\r?\n/)) {
                console.log(`      ${line}`);
            }
            const pa = Array.isArray(e.perPhotoAssessments) ? e.perPhotoAssessments : [];
            console.log(`    perPhotoAssessments: ${pa.length} entr${pa.length === 1 ? "y" : "ies"}`);
            for (const p of pa) {
                const conf = typeof p.confidence === "number" ? p.confidence.toFixed(2) : "n/a";
                console.log(`      · photo_index=${p.photo_index}  verdict=${p.verdict}  confidence=${conf}`);
                const pr = typeof p.reasoning === "string" ? p.reasoning : "(missing)";
                for (const line of pr.split(/\r?\n/)) {
                    console.log(`          ${line}`);
                }
                if (Array.isArray(p.visible_elements) && p.visible_elements.length > 0) {
                    console.log(`          visible_elements: ${JSON.stringify(p.visible_elements)}`);
                }
            }
        }
    }

    // ----- Summary: verdict distribution per promptVersion -----
    console.log("\n" + "=".repeat(78));
    console.log("SUMMARY — verdict distribution per promptVersion");
    console.log("=".repeat(78));
    for (const gk of groupOrder) {
        const bucket = groups.get(gk);
        const counts = new Map();
        for (const r of bucket) {
            const v = r.entry.overallVerdict || "(missing)";
            counts.set(v, (counts.get(v) || 0) + 1);
        }
        console.log(`\n${gk}   (n=${bucket.length})`);
        const verdicts = Array.from(counts.keys()).sort();
        for (const v of verdicts) {
            const n = counts.get(v);
            console.log(`  ${v.padEnd(22)} ${String(n).padStart(4)}   ${pctStr(n, bucket.length)}`);
        }
    }

    // ----- Summary: v3 out-of-scope citation check -----
    console.log("\n" + "=".repeat(78));
    console.log("SUMMARY — v3-2026-08 records citing OUT-OF-SCOPE signals");
    console.log("(location correctness / capture date vs. project window)");
    console.log("=".repeat(78));

    const v3Bucket = groups.get("v3-2026-08") || [];
    console.log(`\nSearched tokens (case-insensitive): ${OUT_OF_SCOPE_TOKENS.map(t => JSON.stringify(t)).join(", ")}`);
    console.log(`v3-2026-08 record count: ${v3Bucket.length}`);

    if (v3Bucket.length === 0) {
        console.log("\nNo v3-2026-08 records to inspect.");
    } else {
        let citing = 0;
        const detailed = [];
        for (const r of v3Bucket) {
            const e = r.entry;
            const allHits = [];

            const overallHits = findOutOfScopeHits(e.overallReasoning);
            for (const h of overallHits) allHits.push({ where: "overallReasoning", ...h });

            const pa = Array.isArray(e.perPhotoAssessments) ? e.perPhotoAssessments : [];
            for (const p of pa) {
                const pHits = findOutOfScopeHits(p.reasoning);
                for (const h of pHits) allHits.push({ where: `perPhoto[${p.photo_index}]`, ...h });
            }

            if (allHits.length > 0) {
                citing++;
                detailed.push({ r, hits: allHits });
            }
        }

        console.log(`v3-2026-08 records that cite at least one out-of-scope token: ${citing}   (${pctStr(citing, v3Bucket.length)})`);

        if (detailed.length > 0) {
            console.log("\n--- Matches ---");
            for (const { r, hits } of detailed) {
                console.log(`\nproject ${r.projectId} · milestone ${r.milestoneId} · runAt ${fmtManila(r.entry.runAt)}`);
                console.log(`  verdict: ${r.entry.overallVerdict}`);
                for (const h of hits) {
                    console.log(`  [${h.where}] token=${JSON.stringify(h.token)}`);
                    console.log(`    sentence: ${h.sentence}`);
                }
            }
        }
    }

    console.log("\nNo writes performed.");
    process.exit(0);
})().catch((err) => {
    console.error("Fatal:", err);
    process.exit(1);
});
