// One-shot demonstration of the per-proof verdict-history walk added to
// client/src/pages/hcsd/ProjectDetail.jsx. Mirrors the resolver + walker
// logic exactly (the JSX component embeds it in an IIFE, so we reimplement
// the pure parts here for demonstration). No network, no writes.
//
// Usage: node scripts/walk-perproof-scenarios.js

const proofKey = (p) => p?.id || p?.fileName || p?.name || p?.storagePath || p?.url || null;

const isTrustedRecordVersion = (pv) =>
    typeof pv === 'string' && (pv.startsWith('v2') || pv.startsWith('v3'));

const resolveProofForAssessment = (pa, record, proofs) => {
    if (!pa || !Array.isArray(proofs) || proofs.length === 0) return { proof: null, match: 'none' };
    const idx = pa.photo_index;
    if (pa.proofId != null) {
        const found = proofs.find((p) => proofKey(p) === pa.proofId);
        if (found) return { proof: found, match: 'exact' };
    }
    const keys = record?.proofKeys;
    if (Array.isArray(keys) && Number.isInteger(idx) && idx >= 0 && idx < keys.length) {
        const key = keys[idx];
        if (key != null) {
            const found = proofs.find((p) => proofKey(p) === key);
            if (found) {
                return { proof: found, match: isTrustedRecordVersion(record?.promptVersion) ? 'exact' : 'approximate-tier2' };
            }
        }
    }
    if (Number.isInteger(idx) && idx >= 0 && idx < proofs.length) {
        return { proof: proofs[idx], match: 'approximate-tier3' };
    }
    return { proof: null, match: 'none' };
};

const buildPerProofMap = (verificationHistory, cachedProofs) => {
    const historyEntries = Array.isArray(verificationHistory) && verificationHistory.length > 0
        ? [...verificationHistory].sort((a, b) => {
            const ta = a?.runAt?.toMillis?.() ?? Date.parse(a?.runAt) ?? 0;
            const tb = b?.runAt?.toMillis?.() ?? Date.parse(b?.runAt) ?? 0;
            return tb - ta;
        })
        : [];
    const perProofMap = new Map();
    for (const entry of historyEntries) {
        const paList = Array.isArray(entry.perPhotoAssessments)
            ? entry.perPhotoAssessments
            : (Array.isArray(entry.per_photo_assessments) ? entry.per_photo_assessments : []);
        for (const pa of paList) {
            const { proof: matched, match } = resolveProofForAssessment(pa, entry, cachedProofs);
            if (!matched) continue;
            const k = proofKey(matched);
            if (!k || perProofMap.has(k)) continue;
            perProofMap.set(k, { pa, entry, match, proof: matched });
        }
    }
    return { perProofMap, historyEntries, latestHistoryEntry: historyEntries[0] ?? null, hasMultipleRuns: historyEntries.length > 1 };
};

function header(title) {
    console.log('\n' + '='.repeat(78));
    console.log('  ' + title);
    console.log('='.repeat(78));
}

function reportProof(p, mapEntry, hasHistory) {
    const k = proofKey(p);
    if (mapEntry) {
        console.log(`  proof ${k}: verdict=${mapEntry.pa.verdict}  match=${mapEntry.match}  from-run=${mapEntry.entry.runAt}  badge=${
            hasHistory && !mapEntry ? 'Not yet assessed' : (mapEntry.match === 'approximate-tier2' || mapEntry.match === 'approximate-tier3' ? 'amber ≈' : 'none')
        }`);
    } else {
        console.log(`  proof ${k}: verdict=(none)              badge=${hasHistory ? 'Not yet assessed' : 'none'}`);
    }
}

