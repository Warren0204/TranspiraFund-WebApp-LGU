// One-shot trigger for the slippage scan that the deployed
// detectProjectSlippage scheduled function runs every morning. Use this
// to seed the very first scan immediately after deploying the cron
// (instead of waiting for tomorrow 08:00 Manila), or to verify the
// detection + notification fan-out end-to-end during development.
//
// Mirrors the logic in functions/src/index.js → runSlippageScan().
// Kept in sync by hand: the formula is small and stable, and we
// deliberately don't import functions code into a script so this stays
// runnable without a build step.
//
//   node scripts/trigger-slippage-scan.js            # dry run
//   node scripts/trigger-slippage-scan.js --apply    # commit: persist
//                                                    # status flips and
//                                                    # create notifications
//
// Tenant safety: notifications are created with project.tenantId on
// every doc (same isolation guard as createNotification in functions).

const admin = require('firebase-admin');
const serviceAccount = require('../serviceAccountKey.json');

admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });

const db = admin.firestore();
const APPLY = process.argv.includes('--apply');

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

const computeSlippagePercent = (project, now) => {
    const start = project.officialDateStarted;
    const end = project.originalDateCompletion;
    if (!start || !end) return null;
    const s = new Date(start).getTime();
    const e = new Date(end).getTime();
    if (isNaN(s) || isNaN(e) || e <= s) return null;
    const timeElapsed = clamp(((now - s) / (e - s)) * 100, 0, 100);
    const actual = Number(project.actualPercent) || 0;
    return Math.round((timeElapsed - actual) * 10) / 10;
};

async function createNotification(payload) {
    if (!payload.recipientUid || !payload.tenantId) return;
    await db.collection('notifications').add({
        ...payload,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        isRead: false,
        dismissedAt: null,
    });
}

async function main() {
    console.log('=== Slippage scan (mirrors detectProjectSlippage cron) ===');
    console.log(APPLY ? 'Mode: APPLY (writes enabled)\n' : 'Mode: DRY RUN (no writes)\n');

    const snap = await db.collection('projects').get();
    console.log(`Scanning ${snap.size} project(s)...\n`);

    const now = Date.now();
    const willDetect = [];
    const willRecover = [];
    const stillSlipping = [];

    for (const doc of snap.docs) {
        const p = doc.data();
        const statusLower = (p.status || '').toLowerCase();
        if (statusLower === 'completed') continue;
        if (!p.projectEngineer) continue;

        const slippage = computeSlippagePercent(p, now);
        if (slippage === null) continue;

        const wasSlipping = !!p.slippageDetectedAt;
        const isSlipping = slippage > 0;

        if (isSlipping) {
            const entry = { id: doc.id, name: p.projectName, slippage, createdBy: p.createdBy, pe: p.projectEngineer, tenantId: p.tenantId, oldStatus: p.status, persistedSlip: p.slippagePercent };
            if (wasSlipping) stillSlipping.push(entry); else willDetect.push(entry);
        } else if (wasSlipping) {
            willRecover.push({ id: doc.id, name: p.projectName, hasUnassignReason: !!p.engineerUnassignedAt, hasEng: !!p.projectEngineer });
        }
    }

    console.log(`  Detected (new):   ${willDetect.length}`);
    console.log(`  Recovered:        ${willRecover.length}`);
    console.log(`  Still slipping:   ${stillSlipping.length}\n`);

    if (willDetect.length) {
        console.log('--- Newly Delayed (first detection — "Project is now Delayed" notification) ---');
        willDetect.forEach((u) => {
            console.log(`  [${u.id}] "${u.name}" | status "${u.oldStatus}" → "Delayed" | slippage +${u.slippage}% | tenant ${u.tenantId}`);
        });
        console.log('');
    }
    if (willRecover.length) {
        console.log('--- Recovered (clearing slippage fields; no notification) ---');
        willRecover.forEach((u) => {
            const restored = !u.hasUnassignReason && u.hasEng;
            console.log(`  [${u.id}] "${u.name}"${restored ? ' → status restored to Ongoing' : ' (status NOT restored — other delay reason)'}`);
        });
        console.log('');
    }
    if (stillSlipping.length) {
        console.log('--- Still slipping (daily reminder — "Project still Delayed" notification) ---');
        stillSlipping.forEach((u) => {
            console.log(`  [${u.id}] "${u.name}" | persisted +${u.persistedSlip || 0}% → live +${u.slippage}% | tenant ${u.tenantId}`);
        });
        console.log('');
    }

    if (!APPLY) {
        console.log('Dry run complete. Re-run with --apply to commit changes.');
        process.exit(0);
    }

    if (!willDetect.length && !willRecover.length && !stillSlipping.length) {
        console.log('Nothing to write.');
        process.exit(0);
    }

    let writes = 0;

    const sendSlippingNotification = async (u, isReminder) => {
        const title = isReminder ? 'Project still Delayed' : 'Project is now Delayed';
        const body = `${u.name || 'Project'} is ${u.slippage}% behind schedule.`;
        const baseNotif = {
            action: 'PROJECT_DELAYED',
            severity: 'warn',
            category: 'system',
            title,
            body,
            targetType: 'project',
            targetId: u.id,
            metadata: { projectId: u.id, projectName: u.name || null, slippagePercent: u.slippage, reminder: isReminder },
            tenantId: u.tenantId,
        };
        if (u.createdBy) {
            await createNotification({ ...baseNotif, recipientUid: u.createdBy });
        }
        if (u.pe && u.pe !== u.createdBy) {
            await createNotification({ ...baseNotif, recipientUid: u.pe });
        }
    };

    for (const u of willDetect) {
        await db.collection('projects').doc(u.id).update({
            status: 'Delayed',
            slippageDetectedAt: admin.firestore.FieldValue.serverTimestamp(),
            slippagePercent: u.slippage,
        });
        await sendSlippingNotification(u, false);
        writes++;
    }

    for (const u of willRecover) {
        const updates = {
            slippageDetectedAt: admin.firestore.FieldValue.delete(),
            slippagePercent: admin.firestore.FieldValue.delete(),
        };
        if (!u.hasUnassignReason && u.hasEng) {
            updates.status = 'Ongoing';
        }
        await db.collection('projects').doc(u.id).update(updates);
        writes++;
    }

    for (const u of stillSlipping) {
        await db.collection('projects').doc(u.id).update({ slippagePercent: u.slippage });
        await sendSlippingNotification(u, true);
        writes++;
    }

    const totalNotifPairs = willDetect.length + stillSlipping.length;
    console.log(`\n✓ ${writes} project(s) written, ${totalNotifPairs} notification pair(s) sent (${willDetect.length} first-detection, ${stillSlipping.length} reminder).`);
    process.exit(0);
}

main().catch((err) => {
    console.error('\n✗ Scan failed:', err.message);
    process.exit(1);
});
