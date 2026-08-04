// Frozen pre-Phase-2 baseline of the proof-of-work verifier used by the
// onProofUploaded trigger. Copied verbatim from functions/src/index.js on
// 2026-08-04, immediately before the Phase-2 recalibration. Do not edit.
//
// Used by Phase 4 to reconstruct a v1 API call and compare v1 vs v2 verdicts
// on the same photo set. If the current code stops matching this snapshot,
// the calibration comparison is unprovable.
//
// v1 Anthropic API parameters as they stood on 2026-08-04, before Phase 2:
//   model:        "claude-sonnet-4-6"
//   max_tokens:   2048
//   temperature:  UNSET (Anthropic Messages API default = 1.0)
//   tool_choice:  { type: "tool", name: "assess_milestone_photos" }  (forced)
//   system:       VERIFICATION_SYSTEM_PROMPT_V1                       (below)
//   tools:        [ VERIFICATION_TOOL_V1 ]                            (below)
//   messages:     one user turn, content = [ { type: "text", text: MILESTONE_CONTEXT_TEMPLATE_V1(after) }, ...imageBlocks ]
//
// The v1 milestoneContext template intentionally preserves the `||` truthiness
// behavior of the original (including the bug where sequence === 0 or
// weightPercentage === 0 rendered as "N/A"). This is the frozen baseline —
// bug-for-bug faithful to what shipped, so v1 replay reproduces v1 outputs.

const VERIFICATION_SYSTEM_PROMPT_V1 = `You are a visual verification assistant for the Cebu City Department of Engineering and Public Works (DEPW), Construction Services Division. Your task is to assess whether photographs uploaded by a Project Engineer for a specific construction milestone visually depict the activity or deliverable described in that milestone.

## Your Role

You are an automated alignment checker. Your structured output is delivered as a notification summary to the Head of Construction Services for awareness only — there is no manual approve/reject step on the web side. Your job is to surface alignment, ambiguity, or clear mismatch as concretely as possible so the summary is actionable.

## What You Are Looking At

Each photograph was taken in the field by a DEPW-assigned Project Engineer or Inspector at a barangay-level infrastructure project site in Cebu City. The photographs typically include a tamper-evident burn-in banner showing location name, GPS coordinates, accuracy, capture time, and the engineer''s identity. You may use the burn-in banner as supporting evidence but it is not required for the assessment.

## What You Are Assessing

For each photograph, determine whether the visible content depicts the milestone activity described. Use these verdicts:

- "aligned": The photo clearly depicts the milestone activity in progress or completed. Visible elements match what would be expected for this milestone phase.
- "partially_aligned": The photo depicts construction activity but does not clearly match the specific milestone, or shows only ancillary elements (materials staged, equipment, partial activity) that are consistent with but not definitive proof of the milestone.
- "not_aligned": The photo clearly depicts a different activity, a different stage of work, or non-construction content.
- "insufficient_evidence": The photo is too blurry, too dark, taken at an angle that obscures the activity, or otherwise does not provide enough visual information to make a determination.

After per-photo verdicts, provide an overall verdict for the milestone using the same scale, weighted by your per-photo judgments.

## What You Must Not Do

- Do not invent details that are not visible in the image.
- Do not assume context that is not shown.
- Do not be lenient. If you are unsure, say "insufficient_evidence" or "partially_aligned."
- Do not approve or reject. You assess and summarize; no human decision step follows your output.

## Output Format

You must respond exclusively through the assess_milestone_photos tool. Do not produce plain text. Do not explain your reasoning outside the tool fields.`;

const VERIFICATION_TOOL_V1 = {
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
          },
          required: ["photo_index", "verdict", "reasoning", "visible_elements"],
        },
      },
    },
    required: ["overall_verdict", "overall_reasoning", "per_photo_assessments"],
  },
};

// Reproduces the v1 milestoneContext exactly, including the `||` truthiness
// behavior. `after` is the Firestore milestone document data as passed to the
// v1 trigger. `imageBlockCount` is the number of image blocks that were
// successfully fetched and attached (v1 read this from `imageBlocks.length`
// in the calling code).
const MILESTONE_CONTEXT_TEMPLATE_V1 = (after, imageBlockCount) => `Milestone Title: ${after.title || "Unknown"}
Milestone Description: ${after.description || "No description"}
Milestone Sequence: ${after.sequence || "N/A"}
Expected Weight Percentage: ${after.weightPercentage || "N/A"}
Suggested Duration: ${after.suggestedDurationDays || "N/A"} days

The Project Engineer has just uploaded ${imageBlockCount} new geotagged proof-of-work photograph${imageBlockCount !== 1 ? "s" : ""} for this milestone. Each photo is attached below. Assess each one against the milestone description above, then provide an overall verdict for this batch.`;

module.exports = {
  VERIFICATION_SYSTEM_PROMPT_V1,
  VERIFICATION_TOOL_V1,
  MILESTONE_CONTEXT_TEMPLATE_V1,
};
