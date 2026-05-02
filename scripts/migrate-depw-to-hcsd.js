const admin = require('firebase-admin');
const serviceAccount = require('./serviceAccountKey.json');

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();

async function migrateUserDocuments() {
    console.log('\n[1/3] Migrating Firestore user documents: role DEPW → HCSD...');
    const snapshot = await db.collection('users').where('role', '==', 'DEPW').get();

    if (snapshot.empty) {
        console.log('  No users with role DEPW found. Skipping.');
        return [];
    }

    const batch = db.batch();
    snapshot.docs.forEach(doc => {
        batch.update(doc.ref, { role: 'HCSD' });
    });
    await batch.commit();

    const uids = snapshot.docs.map(d => d.id);
    console.log(`  Updated ${uids.length} user document(s): ${uids.join(', ')}`);
    return uids;
}

async function migrateAuthClaims(uids) {
    console.log('\n[2/3] Refreshing Firebase Auth custom claims...');
    if (uids.length === 0) {
        console.log('  No UIDs to update. Skipping.');
        return;
    }
    for (const uid of uids) {
        await admin.auth().setCustomUserClaims(uid, {
            role: 'HCSD',
            otpVerified: false,
            otpVerifiedAtAuthTime: 0,
        });
        console.log(`  Updated claims for UID: ${uid}`);
    }
    console.log(`  ${uids.length} claim(s) updated.`);
}

async function migrateAuditTrails() {
    console.log('\n[3/3] Migrating depwAuditTrails → hcsdAuditTrails...');
    const snapshot = await db.collection('depwAuditTrails').get();

    if (snapshot.empty) {
        console.log('  No documents in depwAuditTrails. Skipping.');
        return;
    }

    const chunks = [];
    for (let i = 0; i < snapshot.docs.length; i += 250) {
        chunks.push(snapshot.docs.slice(i, i + 250));
    }

    let migrated = 0;
    for (const chunk of chunks) {
        const batch = db.batch();
        chunk.forEach(doc => {
            const newRef = db.collection('hcsdAuditTrails').doc(doc.id);
            batch.set(newRef, doc.data());
            batch.delete(doc.ref);
        });
        await batch.commit();
        migrated += chunk.length;
    }

    console.log(`  Migrated ${migrated} audit trail document(s).`);
}

async function main() {
    console.log('=== TranspiraFund: DEPW → HCSD Migration ===');
    try {
        const uids = await migrateUserDocuments();
        await migrateAuthClaims(uids);
        await migrateAuditTrails();
        console.log('\n✓ Migration complete.\n');
        console.log('Next steps:');
        console.log('  1. Deploy Firestore rules:    firebase deploy --only firestore:rules');
        console.log('  2. Deploy Cloud Functions:    firebase deploy --only functions');
        console.log('  3. Deploy frontend:           firebase deploy --only hosting');
    } catch (err) {
        console.error('\n✗ Migration failed:', err.message);
        process.exit(1);
    }
    process.exit(0);
}

main();
