// Backfill projectType + classificationConfidence on existing project
// documents. Necessary because projects created BEFORE the
// validateProjectClassification flow deployed have neither field, so
// generateMilestones now blocks the PE with "classification incomplete".
//
// What this script does:
//   1. Reads every projects/* doc in Firestore.
//   2. Skips any doc that already has projectType !== "unknown" AND
//      classificationConfidence >= 0.6.
//   3. For each remaining doc, calls Anthropic Haiku 4.5 with the same
//      classifier prompt + tool used at project creation time. Writes
//      projectType and classificationConfidence back to the doc.
//   4. If the classifier says "unknown" or rejects the name, still records
//      whatever the model returned (often projectType=unknown, confidence>0)
//      so HCSD can manually correct later.
//
// Run safely: defaults to DRY RUN. The script auto-loads ANTHROPIC_API_KEY from
// Firebase Secret Manager (same secret the Cloud Functions runtime uses), so
// you do not need to paste or export it. Override by setting $env:ANTHROPIC_API_KEY
// in the shell if you want to point at a different key.
//
//   PowerShell:
//     node scripts/backfill-project-classification.js              # dry run
//     node scripts/backfill-project-classification.js --apply      # commit
//
// Anthropic cost: roughly 1 short Haiku call per project (~500 input + 200
// output tokens). At Haiku 4.5 list price that's a fraction of a US cent per
// project. Free side: Firestore reads + at most one write per project.

const { execSync } = require('child_process');
const admin = require('firebase-admin');
const serviceAccount = require('../serviceAccountKey.json');
// Require @anthropic-ai/sdk from functions/node_modules so we don't need
// to add it to the root package.json.
const Anthropic = require('../functions/node_modules/@anthropic-ai/sdk').default;
const {
    PROJECT_TYPE_ENUM,
    TYPICAL_DURATION_DAYS,
    decideClassification,
} = require('../functions/src/lib/classification');

admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

const APPLY = process.argv.includes('--apply');
const LIMIT_FLAG = process.argv.find((a) => a.startsWith('--limit='));
const LIMIT = LIMIT_FLAG ? parseInt(LIMIT_FLAG.split('=')[1], 10) : Infinity;

function loadAnthropicKey() {
    if (process.env.ANTHROPIC_API_KEY) return process.env.ANTHROPIC_API_KEY;
    try {
        console.log('Loading ANTHROPIC_API_KEY from Firebase Secret Manager...');
        const out = execSync('firebase functions:secrets:access ANTHROPIC_API_KEY', {
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'pipe'],
        }).trim();
        if (!out) throw new Error('Secret value is empty.');
        return out;
    } catch (err) {
        console.error('✗ Could not load ANTHROPIC_API_KEY.');
        console.error('  Tried Firebase Secret Manager; falls back to $env:ANTHROPIC_API_KEY.');
        console.error('  Make sure you are logged in via `firebase login` and have access to this project,');
        console.error('  or set $env:ANTHROPIC_API_KEY in your shell.');
        console.error(`  Details: ${err.message}`);
        process.exit(1);
    }
}

const apiKey = loadAnthropicKey();
const client = new Anthropic({ apiKey });

// Same prompt + tool as functions/src/index.js. Kept inline so this script is
// self-contained and can be run without a build step.
const CLASSIFIER_SYSTEM_PROMPT = `You are a project intake gatekeeper for the Construction Services Division of the Cebu City Department of Engineering and Public Works (DEPW). Your role is to classify whether a proposed project name describes a barangay-level infrastructure project that the division would supervise after a Notice to Proceed, and to compare its contract duration against the typical duration band for that type.

You are judging category — the scope of physical work the project name implies. You are NOT judging funding source.

Project type enum:
- road_concreting
- drainage_construction
- multi_purpose_building
- covered_court
- day_care_center
- footbridge
- slope_protection
- waterworks
- electrification
- unknown

Typical duration bands (days):
road_concreting:        60-180
drainage_construction:  45-120
multi_purpose_building: 90-365
covered_court:          60-180
day_care_center:        75-240
footbridge:             45-120
slope_protection:       45-150
waterworks:             45-180
electrification:        30-120

If the name describes procurement of goods, services, software, planning, or any non-physical activity, set isInfrastructure=false and projectType="unknown" with high confidence.

Respond exclusively through the classify_infrastructure_project tool.`;

