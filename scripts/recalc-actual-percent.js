const admin = require('firebase-admin');
const serviceAccount = require('../serviceAccountKey.json');

admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });

const db = admin.firestore();
const APPLY = process.argv.includes('--apply');

const DONE_STATUSES = ['done', 'complete', 'completed'];

function computeActualPercent(milestones) {
    const confirmed = milestones.filter((m) => m.confirmed !== false);
    if (confirmed.length === 0) return 0;
    const completed = confirmed.filter((m) => {
        const s = (m.status || '').toLowerCase();
        return DONE_STATUSES.includes(s);
    }).length;
    return Math.round((completed / confirmed.length) * 100);
}

async function main() {
    console.log('=== Recalculate project.actualPercent (count-based) ===');
    console.log(APPLY ? 'Mode: APPLY (writes enabled)\n' : 'Mode: DRY RUN (no writes)\n');

    const projSnap = await db.collection('projects').get();
    console.log(`Scanning ${projSnap.size} project(s)...\n`);

    const updates = [];
    let unchanged = 0;

    for (const doc of projSnap.docs) {
        const data = doc.data();
        const oldPercent = Number(data.actualPercent) || 0;

        const msSnap = await doc.ref.collection('milestones').get();
        const milestones = msSnap.docs.map((d) => d.data());
        const newPercent = computeActualPercent(milestones);

        if (newPercent === oldPercent) {
            unchanged++;
            continue;
        }

        updates.push({
            projectId: doc.id,
            projectName: data.projectName || '(unnamed)',
            oldPercent,
            newPercent,
            milestoneCount: milestones.length,
        });
    }

    console.log(`  Unchanged:    ${unchanged}`);
    console.log(`  Will update:  ${updates.length}\n`);

    if (updates.length) {
        console.log('--- Projects to update ---');
        updates.forEach((u) => {
            console.log(`  [${u.projectId}] "${u.projectName}" | ${u.oldPercent}% → ${u.newPercent}% (${u.milestoneCount} milestone(s))`);
        });
        console.log('');
    }

    if (!APPLY) {
        console.log('Dry run complete. Re-run with --apply to commit changes.');
        process.exit(0);
    }

    if (updates.length === 0) {
        console.log('Nothing to write.');
        process.exit(0);
    }

    const chunks = [];
    for (let i = 0; i < updates.length; i += 400) chunks.push(updates.slice(i, i + 400));

    let written = 0;
    for (const chunk of chunks) {
        const batch = db.batch();
        chunk.forEach((u) => {
            batch.update(db.collection('projects').doc(u.projectId), { actualPercent: u.newPercent });
        });
        await batch.commit();
        written += chunk.length;
    }

    console.log(`\n✓ Updated ${written} project document(s).`);
    process.exit(0);
}

main().catch((err) => {
    console.error('\n✗ Recalculation failed:', err.message);
    process.exit(1);
});
