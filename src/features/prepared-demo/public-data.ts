export type GuideStep = {
  number: string;
  title: string;
  description: string;
  drawingReference: string;
};

export type PreparedPart = {
  id: string;
  name: string;
  project: string;
  drawingId: string;
  revision: string;
  revisionNote: string;
  sourcePdf: string;
  drawingPdf: string;
  drawingPreview: string;
  drawingAlt: string;
  qrCodeImage: string;
  qrTarget: string;
  modelStl: string;
  modelFileName: string;
  state: "Revision needs review";
  facility: string;
  machine: string;
  readiness: string;
  evidence: string[];
  sourceFacts: string[];
  guideSteps: GuideStep[];
  chatFacts: {
    dimensions: string;
    drilling: string;
    guide: string;
    model: string;
  };
  openQuestion: string;
  nextAction: string;
};

// Local copies of the user-supplied source files power one focused public demo.
// The demo guide is a review aid and never establishes a released process.
export const preparedParts: PreparedPart[] = [
  {
    id: "manufacturing-test-sheet",
    name: "Steel Bracket",
    project: "Focused public demo",
    drawingId: "Steel Bracket",
    revision: "Needs review",
    revisionNote: "The source revision table shows REV1 / RELEASE while the title block reads ANY. Resolve that conflict before treating a revision as confirmed.",
    sourcePdf: "/chappe-demo/manufacturing-test-sheet.pdf",
    drawingPdf: "/chappe-demo/steel-bracket-qr-drawing.pdf",
    drawingPreview: "/chappe-demo/steel-bracket-qr-drawing-preview.png",
    drawingAlt: "Steel Bracket demo drawing with a Chappe QR code in the right-side drawing margin",
    qrCodeImage: "/chappe-demo/steel-bracket-qr.png",
    qrTarget: "http://10.196.209.152:3312/parts/manufacturing-test-sheet",
    modelStl: "/chappe-demo/manufacturing-test-sheet.stl",
    modelFileName: "Steel Bracket source STL",
    state: "Revision needs review",
    facility: "No facility selected",
    machine: "No equipment context supplied",
    readiness: "The QR drawing, source PDF, STL visual reference, and a demo review guide are available. Material, finish, facility, and approved work guidance remain unresolved.",
    evidence: ["QR-enabled demo drawing", "Original source drawing PDF", "User-provided STL visual reference", "Demo manufacturing guide"],
    sourceFacts: [
      "The source drawing states that all dimensions are in millimetres and cites ISO 1101-2004 GD&T.",
      "The drawing shows 75.0 mm overall length, plus 40.0 mm base and 37.0 mm upright profile dimensions.",
      "The drawing calls out two R3.0 circular features on the 30.0 mm upper face and one R6.0 feature in the rounded R15.0 area.",
      "The source drawing does not show datum-based X/Y hole-centre coordinates.",
      "The STL is unitless and is shown only as a visual reference.",
    ],
    guideSteps: [
      {
        number: "01",
        title: "Verify the source before work starts",
        description: "Use the QR-enabled demo drawing and compare its revision fields. The source table says REV1 / RELEASE, while the title block says ANY.",
        drawingReference: "Revision table and title block",
      },
      {
        number: "02",
        title: "Confirm material and manufacturing route",
        description: "The drawing leaves material and finish blank. Confirm stock, tooling, fixturing, and whether the profile is formed or machined before releasing work.",
        drawingReference: "Material and finish fields",
      },
      {
        number: "03",
        title: "Set up from the drawing views",
        description: "Use the drawing views to establish the blank and profile. Keep the 75.0 mm overall dimension and the 40.0 mm base / 37.0 mm upright profile values in the inspection plan.",
        drawingReference: "Front and side profile views",
      },
      {
        number: "04",
        title: "Locate the circular features from the drawing",
        description: "The source calls out two R3.0 features on the 30.0 mm upper face and one R6.0 feature in the rounded R15.0 area. The web demo does not invent drill coordinates; use the drawing views and engineer confirmation for the setup.",
        drawingReference: "Upper face and rounded feature views",
      },
      {
        number: "05",
        title: "Finish the profile and inspect",
        description: "Deburr and inspect against the source drawing after the chosen process is reviewed. Record any unresolved tolerance, finish, or fit question for engineering.",
        drawingReference: "Source notes and all drawing views",
      },
    ],
    chatFacts: {
      dimensions: "The source drawing uses millimetres. It visibly calls out 75.0 mm overall length, 40.0 mm base length, 37.0 mm upright height, 30.0 mm upper face width, and 3.0 mm typical thickness. Check the QR drawing for the full set of dimensions before making a part.",
      drilling: "The drawing shows two R3.0 circular features on the 30.0 mm upper face and one R6.0 circular feature in the rounded R15.0 area. It does not show datum-based X/Y hole-centre coordinates, so use the drawing views and confirm the drill setup with engineering.",
      guide: "Open Guide in the Steel Bracket shop view for the source-grounded review sequence. It covers source review, material and route confirmation, profile setup, circular feature review, and final inspection. It is not approved work guidance.",
      model: "This view uses the supplied Steel Bracket STL as a visual reference. Its viewer bounds are 75 by 57.5 by 44, but the STL is unitless and does not replace the drawing as the source of dimensions.",
    },
    openQuestion: "Which material, manufacturing route, and revision should be confirmed before a real handoff?",
    nextAction: "Engineer to resolve the source revision, material, and process context before release.",
  },
];

export function getPreparedPart(id: string): PreparedPart | undefined {
  return preparedParts.find((part) => part.id === id);
}
