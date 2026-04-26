const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { onDocumentWritten, onDocumentCreated } = require("firebase-functions/v2/firestore");
const { setGlobalOptions } = require("firebase-functions/v2/options");
const { defineSecret } = require("firebase-functions/params");
const logger = require("firebase-functions/logger");

const admin = require("firebase-admin");
const crypto = require("crypto");
const nodemailer = require("nodemailer");
const { z } = require("zod");

admin.initializeApp();
setGlobalOptions({ region: "asia-southeast1" });

// â”€â”€â”€ Secrets â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const gmailUser = defineSecret("GMAIL_USER");
const gmailAppPassword = defineSecret("GMAIL_APP_PASSWORD");

// â”€â”€â”€ Email Transport â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const createTransporter = () => nodemailer.createTransport({
    service: "gmail",
    auth: {
        user: gmailUser.value(),
        pass: gmailAppPassword.value(),
    },
});

// â”€â”€â”€ Zod validation schemas â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const createAccountSchema = z.object({
    email: z.string().email().max(100),
    firstName: z.string().min(2).max(50).regex(/^[a-zA-Z\s\-']+$/, "First name contains invalid characters"),
    lastName: z.string().min(2).max(50).regex(/^[a-zA-Z\s\-']+$/, "Last name contains invalid characters"),
    roleType: z.enum(["HCSD", "PROJ_ENG"]),
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
    contractAmount: z.number().min(10000, "Minimum contract amount is â‚±10,000").max(1_000_000_000),

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

// Tenant provisioning input. tenantId format is {lgu-slug}-{psgc-10-digit},
// e.g. "cebu-city-0730600000". The slug must be lowercase alphanumeric with
// hyphens (no leading/trailing hyphen). The 10-digit PSGC code is per PSGC
// Revision 1, PSA Board Resolution No. 07 Series of 2021. classification
// must be one of the four LGU classifications recognized by DILG.
const provisionTenantSchema = z.object({
    tenantId: z.string().min(12).max(100).regex(
        /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?-\d{10}$/,
        "tenantId must be {lgu-slug}-{psgc-10-digit}, e.g. cebu-city-0730600000",
    ),
    lguName: z.string().min(2).max(100),
    province: z.string().min(2).max(100),
    region: z.string().min(2).max(100),
    classification: z.enum([
        "Highly Urbanized City",
        "Independent Component City",
        "Component City",
        "Municipality",
    ]),
    contractReference: z.string().min(1).max(100),
    firstMisAdminEmail: z.string().email().max(100),
});

// â”€â”€â”€ Helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

// Cryptographically secure password generator
const generatePassword = (length = 16) => {
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*";
    let password = "";
    for (let i = 0; i < length; i++) {
        password += chars.charAt(crypto.randomInt(chars.length));
    }
    return password;
};

// Tenant-claim guard. Every authenticated callable that touches Firestore
// must pass through this so a missing tenantId fails loudly instead of
// silently writing an unscoped document. Returns the tenantId on success.
const requireTenantClaim = (auth) => {
    const tenantId = auth?.token?.tenantId;
    if (!tenantId || typeof tenantId !== "string") {
        throw new HttpsError(
            "failed-precondition",
            "Account is not assigned to a tenant. Contact your administrator.",
        );
    }
    return tenantId;
};

// Platform-admin guard for tenant provisioning / lifecycle ops. The
// platformAdmin claim is granted via scripts/grant-platform-admin.js and
// never set by any callable, so it cannot be self-elevated.
const requirePlatformAdmin = (auth) => {
    if (!auth || auth.token?.platformAdmin !== true) {
        throw new HttpsError(
            "permission-denied",
            "This action requires platform administrator privileges.",
        );
    }
};

// Write an audit trail entry, HCSD-scoped. tenantId is required so the
// document carries the same tenant stamp the read-side rules check against.
const logAudit = async (actorUid, actorEmail, action, targetId, details, tenantId) => {
    try {
        if (!tenantId) {
            logger.error(`logAudit called without tenantId for action=${action}; refusing to write unscoped doc`);
            return;
        }
        await admin.firestore().collection("auditTrails").doc("hcsd").collection("entries").add({
            timestamp: admin.firestore.FieldValue.serverTimestamp(),
            actorUid,
            actorEmail: actorEmail || null,
            action,
            targetId: targetId ?? null,
            details: details ?? {},
            tenantId,
        });
    } catch (err) {
        logger.error("Audit trail write failed:", err);
    }
};

// Write a system-level audit trail entry, MIS-scoped, append-only. tenantId
// is required.
const logSystemAudit = async (actorUid, actorEmail, action, target, status, actorName, tenantId) => {
    try {
        if (!tenantId) {
            logger.error(`logSystemAudit called without tenantId for action=${action}; refusing to write unscoped doc`);
            return;
        }
        const actor = { uid: actorUid, email: actorEmail || null };
        if (actorName) actor.name = actorName;
        await admin.firestore().collection("auditTrails").doc("mis").collection("entries").add({
            action,
            actor,
            target: target ?? {},
            status: status ?? "SUCCESS",
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            tenantId,
        });
    } catch (err) {
        logger.error("System audit trail write failed:", err);
    }
};

// Write a platform-scope audit entry. Used only by tenant provisioning /
// lifecycle ops. tenantId here is the SUBJECT tenant (the one being
// provisioned), not the actor's tenant (platform admins have no tenant).
const logPlatformAudit = async (actorUid, actorEmail, action, target, status, tenantId) => {
    try {
        await admin.firestore().collection("auditTrails").doc("_platform").collection("entries").add({
            action,
            actor: { uid: actorUid, email: actorEmail || null },
            target: target ?? {},
            status: status ?? "SUCCESS",
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            tenantId: tenantId ?? null,
        });
    } catch (err) {
        logger.error("Platform audit trail write failed:", err);
    }
};

// Write a user-facing notification document. Narrow payload on purpose â€”
// recipientUid is queried by the client; severity drives the visual variant;
// isRead/dismissedAt are the only fields the client may mutate (rules enforced).
//
// category split:
//   "system" - admin/operational events from the web side (assignments,
//              provisioning). Default.
//   "field"  - mobile PROJ_ENG activity on a project (photo, milestones,
//              completion submit). Feeds the Notifications page "Field
//              Activity" tab and never lands in the Audit Trail.
const createNotification = async ({
    recipientUid,
    action,
    severity = "info",
    category = "system",
    title,
    body,
    targetType = null,
    targetId = null,
    metadata = {},
    tenantId,
}) => {
    try {
        if (!recipientUid) return;
        if (!tenantId) {
            logger.error("createNotification called without tenantId; refusing to write unscoped doc");
            return;
        }
        await admin.firestore().collection("notifications").add({
            recipientUid,
            action,
            severity,
            category,
            title,
            body,
            targetType,
            targetId,
            metadata,
            isRead: false,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            tenantId,
        });
    } catch (err) {
        logger.error("Notification write failed:", err);
    }
};

// Server-side filename hardening for NTP uploads. Client sanitization is a UX
// nicety; this is the security control. Returns null on pass, or an error msg.
const validateNtpFilename = (name) => {
    if (!name || typeof name !== "string" || name.length < 1 || name.length > 255) {
        return "Invalid filename length";
    }
    if (!/^[A-Za-z0-9._-]+$/.test(name)) {
        return "Filename contains disallowed characters";
    }
    if (name.startsWith(".") || name.includes("..")) {
        return "Invalid filename";
    }
    if (/\.(exe|bat|cmd|sh|ps1|js|jar|php|html?)\./i.test(name)) {
        return "Suspicious double extension";
    }
    if (!/\.(pdf|jpe?g|png)$/i.test(name)) {
        return "Unsupported file extension";
    }
    return null;
};

// Per-user rolling-hour rate limit. Guards against compromised or abusive
// accounts by capping the blast radius of sensitive callables (NTP uploads,
// project creation). Each collection holds { count, windowStartAt, tenantId,
// uid } per uid. tenantId is stamped on the doc so rules can scope reads
// (clients are blocked from these collections anyway, but the field keeps
// the document model consistent and allows tenant-scoped maintenance ops).
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;
const enforceRateLimit = async (collection, uid, max, errorMsg, tenantId) => {
    const rlRef = admin.firestore().doc(`${collection}/${uid}`);
    await admin.firestore().runTransaction(async (tx) => {
        const snap = await tx.get(rlRef);
        const now = Date.now();
        if (!snap.exists) {
            tx.set(rlRef, {
                count: 1,
                windowStartAt: admin.firestore.FieldValue.serverTimestamp(),
                uid,
                tenantId: tenantId ?? null,
            });
            return;
        }
        const data = snap.data();
        const windowStart = data.windowStartAt?.toMillis?.() ?? 0;
        if (now - windowStart > RATE_LIMIT_WINDOW_MS) {
            tx.set(rlRef, {
                count: 1,
                windowStartAt: admin.firestore.FieldValue.serverTimestamp(),
                uid,
                tenantId: tenantId ?? null,
            });
            return;
        }
        if ((data.count || 0) >= max) {
            throw new HttpsError("resource-exhausted", errorMsg);
        }
        tx.update(rlRef, { count: admin.firestore.FieldValue.increment(1) });
    });
};

const enforceNtpRateLimit = (uid, tenantId) =>
    enforceRateLimit("ntpRateLimits", uid, 20, "Too many NTP uploads. Try again in an hour.", tenantId);

const enforceCreateProjectRateLimit = (uid, tenantId) =>
    enforceRateLimit("projectCreateRateLimits", uid, 10, "Too many project submissions. Try again in an hour.", tenantId);

// â”€â”€â”€ CLOUD FUNCTION: Send OTP â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

    // Derive tenantId for the otpCodes doc stamp. Claim is the primary
    // source; userDoc is a fallback for accounts whose claim was wiped by
    // pre-refactor OTP code. New accounts always have the claim.
    const sendOtpUserDoc = await admin.firestore().collection("users").doc(uid).get();
    const sendOtpTenantId = auth.token?.tenantId
        || (sendOtpUserDoc.exists ? sendOtpUserDoc.data().tenantId : null)
        || null;

    await admin.firestore().collection("otpCodes").doc(uid).set({
        code: otpCode,
        email: userEmail,
        sentAt,
        expiresAt,
        attempts: 0,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        tenantId: sendOtpTenantId,
    });

    // Additive claim update: preserve all existing claims (including
    // tenantId), only reset the OTP fields. Restore role from Firestore
    // only if it's missing from claims (covers legacy accounts whose role
    // got wiped by older OTP code).
    const sendOtpUser = await admin.auth().getUser(uid);
    const sendOtpExisting = sendOtpUser.customClaims || {};
    let sendOtpRole = sendOtpExisting.role;
    if (!sendOtpRole) {
        sendOtpRole = sendOtpUserDoc.exists ? sendOtpUserDoc.data().role : undefined;
    }
    const sendOtpNextClaims = { ...sendOtpExisting, otpVerified: false, otpVerifiedAtAuthTime: 0 };
    if (sendOtpRole) sendOtpNextClaims.role = sendOtpRole;
    await admin.auth().setCustomUserClaims(uid, sendOtpNextClaims);

    try {
        const transporter = createTransporter();
        await transporter.sendMail({
            from: `"TranspiraFund LGU Portal" <${gmailUser.value()}>`,
            to: userEmail,
            subject: "TranspiraFund â€” Your Verification Code",
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

// â”€â”€â”€ CLOUD FUNCTION: Verify OTP â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

    // Additive claim update: preserve all existing claims (including
    // tenantId), only set the OTP verification fields. Restore role from
    // Firestore only if it's missing from claims (covers legacy accounts
    // whose role got wiped).
    const userDoc = await admin.firestore().collection("users").doc(uid).get();
    const userRole = userDoc.exists ? userDoc.data().role : null;
    const userName = userDoc.exists
        ? `${userDoc.data().firstName || ""} ${userDoc.data().lastName || ""}`.trim()
        : null;
    // Tenant resolution: claim first, userDoc fallback for legacy accounts.
    const userTenantId = auth.token?.tenantId
        || (userDoc.exists ? userDoc.data().tenantId : null)
        || null;

    const authTime = auth.token.auth_time;
    const verifyOtpUser = await admin.auth().getUser(uid);
    const verifyOtpExisting = verifyOtpUser.customClaims || {};
    const verifyOtpNextClaims = { ...verifyOtpExisting, otpVerified: true, otpVerifiedAtAuthTime: authTime };
    if (!verifyOtpNextClaims.role && userRole) verifyOtpNextClaims.role = userRole;
    await admin.auth().setCustomUserClaims(uid, verifyOtpNextClaims);

    if (userRole === "HCSD") {
        await logAudit(uid, auth.token.email, "USER_LOGIN", uid, { role: userRole, name: userName }, userTenantId);
    } else {
        await logSystemAudit(uid, auth.token.email, "USER_LOGIN", { uid, role: userRole, name: userName }, "SUCCESS", userName, userTenantId);
    }

    await logSystemAudit(uid, auth.token.email, "OTP_VERIFIED", {}, "SUCCESS", null, userTenantId);
    return { success: true };
});

// â”€â”€â”€ CLOUD FUNCTION: Create Official Account â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
exports.createOfficialAccount = onCall({ secrets: [gmailUser, gmailAppPassword] }, async (request) => {
    const { data, auth } = request;
    if (!auth) throw new HttpsError("unauthenticated", "The function must be called while authenticated.");

    // Caller must have a tenantId claim. The new account inherits it.
    const callerTenantId = requireTenantClaim(auth);

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

        // Additive claim merge. Brand-new users have no existing claims, but
        // the pattern matches sendOtp / verifyOtp so any future claim added
        // outside this callable will not get clobbered. tenantId is set here
        // and never rewritten anywhere else.
        const newUserRecord = await admin.auth().getUser(userRecord.uid);
        const existingClaims = newUserRecord.customClaims || {};
        await admin.auth().setCustomUserClaims(userRecord.uid, {
            ...existingClaims,
            role: roleType,
            tenantId: callerTenantId,
            otpVerified: false,
            otpVerifiedAtAuthTime: 0,
        });

        await admin.firestore().collection("users").doc(userRecord.uid).set({
            uid: userRecord.uid,
            email,
            firstName,
            lastName,
            role: roleType,
            tenantId: callerTenantId,
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
            subject: "TranspiraFund â€” Your Account Has Been Created",
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

        // Audit trail â€” route by caller role
        const callerName = `${callerDoc.data().firstName} ${callerDoc.data().lastName}`;
        if (callerRole === "MIS") {
            await logSystemAudit(auth.uid, auth.token.email, "ACCOUNT_CREATED",
                { email, role: roleType, department: department || "" },
                "SUCCESS", callerName, callerTenantId);
        } else {
            await logAudit(auth.uid, auth.token.email, "ACCOUNT_CREATED", userRecord.uid, {
                email, roleType, department: department || "",
            }, callerTenantId);
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

// ─── CLOUD FUNCTION: Provision Tenant ─────────────────────────────────────
// Platform-admin-only. Creates a new tenant document and the first MIS Admin
// account for that tenant. The platform admin's own session does NOT need a
// tenantId claim (super-admins have no tenant); the new tenant's id is the
// one passed in the payload, which is then stamped on the new MIS account's
// claims and Firestore docs. Bootstrap a platform admin via:
//   node scripts/grant-platform-admin.js <uid>
exports.provisionTenant = onCall({ secrets: [gmailUser, gmailAppPassword] }, async (request) => {
    const { data, auth } = request;
    if (!auth) throw new HttpsError("unauthenticated", "Must be authenticated.");
    requirePlatformAdmin(auth);

    const parsed = provisionTenantSchema.safeParse(data);
    if (!parsed.success) {
        const msg = parsed.error.errors[0]?.message ?? "Invalid input.";
        throw new HttpsError("invalid-argument", msg);
    }
    const {
        tenantId, lguName, province, region, classification,
        contractReference, firstMisAdminEmail,
    } = parsed.data;

    // Reject if tenant already exists. Idempotency is intentionally not
    // baked in: a duplicate provision is a mistake worth surfacing.
    const tenantRef = admin.firestore().collection("tenants").doc(tenantId);
    const tenantSnap = await tenantRef.get();
    if (tenantSnap.exists) {
        throw new HttpsError("already-exists", `Tenant '${tenantId}' is already provisioned.`);
    }

    const tempPassword = generatePassword();
    let userRecord;

    try {
        userRecord = await admin.auth().createUser({
            email: firstMisAdminEmail,
            password: tempPassword,
            displayName: `${lguName} MIS Admin`,
        });
    } catch (error) {
        logger.error("provisionTenant: createUser failed:", error);
        if (error.code === "auth/email-already-exists") {
            throw new HttpsError("already-exists", "An account with this email already exists.");
        }
        throw new HttpsError("internal", "Unable to create the MIS admin account.");
    }

    try {
        // Tenant doc first so the new user's tenantId stamp points at a
        // real, queryable tenant. Status seeds to "active"; lifecycle ops
        // (suspend / archive) belong to a separate v2 callable.
        await tenantRef.set({
            tenantId,
            lguName,
            province,
            region,
            classification,
            status: "active",
            dateOnboarded: admin.firestore.FieldValue.serverTimestamp(),
            contractReference,
        });

        // Additive claim merge (matches sendOtp / verifyOtp / createOfficialAccount).
        const newUserRecord = await admin.auth().getUser(userRecord.uid);
        const existingClaims = newUserRecord.customClaims || {};
        await admin.auth().setCustomUserClaims(userRecord.uid, {
            ...existingClaims,
            role: "MIS",
            tenantId,
            otpVerified: false,
            otpVerifiedAtAuthTime: 0,
        });

        await admin.firestore().collection("users").doc(userRecord.uid).set({
            uid: userRecord.uid,
            email: firstMisAdminEmail,
            firstName: "MIS",
            lastName: "Admin",
            role: "MIS",
            tenantId,
            department: "Management Information Systems",
            status: "Active",
            mustChangePassword: true,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            createdBy: auth.uid,
        });

        const transporter = createTransporter();
        await transporter.sendMail({
            from: `"TranspiraFund Platform" <${gmailUser.value()}>`,
            to: firstMisAdminEmail,
            subject: `TranspiraFund — ${lguName} has been onboarded`,
            html: `
                <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;background:#f8fafc;border-radius:12px;">
                    <h2 style="color:#0f766e;font-size:22px;margin-bottom:8px;">Welcome to TranspiraFund</h2>
                    <p style="color:#475569;font-size:15px;margin-bottom:8px;">${lguName} has been onboarded as an LGU on TranspiraFund. You have been provisioned as the first MIS Administrator for this tenant.</p>
                    <div style="background:#fff;border:1px solid #e2e8f0;border-radius:8px;padding:20px;margin:24px 0;">
                        <p style="margin:0 0 8px;color:#64748b;font-size:13px;font-weight:bold;text-transform:uppercase;letter-spacing:.05em;">Login Email</p>
                        <p style="margin:0 0 16px;color:#1e293b;font-size:15px;font-weight:600;">${firstMisAdminEmail}</p>
                        <p style="margin:0 0 8px;color:#64748b;font-size:13px;font-weight:bold;text-transform:uppercase;letter-spacing:.05em;">Temporary Password</p>
                        <p style="margin:0;color:#1e293b;font-size:18px;font-weight:bold;letter-spacing:2px;font-family:monospace;">${tempPassword}</p>
                    </div>
                    <p style="color:#dc2626;font-size:13px;font-weight:600;">You will be required to change your password on first login. Do not share this email with anyone.</p>
                </div>
            `,
        });

        await logPlatformAudit(
            auth.uid, auth.token.email, "TENANT_PROVISIONED",
            { tenantId, lguName, classification, contractReference, firstMisAdminUid: userRecord.uid, firstMisAdminEmail },
            "SUCCESS", tenantId,
        );

        return {
            success: true,
            tenantId,
            firstMisAdminUid: userRecord.uid,
            message: `${lguName} provisioned. Credentials sent to ${firstMisAdminEmail}.`,
        };
    } catch (error) {
        // Best-effort rollback so a half-provisioned tenant does not linger.
        // We only delete the Auth user we created in this invocation; the
        // tenant doc is removed first since it has no foreign-key tail.
        logger.error("provisionTenant: post-createUser step failed, rolling back:", error);
        try { await tenantRef.delete(); } catch (e) { logger.error("Rollback: tenant doc delete failed:", e); }
        try { await admin.firestore().collection("users").doc(userRecord.uid).delete(); } catch (e) { logger.error("Rollback: user doc delete failed:", e); }
        try { await admin.auth().deleteUser(userRecord.uid); } catch (e) { logger.error("Rollback: auth user delete failed:", e); }

        await logPlatformAudit(
            auth.uid, auth.token.email, "TENANT_PROVISION_FAILED",
            { tenantId, lguName, error: error.message ?? String(error) },
            "FAILURE", tenantId,
        );
        throw new HttpsError("internal", "Tenant provisioning failed and was rolled back. Please try again.");
    }
});

// â”€â”€â”€ CLOUD FUNCTION: Delete Official Account â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
exports.deleteOfficialAccount = onCall(async (request) => {
    const { data, auth } = request;
    if (!auth) throw new HttpsError("unauthenticated", "Must be authenticated to delete accounts.");
    const callerTenantId = requireTenantClaim(auth);

    const callerDoc = await admin.firestore().collection("users").doc(auth.uid).get();
    if (!callerDoc.exists) throw new HttpsError("permission-denied", "User profile not found.");
    const callerRole = callerDoc.data().role;
    if (!["MIS", "HCSD"].includes(callerRole)) throw new HttpsError("permission-denied", "Insufficient permissions to delete accounts.");

    const { uid } = data;
    if (!uid || typeof uid !== "string") throw new HttpsError("invalid-argument", "User UID is required.");

    // Single read of the target. We need both the role-class check (HCSD may
    // only delete PROJ_ENG) and the tenant check (no caller may delete
    // accounts outside their own tenant, even with the role check intact).
    const targetDoc = await admin.firestore().collection("users").doc(uid).get();
    if (!targetDoc.exists) {
        throw new HttpsError("not-found", "Target account not found.");
    }
    const targetData = targetDoc.data();
    if (targetData.tenantId !== callerTenantId) {
        throw new HttpsError("permission-denied", "Cannot delete an account from another tenant.");
    }
    if (callerRole === "HCSD" && targetData.role !== "PROJ_ENG") {
        throw new HttpsError("permission-denied", "HCSD can only revoke Project Engineer access.");
    }

    try {
        const targetEmail = targetData.email ?? null;
        const targetRole = targetData.role ?? null;

        await admin.auth().deleteUser(uid);
        await admin.firestore().collection("users").doc(uid).delete();

        // Audit trail â€” route by caller role
        if (callerRole === "MIS") {
            await logSystemAudit(auth.uid, auth.token.email, "ACCOUNT_DELETED",
                { uid, email: targetEmail, role: targetRole }, "SUCCESS", null, callerTenantId);
        } else {
            await logAudit(auth.uid, auth.token.email, "ACCOUNT_DELETED", uid, { deletedEmail: targetEmail }, callerTenantId);
        }

        return { success: true, message: "Account deleted successfully." };
    } catch (error) {
        logger.error("Error deleting user:", error);
        throw new HttpsError("internal", "Unable to delete account. Please try again.");
    }
});

// â”€â”€â”€ CLOUD FUNCTION: Create Project â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
exports.createProject = onCall(async (request) => {
    const { auth, data } = request;
    if (!auth) throw new HttpsError("unauthenticated", "Must be authenticated to create projects.");
    const callerTenantId = requireTenantClaim(auth);

    const callerDoc = await admin.firestore().collection("users").doc(auth.uid).get();
    if (!callerDoc.exists || callerDoc.data().role !== "HCSD") {
        throw new HttpsError("permission-denied", "Only HCSD personnel can create projects.");
    }

    await enforceCreateProjectRateLimit(auth.uid, callerTenantId);

    // Firebase callable SDK sends null for absent optional fields; convert null â†’ undefined before validation
    const sanitized = Object.fromEntries(
        Object.entries(data || {}).map(([k, v]) => [k, v === null ? undefined : v])
    );

    // Validate project data
    const parsed = createProjectSchema.safeParse(sanitized);
    if (!parsed.success) {
        const msg = parsed.error.errors[0]?.message ?? "Invalid project data.";
        throw new HttpsError("invalid-argument", msg);
    }
    // Strip undefined/null values â€” Firestore rejects undefined fields
    const projectFields = Object.fromEntries(
        Object.entries(parsed.data).filter(([, v]) => v !== undefined && v !== null)
    );

    // Cross-tenant assignment guard: HCSD can pass any UID for projectEngineer
    // via the form, but we must reject anyone not in the same tenant.
    if (projectFields.projectEngineer) {
        const peDoc = await admin.firestore().collection("users").doc(projectFields.projectEngineer).get();
        if (!peDoc.exists || peDoc.data().tenantId !== callerTenantId) {
            throw new HttpsError("permission-denied", "Assigned project engineer is not in your tenant.");
        }
    }

    try {
        const projectRef = await admin.firestore().collection("projects").add({
            ...projectFields,
            status: projectFields.projectEngineer ? "Ongoing" : "Delayed",
            progress: 0,
            createdBy: auth.uid,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            tenantId: callerTenantId,
        });

        // Audit trail
        await logAudit(auth.uid, auth.token.email, "PROJECT_CREATED", projectRef.id, {
            projectName: projectFields.projectName,
            contractAmount: projectFields.contractAmount,
            barangay: projectFields.barangay,
        }, callerTenantId);

        // Notify assigned Project Engineer (if any)
        if (projectFields.projectEngineer) {
            await createNotification({
                recipientUid: projectFields.projectEngineer,
                action: "PROJECT_ASSIGNED",
                severity: "info",
                title: "New project assigned",
                body: `${projectFields.projectName}, ${projectFields.barangay}`,
                targetType: "project",
                targetId: projectRef.id,
                tenantId: callerTenantId,
            });
        }

        return { success: true, projectId: projectRef.id };
    } catch (error) {
        logger.error("Error creating project:", error);
        throw new HttpsError("internal", "Unable to create project. Please try again.");
    }
});

// â”€â”€â”€ CLOUD FUNCTION: Attach NTP document to a project â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// HCSD uploads the NTP file to Storage at projects/{projectId}/ntp/{fileName}
// first, then calls this to persist the metadata on the project doc, log the
// audit entry, and notify the assigned PE.
const NTP_ALLOWED_CONTENT_TYPES = ["application/pdf", "image/jpeg", "image/png"];
const NTP_MAX_BYTES = 10 * 1024 * 1024;
const NTP_MIN_BYTES = 1024;

const NTP_MAGIC_BYTES = {
    "application/pdf": Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2D]),
    "image/jpeg": Buffer.from([0xFF, 0xD8, 0xFF]),
    "image/png": Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
};

const attachNtpSchema = z.object({
    projectId: z.string().min(1).max(128),
    fileName: z.string().min(1).max(255),
    fileUrl: z.string().url(),
    sizeBytes: z.number().int().min(NTP_MIN_BYTES).max(NTP_MAX_BYTES),
    contentType: z.enum(NTP_ALLOWED_CONTENT_TYPES),
});

exports.attachNtp = onCall(async (request) => {
    const { auth, data } = request;
    if (!auth) throw new HttpsError("unauthenticated", "Must be authenticated to attach NTP.");
    const callerTenantId = requireTenantClaim(auth);

    const callerDoc = await admin.firestore().collection("users").doc(auth.uid).get();
    if (!callerDoc.exists || callerDoc.data().role !== "HCSD") {
        throw new HttpsError("permission-denied", "Only HCSD personnel can attach NTP documents.");
    }

    // Cheap abuse reject before we touch Zod / Storage.
    await enforceNtpRateLimit(auth.uid, callerTenantId);

    const parsed = attachNtpSchema.safeParse(data || {});
    if (!parsed.success) {
        const msg = parsed.error.errors[0]?.message ?? "Invalid NTP payload.";
        throw new HttpsError("invalid-argument", msg);
    }
    const { projectId, fileName, fileUrl, sizeBytes, contentType } = parsed.data;

    const filenameErr = validateNtpFilename(fileName);
    if (filenameErr) {
        await logAudit(auth.uid, auth.token.email, "NTP_REJECTED", projectId, {
            fileName,
            reason: "filename_violation",
            detail: filenameErr,
        }, callerTenantId);
        throw new HttpsError("invalid-argument", filenameErr);
    }

    const projectRef = admin.firestore().collection("projects").doc(projectId);
    const projectSnap = await projectRef.get();
    if (!projectSnap.exists) {
        throw new HttpsError("not-found", "Project not found.");
    }
    const projectData = projectSnap.data();
    if (projectData.tenantId !== callerTenantId) {
        throw new HttpsError("permission-denied", "Cannot attach NTP to a project in another tenant.");
    }

    // Magic-byte verification â€” the only check that actually sees the bytes.
    // Client-reported contentType and file extension are both spoofable; this
    // proves the uploaded object is plausibly what it claims to be.
    const objectPath = `projects/${projectId}/ntp/${fileName}`;
    const storageFile = admin.storage().bucket().file(objectPath);
    let header;
    try {
        const [buf] = await storageFile.download({ start: 0, end: 15 });
        header = buf;
    } catch (err) {
        logger.error("NTP header read failed:", err);
        throw new HttpsError("not-found", "Uploaded file not found in storage.");
    }

    const expected = NTP_MAGIC_BYTES[contentType];
    const magicOk = expected && header.length >= expected.length &&
        header.slice(0, expected.length).equals(expected);

    if (!magicOk) {
        try { await storageFile.delete(); } catch (e) { logger.error("NTP cleanup delete failed:", e); }
        await logAudit(auth.uid, auth.token.email, "NTP_REJECTED", projectId, {
            projectName: projectData.projectName,
            fileName,
            reason: "magic_byte_mismatch",
            declaredType: contentType,
        }, callerTenantId);
        throw new HttpsError("invalid-argument", "File content does not match declared type.");
    }

    try {
        await projectRef.update({
            ntpFileUrl: fileUrl,
            ntpFileName: fileName,
            ntpUploadedAt: admin.firestore.FieldValue.serverTimestamp(),
            ntpUploadedBy: auth.uid,
        });

        // No separate audit row: NTP attachment is part of project creation,
        // already covered by the `PROJECT_CREATED` entry on the same project.
        // No PE notification either: NTP upload is a project-creation
        // requirement on the web side, not a standalone event.

        return { success: true };
    } catch (error) {
        logger.error("Error attaching NTP:", error);
        throw new HttpsError("internal", "Unable to attach NTP. Please try again.");
    }
});

// â”€â”€â”€ CLOUD FUNCTION: Change Password â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
exports.changePassword = onCall(async (request) => {
    const { auth, data } = request;
    if (!auth) throw new HttpsError("unauthenticated", "Must be authenticated to change password.");
    const callerTenantId = requireTenantClaim(auth);

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
        const userRef = admin.firestore().collection("users").doc(auth.uid);
        await userRef.update({
            mustChangePassword: false,
            passwordChangedAt: admin.firestore.FieldValue.serverTimestamp(),
        });

        // Audit trail — MIS scope always; HCSD scope only when the actor is HCSD.
        await logSystemAudit(auth.uid, auth.token.email, "PASSWORD_CHANGED", {}, "SUCCESS", null, callerTenantId);
        const userDoc = await userRef.get();
        if (userDoc.exists && userDoc.data().role === "HCSD") {
            const d = userDoc.data();
            const actorName = [d.firstName, d.lastName].filter(Boolean).join(" ") || auth.token.email;
            await logAudit(auth.uid, auth.token.email, "PASSWORD_CHANGED", auth.uid, { actorName }, callerTenantId);
        }

        return { success: true };
    } catch (error) {
        logger.error("Error changing password:", error);
        throw new HttpsError("internal", "Unable to change password. Please try again.");
    }
});

// â”€â”€â”€ CLOUD FUNCTION: Revoke Other Sessions â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Invalidates all refresh tokens for the current user. The caller's current
// session remains active (they keep their ID token until it expires naturally,
// then their own refresh token is also gone â€” so they'll be forced to re-auth
// the next time their token refreshes). All OTHER active sessions across devices
// will be signed out on their next token refresh (within ~1 hour).
exports.revokeOtherSessions = onCall(async (request) => {
    const { auth } = request;
    if (!auth) throw new HttpsError("unauthenticated", "Must be authenticated.");
    const callerTenantId = requireTenantClaim(auth);

    try {
        await admin.auth().revokeRefreshTokens(auth.uid);
        await logSystemAudit(auth.uid, auth.token.email, "SESSIONS_REVOKED", {}, "SUCCESS", null, callerTenantId);
        const userDoc = await admin.firestore().collection("users").doc(auth.uid).get();
        if (userDoc.exists && userDoc.data().role === "HCSD") {
            const d = userDoc.data();
            const actorName = [d.firstName, d.lastName].filter(Boolean).join(" ") || auth.token.email;
            await logAudit(auth.uid, auth.token.email, "SESSIONS_REVOKED", auth.uid, { actorName }, callerTenantId);
        }
        return { success: true };
    } catch (error) {
        logger.error("Error revoking sessions:", error);
        throw new HttpsError("internal", "Unable to sign out other devices. Please try again.");
    }
});

// ─── CLOUD FUNCTION: Log User Logout ──────────────────────────────────────────
// Called from the HCSD sidebar sign-out button immediately before Firebase
// signOut(). Writes a system-level audit row always, and duplicates to the
// HCSD scope when the actor is HCSD so the administrative trail records the
// logout alongside the matching login. Best-effort — never throws, so a slow
// or failed log write doesn't strand the user on the app.
exports.logUserLogout = onCall(async (request) => {
    const { auth } = request;
    if (!auth) return { success: false };
    try {
        // Best-effort tenant resolution: prefer the claim, fall back to the
        // user doc. We never reject a logout for a missing claim because the
        // user signs out either way; the only consequence is the audit row
        // is skipped (the helpers refuse to write without a tenantId).
        const userDoc = await admin.firestore().collection("users").doc(auth.uid).get();
        const role = userDoc.exists ? userDoc.data().role : null;
        const tenantId = auth.token?.tenantId || (userDoc.exists ? userDoc.data().tenantId : null);
        const actorName = userDoc.exists
            ? [userDoc.data().firstName, userDoc.data().lastName].filter(Boolean).join(" ") || auth.token.email
            : auth.token.email;
        await logSystemAudit(auth.uid, auth.token.email, "USER_LOGOUT", {}, "SUCCESS", actorName, tenantId);
        if (role === "HCSD") {
            await logAudit(auth.uid, auth.token.email, "USER_LOGOUT", auth.uid, { actorName }, tenantId);
        }
        return { success: true };
    } catch (err) {
        logger.error("logUserLogout failed:", err);
        return { success: false };
    }
});

// ─── CALLABLE: Log a mobile-origin audit trail entry ──────────────────────
// Mobile PE app calls this on every audit-worthy local event (sign-in/out,
// milestone confirm/complete, etc). Writes one row to
// auditTrails/mobile/entries (PROJ_ENG-only read per firestore.rules) with
// tenantId stamped from the caller's claim.
//
// Canonical shape per CLAUDE.md:
//   { action, actorUid, createdAt, details, tenantId, targetId?, email? }
//
// Recreates a deployed nodejs20 ghost function whose source was never in
// the repo. Adds the tenantId-required invariant via requireTenantClaim
// so unscoped writes are impossible by construction (matches logAudit at
// 153-156 and logSystemAudit at 175-178). `details` accepts both object
// (canonical) and string (legacy) forms — onMobileAuditCreated already
// tolerates both at line 1628, so we preserve that here. `syncToHCSD` is
// accepted for backward compatibility with the mobile payload but
// deliberately ignored: CLAUDE.md forbids mobile-origin actions from
// bleeding into the HCSD audit trail.
const logMobileAuditTrailSchema = z.object({
    action: z.string().min(1).max(128),
    details: z.union([z.record(z.any()), z.string()]).optional(),
    targetId: z.string().min(1).max(128).optional(),
    email: z.string().email().optional(),
    syncToHCSD: z.boolean().optional(),
});

exports.logMobileAuditTrail = onCall(async (request) => {
    const { auth, data } = request;
    if (!auth) {
        throw new HttpsError("unauthenticated", "Must be authenticated to log audit events.");
    }
    const callerTenantId = requireTenantClaim(auth);

    const parsed = logMobileAuditTrailSchema.safeParse(data || {});
    if (!parsed.success) {
        throw new HttpsError(
            "invalid-argument",
            parsed.error.errors[0]?.message ?? "Invalid audit payload.",
        );
    }
    const { action, details, targetId, email } = parsed.data;

    const doc = {
        action,
        actorUid: auth.uid,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        details: details ?? {},
        tenantId: callerTenantId,
    };
    if (targetId) doc.targetId = targetId;
    const resolvedEmail = email || auth.token?.email || null;
    if (resolvedEmail) doc.email = resolvedEmail;

    try {
        await admin.firestore()
            .collection("auditTrails").doc("mobile").collection("entries")
            .add(doc);
        return { success: true };
    } catch (err) {
        logger.error("logMobileAuditTrail write failed:", err);
        throw new HttpsError("internal", "Failed to log audit event.");
    }
});

// ─── CLOUD FUNCTION: Backfill projectEngineer field (name → UID) ──────────
// One-time maintenance op to convert legacy project docs that stored the
// engineer's display name in `projectEngineer` over to the engineer's UID,
// so Firestore rules and the mobile app query (`projectEngineer == uid`) match.
// HCSD-only. Idempotent â€” safe to run multiple times.
exports.backfillProjectEngineerUids = onCall(async (request) => {
    const { auth } = request;
    if (!auth) throw new HttpsError("unauthenticated", "Must be authenticated.");
    const callerTenantId = requireTenantClaim(auth);

    const callerDoc = await admin.firestore().collection("users").doc(auth.uid).get();
    if (!callerDoc.exists || callerDoc.data().role !== "HCSD") {
        throw new HttpsError("permission-denied", "Only HCSD personnel can run this maintenance task.");
    }

    const normalize = (s) => (s || "").toString().trim().toLowerCase()
        .replace(/^engr\.?\s+/i, "")
        .replace(/\s+/g, " ");

    try {
        // Tenant-scoped scans: HCSD-A may only resolve names against PROJ_ENGs
        // in tenant A, and may only update projects in tenant A. The composite
        // (role + tenantId) read requires a Firestore index; if it errors,
        // fall back to filtering in memory after the role-only query.
        const usersSnap = await admin.firestore().collection("users")
            .where("role", "==", "PROJ_ENG")
            .where("tenantId", "==", callerTenantId)
            .get();

        const nameToUid = new Map();
        const uidSet = new Set();
        usersSnap.docs.forEach(doc => {
            const d = doc.data();
            const full = normalize(`${d.firstName || ""} ${d.lastName || ""}`);
            if (full) nameToUid.set(full, doc.id);
            uidSet.add(doc.id);
        });

        const projSnap = await admin.firestore().collection("projects")
            .where("tenantId", "==", callerTenantId).get();

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

        // Maintenance op — not logged to the HCSD audit trail; results are
        // returned to the caller and visible in Cloud Functions logs.
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

// â”€â”€â”€ CLOUD FUNCTION: Send Password Reset Email â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
exports.sendPasswordReset = onCall({ secrets: [gmailUser, gmailAppPassword] }, async (request) => {
    const { data } = request;
    const { email } = data;

    if (!email || typeof email !== "string") {
        throw new HttpsError("invalid-argument", "Email is required.");
    }

    const cleanEmail = email.trim().toLowerCase();
    const RESET_BASE = "https://transpirafund-webapp.web.app/reset-password";

    // Anti-enumeration tenant lookup: try to resolve email to a tenantId
    // server-side. If the account does not exist, tenantId stays null and
    // the cooldown doc is still written so the response timing matches a
    // hit. The caller never sees the result of this lookup.
    let tenantId = null;
    try {
        const userRecord = await admin.auth().getUserByEmail(cleanEmail);
        const userDoc = await admin.firestore().collection("users").doc(userRecord.uid).get();
        if (userDoc.exists) tenantId = userDoc.data().tenantId || null;
    } catch (lookupErr) {
        // Swallow auth/user-not-found; do not let any other error change
        // the response shape (the next call to generatePasswordResetLink
        // will hit the same condition and be silently absorbed below).
    }

    // Rate limiting â€” consistent for registered and unregistered emails (anti-enumeration)
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
        tenantId,
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
            subject: "TranspiraFund â€” Password Reset Request",
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

    // Always return success â€” never reveal whether the email exists
    return { success: true };
});

// â”€â”€â”€ CLOUD FUNCTION: Reset Password â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

    // Audit trail â€” non-blocking. Tenant resolved server-side from the
    // post-reset email; client never sees or supplies a tenantId.
    const email = resetResult?.email;
    if (email) {
        try {
            const userRecord = await admin.auth().getUserByEmail(email);
            const userDoc = await admin.firestore().collection("users").doc(userRecord.uid).get();
            const tenantId = userDoc.exists ? (userDoc.data().tenantId || null) : null;
            await logSystemAudit(userRecord.uid, email, "PASSWORD_RESET", {}, "SUCCESS", null, tenantId);
        } catch (auditErr) {
            logger.warn("Audit trail write failed for PASSWORD_RESET:", auditErr);
        }
    }

    return { success: true };
});

exports.recalculateStats = onCall(async (request) => {
    const { auth } = request;
    if (!auth) throw new HttpsError("unauthenticated", "Must be authenticated.");
    const callerTenantId = requireTenantClaim(auth);

    const callerDoc = await admin.firestore().collection("users").doc(auth.uid).get();
    if (!callerDoc.exists || callerDoc.data().role !== "MIS") {
        throw new HttpsError("permission-denied", "Only MIS can recalculate stats.");
    }

    try {
        // Per-tenant aggregates land on the tenant document. The global
        // stats/public counter is maintained separately by onUserWritten /
        // onProjectWritten triggers and remains cross-tenant by design.
        const [usersSnapshot, projectsSnapshot] = await Promise.all([
            admin.firestore().collection("users").where("tenantId", "==", callerTenantId).get(),
            admin.firestore().collection("projects").where("tenantId", "==", callerTenantId).get(),
        ]);

        const users = usersSnapshot.docs.map(d => d.data());
        const projects = projectsSnapshot.docs.map(d => d.data());

        const engineerCount = users.filter(u => u.role === "PROJ_ENG" || u.role === "Project Engineer").length;
        const DEPT_ROLES = ["HCSD"];
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

        await admin.firestore().collection("tenants").doc(callerTenantId).update({
            stats: {
                engineerCount,
                departmentCount,
                projectCount,
                totalBudget,
                done,
                delayed,
                progress: ongoing,
                delay,
                lastUpdated: new Date().toISOString(),
            },
        });

        await logSystemAudit(auth.uid, auth.token.email, "STATS_RECALCULATED",
            { engineerCount, departmentCount, projectCount, totalBudget }, "SUCCESS", null, callerTenantId);

        return { success: true, engineerCount, departmentCount, projectCount, totalBudget };
    } catch (error) {
        logger.error("Error recalculating stats:", error);
        throw new HttpsError("internal", "Unable to recalculate stats. Please try again.");
    }
});

// ─── CLOUD FUNCTION: Purge mobile-origin rows from HCSD audit trail ─────────
// Legacy bleed-through: before the onMobileAuditCreated fan-out trigger
// shipped, mobile-origin activity was being written directly into
// auditTrails/hcsd/entries with these exact action strings. The web-side
// Audit Trails page is strictly "what this HCSD account did"; field
// activity lives in Notifications. This callable deletes those stray rows.
// HCSD-only. Idempotent — safe to call any time. Returns the number deleted.
exports.purgeMobileOriginHcsdAudit = onCall(async (request) => {
    const { auth } = request;
    if (!auth) throw new HttpsError("unauthenticated", "Must be authenticated.");
    const callerTenantId = requireTenantClaim(auth);

    const callerDoc = await admin.firestore().collection("users").doc(auth.uid).get();
    if (!callerDoc.exists || callerDoc.data().role !== "HCSD") {
        throw new HttpsError("permission-denied", "Only HCSD personnel can run this maintenance task.");
    }

    const MOBILE_ORIGIN_ACTIONS = [
        "Proof Uploaded",
        "Milestones Drafted",
        "Milestones Confirmed",
        "Milestone Completed",
        "Project Completed",
        "Milestones Generated (AI-Assisted)",
    ];

    try {
        // Tenant-scoped query: HCSD-A only purges stray rows from their own
        // tenant. Legacy rows without a tenantId field will not match this
        // query and remain stranded; that's acceptable for the v1 wipe-and-
        // reseed migration path.
        const snap = await admin.firestore()
            .collection("auditTrails").doc("hcsd").collection("entries")
            .where("action", "in", MOBILE_ORIGIN_ACTIONS)
            .where("tenantId", "==", callerTenantId)
            .get();

        if (snap.empty) return { success: true, deleted: 0 };

        let deleted = 0;
        for (let i = 0; i < snap.docs.length; i += 400) {
            const chunk = snap.docs.slice(i, i + 400);
            const batch = admin.firestore().batch();
            chunk.forEach((d) => batch.delete(d.ref));
            await batch.commit();
            deleted += chunk.length;
        }

        // Maintenance op — not logged to the HCSD audit trail; Cloud
        // Functions logs retain the invocation record for forensics.
        return { success: true, deleted };
    } catch (error) {
        logger.error("[purgeMobileOriginHcsdAudit] Failed:", error);
        throw new HttpsError("internal", "Unable to purge audit entries. Please try again.");
    }
});

// â”€â”€â”€ TRIGGER: Recompute public stats on user writes â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
exports.onUserWritten = onDocumentWritten("users/{userId}", async () => {
    try {
        // Cross-tenant scan: stats/public is intentionally global by spec.
        // Scaling note: every user write in any tenant triggers a full table
        // scan. Acceptable for v1; v2 should switch to scheduled per-tenant
        // aggregation if tenant count grows past a few dozen.
        const usersSnapshot = await admin.firestore().collection("users").get();
        const users = usersSnapshot.docs.map(doc => doc.data());

        const engineerCount = users.filter(u =>
            u.role === "PROJ_ENG" || u.role === "Project Engineer"
        ).length;

        const DEPT_ROLES = ["HCSD"];
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

// â”€â”€â”€ TRIGGER: Recompute public stats on project writes â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

// ─── TRIGGER: Fan out mobile PROJ_ENG activity into HCSD notifications ─────
// The Audit Trails page is strictly "what I (this account) did." Mobile
// activity lives in `auditTrails/mobile/entries` (PROJ_ENG-only read) and
// is surfaced to HCSD exclusively as notifications with category "field".
// Only the whitelisted actions produce notifications — anything else the
// mobile writes (login, generic updates, draft removal) is ignored here.
// Mobile currently ships `details` as a plain string: `"<ProjectName> · <MilestoneName>"`
// (middle-dot U+00B7 separator). Parse that shape first; fall back to object-key
// scanning for any mobile client that starts sending structured `details`.
const parseMilestoneFromDetailsString = (s) => {
    if (typeof s !== "string" || !s.trim()) return null;
    const parts = s.split(/\s*[·|]\s*/).map((p) => p.trim()).filter(Boolean);
    if (parts.length === 0) return null;
    // When there are >=2 parts, last is the milestone name (`Project · Milestone`
    // or `Project · Phase N · Milestone`). With one part, treat as milestone name.
    const name = parts[parts.length - 1];
    return name ? { name, phase: null, order: null } : null;
};

const pickMilestoneLabel = (details) => {
    const fromString = parseMilestoneFromDetailsString(details);
    if (fromString) return fromString;
    if (!details || typeof details !== "object") return { name: null, phase: null, order: null };
    const name = details.milestoneName || details.milestone
        || details.title || details.name || details.label
        || details.taskName || details.description || null;
    const phase = details.phase || details.phaseName || details.phaseTitle
        || details.stage || details.stageName || null;
    const order = details.phaseNumber ?? details.phaseOrder
        ?? details.milestoneNumber ?? details.milestoneOrder
        ?? details.order ?? details.sequence ?? details.index ?? null;
    return { name, phase, order };
};

const formatMilestoneLabel = ({ name, phase, order }) => {
    if (name && phase) return `"${name}" (${phase})`;
    if (name && order != null) return `Phase ${order} — "${name}"`;
    if (name) return `"${name}"`;
    if (phase && order != null) return `Phase ${order} — ${phase}`;
    if (phase) return phase;
    if (order != null) return `Phase ${order}`;
    return null;
};

// Prefer the canonical milestone doc (web-authored, stable `title` + `sequence`)
// when the trigger has FK-resolved it from `details.milestoneId`. Fall back to
// whatever keys mobile happened to carry.
const labelFromMilestoneDoc = (milestoneDoc) => {
    if (!milestoneDoc) return null;
    return formatMilestoneLabel({
        name: milestoneDoc.title || null,
        phase: null,
        order: milestoneDoc.sequence ?? null,
    });
};

const FIELD_NOTIFICATION_SPECS = {
    "Proof Uploaded": {
        severity: "info",
        title: "Proof uploaded",
        bodyFor: (projectName, details, milestoneDoc) => {
            const label = labelFromMilestoneDoc(milestoneDoc)
                || formatMilestoneLabel(pickMilestoneLabel(details));
            return label
                ? `${projectName}: geotagged proof uploaded for ${label}`
                : `${projectName}: geotagged proof-of-work photo uploaded`;
        },
    },
    "Milestones Drafted": {
        severity: "info",
        title: "Milestones drafted",
        bodyFor: (projectName, details) => {
            const count = details?.count;
            return count
                ? `${projectName}: ${count} AI-generated milestones drafted`
                : `${projectName}: milestone draft generated`;
        },
    },
    "Milestones Confirmed": {
        severity: "success",
        title: "Milestones confirmed",
        bodyFor: (projectName, details) => {
            const count = details?.count;
            return count
                ? `${projectName}: engineer confirmed ${count} milestones`
                : `${projectName}: milestones confirmed`;
        },
    },
    "Milestone Completed": {
        severity: "success",
        title: "Milestone completed",
        bodyFor: (projectName, details, milestoneDoc) => {
            const label = labelFromMilestoneDoc(milestoneDoc)
                || formatMilestoneLabel(pickMilestoneLabel(details));
            return label
                ? `${projectName}: ${label} marked complete`
                : `${projectName}: engineer marked a milestone complete`;
        },
    },
};

exports.onMobileAuditCreated = onDocumentCreated(
    "auditTrails/mobile/entries/{logId}",
    async (event) => {
        try {
            const entry = event.data?.data();
            if (!entry) return;

            const spec = FIELD_NOTIFICATION_SPECS[entry.action];
            if (!spec) return;

            // `details` from mobile is currently a plain string like
            // `"<ProjectName> · <MilestoneName>"`. Keep it as-is for parsing,
            // but normalize to an empty object for safe property lookups.
            const rawDetails = entry.details;
            const detailsObj = (rawDetails && typeof rawDetails === "object") ? rawDetails : {};

            const projectId = entry.targetId || detailsObj.projectId;
            if (!projectId) {
                logger.warn(`[onMobileAuditCreated] Skipping — no projectId on ${entry.action}`);
                return;
            }

            const projectSnap = await admin.firestore()
                .doc(`projects/${projectId}`)
                .get();
            if (!projectSnap.exists) return;

            const project = projectSnap.data();
            const projectName = project.projectName || detailsObj.projectName || "Project";

            // Tenant cross-check. Mobile stamps tenantId on every audit
            // entry post-refactor; if the entry's tenantId disagrees with
            // the resolved project's tenantId, refuse to fan out (cannot
            // happen under correct mobile but worth catching defensively).
            // The notification stamp uses the project's tenantId as the
            // source of truth.
            const projectTenantId = project.tenantId || null;
            if (entry.tenantId && projectTenantId && entry.tenantId !== projectTenantId) {
                logger.warn(`[onMobileAuditCreated] Tenant mismatch on ${entry.action}: entry=${entry.tenantId} project=${projectTenantId}`);
                return;
            }
            if (!projectTenantId) {
                logger.warn(`[onMobileAuditCreated] Skipping ${entry.action}: project ${projectId} has no tenantId (pre-migration doc)`);
                return;
            }

            // Deliver to the HCSD who created the project. If missing
            // (legacy docs), silently skip — no broadcast to every HCSD.
            const recipientUid = project.createdBy;
            if (!recipientUid) return;

            // FK-resolve the milestone when mobile passes milestoneId so the
            // notification body uses the web-authored canonical title/sequence
            // instead of whatever free-text keys mobile happened to ship.
            let milestoneDoc = null;
            const milestoneId = detailsObj.milestoneId || null;
            if (milestoneId) {
                try {
                    const mSnap = await admin.firestore()
                        .doc(`projects/${projectId}/milestones/${milestoneId}`)
                        .get();
                    if (mSnap.exists) milestoneDoc = { id: mSnap.id, ...mSnap.data() };
                } catch (e) {
                    logger.warn(`[onMobileAuditCreated] Milestone lookup failed for ${milestoneId}: ${e.message}`);
                }
            }

            await createNotification({
                recipientUid,
                action: entry.action,
                category: "field",
                severity: spec.severity,
                title: spec.title,
                body: spec.bodyFor(projectName, rawDetails, milestoneDoc),
                targetType: milestoneId ? "milestone" : "project",
                targetId: milestoneId || projectId,
                metadata: {
                    ...detailsObj,
                    ...(typeof rawDetails === "string" ? { detailsRaw: rawDetails } : {}),
                    projectId,
                    milestoneId,
                    milestoneTitle: milestoneDoc?.title || null,
                    milestoneSequence: milestoneDoc?.sequence ?? null,
                    sourceAuditLogId: event.params.logId,
                },
                tenantId: projectTenantId,
            });

            // Server-side synthesis: after a phase is marked complete, check
            // whether ALL sibling milestones are done. If so, emit a second
            // "Project Completed" notification. No new mobile event needed.
            if (entry.action === "Milestone Completed") {
                const milestonesSnap = await admin.firestore()
                    .collection(`projects/${projectId}/milestones`)
                    .get();
                const total = milestonesSnap.size;
                const doneStatuses = new Set(["Done", "Complete", "Completed"]);
                const done = milestonesSnap.docs.filter(
                    (d) => doneStatuses.has(d.data().status),
                ).length;
                if (total > 0 && done === total) {
                    await createNotification({
                        recipientUid,
                        action: "Project Completed",
                        category: "field",
                        severity: "success",
                        title: "Project completed",
                        body: `${projectName}: all ${total} milestones marked complete`,
                        targetType: "project",
                        targetId: projectId,
                        metadata: {
                            projectId,
                            totalMilestones: total,
                            sourceAuditLogId: event.params.logId,
                        },
                        tenantId: projectTenantId,
                    });
                }
            }
        } catch (err) {
            logger.error("[onMobileAuditCreated] Failed to fan out notification:", err);
        }
    }
);

// Recompute parent project's actualPercent on any milestone write.
// Mobile engineers modify per-milestone status/actualPercent over the life
// of a project; the parent projects/{id} doc carries a denormalized
// actualPercent so that list views (Manage Projects, Dashboard Active
// Registry) can render progress without an N+1 subcollection read. This
// trigger keeps that field fresh. Weighted by weightPercentage and
// normalized to 100 to handle legacy weights that don't sum exactly.
//
// Tenant immutability: this trigger only writes `actualPercent`. It never
// reads, writes, or echoes back the project's tenantId, so the field
// cannot be rewritten via a milestone update. The Firestore rules also
// reject any update that changes tenantId, but this function is the
// internal write path that needs to be careful by construction.
exports.recomputeProjectActualPercent = onDocumentWritten(
    "projects/{projectId}/milestones/{milestoneId}",
    async (event) => {
        const { projectId } = event.params;
        try {
            const snap = await admin.firestore()
                .collection("projects").doc(projectId)
                .collection("milestones").get();

            const confirmed = snap.docs
                .map((d) => d.data())
                .filter((m) => m.confirmed !== false);

            if (confirmed.length === 0) {
                await admin.firestore().collection("projects").doc(projectId)
                    .update({ actualPercent: 0 });
                return;
            }

            const totalWeight = confirmed.reduce(
                (s, m) => s + (Number(m.weightPercentage) || Number(m.weight) || 0),
                0,
            );

            let earned = 0;
            for (const m of confirmed) {
                const weight = Number(m.weightPercentage) || Number(m.weight) || 0;
                const statusLower = (m.status || "").toLowerCase();
                const isComplete = ["done", "complete", "completed"].includes(statusLower);
                const contribution = m.actualPercent != null
                    ? Math.min(Number(m.actualPercent) || 0, weight)
                    : (isComplete ? weight : 0);
                earned += contribution;
            }

            const actualPercent = totalWeight > 0
                ? Math.min(100, Math.round((earned / totalWeight) * 100 * 10) / 10)
                : 0;

            await admin.firestore().collection("projects").doc(projectId)
                .update({ actualPercent });
        } catch (err) {
            logger.error(`[recomputeProjectActualPercent] ${projectId}:`, err);
        }
    },
);

// â”€â”€â”€ CLOUD FUNCTION: Update Profile Photo â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
exports.updateProfilePhoto = onCall(async (request) => {
    const { auth, data } = request;
    if (!auth) throw new HttpsError("unauthenticated", "Must be authenticated to update profile photo.");
    const callerTenantId = requireTenantClaim(auth);

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
            }, callerTenantId);
        }
        await logSystemAudit(auth.uid, auth.token.email, "PROFILE_PHOTO_UPDATED", {}, "SUCCESS", null, callerTenantId);

        return { success: true };
    } catch (error) {
        logger.error("Error updating profile photo:", error);
        throw new HttpsError("internal", "Unable to update profile photo. Please try again.");
    }
});

// â”€â”€â”€ CLOUD FUNCTION: Update Profile Name â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
exports.updateProfile = onCall(async (request) => {
    const { auth, data } = request;
    if (!auth) throw new HttpsError("unauthenticated", "Must be authenticated to update profile.");
    const callerTenantId = requireTenantClaim(auth);

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
        const newName = `${firstName} ${lastName}`;
        // Name updates are an MIS-only operation (department heads' display
        // names are maintained by MIS), so no HCSD audit duplicate — only
        // the MIS observability row is written.
        await logSystemAudit(
            auth.uid, auth.token.email, "PROFILE_UPDATED",
            { oldName: oldName ?? "â€”", newName },
            "SUCCESS", newName, callerTenantId,
        );
        return { success: true };
    } catch (error) {
        logger.error("Error updating profile:", error);
        throw new HttpsError("internal", "Unable to update name. Please try again.");
    }
});

// â”€â”€â”€ AI-Assisted Milestone Generation â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Generates milestones using Anthropic Claude Haiku 4.5, constrained by a
// tool-use schema. The assigned Project Engineer reviews and adjusts these
// suggestions before monitoring begins. Writes to the
// projects/{projectId}/milestones subcollection.

const Anthropic = require("@anthropic-ai/sdk").default;
const anthropicApiKey = defineSecret("ANTHROPIC_API_KEY");

const MILESTONE_SYSTEM_PROMPT = `You are a senior construction planning assistant for the Construction Services Division of the Cebu City Department of Engineering and Public Works (DEPW). Your role is to generate standardized physical construction milestones for city-funded barangay-level infrastructure projects that have already completed procurement under Republic Act No. 12009 (New Government Procurement Act) and have received the Notice to Proceed.

## Institutional Context

The Construction Services Division supervises the post-bidding implementation phase of barangay-level infrastructure projects across Cebu City. A Project Engineer is assigned to each project by the Head of Construction Services. The Project Engineer encodes project details and uses your generated milestones as a standardized starting point, then reviews and adjusts them before monitoring begins. Your output is a draft for Project Engineer review, not a final plan.

## Milestone Design Principles

1. Each milestone must represent a verifiable, on-site physical deliverable that can be evidenced by a geotagged photograph. Do not generate administrative tasks (permits, meetings, documentation submission) as milestones, because compliance is tracked separately through the NTP verification workflow.

2. Milestone count ranges from 5 to 12 depending on project complexity and duration. Projects of 30 to 60 days typically have 5 to 7 milestones. Projects of 61 to 120 days typically have 7 to 10 milestones. Projects of 121 days or more may reach 10 to 12 milestones.

3. Weight percentages reflect relative physical effort and material cost share, not calendar time. Concrete pouring phases typically carry the heaviest weight. Mobilization and site clearing phases typically carry the lightest. All weights must sum to exactly 100.

4. Suggested durations must fit within the overall project timeline provided. Use calendar days. Account for typical Philippine weather variability by assuming 15 to 20 percent of calendar days may be non-workable during rainy months (June to November). Do not exceed the total project duration in the sum of suggested durations; milestones may overlap in real execution.

5. The first milestone should always cover site preparation or mobilization. The final milestone should always cover final inspection, cleanup, and turnover readiness.

6. Use clear, specific milestone titles that a Project Engineer would recognize from standard DEPW field practice. Avoid generic titles like "Construction Phase 1" or "Work Progress 50%."

## Project Type Reference Examples

The examples below illustrate validated phasing patterns for each project type. Match the closest project type to the input, then adapt the pattern to the specific project's scope, duration, and contract amount. Do not copy example values literally; generate values that fit the specific project being described.

### ROAD_CONCRETING

Example A: Concreting of a 150-meter by 6-meter barangay access road, 90-day duration, PHP 1,500,000 contract amount.
1. Mobilization, site clearing, and traffic management setup (8%, 7 days)
2. Excavation and removal of existing pavement or subgrade (10%, 10 days)
3. Subgrade preparation, compaction, and aggregate base course installation (15%, 12 days)
4. Formworks installation and steel reinforcement placement (12%, 10 days)
5. Concrete pouring and screeding, first half (22%, 14 days)
6. Concrete pouring and screeding, second half (22%, 14 days)
7. Concrete curing with surface protection and joint cutting (6%, 14 days)
8. Pavement markings, signage installation, and final cleanup (5%, 9 days)

Example B: Concreting of a 75-meter by 4-meter barangay interior road, 45-day duration, PHP 600,000 contract amount.
1. Site clearing and excavation (15%, 6 days)
2. Subgrade preparation and base course (20%, 8 days)
3. Formworks and reinforcement (15%, 7 days)
4. Concrete pouring and finishing (35%, 10 days)
5. Curing and joint sealing (10%, 10 days)
6. Cleanup and turnover readiness (5%, 4 days)

### DRAINAGE_CONSTRUCTION

Example A: Construction of a 200-meter reinforced concrete canal with side walls, 75-day duration, PHP 950,000 contract amount.
1. Mobilization, survey, and canal alignment staking (7%, 5 days)
2. Excavation of canal trench to design depth (14%, 12 days)
3. Subbase preparation and leveling course (10%, 8 days)
4. Formworks for canal floor and walls (13%, 10 days)
5. Steel reinforcement installation for floor and walls (13%, 10 days)
6. Concrete pouring for canal floor (15%, 10 days)
7. Concrete pouring for canal side walls (15%, 12 days)
8. Installation of grating covers and inlet structures (8%, 5 days)
9. Backfilling, site restoration, and flow testing (5%, 3 days)

Example B: Construction of a 100-meter reinforced concrete pipe drainage line, 50-day duration, PHP 500,000 contract amount.
1. Site clearing and trench excavation (18%, 10 days)
2. Subbase preparation (10%, 5 days)
3. Installation of reinforced concrete pipes with jointing (30%, 15 days)
4. Construction of catch basins and manholes (22%, 10 days)
5. Backfilling and compaction (15%, 8 days)
6. Site restoration and turnover readiness (5%, 2 days)

### MULTI_PURPOSE_BUILDING

Example A: Construction of a single-story 12-meter by 10-meter multi-purpose covered court with stage, 150-day duration, PHP 2,800,000 contract amount.
1. Mobilization, site clearing, and layout staking (5%, 7 days)
2. Excavation for footings and foundations (7%, 10 days)
3. Pouring of footings, column bases, and tie beams (12%, 15 days)
4. Erection of columns, roof trusses, and purlins (18%, 25 days)
5. Installation of roofing sheets, gutters, and flashing (15%, 18 days)
6. Concrete flooring with steel reinforcement (14%, 20 days)
7. Construction of stage platform and perimeter low walls (10%, 15 days)
8. Electrical roughing-in and lighting fixture installation (8%, 15 days)
9. Painting of steel members, trimmings, and surfaces (6%, 12 days)
10. Final cleanup, electrical testing, and turnover readiness (5%, 13 days)

Example B: Construction of a 6-meter by 8-meter barangay day care center, one story, 120-day duration, PHP 1,800,000 contract amount.
1. Site clearing, excavation, and foundation layout (7%, 10 days)
2. Footings, column footings, and ground beam pouring (12%, 14 days)
3. Masonry works for exterior and interior walls (20%, 25 days)
4. Roof framing and installation of roofing system (15%, 18 days)
5. Concrete slab flooring with finishing (12%, 14 days)
6. Plastering of walls and installation of doors and windows (14%, 16 days)
7. Plumbing fixtures and electrical wiring installation (10%, 12 days)
8. Tiling, painting, and interior finishing (7%, 8 days)
9. Final inspection, cleanup, and turnover readiness (3%, 3 days)

### SLOPE_PROTECTION

Example A: Construction of a 50-meter riprap slope protection along a barangay waterway, 60-day duration, PHP 750,000 contract amount.
1. Mobilization and site clearing along the slope alignment (8%, 5 days)
2. Excavation and slope trimming to design profile (15%, 10 days)
3. Foundation trench excavation and leveling (12%, 7 days)
4. Foundation concrete pouring for toe wall (15%, 8 days)
5. Placement of filter fabric or bedding material (10%, 6 days)
6. Riprap boulder placement and interlocking (25%, 15 days)
7. Grouting of riprap voids where specified (10%, 6 days)
8. Final trimming, cleanup, and turnover readiness (5%, 3 days)

Example B: Construction of a 30-meter reinforced concrete slope protection wall, 75-day duration, PHP 900,000 contract amount.
1. Site clearing and excavation of wall footprint (10%, 8 days)
2. Foundation excavation and rebar preparation (12%, 10 days)
3. Foundation concrete pouring (15%, 8 days)
4. Wall formworks and reinforcement installation (18%, 12 days)
5. Wall concrete pouring in lifts (25%, 15 days)
6. Weep hole installation and drainage provisions (8%, 6 days)
7. Backfilling and slope restoration behind the wall (7%, 10 days)
8. Final cleanup and turnover readiness (5%, 6 days)

### WATERWORKS

Example A: Installation of a 300-meter barangay water distribution pipeline with tapping stands, 70-day duration, PHP 680,000 contract amount.
1. Mobilization, route survey, and coordination with the barangay (6%, 5 days)
2. Trench excavation along the pipeline route (18%, 12 days)
3. Pipe bedding preparation with sand or gravel (10%, 6 days)
4. Laying and jointing of distribution pipes (22%, 15 days)
5. Installation of valves, fittings, and tapping stands (15%, 10 days)
6. Pressure testing and leak checking (8%, 5 days)
7. Backfilling and compaction over the pipeline (12%, 10 days)
8. Surface restoration at excavated crossings (6%, 5 days)
9. Commissioning and turnover readiness (3%, 2 days)

Example B: Construction of a 10-cubic-meter elevated water storage tank with distribution connection, 90-day duration, PHP 1,100,000 contract amount.
1. Site preparation and foundation excavation (8%, 8 days)
2. Foundation and column footing concrete works (14%, 14 days)
3. Erection of elevated tank support columns and cross bracing (18%, 18 days)
4. Tank fabrication or installation on the support structure (22%, 16 days)
5. Inlet, outlet, and overflow piping installation (12%, 10 days)
6. Ladder, railing, and safety appurtenances (8%, 8 days)
7. Waterproofing and interior tank cleaning (8%, 7 days)
8. Pressure testing, disinfection, and commissioning (7%, 6 days)
9. Cleanup and turnover readiness (3%, 3 days)

### ELECTRIFICATION

Example A: Installation of 500 meters of barangay streetlight line with 15 LED fixtures, 45-day duration, PHP 420,000 contract amount.
1. Mobilization, route survey, and coordination with VECO or distribution utility (8%, 4 days)
2. Excavation for pole foundations (10%, 5 days)
3. Pole foundation concrete pouring and curing (12%, 6 days)
4. Erection and alignment of streetlight poles (15%, 6 days)
5. Overhead or underground wiring installation (22%, 10 days)
6. Installation of LED fixtures and connections (15%, 6 days)
7. Grounding system installation (8%, 4 days)
8. Energization testing and commissioning with utility coordination (7%, 3 days)
9. Cleanup and turnover readiness (3%, 1 day)

Example B: Electrical roughing-in and finishing for a newly constructed barangay day care center, 30-day duration, PHP 180,000 contract amount.
1. Mobilization and coordination with general contractor (10%, 3 days)
2. Conduit roughing-in and box installation (22%, 7 days)
3. Wire pulling through conduits (18%, 6 days)
4. Panel board installation and circuit terminations (20%, 5 days)
5. Installation of switches, outlets, and lighting fixtures (15%, 5 days)
6. Grounding and bonding works (8%, 2 days)
7. Energization, circuit testing, and commissioning (5%, 1 day)
8. Final labeling, cleanup, and turnover readiness (2%, 1 day)

### OTHER

When the project does not match any of the above categories, infer the closest construction discipline from the project name and generate 6 to 10 milestones that cover mobilization, primary construction phases, secondary works, testing or inspection, and turnover. Maintain all other design principles above.

## Output Constraints

You must output your response exclusively through the generate_project_milestones tool. Do not produce any plain text response. Do not explain your reasoning. Do not apologize or add disclaimers. The Project Engineer will see your milestones in a structured review interface and will adjust any that do not match field realities.

Now, generate milestones for the project described in the next message.`;

const milestoneTool = {
  name: "generate_project_milestones",
  description:
    "Generates standardized construction milestones for a city-funded barangay-level infrastructure project. Weight percentages must sum to exactly 100.",
  input_schema: {
    type: "object",
    properties: {
      project_type: {
        type: "string",
        enum: [
          "road_concreting",
          "drainage_construction",
          "multi_purpose_building",
          "slope_protection",
          "waterworks",
          "electrification",
          "other",
        ],
      },
      milestones: {
        type: "array",
        minItems: 5,
        maxItems: 12,
        items: {
          type: "object",
          properties: {
            sequence: { type: "integer" },
            title: { type: "string" },
            description: { type: "string" },
            weight_percentage: { type: "number" },
            suggested_duration_days: { type: "integer" },
          },
          required: [
            "sequence",
            "title",
            "description",
            "weight_percentage",
            "suggested_duration_days",
          ],
        },
      },
    },
    required: ["project_type", "milestones"],
  },
};

exports.generateMilestones = onCall(
  { secrets: [anthropicApiKey], timeoutSeconds: 60 },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Authentication required.");
    }
    const callerTenantId = requireTenantClaim(request.auth);

    const { projectId } = request.data || {};
    if (!projectId) {
      throw new HttpsError("invalid-argument", "projectId is required.");
    }

    const projectRef = admin.firestore().doc(`projects/${projectId}`);
    const projectSnap = await projectRef.get();
    if (!projectSnap.exists) {
      throw new HttpsError("not-found", "Project not found.");
    }
    const project = projectSnap.data();
    if (project.tenantId !== callerTenantId) {
      throw new HttpsError(
        "permission-denied",
        "Cannot generate milestones for a project in another tenant."
      );
    }

    if (project.projectEngineer !== request.auth.uid) {
      throw new HttpsError(
        "permission-denied",
        "Only the assigned Project Engineer can generate milestones for this project."
      );
    }

    const existingSnap = await admin
      .firestore()
      .collection(`projects/${projectId}/milestones`)
      .limit(1)
      .get();
    if (!existingSnap.empty) {
      throw new HttpsError(
        "already-exists",
        "Milestones already exist for this project."
      );
    }

    const userMessage = `Generate milestones for the following project:

Project Name: ${project.projectName || "Unknown"}
Barangay: ${project.barangay || "Unknown"}
Sitio/Street: ${project.sitioStreet || "N/A"}
Contract Amount (for reference only): PHP ${project.contractAmount || "N/A"}
Contractor: ${project.contractor || "N/A"}
Official Start Date: ${project.officialDateStarted || "N/A"}
Original Completion Date: ${project.originalDateCompletion || "N/A"}`;

    const client = new Anthropic({ apiKey: anthropicApiKey.value() });

    let response;
    try {
      response = await client.messages.create({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 2048,
        system: MILESTONE_SYSTEM_PROMPT,
        tools: [milestoneTool],
        tool_choice: { type: "tool", name: "generate_project_milestones" },
        messages: [{ role: "user", content: userMessage }],
      });
    } catch (error) {
      logger.error("Anthropic API error:", error);
      throw new HttpsError(
        "internal",
        "Failed to generate milestones. You can create milestones manually."
      );
    }

    const toolUseBlock = response.content.find(
      (block) => block.type === "tool_use"
    );
    if (!toolUseBlock) {
      throw new HttpsError(
        "internal",
        "No structured milestone output was returned."
      );
    }

    const { milestones } = toolUseBlock.input;

    const totalWeight = milestones.reduce(
      (sum, m) => sum + m.weight_percentage,
      0
    );
    if (Math.abs(totalWeight - 100) > 0.5) {
      throw new HttpsError(
        "internal",
        `Milestone weights did not sum to 100 (got ${totalWeight}). Please try again or create manually.`
      );
    }

    const batch = admin.firestore().batch();
    const msCollection = admin
      .firestore()
      .collection(`projects/${projectId}/milestones`);

    milestones
      .sort((a, b) => a.sequence - b.sequence)
      .forEach((m) => {
        const docRef = msCollection.doc();
        batch.set(docRef, {
          title: m.title,
          description: m.description,
          sequence: m.sequence,
          weightPercentage: m.weight_percentage,
          suggestedDurationDays: m.suggested_duration_days,
          status: "Pending",
          proofs: [],
          generatedBy: "claude-haiku-4-5",
          confirmed: false,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          tenantId: callerTenantId,
        });
      });

    await batch.commit();

    await admin
      .firestore()
      .collection("auditTrails")
      .doc("mobile")
      .collection("entries")
      .add({
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
        actorUid: request.auth.uid,
        actorEmail: request.auth.token.email || null,
        action: "Milestones Generated (AI-Assisted)",
        target: `Milestones Generated for ${projectId} | Count: ${milestones.length}`,
        success: true,
        tenantId: callerTenantId,
      });

    return {
      success: true,
      count: milestones.length,
    };
  }
);