const classifyInfrastructureTool = {
    name: 'classify_infrastructure_project',
    description:
        'Classifies a proposed Cebu City DEPW project by infrastructure type and returns the typical duration band for that type.',
    input_schema: {
        type: 'object',
        properties: {
            isInfrastructure: { type: 'boolean' },
            projectType: { type: 'string', enum: PROJECT_TYPE_ENUM },
            confidence: { type: 'number', minimum: 0, maximum: 1 },
            typicalDurationDays: {
                type: ['object', 'null'],
                properties: { min: { type: 'number' }, max: { type: 'number' } },
                required: ['min', 'max'],
            },
            reason: { type: 'string', maxLength: 240 },
        },
        required: ['isInfrastructure', 'projectType', 'confidence', 'typicalDurationDays', 'reason'],
    },
};

function durationDaysOf(project) {
    const start = project.officialDateStarted;
    const end = project.originalDateCompletion;
    if (!start || !end) return null;
    const s = new Date(start).getTime();
    const e = new Date(end).getTime();
    if (Number.isNaN(s) || Number.isNaN(e)) return null;
    return Math.round((e - s) / 86_400_000);
}

async function classifyProject(project) {
    const durationDays = durationDaysOf(project);
    const userMessage = `Project name: ${project.projectName || '(unnamed)'}
Start date: ${project.officialDateStarted || 'N/A'}
End date: ${project.originalDateCompletion || 'N/A'}
Duration: ${durationDays != null ? durationDays + ' days' : 'unknown'}`;

    const response = await client.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 512,
        system: CLASSIFIER_SYSTEM_PROMPT,
        tools: [classifyInfrastructureTool],
        tool_choice: { type: 'tool', name: 'classify_infrastructure_project' },
        messages: [{ role: 'user', content: userMessage }],
    });
    const toolUse = response.content.find((b) => b.type === 'tool_use');
    if (!toolUse) throw new Error('No tool_use block in response');
    return decideClassification(toolUse.input, durationDays);
}

async function main() {
    console.log('=== Backfill projectType + classificationConfidence ===');
    console.log(APPLY ? 'Mode: APPLY (writes enabled)' : 'Mode: DRY RUN (no writes)');
    if (Number.isFinite(LIMIT)) console.log(`Limit: ${LIMIT} project(s)`);
    console.log('');

    const snap = await db.collection('projects').get();
    console.log(`Scanning ${snap.size} project(s)...\n`);

    let skipped = 0;
    let processed = 0;
    let failed = 0;
    const updates = [];
    const failures = [];

    for (const doc of snap.docs) {
        const data = doc.data();
        const currentType = data.projectType || 'unknown';
        const currentConf = typeof data.classificationConfidence === 'number'
            ? data.classificationConfidence : 0;

        if (currentType !== 'unknown' && currentConf >= 0.6) {
            skipped++;
            continue;
        }
        if (processed >= LIMIT) break;

        const name = data.projectName || '(unnamed)';
        process.stdout.write(`  [${doc.id}] "${name}" ... `);
        try {
            const result = await classifyProject(data);
            const newType = result.projectType || 'unknown';
            const newConf = typeof result.confidence === 'number' ? result.confidence : 0;
            console.log(`→ ${newType} (confidence ${newConf.toFixed(2)})`);
            updates.push({
                id: doc.id,
                projectName: name,
                oldType: currentType,
                oldConf: currentConf,
                newType,
                newConf,
                accepted: result.accepted,
                reason: result.reason,
            });
            processed++;
        } catch (err) {
            console.log(`✗ failed: ${err.message}`);
            failures.push({ id: doc.id, projectName: name, error: err.message });
            failed++;
            processed++;
        }
    }

    console.log('');
    console.log(`  Already classified:  ${skipped}`);
    console.log(`  Classified now:      ${updates.length}`);
    console.log(`  Classifier failures: ${failed}`);
    console.log('');

    if (updates.length) {
        const rejected = updates.filter((u) => !u.accepted);
        if (rejected.length) {
            console.log(`⚠ Classifier rejected ${rejected.length} project(s) as non-infrastructure:`);
            rejected.forEach((u) => {
                console.log(`    [${u.id}] "${u.projectName}" → ${u.newType} | ${u.reason}`);
            });
            console.log('  These will still be written with projectType="unknown" so the gate keeps them blocked.');
            console.log('  Edit them by hand in the Firestore console afterwards if any are mis-classified.');
            console.log('');
        }
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
        chunk.forEach((u) => {
            batch.update(db.collection('projects').doc(u.id), {
                projectType: u.newType,
                classificationConfidence: u.newConf,
            });
        });
        await batch.commit();
        written += chunk.length;
    }

    console.log(`✓ Wrote ${written} project document(s).`);
    if (failed) {
        console.log(`⚠ ${failed} project(s) had classifier failures and were not written. See above.`);
    }
    process.exit(0);
}

main().catch((err) => {
    console.error('\n✗ Backfill failed:', err.message);
    process.exit(1);
});
