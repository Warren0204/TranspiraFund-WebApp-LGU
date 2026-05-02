const admin = require('firebase-admin');
const serviceAccount = require('./serviceAccountKey.json');

admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });

const db = admin.firestore();
const APPLY = process.argv.includes('--apply');

function normalize(s) {
    return (s || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

async function loadEngineerIndex() {
    const snap = await db.collection('users')
        .where('role', 'in', ['PROJ_ENG', 'Project Engineer'])
        .get();

    const byName = new Map();
    const uidSet = new Set();
    snap.docs.forEach(doc => {
        const d = doc.data();
        const full = normalize(`${d.firstName || ''} ${d.lastName || ''}`);
        if (full) byName.set(full, doc.id);
        uidSet.add(doc.id);
    });
    return { byName, uidSet };
}

async function main() {
    console.log('=== Backfill: projectEngineer name → UID ===');
    console.log(APPLY ? 'Mode: APPLY (writes enabled)\n' : 'Mode: DRY RUN (no writes)\n');

    const { byName, uidSet } = await loadEngineerIndex();
    console.log(`Loaded ${uidSet.size} engineer user(s), ${byName.size} resolvable by name.`);

    const projSnap = await db.collection('projects').get();
    console.log(`Scanning ${projSnap.size} project(s)...\n`);

    const updates = [];
    const unresolved = [];
    let alreadyUid = 0;
    let empty = 0;

    projSnap.docs.forEach(doc => {
        const data = doc.data();
        const val = data.projectEngineer;

        if (!val) { empty++; return; }
        if (uidSet.has(val)) { alreadyUid++; return; }

        const uid = byName.get(normalize(val));
        if (uid) {
            updates.push({ projectId: doc.id, projectName: data.projectName, oldValue: val, newUid: uid });
        } else {
            unresolved.push({ projectId: doc.id, projectName: data.projectName, value: val });
        }
    });

    console.log(`  Already UID-keyed:  ${alreadyUid}`);
    console.log(`  No engineer field:  ${empty}`);
    console.log(`  Will update:        ${updates.length}`);
    console.log(`  Unresolved:         ${unresolved.length}\n`);

    if (updates.length) {
        console.log('--- Projects to update ---');
        updates.forEach(u => console.log(`  [${u.projectId}] "${u.projectName}" | "${u.oldValue}" → ${u.newUid}`));
        console.log('');
    }

    if (unresolved.length) {
        console.log('--- Unresolved (name did not match any engineer) ---');
        unresolved.forEach(u => console.log(`  [${u.projectId}] "${u.projectName}" | "${u.value}"`));
        console.log('  → Either the engineer was deleted, or the name differs from firstName+lastName.\n');
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
        chunk.forEach(u => {
            batch.update(db.collection('projects').doc(u.projectId), { projectEngineer: u.newUid });
        });
        await batch.commit();
        written += chunk.length;
    }

    console.log(`\n✓ Updated ${written} project document(s).`);
    process.exit(0);
}

main().catch(err => {
    console.error('\n✗ Migration failed:', err.message);
    process.exit(1);
});
