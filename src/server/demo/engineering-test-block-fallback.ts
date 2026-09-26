import "server-only";

import {
  PitchIssueTriageSchema,
  PitchMobilePreviewAnswerSchema,
  type PitchCitation,
  type PitchIssueInput,
  type PitchIssueTriage,
  type PitchMobilePreviewAnswer,
} from "@/contracts";

const drawingKey = "drawing:engineering-test-block:1";
const capabilityKey = "supplier:ridgeway:cnc-capability";

const citations = {
  section: [{
    sourceKey: drawingKey,
    excerpt: "SECTION D-D shows a 60.0 mm wide by 60.0 mm high outer section.",
  }],
  passage: [{
    sourceKey: drawingKey,
    excerpt: "An internal horizontal passage enters from the left face, has a 15.0 mm vertical dimension, and terminates at the vertical centreline 30.0 mm from the left edge.",
  }],
  circularFeature: [{
    sourceKey: drawingKey,
    excerpt: "The plan view shows a circular feature on the vertical centreline with the callout Ø10.0(TYP).",
  }],
  tolerances: [{
    sourceKey: drawingKey,
    excerpt: "Tolerance table (unless otherwise specified): .X ± .1, .XX ± .05, .XXX ± .010, ANG. ± 1°.",
  }],
  missingSpecification: [{
    sourceKey: drawingKey,
    excerpt: "The title-block MATERIAL and FINISH fields are blank.",
  }],
  capability: [{
    sourceKey: capabilityKey,
    excerpt: "Confirmed machining envelope: 300 x 300 x 300 mm.",
  }, {
    sourceKey: capabilityKey,
    excerpt: "Drilling capability: Ø10 mm.",
  }],
} satisfies Record<string, PitchCitation[]>;

/**
 * Keeps the prepared five-minute demonstration usable if the hosted provider
 * is temporarily unavailable. The normal Luna request remains the preferred
 * path; these replies only use the fixed, cited Engineering Test Block facts.
 */
export function preparedEngineeringTestBlockAnswer(question: string): PitchMobilePreviewAnswer {
  const value = question.toLowerCase();

  if (/(passage|internal|orientation|left face|15(?:\.0)?\b|30(?:\.0)?\b)/.test(value)) {
    return answer(
      "SECTION D-D shows the internal passage entering from the left face. Its vertical dimension is 15.0 mm and it ends at the vertical centreline, 30.0 mm from the left edge. Pause for engineering if the part differs; the drawing does not establish a tool-entry sequence.",
      citations.passage,
    );
  }
  if (/(outer|section|60(?:\.0)?\b|width|overall size)/.test(value)) {
    return answer(
      "SECTION D-D shows a 60.0 mm wide by 60.0 mm high outer section. Compare the part with that drawing view and pause for engineering if it differs.",
      citations.section,
    );
  }
  if (/(hole|diameter|circular|10(?:\.0)?\b|drill)/.test(value)) {
    return answer(
      "The plan view marks a circular feature on the vertical centreline as Ø10.0(TYP). The supplied drawing does not establish its drilling depth or sequence.",
      citations.circularFeature,
    );
  }
  if (/(tolerance|tol\b|gd\s*&?\s*t|inspection)/.test(value)) {
    return answer(
      "The drawing lists default tolerances of .X ± .1, .XX ± .05, .XXX ± .010 and ANG. ± 1°. Engineering still needs to confirm feature-specific application and inspection.",
      citations.tolerances,
    );
  }
  if (/(possible|capability|can .*machine|supplier|ridgeway|envelope)/.test(value)) {
    return answer(
      "The prepared comparison is clear for engineer review: the cited 60.0 mm section is below the recorded 300 mm machining envelope and Ø10 mm drilling is recorded. It does not prove the complete setup or give production approval.",
      [...citations.section, ...citations.capability, ...citations.circularFeature],
    );
  }
  if (/(start|before|confirm|first|ready)/.test(value)) {
    return answer(
      "Before starting, compare the outer section, internal passage and circular feature with the drawing. Engineering must still confirm material, stock, finish, setup, tolerance application and inspection before release.",
      [...citations.section, ...citations.passage, ...citations.circularFeature, ...citations.missingSpecification],
    );
  }

  return PitchMobilePreviewAnswerSchema.parse({
    approvalState: "draft",
    evidenceState: "not_found",
    text: "The prepared knowledge base does not establish that detail. Keep the part on hold while engineering reviews the drawing and the reported question.",
    citations: [],
    suggestedEngineerReview: "Please confirm the requested detail against the drawing before work continues.",
  });
}

/** Creates the same short, hold-preserving inbox item when Luna is offline. */
export function preparedEngineeringTestBlockInsight(issue: PitchIssueInput): PitchIssueTriage {
  const observation = issue.text.length > 860 ? `${issue.text.slice(0, 857)}…` : issue.text;
  return PitchIssueTriageSchema.parse({
    approvalState: "draft",
    severity: "hold",
    title: "Floor observation needs engineer review",
    summary: `Floor observation: ${observation}`,
    affectedOperation: issue.operation,
    knownEvidence: [
      "SECTION D-D identifies a 60.0 mm by 60.0 mm outer section and an internal passage.",
      "Material and finish are blank in the drawing title block.",
    ],
    knownEvidenceCitations: [citations.section, citations.missingSpecification],
    unknowns: [
      "The operator observation has not been confirmed against the part or drawing.",
      "The supplied package does not establish a corrective action or whether work may continue.",
    ],
    engineerDecisionNeeded: "Review the floor observation, confirm the relevant drawing requirement, and decide whether to issue approved direction.",
    suggestedReply: "Keep the part on hold and await engineer direction.",
    citations: [...citations.section, ...citations.missingSpecification],
  });
}

function answer(text: string, evidence: PitchCitation[]): PitchMobilePreviewAnswer {
  return PitchMobilePreviewAnswerSchema.parse({
    approvalState: "draft",
    evidenceState: "supported",
    text,
    citations: evidence,
    suggestedEngineerReview: null,
  });
}