// ------------------------------------------------------------
// Scenario 1: 5 history entries, 5 different proofs, each pa has proofId set.
//   Expected: every proof carries its own persistent verdict; no
//   "Not yet assessed" badges; hasMultipleRuns=true so the milestone-level
//   panel shows the "Reflects the most recent scan only" note.
// ------------------------------------------------------------
header('Scenario 1 — 5 history entries across 5 different proofs (v3.4)');
{
    const proofs = [
        { id: 'proof-A', url: 'https://s/A' },
        { id: 'proof-B', url: 'https://s/B' },
        { id: 'proof-C', url: 'https://s/C' },
        { id: 'proof-D', url: 'https://s/D' },
        { id: 'proof-E', url: 'https://s/E' },
    ];
    const history = [
        { runAt: '2026-08-05T05:00:00Z', promptVersion: 'v3.4-2026-08', proofKeys: ['proof-A'], perPhotoAssessments: [{ photo_index: 0, verdict: 'aligned', proofId: 'proof-A', reasoning: 'A ok', visible_elements: [] }] },
        { runAt: '2026-08-05T05:10:00Z', promptVersion: 'v3.4-2026-08', proofKeys: ['proof-B'], perPhotoAssessments: [{ photo_index: 0, verdict: 'partially_aligned', proofId: 'proof-B', reasoning: 'B partial', visible_elements: [] }] },
        { runAt: '2026-08-05T05:20:00Z', promptVersion: 'v3.4-2026-08', proofKeys: ['proof-C'], perPhotoAssessments: [{ photo_index: 0, verdict: 'not_aligned', proofId: 'proof-C', reasoning: 'C wrong phase', visible_elements: [] }] },
        { runAt: '2026-08-05T05:30:00Z', promptVersion: 'v3.4-2026-08', proofKeys: ['proof-D'], perPhotoAssessments: [{ photo_index: 0, verdict: 'aligned', proofId: 'proof-D', reasoning: 'D ok', visible_elements: [] }] },
        { runAt: '2026-08-05T05:40:00Z', promptVersion: 'v3.4-2026-08', proofKeys: ['proof-E'], perPhotoAssessments: [{ photo_index: 0, verdict: 'aligned', proofId: 'proof-E', reasoning: 'E ok', visible_elements: [] }] },
    ];
    const { perProofMap, hasMultipleRuns, latestHistoryEntry } = buildPerProofMap(history, proofs);
    console.log(`  hasMultipleRuns:      ${hasMultipleRuns}`);
    console.log(`  latestHistoryEntry:   runAt=${latestHistoryEntry.runAt}  overallVerdict=${latestHistoryEntry.perPhotoAssessments[0].verdict}`);
    console.log(`  perProofMap size:     ${perProofMap.size}  (expected 5)`);
    console.log(`  panel note visible:   ${hasMultipleRuns ? 'YES ("Reflects the most recent scan only…")' : 'no'}`);
    console.log('  per-photo strip:');
    for (const p of proofs) reportProof(p, perProofMap.get(proofKey(p)), true);
    console.log('  thumbnail badges:     none (assessedKeys covers all 5 proofs)');
}

// ------------------------------------------------------------
// Scenario 2: Same proof re-assessed across two runs.
//   Expected: the NEWER assessment wins in the map because we walk
//   newest-first with first-writer-wins.
// ------------------------------------------------------------
header('Scenario 2 — re-assessed proof (same key, two runs)');
{
    const proofs = [{ id: 'proof-X', url: 'https://s/X' }];
    const history = [
        { runAt: '2026-08-05T05:00:00Z', promptVersion: 'v3.4-2026-08', proofKeys: ['proof-X'], perPhotoAssessments: [{ photo_index: 0, verdict: 'partially_aligned', proofId: 'proof-X', reasoning: 'first run — partial', visible_elements: [] }] },
        { runAt: '2026-08-05T06:00:00Z', promptVersion: 'v3.4-2026-08', proofKeys: ['proof-X'], perPhotoAssessments: [{ photo_index: 0, verdict: 'aligned',           proofId: 'proof-X', reasoning: 'second run — aligned', visible_elements: [] }] },
    ];
    const { perProofMap, hasMultipleRuns } = buildPerProofMap(history, proofs);
    console.log(`  hasMultipleRuns:      ${hasMultipleRuns}`);
    console.log(`  perProofMap size:     ${perProofMap.size}  (expected 1)`);
    const entry = perProofMap.get('proof-X');
    console.log(`  proof-X verdict:      ${entry.pa.verdict}  (expected 'aligned' — newer wins)`);
    console.log(`  proof-X reasoning:    "${entry.pa.reasoning}"`);
    console.log(`  proof-X from-run:     ${entry.entry.runAt}  (expected 06:00Z)`);
}

