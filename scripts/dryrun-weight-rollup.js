// Read-only dry run of the new weight-based rollup formula. Compares the
// value that would be persisted by the trigger against the stored
// actualPercent on every project. Zero writes.
//
// Compare the printed table against the recon: only 4jTZftmuWgX5l8S3qGP4
// should show a delta (89 -> 92). Any other movement means the code is
// wrong and we do not deploy.
//
//   NODE_PATH=./functions/node_modules node scripts/dryrun-weight-rollup.js
//
// (firebase-admin is installed under functions/, not the repo root; the
// NODE_PATH prefix is how every scripts/*.js in this repo picks it up.)
//
// Relies on the pure module in functions/src/lib/milestone-rollup.js so
// the number it prints is byte-identical to what the trigger would
// write.

const path = require("path");
const admin = require("firebase-admin");
const serviceAccount = require("../serviceAccountKey.json");
const {
    computeActualPercent,
    decideStatusUpdate,
} = require(path.join(__dirname, "..", "functions", "src", "lib", "milestone-rollup"));

admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

const pad = (v, w) => String(v).padEnd(w);
const padR = (v, w) => String(v).padStart(w);

async function main() {
    const projSnap = await db.collection("projects").get();
    console.log(`Scanning ${projSnap.size} project(s). Read-only.\n`);

    const rows = [];
    for (const doc of projSnap.docs) {
        const data = doc.data();
        const msSnap = await doc.ref.collection("milestones").get();
        const milestones = msSnap.docs.map((d) => d.data());
        const { actualPercent, method, skipped } = computeActualPercent(milestones);
        const stored = Number(data.actualPercent) || 0;
        const delta = actualPercent - stored;
        const statusDecision = decideStatusUpdate({
            actualPercent,
            currentStatus: data.status,
            currentActualDateCompleted: data.actualDateCompleted,
            today: new Date().toISOString().split("T")[0],
        });
        rows.push({
            id: doc.id,
            name: data.projectName || "(unnamed)",
            stored,
            newPct: actualPercent,
            delta,
            method,
            skipped,
            status: data.status || "(empty)",
            statusChange: statusDecision
                ? `${data.status || "(none)"} -> ${statusDecision.status}`
                : "",
        });
    }

    console.log(
        pad("projectId", 22) +
        pad("name", 52) +
        padR("stored", 7) +
        padR("new", 6) +
        padR("delta", 7) +
        pad("  method", 18) +
        padR("skip", 5) +
        pad("  status", 13) +
        "  statusChange"
    );
    console.log("-".repeat(140));
    for (const r of rows) {
        const deltaStr = r.delta === 0 ? "0" : (r.delta > 0 ? `+${r.delta}` : `${r.delta}`);
        console.log(
            pad(r.id, 22) +
            pad(r.name.slice(0, 50), 52) +
            padR(r.stored, 7) +
            padR(r.newPct, 6) +
            padR(deltaStr, 7) +
            pad(`  ${r.method}`, 18) +
            padR(r.skipped, 5) +
            pad(`  ${r.status}`, 13) +
            `  ${r.statusChange}`
        );
    }

    const moved = rows.filter((r) => r.delta !== 0);
    console.log(`\n${moved.length} project(s) would change actualPercent.`);
    if (moved.length) {
        console.log("Movers:");
        for (const r of moved) {
            console.log(`  ${r.id} "${r.name}" : ${r.stored} -> ${r.newPct}${r.statusChange ? `, ${r.statusChange}` : ""}`);
        }
    }
    process.exit(0);
}

main().catch((err) => {
    console.error("Dry run failed:", err);
    process.exit(1);
});
