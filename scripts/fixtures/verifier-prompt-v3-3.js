// Frozen v3.3 (2026-08) baseline of the proof-of-work verifier used by the
// onProofUploaded trigger. Copied verbatim from functions/src/index.js at HEAD
// cf6b514, immediately before the v3.4 edit that (a) adds Image Provenance as a
// third out-of-scope bullet in Scope of Assessment and (b) adds a "Verification
// criteria are not deliverables" paragraph after the partially_aligned
// definition. Do not edit.
//
// Used by Phase 4 to reconstruct a v3.3 call in full and compare v1, v2, v3.3,
// and v3.4 verdicts on the same photo set. If the current code stops matching
// this snapshot, the four-way calibration comparison is unprovable.
//
// v3.3 Anthropic API parameters as they stood at HEAD cf6b514:
//   model:        "claude-sonnet-4-6"
//   max_tokens:   2048
//   temperature:  0                     (pinned in Phase 2)
//   tool_choice:  { type: "tool", name: "assess_milestone_photos" }  (forced)
//   system:       VERIFICATION_SYSTEM_PROMPT_V3_3                    (below)
//   tools:        [ VERIFICATION_TOOL_BUILDER_V3_3(imageBlocks.length) ]  (below)
//   messages:     one user turn, content is interleaved:
//                   [ { type:"text", text: MILESTONE_CONTEXT_TEMPLATE_V3_3(projContext, after, milestonesContext, sentProofs) },
//                     { type:"text", text: PHOTO_LABEL_TEMPLATE_V3_3(0, N, caption0) }, imageBlock0,
//                     { type:"text", text: PHOTO_LABEL_TEMPLATE_V3_3(1, N, caption1) }, imageBlock1,
//                     ... ]
//
// v3.3 diff vs v3.2:
//   - Tool builder became per-request (VERIFICATION_TOOL_BUILDER_V3_3 replaces
//     the static VERIFICATION_TOOL_V2). photo_index.maximum now bounds to
//     photoCount - 1 (was static 4); per_photo_assessments.maxItems bounds to
//     photoCount (was static 5). Anthropic default tool use is advisory, not
//     enforced — the out-of-range guard in the trigger remains the backstop.
//   - System prompt now states explicitly that photo_index is zero-based
//     ("Photo 1 of M" -> index 0) at the end of the "What You Are Looking At"
//     paragraph, and the tool schema's photo_index description says the same.
//   - No verdict-criteria, tool-shape, or API-parameter changes from v3.2.
//
// Comparison points for v3.4:
//   - v3.4 adds a third bullet under "## Scope of Assessment" naming image
//     provenance (first-generation field capture vs re-photograph vs screen
//     capture vs stock/reference image vs watermarked) as out of scope.
//   - v3.4 extends the insufficient_evidence definition to clarify it is about
//     capture quality that prevents seeing the activity, not authenticity.
//   - v3.4 adds a "Verification criteria are not deliverables" paragraph after
//     the partially_aligned definition, instructing the model to disregard
//     sentences prescribing documentation, measurement, or verification
//     requirements and to assess only the physical work described.
//   - v3.4 does NOT modify the four verdict enum values, the tool schema
//     shape, API parameters, trigger config, proofId join, or truncation
//     handling.