// ------------------------------------------------------------
// Scenario 3: Pre-v2 record resolving by Tier 2 (no proofId, no v2/v3
// promptVersion). Expected: match='approximate-tier2', amber ≈ badge.
// ------------------------------------------------------------
header('Scenario 3 — pre-v2 record (proofId absent, no trusted version tag)');
{
    const proofs = [
        { id: 'proof-P', url: 'https://s/P' },
        { id: 'proof-Q', url: 'https://s/Q' },
    ];
    const history = [
        {
            runAt: '2026-08-04T10:00:00Z',
            // No promptVersion => isTrustedRecordVersion returns false.
            proofKeys: ['proof-P', 'proof-Q'],
            perPhotoAssessments: [
                { photo_index: 0, verdict: 'aligned',       reasoning: 'P looks ok',      visible_elements: [] },
                { photo_index: 1, verdict: 'not_aligned',   reasoning: 'Q wrong phase',   visible_elements: [] },
            ],
        },
    ];
    const { perProofMap } = buildPerProofMap(history, proofs);
    console.log(`  perProofMap size:     ${perProofMap.size}  (expected 2)`);
    for (const p of proofs) {
        const e = perProofMap.get(proofKey(p));
        console.log(`  ${proofKey(p)}: verdict=${e.pa.verdict}  match=${e.match}  badge=${e.match === 'approximate-tier2' ? 'amber ≈ (legacy record)' : 'none'}`);
    }
}

// ------------------------------------------------------------
// Scenario 4: v3+ record with proofId: null (out-of-range photo_index at
// trigger time). Expected under the broadened predicate: Tier 2 upgrades to
// 'exact' because promptVersion starts with 'v3'. Under the OLD predicate
// this would have been 'approximate-tier2' with a "legacy record" tooltip —
// the exact scenario the ancillary finding named.
// ------------------------------------------------------------
header('Scenario 4 — v3+ record with proofId null (ancillary-finding fix)');
{
    const proofs = [
        { id: 'proof-R', url: 'https://s/R' },
        { id: 'proof-S', url: 'https://s/S' },
    ];
    const history = [
        {
            runAt: '2026-08-06T09:00:00Z',
            promptVersion: 'v3.4-2026-08',
            proofKeys: ['proof-R', 'proof-S'],
            perPhotoAssessments: [
                // proofId is null (would-be trigger warn: out-of-range photo_index).
                // Tier 1 skips. Tier 2 resolves via proofKeys[0] → 'proof-R'.
                { photo_index: 0, verdict: 'aligned', proofId: null, reasoning: 'R aligned', visible_elements: [] },
                { photo_index: 1, verdict: 'aligned', proofId: null, reasoning: 'S aligned', visible_elements: [] },
            ],
        },
    ];
    const { perProofMap } = buildPerProofMap(history, proofs);
    for (const p of proofs) {
        const e = perProofMap.get(proofKey(p));
        console.log(`  ${proofKey(p)}: verdict=${e.pa.verdict}  match=${e.match}  badge=${
            e.match === 'exact' ? 'none (correctly NOT labeled legacy under broadened predicate)' : 'unexpected: ' + e.match
        }`);
    }
    // Sanity: prove the predicate is doing the work by re-running with the OLD scope.
    const oldPredicateResult = (() => {
        // Simulate the old isV2 check: only 'v2-2026-08' upgrades.
        const pa = history[0].perPhotoAssessments[0];
        const key = history[0].proofKeys[pa.photo_index];
        const isV2Old = history[0].promptVersion === 'v2-2026-08';
        return isV2Old ? 'exact' : 'approximate-tier2';
    })();
    console.log(`  (under old isV2 predicate this would have been:  ${oldPredicateResult})`);
}

console.log('\nAll scenarios executed. No writes.');
