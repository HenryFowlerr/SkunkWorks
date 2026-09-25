import type {
  Actor,
  Asset,
  ContextRef,
  Draft,
  DraftContent,
  DraftContentInput,
  EvidenceRef,
  Flag,
  Job,
  PanelModel,
  Release,
  ReleaseView,
  WorkshopSnapshot,
} from "@/contracts";

export const ids = {
  workspace: "00000000-0000-4000-8000-000000000001",
  member: "00000000-0000-4000-8000-000000000002",
  workshop: "00000000-0000-4000-8000-000000000003",
  workshopSnapshot: "00000000-0000-4000-8000-000000000004",
  machine: "00000000-0000-4000-8000-000000000005",
  machineNote: "00000000-0000-4000-8000-000000000006",
  job: "00000000-0000-4000-8000-000000000007",
  asset: "00000000-0000-4000-8000-000000000008",
  draft: "00000000-0000-4000-8000-000000000009",
  step: "00000000-0000-4000-8000-000000000010",
  finding: "00000000-0000-4000-8000-000000000011",
  generation: "00000000-0000-4000-8000-000000000012",
  release: "00000000-0000-4000-8000-000000000013",
  visitor: "00000000-0000-4000-8000-000000000014",
  flag: "00000000-0000-4000-8000-000000000015",
  review: "00000000-0000-4000-8000-000000000016",
  proposal: "00000000-0000-4000-8000-000000000017",
} as const;

const documentEvidence: EvidenceRef = {
  kind: "document",
  assetId: ids.asset,
  page: 1,
  region: [0.1, 0.2, 0.25, 0.15],
  excerpt: "Bend B1: 90 degrees, R3.",
};

const supportedNumber = (value: number) => ({
  value,
  evidence: [documentEvidence],
  evidenceState: "supported" as const,
  originalText: String(value),
});

export const sourceAsset = {
  id: ids.asset,
  jobId: ids.job,
  releaseId: null,
  kind: "drawing_pdf",
  filename: "sample-bracket.pdf",
  mimeType: "application/pdf",
  byteSize: 2048,
  sha256: "a".repeat(64),
  version: 1,
  status: "ready",
  drawingRevision: "A",
} satisfies Asset;

export const pendingAsset = {
  ...sourceAsset,
  sha256: null,
  status: "pending",
} satisfies Asset;

export const failedAsset = {
  ...sourceAsset,
  sha256: null,
  status: "failed",
} satisfies Asset;

export const workshopSnapshot = {
  id: ids.workshopSnapshot,
  workshopId: ids.workshop,
  workspaceId: ids.workspace,
  version: 1,
  name: "Brake cell",
  machines: [{
    id: ids.machine,
    name: "Press brake 1",
    process: "press_brake",
    model: "PB-100",
    usableBendLengthMm: {
      value: 1000,
      evidence: [{
        kind: "workshop_note",
        snapshotId: ids.workshopSnapshot,
        machineId: ids.machine,
        noteId: ids.machineNote,
      }],
      evidenceState: "supported",
      originalText: "1000 mm",
    },
    tools: [{ id: ids.machineNote, name: "V-die 12", specification: "12 mm", evidence: [] }],
    notes: [{
      id: ids.machineNote,
      text: "Setup checked",
      authorId: ids.member,
      createdAt: "2026-09-25T11:00:00.000Z",
      source: null,
      confirmedBy: ids.member,
    }],
    approvedOrderConstraints: [],
  }],
  confirmedBy: ids.member,
  confirmedAt: "2026-09-25T12:00:00.000Z",
} satisfies WorkshopSnapshot;

export const panelModel = {
  schemaVersion: "1.0",
  units: "mm",
  thicknessMm: 2,
  rootPanelId: "P1",
  panels: [
    { id: "P1", polygonMm: [[0, 0], [100, 0], [100, 50], [0, 50]] },
    { id: "P2", polygonMm: [[100, 0], [120, 0], [120, 50], [100, 50]] },
  ],
  hinges: [{
    id: "H1",
    parentPanelId: "P1",
    childPanelId: "P2",
    axisStartMm: [100, 0],
    axisEndMm: [100, 50],
  }],
  origin: "reviewer_mapped",
  referenceFaceLabel: "Outside face",
  reviewed: true,
} satisfies PanelModel;