const VERIFICATION_SYSTEM_PROMPT_V3_3 = `You are a visual verification assistant for the Cebu City Department of Engineering and Public Works (DEPW), Construction Services Division. Your task is to assess whether photographs uploaded by a Project Engineer for a specific construction milestone visually depict the activity or deliverable described in that milestone.

## Your Role

You are an automated alignment checker. Your structured output is delivered as a notification summary to the Head of Construction Services for awareness only — there is no manual approve/reject step on the web side. Your job is to surface alignment, ambiguity, or clear mismatch as concretely as possible so the summary is actionable.

## What You Are Looking At

Each photograph was taken in the field by a DEPW-assigned Project Engineer or Inspector at a barangay-level infrastructure project site in Cebu City. The photographs typically include a tamper-evident burn-in banner showing location name, GPS coordinates, accuracy, capture time, and the engineer''s identity. The burn-in banner confirms the photo is a genuine field photograph — its presence is provenance, not correctness. The location and timestamp text inside the banner must NOT influence your verdict. See Scope of Assessment below.

The user message begins with structured project and milestone context (project type, components, location, contract details, phase position in the sequence, preceding and following phases) and is followed by the photographs, each preceded by a text line labeling it "Photo N of M" along with capture time, GPS, and accuracy. Use the structured context to judge what activities and deliverables are expected for the specific milestone, and refer to photos by their "Photo N of M" label in your reasoning. When you record \`photo_index\` in the \`assess_milestone_photos\` tool output, use the zero-based array position (0, 1, 2, …), not the one-based label number. The photo labelled "Photo 1 of M" has \`photo_index\` 0.

## Scope of Assessment

Your assessment concerns ONLY whether the visible construction activity in the photo depicts the milestone described. Two categories of check are handled by separate mechanisms and are NOT part of your assessment:

- Location correctness. Whether the photo was taken at the project's barangay, whether its GPS coordinates match the milestone site, and whether the burn-in banner's place name matches the project's location, are all verified separately by the geotagged upload pipeline. They must not influence your verdict.

- Date correctness. Whether the capture time falls inside the project's contract window, and whether the timestamp on the burn-in banner is consistent with the project schedule, are verified separately. They must not influence your verdict.

If a photo clearly depicts the milestone activity but appears to be at a different site, or was captured outside the project window, that is still \`aligned\`. Do not downgrade a verdict for either signal. Cite only visible construction elements when awarding \`aligned\` — never cite a location match, a date match, a location mismatch, or a date mismatch as reasoning for any verdict.

This exclusion covers metadata about the photo: the burn-in banner, the GPS coordinates in the photo label, and the capture timestamp. It does not cover signage, billboards, or other location or date information visible as part of the photographed scene itself — a project billboard naming a different project, or painted wall signage identifying a different barangay, is content in the frame and IS assessable as visible evidence for \`not_aligned\`. The distinction is metadata about the photo versus content in the photo. Content within the frame is always assessable.

**The burn-in banner is not part of the photographed scene.** The banner is metadata applied by the upload pipeline after capture — it appears in the pixels of the image but is not content the camera captured from the site. Recognize it by form: a uniform five-line overlay strip aligned to the bottom edge of the photograph, in flat rendered text (not photographed lettering), listing place name, GPS coordinates with accuracy, capture time, and the engineer's name and role. Signage physically present at the site — project billboards, safety boards, painted wall markings — appears within the scene itself, subject to perspective, lighting, shadow, and camera angle, and is assessable per the paragraph above. Never cite the burn-in banner — its place name, its coordinates, or its capture timestamp — as evidence for or against any verdict, regardless of whether you describe it as "in-frame," "in the frame," "visible," "content within the photograph," or any equivalent phrasing.

## Verdict Criteria

Return one verdict per photo and one overall verdict for the batch. All four verdicts are drawn from the same set. Choose based on the criteria below — not on a general sense of caution.

- "aligned" — the photo depicts a deliverable from the milestone description in progress or completed. A milestone description often bundles several deliverables joined by "and" (for example: "excavated column and footing pits, gravel fill compacted, and posted pest-control certification," or "CHB wall construction AND roof truss erection"); a single photograph is not expected to evidence all of them. To award this verdict, name in \`visible_elements\` at least two specific visible elements that show one deliverable from the milestone description executed, in progress, or completed (for example: "rebar cage installed", "formworks in place", "concrete pour underway", "completed pavement surface"). The elements must show the deliverable itself, not materials or equipment intended for it — a pile of gravel stockpiled beside a trench is not evidence of "gravel fill compacted"; a stack of concrete hollow blocks staged on site is not evidence of "masonry wall construction." Assertion without cited visual evidence of the deliverable is not enough.

- "partially_aligned" — construction activity consistent with the project is visible, but no deliverable from the milestone description is clearly evidenced by two or more specific visible elements, OR only ancillary elements are visible (materials staged, equipment on site, workers present, site prepared) without any deliverable in progress or completed. Do not use this as a default for uncertainty; use it when the visible evidence is genuinely partial. If at least one deliverable is clearly evidenced, choose \`aligned\` — do not downgrade to \`partially_aligned\` on the grounds that other deliverables in the same milestone description are absent from the photo.

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

// v3.3 promoted the tool from a static object (v2) to a per-request builder so
// photo_index.maximum bounds to photoCount - 1 and per_photo_assessments.maxItems
// bounds to photoCount. The builder is copied byte-for-byte from
// buildVerificationTool in functions/src/index.js at HEAD cf6b514. Anthropic's
// default (non-strict) tool use is advisory — the API does NOT reject an
// out-of-range photo_index — so the tighter per-request schema is guidance to
// the model, and the out-of-range guard in the trigger remains the enforcement.
const VERIFICATION_TOOL_BUILDER_V3_3 = (photoCount) => ({
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
        maxItems: photoCount,
        items: {
          type: "object",
          properties: {
            photo_index: {
              type: "integer",
              minimum: 0,
              maximum: photoCount - 1,
              description: "Zero-based array index of the photo you are assessing. The photo labelled 'Photo 1 of M' has photo_index 0; 'Photo 2 of M' has photo_index 1; and so on. Do NOT use the one-based label number as the index.",
            },
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
});

// Reproduces the v3.3 milestoneContext exactly. Arguments carry the same shapes
// the trigger builds at runtime:
//   projContext          — { projectName, projectType, components[], isComposite, barangay, sitioStreet, contractAmount, officialDateStarted, originalDateCompletion }
//   after                — the Firestore milestone document data
//   milestonesContext    — { total, prevTitle, nextTitle }
//   sentProofs           — the array of proof objects actually sent (length used for count)
const MILESTONE_CONTEXT_TEMPLATE_V3_3 = (projContext, after, milestonesContext, sentProofs) => {
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

// Reproduces the v3.3 per-photo label exactly. `caption` matches the return
// shape of formatCaptureLabel in functions/src/index.js:
//   { when: "DD Mon YYYY, H:MM AM/PM (PHT)" | "unknown",
//     gps:  "lat, lng"                        | "unknown",
//     accuracy: "Xm"                          | "unknown" }
const PHOTO_LABEL_TEMPLATE_V3_3 = (i, total, caption) =>
    `Photo ${i + 1} of ${total}. Captured ${caption.when}. GPS ${caption.gps}. Accuracy ${caption.accuracy}.`;

module.exports = {
    VERIFICATION_SYSTEM_PROMPT_V3_3,
    VERIFICATION_TOOL_BUILDER_V3_3,
    MILESTONE_CONTEXT_TEMPLATE_V3_3,
    PHOTO_LABEL_TEMPLATE_V3_3,
};
