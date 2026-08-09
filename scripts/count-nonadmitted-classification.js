// Read-only report: counts projects whose stored classification.admitted is
// false. Surfaces the population that the 2026-08-09 client-forwarding fix
// (CreateProject.jsx forwarding admitted + the other v1 contract fields) does
// NOT retroactively repair — existing records were persisted with admitted
// re-derived from the legacy 0.8 confidence floor because the client never
// sent the admitted field.
//
// This script MAKES NO WRITES. It only reads the projects collection.
// Verify with:  grep -E "\.(set|update|add|delete)\(" scripts/count-nonadmitted-classification.js
// Expected output of that grep: no matches.
//
// Usage:
//   node scripts/count-nonadmitted-classification.js
//
// Requires ./serviceAccountKey.json (same file the existing scan/backfill
// scripts use). No Anthropic key, no Cloud Function invocations, no external
// network calls beyond Firestore reads.

const admin = require(require("path").join(__dirname, "..", "functions", "node_modules", "firebase-admin"));
const serviceAccount = require("../serviceAccountKey.json");

admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

(async () => {
    const snap = await db.collection("projects").get();

    const affected = [];
    let missingClassification = 0;
    let admittedTrueTotal = 0;
    let admittedFalseTotal = 0;
    let admittedMissingTotal = 0;

    for (const doc of snap.docs) {
        const p = doc.data();
        const cls = p.classification;

        if (!cls) {
            missingClassification++;
            continue;
        }

        // Three states: admitted true, admitted false, admitted field absent
        // (pre-v1 records where the field was never persisted). The affected
        // population is the second — those are records the mobile app refuses
        // AND that can be repaired by recomputing admission from stored
        // recognition fields, without re-invoking the classifier.
        if (cls.admitted === true) {
            admittedTrueTotal++;
            continue;
        }
        if (cls.admitted !== false) {
            admittedMissingTotal++;
            continue;
        }

        admittedFalseTotal++;
        affected.push({
            id: doc.id,
            projectName: p.projectName || "(unnamed)",
            tenantId: p.tenantId || "(no tenant)",
            projectType: cls.projectType || "?",
            confidence: cls.confidence ?? null,
            classifierPromptVersion: cls.classifierPromptVersion || "(pre-v1.1)",
            createdAt: p.createdAt?.toDate?.().toISOString?.() || null,
            hasVerdict: !!cls.verdict,
        });
    }

    console.log("=== Non-admitted classification audit (read-only) ===");
    console.log(`Total projects scanned:               ${snap.size}`);
    console.log(`Missing classification map entirely:  ${missingClassification}`);
    console.log(`classification.admitted === true:     ${admittedTrueTotal}`);
    console.log(`classification.admitted === false:    ${admittedFalseTotal}   ← population needing recovery`);
    console.log(`classification.admitted absent:       ${admittedMissingTotal}   (pre-v1 records; not the target of this scan)`);

    if (affected.length > 0) {
        console.log("\n--- Affected projects (id · type · conf · promptVersion · createdAt · name) ---");
        for (const r of affected) {
            console.log(
                `  ${r.id}  ${r.projectType.padEnd(24)}  ${String(r.confidence ?? "?").padEnd(5)}  ${r.classifierPromptVersion.padEnd(18)}  ${r.createdAt || "(no createdAt)"}  "${r.projectName}"`,
            );
        }
    }

    console.log("\nNo writes performed.");
    process.exit(0);
})().catch((err) => {
    console.error("Fatal:", err);
    process.exit(1);
});