export const draftContent: DraftContent = {
  sourceAssetIds: [ids.asset],
  workshopSnapshotId: ids.workshopSnapshot,
  machineId: ids.machine,
  panelModel,
  bends: [{
    bendId: "B1",
    hingeId: "H1",
    finishedAngle: {
      value: { degrees: 90, convention: "internal" },
      evidence: [documentEvidence],
      evidenceState: "supported",
      originalText: "90° internal",
    },
    foldRotationDeg: supportedNumber(90),
    insideRadiusMm: supportedNumber(3),
    directionText: {
      value: "Up from flat",
      evidence: [documentEvidence],
      evidenceState: "supported",
      originalText: "Up",
    },
  }],
  steps: [{
    id: ids.step,
    bendId: "B1",
    instruction: "Make bend B1 upward to the marked angle.",
    evidence: [documentEvidence],
    camera: { positionMm: [180, 120, 180], targetMm: [50, 20, 0] },
  }],
  findings: [],
  machineProposals: [],
};

export const draftContentInput: DraftContentInput = {
  ...draftContent,
  panelModel: {
    schemaVersion: panelModel.schemaVersion,
    units: panelModel.units,
    thicknessMm: panelModel.thicknessMm,
    rootPanelId: panelModel.rootPanelId,
    panels: panelModel.panels,
    hinges: panelModel.hinges,
    origin: panelModel.origin,
    referenceFaceLabel: panelModel.referenceFaceLabel,
  },
  findings: [],
  machineProposals: [],
};

export const draft: Draft = {
  id: ids.draft,
  jobId: ids.job,
  version: 1,
  content: draftContent,
  reviews: [],
  generationId: ids.generation,
  inputFingerprint: "b".repeat(64),
};

export const job: Job = {
  id: ids.job,
  workspaceId: ids.workspace,
  title: "Sample bracket",
  partNumber: "BR-100",
  partFamily: "bracket",
  version: 1,
  workshopSnapshotId: ids.workshopSnapshot,
  machineId: ids.machine,
  sourceAssetIds: [ids.asset],
  draftId: ids.draft,
  latestReleaseId: ids.release,
  createdAt: "2026-09-25T12:00:00.000Z",
};

export const release: Release = {
  id: ids.release,
  jobId: ids.job,
  revisionNumber: 1,
  snapshot: draftContent,
  sourceDraftVersion: 1,
  reviews: [],
  publishedAt: "2026-09-25T13:00:00.000Z",
  publishedBy: ids.member,
  supersedesReleaseId: null,
  allowPredecessorVisitors: false,
};

export const memberActor: Actor = {
  id: ids.member,
  displayName: "Designer",
  kind: "member",
  roles: ["designer"],
};

export const visitorActor: Actor = {
  id: ids.visitor,
  displayName: "Release visitor",
  kind: "release_visitor",
  roles: [],
};

export const releaseView: ReleaseView = {
  job,
  release,
  sourceAssets: [sourceAsset],
  replacementReleaseId: null,
  canFollowReplacement: false,
  actor: visitorActor,
  permissions: { canAsk: true, canFlag: true, canRespond: false },
};

export const releaseContext: ContextRef = {
  jobId: ids.job,
  releaseId: ids.release,
  draftId: null,
  draftVersion: null,
  stepId: ids.step,
  bendId: "B1",
};

export const openFlag: Flag = {
  id: ids.flag,
  context: releaseContext,
  question: "Should I hold the part this way?",
  photoAssetIds: [],
  createdBy: visitorActor,
  version: 1,
  status: "open",
  createdAt: "2026-09-25T13:30:00.000Z",
  response: null,
};
