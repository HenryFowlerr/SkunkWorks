import type {
  Answer,
  Bend,
  ContextRef,
  EvidenceRef,
  Finding,
  MachineProposal,
  Step,
  WorkshopSnapshot,
} from "../../contracts/domain";

/** A PDF already authorised by the caller and loaded from private storage. */
export type PdfEvidenceFile = {
  assetId: string;
  filename: string;
  mimeType: "application/pdf";
  bytes: Uint8Array;
  pageCount: number;
  /** Text extracted by a trusted server-side PDF reader, indexed by 1-based page. */
  pages: Array<{ page: number; text: string }>;
};

/** Contextual evidence is assembled by the caller after checking access. */
export type GroundingSource =
  | {
      kind: "document";
      assetId: string;
      page: number;
      text: string;
    }
  | {
      kind: "workshop_note";
      snapshotId: string;
      machineId: string;
      noteId: string;
      text: string;
    }
  | { kind: "human_clarification"; recordId: string; text: string };

export type StepTarget = { id: string; bendId: string };

export type GenerationInput = {
  jobId: string;
  partFamily: string;
  sourceAssetIds: string[];
  pdfs: PdfEvidenceFile[];
  sources: GroundingSource[];
  workshopSnapshot: WorkshopSnapshot;
  machineId: string;
  /** IDs and hinge assignments come from the supplied/reviewed manifest. */
  mappedBends: Array<Pick<Bend, "bendId" | "hingeId" | "foldRotationDeg">>;
  /** Step IDs are minted by the server before the model call. */
  stepTargets: StepTarget[];
};

export type QuestionInput = {
  context: ContextRef;
  question: string;
  pdfs: PdfEvidenceFile[];
  sources: GroundingSource[];
  workshopSnapshot: WorkshopSnapshot | null;
  knownBendIds: string[];
  knownStepTargets: StepTarget[];
};

export type DraftProposal = {
  /** Manifest identity and signed fold rotations are preserved exactly. */
  bends: Array<Pick<Bend, "bendId" | "hingeId" | "foldRotationDeg" | "finishedAngle" | "insideRadiusMm" | "directionText">>;
  steps: Step[];
  findings: Finding[];
  machineProposal: Omit<MachineProposal, "id" | "snapshotId" | "machineId" | "status" | "decidedBy"> | null;
  model: string;
};

export type AiProviderFailureCode =
  | "MISSING_CREDENTIALS"
  | "MISSING_MODEL_CONFIGURATION"
  | "PROVIDER_TIMEOUT"
  | "PROVIDER_UNAVAILABLE"
  | "MODEL_OR_FEATURE_UNAVAILABLE"
  | "PROVIDER_REFUSAL"
  | "MALFORMED_OUTPUT"
  | "UNSUPPORTED_CLAIM";

export class AiProviderError extends Error {
  readonly code: AiProviderFailureCode;
  readonly retryable: boolean;

  constructor(code: AiProviderFailureCode, options?: { retryable?: boolean }) {
    super(safeMessage(code));
    this.name = "AiProviderError";
    this.code = code;
    this.retryable = options?.retryable ?? false;
  }
}

function safeMessage(code: AiProviderFailureCode): string {
  switch (code) {
    case "MISSING_CREDENTIALS": return "AI provider credentials are not configured.";
    case "MISSING_MODEL_CONFIGURATION": return "OPENAI_MODEL is not configured.";
    case "PROVIDER_TIMEOUT": return "The AI provider did not respond before the configured timeout.";
    case "PROVIDER_UNAVAILABLE": return "The AI provider is temporarily unavailable.";
    case "MODEL_OR_FEATURE_UNAVAILABLE": return "The configured model does not support the requested PDF and structured-output features.";
    case "PROVIDER_REFUSAL": return "The AI provider refused this request.";
    case "MALFORMED_OUTPUT": return "The AI provider did not return a complete, valid structured response.";
    case "UNSUPPORTED_CLAIM": return "The AI response contained an unsupported claim or evidence pointer.";
  }
}

export type RawCitation = {
  sourceKey: string;
  excerpt: string;
  region: [number, number, number, number] | null;
};

export type PreparedEvidence = {
  sourceKey: string;
  label: string;
  text: string;
  target: GroundingSource;
  reference: EvidenceRef;
};

export type AskResult = Answer & { model: string };
