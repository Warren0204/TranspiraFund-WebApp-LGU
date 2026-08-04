const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { onDocumentWritten, onDocumentCreated, onDocumentUpdated } = require("firebase-functions/v2/firestore");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { setGlobalOptions } = require("firebase-functions/v2/options");
const { defineSecret } = require("firebase-functions/params");
const logger = require("firebase-functions/logger");

const admin = require("firebase-admin");
const crypto = require("crypto");
const nodemailer = require("nodemailer");
const { z } = require("zod");

admin.initializeApp();
setGlobalOptions({ region: "asia-southeast1" });

const gmailUser = defineSecret("GMAIL_USER");
const gmailAppPassword = defineSecret("GMAIL_APP_PASSWORD");

const createTransporter = () => nodemailer.createTransport({
    service: "gmail",
    auth: {
        user: gmailUser.value(),
        pass: gmailAppPassword.value(),
    },
});

// Pure helpers + canonical constants for classification and milestone coherence.
// Kept in a dependency-free module so they can be unit-tested without mocking
// firebase-admin or the Anthropic SDK.
const {
    PROJECT_TYPE_ENUM,
    COMPONENT_VOCABULARY,
    decideClassification,
    classificationGatePasses,
    parseAndValidateDuration,
    prescreenProjectName,
    prescreenProjectDescription,
} = require("./lib/classification");

// Short stable hash of the classifier system prompt — stamped on every
// persisted classification so a future prompt rewrite can be detected when
// reading historical project docs.
const CLASSIFIER_VERSION = () => crypto
    .createHash("sha256")
    .update(CLASSIFIER_SYSTEM_PROMPT)
    .digest("hex")
    .slice(0, 12);

const createAccountSchema = z.object({
    email: z.string().email().max(100),
    firstName: z.string().min(2).max(50).regex(/^[a-zA-Z\s\-']+$/, "First name contains invalid characters"),
    lastName: z.string().min(2).max(50).regex(/^[a-zA-Z\s\-']+$/, "Last name contains invalid characters"),
    roleType: z.enum(["HCSD", "PROJ_ENG"]),
    department: z.string().max(100).optional(),
});

const createProjectSchema = z.object({
    projectName: z.string().min(10, "Project name must be at least 10 characters").max(200),
    projectDescription: z.string()
        .max(1000, "Project description must be at most 1000 characters")
        .optional(),
    sitioStreet: z.string().min(1, "Sitio / Street is required").max(200),
    barangay: z.string().min(1, "Barangay is required").max(100),
    accountCode: z.string().min(1, "Account Code is required").max(100),
    fundingSource: z.string().max(100).optional(),
    contractAmount: z.number().min(10000, "Minimum contract amount is â‚±10,000").max(1_000_000_000),
    contractor: z.string().min(1, "Contractor is required").max(200),
    projectEngineer: z.string().min(1, "Project Engineer is required").max(200),
    projectInspector: z.string().max(100).optional(),
    materialInspector: z.string().max(100).optional(),
    electricalInspector: z.string().max(100).optional(),
    ntpReceivedDate: z.string().min(1, "NTP received date is required"),
    officialDateStarted: z.string().min(1, "Official start date is required"),
    originalDateCompletion: z.string().min(1, "Original completion date is required"),
    revisedDate1: z.string().optional(),
    revisedDate2: z.string().optional(),
    actualDateCompleted: z.string().optional(),
    actualPercent: z.number().min(0).max(100).optional(),
    resumeOrderNumber: z.string().max(100).optional(),
    resumeOrderDate: z.string().optional(),
    timeExtensionOnOrder: z.string().max(100).optional(),
    validationOrderNumber: z.string().max(100).optional(),
    validationOrderDate: z.string().optional(),
    suspensionOrderNumber: z.string().max(100).optional(),
    suspensionOrderDate: z.string().optional(),
    incurredAmount: z.number().min(0).optional(),
    remarks: z.string().max(1000).optional(),
    actionTaken: z.string().max(1000).optional(),
    projectType: z.enum(PROJECT_TYPE_ENUM).optional(),
    classificationConfidence: z.number().min(0).max(1).optional(),
    classification: z.object({
        projectType: z.enum(PROJECT_TYPE_ENUM).optional(),
        confidence: z.number().min(0).max(1).optional(),
        durationFlag: z.string().optional(),
        typicalDurationDays: z.object({
            min: z.number(), max: z.number(),
        }).nullable().optional(),
        reason: z.string().max(1000).nullable().optional(),
        classifierVersion: z.string().max(64).optional(),
        classifierPromptVersion: z.string().max(64).optional(),
        classifiedAtISO: z.string().optional(),
        verdict: z.object({
            inputSafety: z.object({
                containsProfanity: z.boolean(),
                containsPii: z.boolean(),
                containsPromptInjectionPattern: z.boolean(),
                containsMixedScript: z.boolean(),
                containsNonPrintable: z.boolean(),
            }).nullable().optional(),
            nameQuality: z.object({
                isGibberish: z.boolean(),
                isPlaceholder: z.boolean(),
                specificity: z.enum(["specific", "vague", "generic"]),
            }).nullable().optional(),
            semanticCoherence: z.object({
                allWordsInfraRelated: z.boolean(),
                combinationMakesSense: z.boolean(),
                overallNamePlausible: z.boolean(),
            }).nullable().optional(),
            scopeFit: z.enum(["barangay", "city", "regional", "national", "unclear"]).nullable().optional(),
            jurisdictionFit: z.enum(["in_lgu", "out_of_lgu", "location_agnostic"]).nullable().optional(),
            bundlesMultipleProjects: z.boolean().optional(),
            physicalPlausibility: z.enum(["plausible", "implausible", "unclear"]).nullable().optional(),
        }).optional(),
        // v1 classifier contract additions (all optional so pre-v1 clients
        // still validate; server-side defaults fill them in below).
        admitted: z.boolean().optional(),
        isComposite: z.boolean().optional(),
        components: z.array(z.enum(COMPONENT_VOCABULARY)).optional(),
        componentsSynthesized: z.boolean().optional(),
        contractVersion: z.literal("1").optional(),
    }).optional(),
}).superRefine((data, ctx) => {
    const startMs = new Date(data.officialDateStarted).getTime();
    const endMs = new Date(data.originalDateCompletion).getTime();
    if (Number.isNaN(startMs)) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["officialDateStarted"],
            message: "Official start date is not a valid date",
        });
    }
    if (Number.isNaN(endMs)) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["originalDateCompletion"],
            message: "Original completion date is not a valid date",
        });
    }
    if (Number.isNaN(startMs) || Number.isNaN(endMs)) return;
    if (endMs <= startMs) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["originalDateCompletion"],
            message: "Completion date must be after the official start date",
        });
    }
});

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

const generatePassword = (length = 16) => {
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*";
    let password = "";
    for (let i = 0; i < length; i++) {
        password += chars.charAt(crypto.randomInt(chars.length));
    }
    return password;
};

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

const requirePlatformAdmin = (auth) => {
    if (!auth || auth.token?.platformAdmin !== true) {
        throw new HttpsError(
            "permission-denied",
            "This action requires platform administrator privileges.",
        );
    }
};

// Canonical HCSD audit-trail action whitelist. Defense-in-depth: prevents any
// future code path from writing an unknown or user-supplied action string into
// the HCSD audit collection.
const HCSD_AUDIT_ACTIONS = new Set([
    "USER_LOGIN",
    "USER_LOGOUT",
    "PASSWORD_CHANGED",
    "SESSIONS_REVOKED",
    "PHOTO_UPDATED",
    "PROJECT_CREATED",
    "PROJECT_ROLLED_BACK",
    "PROJECT_REASSIGNED",
    "NTP_REJECTED",
    "ACCOUNT_CREATED",
    "ACCOUNT_DELETED",
]);

