const admin = require('firebase-admin');
const serviceAccount = require('../serviceAccountKey.json');

admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });

async function main() {
    const args = process.argv.slice(2);
    const uid = args.find((a) => !a.startsWith('--'));
    const revoke = args.includes('--revoke');

    if (!uid) {
        console.error('Usage: node scripts/grant-platform-admin.js <uid> [--revoke]');
        process.exit(1);
    }

    console.log(`=== ${revoke ? 'Revoke' : 'Grant'} platformAdmin claim ===`);
    console.log(`Target UID: ${uid}\n`);

    let user;
    try {
        user = await admin.auth().getUser(uid);
    } catch (err) {
        console.error(`✗ User not found: ${err.message}`);
        process.exit(1);
    }

    console.log(`User: ${user.email || '(no email)'} | display: ${user.displayName || '(none)'}`);
    const existingClaims = user.customClaims || {};
    console.log(`Existing claims: ${JSON.stringify(existingClaims)}\n`);

    const nextClaims = { ...existingClaims };
    if (revoke) {
        delete nextClaims.platformAdmin;
    } else {
        nextClaims.platformAdmin = true;
    }

    await admin.auth().setCustomUserClaims(uid, nextClaims);
    console.log(`✓ Claims now: ${JSON.stringify(nextClaims)}`);
    console.log('  The user must sign out and back in for the new token to take effect.');
    process.exit(0);
}

main().catch((err) => {
    console.error('\n✗ Script failed:', err.message);
    process.exit(1);
});
