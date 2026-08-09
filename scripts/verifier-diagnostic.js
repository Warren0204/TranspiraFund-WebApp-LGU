// Phase 4 verifier-diagnostic tooling. This file currently ships the labels
// tooling only. The runner (which will replay v1, v2, v3.3, and v3.5 against
// the hand-labeled proof set and produce confusion matrices) is a separate
// pass; do not add it here without a clear directive.
//
// Subcommands:
//   node scripts/verifier-diagnostic.js labels-init
//   node scripts/verifier-diagnostic.js labels-status
//   node scripts/verifier-diagnostic.js labels-refresh-urls
//   node scripts/verifier-diagnostic.js labels-export [--blank]
//
// labels-init         Scan Firestore, sign Storage URLs (7d, v4), seeded-
//                     randomize row order, emit
//                     scripts/fixtures/verifier-labels.json AND
//                     scripts/fixtures/verifier-labels-contactsheet.html.
//                     Refuses to overwrite either output. Exit 2 if the
//                     labels file already exists. No override flag.
//
// labels-status       Print totals, per-class distribution, floor deficit
//                     vs. floor of 10, and run all three validation guards.
//                     Exit non-zero if any guard fails.
//
// labels-refresh-urls Rotate signedUrl + signedUrlExpiresAt in place. Every
//                     other field byte-identical. Pre-write existence check
//                     against Storage via bucket.file(storagePath).exists()
//                     (NOT Firestore). Failure label: "Storage object
//                     missing". Atomic write (temp + rename). Rewrites the
//                     contact sheet in the same row order.
//
// labels-export       Write docs/phase4/verifier-labels-<YYYYMMDD>.csv with
//                     every labeled row. --blank emits the same CSV with
//                     trueVerdict blank, for a second labeler. Read-only
//                     against the labels file.
//
// Validation guards (invoked by labels-status; the runner will invoke them
// too, once it lands):
//   G1 Duplicate proofId
//   G2 trueVerdict outside enum {aligned, partially_aligned, not_aligned,
//      insufficient_evidence}; blank OK; trim + case-insensitive
//   G3 Firestore row unresolved  (labeled rows only)
//
// Constraints:
//   - No writes to Firestore. No writes to Storage.
//   - No modification of functions/src/index.js.
//   - No git operations, no firebase deploy.
//   - Uses serviceAccountKey.json for firebase-admin init only. Contents
//     never printed.
//   - ANTHROPIC_API_KEY not used here (runner concern, not labels concern).
//
// firebase-admin resolution: the same shim used by
// scripts/read-verification-records.js, because there is no root
// node_modules and firebase-admin actually lives under functions/.

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const admin = require(path.resolve(__dirname, "..", "functions", "node_modules", "firebase-admin"));

const SERVICE_ACCOUNT_PATH = path.resolve(__dirname, "..", "serviceAccountKey.json");
const BUCKET_NAME = "transpirafund-webapp.firebasestorage.app";
const LABELS_PATH = path.resolve(__dirname, "fixtures", "verifier-labels.json");
const CONTACT_SHEET_PATH = path.resolve(__dirname, "fixtures", "verifier-labels-contactsheet.html");
const EXPORT_DIR = path.resolve(__dirname, "..", "docs", "phase4");
const SIGNED_URL_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const VERDICT_ENUM = ["aligned", "partially_aligned", "not_aligned", "insufficient_evidence"];
const FLOOR_PER_CLASS = 10;

function initAdmin() {
    if (admin.apps.length > 0) return;
    if (!fs.existsSync(SERVICE_ACCOUNT_PATH)) {
        console.error("Fatal: serviceAccountKey.json not found at " + SERVICE_ACCOUNT_PATH);
        process.exit(1);
    }
    const svc = require(SERVICE_ACCOUNT_PATH);
    admin.initializeApp({
        credential: admin.credential.cert(svc),
        storageBucket: BUCKET_NAME,
    });
}

