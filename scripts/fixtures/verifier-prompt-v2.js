// Frozen v2 (2026-08-04 recalibration) baseline of the proof-of-work verifier
// used by the onProofUploaded trigger. Copied verbatim from
// functions/src/index.js at HEAD f47111a, immediately before the v3 scope-
// restriction edit that removed location and date from the model's decision
// space. Do not edit.
//
// Used by Phase 4 to reconstruct a v2 call in full and compare v1, v2, and v3
// verdicts on the same photo set. If the current code stops matching this
// snapshot, the three-way calibration comparison is unprovable.
//
// v2 Anthropic API parameters as they stood at HEAD f47111a:
//   model:        "claude-sonnet-4-6"
//   max_tokens:   2048
//   temperature:  0                     (pinned in Phase 2)
//   tool_choice:  { type: "tool", name: "assess_milestone_photos" }  (forced)
//   system:       VERIFICATION_SYSTEM_PROMPT_V2                     (below)
//   tools:        [ VERIFICATION_TOOL_V2 ]                          (below)
//   messages:     one user turn, content is interleaved:
//                   [ { type:"text", text: MILESTONE_CONTEXT_TEMPLATE_V2(projContext, after, milestonesContext, sentProofs) },
//                     { type:"text", text: PHOTO_LABEL_TEMPLATE_V2(0, N, caption0) }, imageBlock0,
//                     { type:"text", text: PHOTO_LABEL_TEMPLATE_V2(1, N, caption1) }, imageBlock1,
//                     ... ]
//
// Comparison points for v3:
//   - v3 adds a "## Scope of Assessment" section restricting the verdict to
//     visual alignment only and declaring location/date correctness out of
//     scope, with a carve-out for signage/billboards visible in the frame.
//   - v3 narrows the burn-in banner sentence from permissive supporting-
//     evidence framing to provenance-only framing.
//   - v3 does NOT modify the four verdict definitions or the tool schema.
//   - v3 does NOT change API parameters, trigger config, or proofId join.

const VERIFICATION_SYSTEM_PROMPT_V2 = `You are a visual verification assistant for the Cebu City Department of Engineering and Public Works (DEPW), Construction Services Division. Your task is to assess whether photographs uploaded by a Project Engineer for a specific construction milestone visually depict the activity or deliverable described in that milestone.

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

const VERIFICATION_TOOL_V2 = {
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

// Reproduces the v2 milestoneContext exactly. Arguments carry the same shapes
// the trigger builds at runtime:
//   projContext          — { projectName, projectType, components[], isComposite, barangay, sitioStreet, contractAmount, officialDateStarted, originalDateCompletion }
//   after                — the Firestore milestone document data
//   milestonesContext    — { total, prevTitle, nextTitle }
//   sentProofs           — the array of proof objects actually sent (length used for count)
const MILESTONE_CONTEXT_TEMPLATE_V2 = (projContext, after, milestonesContext, sentProofs) => {
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
    return `## Project Context

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
};

// Reproduces the v2 per-photo label exactly. `caption` matches the return
// shape of formatCaptureLabel in functions/src/index.js:
//   { when: "DD Mon YYYY, H:MM AM/PM (PHT)" | "unknown",
//     gps:  "lat, lng"                        | "unknown",
//     accuracy: "Xm"                          | "unknown" }
const PHOTO_LABEL_TEMPLATE_V2 = (i, total, caption) =>
    `Photo ${i + 1} of ${total}. Captured ${caption.when}. GPS ${caption.gps}. Accuracy ${caption.accuracy}.`;

module.exports = {
    VERIFICATION_SYSTEM_PROMPT_V2,
    VERIFICATION_TOOL_V2,
    MILESTONE_CONTEXT_TEMPLATE_V2,
    PHOTO_LABEL_TEMPLATE_V2,
};
