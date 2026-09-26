import "server-only";

import generated from "./engineering-test-block-knowledge-base.json";
import {
  PitchCapabilityCheckSchema,
  PitchKnowledgeBaseSchema,
  assertPitchOutputCitations,
  type PitchSource,
} from "@/server/ai/pitch";

const drawingKey = "drawing:engineering-test-block:1";
const profileKey = "supplier:ridgeway:profile";
const capabilityKey = "supplier:ridgeway:cnc-capability";

/**
 * The two supplied Engineering Test Block files are deliberately prepared for
 * the five-minute demonstration. This keeps the phone workflow deterministic
 * while the normal upload-to-analysis flow remains available separately.
 * Only compact, cited text excerpts are retained here; the drawing and STL
 * stay outside the source tree and are not bundled into the browser.
 */
export const engineeringTestBlockSources: PitchSource[] = [
  {
    sourceKey: drawingKey,
    label: "Engineering test block drawing, page 1",
    text: [
      "Engineering test block",
      "SECTION D-D",
      "ALL DIMENSIONS IN MILLIMETERS.",
      "GD&T AS PER ISO1101-2004.",
      "60.0",
      "60.0",
      "10.0(TYP)",
      "Drawing visual review: SECTION D-D shows a 60.0 mm wide by 60.0 mm high outer section. An internal horizontal passage enters from the left face, has a 15.0 mm vertical dimension, and terminates at the vertical centreline 30.0 mm from the left edge. The plan view shows a circular feature on the vertical centreline with the callout Ø10.0(TYP).",
      "Tolerance table (unless otherwise specified): .X ± .1, .XX ± .05, .XXX ± .010, ANG. ± 1°.",
      "The title-block MATERIAL and FINISH fields are blank.",
      "MATERIAL",
      "DESIGN",
      "THIRD ANGLE PROJECTION",
      "ISSUE DATE",
      "FINISH",
      "SUPERVISOR REV1",
      "PART DESCRIPTION .XXX 1 .010 .05 .1",
      "DECIMAL mm TOLERANCE (UNLESS OTHERWISE SPECIFIED) ANG. MATERIAL",
    ].join("\n"),
  },
  {
    sourceKey: profileKey,
    label: "Confirmed supplier profile",
    text: "Supplier profile: Ridgeway Precision Machining. Supplier profile confirmation: confirmed. Selected machine: Ridgeway CNC machining centre. Recorded process: CNC milling and drilling.",
  },
  {
    sourceKey: capabilityKey,
    label: "Confirmed CNC capability",
    text: "Confirmed machining envelope: 300 x 300 x 300 mm. Drilling capability: Ø10 mm.",
  },
];

const capability = PitchCapabilityCheckSchema.parse(generated.capability);
const knowledgeBase = PitchKnowledgeBaseSchema.parse(generated.knowledgeBase);
assertPitchOutputCitations(capability, engineeringTestBlockSources);
assertPitchOutputCitations(knowledgeBase, engineeringTestBlockSources);

export const engineeringTestBlockDemo = {
  id: "engineering-test-block",
  partName: "Engineering Test Block",
  partNumber: "ETB-REV1",
  inputFiles: [
    { name: "Engineering test block (1).pdf", kind: "Technical drawing", status: "Prepared" },
    { name: "Engineering test block (1).STL", kind: "3D reference", status: "Prepared" },
  ],
  capability,
  knowledgeBase,
  sources: engineeringTestBlockSources,
} as const;
