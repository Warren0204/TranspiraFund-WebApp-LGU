const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { onDocumentWritten } = require("firebase-functions/v2/firestore");
const { setGlobalOptions } = require("firebase-functions/v2/options");
const { defineSecret } = require("firebase-functions/params");
const logger = require("firebase-functions/logger");

const admin = require("firebase-admin");
const crypto = require("crypto");
const nodemailer = require("nodemailer");
const { z } = require("zod");

admin.initializeApp();
setGlobalOptions({ region: "asia-southeast1" });

// ─── Secrets ───────────────────────────────────────────────────────────────
const gmailUser = defineSecret("GMAIL_USER");
const gmailAppPassword = defineSecret("GMAIL_APP_PASSWORD");

// ─── Email Transport ────────────────────────────────────────────────────────
const createTransporter = () => nodemailer.createTransport({
    service: "gmail",
    auth: {
        user: gmailUser.value(),
        pass: gmailAppPassword.value(),
    },
});

// ─── Zod validation schemas ─────────────────────────────────────────────────
const createAccountSchema = z.object({
    email: z.string().email().max(100),
    firstName: z.string().min(2).max(50).regex(/^[a-zA-Z\s\-']+$/, "First name contains invalid characters"),
    lastName: z.string().min(2).max(50).regex(/^[a-zA-Z\s\-']+$/, "Last name contains invalid characters"),
    roleType: z.enum(["MAYOR", "HCSD", "CPDO", "PROJ_ENG"]),
    department: z.string().max(100).optional(),
});

const createProjectSchema = z.object({
    // Project Details
    projectName: z.string().min(10, "Project name must be at least 10 characters").max(200),
    sitioStreet: z.string().max(200).optional(),
    barangay: z.string().min(1, "Barangay is required").max(100),

    // Account Code & Funding
    accountCode: z.string().max(100).optional(),
    fundingSource: z.string().min(1, "Funding source is required").max(100),

    // Contract Amount
    contractAmount: z.number().min(10000, "Minimum contract amount is ₱10,000").max(1_000_000_000),

    // Contractor
    contractor: z.string().max(200).optional(),

    // Assigned Personnel
    projectEngineer: z.string().max(200).optional(),
    projectInspector: z.string().max(100).optional(),
    materialInspector: z.string().max(100).optional(),
    electricalInspector: z.string().max(100).optional(),

    // Project Timeliness
    ntpReceivedDate: z.string().min(1, "NTP received date is required"),
    officialDateStarted: z.string().min(1, "Official start date is required"),
    originalDateCompletion: z.string().min(1, "Original completion date is required"),
    revisedDate1: z.string().optional(),
    revisedDate2: z.string().optional(),
    actualDateCompleted: z.string().optional(),

    // Project Accomplishment (only stored field)
    actualPercent: z.number().min(0).max(100).optional(),

    // Project Orders (flat fields)
    resumeOrderNumber: z.string().max(100).optional(),
    resumeOrderDate: z.string().optional(),
    timeExtensionOnOrder: z.string().max(100).optional(),
    validationOrderNumber: z.string().max(100).optional(),
    validationOrderDate: z.string().optional(),
    suspensionOrderNumber: z.string().max(100).optional(),
    suspensionOrderDate: z.string().optional(),

    // Fund Utilization
    incurredAmount: z.number().min(0).optional(),

    // Remarks & Action
    remarks: z.string().max(1000).optional(),
    actionTaken: z.string().max(1000).optional(),

});

// ─── Helpers ────────────────────────────────────────────────────────────────

// Cryptographically secure password generator
const generatePassword = (length = 16) => {
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*";
    let password = "";
    for (let i = 0; i < length; i++) {
        password += chars.charAt(crypto.randomInt(chars.length));
    }
    return password;
};

// Write an audit trail entry — HCSD-scoped
const logAudit = async (actorUid, actorEmail, action, targetId = null, details = {}) => {
    try {
        await admin.firestore().collection("auditTrails").doc("hcsd").collection("entries").add({
            timestamp: admin.firestore.FieldValue.serverTimestamp(),
            actorUid,
            actorEmail: actorEmail || null,
            action,
            targetId,
            details,
        });
    } catch (err) {
        logger.error("Audit trail write failed:", err);
    }
};

// Write a system-level audit trail entry — MIS-scoped, append-only
const logSystemAudit = async (actorUid, actorEmail, action, target = {}, status = "SUCCESS", actorName = null) => {
    try {
        const actor = { uid: actorUid, email: actorEmail || null };
        if (actorName) actor.name = actorName;
        await admin.firestore().collection("auditTrails").doc("mis").collection("entries").add({
            action,
            actor,
            target,
            status,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });
    } catch (err) {
        logger.error("System audit trail write failed:", err);
    }
};

// ─── CLOUD FUNCTION: Send OTP ───────────────────────────────────────────────
exports.sendOtp = onCall({ secrets: [gmailUser, gmailAppPassword] }, async (request) => {
    const { auth } = request;
    if (!auth) throw new HttpsError("unauthenticated", "Must be authenticated to request a verification code.");

    const uid = auth.uid;
    const userEmail = auth.token.email;
    if (!userEmail) throw new HttpsError("invalid-argument", "No email address found for this account.");

    // Enforce 60-second cooldown between resend requests
    const existingOtp = await admin.firestore().collection("otpCodes").doc(uid).get();
    if (existingOtp.exists) {
        const { sentAt } = existingOtp.data();
        const COOLDOWN_MS = 60 * 1000;
        if (sentAt && Date.now() - sentAt < COOLDOWN_MS) {
            const secondsLeft = Math.ceil((COOLDOWN_MS - (Date.now() - sentAt)) / 1000);
            throw new HttpsError("resource-exhausted", `Please wait ${secondsLeft} second(s) before requesting another code.`);
        }
    }

    const otpCode = crypto.randomInt(100000, 999999).toString();
    const sentAt = Date.now();
    const expiresAt = sentAt + 5 * 60 * 1000;

    await admin.firestore().collection("otpCodes").doc(uid).set({
        code: otpCode,
        email: userEmail,
        sentAt,
        expiresAt,
        attempts: 0,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    // Clear previous OTP verification claim for this session
    await admin.auth().setCustomUserClaims(uid, {
        otpVerified: false,
        otpVerifiedAtAuthTime: 0,
    });

    try {
        const transporter = createTransporter();
        await transporter.sendMail({
            from: `"TranspiraFund LGU Portal" <${gmailUser.value()}>`,
            to: userEmail,
            subject: "TranspiraFund — Your Verification Code",
            html: `
                <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;background:#f8fafc;border-radius:12px;">
                    <h2 style="color:#0f766e;font-size:22px;margin-bottom:8px;">Identity Verification</h2>
                    <p style="color:#475569;font-size:15px;margin-bottom:24px;">Your one-time verification code for the TranspiraFund LGU Portal:</p>
                    <div style="background:#fff;border:1px solid #e2e8f0;border-radius:8px;padding:20px;text-align:center;margin-bottom:24px;">
                        <span style="font-size:36px;font-weight:bold;letter-spacing:8px;color:#0f766e;">${otpCode}</span>
                    </div>
                    <p style="color:#64748b;font-size:13px;">This code expires in <strong>5 minutes</strong> and can only be used once. If you did not request this, contact system administration immediately.</p>
                </div>
            `,
        });
    } catch (emailError) {
        logger.error("Failed to send OTP email:", emailError);
        await admin.firestore().collection("otpCodes").doc(uid).delete();
        throw new HttpsError("internal", "Unable to send verification code. Please try again.");
    }

    return { success: true };
});

// ─── CLOUD FUNCTION: Verify OTP ─────────────────────────────────────────────
exports.verifyOtp = onCall(async (request) => {
    const { auth, data } = request;
    if (!auth) throw new HttpsError("unauthenticated", "Must be authenticated to verify a code.");

    const { code } = data;
    if (!code || typeof code !== "string" || !/^\d{6}$/.test(code)) {
        throw new HttpsError("invalid-argument", "Invalid verification code format.");
    }

    const uid = auth.uid;
    const otpRef = admin.firestore().collection("otpCodes").doc(uid);
    const otpDoc = await otpRef.get();

    if (!otpDoc.exists) throw new HttpsError("not-found", "No verification code found. Please request a new one.");

    const { code: storedCode, expiresAt, attempts } = otpDoc.data();

    if (Date.now() > expiresAt) {
        await otpRef.delete();
        throw new HttpsError("deadline-exceeded", "Verification code has expired. Please request a new one.");
    }
    if (attempts >= 5) {
        await otpRef.delete();
        throw new HttpsError("resource-exhausted", "Too many failed attempts. Please request a new verification code.");
    }

    // Constant-time comparison to prevent timing attacks
    const inputBuf = Buffer.from(code.padEnd(6, "0"));
    const storedBuf = Buffer.from(storedCode.padEnd(6, "0"));
    const codesMatch = inputBuf.length === storedBuf.length && crypto.timingSafeEqual(inputBuf, storedBuf);

    if (!codesMatch) {
        await otpRef.update({ attempts: admin.firestore.FieldValue.increment(1) });
        const remaining = 4 - attempts;
        throw new HttpsError(
            "invalid-argument",
            remaining > 0
                ? `Invalid verification code. ${remaining} attempt(s) remaining.`
                : "Invalid verification code. Please request a new one."
        );
    }

    await otpRef.delete();

    // Bind OTP claim to this login session
    const authTime = auth.token.auth_time;
    await admin.auth().setCustomUserClaims(uid, {
        otpVerified: true,
        otpVerifiedAtAuthTime: authTime,
    });

    // Fetch user role to route login audit to correct trail
    const userDoc = await admin.firestore().collection("users").doc(uid).get();
    const userRole = userDoc.exists ? userDoc.data().role : null;
    const userName = userDoc.exists
        ? `${userDoc.data().firstName || ""} ${userDoc.data().lastName || ""}`.trim()
        : null;

    if (userRole === "HCSD") {
        await logAudit(uid, auth.token.email, "USER_LOGIN", uid, { role: userRole, name: userName });
    } else {
        await logSystemAudit(uid, auth.token.email, "USER_LOGIN", { uid, role: userRole, name: userName }, "SUCCESS", userName);
    }

    await logSystemAudit(uid, auth.token.email, "OTP_VERIFIED", {}, "SUCCESS");
    return { success: true };
});

// ─── CLOUD FUNCTION: Create Official Account ────────────────────────────────
exports.createOfficialAccount = onCall({ secrets: [gmailUser, gmailAppPassword] }, async (request) => {
    const { data, auth } = request;
    if (!auth) throw new HttpsError("unauthenticated", "The function must be called while authenticated.");

    // RBAC check
    const callerDoc = await admin.firestore().collection("users").doc(auth.uid).get();
    if (!callerDoc.exists) throw new HttpsError("permission-denied", "User profile not found.");
    const callerRole = callerDoc.data().role;
    if (!["MIS", "HCSD"].includes(callerRole)) throw new HttpsError("permission-denied", "Insufficient permissions to create accounts.");

    // Validate input
    const parsed = createAccountSchema.safeParse(data);
    if (!parsed.success) {
        const msg = parsed.error.errors[0]?.message ?? "Invalid input.";
        throw new HttpsError("invalid-argument", msg);
    }
    const { email, firstName, lastName, roleType, department } = parsed.data;

    if (callerRole === "HCSD" && roleType !== "PROJ_ENG") {
        throw new HttpsError("permission-denied", "HCSD can only provision Project Engineers.");
    }

    const tempPassword = generatePassword();

    try {
        const userRecord = await admin.auth().createUser({
            email,
            password: tempPassword,
            displayName: `${firstName} ${lastName}`,
        });

        // Set role as custom claim
        await admin.auth().setCustomUserClaims(userRecord.uid, {
            role: roleType,
            otpVerified: false,
            otpVerifiedAtAuthTime: 0,
        });

        await admin.firestore().collection("users").doc(userRecord.uid).set({
            uid: userRecord.uid,
            email,
            firstName,
            lastName,
            role: roleType,
            department: department || "",
            status: "Active",
            mustChangePassword: true,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            createdBy: auth.uid,
        });

        // Send credentials via Gmail
        const transporter = createTransporter();
        await transporter.sendMail({
            from: `"TranspiraFund LGU Portal" <${gmailUser.value()}>`,
            to: email,
            subject: "TranspiraFund — Your Account Has Been Created",
            html: `
                <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;background:#f8fafc;border-radius:12px;">
                    <h2 style="color:#0f766e;font-size:22px;margin-bottom:8px;">Welcome, ${firstName}!</h2>
                    <p style="color:#475569;font-size:15px;margin-bottom:24px;">Your official TranspiraFund LGU Portal account has been created.</p>
                    <div style="background:#fff;border:1px solid #e2e8f0;border-radius:8px;padding:20px;margin-bottom:24px;">
                        <p style="margin:0 0 8px;color:#64748b;font-size:13px;font-weight:bold;text-transform:uppercase;letter-spacing:.05em;">Login Email</p>
                        <p style="margin:0 0 16px;color:#1e293b;font-size:15px;font-weight:600;">${email}</p>
                        <p style="margin:0 0 8px;color:#64748b;font-size:13px;font-weight:bold;text-transform:uppercase;letter-spacing:.05em;">Temporary Password</p>
                        <p style="margin:0;color:#1e293b;font-size:18px;font-weight:bold;letter-spacing:2px;font-family:monospace;">${tempPassword}</p>
                    </div>
                    <p style="color:#dc2626;font-size:13px;font-weight:600;">You will be required to change your password on first login. Do not share this email with anyone.</p>
                </div>
            `,
        });

        // Audit trail — route by caller role
        const callerName = `${callerDoc.data().firstName} ${callerDoc.data().lastName}`;
        if (callerRole === "MIS") {
            await logSystemAudit(auth.uid, auth.token.email, "ACCOUNT_CREATED",
                { email, role: roleType, department: department || "" },
                "SUCCESS", callerName);
        } else {
            await logAudit(auth.uid, auth.token.email, "ACCOUNT_CREATED", userRecord.uid, {
                email, roleType, department: department || "",
            });
        }

        return { success: true, message: "Account provisioned. Credentials sent to the registered email." };

    } catch (error) {
        logger.error("Error creating new user:", error);
        if (error.code === "auth/email-already-exists") {
            throw new HttpsError("already-exists", "An account with this email already exists.");
        }
        throw new HttpsError("internal", "Unable to create account. Please try again.");
    }
});

// ─── CLOUD FUNCTION: Delete Official Account ────────────────────────────────
exports.deleteOfficialAccount = onCall(async (request) => {
    const { data, auth } = request;
    if (!auth) throw new HttpsError("unauthenticated", "Must be authenticated to delete accounts.");

    const callerDoc = await admin.firestore().collection("users").doc(auth.uid).get();
    if (!callerDoc.exists) throw new HttpsError("permission-denied", "User profile not found.");
    const callerRole = callerDoc.data().role;
    if (!["MIS", "HCSD"].includes(callerRole)) throw new HttpsError("permission-denied", "Insufficient permissions to delete accounts.");

    const { uid } = data;
    if (!uid || typeof uid !== "string") throw new HttpsError("invalid-argument", "User UID is required.");

    if (callerRole === "HCSD") {
        const targetDoc = await admin.firestore().collection("users").doc(uid).get();
        if (targetDoc.exists && targetDoc.data().role !== "PROJ_ENG") {
            throw new HttpsError("permission-denied", "HCSD can only revoke Project Engineer access.");
        }
    }

    try {
        const targetDoc = await admin.firestore().collection("users").doc(uid).get();
        const targetEmail = targetDoc.exists ? targetDoc.data().email : null;
        const targetRole = targetDoc.exists ? targetDoc.data().role : null;

        await admin.auth().deleteUser(uid);
        await admin.firestore().collection("users").doc(uid).delete();

        // Audit trail — route by caller role
        if (callerRole === "MIS") {
            await logSystemAudit(auth.uid, auth.token.email, "ACCOUNT_DELETED",
                { uid, email: targetEmail, role: targetRole }, "SUCCESS");
        } else {
            await logAudit(auth.uid, auth.token.email, "ACCOUNT_DELETED", uid, { deletedEmail: targetEmail });
        }

        return { success: true, message: "Account deleted successfully." };
    } catch (error) {
        logger.error("Error deleting user:", error);
        throw new HttpsError("internal", "Unable to delete account. Please try again.");
    }
});

// ─── CLOUD FUNCTION: Create Project ─────────────────────────────────────────
exports.createProject = onCall(async (request) => {
    const { auth, data } = request;
    if (!auth) throw new HttpsError("unauthenticated", "Must be authenticated to create projects.");

    const callerDoc = await admin.firestore().collection("users").doc(auth.uid).get();
    if (!callerDoc.exists || callerDoc.data().role !== "HCSD") {
        throw new HttpsError("permission-denied", "Only HCSD personnel can create projects.");
    }

    // Firebase callable SDK sends null for absent optional fields; convert null → undefined before validation
    const sanitized = Object.fromEntries(
        Object.entries(data || {}).map(([k, v]) => [k, v === null ? undefined : v])
    );

    // Validate project data
    const parsed = createProjectSchema.safeParse(sanitized);
    if (!parsed.success) {
        const msg = parsed.error.errors[0]?.message ?? "Invalid project data.";
        throw new HttpsError("invalid-argument", msg);
    }
    // Strip undefined/null values — Firestore rejects undefined fields
    const projectFields = Object.fromEntries(
        Object.entries(parsed.data).filter(([, v]) => v !== undefined && v !== null)
    );

    try {
        const projectRef = await admin.firestore().collection("projects").add({
            ...projectFields,
            status: projectFields.projectEngineer ? "Ongoing" : "Delayed",
            progress: 0,
            createdBy: auth.uid,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });

        // Audit trail
        await logAudit(auth.uid, auth.token.email, "PROJECT_CREATED", projectRef.id, {
            projectName: projectFields.projectName,
            contractAmount: projectFields.contractAmount,
            barangay: projectFields.barangay,
        });

        return { success: true, projectId: projectRef.id };
    } catch (error) {
        logger.error("Error creating project:", error);
        throw new HttpsError("internal", "Unable to create project. Please try again.");
    }
});

// ─── CLOUD FUNCTION: Change Password ────────────────────────────────────────
exports.changePassword = onCall(async (request) => {
    const { auth, data } = request;
    if (!auth) throw new HttpsError("unauthenticated", "Must be authenticated to change password.");

    const { newPassword } = data;

    if (!newPassword || typeof newPassword !== "string") {
        throw new HttpsError("invalid-argument", "Invalid password.");
    }
    if (newPassword.length < 12) {
        throw new HttpsError("invalid-argument", "Password must be at least 12 characters.");
    }
    if (newPassword.length > 128) {
        throw new HttpsError("invalid-argument", "Password is too long.");
    }
    if (!/[A-Z]/.test(newPassword)) {
        throw new HttpsError("invalid-argument", "Password must contain at least one uppercase letter.");
    }
    if (!/[a-z]/.test(newPassword)) {
        throw new HttpsError("invalid-argument", "Password must contain at least one lowercase letter.");
    }
    if (!/[0-9]/.test(newPassword)) {
        throw new HttpsError("invalid-argument", "Password must contain at least one number.");
    }
    if (!/[^A-Za-z0-9]/.test(newPassword)) {
        throw new HttpsError("invalid-argument", "Password must contain at least one special character.");
    }

    try {
        await admin.auth().updateUser(auth.uid, { password: newPassword });
        await admin.firestore().collection("users").doc(auth.uid).update({
            mustChangePassword: false,
            passwordChangedAt: admin.firestore.FieldValue.serverTimestamp(),
        });

        // Audit trail
        await logSystemAudit(auth.uid, auth.token.email, "PASSWORD_CHANGED", {}, "SUCCESS");

        return { success: true };
    } catch (error) {
        logger.error("Error changing password:", error);
        throw new HttpsError("internal", "Unable to change password. Please try again.");
    }
});

// ─── CLOUD FUNCTION: Revoke Other Sessions ──────────────────────────────────
// Invalidates all refresh tokens for the current user. The caller's current
// session remains active (they keep their ID token until it expires naturally,
// then their own refresh token is also gone — so they'll be forced to re-auth
// the next time their token refreshes). All OTHER active sessions across devices
// will be signed out on their next token refresh (within ~1 hour).
exports.revokeOtherSessions = onCall(async (request) => {
    const { auth } = request;
    if (!auth) throw new HttpsError("unauthenticated", "Must be authenticated.");

    try {
        await admin.auth().revokeRefreshTokens(auth.uid);
        await logSystemAudit(auth.uid, auth.token.email, "SESSIONS_REVOKED", {}, "SUCCESS");
        return { success: true };
    } catch (error) {
        logger.error("Error revoking sessions:", error);
        throw new HttpsError("internal", "Unable to sign out other devices. Please try again.");
    }
});

// ─── CLOUD FUNCTION: Backfill projectEngineer field (name → UID) ─────────────
// One-time maintenance op to convert legacy project docs that stored the
// engineer's display name in `projectEngineer` over to the engineer's UID,
// so Firestore rules and the mobile app query (`projectEngineer == uid`) match.
// HCSD-only. Idempotent — safe to run multiple times.
exports.backfillProjectEngineerUids = onCall(async (request) => {
    const { auth } = request;
    if (!auth) throw new HttpsError("unauthenticated", "Must be authenticated.");

    const callerDoc = await admin.firestore().collection("users").doc(auth.uid).get();
    if (!callerDoc.exists || callerDoc.data().role !== "HCSD") {
        throw new HttpsError("permission-denied", "Only HCSD personnel can run this maintenance task.");
    }

    const normalize = (s) => (s || "").toString().trim().toLowerCase()
        .replace(/^engr\.?\s+/i, "")
        .replace(/\s+/g, " ");

    try {
        const usersSnap = await admin.firestore().collection("users")
            .where("role", "==", "PROJ_ENG").get();

        const nameToUid = new Map();
        const uidSet = new Set();
        usersSnap.docs.forEach(doc => {
            const d = doc.data();
            const full = normalize(`${d.firstName || ""} ${d.lastName || ""}`);
            if (full) nameToUid.set(full, doc.id);
            uidSet.add(doc.id);
        });

        const projSnap = await admin.firestore().collection("projects").get();

        const updates = [];
        const unresolved = [];
        let alreadyUid = 0;
        let empty = 0;

        projSnap.docs.forEach(doc => {
            const val = doc.data().projectEngineer;
            if (!val) { empty++; return; }
            if (uidSet.has(val)) { alreadyUid++; return; }

            const uid = nameToUid.get(normalize(val));
            if (uid) {
                updates.push({ projectId: doc.id, projectName: doc.data().projectName || null, oldValue: val, newUid: uid });
            } else {
                unresolved.push({ projectId: doc.id, projectName: doc.data().projectName || null, value: val });
            }
        });

        // Commit updates in batches of 400 (Firestore batch limit = 500)
        for (let i = 0; i < updates.length; i += 400) {
            const chunk = updates.slice(i, i + 400);
            const batch = admin.firestore().batch();
            chunk.forEach(u => {
                batch.update(admin.firestore().collection("projects").doc(u.projectId), { projectEngineer: u.newUid });
            });
            await batch.commit();
        }

        await logAudit(auth.uid, auth.token.email, "PROJECT_ENGINEER_BACKFILL", null, {
            updated: updates.length,
            alreadyUid,
            empty,
            unresolved: unresolved.length,
        });

        return {
            success: true,
            scanned: projSnap.size,
            updated: updates.length,
            alreadyUid,
            empty,
            unresolved,
            updates: updates.map(u => ({ projectName: u.projectName, oldValue: u.oldValue })),
        };
    } catch (error) {
        logger.error("Error in backfillProjectEngineerUids:", error);
        throw new HttpsError("internal", "Unable to run backfill. Please try again.");
    }
});

// ─── CLOUD FUNCTION: Send Password Reset Email ───────────────────────────────
exports.sendPasswordReset = onCall({ secrets: [gmailUser, gmailAppPassword] }, async (request) => {
    const { data } = request;
    const { email } = data;

    if (!email || typeof email !== "string") {
        throw new HttpsError("invalid-argument", "Email is required.");
    }

    const cleanEmail = email.trim().toLowerCase();
    const RESET_BASE = "https://transpirafund-webapp.web.app/reset-password";

    // Rate limiting — consistent for registered and unregistered emails (anti-enumeration)
    const emailHash = crypto.createHash("sha256").update(cleanEmail).digest("hex");
    const cooldownRef = admin.firestore().collection("passwordResets").doc(emailHash);
    const cooldownDoc = await cooldownRef.get();
    if (cooldownDoc.exists) {
        const { lastSent } = cooldownDoc.data();
        const COOLDOWN_MS = 60 * 1000;
        if (lastSent && Date.now() - lastSent < COOLDOWN_MS) {
            const secondsLeft = Math.ceil((COOLDOWN_MS - (Date.now() - lastSent)) / 1000);
            throw new HttpsError("resource-exhausted", `Please wait ${secondsLeft} second(s) before requesting another reset link.`);
        }
    }
    await cooldownRef.set({
        lastSent: Date.now(),
        expiresAt: admin.firestore.Timestamp.fromMillis(Date.now() + 10 * 60 * 1000),
    });

    try {
        const firebaseLink = await admin.auth().generatePasswordResetLink(cleanEmail, {
            url: "https://transpirafund-webapp.web.app/login",
        });

        const parsedUrl = new URL(firebaseLink);
        const oobCode = parsedUrl.searchParams.get("oobCode");
        if (!oobCode) throw new Error("Failed to extract reset token.");

        const customResetLink = `${RESET_BASE}?oobCode=${encodeURIComponent(oobCode)}`;

        const transporter = createTransporter();
        await transporter.sendMail({
            from: `"TranspiraFund LGU Portal" <${gmailUser.value()}>`,
            to: cleanEmail,
            subject: "TranspiraFund — Password Reset Request",
            html: `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#F8FAFC;">
<table width="100%" cellpadding="0" cellspacing="0" style="padding:40px 20px;">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 32px rgba(0,0,0,0.08);">
  <tr><td style="background:linear-gradient(135deg,#0f766e,#059669);padding:40px 40px 36px;text-align:center;">
    <p style="margin:0 0 8px;font-size:26px;font-weight:900;color:#fff;letter-spacing:-0.5px;">TranspiraFund</p>
    <p style="margin:0;font-size:12px;color:rgba(255,255,255,0.7);letter-spacing:0.12em;text-transform:uppercase;font-weight:600;">LGU Transparency Portal</p>
  </td></tr>
  <tr><td style="padding:40px 40px 32px;">
    <p style="margin:0 0 8px;font-size:22px;font-weight:800;color:#0f172a;letter-spacing:-0.3px;">Password Reset Request</p>
    <p style="margin:0 0 20px;font-size:15px;color:#64748b;line-height:1.7;">We received a request to reset the password for your official LGU account. Click the button below to set a new secure password.</p>
    <p style="margin:0 0 28px;font-size:13px;color:#94a3b8;line-height:1.6;">This link expires in <strong style="color:#64748b;">24 hours</strong> and is single-use only.</p>
    <table width="100%" cellpadding="0" cellspacing="0">
      <tr><td align="center" style="padding-bottom:32px;">
        <a href="${customResetLink}" style="display:inline-block;background:linear-gradient(135deg,#0f766e,#059669);color:#fff;font-weight:800;font-size:15px;padding:16px 44px;border-radius:12px;text-decoration:none;letter-spacing:0.02em;box-shadow:0 4px 16px rgba(15,118,110,0.3);">Reset My Password &rarr;</a>
      </td></tr>
    </table>
    <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:16px 20px;">
      <p style="margin:0 0 6px;font-size:12px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:0.08em;">Security Notice</p>
      <p style="margin:0;font-size:13px;color:#94a3b8;line-height:1.6;">If you did not request a password reset, disregard this email. Your account remains secure. Never share this link with anyone.</p>
    </div>
  </td></tr>
  <tr><td style="padding:20px 40px 28px;border-top:1px solid #f1f5f9;text-align:center;">
    <p style="margin:0;font-size:11px;color:#cbd5e1;letter-spacing:0.05em;text-transform:uppercase;">TranspiraFund &bull; Secured LGU Portal &bull; Automated System Email</p>
  </td></tr>
</table>
</td></tr></table>
</body></html>`,
        });
    } catch (error) {
        // Silently ignore user-not-found to prevent email enumeration
        if (error.code !== "auth/user-not-found") {
            logger.error("Password reset error:", error);
        }
    }

    // Always return success — never reveal whether the email exists
    return { success: true };
});

// ─── CLOUD FUNCTION: Reset Password ─────────────────────────────────────────
exports.resetPassword = onCall(async (request) => {
    const { data } = request;
    const { oobCode, newPassword } = data;

    if (!oobCode || typeof oobCode !== "string") {
        throw new HttpsError("invalid-argument", "Invalid reset token.");
    }
    if (!newPassword || typeof newPassword !== "string") {
        throw new HttpsError("invalid-argument", "Password is required.");
    }

    // Password rules
    if (newPassword.length < 12) throw new HttpsError("invalid-argument", "Password must be at least 12 characters.");
    if (newPassword.length > 128) throw new HttpsError("invalid-argument", "Password is too long.");
    if (!/[A-Z]/.test(newPassword)) throw new HttpsError("invalid-argument", "Password must contain at least one uppercase letter.");
    if (!/[a-z]/.test(newPassword)) throw new HttpsError("invalid-argument", "Password must contain at least one lowercase letter.");
    if (!/[0-9]/.test(newPassword)) throw new HttpsError("invalid-argument", "Password must contain at least one number.");
    if (!/[^A-Za-z0-9]/.test(newPassword)) throw new HttpsError("invalid-argument", "Password must contain at least one special character.");

    const WEB_API_KEY = process.env.WEB_API_KEY;
    if (!WEB_API_KEY) {
        logger.error("WEB_API_KEY environment variable is not set.");
        throw new HttpsError("internal", "Server configuration error.");
    }

    let resetResult;
    try {
        const response = await fetch(
            `https://identitytoolkit.googleapis.com/v1/accounts:resetPassword?key=${WEB_API_KEY}`,
            {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ oobCode, newPassword }),
            }
        );
        resetResult = await response.json();

        if (!response.ok || resetResult.error) {
            const code = resetResult.error?.message || "UNKNOWN_ERROR";
            if (code === "EXPIRED_OOB_CODE") {
                throw new HttpsError("deadline-exceeded", "This reset link has expired. Please request a new one.");
            }
            if (code === "INVALID_OOB_CODE") {
                throw new HttpsError("invalid-argument", "This reset link is invalid or has already been used.");
            }
            logger.error("Firebase Auth REST error during password reset:", resetResult.error);
            throw new HttpsError("internal", "Unable to reset password. Please try again.");
        }
    } catch (err) {
        if (err instanceof HttpsError) throw err;
        logger.error("Network error calling Firebase Auth REST API:", err);
        throw new HttpsError("internal", "Unable to reset password. Please try again.");
    }

    // Audit trail — non-blocking
    const email = resetResult?.email;
    if (email) {
        try {
            const userRecord = await admin.auth().getUserByEmail(email);
            await logSystemAudit(userRecord.uid, email, "PASSWORD_RESET", {}, "SUCCESS");
        } catch (auditErr) {
            logger.warn("Audit trail write failed for PASSWORD_RESET:", auditErr);
        }
    }

    return { success: true };
});

exports.recalculateStats = onCall(async (request) => {
    const { auth } = request;
    if (!auth) throw new HttpsError("unauthenticated", "Must be authenticated.");

    const callerDoc = await admin.firestore().collection("users").doc(auth.uid).get();
    if (!callerDoc.exists || callerDoc.data().role !== "MIS") {
        throw new HttpsError("permission-denied", "Only MIS can recalculate stats.");
    }

    try {
        const [usersSnapshot, projectsSnapshot] = await Promise.all([
            admin.firestore().collection("users").get(),
            admin.firestore().collection("projects").get(),
        ]);

        const users = usersSnapshot.docs.map(d => d.data());
        const projects = projectsSnapshot.docs.map(d => d.data());

        const engineerCount = users.filter(u => u.role === "PROJ_ENG" || u.role === "Project Engineer").length;
        const DEPT_ROLES = ["MAYOR", "HCSD", "CPDO"];
        const rolesPresent = new Set(users.map(u => u.role));
        const departmentCount = DEPT_ROLES.filter(r => rolesPresent.has(r)).length;
        const projectCount = projects.length;
        const totalBudget = projects.reduce((acc, p) => acc + (Number(p.contractAmount) || 0), 0);

        const now = new Date();
        const done = projects.filter(p => p.status === "Completed").length;
        const delayed = projects.filter(p => p.status === "Delayed").length;
        const ongoing = projects.filter(p => p.status === "Ongoing").length;
        const delay = projects.filter(p => {
            if (p.status === "Completed") return false;
            const completionDate = p.originalDateCompletion || p.revisedDate2 || p.revisedDate1;
            return completionDate ? new Date(completionDate) < now : false;
        }).length;

        await admin.firestore().doc("stats/public").set({
            engineerCount,
            departmentCount,
            projectCount,
            totalBudget,
            done,
            delayed,
            progress: ongoing,
            delay,
            lastUpdated: new Date().toISOString(),
        });

        await logSystemAudit(auth.uid, auth.token.email, "STATS_RECALCULATED",
            { engineerCount, departmentCount, projectCount, totalBudget }, "SUCCESS");

        return { success: true, engineerCount, departmentCount, projectCount, totalBudget };
    } catch (error) {
        logger.error("Error recalculating stats:", error);
        throw new HttpsError("internal", "Unable to recalculate stats. Please try again.");
    }
});

// ─── TRIGGER: Recompute public stats on user writes ─────────────────────────
exports.onUserWritten = onDocumentWritten("users/{userId}", async () => {
    try {
        const usersSnapshot = await admin.firestore().collection("users").get();
        const users = usersSnapshot.docs.map(doc => doc.data());

        const engineerCount = users.filter(u =>
            u.role === "PROJ_ENG" || u.role === "Project Engineer"
        ).length;

        const DEPT_ROLES = ["MAYOR", "HCSD", "CPDO"];
        const rolesPresent = new Set(users.map(u => u.role));
        const departmentCount = DEPT_ROLES.filter(r => rolesPresent.has(r)).length;

        await admin.firestore().doc("stats/public").set(
            { engineerCount, departmentCount, lastUpdated: new Date().toISOString() },
            { merge: true }
        );
    } catch (error) {
        logger.error("[onUserWritten] Failed to update stats:", error);
    }
});

// ─── TRIGGER: Recompute public stats on project writes ──────────────────────
exports.onProjectWritten = onDocumentWritten("projects/{projectId}", async () => {
    try {
        const projectsSnapshot = await admin.firestore().collection("projects").get();
        const projects = projectsSnapshot.docs.map(doc => doc.data());

        const projectCount = projects.length;
        const totalBudget = projects.reduce((acc, p) => acc + (Number(p.contractAmount) || 0), 0);

        const now = new Date();
        const done = projects.filter(p => p.status === "Completed").length;
        const delayed = projects.filter(p => p.status === "Delayed").length;
        const ongoing = projects.filter(p => p.status === "Ongoing").length;
        const delay = projects.filter(p => {
            if (p.status === "Completed") return false;
            const completionDate = p.originalDateCompletion || p.revisedDate2 || p.revisedDate1;
            return completionDate ? new Date(completionDate) < now : false;
        }).length;

        await admin.firestore().doc("stats/public").set(
            { projectCount, totalBudget, done, delayed, progress: ongoing, delay, lastUpdated: new Date().toISOString() },
            { merge: true }
        );
    } catch (error) {
        logger.error("[onProjectWritten] Failed to update stats:", error);
    }
});

// ─── CLOUD FUNCTION: Update Profile Photo ────────────────────────────────────
exports.updateProfilePhoto = onCall(async (request) => {
    const { auth, data } = request;
    if (!auth) throw new HttpsError("unauthenticated", "Must be authenticated to update profile photo.");

    const { photoURL } = data;
    if (!photoURL || typeof photoURL !== "string") {
        throw new HttpsError("invalid-argument", "Invalid photo URL.");
    }
    // Validate URL is a Firebase Storage download URL for this user's profile photo
    if (!photoURL.startsWith("https://firebasestorage.googleapis.com/")) {
        throw new HttpsError("invalid-argument", "Invalid photo source.");
    }
    if (!photoURL.includes(`/o/profile-photos%2F${auth.uid}`)) {
        throw new HttpsError("invalid-argument", "Photo path does not match authenticated user.");
    }

    const userRef = admin.firestore().collection("users").doc(auth.uid);
    const userDoc = await userRef.get();
    if (userDoc.exists) {
        const { photoChangedAt } = userDoc.data();
        const COOLDOWN_MS = 30 * 1000;
        if (photoChangedAt && Date.now() - photoChangedAt < COOLDOWN_MS) {
            const secondsLeft = Math.ceil((COOLDOWN_MS - (Date.now() - photoChangedAt)) / 1000);
            throw new HttpsError("resource-exhausted", `Please wait ${secondsLeft} second(s) before updating your photo again.`);
        }
    }

    try {
        await userRef.update({ photoURL, photoChangedAt: Date.now() });
        await admin.auth().updateUser(auth.uid, { photoURL });

        const role = userDoc.exists ? userDoc.data().role : null;
        const userData = userDoc.exists ? userDoc.data() : {};
        const actorName = [userData.firstName, userData.lastName].filter(Boolean).join(" ") || auth.token.email;

        if (role === "HCSD") {
            await logAudit(auth.uid, auth.token.email, "PHOTO_UPDATED", auth.uid, {
                actorName,
                note: "Profile photo updated",
            });
        }
        await logSystemAudit(auth.uid, auth.token.email, "PROFILE_PHOTO_UPDATED", {}, "SUCCESS");

        return { success: true };
    } catch (error) {
        logger.error("Error updating profile photo:", error);
        throw new HttpsError("internal", "Unable to update profile photo. Please try again.");
    }
});

// ─── CLOUD FUNCTION: Update Profile Name ─────────────────────────────────────
exports.updateProfile = onCall(async (request) => {
    const { auth, data } = request;
    if (!auth) throw new HttpsError("unauthenticated", "Must be authenticated to update profile.");

    const nameSchema = z.object({
        firstName: z.string().min(2).max(50).regex(/^[a-zA-Z\s\-']+$/, "First name contains invalid characters."),
        lastName: z.string().min(2).max(50).regex(/^[a-zA-Z\s\-']+$/, "Last name contains invalid characters."),
    });

    const parsed = nameSchema.safeParse(data);
    if (!parsed.success) {
        throw new HttpsError("invalid-argument", parsed.error.errors[0]?.message ?? "Invalid name.");
    }

    const { firstName, lastName } = parsed.data;

    const userRef = admin.firestore().collection("users").doc(auth.uid);
    const userDoc = await userRef.get();
    const userData = userDoc.exists ? userDoc.data() : {};

    if (userDoc.exists) {
        const { nameChangedAt } = userData;
        const COOLDOWN_MS = 60 * 1000;
        if (nameChangedAt && Date.now() - nameChangedAt < COOLDOWN_MS) {
            const secondsLeft = Math.ceil((COOLDOWN_MS - (Date.now() - nameChangedAt)) / 1000);
            throw new HttpsError("resource-exhausted", `Please wait ${secondsLeft} second(s) before updating your name again.`);
        }
    }

    const oldName = userData.firstName && userData.lastName
        ? `${userData.firstName} ${userData.lastName}`
        : null;

    try {
        await userRef.update({ firstName, lastName, nameChangedAt: Date.now() });
        await admin.auth().updateUser(auth.uid, { displayName: `${firstName} ${lastName}` });
        await logSystemAudit(
            auth.uid, auth.token.email, "PROFILE_UPDATED",
            { oldName: oldName ?? "—", newName: `${firstName} ${lastName}` },
            "SUCCESS", `${firstName} ${lastName}`
        );
        return { success: true };
    } catch (error) {
        logger.error("Error updating profile:", error);
        throw new HttpsError("internal", "Unable to update name. Please try again.");
    }
});
