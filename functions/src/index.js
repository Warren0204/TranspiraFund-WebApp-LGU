const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { onDocumentWritten } = require("firebase-functions/v2/firestore");
const { setGlobalOptions } = require("firebase-functions/v2/options");
const admin = require("firebase-admin");

admin.initializeApp();

// Set deployment region to Singapore (v2)
setGlobalOptions({ region: "asia-southeast1" });

// Helper to generate password
const generatePassword = () => {
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%";
    let password = "";
    for (let i = 0; i < 12; i++) {
        password += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return password;
};

// ☁️ CLOUD FUNCTION: Create Official Account (v2)
exports.createOfficialAccount = onCall(async (request) => {
    // In v2, context is inside the request object
    const { data, auth } = request;

    // 1. SECURITY: Ensure the caller is authenticated
    if (!auth) {
        throw new HttpsError('unauthenticated', 'The function must be called while authenticated.');
    }

    // 2. SECURITY: RBAC - Verify caller has MIS admin role
    const callerDoc = await admin.firestore().collection("users").doc(auth.uid).get();
    if (!callerDoc.exists) {
        throw new HttpsError('permission-denied', 'User profile not found.');
    }
    const callerRole = callerDoc.data().role;
    const ALLOWED_ROLES = ['MIS', 'DEPW']; // MIS can create all, DEPW can create engineers
    if (!ALLOWED_ROLES.includes(callerRole)) {
        throw new HttpsError('permission-denied', 'Insufficient permissions to create accounts.');
    }

    const { email, firstName, lastName, roleType, department } = data;

    // 3. Input Validation
    if (!email || !firstName || !lastName || !roleType) {
        throw new HttpsError('invalid-argument', 'Missing required fields.');
    }

    // 4. SECURITY: DEPW can only create Project Engineers
    if (callerRole === 'DEPW' && roleType !== 'PROJ_ENG') {
        throw new HttpsError('permission-denied', 'DEPW can only provision Project Engineers.');
    }

    const tempPassword = generatePassword();

    try {
        // 2. Create User in Firebase Auth
        const userRecord = await admin.auth().createUser({
            email: email,
            password: tempPassword,
            displayName: `${firstName} ${lastName}`,
        });

        // 3. Create User Profile in Firestore
        await admin.firestore().collection("users").doc(userRecord.uid).set({
            uid: userRecord.uid,
            email: email,
            firstName,
            lastName,
            role: roleType, // 'DEPW', 'CPDO', etc.
            department: department || '',
            status: "Active",
            createdAt: new Date().toISOString(),
            createdBy: auth.uid // Audit log
        });

        // 4. Return the password to the frontend so it can be emailed
        return {
            success: true,
            message: "Account provisioned successfully.",
            tempPassword: tempPassword
        };

    } catch (error) {
        console.error("Error creating new user:", error);
        // Return friendly error if email exists
        if (error.code === 'auth/email-already-exists') {
            throw new HttpsError('already-exists', 'An account with this email already exists.');
        }
        throw new HttpsError('internal', error.message);
    }
});

// ☁️ CLOUD FUNCTION: Delete Official Account (v2)
exports.deleteOfficialAccount = onCall(async (request) => {
    const { data, auth } = request;

    // 1. SECURITY: Ensure authenticated
    if (!auth) {
        throw new HttpsError('unauthenticated', 'Must be authenticated to delete accounts.');
    }

    // 2. SECURITY: RBAC - Only MIS and DEPW can delete (DEPW only their engineers)
    const callerDoc = await admin.firestore().collection("users").doc(auth.uid).get();
    if (!callerDoc.exists) {
        throw new HttpsError('permission-denied', 'User profile not found.');
    }
    const callerRole = callerDoc.data().role;
    const ALLOWED_ROLES = ['MIS', 'DEPW'];
    if (!ALLOWED_ROLES.includes(callerRole)) {
        throw new HttpsError('permission-denied', 'Insufficient permissions to delete accounts.');
    }

    const { uid } = data;
    if (!uid) {
        throw new HttpsError('invalid-argument', 'User UID is required.');
    }

    // 3. SECURITY: DEPW can only delete Project Engineers
    if (callerRole === 'DEPW') {
        const targetDoc = await admin.firestore().collection("users").doc(uid).get();
        if (targetDoc.exists && targetDoc.data().role !== 'PROJ_ENG') {
            throw new HttpsError('permission-denied', 'DEPW can only revoke Project Engineer access.');
        }
    }

    try {
        // 1. Delete from Authentication
        await admin.auth().deleteUser(uid);

        // 2. Delete from Firestore
        await admin.firestore().collection("users").doc(uid).delete();

        return { success: true, message: "Account deleted successfully." };

    } catch (error) {
        console.error("Error deleting user:", error);
        throw new HttpsError('internal', error.message);
    }
});

// ─── TRIGGER: Recompute public stats when any user document changes ──────────
exports.onUserWritten = onDocumentWritten("users/{userId}", async () => {
    try {
        const usersSnapshot = await admin.firestore().collection("users").get();
        const users = usersSnapshot.docs.map(doc => doc.data());

        const engineerCount = users.filter(u =>
            u.role === 'PROJ_ENG' || u.role === 'Project Engineer'
        ).length;

        const departmentCount = new Set(
            users.map(u => u.department).filter(Boolean)
        ).size;

        await admin.firestore().doc("stats/public").set({
            engineerCount,
            departmentCount,
            lastUpdated: new Date().toISOString()
        }, { merge: true });

    } catch (error) {
        console.error("[onUserWritten] Failed to update stats:", error);
    }
});

// ─── TRIGGER: Recompute public stats when any project document changes ───────
exports.onProjectWritten = onDocumentWritten("projects/{projectId}", async () => {
    try {
        const projectsSnapshot = await admin.firestore().collection("projects").get();
        const projects = projectsSnapshot.docs.map(doc => doc.data());

        const projectCount = projects.length;
        const totalBudget = projects.reduce(
            (acc, p) => acc + (Number(p.budget) || 0), 0
        );

        await admin.firestore().doc("stats/public").set({
            projectCount,
            totalBudget,
            lastUpdated: new Date().toISOString()
        }, { merge: true });

    } catch (error) {
        console.error("[onProjectWritten] Failed to update stats:", error);
    }
});
