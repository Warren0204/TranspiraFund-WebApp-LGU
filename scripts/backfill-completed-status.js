// Backfill project.status = "Completed" for any project where every
// confirmed milestone is done but the persisted status hasn't caught up.
//
// Why this exists: the recomputeProjectActualPercent trigger persists
// status="Completed" on milestone writes when actualPercent hits 100%.
// Projects that hit 100% BEFORE that trigger extension was deployed are
// stale — they show actualPercent=100 but status="Ongoing" (or similar).
// They'll only self-heal on the next milestone write. This script
// reconciles them in one pass.
//
// Run safely: this script defaults to DRY RUN. Pass --apply to commit.
//
//   node scripts/backfill-completed-status.js              # dry run
//   node scripts/backfill-completed-status.js --apply      # commit
//
// Mirrors the dry-run/apply pattern of recalc-actual-percent.js so the
// two scripts compose cleanly: run recalc first to fix any stale
// actualPercent, then run this to reconcile status.

const admin = require('firebase-admin');
const serviceAccount = require('../serviceAccountKey.json');

admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });

const db = admin.firestore();
const APPLY = process.argv.includes('--apply');

const DONE_STATUSES = ['done', 'complete', 'completed'];

// Same computation as the recomputeProjectActualPercent trigger and
// scripts/recalc-actual-percent.js. Kept inline (not imported) so this
// script remains self-contained and runnable without a build step.
function computeActualPercent(milestones) {
    const confirmed = milestones.filter((m) => m.confirmed !== false);
    if (confirmed.length === 0) return 0;
    const completed = confirmed.filter((m) => {
        const s = (m.status || '').toLowerCase();
        return DONE_STATUSES.includes(s);
    }).length;
    return Math.round((completed / confirmed.length) * 100);
}

function todayYmd() {
    return new Date().toISOString().split('T')[0];
}

async function main() {
    console.log('=== Backfill project.status = "Completed" for fully-done projects ===');
    console.log(APPLY ? 'Mode: APPLY (writes enabled)\n' : 'Mode: DRY RUN (no writes)\n');

    const projSnap = await db.collection('projects').get();
    console.log(`Scanning ${projSnap.size} project(s)...\n`);

    const updates = [];
    let alreadyCompleted = 0;
    let notYet = 0;
    let empty = 0;

    for (const doc of projSnap.docs) {
        const data = doc.data();
        const currentStatus = (data.status || '').toLowerCase();

        const msSnap = await doc.ref.collection('milestones').get();
        const milestones = msSnap.docs.map((d) => d.data());

        if (milestones.length === 0) {
            empty++;
            continue;
        }

        const pct = computeActualPercent(milestones);
        if (pct < 100) {
            notYet++;
            continue;
        }

        if (currentStatus === 'completed') {
            alreadyCompleted++;
            continue;
        }

        updates.push({
            projectId: doc.id,
            projectName: data.projectName || '(unnamed)',
            oldStatus: data.status || '(empty)',
            stampActualDate: !data.actualDateCompleted,
            milestoneCount: milestones.length,
        });
    }

    console.log(`  Already Completed:    ${alreadyCompleted}`);
    console.log(`  Not yet at 100%:      ${notYet}`);
    console.log(`  No milestones:        ${empty}`);
    console.log(`  Will reconcile:       ${updates.length}\n`);

    if (updates.length) {
        console.log('--- Projects to reconcile ---');
        updates.forEach((u) => {
            const dateNote = u.stampActualDate ? ' [+ stamp actualDateCompleted]' : '';
            console.log(`  [${u.projectId}] "${u.projectName}" | status "${u.oldStatus}" → "Completed" (${u.milestoneCount} milestone(s))${dateNote}`);
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

    const ymd = todayYmd();
    const chunks = [];
    for (let i = 0; i < updates.length; i += 400) chunks.push(updates.slice(i, i + 400));

    let written = 0;
    for (const chunk of chunks) {
        const batch = db.batch();
        chunk.forEach((u) => {
            const payload = { status: 'Completed' };
            if (u.stampActualDate) payload.actualDateCompleted = ymd;
            batch.update(db.collection('projects').doc(u.projectId), payload);
        });
        await batch.commit();
        written += chunk.length;
    }

    console.log(`\n✓ Reconciled ${written} project document(s).`);
    process.exit(0);
}

main().catch((err) => {
    console.error('\n✗ Backfill failed:', err.message);
    process.exit(1);
});