// Mirrors functions/src/index.js:2699. Do not diverge; this key is the join
// column between Firestore proofs and label rows.
const proofKey = (p) => (p && (p.id || p.fileName || p.name || p.storagePath || p.url)) || null;

// Mirrors functions/src/index.js:2715. Same "when / GPS / accuracy" shape the
// model sees per photo. Kept here rather than imported because
// functions/src/index.js is not a pure module.
const CAPTURE_TIME_FORMATTER = new Intl.DateTimeFormat("en-PH", {
    timeZone: "Asia/Manila",
    day: "2-digit", month: "short", year: "numeric",
    hour: "numeric", minute: "2-digit", hour12: true,
});
function formatCaptureLabel(proof) {
    const rawWhen = (proof && (proof.capturedAt != null ? proof.capturedAt : proof.timestamp));
    let whenDate = null;
    if (rawWhen && typeof rawWhen.toDate === "function") whenDate = rawWhen.toDate();
    else if (rawWhen instanceof Date) whenDate = rawWhen;
    else if (typeof rawWhen === "number") whenDate = new Date(rawWhen);
    else if (typeof rawWhen === "string") { const d = new Date(rawWhen); whenDate = isNaN(d.getTime()) ? null : d; }
    const whenStr = whenDate ? (CAPTURE_TIME_FORMATTER.format(whenDate) + " (PHT)") : "unknown";
    const lat = (proof && proof.gps && proof.gps.lat != null) ? proof.gps.lat : (proof && proof.latitude);
    const lng = (proof && proof.gps && proof.gps.lng != null) ? proof.gps.lng : (proof && proof.longitude);
    const gpsStr = (typeof lat === "number" && typeof lng === "number")
        ? (lat.toFixed(6) + ", " + lng.toFixed(6))
        : "unknown";
    const acc = proof && proof.accuracy;
    const accStr = (typeof acc === "number") ? (Math.round(acc) + "m") : "unknown";
    return { when: whenStr, gps: gpsStr, accuracy: accStr };
}

// Deterministic PRNG (mulberry32). Seeded shuffle keeps init reproducible
// given the seed recorded in the labels file; refresh-urls never re-shuffles.
function mulberry32(seed) {
    let t = seed >>> 0;
    return function () {
        t = (t + 0x6d2b79f5) >>> 0;
        let r = t;
        r = Math.imul(r ^ (r >>> 15), r | 1);
        r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
        return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
    };
}
function seededShuffle(arr, seed) {
    const rand = mulberry32(seed);
    const out = arr.slice();
    for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1));
        const tmp = out[i]; out[i] = out[j]; out[j] = tmp;
    }
    return out;
}

function atomicWriteFile(targetPath, content) {
    const tmp = targetPath + ".tmp." + process.pid + "." + Date.now();
    fs.writeFileSync(tmp, content);
    fs.renameSync(tmp, targetPath);
}