const logAudit = async (actorUid, actorEmail, action, targetId, details, tenantId) => {
    try {
        if (!tenantId) {
            logger.error(`logAudit called without tenantId for action=${action}; refusing to write unscoped doc`);
            return;
        }
        if (!HCSD_AUDIT_ACTIONS.has(action)) {
            logger.error(`logAudit rejected unknown action="${action}"; refusing to pollute HCSD audit trail`);
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

const validateNtpFilename = (name) => {
    if (!name || typeof name !== "string") return "Invalid filename";
    const trimmed = name.trim();
    if (trimmed.length < 1 || trimmed.length > 255) return "Invalid filename length";
    if (trimmed.startsWith(".") || trimmed.includes("..")) return "Invalid filename";
    // Single whitelist regex: alphanumerics + dot/dash/underscore in the base, allowed extension only.
    if (!/^[A-Za-z0-9._-]+\.(pdf|jpe?g|png)$/i.test(trimmed)) {
        return "Filename must be alphanumeric with a .pdf, .jpg, .jpeg, or .png extension";
    }
    return null;
};

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

exports.sendOtp = onCall({ secrets: [gmailUser, gmailAppPassword] }, async (request) => {
    const { auth } = request;
    if (!auth) throw new HttpsError("unauthenticated", "Must be authenticated to request a verification code.");

    const uid = auth.uid;
    const userEmail = auth.token.email;
    if (!userEmail) throw new HttpsError("invalid-argument", "No email address found for this account.");

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
            subject: "TranspiraFund — Your Verification Code",
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
    <p style="margin:0 0 8px;font-size:22px;font-weight:800;color:#0f172a;letter-spacing:-0.3px;">Identity Verification</p>
    <p style="margin:0 0 28px;font-size:15px;color:#64748b;line-height:1.7;">Your one-time verification code for the TranspiraFund LGU Portal is below. Enter it within 5 minutes to complete sign-in.</p>
    <div style="background:#f0fdf9;border:1px solid #99f6e4;border-radius:12px;padding:28px;text-align:center;margin-bottom:28px;">
      <p style="margin:0 0 8px;font-size:11px;font-weight:700;color:#0f766e;text-transform:uppercase;letter-spacing:0.12em;">Verification Code</p>
      <p style="margin:0;font-size:40px;font-weight:900;letter-spacing:12px;color:#0f766e;font-family:monospace;">${otpCode}</p>
    </div>
    <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:16px 20px;">
      <p style="margin:0 0 6px;font-size:12px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:0.08em;">Security Notice</p>
      <p style="margin:0;font-size:13px;color:#94a3b8;line-height:1.6;">This code expires in <strong style="color:#64748b;">5 minutes</strong> and can only be used once. If you did not request this, contact system administration immediately.</p>
    </div>
  </td></tr>
  <tr><td style="padding:20px 40px 28px;border-top:1px solid #f1f5f9;text-align:center;">
    <p style="margin:0;font-size:11px;color:#cbd5e1;letter-spacing:0.05em;text-transform:uppercase;">TranspiraFund &bull; Secured LGU Portal &bull; Automated System Email</p>
  </td></tr>
</table>
</td></tr></table>
</body></html>`,
        });
    } catch (emailError) {
        logger.error("Failed to send OTP email:", emailError);
        await admin.firestore().collection("otpCodes").doc(uid).delete();
        throw new HttpsError("internal", "Unable to send verification code. Please try again.");
    }

    return { success: true };
});

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

    const userDoc = await admin.firestore().collection("users").doc(uid).get();
    const userRole = userDoc.exists ? userDoc.data().role : null;
    const userName = userDoc.exists
        ? `${userDoc.data().firstName || ""} ${userDoc.data().lastName || ""}`.trim()
        : null;
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

exports.createOfficialAccount = onCall({ secrets: [gmailUser, gmailAppPassword] }, async (request) => {
    const { data, auth } = request;
    if (!auth) throw new HttpsError("unauthenticated", "The function must be called while authenticated.");

    const callerTenantId = requireTenantClaim(auth);

    const callerDoc = await admin.firestore().collection("users").doc(auth.uid).get();
    if (!callerDoc.exists) throw new HttpsError("permission-denied", "User profile not found.");
    const callerRole = callerDoc.data().role;
    if (!["MIS", "HCSD"].includes(callerRole)) throw new HttpsError("permission-denied", "Insufficient permissions to create accounts.");

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

        const transporter = createTransporter();
        await transporter.sendMail({
            from: `"TranspiraFund LGU Portal" <${gmailUser.value()}>`,
            to: email,
            subject: "TranspiraFund — Your Account Has Been Created",
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
    <p style="margin:0 0 8px;font-size:22px;font-weight:800;color:#0f172a;letter-spacing:-0.3px;">Welcome, ${firstName}!</p>
    <p style="margin:0 0 28px;font-size:15px;color:#64748b;line-height:1.7;">Your official TranspiraFund LGU Portal account has been provisioned. Use the credentials below to sign in for the first time.</p>
    <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:24px;margin-bottom:24px;">
      <p style="margin:0 0 4px;font-size:11px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:0.1em;">Login Email</p>
      <p style="margin:0 0 20px;font-size:15px;font-weight:700;color:#0f766e;">${email}</p>
      <p style="margin:0 0 4px;font-size:11px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:0.1em;">Temporary Password</p>
      <p style="margin:0;font-size:22px;font-weight:900;letter-spacing:3px;color:#0f172a;font-family:monospace;">${tempPassword}</p>
    </div>
    <div style="background:#fff7ed;border:1px solid #fed7aa;border-radius:12px;padding:16px 20px;">
      <p style="margin:0 0 6px;font-size:12px;font-weight:700;color:#ea580c;text-transform:uppercase;letter-spacing:0.08em;">Action Required</p>
      <p style="margin:0;font-size:13px;color:#9a3412;line-height:1.6;">You will be required to change your password on first login. Do not share this email or your credentials with anyone.</p>
    </div>
  </td></tr>
  <tr><td style="padding:20px 40px 28px;border-top:1px solid #f1f5f9;text-align:center;">
    <p style="margin:0;font-size:11px;color:#cbd5e1;letter-spacing:0.05em;text-transform:uppercase;">TranspiraFund &bull; Secured LGU Portal &bull; Automated System Email</p>
  </td></tr>
</table>
</td></tr></table>
</body></html>`,
        });

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
            subject: `TranspiraFund — ${lguName} Has Been Onboarded`,
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
    <p style="margin:0 0 8px;font-size:22px;font-weight:800;color:#0f172a;letter-spacing:-0.3px;">Welcome to TranspiraFund</p>
    <p style="margin:0 0 28px;font-size:15px;color:#64748b;line-height:1.7;">${lguName} has been onboarded as a tenant on TranspiraFund. You have been provisioned as the first MIS Administrator for this LGU.</p>
    <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:24px;margin-bottom:24px;">
      <p style="margin:0 0 4px;font-size:11px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:0.1em;">Login Email</p>
      <p style="margin:0 0 20px;font-size:15px;font-weight:700;color:#0f766e;">${firstMisAdminEmail}</p>
      <p style="margin:0 0 4px;font-size:11px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:0.1em;">Temporary Password</p>
      <p style="margin:0;font-size:22px;font-weight:900;letter-spacing:3px;color:#0f172a;font-family:monospace;">${tempPassword}</p>
    </div>
    <div style="background:#fff7ed;border:1px solid #fed7aa;border-radius:12px;padding:16px 20px;">
      <p style="margin:0 0 6px;font-size:12px;font-weight:700;color:#ea580c;text-transform:uppercase;letter-spacing:0.08em;">Action Required</p>
      <p style="margin:0;font-size:13px;color:#9a3412;line-height:1.6;">You will be required to change your password on first login. Do not share this email or your credentials with anyone.</p>
    </div>
  </td></tr>
  <tr><td style="padding:20px 40px 28px;border-top:1px solid #f1f5f9;text-align:center;">
    <p style="margin:0;font-size:11px;color:#cbd5e1;letter-spacing:0.05em;text-transform:uppercase;">TranspiraFund &bull; Secured LGU Portal &bull; Automated System Email</p>
  </td></tr>
</table>
</td></tr></table>
</body></html>`,
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

        // Auto-unassign active projects assigned to a PE being deleted. Runs
        // BEFORE Auth + Firestore user delete so a partial failure leaves the
        // call retryable without an orphaned Auth user. Completed projects
        // keep the dangling UID as a historical "who did this work" record.
        let unassignedActiveProjects = 0;
        if (targetData.role === "PROJ_ENG") {
            const assignedSnap = await admin.firestore().collection("projects")
                .where("tenantId", "==", callerTenantId)
                .where("projectEngineer", "==", uid)
                .get();

            const activeDocs = assignedSnap.docs.filter((d) => {
                const status = (d.data().status || "").toLowerCase();
                return status !== "completed";
            });

            for (let i = 0; i < activeDocs.length; i += 400) {
                const chunk = activeDocs.slice(i, i + 400);
                const batch = admin.firestore().batch();
                chunk.forEach((d) => {
                    batch.update(d.ref, {
                        projectEngineer: "",
                        status: "Delayed",
                        engineerUnassignedAt: admin.firestore.FieldValue.serverTimestamp(),
                        engineerUnassignedReason: "PE account deleted",
                    });
                });
                await batch.commit();
            }
            unassignedActiveProjects = activeDocs.length;
        }

        await admin.auth().deleteUser(uid);
        await admin.firestore().collection("users").doc(uid).delete();

        if (callerRole === "MIS") {
            await logSystemAudit(auth.uid, auth.token.email, "ACCOUNT_DELETED",
                { uid, email: targetEmail, role: targetRole, unassignedActiveProjects }, "SUCCESS", null, callerTenantId);
        } else {
            await logAudit(auth.uid, auth.token.email, "ACCOUNT_DELETED", uid,
                { deletedEmail: targetEmail, unassignedActiveProjects }, callerTenantId);
        }

        return { success: true, message: "Account deleted successfully.", unassignedActiveProjects };
    } catch (error) {
        logger.error("Error deleting user:", error);
        throw new HttpsError("internal", "Unable to delete account. Please try again.");
    }
});

// Reassigns a project's Project Engineer. Used to recover orphaned projects
// after a PE deletion (see deleteOfficialAccount above) — HCSD picks a
// replacement PE from the Project Detail page's engineer card dropdown. Also
// usable for routine reassignments. Validates the new PE is in the caller's
// tenant, clears the unassignment audit fields, flips status back to Ongoing,
// fires a PROJECT_ASSIGNED notification to the new engineer, and writes a
// PROJECT_REASSIGNED HCSD audit row.
const reassignProjectEngineerSchema = z.object({
    projectId: z.string().min(1).max(128),
    newEngineerUid: z.string().min(1).max(128),
});

exports.reassignProjectEngineer = onCall(async (request) => {
    const { auth, data } = request;
    if (!auth) throw new HttpsError("unauthenticated", "Must be authenticated.");
    const callerTenantId = requireTenantClaim(auth);

    const callerDoc = await admin.firestore().collection("users").doc(auth.uid).get();
    if (!callerDoc.exists || callerDoc.data().role !== "HCSD") {
        throw new HttpsError("permission-denied", "Only HCSD personnel can reassign engineers.");
    }

    const parsed = reassignProjectEngineerSchema.safeParse(data);
    if (!parsed.success) {
        throw new HttpsError("invalid-argument", parsed.error.errors[0]?.message ?? "Invalid input.");
    }
    const { projectId, newEngineerUid } = parsed.data;

    const projectRef = admin.firestore().collection("projects").doc(projectId);
    const projectSnap = await projectRef.get();
    if (!projectSnap.exists) {
        throw new HttpsError("not-found", "Project not found.");
    }
    const project = projectSnap.data();
    if (project.tenantId !== callerTenantId) {
        throw new HttpsError("permission-denied", "Project belongs to a different tenant.");
    }
    if ((project.status || "").toLowerCase() === "completed") {
        throw new HttpsError("failed-precondition", "Cannot reassign engineer on a Completed project.");
    }
    if (project.projectEngineer === newEngineerUid) {
        throw new HttpsError("failed-precondition", "That engineer is already assigned.");
    }

    const peSnap = await admin.firestore().collection("users").doc(newEngineerUid).get();
    if (!peSnap.exists) {
        throw new HttpsError("not-found", "Engineer not found.");
    }
    const pe = peSnap.data();
    if (pe.tenantId !== callerTenantId) {
        throw new HttpsError("permission-denied", "Engineer is not in your tenant.");
    }
    if (pe.role !== "PROJ_ENG") {
        throw new HttpsError("failed-precondition", "Target user is not a Project Engineer.");
    }

    const previousEngineer = project.projectEngineer || null;

    try {
        await projectRef.update({
            projectEngineer: newEngineerUid,
            status: "Ongoing",
            engineerReassignedAt: admin.firestore.FieldValue.serverTimestamp(),
            engineerUnassignedAt: admin.firestore.FieldValue.delete(),
            engineerUnassignedReason: admin.firestore.FieldValue.delete(),
        });

        await logAudit(auth.uid, auth.token.email, "PROJECT_REASSIGNED", projectId, {
            projectName: project.projectName,
            previousEngineer,
            newEngineer: newEngineerUid,
            newEngineerEmail: pe.email || null,
        }, callerTenantId);

        await createNotification({
            recipientUid: newEngineerUid,
            action: "PROJECT_ASSIGNED",
            severity: "info",
            title: "New project assigned",
            body: `${project.projectName}, ${project.barangay}`,
            targetType: "project",
            targetId: projectId,
            tenantId: callerTenantId,
        });

        return { success: true };
    } catch (error) {
        logger.error("Error reassigning project engineer:", error);
        throw new HttpsError("internal", "Unable to reassign engineer. Please try again.");
    }
});

exports.createProject = onCall(async (request) => {
    const { auth, data } = request;
    if (!auth) throw new HttpsError("unauthenticated", "Must be authenticated to create projects.");
    const callerTenantId = requireTenantClaim(auth);

    const callerDoc = await admin.firestore().collection("users").doc(auth.uid).get();
    if (!callerDoc.exists || callerDoc.data().role !== "HCSD") {
        throw new HttpsError("permission-denied", "Only HCSD personnel can create projects.");
    }

    await enforceCreateProjectRateLimit(auth.uid, callerTenantId);

    const sanitized = Object.fromEntries(
        Object.entries(data || {}).map(([k, v]) => [k, v === null ? undefined : v])
    );

    const parsed = createProjectSchema.safeParse(sanitized);
    if (!parsed.success) {
        const msg = parsed.error.errors[0]?.message ?? "Invalid project data.";
        throw new HttpsError("invalid-argument", msg);
    }
    const projectFields = Object.fromEntries(
        Object.entries(parsed.data).filter(([, v]) => v !== undefined && v !== null)
    );

    // Default classification fields when client omits them (e.g. legacy clients
    // not yet updated to call validateProjectClassification first). Treated as
    // "unverified" by generateMilestones, which will gate on these values.
    projectFields.projectType = projectFields.projectType || "unknown";
    projectFields.classificationConfidence = typeof projectFields.classificationConfidence === "number"
        ? projectFields.classificationConfidence
        : 0;

    // Defense-in-depth: if the client forwarded the full classifier verdict,
    // refuse outright when any safety flag is set. The classifier already
    // rejects these client-side, but a tampered client could bypass that
    // check; this is the last server-side gate before the name lands in
    // Firestore (and from there into the mobile milestone-draft prompt).
    const cls = projectFields.classification;
    if (cls?.verdict?.inputSafety) {
        const s = cls.verdict.inputSafety;
        if (s.containsPromptInjectionPattern || s.containsProfanity || s.containsPii
            || s.containsMixedScript || s.containsNonPrintable) {
            throw new HttpsError(
                "failed-precondition",
                "Project name failed classifier safety checks. Re-run validation.",
            );
        }
    }
    if (cls?.verdict?.nameQuality) {
        const q = cls.verdict.nameQuality;
        if (q.isGibberish || q.isPlaceholder) {
            throw new HttpsError(
                "failed-precondition",
                "Project name was flagged as gibberish or a placeholder.",
            );
        }
    }
    if (cls?.verdict?.semanticCoherence) {
        const c = cls.verdict.semanticCoherence;
        if (c.allWordsInfraRelated === false || c.combinationMakesSense === false
            || c.overallNamePlausible === false) {
            throw new HttpsError(
                "failed-precondition",
                "Project name does not coherently describe a public infrastructure project. Re-run validation.",
            );
        }
    }

    // Defense-in-depth: every NON-EMPTY description goes through the same
    // prescreen patterns regardless of whether the client called
    // validateProjectClassification. A tampered client could skip
    // classification entirely; this catches the worst patterns (prompt
    // injection, mixed script, non-printable) before the description lands
    // on the project doc. Empty/absent descriptions are accepted as-is.
    if (typeof projectFields.projectDescription === "string"
        && projectFields.projectDescription.trim().length > 0) {
        const descPrescreen = prescreenProjectDescription(projectFields.projectDescription);
        if (descPrescreen.rejection) {
            throw new HttpsError("invalid-argument", descPrescreen.rejection.reason);
        }
        projectFields.projectDescription = descPrescreen.cleaned;
    }

    if (projectFields.projectEngineer) {
        const peDoc = await admin.firestore().collection("users").doc(projectFields.projectEngineer).get();
        if (!peDoc.exists || peDoc.data().tenantId !== callerTenantId) {
            throw new HttpsError("permission-denied", "Assigned project engineer is not in your tenant.");
        }
    }

    // Build the stamped classification object that the mobile app reads to
    // gate generateMilestones. Strip the client's `classification` slot from
    // the rest of projectFields so it doesn't double-write.
    //
    // Under the v1 classifier contract, `classification` is ALWAYS written
    // (never null) so mobile sees a consistent shape. Legacy clients that
    // omit the map get server-side defaults: admitted derives from the
    // legacy `classificationGatePasses` gate (mirroring the mobile 1c
    // legacy fallback), isComposite defaults to false, components to [],
    // and contractVersion is always "1".
    const { classification: clientClassification, ...projectFieldsClean } = projectFields;
    const stampedClassification = clientClassification
        ? {
            projectType: clientClassification.projectType || projectFieldsClean.projectType,
            confidence: typeof clientClassification.confidence === "number"
                ? clientClassification.confidence
                : projectFieldsClean.classificationConfidence,
            durationFlag: clientClassification.durationFlag || null,
            typicalDurationDays: clientClassification.typicalDurationDays || null,
            reason: clientClassification.reason || null,
            classifierVersion: clientClassification.classifierVersion || null,
            classifierPromptVersion: clientClassification.classifierPromptVersion || null,
            classifiedAt: admin.firestore.FieldValue.serverTimestamp(),
            verdict: clientClassification.verdict || null,
            // v1 contract fields with pre-v1 client defaulting.
            admitted: typeof clientClassification.admitted === "boolean"
                ? clientClassification.admitted
                : classificationGatePasses(projectFieldsClean),
            isComposite: typeof clientClassification.isComposite === "boolean"
                ? clientClassification.isComposite
                : false,
            components: Array.isArray(clientClassification.components)
                ? clientClassification.components
                : [],
            componentsSynthesized: typeof clientClassification.componentsSynthesized === "boolean"
                ? clientClassification.componentsSynthesized
                : false,
            contractVersion: clientClassification.contractVersion || "1",
        }
        : {
            // Fully legacy client omitted classification entirely. Stamp a v1
            // map with pure defaults. admitted derives from the flat
            // projectType/classificationConfidence values defaulted above.
            classifiedAt: admin.firestore.FieldValue.serverTimestamp(),
            verdict: null,
            admitted: classificationGatePasses(projectFieldsClean),
            isComposite: false,
            components: [],
            componentsSynthesized: false,
            classifierPromptVersion: null,
            contractVersion: "1",
        };

    try {
        const projectRef = await admin.firestore().collection("projects").add({
            ...projectFieldsClean,
            status: projectFieldsClean.projectEngineer ? "Ongoing" : "Delayed",
            progress: 0,
            createdBy: auth.uid,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            tenantId: callerTenantId,
            classification: stampedClassification,
        });

        await logAudit(auth.uid, auth.token.email, "PROJECT_CREATED", projectRef.id, {
            projectName: projectFields.projectName,
            contractAmount: projectFields.contractAmount,
            barangay: projectFields.barangay,
            projectType: projectFields.projectType,
            classificationConfidence: projectFields.classificationConfidence,
        }, callerTenantId);

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

    await enforceNtpRateLimit(auth.uid, callerTenantId);

    const parsed = attachNtpSchema.safeParse(data || {});
    if (!parsed.success) {
        const msg = parsed.error.errors[0]?.message ?? "Invalid NTP payload.";
        throw new HttpsError("invalid-argument", msg);
    }
    const { projectId, fileName, fileUrl, contentType } = parsed.data;

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

        return { success: true };
    } catch (error) {
        logger.error("Error attaching NTP:", error);
        throw new HttpsError("internal", "Unable to attach NTP. Please try again.");
    }
});

// ─── Rollback an orphan project draft ───────────────────────────────────────
// Recovery path for the create-then-attachNtp two-phase flow. If attachNtp
// fails in the client, the project doc was already written by createProject
// and would otherwise become an orphan. HCSD invokes this callable from that
// failure branch to delete the orphan.
//
// Strictly guarded — this is NOT a general delete-project API:
//   1. Caller must be HCSD and bound to the project's tenant.
//   2. Caller must be the original creator (createdBy match).
//   3. Project must have no NTP attached yet (ntpUploadedAt == null).
//   4. Project must have no milestones (defensive — mobile engineer hasn't
//      started work). The first three guards already imply this in normal
//      flow, but the explicit check protects against future code changes
//      that move milestone creation earlier.
//
// Any guard failure throws — the caller should not retry blindly.

exports.rollbackOrphanProject = onCall(async (request) => {
    const { auth, data } = request;
    if (!auth) throw new HttpsError("unauthenticated", "Authentication required.");
    const callerTenantId = requireTenantClaim(auth);

    const callerDoc = await admin.firestore().collection("users").doc(auth.uid).get();
    if (!callerDoc.exists || callerDoc.data().role !== "HCSD") {
        throw new HttpsError("permission-denied", "Only HCSD personnel can roll back a project draft.");
    }

    const { projectId } = data || {};
    if (!projectId || typeof projectId !== "string") {
        throw new HttpsError("invalid-argument", "projectId is required.");
    }

    const projectRef = admin.firestore().collection("projects").doc(projectId);
    const projectSnap = await projectRef.get();
    if (!projectSnap.exists) {
        // Treat as no-op (already gone) rather than error so the client UX
        // can call this idempotently without distinguishing "first attempt"
        // from "retry after partial failure".
        return { success: true, rolledBack: false, reason: "not_found" };
    }
    const projectData = projectSnap.data();

    if (projectData.tenantId !== callerTenantId) {
        throw new HttpsError("permission-denied", "Cannot roll back a project in another tenant.");
    }
    if (projectData.createdBy !== auth.uid) {
        throw new HttpsError("permission-denied", "Only the original creator can roll back this draft.");
    }
    if (projectData.ntpUploadedAt != null) {
        throw new HttpsError("failed-precondition", "Project has an NTP attached; rollback is not allowed.");
    }

    const milestonesSnap = await projectRef.collection("milestones").limit(1).get();
    if (!milestonesSnap.empty) {
        throw new HttpsError("failed-precondition", "Project already has milestones; rollback is not allowed.");
    }

    try {
        await projectRef.delete();
    } catch (err) {
        logger.error(`rollbackOrphanProject delete failed for ${projectId}:`, err);
        throw new HttpsError("internal", "Could not delete the orphan project record.");
    }

    await logAudit(auth.uid, auth.token.email, "PROJECT_ROLLED_BACK", projectId, {
        projectName: projectData.projectName || null,
        reason: "ntp_attach_failure",
    }, callerTenantId);

    return { success: true, rolledBack: true };
});

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

exports.logUserLogout = onCall(async (request) => {
    const { auth } = request;
    if (!auth) return { success: false };
    try {
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

        for (let i = 0; i < updates.length; i += 400) {
            const chunk = updates.slice(i, i + 400);
            const batch = admin.firestore().batch();
            chunk.forEach(u => {
                batch.update(admin.firestore().collection("projects").doc(u.projectId), { projectEngineer: u.newUid });
            });
            await batch.commit();
        }

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

exports.sendPasswordReset = onCall({ secrets: [gmailUser, gmailAppPassword] }, async (request) => {
    const { data } = request;
    const { email } = data;

    if (!email || typeof email !== "string") {
        throw new HttpsError("invalid-argument", "Email is required.");
    }

    const cleanEmail = email.trim().toLowerCase();
    const RESET_BASE = "https://transpirafund-webapp.web.app/reset-password";

    let tenantId = null;
    try {
        const userRecord = await admin.auth().getUserByEmail(cleanEmail);
        const userDoc = await admin.firestore().collection("users").doc(userRecord.uid).get();
        if (userDoc.exists) tenantId = userDoc.data().tenantId || null;
    } catch {}

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
        if (error.code !== "auth/user-not-found") {
            logger.error("Password reset error:", error);
        }
    }

    return { success: true };
});

exports.resetPassword = onCall(async (request) => {
    const { data } = request;
    const { oobCode, newPassword } = data;

    if (!oobCode || typeof oobCode !== "string") {
        throw new HttpsError("invalid-argument", "Invalid reset token.");
    }
    if (!newPassword || typeof newPassword !== "string") {
        throw new HttpsError("invalid-argument", "Password is required.");
    }

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
        "Milestone Generator Misconfigured",
        "Password Set",
        "Project Status Updated",
        "Milestone Draft Removed",
        "Milestones Repaired",
        "Milestone Manually Added",
    ];

    try {
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

        return { success: true, deleted };
    } catch (error) {
        logger.error("[purgeMobileOriginHcsdAudit] Failed:", error);
        throw new HttpsError("internal", "Unable to purge audit entries. Please try again.");
    }
});

exports.onUserWritten = onDocumentWritten("users/{userId}", async () => {
    try {
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

exports.onProjectWritten = onDocumentWritten("projects/{projectId}", async () => {
    try {
        const projectsSnapshot = await admin.firestore().collection("projects").get();
        const projects = projectsSnapshot.docs.map(doc => doc.data());

        const projectCount = projects.length;
        const totalBudget = projects.reduce((acc, p) => acc + (Number(p.contractAmount) || 0), 0);

        // Case-insensitive status matching — keeps stats accurate even if a
        // legacy/manually-edited doc carries "completed", "ONGOING", etc.
        // Mirrors the comparison style used everywhere else (statusMeta,
        // normalizeStatus, recomputeProjectActualPercent's rollup guard).
        const statusOf = (p) => (p.status || "").toLowerCase();

        const now = new Date();
        const done = projects.filter(p => statusOf(p) === "completed").length;
        const delayed = projects.filter(p => statusOf(p) === "delayed").length;
        const ongoing = projects.filter(p => statusOf(p) === "ongoing").length;
        const delay = projects.filter(p => {
            if (statusOf(p) === "completed") return false;
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

const parseMilestoneFromDetailsString = (s) => {
    if (typeof s !== "string" || !s.trim()) return null;
    const parts = s.split(/\s*[·|]\s*/).map((p) => p.trim()).filter(Boolean);
    if (parts.length === 0) return null;
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

const labelFromMilestoneDoc = (milestoneDoc) => {
    if (!milestoneDoc) return null;
    return formatMilestoneLabel({
        name: milestoneDoc.title || null,
        phase: null,
        order: milestoneDoc.sequence ?? null,
    });
};

// "Proof Uploaded" is intentionally omitted: the onProofUploaded trigger
// (below) runs an AI vision check and fans out a single summary notification
// per upload. The mobile audit doc remains a log-only record.
const FIELD_NOTIFICATION_SPECS = {
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

            const projectTenantId = project.tenantId || null;
            if (entry.tenantId && projectTenantId && entry.tenantId !== projectTenantId) {
                logger.warn(`[onMobileAuditCreated] Tenant mismatch on ${entry.action}: entry=${entry.tenantId} project=${projectTenantId}`);
                return;
            }
            if (!projectTenantId) {
                logger.warn(`[onMobileAuditCreated] Skipping ${entry.action}: project ${projectId} has no tenantId (pre-migration doc)`);
                return;
            }

            const recipientUid = project.createdBy;
            if (!recipientUid) return;

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

            const completed = confirmed.filter((m) => {
                const statusLower = (m.status || "").toLowerCase();
                return ["done", "complete", "completed"].includes(statusLower);
            }).length;

            const actualPercent = Math.round((completed / confirmed.length) * 100);
            const updates = { actualPercent };

            // Forward-only status rollup: when all confirmed milestones are
            // done, persist project.status = "Completed" so every consumer
            // (HCSD filters, dashboards, deleteOfficialAccount's
            // active-vs-completed filter) sees one source of truth. Mobile's
            // client-side deriveStatus() already returns "Completed" in this
            // state; this just makes the persisted field catch up. We don't
            // auto-revert Completed → Ongoing if a milestone gets un-marked
            // — that's rare and slightly destructive; HCSD can change it
            // manually if needed.
            if (actualPercent === 100) {
                const projectSnap = await admin.firestore()
                    .collection("projects").doc(projectId).get();
                const current = projectSnap.data() || {};
                if ((current.status || "").toLowerCase() !== "completed") {
                    updates.status = "Completed";
                    if (!current.actualDateCompleted) {
                        updates.actualDateCompleted = new Date().toISOString().split("T")[0];
                    }
                }
            }

            await admin.firestore().collection("projects").doc(projectId)
                .update(updates);
        } catch (err) {
            logger.error(`[recomputeProjectActualPercent] ${projectId}:`, err);
        }
    },
);

// Daily slippage detector. Runs at 8 AM Manila time and flips any active
// project whose computed slippage > 0 from "Ongoing" to "Delayed", stamping
// slippageDetectedAt + slippagePercent. Fires a "system"-category
// notification to both the HCSD creator and the assigned PE every morning
// the project is still slipping — a daily reminder until the slippage is
// resolved. (Recipients see one row per morning, severity warn; the title
// distinguishes first-detection from a reminder so the inbox doesn't read
// like an exact duplicate.) On recovery (slippage <= 0), clears the
// slippage fields and restores status to "Ongoing" — only if no other
// delay reason lingers (e.g. engineerUnassignedAt). Mirrors the slippage
// formula in client/src/utils/slippage.js so the dashboard widget and the
// persisted status field stay in agreement.
const computeSlippagePercent = (project, now) => {
    const start = project.officialDateStarted;
    const end = project.originalDateCompletion;
    if (!start || !end) return null;
    const s = new Date(start).getTime();
    const e = new Date(end).getTime();
    if (isNaN(s) || isNaN(e) || e <= s) return null;
    const timeElapsed = Math.min(100, Math.max(0, ((now - s) / (e - s)) * 100));
    const actual = Number(project.actualPercent) || 0;
    return Math.round((timeElapsed - actual) * 10) / 10;
};

// Scans every non-Completed engineer-assigned project for slippage. Accepts
// an optional { tenantId } to restrict the scan to a single tenant — the
// scheduled job (detectProjectSlippage) omits it and runs globally by design
// (one daily system-wide sweep), while the manual callable
// (runSlippageScanNow) MUST pass the caller's tenantId so one tenant's HCSD
// cannot mutate other tenants' projects or fire notifications into them.
const runSlippageScan = async ({ tenantId } = {}) => {
    const db = admin.firestore();
    const query = tenantId
        ? db.collection("projects").where("tenantId", "==", tenantId)
        : db.collection("projects");
    const snap = await query.get();
    const now = Date.now();

    let detected = 0;
    let recovered = 0;
    let stillSlipping = 0;

    for (const doc of snap.docs) {
        const p = doc.data();
        const statusLower = (p.status || "").toLowerCase();

        // Skip Completed (terminal) and projects with no assigned engineer
        // (their Delayed state already reflects a different reason).
        if (statusLower === "completed") continue;
        if (!p.projectEngineer) continue;

        const slippage = computeSlippagePercent(p, now);
        if (slippage === null) continue;

        const wasSlipping = !!p.slippageDetectedAt;
        const isSlipping = slippage > 0;

        if (isSlipping) {
            // Persist the slippage state. Only stamp slippageDetectedAt on
            // the first detection so it remains a record of when the
            // project started slipping, but refresh slippagePercent every
            // run so the latest number is on the doc.
            const updates = { slippagePercent: slippage };
            if (!wasSlipping) {
                updates.status = "Delayed";
                updates.slippageDetectedAt = admin.firestore.FieldValue.serverTimestamp();
            }
            await doc.ref.update(updates);

            // Daily nag: notify both HCSD creator + PE every morning the
            // project is still slipping. The first notification uses a
            // "now Delayed" title; subsequent ones use "still Delayed"
            // so the inbox reads naturally over multiple days.
            const title = wasSlipping ? "Project still Delayed" : "Project is now Delayed";
            const body = `${p.projectName || "Project"} is ${slippage}% behind schedule.`;
            const baseNotif = {
                action: "PROJECT_DELAYED",
                severity: "warn",
                category: "system",
                title,
                body,
                targetType: "project",
                targetId: doc.id,
                metadata: {
                    projectId: doc.id,
                    projectName: p.projectName || null,
                    slippagePercent: slippage,
                    reminder: wasSlipping,
                },
                tenantId: p.tenantId,
            };

            if (p.createdBy) {
                await createNotification({ ...baseNotif, recipientUid: p.createdBy });
            }
            if (p.projectEngineer && p.projectEngineer !== p.createdBy) {
                await createNotification({ ...baseNotif, recipientUid: p.projectEngineer });
            }

            if (wasSlipping) stillSlipping++; else detected++;
        } else if (wasSlipping) {
            const updates = {
                slippageDetectedAt: admin.firestore.FieldValue.delete(),
                slippagePercent: admin.firestore.FieldValue.delete(),
            };
            if (!p.engineerUnassignedAt && p.projectEngineer) {
                updates.status = "Ongoing";
            }
            await doc.ref.update(updates);
            recovered++;
        }
    }

    logger.info(`[slippageScan] tenantId=${tenantId || "ALL"} detected=${detected} recovered=${recovered} stillSlipping=${stillSlipping}`);
    return { detected, recovered, stillSlipping };
};

exports.detectProjectSlippage = onSchedule({
    schedule: "0 8 * * *",
    timeZone: "Asia/Manila",
    region: "asia-southeast1",
}, async () => {
    try {
        await runSlippageScan();
    } catch (err) {
        logger.error("[detectProjectSlippage] scan failed:", err);
    }
});

// Manual trigger so HCSD can force a slippage refresh on demand (e.g.
// immediately after deploying the auto-detector, or when an HCSD user
// wants to validate state without waiting for the next 8 AM cron). MIS or
// HCSD can call this; same tenant isolation as the cron's per-project
// notification fan-out.
exports.runSlippageScanNow = onCall(async (request) => {
    const { auth } = request;
    if (!auth) throw new HttpsError("unauthenticated", "Must be authenticated.");
    const callerTenantId = requireTenantClaim(auth);
    const callerDoc = await admin.firestore().collection("users").doc(auth.uid).get();
    if (!callerDoc.exists) throw new HttpsError("permission-denied", "User not found.");
    const role = callerDoc.data().role;
    if (role !== "HCSD" && role !== "MIS") {
        throw new HttpsError("permission-denied", "Only HCSD or MIS can trigger this scan.");
    }
    try {
        const result = await runSlippageScan({ tenantId: callerTenantId });
        return { success: true, ...result };
    } catch (err) {
        logger.error("[runSlippageScanNow] failed:", err);
        throw new HttpsError("internal", "Slippage scan failed.");
    }
});

exports.updateProfilePhoto = onCall(async (request) => {
    const { auth, data } = request;
    if (!auth) throw new HttpsError("unauthenticated", "Must be authenticated to update profile photo.");
    const callerTenantId = requireTenantClaim(auth);

    const { photoURL } = data;
    if (!photoURL || typeof photoURL !== "string") {
        throw new HttpsError("invalid-argument", "Invalid photo URL.");
    }
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
        await logSystemAudit(
            auth.uid, auth.token.email, "PROFILE_UPDATED",
            { oldName: oldName ?? "—", newName },
            "SUCCESS", newName, callerTenantId,
        );
        return { success: true };
    } catch (error) {
        logger.error("Error updating profile:", error);
        throw new HttpsError("internal", "Unable to update name. Please try again.");
    }
});

const Anthropic = require("@anthropic-ai/sdk").default;
const anthropicApiKey = defineSecret("ANTHROPIC_API_KEY");

// ─── Project-name classifier (gatekeeper for project creation) ─────────────
// Two-tier semantic validation: before HCSD writes a project document, the
// project name is sent to Haiku 4.5 with a forced classification tool. The
// classifier judges category (infrastructure scope) only; funding source is
// captured elsewhere on the form. Prompt + tool schema live in ./lib/classifier-prompt
// so a standalone diagnostic script (scripts/classifier-diagnostic.js) can import them
// without pulling in this file's firebase-functions runtime side effects.
const {
    CLASSIFIER_SYSTEM_PROMPT,
    classifyInfrastructureTool,
    CLASSIFIER_PROMPT_VERSION,
} = require("./lib/classifier-prompt");


const validateProjectClassificationSchema = z.object({
    projectName: z.string().min(10).max(200),
    projectDescription: z.string().max(1000).optional(),
    barangay: z.string().min(1).max(100),
    sitioStreet: z.string().min(1).max(200),
    contractor: z.string().min(1).max(200),
    contractAmount: z.number().min(10000).max(1_000_000_000),
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "startDate must be YYYY-MM-DD"),
    endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "endDate must be YYYY-MM-DD"),
});

exports.validateProjectClassification = onCall(
  { secrets: [anthropicApiKey], timeoutSeconds: 30 },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Authentication required.");
    }
    requireTenantClaim(request.auth);
    if (request.auth.token.role !== "HCSD") {
      throw new HttpsError(
        "permission-denied",
        "Only HCSD personnel can validate project classification."
      );
    }

    const parsed = validateProjectClassificationSchema.safeParse(request.data || {});
    if (!parsed.success) {
      throw new HttpsError(
        "invalid-argument",
        parsed.error.errors[0]?.message || "Invalid classifier payload."
      );
    }
    const {
      projectName: rawProjectName,
      projectDescription: rawProjectDescription,
      barangay,
      sitioStreet,
      contractor,
      contractAmount,
      startDate,
      endDate,
    } = parsed.data;

    // Pre-LLM regex prescreen — deterministic gate before any token spend.
    // Each input is prescreened independently so we can route the rejection
    // back to the correct form field (`field: "projectName" | "projectDescription"`).
    // Tightening this gate is cheaper than tightening the prompt.
    const namePrescreen = prescreenProjectName(rawProjectName);
    if (namePrescreen.rejection) {
      return {
        accepted: false,
        reason: namePrescreen.rejection.reason,
        projectType: "unknown",
        confidence: 0,
        rejectedBy: "prescreen",
        rejectionKind: namePrescreen.rejection.kind,
        field: "projectName",
      };
    }
    const projectName = namePrescreen.cleaned;

    // Project description is optional. If HCSD provided one, prescreen it the
    // same way as the name. If it's absent or empty, skip prescreen and the
    // classifier evaluates the name + structured fields without it.
    let projectDescription = "";
    if (typeof rawProjectDescription === "string" && rawProjectDescription.trim().length > 0) {
      const descPrescreen = prescreenProjectDescription(rawProjectDescription);
      if (descPrescreen.rejection) {
        return {
          accepted: false,
          reason: descPrescreen.rejection.reason,
          projectType: "unknown",
          confidence: 0,
          rejectedBy: "prescreen",
          rejectionKind: descPrescreen.rejection.kind,
          field: "projectDescription",
        };
      }
      projectDescription = descPrescreen.cleaned;
    }

    let durationDays;
    try {
      // Loose bounds: the AI's durationFlag is the sole "is this realistic"
      // judge, so the classifier must see every plausible duration (incl.
      // very short ones like 7 days) and let the client's overlay handle it.
      durationDays = parseAndValidateDuration(startDate, endDate, { minDays: 1, maxDays: 3650 });
    } catch (err) {
      throw new HttpsError(err.code || "invalid-argument", err.message);
    }

    const client = new Anthropic({ apiKey: anthropicApiKey.value() });

    let response;
    try {
      response = await client.messages.create({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 512,
        system: CLASSIFIER_SYSTEM_PROMPT,
        tools: [classifyInfrastructureTool],
        tool_choice: { type: "tool", name: "classify_infrastructure_project" },
        messages: [
          {
            role: "user",
            content: [
              `Project name: ${projectName}`,
              projectDescription
                ? `Project description: ${projectDescription}`
                : `Project description: (HCSD did not provide a description — description is optional)`,
              `Barangay (structured dropdown selection): ${barangay}`,
              `Sitio / Street (structured form input): ${sitioStreet}`,
              `Contractor (structured form input): ${contractor}`,
              `Contract amount (structured form input): PHP ${contractAmount.toLocaleString("en-PH")}`,
              `Start date: ${startDate}`,
              `End date: ${endDate}`,
              `Duration: ${durationDays} days`,
            ].join("\n"),
          },
        ],
      });
    } catch (error) {
      logger.error("[validateProjectClassification] Anthropic error:", {
        status: error?.status,
        code: error?.code,
        message: error?.message,
      });
      throw new HttpsError("internal", "Classifier unavailable. Please try again.");
    }

    const toolUse = response.content.find((b) => b.type === "tool_use");
    if (!toolUse) {
      throw new HttpsError("internal", "Classifier returned no structured output.");
    }

    const decision = decideClassification(toolUse.input, durationDays, {
      onCoercion: (info) => {
        logger.warn(
          `[validateProjectClassification] Coerced admitted project from "unknown" to "${info.coercedType}" (basis: ${info.basis})`,
          info,
        );
      },
      onSynthesis: (info) => {
        // Empty-components safeguard fired: model returned an empty
        // components[] on an admitted project. Log at WARN so a spike in
        // synthesis rate is visible in Cloud Logging — that signals a
        // classifier regression on multi-structure names.
        logger.warn(
          `[validateProjectClassification] Empty components[] on admitted project; synthesized ["${info.synthesizedComponent}"] from projectType=${info.projectType} (basis: ${info.basis})`,
          { ...info, projectName },
        );
      },
    });
    if (decision.accepted) {
      decision.classifierVersion = CLASSIFIER_VERSION();
      decision.classifierPromptVersion = CLASSIFIER_PROMPT_VERSION;
      decision.classifiedAtISO = new Date().toISOString();
    }
    return decision;
  }
);

// ─── Automatic Milestone Photo Verification ───────────────────────────────
// Every proof-of-work photo a mobile engineer uploads is auto-scanned by
// Anthropic Claude Sonnet 4.6. The structured assessment is appended to the
// milestone's verificationHistory[] and a category:"field" summary notification
// is fanned out to the project's HCSD creator. HCSD does not approve or
// reject — they are informed observers.

const VERIFICATION_SYSTEM_PROMPT = `You are a visual verification assistant for the Cebu City Department of Engineering and Public Works (DEPW), Construction Services Division. Your task is to assess whether photographs uploaded by a Project Engineer for a specific construction milestone visually depict the activity or deliverable described in that milestone.

## Your Role

You are an automated alignment checker. Your structured output is delivered as a notification summary to the Head of Construction Services for awareness only — there is no manual approve/reject step on the web side. Your job is to surface alignment, ambiguity, or clear mismatch as concretely as possible so the summary is actionable.

## What You Are Looking At

Each photograph was taken in the field by a DEPW-assigned Project Engineer or Inspector at a barangay-level infrastructure project site in Cebu City. The photographs typically include a tamper-evident burn-in banner showing location name, GPS coordinates, accuracy, capture time, and the engineer''s identity. You may use the burn-in banner as supporting evidence but it is not required for the assessment.

The user message begins with structured project and milestone context (project type, components, location, contract details, phase position in the sequence, preceding and following phases) and is followed by the photographs, each preceded by a text line labeling it "Photo N of M" along with capture time, GPS, and accuracy. Use the structured context to judge what activities and deliverables are expected for the specific milestone, and refer to photos by their "Photo N of M" label in your reasoning.

## Verdict Criteria

Return one verdict per photo and one overall verdict for the batch. All four verdicts are drawn from the same set. Choose based on the criteria below — not on a general sense of caution.

- "aligned" — the photo depicts the milestone activity in progress or completed. To award this verdict, list at least two specific visible elements in \`visible_elements\` that correspond to the milestone description (for example: "rebar cage installed", "formworks in place", "concrete pour underway", "completed pavement surface"). Assertion without cited visual evidence is not enough.

- "partially_aligned" — construction activity consistent with the project is visible, but the specific milestone activity cannot be confirmed from the photo, OR only ancillary elements are visible (materials staged, equipment on site, workers present, site prepared) without the milestone deliverable itself. Do not use this as a default for uncertainty; use it when the visible evidence is genuinely partial.

- "not_aligned" — the photo depicts a different activity, a different phase of the same project, or non-construction content. When choosing this verdict, state what you see instead in \`reasoning\`.

- "insufficient_evidence" — the image quality prevents assessment: blur, darkness, obscuring angle, framing that hides the subject, or a shot too close or too far to identify the activity. This verdict is about image quality only. Do not choose it because you feel uncertain — if the image is clear and you can see the site, choose one of the other three verdicts based on what is visible.

After per-photo verdicts, provide an overall verdict for the milestone using the same scale, weighted by your per-photo judgments.

Also provide a \`confidence\` value between 0 and 1 for each per-photo verdict, where 0 means "I could barely tell" and 1 means "I have no doubt." This confidence is a calibration signal and does not change the verdict itself.

## What You Must Not Do

- Do not invent details that are not visible in the image.
- Do not assume context that is not shown, beyond what the structured project and milestone context provides.
- Do not approve or reject. You assess and summarize; no human decision step follows your output.

## Output Format

You must respond exclusively through the assess_milestone_photos tool. Do not produce plain text. Do not explain your reasoning outside the tool fields.`;

const verificationTool = {
  name: "assess_milestone_photos",
  description:
    "Provides a structured visual assessment of construction milestone photographs. Returns per-photo and overall alignment verdicts with reasoning.",
  input_schema: {
    type: "object",
    properties: {
      overall_verdict: {
        type: "string",
        enum: ["aligned", "partially_aligned", "not_aligned", "insufficient_evidence"],
      },
      overall_reasoning: {
        type: "string",
        description: "One to three sentences summarizing the milestone-level assessment based on all photos collectively.",
      },
      per_photo_assessments: {
        type: "array",
        minItems: 1,
        maxItems: 5,
        items: {
          type: "object",
          properties: {
            photo_index: { type: "integer", minimum: 0, maximum: 4 },
            verdict: {
              type: "string",
              enum: ["aligned", "partially_aligned", "not_aligned", "insufficient_evidence"],
            },
            reasoning: {
              type: "string",
              description: "One to two sentences explaining the verdict for this specific photo.",
            },
            visible_elements: {
              type: "array",
              items: { type: "string" },
              description: "List of clearly visible construction-related elements in the photo (for example: rebar, formworks, fresh concrete, completed pavement, excavator, workers).",
            },
            confidence: {
              type: "number",
              minimum: 0,
              maximum: 1,
              description: "Your confidence in this per-photo verdict from 0 (I could barely tell) to 1 (I have no doubt). Calibration signal only; does not change the verdict itself.",
            },
          },
          required: ["photo_index", "verdict", "reasoning", "visible_elements", "confidence"],
        },
      },
    },
    required: ["overall_verdict", "overall_reasoning", "per_photo_assessments"],
  },
};

// Fires whenever a milestone document is updated. When the proofs[] array
// grows, the newly appended proof(s) are sent to Anthropic Claude Sonnet 4.6
// for visual alignment assessment, the structured result is appended to
// verificationHistory[], and a single category:"field" summary notification
// is fanned out to the project's HCSD creator. Scoped to ASIA-SOUTHEAST1 so
// it co-locates with the project Firestore writes.

const VERDICT_LABEL_MAP = {
  aligned: "Aligned",
  partially_aligned: "Partially aligned",
  not_aligned: "Not aligned",
  insufficient_evidence: "Insufficient evidence",
};

const verdictSeverity = (verdict) => {
  switch (verdict) {
    case "aligned":          return "success";
    case "partially_aligned": return "warn";
    case "not_aligned":       return "error";
    case "insufficient_evidence":
    default:                  return "info";
  }
};

const proofKey = (p) => p?.id || p?.fileName || p?.name || p?.storagePath || p?.url || null;

// Formats a proof entry into human-readable "when / GPS / accuracy" fields
// for the per-photo text labels sent to the vision model. Tolerates both the
// canonical proof shape (`capturedAt` Timestamp/Date/ISO, nested `gps.lat`/
// `gps.lng`, numeric `accuracy`) and the legacy shape (`timestamp`, flat
// `latitude`/`longitude`) documented in CLAUDE.md's proof-entry contract and
// mirrored by client-side `normalizeProof` in
// client/src/pages/hcsd/ProjectDetail.jsx. Missing fields render as "unknown"
// rather than throwing. Timestamps are formatted in Asia/Manila so the label
// matches what the field engineer sees on-device.
const CAPTURE_TIME_FORMATTER = new Intl.DateTimeFormat("en-PH", {
  timeZone: "Asia/Manila",
  day: "2-digit", month: "short", year: "numeric",
  hour: "numeric", minute: "2-digit", hour12: true,
});
const formatCaptureLabel = (proof) => {
  const rawWhen = proof?.capturedAt ?? proof?.timestamp;
  let whenDate = null;
  if (rawWhen?.toDate) whenDate = rawWhen.toDate();
  else if (rawWhen instanceof Date) whenDate = rawWhen;
  else if (typeof rawWhen === "number") whenDate = new Date(rawWhen);
  else if (typeof rawWhen === "string") { const d = new Date(rawWhen); whenDate = isNaN(d.getTime()) ? null : d; }
  const whenStr = whenDate ? `${CAPTURE_TIME_FORMATTER.format(whenDate)} (PHT)` : "unknown";

  const lat = proof?.gps?.lat ?? proof?.latitude;
  const lng = proof?.gps?.lng ?? proof?.longitude;
  const gpsStr = (typeof lat === "number" && typeof lng === "number")
    ? `${lat.toFixed(6)}, ${lng.toFixed(6)}`
    : "unknown";

  const acc = proof?.accuracy;
  const accStr = (typeof acc === "number") ? `${Math.round(acc)}m` : "unknown";

  return { when: whenStr, gps: gpsStr, accuracy: accStr };
};

exports.onProofUploaded = onDocumentUpdated(
  {
    document: "projects/{projectId}/milestones/{milestoneId}",
    region: "asia-southeast1",
    secrets: [anthropicApiKey],
    timeoutSeconds: 120,
  },
  async (event) => {
    const before = event.data?.before?.data();
    const after = event.data?.after?.data();
    if (!before || !after) return;

    const beforeProofs = Array.isArray(before.proofs) ? before.proofs : [];
    const afterProofs = Array.isArray(after.proofs) ? after.proofs : [];
    if (afterProofs.length <= beforeProofs.length) return;

    // Identify the newly appended proof(s) by id/filename. Fall back to a
    // length-based tail slice if no identifying key is present.
    const beforeKeys = new Set(beforeProofs.map(proofKey).filter(Boolean));
    let newProofs = afterProofs.filter((p) => {
      const key = proofKey(p);
      return key && !beforeKeys.has(key);
    });
    if (newProofs.length === 0) {
      newProofs = afterProofs.slice(beforeProofs.length);
    }
    if (newProofs.length === 0) return;

    // The assess_milestone_photos tool schema caps photos at 5 per call.
    const proofs = newProofs.slice(0, 5);

    const projectId = event.params.projectId;
    const milestoneId = event.params.milestoneId;

    const projectSnap = await admin.firestore().doc(`projects/${projectId}`).get();
    if (!projectSnap.exists) {
      logger.error(`[onProofUploaded] Project ${projectId} not found.`);
      return;
    }
    const project = projectSnap.data();
    const tenantId = project.tenantId || null;
    if (!tenantId) {
      logger.warn(`[onProofUploaded] Project ${projectId} has no tenantId; skipping.`);
      return;
    }

    // Defense-in-depth: server-side fetch bypasses Firestore/Storage rules,
    // so verify each proof URL belongs to this project/milestone path.
    // `sentProofs` is pushed in lockstep with `imageBlocks` so that
    // photo_index === i (from the model) refers to the same proof as
    // sentProofs[i] / imageBlocks[i] regardless of any mid-batch skips.
    const expectedSubpath = `projects/${projectId}/milestones/${milestoneId}/`;
    const imageBlocks = [];
    const sentProofs = [];
    for (let i = 0; i < proofs.length; i++) {
      const proof = proofs[i];
      if (!proof?.url) continue;

      let decodedPath = "";
      try { decodedPath = decodeURIComponent(new URL(proof.url).pathname); } catch {}
      if (!decodedPath.includes(expectedSubpath)) {
        logger.warn(`[onProofUploaded] Proof ${i} URL outside expected path for ${milestoneId}; skipping.`);
        continue;
      }

      try {
        const fetchResponse = await fetch(proof.url);
        if (!fetchResponse.ok) {
          logger.warn(`[onProofUploaded] Proof ${i} fetch returned HTTP ${fetchResponse.status}; skipping.`);
          continue;
        }
        const arrayBuffer = await fetchResponse.arrayBuffer();
        const imageBase64 = Buffer.from(arrayBuffer).toString("base64");
        imageBlocks.push({
          type: "image",
          source: { type: "base64", media_type: "image/jpeg", data: imageBase64 },
        });
        sentProofs.push(proof);
      } catch (err) {
        logger.error(`[onProofUploaded] Failed to fetch proof ${i}:`, err);
      }
    }

    if (imageBlocks.length === 0) {
      logger.error(`[onProofUploaded] No proof images resolvable for milestone ${milestoneId}.`);
      return;
    }

    // Context enrichment. `project` was already loaded above; we reuse it
    // rather than re-fetching. The sibling-milestone read is a separate
    // Firestore round trip; both extractions fail soft — partial context
    // beats none.
    const projClassification = project.classification || {};
    const projContext = {
      projectName: project.projectName ?? null,
      projectType: projClassification.projectType ?? project.projectType ?? null,
      components: Array.isArray(projClassification.components) ? projClassification.components : [],
      isComposite: projClassification.isComposite === true,
      barangay: project.barangay ?? null,
      sitioStreet: project.sitioStreet ?? null,
      contractAmount: project.contractAmount ?? null,
      officialDateStarted: project.officialDateStarted ?? null,
      originalDateCompletion: project.originalDateCompletion ?? null,
    };

    let siblingReadOk = false;
    const milestonesContext = { total: null, prevTitle: null, nextTitle: null };
    try {
      const msSnap = await admin.firestore()
        .collection(`projects/${projectId}/milestones`)
        .get();
      const all = msSnap.docs
        .map((d) => d.data())
        .filter((m) => m.confirmed !== false)
        .sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0));
      milestonesContext.total = all.length;
      const currentSeq = after.sequence;
      if (typeof currentSeq === "number") {
        const idx = all.findIndex((m) => m.sequence === currentSeq);
        if (idx > 0) milestonesContext.prevTitle = all[idx - 1].title ?? null;
        if (idx >= 0 && idx < all.length - 1) milestonesContext.nextTitle = all[idx + 1].title ?? null;
      }
      siblingReadOk = true;
    } catch (err) {
      logger.warn(`[onProofUploaded] Milestone sibling read failed for ${milestoneId}: ${err?.message ?? err}`);
    }

    // Per-photo text labels, one per sent image, built after the fetch loop
    // so "Photo N of M" reflects the final sent count (i.e. after skips).
    const photoLabels = sentProofs.map((proof, i) => {
      const caption = formatCaptureLabel(proof);
      return `Photo ${i + 1} of ${sentProofs.length}. Captured ${caption.when}. GPS ${caption.gps}. Accuracy ${caption.accuracy}.`;
    });

    const componentsLine = projContext.components.length > 0
      ? projContext.components.join(", ")
      : "(none recorded)";
    const locationLine = projContext.sitioStreet
      ? `${projContext.barangay ?? "Unknown"}, ${projContext.sitioStreet}`
      : (projContext.barangay ?? "Unknown");
    const contractLine = projContext.contractAmount != null
      ? `PHP ${Number(projContext.contractAmount).toLocaleString("en-PH")}`
      : "Unknown";
    const projectWindow = `${projContext.officialDateStarted ?? "Unknown"} to ${projContext.originalDateCompletion ?? "Unknown"}`;

    const milestoneContext = `## Project Context

Project name: ${projContext.projectName ?? "Unknown"}
Project type: ${projContext.projectType ?? "Unknown"}
Project components: ${componentsLine}
Composite project: ${projContext.isComposite ? "yes" : "no"}
Location: ${locationLine}
Contract amount: ${contractLine}
Project window: ${projectWindow}

## Milestone Context

Title: ${after.title ?? "Unknown"}
Description: ${after.description ?? "No description"}
Phase: ${after.sequence ?? "N/A"} of ${milestonesContext.total ?? "N/A"}
Weight percentage: ${after.weightPercentage ?? "N/A"}
Suggested duration: ${after.suggestedDurationDays ?? "N/A"} days
Preceding phase: ${milestonesContext.prevTitle ?? "(none — this is the first phase)"}
Following phase: ${milestonesContext.nextTitle ?? "(none — this is the final phase)"}

## Photos in this batch

The Project Engineer has just uploaded ${sentProofs.length} new geotagged proof-of-work photograph${sentProofs.length !== 1 ? "s" : ""} for this milestone. Each photo below is preceded by a text line labeling it "Photo N of M" along with capture time, GPS, and accuracy. Refer to photos by that label in your reasoning.

Assess each photo against the milestone description, then provide an overall verdict for this batch.`;

    const contextComplete = siblingReadOk
      && milestonesContext.total !== null
      && projContext.projectType !== null;

    // One structured INFO log per run carrying the fully constructed text
    // prompt. Excludes image blocks (base64), any proof URL (Storage tokens),
    // and the API key. Enables post-hoc auditability of what the model saw.
    logger.info("[onProofUploaded] prompt", {
      projectId,
      milestoneId,
      milestoneTitle: after.title ?? null,
      promptVersion: "v2-2026-08",
      imageBlockCount: imageBlocks.length,
      contextComplete,
      systemPromptChars: VERIFICATION_SYSTEM_PROMPT.length,
      userPromptText: milestoneContext,
      photoLabels,
    });

    const client = new Anthropic({ apiKey: anthropicApiKey.value() });

    // Interleave text labels with image blocks so each photo carries its
    // "Photo N of M" label immediately preceding it in the model's content
    // array.
    const contentBlocks = [{ type: "text", text: milestoneContext }];
    for (let i = 0; i < imageBlocks.length; i++) {
      contentBlocks.push({ type: "text", text: photoLabels[i] });
      contentBlocks.push(imageBlocks[i]);
    }

    let response;
    try {
      response = await client.messages.create({
        model: "claude-sonnet-4-6",
        max_tokens: 2048,
        temperature: 0,
        system: VERIFICATION_SYSTEM_PROMPT,
        tools: [verificationTool],
        tool_choice: { type: "tool", name: "assess_milestone_photos" },
        messages: [
          {
            role: "user",
            content: contentBlocks,
          },
        ],
      });
    } catch (error) {
      logger.error("[onProofUploaded] Anthropic vision API error:", { status: error?.status, code: error?.code, message: error?.message });
      return;
    }

    const toolUseBlock = response.content.find((block) => block.type === "tool_use");
    if (!toolUseBlock) {
      logger.error("[onProofUploaded] No structured assessment returned.");
      return;
    }

    const assessment = toolUseBlock.input;

    // Join per-photo verdicts to sent-order proof keys server side. The model
    // handles only integer indices to avoid hallucinated identifiers.
    const sentProofKeys = sentProofs.map(proofKey);
    if (Array.isArray(assessment.per_photo_assessments)) {
      assessment.per_photo_assessments.forEach((pa) => {
        if (Number.isInteger(pa.photo_index) && pa.photo_index >= 0 && pa.photo_index < sentProofKeys.length) {
          pa.proofId = sentProofKeys[pa.photo_index];
        } else {
          pa.proofId = null;
          logger.warn(`[onProofUploaded] Out-of-range photo_index=${pa.photo_index} in assessment for ${milestoneId}; proofId left null.`);
        }
      });
    }

    const verificationRecord = {
      runAt: admin.firestore.Timestamp.now(),
      runByUid: "system",
      runByEmail: null,
      model: "claude-sonnet-4-6",
      photosVerified: sentProofs.length,
      overallVerdict: assessment.overall_verdict,
      overallReasoning: assessment.overall_reasoning,
      perPhotoAssessments: assessment.per_photo_assessments,
      triggeredBy: "auto-on-proof-upload",
      // v2-2026-08 onward: `proofKeys[i]` names the i-th photo actually sent
      // to the model, in send order — so photo_index === i in
      // perPhotoAssessments corresponds to proofKeys[i]. Pre-v2 records
      // derived this from `proofs.slice(0, imageBlocks.length)` and are
      // misaligned wherever a mid-batch fetch or validation skip occurred;
      // do not trust them for per-photo joins without a
      // promptVersion === "v2-2026-08" check.
      proofKeys: sentProofKeys,
      promptVersion: "v2-2026-08",
      contextComplete,
      temperature: 0,
    };

    await admin.firestore().doc(`projects/${projectId}/milestones/${milestoneId}`).update({
      verificationHistory: admin.firestore.FieldValue.arrayUnion(verificationRecord),
      lastVerificationAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    // Notification fan-out lives strictly between HCSD and the assigned PE.
    // No MIS audit row — MIS provisions HCSD but does not see proof-of-work
    // verification activity.
    const verdictLabel = VERDICT_LABEL_MAP[assessment.overall_verdict] || assessment.overall_verdict;
    const milestoneLabel = after.sequence != null
      ? `Phase ${after.sequence} — ${after.title || "Milestone"}`
      : (after.title || "Milestone");
    const projectName = project.projectName || "Project";
    const countLabel = `${imageBlocks.length} photo${imageBlocks.length !== 1 ? "s" : ""}`;
    const severity = verdictSeverity(assessment.overall_verdict);
    const sharedMetadata = {
      projectId,
      milestoneId,
      milestoneTitle: after.title || null,
      milestoneSequence: after.sequence ?? null,
      overallVerdict: assessment.overall_verdict,
      photosVerified: imageBlocks.length,
      triggeredBy: "auto-on-proof-upload",
    };

    // 1. HCSD recipient — read-only summary in their field-activity lane.
    await createNotification({
      recipientUid: project.createdBy || null,
      action: "Proof Assessment",
      category: "field",
      severity,
      title: `Proof assessment: ${verdictLabel}`,
      body: `${projectName}: ${milestoneLabel} — ${countLabel} scanned. ${assessment.overall_reasoning}`,
      targetType: "milestone",
      targetId: milestoneId,
      metadata: sharedMetadata,
      tenantId,
    });

    // 2. Assigned Project Engineer — preliminary, plain-language framing.
    // Helper no-ops when recipientUid is null (no engineer assigned).
    const peCopy = {
      aligned: {
        title: "Proof reviewed",
        body: `Your proof for ${milestoneLabel} has been reviewed automatically and appears aligned with the milestone.`,
      },
      partially_aligned: {
        title: "Proof reviewed — partial alignment",
        body: `Your proof for ${milestoneLabel} has been reviewed automatically. The check found partial alignment with the milestone description.`,
      },
      not_aligned: {
        title: "Proof reviewed — possible mismatch",
        body: `Your proof for ${milestoneLabel} has been reviewed automatically. The check flagged a possible mismatch with the milestone — consider uploading a clearer or more representative photo.`,
      },
      insufficient_evidence: {
        title: "Proof reviewed — needs clearer image",
        body: `Your proof for ${milestoneLabel} has been reviewed automatically. The check could not confirm alignment from the image quality — consider re-uploading a clearer photo.`,
      },
    }[assessment.overall_verdict] || {
      title: "Proof reviewed",
      body: `Your proof for ${milestoneLabel} has been reviewed automatically.`,
    };

    await createNotification({
      recipientUid: project.projectEngineer || null,
      action: "Proof Assessment",
      category: "system",
      severity,
      title: peCopy.title,
      body: peCopy.body,
      targetType: "milestone",
      targetId: milestoneId,
      metadata: sharedMetadata,
      tenantId,
    });

    logger.info(`[onProofUploaded] Milestone ${milestoneId}: ${assessment.overall_verdict} (${imageBlocks.length} photos)`);
  }
);
