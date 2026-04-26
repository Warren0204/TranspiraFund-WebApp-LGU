/**
 * One-time bootstrap: grant the platformAdmin custom claim to a Firebase Auth UID.
 *
 * Context:
 *   The provisionTenant Cloud Function is gated by `auth.token.platformAdmin === true`.
 *   No callable in this codebase ever sets that claim, so it cannot be self-elevated.
 *   The only way to obtain it is via this script, run with a service account key
 *   by someone with operator access to the Firebase project.
 *
 *   Run this once for each TranspiraFund staff member who needs to onboard new
 *   tenants. Revoke by re-running with --revoke.
 *
 * Prerequisites:
 *   1. Place your Firebase service account key JSON at ./serviceAccountKey.json
 *      (download from Firebase Console: Project Settings, Service accounts,
 *      Generate new private key)
 *   2. cd scripts && npm install firebase-admin   (if not already installed)
 *
 * Usage:
 *   node scripts/grant-platform-admin.js <uid>             # grant
 *   node scripts/grant-platform-admin.js <uid> --revoke    # revoke
 *
 * After granting, the user must sign out and sign back in (or refresh their
 * ID token) for the new claim to land on their session token.
 */

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

    // Additive merge so role / tenantId / OTP claims are never wiped.
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