function escapeHtml(s) {
    return String(s == null ? "" : s)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

function csvEscape(v) {
    const s = String(v == null ? "" : v);
    if (/[",\r\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
}

function renderContactSheet(payload) {
    const rowsHtml = payload.rows.map((r, i) => {
        const cap = r.captureLabel || {};
        return `<section id="row-${i + 1}">
  <h2>${i + 1}. ${escapeHtml(r.milestoneTitle)}</h2>
  <img src="${escapeHtml(r.signedUrl)}" alt="Proof ${escapeHtml(r.proofId)}" loading="lazy">
  <h3>Milestone description</h3>
  <p>${escapeHtml(r.milestoneDescription || "(no description)")}</p>
  <h3>Metadata</h3>
  <dl>
    <dt>proofId</dt><dd><code>${escapeHtml(r.proofId)}</code></dd>
    <dt>projectName</dt><dd>${escapeHtml(r.projectName)}</dd>
    <dt>projectType</dt><dd>${escapeHtml(r.projectType)}</dd>
    <dt>milestoneSequence</dt><dd>${escapeHtml(r.milestoneSequence)}</dd>
    <dt>captureLabel.when</dt><dd>${escapeHtml(cap.when)}</dd>
    <dt>captureLabel.gps</dt><dd>${escapeHtml(cap.gps)}</dd>
    <dt>captureLabel.accuracy</dt><dd>${escapeHtml(cap.accuracy)}</dd>
  </dl>
  <h3>Verdicts (copy one into trueVerdict)</h3>
  <pre class="verdicts">aligned
partially_aligned
not_aligned
insufficient_evidence</pre>
</section>`;
    }).join("\n");
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Verifier labels contact sheet</title>
  <style>
    body { font-family: system-ui, -apple-system, sans-serif; max-width: 1000px; margin: 20px auto; padding: 0 16px; line-height: 1.4; color: #222; }
    header { padding: 12px 0 20px; border-bottom: 2px solid #333; }
    section { border-top: 1px solid #ccc; padding: 24px 0; }
    section:first-of-type { border-top: none; }
    h2 { margin: 0 0 12px; font-size: 18px; }
    h3 { margin: 16px 0 8px; font-size: 14px; text-transform: uppercase; letter-spacing: 0.05em; color: #555; }
    img { max-width: 900px; width: 100%; height: auto; display: block; border: 1px solid #ddd; }
    dl { display: grid; grid-template-columns: max-content 1fr; gap: 4px 12px; margin: 0; font-size: 13px; }
    dt { font-weight: 600; color: #444; }
    dd { margin: 0; }
    code { background: #f4f4f4; padding: 1px 4px; border-radius: 2px; font-size: 12px; }
    .verdicts { background: #f4f4f4; padding: 10px 14px; font-family: ui-monospace, "SF Mono", Consolas, monospace; font-size: 13px; user-select: text; border: 1px solid #ddd; border-radius: 2px; margin: 0; white-space: pre; }
    p { margin: 4px 0; }
  </style>
</head>
<body>
  <header>
    <h1>Verifier labels contact sheet</h1>
    <p>Seed: <code>${escapeHtml(payload.seed)}</code>. Rows: ${payload.rows.length}. Bucket: <code>${escapeHtml(payload.bucketName)}</code>.</p>
    <p>Regenerated at: ${escapeHtml(payload.generatedAt)}. Signed URLs expire at: ${escapeHtml(payload.signedUrlExpiresAt)}.</p>
  </header>
${rowsHtml}
</body>
</html>
`;
}

async function scanFirestoreRows(db) {
    const rows = [];
    const projSnap = await db.collection("projects").get();
    for (const projDoc of projSnap.docs) {
        const project = projDoc.data() || {};
        const projectId = projDoc.id;
        const projectName = project.projectName || "(unnamed)";
        const projectType = (project.classification && project.classification.projectType) || null;
        const msSnap = await projDoc.ref.collection("milestones").get();
        for (const msDoc of msSnap.docs) {
            const ms = msDoc.data() || {};
            const milestoneId = msDoc.id;
            const proofs = Array.isArray(ms.proofs) ? ms.proofs : [];
            for (const proof of proofs) {
                const pid = proofKey(proof);
                if (!pid) continue;
                const storagePath = proof.storagePath || null;
                if (!storagePath) continue;
                rows.push({
                    proofId: pid,
                    projectId,
                    milestoneId,
                    projectName,
                    projectType,
                    milestoneTitle: ms.title || "(untitled)",
                    milestoneDescription: ms.description || "",
                    milestoneSequence: ms.sequence == null ? null : ms.sequence,
                    captureLabel: formatCaptureLabel(proof),
                    storagePath,
                });
            }
        }
    }
    return rows;
}

async function signOne(bucket, storagePath, expiresAtMs) {
    const [url] = await bucket.file(storagePath).getSignedUrl({
        version: "v4",
        action: "read",
        expires: expiresAtMs,
    });
    return url;
}

// ---------------------------------------------------------------------------
// labels-init
// ---------------------------------------------------------------------------
async function cmdLabelsInit() {
    if (fs.existsSync(LABELS_PATH)) {
        console.error("Refusing to overwrite existing labels file: " + LABELS_PATH);
        console.error("There is no override flag. Move or rename the file first if you truly want to re-init.");
        process.exit(2);
    }
    initAdmin();
    const db = admin.firestore();
    const bucket = admin.storage().bucket(BUCKET_NAME);

    console.log("Scanning Firestore for proofs...");
    const rawRows = await scanFirestoreRows(db);
    console.log("Found " + rawRows.length + " proofs with a storagePath.");
    if (rawRows.length === 0) {
        console.error("No rows to write. Nothing to do.");
        process.exit(1);
    }

    const seed = crypto.randomInt(0, 2 ** 31 - 1);
    console.log("Seed for row order: " + seed);
    const shuffled = seededShuffle(rawRows, seed);

    const expiresAtMs = Date.now() + SIGNED_URL_TTL_MS;
    const expiresAtIso = new Date(expiresAtMs).toISOString();

    console.log("Probing getSignedUrl on the first 3 rows...");
    const probeCount = Math.min(3, shuffled.length);
    const probedUrls = new Map();
    for (let i = 0; i < probeCount; i++) {
        const row = shuffled[i];
        try {
            const url = await signOne(bucket, row.storagePath, expiresAtMs);
            probedUrls.set(i, url);
        } catch (err) {
            console.error("Probe failed on row " + i + " (proofId=" + row.proofId + ", storagePath=" + row.storagePath + "):");
            console.error("  " + (err && err.message ? err.message : String(err)));
            console.error("Aborting without writing.");
            process.exit(1);
        }
    }
    console.log("Probe OK. Signing remaining " + Math.max(0, shuffled.length - probeCount) + " rows...");

    const signedRows = [];
    for (let i = 0; i < shuffled.length; i++) {
        const row = shuffled[i];
        let url;
        if (probedUrls.has(i)) {
            url = probedUrls.get(i);
        } else {
            try {
                url = await signOne(bucket, row.storagePath, expiresAtMs);
            } catch (err) {
                console.error("Signing failed on row " + i + " (proofId=" + row.proofId + ", storagePath=" + row.storagePath + "):");
                console.error("  " + (err && err.message ? err.message : String(err)));
                console.error("Aborting without writing.");
                process.exit(1);
            }
        }
        signedRows.push(Object.assign({}, row, {
            signedUrl: url,
            signedUrlExpiresAt: expiresAtIso,
            trueVerdict: "",
        }));
    }

    const payload = {
        seed,
        generatedAt: new Date().toISOString(),
        signedUrlExpiryDays: 7,
        signedUrlExpiresAt: expiresAtIso,
        bucketName: BUCKET_NAME,
        rowCount: signedRows.length,
        rows: signedRows,
    };

    if (fs.existsSync(CONTACT_SHEET_PATH)) {
        console.error("Refusing to overwrite existing contact sheet: " + CONTACT_SHEET_PATH);
        console.error("Remove it manually if you truly want to re-init.");
        process.exit(2);
    }

    atomicWriteFile(LABELS_PATH, JSON.stringify(payload, null, 2) + "\n");
    atomicWriteFile(CONTACT_SHEET_PATH, renderContactSheet(payload));
    console.log("Wrote " + LABELS_PATH);
    console.log("Wrote " + CONTACT_SHEET_PATH);
    console.log("Seed recorded in both outputs: " + seed);
}

// ---------------------------------------------------------------------------
// labels-status
// ---------------------------------------------------------------------------
function loadLabels() {
    if (!fs.existsSync(LABELS_PATH)) {
        console.error("Labels file not found: " + LABELS_PATH);
        console.error("Run 'node scripts/verifier-diagnostic.js labels-init' first.");
        process.exit(1);
    }
    const raw = fs.readFileSync(LABELS_PATH, "utf8");
    return JSON.parse(raw);
}

function normalizeVerdict(v) {
    if (typeof v !== "string") return null;
    const t = v.trim().toLowerCase();
    return t === "" ? "" : t;
}

// G1: Duplicate proofId. Reports every group of size > 1 with row indices.
function guardDuplicateProofIds(rows) {
    const seen = new Map();
    rows.forEach((r, idx) => {
        const list = seen.get(r.proofId) || [];
        list.push(idx);
        seen.set(r.proofId, list);
    });
    const dupes = [];
    for (const [pid, indices] of seen.entries()) {
        if (indices.length > 1) dupes.push({ proofId: pid, indices });
    }
    return dupes;
}

// G2: trueVerdict outside enum. Blank allowed. Trim + case-insensitive.
function guardVerdictEnum(rows) {
    const problems = [];
    rows.forEach((r, idx) => {
        const norm = normalizeVerdict(r.trueVerdict);
        if (norm === null) {
            problems.push({ idx, proofId: r.proofId, literal: r.trueVerdict });
            return;
        }
        if (norm === "") return;
        if (!VERDICT_ENUM.includes(norm)) {
            problems.push({ idx, proofId: r.proofId, literal: r.trueVerdict });
        }
    });
    return problems;
}

// G3: Firestore row unresolved (labeled rows only). Verify the milestone doc
// exists AND its proofs[] contains a proof whose proofKey equals the row's
// proofId.
async function guardFirestoreResolution(db, rows) {
    const problems = [];
    for (let idx = 0; idx < rows.length; idx++) {
        const r = rows[idx];
        const norm = normalizeVerdict(r.trueVerdict);
        if (norm === "" || norm === null) continue;
        try {
            const msRef = db.collection("projects").doc(r.projectId).collection("milestones").doc(r.milestoneId);
            const msSnap = await msRef.get();
            if (!msSnap.exists) {
                problems.push({ idx, proofId: r.proofId, step: "milestone document not found" });
                continue;
            }
            const ms = msSnap.data() || {};
            const proofs = Array.isArray(ms.proofs) ? ms.proofs : [];
            const keys = new Set(proofs.map(proofKey).filter(Boolean));
            if (!keys.has(r.proofId)) {
                problems.push({ idx, proofId: r.proofId, step: "proofId not in milestone.proofs[]" });
            }
        } catch (err) {
            problems.push({ idx, proofId: r.proofId, step: "read error: " + (err && err.message ? err.message : String(err)) });
        }
    }
    return problems;
}

async function cmdLabelsStatus() {
    const payload = loadLabels();
    const rows = Array.isArray(payload.rows) ? payload.rows : [];
    const total = rows.length;

    const dist = { aligned: 0, partially_aligned: 0, not_aligned: 0, insufficient_evidence: 0 };
    let labeled = 0;
    let blank = 0;
    for (const r of rows) {
        const norm = normalizeVerdict(r.trueVerdict);
        if (norm === "" || norm === null) { blank++; continue; }
        if (VERDICT_ENUM.includes(norm)) { dist[norm]++; labeled++; }
        else { labeled++; }
    }

    console.log("Labels file:   " + LABELS_PATH);
    console.log("Seed:          " + payload.seed);
    console.log("Generated at:  " + payload.generatedAt);
    console.log("");
    console.log("Total rows:    " + total);
    console.log("Labeled:       " + labeled);
    console.log("Blank:         " + blank);
    console.log("");
    console.log("Per-verdict distribution (labeled rows):");
    for (const v of VERDICT_ENUM) {
        console.log("  " + v.padEnd(24) + String(dist[v]).padStart(4));
    }
    console.log("");
    console.log("Floor deficit vs floor=" + FLOOR_PER_CLASS + ":");
    for (const v of VERDICT_ENUM) {
        const deficit = Math.max(0, FLOOR_PER_CLASS - dist[v]);
        console.log("  " + v.padEnd(24) + String(deficit).padStart(4));
    }
    console.log("");

    let anyFail = false;

    console.log("Guard 1: Duplicate proofId");
    const g1 = guardDuplicateProofIds(rows);
    if (g1.length === 0) {
        console.log("  OK   (no duplicate proofIds)");
    } else {
        anyFail = true;
        for (const g of g1) {
            console.log("  FAIL Duplicate proofId " + JSON.stringify(g.proofId) + " at rows " + JSON.stringify(g.indices));
        }
    }
    console.log("");

    console.log("Guard 2: trueVerdict enum");
    const g2 = guardVerdictEnum(rows);
    if (g2.length === 0) {
        console.log("  OK   (no invalid verdicts)");
    } else {
        anyFail = true;
        for (const p of g2) {
            console.log("  FAIL Row " + p.idx + " (proofId=" + JSON.stringify(p.proofId) + "): invalid literal " + JSON.stringify(p.literal));
        }
    }
    console.log("");

    console.log("Guard 3: Firestore row unresolved");
    if (labeled === 0) {
        console.log("  SKIP (no labeled rows yet; guard runs against labeled rows only)");
    } else {
        initAdmin();
        const db = admin.firestore();
        const g3 = await guardFirestoreResolution(db, rows);
        if (g3.length === 0) {
            console.log("  OK   (all " + labeled + " labeled row(s) resolve to a Firestore proofs[] entry)");
        } else {
            anyFail = true;
            for (const p of g3) {
                console.log("  FAIL Firestore row unresolved: row " + p.idx + " (proofId=" + JSON.stringify(p.proofId) + "): " + p.step);
            }
        }
    }

    if (anyFail) process.exit(1);
}

// ---------------------------------------------------------------------------
// labels-refresh-urls
// ---------------------------------------------------------------------------
async function cmdLabelsRefreshUrls() {
    if (!fs.existsSync(LABELS_PATH)) {
        console.error("Labels file not found: " + LABELS_PATH);
        console.error("Run 'node scripts/verifier-diagnostic.js labels-init' first.");
        process.exit(1);
    }
    const raw = fs.readFileSync(LABELS_PATH, "utf8");
    const payload = JSON.parse(raw);
    const rows = Array.isArray(payload.rows) ? payload.rows : [];
    if (rows.length === 0) {
        console.error("Labels file has zero rows. Refusing to refresh a degenerate file.");
        process.exit(1);
    }

    initAdmin();
    const bucket = admin.storage().bucket(BUCKET_NAME);

    console.log("Pre-write existence check against Storage (bucket.file(storagePath).exists())...");
    const missing = [];
    for (let idx = 0; idx < rows.length; idx++) {
        const r = rows[idx];
        if (!r.storagePath) {
            missing.push({ idx, proofId: r.proofId, storagePath: r.storagePath, reason: "storagePath is empty" });
            continue;
        }
        try {
            const [exists] = await bucket.file(r.storagePath).exists();
            if (!exists) {
                missing.push({ idx, proofId: r.proofId, storagePath: r.storagePath, reason: "not present in bucket" });
            }
        } catch (err) {
            missing.push({ idx, proofId: r.proofId, storagePath: r.storagePath, reason: "exists() error: " + (err && err.message ? err.message : String(err)) });
        }
    }
    if (missing.length > 0) {
        console.error("Storage object missing:");
        for (const m of missing) {
            console.error("  row " + m.idx + " (proofId=" + JSON.stringify(m.proofId) + " storagePath=" + JSON.stringify(m.storagePath) + "): " + m.reason);
        }
        console.error("Aborting without writing. No fields on the labels file were touched.");
        process.exit(1);
    }
    console.log("All " + rows.length + " storage objects present. Signing new URLs...");

    const expiresAtMs = Date.now() + SIGNED_URL_TTL_MS;
    const expiresAtIso = new Date(expiresAtMs).toISOString();

    const refreshedRows = [];
    for (let idx = 0; idx < rows.length; idx++) {
        const r = rows[idx];
        let url;
        try {
            url = await signOne(bucket, r.storagePath, expiresAtMs);
        } catch (err) {
            console.error("Signing failed for row " + idx + " (proofId=" + JSON.stringify(r.proofId) + "): " + (err && err.message ? err.message : String(err)));
            console.error("Aborting without writing. No fields on the labels file were touched.");
            process.exit(1);
        }
        refreshedRows.push(Object.assign({}, r, {
            signedUrl: url,
            signedUrlExpiresAt: expiresAtIso,
        }));
    }

    const refreshedPayload = Object.assign({}, payload, {
        generatedAt: payload.generatedAt,
        signedUrlExpiresAt: expiresAtIso,
        rows: refreshedRows,
    });

    // Constraint: labels-refresh-urls is the ONE permitted write to the labels
    // file. It regenerates signedUrl / signedUrlExpiresAt only. It MUST NOT
    // alter trueVerdict, MUST NOT add rows, MUST NOT drop rows, MUST NOT
    // reorder rows. A future edit that "tidies" any of those away silently
    // destroys labeling work. If refresh needs to grow richer than URL rotation,
    // build a new subcommand and leave this one alone.
    atomicWriteFile(LABELS_PATH, JSON.stringify(refreshedPayload, null, 2) + "\n");
    atomicWriteFile(CONTACT_SHEET_PATH, renderContactSheet(refreshedPayload));
    console.log("Refreshed " + rows.length + " row(s). New expiry: " + expiresAtIso);
    console.log("Wrote " + LABELS_PATH);
    console.log("Wrote " + CONTACT_SHEET_PATH);
}

// ---------------------------------------------------------------------------
// labels-export
// ---------------------------------------------------------------------------
function cmdLabelsExport(blankFlag) {
    const payload = loadLabels();
    const rows = Array.isArray(payload.rows) ? payload.rows : [];
    const labeled = blankFlag
        ? rows
        : rows.filter((r) => {
            const norm = normalizeVerdict(r.trueVerdict);
            return norm !== "" && norm !== null && VERDICT_ENUM.includes(norm);
        });

    if (!fs.existsSync(EXPORT_DIR)) fs.mkdirSync(EXPORT_DIR, { recursive: true });
    const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    const suffix = blankFlag ? "-blank" : "";
    const outPath = path.join(EXPORT_DIR, "verifier-labels-" + stamp + suffix + ".csv");

    const header = ["proofId", "projectId", "milestoneId", "projectName", "projectType", "milestoneTitle", "milestoneSequence", "captureLabel", "trueVerdict"];
    const lines = [header.map(csvEscape).join(",")];
    for (const r of labeled) {
        const cap = r.captureLabel || {};
        const capStr = "Captured " + (cap.when || "unknown") + " | GPS " + (cap.gps || "unknown") + " | Accuracy " + (cap.accuracy || "unknown");
        const verdict = blankFlag ? "" : normalizeVerdict(r.trueVerdict);
        lines.push([
            r.proofId,
            r.projectId,
            r.milestoneId,
            r.projectName,
            r.projectType,
            r.milestoneTitle,
            r.milestoneSequence,
            capStr,
            verdict,
        ].map(csvEscape).join(","));
    }
    fs.writeFileSync(outPath, lines.join("\n") + "\n");
    console.log("Wrote " + outPath + " (" + labeled.length + " row(s)" + (blankFlag ? ", trueVerdict blank" : ", labeled only") + ")");
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------
function usage() {
    console.error("Usage:");
    console.error("  node scripts/verifier-diagnostic.js labels-init");
    console.error("  node scripts/verifier-diagnostic.js labels-status");
    console.error("  node scripts/verifier-diagnostic.js labels-refresh-urls");
    console.error("  node scripts/verifier-diagnostic.js labels-export [--blank]");
}

(async () => {
    const argv = process.argv.slice(2);
    const sub = argv[0];
    if (!sub) { usage(); process.exit(2); }
    switch (sub) {
        case "labels-init":
            await cmdLabelsInit();
            break;
        case "labels-status":
            await cmdLabelsStatus();
            break;
        case "labels-refresh-urls":
            await cmdLabelsRefreshUrls();
            break;
        case "labels-export":
            cmdLabelsExport(argv.includes("--blank"));
            break;
        default:
            console.error("Unknown subcommand: " + sub);
            usage();
            process.exit(2);
    }
})().catch((err) => {
    console.error("Fatal:", err && err.stack ? err.stack : err);
    process.exit(1);
});
