const admin = require('firebase-admin');
const serviceAccount = require('../serviceAccountKey.json');

admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });

const VALID_ROLES = ['MIS', 'HCSD', 'PROJ_ENG'];

async function listTenants() {
    const snap = await admin.firestore().collection('tenants').get();
    if (snap.empty) {
        console.log('(no tenants provisioned yet — run provisionTenant callable first)');
        return;
    }
    console.log('Existing tenants:');
    snap.forEach((doc) => {
        const t = doc.data();
        console.log(`  - ${doc.id}${t.lguName ? `  (${t.lguName})` : ''}`);
    });
}

async function main() {
    const args = process.argv.slice(2);
    const uid = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--tenant' && args[i - 1] !== '--role');
    const tenantIdx = args.indexOf('--tenant');
    const tenantId = tenantIdx >= 0 ? args[tenantIdx + 1] : null;
    const roleIdx = args.indexOf('--role');
    const role = roleIdx >= 0 ? args[roleIdx + 1] : null;

    if (!uid || !tenantId) {
        console.error('Usage: node scripts/grant-tenant-claim.js <uid> --tenant <tenantId> [--role <MIS|HCSD|PROJ_ENG>]\n');
        await listTenants();
        process.exit(1);
    }

    if (role && !VALID_ROLES.includes(role)) {
        console.error(`✗ Invalid --role "${role}". Must be one of: ${VALID_ROLES.join(', ')}`);
        process.exit(1);
    }

    const tenantSnap = await admin.firestore().collection('tenants').doc(tenantId).get();
    if (!tenantSnap.exists) {
        console.error(`✗ Tenant "${tenantId}" does not exist in Firestore.\n`);
        await listTenants();
        process.exit(1);
    }

    console.log('=== Grant tenantId custom claim ===');
    console.log(`Target UID: ${uid}`);
    console.log(`Tenant ID:  ${tenantId}  (${tenantSnap.data().lguName || 'unnamed'})`);
    if (role) console.log(`Role:       ${role}`);
    console.log('');

    let user;
    try {
        user = await admin.auth().getUser(uid);
    } catch (err) {
        console.error(`✗ Auth user not found: ${err.message}`);
        process.exit(1);
    }

    console.log(`User: ${user.email || '(no email)'} | display: ${user.displayName || '(none)'}`);
    const existingClaims = user.customClaims || {};
    console.log(`Existing claims: ${JSON.stringify(existingClaims)}\n`);

    const nextClaims = { ...existingClaims, tenantId };
    if (role) nextClaims.role = role;

    await admin.auth().setCustomUserClaims(user.uid, nextClaims);
    console.log(`✓ Auth claims now: ${JSON.stringify(nextClaims)}`);

    const userDocRef = admin.firestore().collection('users').doc(user.uid);
    const userDoc = await userDocRef.get();
    if (userDoc.exists) {
        const current = userDoc.data();
        const update = {};
        if (current.tenantId !== tenantId) update.tenantId = tenantId;
        if (role && current.role !== role) update.role = role;
        if (Object.keys(update).length > 0) {
            await userDocRef.update(update);
            console.log(`✓ Firestore users/${user.uid} updated:`, update);
        } else {
            console.log(`  Firestore users/${user.uid} already matches — no doc update needed.`);
        }
    } else {
        console.warn(`⚠ Firestore users/${user.uid} does not exist. Only the Auth claim was set.`);
        console.warn('  The RequireAuth flow and Firestore rules both expect this document; create it or provision via provisionTenant.');
    }

    console.log('\n  The user must sign out and back in for the new token to take effect.');
    process.exit(0);
}

main().catch((err) => {
    console.error('\n✗ Script failed:', err.message);
    process.exit(1);
});
