// Read-only report: counts projects whose stored classification.components is
// empty (or missing) on an admitted project. Surfaces the population that the
// 2026-08-04 classifier fix would need to backfill if you decide to.
//
// This script MAKES NO WRITES. It only reads the projects collection.
// Verify with:  grep -E "\.(set|update|add|delete)\(" scripts/count-empty-components-projects.js
// Expected output of that grep: no matches.
//
// Usage:
//   node scripts/count-empty-components-projects.js
//
// Requires ./serviceAccountKey.json (same file the existing backfill scripts
// use). No Anthropic key, no Cloud Function invocations, no external network
// calls beyond Firestore reads.

const admin = require("firebase-admin");
const serviceAccount = require("../serviceAccountKey.json");

admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

(async () => {
    const snap = await db.collection("projects").get();

    const affected = [];
    let admittedTotal = 0;
    let componentsSynthesizedTotal = 0;
    let contradictionsTotal = 0; // isComposite vs verdict.bundlesMultipleProjects
    let missingClassification = 0;

    for (const doc of snap.docs) {
        const p = doc.data();
        const cls = p.classification;

        if (!cls) {
            missingClassification++;
            continue;
        }

        // Admission signal, prefer explicit v1 admitted flag.
        const isAdmitted = typeof cls.admitted === "boolean"
            ? cls.admitted
            : (cls.projectType && cls.projectType !== "unknown");
        if (!isAdmitted) continue;
        admittedTotal++;

        if (cls.componentsSynthesized === true) componentsSynthesizedTotal++;

        const hasComponents = Array.isArray(cls.components) && cls.components.length > 0;
        if (!hasComponents) {
            affected.push({
                id: doc.id,
                projectName: p.projectName || "(unnamed)",
                tenantId: p.tenantId || "(no tenant)",
                projectType: cls.projectType || "?",
                confidence: cls.confidence ?? null,
                classifierPromptVersion: cls.classifierPromptVersion || "(pre-v1.1)",
                createdAt: p.createdAt?.toDate?.().toISOString?.() || null,
            });
        }

        // Sanity check on the composite mirror: pre-fix rows may show a
        // contradiction because bundlesMultipleProjects was independent
        // model output before 2026-08-04.
        const bmp = cls.verdict?.bundlesMultipleProjects;
        if (typeof cls.isComposite === "boolean" && typeof bmp === "boolean" && cls.isComposite !== bmp) {
            contradictionsTotal++;
        }
    }

    console.log("=== Empty-components audit (read-only) ===");
    console.log(`Total projects scanned:               ${snap.size}`);
    console.log(`Missing classification map entirely:  ${missingClassification}`);
    console.log(`Admitted projects:                    ${admittedTotal}`);
    console.log(`Admitted with EMPTY components:       ${affected.length}`);
    console.log(`Admitted with componentsSynthesized:  ${componentsSynthesizedTotal}   (post-fix rows only; pre-fix rows have this field absent)`);
    console.log(`isComposite vs bundlesMultipleProjects contradictions: ${contradictionsTotal}   (pre-fix rows only; post-fix mirror derives one from the other)`);

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
